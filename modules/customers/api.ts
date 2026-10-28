import { del, post, put } from "@/shared/api/client";
import type { Address, Customer } from "@/shared/types/entities";

/** Customers module: walk-in profiles (staff) and the customer's own profile, addresses and data rights. */
export const customersApi = {
  createWalkIn: (b: { name: string; phone: string; birthday?: string; anniversary?: string; marketing_consent?: boolean }) => post<Customer>("/customers", b, { auth: "staff" }),
  update: (id: string, b: Partial<Customer>) => put<Customer>(`/customers/${id}`, b, { auth: "staff" }),
  adjustPoints: (id: string, points: number, reason: string) => post(`/customers/${id}/points`, { points, reason }, { auth: "staff" }),

  updateMe: (b: Partial<Customer>) => put<{ customer: Customer; needs_profile: boolean }>("/me", b, { auth: "customer" }),
  addAddress: (b: Partial<Address>) => post<Address>("/me/addresses", b, { auth: "customer" }),
  deleteAddress: (id: string) => del(`/me/addresses/${id}`, { auth: "customer" }),
  deleteMe: () => del("/me", { auth: "customer" }),
};
