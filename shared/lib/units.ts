import type { UnitCode } from "@/shared/types/entities";

/** Unit conversion for stock (SRS M5.1). Converts between kg↔g and L↔ml; pcs only to pcs. */
const BASE: Record<UnitCode, { dim: "mass" | "volume" | "count"; factor: number }> = {
  kg: { dim: "mass", factor: 1000 },
  g: { dim: "mass", factor: 1 },
  L: { dim: "volume", factor: 1000 },
  ml: { dim: "volume", factor: 1 },
  pcs: { dim: "count", factor: 1 },
};

export function convert(qty: number, from: UnitCode, to: UnitCode): number {
  if (from === to) return qty;
  const a = BASE[from];
  const b = BASE[to];
  if (a.dim !== b.dim) throw new Error(`Cannot convert ${from} to ${to}`);
  return (qty * a.factor) / b.factor;
}

export const compatibleUnits = (u: UnitCode): UnitCode[] =>
  (Object.keys(BASE) as UnitCode[]).filter((k) => BASE[k].dim === BASE[u].dim);

export const UNITS: UnitCode[] = ["kg", "g", "L", "ml", "pcs"];
