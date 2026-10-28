import { aggregatorPayout } from "@/shared/lib/kpi";
import { audit, create, find, invalid, need, route, scoped, update, type Ctx } from "../core";
import type { AggregatorEntry } from "@/shared/types/entities";

/** Swiggy/Zomato tracker (M9): manual entries, calculated net payout, actual vs expected, per ₹100 comparison. */

function entryRow(ctx: Ctx, e: AggregatorEntry) {
  const p = find(ctx, "aggregator_platforms", e.platform_id);
  const calc = aggregatorPayout({ ...e, pg_fee_pct: p.pg_fee_pct, tcs_pct: p.tcs_pct, tds_pct: p.tds_pct });
  const payouts = scoped(ctx, "aggregator_payouts").filter((x) => x.entry_id === e.id);
  const received = payouts.reduce((s, x) => s + x.amount, 0);
  return { ...e, platform: p.name, calc, payouts, received, difference: payouts.length ? received - calc.net_payout : null };
}

route("GET", "/aggregators/platforms", (ctx) => scoped(ctx, "aggregator_platforms"), { perm: "aggregators.manage" });
route("PUT", "/aggregators/platforms/:id", (ctx) => {
  const p = find(ctx, "aggregator_platforms", ctx.params.id, "Platform");
  const { commission_pct, pg_fee_pct, tcs_pct, tds_pct } = ctx.body;
  audit(ctx, "setting_change", "aggregator_platform", p.id, p, ctx.body);
  return update("aggregator_platforms", p.id, { commission_pct, pg_fee_pct, tcs_pct, tds_pct });
}, { perm: "aggregators.manage" });

route("GET", "/aggregators/entries", (ctx) => [...scoped(ctx, "aggregator_entries")].sort((a, b) => b.period_from.localeCompare(a.period_from)).map((e) => entryRow(ctx, e)), { perm: "aggregators.manage" });

route("POST", "/aggregators/entries", (ctx) => {
  need(ctx.body, ["platform_id", "period_from", "period_to", "gross_sales"]);
  const p = find(ctx, "aggregator_platforms", ctx.body.platform_id, "Platform");
  if (ctx.body.period_to < ctx.body.period_from) throw invalid({ period_to: "End date is before start date" });
  const n = (k: string) => Math.round(Number(ctx.body[k] ?? 0));
  const e = create(ctx, "aggregator_entries", "ae", {
    platform_id: p.id, period_from: ctx.body.period_from, period_to: ctx.body.period_to, orders: Number(ctx.body.orders ?? 0),
    gross_sales: n("gross_sales"), outlet_discount: n("outlet_discount"), packaging: n("packaging"), ads: n("ads"), other_deductions: n("other_deductions"),
    commission_pct: Number(ctx.body.commission_pct ?? p.commission_pct),
  }) as AggregatorEntry;
  return entryRow(ctx, e);
}, { perm: "aggregators.manage" });

route("DELETE", "/aggregators/entries/:id", (ctx) => {
  const e = find(ctx, "aggregator_entries", ctx.params.id, "Entry");
  update("aggregator_entries", e.id, { deleted_at: ctx.now.toISOString() });
  audit(ctx, "delete", "aggregator_entry", e.id, e, null);
  return { deleted: true };
}, { perm: "aggregators.manage" });

route("POST", "/aggregators/entries/:id/payouts", (ctx) => {
  const e = find(ctx, "aggregator_entries", ctx.params.id, "Entry");
  need(ctx.body, ["amount", "received_on"]);
  create(ctx, "aggregator_payouts", "apo", { entry_id: e.id, received_on: ctx.body.received_on, amount: Math.round(Number(ctx.body.amount)), reference: ctx.body.reference ?? "" });
  return entryRow(ctx, e);
}, { perm: "aggregators.manage" });

/** Net earned per ₹100 of sales: each platform vs direct orders (M9.4). */
route("GET", "/aggregators/comparison", (ctx) => {
  const { from, to } = ctx.query;
  const inR = (d: string) => (!from || d >= from) && (!to || d <= to);
  const entries = scoped(ctx, "aggregator_entries").filter((e) => inR(e.period_from)).map((e) => entryRow(ctx, e));
  const rows = scoped(ctx, "aggregator_platforms").map((p) => {
    const mine = entries.filter((e) => e.platform_id === p.id);
    const gross = mine.reduce((s, e) => s + e.gross_sales, 0);
    const net = mine.reduce((s, e) => s + e.calc.net_payout, 0);
    return { channel: p.name, orders: mine.reduce((s, e) => s + e.orders, 0), gross, net, per_100: gross ? (net / gross) * 100 : 0, commission: mine.reduce((s, e) => s + e.calc.commission + e.calc.gst_on_commission, 0) };
  });
  // Direct orders: net of discounts and gateway fees on online payments (CafeChalao takes no commission).
  const orders = scoped(ctx, "orders").filter((o) => o.payment_status === "paid" && inR(o.created_at.slice(0, 10)));
  const gross = orders.reduce((s, o) => s + o.subtotal + o.service_charge + o.delivery_charge, 0);
  const pgFee = scoped(ctx, "payments").filter((p) => p.mode === "online" && p.status === "success" && inR(p.created_at.slice(0, 10))).reduce((s, p) => s + Math.round(p.amount * 0.02), 0);
  const deliveryToRider = orders.reduce((s, o) => s + o.delivery_charge, 0);
  const direct = { channel: "Direct (CafeChalao)", orders: orders.length, gross, net: gross - orders.reduce((s, o) => s + o.discount, 0) - pgFee - deliveryToRider, commission: 0, per_100: 0 };
  direct.per_100 = direct.gross ? (direct.net / direct.gross) * 100 : 0;
  return [direct, ...rows];
}, { perm: "aggregators.manage" });
