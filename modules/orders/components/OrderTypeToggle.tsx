"use client";

import { cart, useCart } from "@/modules/orders/cart";
import { useT } from "@/shared/i18n";
import { cx } from "@/shared/lib/format";
import { useSettings } from "@/shared/tenant/TenantProvider";

/** Ordering from outside the café: what this café offers among Delivery and Takeaway, Delivery first. */
export function useOutsideTypes() {
  const s = useSettings();
  const f = s.flags.features;
  return [
    ...(f.delivery && s.delivery.enabled ? [{ v: "delivery" as const, icon: "🛵" }] : []),
    ...(f.takeaway ? [{ v: "takeaway" as const, icon: "🛍️" }] : []),
  ];
}

/**
 * Delivery / Takeaway switch for guests not at a table (they opened the link, installed or not).
 * Defaults to Delivery; guests at the café scan the table QR instead, which makes the order dine-in.
 */
export function OrderTypeToggle({ className }: { className?: string }) {
  const { t } = useT();
  const c = useCart();
  const types = useOutsideTypes();
  if (!types.length) return null;
  // A table scan lasts one visit (4 h). A guest who has left can switch back to ordering from outside.
  if (c.table_code) {
    return (
      <p className={cx("text-sm text-mute", className)}>
        You&apos;re at <b className="text-ink">{c.table_name}</b> (dine-in). Not at the café any more?{" "}
        <button className="cursor-pointer font-semibold text-brand underline" onClick={() => cart.setMode(types[0].v)}>Order {types.map((x) => x.v).join(" or ")} instead</button>
      </p>
    );
  }
  const current = types.some((x) => x.v === c.order_type) ? c.order_type : types[0].v;
  return (
    <div role="radiogroup" aria-label="Order type" className={cx("flex rounded-2xl border-[1.5px] border-line bg-paper p-1", className)}>
      {types.map((x) => (
        <button key={x.v} role="radio" aria-checked={current === x.v} onClick={() => cart.setMode(x.v)}
          className={cx("min-h-11 flex-1 cursor-pointer rounded-xl px-3 font-semibold transition", current === x.v ? "bg-ink text-bg" : "text-mute hover:text-ink")}>
          <span aria-hidden>{x.icon}</span> {t(x.v === "delivery" ? "Delivery" : "Takeaway")}
        </button>
      ))}
    </div>
  );
}
