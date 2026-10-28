"use client";

import { useState, type ChangeEvent } from "react";
import { outletApi, type Section } from "@/modules/outlet/api";
import { useM, useQ } from "@/shared/api/hooks";
import { cx, fmtDateTime, label, onColor } from "@/shared/lib/format";
import { BUSINESS_TYPE_LABEL, businessTypeDefaults, FEATURE_LABEL } from "@/shared/lib/features";
import { compressImage } from "@/shared/lib/image";
import { formatINR } from "@/shared/lib/money";
import { PERMISSIONS, ROLE_LABEL } from "@/shared/lib/permissions";
import { useSettings } from "@/shared/tenant/TenantProvider";
import type { ApprovalLimit, BusinessType, Device, FeatureKey, Printer, Role } from "@/shared/types/entities";
import { DataTable } from "@/shared/ui/data";
import { FormFields, FormModal, type Values } from "@/shared/ui/form";
import { OutletMark, PoweredBy } from "@/shared/ui/brand";
import { Button, Card, Chip, ErrorText, Field, Input, Label, MoneyInput, Toggle } from "@/shared/ui/primitives";

/** Settings sections (Core/Settings), shared by Settings and the setup wizard. Each saves one /settings/<section>. */

function useSection<T extends object>(section: Section, initial: T, transform: (v: Values) => Values = (v) => v) {
  const [v, setV] = useState<Values>(initial as Values);
  // Take back what the server stored (an uploaded image becomes its file URL), so the form isn't left "unsaved".
  const save = useM(() => outletApi.saveSection(section, transform(v)), {
    success: "Saved",
    onSuccess: (r) => setV((p) => Object.fromEntries(Object.keys(p).map((k) => [k, k in (r as Values) ? (r as Values)[k] : p[k]]))),
  });
  return { v, setV, save, dirty: JSON.stringify(v) !== JSON.stringify(initial) };
}

function SaveBar({ save, dirty, onSaved }: { save: ReturnType<typeof useSection>["save"]; dirty: boolean; onSaved?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onSaved })}>Save</Button>
      {onSaved && <Button variant="ghost" onClick={onSaved}>Skip for now</Button>}
      <ErrorText error={save.error} />
    </div>
  );
}

export function BusinessSection({ onSaved }: { onSaved?: () => void }) {
  const s = useSettings();
  const { v, setV, save, dirty } = useSection("outlet", s.outlet);
  return (
    <Card className="flex flex-col gap-4">
      <FormFields values={v} onChange={setV} fields={[
        { name: "name", label: "Outlet name (shown everywhere)", type: "text", required: true },
        { name: "legal_name", label: "Legal name (on bills)", type: "text" },
        { name: "business_type", label: "Business type", type: "select", options: (Object.keys(BUSINESS_TYPE_LABEL) as BusinessType[]).map((b) => ({ value: b, label: BUSINESS_TYPE_LABEL[b] })) },
        { name: "tagline", label: "Tagline", type: "text" },
        { name: "address", label: "Address", type: "textarea" },
        { name: "city", label: "City", type: "text" },
        { name: "phone", label: "Phone", type: "tel" },
        { name: "email", label: "Email", type: "email" },
        { name: "opening_time", label: "Opens at", type: "time" },
        { name: "closing_time", label: "Closes at", type: "time" },
      ]} />
      {v.business_type !== s.outlet.business_type && (
        <Toggle checked={!!v.apply_defaults} onChange={(x) => setV({ ...v, apply_defaults: x })} label={`Also switch features to the ${BUSINESS_TYPE_LABEL[v.business_type as BusinessType]} defaults`} />
      )}
      <SaveBar save={save} dirty={dirty} onSaved={onSaved} />
    </Card>
  );
}

const PRESETS = ["#5E6B33", "#C2566E", "#0F3C65", "#2B1E16", "#8C2F1B", "#2B6F77", "#6B4E9B"];

