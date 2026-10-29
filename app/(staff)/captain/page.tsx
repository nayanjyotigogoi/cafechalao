"use client";

import { TableBills } from "@/modules/billing/components/TableBills";
import { useEffect, useRef, useState } from "react";
import { CustomerPicker } from "@/modules/customers/components/CustomerPicker";
import { dineinApi } from "@/modules/dinein/api";
import { FloorGrid, TABLE_STATUS } from "@/modules/dinein/components/FloorGrid";
import { MenuPicker, type PickedLine } from "@/modules/menu/components/MenuPicker";
import { ordersApi, type LineIn } from "@/modules/orders/api";
import { StaffBar } from "@/modules/staff/components/StaffBar";
import { useM, useQ } from "@/shared/api/hooks";
import { signOut, StaffGate } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { ago, cx, label, minsSince } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { beep } from "@/shared/realtime";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { Floor, FloorTable, OrderDetail, OrderListRow, StaffSession } from "@/shared/types/api";
import type { Notification } from "@/shared/types/entities";
import { Modal } from "@/shared/ui/overlay";
import { Avatar, Button, Card, Chip, Empty, Input, Label, Loading, Select } from "@/shared/ui/primitives";
import { PoweredBy } from "@/shared/ui/brand";
import { Icon } from "@/shared/ui/icons";

/** Captain (waiter) app (M2.4): table map, open table, attach customer, add items with notes and course, KOT, bill. */
export default function CaptainPage() {
  useTitle("Captain");
  return <StaffGate perm="orders.take">{(s) => <Captain session={s} />}</StaffGate>;
}

type Tab = "tables" | "orders" | "alerts" | "me";

function Captain({ session }: { session: StaffSession }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("tables");
  const floor = useQ<Floor>("/floor", { auth: "staff", live: true });
  const orders = useQ<OrderListRow[]>("/orders", { auth: "staff", query: { active: 1, type: "dine_in" }, live: true });
  const notes = useQ<Notification[]>("/notifications", { auth: "staff", live: true });
  const [tableId, setTableId] = useState<string | null>(null);
  const unread = notes.data?.filter((n) => !n.read && (!n.user_id || n.user_id === session.user.id)).length ?? 0;
  const lastUnread = useRef(unread);
  useEffect(() => {
    if (unread > lastUnread.current) beep(1040);
    lastUnread.current = unread;
  }, [unread]);
  const qrPending = orders.data?.filter((o) => o.channel === "qr" && o.status === "placed") ?? [];
  const accept = useM((id: string) => ordersApi.status(id, "accepted"), { success: "Confirmed · KOT sent" });

  const table = floor.data?.tables.find((x) => x.id === tableId) ?? null;
  return (
    <div className="flex min-h-dvh flex-col">
      <StaffBar title={`Captain · ${session.user.name.split(" ")[0]}`} compact />
      <main className="flex-1 p-3 pb-24">
        {tab === "tables" && (floor.data ? <FloorGrid floor={floor.data} selected={tableId} onPick={(x) => setTableId(x.id)} cols="grid-cols-3 sm:grid-cols-4 md:grid-cols-6" /> : <Loading />)}
        {tab === "orders" && (
          <div className="flex flex-col gap-3">
            {qrPending.length > 0 && <Label>QR orders waiting for you</Label>}
            {qrPending.map((o) => (
              <Card key={o.id} className="flex flex-col gap-2 border-warn">
                <div className="flex items-center gap-2"><b>{o.table_name}</b><span className="text-xs text-mute">{o.number} · {ago(o.created_at)}</span><span className="num ml-auto">{formatINR(o.total)}</span></div>
                <div className="text-sm">{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</div>
                <Button variant="primary" onClick={() => accept.mutate(o.id)}>Confirm and send KOT</Button>
              </Card>
            ))}
            <Label>Running tables</Label>
            {orders.data?.filter((o) => o.status !== "placed").map((o) => (
              <button key={o.id} onClick={() => { setTableId(o.table_id); setTab("tables"); }} className="flex cursor-pointer flex-col gap-1 rounded-2xl border-[1.5px] border-line bg-paper p-3 text-left">
                <div className="flex w-full items-center gap-2"><b>{o.table_name}</b><Chip tone={o.status === "ready" ? "ok" : "warn"}>{label(o.status)}</Chip>{o.bill_requested && <Chip tone="warn">Bill asked</Chip>}<span className="num ml-auto">{formatINR(o.total)}</span></div>
                <span className="text-xs text-mute">{o.items.filter((i) => i.status !== "void").map((i) => `${i.qty}× ${i.name} (${i.status})`).join(", ")}</span>
              </button>
            ))}
            {!orders.data?.length && <Empty title="No running tables" />}
          </div>
        )}
        {tab === "alerts" && (
          <div className="flex flex-col gap-2">
            {floor.data?.tables.filter((x) => x.session?.waiter_called_at).map((x) => (
              <Card key={x.id} className="flex items-center gap-2 border-rose">
                <span className="flex flex-1 items-center gap-1.5"><Icon name="bell" size={16} />{x.name} calling waiter</span><Chip tone="hot">{ago(x.session!.waiter_called_at)}</Chip>
                <Button size="sm" onClick={() => dineinApi.ackCall(x.id)}>On my way</Button>
              </Card>
            ))}
            {notes.data?.map((n) => (
              <Card key={n.id} className={cx("text-sm", !n.read && "border-brand")}><b>{n.title}</b><div className="text-mute">{n.body} · {ago(n.created_at)}</div></Card>
            ))}
            {!notes.data?.length && <Empty title="No alerts" />}
          </div>
        )}
        {tab === "me" && (
          <Card className="flex flex-col items-center gap-3">
            <Avatar name={session.user.name} color={session.user.avatar_color} size={64} />
            <b>{session.user.name}</b>
            <span className="text-sm text-mute">Captain · {orders.data?.filter((o) => o.captain_id === session.user.id).length ?? 0} tables running</span>
            <Button variant="danger" onClick={() => { signOut("staff"); location.href = "/staff"; }}>{t("Log out")}</Button>
          </Card>
        )}
        <PoweredBy />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t-[1.5px] border-line bg-paper" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {([["tables", t("Tables")], ["orders", `${t("Orders")}${qrPending.length ? ` (${qrPending.length})` : ""}`], ["alerts", `${t("Alerts")}${unread ? ` (${unread})` : ""}`], ["me", t("Me")]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} className={cx("min-h-14 flex-1 cursor-pointer text-xs", tab === v ? "font-semibold text-brand" : "text-mute")}>{l}</button>
        ))}
      </nav>
      {table && <TableSheet table={table} floor={floor.data!} onClose={() => setTableId(null)} />}
    </div>
  );
}

