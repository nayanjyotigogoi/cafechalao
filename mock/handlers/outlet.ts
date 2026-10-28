import { audit, crud, find, forbidden, need, route, scoped, settingsOf, update } from "../core";
import { ALL_PERMISSIONS } from "@/shared/lib/permissions";
import { businessTypeDefaults } from "@/shared/lib/features";

/** Outlet settings (Core/Settings): one /settings call feeds the theme, flags and rules for every surface. */

route("GET", "/settings", (ctx) => {
  const pay = settingsOf(ctx, "payment_settings");
  return {
    tenant: { id: ctx.tenant.id, slug: ctx.tenant.slug, status: ctx.tenant.status, version: ctx.tenant.version, support_access_until: ctx.tenant.support_access_until },
    outlet: settingsOf(ctx, "outlets"),
    brand: settingsOf(ctx, "brand_settings"),
    tax: settingsOf(ctx, "tax_settings"),
    flags: settingsOf(ctx, "business_type_flags"),
    payment: { ...pay, gateway_key_id: pay.gateway_key_id }, // secrets never leave the server
    delivery: settingsOf(ctx, "delivery_settings"),
    loyalty: settingsOf(ctx, "loyalty_settings"),
    powered_by: { text: "Powered by CafeChalao", url: "https://cafechalao.in", locked: true },
  };
}, { auth: "public" });

const SECTIONS = {
  outlet: "outlets",
  brand: "brand_settings",
  tax: "tax_settings",
  flags: "business_type_flags",
  payment: "payment_settings",
  delivery: "delivery_settings",
  loyalty: "loyalty_settings",
} as const;

route("PUT", "/settings/:section", (ctx) => {
  const table = SECTIONS[ctx.params.section as keyof typeof SECTIONS];
  if (!table) throw forbidden("Unknown settings section");
  const row = settingsOf(ctx, table);
  const { id: _i, tenant_id: _t, ...patch } = ctx.body ?? {};
  // Gateway secret is write-only: stored encrypted in Laravel, never returned.
  if (table === "payment_settings" && "gateway_secret" in patch) {
    delete patch.gateway_secret;
    patch.gateway_configured = true;
  }
  if (table === "outlets" && patch.business_type && patch.business_type !== (row as { business_type?: string }).business_type && patch.apply_defaults) {
    update("business_type_flags", settingsOf(ctx, "business_type_flags").id, { features: businessTypeDefaults(patch.business_type) });
  }
  delete patch.apply_defaults;
  const next = update(table, row.id, patch);
  audit(ctx, "setting_change", table, row.id, row, patch);
  return next;
}, { perm: "settings.manage" });

route("POST", "/setup/step", (ctx) => {
  need(ctx.body, ["step"]);
  const o = settingsOf(ctx, "outlets");
  return update("outlets", o.id, { setup_step: Math.max(o.setup_step, Number(ctx.body.step)) });
}, { perm: "settings.manage" });

/** Owner grants CafeChalao support time-limited access (SRS 11). */
route("POST", "/support-access", (ctx) => {
  const hours = Number(ctx.body?.hours ?? 0);
  const until = hours > 0 ? new Date(ctx.now.getTime() + hours * 3600000).toISOString() : null;
  update("tenants", ctx.tenant.id, { support_access_until: until });
  audit(ctx, "support_access", "tenant", ctx.tenant.id, null, { until });
  return { support_access_until: until };
}, { perm: "settings.manage" });

/* Roles grid and approval limits */
route("GET", "/roles", (ctx) => ({ roles: scoped(ctx, "roles"), all_permissions: ALL_PERMISSIONS, limits: scoped(ctx, "approval_limits") }), { perm: "settings.manage" });
route("PUT", "/roles/:id", (ctx) => {
  const r = find(ctx, "roles", ctx.params.id);
  if (r.key === "owner") throw forbidden("The owner always has every permission");
  const perms = (ctx.body.permissions as string[]).filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
  audit(ctx, "setting_change", "role", r.id, r.permissions, perms);
  return update("roles", r.id, { permissions: perms });
}, { perm: "settings.manage" });
route("PUT", "/approval-limits/:id", (ctx) => {
  const l = find(ctx, "approval_limits", ctx.params.id);
  const { id: _i, tenant_id: _t, role: _r, ...patch } = ctx.body;
  audit(ctx, "setting_change", "approval_limit", l.id, l, patch);
  return update("approval_limits", l.id, patch);
}, { perm: "settings.manage" });

crud("/printers", "printers", "pr", { perm: "settings.manage", required: ["name", "station"] });
crud("/devices", "devices", "dv", { perm: "settings.manage", required: ["name", "kind"] });

/* Notifications and audit */
route("GET", "/notifications", (ctx) => {
  const role = ctx.user!.role;
  return scoped(ctx, "notifications")
    .filter((n) => (n.user_id ? n.user_id === ctx.user!.id : n.audience === role || (n.audience === "owner" && role === "manager")))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 40);
});
route("POST", "/notifications/:id/read", (ctx) => update("notifications", find(ctx, "notifications", ctx.params.id).id, { read: true }));

route("GET", "/audit-logs", (ctx) => {
  let rows = scoped(ctx, "audit_logs");
  if (ctx.query.action) rows = rows.filter((r) => r.action === ctx.query.action);
  if (ctx.query.from) rows = rows.filter((r) => r.created_at.slice(0, 10) >= ctx.query.from);
  if (ctx.query.to) rows = rows.filter((r) => r.created_at.slice(0, 10) <= ctx.query.to);
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 500);
}, { perm: "audit.view" });
