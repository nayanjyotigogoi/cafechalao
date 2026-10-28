"use client";

import { useState } from "react";
import { authApi } from "@/modules/auth/api";
import { controlApi } from "@/modules/control/api";
import { setTenantSlug } from "@/shared/api/client";
import { useM, useQ } from "@/shared/api/hooks";
import { setAdmin, signIn, signOut, useAdmin } from "@/shared/auth/session";
import { BUSINESS_TYPE_LABEL, FEATURE_LABEL } from "@/shared/lib/features";
import { ago, fmtDate, label } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import type { BusinessType, FeatureKey, PlatformAdmin, SupportTicket, Tenant } from "@/shared/types/entities";
import { CafeChalaoLogo } from "@/shared/ui/brand";
import { DataTable } from "@/shared/ui/data";
import { FormModal, type Values } from "@/shared/ui/form";
import { useToast } from "@/shared/ui/overlay";
import { Button, Card, Chip, ErrorText, Field, Input, Label, Loading, Segmented, Stat, Toggle } from "@/shared/ui/primitives";

/**
 * CafeChalao Control Panel (L1, SRS 11): our own super-admin. Sees every café's licence, version, health and
 * flags, never its customers or sales, except through the time-limited support access the owner grants.
 */
export default function ControlPage() {
  const { token, admin } = useAdmin();
  if (!token || !admin) return <ControlLogin />;
  return <Control admin={admin} />;
}

function ControlLogin() {
  const [email, setEmail] = useState("admin@cafechalao.in");
  const [otp, setOtp] = useState("");
  const login = useM(() => authApi.control(email, otp), { onSuccess: (r) => { setAdmin(r.admin); signIn("control", r.token); } });
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6">
      <CafeChalaoLogo className="text-2xl" />
      <span className="rounded-full border-[1.5px] border-line px-3 py-1 text-xs">Control Panel</span>
      <Card className="flex w-full flex-col gap-3">
        <Field label="Work email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Code from email" hint="Demo code 123456"><Input inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value)} /></Field>
        <ErrorText error={login.error} />
        <Button variant="primary" loading={login.isPending} onClick={() => login.mutate(undefined)}>Sign in</Button>
      </Card>
    </div>
  );
}

type TenantRow = Tenant & { setup_step: number; features: Record<FeatureKey, boolean> | null; open_tickets: number };
type Tab = "overview" | "cafes" | "flags" | "support" | "releases" | "admins";

function Control({ admin }: { admin: PlatformAdmin }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [q, setQ] = useState("");
  const [onboard, setOnboard] = useState<Values | null>(null);
  const toast = useToast();
  const create = useM((v: Values) => controlApi.onboard(v), { onSuccess: (r) => { setOnboard(null); toast(`Café created · the owner signs in with employee ID ${r.owner_code} and sets their own PIN`); } });
  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center gap-3 border-b-[1.5px] border-line bg-paper px-4 py-2.5">
        <CafeChalaoLogo className="text-sm" />
        <Chip>Control Panel</Chip>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input className="w-56" placeholder="Search café, owner, phone…" value={q} onChange={(e) => { setQ(e.target.value); setTab("cafes"); }} />
          <Button variant="primary" onClick={() => setOnboard({ business_type: "cafe", hosting: "shared" })}>+ Onboard café</Button>
          <span className="text-sm text-mute">{admin.name} · {label(admin.role)}</span>
          <Button size="sm" variant="ghost" onClick={() => { signOut("control"); setAdmin(null); }}>Log out</Button>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
        <Segmented value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "cafes", label: "Cafés" }, { value: "flags", label: "Feature flags" }, { value: "support", label: "Support" }, { value: "releases", label: "Releases & health" }, { value: "admins", label: "Admins & roles" }]} />
        {tab === "overview" && <Overview />}
        {tab === "cafes" && <Cafes q={q} />}
        {tab === "flags" && <Flags />}
        {tab === "support" && <Tickets />}
        {tab === "releases" && <Releases />}
        {tab === "admins" && <Admins />}
      </div>
      <FormModal open={!!onboard} title="Onboard a café" initial={onboard} onClose={() => setOnboard(null)} onSave={(v) => create.mutate(v)} saving={create.isPending} error={create.error}
        fields={[
          { name: "name", label: "Café name", type: "text", required: true },
          { name: "slug", label: "Web address (slug)", type: "text", required: true, hint: "e.g. brew-bros → brew-bros.cafechalao.in" },
          { name: "owner_name", label: "Owner name", type: "text", required: true },
          { name: "owner_phone", label: "Owner phone", type: "tel", required: true },
          { name: "owner_email", label: "Owner email", type: "email", required: true },
          { name: "city", label: "City", type: "text", required: true },
          { name: "business_type", label: "Business type", type: "select", options: (Object.keys(BUSINESS_TYPE_LABEL) as BusinessType[]).map((b) => ({ value: b, label: BUSINESS_TYPE_LABEL[b] })), required: true },
          { name: "domain", label: "Own domain (optional)", type: "text", hint: "order.mycafe.in, pointed to our server; SSL is automatic" },
          { name: "hosting", label: "Hosting", type: "select", options: [{ value: "shared", label: "Shared (default)" }, { value: "dedicated", label: "Dedicated (paid extra)" }] },
        ]} />
    </div>
  );
}

