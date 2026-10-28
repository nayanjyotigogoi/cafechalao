"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { getTenantSlug, getToken, setToken, type AuthKind } from "@/shared/api/client";
import { useQ } from "@/shared/api/hooks";
import { can as canP, type Permission } from "@/shared/lib/permissions";
import type { StaffSession } from "@/shared/types/api";
import type { Customer, PlatformAdmin, Rider, RoleKey } from "@/shared/types/entities";
import { Loading } from "@/shared/ui/primitives";

/** One signed-in identity per surface and café: staff (PIN), customer (Google/OTP), rider (OTP), control (L1). */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function useToken(kind: AuthKind) {
  return useSyncExternalStore(subscribe, () => getToken(kind), () => null);
}

export function signIn(kind: AuthKind, token: string) {
  setToken(kind, token);
  emit();
}
export function signOut(kind: AuthKind) {
  setToken(kind, null);
  emit();
}

/* ---------- staff ---------- */

export function useStaff() {
  const token = useToken("staff");
  const q = useQ<StaffSession>(token ? "/auth/staff/me" : null, { auth: "staff" }, { staleTime: 60_000, retry: false });
  const can = useCallback((p: Permission) => canP(q.data?.permissions, p), [q.data]);
  return { token, session: q.data ?? null, loading: !!token && q.isLoading, error: q.error, can };
}

/**
 * Guards staff screens. Redirects to the PIN screen when signed out, when the role lacks the permission,
 * and after 15 minutes without a tap on a shared device (SRS 9 security).
 */
export function StaffGate({ perm, anyOf, roles, children, idleMinutes = 15 }: { perm?: Permission; anyOf?: Permission[]; roles?: RoleKey[]; children: (s: StaffSession) => ReactNode; idleMinutes?: number }) {
  const { token, session, loading, error, can } = useStaff();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const last = useRef(Date.now());

  useEffect(() => {
    if (!token || (error && (error as { status?: number }).status === 401)) {
      if (error) signOut("staff");
      router.replace(`/staff?next=${encodeURIComponent(path)}`);
    }
  }, [token, error, router, path]);

  useEffect(() => {
    const bump = () => (last.current = Date.now());
    const evs = ["pointerdown", "keydown"];
    evs.forEach((e) => window.addEventListener(e, bump));
    const t = setInterval(() => {
      if (Date.now() - last.current > idleMinutes * 60000) {
        signOut("staff");
        qc.clear();
        router.replace(`/staff?next=${encodeURIComponent(path)}&locked=1`);
      }
    }, 30000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [idleMinutes, path, qc, router]);

  if (!token || loading || !session) return <Loading />;
  const allowed = (!perm || can(perm)) && (!anyOf || anyOf.some(can)) && (!roles || roles.includes(session.user.role));
  if (!allowed) {
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="font-disp text-2xl font-bold">Not for your role</h1>
        <p className="text-sm text-mute">{session.user.name}, your role can&apos;t open this screen. Ask the owner to change permissions in Settings → Roles.</p>
        <button className="text-brand underline" onClick={() => { signOut("staff"); router.replace("/staff"); }}>
          Log out
        </button>
      </div>
    );
  }
  return <>{children(session)}</>;
}

/* ---------- customer ---------- */

export function useCustomer() {
  const token = useToken("customer");
  const q = useQ<{ customer: Customer; needs_profile: boolean }>(token ? "/me" : null, { auth: "customer" }, { retry: false });
  useEffect(() => {
    if ((q.error as { status?: number } | null)?.status === 401) signOut("customer");
  }, [q.error]);
  return { token, customer: q.data?.customer ?? null, needsProfile: q.data?.needs_profile ?? false, loading: !!token && q.isLoading };
}

/* ---------- rider ---------- */

export function useRider() {
  const token = useToken("rider");
  const q = useQ<Rider>(token ? "/rider/me" : null, { auth: "rider" }, { retry: false });
  useEffect(() => {
    if ((q.error as { status?: number } | null)?.status === 401) signOut("rider");
  }, [q.error]);
  return { token, rider: q.data ?? null, loading: !!token && q.isLoading };
}

/* ---------- control panel ---------- */

export function useAdmin() {
  const token = useToken("control");
  const admin = useSyncExternalStore(
    subscribe,
    () => (typeof localStorage !== "undefined" ? localStorage.getItem("cc.control.admin") : null),
    () => null,
  );
  return { token, admin: admin ? (JSON.parse(admin) as PlatformAdmin) : null };
}
export function setAdmin(a: PlatformAdmin | null) {
  try {
    if (a) localStorage.setItem("cc.control.admin", JSON.stringify(a));
    else localStorage.removeItem("cc.control.admin");
  } catch {}
  emit();
}

export const currentTenant = () => getTenantSlug();
