"use client";

import { useState } from "react";
import { marketingApi } from "@/modules/marketing/api";
import { outletApi } from "@/modules/outlet/api";
import { useM, useQ } from "@/shared/api/hooks";
import { fmtDate, label } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useSettings } from "@/shared/tenant/TenantProvider";
import type { Menu } from "@/shared/types/api";
import type { Coupon, Feedback, GiftCard, LoyaltySettings, MembershipPlan, Offer } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { FormFields, FormModal, type Values } from "@/shared/ui/form";
import { Button, Card, Chip, Field, Label, Loading, Money, MoneyInput, PageTitle, ProgressBar, Segmented, Stars, Stat, Toggle } from "@/shared/ui/primitives";
import { put } from "@/shared/api/client";

/** Customers and marketing (M4.2–M4.8). Campaign messages are free click-to-WhatsApp links or email in Phase 1. */
type Tab = "budget" | "coupons" | "loyalty" | "gift" | "members" | "offers" | "greetings" | "feedback";

interface Budget { month: string; amount: number; enforce: boolean; spent: { coupons: number; expenses: number; total: number }; remaining: number }

/** Monthly marketing budget: coupon discounts and Marketing expenses are deducted from it. */
function BudgetTab() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const b = useQ<Budget>("/marketing/budget", { auth: "staff", query: { month } });
  const [edit, setEdit] = useState<{ amount: number; enforce: boolean } | null>(null);
  const save = useM(() => put("/marketing/budget", { month, ...edit }, { auth: "staff" }), { success: "Budget saved", onSuccess: () => setEdit(null) });
  if (!b.data) return <Loading />;
  const d = b.data;
  const used = d.amount ? Math.min(100, (d.spent.total / d.amount) * 100) : 0;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2"><Label>Month</Label><input type="month" className="min-h-11 rounded-lg border-[1.5px] border-line bg-paper px-3 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Budget" value={formatINR(d.amount)} />
        <Stat label="Spent" value={formatINR(d.spent.total)} sub={`Coupons ${formatINR(d.spent.coupons)} · expenses ${formatINR(d.spent.expenses)}`} />
        <Stat label="Left" value={formatINR(d.remaining)} tone={d.remaining < 0 ? "hot" : d.amount && d.remaining < d.amount * 0.1 ? "warn" : undefined} />
        <Stat label="Coupons when used up" value={d.enforce ? "Stop" : "Keep going"} />
      </div>
      <ProgressBar value={used} tone={used >= 100 ? "hot" : used > 80 ? "warn" : "ok"} />
      {edit ? (
        <Card className="flex flex-col gap-3">
          <Field label="Budget for the month"><MoneyInput value={edit.amount} onChange={(v) => setEdit({ ...edit, amount: v })} /></Field>
          <Toggle checked={edit.enforce} onChange={(v) => setEdit({ ...edit, enforce: v })} label="Stop coupons once the budget is used up" />
          <div className="flex gap-2"><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></div>
        </Card>
      ) : <Button className="self-start" variant="primary" onClick={() => setEdit({ amount: d.amount, enforce: d.enforce })}>Set budget</Button>}
      <p className="text-xs text-mute">Spend counts the discount given through coupons plus expenses in the Marketing category (ads, flyers). Add those under Expenses.</p>
    </div>
  );
}

export function MarketingAdmin({ initial = "budget" }: { initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  const f = useSettings().flags.features;
  const tabs = ([["budget", "Budget", true], ["coupons", "Coupons", f.coupons], ["loyalty", "Loyalty", f.loyalty], ["gift", "Gift cards", f.gift_cards], ["members", "Memberships", f.memberships], ["offers", "Offers", f.offers], ["greetings", "Birthdays", true], ["feedback", "Feedback", true]] as const)
    .filter((x) => x[2]).map(([value, l]) => ({ value: value as Tab, label: l }));
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Marketing" sub="Bring customers back: loyalty, coupons, gift cards, memberships, offers and birthday wishes." />
      <Segmented value={tab} onChange={setTab} options={tabs} />
      {tab === "budget" && <BudgetTab />}
      {tab === "coupons" && <Coupons />}
      {tab === "loyalty" && <Loyalty />}
      {tab === "gift" && <GiftCards />}
      {tab === "members" && <Memberships />}
      {tab === "offers" && <Offers />}
      {tab === "greetings" && <Greetings />}
      {tab === "feedback" && <FeedbackList />}
    </div>
  );
}

