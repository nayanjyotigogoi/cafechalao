/**
 * Row types, one per database table (SRS section 8).
 * Field names are snake_case and match the MySQL columns the Laravel API will use,
 * so the frontend reads the same JSON in mock mode and in http mode.
 * Every tenant-owned row carries tenant_id, created_at, updated_at, created_by, deleted_at.
 */

export type ID = string;
export type ISODate = string; // 2026-10-27T13:45:00.000Z
export type Paise = number; // money is stored in paise (integer) to avoid float errors

export interface BaseRow {
  id: ID;
  tenant_id: ID;
  created_at: ISODate;
  updated_at: ISODate;
  created_by: ID | null;
  deleted_at: ISODate | null;
}

/* ---------- Platform (L1) ---------- */

export type BusinessType = "cafe" | "qsr" | "cloud_kitchen" | "restaurant";
export type LicenceStatus = "active" | "trial" | "suspended";

export interface Tenant {
  id: ID;
  slug: string; // chai-adda
  domains: string[]; // order.chaiadda.in, chai-adda.localhost
  name: string;
  owner_name: string;
  owner_phone: string;
  owner_email: string;
  city: string;
  business_type: BusinessType;
  hosting: "shared" | "dedicated";
  licence_key: string;
  plan: "phase1";
  purchase_date: ISODate;
  support_expiry: ISODate;
  status: LicenceStatus;
  version: string;
  last_backup_at: ISODate;
  uptime_pct: number;
  go_live_date: ISODate | null;
  support_access_until: ISODate | null; // time-limited support access granted by the owner
  created_at: ISODate;
}

export interface SupportTicket {
  id: ID;
  tenant_id: ID;
  subject: string;
  kind: "support" | "change_request";
  quote: Paise | null;
  billing_status: "none" | "quoted" | "approved" | "invoiced" | "paid";
  status: "open" | "in_progress" | "closed";
  created_at: ISODate;
}

export interface PlatformAdmin {
  id: ID;
  name: string;
  email: string;
  role: "super_admin" | "support" | "developer";
}

/* ---------- Outlet and settings ---------- */

export type FeatureKey =
  | "dine_in" | "qr_ordering" | "takeaway" | "delivery" | "counter_tokens" | "reservations" | "waitlist"
  | "captain_app" | "kds" | "loyalty" | "coupons" | "gift_cards" | "memberships" | "offers"
  | "aggregator_tracker" | "service_charge" | "stock" | "purchase" | "expenses" | "staff" | "tips";

export interface Outlet extends BaseRow {
  name: string; // shown everywhere
  legal_name: string;
  business_type: BusinessType;
  address: string;
  city: string;
  phone: string;
  email: string;
  opening_time: string; // "08:00"
  closing_time: string; // "23:00"
  tagline: string;
  setup_step: number; // wizard progress, 10 = live
}

export interface BrandSettings extends BaseRow {
  app_name: string;
  short_name: string;
  logo_url: string | null; // null → monogram
  primary_color: string; // buttons, links
  accent_color: string; // tints, hero
  hero_title: string;
  hero_subtitle: string;
}

export interface TaxSettings extends BaseRow {
  gstin: string | null;
  gst_scheme: "regular" | "composition";
  default_gst_rate: number; // 5 or 18
  fssai_number: string;
  invoice_prefix: string; // CA/26-27/
  hsn_sac: string; // 9963
  place_of_supply: string; // Assam (18)
  service_charge_enabled: boolean;
  service_charge_pct: number;
  round_off: boolean;
}

export interface BusinessTypeFlags extends BaseRow {
  features: Record<FeatureKey, boolean>;
  qr_order_flow: "captain_confirms" | "direct_to_kitchen";
  auto_accept_online: boolean;
  kds_amber_min: number;
  kds_red_min: number;
  language: "en" | "hi";
}

export interface PaymentSettings extends BaseRow {
  modes: { cash: boolean; upi: boolean; card: boolean; online: boolean; cod: boolean; upi_on_delivery: boolean };
  gateway: "dummy" | "razorpay" | "cashfree" | "phonepe";
  gateway_key_id: string; // public key id only, secret never sent to the browser
  gateway_configured: boolean;
  upi_id: string; // for static QR
  upi_qr_url?: string | null; // QR image uploaded by the owner
}

