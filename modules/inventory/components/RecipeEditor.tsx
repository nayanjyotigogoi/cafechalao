"use client";

import { useState } from "react";
import { menuApi } from "@/modules/menu/api";
import { useM, useQ } from "@/shared/api/hooks";
import { formatINR } from "@/shared/lib/money";
import { compatibleUnits, UNITS } from "@/shared/lib/units";
import type { Menu } from "@/shared/types/api";
import type { RawMaterial, UnitCode } from "@/shared/types/entities";
import { Modal } from "@/shared/ui/overlay";
import { Button, Input, Loading, Select } from "@/shared/ui/primitives";

/** What one portion of a dish uses; each sale deducts it from stock and it gives the food cost. Owner/manager (menu edit). */
export function RecipeEditor({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const r = useQ<{ lines: { raw_material_id: string; qty: number; unit: UnitCode }[]; cost: number }>(`/items/${itemId}/recipe`, { auth: "staff" });
  const mats = useQ<RawMaterial[]>("/raw-materials", { auth: "staff" });
  const menu = useQ<Menu>("/menu");
  const [lines, setLines] = useState<{ raw_material_id: string; qty: number; unit: UnitCode }[] | null>(null);
  const save = useM(() => menuApi.saveRecipe(itemId, cur), { success: (x) => `Recipe saved · cost ${formatINR(x.cost)}`, onSuccess: onClose });
  const cur = lines ?? r.data?.lines ?? [];
  const item = menu.data?.items.find((i) => i.id === itemId);
  return (
    <Modal open onClose={onClose} title={`Recipe · ${item?.name ?? ""}`} footer={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save recipe</Button>}>
      {!r.data ? <Loading /> : (
        <div className="flex flex-col gap-2">
          {cur.map((l, i) => {
            const m = mats.data?.find((x) => x.id === l.raw_material_id);
            return (
              <div key={i} className="flex gap-2">
                <Select value={l.raw_material_id} onChange={(e) => { const mm = mats.data?.find((x) => x.id === e.target.value); setLines(cur.map((x, j) => (j === i ? { ...x, raw_material_id: e.target.value, unit: mm?.unit ?? x.unit } : x))); }}>
                  {mats.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
                <Input type="number" className="w-24" value={l.qty} onChange={(e) => setLines(cur.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} aria-label="Quantity" />
                <Select className="w-20" value={l.unit} onChange={(e) => setLines(cur.map((x, j) => (j === i ? { ...x, unit: e.target.value as UnitCode } : x)))} aria-label="Unit">
                  {(m ? compatibleUnits(m.unit) : UNITS).map((u) => <option key={u}>{u}</option>)}
                </Select>
                <Button variant="ghost" onClick={() => setLines(cur.filter((_, j) => j !== i))} aria-label="Remove">×</Button>
              </div>
            );
          })}
          <Button size="sm" variant="soft" onClick={() => mats.data?.[0] && setLines([...cur, { raw_material_id: mats.data[0].id, qty: 1, unit: mats.data[0].unit }])}>+ Ingredient</Button>
          <p className="text-sm text-mute">Current cost {formatINR(r.data.cost)}{item ? ` · ${((r.data.cost / item.price) * 100).toFixed(1)}% of price` : ""}</p>
        </div>
      )}
    </Modal>
  );
}
