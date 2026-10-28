import { post, put } from "@/shared/api/client";

/** Staff module: profiles, PIN, attendance, advances, salary. */
export const staffApi = {
  save: (b: { id?: string } & object) => (b.id ? put(`/staff/${b.id}`, b, { auth: "staff" }) : post("/staff", b, { auth: "staff" })),
  clock: (pin: string, selfie?: string | null) => post<{ action: "in" | "out"; name: string }>("/attendance/clock", { pin, selfie }),
  correct: (id: string, patch: object, reason: string) => post(`/attendance/${id}/correct`, { patch, reason }, { auth: "staff" }),
  advance: (b: { user_id: string; amount: number; note?: string }) => post("/advances", b, { auth: "staff" }),
  paySalary: (b: { month: string; user_id: string; deductions?: number; mode?: string }) => post("/salary-sheet/pay", b, { auth: "staff" }),
};
