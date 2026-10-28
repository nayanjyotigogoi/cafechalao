/**
 * The one door between the UI and the backend.
 *
 * NEXT_PUBLIC_API_MODE=mock  → requests are answered in the browser by /mock/server.ts (dummy data).
 * NEXT_PUBLIC_API_MODE=http  → the same requests go to the Laravel API at NEXT_PUBLIC_API_URL.
 *
 * Screens never call fetch directly; they call the module api files (modules/<module>/api.ts),
 * which call api(). Switching to the real backend is a config change, not a frontend change.
 * The contract (paths, bodies, { data } envelope, error shape) is documented in docs/api-contract.md.
 */

export type AuthKind = "customer" | "staff" | "rider" | "control";

export interface ApiOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  auth?: AuthKind;
  idempotencyKey?: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error", public fields?: Record<string, string>) {
    super(message);
  }
}

export const API_MODE = (process.env.NEXT_PUBLIC_API_MODE ?? "mock") as "mock" | "http";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/* ---------- tenant (the café) ---------- */

const TENANT_KEY = "cc.tenant";
let tenantOverride: string | null = null;

/**
 * The café is identified by the domain (SRS 7): in production NEXT_PUBLIC_TENANT_LOCKED pins the site to
 * NEXT_PUBLIC_DEFAULT_TENANT. In development:
 *   chai-adda.localhost:3000  → chai-adda
 *   localhost:3000?outlet=momo-mahal → momo-mahal (remembered)
 */
export function getTenantSlug(): string {
  // Production: each café's site runs on its own domain and serves only that café, whatever the URL says.
  if (process.env.NEXT_PUBLIC_TENANT_LOCKED === "true" && process.env.NEXT_PUBLIC_DEFAULT_TENANT) return process.env.NEXT_PUBLIC_DEFAULT_TENANT;
  if (tenantOverride) return tenantOverride;
  if (typeof window === "undefined") return process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? "chai-adda";
  const q = new URLSearchParams(window.location.search).get("outlet");
  if (q) {
    try { localStorage.setItem(TENANT_KEY, q); } catch {}
    return q;
  }
  const host = window.location.hostname;
  const sub = host.endsWith(".localhost") ? host.slice(0, -".localhost".length) : null;
  if (sub) return sub;
  try {
    const saved = localStorage.getItem(TENANT_KEY);
    if (saved) return saved;
  } catch {}
  return process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? "chai-adda";
}

export function setTenantSlug(slug: string) {
  tenantOverride = slug;
  try { localStorage.setItem(TENANT_KEY, slug); } catch {}
}

/* ---------- tokens (one per surface, per café) ---------- */

const tokenKey = (kind: AuthKind) => (kind === "control" ? "cc.token.control" : `cc.token.${getTenantSlug()}.${kind}`);

export function getToken(kind: AuthKind): string | null {
  try { return localStorage.getItem(tokenKey(kind)); } catch { return null; }
}
export function setToken(kind: AuthKind, token: string | null) {
  try {
    if (token) localStorage.setItem(tokenKey(kind), token);
    else localStorage.removeItem(tokenKey(kind));
  } catch {}
}

export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/* ---------- request ---------- */

export async function api<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts: ApiOptions = {}): Promise<T> {
  const token = opts.auth ? getToken(opts.auth) : null;
  const query = Object.fromEntries(Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]));

  if (API_MODE === "mock") {
    const { handle } = await import("@/mock/server");
    const res = await handle({ method, path, query, body: opts.body, token, tenant: getTenantSlug(), idempotencyKey: opts.idempotencyKey, auth: opts.auth });
    if (res.status >= 400) {
      const e = res.body as { message: string; code?: string; errors?: Record<string, string> };
      throw new ApiError(res.status, e.message, e.code, e.errors);
    }
    return (res.body as { data: T }).data;
  }

  const qs = new URLSearchParams(query).toString();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Tenant": getTenantSlug(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "You're offline. We'll retry when the connection is back.", "offline");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.message ?? "Something went wrong", json.code, json.errors);
  return json.data as T;
}

export const get = <T,>(path: string, opts?: ApiOptions) => api<T>("GET", path, opts);
export const post = <T,>(path: string, body?: unknown, opts?: ApiOptions) => api<T>("POST", path, { ...opts, body });
export const put = <T,>(path: string, body?: unknown, opts?: ApiOptions) => api<T>("PUT", path, { ...opts, body });
export const patch = <T,>(path: string, body?: unknown, opts?: ApiOptions) => api<T>("PATCH", path, { ...opts, body });
export const del = <T,>(path: string, opts?: ApiOptions) => api<T>("DELETE", path, opts);
