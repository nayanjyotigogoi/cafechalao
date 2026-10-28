"use client";

import { useState } from "react";
import { useQ } from "@/shared/api/hooks";
import { cx, daysAgoISO, downloadCSV, fmtDate, label, todayISO } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { DayClose } from "@/shared/types/entities";
import { AreaLine, BarChart, HBars } from "@/shared/ui/charts";
import { DataTable } from "@/shared/ui/data";
import { Button, Card, Chip, Input, Label, Loading, Money, PageTitle, Select, Stat } from "@/shared/ui/primitives";

/** Finance and reports (M10): every report filters by date, order type and staff, and exports to Excel (CSV) and PDF (print). */
const REPORTS = [
  ["sales", "Sales"], ["pnl", "P&L"], ["cash_flow", "Cash flow"], ["tax", "GST summary"], ["menu", "Menu engineering"], ["food_cost", "Food cost"],
  ["stock_variance", "Stock variance"], ["kitchen", "Kitchen prep"], ["delivery", "Delivery"], ["customers", "Customers"], ["feedback", "Feedback"],
  ["dine_in", "Dine-in"], ["budget", "Budget"], ["day_close", "Day close"], ["items", "Item sales"],
] as const;
type Name = (typeof REPORTS)[number][0];

export default function ReportsPage() {
  useTitle("Reports");
  const [name, setName] = useState<Name>("sales");
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(todayISO());
  const [type, setType] = useState("");
  const q = useQ<unknown>(`/reports/${name.replace(/_/g, "-")}`, { auth: "staff", query: { from, to, type } });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Reports" actions={<Button className="no-print" onClick={() => window.print()}>Export PDF</Button>} />
      <div className="no-print scrollbar-none flex gap-1.5 overflow-x-auto">{REPORTS.map(([k, l]) => <Chip key={k} onClick={() => setName(k)} active={name === k}>{l}</Chip>)}</div>
      <div className="no-print flex flex-wrap items-center gap-2">
        {[["Today", 0], ["7 days", 6], ["30 days", 29], ["90 days", 89]].map(([l, n]) => <Chip key={l as string} onClick={() => { setFrom(daysAgoISO(n as number)); setTo(todayISO()); }} active={from === daysAgoISO(n as number) && to === todayISO()}>{l}</Chip>)}
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" />
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40" aria-label="Order type"><option value="">All order types</option>{["dine_in", "takeaway", "delivery", "counter"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>
      </div>
      <h2 className="hidden font-disp text-xl print:block">{REPORTS.find((r) => r[0] === name)?.[1]} · {fmtDate(from)} – {fmtDate(to)}</h2>
      {q.isLoading || !q.data ? <Loading /> : <Report name={name} data={q.data} file={`${name}-${from}-to-${to}`} />}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function Report({ name, data, file }: { name: Name; data: any; file: string }) {
  const s = useSettings();
  const pct = (v: number) => `${v.toFixed(1)}%`;
  switch (name) {
    case "sales":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Gross sales" value={formatINR(data.summary.gross)} /><Stat label="Discounts" value={formatINR(data.summary.discounts)} />
            <Stat label="Net sales (ex-GST)" value={formatINR(data.summary.net)} sub={`Refunds ${formatINR(data.summary.refunds)}`} /><Stat label="Bills · AOV" value={`${data.summary.bills} · ${formatINR(data.summary.aov)}`} />
          </div>
          <Card><Label>Daily sales</Label><AreaLine data={data.by_day.map((d: any) => ({ label: fmtDate(d.date).slice(0, 6), value: d.sales }))} /></Card>
          <div className="grid gap-3 md:grid-cols-3">
            <Card><Label>Payment modes</Label><HBars data={data.by_mode.map((m: any) => ({ label: label(m.mode), value: m.amount }))} /></Card>
            <Card><Label>Order types</Label><HBars data={data.by_type.filter((t: any) => t.orders).map((t: any) => ({ label: `${label(t.type)} (${t.orders})`, value: t.sales }))} /></Card>
            <Card><Label>Channels</Label><HBars data={data.by_channel.map((c: any) => ({ label: c.channel.toUpperCase(), value: c.amount }))} /></Card>
          </div>
          <DataTable rows={data.by_day} rowKey={(r: any) => r.date} exportName={file} columns={[{ key: "date", header: "Date", value: (r: any) => fmtDate(r.date) }, { key: "orders", header: "Bills", align: "right" }, { key: "net", header: "Net", align: "right", value: (r: any) => r.net / 100, cell: (r: any) => <Money value={r.net} /> }, { key: "sales", header: "Total incl. GST", align: "right", value: (r: any) => r.sales / 100, cell: (r: any) => <Money value={r.sales} /> }]} />
        </div>
      );
    case "pnl": {
      const rows: [string, number, boolean?][] = [["Direct net sales (ex-GST)", data.direct_sales], ["Swiggy/Zomato net payout", data.aggregator_net], ["Net sales", data.net_sales, true], ["Cost of goods sold (recipes)", -data.cogs], ["Wastage", -data.wastage], ["Gross profit", data.gross_profit, true], ["Labour", -data.labour], ...data.expenses.map((e: any) => [e.category, -e.amount] as [string, number]), ["Net profit", data.net_profit, true]];
      return (
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <Card className="flex flex-col gap-1.5">
            {rows.map(([l, v, b]) => <div key={l} className={cx("flex justify-between text-sm", b && "border-t border-line pt-1.5 font-semibold")}><span>{l}</span><span className={cx("num", v < 0 && "text-rose")}>{formatINR(v)}</span></div>)}
            <p className="mt-2 text-xs text-mute">{data.note}</p>
            <Button size="sm" className="no-print self-start" onClick={() => downloadCSV(file, rows.map(([l, v]) => ({ line: l, amount: v / 100 })))}>Export CSV</Button>
          </Card>
          <div className="flex flex-col gap-3"><Stat label="Food cost %" value={pct(data.food_cost_pct)} tone={data.food_cost_pct > 35 ? "warn" : undefined} /><Stat label="Labour cost %" value={pct(data.labour_cost_pct)} /><Stat label="Net margin" value={pct(data.net_sales ? (data.net_profit / data.net_sales) * 100 : 0)} tone={data.net_profit < 0 ? "hot" : undefined} /></div>
        </div>
      );
    }
    case "cash_flow":
      return (
        <Card className="flex max-w-xl flex-col gap-1.5 text-sm">
          <div className="flex justify-between"><span>Opening cash</span><span className="num">{formatINR(data.opening)}</span></div>
          <Label>Cash in</Label>
          <div className="flex justify-between"><span>Sales collected</span><span className="num">{formatINR(data.cash_in.sales)}</span></div>
          <div className="flex justify-between"><span>Aggregator payouts</span><span className="num">{formatINR(data.cash_in.aggregators)}</span></div>
          <Label>Cash out</Label>
          {Object.entries(data.cash_out).filter(([k]) => k !== "total").map(([k, v]) => <div key={k} className="flex justify-between"><span>{label(k)}</span><span className="num text-rose">−{formatINR(v as number)}</span></div>)}
          <div className="flex justify-between border-t border-line pt-1.5 font-semibold"><span>Closing cash</span><span className="num">{formatINR(data.closing)}</span></div>
        </Card>
      );
    case "tax":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Scheme" value={label(data.scheme)} sub={data.gstin ?? "No GSTIN"} /><Stat label="Invoices" value={data.invoices} sub={data.first_invoice ? `${data.first_invoice} → ${data.last_invoice}` : undefined} /><Stat label="Turnover" value={formatINR(data.turnover)} /><Stat label="SAC" value={data.hsn_sac} /></div>
          {data.scheme === "composition" && <Card className="border-warn text-sm">Composition scheme: bills print as “Bill of Supply” with no GST. Turnover so far {formatINR(data.turnover)} — watch the annual threshold with your CA.</Card>}
          <DataTable rows={data.by_rate} rowKey={(r: any) => String(r.rate)} exportName={file} columns={[{ key: "rate", header: "GST rate", value: (r: any) => `${r.rate}%` }, { key: "taxable", header: "Taxable value", align: "right", value: (r: any) => r.taxable / 100, cell: (r: any) => <Money value={r.taxable} /> }, { key: "cgst", header: "CGST", align: "right", value: (r: any) => r.cgst / 100, cell: (r: any) => <Money value={r.cgst} decimals /> }, { key: "sgst", header: "SGST", align: "right", value: (r: any) => r.sgst / 100, cell: (r: any) => <Money value={r.sgst} decimals /> }]} />
          <p className="text-xs text-mute">For your CA. GSTR-1/3B filing reports come in Phase 2.</p>
        </div>
      );
    case "menu": {
      const cls: Record<string, [string, string]> = { star: ["⭐ Star", "Keep it prominent"], plowhorse: ["🐴 Plowhorse", "Popular, low margin: raise price or cut cost"], puzzle: ["🧩 Puzzle", "Profitable, slow: promote it"], dog: ["🐕 Dog", "Consider removing"] };
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(cls).map(([k, [l, tip]]) => <Card key={k}><b>{l}</b><div className="num font-disp text-2xl">{data.filter((r: any) => r.cls === k).length}</div><div className="text-xs text-mute">{tip}</div></Card>)}</div>
          <DataTable rows={data} rowKey={(r: any) => r.item_id} exportName={file} columns={[{ key: "name", header: "Item", cell: (r: any) => <b>{r.name}</b> }, { key: "cls", header: "Class", value: (r: any) => cls[r.cls][0] }, { key: "qty", header: "Sold", align: "right" }, { key: "popularity", header: "Popularity", align: "right", value: (r: any) => Math.round(r.popularity * 100) / 100 }, { key: "price", header: "Price", align: "right", cell: (r: any) => <Money value={r.price} /> }, { key: "recipe_cost", header: "Cost", align: "right", cell: (r: any) => <Money value={r.recipe_cost} /> }, { key: "margin", header: "Margin", align: "right", value: (r: any) => r.margin / 100, cell: (r: any) => <Money value={r.margin} /> }, { key: "food_cost_pct", header: "Food cost", align: "right", value: (r: any) => pct(r.food_cost_pct) }, { key: "revenue", header: "Revenue", align: "right", value: (r: any) => r.revenue / 100, cell: (r: any) => <Money value={r.revenue} /> }]} />
        </div>
      );
    }
    case "food_cost":
      return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Opening stock" value={formatINR(data.opening)} /><Stat label="Purchases (GRN)" value={formatINR(data.purchases)} /><Stat label="Closing stock" value={formatINR(data.closing)} />
          <Stat label="Food cost % (actual)" value={pct(data.food_cost_pct)} sub="(Opening + purchases − closing) ÷ net sales" /><Stat label="Theoretical food cost" value={formatINR(data.theoretical)} sub={`${pct(data.theoretical_pct)} of net sales from recipes`} /><Stat label="Net sales" value={formatINR(data.net_sales)} />
        </div>
      );
    case "stock_variance":
      return <DataTable rows={data} rowKey={(r: any) => r.raw_material_id} exportName={file} columns={[{ key: "name", header: "Ingredient" }, { key: "theoretical", header: "Theoretical use", align: "right", value: (r: any) => `${r.theoretical} ${r.unit}` }, { key: "wastage", header: "Wastage", align: "right", value: (r: any) => `${Math.round(r.wastage * 100) / 100}` }, { key: "actual", header: "Actual use", align: "right", value: (r: any) => `${r.actual} ${r.unit}` }, { key: "variance", header: "Variance", align: "right", cell: (r: any) => <span className={r.variance < 0 ? "num text-rose" : "num"}>{r.variance}</span> }, { key: "value", header: "Value", align: "right", value: (r: any) => r.value / 100, cell: (r: any) => <Money value={r.value} /> }]} />;
    case "kitchen":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3"><Stat label="Average prep time" value={`${Math.floor(data.average_sec / 60)}m ${Math.round(data.average_sec % 60)}s`} /><Stat label="KOTs" value={data.kots} /><Stat label={`Late (> ${s.flags.kds_red_min} min)`} value={data.late} tone={data.late ? "warn" : undefined} /></div>
          <DataTable rows={data.by_station} rowKey={(r: any) => r.station} columns={[{ key: "station", header: "Station", value: (r: any) => label(r.station) }, { key: "kots", header: "KOTs", align: "right" }, { key: "average_sec", header: "Avg prep", align: "right", value: (r: any) => `${Math.floor(r.average_sec / 60)}m ${Math.round(r.average_sec % 60)}s` }]} />
        </div>
      );
    case "delivery":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3"><Stat label="Deliveries" value={data.deliveries} /><Stat label="Avg delivery time" value={`${Math.round(data.average_min)} min`} sub="Delivered − accepted" /><Stat label="Charges to riders" value={formatINR(data.charges)} /></div>
          <DataTable rows={data.by_rider} rowKey={(r: any) => r.rider} exportName={file} columns={[{ key: "rider", header: "Rider" }, { key: "type", header: "Type" }, { key: "deliveries", header: "Deliveries", align: "right" }, { key: "charges", header: "Charges", align: "right", cell: (r: any) => <Money value={r.charges} /> }, { key: "cash", header: "Cash collected", align: "right", cell: (r: any) => <Money value={r.cash} /> }]} />
        </div>
      );
    case "customers":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Customers who ordered" value={data.customers} /><Stat label="Repeat rate" value={pct(data.repeat_rate)} sub={`${data.repeat_customers} with 2+ orders`} /><Stat label="New sign-ups" value={data.new_signups} /><Stat label="Tags" value={<span className="text-base">{Object.entries(data.tags).map(([k, v]) => `${k} ${v}`).join(" · ")}</span>} /></div>
          <DataTable rows={data.top} rowKey={(r: any) => r.id} exportName={file} columns={[{ key: "name", header: "Top customers" }, { key: "orders", header: "Orders", align: "right" }, { key: "spend", header: "Spend", align: "right", cell: (r: any) => <Money value={r.spend} /> }]} />
        </div>
      );
    case "feedback":
      return (
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div className="grid grid-cols-2 gap-3"><Stat label="Average rating" value={`${data.overall.toFixed(2)} ★`} sub={`${data.count} ratings`} /><Stat label="Low ratings" value={data.low} tone={data.low ? "warn" : undefined} /><Stat label="Food" value={data.food.toFixed(2)} /><Stat label="Service" value={data.service.toFixed(2)} /></div>
          <Card><Label>Distribution</Label><BarChart plain data={data.distribution.map((d: any) => ({ label: `${d.stars}★`, value: d.count }))} /></Card>
        </div>
      );
    case "dine_in":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3"><Stat label="Dine-in bills" value={data.bills} /><Stat label="Tables" value={data.tables} /><Stat label="Table turnover" value={`${data.turnover_per_hour.toFixed(2)} / hr`} sub="Bills per table ÷ operating hours" /></div>
          <div className="grid gap-3 md:grid-cols-2">
            <DataTable rows={data.by_table} rowKey={(r: any) => r.table} columns={[{ key: "table", header: "Table" }, { key: "bills", header: "Bills", align: "right" }, { key: "sales", header: "Sales", align: "right", cell: (r: any) => <Money value={r.sales} /> }]} />
            <DataTable rows={data.by_captain} rowKey={(r: any) => r.captain} columns={[{ key: "captain", header: "Captain" }, { key: "bills", header: "Bills", align: "right" }, { key: "sales", header: "Sales", align: "right", cell: (r: any) => <Money value={r.sales} /> }]} />
          </div>
        </div>
      );
    case "budget":
      return <DataTable rows={data} rowKey={(r: any) => r.category} exportName={file} columns={[{ key: "category", header: "Category" }, { key: "budget", header: "Budget", align: "right", cell: (r: any) => <Money value={r.budget} /> }, { key: "actual", header: "Actual", align: "right", cell: (r: any) => <Money value={r.actual} /> }, { key: "amount", header: "Variance", align: "right", cell: (r: any) => <Money value={r.amount} className={r.amount > 0 ? "text-rose" : "text-ok"} /> }, { key: "pct", header: "%", align: "right", value: (r: any) => (r.budget ? pct(r.pct) : "—") }]} />;
    case "day_close":
      return <DataTable rows={data as (DayClose & { closed_by_name: string })[]} rowKey={(r) => r.id} exportName={file} columns={[{ key: "business_date", header: "Date", value: (r) => fmtDate(r.business_date) }, { key: "sales_total", header: "Sales", align: "right", cell: (r) => <Money value={r.sales_total} /> }, { key: "expected_cash", header: "Expected cash", align: "right", cell: (r) => <Money value={r.expected_cash} /> }, { key: "counted_cash", header: "Counted", align: "right", cell: (r) => <Money value={r.counted_cash} /> }, { key: "variance", header: "Variance", align: "right", cell: (r) => <Money value={r.variance} className={r.variance ? "text-rose" : "text-ok"} /> }, { key: "variance_reason", header: "Reason" }, { key: "closed_by_name", header: "Closed by" }]} empty="No days closed in this range" />;
    case "items":
      return <DataTable rows={data} rowKey={(r: any) => r.name} search exportName={file} columns={[{ key: "name", header: "Item" }, { key: "qty", header: "Qty", align: "right" }, { key: "sales", header: "Sales (ex-GST)", align: "right", value: (r: any) => r.sales / 100, cell: (r: any) => <Money value={r.sales} /> }]} />;
  }
}
