import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, errorMessage, type ApiResult } from "./api";

type Params = Record<string, string | number | boolean | null | undefined>;

/** GET a resource. The previous page stays visible while the next one loads (no layout jump when paginating). */
export function useApi<T = any>(path: string | null, params?: Params, opts?: { refetchInterval?: number }) {
  return useQuery<ApiResult<T>>({
    queryKey: [path, params ?? null],
    queryFn: () => api.get<T>(path!, params),
    enabled: !!path,
    placeholderData: keepPreviousData,
    refetchInterval: opts?.refetchInterval,
  });
}

/**
 * Mutation with consistent UX: success toast, error toast, and a refresh of every cached list
 * so screens never show stale totals after a change.
 */
export function useAction<TVars = void, TData = any>(
  fn: (vars: TVars) => Promise<ApiResult<TData>>,
  opts: { success?: string | ((data: TData, vars: TVars) => string | null); onSuccess?: (data: TData, vars: TVars) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      const msg = typeof opts.success === "function" ? opts.success(res.data, vars) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(res.data, vars);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(errorMessage(e));
    },
  });
}

/**
 * Filter state kept in the URL query string, so filters survive refresh, back/forward and can be shared as a link.
 * Changing any filter other than `page` resets to page 1.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const [sp, setSp] = useSearchParams();
  const values = Object.fromEntries(Object.keys(defaults).map((k) => [k, sp.get(k) ?? defaults[k]])) as T;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const set = useCallback(
    (patch: Partial<T> & { page?: number }) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!("page" in patch)) next.delete("page");
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === "" || v === (defaults as any)[k] || (k === "page" && v === 1)) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSp], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { values, page, set };
}
