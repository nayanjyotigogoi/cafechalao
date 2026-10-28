"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ordersApi } from "@/modules/orders/api";
import { CafeUpiQr } from "@/modules/billing/components/CafeUpiQr";
import { TableBills } from "@/modules/billing/components/TableBills";
import { useM, useQ } from "@/shared/api/hooks";
import { useCustomer } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { cx, fmtTime, label } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { OrderDetail } from "@/shared/types/api";
import { Button, Card, Empty, ErrorText, Label, Loading, Money, Stars, Textarea } from "@/shared/ui/primitives";

/** Live order tracking (M1.7): placed → accepted → preparing → ready / out for delivery → delivered. */
export default function TrackPage() {
  return (
    <Suspense>
      <Track />
    </Suspense>
  );
}

function Track() {
  const { id } = useParams<{ id: string }>();
  const table = useSearchParams().get("table");
  const s = useSettings();
  const { t } = useT();
  const { customer } = useCustomer();
  const o = useQ<OrderDetail>(`/orders/${id}`, { auth: customer ? "customer" : undefined, query: table ? { table_code: table } : undefined, live: true });
  useTitle(o.data ? `Order ${o.data.number}` : "Order");
  const cancel = useM(() => ordersApi.cancel(id, "Cancelled by customer", "customer"), { success: "Order cancelled" });
  const bill = useM(() => ordersApi.requestBill(id, table ?? undefined), { success: "Bill requested" });

  if (o.isLoading) return <Loading />;
  if (!o.data) return <Empty title="Order not found">{o.error instanceof Error ? o.error.message : ""}</Empty>;
  const d = o.data;
  const isDelivery = d.type === "delivery";
  const steps = [
    { key: "placed", label: t("Order placed"), at: d.created_at },
    { key: "accepted", label: t("Accepted by café"), at: d.accepted_at },
    { key: "preparing", label: t("Being prepared"), at: d.status_log.find((l) => l.status === "preparing")?.created_at },
    { key: isDelivery ? "out_for_delivery" : "ready", label: isDelivery ? t("Out for delivery") : d.type === "dine_in" ? "Ready to serve" : t("Ready") + " for pickup", at: isDelivery ? d.delivery?.picked_at : d.ready_at },
    { key: "completed", label: isDelivery ? t("Delivered") : d.type === "dine_in" ? "Served & billed" : "Picked up", at: d.completed_at },
  ];
  const rank: Record<string, number> = { placed: 0, accepted: 1, preparing: 2, ready: 3, out_for_delivery: 3, served: 3, delivered: 4, completed: 4 };
  const cur = rank[d.status] ?? 0;
  const prepLeft = Math.max(1, Math.max(...d.items.map(() => 8)) - Math.floor((Date.now() - new Date(d.accepted_at ?? d.created_at).getTime()) / 60000));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="font-disp text-2xl font-extrabold">Order {d.number}</h1>
        {d.token && <span className="num rounded-lg bg-ink px-2 py-0.5 text-bg">Token {d.token}</span>}
      </div>

      {d.payment_status === "pending" && d.status !== "cancelled" && (
        <Card className="flex flex-col items-center gap-2 border-warn text-center">
          <b>Waiting for {s.outlet.name} to confirm your UPI payment</b>
          <span className="text-sm text-mute">Haven&apos;t paid yet? Scan and pay now. Your order starts as soon as the café sees the payment.</span>
          <CafeUpiQr amount={d.total} size={150} />
        </Card>
      )}
      {d.status === "cancelled" ? (
        <Card className="border-rose text-rose">This order was cancelled.{d.payment_status === "paid" && " Your refund will be processed by the café."}</Card>
      ) : (
        <>
          {isDelivery && (
            <div className="img-ph grid h-36 place-items-center rounded-2xl border-[1.5px] border-line text-sm text-mute">
              {d.delivery?.rider ? `${d.delivery.rider.name} · ${d.delivery.rider.vehicle}` : "Rider will be assigned when your food is ready"}
              <span className="text-[11px]">Live GPS tracking arrives in Phase 3</span>
            </div>
          )}
          <Card className="flex flex-col gap-3">
            {steps.map((st, i) => (
              <div key={st.key} className="flex items-center gap-3">
                <span className={cx("grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] text-xs", i < cur || (i === cur && i === 4) ? "border-ink bg-ink text-bg" : i === cur ? "border-brand bg-brand text-on-brand" : "border-line")}>
                  {i < cur || (i === 4 && cur === 4) ? "✓" : i + 1}
                </span>
                <span className={cx("flex-1", i === cur && "font-semibold")}>
                  {st.label}
                  {i === cur && i === 2 && ` · ~${prepLeft} min`}
                </span>
                {st.at && <span className="num text-xs text-mute">{fmtTime(st.at)}</span>}
              </div>
            ))}
          </Card>
          {isDelivery && d.delivery_otp && cur < 4 && (
            <Card className="flex items-center justify-between">
              <span>Delivery OTP <span className="block text-xs text-mute">Share with the rider at handover</span></span>
              <b className="num font-disp text-3xl">{d.delivery_otp}</b>
            </Card>
          )}
        </>
      )}

      <Card className="flex flex-col gap-1.5 text-sm">
        <Label>{label(d.type)}{d.table ? ` · ${d.table.name}` : ""}{d.pickup_time ? ` · pickup ${d.pickup_time}` : ""}</Label>
        {d.items.filter((i) => i.status !== "void").map((i) => (
          <div key={i.id} className="flex justify-between gap-2">
            <span>{i.name}{i.variant_name ? ` (${i.variant_name})` : ""} × {i.qty}</span>
            <Money value={i.unit_price * i.qty} />
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
          <span>Total ({d.payment_status === "paid" ? "paid" : label(d.payment_method ?? "unpaid")})</span>
          <span className="num">{formatINR(d.total, { decimals: true })}</span>
        </div>
      </Card>

      {d.table_bills && <TableBills bills={d.table_bills} currentId={d.id} />}

      <div className="flex flex-wrap gap-2">
        <a href={`tel:${s.outlet.phone.replace(/\s/g, "")}`}><Button>Call café</Button></a>
        {d.invoice && <Link href={`/bill/${d.invoice.id}?key=${d.id}`}><Button>View / print bill</Button></Link>}
        {d.status === "placed" && customer && <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>Cancel order</Button>}
        {d.type === "dine_in" && d.status !== "completed" && !d.bill_requested && <Button loading={bill.isPending} onClick={() => bill.mutate(undefined)}>{t("Request bill")}</Button>}
        <Link href={table ? `/t/${table}` : "/"}><Button variant="ghost">{t("Order more")} →</Button></Link>
      </div>

      {d.status === "completed" && customer && d.customer_id === customer.id && !d.feedback && <Feedback id={d.id} isDelivery={isDelivery} />}
      {d.feedback && <Card className="text-sm">Thanks for your rating! {"★".repeat(Math.round((d.feedback.food + d.feedback.service + d.feedback.ambience) / 3))}</Card>}
    </div>
  );
}

/** Feedback after each order (M4.8): food, service, ambience/delivery, comment. */
function Feedback({ id, isDelivery }: { id: string; isDelivery: boolean }) {
  const [f, setF] = useState({ food: 0, service: 0, ambience: 0, comment: "" });
  const send = useM(() => ordersApi.feedback(id, f), { success: "Thanks for the feedback!" });
  return (
    <Card className="flex flex-col gap-3">
      <b>How was it?</b>
      {([["food", "Food"], ["service", "Service"], ["ambience", isDelivery ? "Delivery" : "Ambience"]] as const).map(([k, l]) => (
        <div key={k} className="flex items-center justify-between gap-2">
          <span className="text-sm">{l}</span>
          <Stars value={f[k]} onChange={(n) => setF({ ...f, [k]: n })} />
        </div>
      ))}
      <Textarea placeholder="Anything we should know?" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
      <ErrorText error={send.error} />
      <Button variant="primary" disabled={!f.food || !f.service || !f.ambience} loading={send.isPending} onClick={() => send.mutate(undefined)}>Send feedback</Button>
    </Card>
  );
}
