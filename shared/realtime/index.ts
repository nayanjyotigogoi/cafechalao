import { API_MODE } from "@/shared/api/client";

/**
 * Realtime channel (SRS 14: Laravel Reverb or Pusher) for KOT → KDS, order status and rider requests.
 * mock mode: changes from any open tab arrive through the mock database's BroadcastChannel.
 * http mode: connect Laravel Echo here (private-tenant.{id} channel); until then screens poll (see useQ live).
 * Screens only call subscribeRealtime, so swapping the transport never touches them.
 */
export function subscribeRealtime(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 120);
  };
  let off: (() => void) | null = null;
  let cancelled = false;
  if (API_MODE === "mock") {
    import("@/mock/db").then(({ onChange: listen }) => {
      if (cancelled) return;
      const un = listen(fire);
      off = () => void un();
    });
  }
  return () => {
    cancelled = true;
    off?.();
    if (timer) clearTimeout(timer);
  };
}

/** Plays a short beep for new KOTs / ready alerts (kitchen and captain screens). */
export function beep(freq = 880, ms = 160) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    o.start();
    o.stop(ctx.currentTime + ms / 1000);
  } catch {
    /* audio blocked until the user taps */
  }
}
