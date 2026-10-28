import type * as E from "@/shared/types/entities";
import { financialYear, pointsEarned } from "@/shared/lib/pricing";
import { convert } from "@/shared/lib/units";
import {
  audit, checkLimit, create, find, HttpError, invalid, need, nextCounter, notify, route, scoped, settingsOf, today, update, type Ctx,
} from "../core";
import { buildQuote, freeTableIfDone, logStatus, orderDetail } from "./orders";

/** Billing (M3): GST invoice, split payments, discounts, refunds, shifts and day close. */

/** Deducts raw materials by recipe for every billed item (M5.2). Stock may go negative; billing is never blocked. */
function deductStock(ctx: Ctx, order: E.Order) {
  const items = scoped(ctx, "order_items").filter((i) => i.order_id === order.id && i.status !== "void");
  for (const it of items) {
    const rec = scoped(ctx, "recipes").find((r) => r.item_id === it.item_id && r.variant_id === it.variant_id) ?? scoped(ctx, "recipes").find((r) => r.item_id === it.item_id && !r.variant_id);
    if (!rec) continue;
    for (const l of scoped(ctx, "recipe_lines").filter((x) => x.recipe_id === rec.id)) {
      const m = ctx.t.raw_materials.find((x) => x.id === l.raw_material_id && x.tenant_id === ctx.tenant.id);
      if (!m) continue;
      const qty = convert(l.qty, l.unit, m.unit) * it.qty;
      const bal = Math.round((m.stock - qty) * 1000) / 1000;
      update("raw_materials", m.id, { stock: bal });
      create(ctx, "stock_ledger", "sl", { raw_material_id: m.id, qty: -qty, reason: "sale", ref_id: order.id, balance_after: bal });
      if (bal < m.min_level && m.stock >= m.min_level) notify(ctx, "manager", "Low stock", `${m.name} is below ${m.min_level} ${m.unit}`, "/admin/stock");
    }
  }
}

/**
 * Creates the GST invoice for a paid order: sequential number per financial year (row lock in MySQL),
 * tax lines, stock deduction, loyalty, coupon / gift card redemption and customer stats, in one transaction.
 */
