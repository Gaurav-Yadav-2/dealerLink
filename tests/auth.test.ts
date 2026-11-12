import { describe, expect, it } from "vitest";
import { hashPassword } from "../src/worker/lib/crypto";
import { addRetailer, Client, createAdmin, db, ORIGIN, PASSWORD, phone, registerOwner } from "./helpers";

describe("registration and sessions", () => {
  it("registers an owner, creates the business with a unique slug and signs them in", async () => {
    const a = await registerOwner("Sharma Traders");
    expect(a.user.role).toBe("owner");
    expect(a.business.slug).toMatch(/^sharma-traders-/);
    const me = await a.client.get("/api/auth/me");
    expect(me.data.user.email).toBe(a.email);
    expect(me.data.business.id).toBe(a.business.id);
  });

  it("never returns password hashes or session tokens in any auth response", async () => {
    const a = await registerOwner();
    const me = await a.client.get("/api/auth/me");
    const text = JSON.stringify(me.data);
    expect(text).not.toMatch(/password|pbkdf2|token_hash|tokenHash/i);
    const stored = await db.prepare("SELECT password_hash FROM users WHERE email = ?").bind(a.email).first<any>();
    expect(stored.password_hash.startsWith("pbkdf2$")).toBe(true);
    expect(stored.password_hash).not.toContain(PASSWORD);
    // session token is stored hashed, never raw
    const token = a.client.token;
    expect(token.length).toBeGreaterThan(20);
    expect(JSON.stringify(me.data)).not.toContain(token); // the token is returned once at sign-in, never by /me
    const rawMatch = await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?").bind(token).first<any>();
    expect(rawMatch.n).toBe(0);
  });

  it("uses no cookies: the session token is returned once and sent in a header", async () => {
    const c = new Client();
    const res = await c.post("/api/auth/register", { name: "Header Test", email: `h-${Date.now()}@example.com`, password: PASSWORD, phone: phone(), businessName: "Header Biz " + Date.now() });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(c.token).toBeTruthy();
    // an unrelated client that has no token is not signed in, whatever else it sends
    const other = new Client();
    expect((await other.get("/api/biz/products")).status).toBe(401);
    expect((await other.raw("GET", "/api/biz/products", undefined, { cookie: "dl_session=" + c.token })).status).toBe(401);
  });

  it("each tab has its own session: signing out or in on one never affects another", async () => {
    const a = await registerOwner("Tabs");
    const tab2 = new Client();
    expect((await tab2.post("/api/auth/login", { email: a.email, password: PASSWORD })).status).toBe(200);
    expect(tab2.token).not.toBe(a.client.token);
    // two independent sessions for the same user
    expect((await a.client.get("/api/biz/products")).status).toBe(200);
    expect((await tab2.get("/api/biz/products")).status).toBe(200);
    // sign out of tab 2: tab 1 is still signed in
    expect((await tab2.post("/api/auth/logout")).status).toBe(200);
    expect((await tab2.get("/api/biz/products")).status).toBe(401);
    expect((await a.client.get("/api/biz/products")).status).toBe(200);
    // a different user can be signed in on another tab at the same time
    const r = await addRetailer(a.client);
    expect((await r.client.get("/api/retailer/products")).status).toBe(200);
    expect((await a.client.get("/api/biz/products")).status).toBe(200);
    expect((await a.client.post("/api/auth/logout")).status).toBe(200);
    expect((await r.client.get("/api/retailer/products")).status).toBe(200);
  });

  it("rejects duplicate emails and duplicate business names", async () => {
    const a = await registerOwner();
    const c = new Client();
    const dupEmail = await c.post("/api/auth/register", { name: "Other", email: a.email, password: PASSWORD, phone: phone(), businessName: "Unique " + Date.now() });
    expect(dupEmail.status).toBe(409);
    const dupName = await c.post("/api/auth/register", { name: "Other", email: `x-${Date.now()}@example.com`, password: PASSWORD, phone: phone(), businessName: a.businessName.toUpperCase() });
    expect(dupName.status).toBe(409);
  });

  it("validates registration input", async () => {
    const c = new Client();
    const res = await c.post("/api/auth/register", { name: "A", email: "nope", password: "weak", phone: "123", businessName: "" });
    expect(res.status).toBe(422);
    expect(res.error!.code).toBe("VALIDATION_ERROR");
    expect(res.error!.details.length).toBeGreaterThan(2);
  });

  it("logs in with correct credentials only, with a generic error otherwise", async () => {
    const a = await registerOwner();
    const c = new Client();
    const bad = await c.post("/api/auth/login", { email: a.email, password: "wrong-password1" });
    expect(bad.status).toBe(401);
    const unknown = await c.post("/api/auth/login", { email: "nobody@example.com", password: "wrong-password1" });
    expect(unknown.status).toBe(401);
    expect(unknown.error!.message).toBe(bad.error!.message);
    const good = await c.post("/api/auth/login", { email: a.email.toUpperCase(), password: PASSWORD });
    expect(good.status).toBe(200);
    expect(good.data.user.email).toBe(a.email);
  });

  it("logout invalidates the session server-side", async () => {
    const a = await registerOwner();
    const stolen = a.client.token;
    expect((await a.client.post("/api/auth/logout")).status).toBe(200);
    const replay = new Client();
    replay.token = stolen;
    expect((await replay.get("/api/biz/products")).status).toBe(401);
  });

  it("rate limits repeated failed logins", async () => {
    const a = await registerOwner();
    const c = new Client();
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await c.post("/api/auth/login", { email: a.email, password: "wrong-password1" })).status;
    expect(last).toBe(429);
    // even the right password is refused while limited
    expect((await c.post("/api/auth/login", { email: a.email, password: PASSWORD })).status).toBe(429);
  });

  it("blocks demo accounts unless explicitly enabled", async () => {
    const email = `demo-${Date.now()}@example.com`;
    const ts = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, email, password_hash, name, role, is_demo, created_at, updated_at) VALUES (?,?,?,?,'admin',1,?,?)")
      .bind(crypto.randomUUID(), email, await hashPassword(PASSWORD), "Demo", ts, ts).run();
    const res = await new Client().post("/api/auth/login", { email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.error!.code).toBe("DEMO_DISABLED");
  });
});

