import { newIdempotencyKey, post } from "@/shared/api/client";
import type { OrderDetail, QuoteResult } from "@/shared/types/api";
import type { DayClose, Invoice, PaymentMode, Shift } from "@/shared/types/entities";

/** Billing module: settle, preview, invoices, refunds, shifts, day close. */
export interface SettleBody {
  payments: { mode: PaymentMode; amount: number; reference?: string }[];
  discount?: { kind: "pct" | "flat"; value: number; reason: string } | null;
  coupon_code?: string | null;
  redeem_points?: number;
  gift_card_code?: string | null;
  customer_id?: string | null;
  remove_service_charge?: boolean;
  tip?: number;
  approver_id?: string;
}

export const billingApi = {
  preview: (orderId: string, b: Partial<SettleBody>) => post<QuoteResult | null>(`/orders/${orderId}/preview`, b, { auth: "staff" }),
  settle: (orderId: string, b: SettleBody) => post<{ invoice: Invoice; order: OrderDetail; change: number }>(`/orders/${orderId}/settle`, b, { auth: "staff", idempotencyKey: newIdempotencyKey() }),
  reprint: (id: string) => post(`/invoices/${id}/reprint`, {}, { auth: "staff" }),
  share: (id: string, phone?: string) => post<{ whatsapp_url: string; sms_body: string }>(`/invoices/${id}/share`, { phone, origin: typeof window !== "undefined" ? window.location.origin : "" }, { auth: "staff" }),
  refund: (id: string, b: { amount: number; reason: string; approver_id?: string; mode?: string }) => post(`/invoices/${id}/refund`, b, { auth: "staff" }),
  openShift: (opening_cash: number) => post<Shift>("/shifts/open", { opening_cash }, { auth: "staff" }),
  handover: (id: string, to_user_id: string, cash: number) => post<Shift>(`/shifts/${id}/handover`, { to_user_id, cash }, { auth: "staff" }),
  dayClose: (b: { counts: { denomination: number; count: number }[]; variance_reason?: string; date?: string }) => post<DayClose>("/day-close", b, { auth: "staff" }),
};