export function createInvoice(ctx: Ctx, order: E.Order, opts: { shiftId?: string | null } = {}): E.Invoice {
  const existing = scoped(ctx, "invoices").find((i) => i.order_id === order.id);
  if (existing) return existing;
  const tax = settingsOf(ctx, "tax_settings");
  const fy = financialYear(ctx.now);
  const built = buildQuote(ctx, {
    lines: scoped(ctx, "order_items").filter((i) => i.order_id === order.id && i.status !== "void").map((i) => ({ item_id: i.item_id, variant_id: i.variant_id, add_on_ids: i.add_ons.map((a) => a.id), qty: i.qty, complimentary: i.complimentary })),
    order_type: order.type, coupon_code: order.coupon_code, customer_id: order.customer_id, tip: order.tip,
    manual_discount: null, redeem_points: 0, gift_card_code: null,
  }, false);
  const q = built.quote;
  const manual = scoped(ctx, "discounts").filter((d) => d.order_id === order.id).reduce((s, d) => s + d.amount, 0);
  const seq = nextCounter(ctx, `invoice:${fy}`);
  const number = `${tax.invoice_prefix}${fy.slice(2)}/${String(seq).padStart(6, "0")}`;
  const cgst = Math.round((order.tax) / 2);
  const inv = create(ctx, "invoices", "iv", {
    order_id: order.id, number, financial_year: fy, bill_of_supply: tax.gst_scheme === "composition", subtotal: order.subtotal, discount: order.discount,
    service_charge: order.service_charge, taxable: order.subtotal - order.discount + order.service_charge, cgst, sgst: order.tax - cgst, round_off: order.round_off,
    total: order.total, cashier_id: ctx.user?.id ?? null, shift_id: opts.shiftId ?? null, reprints: 0,
  }) as E.Invoice;
  // Tax lines from the quote, scaled when a manual discount changed the taxable value.
  const ratio = q.taxable ? (inv.taxable / q.taxable) : 1;
  for (const tl of q.tax_lines) {
    create(ctx, "invoice_taxes", "ivt", { invoice_id: inv.id, rate: tl.rate, taxable: Math.round(tl.taxable * ratio), cgst: Math.round(tl.cgst * ratio), sgst: Math.round(tl.sgst * ratio) });
  }
  void manual;
  for (const p of scoped(ctx, "payments").filter((p) => p.order_id === order.id && !p.invoice_id)) update("payments", p.id, { invoice_id: inv.id });

  deductStock(ctx, order);

  if (order.coupon_code) {
    const c = scoped(ctx, "coupons").find((x) => x.code === order.coupon_code);
    if (c) {
      // Atomic counter: only the allowed number of redemptions succeed.
      if (c.usage_limit_total != null && c.used_count >= c.usage_limit_total) throw new HttpError(409, "This coupon just ran out", "coupon_exhausted");
      update("coupons", c.id, { used_count: c.used_count + 1 });
      create(ctx, "coupon_redemptions", "cr", { coupon_id: c.id, order_id: order.id, customer_id: order.customer_id, amount: q.coupon_discount });
    }
  }
  if (order.customer_id) {
    const cust = find(ctx, "customers", order.customer_id);
    const loyalty = settingsOf(ctx, "loyalty_settings");
    let points = cust.loyalty_points;
    if (order.points_redeemed) {
      points -= order.points_redeemed;
      create(ctx, "loyalty_ledger", "ll", { customer_id: cust.id, order_id: order.id, points: -order.points_redeemed, reason: "redeem", expires_at: null });
    }
    const earned = loyalty.enabled ? pointsEarned(inv.taxable, loyalty.earn_per_rupees) : 0;
    if (earned) {
      points += earned;
      create(ctx, "loyalty_ledger", "ll", { customer_id: cust.id, order_id: order.id, points: earned, reason: "earn", expires_at: new Date(ctx.now.getTime() + loyalty.expiry_days * 86400000).toISOString() });
    }
    update("customers", cust.id, { loyalty_points: points, visits: cust.visits + 1, total_spend: cust.total_spend + inv.total, last_visit_at: ctx.now.toISOString(), tags: [...new Set([...cust.tags.filter((t) => t !== "lapsed" && t !== "new"), ...(cust.visits + 1 >= 3 ? ["regular" as const] : []), ...(cust.total_spend + inv.total > 400000 ? ["vip" as const] : [])])] });
  }
  return inv;
}

/** Open shift of the signed-in cashier (or any open shift for managers). */
function currentShift(ctx: Ctx) {
  return scoped(ctx, "shifts").find((s) => !s.closed_at && (s.user_id === ctx.user!.id || ["owner", "manager"].includes(ctx.user!.role))) ?? null;
}

/**
 * Settle a bill at the POS: optional discount (limit-checked), coupon, points, gift card, service charge removal,
 * then one or more payments (split). Creates the invoice once the payments cover the total.
 */
