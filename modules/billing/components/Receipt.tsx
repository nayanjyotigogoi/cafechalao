"use client";

import { fmtDateTime, label } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import type { InvoiceDetail } from "@/shared/types/api";

/**
 * GST invoice / Bill of Supply (M3.3) laid out for 58/80 mm thermal paper and the browser PDF fallback.
 * Shows outlet GSTIN, FSSAI, HSN/SAC, CGST/SGST split, sequential invoice number, round-off and the locked
 * "Powered by CafeChalao" line.
 */
export function Receipt({ inv }: { inv: InvoiceDetail }) {
  const o = inv.order;
  const items = o.items.filter((i) => i.status !== "void");
  const row = (l: string, v: number, bold = false) => (
    <div className={`flex justify-between ${bold ? "font-bold" : ""}`}>
      <span>{l}</span>
      <span className="num">{formatINR(v, { decimals: true })}</span>
    </div>
  );
  return (
    <div className="print-receipt mx-auto w-full max-w-[340px] bg-white p-4 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <div className="font-sans text-base font-bold">{inv.outlet.name}</div>
        <div>{inv.outlet.legal_name}</div>
        <div>{inv.outlet.address}</div>
        <div>Ph {inv.outlet.phone}</div>
        {inv.tax_settings.gstin && <div>GSTIN {inv.tax_settings.gstin}</div>}
        <div>FSSAI {inv.tax_settings.fssai_number}</div>
        <div className="mt-1 font-bold">{inv.bill_of_supply ? "BILL OF SUPPLY" : "TAX INVOICE"}</div>
        {inv.bill_of_supply && <div className="text-[10px]">Composition taxable person, not eligible to collect tax on supplies</div>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between"><span>No. {inv.number}</span><span>{o.token ? `Token ${o.token}` : ""}</span></div>
      <div>{fmtDateTime(inv.created_at)}</div>
      <div>{label(o.type)}{o.table ? ` · ${o.table.name}` : ""} · {o.number}</div>
      {o.customer_name && <div>Customer: {o.customer_name}</div>}
      {inv.cashier && <div>Cashier: {inv.cashier}</div>}
      <div>Place of supply: {inv.tax_settings.place_of_supply} · SAC {inv.tax_settings.hsn_sac}</div>
      <div className="my-2 border-t border-dashed border-black" />
      {items.map((i) => (
        <div key={i.id} className="flex justify-between gap-2">
          <span className="min-w-0">
            {i.name}{i.variant_name ? ` (${i.variant_name})` : ""}{i.complimentary ? " [comp]" : ""}
            <br />
            <span className="text-[11px]">{i.qty} × {formatINR(i.unit_price, { decimals: true })}</span>
          </span>
          <span className="num">{formatINR(i.complimentary ? 0 : i.unit_price * i.qty, { decimals: true })}</span>
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-black" />
      {row("Subtotal", inv.subtotal)}
      {inv.discount > 0 && row("Discount", -inv.discount)}
      {inv.service_charge > 0 && row("Service charge (optional)", inv.service_charge)}
      {!inv.bill_of_supply && (
        <>
          {row("Taxable value", inv.taxable)}
          {inv.taxes.map((t) => (
            <div key={t.id}>
              {row(`CGST ${t.rate / 2}%`, t.cgst)}
              {row(`SGST ${t.rate / 2}%`, t.sgst)}
            </div>
          ))}
        </>
      )}
      {o.delivery_charge > 0 && row("Delivery charge", o.delivery_charge)}
      {o.tip > 0 && row("Tip", o.tip)}
      {inv.round_off !== 0 && row("Round off", inv.round_off)}
      {row("TOTAL", inv.total, true)}
      <div className="my-2 border-t border-dashed border-black" />
      {inv.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{label(p.mode)}</span><span className="num">{formatINR(p.amount, { decimals: true })}</span></div>)}
      {inv.refunds.map((r) => <div key={r.id} className="flex justify-between"><span>Refund: {r.reason}</span><span className="num">−{formatINR(r.amount, { decimals: true })}</span></div>)}
      {inv.reprints > 0 && <div className="mt-1 text-center">** REPRINT {inv.reprints} **</div>}
      <div className="mt-3 text-center">Thank you! Visit again.</div>
      <div className="mt-2 text-center text-[10px]">Powered by CafeChalao</div>
    </div>
  );
}
