import type * as E from "@/shared/types/entities";

/**
 * The mock database: one array per MySQL table, named as the Laravel migrations will name them.
 * Every tenant-owned row carries tenant_id, exactly like the shared multi-tenant database.
 */
export interface Tables {
  tenants: E.Tenant[];
  support_tickets: E.SupportTicket[];
  platform_admins: E.PlatformAdmin[];
  outlets: E.Outlet[];
  brand_settings: E.BrandSettings[];
  tax_settings: E.TaxSettings[];
  business_type_flags: E.BusinessTypeFlags[];
  payment_settings: E.PaymentSettings[];
  delivery_settings: E.DeliverySettings[];
  loyalty_settings: E.LoyaltySettings[];
  printers: E.Printer[];
  devices: E.Device[];
  roles: E.Role[];
  approval_limits: E.ApprovalLimit[];
  users: E.User[];
  staff_profiles: E.StaffProfile[];
  customers: E.Customer[];
  addresses: E.Address[];
  consent_logs: E.ConsentLog[];
  categories: E.Category[];
  items: E.Item[];
  variants: E.Variant[];
  add_on_groups: E.AddOnGroup[];
  add_ons: E.AddOn[];
  availability_slots: E.AvailabilitySlot[];
  areas: E.Area[];
  dining_tables: E.DiningTable[];
  table_sessions: E.TableSession[];
  reservations: E.Reservation[];
  waitlist_entries: E.WaitlistEntry[];
  orders: E.Order[];
  order_items: E.OrderItem[];
  kots: E.KOT[];
  order_status_logs: E.OrderStatusLog[];
  invoices: E.Invoice[];
  invoice_taxes: E.InvoiceTax[];
  payments: E.Payment[];
  refunds: E.Refund[];
  discounts: E.Discount[];
  voids: E.Void[];
  shifts: E.Shift[];
  day_closes: E.DayClose[];
  cash_counts: E.CashCount[];
  loyalty_ledger: E.LoyaltyLedger[];
  coupons: E.Coupon[];
  coupon_redemptions: E.CouponRedemption[];
  gift_cards: E.GiftCard[];
  gift_card_txns: E.GiftCardTxn[];
  membership_plans: E.MembershipPlan[];
  memberships: E.Membership[];
  offers: E.Offer[];
  message_logs: E.MessageLog[];
  feedback: E.Feedback[];
  raw_materials: E.RawMaterial[];
  recipes: E.Recipe[];
  recipe_lines: E.RecipeLine[];
  stock_ledger: E.StockLedger[];
  stock_counts: E.StockCount[];
  wastage: E.Wastage[];
  suppliers: E.Supplier[];
  purchase_requests: E.PurchaseRequest[];
  quotations: E.Quotation[];
  quotation_lines: E.QuotationLine[];
  purchase_orders: E.PurchaseOrder[];
  po_lines: E.POLine[];
  grns: E.GRN[];
  grn_lines: E.GRNLine[];
  supplier_payments: E.SupplierPayment[];
  expense_categories: E.ExpenseCategory[];
  expenses: E.Expense[];
  budgets: E.Budget[];
  approvals: E.Approval[];
  attendance: E.Attendance[];
  shift_rosters: E.ShiftRoster[];
  advances: E.Advance[];
  salary_slips: E.SalarySlip[];
  riders: E.Rider[];
  deliveries: E.Delivery[];
  delivery_requests: E.DeliveryRequest[];
  rider_settlements: E.RiderSettlement[];
  aggregator_platforms: E.AggregatorPlatform[];
  aggregator_entries: E.AggregatorEntry[];
  aggregator_payouts: E.AggregatorPayout[];
  audit_logs: E.AuditLog[];
  notifications: E.Notification[];
  /** api_tokens and idempotency_keys mirror Laravel Sanctum tokens and the Idempotency middleware store. */
  api_tokens: { id: string; token: string; tenant_id: string | null; kind: "customer" | "staff" | "rider" | "control"; subject_id: string; created_at: string }[];
  idempotency_keys: { id: string; key: string; tenant_id: string; response: unknown; created_at: string }[];
  counters: { id: string; tenant_id: string; name: string; value: number }[];
}

export type TableName = keyof Tables;

export const emptyTables = (): Tables => {
  const t = {} as Record<string, unknown[]>;
  for (const k of TABLE_NAMES) t[k] = [];
  return t as unknown as Tables;
};

export const TABLE_NAMES: TableName[] = [
  "tenants", "support_tickets", "platform_admins", "outlets", "brand_settings", "tax_settings", "business_type_flags",
  "payment_settings", "delivery_settings", "loyalty_settings", "printers", "devices", "roles", "approval_limits", "users",
  "staff_profiles", "customers", "addresses", "consent_logs", "categories", "items", "variants", "add_on_groups", "add_ons",
  "availability_slots", "areas", "dining_tables", "table_sessions", "reservations", "waitlist_entries", "orders", "order_items",
  "kots", "order_status_logs", "invoices", "invoice_taxes", "payments", "refunds", "discounts", "voids", "shifts", "day_closes",
  "cash_counts", "loyalty_ledger", "coupons", "coupon_redemptions", "gift_cards", "gift_card_txns", "membership_plans",
  "memberships", "offers", "message_logs", "feedback", "raw_materials", "recipes", "recipe_lines", "stock_ledger",
  "stock_counts", "wastage", "suppliers", "purchase_requests", "quotations", "quotation_lines", "purchase_orders", "po_lines",
  "grns", "grn_lines", "supplier_payments", "expense_categories", "expenses", "budgets", "approvals", "attendance",
  "shift_rosters", "advances", "salary_slips", "riders", "deliveries", "delivery_requests", "rider_settlements",
  "aggregator_platforms", "aggregator_entries", "aggregator_payouts", "audit_logs", "notifications", "api_tokens",
  "idempotency_keys", "counters",
];