route("POST", "/orders/:id/settle", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  if (o.payment_status === "paid" && scoped(ctx, "invoices").some((i) => i.order_id === o.id)) throw invalid({ order: "This bill is already paid" });
  const shift = currentShift(ctx);
  if (!shift) throw new HttpError(409, "Open your shift with the opening cash first", "no_shift");
  const b = ctx.body;
  need(b, ["payments"]);

  // Discount (M3.6): % above the role's limit, or flat equal to more than the limit %, needs a manager PIN.
  if (b.discount) {
    const base = o.subtotal;
    const pct = b.discount.kind === "pct" ? Number(b.discount.value) : base ? (Number(b.discount.value) / base) * 100 : 0;
    if (!b.discount.reason) throw invalid({ reason: "Add a reason for the discount" });
    const approver = checkLimit(ctx, "discount_pct", pct, b.approver_id);
    const amt = b.discount.kind === "pct" ? Math.round((base * pct) / 100) : Math.round(Number(b.discount.value));
    for (const d of scoped(ctx, "discounts").filter((d) => d.order_id === o.id)) update("discounts", d.id, { deleted_at: ctx.now.toISOString() });
    create(ctx, "discounts", "dc", { order_id: o.id, kind: b.discount.kind, value: Number(b.discount.value), amount: amt, reason: b.discount.reason, approved_by: approver?.id ?? null });
    audit(ctx, "discount", "order", o.id, null, { ...b.discount, amount: amt, approved_by: approver?.name ?? null });
  }
  if (b.remove_service_charge && o.service_charge) audit(ctx, "service_charge_removed", "order", o.id, { service_charge: o.service_charge }, { service_charge: 0 });

  const d = scoped(ctx, "discounts").find((x) => x.order_id === o.id);
  const built = buildQuote(ctx, {
    lines: scoped(ctx, "order_items").filter((i) => i.order_id === o.id && i.status !== "void").map((i) => ({ item_id: i.item_id, variant_id: i.variant_id, add_on_ids: i.add_ons.map((a) => a.id), qty: i.qty, complimentary: i.complimentary })),
    order_type: o.type, coupon_code: b.coupon_code ?? o.coupon_code, customer_id: b.customer_id ?? o.customer_id, redeem_points: b.redeem_points ?? 0,
    gift_card_code: b.gift_card_code ?? null, tip: b.tip ?? o.tip, remove_service_charge: !!b.remove_service_charge,
    manual_discount: d ? { kind: d.kind, value: d.value } : null,
  }, false);
  if (b.coupon_code && built.coupon_error) throw invalid({ coupon_code: built.coupon_error });
  if (b.redeem_points && built.points_error) throw invalid({ redeem_points: built.points_error });
  if (b.gift_card_code && built.gift_card_error) throw invalid({ gift_card_code: built.gift_card_error });
  const q = built.quote;

  const payments = (b.payments as { mode: E.PaymentMode; amount: number; reference?: string }[]).filter((p) => p.amount > 0);
  const nonCash = q.points_value + q.gift_card_amount;
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  if (paid + nonCash < q.total) throw invalid({ payments: `₹${((q.total - nonCash - paid) / 100).toFixed(2)} still to collect` });

  const order = update("orders", o.id, {
    subtotal: q.subtotal, discount: q.discount, service_charge: q.service_charge, tax: q.tax, delivery_charge: q.delivery_charge, tip: q.tip,
    round_off: q.round_off, total: q.total, coupon_code: built.coupon?.code ?? null, points_redeemed: built.points_used, gift_card_code: built.gift_card?.code ?? null,
    customer_id: b.customer_id ?? o.customer_id, cashier_id: ctx.user!.id, payment_status: "paid",
    payment_method: payments.length > 1 ? payments[0].mode : (payments[0]?.mode ?? (q.gift_card_amount ? "gift_card" : "points")),
  }) as E.Order;
  // Cash change is returned, so record cash only up to what was due.
  let due = q.total - nonCash;
  for (const p of payments) {
    const amt = Math.min(p.amount, due);
    if (amt <= 0) continue;
    due -= amt;
    create(ctx, "payments", "py", { invoice_id: null, order_id: o.id, mode: p.mode, amount: amt, reference: p.reference ?? null, status: "success", gateway: null, shift_id: shift.id });
  }
  if (q.points_value) create(ctx, "payments", "py", { invoice_id: null, order_id: o.id, mode: "points", amount: q.points_value, reference: `${built.points_used} pts`, status: "success", gateway: null, shift_id: shift.id });
  if (q.gift_card_amount && built.gift_card) {
    const g = scoped(ctx, "gift_cards").find((x) => x.code === built.gift_card!.code)!;
    update("gift_cards", g.id, { balance: g.balance - q.gift_card_amount });
    create(ctx, "gift_card_txns", "gt", { gift_card_id: g.id, order_id: o.id, amount: -q.gift_card_amount });
    create(ctx, "payments", "py", { invoice_id: null, order_id: o.id, mode: "gift_card", amount: q.gift_card_amount, reference: g.code, status: "success", gateway: null, shift_id: shift.id });
  }
  const inv = createInvoice(ctx, order, { shiftId: shift.id });
  if (["dine_in", "takeaway", "counter"].includes(order.type)) {
    update("orders", o.id, { status: "completed", completed_at: ctx.now.toISOString() });
    logStatus(ctx, o.id, "completed", "Billed");
    for (const k of scoped(ctx, "kots").filter((k) => k.order_id === o.id && k.status !== "served")) update("kots", k.id, { status: "served" });
    freeTableIfDone(ctx, find(ctx, "orders", o.id));
  }
  return { invoice: inv, order: orderDetail(ctx, find(ctx, "orders", o.id)), change: Math.max(0, paid + nonCash - q.total) };
}, { perm: "pos.bill" });

