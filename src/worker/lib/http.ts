import type { Context } from "hono";
import type { ZodType } from "zod";
import type { AuthCtx } from "./auth";

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ALLOWED_ORIGINS?: string;
  ALLOW_DEMO_ACCOUNTS?: string;
  DEV_SHOW_RESET_LINKS?: string;
  PASSWORD_HASH_ITERATIONS?: string;
};
export type AppEnv = { Bindings: Bindings; Variables: { auth: AuthCtx | null } };
export type Ctx = Context<AppEnv>;

export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what = "Record") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You do not have access to this resource") => new AppError(403, "FORBIDDEN", message);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
export const invalid = (message: string, details?: unknown) => new AppError(422, "VALIDATION_ERROR", message, details);

const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());

/** DB rows are snake_case; the API is camelCase. Converts keys recursively. */
export function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[toCamel(k)] = camelize(v);
    return out;
  }
  return value;
}

/** Every successful response is `{ data, meta? }`; every failure is `{ error: { code, message, details? } }`. */
export function ok(c: Ctx, data: unknown, meta?: Record<string, unknown>, status: 200 | 201 = 200) {
  return c.json(meta ? { data: camelize(data), meta: camelize(meta) } : { data: camelize(data) }, status);
}

export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw invalid(issues[0] ? `${issues[0].path ? issues[0].path + ": " : ""}${issues[0].message}` : "Invalid input", issues);
  }
  return result.data;
}

export async function body<T>(c: Ctx, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new AppError(400, "BAD_REQUEST", "Request body must be valid JSON");
  }
  return parse(schema, json);
}

export function pageParams(c: Ctx, defaultSize = 20) {
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(c.req.query("pageSize")) || defaultSize)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

/** Escapes LIKE wildcards so user search text is always treated literally. */
export const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Reads an optional `from`/`to` (IST dates) range from the query string, defaulting to the last 30 days. */
export function dateRange(c: Ctx, defaultDays = 30) {
  const today = istDate(new Date());
  let from = c.req.query("from");
  let to = c.req.query("to");
  if (!to || !DATE_RE.test(to)) to = today;
  if (!from || !DATE_RE.test(from)) from = istDate(new Date(Date.now() - (defaultDays - 1) * 86400000));
  if (from > to) throw invalid("The start date must be before the end date");
  return { from, to };
}

/** The calendar date in India for a given instant. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
/** SQL fragment converting a UTC timestamp column to an IST calendar date. */
export const istDateSql = (col: string) => `date(${col}, '+330 minutes')`;
