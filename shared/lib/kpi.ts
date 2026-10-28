import type { Paise } from "@/shared/types/entities";

/** KPI formulas exactly as SRS section 5. All money in paise, percentages as 0–100. */

const div = (a: number, b: number) => (b === 0 ? 0 : a / b);

export const netSales = (gross: Paise, discounts: Paise, refunds: Paise) => gross - discounts - refunds;
export const averageOrderValue = (net: Paise, bills: number) => Math.round(div(net, bills));
export const foodCostPct = (opening: Paise, purchases: Paise, closing: Paise, net: Paise) => div(opening + purchases - closing, net) * 100;
export const theoreticalFoodCost = (rows: { recipe_cost: Paise; qty: number }[]) => rows.reduce((s, r) => s + r.recipe_cost * r.qty, 0);
export const stockVariance = (theoretical: number, actual: number) => theoretical - actual;
export const itemMargin = (priceExGst: Paise, recipeCost: Paise) => priceExGst - recipeCost;
export const labourCostPct = (salaries: Paise, wages: Paise, overtime: Paise, net: Paise) => div(salaries + wages + overtime, net) * 100;
export const grossProfit = (net: Paise, cogs: Paise) => net - cogs;
export const netProfit = (gp: Paise, labour: Paise, expenses: Paise) => gp - labour - expenses;
export const closingCash = (opening: Paise, cashIn: Paise, cashOut: Paise) => opening + cashIn - cashOut;
export const budgetVariance = (actual: Paise, budget: Paise) => ({ amount: actual - budget, pct: div(actual - budget, budget) * 100 });
export const tableTurnover = (bills: number, tables: number, hours: number) => div(div(bills, tables), hours);
export const averagePrepTimeSec = (rows: { kot_at: number; ready_at: number }[]) => div(rows.reduce((s, r) => s + (r.ready_at - r.kot_at) / 1000, 0), rows.length);
export const deliveryTimeMin = (acceptedAt: number, deliveredAt: number) => (deliveredAt - acceptedAt) / 60000;
export const repeatRate = (customersWith2Plus: number, total: number) => div(customersWith2Plus, total) * 100;
export const averageRating = (stars: number[]) => div(stars.reduce((a, b) => a + b, 0), stars.length);
export const cashVariance = (counted: Paise, expected: Paise) => counted - expected;

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

/**
 * Menu engineering: popularity = item qty ÷ average qty per item; margin compared to the
 * average item margin. Star = high/high, Plowhorse = high popularity low margin,
 * Puzzle = low popularity high margin, Dog = both low.
 */
export function menuEngineering<T extends { qty: number; margin: Paise }>(rows: T[]): (T & { popularity: number; cls: MenuClass })[] {
  const avgQty = div(rows.reduce((s, r) => s + r.qty, 0), rows.length);
  const avgMargin = div(rows.reduce((s, r) => s + r.margin, 0), rows.length);
  return rows.map((r) => {
    const popularity = div(r.qty, avgQty);
    const hiPop = popularity >= 1;
    const hiMargin = r.margin >= avgMargin;
    const cls: MenuClass = hiPop && hiMargin ? "star" : hiPop ? "plowhorse" : hiMargin ? "puzzle" : "dog";
    return { ...r, popularity, cls };
  });
}

/** Aggregator net payout (SRS M9.2 and section 5). */
export interface AggregatorInput {
  gross_sales: Paise;
  outlet_discount: Paise;
  packaging: Paise;
  ads: Paise;
  other_deductions: Paise;
  commission_pct: number;
  pg_fee_pct: number;
  tcs_pct: number; // GST TCS (1%) on net taxable supplies
  tds_pct: number; // income tax 194-O (0.1%)
}

export function aggregatorPayout(e: AggregatorInput) {
  const commission = Math.round((e.gross_sales * e.commission_pct) / 100);
  const gstOnCommission = Math.round(commission * 0.18);
  const pgFee = Math.round((e.gross_sales * e.pg_fee_pct) / 100);
  const tcs = Math.round(((e.gross_sales - e.outlet_discount) * e.tcs_pct) / 100);
  const tds = Math.round(((e.gross_sales - e.outlet_discount) * e.tds_pct) / 100);
  const net = e.gross_sales - commission - gstOnCommission - pgFee - e.ads - e.other_deductions - tcs - tds - e.outlet_discount;
  return {
    commission,
    gst_on_commission: gstOnCommission,
    pg_fee: pgFee,
    tcs,
    tds,
    ads: e.ads,
    other: e.other_deductions,
    outlet_discount: e.outlet_discount,
    net_payout: net,
    per_100: div(net, e.gross_sales) * 100,
  };
}
