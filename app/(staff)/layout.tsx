"use client";

import type { ReactNode } from "react";
import { TenantProvider } from "@/shared/tenant/TenantProvider";

/** Staff surfaces (POS, captain, KDS, rider, admin) share the café's settings and theme. */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return <TenantProvider>{children}</TenantProvider>;
}
