/** Thin fetch wrapper for the DealerLink REST API. Responses are `{ data, meta? }` or `{ error }`. */

let csrfToken = "";
export const setCsrfToken = (t: string) => {
  csrfToken = t;
};

/**
 * Per-tab session. The token lives in this tab's sessionStorage (never shared with other tabs, gone when the tab
 * closes) and is sent in a header, so signing in or out in one tab never affects another. If storage is
 * unavailable the token is kept in memory only (the session then ends on reload).
 */
const TOKEN_KEY = "dl_session";
let memoryToken: string | null = null;

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}
export function setSessionToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: memory copy is used */
  }
}
export const clearSession = () => {
  setSessionToken(null);
  csrfToken = "";
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

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...extraHeaders };
  const token = readToken();
  if (token) headers["X-DL-Session"] = token;
  const isFile = body instanceof Blob;
  if (method !== "GET") {
    headers["X-DL-Client"] = "web";
    headers["X-CSRF-Token"] = csrfToken;
    headers["Content-Type"] = isFile ? (body as Blob).type || "application/octet-stream" : "application/json";
  }
  let res: Response;
  try {
    const payload = method === "GET" ? undefined : isFile ? (body as Blob) : JSON.stringify(body ?? {});
    res = await fetch(`/api${path}`, { method, headers, credentials: "omit", body: payload });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check your internet connection and try again.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const e = json?.error;
    // This tab's session ended (expired, signed out, account deactivated): forget the stored token.
    if (res.status === 401 && e?.code === "UNAUTHENTICATED") clearSession();
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? "Something went wrong. Please try again.", e?.details);
  }
  if (json.data && typeof json.data === "object") {
    if (typeof json.data.csrfToken === "string") csrfToken = json.data.csrfToken;
    // Only login / register / accept-invite return a token. Keep it out of the data the UI sees.
    if (typeof json.data.sessionToken === "string") {
      setSessionToken(json.data.sessionToken);
      delete json.data.sessionToken;
    }
  }
  return json as ApiResult<T>;
}

export const api = {
  get: <T = any>(path: string, params?: Params) => request<T>("GET", path + qs(params)),
  post: <T = any>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>("POST", path, body, headers),
  put: <T = any>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T = any>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T = any>(path: string) => request<T>("DELETE", path),
  /** Sends a file (e.g. a compressed photo) as the raw request body. */
  upload: <T = any>(path: string, file: Blob) => request<T>("POST", path, file),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
