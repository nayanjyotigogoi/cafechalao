import type * as E from "@/shared/types/entities";
import { businessTypeDefaults } from "@/shared/lib/features";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_LABEL } from "@/shared/lib/permissions";
import { HttpError, insert, invalid, need, newId, route, update } from "../core";
import { issue } from "./auth";

/**
 * Control Panel (L1, SRS 11): CafeChalao's own super-admin. Sees licence, version and health of every café,
 * never their customer or sales data, except through a time-limited support access the owner grants.
 */

route("GET", "/control/overview", (ctx) => {
  const t = ctx.t;
  const today = ctx.now.toISOString().slice(0, 10);
  return {
    cafes: t.tenants.length,
    active: t.tenants.filter((x) => x.status === "active").length,
    trial: t.tenants.filter((x) => x.status === "trial").length,
    suspended: t.tenants.filter((x) => x.status === "suspended").length,
    new_this_month: t.tenants.filter((x) => x.created_at.slice(0, 7) === today.slice(0, 7)).length,
    // Aggregate platform volume only (a count, no order contents).
    orders_today: t.orders.filter((o) => o.created_at.slice(0, 10) === today).length,
    uptime: 99.9,
    open_tickets: t.support_tickets.filter((s) => s.status !== "closed").length,
    versions: Object.entries(t.tenants.reduce((m, x) => ({ ...m, [x.version]: (m[x.version] ?? 0) + 1 }), {} as Record<string, number>)).map(([version, count]) => ({ version, count })),
    latest_version: "1.4.2",
  };
}, { auth: "control", tenantless: true });

route("GET", "/control/tenants", (ctx) => ctx.t.tenants.map((x) => ({
  ...x,
  setup_step: ctx.t.outlets.find((o) => o.tenant_id === x.id)?.setup_step ?? 0,
  features: ctx.t.business_type_flags.find((f) => f.tenant_id === x.id)?.features ?? null,
  open_tickets: ctx.t.support_tickets.filter((s) => s.tenant_id === x.id && s.status !== "closed").length,
})), { auth: "control", tenantless: true });

route("PATCH", "/control/tenants/:id", (ctx) => {
  const ten = ctx.t.tenants.find((x) => x.id === ctx.params.id);
  if (!ten) throw new HttpError(404, "Café not found");
  const allowed = ["status", "support_expiry", "version", "domains", "hosting"];
  const patch = Object.fromEntries(Object.entries(ctx.body).filter(([k]) => allowed.includes(k)));
  const next = update("tenants", ten.id, patch);
  if (ctx.body.features) {
    const flags = ctx.t.business_type_flags.find((f) => f.tenant_id === ten.id);
    if (flags) update("business_type_flags", flags.id, { features: { ...flags.features, ...ctx.body.features } });
  }
  insert("audit_logs", { id: newId("au"), tenant_id: ten.id, created_at: ctx.now.toISOString(), updated_at: ctx.now.toISOString(), created_by: null, deleted_at: null, user_id: null, user_name: `CafeChalao · ${ctx.admin!.name}`, action: "control_change", entity: "tenant", entity_id: ten.id, device: "Control Panel", old_value: null, new_value: ctx.body });
  return next;
}, { auth: "control", tenantless: true });

