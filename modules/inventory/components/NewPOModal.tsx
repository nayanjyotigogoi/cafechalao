"use client";

import { useState } from "react";
import { inventoryApi } from "@/modules/inventory/api";
import { useM, useQ } from "@/shared/api/hooks";
import { useStaff } from "@/shared/auth/session";
import { formatINR } from "@/shared/lib/money";
import { UNITS } from "@/shared/lib/units";
import type { RawMaterial, Supplier, UnitCode } from "@/shared/types/entities";
import { Modal } from "@/shared/ui/overlay";
import { Button, Card, ErrorText, Field, Input, MoneyInput, Select } from "@/shared/ui/primitives";

type Line = { raw_material_id: string; qty: number; rate: number };
const ROW = "grid grid-cols-[minmax(0,1fr)_6rem_7rem_2.5rem] items-center gap-2";

/**
 * New purchase order. Starts empty: the buyer adds only what they are buying this time, from any supplier
 * (vegetables come from whoever has them that day). New suppliers and new ingredients can be added right here.
 */
export function NewPOModal({ onClose }: { onClose: () => void }) {
  const { can, session } = useStaff();
  const sup = useQ<Supplier[]>("/suppliers", { auth: "staff" });
  const mats = useQ<RawMaterial[]>("/raw-materials", { auth: "staff" });
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [newSup, setNewSup] = useState<{ name: string; phone: string } | null>(null);
  const [newMat, setNewMat] = useState<{ name: string; unit: UnitCode } | null>(null);
  const sid = supplierId || sup.data?.[0]?.id || "";
  const mat = (id: string) => mats.data?.find((m) => m.id === id);
  const add = (id: string) => {
    const m = mat(id);
    if (m && !lines.some((l) => l.raw_material_id === id)) setLines([...lines, { raw_material_id: id, qty: 0, rate: m.last_cost }]);
  };
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const low = (mats.data ?? []).filter((m) => m.supplier_id === sid && m.stock < m.min_level && !lines.some((l) => l.raw_material_id === m.id));

  const addSup = useM(() => inventoryApi.saveSupplier(newSup!) as Promise<Supplier>, { success: "Supplier added", onSuccess: (x) => { setNewSup(null); setSupplierId(x.id); } });
  const addMat = useM(() => inventoryApi.saveMaterial({ name: newMat!.name, unit: newMat!.unit, supplier_id: sid || null } as object) as Promise<RawMaterial>, {
    success: "Ingredient added",
    onSuccess: (m) => { setNewMat(null); setLines((ls) => [...ls, { raw_material_id: m.id, qty: 0, rate: 0 }]); },
  });
  const buying = lines.filter((l) => l.qty > 0);
  const total = buying.reduce((a, l) => a + Math.round(l.qty * l.rate), 0);
  const create = useM(() => inventoryApi.createPO({ supplier_id: sid, lines: buying }), { success: "Purchase order saved", onSuccess: onClose });

  // Same rule as the server: someone who can approve, within their PO limit, saves it approved.
  const limit = session?.limits.po_value ?? 0;
  const note = !total ? "" : can("stock.approve") && total <= limit
    ? `Approved straight away${limit < 100_000_000 ? ` (your limit ${formatINR(limit)})` : ""}.`
    : can("stock.approve") ? `Over your ${formatINR(limit)} limit: goes to the owner for approval.` : "Goes to the manager or owner for approval.";

  return (
    <Modal open onClose={onClose} title="New purchase order" wide
      footer={<Button variant="primary" disabled={!sid || !buying.length} loading={create.isPending} onClick={() => create.mutate(undefined)}>Save purchase order</Button>}>
      <div className="flex flex-col gap-3">
        <Field label="Supplier">
          <Select value={sid} onChange={(e) => (e.target.value === "+new" ? setNewSup({ name: "", phone: "" }) : setSupplierId(e.target.value))}>
            {!sid && <option value="">Choose a supplier…</option>}
            {sup.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            {can("stock.approve") && <option value="+new">+ New supplier…</option>}
          </Select>
        </Field>
        {newSup && (
          <Card className="flex flex-col gap-2 bg-fill p-3">
            <b className="text-sm">New supplier</b>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Name, e.g. Fancy Bazaar veg market" value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} aria-label="Supplier name" />
              <Input placeholder="Phone" inputMode="tel" value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} aria-label="Supplier phone" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={!newSup.name.trim() || !newSup.phone.trim()} loading={addSup.isPending} onClick={() => addSup.mutate(undefined)}>Add supplier</Button>
              <Button size="sm" variant="ghost" onClick={() => setNewSup(null)}>Cancel</Button>
            </div>
            <ErrorText error={addSup.error} />
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {lines.length > 0 && <div className={`${ROW} px-1 text-xs text-mute`}><span>Ingredient</span><span>Qty</span><span>Rate / unit</span><span /></div>}
          {lines.map((l, i) => {
            const m = mat(l.raw_material_id);
            return (
              <div key={l.raw_material_id} className={ROW}>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">{m?.name}</span>
                  {l.qty > 0 && <span className="num text-xs text-mute">= {formatINR(Math.round(l.qty * l.rate))}</span>}
                </span>
                <div className="relative">
                  <Input type="number" min={0} inputMode="decimal" className="w-full pr-9" value={l.qty || ""} onChange={(e) => set(i, { qty: Number(e.target.value) })} aria-label={`${m?.name} quantity`} />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-mute">{m?.unit}</span>
                </div>
                <MoneyInput value={l.rate} onChange={(v) => set(i, { rate: v })} />
                <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove ${m?.name}`}>×</Button>
              </div>
            );
          })}
          {!lines.length && <p className="rounded-xl border-[1.5px] border-dashed border-line p-4 text-center text-sm text-mute">Add the ingredients you are buying this time.</p>}

          <Select value="" onChange={(e) => (e.target.value === "+new" ? setNewMat({ name: "", unit: "kg" }) : add(e.target.value))} aria-label="Add ingredient">
            <option value="">+ Add ingredient…</option>
            {mats.data?.filter((m) => !lines.some((l) => l.raw_material_id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
            {can("stock.receive") && <option value="+new">+ New ingredient (not in the list)…</option>}
          </Select>
          {newMat && (
            <Card className="flex flex-col gap-2 bg-fill p-3">
              <b className="text-sm">New ingredient</b>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                <Input placeholder="Name, e.g. Tomato" value={newMat.name} onChange={(e) => setNewMat({ ...newMat, name: e.target.value })} aria-label="Ingredient name" />
                <Select value={newMat.unit} onChange={(e) => setNewMat({ ...newMat, unit: e.target.value as UnitCode })} aria-label="Unit">{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={!newMat.name.trim()} loading={addMat.isPending} onClick={() => addMat.mutate(undefined)}>Add ingredient</Button>
                <Button size="sm" variant="ghost" onClick={() => setNewMat(null)}>Cancel</Button>
              </div>
              <ErrorText error={addMat.error} />
            </Card>
          )}
          {low.length > 0 && (
            <Button size="sm" variant="soft" className="self-start" onClick={() => setLines([...lines, ...low.map((m) => ({ raw_material_id: m.id, qty: Math.ceil(m.min_level * 2 - m.stock), rate: m.last_cost }))])}>
              + Add {low.length} low-stock item{low.length > 1 ? "s" : ""} usually bought here
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
          <span className="text-sm text-mute">{note}</span>
          <span>Total <b className="num text-lg">{formatINR(total)}</b></span>
        </div>
        <ErrorText error={create.error} />
      </div>
    </Modal>
  );
}
