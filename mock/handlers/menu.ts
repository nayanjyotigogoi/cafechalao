import type { Item, RecipeLine } from "@/shared/types/entities";
import { convert } from "@/shared/lib/units";
import { audit, create, crud, find, forbidden, HttpError, invalid, need, route, scoped, update, type Ctx } from "../core";

/** Menu (M1.3, M2.2.1): categories, items, variants, add-ons, time slots, daily availability, recipes. */

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export function recipeCost(ctx: Ctx, itemId: string, variantId: string | null = null) {
  const rec = scoped(ctx, "recipes").find((r) => r.item_id === itemId && r.variant_id === variantId) ?? scoped(ctx, "recipes").find((r) => r.item_id === itemId && !r.variant_id);
  if (!rec) return 0;
  return scoped(ctx, "recipe_lines")
    .filter((l) => l.recipe_id === rec.id)
    .reduce((s, l) => {
      const m = ctx.t.raw_materials.find((x) => x.id === l.raw_material_id);
      return m ? s + convert(l.qty, l.unit, m.unit) * m.avg_cost : s;
    }, 0);
}

export function menuPayload(ctx: Ctx, staff = false) {
  const now = hhmm(ctx.now);
  const slots = scoped(ctx, "availability_slots");
  const groups = scoped(ctx, "add_on_groups");
  const addOns = scoped(ctx, "add_ons");
  const variants = scoped(ctx, "variants");
  const categories = scoped(ctx, "categories").filter((c) => staff || c.active).sort((a, b) => a.sort - b.sort);
  const items = scoped(ctx, "items")
    .filter((i) => categories.some((c) => c.id === i.category_id))
    .sort((a, b) => a.sort - b.sort)
    .map((i) => {
      const slot = slots.find((s) => s.id === i.availability_slot_id) ?? null;
      const inSlot = !slot || (now >= slot.start_time && now <= slot.end_time);
      return {
        ...i,
        gst_rate: i.gst_rate ?? scoped(ctx, "tax_settings")[0].default_gst_rate,
        variants: variants.filter((v) => v.item_id === i.id),
        add_on_groups: groups.filter((g) => i.add_on_group_ids.includes(g.id)).map((g) => ({ ...g, add_ons: addOns.filter((a) => a.group_id === g.id) })),
        slot,
        available_now: i.in_stock && i.available_today && inSlot,
        ...(staff ? { recipe_cost: Math.round(recipeCost(ctx, i.id)) } : {}),
      };
    });
  return { categories, items, slots };
}

route("GET", "/menu", (ctx) => menuPayload(ctx, false), { auth: "public" });
route("GET", "/menu/manage", (ctx) => menuPayload(ctx, true), { perm: "menu.edit" });

crud("/categories", "categories", "ct", { perm: "menu.edit", required: ["name"], defaults: { active: true, sort: 99, station: "kitchen", name_hi: null }, auditAs: "category" });
crud("/availability-slots", "availability_slots", "as", { perm: "menu.edit", required: ["name", "start_time", "end_time"] });
crud("/add-on-groups", "add_on_groups", "ag", { perm: "menu.edit", required: ["name"], defaults: { min_select: 0, max_select: 1 } });
crud("/add-ons", "add_ons", "ao", { perm: "menu.edit", required: ["group_id", "name"], defaults: { price: 0, food_type: "veg" } });

function validateItem(body: Partial<Item>) {
  const e: Record<string, string> = {};
  if (!body.name?.trim()) e.name = "Name is required";
  if (!body.category_id) e.category_id = "Pick a category";
  if (body.price == null || body.price < 0) e.price = "Price must be 0 or more";
  if (body.food_type && !["veg", "non_veg", "egg"].includes(body.food_type)) e.food_type = "Veg, non-veg or egg";
  return e;
}

function saveVariants(ctx: Ctx, itemId: string, list?: { id?: string; name: string; price: number; is_default?: boolean }[]) {
  if (!list) return;
  const existing = scoped(ctx, "variants").filter((v) => v.item_id === itemId);
  for (const v of existing) if (!list.some((x) => x.id === v.id)) update("variants", v.id, { deleted_at: ctx.now.toISOString() });
  list.forEach((v, i) => {
    if (v.id && existing.some((x) => x.id === v.id)) update("variants", v.id, { name: v.name, price: v.price, is_default: v.is_default ?? i === 0 });
    else create(ctx, "variants", "va", { item_id: itemId, name: v.name, price: v.price, is_default: v.is_default ?? i === 0 });
  });
}

route("POST", "/items", (ctx) => {
  const e = validateItem(ctx.body);
  if (Object.keys(e).length) throw invalid(e);
  const { variants, ...data } = ctx.body;
  const code = data.code || String(scoped(ctx, "items").length + 100);
  if (scoped(ctx, "items").some((i) => i.code === code)) throw invalid({ code: "This item code is already used" });
  const item = create(ctx, "items", "it", {
    description: "", food_type: "veg", gst_rate: null, photo_url: null, bestseller: false, in_stock: true, available_today: true, prep_minutes: 8,
    availability_slot_id: null, add_on_group_ids: [], sort: 99, name_hi: null, ...data, code,
  }) as Item;
  saveVariants(ctx, item.id, variants);
  audit(ctx, "create", "item", item.id, null, data);
  return item;
}, { perm: "menu.edit" });

