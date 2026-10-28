import type * as E from "@/shared/types/entities";
import { deliveryCharge, priceOrder, type Quote } from "@/shared/lib/pricing";
import {
  audit, checkLimit, create, feature, find, forbidden, HttpError, invalid, need, nextCounter, notify, route, scoped, settingsOf, update, type Ctx,
} from "../core";
import { createInvoice } from "./billing";

/** Orders, cart quote, KOT and kitchen display (M1, M2, M3 order side). */

export interface LineInput {
  item_id: string;
  variant_id?: string | null;
  add_on_ids?: string[];
  qty: number;
  note?: string;
  course?: E.OrderItem["course"];
  complimentary?: boolean;
}

export interface ResolvedLine extends LineInput {
  name: string;
  variant_name: string | null;
  add_ons: { id: string; name: string; price: number }[];
  unit_price: number;
  gst_rate: number;
  station: E.Station;
  available: boolean;
}

export function resolveLines(ctx: Ctx, lines: LineInput[], checkAvailability = true): ResolvedLine[] {
  const tax = settingsOf(ctx, "tax_settings");
  const errors: Record<string, string> = {};
  const out = lines.map((l, i) => {
    const item = scoped(ctx, "items").find((x) => x.id === l.item_id);
    if (!item) {
      errors[`lines.${i}`] = "This item is no longer on the menu";
      return null;
    }
    const v = l.variant_id ? scoped(ctx, "variants").find((x) => x.id === l.variant_id && x.item_id === item.id) : null;
    if (l.variant_id && !v) errors[`lines.${i}`] = `Pick a size for ${item.name}`;
    const addOns = scoped(ctx, "add_ons").filter((a) => (l.add_on_ids ?? []).includes(a.id)).map((a) => ({ id: a.id, name: a.name, price: a.price }));
    const available = item.in_stock && item.available_today;
    if (checkAvailability && !available) errors[`lines.${i}`] = `${item.name} just went out of stock`;
    if (!Number.isInteger(l.qty) || l.qty < 1) errors[`lines.${i}`] = "Quantity must be at least 1";
    const cat = scoped(ctx, "categories").find((c) => c.id === item.category_id);
    return {
      ...l, name: item.name, variant_name: v?.name ?? null, add_ons: addOns,
      unit_price: (v ? v.price : item.price) + addOns.reduce((s, a) => s + a.price, 0),
      gst_rate: item.gst_rate ?? tax.default_gst_rate, station: cat?.station ?? "kitchen", available,
    } as ResolvedLine;
  });
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0], "unavailable", errors);
  return out as ResolvedLine[];
}

/** Active offers (M4.6): happy hour % on items, buy-X-get-Y. */
function offerDiscount(ctx: Ctx, lines: ResolvedLine[]): { amount: number; names: string[] } {
  if (!feature(ctx, "offers")) return { amount: 0, names: [] };
  const day = ctx.now.getDay();
  const hm = `${String(ctx.now.getHours()).padStart(2, "0")}:${String(ctx.now.getMinutes()).padStart(2, "0")}`;
  let amount = 0;
  const names: string[] = [];
  for (const o of scoped(ctx, "offers").filter((x) => x.active && x.days.includes(day) && hm >= x.start_time && hm <= x.end_time)) {
    const eligible = lines.filter((l) => !l.complimentary && (o.item_ids.length === 0 || o.item_ids.includes(l.item_id)));
    if (o.kind === "happy_hour" && eligible.length) {
      amount += Math.round(eligible.reduce((s, l) => s + l.unit_price * l.qty, 0) * (o.discount_pct / 100));
      names.push(o.name);
    }
    if (o.kind === "bxgy" && o.buy_qty > 0) {
      for (const l of eligible) {
        const free = Math.floor(l.qty / (o.buy_qty + o.get_qty)) * o.get_qty;
        if (free > 0) {
          amount += free * l.unit_price;
          names.push(o.name);
        }
      }
    }
  }
  return { amount, names };
}

export interface QuoteInput {
  lines: LineInput[];
  order_type: E.OrderType;
  coupon_code?: string | null;
  redeem_points?: number;
  gift_card_code?: string | null;
  tip?: number;
  remove_service_charge?: boolean;
  manual_discount?: { kind: "pct" | "flat"; value: number } | null;
  customer_id?: string | null;
}

