import type * as E from "@/shared/types/entities";
import { audit, create, crud, find, forbidden, invalid, need, route, scoped, update, type Ctx } from "../core";
import { needsProfile } from "./auth";

/**
 * Customers belong to the café (L3 data is owned by L2). The same person ordering at two cafés
 * is two separate customer rows, one per tenant, and neither café can see the other's.
 */

const norm = (p: string) => p.replace(/\D/g, "").slice(-10);

export function customerSummary(ctx: Ctx, c: E.Customer) {
  const orders = scoped(ctx, "orders").filter((o) => o.customer_id === c.id && o.payment_status === "paid");
  const counts = new Map<string, number>();
  for (const it of scoped(ctx, "order_items").filter((i) => orders.some((o) => o.id === i.order_id))) counts.set(it.name, (counts.get(it.name) ?? 0) + it.qty);
  const favourites = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => ({ name, qty }));
  return { ...c, average_bill: orders.length ? Math.round(c.total_spend / Math.max(1, c.visits)) : 0, favourites };
}

route("GET", "/customers", (ctx) => {
  let rows = scoped(ctx, "customers");
  const q = ctx.query.q?.toLowerCase();
  if (q) rows = rows.filter((c) => `${c.name} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q));
  if (ctx.query.tag) rows = rows.filter((c) => c.tags.includes(ctx.query.tag as E.CustomerTag));
  const sorted = [...rows].sort((a, b) => (b.last_visit_at ?? "").localeCompare(a.last_visit_at ?? ""));
  return sorted.slice(0, Number(ctx.query.limit ?? 500));
}, { auth: "staff" });

route("GET", "/customers/:id", (ctx) => {
  if (!ctx.perms.includes("customers.view") && !ctx.perms.includes("customers.create")) throw forbidden();
  const c = find(ctx, "customers", ctx.params.id, "Customer");
  return {
    ...customerSummary(ctx, c),
    addresses: scoped(ctx, "addresses").filter((a) => a.customer_id === c.id),
    orders: scoped(ctx, "orders").filter((o) => o.customer_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30),
    loyalty: scoped(ctx, "loyalty_ledger").filter((l) => l.customer_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    memberships: scoped(ctx, "memberships").filter((m) => m.customer_id === c.id),
    gift_cards: scoped(ctx, "gift_cards").filter((g) => g.customer_id === c.id),
    feedback: scoped(ctx, "feedback").filter((f) => f.customer_id === c.id),
  };
});

/** Walk-in profile created by a captain or receptionist (M1.2). Same mobile → returns the existing profile. */
route("POST", "/customers", (ctx) => {
  need(ctx.body, ["name", "phone"]);
  if (norm(ctx.body.phone).length !== 10) throw invalid({ phone: "Enter a 10-digit mobile number" });
  const dup = scoped(ctx, "customers").find((c) => c.phone && norm(c.phone) === norm(ctx.body.phone));
  if (dup) return dup;
  return create(ctx, "customers", "cu", {
    name: ctx.body.name, phone: ctx.body.phone, phone_verified: false, email: null, google_id: null, birthday: ctx.body.birthday || null,
    anniversary: ctx.body.anniversary || null, gender: null, source: "walk_in", marketing_consent: !!ctx.body.marketing_consent, tags: ["new"],
    loyalty_points: 0, total_spend: 0, visits: 0, last_visit_at: null,
  });
}, { perm: "customers.create" });

route("PUT", "/customers/:id", (ctx) => {
  const c = find(ctx, "customers", ctx.params.id, "Customer");
  const allowed = ["name", "birthday", "anniversary", "tags", "marketing_consent", "email"];
  const patch = Object.fromEntries(Object.entries(ctx.body).filter(([k]) => allowed.includes(k)));
  audit(ctx, "update", "customer", c.id, null, patch);
  return update("customers", c.id, patch);
}, { perm: "customers.view" });

route("POST", "/customers/:id/points", (ctx) => {
  const c = find(ctx, "customers", ctx.params.id, "Customer");
  const pts = Math.round(Number(ctx.body.points));
  need(ctx.body, ["reason"]);
  create(ctx, "loyalty_ledger", "ll", { customer_id: c.id, order_id: null, points: pts, reason: "adjust", expires_at: null });
  audit(ctx, "points_adjust", "customer", c.id, { points: c.loyalty_points }, { points: c.loyalty_points + pts, reason: ctx.body.reason });
  return update("customers", c.id, { loyalty_points: Math.max(0, c.loyalty_points + pts) });
}, { perm: "marketing.manage" });

/* ---------- the customer's own profile ---------- */

route("GET", "/me", (ctx) => ({ customer: ctx.customer!, needs_profile: needsProfile(ctx.customer!) }), { auth: "customer" });

route("PUT", "/me", (ctx) => {
  const allowed = ["name", "birthday", "anniversary", "gender", "marketing_consent", "email"];
  const patch = Object.fromEntries(Object.entries(ctx.body).filter(([k]) => allowed.includes(k)));
  if ("marketing_consent" in patch && patch.marketing_consent !== ctx.customer!.marketing_consent) {
    create(ctx, "consent_logs", "cl", { customer_id: ctx.customer!.id, purpose: "marketing_whatsapp", granted: !!patch.marketing_consent });
  }
  const c = update("customers", ctx.customer!.id, patch) as E.Customer;
  return { customer: c, needs_profile: needsProfile(c) };
}, { auth: "customer" });

route("GET", "/me/addresses", (ctx) => scoped(ctx, "addresses").filter((a) => a.customer_id === ctx.customer!.id), { auth: "customer" });
route("POST", "/me/addresses", (ctx) => {
  need(ctx.body, ["line1", "city", "pincode"]);
  if (!/^\d{6}$/.test(String(ctx.body.pincode))) throw invalid({ pincode: "Pincode must be 6 digits" });
  return create(ctx, "addresses", "ad", { customer_id: ctx.customer!.id, label: ctx.body.label ?? "Home", line1: ctx.body.line1, line2: ctx.body.line2 ?? "", landmark: ctx.body.landmark ?? "", city: ctx.body.city, pincode: String(ctx.body.pincode) });
}, { auth: "customer" });
route("DELETE", "/me/addresses/:id", (ctx) => {
  const a = find(ctx, "addresses", ctx.params.id, "Address");
  if (a.customer_id !== ctx.customer!.id) throw forbidden();
  update("addresses", a.id, { deleted_at: ctx.now.toISOString() });
  return { deleted: true };
}, { auth: "customer" });

route("GET", "/me/wallet", (ctx) => {
  const c = ctx.customer!;
  const memberships = scoped(ctx, "memberships").filter((m) => m.customer_id === c.id).map((m) => ({ ...m, plan: scoped(ctx, "membership_plans").find((p) => p.id === m.plan_id) }));
  return {
    points: c.loyalty_points, loyalty: scoped(ctx, "loyalty_settings")[0], ledger: scoped(ctx, "loyalty_ledger").filter((l) => l.customer_id === c.id).slice(-20).reverse(),
    gift_cards: scoped(ctx, "gift_cards").filter((g) => g.customer_id === c.id), memberships,
    plans: scoped(ctx, "membership_plans").filter((p) => p.active),
  };
}, { auth: "customer" });

/** DPDP Act: the customer can export their data or ask for deletion (orders stay for tax records, anonymised). */
route("GET", "/me/export", (ctx) => {
  const c = ctx.customer!;
  return {
    profile: c, addresses: scoped(ctx, "addresses").filter((a) => a.customer_id === c.id),
    orders: scoped(ctx, "orders").filter((o) => o.customer_id === c.id), consents: scoped(ctx, "consent_logs").filter((x) => x.customer_id === c.id),
  };
}, { auth: "customer" });

route("DELETE", "/me", (ctx) => {
  const c = ctx.customer!;
  update("customers", c.id, { name: "Deleted customer", phone: null, email: null, google_id: null, birthday: null, anniversary: null, marketing_consent: false, deleted_at: ctx.now.toISOString() });
  for (const a of scoped(ctx, "addresses").filter((a) => a.customer_id === c.id)) update("addresses", a.id, { deleted_at: ctx.now.toISOString() });
  audit(ctx, "delete", "customer", c.id, { name: c.name }, { anonymised: true });
  return { deleted: true };
}, { auth: "customer" });

crud("/customer-addresses", "addresses", "ad", { perm: "customers.view" });
