"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Receipt } from "@/modules/billing/components/Receipt";
import { useQ } from "@/shared/api/hooks";
import { useCustomer, useToken } from "@/shared/auth/session";
import { useTitle } from "@/shared/tenant/TenantProvider";
import type { InvoiceDetail } from "@/shared/types/api";
import { Button, Empty, Loading } from "@/shared/ui/primitives";

/** E-bill link (M3.7) sent by WhatsApp/SMS: opens the invoice; Print saves it as PDF. */
export default function BillPage() {
  return (
    <Suspense>
      <Bill />
    </Suspense>
  );
}

function Bill() {
  const { id } = useParams<{ id: string }>();
  const key = useSearchParams().get("key");
  const { customer } = useCustomer();
  const staff = useToken("staff");
  const inv = useQ<InvoiceDetail>(`/invoices/${id}`, { auth: staff ? "staff" : customer ? "customer" : undefined, query: key ? { key } : undefined });
  useTitle(inv.data ? `Bill ${inv.data.number}` : "Bill");
  if (inv.isLoading) return <Loading />;
  if (!inv.data) return <Empty title="Bill not found">{inv.error instanceof Error ? inv.error.message : ""}</Empty>;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="no-print flex gap-2">
        <Button variant="primary" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <div className="rounded-xl border-[1.5px] border-line shadow-sm">
        <Receipt inv={inv.data} />
      </div>
    </div>
  );
}
