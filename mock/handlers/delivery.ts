import type * as E from "@/shared/types/entities";
import { audit, create, crud, find, HttpError, invalid, need, notify, route, scoped, today, update, type Ctx } from "../core";
import { createInvoice } from "./billing";
import { logStatus } from "./orders";

/** Delivery and rider tab (M8): own and freelance riders, requests, first-accept-wins, OTP/photo proof, settlement. */

crud("/riders", "riders", "rd", { perm: "delivery.assign", required: ["name", "phone", "type"], defaults: { user_id: null, vehicle: "", id_document: "", online: false, active: true }, auditAs: "rider" });

function deliveryRow(ctx: Ctx, d: E.Delivery) {
  const o = scoped(ctx, "orders").find((x) => x.id === d.order_id);
  const r = d.rider_id ? scoped(ctx, "riders").find((x) => x.id === d.rider_id) : null;
  const requests = scoped(ctx, "delivery_requests").filter((q) => q.delivery_id === d.id);
  return {
    ...d, rider_name: r?.name ?? null,
    order: o ? { id: o.id, number: o.number, status: o.status, total: o.total, payment_method: o.payment_method, payment_status: o.payment_status, customer_name: o.customer_name, customer_phone: o.customer_phone, address_text: o.address_text, delivery_otp: undefined, created_at: o.created_at, ready_at: o.ready_at } : null,
    requested_riders: requests.filter((q) => q.status === "sent").map((q) => q.rider_id),
  };
}

route("GET", "/deliveries", (ctx) => {
  let rows = scoped(ctx, "deliveries");
  if (ctx.query.active) rows = rows.filter((d) => !["delivered", "failed"].includes(d.status));
  if (ctx.query.date) rows = rows.filter((d) => d.created_at.slice(0, 10) === ctx.query.date);
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200).map((d) => deliveryRow(ctx, d)).filter((d) => d.order?.status !== "cancelled");
}, { perm: "delivery.assign" });

/**
 * Assign by owner/manager/cashier: own staff directly, or send a request to one or more riders
 * (freelancers when busy). The first rider to accept gets it.
 */
route("POST", "/deliveries/:id/assign", (ctx) => {
  const d = find(ctx, "deliveries", ctx.params.id, "Delivery");
  need(ctx.body, ["rider_ids"]);
  if (["picked_up", "on_the_way", "delivered"].includes(d.status)) throw invalid({ rider_ids: "Already on the way" });
  for (const q of scoped(ctx, "delivery_requests").filter((q) => q.delivery_id === d.id && q.status === "sent")) update("delivery_requests", q.id, { status: "declined" });
  const ids = ctx.body.rider_ids as string[];
  for (const rid of ids) {
    const r = find(ctx, "riders", rid, "Rider");
    create(ctx, "delivery_requests", "dq", { delivery_id: d.id, rider_id: r.id, status: "sent" });
  }
  return deliveryRow(ctx, update("deliveries", d.id, { status: "requested", rider_id: null }) as E.Delivery);
}, { perm: "delivery.assign" });

/* ---------- rider app ---------- */

route("GET", "/rider/me", (ctx) => ctx.rider!, { auth: "rider" });
route("PATCH", "/rider/me", (ctx) => update("riders", ctx.rider!.id, { online: !!ctx.body.online }), { auth: "rider" });

route("GET", "/rider/deliveries", (ctx) => {
  const r = ctx.rider!;
  const reqIds = new Set(scoped(ctx, "delivery_requests").filter((q) => q.rider_id === r.id && q.status === "sent").map((q) => q.delivery_id));
  const all = scoped(ctx, "deliveries");
  const active = all.filter((d) => d.rider_id === r.id && ["accepted", "picked_up", "on_the_way"].includes(d.status));
  const requests = all.filter((d) => reqIds.has(d.id) && d.status === "requested");
  const history = all.filter((d) => d.rider_id === r.id && ["delivered", "failed"].includes(d.status)).sort((a, b) => (b.delivered_at ?? "").localeCompare(a.delivered_at ?? "")).slice(0, 50);
  const outlet = scoped(ctx, "outlets")[0];
  const withOrder = (d: E.Delivery) => ({ ...deliveryRow(ctx, d), pickup: { name: outlet.name, address: outlet.address, phone: outlet.phone } });
  return { active: active.map(withOrder), requests: requests.map(withOrder), history: history.map(withOrder) };
}, { auth: "rider" });