export function buildQuote(ctx: Ctx, input: QuoteInput, checkAvailability = true) {
  if (!input.lines?.length) throw invalid({ lines: "Your cart is empty" });
  const lines = resolveLines(ctx, input.lines, checkAvailability);
  const tax = settingsOf(ctx, "tax_settings");
  const loyalty = settingsOf(ctx, "loyalty_settings");
  const ds = settingsOf(ctx, "delivery_settings");
  const customer = input.customer_id ? scoped(ctx, "customers").find((c) => c.id === input.customer_id) ?? null : ctx.customer;

  const coupon = input.coupon_code ? scoped(ctx, "coupons").find((c) => c.code.toUpperCase() === input.coupon_code!.toUpperCase()) ?? null : null;
  let couponError: string | null = input.coupon_code && !coupon ? "This coupon code doesn't exist" : null;
  if (coupon && customer && coupon.usage_limit_per_customer != null) {
    const used = scoped(ctx, "coupon_redemptions").filter((r) => r.coupon_id === coupon.id && r.customer_id === customer.id).length;
    if (used >= coupon.usage_limit_per_customer) couponError = "You've already used this coupon";
  }
  const membership = customer
    ? scoped(ctx, "memberships").find((m) => m.customer_id === customer.id && m.status === "active" && m.ends_on >= ctx.now.toISOString().slice(0, 10))
    : undefined;
  const plan = membership ? scoped(ctx, "membership_plans").find((p) => p.id === membership.plan_id) : undefined;
  const offers = offerDiscount(ctx, lines);
  const foodValue = lines.reduce((s, l) => s + (l.complimentary ? 0 : l.unit_price * l.qty), 0);

  let pointsValue = 0;
  let pointsError: string | null = null;
  const points = Math.max(0, Math.floor(input.redeem_points ?? 0));
  if (points > 0) {
    if (!loyalty.enabled || !feature(ctx, "loyalty")) pointsError = "Loyalty is not on for this café";
    else if (!customer) pointsError = "Sign in to use points";
    else if (points > customer.loyalty_points) pointsError = `You have ${customer.loyalty_points} points`;
    else if (foodValue < loyalty.min_bill_to_redeem) pointsError = `Points can be used on bills above ₹${loyalty.min_bill_to_redeem / 100}`;
    else pointsValue = points * loyalty.point_value;
  }
  let giftCard: E.GiftCard | undefined;
  let giftError: string | null = null;
  if (input.gift_card_code) {
    giftCard = scoped(ctx, "gift_cards").find((g) => g.code.toUpperCase() === input.gift_card_code!.toUpperCase());
    if (!giftCard || !giftCard.active) giftError = "Gift card not found";
    else if (giftCard.expires_on < ctx.now.toISOString().slice(0, 10)) giftError = "This gift card has expired";
    else if (giftCard.balance <= 0) giftError = "This gift card has no balance left";
  }
  const delivery = input.order_type === "delivery" && ds.enabled ? deliveryCharge(ds, foodValue) : 0;

  const q: Quote = priceOrder({
    lines: lines.map((l) => ({ item_id: l.item_id, unit_price: l.unit_price, qty: l.qty, gst_rate: l.gst_rate, complimentary: l.complimentary })),
    order_type: input.order_type,
    tax,
    coupon: couponError ? null : coupon,
    membership_discount_pct: plan?.discount_pct ?? 0,
    offer_discount: offers.amount,
    manual_discount: input.manual_discount ?? null,
    remove_service_charge: input.remove_service_charge,
    delivery_charge: delivery,
    tip: feature(ctx, "tips") ? Math.max(0, input.tip ?? 0) : 0,
    points_value: pointsValue,
    gift_card_amount: giftCard && !giftError ? giftCard.balance : 0,
  });
  if (!couponError && q.coupon_error) couponError = q.coupon_error;
  return {
    lines, quote: q, coupon: coupon && !couponError ? coupon : null, coupon_error: couponError, points_used: pointsValue ? points : 0,
    points_error: pointsError, gift_card: giftCard && !giftError ? { code: giftCard.code, balance: giftCard.balance } : null, gift_card_error: giftError,
    membership: plan ? { name: plan.name, discount_pct: plan.discount_pct } : null, offers: offers.names,
    min_order_error: input.order_type === "delivery" && foodValue < ds.min_order ? `Minimum order for delivery is ₹${ds.min_order / 100}` : null,
    customer_points: customer?.loyalty_points ?? 0,
  };
}

route("POST", "/cart/quote", (ctx) => buildQuote(ctx, ctx.body), { auth: "customer_optional" });

/* ---------- order creation ---------- */

function writeItems(ctx: Ctx, orderId: string, lines: ResolvedLine[]) {
  return lines.map((l) =>
    create(ctx, "order_items", "oi", {
      order_id: orderId, item_id: l.item_id, variant_id: l.variant_id ?? null, name: l.name, variant_name: l.variant_name, add_ons: l.add_ons,
      unit_price: l.unit_price, qty: l.qty, gst_rate: l.gst_rate, note: l.note ?? "", course: l.course ?? null, kot_id: null, status: "new", complimentary: !!l.complimentary,
    }) as E.OrderItem,
  );
}

export function logStatus(ctx: Ctx, orderId: string, status: E.OrderStatus, note = "") {
  create(ctx, "order_status_logs", "osl", { order_id: orderId, status, note });
}

/** Writes totals from a fresh quote of the order's current items. */
export function recalc(ctx: Ctx, order: E.Order, extra: Partial<QuoteInput> = {}) {
  const items = scoped(ctx, "order_items").filter((i) => i.order_id === order.id && i.status !== "void");
  if (!items.length) return update("orders", order.id, { subtotal: 0, discount: 0, tax: 0, service_charge: 0, total: 0, round_off: 0 }) as E.Order;
  const q = buildQuote(ctx, {
    lines: items.map((i) => ({ item_id: i.item_id, variant_id: i.variant_id, add_on_ids: i.add_ons.map((a) => a.id), qty: i.qty, complimentary: i.complimentary })),
    order_type: order.type, coupon_code: order.coupon_code, customer_id: order.customer_id, tip: order.tip, ...extra,
  }, false).quote;
  return update("orders", order.id, {
    subtotal: q.subtotal, discount: q.discount, service_charge: q.service_charge, tax: q.tax, delivery_charge: q.delivery_charge, round_off: q.round_off, total: q.total,
  }) as E.Order;
}