/** Bill preview for the POS: totals with the given discount / coupon / points without saving. */
route("POST", "/orders/:id/preview", (ctx) => {
  const o = find(ctx, "orders", ctx.params.id, "Order");
  const b = ctx.body ?? {};
  const lines = scoped(ctx, "order_items").filter((i) => i.order_id === o.id && i.status !== "void");
  if (!lines.length) return null;
  return buildQuote(ctx, {
    lines: lines.map((i) => ({ item_id: i.item_id, variant_id: i.variant_id, add_on_ids: i.add_ons.map((a) => a.id), qty: i.qty, complimentary: i.complimentary })),
    order_type: o.type, coupon_code: b.coupon_code ?? o.coupon_code, customer_id: b.customer_id ?? o.customer_id, redeem_points: b.redeem_points ?? 0,
    gift_card_code: b.gift_card_code ?? null, tip: b.tip ?? 0, remove_service_charge: !!b.remove_service_charge, manual_discount: b.discount ?? null,
  }, false);
}, { perm: "pos.bill" });

/* ---------- invoices ---------- */

export function invoiceDetail(ctx: Ctx, inv: E.Invoice) {
  const order = find(ctx, "orders", inv.order_id);
  return {
    ...inv,
    order: orderDetail(ctx, order),
    taxes: scoped(ctx, "invoice_taxes").filter((t) => t.invoice_id === inv.id),
    payments: scoped(ctx, "payments").filter((p) => p.order_id === order.id && p.status === "success"),
    refunds: scoped(ctx, "refunds").filter((r) => r.invoice_id === inv.id),
    outlet: settingsOf(ctx, "outlets"),
    tax_settings: settingsOf(ctx, "tax_settings"),
    brand: settingsOf(ctx, "brand_settings"),
    cashier: inv.cashier_id ? scoped(ctx, "users").find((u) => u.id === inv.cashier_id)?.name ?? null : null,
  };
}

route("GET", "/invoices", (ctx) => {
  let rows = scoped(ctx, "invoices");
  if (ctx.query.date) rows = rows.filter((i) => i.created_at.slice(0, 10) === ctx.query.date);
  if (ctx.query.q) rows = rows.filter((i) => i.number.toLowerCase().includes(ctx.query.q.toLowerCase()));
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200);
}, { perm: "pos.bill" });

/** Invoice view: staff, or the customer who owns the order (e-bill link). */
route("GET", "/invoices/:id", (ctx) => {
  const inv = find(ctx, "invoices", ctx.params.id, "Invoice");
  const o = find(ctx, "orders", inv.order_id);
  if (!ctx.user && !(ctx.customer && o.customer_id === ctx.customer.id) && ctx.query.key !== o.id) throw new HttpError(403, "Not your bill", "forbidden");
  return invoiceDetail(ctx, inv);
}, { auth: "public" });

route("POST", "/invoices/:id/reprint", (ctx) => {
  const inv = find(ctx, "invoices", ctx.params.id, "Invoice");
  audit(ctx, "reprint", "invoice", inv.id, { reprints: inv.reprints }, { reprints: inv.reprints + 1 });
  return update("invoices", inv.id, { reprints: inv.reprints + 1 });
}, { perm: "pos.reprint" });

