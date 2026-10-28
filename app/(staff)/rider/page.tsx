"use client";

import { useEffect, useRef, useState } from "react";
import { authApi } from "@/modules/auth/api";
import { deliveryApi } from "@/modules/delivery/api";
import { API_MODE } from "@/shared/api/client";
import { useM, useQ } from "@/shared/api/hooks";
import { signIn, signOut, useRider } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { cx, fmtTime, label } from "@/shared/lib/format";
import { compressImage } from "@/shared/lib/image";
import { formatINR } from "@/shared/lib/money";
import { beep } from "@/shared/realtime";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { DeliveryRow } from "@/shared/types/api";
import { OutletMark, PoweredBy } from "@/shared/ui/brand";
import { Modal } from "@/shared/ui/overlay";
import { Button, Card, Chip, Empty, ErrorText, Field, Input, Label, Loading, Stat, Toggle } from "@/shared/ui/primitives";

/** Rider tab (M8): phone OTP login, accept requests (first wins), pick up, navigate, deliver with OTP or photo, collect cash/UPI. */
export default function RiderPage() {
  useTitle("Rider");
  const { token, rider, loading } = useRider();
  if (!token) return <RiderLogin />;
  if (loading || !rider) return <Loading />;
  return <RiderApp />;
}

function RiderLogin() {
  const s = useSettings();
  const [phone, setPhone] = useState(API_MODE === "mock" ? "+91 90000 11111" : "");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const send = useM(() => authApi.sendOtp(phone), { onSuccess: (r) => setSent(r.demo_otp ?? "") });
  const login = useM(() => authApi.rider(phone, otp), { onSuccess: (r) => signIn("rider", r.token) });
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <OutletMark name={s.outlet.name} logo={s.brand.logo_url} size={60} />
      <h1 className="font-disp text-2xl font-extrabold">{s.outlet.name} · Rider</h1>
      <Card className="flex w-full flex-col gap-3 text-left">
        <Field label="Your phone" hint={API_MODE === "mock" ? "Demo riders: +91 90000 11111 (own), +91 90000 22222 (freelance)" : undefined}><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        {sent === null ? <Button variant="primary" loading={send.isPending} onClick={() => send.mutate(undefined)}>Send OTP</Button> : (
          <>
            <Field label="OTP" hint={sent ? `Demo OTP ${sent}` : undefined}><Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} /></Field>
            <Button variant="primary" loading={login.isPending} onClick={() => login.mutate(undefined)}>Log in</Button>
          </>
        )}
        <ErrorText error={send.error ?? login.error} />
      </Card>
      <PoweredBy />
    </div>
  );
}