/** Sends every not-yet-sent item to the kitchen as one KOT per station (M2.4, M2.5). */
export function sendKot(ctx: Ctx, order: E.Order) {
  const pending = scoped(ctx, "order_items").filter((i) => i.order_id === order.id && i.status === "new");
  if (!pending.length) return [];
  const table = order.table_id ? scoped(ctx, "dining_tables").find((t) => t.id === order.table_id) : null;
  const byStation = new Map<E.Station, E.OrderItem[]>();
  for (const it of pending) {
    const item = scoped(ctx, "items").find((x) => x.id === it.item_id);
    const st = scoped(ctx, "categories").find((c) => c.id === item?.category_id)?.station ?? "kitchen";
    byStation.set(st, [...(byStation.get(st) ?? []), it]);
  }
  const kots: E.KOT[] = [];
  for (const [station, its] of byStation) {
    const printer = scoped(ctx, "printers").find((p) => p.station === station);
    const kot = create(ctx, "kots", "kt", {
      order_id: order.id, number: nextCounter(ctx, "kot", 100), station, status: "new", table_name: table?.name ?? null, order_type: order.type,
      started_at: null, ready_at: null, printed: !!printer?.online,
    }) as E.KOT;
    for (const it of its) update("order_items", it.id, { kot_id: kot.id, status: "sent" });
    // Printer offline: the KOT still reaches the KDS; the print job is queued and the POS is alerted.
    if (printer && !printer.online) notify(ctx, "cashier", "Printer offline", `KOT #${kot.number} for ${station} is queued until ${printer.name} is back.`, "/admin/settings/devices");
    kots.push(kot);
  }
  if (order.status === "placed") {
    update("orders", order.id, { status: "accepted", accepted_at: order.accepted_at ?? ctx.now.toISOString() });
    logStatus(ctx, order.id, "accepted");
  }
  return kots;
}

function acceptAfterPlacement(ctx: Ctx, order: E.Order) {
  const flags = settingsOf(ctx, "business_type_flags");
  const goesStraight =
    (order.channel === "qr" && flags.qr_order_flow === "direct_to_kitchen") ||
    (order.channel === "app" && flags.auto_accept_online);
  if (goesStraight) sendKot(ctx, order);
  else notify(ctx, order.channel === "qr" ? "captain" : "cashier", order.channel === "qr" ? "New QR order" : "New online order", `${order.number} · ${order.type.replace("_", "-")} · ₹${order.total / 100}`, order.channel === "qr" ? "/captain" : "/pos");
}

