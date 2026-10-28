"use client";

import Link from "next/link";
import { useState } from "react";
import { dineinApi } from "@/modules/dinein/api";
import { useM } from "@/shared/api/hooks";
import { useCustomer } from "@/shared/auth/session";
import { todayISO } from "@/shared/lib/format";
import { useFeature, useSettings, useTitle } from "@/shared/tenant/TenantProvider";
import { Button, Card, Empty, ErrorText, Field, Input, Textarea } from "@/shared/ui/primitives";

/** Book a table (M2.6) from the customer app. The receptionist confirms it. */
export default function ReservePage() {
  useTitle("Book a table");
  const s = useSettings();
  const on = useFeature("reservations");
  const { customer } = useCustomer();
  const [f, setF] = useState({ date: todayISO(), time: "20:00", party_size: 2, table_preference: "", notes: "" });
  const [done, setDone] = useState(false);
  const book = useM(() => dineinApi.reserve({ ...f, name: customer!.name, phone: customer!.phone ?? "" }, true), { onSuccess: () => setDone(true) });

  if (!on) return <Empty title="Reservations are not available">{s.outlet.name} seats walk-ins. Call {s.outlet.phone}.</Empty>;
  if (!customer) return <Empty title="Sign in to book a table" action={<Link href="/login?next=/reserve"><Button variant="primary">Sign in</Button></Link>} />;
  if (done) return <Empty title="Request sent!" action={<Link href="/"><Button>Back to menu</Button></Link>}>{s.outlet.name} will confirm your table for {f.party_size} on {f.date} at {f.time} on WhatsApp.</Empty>;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-disp text-2xl font-extrabold">Book a table</h1>
      <Card className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" min={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Time"><Input type="time" min={s.outlet.opening_time} max={s.outlet.closing_time} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        </div>
        <Field label="Guests">
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <Button key={n} size="sm" variant={f.party_size === n ? "primary" : "outline"} onClick={() => setF({ ...f, party_size: n })}>{n}</Button>)}
          </div>
        </Field>
        <Field label="Table preference"><Input placeholder="Window, rooftop, family section…" value={f.table_preference} onChange={(e) => setF({ ...f, table_preference: e.target.value })} /></Field>
        <Field label="Notes"><Textarea placeholder="Birthday, high chair…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <ErrorText error={book.error} />
        <Button variant="primary" size="lg" loading={book.isPending} onClick={() => book.mutate(undefined)} disabled={!customer.phone}>Request booking</Button>
        {!customer.phone && <p className="text-xs text-rose">Add your mobile number in your profile first.</p>}
      </Card>
    </div>
  );
}