function RiderApp() {
  const { t } = useT();
  const { rider } = useRider();
  const [tab, setTab] = useState<"active" | "history" | "earnings">("active");
  const data = useQ<{ active: DeliveryRow[]; requests: DeliveryRow[]; history: DeliveryRow[] }>("/rider/deliveries", { auth: "rider", live: true });
  const earnings = useQ<{ type: string; today_count: number; today_charges: number; cash_in_hand: number; upi_collected: number; month_charges: number; note: string; settled_today: boolean }>("/rider/earnings", { auth: "rider", live: true });
  const online = useM((v: boolean) => deliveryApi.setOnline(v));
  const [delivering, setDelivering] = useState<DeliveryRow | null>(null);
  const reqCount = data.data?.requests.length ?? 0;
  const prev = useRef(reqCount);
  useEffect(() => {
    if (reqCount > prev.current) beep(988, 250);
    prev.current = reqCount;
  }, [reqCount]);
  const accept = useM((id: string) => deliveryApi.accept(id), { success: "Accepted. Head to the café." });
  const decline = useM((id: string) => deliveryApi.decline(id));
  const status = useM(({ id, st }: { id: string; st: string }) => deliveryApi.status(id, { status: st }));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b-[1.5px] border-line bg-paper px-4 py-2.5">
        <b className="font-disp text-lg">Rider · {rider!.name.split(" ")[0]}</b>
        <div className="ml-auto flex items-center gap-2">
          <Toggle checked={rider!.online} onChange={(v) => online.mutate(v)} label={<Chip tone={rider!.online ? "ok" : "neutral"}>● {rider!.online ? t("Online") : t("Offline")}</Chip>} />
          <Button size="sm" variant="ghost" onClick={() => signOut("rider")}>{t("Log out")}</Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-3 p-3 pb-24">
        {tab === "active" && (
          <>
            {data.isLoading && <Loading />}
            {data.data?.requests.map((d) => (
              <Card key={d.id} className="flex flex-col gap-2 border-[2.5px] border-brand">
                <div className="flex items-center gap-2"><b>New request · {d.order?.number}</b><span className="num ml-auto">{d.distance_km} km</span></div>
                <div className="text-sm">Pickup: {d.pickup?.name} · {d.pickup?.address}</div>
                <div className="text-sm">Drop: {d.order?.address_text}</div>
                <div className="text-sm">Your charge <b className="num">{formatINR(d.charge)}</b> · {d.to_collect ? `collect ${formatINR(d.to_collect)}` : "prepaid"}</div>
                <div className="flex gap-2"><Button className="flex-1" onClick={() => decline.mutate(d.id)}>Decline</Button><Button variant="primary" className="flex-1" loading={accept.isPending} onClick={() => accept.mutate(d.id)}>Accept</Button></div>
              </Card>
            ))}
            {data.data?.active.map((d) => (
              <Card key={d.id} className="flex flex-col gap-2">
                <div className="img-ph grid h-40 place-items-center rounded-xl border-[1.5px] border-line text-sm text-mute">Map · route to customer</div>
                <div className="flex items-center gap-2"><b>Order {d.order?.number}</b><Chip tone={d.status === "accepted" ? "info" : "warn"}>{label(d.status)}</Chip><span className="ml-auto text-xs text-mute">{d.order?.status === "ready" ? "Food ready ✓" : `Kitchen: ${label(d.order?.status ?? "")}`}</span></div>
                <div className="text-sm">{d.order?.customer_name} · {d.distance_km} km</div>
                <div className="text-xs text-mute">{d.order?.address_text}</div>
                <div className="flex justify-between text-sm"><span>To collect</span><b className="num">{d.to_collect ? formatINR(d.to_collect) : "₹0 (paid online)"}</b></div>
                <div className="flex gap-2">
                  <a className="flex-1" href={`tel:${(d.order?.customer_phone ?? "").replace(/\s/g, "")}`}><Button block>{t("Call")}</Button></a>
                  <a className="flex-1" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d.order?.address_text ?? "")}`}><Button block>{t("Navigate")}</Button></a>
                </div>
                {d.status === "accepted" && <Button variant="primary" loading={status.isPending} disabled={d.order?.status !== "ready"} onClick={() => status.mutate({ id: d.id, st: "picked_up" })}>{d.order?.status === "ready" ? t("Picked up") : "Waiting for the kitchen…"}</Button>}
                {d.status === "picked_up" && <Button onClick={() => status.mutate({ id: d.id, st: "on_the_way" })}>On the way</Button>}
                {["picked_up", "on_the_way"].includes(d.status) && <Button variant="primary" onClick={() => setDelivering(d)}>{t("Mark delivered")} (OTP or photo)</Button>}
              </Card>
            ))}
            {!data.isLoading && !data.data?.active.length && !reqCount && <Empty title="No deliveries right now">{rider!.online ? "New requests will ring here." : "Go online to receive requests."}</Empty>}
            {earnings.data && <Card className="flex justify-between text-sm"><span>Today: {earnings.data.today_count} deliveries</span><span className="num">Cash in hand {formatINR(earnings.data.cash_in_hand)}</span></Card>}
          </>
        )}
        {tab === "history" && (
          <div className="flex flex-col gap-2">
            {data.data?.history.map((d) => (
              <Card key={d.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1"><b>{d.order?.number}</b> · {d.distance_km} km<span className="block text-xs text-mute">{fmtTime(d.delivered_at)} · {d.proof ?? ""} {d.collected ? `· collected ${formatINR(d.collected)} ${d.collected_mode}` : ""}</span></span>
                <Chip tone={d.status === "delivered" ? "ok" : "hot"}>{label(d.status)}</Chip>
                <span className="num">{formatINR(d.charge)}</span>
              </Card>
            ))}
            {!data.data?.history.length && <Empty title="No deliveries yet" />}
          </div>
        )}
        {tab === "earnings" && earnings.data && (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Today's deliveries" value={earnings.data.today_count} />
            <Stat label="Today's charges" value={formatINR(earnings.data.today_charges)} />
            <Stat label="Cash in hand" value={formatINR(earnings.data.cash_in_hand)} sub={earnings.data.settled_today ? "Settled with cashier ✓" : "Settle with the cashier at day close"} />
            <Stat label="UPI collected" value={formatINR(earnings.data.upi_collected)} />
            <Stat label="This month" value={formatINR(earnings.data.month_charges)} className="col-span-2" sub={earnings.data.note} />
          </div>
        )}
        <PoweredBy />
      </main>
      <nav className="fixed inset-x-0 bottom-0 flex border-t-[1.5px] border-line bg-paper" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {([["active", `${t("Active")}${reqCount ? ` (${reqCount})` : ""}`], ["history", t("History")], ["earnings", t("Earnings")]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} className={cx("min-h-14 flex-1 cursor-pointer text-xs", tab === v ? "font-semibold text-brand" : "text-mute")}>{l}</button>
        ))}
      </nav>
      {delivering && <DeliverModal d={delivering} onClose={() => setDelivering(null)} />}
    </div>
  );
}

function DeliverModal({ d, onClose }: { d: DeliveryRow; onClose: () => void }) {
  const [proof, setProof] = useState<"otp" | "photo">("otp");
  const [otp, setOtp] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [mode, setMode] = useState<"cash" | "upi">("cash");
  const done = useM(() => deliveryApi.status(d.id, { status: "delivered", proof, otp, photo: photo ?? undefined, collected_mode: d.to_collect ? mode : undefined }), { success: "Delivered! 🎉", onSuccess: onClose });
  const failed = useM((reason: string) => deliveryApi.status(d.id, { status: "failed", reason }), { success: "Reported to the café", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Deliver ${d.order?.number}`} footer={<Button variant="primary" block loading={done.isPending} disabled={proof === "otp" ? otp.length !== 4 : !photo} onClick={() => done.mutate(undefined)}>Confirm delivery</Button>}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2"><Chip onClick={() => setProof("otp")} active={proof === "otp"}>Customer OTP</Chip><Chip onClick={() => setProof("photo")} active={proof === "photo"}>Photo proof</Chip></div>
        {proof === "otp" ? (
          <Field label="4-digit OTP from the customer"><Input inputMode="numeric" maxLength={4} className="num text-center text-2xl tracking-[0.5em]" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} /></Field>
        ) : (
          <Field label="Photo of handover">
            <input type="file" accept="image/*" capture="environment" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await compressImage(f, 120, 800)); }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo && <img src={photo} alt="Handover" className="mt-2 h-32 rounded-lg object-cover" />}
          </Field>
        )}
        {d.to_collect > 0 && (
          <div className="flex flex-col gap-2">
            <Label>Collect {formatINR(d.to_collect)}</Label>
            <div className="flex gap-2"><Chip onClick={() => setMode("cash")} active={mode === "cash"}>Cash</Chip><Chip onClick={() => setMode("upi")} active={mode === "upi"}>UPI</Chip></div>
          </div>
        )}
        <ErrorText error={done.error} />
        <Button variant="ghost" onClick={() => { const r = prompt("Why couldn't you deliver?"); if (r) failed.mutate(r); }}>Couldn&apos;t deliver?</Button>
      </div>
    </Modal>
  );
}
