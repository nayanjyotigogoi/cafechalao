"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cart, useCart } from "@/modules/orders/cart";
import { ordersApi, type PlaceResult } from "@/modules/orders/api";
import { AddressModal } from "@/modules/customers/components/AddressModal";
import { CafeUpiQr } from "@/modules/billing/components/CafeUpiQr";
import { OrderTypeToggle } from "@/modules/orders/components/OrderTypeToggle";
import { ApiError, newIdempotencyKey } from "@/shared/api/client";
import { useM, useQ } from "@/shared/api/hooks";
import { useCustomer } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { cx } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useFeature, useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { QuoteResult } from "@/shared/types/api";
import type { Address, OrderType, PaymentMode } from "@/shared/types/entities";
import { Modal, useToast } from "@/shared/ui/overlay";
import { Button, Card, Chip, Empty, ErrorText, Field, FoodMark, Input, Label, Money, Textarea } from "@/shared/ui/primitives";
import { Icon } from "@/shared/ui/icons";

/** Cart and checkout (M1.4–M1.6): order type, coupon, points, gift card, tip, GST breakdown, payment. */
export default function CartPage() {
  useTitle("Cart");
  const s = useSettings();
  const { t } = useT();
  const c = useCart();
  const router = useRouter();
  const toast = useToast();
  const { customer } = useCustomer();
  const features = s.flags.features;
  const tips = useFeature("tips");
  const [couponInput, setCouponInput] = useState(c.coupon_code ?? "");
  const [giftInput, setGiftInput] = useState(c.gift_card_code ?? "");
  const [payment, setPayment] = useState<PaymentMode | null>(null);
  const [gateway, setGateway] = useState<PlaceResult | null>(null);
  const [idem] = useState(newIdempotencyKey);
  const [newAddress, setNewAddress] = useState(false);

  const types = useMemo(() => {
    const out: { v: OrderType; label: string }[] = [];
    // Scanned a table QR = the guest is sitting at the café: dine-in only, no takeaway, delivery or pickup time.
    if (c.table_code && features.dine_in) return [{ v: "dine_in" as OrderType, label: `${t("Dine-in")} ${c.table_name ?? ""}` }];
    // Not at a table: Delivery (default) or Takeaway, picked with the toggle.
    if (features.delivery && s.delivery.enabled) out.push({ v: "delivery", label: t("Delivery") });
    if (features.takeaway) out.push({ v: "takeaway", label: t("Takeaway") });
    return out;
  }, [c.table_code, c.table_name, features, s.delivery.enabled, t]);

  useEffect(() => {
    if (types.length && !types.some((x) => x.v === c.order_type)) cart.set({ order_type: types[0].v });
  }, [types, c.order_type]);

  const addresses = useQ<Address[]>(customer && c.order_type === "delivery" ? "/me/addresses" : null, { auth: "customer" });
  useEffect(() => {
    if (addresses.data?.length && !addresses.data.some((a) => a.id === c.address_id)) cart.set({ address_id: addresses.data[0].id });
  }, [addresses.data, c.address_id]);

  const body = {
    lines: c.lines.map((l) => ({ item_id: l.item_id, variant_id: l.variant_id, add_on_ids: l.add_on_ids, qty: l.qty, note: l.note })),
    order_type: c.order_type, coupon_code: c.coupon_code, redeem_points: c.redeem_points, gift_card_code: c.gift_card_code, tip: c.tip,
  };
  const quote = useQuery<QuoteResult, ApiError>({
    queryKey: ["quote", customer?.id ?? "guest", body],
    queryFn: () => ordersApi.quote(body, customer ? "customer" : undefined),
    enabled: c.lines.length > 0,
    retry: false,
  });

  const payOptions: { v: PaymentMode; label: string }[] = [];
  if (s.payment.modes.online || s.payment.modes.upi) payOptions.push({ v: "upi_qr", label: t("Pay by UPI (scan café QR)") });
  if (c.order_type === "delivery") {
    if (s.payment.modes.cod && s.delivery.allow_cod) payOptions.push({ v: "cod", label: t("Cash on delivery") });
    if (s.payment.modes.upi_on_delivery && s.delivery.allow_upi_on_delivery) payOptions.push({ v: "upi_on_delivery", label: t("UPI on delivery") });
  } else payOptions.push({ v: "cash", label: t("Pay at counter") });
  const pay = payment && payOptions.some((p) => p.v === payment) ? payment : payOptions[0]?.v ?? null;

  const place = useM(
    () => ordersApi.place({ ...body, payment_method: pay, table_code: c.table_code, pickup_time: c.pickup_time || null, address_id: c.address_id, note: c.note }, customer ? "customer" : undefined, idem),
    {
      onSuccess: (r) => {
        if (r.payment) setGateway(r);
        else finish(r.order.id);
      },
    },
  );
  const finish = (id: string) => {
    cart.clear();
    router.push(`/orders/${id}${c.table_code ? `?table=${c.table_code}` : ""}`);
  };

  if (!c.lines.length) {
    return (
      <Empty title={t("Your cart") + " is empty"} action={<Link href={c.table_code ? `/t/${c.table_code}` : "/"}><Button variant="primary">Browse the menu</Button></Link>}>
        Add a few dishes and they will show up here.
      </Empty>
    );
  }

  const qd = quote.data;
  const needsLogin = c.order_type === "delivery" && !customer;
  // Signed in but never finished the profile: the rider needs a verified mobile to call.
  const needsPhone = c.order_type === "delivery" && !!customer && !(customer.phone_verified && customer.phone);
  const err = quote.error?.message ?? qd?.min_order_error;

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Link href={c.table_code ? `/t/${c.table_code}` : "/"} className="text-brand">← Menu</Link>
          <h1 className="font-disp text-2xl font-extrabold">{t("Your cart")}</h1>
        </div>
        <Card className="flex flex-col divide-y divide-line/70 p-0">
          {c.lines.map((l) => (
            <div key={l.key} className="flex items-center gap-3 px-4 py-3">
              <FoodMark type={l.food_type} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{l.name}{l.variant_name && <span className="text-mute"> · {l.variant_name}</span>}</div>
                {(l.add_on_names.length > 0 || l.note) && <div className="text-xs text-mute">{[...l.add_on_names, l.note && `“${l.note}”`].filter(Boolean).join(", ")}</div>}
              </div>
              <div className="flex items-center rounded-xl border-[1.5px] border-line">
                <button className="min-h-9 w-9 cursor-pointer" onClick={() => cart.setQty(l.key, l.qty - 1)} aria-label="Less">−</button>
                <span className="num w-6 text-center text-sm">{l.qty}</span>
                <button className="min-h-9 w-9 cursor-pointer" onClick={() => cart.setQty(l.key, l.qty + 1)} aria-label="More">+</button>
              </div>
              <Money value={l.unit_price * l.qty} className="w-16 text-right" />
            </div>
          ))}
        </Card>

        <Field label="Cooking note for the kitchen">
          <Textarea value={c.note} onChange={(e) => cart.set({ note: e.target.value })} placeholder="Less spicy, no onion…" maxLength={200} />
        </Field>

        {c.table_code ? (
          <Card className="flex items-center gap-2 text-sm">
            <Icon name="menu" size={20} />
            <span>Dine-in at <b>{c.table_name}</b>. We&apos;ll bring your order to the table.</span>
          </Card>
        ) : null}
        {c.table_code ? (
          <OrderTypeToggle />
        ) : (
          <div className="flex flex-col gap-2">
            <Label>Order type</Label>
            <OrderTypeToggle />
          </div>
        )}

        {c.order_type === "takeaway" && (
          <Field label="Pickup time" hint="Leave empty for as soon as possible">
            <Input type="time" value={c.pickup_time} onChange={(e) => cart.set({ pickup_time: e.target.value })} min={s.outlet.opening_time} max={s.outlet.closing_time} />
          </Field>
        )}

        {c.order_type === "delivery" && (
          <Card className="flex flex-col gap-3">
            <Label>Deliver to</Label>
            {needsLogin ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                Sign in to order for delivery.
                <Link href="/login?next=/cart"><Button variant="primary" size="sm">{t("Continue with Google")}</Button></Link>
              </div>
            ) : needsPhone ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1">Add and verify your mobile number so the rider can call you.</span>
                <Link href="/login?next=/cart"><Button variant="primary" size="sm">Verify mobile</Button></Link>
              </div>
            ) : (
              <>
                {addresses.data?.map((a) => (
                  <label key={a.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border-[1.5px] border-line p-3 text-sm">
                    <input type="radio" name="addr" checked={c.address_id === a.id} onChange={() => cart.set({ address_id: a.id })} className="mt-1 accent-[var(--brand)]" />
                    <span><b>{a.label}</b> · {a.line1}{a.landmark ? `, ${a.landmark}` : ""}, {a.city} {a.pincode}</span>
                  </label>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setNewAddress(true)}>+ Add address</Button>
              </>
            )}
            <p className="text-xs text-mute">Delivery charge: {s.delivery.charge_type === "flat" ? formatINR(s.delivery.flat_charge) : "by order value"} · min order {formatINR(s.delivery.min_order)}. The delivery charge goes to the rider.</p>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <Card className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input placeholder={`${t("Apply coupon")} · e.g. ${"CODE"}`} value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} aria-label="Coupon code" />
            {c.coupon_code ? <Button onClick={() => { cart.set({ coupon_code: null }); setCouponInput(""); }}>Remove</Button> : <Button onClick={() => cart.set({ coupon_code: couponInput || null })} disabled={!couponInput}>Apply</Button>}
          </div>
          {qd?.coupon_error && c.coupon_code && <p className="text-xs text-rose">{qd.coupon_error}</p>}
          {qd?.coupon && <p className="text-xs text-ok">✓ {qd.coupon.code} applied</p>}

          {customer && s.loyalty.enabled && features.loyalty && (qd?.customer_points ?? 0) > 0 && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={c.redeem_points > 0} onChange={(e) => cart.set({ redeem_points: e.target.checked ? qd!.customer_points : 0 })} className="accent-[var(--brand)]" />
              Use {qd?.customer_points} {t("Loyalty points")} (worth {formatINR((qd?.customer_points ?? 0) * s.loyalty.point_value)})
            </label>
          )}
          {qd?.points_error && c.redeem_points > 0 && <p className="text-xs text-rose">{qd.points_error}</p>}

          {features.gift_cards && (
            <div className="flex gap-2">
              <Input placeholder="Gift card code" value={giftInput} onChange={(e) => setGiftInput(e.target.value.toUpperCase())} aria-label="Gift card code" />
              {c.gift_card_code ? <Button onClick={() => { cart.set({ gift_card_code: null }); setGiftInput(""); }}>Remove</Button> : <Button onClick={() => cart.set({ gift_card_code: giftInput || null })} disabled={!giftInput}>Use</Button>}
            </div>
          )}
          {qd?.gift_card_error && c.gift_card_code && <p className="text-xs text-rose">{qd.gift_card_error}</p>}

          {tips && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-mute">Tip (optional)</span>
              {[0, 2000, 3000, 5000].map((v) => <Chip key={v} onClick={() => cart.set({ tip: v })} active={c.tip === v}>{v ? formatINR(v) : "No tip"}</Chip>)}
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-1.5 text-sm">
          {qd ? (
            <>
              <Row label={t("Item total")} value={qd.quote.subtotal} />
              {qd.quote.discount > 0 && <Row label={`${t("Discount")}${qd.offers.length ? ` · ${qd.offers.join(", ")}` : ""}${qd.membership ? ` · ${qd.membership.name}` : ""}`} value={-qd.quote.discount} tone="ok" />}
              {qd.quote.service_charge > 0 && <Row label={`Service charge (optional, ${s.tax.service_charge_pct}%)`} value={qd.quote.service_charge} />}
              {qd.quote.bill_of_supply ? <Row label="GST" valueText="Not charged (composition)" /> : qd.quote.tax_lines.map((tl) => <Row key={tl.rate} label={`GST ${tl.rate}% (CGST + SGST)`} value={tl.cgst + tl.sgst} />)}
              {qd.quote.delivery_charge > 0 && <Row label="Delivery charge" value={qd.quote.delivery_charge} />}
              {qd.quote.tip > 0 && <Row label="Tip" value={qd.quote.tip} />}
              {qd.quote.round_off !== 0 && <Row label="Round off" value={qd.quote.round_off} decimals />}
              {qd.quote.points_value > 0 && <Row label="Points" value={-qd.quote.points_value} tone="ok" />}
              {qd.quote.gift_card_amount > 0 && <Row label="Gift card" value={-qd.quote.gift_card_amount} tone="ok" />}
              <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
                <b>{t("To pay")}</b>
                <b className="num font-disp text-2xl">{formatINR(qd.quote.payable, { decimals: true })}</b>
              </div>
            </>
          ) : quote.isLoading ? <span className="text-mute">Calculating…</span> : null}
          {err && <ErrorText error={err} />}
        </Card>

        <Card className="flex flex-col gap-2">
          <Label>{t("Pay with")}</Label>
          <div className="flex flex-wrap gap-2">
            {payOptions.map((p) => <Chip key={p.v} onClick={() => setPayment(p.v)} active={pay === p.v}>{p.label}</Chip>)}
          </div>
          {pay === "upi_qr" && <p className="text-xs text-mute">You pay straight to {s.outlet.name}&apos;s UPI. No extra charges.</p>}
          {c.order_type === "dine_in" && !customer && <p className="text-xs text-mute">Sign-in is optional. <Link className="text-brand underline" href="/login?next=/cart">Sign in</Link> to earn loyalty points.</p>}
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!qd || !!err || needsLogin || needsPhone || (c.order_type === "delivery" && !c.address_id) || !pay}
            loading={place.isPending}
            onClick={() => place.mutate(undefined)}
          >
            {t("Place order")} · {qd ? formatINR(qd.quote.payable, { decimals: true }) : ""}
          </Button>
        </Card>
      </div>

      <AddressModal open={newAddress} onClose={() => setNewAddress(false)} city={s.outlet.city} onSaved={(a) => { cart.set({ address_id: a.id }); toast("Address saved"); }} />
      <UpiPay result={gateway} onDone={(id) => finish(id)} />
    </div>
  );
}