function Overview() {
  const o = useQ<{ cafes: number; active: number; trial: number; suspended: number; new_this_month: number; orders_today: number; uptime: number; open_tickets: number; versions: { version: string; count: number }[]; latest_version: string }>("/control/overview", { auth: "control", live: true });
  if (!o.data) return <Loading />;
  const d = o.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active cafés" value={d.active} sub={`+${d.new_this_month} this month · ${d.trial} trial · ${d.suspended} suspended`} />
        <Stat label="Orders today (all cafés)" value={d.orders_today.toLocaleString("en-IN")} />
        <Stat label="API uptime" value={`${d.uptime}%`} />
        <Stat label="Open tickets" value={d.open_tickets} tone={d.open_tickets ? "warn" : undefined} />
      </div>
      <Card className="flex flex-wrap gap-3 text-sm"><Label>Versions running</Label>{d.versions.map((v) => <Chip key={v.version} tone={v.version === d.latest_version ? "ok" : "warn"}>{v.version} · {v.count} café{v.count > 1 ? "s" : ""}</Chip>)}</Card>
      <p className="text-xs text-mute">The Control Panel never shows a café&apos;s customers or sales. Order counts are platform totals for capacity planning.</p>
    </div>
  );
}

function Cafes({ q }: { q: string }) {
  const rows = useQ<TenantRow[]>("/control/tenants", { auth: "control", live: true });
  const [sel, setSel] = useState<TenantRow | null>(null);
  const list = (rows.data ?? []).filter((t) => !q || `${t.name} ${t.owner_name} ${t.owner_phone} ${t.city}`.toLowerCase().includes(q.toLowerCase()));
  const selected = rows.data?.find((t) => t.id === sel?.id) ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <DataTable rows={list} rowKey={(r) => r.id} onRowClick={setSel} exportName="cafes"
        columns={[
          { key: "name", header: "Café", cell: (r) => <b>{r.name}</b> },
          { key: "city", header: "City" },
          { key: "business_type", header: "Type", value: (r) => BUSINESS_TYPE_LABEL[r.business_type] },
          { key: "domains", header: "Domain", value: (r) => r.domains[1] ?? r.domains[0], hideSm: true },
          { key: "version", header: "Version", hideSm: true },
          { key: "setup_step", header: "Setup", value: (r) => (r.setup_step >= 10 ? "Live" : `${r.setup_step}/10`) },
          { key: "status", header: "Status", cell: (r) => <Chip tone={r.status === "active" ? "ok" : r.status === "trial" ? "warn" : "hot"}>{r.status === "trial" ? `Trial · ${Math.max(0, Math.ceil((new Date(r.support_expiry).getTime() - Date.now()) / 86400000))} days` : label(r.status)}</Chip> },
        ]} />
      {selected ? <CafePanel t={selected} /> : <Card className="text-sm text-mute">Pick a café to manage its licence, support, flags and access.</Card>}
    </div>
  );
}

