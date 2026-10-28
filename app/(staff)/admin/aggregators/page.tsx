"use client";

import { useState } from "react";
import { aggregatorsApi } from "@/modules/aggregators/api";
import { useM, useQ } from "@/shared/api/hooks";
import { fmtDate, todayISO } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { AggregatorEntry, AggregatorPayout, AggregatorPlatform } from "@/shared/types/entities";
import { HBars } from "@/shared/ui/charts";
import { DataTable } from "@/shared/ui/data";
import { FormModal, type Values } from "@/shared/ui/form";
import { Modal } from "@/shared/ui/overlay";
import { Button, Card, Field, Input, Label, Money, MoneyInput, PageTitle } from "@/shared/ui/primitives";

/**
 * Swiggy/Zomato tracker (M9): enter orders or weekly totals by hand; the app calculates commission, 18% GST on it,
 * gateway fee, TCS, TDS and the expected payout, compares with what arrived, and shows net earned per ₹100 vs direct.
 * Nothing is filed from here; GST under section 9(5) is paid by the platform.
 */
type Row = AggregatorEntry & { platform: string; calc: { commission: number; gst_on_commission: number; pg_fee: number; tcs: number; tds: number; ads: number; other: number; outlet_discount: number; net_payout: number; per_100: number }; received: number; difference: number | null; payouts: AggregatorPayout[] };

