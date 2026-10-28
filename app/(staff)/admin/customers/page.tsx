"use client";

import { useState } from "react";
import { customersApi } from "@/modules/customers/api";
import { CustomerPicker } from "@/modules/customers/components/CustomerPicker";
import { marketingApi } from "@/modules/marketing/api";
import { useM, useQ } from "@/shared/api/hooks";
import { useStaff } from "@/shared/auth/session";
import { fmtDate, label } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { Customer, CustomerTag, Feedback, GiftCard, LoyaltyLedger, Membership, MembershipPlan, Order } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { Modal } from "@/shared/ui/overlay";
import { Button, Card, Chip, Field, Input, Label, Loading, Money, PageTitle, Select, Stat } from "@/shared/ui/primitives";

/**
 * Customer database (M4.1). These are this café's own customers: nobody else, CafeChalao included,
 * can see them without the owner's time-limited support access.
 */
export default function CustomersAdmin() {
  useTitle("Customers");
  const { can } = useStaff();
  const [tag, setTag] = useState<CustomerTag | "">("");
  const list = useQ<Customer[]>(can("customers.view") ? "/customers" : null, { auth: "staff", query: { tag } });
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Customers" sub="Profiles, visits, spend, favourites and tags. Your data, kept separate from every other café." actions={can("customers.create") && <Button variant="primary" onClick={() => setAdd(true)}>+ Walk-in profile</Button>} />
      {!can("customers.view") ? <Card className="text-sm text-mute">Your role can add walk-in profiles but not browse the database.</Card> : (
        <DataTable rows={list.data ?? []} rowKey={(r) => r.id} search exportName="customers" onRowClick={(r) => setOpen(r.id)}
          toolbar={<div className="flex gap-1">{(["", "vip", "regular", "new", "lapsed"] as const).map((t) => <Chip key={t} onClick={() => setTag(t)} active={tag === t}>{t ? label(t) : "All"}</Chip>)}</div>}
          columns={[
            { key: "name", header: "Name", cell: (r) => <b>{r.name}</b> },
            { key: "phone", header: "Mobile", value: (r) => r.phone ?? "—" },
            { key: "visits", header: "Visits", align: "right" },
            { key: "total_spend", header: "Spend", align: "right", value: (r) => r.total_spend / 100, cell: (r) => <Money value={r.total_spend} /> },
            { key: "avg", header: "Avg bill", align: "right", hideSm: true, value: (r) => (r.visits ? r.total_spend / r.visits / 100 : 0), cell: (r) => <Money value={r.visits ? Math.round(r.total_spend / r.visits) : 0} /> },
            { key: "loyalty_points", header: "Points", align: "right", hideSm: true },
            { key: "last_visit_at", header: "Last visit", value: (r) => fmtDate(r.last_visit_at), hideSm: true },
            { key: "tags", header: "Tags", value: (r) => r.tags.join(" "), cell: (r) => <div className="flex gap-1">{r.tags.map((t) => <Chip key={t} tone={t === "vip" ? "warn" : t === "lapsed" ? "hot" : "neutral"}>{t}</Chip>)}</div> },
            { key: "source", header: "Source", value: (r) => label(r.source), hideSm: true },
          ]} />
      )}
      {open && <CustomerModal id={open} onClose={() => setOpen(null)} />}
      <CustomerPicker open={add} onClose={() => setAdd(false)} onPick={(c) => can("customers.view") && setOpen(c.id)} />
    </div>
  );
}

type Detail = Customer & { average_bill: number; favourites: { name: string; qty: number }[]; orders: Order[]; loyalty: LoyaltyLedger[]; memberships: Membership[]; gift_cards: GiftCard[]; feedback: Feedback[] };