export function BrandSection({ onSaved }: { onSaved?: () => void }) {
  const s = useSettings();
  const { v, setV, save, dirty } = useSection("brand", s.brand);
  const primary = (v.primary_color as string) ?? "#5E6B33";
  const accent = (v.accent_color as string) ?? "#F9D1D9";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <OutletMark name={s.outlet.name} logo={v.logo_url as string | null} size={64} />
          <div className="flex flex-col gap-1">
            <Label>Logo</Label>
            <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setV({ ...v, logo_url: await compressImage(f, 80, 512) }); }} />
            {!!v.logo_url && <Button size="sm" variant="ghost" onClick={() => setV({ ...v, logo_url: null })}>Remove logo</Button>}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Brand colour · pick a preset or your own</Label>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((c) => <button key={c} onClick={() => setV({ ...v, primary_color: c })} aria-label={`Use ${c}`} className={cx("size-9 cursor-pointer rounded-full", primary.toLowerCase() === c.toLowerCase() && "ring-[3px] ring-ink ring-offset-2")} style={{ background: c }} />)}
            <input type="color" value={primary} onChange={(e) => setV({ ...v, primary_color: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-line" aria-label="Custom brand colour" />
          </div>
        </div>
        <FormFields values={v} onChange={setV} fields={[
          { name: "accent_color", label: "Accent colour (tints and hero)", type: "color" },
          { name: "app_name", label: "App name (home screen)", type: "text" },
          { name: "short_name", label: "Short name (under the icon)", type: "text" },
          { name: "hero_title", label: "Menu headline", type: "text" },
          { name: "hero_subtitle", label: "Menu sub-headline", type: "text" },
        ]} />
        <p className="text-xs text-mute">Your name, logo and colours fill the app header, login, bills, KOTs, messages and the installable app. The small “Powered by CafeChalao” line stays and can’t be removed.</p>
        <SaveBar save={save} dirty={dirty} onSaved={onSaved} />
      </Card>
      <div className="flex flex-col items-center gap-2">
        <Label>Live preview</Label>
        <div className="w-56 overflow-hidden rounded-3xl border-2 border-ink" style={{ ["--primary" as string]: primary, ["--accent" as string]: accent, ["--on-primary" as string]: onColor(primary) }}>
          <div className="flex items-center gap-2 border-b border-line bg-paper p-2"><OutletMark name={s.outlet.name} logo={v.logo_url as string | null} size={24} /><b className="font-disp text-sm">{v.app_name as string}</b></div>
          <div className="flex flex-col gap-2 bg-paper p-3">
            <div className="rounded-xl p-2" style={{ background: accent }}><b className="font-disp text-sm">{(v.hero_title as string) || "What's brewing?"}</b></div>
            <div className="img-ph h-14 rounded" /><div className="h-2 rounded bg-fill" /><div className="h-2 w-3/5 rounded bg-fill" />
            <span className="rounded-lg py-2 text-center text-xs font-semibold" style={{ background: primary, color: onColor(primary) }}>Order now</span>
          </div>
          <PoweredBy className="scale-90 bg-paper" />
        </div>
      </div>
    </div>
  );
}

export function TaxSection({ onSaved }: { onSaved?: () => void }) {
  const s = useSettings();
  const { v, setV, save, dirty } = useSection("tax", { ...s.tax, default_gst_rate: String(s.tax.default_gst_rate) }, (x) => ({ ...x, default_gst_rate: Number(x.default_gst_rate), service_charge_pct: Number(x.service_charge_pct) }));
  return (
    <Card className="flex flex-col gap-4">
      <FormFields values={v} onChange={setV} fields={[
        { name: "gst_scheme", label: "GST scheme", type: "select", options: [{ value: "regular", label: "Regular (tax invoice with CGST/SGST)" }, { value: "composition", label: "Composition (Bill of Supply, no GST charged)" }] },
        { name: "gstin", label: "GSTIN", type: "text" },
        { name: "default_gst_rate", label: "Default GST rate %", type: "select", options: [{ value: "5", label: "5% (standalone restaurant, no ITC)" }, { value: "18", label: "18% (in hotel > ₹7,500 room tariff, or with ITC)" }] },
        { name: "fssai_number", label: "FSSAI licence / registration no.", type: "text", required: true },
        { name: "invoice_prefix", label: "Invoice prefix", type: "text", hint: "Numbers run in sequence per financial year, e.g. CA/26-27/000123" },
        { name: "hsn_sac", label: "SAC code", type: "text", hint: "9963 for restaurant service" },
        { name: "place_of_supply", label: "Place of supply (state)", type: "text" },
        { name: "round_off", label: "Round off bills to the rupee", type: "toggle" },
        { name: "service_charge_enabled", label: "Optional service charge (off by default; shown separately; removable on request)", type: "toggle" },
        { name: "service_charge_pct", label: "Service charge %", type: "number" },
      ]} />
      <p className="text-xs text-mute">Rates and rules are our working understanding and must be confirmed by your CA (SRS section 6).</p>
      <SaveBar save={save} dirty={dirty} onSaved={onSaved} />
    </Card>
  );
}

export function FeaturesSection() {
  const s = useSettings();
  const { v, setV, save, dirty } = useSection("flags", s.flags);
  const features = v.features as Record<FeatureKey, boolean>;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label>Reset to business type defaults</Label>
        {(Object.keys(BUSINESS_TYPE_LABEL) as BusinessType[]).map((b) => <Chip key={b} onClick={() => setV({ ...v, features: businessTypeDefaults(b) })} active={s.outlet.business_type === b}>{BUSINESS_TYPE_LABEL[b]}</Chip>)}
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {(Object.keys(FEATURE_LABEL) as FeatureKey[]).map((k) => <Toggle key={k} checked={features[k]} onChange={(x) => setV({ ...v, features: { ...features, [k]: x } })} label={FEATURE_LABEL[k]} />)}
      </div>
      <FormFields values={v} onChange={setV} fields={[
        { name: "qr_order_flow", label: "Table QR orders", type: "select", options: [{ value: "captain_confirms", label: "Go to the captain to confirm first" }, { value: "direct_to_kitchen", label: "Go straight to the kitchen" }] },
        { name: "auto_accept_online", label: "Auto-accept online orders", type: "toggle" },
        { name: "kds_amber_min", label: "Kitchen ticket turns amber after (min)", type: "number" },
        { name: "kds_red_min", label: "…and red after (min)", type: "number" },
        { name: "language", label: "Default language", type: "select", options: [{ value: "en", label: "English" }, { value: "hi", label: "हिन्दी" }] },
      ]} />
      <SaveBar save={save} dirty={dirty} />
    </Card>
  );
}

