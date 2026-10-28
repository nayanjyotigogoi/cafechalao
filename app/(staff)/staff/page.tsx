"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "@/modules/auth/api";
import { staffApi } from "@/modules/staff/api";
import { getTenantSlug } from "@/shared/api/client";
import { useM } from "@/shared/api/hooks";
import { signIn, useStaff } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { ROLE_HOME, ROLE_LABEL } from "@/shared/lib/permissions";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { StaffSession } from "@/shared/types/api";
import type { RoleKey } from "@/shared/types/entities";
import { OutletMark, PoweredBy } from "@/shared/ui/brand";
import { PinPad } from "@/shared/ui/pinpad";
import { Avatar, Button, Card, ErrorText, Field, Input, Segmented } from "@/shared/ui/primitives";

/** Shared-device staff login by employee ID + 4–6 digit PIN (SRS 2); each device remembers who signed in on it, plus attendance clock-in/out with selfie (M7.2). */
export default function StaffLoginPage() {
  return (
    <Suspense>
      <StaffLogin />
    </Suspense>
  );
}

/** Staff who signed in on this device, newest first, so they don't have to type their ID each time. Kept per café. */
type Known = { code: string; name: string; role: RoleKey; color: string };
const knownKey = () => `cc.staff.known.${getTenantSlug()}`;
function readKnown(): Known[] {
  try { return JSON.parse(localStorage.getItem(knownKey()) ?? "[]") as Known[]; } catch { return []; }
}
function writeKnown(list: Known[]) {
  try { localStorage.setItem(knownKey(), JSON.stringify(list.slice(0, 12))); } catch { /* private mode: just not remembered */ }
}

function StaffLogin() {
  useTitle("Staff login");
  const s = useSettings();
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const { session } = useStaff();
  const [tab, setTab] = useState<"login" | "clock">("login");
  const [known, setKnown] = useState<Known[]>([]);
  const [step, setStep] = useState<"pick" | "id" | "pin" | "setup">("pick");
  const [code, setCode] = useState("");
  const [who, setWho] = useState<Known | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const k = readKnown(); setKnown(k); if (!k.length) setStep("id"); }, []);

  const done = (r: StaffSession & { token: string }) => {
    const me: Known = { code: r.user.employee_code, name: r.user.name, role: r.user.role, color: r.user.avatar_color };
    writeKnown([me, ...readKnown().filter((k) => k.code !== me.code)]);
    signIn("staff", r.token);
    router.replace(next && !next.startsWith("/staff") ? next : ROLE_HOME[r.user.role]);
  };
  const reset = () => { setStep(readKnown().length ? "pick" : "id"); setWho(null); setCode(""); setErr(null); };
  const login = useM((pin: string) => authApi.pin(code, pin), {
    silentError: true,
    onSuccess: done,
    onError: (e) => (e.code === "pin_not_set" ? setStep("setup") : setErr(e.message)),
  });
  const submit = useCallback((pin: string) => { setErr(null); login.mutate(pin); }, [login]);
  const forget = (c: string) => { const k = readKnown().filter((x) => x.code !== c); writeKnown(k); setKnown(k); if (!k.length) setStep("id"); };

  useEffect(() => {
    if (session && !next) router.replace(ROLE_HOME[session.user.role]);
  }, [session, next, router]);

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-5 px-4 py-8">
        <div className="flex items-center gap-3">
          <OutletMark name={s.outlet.name} logo={s.brand.logo_url} size={44} />
          <h1 className="font-disp text-2xl font-extrabold">{s.outlet.name}</h1>
        </div>
        {params.get("locked") && <p className="text-sm text-warn">Locked after 15 minutes without use. Enter your PIN to continue.</p>}
        <Segmented value={tab} onChange={(v) => { setTab(v); reset(); }} options={[{ value: "login", label: t("Who's working?") }, { value: "clock", label: t("Clock in / out") }]} />

        {tab === "login" && step === "pick" && (
          <div className="flex w-full flex-col items-center gap-3">
            <p className="text-sm text-mute">Signed in on this device before</p>
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {known.map((u) => (
                <div key={u.code} className="relative">
                  <button onClick={() => { setWho(u); setCode(u.code); setStep("pin"); }} className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-[1.5px] border-line bg-paper p-4 hover:border-brand">
                    <Avatar name={u.name} color={u.color} size={52} />
                    <b className="text-sm leading-tight">{u.name}</b>
                    <span className="text-xs text-mute">{u.code} · {ROLE_LABEL[u.role]}</span>
                  </button>
                  <button onClick={() => forget(u.code)} aria-label={`Remove ${u.name} from this device`} title="Remove from this device" className="absolute right-1.5 top-1.5 grid size-7 cursor-pointer place-items-center rounded-full text-mute hover:bg-fill">×</button>
                </div>
              ))}
            </div>
            <Button size="lg" onClick={() => { setCode(""); setStep("id"); }}>Someone else? Sign in with employee ID</Button>
          </div>
        )}

        {tab === "login" && step === "id" && (
          <Card className="flex w-full max-w-sm flex-col gap-3">
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (code.trim()) { setErr(null); setWho(null); setStep("pin"); } }}>
              <Field label="Employee ID" hint="On your staff card, or ask the owner (e.g. E002).">
                <Input autoFocus autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="E001" className="text-center text-lg tracking-widest" />
              </Field>
              <Button type="submit" variant="primary" size="lg" disabled={!code.trim()}>Next</Button>
            </form>
            {known.length > 0 && <Button variant="ghost" onClick={reset}>Back</Button>}
          </Card>
        )}

        {tab === "login" && step === "pin" && (
          <Card className="flex w-full max-w-sm flex-col items-center gap-3">
            <b>{who ? who.name : `Employee ${code}`}</b>
            <PinPad onSubmit={submit} busy={login.isPending} error={err} label={t("Enter PIN")} />
            <Button variant="ghost" onClick={reset}>Not you?</Button>
          </Card>
        )}

        {tab === "login" && step === "setup" && <SetPin code={code} onDone={done} onBack={reset} />}

        {tab === "clock" && <Clock />}

        <a href="/rider" className="text-sm text-brand underline">Rider? Log in with your phone</a>
      </div>
      <PoweredBy />
    </div>
  );
}

