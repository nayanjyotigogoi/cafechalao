import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { DEMO_TENANTS } from "@/mock/seed";

/** Home-screen icon for a café without an uploaded logo: its initials on its brand colour. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("outlet") ?? "chai-adda";
  const size = Math.min(1024, Number(req.nextUrl.searchParams.get("size") ?? 192));
  const t = DEMO_TENANTS.find((x) => x.slug === slug);
  const name = t?.name ?? "CafeChalao";
  const ini = name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: t?.primary ?? "#5E6B33", color: "#fff", fontSize: size * 0.42, fontWeight: 700 }}>
        {ini}
      </div>
    ),
    { width: size, height: size },
  );
}
