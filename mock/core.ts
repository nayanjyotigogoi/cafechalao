import type * as E from "@/shared/types/entities";
import type { Permission } from "@/shared/lib/permissions";
import { ROLE_RANK } from "@/shared/lib/permissions";
import { db, insert, update } from "./db";
import type { TableName, Tables } from "./tables";

/**
 * Router and helpers for the mock backend. Mirrors what the Laravel API does:
 * tenant from the request, Sanctum-style bearer tokens, permission checks,
 * tenant scope on every query, audit log, idempotency keys.
 */

export interface Ctx {
  tenant: E.Tenant;
  t: Tables;
  user: E.User | null;
  perms: string[];
  customer: E.Customer | null;
  rider: E.Rider | null;
  admin: E.PlatformAdmin | null;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  query: Record<string, string>;
  params: Record<string, string>;
  now: Date;
  idem?: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error", public errors?: Record<string, string>) {
    super(message);
  }
}

export type AuthMode = "public" | "customer" | "customer_optional" | "staff" | "rider" | "control" | "staff_or_customer";
type Handler = (ctx: Ctx) => unknown;
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler; auth: AuthMode; perm?: Permission; tenantless?: boolean }

export const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler, opts: { auth?: AuthMode; perm?: Permission; tenantless?: boolean } = {}) {
  const keys: string[] = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, handler, auth: opts.auth ?? "staff", perm: opts.perm, tenantless: opts.tenantless });
}

export const notFound = (what = "Record") => new HttpError(404, `${what} not found`, "not_found");
export const forbidden = (msg = "You don't have permission to do this") => new HttpError(403, msg, "forbidden");
export const invalid = (errors: Record<string, string>) => new HttpError(422, Object.values(errors)[0], "validation", errors);

/** Required-field check; returns 422 with field messages like Laravel's FormRequest. */
export function need(body: Record<string, unknown> | undefined, fields: string[]) {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = body?.[f];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) errors[f] = `${f.replace(/_/g, " ")} is required`;
  }
  if (Object.keys(errors).length) throw invalid(errors);
}

/** Tenant scope: every query goes through here (SRS 7: every query is scoped to tenant_id). */
export function scoped<K extends TableName>(ctx: Ctx, table: K): Tables[K] {
  return (ctx.t[table] as unknown as { tenant_id?: string; deleted_at?: string | null }[]).filter(
    (r) => r.tenant_id === ctx.tenant.id && !r.deleted_at,
  ) as unknown as Tables[K];
}

export function find<K extends TableName>(ctx: Ctx, table: K, id: string, what?: string): Tables[K][number] {
  const row = (scoped(ctx, table) as unknown as { id: string }[]).find((r) => r.id === id);
  if (!row) throw notFound(what);
  return row as Tables[K][number];
}