const ORDER_TYPES = [{ value: "dine_in", label: "Dine-in" }, { value: "takeaway", label: "Takeaway" }, { value: "delivery", label: "Delivery" }, { value: "counter", label: "Counter" }];

function Coupons() {
  const rows = useQ<Coupon[]>("/coupons", { auth: "staff" });
  const menu = useQ<Menu>("/menu");
  const [e, setE] = useState<Values | null>(null);
  const save = useM(({ value_pct, value_money, ...v }: Values) => marketingApi.saveCoupon({ ...v, code: String(v.code ?? "").toUpperCase(), value: v.kind === "flat" ? value_money : value_pct } as { id?: string }), { success: "Coupon saved", onSuccess: () => setE(null) });
  return (
    <>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} search onRowClick={(r) => setE({ ...r, value_pct: r.kind === "pct" ? r.value : null, value_money: r.kind === "flat" ? r.value : null })}
        toolbar={<Button size="sm" variant="primary" onClick={() => setE({ kind: "pct", active: true, order_types: [], item_ids: [], usage_limit_per_customer: 1, valid_from: new Date().toISOString().slice(0, 10) })}>+ Coupon</Button>}
        columns={[
          { key: "code", header: "Code", cell: (r) => <b className="num">{r.code}</b> },
          { key: "value", header: "Discount", value: (r) => (r.kind === "pct" ? `${r.value}%${r.max_discount ? ` up to ${formatINR(r.max_discount)}` : ""}` : formatINR(r.value)) },
          { key: "min_order", header: "Min order", value: (r) => formatINR(r.min_order) },
          { key: "valid", header: "Valid", value: (r) => `${fmtDate(r.valid_from)} – ${fmtDate(r.valid_to)}`, hideSm: true },
          { key: "used", header: "Used", value: (r) => `${r.used_count}${r.usage_limit_total ? ` / ${r.usage_limit_total}` : ""}` },
          { key: "active", header: "Status", cell: (r) => <Chip tone={r.active ? "ok" : "neutral"}>{r.active ? "Active" : "Off"}</Chip> },
        ]} />
      <FormModal open={!!e} title="Coupon" initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} error={save.error} wide
        fields={[
          { name: "code", label: "Code", type: "text", required: true },
          { name: "kind", label: "Type", type: "select", options: [{ value: "pct", label: "% off" }, { value: "flat", label: "₹ off" }], required: true },
          ...(e?.kind === "flat" ? [{ name: "value_money", label: "₹ off", type: "money" as const }] : [{ name: "value_pct", label: "% off", type: "number" as const, min: 1, max: 100 }, { name: "max_discount", label: "Max discount", type: "money" as const }]),
          { name: "min_order", label: "Minimum order", type: "money" },
          { name: "valid_from", label: "Valid from", type: "date", required: true },
          { name: "valid_to", label: "Valid to", type: "date", required: true },
          { name: "usage_limit_total", label: "Total uses (blank = no limit)", type: "number" },
          { name: "usage_limit_per_customer", label: "Uses per customer", type: "number" },
          { name: "order_types", label: "Order types (none = all)", type: "checks", options: ORDER_TYPES },
          { name: "item_ids", label: "Only these items (none = whole menu)", type: "checks", options: (menu.data?.items ?? []).map((i) => ({ value: i.id, label: i.name })) },
          { name: "active", label: "Active", type: "toggle" },
        ]} />
    </>
  );
}