/** First sign-in: confirm with the code sent to the employee's mobile, then choose a PIN only they know. */
function SetPin({ code, onDone, onBack }: { code: string; onDone: (r: StaffSession & { token: string }) => void; onBack: () => void }) {
  const [otp, setOtp] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const send = useM(() => authApi.pinCode(code), { silentError: true });
  const setup = useM(() => authApi.pinSetup(code, otp, pin), { silentError: true, onSuccess: onDone });
  const { mutate } = send;
  useEffect(() => { mutate(undefined); }, [mutate]);
  const valid = /^\d{4,6}$/.test(pin) && pin === pin2 && otp.length >= 4;
  return (
    <Card className="flex w-full max-w-sm flex-col gap-3">
      <h2 className="font-disp text-xl font-extrabold">Welcome! Set your PIN</h2>
      <p className="text-sm text-mute">
        {send.isPending ? "Sending a code to your mobile…" : send.data ? <>We sent a code to your mobile{send.data.phone_hint ? ` ${send.data.phone_hint}` : ""}. Enter it, then choose a 4–6 digit PIN you&apos;ll use to sign in.</> : null}
      </p>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) setup.mutate(undefined); }}>
        <Field label="Code from SMS" hint={send.data?.demo_otp ? `Demo code: ${send.data.demo_otp}` : undefined}><Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="New PIN (4–6 digits)"><Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Type the PIN again" error={pin2 && pin !== pin2 ? "PINs don't match" : undefined}><Input type="password" inputMode="numeric" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} /></Field>
        <ErrorText error={send.error ?? setup.error} />
        <Button type="submit" variant="primary" size="lg" disabled={!valid} loading={setup.isPending}>Save PIN and sign in</Button>
      </form>
      <Button variant="ghost" onClick={onBack}>Back</Button>
    </Card>
  );
}

/** Attendance: PIN clock-in/out on the outlet device with a selfie. */
function Clock() {
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<"off" | "on" | "denied">("off");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const clock = useM(({ pin, selfie }: { pin: string; selfie: string | null }) => staffApi.clock(pin, selfie), {
    silentError: true,
    onSuccess: (r) => { setErr(null); setMsg(`${r.name} clocked ${r.action} at ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`); },
    onError: (e) => { setMsg(null); setErr(e.message); },
  });
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 } })
      .then((st) => { stream = st; if (video.current) video.current.srcObject = st; setCam("on"); })
      .catch(() => setCam("denied"));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  const snap = () => {
    if (cam !== "on" || !video.current) return null;
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 120;
    c.getContext("2d")!.drawImage(video.current, 0, 0, 160, 120);
    return c.toDataURL("image/webp", 0.6);
  };
  const submit = useCallback((pin: string) => clock.mutate({ pin, selfie: snap() }), [clock]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card className="flex w-full max-w-sm flex-col items-center gap-3">
      <div className="grid h-40 w-full place-items-center overflow-hidden rounded-xl bg-fill">
        {cam === "denied" ? <span className="text-sm text-mute">Camera not available: clocking without a selfie</span> : <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" />}
      </div>
      {msg && <p className="text-sm font-semibold text-ok">{msg}</p>}
      <PinPad onSubmit={submit} busy={clock.isPending} error={err} label="Enter your PIN to clock in or out" />
    </Card>
  );
}