function CustomerModal({ id, onClose }: { id: string; onClose: () => void }) {
  const c = useQ<Detail>(`/customers/${id}`, { auth: "staff" });
  const plans = useQ<MembershipPlan[]>("/membership-plans", { auth: "staff" });
  const [pts, setPts] = useState({ points: 0, reason: "" });
  const [plan, setPlan] = useState("");
  const adjust = useM(() => customersApi.adjustPoints(id, pts.points, pts.reason), { success: "Points adjusted" });
  const sell = useM(() => marketingApi.sellMembership(id, plan), { success: "Membership added. Take the payment at the POS." });
  const tag = useM((tags: CustomerTag[]) => customersApi.update(id, { tags }));
  const d = c.data;
  return (
    <Modal open onClose={onClose} title={d?.name ?? "Customer"} wide>
      {!d ? <Loading /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Visits" value={d.visits} />
            <Stat label="Total spend" value={formatINR(d.total_spend)} />
            <Stat label="Average bill" value={formatINR(d.average_bill)} />
            <Stat label="Points" value={d.loyalty_points} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1 text-sm">
              <Label>Profile</Label>
              <div>{d.phone} {d.phone_verified ? "✓" : "(not verified)"} · {d.email ?? "no email"}</div>
              <div>Birthday {fmtDate(d.birthday)}{d.anniversary ? ` · anniversary ${fmtDate(d.anniversary)}` : ""}</div>
              <div>Source {label(d.source)} · {d.google_id ? "Google account linked" : "No app login yet"} · marketing {d.marketing_consent ? "allowed" : "not allowed"}</div>
              <div>Favourites: {d.favourites.map((f) => `${f.name} (${f.qty})`).join(", ") || "—"}</div>
              <div className="mt-1 flex flex-wrap gap-1">{(["vip", "regular", "new", "lapsed"] as const).map((t) => <Chip key={t} onClick={() => tag.mutate(d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t])} active={d.tags.includes(t)}>{t}</Chip>)}</div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Loyalty adjustment</Label>
              <div className="flex gap-2"><Input type="number" className="w-24" value={pts.points || ""} onChange={(e) => setPts({ ...pts, points: Number(e.target.value) })} placeholder="±pts" /><Input value={pts.reason} onChange={(e) => setPts({ ...pts, reason: e.target.value })} placeholder="Reason" /><Button disabled={!pts.points || !pts.reason} loading={adjust.isPending} onClick={() => adjust.mutate(undefined)}>Apply</Button></div>
              <Label>Membership</Label>
              <div className="flex gap-2"><Select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">Choose plan…</option>{plans.data?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {formatINR(p.price)}</option>)}</Select><Button disabled={!plan} loading={sell.isPending} onClick={() => sell.mutate(undefined)}>Add</Button></div>
              {d.memberships.map((m) => <div key={m.id} className="text-xs text-mute">{plans.data?.find((p) => p.id === m.plan_id)?.name} · till {fmtDate(m.ends_on)} · {m.status}</div>)}
              {d.gift_cards.map((g) => <div key={g.id} className="num text-xs">{g.code} · {formatINR(g.balance)} left</div>)}
            </div>
          </div>
          <Card className="p-0">
            <DataTable rows={d.orders} rowKey={(r) => r.id} dense columns={[
              { key: "number", header: "Order" }, { key: "created_at", header: "Date", value: (r) => fmtDate(r.created_at) }, { key: "type", header: "Type", value: (r) => label(r.type) },
              { key: "status", header: "Status", value: (r) => label(r.status) }, { key: "total", header: "Total", align: "right", cell: (r) => <Money value={r.total} /> },
            ]} />
          </Card>
          {!!d.feedback.length && <div className="flex flex-col gap-1 text-sm"><Label>Feedback</Label>{d.feedback.map((f) => <div key={f.id}>{fmtDate(f.created_at)} · food {f.food}★ service {f.service}★ {f.comment && `· “${f.comment}”`}</div>)}</div>}
          <Field label="Note">
            <span className="text-xs text-mute">Customers can download or delete their own data from their profile (DPDP Act).</span>
          </Field>
        </div>
      )}
    </Modal>
  );
}
