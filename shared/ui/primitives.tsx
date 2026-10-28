"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "@/shared/lib/format";
import { formatINR } from "@/shared/lib/money";
import type { FoodType } from "@/shared/types/entities";

/** Component library (shared/ui): one Button, one Card, one Chip ... used by all six surfaces. */

type Variant = "primary" | "outline" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; block?: boolean }>(
  function Button({ variant = "outline", size = "md", loading, block, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          "inline-flex items-center justify-center gap-2 rounded-xl border-[1.5px] font-semibold transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap",
          size === "sm" && "min-h-9 px-3 text-[13px]",
          size === "md" && "min-h-11 px-4 text-sm",
          size === "lg" && "min-h-12 px-5 text-base",
          variant === "primary" && "bg-brand border-brand text-on-brand hover:brightness-110",
          variant === "outline" && "border-ink/80 bg-transparent text-ink hover:bg-fill/60",
          variant === "ghost" && "border-transparent bg-transparent text-ink hover:bg-fill/60",
          variant === "soft" && "border-transparent bg-fill text-ink hover:brightness-95",
          variant === "danger" && "border-rose text-rose bg-transparent hover:bg-rose/10",
          block && "w-full",
          className,
        )}
        {...rest}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  },
);

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-2xl border-[1.5px] border-line bg-paper p-4", className)} {...rest}>
      {children}
    </div>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "hot" | "brand" | "info" | "on";
const toneCls: Record<Tone, string> = {
  neutral: "border-line text-ink",
  ok: "border-ok text-ok",
  warn: "border-warn text-warn",
  hot: "border-rose text-rose",
  brand: "border-brand text-brand",
  info: "border-info text-info",
  on: "bg-ink text-bg border-ink",
};

export function Chip({ tone = "neutral", className, children, onClick, active, title }: { tone?: Tone; className?: string; children: ReactNode; onClick?: () => void; active?: boolean; title?: string }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-pressed={onClick ? !!active : undefined}
      className={cx(
        "inline-flex min-h-[30px] items-center gap-1 whitespace-nowrap rounded-full border-[1.5px] px-3 text-xs font-medium",
        toneCls[active ? "on" : tone],
        onClick && "cursor-pointer min-h-9",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-[11px] font-medium uppercase tracking-[0.06em] text-mute", className)}>{children}</div>;
}

export function Field({ label, error, hint, children, className }: { label?: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      {label && <Label>{label}</Label>}
      {children}
      {error ? <span className="text-xs text-rose">{error}</span> : hint ? <span className="text-xs text-mute">{hint}</span> : null}
    </label>
  );
}

const inputCls = "min-h-11 w-full min-w-0 rounded-lg border-[1.5px] border-line bg-paper px-3 text-sm text-ink placeholder:text-mute focus:border-brand focus:outline-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputCls, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputCls, "min-h-20 py-2", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(inputCls, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

/** Rupee input that stores paise. */
export function MoneyInput({ value, onChange, ...rest }: { value: number | null | undefined; onChange: (paise: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mute">₹</span>
      <Input
        inputMode="decimal"
        className="pl-7 num"
        value={value == null ? "" : String(value / 100)}
        onChange={(e) => onChange(Math.round(Number(e.target.value.replace(/[^\d.]/g, "") || 0) * 100))}
        {...rest}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm", disabled && "opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 shrink-0 rounded-full border-[1.5px] transition-colors", checked ? "border-brand bg-brand" : "border-line bg-fill")}
      >
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-paper shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Money({ value, className, decimals }: { value: number; className?: string; decimals?: boolean }) {
  return <span className={cx("num", className)}>{formatINR(value, { decimals })}</span>;
}

export function Stat({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "hot"; className?: string }) {
  return (
    <Card className={cx("flex flex-col gap-1", tone === "warn" && "border-warn", tone === "hot" && "border-rose", className)}>
      <Label>{label}</Label>
      <div className={cx("num font-disp text-2xl font-extrabold leading-tight", tone === "warn" && "text-warn", tone === "hot" && "text-rose")}>{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </Card>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line px-6 py-10 text-center">
      <div className="font-disp text-lg font-bold">{title}</div>
      {children && <p className="max-w-md text-sm text-mute">{children}</p>}
      {action}
    </div>
  );
}

/** Veg / non-veg / egg mark: colour plus shape so it reads without colour (SRS 9 accessibility). */
export function FoodMark({ type, withLabel }: { type: FoodType; withLabel?: boolean }) {
  const c = type === "veg" ? "#2e8b47" : type === "egg" ? "#c98a0b" : "#b3261e";
  const text = type === "veg" ? "Veg" : type === "egg" ? "Egg" : "Non-veg";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-mute" title={text}>
      <span className="grid size-3.5 place-items-center border-[1.5px]" style={{ borderColor: c }} aria-hidden>
        {type === "non_veg" ? (
          <span className="size-0 border-x-[4px] border-b-[6px] border-x-transparent" style={{ borderBottomColor: c }} />
        ) : (
          <span className="size-1.5 rounded-full" style={{ background: c }} />
        )}
      </span>
      {withLabel && text}
      <span className="sr-only">{text}</span>
    </span>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  // Many tabs on a phone: one dropdown instead of a strip that has to be scrolled sideways.
  const many = options.length > 3;
  return (
    <>
    {many && (
      <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label="Section"
        className={cx("min-h-11 w-full rounded-xl border-[1.5px] border-line bg-fill px-3 text-sm font-semibold sm:hidden", className)}>
        {options.map((o) => <option key={o.value} value={o.value}>{typeof o.label === "string" ? o.label : o.value}{o.count != null ? ` (${o.count})` : ""}</option>)}
      </select>
    )}
    <div role="tablist" className={cx("scrollbar-none max-w-full gap-1 overflow-x-auto rounded-xl bg-fill p-1", many ? "hidden sm:flex" : "flex", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("min-h-9 shrink-0 cursor-pointer rounded-lg px-3 text-[13px] font-medium", o.value === value ? "bg-paper font-semibold shadow-sm" : "text-ink/80")}
        >
          {o.label}
          {o.count != null && <span className="num ml-1.5 text-[11px] text-mute">{o.count}</span>}
        </button>
      ))}
    </div>
    </>
  );
}

export function Avatar({ name, color, size = 36 }: { name: string; color?: string; size?: number }) {
  const ini = name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: color ?? "var(--brand)", fontSize: size * 0.38 }}>
      {ini}
    </span>
  );
}

export function Stars({ value, onChange, size = 28 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <div className="flex gap-1" role={onChange ? "radiogroup" : undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onChange?.(n)}
          className={cx("leading-none", onChange && "cursor-pointer")}
          style={{ fontSize: size, color: n <= value ? "#e0a100" : "var(--line)" }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-disp text-2xl font-extrabold leading-tight sm:text-[28px]">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-mute">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ProgressBar({ value, tone }: { value: number; tone?: "ok" | "warn" | "hot" }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-fill">
      <div className={cx("h-full rounded", tone === "warn" ? "bg-warn" : tone === "hot" ? "bg-rose" : tone === "ok" ? "bg-ok" : "bg-brand")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p role="alert" className="rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose">{msg}</p>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-mute">
      <Spinner /> {label}
    </div>
  );
}
