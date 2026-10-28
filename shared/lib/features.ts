import type { BusinessType, FeatureKey } from "@/shared/types/entities";

/** Business Type presets (SRS section 1 and M11.1). The owner can still flip any toggle. */
export const FEATURE_LABEL: Record<FeatureKey, string> = {
  dine_in: "Dine-in and tables",
  qr_ordering: "QR table ordering",
  takeaway: "Takeaway",
  delivery: "Own delivery",
  counter_tokens: "Counter tokens",
  reservations: "Table reservations",
  waitlist: "Waitlist",
  captain_app: "Captain (waiter) app",
  kds: "Kitchen display",
  loyalty: "Loyalty points",
  coupons: "Coupons",
  gift_cards: "Gift cards",
  memberships: "Memberships",
  offers: "Offers (happy hour, combos)",
  aggregator_tracker: "Swiggy/Zomato tracker",
  service_charge: "Service charge",
  stock: "Stock and recipes",
  purchase: "Purchase",
  expenses: "Expenses and budget",
  staff: "Staff, attendance and salary",
  tips: "Tips",
};

const ALL_ON = Object.fromEntries(Object.keys(FEATURE_LABEL).map((k) => [k, true])) as Record<FeatureKey, boolean>;

export function businessTypeDefaults(type: BusinessType): Record<FeatureKey, boolean> {
  const f = { ...ALL_ON, service_charge: false };
  switch (type) {
    case "cafe":
      return { ...f, counter_tokens: false };
    case "qsr":
      return { ...f, reservations: false, captain_app: false, waitlist: false, dine_in: false, qr_ordering: false };
    case "cloud_kitchen":
      return { ...f, dine_in: false, qr_ordering: false, reservations: false, waitlist: false, captain_app: false, counter_tokens: false };
    case "restaurant":
      return { ...f, counter_tokens: false, service_charge: true };
  }
}

export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  cafe: "Café",
  qsr: "QSR counter",
  cloud_kitchen: "Cloud kitchen",
  restaurant: "Restaurant",
};