interface Pending extends LineIn { key: string; name: string; price: number }

function TableSheet({ table, floor, onClose }: { table: FloorTable; floor: Floor; onClose: () => void }) {
  // A table can have more than one bill (extra items after paying); the captain can open each one.
  const [billId, setBillId] = useState<string | null>(null);
  const shownId = billId ?? table.order?.id;
  const order = useQ<OrderDetail>(shownId ? `/orders/${shownId}` : null, { auth: "staff", live: true });
  const [guests, setGuests] = useState(table.seats > 2 ? 2 : table.seats);
  const [pending, setPending] = useState<Pending[]>([]);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [course, setCourse] = useState<"" | "starter" | "main" | "dessert">("");
  const [cust, setCust] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const d = order.data;

  const open = useM(() => ordersApi.open({ type: "dine_in", table_id: table.id, guests }), { success: `${table.name} opened` });
  const send = useM(async () => {
    const lines = pending.map(({ item_id, variant_id, add_on_ids, qty, note: n, course: c }) => ({ item_id, variant_id, add_on_ids, qty, note: n, course: c }));
    let o = d;
    if (!o) o = await ordersApi.open({ type: "dine_in", table_id: table.id, guests, lines });
    else if (lines.length) o = await ordersApi.addItems(o.id, lines, o.updated_at);
    await ordersApi.sendKot(o.id);
    setPending([]);
  }, { success: "KOT sent", onError: (e) => e.status === 409 && order.refetch() });
  const bill = useM(() => ordersApi.requestBill(d!.id), { success: "Bill requested from cashier" });
  const served = useM(() => ordersApi.status(d!.id, "served"), { success: "Marked served" });
  const move = useM(() => dineinApi.move(table.id, moveTo), { success: "Moved", onSuccess: onClose });
  const merge = useM(() => dineinApi.merge(table.id, [moveTo]), { success: "Merged", onSuccess: onClose });
  const status = useM((st: string) => dineinApi.tableStatus(table.id, st), { success: "Table updated" });

  const add = (p: PickedLine) => {
    setPending((ps) => [...ps, { key: `${Date.now()}`, item_id: p.item.id, variant_id: p.variant_id, add_on_ids: p.add_on_ids, qty: p.qty, note: [p.note, note].filter(Boolean).join(", "), course: course || null, name: p.item.name, price: p.item.variants.find((v) => v.id === p.variant_id)?.price ?? p.item.price }]);
  };
  const st = TABLE_STATUS[table.status];
  const free = floor.tables.filter((x) => x.id !== table.id && ["free", "cleaning"].includes(x.status));
  const busy = floor.tables.filter((x) => x.id !== table.id && ["occupied", "bill_requested"].includes(x.status));

  return (
    <Modal open onClose={onClose} title={<span>{table.name} <span className={cx("text-sm", st.cls.split(" ")[1])}>· {st.label}</span></span>} wide>
      <div className="flex flex-col gap-3">
        {table.session?.waiter_called_at && <Button variant="danger" onClick={() => dineinApi.ackCall(table.id)}><Icon name="bell" size={16} className="mr-1" />Calling waiter · acknowledge</Button>}
        {!d && table.status !== "occupied" && (
          <div className="flex flex-wrap items-center gap-2">
            <Label>Guests</Label>
            {[1, 2, 3, 4, 5, 6].map((n) => <Button key={n} size="sm" variant={guests === n ? "primary" : "outline"} onClick={() => setGuests(n)}>{n}</Button>)}
            <Button variant="primary" loading={open.isPending} onClick={() => open.mutate(undefined)}>Open table</Button>
            {table.status === "cleaning" && <Button onClick={() => status.mutate("free")}>Mark clean</Button>}
            {table.status === "reserved" && <Button onClick={() => status.mutate("free")}>Release reservation</Button>}
          </div>
        )}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{d.number} · {d.guests} guests · {minsSince(d.created_at)}m</span>
              <Button size="sm" variant="ghost" onClick={() => setCust(true)}>{d.customer_name ?? "+ Attach customer"}</Button>
              <span className="num ml-auto font-semibold">{formatINR(d.total)}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {d.items.filter((i) => i.status !== "void").map((i) => (
                <div key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{i.name}{i.variant_name ? ` (${i.variant_name})` : ""} × {i.qty}{i.course && <span className="text-mute"> · {i.course}</span>}{i.note && <span className="block text-[11px] text-rose">{i.note}</span>}</span>
                  <Chip tone={i.status === "ready" ? "ok" : i.status === "preparing" ? "warn" : i.status === "served" ? "neutral" : "info"}>{i.status === "preparing" ? "Cooking" : i.status === "new" ? "Not sent" : label(i.status)}</Chip>
                </div>
              ))}
            </div>
          </>
        )}
        {pending.length > 0 && (
          <div className="flex flex-col gap-1 rounded-xl border-[1.5px] border-dashed border-brand p-2">
            <Label>To send</Label>
            {pending.map((p) => (
              <div key={p.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{p.name} × {p.qty}{p.note && <span className="text-rose"> · {p.note}</span>}{p.course && <span className="text-mute"> · {p.course}</span>}</span>
                <button className="cursor-pointer text-mute" onClick={() => setPending((ps) => ps.filter((x) => x.key !== p.key))} aria-label="Remove">×</button>
              </div>
            ))}
          </div>
        )}
        {(d || table.status !== "occupied") && (
          adding ? (
            <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-line p-2">
              <div className="flex flex-wrap gap-2">
                <Input className="flex-1" placeholder="Note for the next items: less spicy, no onion" value={note} onChange={(e) => setNote(e.target.value)} />
                <Select className="w-32" value={course} onChange={(e) => setCourse(e.target.value as typeof course)} aria-label="Course"><option value="">Any course</option><option value="starter">Starter</option><option value="main">Main</option><option value="dessert">Dessert</option></Select>
              </div>
              <div className="h-[50dvh] overflow-hidden"><MenuPicker onPick={add} layout="phone" /></div>
              <Button onClick={() => setAdding(false)}>Done adding</Button>
            </div>
          ) : <Button variant="soft" onClick={() => setAdding(true)}>+ Add item (search menu)</Button>
        )}
        <div className="flex flex-wrap gap-2">
          {pending.length > 0 && <Button variant="primary" className="flex-1" loading={send.isPending} onClick={() => send.mutate(undefined)}>Send KOT ({pending.reduce((a, p) => a + p.qty, 0)})</Button>}
          {d && d.status === "ready" && <Button onClick={() => served.mutate(undefined)}>Served</Button>}
          {d && !d.bill_requested && <Button onClick={() => bill.mutate(undefined)} loading={bill.isPending}>Request bill</Button>}
        </div>
        {d?.table_bills && <TableBills bills={d.table_bills} currentId={d.id} compact onPick={setBillId} />}
        {d && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Select className="w-44" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Other table">
              <option value="">Move / merge with…</option>
              <optgroup label="Free (move)">{free.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
              <optgroup label="Running (merge)">{busy.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
            </Select>
            <Button size="sm" disabled={!free.some((x) => x.id === moveTo)} onClick={() => move.mutate(undefined)}>Move here →</Button>
            <Button size="sm" disabled={!busy.some((x) => x.id === moveTo)} onClick={() => merge.mutate(undefined)}>Merge into {table.name}</Button>
            {floor.tables.some((x) => x.merged_into === table.id) && <Button size="sm" onClick={() => dineinApi.split(table.id)}>Split merged</Button>}
          </div>
        )}
      </div>
      <CustomerPicker open={cust} onClose={() => setCust(false)} onPick={(c) => dineinApi.attachCustomer(table.id, c.id).then(() => order.refetch())} />
    </Modal>
  );
}