export function PaymentSection({ onSaved }: { onSaved?: () => void }) {
  const s = useSettings();
  const { v, setV, save, dirty } = useSection("payment", s.payment);
  const modes = v.modes as Record<string, boolean>;
  const qrChanged = (v.upi_qr_url ?? null) !== (s.payment.upi_qr_url ?? null);
  const pickQr = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) setV({ ...v, upi_qr_url: await compressImage(f, 300, 900) });
  };
  return (
    <Card className="flex flex-col gap-4">
      <Label>Payment modes allowed</Label>
      <div className="grid gap-1 sm:grid-cols-3">
        {[["cash", "Cash"], ["upi", "UPI QR at counter"], ["card", "Card (external machine)"], ["online", "Online (UPI/card via gateway)"], ["cod", "Cash on delivery"], ["upi_on_delivery", "UPI on delivery"]].map(([k, l]) => <Toggle key={k} checked={modes[k]} onChange={(x) => setV({ ...v, modes: { ...modes, [k]: x } })} label={l} />)}
      </div>
      <Label>Your UPI QR (customers scan it to pay the bill amount)</Label>
      <div className="flex flex-wrap items-start gap-4">
        <label className="cursor-pointer" title="Choose a QR image">
          {(v.upi_qr_url as string | null) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.upi_qr_url as string} alt="UPI QR" className="size-36 rounded-xl border-[1.5px] border-line bg-white object-contain p-1" />
          ) : (
            <div className="grid size-36 place-items-center rounded-xl border-[1.5px] border-dashed border-line p-2 text-center text-xs text-mute hover:border-brand">
              <span><span className="block text-3xl">＋</span>Tap to add your QR</span>
            </div>
          )}
          <input type="file" accept="image/*" className="sr-only" onChange={pickQr} />
        </label>
        <div className="flex min-w-48 flex-1 flex-col items-start gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-[1.5px] border-line bg-paper px-4 font-semibold hover:border-brand">
            📷 {v.upi_qr_url ? "Change QR image" : "Upload QR image"}
            <input type="file" accept="image/*" className="sr-only" onChange={pickQr} />
          </label>
          {!!v.upi_qr_url && <Button size="sm" variant="ghost" onClick={() => setV({ ...v, upi_qr_url: null })}>Remove QR</Button>}
          {qrChanged ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn/15 px-3 py-2 text-sm text-warn">
              {v.upi_qr_url ? "New QR not saved yet. Customers still see the old one." : "QR removed. Save to stop showing it."}
              <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save now</Button>
            </div>
          ) : v.upi_qr_url ? (
            <span className="text-sm text-ok">✓ Customers see this QR when they pay.</span>
          ) : null}
          <span className="text-xs text-mute">A photo or screenshot of the QR from your bank or UPI app (GPay, PhonePe, Paytm for Business). PNG or JPG.</span>
        </div>
      </div>
      <FormFields values={v} onChange={setV} fields={[
        { name: "upi_id", label: "UPI ID (shown under the QR; used if no QR image)", type: "text" },
      ]} />
      <details className="rounded-xl border-[1.5px] border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold">Payment gateway (optional, for later)</summary>
        <div className="mt-3">
          <FormFields values={v} onChange={setV} fields={[
            { name: "gateway", label: "Gateway", type: "select", options: [{ value: "upi_qr", label: "None (own UPI QR)" }, { value: "razorpay", label: "Razorpay" }, { value: "cashfree", label: "Cashfree" }, { value: "phonepe", label: "PhonePe" }] },
            { name: "gateway_key_id", label: "Key ID / App ID", type: "text" },
            { name: "gateway_secret", label: "Key secret (stored on the server, never shown again)", type: "text" },
          ]} />
          <p className="mt-2 text-xs text-mute">Keys are saved for when gateway checkout is switched on. Until then customers pay with your UPI QR.</p>
        </div>
      </details>
      <p className="text-xs text-mute">Customer payments go straight to your bank. CafeChalao never holds your money. {s.payment.gateway_configured ? "✓ Gateway keys saved." : ""}</p>
      <SaveBar save={save} dirty={dirty} onSaved={onSaved} />
    </Card>
  );
}