/** First accept wins (atomic update): the second rider gets "already taken". */
route("POST", "/deliveries/:id/accept", (ctx) => {
  const d = find(ctx, "deliveries", ctx.params.id, "Delivery");
  const r = ctx.rider!;
  const req = scoped(ctx, "delivery_requests").find((q) => q.delivery_id === d.id && q.rider_id === r.id);
  if (!req) throw new HttpError(403, "This request wasn't sent to you", "forbidden");
  if (d.rider_id && d.rider_id !== r.id) throw new HttpError(409, "Already taken by another rider", "already_taken");
  update("deliveries", d.id, { rider_id: r.id, status: "accepted", accepted_at: ctx.now.toISOString() });
  for (const q of scoped(ctx, "delivery_requests").filter((q) => q.delivery_id === d.id)) update("delivery_requests", q.id, { status: q.rider_id === r.id ? "accepted" : "taken" });
  notify(ctx, "cashier", "Rider assigned", `${r.name} accepted ${scoped(ctx, "orders").find((o) => o.id === d.order_id)?.number}`, "/pos");
  return deliveryRow(ctx, find(ctx, "deliveries", d.id));
}, { auth: "rider" });

route("POST", "/deliveries/:id/decline", (ctx) => {
  const q = scoped(ctx, "delivery_requests").find((q) => q.delivery_id === ctx.params.id && q.rider_id === ctx.rider!.id && q.status === "sent");
  if (q) update("delivery_requests", q.id, { status: "declined" });
  return { ok: true };
}, { auth: "rider" });

/** Picked up → on the way → delivered with OTP or photo; collects COD / UPI-on-delivery. */
route("PATCH", "/deliveries/:id/status", (ctx) => {
  const d = find(ctx, "deliveries", ctx.params.id, "Delivery");
  if (!ctx.rider && !ctx.perms.includes("delivery.assign")) throw new HttpError(401, "Please log in", "unauthenticated");
  if (ctx.rider && d.rider_id !== ctx.rider.id) throw new HttpError(403, "Not your delivery", "forbidden");
  const o = find(ctx, "orders", d.order_id);
  const to = ctx.body.status as E.Delivery["status"];
  if (to === "picked_up") {
    if (!["ready", "out_for_delivery"].includes(o.status) && !ctx.body.force) throw invalid({ status: "The kitchen hasn't marked this ready yet" });
    update("deliveries", d.id, { status: "picked_up", picked_at: ctx.now.toISOString() });
    update("orders", o.id, { status: "out_for_delivery" });
    logStatus(ctx, o.id, "out_for_delivery");
  } else if (to === "on_the_way") {
    update("deliveries", d.id, { status: "on_the_way" });
  } else if (to === "delivered") {
    if (ctx.body.proof === "otp" && String(ctx.body.otp) !== o.delivery_otp) throw invalid({ otp: "OTP doesn't match. Ask the customer again." });
    if (ctx.body.proof === "photo" && !ctx.body.photo) throw invalid({ photo: "Take a photo of the handover" });
    if (!["otp", "photo"].includes(ctx.body.proof)) throw invalid({ proof: "Deliver with OTP or a photo" });
    const collect = d.to_collect;
    if (collect > 0 && !["cash", "upi"].includes(ctx.body.collected_mode)) throw invalid({ collected_mode: `Collect ₹${collect / 100} by cash or UPI` });
    update("deliveries", d.id, { status: "delivered", delivered_at: ctx.now.toISOString(), proof: ctx.body.proof, collected: collect, collected_mode: collect ? ctx.body.collected_mode : null });
    if (o.payment_status !== "paid") {
      create(ctx, "payments", "py", { invoice_id: null, order_id: o.id, mode: ctx.body.collected_mode === "upi" ? "upi_on_delivery" : "cod", amount: collect, reference: null, status: "success", gateway: null, shift_id: null });
      update("orders", o.id, { payment_status: "paid" });
    }
    createInvoice(ctx, find(ctx, "orders", o.id));
    update("orders", o.id, { status: "completed", completed_at: ctx.now.toISOString() });
    logStatus(ctx, o.id, "delivered");
    logStatus(ctx, o.id, "completed");
  } else if (to === "failed") {
    need(ctx.body, ["reason"]);
    update("deliveries", d.id, { status: "failed" });
    notify(ctx, "manager", "Delivery failed", `${o.number}: ${ctx.body.reason}`, "/admin/delivery");
  } else throw invalid({ status: "Unknown status" });
  return deliveryRow(ctx, find(ctx, "deliveries", d.id));
}, { auth: "public" });

