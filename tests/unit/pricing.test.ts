import { describe, expect, it } from "vitest";
import { allocate, formatINR } from "@/shared/lib/money";
import { couponDiscount, deliveryCharge, financialYear, pointsEarned, priceOrder } from "@/shared/lib/pricing";
import type { Coupon } from "@/shared/types/entities";

const tax = { gst_scheme: "regular" as const, service_charge_enabled: false, service_charge_pct: 5, round_off: true };
const line = (price: number, qty = 1, rate = 5) => ({ item_id: `i${price}`, unit_price: price * 100, qty, gst_rate: rate });

describe("GST and pricing (Shared/Tax, Shared/Pricing)", () => {
  it("TC-BILL-01 matches the wireframe cart: ₹170 + 5% GST = ₹178.50 → rounds to ₹179", () => {
    const q = priceOrder({ lines: [line(40, 2), line(90)], order_type: "dine_in", tax });
    expect(q.subtotal).toBe(17000);
    expect(q.tax).toBe(850);
    expect(q.tax_lines[0]).toEqual({ rate: 5, taxable: 17000, cgst: 425, sgst: 425 });
    expect(q.total).toBe(17900);
    expect(q.round_off).toBe(50);
  });

  it("TC-BILL-02 no round-off keeps paise", () => {
    const q = priceOrder({ lines: [line(40, 2), line(90)], order_type: "dine_in", tax: { ...tax, round_off: false } });
    expect(q.total).toBe(17850);
  });

  it("TC-BILL-03 composition scheme prints a Bill of Supply with no GST", () => {
    const q = priceOrder({ lines: [line(99, 2)], order_type: "counter", tax: { ...tax, gst_scheme: "composition" } });
    expect(q.bill_of_supply).toBe(true);
    expect(q.tax).toBe(0);
    expect(q.tax_lines).toHaveLength(0);
    expect(q.total).toBe(19800);
  });

  it("TC-BILL-04 service charge only on dine-in, taxable, and removable on request", () => {
    const sc = { ...tax, service_charge_enabled: true, round_off: false };
    const dine = priceOrder({ lines: [line(200)], order_type: "dine_in", tax: sc });
    expect(dine.service_charge).toBe(1000);
    expect(dine.taxable).toBe(21000);
    expect(dine.tax).toBe(1050);
    expect(priceOrder({ lines: [line(200)], order_type: "takeaway", tax: sc }).service_charge).toBe(0);
    expect(priceOrder({ lines: [line(200)], order_type: "dine_in", tax: sc, remove_service_charge: true }).service_charge).toBe(0);
  });

  it("TC-BILL-05 discount is spread across GST rates and lowers the taxable value", () => {
    const q = priceOrder({ lines: [line(100, 1, 5), line(100, 1, 18)], order_type: "takeaway", tax: { ...tax, round_off: false }, manual_discount: { kind: "flat", value: 2000 } });
    expect(q.discount).toBe(2000);
    expect(q.tax_lines.map((t) => t.taxable)).toEqual([9000, 9000]);
    expect(q.tax).toBe(Math.round(9000 * 0.025) * 2 + Math.round(9000 * 0.09) * 2);
  });

  it("TC-BILL-06 complimentary items are free and not taxed", () => {
    const q = priceOrder({ lines: [line(100), { ...line(50), complimentary: true }], order_type: "dine_in", tax: { ...tax, round_off: false } });
    expect(q.subtotal).toBe(10000);
    expect(q.complimentary).toBe(5000);
    expect(q.tax).toBe(500);
  });

  it("TC-BILL-07 delivery charge and tip are not taxed; points and gift card reduce what is payable", () => {
    const q = priceOrder({ lines: [line(300)], order_type: "delivery", tax: { ...tax, round_off: false }, delivery_charge: 3000, tip: 2000, points_value: 2500, gift_card_amount: 10000 });
    expect(q.tax).toBe(1500);
    expect(q.total).toBe(30000 + 1500 + 3000 + 2000);
    expect(q.payable).toBe(q.total - 2500 - 10000);
  });

  it("TC-MKT-01 coupon rules: min order, expiry, cap, usage limit, order type", () => {
    const today = new Date();
    const c: Coupon = {
      id: "c", tenant_id: "t", created_at: "", updated_at: "", created_by: null, deleted_at: null, code: "CHAI10", kind: "pct", value: 10, max_discount: 5000,
      min_order: 15000, valid_from: "2000-01-01", valid_to: "2999-01-01", usage_limit_total: 10, usage_limit_per_customer: 1, used_count: 0, order_types: [], item_ids: [], active: true,
    };
    expect(couponDiscount(c, [line(100)], "dine_in", today).error).toMatch(/Add items worth ₹50 more/);
    expect(couponDiscount(c, [line(200)], "dine_in", today).amount).toBe(2000);
    expect(couponDiscount(c, [line(1000)], "dine_in", today).amount).toBe(5000);
    expect(couponDiscount({ ...c, valid_to: "2000-01-02" }, [line(200)], "dine_in", today).error).toMatch(/expired/);
    expect(couponDiscount({ ...c, used_count: 10 }, [line(200)], "dine_in", today).error).toMatch(/fully used/);
    expect(couponDiscount({ ...c, order_types: ["delivery"] }, [line(200)], "dine_in", today).error).toMatch(/order type/);
  });

  it("TC-MKT-02 loyalty: 1 point per ₹10 of net value", () => {
    expect(pointsEarned(17000, 10)).toBe(17);
    expect(pointsEarned(999, 10)).toBe(0);
  });

  it("TC-DEL-01 delivery charge: flat or slab by order value", () => {
    expect(deliveryCharge({ charge_type: "flat", flat_charge: 3000, slabs: [] }, 50000)).toBe(3000);
    const slab = { charge_type: "slab" as const, flat_charge: 0, slabs: [{ upto_amount: 29900, charge: 4000 }, { upto_amount: 59900, charge: 2500 }, { upto_amount: 1e9, charge: 0 }] };
    expect(deliveryCharge(slab, 20000)).toBe(4000);
    expect(deliveryCharge(slab, 45000)).toBe(2500);
    expect(deliveryCharge(slab, 90000)).toBe(0);
  });

  it("TC-BILL-08 invoice series runs per Indian financial year (Apr–Mar)", () => {
    expect(financialYear(new Date(2026, 9, 27))).toBe("2026-27");
    expect(financialYear(new Date(2027, 2, 31))).toBe("2026-27");
    expect(financialYear(new Date(2027, 3, 1))).toBe("2027-28");
  });

  it("allocate never loses a paisa", () => {
    const parts = allocate(1001, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(formatINR(17850)).toBe("₹178.50");
    expect(formatINR(1842000)).toBe("₹18,420");
  });
});
