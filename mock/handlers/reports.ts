import * as K from "@/shared/lib/kpi";
import { aggregatorPayout } from "@/shared/lib/kpi";
import { invalid, route, scoped, settingsOf, today, type Ctx } from "../core";
import { recipeCost } from "./menu";
import { salarySheet } from "./staff";

/**
 * Reports and KPIs (M10, SRS section 5). Filters: from, to, type (order type), channel (direct, swiggy, zomato), staff.
 * In http mode Laravel builds these on a read replica; the JSON shape is the same.
 */

interface F { from: string; to: string; type?: string; channel?: string; staff?: string }

function filters(ctx: Ctx): F {
  const t = today(ctx);
  const range = ctx.query.range;
  const shift = (n: number) => new Date(new Date(t).getTime() - n * 86400000).toISOString().slice(0, 10);
  const from = ctx.query.from ?? (range === "7d" ? shift(6) : range === "30d" ? shift(29) : range === "month" ? `${t.slice(0, 7)}-01` : t);
  return { from, to: ctx.query.to ?? t, type: ctx.query.type, channel: ctx.query.channel, staff: ctx.query.staff };
}

const d10 = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function paidOrders(ctx: Ctx, f: F) {
  return scoped(ctx, "orders").filter((o) => {
    if (o.payment_status !== "paid" && o.payment_status !== "partially_refunded" && o.payment_status !== "refunded") return false;
    const d = d10(o.created_at);
    if (d < f.from || d > f.to) return false;
    if (f.type && o.type !== f.type) return false;
    if (f.staff && o.captain_id !== f.staff && o.cashier_id !== f.staff) return false;
    return true;
  });
}

function salesCore(ctx: Ctx, f: F) {
  const orders = paidOrders(ctx, f);
  const ids = new Set(orders.map((o) => o.id));
  const invoices = scoped(ctx, "invoices").filter((i) => ids.has(i.order_id));
  const refunds = scoped(ctx, "refunds").filter((r) => invoices.some((i) => i.id === r.invoice_id)).reduce((s, r) => s + r.amount, 0);
  const gross = orders.reduce((s, o) => s + o.subtotal + o.service_charge, 0) + orders.reduce((s, o) => s + o.discount, 0);
  const discounts = orders.reduce((s, o) => s + o.discount, 0);
  const net = K.netSales(gross, discounts, refunds);
  return { orders, ids, invoices, gross, discounts, refunds, net, tax: orders.reduce((s, o) => s + o.tax, 0), total: orders.reduce((s, o) => s + o.total, 0) };
}

/** COGS from recipes (theoretical food cost) for the sold items. */
function cogs(ctx: Ctx, ids: Set<string>) {
  const items = scoped(ctx, "order_items").filter((i) => ids.has(i.order_id) && i.status !== "void");
  const cache = new Map<string, number>();
  let total = 0;
  for (const it of items) {
    const k = `${it.item_id}:${it.variant_id ?? ""}`;
    if (!cache.has(k)) cache.set(k, recipeCost(ctx, it.item_id, it.variant_id));
    total += cache.get(k)! * it.qty;
  }
  return Math.round(total);
}

