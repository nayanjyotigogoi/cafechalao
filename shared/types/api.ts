import type * as E from "./entities";
import type { Quote } from "@/shared/lib/pricing";

/** Response shapes of composite endpoints (documented in docs/api-contract.md). */

export interface Settings {
  tenant: { id: string; slug: string; status: E.LicenceStatus; version: string; support_access_until: string | null };
  outlet: E.Outlet;
  brand: E.BrandSettings;
  tax: E.TaxSettings;
  flags: E.BusinessTypeFlags;
  payment: E.PaymentSettings;
  delivery: E.DeliverySettings;
  loyalty: E.LoyaltySettings;
  powered_by: { text: string; url: string; locked: boolean };
}

export type MenuItem = E.Item & {
  variants: E.Variant[];
  add_on_groups: (E.AddOnGroup & { add_ons: E.AddOn[] })[];
  slot: E.AvailabilitySlot | null;
  available_now: boolean;
  recipe_cost?: number;
};
export interface Menu {
  categories: E.Category[];
  items: MenuItem[];
  slots: E.AvailabilitySlot[];
}

export interface CartLine {
  key: string;
  item_id: string;
  variant_id: string | null;
  add_on_ids: string[];
  qty: number;
  note: string;
  name: string;
  variant_name: string | null;
  add_on_names: string[];
  unit_price: number;
  food_type: E.FoodType;
}

export interface QuoteResult {
  lines: (CartLine & { unit_price: number; gst_rate: number })[];
  quote: Quote;
  coupon: E.Coupon | null;
  coupon_error: string | null;
  points_used: number;
  points_error: string | null;
  gift_card: { code: string; balance: number } | null;
  gift_card_error: string | null;
  membership: { name: string; discount_pct: number } | null;
  offers: string[];
  min_order_error: string | null;
  customer_points: number;
}

export type OrderDetail = E.Order & {
  items: E.OrderItem[];
  kots: E.KOT[];
  table: E.DiningTable | null;
  invoice: E.Invoice | null;
  delivery: (E.Delivery & { rider: { name: string; phone: string; vehicle: string } | null }) | null;
  payments: E.Payment[];
  status_log: E.OrderStatusLog[];
  feedback: E.Feedback | null;
  /** Dine-in: every bill of this table visit (extra items after paying go on a new bill). */
  table_bills: TableBills | null;
};

export type OrderListRow = E.Order & { table_name: string | null; items: E.OrderItem[] };

export type KotRow = E.KOT & { order_number: string; order_status: E.OrderStatus; token: number | null; customer_name: string | null; note: string; items: E.OrderItem[] };

export interface TableBills {
  paid: number;
  /** Guest says they paid by UPI; the cashier hasn't confirmed it yet. */
  confirming: number;
  due: number;
  orders: { id: string; number: string; total: number; status: E.OrderStatus; payment_status: E.Order["payment_status"]; invoice_id: string | null; invoice_number: string | null; created_at: string }[];
}

export interface FloorTable extends E.DiningTable {
  bill: TableBills | null;
  session: (E.TableSession & { captain_name: string | null }) | null;
  order: { id: string; number: string; total: number; status: E.OrderStatus; bill_requested: boolean; updated_at: string; items: { id: string; name: string; qty: number; status: E.OrderItem["status"] }[] } | null;
  reservation: E.Reservation | null;
}
export interface Floor {
  areas: E.Area[];
  tables: FloorTable[];
}

export interface StaffSession {
  user: Omit<E.User, "pin_hash">;
  permissions: string[];
  limits: E.ApprovalLimit;
}

export type InvoiceDetail = E.Invoice & {
  order: OrderDetail;
  taxes: E.InvoiceTax[];
  payments: E.Payment[];
  refunds: E.Refund[];
  outlet: E.Outlet;
  tax_settings: E.TaxSettings;
  brand: E.BrandSettings;
  cashier: string | null;
};

export type DeliveryRow = E.Delivery & {
  rider_name: string | null;
  order: { id: string; number: string; status: E.OrderStatus; total: number; payment_method: E.PaymentMode | null; payment_status: E.PaymentStatus; customer_name: string | null; customer_phone: string | null; address_text: string | null; created_at: string; ready_at: string | null } | null;
  requested_riders: string[];
  pickup?: { name: string; address: string; phone: string };
};

export interface Dashboard {
  range: { from: string; to: string };
  sales: number; net_sales: number; orders: number; aov: number; sales_change_pct: number | null; online: number; cash: number; expenses: number;
  food_cost_pct: number; labour_cost_pct: number; profit_estimate: number; cash_in_hand: number;
  live_tables: { occupied: number; total: number };
  by_hour: { hour: number; sales: number; orders: number }[];
  by_type: { type: string; orders: number; sales: number }[];
  top_items: { name: string; qty: number; sales: number }[];
  alerts: { kind: string; text: string; link: string }[];
}
