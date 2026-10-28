import { DEMO_OTP } from "../seed";
import { audit, create, find, HttpError, insert, invalid, limitsFor, need, newId, route, scoped, update, type Ctx } from "../core";
import { ROLE_RANK } from "@/shared/lib/permissions";
import type { Customer, User } from "@/shared/types/entities";

/** Logins: Google (customers), phone OTP (customers fallback, riders), PIN (staff), email OTP (Control Panel). */

function issue(ctx: Ctx, kind: "customer" | "staff" | "rider" | "control", subject: string) {
  const token = `${kind}_${newId("tk")}${Math.random().toString(36).slice(2, 10)}`;
  insert("api_tokens", { id: token, token, tenant_id: kind === "control" ? null : ctx.tenant.id, kind, subject_id: subject, created_at: ctx.now.toISOString() });
  return token;
}

export const needsProfile = (c: Customer) => !c.phone_verified; // birthday is optional

const normPhone = (p: string) => p.replace(/\D/g, "").slice(-10);

/* ---------- customers ---------- */

route("POST", "/auth/google", (ctx) => {
  // In http mode Laravel verifies the Google ID token; the demo button sends a demo Google profile.
  need(ctx.body, ["email", "name"]);
  const { email, name, google_id } = ctx.body;
  const gid = google_id ?? `g_${email}`;
  let c = scoped(ctx, "customers").find((x) => x.google_id === gid || (x.email && x.email === email));
  if (!c) {
    c = create(ctx, "customers", "cu", {
      name, email, google_id: gid, phone: null, phone_verified: false, birthday: null, anniversary: null, gender: null, source: "app",
      marketing_consent: false, tags: ["new"], loyalty_points: 0, total_spend: 0, visits: 0, last_visit_at: null,
    }) as Customer;
  } else if (!c.google_id) {
    c = update("customers", c.id, { google_id: gid }) as Customer;
  }
  return { token: issue(ctx, "customer", c.id), customer: c, needs_profile: needsProfile(c) };
}, { auth: "public" });

