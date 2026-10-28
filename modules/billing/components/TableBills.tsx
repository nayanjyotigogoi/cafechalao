"use client";

import Link from "next/link";
import { cx } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import type { TableBills as Bills } from "@/shared/types/api";
import { Card, Label } from "@/shared/ui/primitives";

/**
 * All bills of one table visit. A paid bill is never changed: items added after paying go on a new bill,
 * so guests and the cashier see what is paid, what is still due, and can open/print each invoice.
 */
export function TableBills({ bills, currentId, compact, onPick }: { bills: Bills; currentId?: string; compact?: boolean; onPick?: (id: string) => void }) {
  if (bills.orders.length < 2 && !bills.paid && !bills.confirming) return null;
  return (
    <Card className={cx("flex flex-col gap-2 text-sm", compact && "p-3")}>
      <Label>Bills for this table</Label>
      {bills.orders.map((o) => {
        const paid = o.payment_status === "paid";
        const confirming = o.payment_status === "pending";
        const name = <>{o.number}{o.invoice_number && <span className="text-mute"> · {o.invoice_number}</span>}</>;
        return (
          <div key={o.id} className={cx("flex items-center gap-2", o.id === currentId && "font-semibold")}>
            {onPick && o.id !== currentId
              ? <button className="flex-1 cursor-pointer text-left text-brand underline" onClick={() => onPick(o.id)}>{name}</button>
              : <span className="flex-1">{name}</span>}
            <span className={cx("rounded-full px-2 py-0.5 text-xs", paid ? "bg-ok/15 text-ok" : confirming ? "bg-info/15 text-info" : "bg-warn/15 text-warn")}>{paid ? "Paid" : confirming ? "UPI · confirming" : "Due"}</span>
            <span className="num w-20 text-right">{formatINR(o.total, { decimals: true })}</span>
            {o.invoice_id ? <Link href={`/bill/${o.invoice_id}?key=${o.id}`} className="w-16 text-right text-brand">View</Link> : <span className="w-16" />}
          </div>
        );
      })}
      <div className="flex justify-between border-t border-line pt-2">
        <span>Paid <b className="num">{formatINR(bills.paid, { decimals: true })}</b>{bills.confirming > 0 && <> · UPI confirming <b className="num">{formatINR(bills.confirming, { decimals: true })}</b></>}</span>
        <span>Still to pay <b className={cx("num", bills.due > 0 && "text-warn")}>{formatINR(bills.due, { decimals: true })}</b></span>
      </div>
    </Card>
  );
}