/** Customer places an order from the app, web or table QR (M1.4–M1.6, M2.3). */
route("POST", "/orders", (ctx) => {
  const b = ctx.body;
  need(b, ["lines", "order_type", "payment_method"]);
  const type = b.order_type as E.OrderType;
  const flags = settingsOf(ctx, "business_type_flags");
  const pay = settingsOf(ctx, "payment_settings");
  const ds = settingsOf(ctx, "delivery_settings");
  if (type === "delivery" && (!flags.features.delivery || !ds.enabled)) throw invalid({ order_type: "This café is not taking delivery orders" });
  if (type === "dine_in" && !flags.features.dine_in) throw invalid({ order_type: "Dine-in is not available here" });
  if (type === "takeaway" && !flags.features.takeaway) throw invalid({ order_type: "Takeaway is not available here" });

  let table: E.DiningTable | undefined;
  let session: E.TableSession | undefined;
  if (type === "dine_in") {
    need(b, ["table_code"]);
    table = scoped(ctx, "dining_tables").find((t) => t.qr_code === b.table_code);
    if (!table) throw invalid({ table_code: "This table QR is not valid" });
  }
  const method = (b.payment_method === "upi_qr" ? "online" : b.payment_method) as E.PaymentMode;
  const allowed: Record<string, boolean> = {
    online: pay.modes.online, cod: type === "delivery" && pay.modes.cod && ds.allow_cod, upi_on_delivery: type === "delivery" && pay.modes.upi_on_delivery && ds.allow_upi_on_delivery,
    cash: type !== "delivery", upi: type !== "delivery",
  };
  if (!allowed[method]) throw invalid({ payment_method: "This payment option isn't available for this order" });

  if (type === "delivery" && !ctx.customer) throw new HttpError(401, "Sign in to order for delivery", "unauthenticated");
  // The rider has to be able to call: delivery needs a verified mobile on the account.
  if (type === "delivery" && (!ctx.customer!.phone_verified || !ctx.customer!.phone)) throw new HttpError(422, "Add and verify your mobile number so the rider can reach you", "needs_phone");
  let addressText: string | null = null;
  if (type === "delivery") {
    if (b.address_id) {
      const a = find(ctx, "addresses", b.address_id, "Address");
      if (a.customer_id !== ctx.customer!.id) throw forbidden();
      addressText = [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(", ");
    } else {
      need(b, ["address"]);
      addressText = b.address;
    }
  }

  const built = buildQuote(ctx, { ...b, customer_id: ctx.customer?.id ?? null });
  if (built.min_order_error) throw invalid({ lines: built.min_order_error });
  if (b.coupon_code && built.coupon_error) throw invalid({ coupon_code: built.coupon_error });
  if (b.redeem_points && built.points_error) throw invalid({ redeem_points: built.points_error });
  if (b.gift_card_code && built.gift_card_error) throw invalid({ gift_card_code: built.gift_card_error });
  const q = built.quote;
  const c = ctx.customer;

  if (table) {
    session = table.current_session_id ? scoped(ctx, "table_sessions").find((s) => s.id === table!.current_session_id && !s.closed_at) : undefined;
    if (!session) {
      session = create(ctx, "table_sessions", "ts", { table_id: table.id, guests: Number(b.guests ?? 2), captain_id: null, customer_id: c?.id ?? null, opened_at: ctx.now.toISOString(), closed_at: null, waiter_called_at: null }) as E.TableSession;
      update("dining_tables", table.id, { status: "occupied", current_session_id: session.id });
    }
  }

  // Guest at a table orders more and will pay at the counter: add it to the table's open bill, one bill per visit.
  const running = session && method !== "online" ? runningTableOrder(ctx, session.id) : undefined;
  if (running) {
    writeItems(ctx, running.id, built.lines);
    let o = recalc(ctx, running);
    if (o.status === "ready" || o.status === "served") o = update("orders", o.id, { status: "accepted" }) as E.Order;
    logStatus(ctx, o.id, o.status, "More items from the table QR");
    acceptAfterPlacement(ctx, o);
    return { order: find(ctx, "orders", o.id), payment: null };
  }
  const order = create(ctx, "orders", "or", {
    number: `O-${nextCounter(ctx, "order", 1000)}`, token: null, type, channel: type === "dine_in" ? "qr" : "app", status: "placed",
    payment_status: method === "online" ? "pending" : "unpaid", payment_method: method,
    customer_id: c?.id ?? null, customer_name: c?.name ?? b.customer_name ?? null, customer_phone: c?.phone ?? b.customer_phone ?? null,
    table_id: table?.id ?? null, table_session_id: session?.id ?? null, guests: table ? Number(b.guests ?? session?.guests ?? 2) : null,
    captain_id: null, cashier_id: null, address_text: addressText, pickup_time: type === "takeaway" ? b.pickup_time ?? null : null, note: b.note ?? "",
    coupon_code: built.coupon?.code ?? null, points_redeemed: built.points_used, gift_card_code: built.gift_card?.code ?? null,
    subtotal: q.subtotal, discount: q.discount, service_charge: q.service_charge, tax: q.tax, delivery_charge: q.delivery_charge, packaging: q.packaging,
    tip: q.tip, round_off: q.round_off, total: q.total, delivery_otp: type === "delivery" ? String(1000 + Math.floor(Math.random() * 9000)) : null,
    idempotency_key: ctx.idem ?? null, bill_requested: false, accepted_at: null, ready_at: null, completed_at: null,
  }) as E.Order;
  writeItems(ctx, order.id, built.lines);
  logStatus(ctx, order.id, "placed");

  if (type === "delivery") {
    create(ctx, "deliveries", "dl", {
      order_id: order.id, rider_id: null, status: "unassigned", charge: q.delivery_charge, distance_km: Math.round((1 + Math.random() * 5) * 10) / 10,
      to_collect: method === "online" ? 0 : q.payable, collected: 0, collected_mode: null, proof: null, accepted_at: null, picked_at: null, delivered_at: null,
    });
  }
  // Prepaid orders wait for the gateway; everything else moves on now.
  // A guest at the table is here to eat: dine-in goes to the kitchen now and is paid later at the table.
  if (type === "dine_in" || method !== "online") acceptAfterPlacement(ctx, order);
  return { order: find(ctx, "orders", order.id), payment: method === "online" ? { gateway: pay.gateway, key_id: pay.gateway_key_id, amount: q.payable, order_id: order.id } : null };
}, { auth: "customer_optional" });

/** Dummy gateway: the checkout page posts the result; in http mode the gateway webhook does this, once. */
route("POST", "/orders/:id/pay", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  if (o.payment_status === "paid") return { order: o, already_paid: true };
  if (!ctx.body.result) {
    // Paid by scanning the café's UPI QR: wait for the cashier to confirm (POST /orders/:id/confirm-payment).
    notify(ctx, "cashier", "Check UPI payment", `${o.number} · ₹${o.total / 100}${ctx.body.reference ? ` · ref ${ctx.body.reference}` : ""}`, "/pos");
    return { order: update("orders", o.id, { payment_status: "pending" }), awaiting_confirmation: true };
  }
  if (ctx.body.result === "failure") {
    update("orders", o.id, { payment_status: "unpaid" });
    create(ctx, "payments", "py", { invoice_id: null, order_id: o.id, mode: "online", amount: o.total, reference: null, status: "failed", gateway: "dummy", shift_id: null });
    return { order: find(ctx, "orders", o.id), failed: true };
  }
  const payable = o.total - o.points_redeemed * settingsOf(ctx, "loyalty_settings").point_value;
  create(ctx, "payments", "py", { invoice_id: null, order_id: o.id, mode: "online", amount: Math.max(0, payable), reference: `pay_dummy_${Date.now()}`, status: "success", gateway: "dummy", shift_id: null });
  update("orders", o.id, { payment_status: "paid" });
  const order = find(ctx, "orders", o.id);
  createInvoice(ctx, order);
  acceptAfterPlacement(ctx, order);
  return { order: find(ctx, "orders", o.id) };
}, { auth: "customer_optional" });

route("POST", "/orders/:id/confirm-payment", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  if (o.payment_status !== "paid") {
    create(ctx, "payments", "py", { invoice_id: null, order_id: o.id, mode: "upi", amount: o.total, reference: ctx.body?.reference ?? null, status: "success", gateway: "upi_qr", shift_id: null });
    update("orders", o.id, { payment_status: "paid" });
    createInvoice(ctx, find(ctx, "orders", o.id));
    if (o.status === "placed") acceptAfterPlacement(ctx, find(ctx, "orders", o.id));
  }
  return orderDetail(ctx, find(ctx, "orders", o.id));
}, { perm: "pos.bill" });

route("GET", "/me/orders", (ctx) =>
  scoped(ctx, "orders").filter((o) => o.customer_id === ctx.customer!.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50),
{ auth: "customer" });

