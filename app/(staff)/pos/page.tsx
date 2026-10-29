"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { billingApi } from "@/modules/billing/api";
import { ReceiptModal } from "@/modules/billing/components/ReceiptModal";
import { SettleModal } from "@/modules/billing/components/SettleModal";
import { TableBills } from "@/modules/billing/components/TableBills";
import { CustomerPicker } from "@/modules/customers/components/CustomerPicker";
import { deliveryApi } from "@/modules/delivery/api";
import { FloorGrid } from "@/modules/dinein/components/FloorGrid";
import { MenuPicker, type PickedLine } from "@/modules/menu/components/MenuPicker";
import { ordersApi, type LineIn } from "@/modules/orders/api";
import { ApprovalPin } from "@/modules/staff/components/ApprovalPin";
import { StaffBar } from "@/modules/staff/components/StaffBar";
import { ApiError } from "@/shared/api/client";
import { useM, useQ } from "@/shared/api/hooks";
import { StaffGate } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { cx, fmtTime, label, minsSince } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { priceOrder } from "@/shared/lib/pricing";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { DeliveryRow, Floor, OrderDetail, OrderListRow } from "@/shared/types/api";
import type { Customer, Invoice, OrderType, PaymentMode, Rider } from "@/shared/types/entities";
import { Modal, useToast } from "@/shared/ui/overlay";
import { Button, Chip, Empty, ErrorText, Field, Input, Label, Loading, MoneyInput, Segmented } from "@/shared/ui/primitives";
import { Icon } from "@/shared/ui/icons";

/** POS (M3.1): dine-in, takeaway, counter token and delivery billing, sized for tablet touch. */
export default function POSPage() {
  useTitle("POS");
  return <StaffGate perm="pos.bill">{() => <POS />}</StaffGate>;
}

interface Draft extends LineIn { key: string; name: string; variant_name: string | null; unit_price: number; gst_rate: number }
type Panel = "bill" | "online" | "open" | "bills";

