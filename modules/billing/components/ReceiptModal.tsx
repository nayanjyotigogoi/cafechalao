"use client";

import { useState } from "react";
import { billingApi } from "@/modules/billing/api";
import { Receipt } from "@/modules/billing/components/Receipt";
import { ApprovalPin } from "@/modules/staff/components/ApprovalPin";
import { useM, useQ } from "@/shared/api/hooks";
import { formatINR } from "@/shared/lib/money";
import type { InvoiceDetail } from "@/shared/types/api";
import { Modal } from "@/shared/ui/overlay";
import { Button, Field, Input, Loading, MoneyInput } from "@/shared/ui/primitives";

/** Bill after charging or from the bills list: print (ESC/POS or browser), reprint with audit, e-bill link, refund. */
export function ReceiptModal({ invoiceId, change, onClose, allowRefund }: { invoiceId: string | null; change?: number; onClose: () => void; allowRefund?: boolean }) {
  const inv = useQ<InvoiceDetail>(invoiceId ? `/invoices/${invoiceId}` : null, { auth: "staff" });
  const [phone, setPhone] = useState("");
  const [refund, setRefund] = useState<{ amount: number; reason: string } | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const reprint = useM(() => billingApi.reprint(invoiceId!), { onSuccess: () => setTimeout(() => window.print(), 50) });
  const share = useM(() => billingApi.share(invoiceId!, phone || undefined), { onSuccess: (r) => window.open(r.whatsapp_url, "_blank", "noopener") });
  const doRefund = useM((approver_id?: string) => billingApi.refund(invoiceId!, { ...refund!, approver_id }), {
    success: "Refund recorded",
    onError: (e) => e.code === "approval_required" && setNeedPin(true),
    onSuccess: () => setRefund(null),
  });
  if (!invoiceId) return null;
  return (
    <Modal open onClose={onClose} title={inv.data ? `Bill ${inv.data.number}` : "Bill"} wide
      footer={
        <>
          <Button onClick={() => window.print()}>Print</Button>
          <Button onClick={() => reprint.mutate(undefined)} loading={reprint.isPending}>Reprint (logged)</Button>
          <Button variant="primary" onClick={onClose}>Done · New order</Button>
        </>
      }>
      {!inv.data ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,340px)_1fr]">
          <div className="rounded-xl border-[1.5px] border-line"><Receipt inv={inv.data} /></div>
          <div className="no-print flex flex-col gap-3">
            {change != null && change > 0 && <div className="rounded-xl bg-ok/15 p-3 text-ok">Return change <b className="num text-xl">{formatINR(change, { decimals: true })}</b></div>}
            <Field label="Send e-bill on WhatsApp">
              <div className="flex gap-2">
                <Input inputMode="tel" placeholder={inv.data.order.customer_phone ?? "Customer mobile"} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Button onClick={() => share.mutate(undefined)} loading={share.isPending}>Send</Button>
              </div>
            </Field>
            {allowRefund && (
              refund ? (
                <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-line p-3">
                  <Field label="Refund amount"><MoneyInput value={refund.amount} onChange={(v) => setRefund({ ...refund, amount: v })} /></Field>
                  <Field label="Reason"><Input value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></Field>
                  <div className="flex gap-2"><Button onClick={() => setRefund(null)}>Cancel</Button><Button variant="danger" disabled={!refund.reason || !refund.amount} loading={doRefund.isPending} onClick={() => doRefund.mutate(undefined)}>Refund</Button></div>
                </div>
              ) : <Button variant="danger" onClick={() => setRefund({ amount: inv.data!.total, reason: "" })}>Refund…</Button>
            )}
          </div>
        </div>
      )}
      <ApprovalPin open={needPin} onClose={() => setNeedPin(false)} kind="refund_value" amount={refund?.amount} reason="Refunds above your limit need a manager" onApproved={(id) => { setNeedPin(false); doRefund.mutate(id); }} />
    </Modal>
  );
}
