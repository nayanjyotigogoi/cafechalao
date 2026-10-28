import { describe, expect, it } from "vitest";
import * as K from "@/shared/lib/kpi";
import { convert } from "@/shared/lib/units";

describe("KPI formulas (SRS section 5)", () => {
  it("TC-RPT-01 net sales, AOV, food cost %, labour %, profit", () => {
    const net = K.netSales(100000, 5000, 2000);
    expect(net).toBe(93000);
    expect(K.averageOrderValue(net, 10)).toBe(9300);
    expect(K.foodCostPct(20000, 30000, 21000, 93000)).toBeCloseTo(31.18, 1);
    expect(K.labourCostPct(15000, 3000, 1000, 95000)).toBeCloseTo(20, 5);
    const gp = K.grossProfit(93000, 29000);
    expect(K.netProfit(gp, 19000, 10000)).toBe(35000);
  });

  it("TC-RPT-02 cash flow, budget variance, cash variance", () => {
    expect(K.closingCash(5000, 20000, 12000)).toBe(13000);
    expect(K.budgetVariance(11000, 10000)).toEqual({ amount: 1000, pct: 10 });
    expect(K.cashVariance(9800, 10000)).toBe(-200);
  });

  it("TC-RPT-03 menu engineering classes", () => {
    const rows = K.menuEngineering([
      { name: "Star", qty: 100, margin: 80 },
      { name: "Plowhorse", qty: 100, margin: 10 },
      { name: "Puzzle", qty: 5, margin: 90 },
      { name: "Dog", qty: 5, margin: 5 },
    ]);
    expect(rows.map((r) => r.cls)).toEqual(["star", "plowhorse", "puzzle", "dog"]);
  });

  it("TC-AGG-01 aggregator net payout per SRS formula", () => {
    const r = K.aggregatorPayout({ gross_sales: 100000_00, outlet_discount: 5000_00, packaging: 2000_00, ads: 1000_00, other_deductions: 0, commission_pct: 20, pg_fee_pct: 2, tcs_pct: 1, tds_pct: 0.1 });
    expect(r.commission).toBe(20000_00);
    expect(r.gst_on_commission).toBe(3600_00);
    expect(r.pg_fee).toBe(2000_00);
    expect(r.tcs).toBe(950_00);
    expect(r.tds).toBe(95_00);
    expect(r.net_payout).toBe(100000_00 - 20000_00 - 3600_00 - 2000_00 - 1000_00 - 950_00 - 95_00 - 5000_00);
    expect(r.per_100).toBeCloseTo(67.355, 2);
  });

  it("TC-RPT-04 repeat rate, rating, prep time, turnover", () => {
    expect(K.repeatRate(25, 100)).toBe(25);
    expect(K.averageRating([5, 4, 3])).toBe(4);
    expect(K.averagePrepTimeSec([{ kot_at: 0, ready_at: 600000 }, { kot_at: 0, ready_at: 300000 }])).toBe(450);
    expect(K.tableTurnover(60, 10, 12)).toBe(0.5);
  });

  it("TC-STK-01 unit conversion for recipes", () => {
    expect(convert(120, "ml", "L")).toBeCloseTo(0.12);
    expect(convert(1.5, "kg", "g")).toBe(1500);
    expect(() => convert(1, "kg", "pcs")).toThrow();
  });
});
