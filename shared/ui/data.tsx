"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cx, downloadCSV } from "@/shared/lib/format";
import { Button, Input } from "./primitives";

/** One Table component for every list (sortable, searchable, CSV export, scrolls inside its card on phones). */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell?: (row: T) => ReactNode;
  value?: (row: T) => string | number | null | undefined; // for sort, search and CSV
  align?: "right" | "center";
  className?: string;
  hideSm?: boolean;
}

export function DataTable<T>({
  rows, columns, rowKey, onRowClick, search, exportName, empty = "Nothing here yet", toolbar, pageSize = 50, dense,
}: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; search?: boolean; exportName?: string;
  empty?: ReactNode; toolbar?: ReactNode; pageSize?: number; dense?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(pageSize);
  const val = (c: Column<T>, r: T) => (c.value ? c.value(r) : ((r as Record<string, unknown>)[c.key] as string | number | null | undefined));

  const shown = useMemo(() => {
    let out = rows;
    if (q) {
      const s = q.toLowerCase();
      out = out.filter((r) => columns.some((c) => String(val(c, r) ?? "").toLowerCase().includes(s)));
    }
    if (sort) {
      const c = columns.find((x) => x.key === sort.key)!;
      out = [...out].sort((a, b) => {
        const va = val(c, a) ?? "";
        const vb = val(c, b) ?? "";
        return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
      });
    }
    return out;
  }, [rows, q, sort, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {(search || exportName || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-xs sm:flex-1" aria-label="Search table" />}
          <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
            {toolbar}
            {exportName && (
              <Button size="sm" onClick={() => downloadCSV(exportName, shown.map((r) => Object.fromEntries(columns.map((c) => [typeof c.header === "string" ? c.header : c.key, val(c, r)]))))}>
                Export CSV
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="min-w-0 overflow-x-auto rounded-2xl border-[1.5px] border-line bg-paper">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-[1.5px] border-line text-left">
              {columns.map((c) => (
                <th key={c.key} className={cx("whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-mute", c.align === "right" && "text-right", c.align === "center" && "text-center", c.hideSm && "hidden md:table-cell")}>
                  <button className="cursor-pointer uppercase" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}>
                    {c.header}
                    {sort?.key === c.key && (sort.dir === 1 ? " ↑" : " ↓")}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx("border-b border-line/70 last:border-0", onRowClick && "cursor-pointer hover:bg-fill/40")}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx("px-3 align-middle", dense ? "py-1.5" : "py-2.5", c.align === "right" && "text-right", c.align === "center" && "text-center", c.hideSm && "hidden md:table-cell", c.className)}>
                    {c.cell ? c.cell(r) : String(val(c, r) ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-mute">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + pageSize)}>
          Show more ({shown.length - limit} left)
        </Button>
      )}
    </div>
  );
}