function CafePanel({ t }: { t: TenantRow }) {
  const toast = useToast();
  const upd = useM((b: object) => controlApi.updateTenant(t.id, b), { success: "Updated" });
  const support = useM(() => controlApi.supportLogin(t.id), {
    onSuccess: (r) => {
      setTenantSlug(r.slug);
      localStorage.setItem(`cc.token.${r.slug}.staff`, r.token);
      toast("Support session opened in a new tab. This access is in the café's audit log.", "info");
      window.open(`/admin?outlet=${r.slug}`, "_blank");
    },
  });
  const supportOk = t.support_access_until && t.support_access_until > new Date().toISOString();
  return (
    <Card className="flex flex-col gap-2">
      <b className="font-disp text-lg">{t.name}</b>
      <div className="text-xs text-mute">Owner · {t.owner_name} · {t.owner_phone}<br />{t.owner_email}<br />Licence {t.licence_key}<br />Support till {fmtDate(t.support_expiry)} · backup {ago(t.last_backup_at)} · uptime {t.uptime_pct}%<br />{t.hosting} hosting · {t.domains.join(", ")}</div>
      <Button onClick={() => support.mutate(undefined)} loading={support.isPending} disabled={!supportOk}>Log in as café (support)</Button>
      <span className="text-[11px] text-mute">{supportOk ? `Owner allowed access until ${fmtDate(t.support_access_until)}` : "Owner hasn't granted support access"}</span>
      <ErrorText error={support.error} />
      <Button onClick={() => upd.mutate({ support_expiry: new Date(new Date(t.support_expiry).getTime() + 30 * 86400000).toISOString() })}>{t.status === "trial" ? "Extend trial 30 days" : "Extend support 30 days"}</Button>
      {t.status === "trial" && <Button onClick={() => upd.mutate({ status: "active" })}>Mark licence paid · active</Button>}
      {t.status !== "suspended" ? <Button variant="danger" onClick={() => upd.mutate({ status: "suspended" })}>Suspend (read-only)</Button> : <Button variant="primary" onClick={() => upd.mutate({ status: "active" })}>Reactivate</Button>}
      <Label>Branding lock</Label>
      <span className="text-xs">“Powered by CafeChalao” · locked on footer, login and bills</span>
    </Card>
  );
}

