"use client";

import { useState } from "react";
import { cx, minsSince } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import type { Floor, FloorTable } from "@/shared/types/api";
import type { TableStatus } from "@/shared/types/entities";
import { Chip, Segmented } from "@/shared/ui/primitives";

/** Live table map (M2.2): colour plus a text label per status so it reads without colour. */
export const TABLE_STATUS: Record<TableStatus, { label: string; cls: string; tone: "ok" | "hot" | "warn" | "info" | "neutral" }> = {
  free: { label: "Free", cls: "border-ok text-ok", tone: "ok" },
  occupied: { label: "Occupied", cls: "border-rose text-rose", tone: "hot" },
  bill_requested: { label: "Bill asked", cls: "border-warn text-warn", tone: "warn" },
  reserved: { label: "Reserved", cls: "border-info text-info", tone: "info" },
  cleaning: { label: "Cleaning", cls: "border-line text-mute", tone: "neutral" },
};

export function FloorGrid({ floor, onPick, selected, cols = "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6" }: { floor: Floor; onPick: (t: FloorTable) => void; selected?: string | null; cols?: string }) {
  const [area, setArea] = useState<string>("all");
  const tables = floor.tables.filter((t) => area === "all" || t.area_id === area);
  const count = (s: TableStatus) => floor.tables.filter((t) => t.status === s).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {floor.areas.length > 1 && <Segmented value={area} onChange={setArea} options={[{ value: "all", label: "All" }, ...floor.areas.map((a) => ({ value: a.id, label: a.name }))]} />}
        <Chip tone="ok">Free {count("free")}</Chip>
        <Chip tone="hot">Occupied {count("occupied")}</Chip>
        <Chip tone="warn">Bill asked {count("bill_requested")}</Chip>
        {count("reserved") > 0 && <Chip tone="info">Reserved {count("reserved")}</Chip>}
      </div>
      <div className={cx("grid gap-2", cols)}>
        {tables.map((t) => {
          const st = TABLE_STATUS[t.status];
          const calling = t.session?.waiter_called_at;
          return (
            <button key={t.id} onClick={() => onPick(t)}
              className={cx("relative flex min-h-20 cursor-pointer flex-col items-start gap-0.5 rounded-xl border-[1.5px] bg-paper p-2.5 text-left", st.cls, selected === t.id && "ring-2 ring-brand ring-offset-2", t.merged_into && "border-dashed")}>
              <b className="text-base text-ink">{t.name}</b>
              <span className="text-[11px]">{st.label}{t.merged_into ? " · merged" : ""}</span>
              {t.session && <span className="text-[11px] text-mute">{t.session.guests} pax · {minsSince(t.session.opened_at)}m</span>}
              {t.order && <span className="num text-[11px] text-ink">{formatINR(t.order.total)}</span>}
              {t.reservation && t.status !== "occupied" && <span className="text-[11px] text-info">{t.reservation.time} · {t.reservation.name.split(" ")[0]}</span>}
              {calling && <span className="absolute right-1.5 top-1.5 animate-pulse text-sm" title="Calling waiter">🔔</span>}
              {!t.order && t.status === "free" && <span className="text-[11px] text-mute">{t.seats} seats</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
