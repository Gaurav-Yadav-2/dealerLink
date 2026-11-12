import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_IDLE_HOURS, SESSION_TTL_DAYS } from "../src/shared/constants";
import { sha256Hex } from "../src/worker/lib/crypto";
import { requireHuman } from "../src/worker/lib/turnstile";
import { addRetailer, Client, db, PASSWORD, registerOwner } from "./helpers";

const sessionRow = async (c: Client) =>
  db.prepare("SELECT id, expires_at, created_at, last_seen_at FROM sessions WHERE token_hash = ?").bind(await sha256Hex(c.token)).first<any>();

describe("session lifetime", () => {
  it("new sessions last at most 7 days and record activity", async () => {
    const a = await registerOwner("Ttl");
    const row = await sessionRow(a.client);
    const days = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 86400000;
    expect(SESSION_TTL_DAYS).toBe(7);
    expect(Math.round(days)).toBe(7);
    expect(row.last_seen_at).toBe(row.created_at);
  });

  it(`ends a session after ${SESSION_IDLE_HOURS} hours without activity`, async () => {
    const a = await registerOwner("Idle");
    const row = await sessionRow(a.client);
    const stale = new Date(Date.now() - (SESSION_IDLE_HOURS * 3600 + 60) * 1000).toISOString();
    await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(stale, row.id).run();
    expect((await a.client.get("/api/biz/products")).status).toBe(401);
    // the idle session is deleted, not just refused
    expect(await db.prepare("SELECT 1 FROM sessions WHERE id = ?").bind(row.id).first()).toBeNull();
  });

  it("activity keeps a session alive and is recorded at most every 5 minutes", async () => {
    const a = await registerOwner("Active");
    const row = await sessionRow(a.client);
    const recent = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago: not rewritten
    await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(recent, row.id).run();
    expect((await a.client.get("/api/biz/products")).status).toBe(200);
    expect((await sessionRow(a.client)).last_seen_at).toBe(recent);
    const older = new Date(Date.now() - (SESSION_IDLE_HOURS - 1) * 3600 * 1000).toISOString(); // inside the limit
    await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(older, row.id).run();
    expect((await a.client.get("/api/biz/products")).status).toBe(200);
    const refreshed = (await sessionRow(a.client)).last_seen_at;
    expect(Date.now() - Date.parse(refreshed)).toBeLessThan(60 * 1000);
  });
});

describe("sign out of all devices", () => {
  it("ends every session of that user, including the current one, and nobody else's", async () => {
    const a = await registerOwner("All");
    const phone = new Client();
    await phone.post("/api/auth/login", { email: a.email, password: PASSWORD });
    const r = await addRetailer(a.client);
    expect((await phone.get("/api/biz/products")).status).toBe(200);

    const res = await a.client.post("/api/auth/logout-all");
    expect(res.status).toBe(200);
    expect(res.data.sessionsEnded).toBe(2);
    expect((await a.client.get("/api/biz/products")).status).toBe(401);
    expect((await phone.get("/api/biz/products")).status).toBe(401);
    // the retailer (another user) stays signed in
    expect((await r.client.get("/api/retailer/products")).status).toBe(200);
    const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'user.signed_out_everywhere' AND actor_user_id = ?").bind(a.user.id).first<any>();
    expect(audit.n).toBe(1);
  });

  it("requires sign-in and the CSRF token", async () => {
    expect((await new Client().post("/api/auth/logout-all")).status).toBe(401);
    const a = await registerOwner("AllCsrf");
    const forged = await a.client.raw("POST", "/api/auth/logout-all", {}, { "x-dl-client": "web", "x-dl-session": a.client.token });
    expect(forged.status).toBe(403);
    expect((await a.client.get("/api/biz/products")).status).toBe(200);
  });
});

describe("bot check (Cloudflare Turnstile)", () => {
  afterEach(() => vi.restoreAllMocks());

  const ctx = (headers: Record<string, string>, secret?: string) =>
    ({ env: { TURNSTILE_SECRET_KEY: secret }, req: { header: (n: string) => headers[n.toLowerCase()] } }) as any;

  it("is off when no secret is configured (the default), so sign-in works without it", async () => {
    await expect(requireHuman(ctx({}))).resolves.toBeUndefined();
    const cfg = await new Client().get("/api/auth/config");
    expect(cfg.data).toEqual({ turnstileSiteKey: null });
    expect((await registerOwner("NoCaptcha")).user.role).toBe("owner");
  });

  it("rejects a request without a token when switched on", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(requireHuman(ctx({}, "secret"))).rejects.toMatchObject({ status: 403, code: "CAPTCHA_REQUIRED" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("verifies the token with Cloudflare and accepts only a successful result", async () => {
    const calls: { url: string; body: FormData }[] = [];
    let success = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      calls.push({ url: String(input), body: init.body });
      return Response.json({ success });
    });
    await expect(requireHuman(ctx({ "x-turnstile-token": "tok-1", "cf-connecting-ip": "203.0.113.9" }, "s3cret"))).resolves.toBeUndefined();
    expect(calls[0].url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(calls[0].body.get("secret")).toBe("s3cret");
    expect(calls[0].body.get("response")).toBe("tok-1");
    expect(calls[0].body.get("remoteip")).toBe("203.0.113.9");
    success = false;
    await expect(requireHuman(ctx({ "x-turnstile-token": "tok-2" }, "s3cret"))).rejects.toMatchObject({ status: 403, code: "CAPTCHA_FAILED" });
  });

  it("fails closed if Cloudflare cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(requireHuman(ctx({ "x-turnstile-token": "tok" }, "s3cret"))).rejects.toMatchObject({ status: 403, code: "CAPTCHA_UNAVAILABLE" });
  });
});