function Loyalty() {
  const s = useSettings();
  const ls = useQ<LoyaltySettings>("/loyalty-settings", { auth: "staff" });
  const [v, setV] = useState<Values | null>(null);
  const save = useM(() => outletApi.saveSection("loyalty", v!), { success: "Loyalty rules saved" });
  if (!ls.data) return <Loading />;
  const val = v ?? (ls.data as unknown as Values);
  return (
    <Card className="flex max-w-2xl flex-col gap-3">
      <FormFields values={val} onChange={setV} fields={[
        { name: "enabled", label: "Loyalty points on", type: "toggle" },
        { name: "earn_per_rupees", label: "1 point for every ₹…", type: "number", min: 1 },
        { name: "point_value", label: "Value of 1 point (paise)", type: "number", min: 1, hint: "25 = ₹0.25 per point" },
        { name: "min_bill_to_redeem", label: "Minimum bill to redeem", type: "money" },
        { name: "expiry_days", label: "Points expire after (days)", type: "number" },
      ]} />
      <p className="text-sm text-mute">Example: a ₹500 bill earns {Math.floor(500 / Number(val.earn_per_rupees || 10))} points worth {formatINR(Math.floor(500 / Number(val.earn_per_rupees || 10)) * Number(val.point_value || 0))} at {s.outlet.name}.</p>
      <Button variant="primary" className="self-start" disabled={!v} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
    </Card>
  );
}

function GiftCards() {
  const rows = useQ<GiftCard[]>("/gift-cards", { auth: "staff" });
  const [e, setE] = useState<Values | null>(null);
  const sell = useM((v: Values) => marketingApi.sellGiftCard(v as { value: number }), { success: (g) => `Gift card ${g.code} created. Take the payment at the POS.`, onSuccess: () => setE(null) });
  const toggle = useM(({ id, a }: { id: string; a: boolean }) => marketingApi.toggleGiftCard(id, a));
  return (
    <>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} search exportName="gift-cards" toolbar={<Button size="sm" variant="primary" onClick={() => setE({ value: 100000 })}>+ Sell gift card</Button>}
        columns={[
          { key: "code", header: "Code", cell: (r) => <b className="num">{r.code}</b> },
          { key: "initial_value", header: "Value", align: "right", cell: (r) => <Money value={r.initial_value} /> },
          { key: "balance", header: "Balance", align: "right", cell: (r) => <Money value={r.balance} /> },
          { key: "expires_on", header: "Expires", value: (r) => fmtDate(r.expires_on) },
          { key: "active", header: "", cell: (r) => <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: r.id, a: !r.active })}>{r.active ? "Block" : "Unblock"}</Button> },
        ]} />
      <FormModal open={!!e} title="Sell a gift card" initial={e} onClose={() => setE(null)} onSave={(v) => sell.mutate(v)} saving={sell.isPending}
        fields={[{ name: "value", label: "Value", type: "money", required: true }, { name: "expires_on", label: "Expires on (default 1 year)", type: "date" }]} />
    </>
  );
}

