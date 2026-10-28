"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StaffBar } from "@/modules/staff/components/StaffBar";
import { useQ } from "@/shared/api/hooks";
import { StaffGate, useStaff } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { cx } from "@/shared/lib/format";
import type { Permission } from "@/shared/lib/permissions";
import { useSettings } from "@/shared/tenant/TenantProvider";
import type { Approval, FeatureKey } from "@/shared/types/entities";
import { PoweredBy } from "@/shared/ui/brand";

/** Outlet admin and owner dashboard (L2). Menu entries follow the user's permissions and the café's features. */

interface NavItem { href: string; label: string; icon: string; perm?: Permission; anyOf?: Permission[]; feature?: FeatureKey }
const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "📊", anyOf: ["dashboard.owner", "reports.view"] },
  { href: "/admin/orders", label: "Orders", icon: "🧾", anyOf: ["pos.bill", "reports.view"] },
  { href: "/admin/menu", label: "Menu", icon: "🍽", perm: "menu.edit" },
  { href: "/admin/tables", label: "Tables & QR", icon: "🪑", perm: "tables.manage", feature: "dine_in" },
  { href: "/admin/reservations", label: "Reservations", icon: "📅", perm: "reservations.manage", feature: "reservations" },
  { href: "/admin/customers", label: "Customers", icon: "👥", anyOf: ["customers.view", "customers.create"] },
  { href: "/admin/marketing", label: "Marketing", icon: "🎁", perm: "marketing.manage" },
  { href: "/admin/stock", label: "Stock & purchase", icon: "📦", perm: "stock.view", feature: "stock" },
  { href: "/admin/expenses", label: "Expenses", icon: "💸", perm: "expenses.create", feature: "expenses" },
  { href: "/admin/staff", label: "Staff", icon: "🧑‍🍳", perm: "staff.manage", feature: "staff" },
  { href: "/admin/delivery", label: "Delivery", icon: "🛵", perm: "delivery.assign", feature: "delivery" },
  { href: "/admin/aggregators", label: "Swiggy/Zomato", icon: "📱", perm: "aggregators.manage", feature: "aggregator_tracker" },
  { href: "/admin/reports", label: "Reports", icon: "📈", perm: "reports.view" },
  { href: "/admin/approvals", label: "Approvals", icon: "✅", perm: "approvals.decide" },
  { href: "/admin/audit", label: "Audit log", icon: "🔍", perm: "audit.view" },
  { href: "/admin/settings", label: "Settings", icon: "⚙️", perm: "settings.manage" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <StaffGate anyOf={["dashboard.owner", "reports.view", "stock.view", "reservations.manage", "menu.edit", "staff.manage", "customers.create", "expenses.create"]}>
      {() => <Shell>{children}</Shell>}
    </StaffGate>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const s = useSettings();
  const { can } = useStaff();
  const { t } = useT();
  const path = usePathname();
  const pending = useQ<Approval[]>(can("approvals.decide") ? "/approvals" : null, { auth: "staff", query: { status: "pending" }, live: true });
  const items = NAV.filter((n) => (!n.perm || can(n.perm)) && (!n.anyOf || n.anyOf.some(can)) && (!n.feature || s.flags.features[n.feature]));
  const on = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  const badge = (n: NavItem) => n.href === "/admin/approvals" && !!pending.data?.length && <span className="num ml-auto rounded-full bg-rose px-1.5 text-[11px] text-white">{pending.data.length}</span>;
  const links = items.map((n) => (
    <Link key={n.href} href={n.href} className={cx("flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm", on(n.href) ? "bg-fill font-semibold" : "hover:bg-fill/50")}>
      <span aria-hidden>{n.icon}</span>{t(n.label)}{badge(n)}
    </Link>
  ));
  const quick = [
    can("pos.bill") && { href: "/pos", label: "POS" },
    can("orders.take") && s.flags.features.captain_app && { href: "/captain", label: "Captain" },
    can("kds.use") && { href: "/kds", label: "Kitchen" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="flex min-h-dvh flex-col">
      <StaffBar title="Admin" menu={links}>
        <div className="hidden gap-1 lg:flex">{quick.map((q) => <Link key={q.href} href={q.href} className="rounded-lg px-2 py-1 text-sm text-brand hover:bg-fill">{q.label}</Link>)}</div>
      </StaffBar>
      {s.outlet.setup_step < 10 && can("settings.manage") && !path.startsWith("/admin/setup") && (
        <Link href="/admin/setup" className="no-print block bg-brand px-4 py-2 text-center text-sm text-on-brand">Finish setting up {s.outlet.name} ({s.outlet.setup_step}/10 steps done) →</Link>
      )}
      <div className="flex flex-1 flex-col lg:flex-row">
        <nav className="no-print hidden shrink-0 gap-1 border-r-[1.5px] border-line bg-paper p-2 lg:sticky lg:top-[55px] lg:flex lg:h-[calc(100dvh-55px)] lg:w-56 lg:flex-col lg:overflow-y-auto">
          {links}
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
      <PoweredBy className="no-print" />
    </div>
  );
}