/** E-bill by WhatsApp link or SMS (M3.7): returns a click-to-WhatsApp link; nothing is sent automatically. */
route("POST", "/invoices/:id/share", (ctx) => {
  const inv = find(ctx, "invoices", ctx.params.id, "Invoice");
  const o = find(ctx, "orders", inv.order_id);
  const phone = (ctx.body?.phone ?? o.customer_phone ?? "").replace(/\D/g, "");
  if (phone.length < 10) throw invalid({ phone: "Add the customer's mobile number" });
  const outlet = settingsOf(ctx, "outlets");
  const link = `${ctx.body?.origin ?? ""}/bill/${inv.id}?key=${o.id}`;
  const body = `Thank you for visiting ${outlet.name}! Your bill ${inv.number} for ₹${(inv.total / 100).toFixed(2)}: ${link}`;
  create(ctx, "message_logs", "ml", { customer_id: o.customer_id, channel: "whatsapp_link", template: "bill", to: phone, body, status: "prepared" });
  return { whatsapp_url: `https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(body)}`, sms_body: body };
}, { perm: "pos.bill" });

route("POST", "/invoices/:id/refund", (ctx) => {
  const inv = find(ctx, "invoices", ctx.params.id, "Invoice");
  need(ctx.body, ["amount", "reason"]);
  const already = scoped(ctx, "refunds").filter((r) => r.invoice_id === inv.id).reduce((s, r) => s + r.amount, 0);
  const amount = Math.round(Number(ctx.body.amount));
  if (amount <= 0 || amount + already > inv.total) throw invalid({ amount: `You can refund up to ₹${((inv.total - already) / 100).toFixed(2)}` });
  const approver = checkLimit(ctx, "refund_value", amount, ctx.body.approver_id);
  const r = create(ctx, "refunds", "rf", { invoice_id: inv.id, amount, reason: ctx.body.reason, approved_by: approver?.id ?? null });
  const o = find(ctx, "orders", inv.order_id);
  const online = scoped(ctx, "payments").find((p) => p.order_id === o.id && p.mode === "online" && p.status === "success");
  create(ctx, "payments", "py", { invoice_id: inv.id, order_id: o.id, mode: online ? "online" : ctx.body.mode ?? "cash", amount: -amount, reference: online ? `rfnd_dummy_${Date.now()}` : null, status: "refunded", gateway: online ? "dummy" : null, shift_id: currentShift(ctx)?.id ?? null });
  update("orders", o.id, { payment_status: amount + already >= inv.total ? "refunded" : "partially_refunded" });
  audit(ctx, "refund", "invoice", inv.id, null, { amount, reason: ctx.body.reason, approved_by: approver?.name ?? null });
  return r;
}, { perm: "pos.bill" });

/* ---------- shifts and day close (M3.8) ---------- */

route("GET", "/shifts/current", (ctx) => {
  const s = currentShift(ctx);
  if (!s) return null;
  return { ...s, user_name: scoped(ctx, "users").find((u) => u.id === s.user_id)?.name };
});

route("POST", "/shifts/open", (ctx) => {
  if (currentShift(ctx)) throw invalid({ shift: "A shift is already open" });
  need(ctx.body, ["opening_cash"]);
  return create(ctx, "shifts", "sh", { user_id: ctx.user!.id, opened_at: ctx.now.toISOString(), closed_at: null, opening_cash: Math.round(Number(ctx.body.opening_cash)), handed_to: null });
}, { perm: "pos.bill" });

/** Shift handover: close mine and open one for the next cashier with the counted cash. */
route("POST", "/shifts/:id/handover", (ctx) => {
  const s = find(ctx, "shifts", ctx.params.id, "Shift");
  need(ctx.body, ["to_user_id", "cash"]);
  update("shifts", s.id, { closed_at: ctx.now.toISOString(), handed_to: ctx.body.to_user_id });
  return create(ctx, "shifts", "sh", { user_id: ctx.body.to_user_id, opened_at: ctx.now.toISOString(), closed_at: null, opening_cash: Math.round(Number(ctx.body.cash)), handed_to: null });
}, { perm: "pos.bill" });