export interface DeliverySettings extends BaseRow {
  enabled: boolean;
  mode: "own" | "freelance" | "both";
  charge_type: "flat" | "slab";
  flat_charge: Paise;
  slabs: { upto_amount: Paise; charge: Paise }[]; // by order value
  min_order: Paise;
  allow_prepaid: boolean;
  allow_cod: boolean;
  allow_upi_on_delivery: boolean;
}

export interface Printer extends BaseRow {
  name: string;
  station: Station | "bill";
  width_mm: 58 | 80;
  connection: "bluetooth" | "usb" | "network";
  address: string;
  online: boolean;
}

export interface Device extends BaseRow {
  name: string;
  kind: "pos" | "captain" | "kds" | "owner";
  station: Station | null;
  last_seen_at: ISODate;
}

/* ---------- Users ---------- */

export type RoleKey =
  | "owner" | "manager" | "cashier" | "receptionist" | "captain" | "kitchen" | "storekeeper" | "rider";

export interface Role extends BaseRow {
  key: RoleKey;
  name: string;
  permissions: string[]; // permission keys, owner-editable grid
}

export interface ApprovalLimit extends BaseRow {
  role: RoleKey;
  discount_pct: number;
  void_value: Paise;
  refund_value: Paise;
  expense_value: Paise;
  po_value: Paise;
}

export interface User extends BaseRow {
  employee_code: string; // E001, E002, … typed at staff login
  name: string;
  role: RoleKey;
  phone: string;
  email: string | null;
  pin_hash: string; // mock keeps the plain PIN for demo login; Laravel hashes it
  active: boolean;
  avatar_color: string;
}

export interface StaffProfile extends BaseRow {
  user_id: ID;
  salary_type: "monthly" | "daily";
  salary_amount: Paise; // per month or per day
  weekly_off: number; // 0 = Sunday
  shift_start: string;
  shift_end: string;
  id_document: string | null;
  joined_on: ISODate;
}

/* ---------- Customers (L3, owned by the outlet) ---------- */

export interface Customer extends BaseRow {
  name: string;
  phone: string | null;
  phone_verified: boolean;
  email: string | null;
  google_id: string | null; // set when the customer signs in with Google or claims a walk-in profile
  birthday: string | null; // MM-DD or YYYY-MM-DD
  anniversary: string | null;
  gender: "male" | "female" | "other" | null;
  source: "app" | "walk_in" | "qr";
  marketing_consent: boolean;
  tags: CustomerTag[];
  loyalty_points: number;
  total_spend: Paise;
  visits: number;
  last_visit_at: ISODate | null;
}

export type CustomerTag = "vip" | "regular" | "new" | "lapsed";

export interface Address extends BaseRow {
  customer_id: ID;
  label: string; // Home, Work
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  pincode: string;
}

export interface ConsentLog extends BaseRow {
  customer_id: ID;
  purpose: "marketing_whatsapp" | "marketing_sms" | "marketing_email";
  granted: boolean;
}

/* ---------- Menu ---------- */

export type FoodType = "veg" | "non_veg" | "egg";

export interface Category extends BaseRow {
  name: string;
  name_hi: string | null;
  sort: number;
  station: Station;
  active: boolean;
}

export interface Item extends BaseRow {
  category_id: ID;
  code: string; // keypad code, e.g. 101
  name: string;
  name_hi: string | null;
  description: string;
  food_type: FoodType;
  price: Paise; // ex-GST base price
  gst_rate: number | null; // null → outlet default
  photo_url: string | null;
  bestseller: boolean;
  in_stock: boolean;
  available_today: boolean; // M2.2.1 daily availability
  prep_minutes: number;
  availability_slot_id: ID | null;
  add_on_group_ids: ID[];
  sort: number;
}

export interface Variant extends BaseRow {
  item_id: ID;
  name: string; // Small, Large
  price: Paise;
  is_default: boolean;
}

export interface AddOnGroup extends BaseRow {
  name: string;
  min_select: number;
  max_select: number;
}

