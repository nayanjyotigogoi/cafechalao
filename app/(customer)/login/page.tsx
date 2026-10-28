"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { authApi } from "@/modules/auth/api";
import { customersApi } from "@/modules/customers/api";
import { API_MODE } from "@/shared/api/client";
import { useM, useQ } from "@/shared/api/hooks";
import { GoogleButton } from "@/modules/auth/components/GoogleButton";
import { signIn, useCustomer } from "@/shared/auth/session";
import { useT } from "@/shared/i18n";
import { useCart } from "@/modules/orders/cart";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import { OutletMark } from "@/shared/ui/brand";
import { Button, Card, ErrorText, Field, Input, Label, Toggle } from "@/shared/ui/primitives";

/**
 * Customer sign-in (M1.1): Google first, phone OTP as fallback. First login completes the profile:
 * mobile (OTP verified), birthday, optional anniversary and gender, and consent for WhatsApp/SMS messages.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  useTitle("Sign in");
  const s = useSettings();
  const { t } = useT();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const { customer, needsProfile } = useCustomer();
  const c = useCart();
  const [mode, setMode] = useState<"choose" | "google" | "phone">("choose");
  const [g, setG] = useState({ name: "", email: "" });
  const [email, setEmail] = useState("");
  const cfg = useQ<{ google_client_id: string | null; demo: boolean }>("/auth/config");
  const emailLogin = useM(() => authApi.email(email), { onSuccess: (r) => { signIn("customer", r.token); if (!r.needs_profile) router.replace(next); } });
  const onGoogle = (r: { token: string; needs_profile: boolean }) => { signIn("customer", r.token); if (!r.needs_profile) router.replace(next); };
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const google = useM((b: { name: string; email: string; google_id?: string }) => authApi.google(b), { onSuccess: (r) => { signIn("customer", r.token); if (!r.needs_profile) router.replace(next); } });
  const sendOtp = useM((p: string) => authApi.sendOtp(p), { onSuccess: (r) => setSent(r.demo_otp ?? "") });
  const phoneLogin = useM(() => authApi.phoneLogin(phone, otp), { onSuccess: (r) => { signIn("customer", r.token); if (!r.needs_profile) router.replace(next); } });

  useEffect(() => {
    if (customer && !needsProfile) router.replace(next);
  }, [customer, needsProfile, next, router]);

  if (customer && needsProfile) return <CompleteProfile onDone={() => router.replace(next)} />;
  if (customer) return null;

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 py-8 text-center">
      <OutletMark name={s.outlet.name} logo={s.brand.logo_url} size={72} />
      <h1 className="font-disp text-3xl font-extrabold">{s.outlet.name}</h1>
      <p className="text-sm text-mute">Order from your table or get it delivered.</p>

      {mode === "choose" && (
        <div className="flex w-full flex-col gap-2">
          {/* Email login: enter your email and you're in; the account is created the first time. */}
          <form className="flex flex-col gap-2 text-left" onSubmit={(e) => { e.preventDefault(); emailLogin.mutate(undefined); }}>
            <Field label="Your email"><Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Button type="submit" variant="primary" size="lg" block loading={emailLogin.isPending} disabled={!email.includes("@")}>Continue with email</Button>
            <ErrorText error={emailLogin.error} />
          </form>
          <div className="my-1 text-xs text-mute">or</div>
          {cfg.data?.google_client_id ? (
            <GoogleButton clientId={cfg.data.google_client_id} onSignedIn={onGoogle} />
          ) : (API_MODE === "mock" || cfg.data?.demo) && (
            <>
              <Button block size="lg" loading={google.isPending} onClick={() => google.mutate({ name: "Priya Sharma", email: "priya.demo@gmail.com", google_id: "g_demo_priya" })}>
                <span className="font-bold text-[#4285F4]">G</span> {t("Continue with Google")} (demo: Priya)
              </Button>
              <Button block variant="ghost" onClick={() => setMode("google")}>Use another Google account (demo)</Button>
            </>
          )}
          <Button block size="lg" onClick={() => setMode("phone")}>{t("Continue with phone (OTP)")}</Button>
          {c.table_name && <p className="text-xs text-mute">Scanned at Table {c.table_name} · Dine-in</p>}
        </div>
      )}

      {mode === "google" && (
        <Card className="flex w-full flex-col gap-3 text-left">
          <Label>Demo Google account</Label>
          <Field label="Name"><Input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></Field>
          <Field label="Gmail"><Input type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} placeholder="you@gmail.com" /></Field>
          <Button variant="primary" loading={google.isPending} disabled={!g.name || !g.email.includes("@")} onClick={() => google.mutate(g)}>Continue</Button>
          <Button variant="ghost" onClick={() => setMode("choose")}>Back</Button>
        </Card>
      )}

      {mode === "phone" && (
        <Card className="flex w-full flex-col gap-3 text-left">
          <Field label="Mobile number"><Input inputMode="tel" placeholder="98xxx xxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          {sent === null ? (
            <Button variant="primary" loading={sendOtp.isPending} onClick={() => sendOtp.mutate(phone)}>Send OTP</Button>
          ) : (
            <>
              <Field label="OTP" hint={sent ? `Demo OTP: ${sent}` : undefined}><Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} /></Field>
              <Button variant="primary" loading={phoneLogin.isPending} onClick={() => phoneLogin.mutate(undefined)}>Verify and continue</Button>
            </>
          )}
          <ErrorText error={sendOtp.error ?? phoneLogin.error} />
          <Button variant="ghost" onClick={() => { setMode("choose"); setSent(null); }}>Back</Button>
        </Card>
      )}
      <p className="text-[11px] text-mute">By continuing you agree to {s.outlet.name}&apos;s terms. Your data stays with {s.outlet.name} and is used only as you allow (DPDP Act 2023).</p>
    </div>
  );
}

