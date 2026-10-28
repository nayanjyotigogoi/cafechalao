import { buildSeed } from "@/mock/seed";
import { db, useMemoryDB } from "@/mock/db";
import { handle } from "@/mock/server";

/** Fresh seeded database and a small client that talks to the mock API like the browser does. */
export function freshDB() {
  const t = buildSeed(new Date());
  useMemoryDB(t);
  return t;
}

export function client(tenant = "chai-adda") {
  const tokens: Record<string, string | null> = {};
  const call = async <T = any>(method: string, path: string, body?: unknown, o: { as?: string; idem?: string; query?: Record<string, string>; now?: Date } = {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await handle({ method, path, query: o.query ?? {}, body, token: o.as ? tokens[o.as] ?? null : null, tenant, idempotencyKey: o.idem, now: o.now });
    if (res.status >= 400) {
      const e = res.body as { message: string; code: string };
      const err = new Error(e.message) as Error & { status: number; code: string };
      err.status = res.status;
      err.code = e.code;
      throw err;
    }
    return (res.body as { data: T }).data;
  };
  return {
    call,
    tokens,
    async staff(role: string) {
      const pins: Record<string, string> = { owner: "1111", manager: "2222", cashier: "3333", receptionist: "4444", captain: "5555", kitchen: "6666", storekeeper: "7777" };
      const u = db().users.find((x) => x.tenant_id === `tn_${tenant.replace(/-/g, "_")}` && x.role === role && x.active && x.pin_hash === pins[role])!;
      const r = await call<{ token: string }>("POST", "/auth/pin", { employee_code: u.employee_code, pin: pins[role] });
      tokens[role] = r.token;
      return r;
    },
    async customer(email = "priya.demo@gmail.com", name = "Priya Sharma") {
      const r = await call<{ token: string; customer: { id: string } }>("POST", "/auth/google", { email, name, google_id: email === "priya.demo@gmail.com" ? "g_demo_priya" : undefined });
      tokens.customer = r.token;
      return r;
    },
    async rider(phone: string) {
      const r = await call<{ token: string }>("POST", "/auth/rider", { phone, otp: "123456" });
      tokens.rider = r.token;
      return r;
    },
  };
}
