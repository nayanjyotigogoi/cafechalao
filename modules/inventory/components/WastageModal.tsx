"use client";

import { useState } from "react";
import { inventoryApi } from "@/modules/inventory/api";
import { useM, useQ } from "@/shared/api/hooks";
import { label } from "@/shared/lib/format";
import { UNITS } from "@/shared/lib/units";
import type { Menu } from "@/shared/types/api";
import type { RawMaterial, UnitCode } from "@/shared/types/entities";
import { Modal } from "@/shared/ui/overlay";
import { Button, Chip, Field, Input, Select } from "@/shared/ui/primitives";

/** Wastage entry with reason (M5.8): kitchen at end of shift, storekeeper any time. */
export function WastageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mats = useQ<Pick<RawMaterial, "id" | "name" | "unit">[]>(open ? "/wastage/materials" : null, { auth: "staff" });
  const menu = useQ<Menu>(open ? "/menu" : null);
  const [f, setF] = useState<{ kind: "material" | "item"; id: string; qty: number; unit: UnitCode; reason: string; note: string }>({ kind: "material", id: "", qty: 0, unit: "g", reason: "spoiled", note: "" });
  const save = useM(() => inventoryApi.wastage({ [f.kind === "material" ? "raw_material_id" : "item_id"]: f.id, qty: f.qty, unit: f.kind === "item" ? "pcs" : f.unit, reason: f.reason, note: f.note }), { success: "Wastage recorded", onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} title="Record wastage" footer={<Button variant="primary" disabled={!f.id || f.qty <= 0} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Chip onClick={() => setF({ ...f, kind: "material", id: "" })} active={f.kind === "material"}>Ingredient</Chip>
          <Chip onClick={() => setF({ ...f, kind: "item", id: "" })} active={f.kind === "item"}>Menu item</Chip>
        </div>
        <Field label={f.kind === "material" ? "Ingredient" : "Item"}>
          <Select value={f.id} onChange={(e) => { const m = mats.data?.find((x) => x.id === e.target.value); setF({ ...f, id: e.target.value, unit: m?.unit ?? f.unit }); }}>
            <option value="">Choose…</option>
            {f.kind === "material" ? mats.data?.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>) : menu.data?.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity"><Input inputMode="decimal" value={f.qty || ""} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} /></Field>
          {f.kind === "material" && <Field label="Unit"><Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as UnitCode })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select></Field>}
        </div>
        <Field label="Reason"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{["expired", "spoiled", "burnt", "returned", "other"].map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select></Field>
        <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
