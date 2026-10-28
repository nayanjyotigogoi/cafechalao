"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WastageModal } from "@/modules/inventory/components/WastageModal";
import { menuApi } from "@/modules/menu/api";
import { ordersApi } from "@/modules/orders/api";
import { StaffBar } from "@/modules/staff/components/StaffBar";
import { useM, useQ } from "@/shared/api/hooks";
import { StaffGate } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { clock, cx, label, minsSince } from "@/shared/lib/format";
import { beep } from "@/shared/realtime";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { KotRow, Menu } from "@/shared/types/api";
import type { Station } from "@/shared/types/entities";
import { Modal } from "@/shared/ui/overlay";
import { Button, Chip, Label, Loading } from "@/shared/ui/primitives";

/**
 * Kitchen display (M2.5): tickets per station, per-item timers, amber/red when late (configurable),
 * preparing → ready, ready alert to captain/rider, out-of-stock toggle and wastage at end of shift.
 */
export default function KDSPage() {
  useTitle("Kitchen");
  return <StaffGate perm="kds.use" idleMinutes={720}>{() => <KDS />}</StaffGate>;
}

function KDS() {
  const s = useSettings();
  const { t } = useT();
  const [station, setStation] = useState<Station | "all">("all");
  const kots = useQ<KotRow[]>("/kots", { auth: "staff", live: true });
  const done = useQ<KotRow[]>("/kots", { auth: "staff", query: { all: 1 }, live: true });
  const [view, setView] = useState<"live" | "served">("live");
  const [now, setNow] = useState(Date.now());
  const [wastage, setWastage] = useState(false);
  const [stock, setStock] = useState(false);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  const all = useMemo(() => kots.data ?? [], [kots.data]);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(all.map((k) => k.id));
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) beep(880, 220);
    seen.current = ids;
  }, [all]);

  const list = all.filter((k) => station === "all" || k.station === station);
  const stations = [...new Set(all.map((k) => k.station))];
  const kot = useM(({ id, st }: { id: string; st: "preparing" | "ready" | "served" }) => ordersApi.kot(id, st));
  const item = useM(({ id, st }: { id: string; st: "preparing" | "ready" }) => ordersApi.kotItem(id, st));

  const avg = useMemo(() => {
    const today = new Date().toDateString();
    const r = (done.data ?? []).filter((k) => k.ready_at && new Date(k.created_at).toDateString() === today);
    if (!r.length) return null;
    const sec = r.reduce((a, k) => a + (new Date(k.ready_at!).getTime() - new Date(k.created_at).getTime()) / 1000, 0) / r.length;
    return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  }, [done.data]);

  // Served tickets leave the live board; the kitchen can still look them up for today.
  const served = useMemo(() => {
    const today = new Date().toDateString();
    return (done.data ?? []).filter((k) => k.status === "served" && new Date(k.created_at).toDateString() === today && (station === "all" || k.station === station))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [done.data, station]);

  const late = (k: KotRow) => {
    const m = minsSince(k.created_at, now);
    return m >= s.flags.kds_red_min ? "red" : m >= s.flags.kds_amber_min ? "amber" : null;
  };
  const cols: { key: KotRow["status"]; title: string; list: KotRow[] }[] = [
    { key: "new", title: t("New"), list: list.filter((k) => k.status === "new") },
    { key: "preparing", title: t("Cooking"), list: list.filter((k) => k.status === "preparing") },
    { key: "ready", title: t("Ready to serve"), list: list.filter((k) => k.status === "ready") },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <StaffBar title={t("Kitchen") === "Kitchen" ? "Kitchen" : t("Kitchen")} compact>
        <div className="flex gap-1 rounded-xl bg-fill p-1">
          <Chip onClick={() => setView("live")} active={view === "live"}>Live</Chip>
          <Chip onClick={() => setView("served")} active={view === "served"}>Served today {served.length}</Chip>
        </div>
        <div className="flex gap-1 rounded-xl bg-fill p-1">
          <Chip onClick={() => setStation("all")} active={station === "all"}>All {all.length}</Chip>
          {stations.map((st) => <Chip key={st} onClick={() => setStation(st)} active={station === st}>{label(st)} {all.filter((k) => k.station === st).length}</Chip>)}
        </div>
        {avg && <Chip>Avg prep {avg}</Chip>}
        <Chip className="num">{new Date(now).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</Chip>
        <Button size="sm" onClick={() => setStock(true)}>Out of stock</Button>
        <Button size="sm" onClick={() => setWastage(true)}>{t("Record wastage")}</Button>
      </StaffBar>
      {view === "served" ? (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <Label>Served today · {served.length}</Label>
          {served.map((k) => (
            <article key={k.id} className="flex flex-col gap-1 rounded-2xl border-[1.5px] border-line bg-paper p-3 md:flex-row md:items-center md:gap-4">
              <b className="md:w-48">#{k.number} · {k.table_name ?? (k.token ? `Token ${k.token}` : label(k.order_type))}</b>
              <span className="text-xs text-mute md:w-40">{k.order_number} · {label(k.station)}</span>
              <span className="flex-1 text-sm">{k.items.filter((i) => i.status !== "void").map((i) => `${i.qty}× ${i.name}${i.variant_name ? ` (${i.variant_name})` : ""}`).join(", ")}</span>
              <span className="num text-xs text-mute">
                In {new Date(k.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                {k.ready_at && ` · ready in ${Math.max(1, Math.round((new Date(k.ready_at).getTime() - new Date(k.created_at).getTime()) / 60000))} min`}
              </span>
            </article>
          ))}
          {!served.length && <div className="rounded-2xl border-[1.5px] border-dashed border-line p-6 text-center text-sm text-mute">Nothing served yet today</div>}
        </div>
      ) : kots.isLoading ? <Loading /> : (
        <div className="grid flex-1 gap-3 p-3 md:grid-cols-3">
          {cols.map((c) => (
            <section key={c.key} className="flex min-w-0 flex-col gap-2">
              <Label>{c.title} · {c.list.length}</Label>
              {c.list.map((k) => {
                const l = late(k);
                return (
                  <article key={k.id} className={cx("flex flex-col gap-2 rounded-2xl border-[1.5px] bg-paper p-3", l === "red" ? "border-[2.5px] border-rose" : l === "amber" ? "border-warn" : "border-line", c.key === "ready" && "bg-fill")}>
                    <div className="flex items-center gap-2">
                      <b className="text-lg">#{k.number} · {k.table_name ?? (k.token ? `Token ${k.token}` : label(k.order_type))}</b>
                      <span className={cx("num ml-auto rounded-full border-[1.5px] px-2 py-0.5 text-sm", l === "red" ? "border-rose text-rose" : l === "amber" ? "border-warn text-warn" : "border-line")}>
                        {clock(k.created_at, now)}{l === "red" ? " late" : ""}{l ? (l === "red" ? " ⚠" : " ◔") : ""}
                      </span>
                    </div>
                    <div className="text-xs text-mute">{k.order_number} · {label(k.station)}{k.customer_name ? ` · ${k.customer_name}` : ""}</div>
                    {k.items.filter((i) => i.status !== "void").map((i) => (
                      <button key={i.id} disabled={c.key === "ready"} onClick={() => item.mutate({ id: i.id, st: i.status === "ready" ? "preparing" : "ready" })}
                        className={cx("flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-[15px]", i.status === "ready" ? "text-mute line-through" : "hover:bg-fill/60")}>
                        <b className="num">{i.qty}×</b><span className="flex-1">{i.name}{i.variant_name ? ` (${i.variant_name})` : ""}</span>
                        {i.status === "ready" && <span className="text-ok no-underline">✓</span>}
                        {(i.note || i.add_ons.length > 0) && <Chip tone="hot">{[...i.add_ons.map((a) => a.name), i.note].filter(Boolean).join(", ")}</Chip>}
                        {i.course && <Chip>{i.course}</Chip>}
                      </button>
                    ))}
                    {k.note && <div className="rounded-lg bg-rose/10 px-2 py-1 text-sm text-rose">Note: {k.note}</div>}
                    {c.key === "new" && <Button className="touch" onClick={() => kot.mutate({ id: k.id, st: "preparing" })}>{t("Start cooking")}</Button>}
                    {c.key === "preparing" && <Button className="touch" variant="primary" onClick={() => kot.mutate({ id: k.id, st: "ready" })}>{t("Mark ready")}</Button>}
                    {c.key === "ready" && (
                      <>
                        <div className="text-xs text-mute">{k.order_type === "dine_in" ? "Captain notified" : k.order_type === "delivery" ? "Rider notified" : "Counter notified"}</div>
                        <Button className="touch" onClick={() => kot.mutate({ id: k.id, st: "served" })}>{t("Served")}</Button>
                      </>
                    )}
                  </article>
                );
              })}
              {!c.list.length && <div className="rounded-2xl border-[1.5px] border-dashed border-line p-6 text-center text-sm text-mute">Nothing here</div>}
            </section>
          ))}
        </div>
      )}
      <p className="px-4 pb-3 text-xs text-mute">Timers turn amber at {s.flags.kds_amber_min} min and red at {s.flags.kds_red_min} min (Settings → Features). Tap an item to mark it ready on its own.</p>
      <StockModal open={stock} onClose={() => setStock(false)} />
      <WastageModal open={wastage} onClose={() => setWastage(false)} />
    </div>
  );
}

function StockModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const menu = useQ<Menu>(open ? "/menu" : null);
  const toggle = useM(({ id, v }: { id: string; v: boolean }) => menuApi.availability(id, { in_stock: v }));
  return (
    <Modal open={open} onClose={onClose} title="Out of stock today">
      <div className="flex flex-col gap-1">
        {menu.data?.items.map((i) => (
          <label key={i.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line/60 text-sm">
            <input type="checkbox" checked={!i.in_stock} onChange={(e) => toggle.mutate({ id: i.id, v: !e.target.checked })} className="size-5 accent-[var(--rose)]" />
            <span className="flex-1">{i.name}</span>
            {!i.in_stock && <Chip tone="hot">Out</Chip>}
          </label>
        ))}
      </div>
    </Modal>
  );
}