function Flags() {
  const rows = useQ<TenantRow[]>("/control/tenants", { auth: "control" });
  const upd = useM(({ id, f }: { id: string; f: Partial<Record<FeatureKey, boolean>> }) => controlApi.updateTenant(id, { features: f }));
  const keys = Object.keys(FEATURE_LABEL) as FeatureKey[];
  if (!rows.data) return <Loading />;
  return (
    <div className="overflow-x-auto rounded-2xl border-[1.5px] border-line bg-paper">
      <table className="text-sm">
        <thead><tr className="border-b border-line"><th className="sticky left-0 bg-paper p-2 text-left">Feature</th>{rows.data.map((t) => <th key={t.id} className="p-2 text-xs">{t.name}</th>)}</tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-b border-line/60">
              <td className="sticky left-0 bg-paper p-2">{FEATURE_LABEL[k]}</td>
              {rows.data!.map((t) => <td key={t.id} className="p-1 text-center"><Toggle checked={!!t.features?.[k]} onChange={(v) => upd.mutate({ id: t.id, f: { [k]: v } })} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-3 text-xs text-mute">Paid custom features are built into the main code behind a flag and switched on here for one café, so every café still runs the same version.</p>
    </div>
  );
}

function Tickets() {
  const rows = useQ<(SupportTicket & { cafe: string })[]>("/control/tickets", { auth: "control" });
  const cafes = useQ<TenantRow[]>("/control/tenants", { auth: "control" });
  const [e, setE] = useState<Values | null>(null);
  const create = useM((v: Values) => controlApi.ticket(v), { success: "Ticket created", onSuccess: () => setE(null) });
  const upd = useM(({ id, b }: { id: string; b: object }) => controlApi.updateTicket(id, b));
  return (
    <>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} toolbar={<Button size="sm" variant="primary" onClick={() => setE({ kind: "support" })}>+ Ticket</Button>}
        columns={[
          { key: "created_at", header: "Opened", value: (r) => ago(r.created_at) },
          { key: "cafe", header: "Café" },
          { key: "subject", header: "Subject", cell: (r) => <b>{r.subject}</b> },
          { key: "kind", header: "Kind", value: (r) => label(r.kind) },
          { key: "quote", header: "Quote", value: (r) => (r.quote ? formatINR(r.quote) : "—") },
          { key: "billing_status", header: "Billing", cell: (r) => <select className="rounded border border-line bg-paper px-1 text-xs" value={r.billing_status} onChange={(ev) => upd.mutate({ id: r.id, b: { billing_status: ev.target.value } })}>{["none", "quoted", "approved", "invoiced", "paid"].map((x) => <option key={x}>{x}</option>)}</select> },
          { key: "status", header: "Status", cell: (r) => <select className="rounded border border-line bg-paper px-1 text-xs" value={r.status} onChange={(ev) => upd.mutate({ id: r.id, b: { status: ev.target.value } })}>{["open", "in_progress", "closed"].map((x) => <option key={x}>{x}</option>)}</select> },
        ]} />
      <FormModal open={!!e} title="New ticket" initial={e} onClose={() => setE(null)} onSave={(v) => create.mutate(v)} saving={create.isPending}
        fields={[{ name: "tenant_id", label: "Café", type: "select", options: (cafes.data ?? []).map((t) => ({ value: t.id, label: t.name })), required: true }, { name: "subject", label: "Subject", type: "text", required: true }, { name: "kind", label: "Kind", type: "select", options: [{ value: "support", label: "Support" }, { value: "change_request", label: "Change request (billed)" }], required: true }, { name: "quote", label: "Quote", type: "money" }]} />
    </>
  );
}

function Releases() {
  const rows = useQ<TenantRow[]>("/control/tenants", { auth: "control" });
  const [version, setVersion] = useState("1.4.3");
  const [pilot, setPilot] = useState<string[]>([]);
  const release = useM((target: "all" | "pilot") => controlApi.release({ version, target, tenant_ids: pilot }), { success: (r) => `Updated ${r.updated} café(s) · backup taken first` });
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card className="flex flex-col gap-3">
        <Label>Ship a release</Label>
        <Field label="Version (semantic)"><Input value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
        <p className="text-xs text-mute">Order: demo outlet → pilot group → everyone. A backup is taken before every update; roll back by releasing the previous version.</p>
        <div className="flex flex-col gap-1">{rows.data?.map((t) => <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pilot.includes(t.id)} onChange={() => setPilot((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))} className="accent-[var(--brand)]" />{t.name} <span className="text-mute">({t.version})</span></label>)}</div>
        <div className="flex gap-2"><Button disabled={!pilot.length} onClick={() => release.mutate("pilot")}>Release to pilot</Button><Button variant="primary" onClick={() => release.mutate("all")}>Release to all</Button></div>
      </Card>
      <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} columns={[{ key: "name", header: "Café" }, { key: "version", header: "Version" }, { key: "last_backup_at", header: "Last backup", value: (r) => ago(r.last_backup_at) }, { key: "uptime_pct", header: "Uptime", value: (r) => `${r.uptime_pct}%` }, { key: "hosting", header: "Hosting" }]} />
    </div>
  );
}

function Admins() {
  const rows = useQ<PlatformAdmin[]>("/control/admins", { auth: "control" });
  return <DataTable rows={rows.data ?? []} rowKey={(r) => r.id} columns={[{ key: "name", header: "Name" }, { key: "email", header: "Email" }, { key: "role", header: "Role", value: (r) => label(r.role) }]} />;
}