export function dayFigures(ctx: Ctx, date: string) {
  const shifts = scoped(ctx, "shifts").filter((s) => s.opened_at.slice(0, 10) === date || !s.closed_at);
  const shiftIds = new Set(shifts.map((s) => s.id));
  const pays = scoped(ctx, "payments").filter((p) => p.created_at.slice(0, 10) === date && (p.status === "success" || p.status === "refunded"));
  const byMode: Record<string, number> = {};
  for (const p of pays) byMode[p.mode] = (byMode[p.mode] ?? 0) + p.amount;
  const opening = shifts.filter((s) => !s.handed_to).reduce((m, s) => Math.max(m, s.opening_cash), 0) || shifts[0]?.opening_cash || 0;
  const cashSales = pays.filter((p) => p.mode === "cash" && (!p.shift_id || shiftIds.has(p.shift_id))).reduce((s, p) => s + p.amount, 0);
  const pettyCash = scoped(ctx, "expenses").filter((e) => e.spent_on === date && e.mode === "cash" && e.status === "approved").reduce((s, e) => s + e.amount, 0);
  const settlements = scoped(ctx, "rider_settlements").filter((r) => r.business_date === date && r.settled);
  const riderCashIn = settlements.reduce((s, r) => s + r.cash_collected, 0);
  const riderPayouts = settlements.reduce((s, r) => s + r.charges_earned, 0);
  const invoices = scoped(ctx, "invoices").filter((i) => i.created_at.slice(0, 10) === date);
  const pendingRiders = scoped(ctx, "riders").filter((r) => {
    const dels = scoped(ctx, "deliveries").filter((d) => d.rider_id === r.id && d.delivered_at?.slice(0, 10) === date);
    return dels.length && !settlements.some((s) => s.rider_id === r.id);
  }).map((r) => r.name);
  return {
    date, opening_cash: opening, cash_sales: cashSales, petty_cash_out: pettyCash, rider_cash_in: riderCashIn, rider_payouts: riderPayouts,
    expected_cash: opening + cashSales + riderCashIn - pettyCash - riderPayouts, by_mode: byMode, bills: invoices.length,
    sales_total: invoices.reduce((s, i) => s + i.total, 0), pending_rider_settlements: pendingRiders,
    open_orders: scoped(ctx, "orders").filter((o) => o.created_at.slice(0, 10) === date && o.payment_status !== "paid" && o.status !== "cancelled").length,
  };
}

route("GET", "/day-close/preview", (ctx) => {
  const date = ctx.query.date ?? today(ctx);
  return { ...dayFigures(ctx, date), closed: scoped(ctx, "day_closes").find((d) => d.business_date === date) ?? null };
}, { perm: "pos.day_close" });

/** One lock per outlet day: a second device trying to close the same day is refused. */
route("POST", "/day-close", (ctx) => {
  const date = ctx.body.date ?? today(ctx);
  if (scoped(ctx, "day_closes").some((d) => d.business_date === date)) throw new HttpError(409, "This day is already closed", "day_closed");
  need(ctx.body, ["counts"]);
  const counts = ctx.body.counts as { denomination: number; count: number }[];
  const counted = counts.reduce((s, c) => s + c.denomination * 100 * c.count, 0);
  const f = dayFigures(ctx, date);
  const variance = counted - f.expected_cash;
  if (variance !== 0 && !ctx.body.variance_reason) throw invalid({ variance_reason: "Cash doesn't match. Add a reason for the difference." });
  const dc = create(ctx, "day_closes", "dc", { business_date: date, expected_cash: f.expected_cash, counted_cash: counted, variance, variance_reason: ctx.body.variance_reason ?? "", closed_by: ctx.user!.id, sales_total: f.sales_total }) as E.DayClose;
  for (const c of counts) create(ctx, "cash_counts", "cc", { day_close_id: dc.id, denomination: c.denomination, count: c.count });
  for (const s of scoped(ctx, "shifts").filter((s) => !s.closed_at)) update("shifts", s.id, { closed_at: ctx.now.toISOString() });
  if (variance !== 0) {
    audit(ctx, "cash_variance", "day_close", dc.id, { expected: f.expected_cash }, { counted, variance, reason: ctx.body.variance_reason });
    notify(ctx, "owner", "Cash variance at day close", `${variance > 0 ? "Excess" : "Short"} ₹${Math.abs(variance / 100)} · ${ctx.body.variance_reason}`, "/admin/reports/day-close");
  }
  return dc;
}, { perm: "pos.day_close" });

route("GET", "/day-closes", (ctx) => [...scoped(ctx, "day_closes")].sort((a, b) => b.business_date.localeCompare(a.business_date)), { perm: "reports.view" });
