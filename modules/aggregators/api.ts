import { del, post, put } from "@/shared/api/client";

/** Swiggy/Zomato tracker module (manual entries). */
export const aggregatorsApi = {
  savePlatform: (id: string, b: { commission_pct: number; pg_fee_pct: number; tcs_pct: number; tds_pct: number }) => put(`/aggregators/platforms/${id}`, b, { auth: "staff" }),
  addEntry: (b: object) => post("/aggregators/entries", b, { auth: "staff" }),
  deleteEntry: (id: string) => del(`/aggregators/entries/${id}`, { auth: "staff" }),
  addPayout: (id: string, b: { amount: number; received_on: string; reference?: string }) => post(`/aggregators/entries/${id}/payouts`, b, { auth: "staff" }),
};
