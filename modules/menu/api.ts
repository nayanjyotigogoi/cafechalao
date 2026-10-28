import { del, patch, post, put } from "@/shared/api/client";
import type { Item } from "@/shared/types/entities";

/** Menu module: items, variants, categories, availability, import, recipes. */
export type ItemBody = Partial<Item> & { variants?: { id?: string; name: string; price: number; is_default?: boolean }[] };

export const menuApi = {
  saveItem: (b: ItemBody) => (b.id ? put<Item>(`/items/${b.id}`, b, { auth: "staff" }) : post<Item>("/items", b, { auth: "staff" })),
  deleteItem: (id: string) => del(`/items/${id}`, { auth: "staff" }),
  availability: (id: string, b: { in_stock?: boolean; available_today?: boolean }) => patch(`/items/${id}/availability`, b, { auth: "staff" }),
  resetAvailability: () => post("/items/availability/reset", {}, { auth: "staff" }),
  saveCategory: (b: { id?: string } & object) => (b.id ? put(`/categories/${b.id}`, b, { auth: "staff" }) : post("/categories", b, { auth: "staff" })),
  deleteCategory: (id: string) => del(`/categories/${id}`, { auth: "staff" }),
  saveGroup: (b: { id?: string } & object) => (b.id ? put<{ id: string }>(`/add-on-groups/${b.id}`, b, { auth: "staff" }) : post<{ id: string }>("/add-on-groups", b, { auth: "staff" })),
  saveAddOn: (b: { id?: string } & object) => (b.id ? put(`/add-ons/${b.id}`, b, { auth: "staff" }) : post("/add-ons", b, { auth: "staff" })),
  deleteAddOn: (id: string) => del(`/add-ons/${id}`, { auth: "staff" }),
  saveSlot: (b: { id?: string } & object) => (b.id ? put(`/availability-slots/${b.id}`, b, { auth: "staff" }) : post("/availability-slots", b, { auth: "staff" })),
  import: (rows: Record<string, string>[]) => post<{ created: number }>("/menu/import", { rows }, { auth: "staff" }),
  saveRecipe: (itemId: string, lines: { raw_material_id: string; qty: number; unit: string }[]) => put<{ cost: number }>(`/items/${itemId}/recipe`, { lines }, { auth: "staff" }),
};