function labourFor(ctx: Ctx, f: F) {
  const months = new Set<string>();
  for (let d = new Date(f.from); d10(d.toISOString()) <= f.to; d = new Date(d.getTime() + 86400000)) months.add(d10(d.toISOString()).slice(0, 7));
  const days = Math.max(1, (new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000 + 1);
  let monthly = 0;
  for (const m of months) {
    const sheet = salarySheet(ctx, m);
    monthly += sheet.reduce((s, r) => s + (r.salary_type === "monthly" ? r.salary_amount : r.salary_amount * 26) + r.overtime_pay, 0);
  }
  // Pro-rate the month's labour to the selected days.
  const perDay = monthly / (months.size * 30);
  return Math.round(perDay * days);
}

function expensesFor(ctx: Ctx, f: F, excludeSalary = true) {
  const cats = scoped(ctx, "expense_categories");
  const salaryCat = cats.find((c) => c.name === "Salary")?.id;
  return scoped(ctx, "expenses").filter((e) => e.status === "approved" && e.spent_on >= f.from && e.spent_on <= f.to && (!excludeSalary || e.category_id !== salaryCat));
}

const REPORTS: Record<string, (ctx: Ctx, f: F) => unknown> = {
  /** Owner dashboard (M10.2). */
  dashboard(ctx, f) {
    const s = salesCore(ctx, f);
    const days = Math.max(1, (new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000 + 1);
    const prev: F = { ...f, from: new Date(new Date(f.from).getTime() - days * 86400000).toISOString().slice(0, 10), to: new Date(new Date(f.from).getTime() - 86400000).toISOString().slice(0, 10) };
    const p = salesCore(ctx, prev);
    const pays = scoped(ctx, "payments").filter((x) => s.ids.has(x.order_id) && x.status === "success");
    const online = pays.filter((x) => x.mode !== "cash" && x.mode !== "cod").reduce((a, x) => a + x.amount, 0);
    const cash = pays.filter((x) => x.mode === "cash" || x.mode === "cod").reduce((a, x) => a + x.amount, 0);
    const exp = expensesFor(ctx, f).reduce((a, e) => a + e.amount, 0);
    const c = cogs(ctx, s.ids);
    const labour = labourFor(ctx, f);
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, sales: 0, orders: 0 }));
    for (const o of s.orders) {
      const h = new Date(o.created_at).getHours();
      hours[h].sales += o.total;
      hours[h].orders++;
    }
    const itemQty = new Map<string, { name: string; qty: number; sales: number }>();
    for (const it of scoped(ctx, "order_items").filter((i) => s.ids.has(i.order_id) && i.status !== "void")) {
      const r = itemQty.get(it.item_id) ?? { name: it.name, qty: 0, sales: 0 };
      r.qty += it.qty;
      r.sales += it.unit_price * it.qty;
      itemQty.set(it.item_id, r);
    }
    const mats = scoped(ctx, "raw_materials");
    const late = scoped(ctx, "orders").filter((o) => ["accepted", "preparing", "placed"].includes(o.status) && (ctx.now.getTime() - new Date(o.created_at).getTime()) / 60000 > settingsOf(ctx, "business_type_flags").kds_amber_min);
    const tables = scoped(ctx, "dining_tables");
    const lowRatings = scoped(ctx, "feedback").filter((x) => d10(x.created_at) >= f.from && Math.min(x.food, x.service, x.ambience) <= 2 && !x.replied);
    const pendingApprovals = scoped(ctx, "approvals").filter((a) => a.status === "pending");
    const lastClose = [...scoped(ctx, "day_closes")].sort((a, b) => b.business_date.localeCompare(a.business_date))[0];
    const opening = scoped(ctx, "shifts").find((x) => !x.closed_at)?.opening_cash ?? 0;
    const cashToday = scoped(ctx, "payments").filter((x) => x.mode === "cash" && x.status === "success" && d10(x.created_at) === today(ctx)).reduce((a, x) => a + x.amount, 0);
    const pettyToday = scoped(ctx, "expenses").filter((e) => e.spent_on === today(ctx) && e.mode === "cash" && e.status === "approved").reduce((a, e) => a + e.amount, 0);
    return {
      range: f, sales: s.total, net_sales: s.net, orders: s.orders.length, aov: K.averageOrderValue(s.net, s.orders.length),
      sales_change_pct: p.total ? ((s.total - p.total) / p.total) * 100 : null, online, cash, expenses: exp,
      food_cost_pct: s.net ? (c / s.net) * 100 : 0, labour_cost_pct: K.labourCostPct(labour, 0, 0, s.net),
      profit_estimate: K.netProfit(K.grossProfit(s.net, c), labour, exp), cash_in_hand: opening + cashToday - pettyToday,
      live_tables: { occupied: tables.filter((t) => ["occupied", "bill_requested"].includes(t.status)).length, total: tables.length },
      by_hour: hours.filter((h) => h.orders > 0 || (h.hour >= 8 && h.hour <= 23)),
      by_type: ["dine_in", "takeaway", "delivery", "counter"].map((t) => ({ type: t, orders: s.orders.filter((o) => o.type === t).length, sales: s.orders.filter((o) => o.type === t).reduce((a, o) => a + o.total, 0) })).filter((x) => x.orders),
      top_items: [...itemQty.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
      alerts: [
        ...mats.filter((m) => m.stock < m.min_level).slice(0, 4).map((m) => ({ kind: "low_stock", text: m.stock <= 0 ? `${m.name} is out of stock` : `${m.name} below ${m.min_level} ${m.unit}`, link: "/admin/stock" })),
        ...(late.length ? [{ kind: "late", text: `${late.length} order${late.length > 1 ? "s" : ""} waiting > ${settingsOf(ctx, "business_type_flags").kds_amber_min} min`, link: "/admin/orders" }] : []),
        ...(pendingApprovals.length ? [{ kind: "approvals", text: `${pendingApprovals.length} approval${pendingApprovals.length > 1 ? "s" : ""} pending`, link: "/admin/approvals" }] : []),
        ...lowRatings.slice(0, 3).map((x) => ({ kind: "rating", text: `Low rating ${Math.min(x.food, x.service, x.ambience)}★: "${x.comment || "no comment"}"`, link: "/admin/marketing/feedback" })),
        ...(lastClose && lastClose.variance !== 0 ? [{ kind: "variance", text: `Cash variance ₹${lastClose.variance / 100} on ${lastClose.business_date}`, link: "/admin/reports/day-close" }] : []),
      ],
    };
  },

  sales(ctx, f) {
    const s = salesCore(ctx, f);
    const byDay = new Map<string, { date: string; orders: number; sales: number; net: number }>();
    for (const o of s.orders) {
      const d = d10(o.created_at);
      const r = byDay.get(d) ?? { date: d, orders: 0, sales: 0, net: 0 };
      r.orders++;
      r.sales += o.total;
      r.net += o.subtotal + o.service_charge;
      byDay.set(d, r);
    }
    const pays = scoped(ctx, "payments").filter((x) => s.ids.has(x.order_id) && x.status !== "failed");
    const byMode: Record<string, number> = {};
    for (const p of pays) byMode[p.mode] = (byMode[p.mode] ?? 0) + p.amount;
    const byChannel: Record<string, number> = {};
    for (const o of s.orders) byChannel[o.channel] = (byChannel[o.channel] ?? 0) + o.total;
    return {
      summary: { gross: s.gross, discounts: s.discounts, refunds: s.refunds, net: s.net, tax: s.tax, total: s.total, bills: s.orders.length, aov: K.averageOrderValue(s.net, s.orders.length) },
      by_day: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      by_mode: Object.entries(byMode).map(([mode, amount]) => ({ mode, amount })),
      by_channel: Object.entries(byChannel).map(([channel, amount]) => ({ channel, amount })),
      by_type: ["dine_in", "takeaway", "delivery", "counter"].map((t) => ({ type: t, orders: s.orders.filter((o) => o.type === t).length, sales: s.orders.filter((o) => o.type === t).reduce((a, o) => a + o.total, 0) })),
    };
  },

  /** GST summary for the CA (filing itself is Phase 2). */
  tax(ctx, f) {
    const s = salesCore(ctx, f);
    const taxes = scoped(ctx, "invoice_taxes").filter((t) => s.invoices.some((i) => i.id === t.invoice_id));
    const byRate = new Map<number, { rate: number; taxable: number; cgst: number; sgst: number }>();
    for (const t of taxes) {
      const r = byRate.get(t.rate) ?? { rate: t.rate, taxable: 0, cgst: 0, sgst: 0 };
      r.taxable += t.taxable;
      r.cgst += t.cgst;
      r.sgst += t.sgst;
      byRate.set(t.rate, r);
    }
    const ts = settingsOf(ctx, "tax_settings");
    return {
      scheme: ts.gst_scheme, gstin: ts.gstin, hsn_sac: ts.hsn_sac, invoices: s.invoices.length,
      first_invoice: [...s.invoices].sort((a, b) => a.number.localeCompare(b.number))[0]?.number ?? null,
      last_invoice: [...s.invoices].sort((a, b) => b.number.localeCompare(a.number))[0]?.number ?? null,
      by_rate: [...byRate.values()], turnover: s.invoices.reduce((a, i) => a + i.total, 0),
      composition_threshold: 15000000_00, // ₹1.5 crore annual turnover (to be confirmed by the CA)
    };
  },

  /** P&L (M10.1): net sales − COGS = gross profit − labour − expenses = net profit; aggregator net added as income. */
  pnl(ctx, f) {
    const s = salesCore(ctx, f);
    const c = cogs(ctx, s.ids);
    const labour = labourFor(ctx, f);
    const exps = expensesFor(ctx, f);
    const cats = scoped(ctx, "expense_categories");
    const byCat = cats.map((cat) => ({ category: cat.name, amount: exps.filter((e) => e.category_id === cat.id).reduce((a, e) => a + e.amount, 0) })).filter((x) => x.amount);
    const agg = scoped(ctx, "aggregator_entries").filter((e) => e.period_from >= f.from && e.period_from <= f.to);
    const platforms = scoped(ctx, "aggregator_platforms");
    const aggNet = agg.reduce((a, e) => {
      const p = platforms.find((x) => x.id === e.platform_id)!;
      return a + aggregatorPayout({ ...e, pg_fee_pct: p.pg_fee_pct, tcs_pct: p.tcs_pct, tds_pct: p.tds_pct }).net_payout;
    }, 0);
    const wastage = scoped(ctx, "wastage").filter((w) => d10(w.created_at) >= f.from && d10(w.created_at) <= f.to).reduce((a, w) => a + w.value, 0);
    const netSales = s.net + aggNet;
    const gp = K.grossProfit(netSales, c + wastage);
    const expTotal = exps.reduce((a, e) => a + e.amount, 0);
    return {
      direct_sales: s.net, aggregator_net: aggNet, net_sales: netSales, cogs: c, wastage, gross_profit: gp, labour, expenses: byCat, expenses_total: expTotal,
      net_profit: K.netProfit(gp, labour, expTotal), food_cost_pct: netSales ? ((c + wastage) / netSales) * 100 : 0, labour_cost_pct: K.labourCostPct(labour, 0, 0, netSales),
      note: "COGS is recipe-based (theoretical). Actual food cost uses opening + purchases − closing stock from stock counts.",
    };
  },

  /** Cash flow: opening + cash in − cash out = closing. */
  cash_flow(ctx, f) {
    const pays = scoped(ctx, "payments").filter((p) => d10(p.created_at) >= f.from && d10(p.created_at) <= f.to && (p.status === "success" || p.status === "refunded"));
    const inSales = pays.filter((p) => !["points", "gift_card"].includes(p.mode)).reduce((a, p) => a + p.amount, 0);
    const supplier = scoped(ctx, "supplier_payments").filter((p) => p.paid_on >= f.from && p.paid_on <= f.to).reduce((a, p) => a + p.amount, 0);
    const exps = expensesFor(ctx, f, false);
    const cats = scoped(ctx, "expense_categories");
    const salaryCat = cats.find((c) => c.name === "Salary")?.id;
    const salaries = exps.filter((e) => e.category_id === salaryCat).reduce((a, e) => a + e.amount, 0);
    const other = exps.filter((e) => e.category_id !== salaryCat).reduce((a, e) => a + e.amount, 0);
    const riderPay = scoped(ctx, "rider_settlements").filter((r) => r.business_date >= f.from && r.business_date <= f.to).reduce((a, r) => a + r.charges_earned, 0);
    const aggIn = scoped(ctx, "aggregator_payouts").filter((p) => p.received_on >= f.from && p.received_on <= f.to).reduce((a, p) => a + p.amount, 0);
    const opening = Number(ctx.query.opening ?? 0);
    const cashIn = inSales + aggIn;
    const cashOut = supplier + other + salaries + riderPay;
    return { opening, cash_in: { sales: inSales, aggregators: aggIn, total: cashIn }, cash_out: { purchases: supplier, expenses: other, salaries, rider_payouts: riderPay, total: cashOut }, closing: K.closingCash(opening, cashIn, cashOut) };
  },

  /** Menu engineering matrix (M10.1). */
  menu(ctx, f) {
    const s = salesCore(ctx, f);
    const items = scoped(ctx, "items");
    const sold = scoped(ctx, "order_items").filter((i) => s.ids.has(i.order_id) && i.status !== "void" && !i.complimentary);
    const rows = items.map((it) => {
      const lines = sold.filter((x) => x.item_id === it.id);
      const qty = lines.reduce((a, l) => a + l.qty, 0);
      const revenue = lines.reduce((a, l) => a + l.unit_price * l.qty, 0);
      const cost = Math.round(recipeCost(ctx, it.id));
      const avgPrice = qty ? Math.round(revenue / qty) : it.price;
      return { item_id: it.id, name: it.name, qty, revenue, price: avgPrice, recipe_cost: cost, margin: K.itemMargin(avgPrice, cost), food_cost_pct: avgPrice ? (cost / avgPrice) * 100 : 0 };
    });
    return K.menuEngineering(rows).sort((a, b) => b.qty - a.qty);
  },

  /** Theoretical vs actual consumption from the latest posted counts (stock variance). */
  stock_variance(ctx, f) {
    const mats = scoped(ctx, "raw_materials");
    const ledger = scoped(ctx, "stock_ledger").filter((l) => d10(l.created_at) >= f.from && d10(l.created_at) <= f.to);
    return mats.map((m) => {
      const mine = ledger.filter((l) => l.raw_material_id === m.id);
      const theoretical = -mine.filter((l) => l.reason === "sale").reduce((a, l) => a + l.qty, 0);
      const adjust = mine.filter((l) => l.reason === "count_adjust").reduce((a, l) => a + l.qty, 0);
      const wastage = -mine.filter((l) => l.reason === "wastage").reduce((a, l) => a + l.qty, 0);
      const actual = theoretical + wastage - adjust;
      return { raw_material_id: m.id, name: m.name, unit: m.unit, theoretical: Math.round(theoretical * 1000) / 1000, wastage, actual: Math.round(actual * 1000) / 1000, variance: Math.round(K.stockVariance(theoretical, actual) * 1000) / 1000, value: Math.round(K.stockVariance(theoretical, actual) * m.avg_cost) };
    }).filter((r) => r.theoretical || r.actual);
  },

  food_cost(ctx, f) {
    const s = salesCore(ctx, f);
    const purchases = scoped(ctx, "grns").filter((g) => g.received_on >= f.from && g.received_on <= f.to).reduce((a, g) => a + g.total, 0);
    const closing = Math.round(scoped(ctx, "raw_materials").reduce((a, m) => a + Math.max(0, m.stock) * m.avg_cost, 0));
    const consumed = cogs(ctx, s.ids);
    const opening = closing + consumed - purchases;
    return { opening, purchases, closing, net_sales: s.net, food_cost_pct: K.foodCostPct(opening, purchases, closing, s.net), theoretical: consumed, theoretical_pct: s.net ? (consumed / s.net) * 100 : 0 };
  },

  kitchen(ctx, f) {
    const kots = scoped(ctx, "kots").filter((k) => k.ready_at && d10(k.created_at) >= f.from && d10(k.created_at) <= f.to);
    const byStation = new Map<string, { kot_at: number; ready_at: number }[]>();
    for (const k of kots) byStation.set(k.station, [...(byStation.get(k.station) ?? []), { kot_at: new Date(k.created_at).getTime(), ready_at: new Date(k.ready_at!).getTime() }]);
    const flags = settingsOf(ctx, "business_type_flags");
    return {
      average_sec: K.averagePrepTimeSec(kots.map((k) => ({ kot_at: new Date(k.created_at).getTime(), ready_at: new Date(k.ready_at!).getTime() }))),
      kots: kots.length, late: kots.filter((k) => (new Date(k.ready_at!).getTime() - new Date(k.created_at).getTime()) / 60000 > flags.kds_red_min).length,
      by_station: [...byStation.entries()].map(([station, rows]) => ({ station, kots: rows.length, average_sec: K.averagePrepTimeSec(rows) })),
    };
  },

  delivery(ctx, f) {
    const dels = scoped(ctx, "deliveries").filter((d) => d.status === "delivered" && d.delivered_at && d10(d.delivered_at) >= f.from && d10(d.delivered_at) <= f.to);
    const riders = scoped(ctx, "riders");
    const times = dels.filter((d) => d.accepted_at).map((d) => K.deliveryTimeMin(new Date(d.accepted_at!).getTime(), new Date(d.delivered_at!).getTime()));
    return {
      deliveries: dels.length, average_min: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0, charges: dels.reduce((a, d) => a + d.charge, 0),
      by_rider: riders.map((r) => {
        const mine = dels.filter((d) => d.rider_id === r.id);
        return { rider: r.name, type: r.type, deliveries: mine.length, charges: mine.reduce((a, d) => a + d.charge, 0), cash: mine.reduce((a, d) => a + (d.collected_mode === "cash" ? d.collected : 0), 0) };
      }),
    };
  },

  customers(ctx, f) {
    const s = salesCore(ctx, f);
    const byCustomer = new Map<string, number>();
    for (const o of s.orders) if (o.customer_id) byCustomer.set(o.customer_id, (byCustomer.get(o.customer_id) ?? 0) + 1);
    const total = byCustomer.size;
    const repeat = [...byCustomer.values()].filter((n) => n >= 2).length;
    const custs = scoped(ctx, "customers");
    const top = [...byCustomer.entries()].map(([id, n]) => ({ id, name: custs.find((c) => c.id === id)?.name ?? "", orders: n, spend: s.orders.filter((o) => o.customer_id === id).reduce((a, o) => a + o.total, 0) })).sort((a, b) => b.spend - a.spend).slice(0, 10);
    const tags: Record<string, number> = {};
    for (const c of custs) for (const t of c.tags) tags[t] = (tags[t] ?? 0) + 1;
    return { customers: total, repeat_customers: repeat, repeat_rate: K.repeatRate(repeat, total), new_signups: custs.filter((c) => d10(c.created_at) >= f.from && d10(c.created_at) <= f.to).length, tags, top };
  },

  feedback(ctx, f) {
    const fb = scoped(ctx, "feedback").filter((x) => d10(x.created_at) >= f.from && d10(x.created_at) <= f.to);
    return {
      count: fb.length, food: K.averageRating(fb.map((x) => x.food)), service: K.averageRating(fb.map((x) => x.service)), ambience: K.averageRating(fb.map((x) => x.ambience)),
      overall: K.averageRating(fb.map((x) => (x.food + x.service + x.ambience) / 3)), low: fb.filter((x) => Math.min(x.food, x.service, x.ambience) <= 2).length,
      distribution: [1, 2, 3, 4, 5].map((n) => ({ stars: n, count: fb.filter((x) => Math.round((x.food + x.service + x.ambience) / 3) === n).length })),
    };
  },

  dine_in(ctx, f) {
    const s = salesCore(ctx, { ...f, type: "dine_in" });
    const tables = scoped(ctx, "dining_tables");
    const outlet = settingsOf(ctx, "outlets");
    const hours = Math.max(1, Number(outlet.closing_time.slice(0, 2)) - Number(outlet.opening_time.slice(0, 2)));
    const days = Math.max(1, (new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000 + 1);
    return {
      bills: s.orders.length, tables: tables.length, turnover_per_hour: K.tableTurnover(s.orders.length, tables.length, hours * days),
      by_table: tables.map((t) => ({ table: t.name, bills: s.orders.filter((o) => o.table_id === t.id).length, sales: s.orders.filter((o) => o.table_id === t.id).reduce((a, o) => a + o.total, 0) })).sort((a, b) => b.sales - a.sales),
      by_captain: scoped(ctx, "users").filter((u) => u.role === "captain").map((u) => ({ captain: u.name, bills: s.orders.filter((o) => o.captain_id === u.id).length, sales: s.orders.filter((o) => o.captain_id === u.id).reduce((a, o) => a + o.total, 0) })),
    };
  },

  budget(ctx, f) {
    const month = f.from.slice(0, 7);
    const cats = scoped(ctx, "expense_categories");
    const budgets = scoped(ctx, "budgets").filter((b) => b.month === month);
    const exps = scoped(ctx, "expenses").filter((e) => e.spent_on.startsWith(month) && e.status === "approved");
    return cats.map((c) => {
      const budget = budgets.find((b) => b.category_id === c.id)?.amount ?? c.monthly_budget;
      const actual = exps.filter((e) => e.category_id === c.id).reduce((a, e) => a + e.amount, 0);
      return { category: c.name, budget, actual, ...K.budgetVariance(actual, budget) };
    });
  },

  day_close(ctx, f) {
    return scoped(ctx, "day_closes").filter((d) => d.business_date >= f.from && d.business_date <= f.to).map((d) => ({ ...d, closed_by_name: scoped(ctx, "users").find((u) => u.id === d.closed_by)?.name })).sort((a, b) => b.business_date.localeCompare(a.business_date));
  },

  items(ctx, f) {
    const s = salesCore(ctx, f);
    const m = new Map<string, { name: string; qty: number; sales: number }>();
    for (const it of scoped(ctx, "order_items").filter((i) => s.ids.has(i.order_id) && i.status !== "void")) {
      const r = m.get(it.name) ?? { name: it.name, qty: 0, sales: 0 };
      r.qty += it.qty;
      r.sales += it.unit_price * it.qty;
      m.set(it.name, r);
    }
    return [...m.values()].sort((a, b) => b.sales - a.sales);
  },
};

route("GET", "/reports/:name", (ctx) => {
  const fn = REPORTS[ctx.params.name.replace(/-/g, "_")];
  if (!fn) throw invalid({ name: "Unknown report" });
  if (ctx.params.name === "dashboard" && !ctx.perms.includes("dashboard.owner") && !ctx.perms.includes("reports.view")) throw invalid({ name: "No access" });
  return fn(ctx, filters(ctx));
}, { perm: "reports.view" });

export type ReportName = keyof typeof REPORTS;
