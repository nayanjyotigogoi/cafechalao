"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cartCount, useCart } from "@/modules/orders/cart";
import { signOut, useCustomer } from "@/shared/auth/session";
import { cx } from "@/shared/lib/format";
import { LanguageSwitch, useT } from "@/shared/i18n";
import { TenantProvider, useFeature, useSettings } from "@/shared/tenant/TenantProvider";
import { OutletMark, PoweredBy } from "@/shared/ui/brand";
import { Button } from "@/shared/ui/primitives";

/** Customer app shell (L3): branded entirely as the café; CafeChalao appears only in the locked footer line. */
export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <TenantProvider>
      <Shell>{children}</Shell>
    </TenantProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const s = useSettings();
  const c = useCart();
  const { customer } = useCustomer();
  const { t } = useT();
  const path = usePathname();
  const reservations = useFeature("reservations");
  const count = cartCount(c);
  const tabs = [
    { href: "/", label: t("Menu"), icon: "🍽" },
    ...(!c.table_code ? [{ href: "/order", label: t("Order online"), icon: "🛍️" }] : []),
    { href: "/orders", label: t("Orders"), icon: "🧾" },
    ...(reservations ? [{ href: "/reserve", label: t("Book a table"), icon: "📅" }] : []),
    { href: "/profile", label: t("Profile"), icon: "👤" },
  ];
  const hideTabs = path.startsWith("/bill/");

  return (
    <div className="flex min-h-dvh flex-col">
      {s.tenant.status === "suspended" && <div className="bg-warn px-4 py-2 text-center text-sm text-white">Online ordering is paused right now. Please call {s.outlet.phone}.</div>}
      <header className="sticky top-0 z-30 border-b-[1.5px] border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <OutletMark name={s.outlet.name} logo={s.brand.logo_url} size={34} />
            <span className="truncate font-disp text-lg font-bold">{s.outlet.name}</span>
          </Link>
          {c.table_name && <span className="rounded-full border-[1.5px] border-line px-2.5 py-0.5 text-xs font-semibold">{c.table_name}</span>}
          <nav className="ml-6 hidden items-center gap-5 text-sm md:flex">
            {tabs.map((x) => (
              <Link key={x.href} href={x.href} className={cx("hover:text-brand", (x.href === "/" ? path === "/" : (path === x.href || path.startsWith(x.href + "/"))) && "font-semibold text-brand")}>
                {x.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitch />
            {!customer ? (
              <Link href={`/login?next=${encodeURIComponent(path)}`} className="hidden sm:block">
                <Button size="sm">{t("Sign in")}</Button>
              </Link>
            ) : (
              <>
                <Link href="/profile" className="hidden text-sm font-medium sm:block">
                  {customer.name.split(" ")[0]}
                </Link>
                <Button size="sm" variant="ghost" onClick={() => signOut("customer")}>{t("Log out")}</Button>
              </>
            )}
            <Link href="/cart" className="hidden md:block">
              <Button size="sm" variant="primary">
                {t("Cart")} · {count}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:pb-10">{children}</main>

      <PoweredBy className="pb-20 md:pb-4" />

      {!hideTabs && (
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t-[1.5px] border-line bg-paper md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {tabs.map((x) => {
            const on = x.href === "/" ? path === "/" || path.startsWith("/t/") : path === x.href || path.startsWith(x.href + "/");
            return (
              <Link key={x.href} href={x.href} className={cx("flex min-h-14 flex-1 flex-col items-center justify-center text-[11px]", on ? "font-semibold text-brand" : "text-mute")}>
                <span aria-hidden className="text-lg leading-none">{x.icon}</span>
                {x.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
