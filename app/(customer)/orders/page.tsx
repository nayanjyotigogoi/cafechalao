"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cart } from "@/modules/orders/cart";
import { useQ } from "@/shared/api/hooks";
import { useCustomer } from "@/shared/auth/session";
import { fmtDateTime, label } from "@/shared/lib/format";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { Menu } from "@/shared/types/api";
import type { Order, OrderItem } from "@/shared/types/entities";
import { Button, Card, Chip, Empty, Loading, Money } from "@/shared/ui/primitives";
import { get } from "@/shared/api/client";
import { useToast } from "@/shared/ui/overlay";

/** Order history with reorder (M1.8). */
export default function OrdersPage() {
  useTitle("Your orders");
  const { customer, loading } = useCustomer();
  const orders = useQ<Order[]>(customer ? "/me/orders" : null, { auth: "customer", live: true });
  const menu = useQ<Menu>("/menu");
  const router = useRouter();
  const toast = useToast();

  if (loading) return <Loading />;
  if (!customer) return <Empty title="Sign in to see your orders" action={<Link href="/login?next=/orders"><Button variant="primary">Sign in</Button></Link>} />;
  if (orders.isLoading) return <Loading />;

  const reorder = async (o: Order) => {
    const d = await get<{ items: OrderItem[] }>(`/orders/${o.id}`, { auth: "customer" });
    let skipped = 0;
    for (const it of d.items.filter((i) => i.status !== "void")) {
      const m = menu.data?.items.find((x) => x.id === it.item_id);
      if (!m || !m.available_now) { skipped++; continue; }
      cart.add(m, { variant_id: it.variant_id, add_on_ids: it.add_ons.map((a) => a.id), qty: it.qty, note: it.note });
    }
    if (skipped) toast(`${skipped} item(s) aren't available right now`, "info");
    router.push("/cart");
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <h1 className="font-disp text-2xl font-extrabold">Your orders</h1>
      {!orders.data?.length && <Empty title="No orders yet" action={<Link href="/"><Button variant="primary">Order now</Button></Link>} />}
      {orders.data?.map((o) => (
        <Card key={o.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Link href={`/orders/${o.id}`} className="font-semibold hover:text-brand">{o.number}</Link>
            <Chip tone={o.status === "completed" ? "ok" : o.status === "cancelled" ? "hot" : "warn"}>{label(o.status)}</Chip>
            <span className="ml-auto"><Money value={o.total} /></span>
          </div>
          <div className="text-xs text-mute">{fmtDateTime(o.created_at)} · {label(o.type)}</div>
          <div className="flex gap-2">
            <Link href={`/orders/${o.id}`}><Button size="sm">{["completed", "cancelled"].includes(o.status) ? "Details" : "Track"}</Button></Link>
            {o.status === "completed" && <Button size="sm" variant="soft" onClick={() => reorder(o)}>Reorder</Button>}
          </div>
        </Card>
      ))}
    </div>
  );
}
