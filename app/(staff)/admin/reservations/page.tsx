"use client";

import { useState } from "react";
import { dineinApi } from "@/modules/dinein/api";
import { useM, useQ } from "@/shared/api/hooks";
import { ago, label, todayISO } from "@/shared/lib/format";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { Floor } from "@/shared/types/api";
import type { Reservation, WaitlistEntry } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { FormModal } from "@/shared/ui/form";
import { Button, Card, Chip, Input, Label, PageTitle, Select } from "@/shared/ui/primitives";

/** Reservations (M2.6) and waitlist (M2.7) for the receptionist. Messages go out as click-to-WhatsApp links. */
export default function ReservationsAdmin() {
  useTitle("Reservations");
  const [date, setDate] = useState(todayISO());
  const res = useQ<Reservation[]>("/reservations", { auth: "staff", query: { date }, live: true });
  const wait = useQ<WaitlistEntry[]>("/waitlist", { auth: "staff", live: true });
  const floor = useQ<Floor>("/floor", { auth: "staff", live: true });
  const [newRes, setNewRes] = useState<Record<string, unknown> | null>(null);
  const [newWait, setNewWait] = useState<Record<string, unknown> | null>(null);
  const openWa = (url: string | null) => url && window.open(url, "_blank", "noopener");
  const create = useM((v: Record<string, unknown>) => dineinApi.reserve(v), { success: "Reservation saved", onSuccess: (r) => { setNewRes(null); openWa(r.whatsapp_url); } });
  const upd = useM(({ id, b }: { id: string; b: Partial<Reservation> }) => dineinApi.updateReservation(id, b), { onSuccess: (r) => openWa(r.whatsapp_url) });
  const addWait = useM((v: Record<string, unknown>) => dineinApi.addWaitlist(v as never), { success: "Added to waitlist", onSuccess: () => setNewWait(null) });
  const notify = useM((id: string) => dineinApi.notifyWaitlist(id), { onSuccess: (r) => openWa(r.whatsapp_url) });
  const seat = useM(({ id, t }: { id: string; t: string }) => dineinApi.seatWaitlist(id, t), { success: "Seated" });
  const left = useM((id: string) => dineinApi.leftWaitlist(id));
  const free = floor.data?.tables.filter((t) => ["free", "cleaning", "reserved"].includes(t.status)) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Reservations & waitlist" actions={<><Button onClick={() => setNewWait({ party_size: 2 })}>+ Walk-in to waitlist</Button><Button variant="primary" onClick={() => setNewRes({ date, time: "20:00", party_size: 2 })}>+ Reservation</Button></>} />
      <Card className="flex flex-col gap-2">
        <Label>Waitlist · {wait.data?.length ?? 0} waiting</Label>
        {wait.data?.map((w, i) => (
          <div key={w.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="num w-6 text-mute">{i + 1}.</span>
            <b className="w-36">{w.name}</b><span>{w.party_size} pax</span><span className="text-mute">{w.phone}</span>
            <Chip tone={w.status === "notified" ? "ok" : "warn"}>{w.status === "notified" ? "Told table is ready" : `~${w.quoted_wait_min} min · waiting ${ago(w.created_at)}`}</Chip>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" onClick={() => notify.mutate(w.id)}>Table ready message</Button>
              <Select className="w-32" value="" onChange={(e) => e.target.value && seat.mutate({ id: w.id, t: e.target.value })} aria-label="Seat at table"><option value="">Seat at…</option>{free.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.seats})</option>)}</Select>
              <Button size="sm" variant="ghost" onClick={() => left.mutate(w.id)}>Left</Button>
            </div>
          </div>
        ))}
        {!wait.data?.length && <span className="text-sm text-mute">Nobody waiting.</span>}
      </Card>
      <div className="flex items-center gap-2"><Label>Reservations on</Label><Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <DataTable rows={res.data ?? []} rowKey={(r) => r.id}
        columns={[
          { key: "time", header: "Time" },
          { key: "name", header: "Guest", cell: (r) => <span><b>{r.name}</b><span className="block text-xs text-mute">{r.phone}</span></span> },
          { key: "party_size", header: "Pax" },
          { key: "table", header: "Table", cell: (r) => (
            <Select className="w-28" value={r.table_id ?? ""} onChange={(e) => upd.mutate({ id: r.id, b: { table_id: e.target.value || null } })} aria-label="Table">
              <option value="">—</option>{floor.data?.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          ) },
          { key: "notes", header: "Notes", value: (r) => [r.table_preference, r.notes].filter(Boolean).join(" · ") || "—", hideSm: true },
          { key: "status", header: "Status", cell: (r) => <Chip tone={r.status === "confirmed" ? "ok" : r.status === "no_show" || r.status === "cancelled" ? "hot" : r.status === "seated" ? "info" : "warn"}>{label(r.status)}</Chip> },
          { key: "actions", header: "", cell: (r) => ["booked", "confirmed"].includes(r.status) ? (
            <div className="flex flex-wrap gap-1">
              {r.status === "booked" && <Button size="sm" onClick={() => upd.mutate({ id: r.id, b: { status: "confirmed" } })}>Confirm</Button>}
              <Button size="sm" variant="primary" disabled={!r.table_id} onClick={() => upd.mutate({ id: r.id, b: { status: "seated" } })}>Seat</Button>
              <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: r.id, b: { status: "no_show" } })}>No-show</Button>
              <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: r.id, b: { status: "cancelled" } })}>Cancel</Button>
            </div>
          ) : null },
        ]} />
      <FormModal open={!!newRes} title="New reservation" initial={newRes} onClose={() => setNewRes(null)} onSave={(v) => create.mutate(v)} saving={create.isPending} error={create.error}
        fields={[
          { name: "name", label: "Guest name", type: "text", required: true },
          { name: "phone", label: "Mobile", type: "tel", required: true },
          { name: "date", label: "Date", type: "date", required: true },
          { name: "time", label: "Time", type: "time", required: true },
          { name: "party_size", label: "Party size", type: "number", min: 1, required: true },
          { name: "table_id", label: "Table", type: "select", options: (floor.data?.tables ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.seats})` })), empty: "Assign later" },
          { name: "table_preference", label: "Table preference", type: "text" },
          { name: "notes", label: "Notes", type: "textarea" },
        ]} />
      <FormModal open={!!newWait} title="Add to waitlist" initial={newWait} onClose={() => setNewWait(null)} onSave={(v) => addWait.mutate(v)} saving={addWait.isPending} error={addWait.error}
        fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "phone", label: "Mobile", type: "tel", required: true }, { name: "party_size", label: "Party size", type: "number", min: 1, required: true }, { name: "quoted_wait_min", label: "Estimated wait (min)", type: "number", hint: "Leave blank to estimate from the queue" }]} />
    </div>
  );
}
