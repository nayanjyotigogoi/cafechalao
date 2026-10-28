import type * as E from "@/shared/types/entities";
import { audit, create, find, forbidden, invalid, need, notify, route, scoped, today, update, type Ctx } from "../core";

/** Staff (M7): profiles with PIN, attendance by PIN + selfie, advances, salary sheet. */

function staffRow(ctx: Ctx, u: E.User) {
  const p = scoped(ctx, "staff_profiles").find((x) => x.user_id === u.id) ?? null;
  const { pin_hash: _p, ...user } = u;
  return { ...user, profile: p };
}

/** Next employee ID for this café (E001, E002, …); removed staff keep theirs. */
export function nextEmployeeCode(ctx: Ctx) {
  const n = Math.max(0, ...scoped(ctx, "users").map((u) => Number(String(u.employee_code ?? "").slice(1)) || 0));
  return `E${String(n + 1).padStart(3, "0")}`;
}

route("GET", "/staff", (ctx) => scoped(ctx, "users").map((u) => staffRow(ctx, u)), { perm: "staff.manage" });

route("POST", "/staff", (ctx) => {
  need(ctx.body, ["name", "role", "pin", "phone"]);
  if (!/^\d{4,6}$/.test(String(ctx.body.pin))) throw invalid({ pin: "PIN must be 4 to 6 digits" });
  if (scoped(ctx, "users").some((u) => u.active && u.pin_hash === String(ctx.body.pin))) throw invalid({ pin: "This PIN is used by someone else. Pick another." });
  if (ctx.body.role === "owner" && ctx.user!.role !== "owner") throw forbidden("Only the owner can add another owner");
  const u = create(ctx, "users", "us", { employee_code: nextEmployeeCode(ctx), name: ctx.body.name, role: ctx.body.role, phone: ctx.body.phone, email: ctx.body.email ?? null, pin_hash: String(ctx.body.pin), active: true, avatar_color: ctx.body.avatar_color ?? "#5E6B33" }) as E.User;
  create(ctx, "staff_profiles", "sp", {
    user_id: u.id, salary_type: ctx.body.salary_type ?? "monthly", salary_amount: Math.round(Number(ctx.body.salary_amount ?? 0)), weekly_off: Number(ctx.body.weekly_off ?? 1),
    shift_start: ctx.body.shift_start ?? "09:00", shift_end: ctx.body.shift_end ?? "18:00", id_document: ctx.body.id_document ?? null, joined_on: ctx.body.joined_on ?? today(ctx),
  });
  audit(ctx, "create", "staff", u.id, null, { name: u.name, role: u.role });
  return staffRow(ctx, u);
}, { perm: "staff.manage" });

route("PUT", "/staff/:id", (ctx) => {
  const u = find(ctx, "users", ctx.params.id, "Staff");
  const b = ctx.body;
  if (u.role === "owner" && ctx.user!.role !== "owner") throw forbidden();
  const userPatch: Partial<E.User> = {};
  for (const k of ["name", "role", "phone", "email", "active", "avatar_color"] as const) if (k in b) (userPatch as Record<string, unknown>)[k] = b[k];
  if (b.pin) {
    if (!/^\d{4,6}$/.test(String(b.pin))) throw invalid({ pin: "PIN must be 4 to 6 digits" });
    if (scoped(ctx, "users").some((x) => x.id !== u.id && x.active && x.pin_hash === String(b.pin))) throw invalid({ pin: "This PIN is used by someone else" });
    userPatch.pin_hash = String(b.pin);
  }
  update("users", u.id, userPatch);
  const p = scoped(ctx, "staff_profiles").find((x) => x.user_id === u.id);
  if (b.profile && p) {
    if ("salary_amount" in b.profile && !ctx.perms.includes("staff.salary")) throw forbidden("Only the owner can change salaries");
    const { id: _i, tenant_id: _t, user_id: _u, ...pp } = b.profile;
    update("staff_profiles", p.id, pp);
  }
  audit(ctx, "update", "staff", u.id, { role: u.role, active: u.active }, { ...userPatch, pin_hash: b.pin ? "changed" : undefined });
  return staffRow(ctx, find(ctx, "users", u.id));
}, { perm: "staff.manage" });