describe("CSRF and origin protection", () => {
  it("rejects authenticated mutations without the CSRF token", async () => {
    const a = await registerOwner();
    const res = await a.client.raw("POST", "/api/biz/categories", { name: "Hack" }, { "x-dl-client": "web", origin: ORIGIN });
    expect(res.status).toBe(403);
    expect(res.error!.code).toBe("CSRF");
    const wrong = await a.client.raw("POST", "/api/biz/categories", { name: "Hack" }, { "x-dl-client": "web", origin: ORIGIN, "x-csrf-token": "guess" });
    expect(wrong.status).toBe(403);
  });

  it("rejects mutations without the custom client header (plain cross-site form posts)", async () => {
    const a = await registerOwner();
    const res = await a.client.raw("POST", "/api/biz/categories", { name: "Hack" }, { "x-csrf-token": a.client.csrf });
    expect(res.status).toBe(403);
  });

  it("rejects mutations from a foreign origin and sends no CORS grant", async () => {
    const a = await registerOwner();
    const res = await a.client.raw("POST", "/api/biz/categories", { name: "Hack" }, { "x-dl-client": "web", "x-csrf-token": a.client.csrf, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.error!.code).toBe("BAD_ORIGIN");
    const get = await a.client.raw("GET", "/api/auth/me", undefined, { origin: "https://evil.example" });
    expect(get.headers.get("access-control-allow-origin")).toBeNull();
    const trusted = await a.client.raw("GET", "/api/auth/me", undefined, { origin: "http://trusted.test" });
    expect(trusted.headers.get("access-control-allow-origin")).toBe("http://trusted.test");
  });
});

describe("role-based access control", () => {
  it("requires authentication for every protected area", async () => {
    const anon = new Client();
    for (const path of ["/api/biz/dashboard", "/api/biz/products", "/api/retailer/products", "/api/admin/stats", "/api/notifications"]) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
  });

  it("keeps each role inside its own API", async () => {
    const owner = await registerOwner();
    const retailer = await addRetailer(owner.client);
    const admin = await createAdmin();
    expect((await owner.client.get("/api/admin/stats")).status).toBe(403);
    expect((await owner.client.get("/api/retailer/products")).status).toBe(403);
    expect((await retailer.client.get("/api/biz/products")).status).toBe(403);
    expect((await retailer.client.get("/api/biz/retailers")).status).toBe(403);
    expect((await retailer.client.get("/api/admin/businesses")).status).toBe(403);
    expect((await admin.client.get("/api/biz/products")).status).toBe(403);
    expect((await admin.client.get("/api/admin/stats")).status).toBe(200);
  });

  it("ignores identity fields supplied by the client", async () => {
    const a = await registerOwner("A");
    const b = await registerOwner("B");
    // attacker tries to plant a product in business B by sending businessId / role
    const res = await a.client.post("/api/biz/products", { name: "Planted", sku: "PLANT-1", unit: "piece", pricePaise: 100, businessId: b.business.id, business_id: b.business.id, role: "admin" });
    expect(res.status).toBe(201);
    const row = await db.prepare("SELECT business_id FROM products WHERE id = ?").bind(res.data.id).first<any>();
    expect(row.business_id).toBe(a.business.id);
  });
});

describe("retailer invitations", () => {
  it("lets a retailer register through an invitation and links them to the wholesaler", async () => {
    const owner = await registerOwner();
    const r = await addRetailer(owner.client);
    const me = await r.client.get("/api/auth/me");
    expect(me.data.user.role).toBe("retailer");
    expect(me.data.retailer.id).toBe(r.id);
    expect(me.data.business.id).toBe(owner.business.id);
    const detail = await owner.client.get(`/api/biz/retailers/${r.id}`);
    expect(detail.data.inviteState).toBe("registered");
  });

  it("stores only a hash of the invitation token and refuses reuse", async () => {
    const owner = await registerOwner();
    const r = await addRetailer(owner.client);
    const raw = await db.prepare("SELECT COUNT(*) AS n FROM retailer_invitations WHERE token_hash = ?").bind(r.token).first<any>();
    expect(raw.n).toBe(0);
    const again = await new Client().post(`/api/auth/invitations/${r.token}/accept`, { name: "Second", email: `second-${Date.now()}@example.com`, password: PASSWORD });
    expect(again.status).toBe(404);
  });

  it("rejects expired, revoked and unknown tokens", async () => {
    const owner = await registerOwner();
    const mk = async () => {
      const created = await owner.client.post("/api/biz/retailers", { businessName: "Shop " + Math.random(), contactPerson: "Asha", phone: phone() });
      const invite = await owner.client.post(`/api/biz/retailers/${created.data.id}/invite`);
      return { id: created.data.id, token: invite.data.token };
    };
    const accept = (token: string) => new Client().post(`/api/auth/invitations/${token}/accept`, { name: "Asha", email: `a-${Math.random().toString(36).slice(2)}@example.com`, password: PASSWORD });

    const expired = await mk();
    await db.prepare("UPDATE retailer_invitations SET expires_at = '2020-01-01T00:00:00.000Z' WHERE retailer_id = ?").bind(expired.id).run();
    expect((await accept(expired.token)).status).toBe(404);

    const revoked = await mk();
    expect((await owner.client.del(`/api/biz/retailers/${revoked.id}/invite`)).data.revoked).toBe(1);
    expect((await accept(revoked.token)).status).toBe(404);

    // issuing a new link invalidates the old one
    const reissued = await mk();
    const second = await owner.client.post(`/api/biz/retailers/${reissued.id}/invite`);
    expect((await accept(reissued.token)).status).toBe(404);
    expect((await accept(second.data.token)).status).toBe(201);

    expect((await accept("x".repeat(43))).status).toBe(404);
  });

  it("deactivating a retailer signs them out and blocks access", async () => {
    const owner = await registerOwner();
    const r = await addRetailer(owner.client);
    expect((await r.client.get("/api/retailer/products")).status).toBe(200);
    await owner.client.patch(`/api/biz/retailers/${r.id}`, { status: "inactive" });
    expect((await r.client.get("/api/retailer/products")).status).toBe(401);
    const relog = new Client();
    await relog.post("/api/auth/login", { email: r.email, password: PASSWORD });
    const blocked = await relog.get("/api/retailer/products");
    expect(blocked.status).toBe(403);
    expect(blocked.error!.code).toBe("ACCOUNT_INACTIVE");
  });
});

describe("password reset", () => {
  it("gives the same response for known and unknown emails and leaks no token", async () => {
    const owner = await registerOwner();
    const known = await new Client().post("/api/auth/forgot-password", { email: owner.email });
    const unknown = await new Client().post("/api/auth/forgot-password", { email: "ghost@example.com" });
    expect(known.status).toBe(200);
    expect(known.data).toEqual(unknown.data);
    expect(JSON.stringify(known.data)).not.toMatch(/token/i);
  });

  it("wholesaler issues a single-use reset link for their retailer", async () => {
    const owner = await registerOwner();
    const r = await addRetailer(owner.client);
    // the retailer's request reaches the wholesaler as a notification
    await new Client().post("/api/auth/forgot-password", { email: r.email });
    const notes = await owner.client.get("/api/notifications");
    expect(notes.data.some((n: any) => n.type === "password_reset_request")).toBe(true);

    const link = await owner.client.post(`/api/biz/retailers/${r.id}/reset-link`);
    expect(link.status).toBe(201);
    const reset = await new Client().post("/api/auth/reset-password", { token: link.data.token, password: "NewPassw0rd!" });
    expect(reset.status).toBe(200);
    // old sessions are revoked, old password stops working, new one works
    expect((await r.client.get("/api/retailer/products")).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email: r.email, password: PASSWORD })).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email: r.email, password: "NewPassw0rd!" })).status).toBe(200);
    // token cannot be replayed
    expect((await new Client().post("/api/auth/reset-password", { token: link.data.token, password: "Another0ne!" })).status).toBe(422);
  });

  it("a wholesaler cannot create a reset link for another wholesaler's retailer", async () => {
    const a = await registerOwner("A");
    const b = await registerOwner("B");
    const rb = await addRetailer(b.client);
    expect((await a.client.post(`/api/biz/retailers/${rb.id}/reset-link`)).status).toBe(404);
  });
});