export function DeliverySection({ onSaved }: { onSaved?: () => void }) {
  const s = useSettings();
  const { v, setV, save, dirty } = useSection("delivery", s.delivery);
  const slabs = (v.slabs as { upto_amount: number; charge: number }[]) ?? [];
  return (
    <Card className="flex flex-col gap-4">
      <FormFields values={v} onChange={setV} fields={[
        { name: "enabled", label: "Take delivery orders", type: "toggle" },
        { name: "mode", label: "Riders", type: "select", options: [{ value: "own", label: "Own staff" }, { value: "freelance", label: "Freelance riders" }, { value: "both", label: "Both (own staff first, freelancers when busy)" }] },
        { name: "charge_type", label: "Delivery charge", type: "select", options: [{ value: "flat", label: "Flat" }, { value: "slab", label: "By order value (slabs)" }] },
        { name: "flat_charge", label: "Flat charge", type: "money" },
        { name: "min_order", label: "Minimum order", type: "money" },
        { name: "allow_prepaid", label: "Allow prepaid", type: "toggle" },
        { name: "allow_cod", label: "Allow cash on delivery", type: "toggle" },
        { name: "allow_upi_on_delivery", label: "Allow UPI on delivery", type: "toggle" },
      ]} />
      {v.charge_type === "slab" && (
        <div className="flex flex-col gap-2">
          <Label>Slabs (distance zones are Phase 3)</Label>
          {slabs.map((sl, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">Up to <div className="w-32"><MoneyInput value={sl.upto_amount} onChange={(x) => setV({ ...v, slabs: slabs.map((y, j) => (j === i ? { ...y, upto_amount: x } : y)) })} /></div> charge <div className="w-28"><MoneyInput value={sl.charge} onChange={(x) => setV({ ...v, slabs: slabs.map((y, j) => (j === i ? { ...y, charge: x } : y)) })} /></div><Button size="sm" variant="ghost" onClick={() => setV({ ...v, slabs: slabs.filter((_, j) => j !== i) })}>×</Button></div>
          ))}
          <Button size="sm" variant="soft" className="self-start" onClick={() => setV({ ...v, slabs: [...slabs, { upto_amount: 50000, charge: 2000 }] })}>+ Slab</Button>
        </div>
      )}
      <SaveBar save={save} dirty={dirty} onSaved={onSaved} />
    </Card>
  );
}

