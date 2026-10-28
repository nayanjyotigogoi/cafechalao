"use client";

import Link from "next/link";
import { useState } from "react";
import { billingApi } from "@/modules/billing/api";
import { deliveryApi } from "@/modules/delivery/api";
import { StaffBar } from "@/modules/staff/components/StaffBar";
import { useM, useQ } from "@/shared/api/hooks";
import { StaffGate, useStaff } from "@/shared/auth/session";
import { cx, label } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { DayClose } from "@/shared/types/entities";
import { Button, Card, ErrorText, Field, Input, Label, Loading, Money, Stat } from "@/shared/ui/primitives";

/** Day close (M3.8, M8.7): settle riders, count the drawer by denomination, expected vs counted, variance reason. */
export default function DayClosePage() {
  useTitle("Day close");
  return <StaffGate perm="pos.day_close">{() => <Close />}</StaffGate>;
}

const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

interface Preview {
  date: string; opening_cash: number; cash_sales: number; petty_cash_out: number; rider_cash_in: number; rider_payouts: number; expected_cash: number;
  by_mode: Record<string, number>; bills: number; sales_total: number; pending_rider_settlements: string[]; open_orders: number; closed: DayClose | null;
}

function Close() {
  const { can } = useStaff();
  const p = useQ<Preview>("/day-close/preview", { auth: "staff" });
  const riders = useQ<{ rider_id: string; name: string; type: string; deliveries: number; cash_collected: number; upi_collected: number; charges_earned: number; net: number; settled: boolean }[]>(can("delivery.assign") ? "/rider-settlements" : null, { auth: "staff" });
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const settleRider = useM((id: string) => deliveryApi.settle(id), { success: "Rider settled" });
  const close = useM(() => billingApi.dayClose({ counts: DENOMS.map((d) => ({ denomination: d, count: counts[d] ?? 0 })), variance_reason: reason || undefined }), { success: "Day closed" });

  if (p.isLoading || !p.data) return <Loading />;
  const d = p.data;
  const counted = DENOMS.reduce((s, x) => s + x * 100 * (counts[x] ?? 0), 0);
  const variance = counted - d.expected_cash;

  return (
    <div className="min-h-dvh">
      <StaffBar title="Day close"><Link href="/pos"><Button size="sm" variant="ghost">← POS</Button></Link></StaffBar>
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        {d.closed ? (
          <Card className="border-ok">
            <b>{d.date} is closed.</b> Counted {formatINR(d.closed.counted_cash)} vs expected {formatINR(d.closed.expected_cash)} · variance {formatINR(d.closed.variance)} {d.closed.variance_reason && `(${d.closed.variance_reason})`}
          </Card>
        ) : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Bills today" value={d.bills} />
          <Stat label="Sales" value={formatINR(d.sales_total)} />
          <Stat label="Expected cash" value={formatINR(d.expected_cash)} sub={`Opening ${formatINR(d.opening_cash)} + cash ${formatINR(d.cash_sales)} + riders ${formatINR(d.rider_cash_in)} − petty ${formatINR(d.petty_cash_out)} − rider pay ${formatINR(d.rider_payouts)}`} />
          <Stat label="Open orders" value={d.open_orders} tone={d.open_orders ? "warn" : undefined} sub={d.open_orders ? "Bill or cancel them before closing" : undefined} />
        </div>
        <Card className="flex flex-wrap gap-4 text-sm">
          <Label>Payments by mode</Label>
          {Object.entries(d.by_mode).map(([m, v]) => <span key={m}>{label(m)} <Money value={v} className="font-semibold" /></span>)}
        </Card>

        {!!riders.data?.length && (
          <Card className="flex flex-col gap-2">
            <Label>Rider settlement</Label>
            {riders.data.map((r) => (
              <div key={r.rider_id} className="flex flex-wrap items-center gap-3 text-sm">
                <b className="w-36">{r.name}</b><span className="text-mute">{r.type} · {r.deliveries} deliveries</span>
                <span>Cash collected <Money value={r.cash_collected} /></span>
                <span>UPI <Money value={r.upi_collected} /></span>
                <span>Charges owed <Money value={r.charges_earned} /></span>
                <span className={cx("font-semibold", r.net >= 0 ? "text-ok" : "text-rose")}>{r.net >= 0 ? `Rider pays ${formatINR(r.net)}` : `Pay rider ${formatINR(-r.net)}`}</span>
                {r.settled ? <span className="text-ok">✓ settled</span> : <Button size="sm" variant="primary" loading={settleRider.isPending} onClick={() => settleRider.mutate(r.rider_id)}>Settle</Button>}
              </div>
            ))}
          </Card>
        )}

        {!d.closed && (
          <Card className="flex flex-col gap-3">
            <Label>Count the drawer</Label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              {DENOMS.map((x) => (
                <Field key={x} label={`₹${x}`}>
                  <Input inputMode="numeric" className="num" value={counts[x] ?? ""} onChange={(e) => setCounts({ ...counts, [x]: Number(e.target.value.replace(/\D/g, "") || 0) })} />
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <span>Counted <b className="num text-lg">{formatINR(counted)}</b></span>
              <span>Expected <b className="num text-lg">{formatINR(d.expected_cash)}</b></span>
              <span className={cx("font-semibold", variance === 0 ? "text-ok" : "text-rose")}>Variance {formatINR(variance)}</span>
            </div>
            {variance !== 0 && <Field label="Reason for the difference (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
            {d.pending_rider_settlements.length > 0 && <p className="text-sm text-warn">Settle {d.pending_rider_settlements.join(", ")} first so their cash is counted.</p>}
            <ErrorText error={close.error} />
            <Button variant="primary" size="lg" disabled={variance !== 0 && !reason} loading={close.isPending} onClick={() => close.mutate(undefined)}>Close day {d.date}</Button>
          </Card>
        )}
      </div>
    </div>
  );
}
