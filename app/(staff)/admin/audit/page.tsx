"use client";

import { useState } from "react";
import { useQ } from "@/shared/api/hooks";
import { daysAgoISO, fmtDateTime, label, todayISO } from "@/shared/lib/format";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { AuditLog } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { Input, PageTitle, Select } from "@/shared/ui/primitives";

/** Append-only audit log (M10.3): voids, discounts, refunds, price changes, reprints, deletions, settings, support access. */
const ACTIONS = ["void", "discount", "refund", "price_change", "reprint", "delete", "setting_change", "support_access", "cash_variance", "cancel", "salary_paid", "approve", "reject"];

export default function AuditPage() {
  useTitle("Audit log");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState(daysAgoISO(30));
  const rows = useQ<AuditLog[]>("/audit-logs", { auth: "staff", query: { action, from, to: todayISO() } });
  const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null).map(([k, x]) => `${k}: ${typeof x === "number" && /price|amount|total|cash/.test(k) ? `₹${x / 100}` : String(x)}`).join(", ") : String(v));
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Audit log" sub="Every sensitive action with who, when, which device, old value and new value. Entries can't be edited or deleted." />
      <div className="flex flex-wrap gap-2">
        <Select className="w-48" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action"><option value="">All actions</option>{ACTIONS.map((a) => <option key={a} value={a}>{label(a)}</option>)}</Select>
        <Input type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
      </div>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} search exportName="audit-log" dense
        columns={[
          { key: "created_at", header: "When", value: (r) => fmtDateTime(r.created_at) },
          { key: "user_name", header: "Who" },
          { key: "action", header: "Action", value: (r) => label(r.action) },
          { key: "entity", header: "On", value: (r) => label(r.entity) },
          { key: "old_value", header: "Old", value: (r) => show(r.old_value), className: "max-w-xs text-xs text-mute" },
          { key: "new_value", header: "New", value: (r) => show(r.new_value), className: "max-w-xs text-xs" },
          { key: "device", header: "Device", hideSm: true },
        ]} />
    </div>
  );
}