/* Attendance (M7.2): PIN clock-in/out on the outlet device with a selfie. */
route("POST", "/attendance/clock", (ctx) => {
  need(ctx.body, ["pin"]);
  const u = scoped(ctx, "users").find((x) => x.active && x.pin_hash === String(ctx.body.pin));
  if (!u) throw invalid({ pin: "Wrong PIN" });
  const d = today(ctx);
  const row = scoped(ctx, "attendance").find((a) => a.user_id === u.id && a.date === d);
  if (!row) {
    const a = create(ctx, "attendance", "at", { user_id: u.id, date: d, clock_in: ctx.now.toISOString(), clock_out: null, selfie_url: ctx.body.selfie ?? null, status: "present", overtime_min: 0, correction_note: null });
    return { action: "in", name: u.name, attendance: a };
  }
  if (row.clock_out) throw invalid({ pin: `${u.name} already clocked out today` });
  if (!row.clock_in) return { action: "in", name: u.name, attendance: update("attendance", row.id, { clock_in: ctx.now.toISOString(), status: "present", selfie_url: ctx.body.selfie ?? row.selfie_url }) };
  const p = scoped(ctx, "staff_profiles").find((x) => x.user_id === u.id);
  const [eh, em] = (p?.shift_end ?? "23:00").split(":").map(Number);
  const end = new Date(ctx.now);
  end.setHours(eh, em, 0, 0);
  const ot = Math.max(0, Math.round((ctx.now.getTime() - end.getTime()) / 60000));
  return { action: "out", name: u.name, attendance: update("attendance", row.id, { clock_out: ctx.now.toISOString(), overtime_min: ot >= 15 ? ot : 0 }) };
}, { auth: "public" });

route("GET", "/attendance", (ctx) => {
  const month = ctx.query.month ?? today(ctx).slice(0, 7);
  return scoped(ctx, "attendance").filter((a) => a.date.startsWith(month) && (!ctx.query.user_id || a.user_id === ctx.query.user_id));
}, { perm: "staff.manage" });

/** Attendance correction: a manager's correction is applied after approval (owner or manager queue). */
route("POST", "/attendance/:id/correct", (ctx) => {
  const a = find(ctx, "attendance", ctx.params.id, "Attendance");
  need(ctx.body, ["patch", "reason"]);
  update("attendance", a.id, { correction_note: JSON.stringify({ patch: ctx.body.patch, reason: ctx.body.reason }) });
  const role: E.RoleKey = ctx.user!.role === "manager" ? "owner" : "manager";
  create(ctx, "approvals", "ap", { kind: "attendance", ref_id: a.id, amount: 0, summary: `Attendance correction · ${scoped(ctx, "users").find((u) => u.id === a.user_id)?.name} · ${a.date}: ${ctx.body.reason}`, requested_by: ctx.user!.id, status: "pending", decided_by: null, decided_at: null, required_role: role });
  notify(ctx, role, "Attendance correction", ctx.body.reason, "/admin/approvals");
  return { ok: true };
}, { perm: "staff.manage" });

route("GET", "/advances", (ctx) => scoped(ctx, "advances"), { perm: "staff.salary" });
route("POST", "/advances", (ctx) => {
  need(ctx.body, ["user_id", "amount"]);
  return create(ctx, "advances", "av", { user_id: ctx.body.user_id, amount: Math.round(Number(ctx.body.amount)), given_on: ctx.body.given_on ?? today(ctx), note: ctx.body.note ?? "", recovered: false });
}, { perm: "staff.salary" });

