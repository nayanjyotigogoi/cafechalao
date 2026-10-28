"use client";

import { useSyncExternalStore } from "react";
import { getTenantSlug } from "@/shared/api/client";
import type { CartLine, MenuItem } from "@/shared/types/api";
import type { OrderType } from "@/shared/types/entities";

/** Customer cart, kept per café in localStorage so a refresh or app reopen keeps it. */

export interface CartState {
  lines: CartLine[];
  order_type: OrderType;
  table_code: string | null;
  table_name: string | null;
  coupon_code: string | null;
  redeem_points: number;
  gift_card_code: string | null;
  note: string;
  tip: number;
  pickup_time: string;
  address_id: string | null;
  table_set_at: number | null;
  /** True once the guest picked how they get the food (table scan = dine-in; otherwise takeaway or delivery on /order). */
  mode_set: boolean;
}

const TABLE_TTL_MS = 4 * 3600 * 1000;
const empty = (): CartState => ({ lines: [], order_type: "delivery", mode_set: false, table_code: null, table_name: null, table_set_at: null, coupon_code: null, redeem_points: 0, gift_card_code: null, note: "", tip: 0, pickup_time: "", address_id: null });
const key = () => `cc.cart.${getTenantSlug()}`;
const listeners = new Set<() => void>();
let snapshot: { k: string; raw: string | null; v: CartState } | null = null;

function read(): CartState {
  if (typeof window === "undefined") return empty();
  const k = key();
  let raw: string | null = null;
  try { raw = localStorage.getItem(k); } catch {}
  if (snapshot && snapshot.k === k && snapshot.raw === raw) return snapshot.v;
  let v = empty();
  try { if (raw) v = { ...empty(), ...JSON.parse(raw) }; } catch {}
  // A table QR scan is valid for one visit (4 h); after that the guest is ordering from outside again.
  if (v.table_code && (!v.table_set_at || Date.now() - v.table_set_at > TABLE_TTL_MS)) v = { ...v, table_code: null, table_name: null, table_set_at: null, order_type: "delivery", mode_set: false };
  snapshot = { k, raw, v };
  return v;
}
function write(next: CartState) {
  try { localStorage.setItem(key(), JSON.stringify(next)); } catch {}
  listeners.forEach((l) => l());
}

const SERVER = empty();
export function useCart(): CartState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => SERVER);
}

export const cart = {
  get: read,
  set: (patch: Partial<CartState>) => write({ ...read(), ...patch }),
  add(item: MenuItem, opts: { variant_id?: string | null; add_on_ids?: string[]; qty?: number; note?: string } = {}) {
    const v = item.variants.find((x) => x.id === opts.variant_id) ?? null;
    const addOns = item.add_on_groups.flatMap((g) => g.add_ons).filter((a) => (opts.add_on_ids ?? []).includes(a.id));
    const k = `${item.id}|${v?.id ?? ""}|${addOns.map((a) => a.id).sort().join(",")}|${opts.note ?? ""}`;
    const s = read();
    const existing = s.lines.find((l) => l.key === k);
    const lines = existing
      ? s.lines.map((l) => (l.key === k ? { ...l, qty: l.qty + (opts.qty ?? 1) } : l))
      : [...s.lines, {
          key: k, item_id: item.id, variant_id: v?.id ?? null, add_on_ids: addOns.map((a) => a.id), qty: opts.qty ?? 1, note: opts.note ?? "",
          name: item.name, variant_name: v?.name ?? null, add_on_names: addOns.map((a) => a.name), unit_price: (v ? v.price : item.price) + addOns.reduce((t, a) => t + a.price, 0), food_type: item.food_type,
        }];
    write({ ...s, lines });
  },
  setQty(k: string, qty: number) {
    const s = read();
    write({ ...s, lines: qty <= 0 ? s.lines.filter((l) => l.key !== k) : s.lines.map((l) => (l.key === k ? { ...l, qty } : l)) });
  },
  /** Quantity of an item across its variants (for the menu stepper). */
  qtyOf: (s: CartState, itemId: string) => s.lines.filter((l) => l.item_id === itemId).reduce((a, l) => a + l.qty, 0),
  clear: () => {
    const s = read();
    write({ ...empty(), order_type: s.order_type, mode_set: s.mode_set, table_code: s.table_code, table_name: s.table_name, table_set_at: s.table_set_at, address_id: s.address_id });
  },
  setTable: (code: string, name: string) => write({ ...read(), table_code: code, table_name: name, table_set_at: Date.now(), order_type: "dine_in", mode_set: true }),
  /** Ordering from outside the café: takeaway or delivery, chosen on the /order page. */
  setMode: (type: "takeaway" | "delivery") => write({ ...read(), table_code: null, table_name: null, table_set_at: null, order_type: type, mode_set: true }),
};

export const cartCount = (s: CartState) => s.lines.reduce((a, l) => a + l.qty, 0);
export const cartValue = (s: CartState) => s.lines.reduce((a, l) => a + l.unit_price * l.qty, 0);