/** Roles grid (on/off per permission) and approval limits in ₹ per role (SRS 2). */
export function RolesSection() {
  const r = useQ<{ roles: Role[]; all_permissions: string[]; limits: ApprovalLimit[] }>("/roles", { auth: "staff" });
  const toggle = useM(({ role, perms }: { role: Role; perms: string[] }) => outletApi.saveRole(role.id, perms));
  const [lim, setLim] = useState<Values | null>(null);
  const saveLim = useM((v: Values) => outletApi.saveLimit(v.id as string, v), { success: "Limits saved", onSuccess: () => setLim(null) });
  if (!r.data) return null;
  const roles = r.data.roles.filter((x) => x.key !== "owner");
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-2xl border-[1.5px] border-line bg-paper">
        <table className="text-sm">
          <thead><tr className="border-b border-line"><th className="sticky left-0 bg-paper p-2 text-left">Permission</th>{roles.map((x) => <th key={x.id} className="p-2 text-xs">{ROLE_LABEL[x.key]}</th>)}</tr></thead>
          <tbody>
            {r.data.all_permissions.map((p) => (
              <tr key={p} className="border-b border-line/60">
                <td className="sticky left-0 bg-paper p-2">{PERMISSIONS[p as keyof typeof PERMISSIONS]}</td>
                {roles.map((x) => {
                  const on = x.permissions.includes(p);
                  return <td key={x.id} className="p-1 text-center"><input type="checkbox" checked={on} onChange={() => toggle.mutate({ role: x, perms: on ? x.permissions.filter((y) => y !== p) : [...x.permissions, p] })} className="size-5 cursor-pointer accent-[var(--brand)]" aria-label={`${ROLE_LABEL[x.key]}: ${p}`} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Label>Approval limits</Label>
      <DataTable rows={r.data.limits.filter((l) => l.role !== "owner")} rowKey={(x) => x.id} onRowClick={(x) => setLim(x as unknown as Values)}
        columns={[{ key: "role", header: "Role", value: (x) => ROLE_LABEL[x.role] }, { key: "discount_pct", header: "Discount up to", value: (x) => `${x.discount_pct}%` }, { key: "void_value", header: "Void", value: (x) => formatINR(x.void_value) }, { key: "refund_value", header: "Refund", value: (x) => formatINR(x.refund_value) }, { key: "expense_value", header: "Expense", value: (x) => formatINR(x.expense_value) }, { key: "po_value", header: "Purchase order", value: (x) => formatINR(x.po_value) }]} />
      <p className="text-xs text-mute">Above a limit, a higher-role PIN is asked on the spot or the request goes to the approval queue. The owner can approve anything.</p>
      <FormModal open={!!lim} title={`Limits · ${lim ? ROLE_LABEL[lim.role as keyof typeof ROLE_LABEL] : ""}`} initial={lim} onClose={() => setLim(null)} onSave={(v) => saveLim.mutate(v)} saving={saveLim.isPending}
        fields={[{ name: "discount_pct", label: "Discount %", type: "number" }, { name: "void_value", label: "Void value", type: "money" }, { name: "refund_value", label: "Refund value", type: "money" }, { name: "expense_value", label: "Expense value", type: "money" }, { name: "po_value", label: "Purchase order value", type: "money" }]} />
    </div>
  );
}

export function DevicesSection({ onSaved }: { onSaved?: () => void }) {
  const printers = useQ<Printer[]>("/printers", { auth: "staff" });
  const devices = useQ<Device[]>("/devices", { auth: "staff" });
  const [p, setP] = useState<Values | null>(null);
  const [d, setD] = useState<Values | null>(null);
  const saveP = useM((v: Values) => outletApi.savePrinter(v), { success: "Printer saved", onSuccess: () => setP(null) });
  const saveD = useM((v: Values) => outletApi.saveDevice(v), { success: "Device saved", onSuccess: () => setD(null) });
  return (
    <div className="flex flex-col gap-4">
      <DataTable rows={printers.data ?? []} rowKey={(x) => x.id} onRowClick={(x) => setP(x as unknown as Values)} toolbar={<Button size="sm" variant="primary" onClick={() => setP({ width_mm: 80, connection: "network", station: "bill", online: true })}>+ Printer</Button>}
        columns={[{ key: "name", header: "Printer" }, { key: "station", header: "Prints", value: (x) => (x.station === "bill" ? "Bills" : `KOT · ${label(x.station)}`) }, { key: "width_mm", header: "Paper", value: (x) => `${x.width_mm} mm` }, { key: "connection", header: "Connection", value: (x) => `${label(x.connection)} · ${x.address}` }, { key: "online", header: "Status", cell: (x) => <Chip tone={x.online ? "ok" : "hot"}>{x.online ? "Online" : "Offline"}</Chip> }]} />
      <DataTable rows={devices.data ?? []} rowKey={(x) => x.id} onRowClick={(x) => setD(x as unknown as Values)} toolbar={<Button size="sm" onClick={() => setD({ kind: "kds" })}>+ Device</Button>}
        columns={[{ key: "name", header: "Device" }, { key: "kind", header: "Used as", value: (x) => x.kind.toUpperCase() }, { key: "station", header: "Station", value: (x) => (x.station ? label(x.station) : "—") }, { key: "last_seen_at", header: "Last seen", value: (x) => fmtDateTime(x.last_seen_at) }]} />
      <p className="text-xs text-mute">ESC/POS on 58/80 mm thermal printers over Bluetooth, USB (desktop) or network; the browser PDF print is the fallback. If a printer is offline, KOTs still reach the kitchen screen and the job is retried.</p>
      {onSaved && <Button variant="primary" className="self-start" onClick={onSaved}>Continue</Button>}
      <FormModal open={!!p} title="Printer" initial={p} onClose={() => setP(null)} onSave={(v) => saveP.mutate(v)} saving={saveP.isPending}
        fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "station", label: "Prints", type: "select", options: [{ value: "bill", label: "Bills" }, { value: "kitchen", label: "Kitchen KOT" }, { value: "bar", label: "Bar KOT" }, { value: "dessert", label: "Dessert KOT" }], required: true }, { name: "width_mm", label: "Paper width", type: "select", options: [{ value: "58", label: "58 mm" }, { value: "80", label: "80 mm" }] }, { name: "connection", label: "Connection", type: "select", options: [{ value: "bluetooth", label: "Bluetooth" }, { value: "usb", label: "USB (desktop)" }, { value: "network", label: "Network / LAN" }] }, { name: "address", label: "Address (IP:port or BT id)", type: "text" }, { name: "online", label: "Online", type: "toggle" }]} />
      <FormModal open={!!d} title="Device" initial={d} onClose={() => setD(null)} onSave={(v) => saveD.mutate(v)} saving={saveD.isPending}
        fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "kind", label: "Used as", type: "select", options: ["pos", "captain", "kds", "owner"].map((x) => ({ value: x, label: x.toUpperCase() })), required: true }, { name: "station", label: "Kitchen station (KDS)", type: "select", options: ["kitchen", "bar", "dessert"].map((x) => ({ value: x, label: label(x) })) }]} />
    </div>
  );
}

/** Time-limited support access for the CafeChalao team; every access is written to the audit log (SRS 11). */
export function SupportSection() {
  const s = useSettings();
  const grant = useM((h: number) => outletApi.supportAccess(h), { success: (r) => (r.support_access_until ? `Support can access until ${fmtDateTime(r.support_access_until)}` : "Support access removed") });
  const active = s.tenant.support_access_until && s.tenant.support_access_until > new Date().toISOString();
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm">Your customers and sales belong to you. The CafeChalao team can only open your data when you allow it here, for a limited time.</p>
      <p className="text-sm">{active ? <span className="text-ok">Support access is ON until {fmtDateTime(s.tenant.support_access_until)}.</span> : "Support access is off."}</p>
      <div className="flex flex-wrap gap-2">
        {[2, 24, 72].map((h) => <Button key={h} onClick={() => grant.mutate(h)}>Allow for {h < 24 ? `${h} hours` : `${h / 24} day${h > 24 ? "s" : ""}`}</Button>)}
        {active && <Button variant="danger" onClick={() => grant.mutate(0)}>Remove access now</Button>}
      </div>
      <Field label="Licence"><Input readOnly value={`${label(s.tenant.status)} · version ${s.tenant.version}`} /></Field>
    </Card>
  );
}
