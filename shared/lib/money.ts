import type { Paise } from "@/shared/types/entities";

/** Money is kept in paise (integers). Helpers convert and format for Indian display. */

export const rupees = (r: number): Paise => Math.round(r * 100);
export const toRupees = (p: Paise) => p / 100;

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,234 or ₹1,234.50 (always 2 decimals when there are paise). */
export function formatINR(p: Paise, opts: { decimals?: boolean } = {}) {
  const neg = p < 0;
  const v = Math.abs(p) / 100;
  const s = opts.decimals || v % 1 !== 0 ? inr2.format(v) : inr.format(v);
  return `${neg ? "−" : ""}₹${s}`;
}

/** ₹1.26L, ₹18.4k: compact numbers for dashboards. */
export function formatINRCompact(p: Paise) {
  const v = p / 100;
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  return formatINR(p);
}

/** Splits an amount across weights so the parts always add back to the total exactly. */
export function allocate(total: Paise, weights: number[]): Paise[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floored = raw.map(Math.floor);
  let rest = total - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    floored[i] += 1;
    rest -= 1;
  }
  return floored;
}

export const pct = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);
