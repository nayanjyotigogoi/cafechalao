"use client";

import { useState } from "react";
import { customersApi } from "@/modules/customers/api";
import { useM, useQ } from "@/shared/api/hooks";
import { formatINR } from "@/shared/lib/money";
import type { Customer } from "@/shared/types/entities";
import { Modal } from "@/shared/ui/overlay";
import { Button, ErrorText, Field, Input, Toggle } from "@/shared/ui/primitives";

/**
 * Find a customer by mobile or name, or create a walk-in profile (M1.2) that the customer can claim later
 * by signing in with Google and verifying the same mobile.
 */
export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer) => void }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", birthday: "", marketing_consent: true });
  const list = useQ<Customer[]>(open && q.length >= 2 ? "/customers" : null, { auth: "staff", query: { q, limit: 8 } });
  const create = useM(() => customersApi.createWalkIn({ ...f, birthday: f.birthday || undefined }), { onSuccess: (c) => { onPick(c); onClose(); setCreating(false); } });
  return (
    <Modal open={open} onClose={onClose} title="Customer">
      {!creating ? (
        <div className="flex flex-col gap-3">
          <Input autoFocus placeholder="Search mobile or name" value={q} onChange={(e) => { setQ(e.target.value); setF((x) => ({ ...x, phone: /\d/.test(e.target.value) ? e.target.value : x.phone, name: /\d/.test(e.target.value) ? x.name : e.target.value })); }} />
          {list.data?.map((c) => (
            <button key={c.id} onClick={() => { onPick(c); onClose(); }} className="flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-line p-3 text-left text-sm hover:border-brand">
              <span className="min-w-0 flex-1"><b>{c.name}</b><span className="block text-xs text-mute">{c.phone} · {c.visits} visits · {formatINR(c.total_spend)} · {c.loyalty_points} pts</span></span>
              {c.tags.map((t) => <span key={t} className="rounded-full bg-fill px-2 py-0.5 text-[10px] uppercase">{t}</span>)}
            </button>
          ))}
          {q.length >= 2 && !list.isLoading && !list.data?.length && <p className="text-sm text-mute">No match.</p>}
          <Button variant="soft" onClick={() => setCreating(true)}>+ New walk-in profile</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Mobile"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Birthday (optional)"><Input type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
          <Toggle checked={f.marketing_consent} onChange={(v) => setF({ ...f, marketing_consent: v })} label="Customer agrees to WhatsApp/SMS offers" />
          <ErrorText error={create.error} />
          <div className="flex gap-2"><Button onClick={() => setCreating(false)}>Back</Button><Button variant="primary" loading={create.isPending} onClick={() => create.mutate(undefined)}>Save</Button></div>
        </div>
      )}
    </Modal>
  );
}
