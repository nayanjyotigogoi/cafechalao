"use client";

import { useState } from "react";
import { dineinApi } from "@/modules/dinein/api";
import { FloorGrid } from "@/modules/dinein/components/FloorGrid";
import { useM, useQ } from "@/shared/api/hooks";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { Floor } from "@/shared/types/api";
import type { Area, DiningTable } from "@/shared/types/entities";
import { FormModal } from "@/shared/ui/form";
import { Button, Card, Field, Input, Label, Loading, PageTitle, Segmented, Select } from "@/shared/ui/primitives";
import { QR } from "@/shared/ui/qr";

/** Floor and table setup (M2.1), table QR codes as a printable sheet (M2.3), and the shareable ordering link (M1.9). */
export default function TablesAdmin() {
  useTitle("Tables & QR");
  const s = useSettings();
  const floor = useQ<Floor>("/floor", { auth: "staff", live: true });
  const [tab, setTab] = useState<"floor" | "setup" | "qr" | "link">("floor");
  const [area, setArea] = useState<Partial<Area> | null>(null);
  const [table, setTable] = useState<Partial<DiningTable> | null>(null);
  const [bulk, setBulk] = useState({ area_id: "", count: 4, seats: 4 });
  const saveArea = useM((v: Record<string, unknown>) => dineinApi.saveArea(v as { name: string }), { success: "Area saved", onSuccess: () => setArea(null) });
  const saveTable = useM((v: Record<string, unknown>) => dineinApi.saveTable(v), { success: "Table saved", onSuccess: () => setTable(null) });
  const addBulk = useM(() => dineinApi.bulkTables({ ...bulk, area_id: bulk.area_id || floor.data!.areas[0].id }), { success: "Tables added" });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/?outlet=${s.tenant.slug}`;
  if (!floor.data) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Tables & QR" sub="Areas, tables, seats and the QR code on each table." />
      <Segmented value={tab} onChange={setTab} options={[{ value: "floor", label: "Live floor" }, { value: "setup", label: "Set up" }, { value: "qr", label: "Print QR codes" }, { value: "link", label: "Ordering link" }]} />
      {tab === "floor" && <FloorGrid floor={floor.data} onPick={(t) => setTable(t)} />}
      {tab === "setup" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {floor.data.areas.map((a) => (
            <Card key={a.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2"><b className="flex-1">{a.name}</b><Button size="sm" variant="ghost" onClick={() => setArea(a)}>Rename</Button></div>
              <div className="flex flex-wrap gap-2">
                {floor.data!.tables.filter((t) => t.area_id === a.id).map((t) => <Button key={t.id} size="sm" onClick={() => setTable(t)}>{t.name} · {t.seats}</Button>)}
                <Button size="sm" variant="soft" onClick={() => setTable({ area_id: a.id, name: "", seats: 4 })}>+ Table</Button>
              </div>
            </Card>
          ))}
          <Card className="flex flex-col gap-3">
            <Label>Add many tables</Label>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Area"><Select value={bulk.area_id} onChange={(e) => setBulk({ ...bulk, area_id: e.target.value })}>{floor.data.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
              <Field label="How many"><Input type="number" min={1} value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: Number(e.target.value) })} /></Field>
              <Field label="Seats each"><Input type="number" min={1} value={bulk.seats} onChange={(e) => setBulk({ ...bulk, seats: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex gap-2"><Button variant="primary" loading={addBulk.isPending} disabled={!floor.data.areas.length} onClick={() => addBulk.mutate(undefined)}>Add tables</Button><Button onClick={() => setArea({ name: "", sort: 99 })}>+ Area</Button></div>
          </Card>
        </div>
      )}
      {tab === "qr" && (
        <>
          <div className="no-print flex items-center gap-2"><p className="flex-1 text-sm text-mute">Each QR opens the menu tied to that table. Print on A4 and stick one per table.</p><Button variant="primary" onClick={() => window.print()}>Print / save PDF</Button></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
            {floor.data.tables.map((t) => (
              <div key={t.id} className="flex break-inside-avoid flex-col items-center gap-1 rounded-2xl border-[1.5px] border-line bg-white p-3 text-center text-black">
                <b className="text-sm">{s.outlet.name}</b>
                <QR value={`${origin}/t/${t.qr_code}?outlet=${s.tenant.slug}`} size={140} label={`QR for ${t.name}`} />
                <b className="text-lg">{t.name}</b>
                <span className="text-[11px]">Scan to see the menu and order</span>
                <span className="text-[9px] text-gray-500">Powered by CafeChalao</span>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "link" && (
        <Card className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <QR value={link} size={180} label="Online ordering QR" />
          <div className="flex flex-col gap-2">
            <b>Your online ordering link</b>
            <p className="text-sm text-mute">Share it on WhatsApp, in your Instagram bio and on your Google Business profile. Orders come straight to you with zero commission.</p>
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigator.clipboard?.writeText(link)}>Copy link</Button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`Order from ${s.outlet.name}: ${link}`)}`} target="_blank" rel="noreferrer"><Button>Share on WhatsApp</Button></a>
            </div>
          </div>
        </Card>
      )}
      <FormModal open={!!area} title="Area" initial={area} onClose={() => setArea(null)} onSave={(v) => saveArea.mutate(v)} saving={saveArea.isPending}
        fields={[{ name: "name", label: "Name (AC, outdoor, rooftop…)", type: "text", required: true }, { name: "sort", label: "Order", type: "number" }]} />
      <FormModal open={!!table} title={table?.id ? `Table ${table.name}` : "New table"} initial={table} onClose={() => setTable(null)} onSave={(v) => saveTable.mutate(v)} saving={saveTable.isPending} error={saveTable.error}
        fields={[
          { name: "name", label: "Name", type: "text", required: true },
          { name: "seats", label: "Seats", type: "number", min: 1 },
          { name: "area_id", label: "Area", type: "select", options: floor.data.areas.map((a) => ({ value: a.id, label: a.name })), required: true },
          { name: "status", label: "Status", type: "select", options: ["free", "reserved", "cleaning"].map((x) => ({ value: x, label: x })) },
          { name: "qr_code", label: "QR code (auto)", type: "text", hint: "Change only if a QR sticker was lost" },
        ]} />
    </div>
  );
}