function Memberships() {
  const plans = useQ<MembershipPlan[]>("/membership-plans", { auth: "staff" });
  const members = useQ<{ id: string; customer: string; plan: string; starts_on: string; ends_on: string; status: string }[]>("/memberships", { auth: "staff" });
  const expiring = useQ<{ id: string; customer: string; plan: string; ends_on: string; whatsapp_url: string | null }[]>("/memberships/expiring", { auth: "staff" });
  const menu = useQ<Menu>("/menu");
  const [e, setE] = useState<Values | null>(null);
  const save = useM((v: Values) => marketingApi.savePlan(v), { success: "Plan saved", onSuccess: () => setE(null) });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {plans.data?.map((p) => (
          <Card key={p.id} className="flex flex-col gap-1">
            <b>{p.name}</b><span className="num font-disp text-2xl">{formatINR(p.price)}</span><span className="text-sm text-mute">{p.validity_days} days · {p.discount_pct}% off · {p.benefits}</span>
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setE(p as unknown as Values)}>Edit</Button>
          </Card>
        ))}
        <Button variant="soft" onClick={() => setE({ validity_days: 365, discount_pct: 10, active: true })}>+ Plan</Button>
      </div>
      {!!expiring.data?.length && (
        <Card className="flex flex-col gap-2">
          <Label>Renewal reminders (ending in 15 days)</Label>
          {expiring.data.map((m) => <div key={m.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{m.customer} · {m.plan} · ends {fmtDate(m.ends_on)}</span>{m.whatsapp_url && <a href={m.whatsapp_url} target="_blank" rel="noreferrer"><Button size="sm">WhatsApp reminder</Button></a>}</div>)}
        </Card>
      )}
      <DataTable rows={members.data ?? []} rowKey={(r) => r.id} search columns={[{ key: "customer", header: "Customer" }, { key: "plan", header: "Plan" }, { key: "starts_on", header: "From", value: (r) => fmtDate(r.starts_on) }, { key: "ends_on", header: "Till", value: (r) => fmtDate(r.ends_on) }, { key: "status", header: "Status", value: (r) => label(r.status) }]} />
      <FormModal open={!!e} title="Membership plan" initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending}
        fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "price", label: "Price", type: "money", required: true }, { name: "validity_days", label: "Valid for (days)", type: "number", required: true }, { name: "discount_pct", label: "% off every bill", type: "number" }, { name: "free_item_id", label: "Free item (e.g. on birthday)", type: "select", options: (menu.data?.items ?? []).map((i) => ({ value: i.id, label: i.name })), empty: "None" }, { name: "benefits", label: "Benefits shown to customers", type: "textarea" }, { name: "active", label: "On sale", type: "toggle" }]} />
    </div>
  );
}

function Offers() {
  const rows = useQ<Offer[]>("/offers", { auth: "staff" });
  const menu = useQ<Menu>("/menu");
  const [e, setE] = useState<Values | null>(null);
  const save = useM((v: Values) => marketingApi.saveOffer(v), { success: "Offer saved", onSuccess: () => setE(null) });
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => setE(r as unknown as Values)} toolbar={<Button size="sm" variant="primary" onClick={() => setE({ kind: "happy_hour", days: [1, 2, 3, 4, 5], start_time: "15:00", end_time: "18:00", discount_pct: 10, item_ids: [], active: true })}>+ Offer</Button>}
        columns={[
          { key: "name", header: "Offer", cell: (r) => <b>{r.name}</b> },
          { key: "kind", header: "Type", value: (r) => ({ happy_hour: "Happy hour", combo: "Combo", bxgy: "Buy X get Y" })[r.kind] },
          { key: "rule", header: "Rule", value: (r) => (r.kind === "happy_hour" ? `${r.discount_pct}% off` : r.kind === "bxgy" ? `Buy ${r.buy_qty} get ${r.get_qty}` : formatINR(r.combo_price ?? 0)) },
          { key: "when", header: "When", value: (r) => `${r.days.map((d) => DAYS[d]).join(" ")} · ${r.start_time}–${r.end_time}` },
          { key: "active", header: "", cell: (r) => <Chip tone={r.active ? "ok" : "neutral"}>{r.active ? "On" : "Off"}</Chip> },
        ]} />
      <FormModal open={!!e} title="Offer" initial={e} onClose={() => setE(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} wide
        fields={[
          { name: "name", label: "Name", type: "text", required: true },
          { name: "kind", label: "Type", type: "select", options: [{ value: "happy_hour", label: "Happy hour (% off)" }, { value: "bxgy", label: "Buy X get Y" }, { value: "combo", label: "Combo price" }], required: true },
          { name: "description", label: "Shown to customers", type: "text", full: true },
          { name: "discount_pct", label: "% off (happy hour)", type: "number" },
          { name: "buy_qty", label: "Buy (X)", type: "number" },
          { name: "get_qty", label: "Get free (Y)", type: "number" },
          { name: "combo_price", label: "Combo price", type: "money" },
          { name: "start_time", label: "From", type: "time" },
          { name: "end_time", label: "To", type: "time" },
          { name: "days", label: "Days", type: "checks", options: DAYS.map((d, i) => ({ value: i, label: d })) },
          { name: "item_ids", label: "Items (none = all)", type: "checks", options: (menu.data?.items ?? []).map((i) => ({ value: i.id, label: i.name })) },
          { name: "active", label: "Active", type: "toggle" },
        ]} />
    </>
  );
}

