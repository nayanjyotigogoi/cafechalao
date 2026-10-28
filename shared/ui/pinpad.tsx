"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/shared/lib/format";

/** 4–6 digit PIN pad for shared devices (staff login, attendance, manager approval). Works with a keyboard too. */
export function PinPad({ onSubmit, length, busy, error, label = "Enter PIN" }: { onSubmit: (pin: string) => void; /** auto-submit when this many digits are typed; omit to allow 4–6 digits with OK */ length?: number; busy?: boolean; error?: string | null; label?: string }) {
  const [pin, setPin] = useState("");
  const pinRef = useRef("");
  pinRef.current = pin;
  useEffect(() => {
    if (error) setPin("");
  }, [error]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter" && pinRef.current.length >= 4) {
        onSubmit(pinRef.current);
        setPin("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSubmit]);
  useEffect(() => {
    if (length && pin.length === length && !busy) {
      onSubmit(pin);
      setPin("");
    }
  }, [pin, length, onSubmit, busy]);

  const press = (k: string) => {
    if (k === "⌫") setPin((p) => p.slice(0, -1));
    else if (k === "OK") {
      if (pin.length >= 4) {
        onSubmit(pin);
        setPin("");
      }
    }
    else setPin((p) => (p.length < 6 ? p + k : p));
  };

  return (
    <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-4">
      <div className="text-sm text-mute">{label}</div>
      <div className="flex gap-3" aria-live="polite" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(length ?? 4, pin.length) }).map((_, i) => (
          <span key={i} className={cx("size-4 rounded-full border-2", i < pin.length ? "border-brand bg-brand" : "border-line")} />
        ))}
      </div>
      {error && <div className="text-sm text-rose" role="alert">{error}</div>}
      <div className="grid w-full grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy}
            onClick={() => press(k)}
            className={cx(
              "num min-h-16 cursor-pointer rounded-2xl border-[1.5px] text-2xl font-semibold active:scale-95",
              k === "OK" ? "border-brand bg-brand text-base text-on-brand" : "border-line bg-paper hover:bg-fill/60",
            )}
            aria-label={k === "⌫" ? "Delete" : k}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