route("GET", "/rider/earnings", (ctx) => {
  const r = ctx.rider!;
  const mine = scoped(ctx, "deliveries").filter((d) => d.rider_id === r.id && d.status === "delivered");
  const t = today(ctx);
  const todays = mine.filter((d) => d.delivered_at?.slice(0, 10) === t);
  const settlement = scoped(ctx, "rider_settlements").find((s) => s.rider_id === r.id && s.business_date === t);
  return {
    type: r.type, today_count: todays.length, today_charges: todays.reduce((s, d) => s + d.charge, 0), cash_in_hand: settlement?.settled ? 0 : todays.reduce((s, d) => s + (d.collected_mode === "cash" ? d.collected : 0), 0),
    upi_collected: todays.reduce((s, d) => s + (d.collected_mode === "upi" ? d.collected : 0), 0),
    month_charges: mine.filter((d) => d.delivered_at?.slice(0, 7) === t.slice(0, 7)).reduce((s, d) => s + d.charge, 0),
    note: r.type === "own" ? "Delivery charges are added to your salary on salary day." : "Delivery charges are paid to you at day close.",
    settled_today: !!settlement?.settled,
  };
}, { auth: "rider" });

/* ---------- settlement at day close (M8.7) ---------- */

function settlementFor(ctx: Ctx, r: E.Rider, date: string) {
  const dels = scoped(ctx, "deliveries").filter((d) => d.rider_id === r.id && d.status === "delivered" && d.delivered_at?.slice(0, 10) === date);
  const cash = dels.reduce((s, d) => s + (d.collected_mode === "cash" ? d.collected : 0), 0);
  // Freelancers are paid charges daily; in-house riders get them on salary day.
  const charges = r.type === "freelance" ? dels.reduce((s, d) => s + d.charge, 0) : 0;
  const existing = scoped(ctx, "rider_settlements").find((s) => s.rider_id === r.id && s.business_date === date);
  return { rider_id: r.id, name: r.name, type: r.type, deliveries: dels.length, cash_collected: cash, upi_collected: dels.reduce((s, d) => s + (d.collected_mode === "upi" ? d.collected : 0), 0), charges_earned: charges, net: cash - charges, settled: !!existing?.settled, settlement_id: existing?.id ?? null };
}

route("GET", "/rider-settlements", (ctx) => {
  const date = ctx.query.date ?? today(ctx);
  return scoped(ctx, "riders").map((r) => settlementFor(ctx, r, date)).filter((s) => s.deliveries > 0 || s.settled);
}, { perm: "delivery.assign" });

route("POST", "/rider-settlements", (ctx) => {
  need(ctx.body, ["rider_id"]);
  const date = ctx.body.date ?? today(ctx);
  const r = find(ctx, "riders", ctx.body.rider_id, "Rider");
  const s = settlementFor(ctx, r, date);
  if (s.settled) throw invalid({ rider_id: "Already settled for today" });
  const row = create(ctx, "rider_settlements", "rs", { rider_id: r.id, business_date: date, cash_collected: s.cash_collected, charges_earned: s.charges_earned, net: s.net, settled: true, settled_by: ctx.user!.id });
  audit(ctx, "rider_settlement", "rider", r.id, null, s);
  return row;
}, { perm: "delivery.assign" });
