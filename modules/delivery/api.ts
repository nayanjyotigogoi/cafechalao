import { patch, post, put } from "@/shared/api/client";
import type { DeliveryRow } from "@/shared/types/api";

/** Delivery module: riders, assignment, rider app actions, settlement. */
export const deliveryApi = {
  saveRider: (b: { id?: string } & object) => (b.id ? put(`/riders/${b.id}`, b, { auth: "staff" }) : post("/riders", b, { auth: "staff" })),
  assign: (id: string, rider_ids: string[]) => post<DeliveryRow>(`/deliveries/${id}/assign`, { rider_ids }, { auth: "staff" }),
  staffStatus: (id: string, b: object) => patch<DeliveryRow>(`/deliveries/${id}/status`, b, { auth: "staff" }),
  settle: (rider_id: string) => post("/rider-settlements", { rider_id }, { auth: "staff" }),

  setOnline: (online: boolean) => patch("/rider/me", { online }, { auth: "rider" }),
  accept: (id: string) => post<DeliveryRow>(`/deliveries/${id}/accept`, {}, { auth: "rider" }),
  decline: (id: string) => post(`/deliveries/${id}/decline`, {}, { auth: "rider" }),
  status: (id: string, b: { status: string; proof?: "otp" | "photo"; otp?: string; photo?: string; collected_mode?: "cash" | "upi"; reason?: string }) =>
    patch<DeliveryRow>(`/deliveries/${id}/status`, b, { auth: "rider" }),
};
