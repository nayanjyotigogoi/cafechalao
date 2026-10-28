"use client";

import { useState } from "react";
import { expensesApi } from "@/modules/expenses/api";
import { useM, useQ } from "@/shared/api/hooks";
import { useStaff } from "@/shared/auth/session";
import { cx, fmtDate, label, todayISO } from "@/shared/lib/format";
import { compressImage } from "@/shared/lib/image";
import { formatINR } from "@/shared/lib/money";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { Expense, ExpenseCategory } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { FormModal, type Values } from "@/shared/ui/form";
import { Modal } from "@/shared/ui/overlay";
import { Button, Chip, Field, Input, Money, MoneyInput, PageTitle, ProgressBar, Segmented, Stat } from "@/shared/ui/primitives";

/** Expenses and budget (M6): categories, daily expenses and petty cash with bill photo, approval by limit, budget vs actual. */
export default function ExpensesAdmin() {
  useTitle("Expenses");
  const { can } = useStaff();
  const [tab, setTab] = useState<"expenses" | "petty" | "budget">("expenses");
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const cats = useQ<ExpenseCategory[]>("/expense-categories", { auth: "staff" });
  const rows = useQ<(Expense & { category: string })[]>("/expenses", { auth: "staff", query: { month, petty: tab === "petty" ? 1 : undefined } });
  const budgets = useQ<{ category_id: string; category: string; budget: number; actual: number; variance: number; variance_pct: number | null }[]>("/budgets", { auth: "staff", query: { month } });
  const [e, setE] = useState<Values | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [bud, setBud] = useState<{ category_id: string; category: string; amount: number } | null>(null);
  const save = useM((v: Values) => expensesApi.create({ ...(v as unknown as Parameters<typeof expensesApi.create>[0]), bill_photo_url: photo, petty_cash: tab === "petty" || !!v.petty_cash }), { success: (r: unknown) => ((r as Expense).status === "pending" ? "Sent for approval (above your limit)" : "Expense saved"), onSuccess: () => { setE(null); setPhoto(null); } });
  const del = useM((id: string) => expensesApi.remove(id), { success: "Removed" });
  const setBudget = useM(() => expensesApi.setBudget({ month, category_id: bud!.category_id, amount: bud!.amount }), { success: "Budget saved", onSuccess: () => setBud(null) });
  const total = (rows.data ?? []).filter((x) => x.status === "approved").reduce((s, x) => s + x.amount, 0);
  const budTotal = (budgets.data ?? []).reduce((s, b) => s + b.budget, 0);
  const actTotal = (budgets.data ?? []).reduce((s, b) => s + b.actual, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Expenses & budget" actions={<><Input type="month" value={month} onChange={(ev) => setMonth(ev.target.value)} className="w-40" aria-label="Month" /><Button variant="primary" onClick={() => setE({ spent_on: todayISO(), mode: tab === "petty" ? "cash" : "upi" })}>+ Expense</Button></>} />
      <Segmented value={tab} onChange={setTab} options={[{ value: "expenses", label: "All expenses" }, { value: "petty", label: "Petty cash book" }, { value: "budget", label: "Budget vs actual" }]} />
      {tab !== "budget" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3"><Stat label="Approved this month" value={formatINR(total)} /><Stat label="Waiting for approval" value={(rows.data ?? []).filter((x) => x.status === "pending").length} tone={(rows.data ?? []).some((x) => x.status === "pending") ? "warn" : undefined} /></div>
          <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} search exportName={`expenses-${month}`}
            columns={[
              { key: "spent_on", header: "Date", value: (r) => fmtDate(r.spent_on) },
              { key: "category", header: "Category" },
              { key: "note", header: "Note" },
              { key: "mode", header: "Mode", value: (r) => r.mode.toUpperCase(), hideSm: true },
              { key: "bill", header: "Bill", cell: (r) => r.bill_photo_url ? <a href={r.bill_photo_url} target="_blank" rel="noreferrer" className="text-brand underline">Photo</a> : "—", hideSm: true },
              { key: "status", header: "Status", cell: (r) => <Chip tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "hot" : "warn"}>{label(r.status)}</Chip> },
              { key: "amount", header: "Amount", align: "right", value: (r) => r.amount / 100, cell: (r) => <Money value={r.amount} /> },
              { key: "x", header: "", cell: (r) => (r.status !== "approved" || can("expenses.approve")) && <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}>×</Button> },
            ]} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3"><Stat label="Budget" value={formatINR(budTotal)} /><Stat label="Actual" value={formatINR(actTotal)} tone={actTotal > budTotal ? "hot" : undefined} /><Stat label="Variance" value={`${formatINR(actTotal - budTotal)} (${budTotal ? (((actTotal - budTotal) / budTotal) * 100).toFixed(0) : 0}%)`} /></div>
          <DataTable rows={budgets.data ?? []} rowKey={(r) => r.category_id} exportName={`budget-${month}`}
            columns={[
              { key: "category", header: "Category", cell: (r) => <b>{r.category}</b> },
              { key: "budget", header: "Budget", align: "right", value: (r) => r.budget / 100, cell: (r) => <Money value={r.budget} /> },
              { key: "actual", header: "Actual", align: "right", value: (r) => r.actual / 100, cell: (r) => <Money value={r.actual} /> },
              { key: "bar", header: "Used", cell: (r) => <div className="w-32"><ProgressBar value={r.budget ? (r.actual / r.budget) * 100 : 0} tone={r.actual > r.budget ? "hot" : r.actual > r.budget * 0.8 ? "warn" : "ok"} /></div> },
              { key: "variance", header: "Variance ₹", align: "right", value: (r) => r.variance / 100, cell: (r) => <span className={cx("num", r.variance > 0 ? "text-rose" : "text-ok")}>{formatINR(r.variance)}</span> },
              { key: "variance_pct", header: "Variance %", align: "right", value: (r) => r.variance_pct ?? 0, cell: (r) => r.variance_pct == null ? "—" : <span className={cx("num", r.variance_pct > 0 ? "text-rose" : "text-ok")}>{r.variance_pct.toFixed(0)}%</span> },
              { key: "x", header: "", cell: (r) => can("expenses.approve") && <Button size="sm" variant="ghost" onClick={() => setBud({ category_id: r.category_id, category: r.category, amount: r.budget })}>Set</Button> },
            ]} />
        </>
      )}
      <FormModal open={!!e} title={tab === "petty" ? "Petty cash entry" : "New expense"} initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} error={save.error}
        fields={[
          { name: "category_id", label: "Category", type: "select", options: (cats.data ?? []).map((c) => ({ value: c.id, label: c.name })), required: true },
          { name: "amount", label: "Amount", type: "money", required: true },
          { name: "mode", label: "Paid by", type: "select", options: ["cash", "upi", "bank", "card"].map((m) => ({ value: m, label: m.toUpperCase() })), required: true },
          { name: "spent_on", label: "Date", type: "date", required: true },
          { name: "note", label: "Note", type: "text", full: true },
          ...(tab === "petty" ? [] : [{ name: "petty_cash", label: "Paid from petty cash", type: "toggle" as const }]),
        ]}
        extra={<Field label="Bill photo"><input type="file" accept="image/*" capture="environment" onChange={async (ev) => { const f = ev.target.files?.[0]; if (f) setPhoto(await compressImage(f, 150, 1000)); }} />{photo && <img src={photo} alt="Bill" className="mt-2 h-24 rounded-lg object-cover" />}</Field>} />
      <Modal open={!!bud} onClose={() => setBud(null)} title={`Budget · ${bud?.category} · ${month}`} footer={<Button variant="primary" loading={setBudget.isPending} onClick={() => setBudget.mutate(undefined)}>Save</Button>}>
        {bud && <MoneyInput value={bud.amount} onChange={(v) => setBud({ ...bud, amount: v })} />}
      </Modal>
    </div>
  );
}
