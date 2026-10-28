import { del, post, put } from "@/shared/api/client";

/** Stock and purchase module: materials, suppliers, PR, quotations, PO, GRN, payments, wastage, counts, approvals. */
export const inventoryApi = {
  saveMaterial: (b: { id?: string } & object) => (b.id ? put(`/raw-materials/${b.id}`, b, { auth: "staff" }) : post("/raw-materials", b, { auth: "staff" })),
  deleteMaterial: (id: string) => del(`/raw-materials/${id}`, { auth: "staff" }),
  saveSupplier: (b: { id?: string } & object) => (b.id ? put(`/suppliers/${b.id}`, b, { auth: "staff" }) : post("/suppliers", b, { auth: "staff" })),
  wastage: (b: { raw_material_id?: string; item_id?: string; qty: number; unit: string; reason: string; note?: string }) => post("/wastage", b, { auth: "staff" }),
  stockCount: (lines: { raw_material_id: string; counted_qty: number }[], post_: boolean) => post("/stock-counts", { lines, post: post_ }, { auth: "staff" }),
  request: (lines: { raw_material_id: string; qty: number; note?: string }[]) => post("/purchase-requests", { lines }, { auth: "staff" }),
  quotation: (b: { supplier_id: string; purchase_request_id?: string; lines: { raw_material_id: string; rate: number }[] }) => post("/quotations", b, { auth: "staff" }),
  convert: (prId: string, choice: Record<string, { supplier_id: string; rate: number }>) => post(`/purchase-requests/${prId}/convert`, { choice }, { auth: "staff" }),
  createPO: (b: { supplier_id: string; lines: { raw_material_id: string; qty: number; rate: number }[] }) => post("/purchase-orders", b, { auth: "staff" }),
  autoPO: () => post<unknown[]>("/stock/auto-po", {}, { auth: "staff" }),
  sendPO: (id: string) => post<{ whatsapp_url: string }>(`/purchase-orders/${id}/send`, {}, { auth: "staff" }),
  grn: (b: { purchase_order_id: string; invoice_ref?: string; lines: { po_line_id: string; received_qty: number; rate?: number; batch?: string; expiry?: string }[] }) => post("/grns", b, { auth: "staff" }),
  paySupplier: (b: { supplier_id: string; amount: number; mode: string; reference?: string }) => post("/supplier-payments", b, { auth: "staff" }),
  decide: (id: string, decision: "approve" | "reject", note?: string) => post(`/approvals/${id}/decide`, { decision, note }, { auth: "staff" }),
};
