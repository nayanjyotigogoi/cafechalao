"use client";

import { useEffect, useRef } from "react";
import { authApi } from "@/modules/auth/api";
import { useToast } from "@/shared/ui/overlay";

/**
 * Real Google sign-in (Google Identity Services). Shown only when the API reports a GOOGLE_CLIENT_ID;
 * the ID token goes to /auth/google, where Laravel verifies it with Google.
 */
declare global {
  interface Window { google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } } }
}

export function GoogleButton({ clientId, onSignedIn }: { clientId: string; onSignedIn: (r: { token: string; needs_profile: boolean }) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  useEffect(() => {
    const render = () => {
      if (!window.google || !box.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (res: { credential: string }) => {
          try { onSignedIn(await authApi.google({ credential: res.credential })); } catch (e) { toast(e instanceof Error ? e.message : "Google sign-in failed", "err"); }
        },
      });
      window.google.accounts.id.renderButton(box.current, { theme: "outline", size: "large", width: 320, text: "continue_with" });
    };
    if (window.google) return render();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [clientId, onSignedIn, toast]);
  return <div ref={box} className="flex min-h-11 justify-center" />;
}