route("PUT", "/items/:id", (ctx) => {
  const old = find(ctx, "items", ctx.params.id, "Item");
  const { variants, id: _i, tenant_id: _t, ...patch } = ctx.body;
  const e = validateItem({ ...old, ...patch });
  if (Object.keys(e).length) throw invalid(e);
  if (patch.price != null && patch.price !== old.price) {
    if (!ctx.perms.includes("menu.price")) throw forbidden("Only the owner can change prices");
    // Old bills keep their old price: order items store a snapshot.
    audit(ctx, "price_change", "item", old.id, { price: old.price }, { price: patch.price });
  }
  const item = update("items", old.id, patch);
  saveVariants(ctx, old.id, variants);
  return item;
}, { perm: "menu.edit" });

route("DELETE", "/items/:id", (ctx) => {
  const old = find(ctx, "items", ctx.params.id, "Item");
  update("items", old.id, { deleted_at: ctx.now.toISOString() });
  audit(ctx, "delete", "item", old.id, old, null);
  return { deleted: true };
}, { perm: "menu.edit" });

/** Daily availability and out-of-stock toggles; kitchen can flip these from the KDS. */
route("PATCH", "/items/:id/availability", (ctx) => {
  if (!ctx.perms.includes("menu.edit") && !ctx.perms.includes("kds.use")) throw forbidden();
  const old = find(ctx, "items", ctx.params.id, "Item");
  const patch: Partial<Item> = {};
  if (typeof ctx.body.in_stock === "boolean") patch.in_stock = ctx.body.in_stock;
  if (typeof ctx.body.available_today === "boolean") patch.available_today = ctx.body.available_today;
  return update("items", old.id, patch);
});

/** Reset "available today" for every item at the start of a day. */
route("POST", "/items/availability/reset", (ctx) => {
  for (const i of scoped(ctx, "items")) if (!i.available_today) update("items", i.id, { available_today: true });
  return { ok: true };
}, { perm: "menu.edit" });

/** Excel/CSV import: every row is validated; nothing is saved unless all rows pass (SRS 16.5). */
route("POST", "/menu/import", (ctx) => {
  need(ctx.body, ["rows"]);
  const rows = ctx.body.rows as Record<string, string>[];
  const cats = scoped(ctx, "categories");
  const errors: Record<string, string> = {};
  rows.forEach((r, i) => {
    const line = i + 2;
    if (!r.name?.trim()) errors[`row_${line}`] = `Row ${line}: name is empty`;
    else if (!r.category?.trim()) errors[`row_${line}`] = `Row ${line}: category is empty`;
    else if (isNaN(Number(r.price)) || Number(r.price) < 0) errors[`row_${line}`] = `Row ${line}: price "${r.price}" is not a number`;
    else if (r.type && !["veg", "non_veg", "non-veg", "egg"].includes(r.type.toLowerCase())) errors[`row_${line}`] = `Row ${line}: type must be veg, non-veg or egg`;
  });
  if (Object.keys(errors).length) throw new HttpError(422, `${Object.keys(errors).length} row(s) have problems. Nothing was imported.`, "validation", errors);
  let created = 0;
  for (const r of rows) {
    let cat = cats.find((c) => c.name.toLowerCase() === r.category.trim().toLowerCase());
    if (!cat) {
      cat = create(ctx, "categories", "ct", { name: r.category.trim(), name_hi: null, sort: 99, station: "kitchen", active: true }) as typeof cats[number];
      cats.push(cat);
    }
    create(ctx, "items", "it", {
      category_id: cat.id, code: r.code || String(scoped(ctx, "items").length + 100), name: r.name.trim(), name_hi: null, description: r.description ?? "",
      food_type: (r.type ?? "veg").toLowerCase().replace("-", "_"), price: Math.round(Number(r.price) * 100), gst_rate: null, photo_url: null, bestseller: false,
      in_stock: true, available_today: true, prep_minutes: 8, availability_slot_id: null, add_on_group_ids: [], sort: 99,
    });
    created++;
  }
  return { created };
}, { perm: "menu.edit" });

/* Recipes (M5.2) */
route("GET", "/items/:id/recipe", (ctx) => {
  const item = find(ctx, "items", ctx.params.id, "Item");
  const rec = scoped(ctx, "recipes").find((r) => r.item_id === item.id && !r.variant_id);
  const lines = rec ? scoped(ctx, "recipe_lines").filter((l) => l.recipe_id === rec.id) : [];
  return { item_id: item.id, lines, cost: Math.round(recipeCost(ctx, item.id)) };
}, { perm: "stock.view" });

route("PUT", "/items/:id/recipe", (ctx) => {
  const item = find(ctx, "items", ctx.params.id, "Item");
  let rec = scoped(ctx, "recipes").find((r) => r.item_id === item.id && !r.variant_id);
  if (!rec) rec = create(ctx, "recipes", "rc", { item_id: item.id, variant_id: null }) as typeof rec & object;
  for (const l of scoped(ctx, "recipe_lines").filter((l) => l.recipe_id === rec!.id)) update("recipe_lines", l.id, { deleted_at: ctx.now.toISOString() });
  for (const l of (ctx.body.lines ?? []) as Pick<RecipeLine, "raw_material_id" | "qty" | "unit">[]) {
    const m = find(ctx, "raw_materials", l.raw_material_id, "Ingredient");
    convert(1, l.unit, m.unit); // throws for kg → pcs
    create(ctx, "recipe_lines", "rcl", { recipe_id: rec!.id, raw_material_id: l.raw_material_id, qty: Number(l.qty), unit: l.unit });
  }
  return { ok: true, cost: Math.round(recipeCost(ctx, item.id)) };
}, { perm: "menu.edit" });
