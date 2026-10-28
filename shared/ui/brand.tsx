"use client";

import { cx } from "@/shared/lib/format";

/**
 * CafeChalao marks. The café's own logo/name is used everywhere else; CafeChalao appears only in the
 * locked "Powered by" line (rendered here, not by the café's theme, so outlet settings cannot remove it).
 */

export function CafeChalaoLogo({ className, tagline = true }: { className?: string; tagline?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/cafechalao-icon-light.svg" alt="" className="h-[1.9em] w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/cafechalao-icon-dark.svg" alt="" className="hidden h-[1.9em] w-auto dark:block" />
      <span className="flex flex-col leading-none">
        <span className="font-logo text-[1.15em] font-semibold tracking-tight">
          Cafe<span className="text-[#5E6B33] dark:text-[#B4BE86]">Chalao</span>
        </span>
        {tagline && <span className="mt-0.5 font-tag text-[0.55em] font-medium text-[#5E6B33] dark:text-[#B4BE86]">Sab kuch, ek jagah</span>}
      </span>
    </span>
  );
}

export function PoweredBy({ className }: { className?: string }) {
  return (
    <a
      href="https://cafechalao.in"
      target="_blank"
      rel="noreferrer"
      className={cx("flex items-center justify-center gap-1.5 py-2 text-[11px] text-mute", className)}
      data-locked="powered-by"
    >
      <span>Powered by</span>
      <span className="text-[13px] text-ink">
        <CafeChalaoLogo tagline={false} />
      </span>
    </a>
  );
}

/** The café's logo, or a monogram in its brand colour when no logo is uploaded. */
export function OutletMark({ name, logo, size = 32, className }: { name: string; logo?: string | null; size?: number; className?: string }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt={`${name} logo`} width={size} height={size} className={cx("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  const ini = name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return (
    <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-full bg-brand font-disp font-bold text-on-brand", className)} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {ini}
    </span>
  );
}