export default function AggregatorsPage() {
  useTitle("Swiggy/Zomato");
  const platforms = useQ<AggregatorPlatform[]>("/aggregators/platforms", { auth: "staff" });
  const rows = useQ<Row[]>("/aggregators/entries", { auth: "staff" });
  const cmp = useQ<{ channel: string; orders: number; gross: number; net: number; per_100: number; commission: number }[]>("/aggregators/comparison", { auth: "staff" });
  const [e, setE] = useState<Values | null>(null);
  const [pl, setPl] = useState<Values | null>(null);
  const [payout, setPayout] = useState<{ id: string; amount: number; received_on: string; reference: string } | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const add = useM((v: Values) => aggregatorsApi.addEntry(v), { success: "Entry saved", onSuccess: () => setE(null) });
  const savePl = useM((v: Values) => aggregatorsApi.savePlatform(v.id as string, v as never), { success: "Rates saved", onSuccess: () => setPl(null) });
  const addPay = useM(() => aggregatorsApi.addPayout(payout!.id, payout!), { success: "Payout recorded", onSuccess: () => setPayout(null) });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Swiggy / Zomato tracker" sub="Manual records. See what you really earn per ₹100 of sales on each platform vs your own zero-commission orders."
        actions={<Button variant="primary" onClick={() => setE({ platform_id: platforms.data?.[0]?.id, period_from: todayISO(), period_to: todayISO() })}>+ Add weekly totals</Button>} />
      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <Card className="flex flex-col gap-3">
          <Label>Net earned per ₹100 of sales</Label>
          {cmp.data && <HBars plain suffix="" data={cmp.data.map((c) => ({ label: c.channel, value: Math.round(c.per_100 * 10) / 10, tone: c.channel.startsWith("Direct") ? "brand" : "rose" }))} />}
          <p className="text-xs text-mute">Direct = your own app, QR and POS orders, after discounts, gateway fees and rider charges. CafeChalao takes no commission.</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <Label>Platform rates</Label>
          {platforms.data?.map((p) => (
            <button key={p.id} onClick={() => setPl(p as unknown as Values)} className="flex cursor-pointer justify-between rounded-lg px-1 py-1 text-left text-sm hover:bg-fill/50">
              <b>{p.name}</b><span className="text-mute">{p.commission_pct}% + 18% GST · PG {p.pg_fee_pct}% · TCS {p.tcs_pct}% · TDS {p.tds_pct}%</span>
            </button>
          ))}
        </Card>
      </div>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} exportName="aggregator-entries" onRowClick={setDetail}
        columns={[
          { key: "platform", header: "Platform", cell: (r) => <b>{r.platform}</b> },
          { key: "period", header: "Period", value: (r) => `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` },
          { key: "orders", header: "Orders", align: "right" },
          { key: "gross_sales", header: "Gross", align: "right", cell: (r) => <Money value={r.gross_sales} /> },
          { key: "deductions", header: "Deductions", align: "right", hideSm: true, value: (r) => (r.gross_sales - r.calc.net_payout) / 100, cell: (r) => <Money value={r.gross_sales - r.calc.net_payout} /> },
          { key: "net", header: "Expected payout", align: "right", value: (r) => r.calc.net_payout / 100, cell: (r) => <Money value={r.calc.net_payout} className="font-semibold" /> },
          { key: "received", header: "Received", align: "right", cell: (r) => (r.payouts.length ? <Money value={r.received} /> : <Button size="sm" onClick={(ev) => { ev.stopPropagation(); setPayout({ id: r.id, amount: r.calc.net_payout, received_on: todayISO(), reference: "" }); }}>Enter</Button>) },
          { key: "difference", header: "Difference", align: "right", value: (r) => r.difference ?? 0, cell: (r) => (r.difference == null ? "—" : <Money value={r.difference} className={r.difference < 0 ? "text-rose" : "text-ok"} />) },
          { key: "per_100", header: "Per ₹100", align: "right", value: (r) => r.calc.per_100, cell: (r) => <span className="num">₹{r.calc.per_100.toFixed(1)}</span> },
        ]} />
      <FormModal open={!!e} title="Aggregator totals" initial={e} onClose={() => setE(null)} onSave={(v) => add.mutate(v)} saving={add.isPending} error={add.error} wide
        fields={[
          { name: "platform_id", label: "Platform", type: "select", options: (platforms.data ?? []).map((p) => ({ value: p.id, label: p.name })), required: true },
          { name: "orders", label: "Orders", type: "number" },
          { name: "period_from", label: "From", type: "date", required: true },
          { name: "period_to", label: "To", type: "date", required: true },
          { name: "gross_sales", label: "Gross sales", type: "money", required: true },
          { name: "outlet_discount", label: "Discounts funded by you", type: "money" },
          { name: "packaging", label: "Packaging charges", type: "money" },
          { name: "ads", label: "Ads", type: "money" },
          { name: "other_deductions", label: "Other deductions", type: "money" },
          { name: "commission_pct", label: "Commission % (blank = platform rate)", type: "number" },
        ]} />
      <FormModal open={!!pl} title={`${pl?.name} rates`} initial={pl} onClose={() => setPl(null)} onSave={(v) => savePl.mutate(v)} saving={savePl.isPending}
        fields={[{ name: "commission_pct", label: "Commission %", type: "number" }, { name: "pg_fee_pct", label: "Payment gateway fee %", type: "number" }, { name: "tcs_pct", label: "TCS (GST) %", type: "number" }, { name: "tds_pct", label: "TDS 194-O %", type: "number" }]} />
      <Modal open={!!payout} onClose={() => setPayout(null)} title="Actual payout received" footer={<Button variant="primary" loading={addPay.isPending} onClick={() => addPay.mutate(undefined)}>Save</Button>}>
        {payout && <div className="grid gap-3"><Field label="Amount"><MoneyInput value={payout.amount} onChange={(v) => setPayout({ ...payout, amount: v })} /></Field><Field label="Received on"><Input type="date" value={payout.received_on} onChange={(ev) => setPayout({ ...payout, received_on: ev.target.value })} /></Field><Field label="Reference (UTR)"><Input value={payout.reference} onChange={(ev) => setPayout({ ...payout, reference: ev.target.value })} /></Field></div>}
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.platform} · ${fmtDate(detail.period_from)}` : ""}>
        {detail && (
          <div className="flex flex-col gap-1 text-sm">
            {[["Gross sales", detail.gross_sales], [`Commission ${detail.commission_pct}%`, -detail.calc.commission], ["GST on commission 18%", -detail.calc.gst_on_commission], ["Payment gateway fee", -detail.calc.pg_fee], ["Ads", -detail.calc.ads], ["Other deductions", -detail.calc.other], ["TCS (GST)", -detail.calc.tcs], ["TDS (194-O)", -detail.calc.tds], ["Discounts funded by you", -detail.calc.outlet_discount]].map(([l, v]) => (
              <div key={l as string} className="flex justify-between"><span>{l}</span><span className="num">{formatINR(v as number)}</span></div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><span>Expected net payout</span><span className="num">{formatINR(detail.calc.net_payout)}</span></div>
            <p className="text-xs text-mute">GST on food under section 9(5) is paid by the platform. Calculations only; nothing is filed from the app.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