export function orderDetail(ctx: Ctx, o: E.Order) {
  const items = scoped(ctx, "order_items").filter((i) => i.order_id === o.id);
  const kots = scoped(ctx, "kots").filter((k) => k.order_id === o.id);
  const delivery = scoped(ctx, "deliveries").find((d) => d.order_id === o.id) ?? null;
  const rider = delivery?.rider_id ? scoped(ctx, "riders").find((r) => r.id === delivery.rider_id) : null;
  const invoice = scoped(ctx, "invoices").find((i) => i.order_id === o.id) ?? null;
  const table = o.table_id ? scoped(ctx, "dining_tables").find((t) => t.id === o.table_id) ?? null : null;
  return {
    ...o, items, kots, table, invoice,
    delivery: delivery ? { ...delivery, rider: rider ? { name: rider.name, phone: rider.phone, vehicle: rider.vehicle } : null } : null,
    payments: scoped(ctx, "payments").filter((p) => p.order_id === o.id),
    status_log: scoped(ctx, "order_status_logs").filter((l) => l.order_id === o.id),
    feedback: scoped(ctx, "feedback").find((f) => f.order_id === o.id) ?? null,
    table_bills: o.table_session_id ? tableBills(ctx, o.table_session_id) : null,
  };
}

/** Order detail: the customer who placed it, staff, or anyone holding the table QR for that order. */
route("GET", "/orders/:id", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  const ownsIt = ctx.customer && o.customer_id === ctx.customer.id;
  const atTable = ctx.query.table_code && o.table_id && scoped(ctx, "dining_tables").some((t) => t.id === o.table_id && t.qr_code === ctx.query.table_code);
  if (!ctx.user && !ownsIt && !atTable && !ctx.rider) throw forbidden();
  return orderDetail(ctx, o);
}, { auth: "public" });

route("POST", "/orders/:id/cancel", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  const isOwner = ctx.customer && o.customer_id === ctx.customer.id;
  if (!ctx.user && !isOwner) throw forbidden();
  if (!ctx.user && o.status !== "placed") throw invalid({ status: "The café has already accepted this order. Please call them." });
  if (["completed", "delivered", "cancelled"].includes(o.status)) throw invalid({ status: "This order can't be cancelled now" });
  update("orders", o.id, { status: "cancelled" });
  logStatus(ctx, o.id, "cancelled", ctx.body?.reason ?? "");
  for (const k of scoped(ctx, "kots").filter((k) => k.order_id === o.id)) update("kots", k.id, { status: "served" });
  if (ctx.user) audit(ctx, "cancel", "order", o.id, { status: o.status }, { status: "cancelled", reason: ctx.body?.reason });
  if (o.payment_status === "paid") notify(ctx, "manager", "Refund needed", `${o.number} was cancelled after payment`, "/admin/orders");
  freeTableIfDone(ctx, o);
  return find(ctx, "orders", o.id);
}, { auth: "staff_or_customer" });

route("POST", "/orders/:id/feedback", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  if (!ctx.customer || o.customer_id !== ctx.customer.id) throw forbidden();
  if (scoped(ctx, "feedback").some((f) => f.order_id === o.id)) throw invalid({ order: "You've already rated this order" });
  for (const k of ["food", "service", "ambience"]) if (!(ctx.body[k] >= 1 && ctx.body[k] <= 5)) throw invalid({ [k]: "Pick 1 to 5 stars" });
  const f = create(ctx, "feedback", "fb", { order_id: o.id, customer_id: o.customer_id, food: ctx.body.food, service: ctx.body.service, ambience: ctx.body.ambience, comment: ctx.body.comment ?? "", replied: false }) as E.Feedback;
  if (Math.min(f.food, f.service, f.ambience) <= 2) notify(ctx, "manager", "Low rating", `${o.number}: ${f.food}/${f.service}/${f.ambience} stars. "${f.comment}"`, "/admin/marketing/feedback");
  return f;
}, { auth: "customer" });

/* ---------- staff order management ---------- */