export interface AddOn extends BaseRow {
  group_id: ID;
  name: string;
  price: Paise;
  food_type: FoodType;
}

export interface AvailabilitySlot extends BaseRow {
  name: string; // Breakfast
  start_time: string;
  end_time: string;
}

/* ---------- Dine-in ---------- */

export type TableStatus = "free" | "occupied" | "bill_requested" | "reserved" | "cleaning";

export interface Area extends BaseRow {
  name: string; // AC hall, Rooftop
  sort: number;
}

export interface DiningTable extends BaseRow {
  area_id: ID;
  name: string; // T4
  seats: number;
  status: TableStatus;
  qr_code: string; // public code in the QR URL /t/<code>
  merged_into: ID | null;
  current_session_id: ID | null;
}

export interface TableSession extends BaseRow {
  table_id: ID;
  guests: number;
  captain_id: ID | null;
  customer_id: ID | null;
  opened_at: ISODate;
  closed_at: ISODate | null;
  waiter_called_at: ISODate | null;
}

export interface Reservation extends BaseRow {
  customer_id: ID | null;
  name: string;
  phone: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  party_size: number;
  table_preference: string;
  table_id: ID | null;
  notes: string;
  status: "booked" | "confirmed" | "seated" | "cancelled" | "no_show";
}

export interface WaitlistEntry extends BaseRow {
  name: string;
  phone: string;
  party_size: number;
  quoted_wait_min: number;
  status: "waiting" | "notified" | "seated" | "left";
  table_id: ID | null;
}

/* ---------- Orders ---------- */

export type OrderType = "dine_in" | "takeaway" | "delivery" | "counter";
export type OrderChannel = "pos" | "captain" | "qr" | "app";
export type OrderStatus =
  | "placed" | "accepted" | "preparing" | "ready" | "out_for_delivery" | "served" | "delivered" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "partially_refunded" | "refunded";
export type Station = "kitchen" | "bar" | "dessert";

export interface Order extends BaseRow {
  number: string; // O-1093
  token: number | null; // counter token
  type: OrderType;
  channel: OrderChannel;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMode | null;
  customer_id: ID | null;
  customer_name: string | null;
  customer_phone: string | null;
  table_id: ID | null;
  table_session_id: ID | null;
  guests: number | null;
  captain_id: ID | null;
  cashier_id: ID | null;
  address_text: string | null;
  pickup_time: string | null;
  note: string;
  coupon_code: string | null;
  points_redeemed: number;
  gift_card_code: string | null;
  subtotal: Paise;
  discount: Paise;
  service_charge: Paise;
  tax: Paise;
  delivery_charge: Paise;
  packaging: Paise;
  tip: Paise;
  round_off: Paise;
  total: Paise;
  delivery_otp: string | null;
  idempotency_key: string | null;
  bill_requested: boolean;
  accepted_at: ISODate | null;
  ready_at: ISODate | null;
  completed_at: ISODate | null;
}

export interface OrderItem extends BaseRow {
  order_id: ID;
  item_id: ID;
  variant_id: ID | null;
  name: string; // snapshot: old bills keep old names and prices
  variant_name: string | null;
  add_ons: { id: ID; name: string; price: Paise }[];
  unit_price: Paise; // item/variant + add-ons, ex-GST
  qty: number;
  gst_rate: number;
  note: string;
  course: "starter" | "main" | "dessert" | null;
  kot_id: ID | null;
  status: "new" | "sent" | "preparing" | "ready" | "served" | "void";
  complimentary: boolean;
}

export interface KOT extends BaseRow {
  order_id: ID;
  number: number; // 218
  station: Station;
  status: "new" | "preparing" | "ready" | "served";
  table_name: string | null;
  order_type: OrderType;
  started_at: ISODate | null;
  ready_at: ISODate | null;
  printed: boolean;
}

export interface OrderStatusLog extends BaseRow {
  order_id: ID;
  status: OrderStatus;
  note: string;
}

/* ---------- Billing ---------- */

export type PaymentMode = "cash" | "upi" | "card" | "online" | "upi_qr" | "cod" | "upi_on_delivery" | "gift_card" | "points";

