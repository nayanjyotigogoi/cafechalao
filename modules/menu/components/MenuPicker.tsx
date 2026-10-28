"use client";

import { useMemo, useState } from "react";
import { useQ } from "@/shared/api/hooks";
import { cx } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import type { Menu, MenuItem } from "@/shared/types/api";
import { FoodMark, Input, Loading } from "@/shared/ui/primitives";
import { ItemSheet } from "./Storefront";

export interface PickedLine { item: MenuItem; variant_id: string | null; add_on_ids: string[]; note: string; qty: number }

/**
 * Staff item picker for POS and captain: category rail, keypad search by name or item code (e.g. 101),
 * favourites (bestsellers), big touch tiles. Items with sizes or add-ons open the option sheet.
 */
export function MenuPicker({ onPick, counts, layout = "pos" }: { onPick: (l: PickedLine) => void; counts?: Record<string, number>; layout?: "pos" | "phone" }) {
  const menu = useQ<Menu>("/menu");
  const [cat, setCat] = useState("fav");
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<MenuItem | null>(null);
  // No favourites yet (new café): start on the first category instead of an empty grid.
  const hasFav = !!menu.data?.items.some((i) => i.bestseller);
  const view = cat === "fav" && menu.data && !hasFav ? menu.data.categories[0]?.id ?? "fav" : cat;
  const items = useMemo(() => {
    const all = menu.data?.items ?? [];
    if (q) return all.filter((i) => i.code === q || i.code.startsWith(q) || i.name.toLowerCase().includes(q.toLowerCase()));
    if (view === "fav") return all.filter((i) => i.bestseller);
    return all.filter((i) => i.category_id === view);
  }, [menu.data, view, q]);
  if (menu.isLoading) return <Loading />;
  const tap = (i: MenuItem) => {
    if (!i.available_now) return;
    if (i.variants.length || i.add_on_groups.length) setSheet(i);
    else onPick({ item: i, variant_id: null, add_on_ids: [], note: "", qty: 1 });
  };
  const cats = [...(hasFav ? [{ id: "fav", name: "★ Favourites", n: menu.data?.items.filter((i) => i.bestseller).length ?? 0 }] : []), ...(menu.data?.categories ?? []).map((c) => ({ id: c.id, name: c.name, n: menu.data!.items.filter((i) => i.category_id === c.id).length }))];

  return (
    <div className={cx("flex min-h-0 flex-1", layout === "pos" ? "flex-col md:flex-row" : "flex-col")}>
      <div className={cx("scrollbar-none flex shrink-0 gap-1.5 overflow-auto p-2", layout === "pos" ? "md:w-28 md:flex-col md:border-r-[1.5px] md:border-line" : "")}>
        {cats.map((c) => (
          <button key={c.id} onClick={() => { setCat(c.id); setQ(""); }}
            className={cx("min-h-12 shrink-0 cursor-pointer rounded-xl border-[1.5px] px-3 py-2 text-center text-[13px]", view === c.id && !q ? "border-brand bg-fill font-semibold" : "border-line bg-paper")}>
            {c.name}<span className="num block text-[10px] text-mute">{c.n}</span>
          </button>
        ))}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
        <Input placeholder="🔍 Search or type item code (e.g. 101)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items"
          onKeyDown={(e) => { if (e.key === "Enter" && items[0]) { tap(items[0]); setQ(""); } }} />
        <div className={cx("grid content-start gap-2 overflow-y-auto", layout === "pos" ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4" : "grid-cols-2")}>
          {items.map((i) => (
            <button key={i.id} onClick={() => tap(i)} disabled={!i.available_now}
              className={cx("relative flex min-h-20 cursor-pointer flex-col gap-1 rounded-xl border-[1.5px] bg-paper p-2.5 text-left active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45", counts?.[i.id] ? "border-brand" : "border-line")}>
              <div className="flex items-center gap-1.5"><FoodMark type={i.food_type} /><span className="num text-[10px] text-mute">{i.code}</span></div>
              <b className="text-[13px] leading-tight">{i.name}</b>
              <span className="num mt-auto text-xs">{i.available_now ? formatINR(i.variants[0]?.price ?? i.price) : "Out of stock"}</span>
              {!!counts?.[i.id] && <span className="num absolute right-2 top-2 grid min-w-6 place-items-center rounded-full bg-ink px-1.5 text-xs text-bg">{counts[i.id]}</span>}
            </button>
          ))}
        </div>
      </div>
      <ItemSheet item={sheet} onClose={() => setSheet(null)} onAdd={(o) => sheet && onPick({ item: sheet, ...o })} />
    </div>
  );
}
