"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { formatINR } from "@/shared/lib/money";
import { useSettings } from "@/shared/tenant/TenantProvider";
import { QR } from "@/shared/ui/qr";

/**
 * The café's own UPI QR, used everywhere a customer pays (checkout, table, POS counter).
 * Uses the QR image the owner uploaded in Settings → Payments; otherwise draws one from the UPI ID with the amount.
 * Settings are re-read each time it opens, so a QR the owner just replaced shows on pages that were already open.
 * Money goes straight to the café's account; CafeChalao never holds it.
 */
export function CafeUpiQr({ amount, size = 180 }: { amount: number; size?: number }) {
  const s = useSettings();
  const qc = useQueryClient();
  useEffect(() => { qc.invalidateQueries({ queryKey: ["api", "public", "/settings"] }); }, [qc]);
  const upi = s.payment.upi_id;
  const img = s.payment.upi_qr_url;
  const link = upi ? `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(s.outlet.name)}&am=${(amount / 100).toFixed(2)}&cu=INR` : null;
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={`${s.outlet.name} UPI QR`} width={size} height={size} className="rounded-xl bg-white object-contain p-1" style={{ width: size, height: size }} />
      ) : link ? (
        <QR value={link} size={size} label={`${s.outlet.name} UPI QR`} />
      ) : (
        <div className="grid place-items-center rounded-xl border-[1.5px] border-dashed border-line p-4 text-sm text-mute" style={{ width: size, height: size }}>The café hasn&apos;t added its UPI QR yet. Please pay at the counter.</div>
      )}
      <div className="num font-disp text-3xl font-extrabold">{formatINR(amount, { decimals: true })}</div>
      {upi && <div className="text-xs text-mute">UPI ID: {upi}</div>}
      {link && <a href={link} className="text-sm text-brand underline sm:hidden">Open UPI app</a>}
    </div>
  );
}
