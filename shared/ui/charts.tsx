"use client";

import { useState } from "react";
import { formatINR, formatINRCompact } from "@/shared/lib/money";
import { cx } from "@/shared/lib/format";

/**
 * Small SVG charts in the theme colours. Bars are the highlighted value in --brand and the rest in --fill,
 * as on the wireframe's "Sales by hour". Values in paise unless `plain` is set.
 */

export function BarChart({ data, height = 140, highlightMax = true, plain, labelEvery = 1 }: { data: { label: string; value: number }[]; height?: number; highlightMax?: boolean; plain?: boolean; labelEvery?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.findIndex((d) => d.value === max);
  const fmt = (v: number) => (plain ? v.toLocaleString("en-IN") : formatINR(v));
  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex items-end gap-1" style={{ height }} role="img" aria-label={data.map((d) => `${d.label}: ${fmt(d.value)}`).join(", ")}>
        {data.map((d, i) => (
          <div key={d.label + i} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i && (
              <div className="num absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-bg">
                {d.label} · {fmt(d.value)}
              </div>
            )}
            <div
              className={cx("w-full rounded-t-[3px] transition-all", (highlightMax && i === peak) || hover === i ? "bg-brand" : "bg-fill")}
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {data.map((d, i) => (
          <div key={d.label + i} className="num min-w-0 flex-1 truncate text-center text-[10px] text-mute">
            {i % labelEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars for ranked lists (top items, channels, per ₹100). */
export function HBars({ data, plain, suffix }: { data: { label: string; value: number; tone?: "brand" | "fill" | "rose" }[]; plain?: boolean; suffix?: string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <div className="flex flex-col gap-2">
      {data.map((d) => (
        <div key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate">{d.label}</span>
          <div className="h-3 rounded bg-fill/50">
            <div className={cx("h-full rounded", d.tone === "rose" ? "bg-rose" : d.tone === "fill" ? "bg-fill" : "bg-brand")} style={{ width: `${(Math.abs(d.value) / max) * 100}%` }} />
          </div>
          <span className="num text-right text-xs">{plain ? `${d.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${suffix ?? ""}` : formatINRCompact(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Line with a filled area for a daily series. */
export function AreaLine({ data, height = 120 }: { data: { label: string; value: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <BarChart data={data} height={height} />;
  const w = 600;
  const max = Math.max(1, ...data.map((d) => d.value));
  const pts = data.map((d, i) => [(i / (data.length - 1)) * w, height - (d.value / max) * (height - 8) - 4] as const);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="h-auto w-full" preserveAspectRatio="none" role="img" aria-label="Daily trend" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)));
        }}>
        <path d={`${path} L${w} ${height} L0 ${height} Z`} fill="var(--fill)" opacity="0.7" />
        <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {hover != null && pts[hover] && <circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill="var(--brand)" />}
      </svg>
      {hover != null && data[hover] && (
        <div className="num pointer-events-none absolute right-0 top-0 rounded-md bg-ink px-2 py-1 text-[11px] text-bg">
          {data[hover].label} · {formatINR(data[hover].value)}
        </div>
      )}
      <div className="num mt-1 flex justify-between text-[10px] text-mute">
        <span>{data[0].label}</span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}
