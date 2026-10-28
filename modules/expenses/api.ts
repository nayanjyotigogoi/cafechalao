import { del, post, put } from "@/shared/api/client";

/** Expenses and budget module (manual records). */
export const expensesApi = {
  create: (b: { category_id: string; amount: number; mode: string; spent_on?: string; note?: string; bill_photo_url?: string | null; petty_cash?: boolean }) => post("/expenses", b, { auth: "staff" }),
  remove: (id: string) => del(`/expenses/${id}`, { auth: "staff" }),
  setBudget: (b: { month: string; category_id: string; amount: number }) => put("/budgets", b, { auth: "staff" }),
  saveCategory: (b: { id?: string; name: string; monthly_budget?: number }) => (b.id ? put(`/expense-categories/${b.id}`, b, { auth: "staff" }) : post("/expense-categories", b, { auth: "staff" })),
};
