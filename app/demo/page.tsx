"use client";

import { API_MODE, setTenantSlug } from "@/shared/api/client";
import { useQ } from "@/shared/api/hooks";
import { BUSINESS_TYPE_LABEL } from "@/shared/lib/features";
import { resetDemo } from "@/shared/lib/demo";
import type { BusinessType } from "@/shared/types/entities";
import { CafeChalaoLogo } from "@/shared/ui/brand";
import { ConfirmButton } from "@/shared/ui/overlay";
import { Card, Chip, Label, Loading } from "@/shared/ui/primitives";

/**
 * Demo launcher: every café on the platform and every surface, with the demo logins.
 * In production each café opens on its own domain; locally use <slug>.localhost:3000 or ?outlet=<slug>.
 */
const SURFACES = [
  ["/", "Customer app & online ordering", "Google sign-in (demo) or phone OTP 123456"],
  ["/staff", "Staff login: employee ID + PIN", "IDs in Admin → Staff (owner E001) · PINs: Owner 1111 · Manager 2222 · Cashier 3333 · Receptionist 4444 · Captain 5555 · Kitchen 6666 · Storekeeper 7777"],
  ["/pos", "POS / billing", "Cashier PIN 3333"],
  ["/captain", "Captain (waiter) app", "Captain PIN 5555"],
  ["/kds", "Kitchen display", "Kitchen PIN 6666"],
  ["/rider", "Rider app", "Phone OTP 123456"],
  ["/admin", "Owner dashboard & admin", "Owner PIN 1111"],
] as const;

export default function DemoPage() {
  const cafes = useQ<{ slug: string; name: string; city: string; business_type: BusinessType; primary_color: string; accent_color: string }[]>("/public/cafes");
  const go = (slug: string, path: string) => {
    setTenantSlug(slug);
    window.open(`${path}${path.includes("?") ? "&" : "?"}outlet=${slug}`, "_blank");
  };
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 md:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <CafeChalaoLogo className="text-2xl" />
        <Chip>Demo · {API_MODE === "mock" ? "dummy data in this browser" : "live API"}</Chip>
        <a href="/control" target="_blank" className="ml-auto text-sm text-brand underline">CafeChalao Control Panel → (admin@cafechalao.in · code 123456)</a>
      </div>
      <p className="max-w-3xl text-sm text-mute">Each café below is a separate CafeChalao customer with its own name, colours, menu, staff, customers and data. Their customers (the people ordering) belong to that café only. Open any surface; open two tabs (for example POS and Kitchen) to see orders move live.</p>
      {!cafes.data ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {cafes.data.map((c) => (
            <Card key={c.slug} className="flex flex-col gap-3" style={{ borderColor: c.primary_color }}>
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-full font-disp text-lg font-bold text-white" style={{ background: c.primary_color }}>{c.name.split(" ").map((p) => p[0]).join("")}</span>
                <div className="flex-1"><b className="font-disp text-xl">{c.name}</b><div className="text-xs text-mute">{BUSINESS_TYPE_LABEL[c.business_type]} · {c.city} · {c.slug}.localhost:3000</div></div>
                <span className="size-6 rounded-full border" style={{ background: c.accent_color }} title="Accent colour" />
              </div>
              <div className="flex flex-col gap-1">
                {SURFACES.map(([path, title, hint]) => (
                  <button key={path} onClick={() => go(c.slug, path)} className="flex cursor-pointer flex-col rounded-lg px-2 py-1.5 text-left hover:bg-fill/60">
                    <span className="text-sm font-semibold text-brand" style={{ color: c.primary_color }}>{title} ↗</span>
                    <span className="text-[11px] text-mute">{hint}</span>
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Card className="flex flex-wrap items-center gap-3">
        <Label>Table QR</Label>
        <span className="flex-1 text-sm">Scan flow: Admin → Tables & QR → Print QR codes, or open a table link like /t/&lt;code&gt;.</span>
        {API_MODE === "mock" && <ConfirmButton variant="danger" confirm="Erase every change made in this browser and reload the sample data?" onConfirm={resetDemo}>Reset demo data</ConfirmButton>}
      </Card>
    </div>
  );
}