export interface Invoice extends BaseRow {
  order_id: ID;
  number: string; // CA/26-27/000123 — sequential per financial year, offline series uses device prefix
  financial_year: string; // 2026-27
  bill_of_supply: boolean; // composition scheme
  subtotal: Paise;
  discount: Paise;
  service_charge: Paise;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  round_off: Paise;
  total: Paise;
  cashier_id: ID | null;
  shift_id: ID | null;
  reprints: number;
}

export interface InvoiceTax extends BaseRow {
  invoice_id: ID;
  rate: number;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
}

export interface Payment extends BaseRow {
  invoice_id: ID | null;
  order_id: ID;
  mode: PaymentMode;
  amount: Paise;
  reference: string | null;
  status: "pending" | "success" | "failed" | "refunded";
  gateway: string | null;
  shift_id: ID | null;
}

export interface Refund extends BaseRow {
  invoice_id: ID;
  amount: Paise;
  reason: string;
  approved_by: ID | null;
}

export interface Discount extends BaseRow {
  order_id: ID;
  kind: "pct" | "flat";
  value: number;
  amount: Paise;
  reason: string;
  approved_by: ID | null;
}

export interface Void extends BaseRow {
  order_id: ID;
  order_item_id: ID;
  amount: Paise;
  reason: string;
  approved_by: ID | null;
}

export interface Shift extends BaseRow {
  user_id: ID;
  opened_at: ISODate;
  closed_at: ISODate | null;
  opening_cash: Paise;
  handed_to: ID | null;
}

export interface DayClose extends BaseRow {
  business_date: string;
  expected_cash: Paise;
  counted_cash: Paise;
  variance: Paise;
  variance_reason: string;
  closed_by: ID;
  sales_total: Paise;
}

export interface CashCount extends BaseRow {
  day_close_id: ID;
  denomination: number; // 500, 200, 100 ... in rupees
  count: number;
}

/* ---------- Marketing ---------- */

export interface LoyaltySettings extends BaseRow {
  enabled: boolean;
  earn_per_rupees: number; // 1 point per ₹10 → 10
  point_value: Paise; // 1 point = ₹0.25 → 25
  min_bill_to_redeem: Paise;
  expiry_days: number;
}

export interface LoyaltyLedger extends BaseRow {
  customer_id: ID;
  order_id: ID | null;
  points: number; // + earn, − redeem
  reason: "earn" | "redeem" | "expire" | "adjust";
  expires_at: ISODate | null;
}

export interface Coupon extends BaseRow {
  code: string;
  kind: "pct" | "flat";
  value: number; // % or paise
  max_discount: Paise | null;
  min_order: Paise;
  valid_from: string;
  valid_to: string;
  usage_limit_total: number | null;
  usage_limit_per_customer: number | null;
  used_count: number;
  order_types: OrderType[];
  item_ids: ID[]; // empty = all items
  active: boolean;
}

export interface CouponRedemption extends BaseRow {
  coupon_id: ID;
  order_id: ID;
  customer_id: ID | null;
  amount: Paise;
}

export interface GiftCard extends BaseRow {
  code: string;
  initial_value: Paise;
  balance: Paise;
  customer_id: ID | null;
  expires_on: string;
  active: boolean;
}

export interface GiftCardTxn extends BaseRow {
  gift_card_id: ID;
  order_id: ID | null;
  amount: Paise; // − redeem, + load
}

export interface MembershipPlan extends BaseRow {
  name: string;
  price: Paise;
  validity_days: number;
  discount_pct: number;
  free_item_id: ID | null;
  benefits: string;
  active: boolean;
}

export interface Membership extends BaseRow {
  plan_id: ID;
  customer_id: ID;
  starts_on: string;
  ends_on: string;
  status: "active" | "expired";
}

export interface Offer extends BaseRow {
  name: string;
  kind: "happy_hour" | "combo" | "bxgy";
  description: string;
  discount_pct: number;
  days: number[]; // 0-6
  start_time: string;
  end_time: string;
  item_ids: ID[];
  buy_qty: number;
  get_qty: number;
  combo_price: Paise | null;
  active: boolean;
}