describe("platform admin", () => {
  it("suspending a business locks out its owner and retailers until reactivated", async () => {
    const owner = await registerOwner();
    const r = await addRetailer(owner.client);
    const admin = await createAdmin();
    const list = await admin.client.get(`/api/admin/businesses?q=${encodeURIComponent(owner.businessName)}`);
    expect(list.data).toHaveLength(1);
    expect((await admin.client.post(`/api/admin/businesses/${owner.business.id}/status`, { status: "suspended", reason: "Abuse report" })).status).toBe(200);
    const blocked = await owner.client.get("/api/biz/products");
    expect(blocked.status).toBe(403);
    expect(blocked.error!.code).toBe("BUSINESS_SUSPENDED");
    expect((await r.client.get("/api/retailer/products")).status).toBe(403);
    // invitations of a suspended business stop working and the public store disappears
    expect((await new Client().get(`/api/public/store/${owner.business.slug}`)).status).toBe(404);
    await admin.client.post(`/api/admin/businesses/${owner.business.id}/status`, { status: "active" });
    expect((await owner.client.get("/api/biz/products")).status).toBe(200);
  });

  it("suspending a user ends their sessions; admins cannot suspend themselves", async () => {
    const owner = await registerOwner();
    const admin = await createAdmin();
    expect((await admin.client.post(`/api/admin/users/${owner.user.id}/status`, { status: "suspended" })).status).toBe(200);
    expect((await owner.client.get("/api/biz/products")).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email: owner.email, password: PASSWORD })).status).toBe(403);
    const me = await admin.client.get("/api/auth/me");
    expect((await admin.client.post(`/api/admin/users/${me.data.user.id}/status`, { status: "suspended" })).status).toBe(409);
  });

  it("reports platform statistics from real rows", async () => {
    const admin = await createAdmin();
    const before = (await admin.client.get("/api/admin/stats")).data.counts.businesses;
    await registerOwner();
    const after = await admin.client.get("/api/admin/stats");
    expect(after.data.counts.businesses).toBe(before + 1);
    expect(after.data.health.database).toBe("ok");
  });
});

describe("public endpoints", () => {
  it("exposes only a minimal store card", async () => {
    const owner = await registerOwner();
    const store = await new Client().get(`/api/public/store/${owner.business.slug}`);
    expect(store.status).toBe(200);
    expect(Object.keys(store.data).sort()).toEqual(["about", "categoryCount", "city", "name", "productCount", "slug", "state"]);
  });
  it("health check works and unknown API routes return a JSON 404", async () => {
    expect((await new Client().get("/api/health")).data.status).toBe("ok");
    const nf = await new Client().get("/api/nope");
    expect(nf.status).toBe(404);
    expect(nf.error!.code).toBe("NOT_FOUND");
  });
});