function POS() {
  const s = useSettings();
  const { t } = useT();
  const toast = useToast();
  const f = s.flags.features;
  const modes = ([["dine_in", t("Dine-in"), f.dine_in], ["takeaway", t("Takeaway"), f.takeaway], ["counter", "Counter token", f.counter_tokens], ["delivery", t("Delivery"), f.delivery]] as const).filter((m) => m[2]);
  const [mode, setMode] = useState<OrderType>(modes[0]?.[0] ?? "takeaway");
  const [panel, setPanel] = useState<Panel>("bill");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [tableId, setTableId] = useState<string | null>(null);
  const [tablePicker, setTablePicker] = useState(false);
  const [guests, setGuests] = useState(2);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [custPicker, setCustPicker] = useState(false);
  const [phoneOrder, setPhoneOrder] = useState({ name: "", phone: "", address: "" });
  const [settle, setSettle] = useState<PaymentMode | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; change?: number; refund?: boolean } | null>(null);
  const [voiding, setVoiding] = useState<{ itemId: string; name: string; amount: number } | null>(null);

  const shift = useQ<{ id: string; opening_cash: number; opened_at: string; user_name: string } | null>("/shifts/current", { auth: "staff" });
  const order = useQ<OrderDetail>(orderId ? `/orders/${orderId}` : null, { auth: "staff", live: true });
  const floor = useQ<Floor>(f.dine_in ? "/floor" : null, { auth: "staff", live: true });
  const active = useQ<OrderListRow[]>("/orders", { auth: "staff", query: { active: 1 }, live: true });
  const online = (active.data ?? []).filter((o) => (o.channel === "app" || o.channel === "qr") && o.status !== "cancelled" && !(o.status === "completed" && o.payment_status === "paid"));
  // Needs the cashier now: a new order to accept, or a UPI payment to confirm (dine-in QR orders are already cooking).
  const needsAction = (o: OrderListRow) => o.status === "placed" || o.payment_status === "pending";
  const incoming = online.filter(needsAction);
  const open = (active.data ?? []).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "placed");

  const d = order.data;
  const table = floor.data?.tables.find((x) => x.id === (d?.table_id ?? tableId));

  // Instant local total for the screen (< 300 ms per add); the server computes the final bill at charge.
  const lines = [...(d?.items.filter((i) => i.status !== "void") ?? []).map((i) => ({ item_id: i.item_id, unit_price: i.unit_price, qty: i.qty, gst_rate: i.gst_rate, complimentary: i.complimentary })), ...draft.map((x) => ({ item_id: x.item_id, unit_price: x.unit_price, qty: x.qty, gst_rate: x.gst_rate }))];
  const est = useMemo(() => (lines.length ? priceOrder({ lines, order_type: mode, tax: s.tax }) : null), [JSON.stringify(lines), mode, s.tax]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of lines) c[l.item_id] = (c[l.item_id] ?? 0) + l.qty;
    return c;
  }, [JSON.stringify(lines)]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setOrderId(null); setDraft([]); setTableId(null); setCustomer(null); setPhoneOrder({ name: "", phone: "", address: "" }); setPanel("bill");
  };

  const pick = (p: PickedLine) => {
    const v = p.item.variants.find((x) => x.id === p.variant_id);
    const addOns = p.item.add_on_groups.flatMap((g) => g.add_ons).filter((a) => p.add_on_ids.includes(a.id));
    const key = `${p.item.id}|${p.variant_id ?? ""}|${p.add_on_ids.join(",")}|${p.note}`;
    setDraft((ds) => ds.some((x) => x.key === key) ? ds.map((x) => (x.key === key ? { ...x, qty: x.qty + p.qty } : x)) : [...ds, {
      key, item_id: p.item.id, variant_id: p.variant_id, add_on_ids: p.add_on_ids, qty: p.qty, note: p.note, name: p.item.name, variant_name: v?.name ?? null,
      unit_price: (v?.price ?? p.item.price) + addOns.reduce((a, x) => a + x.price, 0), gst_rate: p.item.gst_rate ?? s.tax.default_gst_rate,
    }]);
  };

  /** Saves the draft to the server (creating the order if needed) and optionally sends the KOT. */
  const save = useM(async (sendKot: boolean): Promise<OrderDetail | null> => {
    const ls: LineIn[] = draft.map(({ item_id, variant_id, add_on_ids, qty, note }) => ({ item_id, variant_id, add_on_ids, qty, note }));
    let o = d ?? null;
    if (!o) {
      if (mode === "dine_in" && !tableId) throw new ApiError(422, "Pick a table first");
      o = await ordersApi.open({ type: mode, table_id: tableId ?? undefined, guests, customer_id: customer?.id ?? null, lines: ls, customer_name: phoneOrder.name || undefined, customer_phone: phoneOrder.phone || undefined, address: phoneOrder.address || undefined });
      setOrderId(o.id);
      if (sendKot && o.items.some((i) => i.status === "new")) o = (await ordersApi.sendKot(o.id)).order;
    } else if (ls.length) {
      o = await ordersApi.addItems(o.id, ls, o.updated_at, sendKot);
    } else if (sendKot && o.items.some((i) => i.status === "new")) {
      o = (await ordersApi.sendKot(o.id, o.updated_at)).order;
    }
    setDraft([]);
    return o;
  }, { onError: (e) => { if (e.status === 409) order.refetch(); } });

  const kot = () => save.mutate(true, { onSuccess: () => toast("KOT sent to kitchen") });
  const charge = (m: PaymentMode) => save.mutate(true, { onSuccess: (o) => { if (o) setSettle(m); } });

  const accept = useM((id: string) => ordersApi.status(id, "accepted"), { success: "Accepted · KOT sent" });
  const reject = useM((id: string) => ordersApi.cancel(id, "Rejected by café", "staff"), { success: "Order rejected" });
  const handOver = useM((id: string) => ordersApi.status(id, "completed"), { success: "Handed over" });
  const confirmPay = useM((id: string) => ordersApi.confirmPayment(id), { success: "Payment confirmed · order sent to kitchen" });
  const openShift = useM((cash: number) => billingApi.openShift(cash), { success: "Shift opened" });

  const pickTable = async (id: string) => {
    setTablePicker(false);
    const ft = floor.data?.tables.find((x) => x.id === id);
    setTableId(id);
    setDraft([]);
    setOrderId(ft?.order?.id ?? null);
    setMode("dine_in");
    setPanel("bill");
  };
  const loadOrder = (o: OrderListRow) => { setOrderId(o.id); setTableId(o.table_id); setMode(o.type); setDraft([]); setPanel("bill"); };

  if (shift.isLoading) return <Loading />;

  return (
    <div className="flex h-dvh flex-col">
      <StaffBar title="POS">
        <div className="scrollbar-none flex max-w-full gap-1 overflow-x-auto rounded-xl bg-fill p-1">
          {modes.map(([v, l]) => (
            <button key={v} onClick={() => { if (v !== mode) reset(); setMode(v); }} className={cx("min-h-9 shrink-0 cursor-pointer rounded-lg px-3 text-[13px]", mode === v && panel === "bill" ? "bg-ink font-semibold text-bg" : "")}>{l}</button>
          ))}
          <button onClick={() => setPanel("online")} className={cx("min-h-9 shrink-0 cursor-pointer rounded-lg px-3 text-[13px]", panel === "online" && "bg-ink font-semibold text-bg")}>
            Online {incoming.length > 0 && <span className="num ml-1 rounded-full bg-rose px-1.5 text-[11px] text-white">{incoming.length}</span>}
          </button>
          <button onClick={() => setPanel("open")} className={cx("min-h-9 shrink-0 cursor-pointer rounded-lg px-3 text-[13px]", panel === "open" && "bg-ink font-semibold text-bg")}>Open bills {open.length}</button>
          <button onClick={() => setPanel("bills")} className={cx("min-h-9 shrink-0 cursor-pointer rounded-lg px-3 text-[13px]", panel === "bills" && "bg-ink font-semibold text-bg")}>Bills</button>
        </div>
        {shift.data && <Chip>Shift: {shift.data.user_name?.split(" ")[0]} · {Math.floor(minsSince(shift.data.opened_at) / 60)}h {minsSince(shift.data.opened_at) % 60}m</Chip>}
        <Link href="/pos/close"><Button size="sm">Day close</Button></Link>
      </StaffBar>

      {!shift.data && <OpenShift onOpen={(c) => openShift.mutate(c)} busy={openShift.isPending} />}

      {panel === "bill" ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-0 min-w-0 flex-[1.6] flex-col max-md:max-h-[50dvh]">
            <MenuPicker onPick={pick} counts={counts} />
          </div>
          <aside className="flex min-h-0 flex-1 flex-col border-t-[1.5px] border-line bg-bg md:max-w-md md:border-l-[1.5px] md:border-t-0">
            <div className="flex flex-wrap items-center gap-2 border-b-[1.5px] border-line p-3">
              <b className="flex-1">
                {mode === "dine_in" ? (table ? `${table.name} · ${d?.guests ?? guests} guests` : "No table") : label(mode)}
                {d && <span className="ml-2 text-xs font-normal text-mute">{d.number}{d.token ? ` · Token ${d.token}` : ""}</span>}
              </b>
              {mode === "dine_in" && <Button size="sm" onClick={() => setTablePicker(true)}>{table ? "Table ▾" : "Pick table"}</Button>}
              <Button size="sm" variant="ghost" onClick={() => setCustPicker(true)}>{customer?.name ?? d?.customer_name ?? "+ Customer"}</Button>
              {(d || draft.length > 0) && <Button size="sm" variant="ghost" onClick={reset}>New</Button>}
            </div>
            {mode === "dine_in" && !table && !d && <p className="p-3 text-sm text-mute">Pick a table to start. Guests: <input type="number" min={1} value={guests} onChange={(e) => setGuests(Number(e.target.value))} className="num w-14 rounded border border-line bg-paper px-1" /></p>}
            {mode === "delivery" && !d && (
              <div className="grid gap-2 border-b border-line p-3">
                <Input placeholder="Customer name" value={phoneOrder.name} onChange={(e) => setPhoneOrder({ ...phoneOrder, name: e.target.value })} />
                <Input placeholder="Mobile" inputMode="tel" value={phoneOrder.phone} onChange={(e) => setPhoneOrder({ ...phoneOrder, phone: e.target.value })} />
                <Input placeholder="Delivery address" value={phoneOrder.address} onChange={(e) => setPhoneOrder({ ...phoneOrder, address: e.target.value })} />
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
              {d?.items.filter((i) => i.status !== "void").map((i) => (
                <div key={i.id} className="flex items-center gap-2 rounded-xl border-[1.5px] border-line bg-paper px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {i.name}{i.variant_name ? ` (${i.variant_name})` : ""}{i.complimentary && <span className="text-ok"> · comp</span>}
                    {(i.note || i.add_ons.length > 0) && <span className="block text-[11px] text-rose">{[...i.add_ons.map((a) => a.name), i.note].filter(Boolean).join(", ")}</span>}
                  </span>
                  <Chip tone={i.status === "ready" ? "ok" : i.status === "preparing" ? "warn" : i.status === "new" ? "neutral" : "info"}>{i.status === "new" ? "not sent" : label(i.status)}</Chip>
                  <span className="num w-8 text-center">×{i.qty}</span>
                  <span className="num w-16 text-right">{formatINR(i.complimentary ? 0 : i.unit_price * i.qty)}</span>
                  {i.status === "new" ? (
                    <button className="cursor-pointer px-1 text-mute" aria-label={`Remove ${i.name}`} onClick={() => ordersApi.editItem(i.id, { qty: 0 }).then(() => order.refetch())}>×</button>
                  ) : (
                    <button className="cursor-pointer px-1 text-xs text-rose" onClick={() => setVoiding({ itemId: i.id, name: i.name, amount: i.unit_price * i.qty })}>Void</button>
                  )}
                </div>
              ))}
              {draft.map((x) => (
                <div key={x.key} className="flex items-center gap-2 rounded-xl border-[1.5px] border-dashed border-brand bg-paper px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">{x.name}{x.variant_name ? ` (${x.variant_name})` : ""}{x.note && <span className="block text-[11px] text-rose">{x.note}</span>}</span>
                  <div className="flex items-center rounded-lg border border-line">
                    <button className="min-h-9 w-8 cursor-pointer" onClick={() => setDraft((ds) => ds.map((y) => (y.key === x.key ? { ...y, qty: y.qty - 1 } : y)).filter((y) => y.qty > 0))} aria-label="Less">−</button>
                    <span className="num w-6 text-center">{x.qty}</span>
                    <button className="min-h-9 w-8 cursor-pointer" onClick={() => setDraft((ds) => ds.map((y) => (y.key === x.key ? { ...y, qty: y.qty + 1 } : y)))} aria-label="More">+</button>
                  </div>
                  <span className="num w-16 text-right">{formatINR(x.unit_price * x.qty)}</span>
                </div>
              ))}
              {!d?.items.length && !draft.length && <p className="py-8 text-center text-sm text-mute">Tap items to add them to the bill.</p>}
            </div>
            <div className="flex flex-col gap-2 border-t-[1.5px] border-line p-3">
              {est && (
                <div className="grid gap-0.5 text-sm">
                  <div className="flex justify-between"><span>{t("Subtotal")}</span><span className="num">{formatINR(est.subtotal)}</span></div>
                  {est.service_charge > 0 && <div className="flex justify-between"><span>Service charge {s.tax.service_charge_pct}%</span><span className="num">{formatINR(est.service_charge, { decimals: true })}</span></div>}
                  {est.bill_of_supply ? <div className="flex justify-between text-mute"><span>Bill of Supply</span><span>no GST</span></div> : <div className="flex justify-between"><span>GST</span><span className="num">{formatINR(est.tax, { decimals: true })}</span></div>}
                  <div className="flex items-end justify-between"><b>{t("Total")}</b><b className="num font-disp text-2xl">{formatINR(est.total)}</b></div>
                </div>
              )}
              {d?.table_bills && <TableBills bills={d.table_bills} currentId={d.id} compact onPick={(id) => { setOrderId(id); setDraft([]); }} />}
              <ErrorText error={save.error?.status === 409 ? null : save.error} />
              <div className="grid grid-cols-4 gap-1.5">
                {(["cash", "upi", "card"] as const).filter((m) => s.payment.modes[m]).map((m) => (
                  <Button key={m} className="touch" disabled={!lines.length || !shift.data} onClick={() => charge(m)}>{m === "upi" ? "UPI" : t(m === "cash" ? "Cash" : "Card")}</Button>
                ))}
                <Button className="touch" disabled={!lines.length || !shift.data} onClick={() => charge("cash")}>{t("Split")}</Button>
              </div>
              <div className="flex gap-2">
                <Button className="touch flex-1" disabled={!draft.length && !d?.items.some((i) => i.status === "new")} loading={save.isPending && save.variables === true && !settle} onClick={kot}>{t("Send KOT")}</Button>
                {d && d.type === "dine_in" && !d.bill_requested && <Button className="touch" onClick={() => ordersApi.requestBill(d.id).then(() => order.refetch())}>Print bill</Button>}
                <Button variant="primary" className="touch flex-1" disabled={!lines.length || !shift.data} onClick={() => charge("cash")}>{t("Charge")} {est ? formatINR(est.total) : ""}</Button>
              </div>
            </div>
          </aside>
        </div>
      ) : panel === "online" ? (
        <OnlinePanel orders={online} onAccept={(id) => accept.mutate(id)} onReject={(id) => reject.mutate(id)} onHandOver={(id) => handOver.mutate(id)} onLoad={loadOrder} onConfirmPay={(id) => confirmPay.mutate(id)} />
      ) : panel === "open" ? (
        <div className="grid content-start gap-2 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
          {!open.length && <Empty title="No open bills" />}
          {open.map((o) => (
            <button key={o.id} onClick={() => loadOrder(o)} className="flex cursor-pointer flex-col gap-1 rounded-2xl border-[1.5px] border-line bg-paper p-3 text-left hover:border-brand">
              <div className="flex w-full items-center gap-2"><b>{o.table_name ?? (o.token ? `Token ${o.token}` : label(o.type))}</b><span className="text-xs text-mute">{o.number}</span>{o.payment_status === "pending" && <Chip tone="warn">Paid by UPI · confirm in Online</Chip>}{o.bill_requested && <Chip tone="warn">Bill asked</Chip>}<span className="num ml-auto">{formatINR(o.total)}</span></div>
              <span className="text-xs text-mute">{o.items.filter((i) => i.status !== "void").map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
              <span className="text-[11px] text-mute">{label(o.status)} · {fmtTime(o.created_at)}</span>
            </button>
          ))}
        </div>
      ) : (
        <BillsPanel onOpen={(id) => setReceipt({ id, refund: true })} />
      )}

      <Modal open={tablePicker} onClose={() => setTablePicker(false)} title="Pick a table" wide>
        {floor.data ? <FloorGrid floor={floor.data} selected={tableId} onPick={(tb) => pickTable(tb.id)} /> : <Loading />}
      </Modal>
      <CustomerPicker open={custPicker} onClose={() => setCustPicker(false)} onPick={async (c) => {
        setCustomer(c);
        if (d?.table_id) await import("@/modules/dinein/api").then((m) => m.dineinApi.attachCustomer(d.table_id!, c.id));
      }} />
      {d && settle && <SettleModal order={d} open defaultMode={settle} onClose={() => setSettle(null)} onDone={(r) => { setSettle(null); setReceipt({ id: r.invoiceId, change: r.change }); }} />}
      {receipt && <ReceiptModal invoiceId={receipt.id} change={receipt.change} allowRefund={receipt.refund} onClose={() => { setReceipt(null); if (!receipt.refund) reset(); }} />}
      {voiding && d && <VoidModal order={d} item={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}

function OpenShift({ onOpen, busy }: { onOpen: (cash: number) => void; busy: boolean }) {
  const [cash, setCash] = useState<number | null>(200000);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b-[1.5px] border-warn bg-warn/10 px-4 py-3 text-sm">
      <b>Open your shift to start billing.</b>
      <span>Opening cash in drawer</span>
      <div className="w-36"><MoneyInput value={cash} onChange={setCash} aria-label="Opening cash" /></div>
      <Button variant="primary" loading={busy} onClick={() => onOpen(cash ?? 0)}>Open shift</Button>
    </div>
  );
}

function VoidModal({ order, item, onClose }: { order: OrderDetail; item: { itemId: string; name: string; amount: number }; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState(false);
  const run = useM((approver_id?: string) => ordersApi.void(order.id, { order_item_id: item.itemId, reason, approver_id }), {
    success: `${item.name} voided`,
    onError: (e) => e.code === "approval_required" && setPin(true),
    onSuccess: onClose,
  });
  const comp = useM((approver_id?: string) => ordersApi.complimentary(item.itemId, { reason, approver_id }), { success: "Marked complimentary", onSuccess: onClose, onError: (e) => e.code === "approval_required" && setPin(true) });
  return (
    <Modal open onClose={onClose} title={`Void ${item.name}`} footer={<><Button onClick={() => comp.mutate(undefined)} disabled={!reason} loading={comp.isPending}>Make complimentary</Button><Button variant="danger" disabled={!reason} loading={run.isPending} onClick={() => run.mutate(undefined)}>Void {formatINR(item.amount)}</Button></>}>
      <Field label="Reason (saved in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer changed mind, wrong item…" /></Field>
      <p className="mt-2 text-xs text-mute">Already sent to the kitchen. Above your void limit a manager PIN is asked.</p>
      <ApprovalPin open={pin} onClose={() => setPin(false)} kind="void_value" amount={item.amount} reason={`Void ${item.name} · ${formatINR(item.amount)}`} onApproved={(id) => { setPin(false); run.mutate(id); }} />
    </Modal>
  );
}

function OnlinePanel({ orders, onAccept, onReject, onHandOver, onLoad, onConfirmPay }: { orders: OrderListRow[]; onAccept: (id: string) => void; onReject: (id: string) => void; onHandOver: (id: string) => void; onLoad: (o: OrderListRow) => void; onConfirmPay: (id: string) => void }) {
  const deliveries = useQ<DeliveryRow[]>("/deliveries", { auth: "staff", query: { active: 1 }, live: true });
  const riders = useQ<Rider[]>("/riders", { auth: "staff" });
  const assign = useM(({ id, riders: r }: { id: string; riders: string[] }) => deliveryApi.assign(id, r), { success: "Request sent to rider" });
  const [tab, setTab] = useState<"new" | "live">("new");
  const isNew = (o: OrderListRow) => o.status === "placed" || o.payment_status === "pending";
  const list = orders.filter((o) => (tab === "new" ? isNew(o) : !isNew(o)));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <Segmented value={tab} onChange={setTab} options={[{ value: "new", label: "New & to confirm", count: orders.filter(isNew).length }, { value: "live", label: "In progress", count: orders.filter((o) => !isNew(o)).length }]} />
      {!list.length && <Empty title={tab === "new" ? "No new online orders" : "Nothing in progress"}>Orders from the app, website and table QR show up here.</Empty>}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((o) => {
          const del = deliveries.data?.find((x) => x.order_id === o.id);
          return (
            <div key={o.id} className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-line bg-paper p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{o.number}</b>
                <Chip>{label(o.type)}{o.table_name ? ` · ${o.table_name}` : ""}</Chip>
                <Chip tone={o.payment_status === "paid" ? "ok" : o.payment_status === "pending" ? "warn" : "neutral"}>{o.payment_status === "paid" ? "Paid" : label(o.payment_method ?? "unpaid")}</Chip>
                <span className="num ml-auto font-semibold">{formatINR(o.total)}</span>
              </div>
              <div className="text-sm">{o.customer_name ?? "Guest"} {o.customer_phone && <span className="text-mute">· {o.customer_phone}</span>}</div>
              {o.address_text && <div className="flex items-start gap-1 text-xs text-mute"><Icon name="pin" size={14} className="mt-px" />{o.address_text}</div>}
              {o.pickup_time && <div className="text-xs text-mute">Pickup {o.pickup_time}</div>}
              <div className="text-xs">{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}{o.note && <span className="text-rose"> · “{o.note}”</span>}</div>
              <div className="text-[11px] text-mute">{label(o.status)} · {fmtTime(o.created_at)} ({minsSince(o.created_at)}m ago)</div>
              <div className="flex flex-wrap gap-2">
                {o.payment_status === "pending" ? (
                  <>
                    <span className="w-full text-xs text-warn">Customer paid by UPI QR{(o as { payment_reference?: string }).payment_reference ? ` · ref ${(o as { payment_reference?: string }).payment_reference}` : ""}. Check your UPI app, then confirm.</span>
                    <Button size="sm" variant="primary" onClick={() => onConfirmPay(o.id)}>Payment received ✓</Button>
                    {o.type === "dine_in"
                      ? <Button size="sm" onClick={() => onLoad(o)}>Not received · charge at counter</Button>
                      : <Button size="sm" variant="danger" onClick={() => onReject(o.id)}>Not received · cancel</Button>}
                  </>
                ) : o.status === "placed" ? (
                  <>
                    <Button size="sm" variant="primary" onClick={() => onAccept(o.id)}>Accept · send KOT</Button>
                    <Button size="sm" variant="danger" onClick={() => onReject(o.id)}>Reject</Button>
                  </>
                ) : (
                  <>
                    {o.type === "takeaway" && o.status === "ready" && o.payment_status === "paid" && <Button size="sm" variant="primary" onClick={() => onHandOver(o.id)}>Handed over</Button>}
                    {o.payment_status !== "paid" && o.type !== "delivery" && <Button size="sm" onClick={() => onLoad(o)}>Open to charge</Button>}
                    {del && !["picked_up", "on_the_way", "delivered"].includes(del.status) && (
                      <select className="min-h-9 rounded-lg border-[1.5px] border-line bg-paper px-2 text-sm" value="" onChange={(e) => assign.mutate({ id: del.id, riders: e.target.value === "all" ? (riders.data ?? []).filter((r) => r.online && r.active).map((r) => r.id) : [e.target.value] })}>
                        <option value="">{del.status === "requested" ? "Requested… reassign" : del.rider_name ? `Rider: ${del.rider_name}` : "Assign rider ▾"}</option>
                        {riders.data?.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name} · {r.type}{r.online ? "" : " (offline)"}</option>)}
                        <option value="all">Send to all online riders</option>
                      </select>
                    )}
                    {del?.rider_name && <Chip tone="info">{del.rider_name} · {label(del.status)}</Chip>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BillsPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const inv = useQ<Invoice[]>("/invoices", { auth: "staff", query: { date: new Date().toISOString().slice(0, 10) } });
  const [q, setQ] = useState("");
  const rows = (inv.data ?? []).filter((i) => !q || i.number.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2"><Label>Today&apos;s bills</Label><Input className="ml-auto max-w-xs" placeholder="Search bill no." value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {inv.isLoading && <Loading />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((i) => (
          <button key={i.id} onClick={() => onOpen(i.id)} className="flex cursor-pointer items-center gap-2 rounded-xl border-[1.5px] border-line bg-paper p-3 text-left text-sm hover:border-brand">
            <span className="flex-1"><b className="num">{i.number}</b><span className="block text-xs text-mute">{fmtTime(i.created_at)}{i.reprints ? ` · reprinted ${i.reprints}×` : ""}</span></span>
            <span className="num">{formatINR(i.total)}</span>
          </button>
        ))}
      </div>
      {!rows.length && !inv.isLoading && <Empty title="No bills yet today" />}
    </div>
  );
}