route("GET", "/orders", (ctx) => {
  let rows = scoped(ctx, "orders");
  const { status, type, active, date, from, to, q, channel } = ctx.query;
  if (active) rows = rows.filter((o) => !["completed", "cancelled", "delivered"].includes(o.status) || (o.payment_status !== "paid" && o.status !== "cancelled"));
  if (status) rows = rows.filter((o) => status.split(",").includes(o.status));
  if (type) rows = rows.filter((o) => o.type === type);
  if (channel) rows = rows.filter((o) => o.channel === channel);
  if (date) rows = rows.filter((o) => o.created_at.slice(0, 10) === date);
  if (from) rows = rows.filter((o) => o.created_at.slice(0, 10) >= from);
  if (to) rows = rows.filter((o) => o.created_at.slice(0, 10) <= to);
  if (q) rows = rows.filter((o) => `${o.number} ${o.customer_name ?? ""} ${o.customer_phone ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Number(ctx.query.limit ?? 200));
  const tables = scoped(ctx, "dining_tables");
  return sorted.map((o) => ({ ...o, table_name: tables.find((t) => t.id === o.table_id)?.name ?? null, items: scoped(ctx, "order_items").filter((i) => i.order_id === o.id) }));
});

/** POS or captain opens an order (dine-in at a table, takeaway, counter token, phone delivery). */
route("POST", "/pos/orders", (ctx) => {
  const b = ctx.body;
  need(b, ["type"]);
  const type = b.type as E.OrderType;
  let table: E.DiningTable | undefined;
  let session: E.TableSession | undefined;
  if (type === "dine_in") {
    need(b, ["table_id"]);
    table = find(ctx, "dining_tables", b.table_id, "Table");
    session = table.current_session_id ? scoped(ctx, "table_sessions").find((s) => s.id === table!.current_session_id && !s.closed_at) : undefined;
    const open = session && runningTableOrder(ctx, session.id);
    if (open) return orderDetail(ctx, open); // a table has one running unpaid order; add items to it
    if (!session) {
      session = create(ctx, "table_sessions", "ts", { table_id: table.id, guests: Number(b.guests ?? 2), captain_id: ctx.user!.role === "captain" ? ctx.user!.id : null, customer_id: b.customer_id ?? null, opened_at: ctx.now.toISOString(), closed_at: null, waiter_called_at: null }) as E.TableSession;
      update("dining_tables", table.id, { status: "occupied", current_session_id: session.id });
    }
  }
  const cust = b.customer_id ? find(ctx, "customers", b.customer_id, "Customer") : null;
  const order = create(ctx, "orders", "or", {
    number: `O-${nextCounter(ctx, "order", 1000)}`, token: type === "counter" ? (nextCounter(ctx, "token") % 999) || 1 : null, type,
    channel: ctx.user!.role === "captain" ? "captain" : "pos", status: "accepted", payment_status: "unpaid", payment_method: null,
    customer_id: cust?.id ?? null, customer_name: cust?.name ?? b.customer_name ?? null, customer_phone: cust?.phone ?? b.customer_phone ?? null,
    table_id: table?.id ?? null, table_session_id: session?.id ?? null, guests: table ? Number(b.guests ?? session?.guests ?? 2) : null,
    captain_id: ctx.user!.role === "captain" ? ctx.user!.id : session?.captain_id ?? null, cashier_id: ctx.user!.role === "cashier" ? ctx.user!.id : null,
    address_text: b.address ?? null, pickup_time: b.pickup_time ?? null, note: b.note ?? "", coupon_code: null, points_redeemed: 0, gift_card_code: null,
    subtotal: 0, discount: 0, service_charge: 0, tax: 0, delivery_charge: 0, packaging: 0, tip: 0, round_off: 0, total: 0, delivery_otp: type === "delivery" ? String(1000 + Math.floor(Math.random() * 9000)) : null,
    idempotency_key: ctx.idem ?? null, bill_requested: false, accepted_at: ctx.now.toISOString(), ready_at: null, completed_at: null,
  }) as E.Order;
  logStatus(ctx, order.id, "accepted", "Opened at POS");
  if (b.lines?.length) {
    writeItems(ctx, order.id, resolveLines(ctx, b.lines));
    recalc(ctx, order);
  }
  if (type === "delivery") create(ctx, "deliveries", "dl", { order_id: order.id, rider_id: null, status: "unassigned", charge: 0, distance_km: 2, to_collect: 0, collected: 0, collected_mode: null, proof: null, accepted_at: null, picked_at: null, delivered_at: null });
  return orderDetail(ctx, find(ctx, "orders", order.id));
}, { perm: "orders.take" });

/**
 * Add items to a running order. `version` is the order's updated_at the device last saw:
 * two captains editing the same table → the second gets 409 and refreshes (SRS 16.5).
 */
route("POST", "/orders/:id/items", (ctx) => {
  let o = find(ctx, "orders", ctx.params.id, "Order");
  const visit = o.table_session_id ? scoped(ctx, "table_sessions").find((s) => s.id === o.table_session_id && !s.closed_at) : undefined;
  const locked = o.payment_status !== "unpaid" || o.status === "completed";
  if (!(visit && locked) && (["completed", "cancelled", "delivered"].includes(o.status) || o.payment_status !== "unpaid")) throw invalid({ order: "This bill is already closed" });
  if (ctx.body.version && ctx.body.version !== o.updated_at) throw new HttpError(409, "Someone else just changed this order. Refreshing…", "version_conflict");
  // Table bill already paid: add to the visit's unpaid bill, or start one.
  if (visit && locked) o = runningTableOrder(ctx, visit.id) ?? followUpOrder(ctx, o);
  need(ctx.body, ["lines"]);
  writeItems(ctx, o.id, resolveLines(ctx, ctx.body.lines));
  const next = recalc(ctx, o);
  if (o.status === "ready" || o.status === "served") update("orders", o.id, { status: "accepted" });
  if (ctx.body.send_kot) sendKot(ctx, next);
  return orderDetail(ctx, find(ctx, "orders", o.id));
}, { perm: "orders.take" });

/** Change qty or note of an unsent item. Sent items are changed by void (with limit). */
route("PATCH", "/order-items/:id", (ctx) => {
  const it = find(ctx, "order_items", ctx.params.id, "Item");
  if (it.status !== "new") throw invalid({ status: "Already sent to kitchen. Use void instead." });
  const o = find(ctx, "orders", it.order_id);
  if (ctx.body.qty === 0) update("order_items", it.id, { deleted_at: ctx.now.toISOString() });
  else update("order_items", it.id, { qty: ctx.body.qty ?? it.qty, note: ctx.body.note ?? it.note, course: ctx.body.course ?? it.course });
  recalc(ctx, o);
  return orderDetail(ctx, find(ctx, "orders", o.id));
}, { perm: "orders.take" });

route("POST", "/orders/:id/kot", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  if (ctx.body?.version && ctx.body.version !== o.updated_at) throw new HttpError(409, "Someone else just changed this order. Refreshing…", "version_conflict");
  const kots = sendKot(ctx, o);
  if (!kots.length) throw invalid({ items: "No new items to send" });
  return { kots, order: orderDetail(ctx, find(ctx, "orders", o.id)) };
}, { perm: "orders.take" });

/** Accept / reject online orders, mark served, handed over, etc. */
route("PATCH", "/orders/:id/status", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  const to = ctx.body.status as E.OrderStatus;
  if (to === "accepted") {
    if (!ctx.perms.includes("orders.accept_online") && !ctx.perms.includes("orders.take")) throw forbidden();
    if (o.status !== "placed") throw invalid({ status: "Already accepted" });
    sendKot(ctx, o);
    if (o.channel === "qr") update("orders", o.id, { captain_id: ctx.user!.id });
    return orderDetail(ctx, find(ctx, "orders", o.id));
  }
  const allowed: Partial<Record<E.OrderStatus, E.OrderStatus[]>> = {
    served: ["ready", "preparing", "accepted"],
    completed: ["ready", "served", "delivered"],
    out_for_delivery: ["ready"],
    ready: ["preparing", "accepted"],
  };
  if (!allowed[to]?.includes(o.status)) throw invalid({ status: `Can't move from ${o.status} to ${to}` });
  if (to === "completed" && o.payment_status !== "paid") throw invalid({ status: "Take payment before closing this order" });
  update("orders", o.id, { status: to, ...(to === "completed" ? { completed_at: ctx.now.toISOString() } : {}), ...(to === "ready" ? { ready_at: ctx.now.toISOString() } : {}) });
  if (to === "served") for (const i of scoped(ctx, "order_items").filter((i) => i.order_id === o.id && i.status === "ready")) update("order_items", i.id, { status: "served" });
  logStatus(ctx, o.id, to);
  if (to === "completed") freeTableIfDone(ctx, find(ctx, "orders", o.id));
  return orderDetail(ctx, find(ctx, "orders", o.id));
}, { perm: "orders.take" });

route("POST", "/orders/:id/request-bill", (ctx) => {
  let o = find(ctx, "orders", ctx.params.id, "Order");
  const isGuest = ctx.query.table_code && o.table_id && scoped(ctx, "dining_tables").some((t) => t.id === o.table_id && t.qr_code === ctx.query.table_code);
  if (!ctx.user && !isGuest) throw forbidden();
  if (o.payment_status !== "unpaid" && o.table_session_id) o = runningTableOrder(ctx, o.table_session_id) ?? o;
  update("orders", o.id, { bill_requested: true });
  if (o.table_id) update("dining_tables", o.table_id, { status: "bill_requested" });
  notify(ctx, "cashier", "Bill requested", `${o.number}${o.table_id ? ` · ${scoped(ctx, "dining_tables").find((t) => t.id === o.table_id)?.name}` : ""}`, "/pos");
  return orderDetail(ctx, find(ctx, "orders", o.id));
}, { auth: "public" });

/** Void a sent item (M3.6): above the user's void limit needs approver_id from a manager PIN. */
route("POST", "/orders/:id/void", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  need(ctx.body, ["order_item_id", "reason"]);
  const it = find(ctx, "order_items", ctx.body.order_item_id, "Item");
  if (it.order_id !== o.id || it.status === "void") throw invalid({ order_item_id: "Item not on this order" });
  const qty = Math.min(Number(ctx.body.qty ?? it.qty), it.qty);
  const amount = it.unit_price * qty;
  const approver = checkLimit(ctx, "void_value", amount, ctx.body.approver_id);
  if (qty === it.qty) update("order_items", it.id, { status: "void" });
  else {
    update("order_items", it.id, { qty: it.qty - qty });
    const { id: _id, ...copy } = it;
    create(ctx, "order_items", "oi", { ...copy, qty, status: "void" });
  }
  create(ctx, "voids", "vd", { order_id: o.id, order_item_id: it.id, amount, reason: ctx.body.reason, approved_by: approver?.id ?? null });
  audit(ctx, "void", "order_item", it.id, { qty: it.qty, name: it.name }, { voided: qty, reason: ctx.body.reason, approved_by: approver?.name ?? null });
  recalc(ctx, o);
  return orderDetail(ctx, find(ctx, "orders", o.id));
}, { perm: "orders.take" });

