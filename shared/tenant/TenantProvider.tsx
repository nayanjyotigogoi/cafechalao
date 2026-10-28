"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQ } from "@/shared/api/hooks";
import { getTenantSlug } from "@/shared/api/client";
import { onColor } from "@/shared/lib/format";
import type { Settings } from "@/shared/types/api";
import type { FeatureKey } from "@/shared/types/entities";
import { Button, Loading } from "@/shared/ui/primitives";

/**
 * Loads the café's settings once (GET /settings) and applies its theme: brand colours override the
 * design tokens, the café name fills titles and the PWA manifest. No outlet name is hard-coded anywhere.
 */

const Ctx = createContext<Settings | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { data, error, refetch, isLoading } = useQ<Settings>("/settings");

  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    root.style.setProperty("--primary", data.brand.primary_color);
    root.style.setProperty("--accent", data.brand.accent_color);
    // Text on the café colour in light mode; dark mode lightens the brand colour and uses dark text (globals.css).
    root.style.setProperty("--on-primary-light", onColor(data.brand.primary_color));
    // Default Strawberry Matcha keeps the exact wireframe values; other cafés get tints from their own colours.
    const isDefault = data.brand.primary_color.toLowerCase() === "#5e6b33" && data.brand.accent_color.toLowerCase() === "#f9d1d9";
    if (isDefault) root.removeAttribute("data-custom-brand");
    else root.setAttribute("data-custom-brand", "");
    root.lang = data.flags.language === "hi" ? "hi" : "en";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = data.brand.primary_color;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link) link.href = `/manifest.webmanifest?outlet=${data.tenant.slug}`;
  }, [data]);

  if (isLoading) return <Loading label="Opening…" />;
  if (error || !data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="font-disp text-2xl font-bold">We couldn&apos;t open this café</h1>
        <p className="text-sm text-mute">{error instanceof Error ? error.message : "Check the web address."} ({getTenantSlug()})</p>
        <Button onClick={() => refetch()}>Try again</Button>
        <a className="text-sm text-brand underline" href="/demo">
          See demo cafés
        </a>
      </div>
    );
  }
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSettings outside TenantProvider");
  return s;
}

export const useFeature = (f: FeatureKey) => useSettings().flags.features[f];

/** Sets the browser tab title as "<page> · <café name>". */
export function useTitle(page?: string) {
  const s = useContext(Ctx);
  useEffect(() => {
    if (s) document.title = page ? `${page} · ${s.outlet.name}` : s.brand.app_name;
  }, [s, page]);
}
