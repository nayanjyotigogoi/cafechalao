"use client";

import { MarketingAdmin } from "@/modules/marketing/components/MarketingAdmin";
import { useTitle } from "@/shared/tenant/TenantProvider";

export default function FeedbackPage() {
  useTitle("Feedback");
  return <MarketingAdmin initial="feedback" />;
}
