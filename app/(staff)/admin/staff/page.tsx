"use client";

import { useMemo, useState } from "react";
import { staffApi } from "@/modules/staff/api";
import { useM, useQ } from "@/shared/api/hooks";
import { useStaff } from "@/shared/auth/session";
import { cx, fmtDate, fmtTime, label, todayISO } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { ROLE_LABEL } from "@/shared/lib/permissions";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { Advance, Attendance, RoleKey, StaffProfile, User } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { FormModal, type Values } from "@/shared/ui/form";
import { Modal } from "@/shared/ui/overlay";
import { Avatar, Button, Chip, Field, Input, Money, MoneyInput, PageTitle, Segmented, Select } from "@/shared/ui/primitives";

/** Staff (M7): profiles with role and PIN, attendance, salary sheet, advances, staff sales and tips. */
type Row = Omit<User, "pin_hash"> & { profile: StaffProfile | null };
const ROLES = (Object.keys(ROLE_LABEL) as RoleKey[]).filter((r) => r !== "rider");

export default function StaffAdmin() {
  useTitle("Staff");
  const { can } = useStaff();
  const [tab, setTab] = useState<"staff" | "attendance" | "salary" | "advances" | "sales">("staff");
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Staff" sub="Staff log in with their PIN on the café's shared devices and clock in on the PIN screen." />
      <Segmented value={tab} onChange={setTab} options={[{ value: "staff", label: "Team" }, { value: "attendance", label: "Attendance" }, ...(can("staff.salary") ? [{ value: "salary" as const, label: "Salary sheet" }, { value: "advances" as const, label: "Advances" }] : []), ...(can("reports.view") ? [{ value: "sales" as const, label: "Sales & tips" }] : [])]} />
      {tab === "staff" && <Team />}
      {tab === "attendance" && <AttendanceView />}
      {tab === "salary" && <Salary />}
      {tab === "advances" && <Advances />}
      {tab === "sales" && <StaffSales />}
    </div>
  );
}

function Team() {
  const { can } = useStaff();
  const rows = useQ<Row[]>("/staff", { auth: "staff" });
  const [e, setE] = useState<Values | null>(null);
  const save = useM((v: Values) => {
    const { salary_type, salary_amount, weekly_off, shift_start, shift_end, ...u } = v;
    const profile = { salary_type, weekly_off, shift_start, shift_end, ...(can("staff.salary") ? { salary_amount } : {}) };
    const body: Values = u.id ? { ...u, pin: u.pin || undefined, profile: { ...profile, weekly_off: Number(weekly_off) } } : { ...u, salary_type, salary_amount, weekly_off: Number(weekly_off), shift_start, shift_end };
    return staffApi.save(body as { id?: string });
  }, { success: (r) => ((r as { employee_code?: string }).employee_code && !e?.id ? `Saved · their employee ID is ${(r as { employee_code: string }).employee_code}` : "Saved"), onSuccess: () => setE(null) });
  return (
    <>
      <DataTable rows={(rows.data ?? []).filter((r) => r.role !== "rider")} rowKey={(r) => r.id} search onRowClick={(r) => setE({ ...r, ...r.profile, id: r.id, pin: "" })}
        toolbar={<Button size="sm" variant="primary" onClick={() => setE({ role: "captain", active: true, salary_type: "monthly", weekly_off: 1, shift_start: "09:00", shift_end: "18:00" })}>+ Staff</Button>}
        columns={[
          { key: "employee_code", header: "Employee ID", cell: (r) => <b className="num">{r.employee_code}</b> },
          { key: "name", header: "Name", cell: (r) => <span className="flex items-center gap-2"><Avatar name={r.name} color={r.avatar_color} size={28} /><b>{r.name}</b></span> },
          { key: "role", header: "Role", value: (r) => ROLE_LABEL[r.role] },
          { key: "phone", header: "Phone", hideSm: true },
          { key: "salary", header: "Salary", hideSm: true, value: (r) => (can("staff.salary") && r.profile ? `${formatINR(r.profile.salary_amount)}/${r.profile.salary_type === "monthly" ? "month" : "day"}` : "—") },
          { key: "shift", header: "Shift", value: (r) => (r.profile ? `${r.profile.shift_start}–${r.profile.shift_end}` : "—"), hideSm: true },
          { key: "active", header: "Status", cell: (r) => <Chip tone={r.active ? "ok" : "neutral"}>{r.active ? "Active" : "Inactive"}</Chip> },
        ]} />
      <FormModal open={!!e} title={e?.id ? `Edit ${e.name}` : "New staff"} initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} error={save.error}
        fields={[
          { name: "name", label: "Name", type: "text", required: true },
          { name: "phone", label: "Phone", type: "tel", required: true },
          { name: "role", label: "Role", type: "select", options: ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })), required: true },
          { name: "pin", label: e?.id ? "New PIN (leave blank to keep)" : "PIN (4–6 digits)", type: "text", ...(e?.id ? {} : { required: true }) } as never,
          { name: "email", label: "Email (owner/manager login)", type: "email" },
          { name: "salary_type", label: "Salary type", type: "select", options: [{ value: "monthly", label: "Monthly" }, { value: "daily", label: "Daily" }] },
          ...(can("staff.salary") ? [{ name: "salary_amount", label: "Salary amount", type: "money" as const }] : []),
          { name: "weekly_off", label: "Weekly off", type: "select", options: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => ({ value: String(i), label: d })) },
          { name: "shift_start", label: "Shift start", type: "time" },
          { name: "shift_end", label: "Shift end", type: "time" },
          { name: "active", label: "Active", type: "toggle" },
        ]} />
    </>
  );
}

