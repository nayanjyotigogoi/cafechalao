"use client";

import { useState } from "react";
import { inventoryApi } from "@/modules/inventory/api";
import { useM, useQ } from "@/shared/api/hooks";
import { ago, label } from "@/shared/lib/format";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { Approval } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { Button, Card, Chip, Empty, Money, PageTitle, Segmented } from "@/shared/ui/primitives";

/** One approval queue for purchase requests, POs, expenses and attendance corrections (Core/Approvals). */
type Row = Approval & { requested_by_name: string; decided_by_name: string | null; can_decide: boolean };

export default function ApprovalsPage() {
  useTitle("Approvals");
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const rows = useQ<Row[]>("/approvals", { auth: "staff", query: { status: tab }, live: true });
  const decide = useM(({ id, d }: { id: string; d: "approve" | "reject" }) => inventoryApi.decide(id, d), { success: "Done" });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Approvals" sub="Anything above a role's limit waits here for a manager or the owner. Discounts and voids at the POS are approved on the spot with a PIN." />
      <Segmented value={tab} onChange={setTab} options={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]} />
      {tab === "pending" ? (
        <div className="flex flex-col gap-2">
          {!rows.data?.length && <Empty title="Nothing waiting for you" />}
          {rows.data?.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center gap-3">
              <Chip>{label(a.kind)}</Chip>
              <span className="min-w-0 flex-1 text-sm"><b>{a.summary}</b><span className="block text-xs text-mute">by {a.requested_by_name} · {ago(a.created_at)} · needs {label(a.required_role)}</span></span>
              {a.amount > 0 && <Money value={a.amount} className="text-lg font-semibold" />}
              {a.can_decide ? (
                <div className="flex gap-2"><Button variant="danger" onClick={() => decide.mutate({ id: a.id, d: "reject" })}>Reject</Button><Button variant="primary" onClick={() => decide.mutate({ id: a.id, d: "approve" })}>Approve</Button></div>
              ) : <span className="text-xs text-mute">Waiting for {a.required_role}</span>}
            </Card>
          ))}
        </div>
      ) : (
        <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} columns={[{ key: "kind", header: "Type", value: (r) => label(r.kind) }, { key: "summary", header: "Request" }, { key: "amount", header: "Amount", align: "right", cell: (r) => <Money value={r.amount} /> }, { key: "requested_by_name", header: "Asked by" }, { key: "decided_by_name", header: "Decided by" }, { key: "decided_at", header: "When", value: (r) => ago(r.decided_at) }]} />
      )}
    </div>
  );
}
