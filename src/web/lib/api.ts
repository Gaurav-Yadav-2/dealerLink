/** Thin fetch wrapper for the DealerLink REST API. Responses are `{ data, meta? }` or `{ error }`. */

let csrfToken = "";
export const setCsrfToken = (t: string) => {
  csrfToken = t;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path?: string; message: string }[] | unknown,
  ) {
    super(message);
  }
}

export type ApiResult<T> = { data: T; meta?: any };
type Params = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Params): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["X-DL-Client"] = "web";
    headers["X-CSRF-Token"] = csrfToken;
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, credentials: "same-origin", body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check your internet connection and try again.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? "Something went wrong. Please try again.", e?.details);
  }
  if (json.data && typeof json.data === "object" && typeof json.data.csrfToken === "string") csrfToken = json.data.csrfToken;
  return json as ApiResult<T>;
}

export const api = {
  get: <T = any>(path: string, params?: Params) => request<T>("GET", path + qs(params)),
  post: <T = any>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T = any>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T = any>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T = any>(path: string) => request<T>("DELETE", path),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
