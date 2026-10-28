import { newIdempotencyKey, patch, post, type AuthKind } from "@/shared/api/client";
import type { OrderDetail, QuoteResult } from "@/shared/types/api";
import type { OrderType } from "@/shared/types/entities";

/** Orders module: cart quote, place order, pay, POS/captain order actions, kitchen display. */
export interface LineIn {
  item_id: string;
  variant_id?: string | null;
  add_on_ids?: string[];
  qty: number;
  note?: string;
  course?: "starter" | "main" | "dessert" | null;
}

export type PlaceResult = { order: OrderDetail; payment: { gateway: string; key_id: string; amount: number; order_id: string } | null };

export const ordersApi = {
  quote: (b: { lines: LineIn[]; order_type: OrderType; coupon_code?: string | null; redeem_points?: number; gift_card_code?: string | null; tip?: number }, auth?: AuthKind) =>
    post<QuoteResult>("/cart/quote", b, { auth }),
  place: (b: object, auth?: AuthKind, key = newIdempotencyKey()) => post<PlaceResult>("/orders", b, { auth, idempotencyKey: key }),
  pay: (id: string, result: "success" | "failure") => post<{ order: OrderDetail }>(`/orders/${id}/pay`, { result }, { idempotencyKey: `pay-${id}-${result}-${Date.now()}` }),
  /** Customer paid by scanning the café's UPI QR; the café confirms it at the POS. */
  paid: (id: string, reference: string) => post<{ order: OrderDetail }>(`/orders/${id}/pay`, { reference }, { auth: "customer" }),
  /** Cashier confirms the UPI money arrived (bills the order and sends it to the kitchen). */
  confirmPayment: (id: string, reference?: string) => post<OrderDetail>(`/orders/${id}/confirm-payment`, { reference }, { auth: "staff" }),
  cancel: (id: string, reason: string, auth: AuthKind) => post(`/orders/${id}/cancel`, { reason }, { auth }),
  feedback: (id: string, b: { food: number; service: number; ambience: number; comment: string }) => post(`/orders/${id}/feedback`, b, { auth: "customer" }),
  requestBill: (id: string, tableCode?: string) => post(`/orders/${id}/request-bill`, {}, tableCode ? { query: { table_code: tableCode } } : { auth: "staff" }),
  callWaiter: (code: string) => post(`/qr/${code}/call-waiter`, {}),

  open: (b: { type: OrderType; table_id?: string; guests?: number; customer_id?: string | null; lines?: LineIn[]; note?: string; customer_name?: string; customer_phone?: string; address?: string; pickup_time?: string }) =>
    post<OrderDetail>("/pos/orders", b, { auth: "staff", idempotencyKey: newIdempotencyKey() }),
  addItems: (id: string, lines: LineIn[], version?: string, send_kot?: boolean) => post<OrderDetail>(`/orders/${id}/items`, { lines, version, send_kot }, { auth: "staff" }),
  editItem: (itemId: string, b: { qty?: number; note?: string }) => patch<OrderDetail>(`/order-items/${itemId}`, b, { auth: "staff" }),
  sendKot: (id: string, version?: string) => post<{ order: OrderDetail }>(`/orders/${id}/kot`, { version }, { auth: "staff" }),
  status: (id: string, status: string) => patch<OrderDetail>(`/orders/${id}/status`, { status }, { auth: "staff" }),
  void: (id: string, b: { order_item_id: string; qty?: number; reason: string; approver_id?: string }) => post<OrderDetail>(`/orders/${id}/void`, b, { auth: "staff" }),
  complimentary: (itemId: string, b: { reason: string; approver_id?: string }) => post<OrderDetail>(`/order-items/${itemId}/complimentary`, b, { auth: "staff" }),

  kot: (id: string, status: "preparing" | "ready" | "served") => patch(`/kots/${id}`, { status }, { auth: "staff" }),
  kotItem: (id: string, status: "preparing" | "ready") => patch(`/kot-items/${id}`, { status }, { auth: "staff" }),
  reprintKot: (id: string) => post(`/kots/${id}/reprint`, {}, { auth: "staff" }),
};
