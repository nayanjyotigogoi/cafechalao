"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BrandSection, BusinessSection, DeliverySection, DevicesSection, FeaturesSection, PaymentSection, RolesSection, SupportSection, TaxSection } from "@/modules/outlet/components/SettingsSections";
import { LanguageSwitch } from "@/shared/i18n";
import { useTitle } from "@/shared/tenant/TenantProvider";
import { Card, Label, PageTitle, Segmented } from "@/shared/ui/primitives";
import { API_MODE } from "@/shared/api/client";
import { resetDemo } from "@/shared/lib/demo";
import { ConfirmButton } from "@/shared/ui/overlay";
import Link from "next/link";
import { Button } from "@/shared/ui/primitives";

/** Outlet settings (M11): everything a café may want different is a setting here, never a code change. */
const TABS = [["business", "Business"], ["brand", "Branding"], ["tax", "Tax & GST"], ["features", "Features"], ["payment", "Payments"], ["delivery", "Delivery"], ["roles", "Roles & limits"], ["devices", "Printers & devices"], ["support", "Support & language"]] as const;
type Tab = (typeof TABS)[number][0];

export default function SettingsPage() {
  return <Suspense><Settings /></Suspense>;
}

function Settings() {
  useTitle("Settings");
  const initial = (useSearchParams().get("tab") as Tab) ?? "business";
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t[0] === initial) ? initial : "business");
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Settings" actions={<Link href="/admin/setup"><Button>Setup wizard</Button></Link>} />
      <Segmented value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} />
      {tab === "business" && <BusinessSection />}
      {tab === "brand" && <BrandSection />}
      {tab === "tax" && <TaxSection />}
      {tab === "features" && <FeaturesSection />}
      {tab === "payment" && <PaymentSection />}
      {tab === "delivery" && <DeliverySection />}
      {tab === "roles" && <RolesSection />}
      {tab === "devices" && <DevicesSection />}
      {tab === "support" && (
        <div className="flex flex-col gap-4">
          <SupportSection />
          <Card className="flex items-center gap-3"><Label>Language on this device</Label><LanguageSwitch /></Card>
          {API_MODE === "mock" && (
            <Card className="flex flex-wrap items-center gap-3">
              <span className="flex-1 text-sm">Demo mode: all data lives in this browser. Reset to start again from the sample cafés.</span>
              <ConfirmButton variant="danger" confirm="Erase every change made in this browser and reload the sample data for all cafés?" onConfirm={resetDemo}>Reset demo data</ConfirmButton>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
