"use client";

import { useState } from "react";
import { customersApi } from "@/modules/customers/api";
import { useM } from "@/shared/api/hooks";
import type { Address } from "@/shared/types/entities";
import { Modal } from "@/shared/ui/overlay";
import { Button, ErrorText, Field, Input } from "@/shared/ui/primitives";

export function AddressModal({ open, onClose, city, onSaved }: { open: boolean; onClose: () => void; city: string; onSaved: (a: Address) => void }) {
  const [f, setF] = useState({ label: "Home", line1: "", landmark: "", city, pincode: "" });
  const save = useM(() => customersApi.addAddress(f), { onSuccess: (a) => { onSaved(a); onClose(); } });
  return (
    <Modal open={open} onClose={onClose} title="New address" footer={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save address</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Pincode"><Input inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="House, street" className="sm:col-span-2"><Input value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} /></Field>
        <Field label="Landmark"><Input value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} /></Field>
        <Field label="City"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
      </div>
      <ErrorText error={save.error} />
    </Modal>
  );
}
