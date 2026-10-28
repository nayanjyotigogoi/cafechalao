"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api, ApiError, type ApiOptions } from "@/shared/api/client";

/**
 * Offline mode for POS, captain and KDS (M11.3, SRS 9).
 * Writes that fail because the network is down go into an outbox (localStorage) with their Idempotency-Key,
 * and are replayed in order when the connection returns, so nothing is charged or created twice.
 * Bills printed offline use a device invoice series (OFF-<device>-<n>) so numbers never clash; the server
 * keeps that number on sync.
 */

interface QueuedOp { id: string; method: "POST" | "PATCH" | "PUT" | "DELETE"; path: string; opts: ApiOptions; label: string; at: number }

const KEY = "cc.outbox";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(): QueuedOp[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function write(ops: QueuedOp[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ops)); } catch {}
  emit();
}
export function useOutbox(): number {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => (typeof window === "undefined" ? 0 : read().length), () => 0);
}

export function useOnline() {
  const online = useSyncExternalStore(
    (l) => {
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => {
        window.removeEventListener("online", l);
        window.removeEventListener("offline", l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  useEffect(() => {
    if (online) void flush();
  }, [online]);
  return online;
}

/** Runs a write now, or queues it if the device is offline. Returns null when queued. */
export async function sendOrQueue<T>(method: QueuedOp["method"], path: string, opts: ApiOptions & { idempotencyKey: string }, label: string): Promise<T | null> {
  try {
    return await api<T>(method, path, opts);
  } catch (e) {
    if (e instanceof ApiError && e.code === "offline") {
      write([...read(), { id: opts.idempotencyKey, method, path, opts, label, at: Date.now() }]);
      return null;
    }
    throw e;
  }
}

let flushing = false;
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    let ops = read();
    while (ops.length) {
      const op = ops[0];
      try {
        await api(op.method, op.path, op.opts);
      } catch (e) {
        if (e instanceof ApiError && e.code === "offline") break; // still offline: try later
        // A conflict or validation error is surfaced to the manager instead of retrying forever.
        console.warn("[outbox] dropped", op.label, e);
      }
      ops = ops.slice(1);
      write(ops);
    }
  } finally {
    flushing = false;
  }
}

export function deviceCode(): string {
  try {
    let d = localStorage.getItem("cc.device");
    if (!d) {
      d = Math.random().toString(36).slice(2, 6).toUpperCase();
      localStorage.setItem("cc.device", d);
    }
    return d;
  } catch {
    return "WEB";
  }
}

export function nextOfflineInvoiceNo(): string {
  const k = "cc.offline.series";
  const n = Number(localStorage.getItem(k) ?? "0") + 1;
  localStorage.setItem(k, String(n));
  return `OFF-${deviceCode()}-${String(n).padStart(5, "0")}`;
}

