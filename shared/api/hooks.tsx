"use client";

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { API_MODE, ApiError, get, type ApiOptions, type AuthKind } from "./client";
import { subscribeRealtime } from "@/shared/realtime";
import { useToast } from "@/shared/ui/overlay";

/**
 * Data hooks. Query keys are ["api", auth, path, query] so a change anywhere can refresh what is on screen.
 * Realtime (KOT → KDS, order status, rider requests) arrives through shared/realtime and refreshes active queries.
 */

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2, refetchOnWindowFocus: API_MODE === "http" },
          mutations: { retry: false },
        },
      }),
  );
  useEffect(() => subscribeRealtime(() => client.invalidateQueries({ queryKey: ["api"] })), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function useQ<T>(path: string | null, opts: ApiOptions & { live?: boolean; enabled?: boolean; select?: (d: T) => T } = {}, q?: Partial<UseQueryOptions<T>>) {
  const { live, enabled = true, ...apiOpts } = opts;
  return useQuery<T>({
    queryKey: ["api", apiOpts.auth ?? "public", path, apiOpts.query ?? {}],
    queryFn: () => get<T>(path!, apiOpts),
    enabled: !!path && enabled,
    // Without websockets (http mode before Reverb is wired) live screens poll every 5 s.
    refetchInterval: live && API_MODE === "http" ? 5000 : undefined,
    ...q,
  });
}

/** Mutation that refreshes every query on success and shows API errors as a toast unless handled. */
export function useM<V, R>(fn: (v: V) => Promise<R>, o: { success?: string | ((r: R) => string); silentError?: boolean; onSuccess?: (r: R, v: V) => void; onError?: (e: ApiError) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<R, ApiError, V>({
    mutationFn: fn,
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ["api"] });
      if (o.success) toast(typeof o.success === "function" ? o.success(r) : o.success);
      o.onSuccess?.(r, v);
    },
    onError: (e) => {
      o.onError?.(e);
      if (!o.silentError && !(e.code === "approval_required" && o.onError)) toast(e.message, "err");
    },
  });
}

export type { AuthKind };
