import { patch, post } from "@/shared/api/client";

/** Control Panel module (L1): cafés, licences, flags, tickets, releases, support login. */
export const controlApi = {
  updateTenant: (id: string, b: object) => patch(`/control/tenants/${id}`, b, { auth: "control" }),
  onboard: (b: object) => post<{ id: string; slug: string; owner_code: string; setup_url: string }>("/control/tenants", b, { auth: "control" }),
  supportLogin: (id: string) => post<{ token: string; slug: string }>(`/control/tenants/${id}/support-login`, {}, { auth: "control" }),
  ticket: (b: object) => post("/control/tickets", b, { auth: "control" }),
  updateTicket: (id: string, b: object) => patch(`/control/tickets/${id}`, b, { auth: "control" }),
  release: (b: { version: string; target: "all" | "pilot"; tenant_ids?: string[] }) => post<{ updated: number }>("/control/release", b, { auth: "control" }),
};
