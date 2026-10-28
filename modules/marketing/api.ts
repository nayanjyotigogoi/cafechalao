import { del, patch, post, put } from "@/shared/api/client";
import type { GiftCard } from "@/shared/types/entities";

/** Marketing module: coupons, gift cards, memberships, offers, loyalty, greetings, feedback. */
const save = (path: string) => (b: { id?: string } & object) => (b.id ? put(`${path}/${b.id}`, b, { auth: "staff" }) : post(path, b, { auth: "staff" }));
const remove = (path: string) => (id: string) => del(`${path}/${id}`, { auth: "staff" });

export const marketingApi = {
  saveCoupon: save("/coupons"),
  deleteCoupon: remove("/coupons"),
  savePlan: save("/membership-plans"),
  saveOffer: save("/offers"),
  deleteOffer: remove("/offers"),
  sellGiftCard: (b: { value: number; customer_id?: string | null; expires_on?: string }) => post<GiftCard>("/gift-cards", b, { auth: "staff" }),
  toggleGiftCard: (id: string, active: boolean) => put(`/gift-cards/${id}`, { active }, { auth: "staff" }),
  sellMembership: (customer_id: string, plan_id: string) => post("/memberships", { customer_id, plan_id }, { auth: "staff" }),
  logGreeting: (b: { customer_id: string; kind: string; body: string; channel: "whatsapp_link" | "email" }) => post("/greetings/log", b, { auth: "staff" }),
  feedbackReplied: (id: string, replied: boolean) => patch(`/feedback/${id}`, { replied }, { auth: "staff" }),
};
