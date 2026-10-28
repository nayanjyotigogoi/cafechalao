import type { Coupon, OrderType, Paise, TaxSettings } from "@/shared/types/entities";
import { allocate } from "./money";

/**
 * PriceCalculator + GstCalculator (SRS 16.3).
 * The same pure functions run in the mock backend and for the instant POS preview.
 * In http mode Laravel's Shared/Pricing and Shared/Tax produce the final bill; the UI only shows it.
 *
 * Rules used (to be confirmed by a CA, SRS section 6):
 * - Discounts reduce the taxable value and are spread across GST rates in proportion to line value.
 * - Service charge (dine-in only, off by default) is taxable at the bill's weighted rate.
 * - Delivery charge, packaging and tip are passed through without GST (delivery charge goes to the rider).
 * - Loyalty points and gift cards are payment modes: they reduce what is payable, not the taxable value.
 * - Composition scheme: no GST is charged; the bill prints as "Bill of Supply".
 */

export interface PriceLine {
  item_id: string;
  unit_price: Paise; // ex-GST, includes variant and add-ons
  qty: number;
  gst_rate: number;
  complimentary?: boolean;
}

export interface PriceInput {
  lines: PriceLine[];
  order_type: OrderType;
  tax: Pick<TaxSettings, "gst_scheme" | "service_charge_enabled" | "service_charge_pct" | "round_off">;
  manual_discount?: { kind: "pct" | "flat"; value: number } | null;
  coupon?: Coupon | null;
  membership_discount_pct?: number;
  offer_discount?: Paise;
  remove_service_charge?: boolean;
  delivery_charge?: Paise;
  packaging?: Paise;
  tip?: Paise;
  points_value?: Paise; // value of points being redeemed
  gift_card_amount?: Paise;
}

export interface TaxLine {
  rate: number;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
}

export interface Quote {
  subtotal: Paise;
  complimentary: Paise;
  coupon_discount: Paise;
  manual_discount: Paise;
  membership_discount: Paise;
  offer_discount: Paise;
  discount: Paise;
  service_charge: Paise;
  taxable: Paise;
  tax_lines: TaxLine[];
  tax: Paise;
  delivery_charge: Paise;
  packaging: Paise;
  tip: Paise;
  round_off: Paise;
  total: Paise;
  points_value: Paise;
  gift_card_amount: Paise;
  payable: Paise;
  bill_of_supply: boolean;
  coupon_error: string | null;
}

export function couponDiscount(coupon: Coupon, lines: PriceLine[], orderType: OrderType, today = new Date()): { amount: Paise; error: string | null } {
  if (!coupon.active) return { amount: 0, error: "This coupon is not active" };
  const d = today.toISOString().slice(0, 10);
  if (d < coupon.valid_from || d > coupon.valid_to) return { amount: 0, error: "This coupon has expired" };
  if (coupon.usage_limit_total != null && coupon.used_count >= coupon.usage_limit_total) return { amount: 0, error: "This coupon has been fully used" };
  if (coupon.order_types.length && !coupon.order_types.includes(orderType)) return { amount: 0, error: "Not valid for this order type" };
  const eligible = lines.filter((l) => !l.complimentary && (coupon.item_ids.length === 0 || coupon.item_ids.includes(l.item_id)));
  const base = eligible.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const all = lines.reduce((s, l) => s + (l.complimentary ? 0 : l.unit_price * l.qty), 0);
  if (all < coupon.min_order) return { amount: 0, error: `Add items worth ₹${Math.ceil((coupon.min_order - all) / 100)} more to use this coupon` };
  let amount = coupon.kind === "pct" ? Math.round((base * coupon.value) / 100) : coupon.value;
  if (coupon.max_discount != null) amount = Math.min(amount, coupon.max_discount);
  return { amount: Math.min(amount, base), error: null };
}

