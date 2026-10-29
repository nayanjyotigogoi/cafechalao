"use client";

import Link from "next/link";
import { useState } from "react";
import { useQ } from "@/shared/api/hooks";
import { useStaff } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { label } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { Dashboard } from "@/shared/types/api";
import { BarChart } from "@/shared/ui/charts";
import { Card, Chip, Label, Loading, PageTitle, Stat } from "@/shared/ui/primitives";

/** Owner dashboard (M10.2): sales, orders, expenses, profit estimate, cash in hand, alerts — phone and desktop. */
export default function DashboardPage() {
  useTitle("Dashboard");
  const s = useSettings();
  const { t } = useT();
  const { session, can } = useStaff();
  const [range, setRange] = useState<"today" | "7d" | "30d">("today");
  const d = useQ<Dashboard>("/reports/dashboard", { auth: "staff", query: { range }, live: true });

  if (!can("reports.view")) {
    return <PageTitle title={`${t("Good morning")}, ${session?.user.name.split(" ")[0]}`} sub="Use the menu on the left for your work today." />;
  }
  const x = d.data;
  const cmp = range === "today" ? `vs last ${new Date(Date.now() - 86400000).toLocaleDateString("en-IN", { weekday: "short" })}` : "vs previous period";
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={`${s.outlet.name} · Owner`} sub={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        actions={<div className="flex gap-1">{(["today", "7d", "30d"] as const).map((r) => <Chip key={r} onClick={() => setRange(r)} active={range === r}>{r === "today" ? "Today" : r === "7d" ? "7 days" : "30 days"}</Chip>)}</div>} />
      {!x ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat className="pastel" label={t("Sales")} value={formatINR(x.sales)} sub={x.sales_change_pct != null && <span className={x.sales_change_pct >= 0 ? "text-ok" : "text-rose"}>{x.sales_change_pct >= 0 ? "▲" : "▼"} {Math.abs(x.sales_change_pct).toFixed(0)}% {cmp}</span>} />
            <Stat label={t("Orders")} value={x.orders} sub={`Avg bill ${formatINR(x.aov)}`} />
            <Stat label="Profit estimate" value={formatINR(x.profit_estimate)} tone={x.profit_estimate < 0 ? "hot" : undefined} sub={`Food cost ${x.food_cost_pct.toFixed(0)}% · labour ${x.labour_cost_pct.toFixed(0)}%`} />
            <Stat label="Cash in hand" value={formatINR(x.cash_in_hand)} sub={`Expenses ${formatINR(x.expenses)}`} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Online / Cash" value={<span className="text-lg">{formatINR(x.online)} / {formatINR(x.cash)}</span>} />
            {s.flags.features.dine_in && <Stat label="Live tables" value={`${x.live_tables.occupied} of ${x.live_tables.total}`} />}
            <Stat label="Net sales (ex-GST)" value={formatINR(x.net_sales)} />
            <Stat label="Food cost" value={`${x.food_cost_pct.toFixed(0)}%`} tone={x.food_cost_pct > 35 ? "warn" : undefined} />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <Card className="flex flex-col gap-2">
              <Label>{t("Sales by hour")}</Label>
              <BarChart data={x.by_hour.map((h) => ({ label: `${h.hour % 12 || 12}${h.hour < 12 ? "a" : "p"}`, value: h.sales }))} height={150} />
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {x.by_type.map((bt) => <Chip key={bt.type}>{label(bt.type)} · {bt.orders} · {formatINR(bt.sales)}</Chip>)}
              </div>
            </Card>
            <div className="flex flex-col gap-3">
              <Card className="flex flex-col gap-2">
                <Label>{t("Needs attention")}</Label>
                {!x.alerts.length && <span className="text-sm text-ok">All good ✓</span>}
                {x.alerts.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{a.text}</span>
                    <Link href={a.link} className="text-brand underline">{a.kind === "low_stock" ? "Reorder" : a.kind === "approvals" ? "Review" : a.kind === "rating" ? "Reply" : "Open"}</Link>
                  </div>
                ))}
              </Card>
              <Card className="flex flex-col gap-1.5">
                <Label>{t("Top items")}</Label>
                {x.top_items.map((it) => <div key={it.name} className="flex justify-between text-sm"><span>{it.name}</span><span className="num">{it.qty}</span></div>)}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
