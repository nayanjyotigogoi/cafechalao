"use client";

import { useEffect, type ReactNode } from "react";
import { QueryProvider } from "@/shared/api/hooks";
import { I18nProvider } from "@/shared/i18n";
import { ToastProvider } from "@/shared/ui/overlay";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Service worker: caches the app shell so POS/KDS reopen without internet (production builds only).
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return (
    <ToastProvider>
      <QueryProvider>
        <I18nProvider>{children}</I18nProvider>
      </QueryProvider>
    </ToastProvider>
  );
}
