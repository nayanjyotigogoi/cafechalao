"use client";

import { MarketingAdmin } from "@/modules/marketing/components/MarketingAdmin";
import { useTitle } from "@/shared/tenant/TenantProvider";

export default function MarketingPage() {
  useTitle("Marketing");
  return <MarketingAdmin />;
}