function Row({ label, value, valueText, tone, decimals }: { label: string; value?: number; valueText?: string; tone?: "ok"; decimals?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-mute">{label}</span>
      <span className={cx("num", tone === "ok" && "text-ok")}>{valueText ?? formatINR(value ?? 0, { decimals: decimals || ((value ?? 0) % 100 !== 0) })}</span>
    </div>
  );
}

/**
 * Pay by UPI to the café's own QR (no payment gateway needed). The customer scans, pays the exact amount
 * and taps "I've paid"; the café confirms the money arrived and the order goes to the kitchen.
 */
function UpiPay({ result, onDone }: { result: PlaceResult | null; onDone: (orderId: string, ok: boolean) => void }) {
  const [ref, setRef] = useState("");
  const pay = useM(() => ordersApi.paid(result!.order.id, ref), { onSuccess: () => onDone(result!.order.id, true) });
  if (!result?.payment) return null;
  return (
    <Modal open onClose={() => onDone(result.order.id, true)} title={`Pay ${result.order.number} by UPI`}>
      <div className="flex flex-col items-center gap-4 py-2">
        <p className="text-center text-sm text-mute">Scan with any UPI app (GPay, PhonePe, Paytm…) and pay the amount below.</p>
        <CafeUpiQr amount={result.payment.amount} />
        <Field label="UPI reference / UTR (optional)" className="w-full"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="12-digit number from your UPI app" /></Field>
        <Button block variant="primary" size="lg" loading={pay.isPending} onClick={() => pay.mutate(undefined)}>I&apos;ve paid</Button>
        <p className="text-center text-xs text-mute">The café checks the payment and starts your order. You can follow it on the next screen.</p>
      </div>
    </Modal>
  );
}
