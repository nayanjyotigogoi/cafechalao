"use client";

import Link from "next/link";
import { useState } from "react";
import { deliveryApi } from "@/modules/delivery/api";
import { useM, useQ } from "@/shared/api/hooks";
import { fmtTime, label, minsSince } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { DeliveryRow } from "@/shared/types/api";
import type { Rider } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { FormModal, type Values } from "@/shared/ui/form";
import { Button, Card, Chip, Label, Money, PageTitle, Segmented, Select } from "@/shared/ui/primitives";

/**
 * Delivery and rider tab (M8): own staff and freelance riders, assignment by owner/manager, settlement at day close.
 * Live GPS tracking, zones and automatic split payouts are Phase 3.
 */
export default function DeliveryAdmin() {
  useTitle("Delivery");
  const s = useSettings();
  const [tab, setTab] = useState<"live" | "riders" | "settle">("live");
  const live = useQ<DeliveryRow[]>("/deliveries", { auth: "staff", query: { active: 1 }, live: true });
  const riders = useQ<Rider[]>("/riders", { auth: "staff" });
  const settle = useQ<{ rider_id: string; name: string; type: string; deliveries: number; cash_collected: number; upi_collected: number; charges_earned: number; net: number; settled: boolean }[]>(tab === "settle" ? "/rider-settlements" : null, { auth: "staff" });
  const [e, setE] = useState<Values | null>(null);
  const save = useM((v: Values) => deliveryApi.saveRider(v), { success: "Rider saved", onSuccess: () => setE(null) });
  const assign = useM(({ id, r }: { id: string; r: string[] }) => deliveryApi.assign(id, r), { success: "Request sent" });
  const doSettle = useM((id: string) => deliveryApi.settle(id), { success: "Settled" });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Delivery" sub={`Mode: ${label(s.delivery.mode)} riders · charge ${s.delivery.charge_type === "flat" ? formatINR(s.delivery.flat_charge) + " flat" : "by order value"} · the delivery charge goes to the rider.`} actions={<Link href="/admin/settings?tab=delivery"><Button>Delivery settings</Button></Link>} />
      <Segmented value={tab} onChange={setTab} options={[{ value: "live", label: "Live", count: live.data?.length }, { value: "riders", label: "Riders" }, { value: "settle", label: "Today's settlement" }]} />
      {tab === "live" && (
        <div className="grid gap-3 lg:grid-cols-2">
          {live.data?.map((d) => (
            <Card key={d.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2"><b>{d.order?.number}</b><Chip tone={d.status === "unassigned" ? "hot" : d.status === "requested" ? "warn" : "info"}>{label(d.status)}</Chip><span className="text-xs text-mute">kitchen: {label(d.order?.status ?? "")} · {minsSince(d.created_at)}m</span><span className="num ml-auto">{formatINR(d.order?.total ?? 0)}</span></div>
              <div className="text-sm">{d.order?.customer_name} · {d.order?.address_text}</div>
              <div className="text-xs text-mute">{d.distance_km} km · charge {formatINR(d.charge)} · {d.to_collect ? `collect ${formatINR(d.to_collect)} (${label(d.order?.payment_method ?? "")})` : "prepaid"}</div>
              <div className="flex items-center gap-2">
                {d.rider_name && <Chip tone="info">🛵 {d.rider_name}</Chip>}
                {!["picked_up", "on_the_way"].includes(d.status) && (
                  <Select className="max-w-xs" value="" onChange={(ev) => assign.mutate({ id: d.id, r: ev.target.value === "all" ? (riders.data ?? []).filter((r) => r.online && r.active).map((r) => r.id) : ev.target.value === "freelance" ? (riders.data ?? []).filter((r) => r.type === "freelance" && r.online).map((r) => r.id) : [ev.target.value] })} aria-label="Assign rider">
                    <option value="">{d.status === "requested" ? "Waiting for accept… reassign" : "Assign rider"}</option>
                    {riders.data?.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.type}){r.online ? "" : " · offline"}</option>)}
                    <option value="freelance">All online freelancers</option>
                    <option value="all">All online riders</option>
                  </Select>
                )}
              </div>
            </Card>
          ))}
          {!live.data?.length && <Card className="text-sm text-mute">No deliveries in progress.</Card>}
        </div>
      )}
      {tab === "riders" && (
        <>
          <DataTable rows={riders.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => setE(r as unknown as Values)} toolbar={<Button size="sm" variant="primary" onClick={() => setE({ type: "own", active: true })}>+ Rider</Button>}
            columns={[{ key: "name", header: "Rider", cell: (r) => <b>{r.name}</b> }, { key: "phone", header: "Phone (login)" }, { key: "type", header: "Type", value: (r) => (r.type === "own" ? "Own staff" : "Freelance") }, { key: "vehicle", header: "Vehicle", hideSm: true }, { key: "id_document", header: "ID", hideSm: true }, { key: "online", header: "Now", cell: (r) => <Chip tone={r.online ? "ok" : "neutral"}>{r.online ? "Online" : "Offline"}</Chip> }]} />
          <FormModal open={!!e} title="Rider" initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} error={save.error}
            fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "phone", label: "Phone (they log in with OTP)", type: "tel", required: true }, { name: "type", label: "Type", type: "select", options: [{ value: "own", label: "Own staff (paid on salary day)" }, { value: "freelance", label: "Freelance (paid daily)" }], required: true }, { name: "vehicle", label: "Vehicle", type: "text" }, { name: "id_document", label: "ID document", type: "text" }, { name: "active", label: "Active", type: "toggle" }]} />
        </>
      )}
      {tab === "settle" && (
        <DataTable rows={settle.data ?? []} rowKey={(r) => r.rider_id} exportName="rider-settlement"
          columns={[{ key: "name", header: "Rider", cell: (r) => <b>{r.name}</b> }, { key: "type", header: "Type" }, { key: "deliveries", header: "Deliveries", align: "right" }, { key: "cash_collected", header: "Cash collected", align: "right", cell: (r) => <Money value={r.cash_collected} /> }, { key: "upi_collected", header: "UPI", align: "right", cell: (r) => <Money value={r.upi_collected} /> }, { key: "charges_earned", header: "Charges owed", align: "right", cell: (r) => <Money value={r.charges_earned} /> }, { key: "net", header: "Net", align: "right", cell: (r) => <span className={r.net >= 0 ? "text-ok" : "text-rose"}>{r.net >= 0 ? `Rider pays ${formatINR(r.net)}` : `Pay rider ${formatINR(-r.net)}`}</span> }, { key: "x", header: "", cell: (r) => (r.settled ? <Chip tone="ok">Settled</Chip> : <Button size="sm" variant="primary" onClick={() => doSettle.mutate(r.rider_id)}>Settle</Button>) }]} />
      )}
      <Label>Delivery times and rider totals are in Reports → Delivery. Last updated {fmtTime(new Date().toISOString())}.</Label>
    </div>
  );
}