export function priceOrder(input: PriceInput): Quote {
  const { lines, tax } = input;
  const composition = tax.gst_scheme === "composition";
  const gross = lines.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const complimentary = lines.filter((l) => l.complimentary).reduce((s, l) => s + l.unit_price * l.qty, 0);
  const paidLines = lines.filter((l) => !l.complimentary);
  const subtotal = gross - complimentary;

  let couponAmt = 0;
  let couponError: string | null = null;
  if (input.coupon) {
    const r = couponDiscount(input.coupon, lines, input.order_type);
    couponAmt = r.amount;
    couponError = r.error;
  }
  const afterCoupon = subtotal - couponAmt;
  const membership = input.membership_discount_pct ? Math.round((afterCoupon * input.membership_discount_pct) / 100) : 0;
  const offer = Math.min(input.offer_discount ?? 0, afterCoupon - membership);
  let manual = 0;
  if (input.manual_discount) {
    const base = afterCoupon - membership - offer;
    manual = input.manual_discount.kind === "pct" ? Math.round((base * input.manual_discount.value) / 100) : Math.round(input.manual_discount.value);
    manual = Math.max(0, Math.min(manual, base));
  }
  const discount = couponAmt + membership + offer + manual;
  const netFood = subtotal - discount;

  const serviceCharge =
    tax.service_charge_enabled && !input.remove_service_charge && input.order_type === "dine_in"
      ? Math.round((netFood * tax.service_charge_pct) / 100)
      : 0;

  // Spread discount across lines, then group by GST rate.
  const lineValues = paidLines.map((l) => l.unit_price * l.qty);
  const lineDiscounts = allocate(discount, lineValues);
  const byRate = new Map<number, Paise>();
  paidLines.forEach((l, i) => byRate.set(l.gst_rate, (byRate.get(l.gst_rate) ?? 0) + lineValues[i] - lineDiscounts[i]));
  // Service charge is taxed in the same proportion as the food.
  const rates = [...byRate.keys()];
  const scParts = allocate(serviceCharge, rates.map((r) => byRate.get(r)!));
  rates.forEach((r, i) => byRate.set(r, byRate.get(r)! + scParts[i]));

  const taxLines: TaxLine[] = composition
    ? []
    : rates
        .sort((a, b) => a - b)
        .map((rate) => {
          const taxable = byRate.get(rate)!;
          const half = Math.round((taxable * rate) / 200); // CGST = SGST = rate / 2
          return { rate, taxable, cgst: half, sgst: half };
        });
  const taxAmt = taxLines.reduce((s, t) => s + t.cgst + t.sgst, 0);
  const taxable = netFood + serviceCharge;
  const delivery = input.delivery_charge ?? 0;
  const packaging = input.packaging ?? 0;
  const tip = input.tip ?? 0;
  const beforeRound = taxable + taxAmt + delivery + packaging + tip;
  const total = tax.round_off ? Math.round(beforeRound / 100) * 100 : beforeRound;
  const roundOff = total - beforeRound;
  const pointsValue = Math.min(input.points_value ?? 0, total);
  const giftCard = Math.min(input.gift_card_amount ?? 0, total - pointsValue);

  return {
    subtotal,
    complimentary,
    coupon_discount: couponAmt,
    manual_discount: manual,
    membership_discount: membership,
    offer_discount: offer,
    discount,
    service_charge: serviceCharge,
    taxable,
    tax_lines: taxLines,
    tax: taxAmt,
    delivery_charge: delivery,
    packaging,
    tip,
    round_off: roundOff,
    total,
    points_value: pointsValue,
    gift_card_amount: giftCard,
    payable: total - pointsValue - giftCard,
    bill_of_supply: composition,
    coupon_error: couponError,
  };
}

/** Points earned on a bill: 1 point per `earnPerRupees` of net food value (ex-GST). */
export const pointsEarned = (netFood: Paise, earnPerRupees: number) => (earnPerRupees > 0 ? Math.floor(netFood / 100 / earnPerRupees) : 0);

/** Delivery charge from outlet rules: flat, or slab by order value (distance zones are Phase 3). */
export function deliveryCharge(rules: { charge_type: "flat" | "slab"; flat_charge: Paise; slabs: { upto_amount: Paise; charge: Paise }[] }, orderValue: Paise): Paise {
  if (rules.charge_type === "flat") return rules.flat_charge;
  const slab = [...rules.slabs].sort((a, b) => a.upto_amount - b.upto_amount).find((s) => orderValue <= s.upto_amount);
  return slab ? slab.charge : 0;
}

/** Indian financial year label for a date: Apr–Mar → "2026-27". */
export function financialYear(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
