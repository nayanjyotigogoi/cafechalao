"use client";

import Link from "next/link";
import { useState } from "react";
import { ordersApi } from "@/modules/orders/api";
import { useM, useQ } from "@/shared/api/hooks";
import { fmtDateTime, fmtTime, label, todayISO } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { OrderDetail, OrderListRow } from "@/shared/types/api";
import { DataTable } from "@/shared/ui/data";
import { ConfirmButton, Modal } from "@/shared/ui/overlay";
import { Button, Chip, Input, Label, Loading, Money, PageTitle, Select } from "@/shared/ui/primitives";

/** All orders with filters by date, status, type and channel; detail with status history. */
export default function OrdersAdmin() {
  useTitle("Orders");
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useQ<OrderListRow[]>("/orders", { auth: "staff", query: { date, type, channel, status, limit: 500 }, live: true });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Orders" sub="Every order from POS, captain, table QR and the online app." />
      <div className="flex flex-wrap gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" aria-label="Date" />
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40" aria-label="Type"><option value="">All types</option>{["dine_in", "takeaway", "delivery", "counter"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-40" aria-label="Channel"><option value="">All channels</option>{["pos", "captain", "qr", "app"].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status"><option value="">Any status</option>{["placed", "accepted", "preparing", "ready", "out_for_delivery", "completed", "cancelled"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>
      </div>
      {rows.isLoading ? <Loading /> : (
        <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)} search exportName={`orders-${date}`}
          columns={[
            { key: "number", header: "Order", cell: (r) => <b>{r.number}</b> },
            { key: "created_at", header: "Time", value: (r) => fmtTime(r.created_at) },
            { key: "type", header: "Type", value: (r) => `${label(r.type)}${r.table_name ? ` · ${r.table_name}` : ""}` },
            { key: "channel", header: "Channel", value: (r) => r.channel.toUpperCase(), hideSm: true },
            { key: "customer_name", header: "Customer", value: (r) => r.customer_name ?? "—", hideSm: true },
            { key: "status", header: "Status", value: (r) => r.status, cell: (r) => <Chip tone={r.status === "completed" ? "ok" : r.status === "cancelled" ? "hot" : "warn"}>{label(r.status)}</Chip> },
            { key: "payment_status", header: "Payment", value: (r) => r.payment_status, cell: (r) => <span className={r.payment_status === "paid" ? "text-ok" : "text-mute"}>{label(r.payment_status)}</span>, hideSm: true },
            { key: "total", header: "Total", align: "right", value: (r) => r.total / 100, cell: (r) => <Money value={r.total} /> },
          ]} />
      )}
      {open && <OrderModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function OrderModal({ id, onClose }: { id: string; onClose: () => void }) {
  const o = useQ<OrderDetail>(`/orders/${id}`, { auth: "staff" });
  const cancel = useM((reason: string) => ordersApi.cancel(id, reason, "staff"), { success: "Order cancelled" });
  const d = o.data;
  return (
    <Modal open onClose={onClose} title={d ? `${d.number} · ${label(d.type)}` : "Order"} wide>
      {!d ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5 text-sm">
            <Label>Items</Label>
            {d.items.map((i) => <div key={i.id} className={`flex justify-between ${i.status === "void" ? "text-mute line-through" : ""}`}><span>{i.qty}× {i.name}{i.variant_name ? ` (${i.variant_name})` : ""}{i.note ? ` · ${i.note}` : ""}</span><Money value={i.unit_price * i.qty} /></div>)}
            <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold"><span>Total</span><span className="num">{formatINR(d.total, { decimals: true })}</span></div>
            <div className="text-mute">Subtotal {formatINR(d.subtotal)} · discount {formatINR(d.discount)} · tax {formatINR(d.tax, { decimals: true })}{d.delivery_charge ? ` · delivery ${formatINR(d.delivery_charge)}` : ""}</div>
            {d.customer_name && <div>Customer: {d.customer_name} {d.customer_phone}</div>}
            {d.address_text && <div>Address: {d.address_text}</div>}
            {d.delivery && <div>Rider: {d.delivery.rider?.name ?? "not assigned"} · {label(d.delivery.status)}</div>}
            {d.feedback && <div>Rating: food {d.feedback.food}★ service {d.feedback.service}★ · “{d.feedback.comment}”</div>}
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <Label>History</Label>
            {d.status_log.map((l) => <div key={l.id} className="flex justify-between"><span>{label(l.status)}{l.note ? ` · ${l.note}` : ""}</span><span className="text-mute">{fmtDateTime(l.created_at)}</span></div>)}
            <Label>Payments</Label>
            {d.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{label(p.mode)} · {p.status}</span><Money value={p.amount} /></div>)}
            <div className="mt-2 flex flex-wrap gap-2">
              {d.invoice && <Link href={`/bill/${d.invoice.id}`} target="_blank"><Button size="sm">Invoice {d.invoice.number}</Button></Link>}
              {!["completed", "cancelled"].includes(d.status) && <ConfirmButton size="sm" variant="danger" confirm={`Cancel ${d.number}? ${d.payment_status === "paid" ? "It is paid: record a refund from the bill." : ""}`} onConfirm={async () => { await cancel.mutateAsync("Cancelled by staff"); }}>Cancel order</ConfirmButton>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
