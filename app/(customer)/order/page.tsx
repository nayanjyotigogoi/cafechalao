"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cart, useCart } from "@/modules/orders/cart";
import { useT } from "@/shared/i18n";
import { cx } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import { Card, Empty } from "@/shared/ui/primitives";
import { Icon, type IconName } from "@/shared/ui/icons";

/**
 * Ordering from outside the café: pick Takeaway or Delivery first, then the menu.
 * Guests at a table never see this page; their table QR makes the order dine-in.
 */
export default function OrderModePage() {
  return <Suspense><OrderMode /></Suspense>;
}

function OrderMode() {
  useTitle("Order online");
  const s = useSettings();
  const { t } = useT();
  const c = useCart();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const f = s.flags.features;
  const delivery = f.delivery && s.delivery.enabled;
  const pick = (m: "takeaway" | "delivery") => {
    cart.setMode(m);
    router.push(next);
  };
  const options = [
    f.takeaway && { v: "takeaway" as const, icon: "bag", title: t("Takeaway"), text: `Order now and pick it up at ${s.outlet.name}. Choose a pickup time at checkout.` },
    delivery && { v: "delivery" as const, icon: "scooter", title: t("Delivery"), text: `We bring it to your door. ${s.delivery.charge_type === "flat" ? `Delivery ${formatINR(s.delivery.flat_charge)}` : "Delivery charge by order value"} · min order ${formatINR(s.delivery.min_order)}.` },
  ].filter(Boolean) as { v: "takeaway" | "delivery"; icon: IconName; title: string; text: string }[];

  if (!options.length) return <Empty title="Online ordering is off">{s.outlet.name} isn&apos;t taking takeaway or delivery orders right now.</Empty>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 py-4">
      <div>
        <h1 className="font-disp text-3xl font-extrabold">How would you like your order?</h1>
        <p className="mt-1 text-sm text-mute">At {s.outlet.name} right now? Scan the QR code on your table to order dine-in.</p>
      </div>
      <div className={cx("grid gap-3", options.length > 1 && "sm:grid-cols-2")}>
        {options.map((o) => (
          <button key={o.v} onClick={() => pick(o.v)} className="text-left">
            <Card className={cx("lift flex h-full cursor-pointer flex-col gap-2 p-5 hover:border-brand", c.mode_set && c.order_type === o.v && "border-[2.5px] border-brand")}>
              <Icon name={o.icon} size={46} />
              <b className="font-disp text-2xl">{o.title}</b>
              <span className="text-sm text-mute">{o.text}</span>
              <span className="mt-auto pt-2 font-semibold text-brand">Continue →</span>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