export interface MessageLog extends BaseRow {
  customer_id: ID | null;
  channel: "whatsapp_link" | "email" | "sms";
  template: "birthday" | "anniversary" | "order_status" | "reservation" | "table_ready" | "feedback" | "bill" | "po";
  to: string;
  body: string;
  status: "prepared" | "sent";
}

export interface Feedback extends BaseRow {
  order_id: ID;
  customer_id: ID | null;
  food: number;
  service: number;
  ambience: number; // ambience for dine-in, delivery experience for delivery
  comment: string;
  replied: boolean;
}

/* ---------- Stock ---------- */

export type UnitCode = "kg" | "g" | "L" | "ml" | "pcs";

export interface RawMaterial extends BaseRow {
  name: string;
  category: string;
  unit: UnitCode; // stock unit
  storage: string;
  min_level: number;
  stock: number; // current, in stock unit; may go negative (sale never blocked)
  avg_cost: Paise; // per stock unit
  last_cost: Paise;
  supplier_id: ID | null;
}

export interface Recipe extends BaseRow {
  item_id: ID;
  variant_id: ID | null;
}

export interface RecipeLine extends BaseRow {
  recipe_id: ID;
  raw_material_id: ID;
  qty: number;
  unit: UnitCode; // converted to the material's unit on deduction
}

export interface StockLedger extends BaseRow {
  raw_material_id: ID;
  qty: number; // + in, − out
  reason: "sale" | "grn" | "wastage" | "count_adjust" | "transfer" | "opening";
  ref_id: ID | null;
  balance_after: number;
}

export interface StockCount extends BaseRow {
  counted_on: string;
  lines: { raw_material_id: ID; system_qty: number; counted_qty: number }[];
  status: "draft" | "posted";
}

export interface Wastage extends BaseRow {
  raw_material_id: ID | null;
  item_id: ID | null;
  qty: number;
  unit: UnitCode;
  reason: "expired" | "spoiled" | "burnt" | "returned" | "other";
  note: string;
  value: Paise;
}

/* ---------- Purchase ---------- */

export interface Supplier extends BaseRow {
  name: string;
  gstin: string | null;
  contact_person: string;
  phone: string;
  email: string | null;
  payment_terms_days: number;
  items_supplied: string;
  outstanding: Paise;
}

export type ApprovalState = "draft" | "pending" | "approved" | "rejected";

export interface PurchaseRequest extends BaseRow {
  number: string;
  lines: { raw_material_id: ID; qty: number; note: string }[];
  status: ApprovalState | "ordered";
  estimated_value: Paise;
}

export interface Quotation extends BaseRow {
  purchase_request_id: ID | null;
  supplier_id: ID;
  received_on: string;
}

export interface QuotationLine extends BaseRow {
  quotation_id: ID;
  raw_material_id: ID;
  rate: Paise;
}

export interface PurchaseOrder extends BaseRow {
  number: string;
  supplier_id: ID;
  purchase_request_id: ID | null;
  status: ApprovalState | "sent" | "partially_received" | "received" | "closed";
  expected_on: string;
  total: Paise;
}

export interface POLine extends BaseRow {
  purchase_order_id: ID;
  raw_material_id: ID;
  qty: number;
  rate: Paise;
  received_qty: number;
}

export interface GRN extends BaseRow {
  number: string;
  purchase_order_id: ID;
  supplier_id: ID;
  received_on: string;
  total: Paise;
  invoice_ref: string;
}

export interface GRNLine extends BaseRow {
  grn_id: ID;
  po_line_id: ID;
  raw_material_id: ID;
  received_qty: number;
  rate: Paise;
  batch: string | null;
  expiry: string | null;
  shortfall: number;
}

export interface SupplierPayment extends BaseRow {
  supplier_id: ID;
  amount: Paise;
  mode: "cash" | "upi" | "bank" | "cheque";
  reference: string;
  paid_on: string;
}

/* ---------- Expenses ---------- */

export interface ExpenseCategory extends BaseRow {
  name: string;
  monthly_budget: Paise;
}

export interface Expense extends BaseRow {
  category_id: ID;
  amount: Paise;
  mode: "cash" | "upi" | "bank" | "card";
  spent_on: string;
  note: string;
  bill_photo_url: string | null;
  status: ApprovalState;
  petty_cash: boolean;
}