/** Salary sheet (M7.3, M8.6): days present, overtime, advances, deductions, in-house rider delivery earnings. */
export function salarySheet(ctx: Ctx, month: string) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const att = scoped(ctx, "attendance").filter((a) => a.date.startsWith(month));
  const slips = scoped(ctx, "salary_slips").filter((s) => s.month === month);
  return scoped(ctx, "users").filter((u) => u.role !== "owner").map((u) => {
    const p = scoped(ctx, "staff_profiles").find((x) => x.user_id === u.id);
    const mine = att.filter((a) => a.user_id === u.id);
    const present = mine.filter((a) => a.status === "present").length + mine.filter((a) => a.status === "half_day").length * 0.5;
    const paidOffs = mine.filter((a) => a.status === "weekly_off").length;
    const otMin = mine.reduce((s, a) => s + a.overtime_min, 0);
    const daily = p ? (p.salary_type === "monthly" ? p.salary_amount / daysInMonth : p.salary_amount) : 0;
    const gross = Math.round(p?.salary_type === "monthly" ? daily * (present + paidOffs) : daily * present);
    const overtime = Math.round((daily / 8) * (otMin / 60) * 1.5);
    const advances = scoped(ctx, "advances").filter((a) => a.user_id === u.id && !a.recovered).reduce((s, a) => s + a.amount, 0);
    const rider = scoped(ctx, "riders").find((r) => r.user_id === u.id && r.type === "own");
    const deliveryEarnings = rider ? scoped(ctx, "deliveries").filter((d) => d.rider_id === rider.id && d.status === "delivered" && d.delivered_at?.startsWith(month)).reduce((s, d) => s + d.charge, 0) : 0;
    const slip = slips.find((s) => s.user_id === u.id);
    return {
      user_id: u.id, name: u.name, role: u.role, salary_type: p?.salary_type, salary_amount: p?.salary_amount ?? 0, days_present: present, weekly_offs: paidOffs,
      overtime_min: otMin, gross, overtime_pay: overtime, advances, deductions: 0, delivery_earnings: deliveryEarnings,
      net: gross + overtime + deliveryEarnings - advances, paid: !!slip?.paid, slip_id: slip?.id ?? null,
    };
  });
}

route("GET", "/salary-sheet", (ctx) => salarySheet(ctx, ctx.query.month ?? today(ctx).slice(0, 7)), { perm: "staff.salary" });

route("POST", "/salary-sheet/pay", (ctx) => {
  need(ctx.body, ["month", "user_id"]);
  const row = salarySheet(ctx, ctx.body.month).find((r) => r.user_id === ctx.body.user_id);
  if (!row) throw invalid({ user_id: "Not on this sheet" });
  if (row.paid) throw invalid({ user_id: "Already paid" });
  const deductions = Math.round(Number(ctx.body.deductions ?? 0));
  const slip = create(ctx, "salary_slips", "ss", { user_id: row.user_id, month: ctx.body.month, days_present: row.days_present, overtime_pay: row.overtime_pay, gross: row.gross, advances: row.advances, deductions, delivery_earnings: row.delivery_earnings, net: row.net - deductions, paid: true });
  for (const a of scoped(ctx, "advances").filter((a) => a.user_id === row.user_id && !a.recovered)) update("advances", a.id, { recovered: true });
  const cat = scoped(ctx, "expense_categories").find((c) => c.name === "Salary");
  if (cat) create(ctx, "expenses", "ex", { category_id: cat.id, amount: row.net - deductions, mode: ctx.body.mode ?? "bank", spent_on: today(ctx), note: `Salary ${ctx.body.month} · ${row.name}`, bill_photo_url: null, status: "approved", petty_cash: false });
  audit(ctx, "salary_paid", "staff", row.user_id, null, { month: ctx.body.month, net: row.net - deductions });
  return slip;
}, { perm: "staff.salary" });

/** Staff sales and tips (M7.4). */
route("GET", "/reports/staff-sales", (ctx) => {
  const { from, to } = ctx.query;
  const orders = scoped(ctx, "orders").filter((o) => o.payment_status === "paid" && (!from || o.created_at.slice(0, 10) >= from) && (!to || o.created_at.slice(0, 10) <= to));
  return scoped(ctx, "users").filter((u) => ["captain", "cashier", "manager"].includes(u.role)).map((u) => {
    const mine = orders.filter((o) => o.captain_id === u.id || (!o.captain_id && o.cashier_id === u.id));
    return { user_id: u.id, name: u.name, role: u.role, orders: mine.length, sales: mine.reduce((s, o) => s + o.total, 0), tips: mine.reduce((s, o) => s + o.tip, 0), average: mine.length ? Math.round(mine.reduce((s, o) => s + o.total, 0) / mine.length) : 0 };
  }).sort((a, b) => b.sales - a.sales);
}, { perm: "reports.view" });