let idSeq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(++idSeq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function stamp(ctx: Ctx, prefix: string): E.BaseRow {
  const now = ctx.now.toISOString();
  return { id: newId(prefix), tenant_id: ctx.tenant.id, created_at: now, updated_at: now, created_by: ctx.user?.id ?? ctx.customer?.id ?? ctx.rider?.id ?? null, deleted_at: null };
}

/** Creates a row with base columns filled. */
export function create<K extends TableName>(ctx: Ctx, table: K, prefix: string, data: Record<string, unknown>): Tables[K][number] {
  return insert(table, { ...stamp(ctx, prefix), ...data } as unknown as Tables[K][number]);
}

/** Sequential counters (order, KOT, invoice): a row lock in MySQL, a single-threaded update here. */
export function nextCounter(ctx: Ctx, name: string, start = 0): number {
  const key = `${ctx.tenant.id}:${name}`;
  const row = ctx.t.counters.find((c) => c.id === key);
  if (!row) {
    insert("counters", { id: key, tenant_id: ctx.tenant.id, name, value: start + 1 });
    return start + 1;
  }
  return (update("counters", key, { value: row.value + 1 }) as { value: number }).value;
}

export function audit(ctx: Ctx, action: string, entity: string, entityId: string | null, oldValue: unknown, newValue: unknown) {
  create(ctx, "audit_logs", "au", {
    user_id: ctx.user?.id ?? null,
    user_name: ctx.admin ? `CafeChalao support · ${ctx.admin.name}` : ctx.user?.name ?? ctx.customer?.name ?? "System",
    action, entity, entity_id: entityId, device: ctx.query.__device ?? "Web", old_value: oldValue, new_value: newValue,
  });
}

export function notify(ctx: Ctx, audience: E.Notification["audience"], title: string, body: string, link: string | null = null, userId: string | null = null) {
  create(ctx, "notifications", "nt", { audience, user_id: userId, title, body, link, read: false });
}

export const settingsOf = <K extends "tax_settings" | "business_type_flags" | "payment_settings" | "delivery_settings" | "loyalty_settings" | "brand_settings" | "outlets">(ctx: Ctx, table: K) =>
  scoped(ctx, table)[0] as Tables[K][number];

export const feature = (ctx: Ctx, f: E.FeatureKey) => settingsOf(ctx, "business_type_flags").features[f];

export function requirePerm(ctx: Ctx, p: Permission) {
  if (!ctx.perms.includes(p)) throw forbidden();
}

export function limitsFor(ctx: Ctx, role: E.RoleKey): E.ApprovalLimit {
  return (
    scoped(ctx, "approval_limits").find((l) => l.role === role) ??
    ({ role, discount_pct: 0, void_value: 0, refund_value: 0, expense_value: 0, po_value: 0 } as E.ApprovalLimit)
  );
}

export type LimitKind = "discount_pct" | "void_value" | "refund_value" | "expense_value" | "po_value";

/**
 * Approval engine (SRS 2 and Core/Approvals): an action above the user's limit needs an approver
 * (a higher-role PIN entered on the spot → approver_id) or goes to the approval queue.
 */
export function checkLimit(ctx: Ctx, kind: LimitKind, amount: number, approverId?: string | null): E.User | null {
  const me = ctx.user!;
  if (amount <= limitsFor(ctx, me.role)[kind]) return null;
  if (!approverId) throw new HttpError(403, "Above your limit: a manager PIN is needed", "approval_required", { kind, amount: String(amount) });
  const approver = scoped(ctx, "users").find((u) => u.id === approverId && u.active);
  if (!approver || ROLE_RANK[approver.role] <= ROLE_RANK[me.role] || amount > limitsFor(ctx, approver.role)[kind]) {
    throw new HttpError(403, "That approver's limit doesn't cover this amount", "approval_required");
  }
  return approver;
}

export const today = (ctx: Ctx) => {
  const d = ctx.now;
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const dayOf = (iso: string) => {
  const d = new Date(iso);
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export function inRange(iso: string | null | undefined, from?: string, to?: string) {
  if (!iso) return false;
  const d = dayOf(iso);
  return (!from || d >= from) && (!to || d <= to);
}

/** Generic CRUD for simple settings-style tables (suppliers, coupons, areas ...). */
export function crud<K extends TableName>(
  path: string,
  table: K,
  prefix: string,
  o: { perm: Permission; readPerm?: Permission; required?: string[]; defaults?: Record<string, unknown>; auditAs?: string; readAuth?: AuthMode; sort?: (a: any, b: any) => number }, // eslint-disable-line @typescript-eslint/no-explicit-any
) {
  route("GET", path, (ctx) => {
    let rows = [...(scoped(ctx, table) as unknown as Record<string, unknown>[])];
    const q = ctx.query.q?.toLowerCase();
    if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    if (o.sort) rows.sort(o.sort);
    return rows;
  }, { auth: o.readAuth ?? "staff", perm: o.readAuth === "public" ? undefined : o.readPerm ?? o.perm });
  route("GET", `${path}/:id`, (ctx) => find(ctx, table, ctx.params.id), { perm: o.readPerm ?? o.perm });
  route("POST", path, (ctx) => {
    need(ctx.body, o.required ?? []);
    const row = create(ctx, table, prefix, { ...(o.defaults ?? {}), ...ctx.body });
    if (o.auditAs) audit(ctx, "create", o.auditAs, (row as { id: string }).id, null, ctx.body);
    return row;
  }, { perm: o.perm });
  route("PUT", `${path}/:id`, (ctx) => {
    const old = find(ctx, table, ctx.params.id);
    const { id: _i, tenant_id: _t, ...rest } = ctx.body ?? {};
    const row = update(table, ctx.params.id, rest);
    if (o.auditAs) audit(ctx, "update", o.auditAs, ctx.params.id, old, rest);
    return row;
  }, { perm: o.perm });
  route("DELETE", `${path}/:id`, (ctx) => {
    const old = find(ctx, table, ctx.params.id);
    update(table, ctx.params.id, { deleted_at: ctx.now.toISOString() } as never);
    audit(ctx, "delete", o.auditAs ?? String(table), ctx.params.id, old, null);
    return { deleted: true };
  }, { perm: o.perm });
}

export { db, insert, update };
