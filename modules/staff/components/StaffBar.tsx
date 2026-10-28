"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { outletApi } from "@/modules/outlet/api";
import { useM, useQ } from "@/shared/api/hooks";
import { signOut, useStaff } from "@/shared/auth/session";
import { LanguageSwitch, useT } from "@/shared/i18n";
import { ago, cx } from "@/shared/lib/format";
import { ROLE_HOME, ROLE_LABEL } from "@/shared/lib/permissions";
import { useOnline, useOutbox } from "@/shared/offline";
import { useSettings } from "@/shared/tenant/TenantProvider";
import type { Notification } from "@/shared/types/entities";
import { OutletMark, PoweredBy } from "@/shared/ui/brand";
import { Modal } from "@/shared/ui/overlay";
import { Avatar, Button, Chip } from "@/shared/ui/primitives";

/** The other working screens, with what each is for (shown in the admin menu and alerts). */
const SCREENS = [
  { href: "/pos", label: "POS", text: "Billing counter: take orders and payments", perm: "pos.bill" },
  { href: "/captain", label: "Captain", text: "Table orders for waiters", perm: "orders.take" },
  { href: "/kds", label: "Kitchen", text: "Kitchen display: tickets to cook", perm: "kds.use" },
] as const;

/**
 * Top bar for staff screens: café, surface, sync status, alerts, user and log out.
 * `menu` (admin pages): on phones and tablets a ☰ button opens a drawer with those links, the other screens and Log out.
 */
export function StaffBar({ title, children, compact, menu }: { title: string; children?: ReactNode; compact?: boolean; menu?: ReactNode }) {
  const s = useSettings();
  const { session, can } = useStaff();
  const { t } = useT();
  const router = useRouter();
  const online = useOnline();
  const queued = useOutbox();
  const [open, setOpen] = useState(false);
  const notes = useQ<Notification[]>(session ? "/notifications" : null, { auth: "staff", live: true });
  const unread = notes.data?.filter((n) => !n.read).length ?? 0;
  const read = useM((id: string) => outletApi.readNotification(id), { silentError: true });
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [path]);
  const logout = () => { signOut("staff"); router.replace("/staff"); };
  const adminAccess = can("dashboard.owner") || can("stock.view") || can("reservations.manage");
  const adminHref = session && ROLE_HOME[session.user.role].startsWith("/admin") ? ROLE_HOME[session.user.role] : "/admin";
  const screens = SCREENS.filter((x) => can(x.perm) && !path.startsWith(x.href) && (x.href !== "/captain" || s.flags.features.captain_app));

  return (
    <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b-[1.5px] border-line bg-paper px-3 py-2 sm:px-4">
      {menu && (
        <button onClick={() => setDrawer(true)} className="grid size-10 cursor-pointer place-items-center rounded-lg text-xl hover:bg-fill lg:hidden" aria-label="Open menu" aria-expanded={drawer}>☰</button>
      )}
      <OutletMark name={s.outlet.name} logo={s.brand.logo_url} size={30} />
      <b className="font-disp text-[17px]">{compact ? title : `${s.outlet.name} · ${title}`}</b>
      {/* POS, Captain and Kitchen: a way back to the admin pages for owner and manager. */}
      {!menu && adminAccess && <Link href={adminHref} className="rounded-lg px-2 py-1 text-sm text-brand hover:bg-fill">← Admin</Link>}
      {children}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Chip tone={online ? "ok" : "hot"} title={online ? "Connected" : "Working offline; changes will sync"}>
          ● {online ? (queued ? `Syncing ${queued}` : "Synced") : `${t("Offline")}${queued ? ` · ${queued} queued` : ""}`}
        </Chip>
        {session && (
          <button onClick={() => setOpen(true)} className="relative grid size-10 cursor-pointer place-items-center rounded-full hover:bg-fill" aria-label={`${unread} alerts`}>
            🔔{unread > 0 && <span className="num absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-rose px-1 text-[10px] text-white">{unread}</span>}
          </button>
        )}
        {session && (
          <div className={cx("items-center gap-2", menu ? "hidden lg:flex" : "flex")}>
            <Avatar name={session.user.name} color={session.user.avatar_color} size={30} />
            <span className="hidden text-sm sm:inline">{session.user.name.split(" ")[0]} · {ROLE_LABEL[session.user.role]}</span>
          </div>
        )}
        {/* With a menu, Log out lives in the drawer on phones and tablets. */}
        <span className={menu ? "hidden lg:contents" : "contents"}><Button size="sm" variant="danger" onClick={logout}>{t("Log out")}</Button></span>
      </div>
      {menu && drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 cursor-default bg-black/50" onClick={() => setDrawer(false)} aria-label="Close menu" />
          <nav className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto bg-paper p-3 shadow-xl">
            <div className="mb-2 flex items-center gap-2 border-b border-line px-1 pb-3">
              {session && <Avatar name={session.user.name} color={session.user.avatar_color} size={36} />}
              <div className="min-w-0 flex-1 text-sm">
                <b className="block truncate">{session?.user.name}</b>
                <span className="text-mute">{session && ROLE_LABEL[session.user.role]} · {s.outlet.name}</span>
              </div>
              <button onClick={() => setDrawer(false)} className="grid size-10 cursor-pointer place-items-center rounded-lg text-xl hover:bg-fill" aria-label="Close menu">×</button>
            </div>
            {menu}
            {screens.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 border-t border-line pt-3">
                <span className="px-3 text-xs font-semibold uppercase tracking-wide text-mute">Other screens</span>
                {screens.map((x) => (
                  <Link key={x.href} href={x.href} className="flex min-h-11 flex-col justify-center rounded-lg px-3 py-1 hover:bg-fill/50">
                    <span className="text-sm">{x.label}</span><span className="text-xs text-mute">{x.text}</span>
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-auto border-t border-line pt-3">
              <Button variant="danger" block onClick={logout}>{t("Log out")}</Button>
            </div>
          </nav>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Alerts" footer={<LanguageSwitch />}>
        <div className="flex flex-col gap-2">
          {!notes.data?.length && <p className="text-sm text-mute">No alerts.</p>}
          {notes.data?.map((n) => (
            <div key={n.id} className={cx("flex items-start gap-3 rounded-xl border-[1.5px] p-3 text-sm", n.read ? "border-line opacity-70" : "border-brand")}>
              <div className="min-w-0 flex-1">
                <b>{n.title}</b>
                <div className="text-mute">{n.body}</div>
                <div className="text-[11px] text-mute">{ago(n.created_at)}</div>
              </div>
              {n.link && (
                <Link href={n.link} onClick={() => { read.mutate(n.id); setOpen(false); }}><Button size="sm">Open</Button></Link>
              )}
              {!n.read && <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>✓</Button>}
            </div>
          ))}
          {session && (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-3 text-sm">
              <span className="text-mute">Go to:</span>
              {screens.map((x) => <Link key={x.href} className="text-brand underline" href={x.href}>{x.label}</Link>)}
              {adminAccess && <Link className="text-brand underline" href={adminHref}>Admin</Link>}
            </div>
          )}
        </div>
      </Modal>
    </header>
  );
}

export function StaffFooter() {
  return <PoweredBy className="no-print" />;
}
