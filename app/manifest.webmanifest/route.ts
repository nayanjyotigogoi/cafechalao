import { NextResponse, type NextRequest } from "next/server";
import { DEMO_TENANTS } from "@/mock/seed";

/**
 * PWA manifest per café (SRS 7 branding): app name, short name, colours and icon come from the café's settings,
 * so each outlet installs to the home screen under its own name. In http mode this reads the Laravel /settings.
 */
export async function GET(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const slug = req.nextUrl.searchParams.get("outlet") ?? (host.includes(".localhost") ? host.split(".localhost")[0] : process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? "chai-adda");
  let name = "CafeChalao";
  let short = "CafeChalao";
  let primary = "#5E6B33";
  let accent = "#F9D1D9";
  if (process.env.NEXT_PUBLIC_API_MODE === "http") {
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/settings`, { headers: { "X-Tenant": slug, Accept: "application/json" }, next: { revalidate: 300 } });
      const s = (await r.json()).data;
      name = s.brand.app_name;
      short = s.brand.short_name;
      primary = s.brand.primary_color;
      accent = s.brand.accent_color;
    } catch {}
  } else {
    const t = DEMO_TENANTS.find((x) => x.slug === slug);
    if (t) ({ name, short, primary, accent } = { name: t.name, short: t.short, primary: t.primary, accent: t.accent });
  }
  const icon = (size: number) => ({ src: `/tenant-icon?outlet=${slug}&size=${size}`, sizes: `${size}x${size}`, type: "image/png", purpose: "any maskable" });
  return NextResponse.json(
    {
      name, short_name: short, start_url: `/?outlet=${slug}`, scope: "/", display: "standalone", background_color: "#ffffff", theme_color: primary,
      icons: [icon(192), icon(512)], categories: ["food", "business"], description: `${name} — order, pay and track`, accent,
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