function AttendanceView() {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const staff = useQ<Row[]>("/staff", { auth: "staff" });
  const att = useQ<Attendance[]>("/attendance", { auth: "staff", query: { month } });
  const [fix, setFix] = useState<Attendance | null>(null);
  const [form, setForm] = useState({ status: "present", reason: "" });
  const correct = useM(() => staffApi.correct(fix!.id, { status: form.status }, form.reason), { success: "Correction sent for approval", onSuccess: () => setFix(null) });
  const days = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter((d) => d <= todayISO());
  }, [month]);
  const people = (staff.data ?? []).filter((s) => s.role !== "owner");
  const sym: Record<string, string> = { present: "P", absent: "A", half_day: "½", weekly_off: "W", leave: "L" };
  return (
    <>
      <div className="flex items-center gap-2"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" aria-label="Month" /><span className="text-xs text-mute">P present · A absent · W weekly off · tap a cell to correct (approval needed)</span></div>
      <div className="overflow-x-auto rounded-2xl border-[1.5px] border-line bg-paper">
        <table className="text-xs">
          <thead><tr><th className="sticky left-0 bg-paper p-2 text-left">Staff</th>{days.map((d) => <th key={d} className="num p-1 font-normal text-mute">{Number(d.slice(8))}</th>)}<th className="p-2">P</th></tr></thead>
          <tbody>
            {people.map((p) => {
              const mine = att.data?.filter((a) => a.user_id === p.id) ?? [];
              return (
                <tr key={p.id} className="border-t border-line">
                  <td className="sticky left-0 whitespace-nowrap bg-paper p-2 font-medium">{p.name}</td>
                  {days.map((d) => {
                    const a = mine.find((x) => x.date === d);
                    return (
                      <td key={d} className="p-0.5 text-center">
                        <button disabled={!a} onClick={() => { setFix(a!); setForm({ status: a!.status, reason: "" }); }} title={a?.clock_in ? `${fmtTime(a.clock_in)} – ${fmtTime(a.clock_out)}${a.overtime_min ? ` · OT ${a.overtime_min}m` : ""}` : undefined}
                          className={cx("grid size-6 cursor-pointer place-items-center rounded", a?.status === "present" ? "bg-ok/20 text-ok" : a?.status === "absent" ? "bg-rose/20 text-rose" : a?.status === "weekly_off" ? "text-mute" : "", a?.correction_note && "ring-2 ring-warn")}>
                          {a ? sym[a.status] : ""}
                        </button>
                      </td>
                    );
                  })}
                  <td className="num p-2 font-semibold">{mine.filter((a) => a.status === "present").length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal open={!!fix} onClose={() => setFix(null)} title={`Correct ${fix && fmtDate(fix.date)}`} footer={<Button variant="primary" disabled={!form.reason} loading={correct.isPending} onClick={() => correct.mutate(undefined)}>Send for approval</Button>}>
        {fix?.selfie_url && <img src={fix.selfie_url} alt="Clock-in selfie" className="mb-2 h-24 rounded" />}
        <div className="grid gap-3">
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["present", "absent", "half_day", "weekly_off", "leave"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
          <Field label="Reason"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

function Salary() {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const sheet = useQ<{ user_id: string; name: string; role: RoleKey; salary_type: string; days_present: number; weekly_offs: number; overtime_min: number; gross: number; overtime_pay: number; advances: number; delivery_earnings: number; net: number; paid: boolean }[]>("/salary-sheet", { auth: "staff", query: { month } });
  const pay = useM((user_id: string) => staffApi.paySalary({ month, user_id }), { success: "Marked paid · added to expenses" });
  return (
    <>
      <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" aria-label="Month" />
      <DataTable rows={sheet.data ?? []} rowKey={(r) => r.user_id} exportName={`salary-${month}`}
        columns={[
          { key: "name", header: "Staff", cell: (r) => <span><b>{r.name}</b><span className="block text-xs text-mute">{ROLE_LABEL[r.role]} · {r.salary_type}</span></span> },
          { key: "days_present", header: "Days", align: "right", value: (r) => `${r.days_present} + ${r.weekly_offs} off` },
          { key: "overtime_min", header: "OT", align: "right", value: (r) => `${Math.round(r.overtime_min / 60)}h`, hideSm: true },
          { key: "gross", header: "Gross", align: "right", cell: (r) => <Money value={r.gross} /> },
          { key: "overtime_pay", header: "OT pay", align: "right", cell: (r) => <Money value={r.overtime_pay} />, hideSm: true },
          { key: "delivery_earnings", header: "Delivery", align: "right", cell: (r) => <Money value={r.delivery_earnings} />, hideSm: true },
          { key: "advances", header: "Advances", align: "right", cell: (r) => <Money value={-r.advances} /> },
          { key: "net", header: "Net pay", align: "right", cell: (r) => <Money value={r.net} className="font-semibold" /> },
          { key: "paid", header: "", cell: (r) => (r.paid ? <Chip tone="ok">Paid</Chip> : <Button size="sm" variant="primary" loading={pay.isPending && pay.variables === r.user_id} onClick={() => pay.mutate(r.user_id)}>Mark paid</Button>) },
        ]} />
      <p className="text-xs text-mute">In-house riders get their delivery charges added on salary day. Statutory payroll (PF/ESI) is Phase 2.</p>
    </>
  );
}

function Advances() {
  const staff = useQ<Row[]>("/staff", { auth: "staff" });
  const rows = useQ<Advance[]>("/advances", { auth: "staff" });
  const [f, setF] = useState<{ user_id: string; amount: number; note: string } | null>(null);
  const save = useM(() => staffApi.advance(f!), { success: "Advance recorded", onSuccess: () => setF(null) });
  return (
    <>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} toolbar={<Button size="sm" variant="primary" onClick={() => setF({ user_id: staff.data?.[1]?.id ?? "", amount: 100000, note: "" })}>+ Advance</Button>}
        columns={[{ key: "given_on", header: "Date", value: (r) => fmtDate(r.given_on) }, { key: "user", header: "Staff", value: (r) => staff.data?.find((s) => s.id === r.user_id)?.name }, { key: "note", header: "Note" }, { key: "amount", header: "Amount", align: "right", cell: (r) => <Money value={r.amount} /> }, { key: "recovered", header: "", cell: (r) => <Chip tone={r.recovered ? "ok" : "warn"}>{r.recovered ? "Recovered" : "Due"}</Chip> }]} />
      <Modal open={!!f} onClose={() => setF(null)} title="Salary advance" footer={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>}>
        {f && <div className="grid gap-3"><Field label="Staff"><Select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}>{staff.data?.filter((s) => s.role !== "owner").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field><Field label="Amount"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field><Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>}
      </Modal>
    </>
  );
}

function StaffSales() {
  const [from, setFrom] = useState(todayISO().slice(0, 8) + "01");
  const rows = useQ<{ user_id: string; name: string; role: RoleKey; orders: number; sales: number; tips: number; average: number }[]>("/reports/staff-sales", { auth: "staff", query: { from, to: todayISO() } });
  return (
    <>
      <div className="flex items-center gap-2 text-sm">From <Input type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} /> to today</div>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.user_id} exportName="staff-sales" columns={[{ key: "name", header: "Staff", cell: (r) => <b>{r.name}</b> }, { key: "role", header: "Role", value: (r) => ROLE_LABEL[r.role] }, { key: "orders", header: "Bills", align: "right" }, { key: "sales", header: "Sales", align: "right", cell: (r) => <Money value={r.sales} /> }, { key: "average", header: "Avg bill", align: "right", cell: (r) => <Money value={r.average} /> }, { key: "tips", header: "Tips", align: "right", cell: (r) => <Money value={r.tips} /> }]} />
    </>
  );
}