/** Onboard a new café: tenant + outlet + default settings; the owner then runs the setup wizard. */
route("POST", "/control/tenants", (ctx) => {
  need(ctx.body, ["name", "slug", "owner_name", "owner_phone", "owner_email", "city", "business_type"]);
  const slug = String(ctx.body.slug).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (ctx.t.tenants.some((x) => x.slug === slug)) throw invalid({ slug: "This web address is taken" });
  const now = ctx.now.toISOString();
  const id = `tn_${slug.replace(/-/g, "_")}`;
  const base = (p: string) => ({ id: newId(p), tenant_id: id, created_at: now, updated_at: now, created_by: null, deleted_at: null });
  const type = ctx.body.business_type as E.BusinessType;
  insert("tenants", {
    id, slug, domains: [`${slug}.localhost`, ...(ctx.body.domain ? [ctx.body.domain] : [])], name: ctx.body.name, owner_name: ctx.body.owner_name, owner_phone: ctx.body.owner_phone,
    owner_email: ctx.body.owner_email, city: ctx.body.city, business_type: type, hosting: ctx.body.hosting ?? "shared",
    licence_key: `CC-P1-${slug.toUpperCase().slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
    plan: "phase1", purchase_date: now, support_expiry: new Date(ctx.now.getTime() + 90 * 86400000).toISOString(), status: "trial", version: "1.4.2",
    last_backup_at: now, uptime_pct: 100, go_live_date: null, support_access_until: null, created_at: now,
  });
  insert("outlets", { ...base("ot"), name: ctx.body.name, legal_name: ctx.body.name, business_type: type, address: "", city: ctx.body.city, phone: ctx.body.owner_phone, email: ctx.body.owner_email, opening_time: "09:00", closing_time: "22:00", tagline: "", setup_step: 0 });
  insert("brand_settings", { ...base("bs"), app_name: ctx.body.name, short_name: ctx.body.name.split(" ")[0], logo_url: null, primary_color: "#5E6B33", accent_color: "#F9D1D9", hero_title: `Welcome to ${ctx.body.name}`, hero_subtitle: "Order online or scan the QR at your table." });
  insert("tax_settings", { ...base("tx"), gstin: null, gst_scheme: "regular", default_gst_rate: 5, fssai_number: "", invoice_prefix: invoicePrefix(String(ctx.body.name), slug), hsn_sac: "9963", place_of_supply: "", service_charge_enabled: false, service_charge_pct: 5, round_off: true });
  insert("business_type_flags", { ...base("bf"), features: businessTypeDefaults(type), qr_order_flow: "direct_to_kitchen", auto_accept_online: true, kds_amber_min: 10, kds_red_min: 15, language: "en" });
  insert("payment_settings", { ...base("ps"), modes: { cash: true, upi: true, card: true, online: true, cod: true, upi_on_delivery: true }, gateway: "dummy", gateway_key_id: "dummy_key_test", gateway_configured: true, upi_id: "" });
  insert("delivery_settings", { ...base("ds"), enabled: type !== "restaurant", mode: "own", charge_type: "flat", flat_charge: 3000, slabs: [], min_order: 9900, allow_prepaid: true, allow_cod: true, allow_upi_on_delivery: true });
  insert("loyalty_settings", { ...base("ls"), enabled: true, earn_per_rupees: 10, point_value: 25, min_bill_to_redeem: 20000, expiry_days: 365 });
  for (const key of Object.keys(DEFAULT_ROLE_PERMISSIONS) as E.RoleKey[]) insert("roles", { ...base("rl"), key, name: ROLE_LABEL[key], permissions: [...DEFAULT_ROLE_PERMISSIONS[key]] });
  insert("approval_limits", { ...base("al"), role: "owner", discount_pct: 100, void_value: 1e9, refund_value: 1e9, expense_value: 1e9, po_value: 1e9 });
  insert("approval_limits", { ...base("al"), role: "manager", discount_pct: 20, void_value: 200000, refund_value: 200000, expense_value: 500000, po_value: 2500000 });
  insert("approval_limits", { ...base("al"), role: "cashier", discount_pct: 5, void_value: 0, refund_value: 0, expense_value: 50000, po_value: 0 });
  insert("users", { ...base("us"), employee_code: "E001", name: ctx.body.owner_name, role: "owner", phone: ctx.body.owner_phone, email: ctx.body.owner_email, pin_hash: "", active: true, avatar_color: "#5E6B33" });
  insert("aggregator_platforms", { ...base("ag"), name: "Swiggy", commission_pct: 22, pg_fee_pct: 1.84, tcs_pct: 1, tds_pct: 0.1 });
  insert("aggregator_platforms", { ...base("ag"), name: "Zomato", commission_pct: 20, pg_fee_pct: 1.84, tcs_pct: 1, tds_pct: 0.1 });
  for (const n of ["Rent", "Electricity", "Gas", "Salary", "Marketing", "Repairs", "Misc"]) insert("expense_categories", { ...base("ec"), name: n, monthly_budget: 0 });
  return { id, slug, owner_code: "E001", setup_url: `/admin/setup?outlet=${slug}` };
}, { auth: "control", tenantless: true });

/** "Log in as café (support)": only while the owner's support access is valid; written to the café's audit log. */
route("POST", "/control/tenants/:id/support-login", (ctx) => {
  const ten = ctx.t.tenants.find((x) => x.id === ctx.params.id);
  if (!ten) throw new HttpError(404, "Café not found");
  if (!ten.support_access_until || ten.support_access_until < ctx.now.toISOString()) throw new HttpError(403, "The owner hasn't granted support access. Ask them to allow it in Settings → Support access.", "no_support_access");
  const owner = ctx.t.users.find((u) => u.tenant_id === ten.id && u.role === "owner" && u.active);
  if (!owner) throw new HttpError(404, "No owner user");
  insert("audit_logs", { id: newId("au"), tenant_id: ten.id, created_at: ctx.now.toISOString(), updated_at: ctx.now.toISOString(), created_by: null, deleted_at: null, user_id: null, user_name: `CafeChalao support · ${ctx.admin!.name}`, action: "support_access", entity: "tenant", entity_id: ten.id, device: "Control Panel", old_value: null, new_value: { until: ten.support_access_until } });
  const c = { ...ctx, tenant: ten };
  return { token: issue(c, "staff", owner.id), slug: ten.slug };
}, { auth: "control", tenantless: true });

route("GET", "/control/tickets", (ctx) => [...ctx.t.support_tickets].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((s) => ({ ...s, cafe: ctx.t.tenants.find((x) => x.id === s.tenant_id)?.name })), { auth: "control", tenantless: true });
route("POST", "/control/tickets", (ctx) => {
  need(ctx.body, ["tenant_id", "subject", "kind"]);
  const row = { id: newId("tk"), tenant_id: ctx.body.tenant_id, subject: ctx.body.subject, kind: ctx.body.kind, quote: ctx.body.quote ?? null, billing_status: ctx.body.quote ? "quoted" : "none", status: "open", created_at: ctx.now.toISOString() } as E.SupportTicket;
  insert("support_tickets", row);
  return row;
}, { auth: "control", tenantless: true });
route("PATCH", "/control/tickets/:id", (ctx) => {
  const allowed = ["status", "quote", "billing_status"];
  return update("support_tickets", ctx.params.id, Object.fromEntries(Object.entries(ctx.body).filter(([k]) => allowed.includes(k))));
}, { auth: "control", tenantless: true });

/** Release: one deployment updates every shared café; flags roll risky features out to a pilot group first. */
route("POST", "/control/release", (ctx) => {
  need(ctx.body, ["version", "target"]);
  const targets = ctx.body.target === "all" ? ctx.t.tenants : ctx.t.tenants.filter((x) => (ctx.body.tenant_ids as string[]).includes(x.id));
  for (const x of targets) update("tenants", x.id, { version: ctx.body.version, last_backup_at: ctx.now.toISOString() });
  return { updated: targets.length, backup_taken: true };
}, { auth: "control", tenantless: true });

route("GET", "/control/admins", (ctx) => ctx.t.platform_admins, { auth: "control", tenantless: true });

/** Public café directory for the marketing site and dev switcher: name and brand only. */
route("GET", "/public/cafes", (ctx) => ctx.t.tenants.filter((x) => x.status !== "suspended").map((x) => {
  const b = ctx.t.brand_settings.find((s) => s.tenant_id === x.id);
  return { slug: x.slug, name: x.name, city: x.city, business_type: x.business_type, primary_color: b?.primary_color, accent_color: b?.accent_color };
}), { auth: "public", tenantless: true });

/** Same rule as the API: "Café 1BHK" → "1BHK/", "Chai Adda" → "CA/". */
export function invoicePrefix(name: string, slug = "") {
  const skip = ["cafe", "café", "the", "and", "restaurant", "kitchen"];
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !skip.includes(w.toLowerCase()));
  const ascii = (w: string) => w.normalize("NFD").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const p = words.length === 1 ? ascii(words[0]).slice(0, 6) : words.slice(0, 4).map((w) => ascii(w).slice(0, 1)).join("");
  return `${p || slug.replace(/-/g, "").slice(0, 4).toUpperCase()}/`;
}