function CompleteProfile({ onDone }: { onDone: () => void }) {
  const { customer } = useCustomer();
  const s = useSettings();
  const [f, setF] = useState({ name: customer?.name ?? "", phone: customer?.phone ?? "", birthday: customer?.birthday ?? "", anniversary: customer?.anniversary ?? "", gender: customer?.gender ?? "", marketing_consent: customer?.marketing_consent ?? false });
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const verified = customer?.phone_verified;
  const send = useM(() => authApi.sendOtp(f.phone), { onSuccess: (r) => setSent(r.demo_otp ?? "") });
  const details = () => customersApi.updateMe({ name: f.name, birthday: f.birthday || null, anniversary: f.anniversary || null, gender: (f.gender || null) as never, marketing_consent: f.marketing_consent });
  // A verified mobile completes the profile and this form closes, so save the details in the same step.
  const verify = useM(async () => {
    const r = await authApi.verifyOtp(f.phone, otp);
    if (r.token) signIn("customer", r.token);
    if (f.name.trim()) await details();
    return r;
  }, {
    success: (r) => (r.claimed ? "We found your earlier visits and linked them to your account" : "Mobile verified"),
  });
  const save = useM(details, {
    onSuccess: (r) => !r.needs_profile && onDone(),
  });
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-6">
      <h1 className="font-disp text-2xl font-extrabold">Welcome! A few details</h1>
      <p className="text-sm text-mute">{s.outlet.name} uses these for your orders, loyalty points and birthday treats.</p>
      <Card className="flex flex-col gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mobile (verified by OTP)">
          <div className="flex gap-2">
            <Input inputMode="tel" value={f.phone} disabled={!!verified} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98xxx xxxxx" />
            {!verified && <Button onClick={() => send.mutate(undefined)} loading={send.isPending}>Send OTP</Button>}
            {verified && <span className="self-center text-sm text-ok">✓</span>}
          </div>
        </Field>
        {!verified && sent !== null && (
          <div className="flex gap-2">
            <Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} placeholder={sent ? `Demo OTP ${sent}` : "OTP"} aria-label="OTP" />
            <Button variant="primary" onClick={() => verify.mutate(undefined)} loading={verify.isPending}>Verify</Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Birthday (optional)"><Input type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
          <Field label="Anniversary (optional)"><Input type="date" value={f.anniversary} onChange={(e) => setF({ ...f, anniversary: e.target.value })} /></Field>
        </div>
        <Field label="Gender (optional)">
          <div className="flex gap-2">
            {[["female", "Female"], ["male", "Male"], ["other", "Other"]].map(([v, l]) => (
              <Button key={v} size="sm" variant={f.gender === v ? "primary" : "outline"} onClick={() => setF({ ...f, gender: f.gender === v ? "" : v })}>{l}</Button>
            ))}
          </div>
        </Field>
        <Toggle checked={f.marketing_consent} onChange={(v) => setF({ ...f, marketing_consent: v })} label={<span className="text-sm">Send me offers and birthday wishes on WhatsApp/SMS</span>} />
        <ErrorText error={send.error ?? verify.error ?? save.error} />
        <Button variant="primary" size="lg" disabled={!verified || !f.name} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save and continue</Button>
        {!verified && <p className="text-xs text-mute">Verify your mobile to continue. Delivery addresses can be added at checkout.</p>}
      </Card>
    </div>
  );
}