/** Complimentary item (needs discount permission). */
route("POST", "/order-items/:id/complimentary", (ctx) => {
  const it = find(ctx, "order_items", ctx.params.id, "Item");
  const o = find(ctx, "orders", it.order_id);
  checkLimit(ctx, "discount_pct", 100, ctx.body?.approver_id);
  update("order_items", it.id, { complimentary: !it.complimentary });
  audit(ctx, "discount", "order_item", it.id, { complimentary: it.complimentary }, { complimentary: !it.complimentary, reason: ctx.body?.reason ?? "" });
  recalc(ctx, o);
  return orderDetail(ctx, find(ctx, "orders", o.id));
}, { perm: "pos.discount_preset" });

/** The table's running bill that can still take items: open, and nobody has paid (or is paying by UPI) yet. */
export function runningTableOrder(ctx: Ctx, sessionId: string): E.Order | undefined {
  return scoped(ctx, "orders").filter((o) => o.table_session_id === sessionId && !["completed", "cancelled"].includes(o.status) && o.payment_status === "unpaid").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

/** Every bill of one table visit, with what is paid and what is still due (paid bills are never changed). */
export function tableBills(ctx: Ctx, sessionId: string) {
  const orders = scoped(ctx, "orders").filter((o) => o.table_session_id === sessionId && o.status !== "cancelled").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const invoices = scoped(ctx, "invoices");
  const paid = (o: E.Order) => o.payment_status === "paid";
  const confirming = (o: E.Order) => o.payment_status === "pending";
  return {
    paid: orders.filter(paid).reduce((a, o) => a + o.total, 0),
    confirming: orders.filter(confirming).reduce((a, o) => a + o.total, 0),
    due: orders.filter((o) => !paid(o) && !confirming(o)).reduce((a, o) => a + o.total, 0),
    orders: orders.map((o) => {
      const inv = invoices.find((i) => i.order_id === o.id);
      return { id: o.id, number: o.number, total: o.total, status: o.status, payment_status: o.payment_status, invoice_id: inv?.id ?? null, invoice_number: inv?.number ?? null, created_at: o.created_at };
    }),
  };
}

/** Items added after the table's bill was paid go on a new bill for the same visit; the cashier collects only that. */
function followUpOrder(ctx: Ctx, paid: E.Order): E.Order {
  const { id: _id, created_at: _c, updated_at: _u, ...same } = paid; // eslint-disable-line @typescript-eslint/no-unused-vars
  const o = create(ctx, "orders", "or", {
    ...same, number: `O-${nextCounter(ctx, "order", 1000)}`, status: "accepted", payment_status: "unpaid", payment_method: null, cashier_id: null, note: "", coupon_code: null, points_redeemed: 0, gift_card_code: null,
    subtotal: 0, discount: 0, service_charge: 0, tax: 0, delivery_charge: 0, packaging: 0, tip: 0, round_off: 0, total: 0, delivery_otp: null, idempotency_key: null, bill_requested: false,
    accepted_at: ctx.now.toISOString(), ready_at: null, completed_at: null,
  }) as E.Order;
  logStatus(ctx, o.id, "accepted", `Extra items after ${paid.number} was paid`);
  if (paid.table_id) update("dining_tables", paid.table_id, { status: "occupied" });
  return o;
}

export function freeTableIfDone(ctx: Ctx, o: E.Order) {
  if (!o.table_id || !o.table_session_id) return;
  // The visit ends when nothing is left to pay; bills already paid (e.g. by UPI at the table) close with it.
  const open = scoped(ctx, "orders").filter((x) => x.table_session_id === o.table_session_id && x.id !== o.id && !["completed", "cancelled"].includes(x.status));
  if (open.some((x) => x.payment_status !== "paid")) return;
  for (const x of open) update("orders", x.id, { status: "completed", completed_at: ctx.now.toISOString() });
  update("table_sessions", o.table_session_id, { closed_at: ctx.now.toISOString() });
  update("dining_tables", o.table_id, { status: "cleaning", current_session_id: null });
}

/* ---------- kitchen display ---------- */

route("GET", "/kots", (ctx) => {
  const station = ctx.query.station;
  const since = new Date(ctx.now.getTime() - 12 * 3600000).toISOString();
  return scoped(ctx, "kots")
    .filter((k) => (!station || k.station === station) && (ctx.query.all ? true : k.status !== "served") && k.created_at >= since)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((k) => {
      const o = scoped(ctx, "orders").find((x) => x.id === k.order_id);
      return { ...k, order_number: o?.number, order_status: o?.status, token: o?.token, customer_name: o?.customer_name, note: o?.note ?? "", items: scoped(ctx, "order_items").filter((i) => i.kot_id === k.id) };
    })
    .filter((k) => k.order_status !== "cancelled");
}, { perm: "kds.use" });

function syncOrderFromKots(ctx: Ctx, orderId: string) {
  const o = find(ctx, "orders", orderId);
  const kots = scoped(ctx, "kots").filter((k) => k.order_id === orderId);
  const pendingItems = scoped(ctx, "order_items").some((i) => i.order_id === orderId && i.status === "new");
  if (kots.length && kots.every((k) => k.status === "ready" || k.status === "served") && !pendingItems) {
    if (!["ready", "served", "out_for_delivery", "delivered", "completed"].includes(o.status)) {
      update("orders", o.id, { status: "ready", ready_at: ctx.now.toISOString() });
      logStatus(ctx, o.id, "ready");
      const who = o.type === "delivery" ? "rider" : o.type === "dine_in" ? "captain" : "cashier";
      notify(ctx, who, "Order ready", `${o.number}${o.table_id ? ` · ${scoped(ctx, "dining_tables").find((t) => t.id === o.table_id)?.name}` : o.token ? ` · Token ${o.token}` : ""} is ready`, who === "captain" ? "/captain" : "/pos", o.captain_id);
    }
  } else if (kots.some((k) => k.status === "preparing") && ["accepted", "placed"].includes(o.status)) {
    update("orders", o.id, { status: "preparing" });
    logStatus(ctx, o.id, "preparing");
  }
}

route("PATCH", "/kots/:id", (ctx) => {
  const k = find(ctx, "kots", ctx.params.id, "KOT");
  const to = ctx.body.status as E.KOT["status"];
  if (!["preparing", "ready", "served"].includes(to)) throw invalid({ status: "Unknown status" });
  update("kots", k.id, { status: to, ...(to === "preparing" && !k.started_at ? { started_at: ctx.now.toISOString() } : {}), ...(to === "ready" ? { ready_at: ctx.now.toISOString() } : {}) });
  for (const i of scoped(ctx, "order_items").filter((i) => i.kot_id === k.id && i.status !== "void")) update("order_items", i.id, { status: to === "served" ? "served" : to });
  syncOrderFromKots(ctx, k.order_id);
  return find(ctx, "kots", k.id);
}, { perm: "kds.use" });

route("PATCH", "/kot-items/:id", (ctx) => {
  const it = find(ctx, "order_items", ctx.params.id, "Item");
  const to = ctx.body.status as E.OrderItem["status"];
  update("order_items", it.id, { status: to });
  if (it.kot_id) {
    const siblings = scoped(ctx, "order_items").filter((i) => i.kot_id === it.kot_id && i.status !== "void");
    const k = find(ctx, "kots", it.kot_id);
    if (siblings.every((i) => i.status === "ready" || i.status === "served")) update("kots", k.id, { status: "ready", ready_at: ctx.now.toISOString() });
    else if (k.status === "new") update("kots", k.id, { status: "preparing", started_at: ctx.now.toISOString() });
    syncOrderFromKots(ctx, it.order_id);
  }
  return find(ctx, "order_items", it.id);
}, { perm: "kds.use" });

route("POST", "/kots/:id/reprint", (ctx) => {
  const k = find(ctx, "kots", ctx.params.id, "KOT");
  audit(ctx, "reprint", "kot", k.id, null, { number: k.number });
  return update("kots", k.id, { printed: true });
}, { perm: "pos.reprint" });

export { acceptAfterPlacement };
