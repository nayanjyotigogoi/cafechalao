import { getDB, insert } from "./db";
import { HttpError, routes, type Ctx } from "./core";
import "./handlers";

/**
 * Entry point of the mock backend. Same contract as the Laravel API:
 *   request  → method, path (without /api/v1), query, JSON body, bearer token, tenant, Idempotency-Key
 *   response → { data } on success, { message, code, errors } on failure, with HTTP status codes.
 */
export interface MockRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  token: string | null;
  tenant: string;
  idempotencyKey?: string;
  auth?: string;
  now?: Date;
}

export async function handle(req: MockRequest): Promise<{ status: number; body: unknown }> {
  const t = await getDB();
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(req.path));
    if (!r) throw new HttpError(404, `No route for ${req.method} ${req.path}`, "no_route");
    const m = req.path.match(r.re)!;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

    const tok = req.token ? t.api_tokens.find((x) => x.token === req.token) : undefined;
    let tenant = t.tenants.find((x) => x.slug === req.tenant || x.domains.includes(req.tenant));
    if (r.tenantless) tenant = tenant ?? t.tenants[0];
    if (!tenant) throw new HttpError(404, "This café was not found", "tenant_not_found");

    const ctx: Ctx = {
      tenant, t, user: null, perms: [], customer: null, rider: null, admin: null,
      body: req.body ?? {}, query: req.query, params, now: req.now ?? new Date(), idem: req.idempotencyKey,
    };

    // A token is only valid for the café that issued it (control tokens are platform-wide).
    if (tok && (tok.kind === "control" || tok.tenant_id === tenant.id)) {
      if (tok.kind === "staff") {
        ctx.user = t.users.find((u) => u.id === tok.subject_id && u.active && !u.deleted_at) ?? null;
        const role = ctx.user && t.roles.find((x) => x.tenant_id === tenant!.id && x.key === ctx.user!.role);
        ctx.perms = role?.permissions ?? [];
      } else if (tok.kind === "customer") ctx.customer = t.customers.find((c) => c.id === tok.subject_id && !c.deleted_at) ?? null;
      else if (tok.kind === "rider") ctx.rider = t.riders.find((x) => x.id === tok.subject_id && !x.deleted_at) ?? null;
      else if (tok.kind === "control") ctx.admin = t.platform_admins.find((a) => a.id === tok.subject_id) ?? null;
    }

    const need = r.auth;
    if (need === "staff" && !ctx.user) throw new HttpError(401, "Please log in with your PIN", "unauthenticated");
    if (need === "customer" && !ctx.customer) throw new HttpError(401, "Please sign in to continue", "unauthenticated");
    if (need === "rider" && !ctx.rider) throw new HttpError(401, "Please log in with your phone", "unauthenticated");
    if (need === "control" && !ctx.admin) throw new HttpError(401, "Control Panel login required", "unauthenticated");
    if (need === "staff_or_customer" && !ctx.user && !ctx.customer) throw new HttpError(401, "Please sign in", "unauthenticated");
    if (r.perm && !ctx.perms.includes(r.perm)) throw new HttpError(403, "You don't have permission to do this", "forbidden");

    // Suspended licence → read-only (SRS 15).
    if (tenant.status === "suspended" && req.method !== "GET" && !r.tenantless && need !== "control") {
      throw new HttpError(423, "This café's licence is suspended. The app is read-only.", "licence_suspended");
    }

    // Idempotency-Key: the same key returns the first response, no second charge or order.
    if (req.idempotencyKey && req.method !== "GET") {
      const id = `${tenant.id}:${req.idempotencyKey}`;
      const hit = t.idempotency_keys.find((k) => k.id === id);
      if (hit) return { status: 200, body: { data: hit.response, replayed: true } };
      const data = await r.handler(ctx);
      insert("idempotency_keys", { id, key: req.idempotencyKey, tenant_id: tenant.id, response: data, created_at: ctx.now.toISOString() });
      return { status: 200, body: { data } };
    }

    const data = await r.handler(ctx);
    return { status: 200, body: { data } };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { message: e.message, code: e.code, errors: e.errors } };
    console.error("[mock api]", req.method, req.path, e);
    return { status: 500, body: { message: "Something went wrong. Please try again.", code: "server_error" } };
  }
}