function Greetings() {
  const coupons = useQ<Coupon[]>("/coupons", { auth: "staff" });
  const [code, setCode] = useState("");
  const list = useQ<{ customer_id: string; name: string; phone: string | null; kind: string; body: string; sent: boolean; whatsapp_url: string | null; mailto: string | null }[]>("/greetings/today", { auth: "staff", query: { coupon_code: code } });
  const log = useM((b: { customer_id: string; kind: string; body: string; channel: "whatsapp_link" | "email" }) => marketingApi.logGreeting(b));
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label>Today&apos;s birthdays and anniversaries</Label>
        <select className="ml-auto min-h-9 rounded-lg border-[1.5px] border-line bg-paper px-2 text-sm" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Attach coupon">
          <option value="">No coupon</option>{coupons.data?.filter((c) => c.active).map((c) => <option key={c.id} value={c.code}>Attach {c.code}</option>)}
        </select>
      </div>
      {!list.data?.length && <p className="text-sm text-mute">No birthdays today among customers who allowed messages.</p>}
      {list.data?.map((g) => (
        <div key={g.customer_id + g.kind} className="flex flex-wrap items-center gap-2 rounded-xl border-[1.5px] border-line p-3 text-sm">
          <span className="text-xl">{g.kind === "birthday" ? "🎂" : "💐"}</span>
          <span className="min-w-0 flex-1"><b>{g.name}</b> · {g.phone}<span className="block text-xs text-mute">{g.body}</span></span>
          {g.sent && <Chip tone="ok">Sent</Chip>}
          {g.whatsapp_url && <a href={g.whatsapp_url} target="_blank" rel="noreferrer" onClick={() => log.mutate({ customer_id: g.customer_id, kind: g.kind, body: g.body, channel: "whatsapp_link" })}><Button size="sm" variant="primary">WhatsApp</Button></a>}
          {g.mailto && <a href={g.mailto} onClick={() => log.mutate({ customer_id: g.customer_id, kind: g.kind, body: g.body, channel: "email" })}><Button size="sm">Email</Button></a>}
        </div>
      ))}
      <p className="text-xs text-mute">Phase 1 uses free click-to-WhatsApp links and email. Paid bulk WhatsApp/SMS comes in Phase 2.</p>
    </Card>
  );
}

function FeedbackList() {
  const [low, setLow] = useState(false);
  const rows = useQ<(Feedback & { order_number: string; order_type: string; customer_name: string; customer_phone: string | null })[]>("/feedback", { auth: "staff", query: { low: low ? 1 : undefined } });
  const replied = useM(({ id, v }: { id: string; v: boolean }) => marketingApi.feedbackReplied(id, v));
  return (
    <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} search exportName="feedback" toolbar={<Chip onClick={() => setLow(!low)} active={low}>Low ratings only</Chip>}
      columns={[
        { key: "created_at", header: "Date", value: (r) => fmtDate(r.created_at) },
        { key: "customer_name", header: "Customer" },
        { key: "order_number", header: "Order", hideSm: true },
        { key: "food", header: "Food", cell: (r) => <Stars value={r.food} size={14} /> },
        { key: "service", header: "Service", cell: (r) => <Stars value={r.service} size={14} />, hideSm: true },
        { key: "ambience", header: "Ambience / delivery", cell: (r) => <Stars value={r.ambience} size={14} />, hideSm: true },
        { key: "comment", header: "Comment" },
        { key: "replied", header: "", cell: (r) => (
          <div className="flex gap-1">
            {r.customer_phone && <a href={`https://wa.me/91${r.customer_phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Hi ${r.customer_name.split(" ")[0]}, thanks for your feedback on ${r.order_number}. `)}`} target="_blank" rel="noreferrer"><Button size="sm">Reply</Button></a>}
            <Button size="sm" variant="ghost" onClick={() => replied.mutate({ id: r.id, v: !r.replied })}>{r.replied ? "✓ Done" : "Mark done"}</Button>
          </div>
        ) },
      ]} />
  );
}
