"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { billingApi, type SettleBody } from "@/modules/billing/api";
import { CustomerPicker } from "@/modules/customers/components/CustomerPicker";
import { ApprovalPin } from "@/modules/staff/components/ApprovalPin";
import { useM } from "@/shared/api/hooks";
import { useStaff } from "@/shared/auth/session";
import { cx } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useFeature, useSettings } from "@/shared/tenant/TenantProvider";
import type { OrderDetail } from "@/shared/types/api";
import type { Customer, PaymentMode } from "@/shared/types/entities";
import { Modal } from "@/shared/ui/overlay";
import { CafeUpiQr } from "./CafeUpiQr";
import { Button, Chip, ErrorText, Input, Label, MoneyInput, Segmented, Toggle } from "@/shared/ui/primitives";

/**
 * Settle a bill (M3.5–M3.7): discount (item/bill, % or ₹, reason, manager PIN above limit), coupon, loyalty points,
 * gift card, optional service charge removal, tip, and cash / UPI QR / card / split payments with change.
 */
export function SettleModal({ order, open, onClose, onDone, defaultMode = "cash" }: { order: OrderDetail; open: boolean; onClose: () => void; onDone: (r: { invoiceId: string; change: number }) => void; defaultMode?: PaymentMode }) {
  const s = useSettings();
  const { session } = useStaff();
  const giftCards = useFeature("gift_cards");
  const [discount, setDiscount] = useState<{ kind: "pct" | "flat"; value: number; reason: string } | null>(null);
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(order.coupon_code);
  const [gift, setGift] = useState("");
  const [appliedGift, setAppliedGift] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [removeSC, setRemoveSC] = useState(false);
  const [customer, setCustomer] = useState<Pick<Customer, "id" | "name" | "loyalty_points"> | null>(order.customer_id ? { id: order.customer_id, name: order.customer_name ?? "Customer", loyalty_points: 0 } : null);
  const [picker, setPicker] = useState(false);
  const [split, setSplit] = useState(false);
  const [mode, setMode] = useState<PaymentMode>(defaultMode);
  const [tendered, setTendered] = useState<number | null>(null);
  const [parts, setParts] = useState<{ mode: PaymentMode; amount: number; reference?: string }[]>([]);
  const [approver, setApprover] = useState<{ id: string; name: string } | null>(null);
  const [needPin, setNeedPin] = useState(false);

  const previewBody = { discount: discount && discount.value > 0 ? discount : null, coupon_code: appliedCoupon, gift_card_code: appliedGift, redeem_points: points, remove_service_charge: removeSC, customer_id: customer?.id ?? null };
  const pv = useQuery({ queryKey: ["preview", order.id, order.updated_at, previewBody], queryFn: () => billingApi.preview(order.id, previewBody), enabled: open, retry: false });
  const q = pv.data?.quote;
  const due = q ? q.payable : order.total;

  const payments = split ? parts : [{ mode, amount: mode === "cash" && tendered ? Math.max(tendered, due) : due }];
  const splitPaid = parts.reduce((a, p) => a + p.amount, 0);
  const body: SettleBody = { ...previewBody, payments, approver_id: approver?.id };
  // The approver comes in directly when retrying right after the PIN, before state has re-rendered.
  const settle = useM((approverId?: string) => billingApi.settle(order.id, { ...body, approver_id: approverId ?? approver?.id }), {
    silentError: false,
    onError: (e) => { if (e.code === "approval_required") setNeedPin(true); },
    onSuccess: (r) => onDone({ invoiceId: r.invoice.id, change: r.change }),
  });
  const limitPct = session?.limits.discount_pct ?? 0;

  return (
    <Modal open={open} onClose={onClose} title={`Settle ${order.number}${order.table ? ` · ${order.table.name}` : ""}`} wide
      footer={
        <>
          <ErrorText error={settle.error?.code === "approval_required" ? null : settle.error} />
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" size="lg" loading={settle.isPending} disabled={!q || (split && splitPaid < due)} onClick={() => settle.mutate(undefined)}>
            Charge {formatINR(due, { decimals: true })}
          </Button>
        </>
      }>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Label>Customer</Label>
            <span className="flex-1 text-sm">{customer ? customer.name : "Walk-in (no profile)"}</span>
            <Button size="sm" onClick={() => setPicker(true)}>{customer ? "Change" : "Attach"}</Button>
          </div>

          <Label>Discount</Label>
          <div className="flex flex-wrap items-center gap-2">
            {[5, 10, 15, 20].map((p) => <Chip key={p} onClick={() => setDiscount({ kind: "pct", value: p, reason: discount?.reason ?? "" })} active={discount?.kind === "pct" && discount.value === p}>{p}%</Chip>)}
            <Chip onClick={() => setDiscount({ kind: "flat", value: 0, reason: discount?.reason ?? "" })} active={discount?.kind === "flat"}>₹ flat</Chip>
            {discount && <Chip onClick={() => { setDiscount(null); setApprover(null); }}>Clear</Chip>}
          </div>
          {discount?.kind === "flat" && <MoneyInput value={discount.value} onChange={(v) => setDiscount({ ...discount, value: v })} aria-label="Flat discount" />}
          {discount && <Input placeholder="Reason (required)" value={discount.reason} onChange={(e) => setDiscount({ ...discount, reason: e.target.value })} />}
          {discount && <p className="text-xs text-mute">Your limit is {limitPct}%. {approver ? `Approved by ${approver.name}.` : "Above it, a manager PIN is asked."}</p>}

          {s.flags.features.coupons && (
            <div className="flex gap-2">
              <Input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
              <Button onClick={() => setAppliedCoupon(coupon || null)}>{appliedCoupon ? "Change" : "Apply"}</Button>
            </div>
          )}
          {pv.data?.coupon_error && appliedCoupon && <p className="text-xs text-rose">{pv.data.coupon_error}</p>}
          {pv.data?.coupon && <p className="text-xs text-ok">✓ {pv.data.coupon.code}</p>}

          {customer && s.loyalty.enabled && (pv.data?.customer_points ?? 0) > 0 && (
            <Toggle checked={points > 0} onChange={(v) => setPoints(v ? pv.data!.customer_points : 0)} label={`Redeem ${pv.data?.customer_points} points (${formatINR((pv.data?.customer_points ?? 0) * s.loyalty.point_value)})`} />
          )}
          {pv.data?.points_error && points > 0 && <p className="text-xs text-rose">{pv.data.points_error}</p>}
          {giftCards && (
            <div className="flex gap-2">
              <Input placeholder="Gift card code" value={gift} onChange={(e) => setGift(e.target.value.toUpperCase())} />
              <Button onClick={() => setAppliedGift(gift || null)}>Use</Button>
            </div>
          )}
          {pv.data?.gift_card_error && appliedGift && <p className="text-xs text-rose">{pv.data.gift_card_error}</p>}
          {order.type === "dine_in" && s.tax.service_charge_enabled && <Toggle checked={removeSC} onChange={setRemoveSC} label="Remove service charge (guest asked)" />}
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-fill/60 p-4 text-sm">
            {q ? (
              <div className="flex flex-col gap-1">
                <Line l="Subtotal" v={q.subtotal} />
                {q.discount > 0 && <Line l="Discount" v={-q.discount} />}
                {q.service_charge > 0 && <Line l={`Service charge ${s.tax.service_charge_pct}%`} v={q.service_charge} />}
                {q.bill_of_supply ? <Line l="Bill of Supply · no GST" v={0} /> : q.tax_lines.map((t) => <Line key={t.rate} l={`CGST + SGST ${t.rate}%`} v={t.cgst + t.sgst} />)}
                {q.delivery_charge > 0 && <Line l="Delivery" v={q.delivery_charge} />}
                {q.round_off !== 0 && <Line l="Round off" v={q.round_off} />}
                <Line l="Total" v={q.total} bold />
                {q.points_value > 0 && <Line l="Points" v={-q.points_value} />}
                {q.gift_card_amount > 0 && <Line l="Gift card" v={-q.gift_card_amount} />}
                <div className="mt-1 flex justify-between border-t border-line pt-2"><b>To collect</b><b className="num font-disp text-2xl">{formatINR(due, { decimals: true })}</b></div>
              </div>
            ) : <span className="text-mute">Calculating…</span>}
            {pv.error && <ErrorText error={pv.error} />}
          </div>

          <Segmented value={split ? "split" : "single"} onChange={(v) => { setSplit(v === "split"); setParts(v === "split" ? [{ mode: "cash", amount: Math.round(due / 2) }, { mode: "upi", amount: due - Math.round(due / 2) }] : []); }} options={[{ value: "single", label: "One payment" }, { value: "split", label: "Split" }]} />
          {!split ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {(["cash", "upi", "card"] as const).filter((m) => s.payment.modes[m]).map((m) => (
                  <Button key={m} variant={mode === m ? "primary" : "outline"} onClick={() => setMode(m)} className="touch">{m === "upi" ? "UPI" : m === "card" ? "Card" : "Cash"}</Button>
                ))}
              </div>
              {mode === "cash" && (
                <div className="flex flex-col gap-2">
                  <Label>Cash received</Label>
                  <div className="flex flex-wrap gap-2">
                    {[due, Math.ceil(due / 10000) * 10000, Math.ceil(due / 50000) * 50000, Math.ceil(due / 200000) * 200000].filter((v, i, a) => a.indexOf(v) === i).map((v) => <Chip key={v} onClick={() => setTendered(v)} active={tendered === v}>{formatINR(v)}</Chip>)}
                  </div>
                  <MoneyInput value={tendered} onChange={setTendered} aria-label="Cash received" />
                  {tendered != null && tendered >= due && <p className="text-sm">Return change: <b className="num">{formatINR(tendered - due, { decimals: true })}</b></p>}
                </div>
              )}
              {mode === "upi" && <div className="rounded-xl border-[1.5px] border-line p-3"><CafeUpiQr amount={due} size={140} /><p className="mt-1 text-center text-xs text-mute">Check the café&apos;s UPI app for the payment, then charge.</p></div>}
              {mode === "card" && <p className="text-xs text-mute">Swipe on the card machine, then charge here. Card is recorded only (external machine).</p>}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {parts.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className="min-h-11 rounded-lg border-[1.5px] border-line bg-paper px-2 text-sm" value={p.mode} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, mode: e.target.value as PaymentMode } : x)))}>
                    {["cash", "upi", "card"].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </select>
                  <MoneyInput value={p.amount} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                  <Button size="sm" variant="ghost" onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label="Remove payment">×</Button>
                </div>
              ))}
              <Button size="sm" variant="soft" onClick={() => setParts([...parts, { mode: "cash", amount: Math.max(0, due - splitPaid) }])}>+ Add payment</Button>
              <p className={cx("text-sm", splitPaid < due ? "text-rose" : "text-ok")}>{splitPaid < due ? `${formatINR(due - splitPaid, { decimals: true })} still to collect` : "Fully paid"}</p>
            </div>
          )}
        </div>
      </div>
      <CustomerPicker open={picker} onClose={() => setPicker(false)} onPick={(c) => setCustomer(c)} />
      <ApprovalPin open={needPin} onClose={() => setNeedPin(false)} kind="discount_pct" amount={discount?.kind === "pct" ? discount.value : q && q.subtotal ? ((discount?.value ?? 0) / q.subtotal) * 100 : 0}
        reason={`Discount above your ${limitPct}% limit`} onApproved={(id, name) => { setApprover({ id, name }); setNeedPin(false); settle.mutate(id); }} />
    </Modal>
  );
}

function Line({ l, v, bold }: { l: string; v: number; bold?: boolean }) {
  return <div className={cx("flex justify-between", bold && "font-semibold")}><span>{l}</span><span className="num">{formatINR(v, { decimals: true })}</span></div>;
}

