/** Date, time and text helpers used across screens (Indian locale). */

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—";

export const fmtDateTime = (iso: string | null | undefined) => (iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "—");

export function minsSince(iso: string | null | undefined, now = Date.now()) {
  return iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)) : 0;
}

export function clock(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const m = minsSince(iso);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const daysAgoISO = (n: number) => {
  const d = new Date(Date.now() - n * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

export const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** CSV export (M10.4). Excel opens UTF-8 CSV with the BOM. */
export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Readable text colour on a background (for brand buttons in any café colour). */
export function onColor(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? "#1e1a1b" : "#ffffff";
}
