"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "./overlay";
import { Button, ErrorText, Field, Input, MoneyInput, Select, Textarea, Toggle } from "./primitives";

/** Spec-driven form so every settings-style screen (coupons, suppliers, riders …) shares one look and behaviour. */

export type FieldSpec =
  | { name: string; label: string; type: "text" | "email" | "tel" | "date" | "time" | "color"; required?: boolean; placeholder?: string; hint?: string; full?: boolean }
  | { name: string; label: string; type: "number"; min?: number; max?: number; step?: number; required?: boolean; hint?: string; full?: boolean }
  | { name: string; label: string; type: "money"; required?: boolean; hint?: string; full?: boolean }
  | { name: string; label: string; type: "textarea"; hint?: string; full?: boolean }
  | { name: string; label: string; type: "toggle"; hint?: string; full?: boolean }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; hint?: string; full?: boolean; empty?: string }
  | { name: string; label: string; type: "checks"; options: { value: string | number; label: string }[]; hint?: string; full?: boolean };

export type Values = Record<string, unknown>;

export function FormFields({ fields, values, onChange }: { fields: FieldSpec[]; values: Values; onChange: (v: Values) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const v = values[f.name];
        const cls = f.full || f.type === "textarea" || f.type === "checks" ? "sm:col-span-2" : undefined;
        if (f.type === "toggle") return <div key={f.name} className={cls}><Toggle checked={!!v} onChange={(x) => set(f.name, x)} label={f.label} /></div>;
        return (
          <Field key={f.name} label={f.label} hint={f.hint} className={cls}>
            {f.type === "money" ? <MoneyInput value={(v as number) ?? null} onChange={(x) => set(f.name, x)} />
              : f.type === "textarea" ? <Textarea value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} />
              : f.type === "select" ? (
                <Select value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value || null)}>
                  <option value="">{f.empty ?? "Choose…"}</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : f.type === "checks" ? (
                <div className="flex flex-wrap gap-2">
                  {f.options.map((o) => {
                    const arr = (v as (string | number)[]) ?? [];
                    const on = arr.includes(o.value);
                    return (
                      <label key={o.value} className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-line px-3 text-xs">
                        <input type="checkbox" checked={on} onChange={() => set(f.name, on ? arr.filter((x) => x !== o.value) : [...arr, o.value])} className="accent-[var(--brand)]" />
                        {o.label}
                      </label>
                    );
                  })}
                </div>
              ) : f.type === "number" ? (
                <Input type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step ?? "any"} value={v == null ? "" : String(v)} onChange={(e) => set(f.name, e.target.value === "" ? null : Number(e.target.value))} />
              ) : f.type === "color" ? (
                <div className="flex gap-2"><input type="color" value={(v as string) ?? "#5E6B33"} onChange={(e) => set(f.name, e.target.value)} className="h-11 w-14 cursor-pointer rounded-lg border-[1.5px] border-line" aria-label={f.label} /><Input value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} /></div>
              ) : (
                <Input type={f.type} placeholder={"placeholder" in f ? f.placeholder : undefined} value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} />
              )}
          </Field>
        );
      })}
    </div>
  );
}

/** Modal create/edit form. `initial` with an id means edit. */
export function FormModal({ open, title, fields, initial, onClose, onSave, saving, error, extra, wide }: {
  open: boolean; title: string; fields: FieldSpec[]; initial: Values | null; onClose: () => void; onSave: (v: Values) => void; saving?: boolean; error?: unknown; extra?: ReactNode; wide?: boolean;
}) {
  const [v, setV] = useState<Values>(initial ?? {});
  useEffect(() => setV(initial ?? {}), [initial, open]);
  const missing = fields.filter((f) => "required" in f && f.required && (v[f.name] == null || v[f.name] === "")).map((f) => f.label);
  return (
    <Modal open={open} onClose={onClose} title={title} wide={wide}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={missing.length > 0} onClick={() => onSave(v)}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <FormFields fields={fields} values={v} onChange={setV} />
        {extra}
        {missing.length > 0 && <p className="text-xs text-mute">Required: {missing.join(", ")}</p>}
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
