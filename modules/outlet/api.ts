import { del, post, put } from "@/shared/api/client";

/** Outlet settings, roles, devices, support access (Core/Settings). */
export type Section = "outlet" | "brand" | "tax" | "flags" | "payment" | "delivery" | "loyalty";
export const outletApi = {
  saveSection: (section: Section, body: object) => put(`/settings/${section}`, body, { auth: "staff" }),
  setupStep: (step: number) => post("/setup/step", { step }, { auth: "staff" }),
  supportAccess: (hours: number) => post<{ support_access_until: string | null }>("/support-access", { hours }, { auth: "staff" }),
  saveRole: (id: string, permissions: string[]) => put(`/roles/${id}`, { permissions }, { auth: "staff" }),
  saveLimit: (id: string, body: object) => put(`/approval-limits/${id}`, body, { auth: "staff" }),
  savePrinter: (b: { id?: string } & object) => (b.id ? put(`/printers/${b.id}`, b, { auth: "staff" }) : post("/printers", b, { auth: "staff" })),
  deletePrinter: (id: string) => del(`/printers/${id}`, { auth: "staff" }),
  saveDevice: (b: { id?: string } & object) => (b.id ? put(`/devices/${b.id}`, b, { auth: "staff" }) : post("/devices", b, { auth: "staff" })),
  readNotification: (id: string) => post(`/notifications/${id}/read`, {}, { auth: "staff" }),
};
