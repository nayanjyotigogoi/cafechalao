"use client";

import Link from "next/link";
import { useState } from "react";
import { outletApi } from "@/modules/outlet/api";
import { BrandSection, BusinessSection, DeliverySection, DevicesSection, PaymentSection, TaxSection } from "@/modules/outlet/components/SettingsSections";
import { useM, useQ } from "@/shared/api/hooks";
import { cx } from "@/shared/lib/format";
import { useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import type { Floor, Menu } from "@/shared/types/api";
import type { Invoice } from "@/shared/types/entities";
import { CafeChalaoLogo, OutletMark } from "@/shared/ui/brand";
import { Button, Card, Label, PageTitle, ProgressBar } from "@/shared/ui/primitives";

/** Setup and branding wizard (SRS 7): from fresh install to first bill in under 2 hours. */
const STEPS = ["Business details", "Branding", "Tax & GST", "Floor & table QR", "Menu", "Staff & roles", "Payments", "Delivery", "Printers & devices", "Go-live checklist"];

export default function SetupWizard() {
  useTitle("Set up");
  const s = useSettings();
  const [step, setStep] = useState(Math.min(9, s.outlet.setup_step));
  const mark = useM((n: number) => outletApi.setupStep(n), { silentError: true });
  const next = () => { mark.mutate(step + 1); setStep((x) => Math.min(9, x + 1)); };
  const done = s.outlet.setup_step;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-2 rounded-2xl bg-fill p-4 lg:w-64">
        <CafeChalaoLogo className="text-sm" />
        <div className="flex items-center gap-2"><OutletMark name={s.outlet.name} logo={s.brand.logo_url} size={28} /><b>Set up your café</b></div>
        <Label>About 10 minutes per step</Label>
        <nav className="scrollbar-none flex gap-1 overflow-x-auto lg:flex-col">
          {STEPS.map((l, i) => (
            <button key={l} onClick={() => setStep(i)} className={cx("flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm", i === step && "bg-paper font-semibold")}>
              <span className={cx("grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] text-xs", i < done ? "border-ink bg-ink text-bg" : i === step ? "border-brand bg-brand text-on-brand" : "border-line")}>{i < done ? "✓" : i + 1}</span>{l}
            </button>
          ))}
        </nav>
        <div className="mt-auto"><ProgressBar value={(done / 10) * 100} /><Label className="mt-1">{done} of 10 done</Label></div>
      </aside>
      <section className="min-w-0 flex-1">
        <PageTitle title={STEPS[step]} sub={SUBS[step]} />
        <div className="mt-4">
          {step === 0 && <BusinessSection onSaved={next} />}
          {step === 1 && <BrandSection onSaved={next} />}
          {step === 2 && <TaxSection onSaved={next} />}
          {step === 3 && <FloorStep onNext={next} />}
          {step === 4 && <MenuStep onNext={next} />}
          {step === 5 && <LinkStep text="Add staff with their PINs, then check the roles grid and approval limits." links={[["/admin/staff", "Add staff"], ["/admin/settings?tab=roles", "Roles & limits"]]} onNext={next} />}
          {step === 6 && <PaymentSection onSaved={next} />}
          {step === 7 && <DeliverySection onSaved={next} />}
          {step === 8 && <DevicesSection onSaved={next} />}
          {step === 9 && <GoLive />}
        </div>
      </section>
    </div>
  );
}

const SUBS = [
  "Outlet name, legal name, business type, address and contacts.",
  "Customers see this on the menu, receipts and the app icon.",
  "GSTIN, scheme, default rate, FSSAI number, invoice prefix and service charge.",
  "Areas and tables. QR codes print as a PDF to stick on each table.",
  "Categories and items by form or Excel import; photos are auto-compressed.",
  "Staff, PINs and approval limits.",
  "Which payment modes are allowed, your gateway keys, UPI ID for the static QR.",
  "On/off, own or freelance riders, charge rules, payment options.",
  "KOT and bill printers per station, kitchen screens.",
  "Test order, test print, test payment. Then you're live.",
];

function FloorStep({ onNext }: { onNext: () => void }) {
  const s = useSettings();
  const floor = useQ<Floor>(s.flags.features.dine_in ? "/floor" : null, { auth: "staff" });
  if (!s.flags.features.dine_in) return <LinkStep text="Your business type doesn't use tables, so there's nothing to set up here." links={[]} onNext={onNext} />;
  return <LinkStep text={`${floor.data?.tables.length ?? 0} tables in ${floor.data?.areas.length ?? 0} areas so far.`} links={[["/admin/tables", "Set up tables"], ["/admin/tables", "Print QR codes"]]} onNext={onNext} />;
}

function MenuStep({ onNext }: { onNext: () => void }) {
  const menu = useQ<Menu>("/menu");
  return <LinkStep text={`${menu.data?.items.length ?? 0} items in ${menu.data?.categories.length ?? 0} categories.`} links={[["/admin/menu", "Edit menu"], ["/admin/menu", "Import from Excel"], ["/admin/stock", "Add recipes (optional)"]]} onNext={onNext} />;
}

function LinkStep({ text, links, onNext }: { text: string; links: [string, string][]; onNext: () => void }) {
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm">{text}</p>
      <div className="flex flex-wrap gap-2">{links.map(([h, l]) => <Link key={l} href={h}><Button>{l}</Button></Link>)}</div>
      <Button variant="primary" className="self-start" onClick={onNext}>Save &amp; continue</Button>
    </Card>
  );
}

function GoLive() {
  const s = useSettings();
  const inv = useQ<Invoice[]>("/invoices", { auth: "staff" });
  const live = useM(() => outletApi.setupStep(10), { success: `${s.outlet.name} is live! 🎉` });
  const checks = [
    { ok: !!s.tax.fssai_number, label: "FSSAI number on bills" },
    { ok: !!s.brand.primary_color, label: "Branding set" },
    { ok: (inv.data?.length ?? 0) > 0, label: "Test bill printed", link: "/pos" },
    { ok: s.payment.gateway_configured, label: "Payment gateway keys saved (dummy is fine for testing)" },
  ];
  return (
    <Card className="flex flex-col gap-3">
      {checks.map((c) => (
        <div key={c.label} className="flex items-center gap-3 text-sm">
          <span className={cx("grid size-6 place-items-center rounded-full text-xs", c.ok ? "bg-ok text-white" : "border-[1.5px] border-line")}>{c.ok ? "✓" : ""}</span>
          <span className="flex-1">{c.label}</span>
          {c.link && !c.ok && <Link href={c.link}><Button size="sm">Do it</Button></Link>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Link href="/" target="_blank"><Button>Place a test order as a customer</Button></Link>
        <Button variant="primary" loading={live.isPending} onClick={() => live.mutate(undefined)} disabled={s.outlet.setup_step >= 10}>{s.outlet.setup_step >= 10 ? "You're live ✓" : "Go live"}</Button>
      </div>
    </Card>
  );
}