export interface Budget extends BaseRow {
  category_id: ID;
  month: string; // 2026-10
  amount: Paise;
}

export type ApprovalKind = "discount" | "void" | "refund" | "expense" | "purchase_order" | "purchase_request" | "attendance";

export interface Approval extends BaseRow {
  kind: ApprovalKind;
  ref_id: ID;
  amount: Paise;
  summary: string;
  requested_by: ID;
  status: "pending" | "approved" | "rejected";
  decided_by: ID | null;
  decided_at: ISODate | null;
  required_role: RoleKey;
}

/* ---------- Staff ---------- */

export interface Attendance extends BaseRow {
  user_id: ID;
  date: string;
  clock_in: ISODate | null;
  clock_out: ISODate | null;
  selfie_url: string | null;
  status: "present" | "absent" | "half_day" | "weekly_off" | "leave";
  overtime_min: number;
  correction_note: string | null;
}

export interface ShiftRoster extends BaseRow {
  user_id: ID;
  day: number;
  start: string;
  end: string;
}

export interface Advance extends BaseRow {
  user_id: ID;
  amount: Paise;
  given_on: string;
  note: string;
  recovered: boolean;
}

export interface SalarySlip extends BaseRow {
  user_id: ID;
  month: string;
  days_present: number;
  overtime_pay: Paise;
  gross: Paise;
  advances: Paise;
  deductions: Paise;
  delivery_earnings: Paise; // in-house riders get delivery charges on salary day (M8.6)
  net: Paise;
  paid: boolean;
}

/* ---------- Delivery ---------- */

export interface Rider extends BaseRow {
  user_id: ID | null;
  name: string;
  phone: string;
  vehicle: string;
  id_document: string;
  type: "own" | "freelance";
  online: boolean;
  active: boolean;
}

export interface Delivery extends BaseRow {
  order_id: ID;
  rider_id: ID | null;
  status: "unassigned" | "requested" | "accepted" | "picked_up" | "on_the_way" | "delivered" | "failed";
  charge: Paise;
  distance_km: number;
  to_collect: Paise; // COD / UPI on delivery
  collected: Paise;
  collected_mode: "cash" | "upi" | null;
  proof: "otp" | "photo" | null;
  accepted_at: ISODate | null;
  picked_at: ISODate | null;
  delivered_at: ISODate | null;
}

export interface DeliveryRequest extends BaseRow {
  delivery_id: ID;
  rider_id: ID;
  status: "sent" | "accepted" | "taken" | "declined";
}

export interface RiderSettlement extends BaseRow {
  rider_id: ID;
  business_date: string;
  cash_collected: Paise; // owed to outlet
  charges_earned: Paise; // owed to rider
  net: Paise; // + rider pays outlet, − outlet pays rider
  settled: boolean;
  settled_by: ID | null;
}

/* ---------- Aggregators (manual) ---------- */

export interface AggregatorPlatform extends BaseRow {
  name: "Swiggy" | "Zomato";
  commission_pct: number;
  pg_fee_pct: number;
  tcs_pct: number; // GST TCS, 1%
  tds_pct: number; // 194-O, 0.1%
}

export interface AggregatorEntry extends BaseRow {
  platform_id: ID;
  period_from: string;
  period_to: string;
  orders: number;
  gross_sales: Paise;
  outlet_discount: Paise;
  packaging: Paise;
  ads: Paise;
  other_deductions: Paise;
  commission_pct: number;
}

export interface AggregatorPayout extends BaseRow {
  entry_id: ID;
  received_on: string;
  amount: Paise;
  reference: string;
}

/* ---------- System ---------- */

export interface AuditLog extends BaseRow {
  user_id: ID | null;
  user_name: string;
  action: string; // void, discount, refund, price_change, reprint, delete, setting_change, support_access
  entity: string;
  entity_id: ID | null;
  device: string;
  old_value: unknown;
  new_value: unknown;
}

export interface Notification extends BaseRow {
  audience: RoleKey | "customer";
  user_id: ID | null;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
}