/** Email login: the account is created the first time (same as the Laravel API). */
route("POST", "/auth/email", (ctx) => {
  need(ctx.body, ["email"]);
  const email = String(ctx.body.email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw invalid({ email: "Enter a valid email" });
  let c = scoped(ctx, "customers").find((x) => x.email === email);
  if (!c) {
    c = create(ctx, "customers", "cu", {
      name: email.split("@")[0], email, google_id: null, phone: null, phone_verified: false, birthday: null, anniversary: null, gender: null, source: "app",
      marketing_consent: false, tags: ["new"], loyalty_points: 0, total_spend: 0, visits: 0, last_visit_at: null,
    }) as Customer;
  }
  return { token: issue(ctx, "customer", c.id), customer: c, needs_profile: needsProfile(c) };
}, { auth: "public" });

route("GET", "/auth/config", () => ({ google_client_id: null, email_login: true, demo: true }), { auth: "public" });

route("POST", "/auth/otp/send", (ctx) => {
  need(ctx.body, ["phone"]);
  if (normPhone(ctx.body.phone).length !== 10) throw invalid({ phone: "Enter a 10-digit mobile number" });
  // Rate limited per IP and per tenant in Laravel. The mock always sends the demo OTP.
  return { sent: true, demo_otp: DEMO_OTP };
}, { auth: "public" });

/** Verify the mobile on the signed-in customer. If a walk-in profile has the same mobile, the customer claims it (M1.2). */
route("POST", "/auth/otp/verify", (ctx) => {
  need(ctx.body, ["phone", "otp"]);
  if (ctx.body.otp !== DEMO_OTP) throw invalid({ otp: "That code is not right. Try 123456 in the demo." });
  const me = ctx.customer!;
  const phone = ctx.body.phone;
  const walkIn = scoped(ctx, "customers").find((x) => x.id !== me.id && x.phone && normPhone(x.phone) === normPhone(phone) && !x.google_id);
  if (walkIn) {
    const claimed = update("customers", walkIn.id, { google_id: me.google_id, email: me.email ?? walkIn.email, phone_verified: true, source: walkIn.source }) as Customer;
    update("customers", me.id, { deleted_at: ctx.now.toISOString(), google_id: null } as Partial<Customer>);
    audit(ctx, "claim_profile", "customer", walkIn.id, null, { from: me.id });
    return { token: issue(ctx, "customer", claimed.id), customer: claimed, claimed: true, needs_profile: needsProfile(claimed) };
  }
  const c = update("customers", me.id, { phone, phone_verified: true }) as Customer;
  return { token: null, customer: c, claimed: false, needs_profile: needsProfile(c) };
}, { auth: "customer" });

/** "Continue with phone (OTP)" fallback on the customer login screen. */
route("POST", "/auth/phone", (ctx) => {
  need(ctx.body, ["phone", "otp"]);
  if (ctx.body.otp !== DEMO_OTP) throw invalid({ otp: "That code is not right. Try 123456 in the demo." });
  let c = scoped(ctx, "customers").find((x) => x.phone && normPhone(x.phone) === normPhone(ctx.body.phone));
  if (!c) {
    c = create(ctx, "customers", "cu", {
      name: ctx.body.name ?? "Guest", email: null, google_id: null, phone: ctx.body.phone, phone_verified: true, birthday: null, anniversary: null,
      gender: null, source: "app", marketing_consent: false, tags: ["new"], loyalty_points: 0, total_spend: 0, visits: 0, last_visit_at: null,
    }) as Customer;
  } else if (!c.phone_verified) c = update("customers", c.id, { phone_verified: true }) as Customer;
  return { token: issue(ctx, "customer", c.id), customer: c, needs_profile: needsProfile(c) };
}, { auth: "public" });

/* ---------- staff ---------- */

function staffSession(ctx: Ctx, userId: string) {
  const u = find(ctx, "users", userId);
  const role = scoped(ctx, "roles").find((r) => r.key === u.role);
  const { pin_hash: _p, ...user } = u;
  return { user, permissions: role?.permissions ?? [], limits: limitsFor(ctx, u.role) };
}

const staffByCode = (ctx: Ctx, code: unknown) => scoped(ctx, "users").find((x) => x.active && x.role !== "rider" && x.employee_code === String(code ?? "").trim().toUpperCase());
const phoneHint = (u: User) => (u.phone ? `••••••${u.phone.replace(/\D/g, "").slice(-4)}` : null);

/** Staff: employee ID + PIN (no public staff list). A user without a PIN sets one after a code to their mobile. */
route("POST", "/auth/pin", (ctx) => {
  need(ctx.body, ["employee_code", "pin"]);
  const u = staffByCode(ctx, ctx.body.employee_code);
  if (u && !u.pin_hash) throw new HttpError(409, "Set your PIN first.", "pin_not_set", { phone_hint: phoneHint(u) ?? "" });
  if (!u || u.pin_hash !== String(ctx.body.pin)) throw new HttpError(422, "Employee ID or PIN is not right.", "wrong_pin", { pin: "Wrong PIN" });
  return { token: issue(ctx, "staff", u.id), ...staffSession(ctx, u.id) };
}, { auth: "public" });

route("POST", "/auth/pin/code", (ctx) => {
  need(ctx.body, ["employee_code"]);
  const u = staffByCode(ctx, ctx.body.employee_code);
  if (!u || u.pin_hash) throw new HttpError(422, "This employee ID already has a PIN. Ask the owner to reset it if you forgot it.", "pin_already_set");
  return { sent: true, phone_hint: phoneHint(u), demo_otp: DEMO_OTP };
}, { auth: "public" });

route("POST", "/auth/pin/setup", (ctx) => {
  need(ctx.body, ["employee_code", "otp", "pin"]);
  const u = staffByCode(ctx, ctx.body.employee_code);
  if (!u || u.pin_hash) throw new HttpError(422, "This employee ID already has a PIN.", "pin_already_set");
  if (String(ctx.body.otp) !== DEMO_OTP) throw invalid({ otp: "That code is not right." });
  if (!/^\d{4,6}$/.test(String(ctx.body.pin))) throw invalid({ pin: "PIN must be 4 to 6 digits" });
  if (scoped(ctx, "users").some((x) => x.active && x.pin_hash === String(ctx.body.pin))) throw invalid({ pin: "This PIN is used by someone else. Pick another." });
  update("users", u.id, { pin_hash: String(ctx.body.pin) });
  return { token: issue(ctx, "staff", u.id), ...staffSession(ctx, u.id) };
}, { auth: "public" });

route("GET", "/auth/staff/me", (ctx) => staffSession(ctx, ctx.user!.id));

/** Higher-role PIN on the spot: returns the approver if their role outranks the requester and their limit covers it. */
route("POST", "/auth/approve", (ctx) => {
  need(ctx.body, ["pin"]);
  const me = ctx.user!;
  const kind = ctx.body.kind as "discount_pct" | "void_value" | "refund_value" | "expense_value" | "po_value" | undefined;
  const amount = Number(ctx.body.amount ?? 0);
  const approver = scoped(ctx, "users").find(
    (u) => u.active && u.pin_hash === String(ctx.body.pin) && ROLE_RANK[u.role] > ROLE_RANK[me.role] && (!kind || amount <= limitsFor(ctx, u.role)[kind]),
  );
  if (!approver) throw new HttpError(403, "That PIN can't approve this. Ask a manager or the owner.", "approval_denied");
  return { approver_id: approver.id, approver_name: approver.name, role: approver.role };
});

/* ---------- riders ---------- */

route("POST", "/auth/rider", (ctx) => {
  need(ctx.body, ["phone", "otp"]);
  if (ctx.body.otp !== DEMO_OTP) throw invalid({ otp: "That code is not right. Try 123456 in the demo." });
  const r = scoped(ctx, "riders").find((x) => x.active && normPhone(x.phone) === normPhone(ctx.body.phone));
  if (!r) throw new HttpError(404, "This phone is not registered as a rider for this café.", "not_rider");
  return { token: issue(ctx, "rider", r.id), rider: r };
}, { auth: "public" });

/* ---------- Control Panel (L1) ---------- */

route("POST", "/control/auth", (ctx) => {
  need(ctx.body, ["email", "otp"]);
  const a = ctx.t.platform_admins.find((x) => x.email === String(ctx.body.email).toLowerCase());
  if (!a || ctx.body.otp !== DEMO_OTP) throw new HttpError(422, "Email or code is not right", "bad_login");
  return { token: issue(ctx, "control", a.id), admin: a };
}, { auth: "public", tenantless: true });

route("POST", "/auth/logout", (ctx) => {
  // Tokens are deleted server-side in Laravel; the client also forgets its copy.
  void ctx;
  return { ok: true };
}, { auth: "public", tenantless: true });

export { issue };
