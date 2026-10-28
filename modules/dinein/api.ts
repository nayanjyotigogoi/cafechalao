import { patch, post, put } from "@/shared/api/client";
import type { Reservation } from "@/shared/types/entities";

/** Dine-in module: tables, merge/move, reservations, waitlist. */
export const dineinApi = {
  tableStatus: (id: string, status: string) => patch(`/tables/${id}/status`, { status }, { auth: "staff" }),
  attachCustomer: (tableId: string, customer_id: string) => post(`/tables/${tableId}/customer`, { customer_id }, { auth: "staff" }),
  move: (from_table_id: string, to_table_id: string) => post("/tables/move", { from_table_id, to_table_id }, { auth: "staff" }),
  merge: (into_id: string, table_ids: string[]) => post("/tables/merge", { into_id, table_ids }, { auth: "staff" }),
  split: (id: string) => post(`/tables/${id}/split`, {}, { auth: "staff" }),
  ackCall: (id: string) => post(`/tables/${id}/ack-call`, {}, { auth: "staff" }),
  saveArea: (b: { id?: string; name: string; sort?: number }) => (b.id ? put(`/areas/${b.id}`, b, { auth: "staff" }) : post("/areas", b, { auth: "staff" })),
  saveTable: (b: { id?: string } & object) => (b.id ? put(`/tables/${b.id}`, b, { auth: "staff" }) : post("/tables", b, { auth: "staff" })),
  bulkTables: (b: { area_id: string; count: number; seats: number; prefix?: string }) => post("/tables/bulk", b, { auth: "staff" }),

  reserve: (b: Partial<Reservation>, asCustomer = false) =>
    post<{ reservation: Reservation; whatsapp_url: string }>(asCustomer ? "/public/reservations" : "/reservations", b, { auth: asCustomer ? "customer" : "staff" }),
  updateReservation: (id: string, b: Partial<Reservation>) => patch<{ reservation: Reservation; whatsapp_url: string | null }>(`/reservations/${id}`, b, { auth: "staff" }),
  addWaitlist: (b: { name: string; phone: string; party_size: number; quoted_wait_min?: number }) => post("/waitlist", b, { auth: "staff" }),
  notifyWaitlist: (id: string) => post<{ whatsapp_url: string }>(`/waitlist/${id}/notify`, {}, { auth: "staff" }),
  seatWaitlist: (id: string, table_id: string) => post(`/waitlist/${id}/seat`, { table_id }, { auth: "staff" }),
  leftWaitlist: (id: string) => post(`/waitlist/${id}/left`, {}, { auth: "staff" }),
};
