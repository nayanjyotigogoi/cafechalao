"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** QR code drawn in the browser (table QR, UPI QR, ordering link). Nothing is sent to a third party. */
export function QR({ value, size = 160, label }: { value: string; size?: number; label?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: "M" }).then(setSrc).catch(() => setSrc(null));
  }, [value, size]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={label ?? "QR code"} width={size} height={size} className="rounded bg-white p-1" />
  ) : (
    <div style={{ width: size, height: size }} className="img-ph rounded" />
  );
}
