import { env, exports } from "cloudflare:workers";
import { hashPassword } from "../src/worker/lib/crypto";

export const db = (env as any).DB as D1Database;
export const ORIGIN = "http://dl.test";
export const PASSWORD = "Passw0rd!x";
const rnd = () => Math.random().toString(36).slice(2, 10);
export const phone = () => "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

type Res = { status: number; data: any; error?: { code: string; message: string; details?: any }; meta?: any; headers: Headers };

/** A browser-tab-like API client: keeps its own session token and CSRF token between calls. */
export class Client {
  token = "";
  csrf = "";
  ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const h: Record<string, string> = { "cf-connecting-ip": this.ip, ...headers };
    if (this.token) h["x-dl-session"] = this.token;
    if (body !== undefined) h["content-type"] = "application/json";
    const res: Response = await (exports as any).default.fetch(
      new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const json: any = await res.json().catch(() => ({}));
    if (json?.data?.csrfToken) this.csrf = json.data.csrfToken;
    if (json?.data?.sessionToken) this.token = json.data.sessionToken;
    return { status: res.status, data: json.data, error: json.error, meta: json.meta, headers: res.headers };
  }
  get(path: string) {
    return this.raw("GET", path);
  }
  /** Mutation with the headers the real web client sends. */
  send(method: string, path: string, body: unknown = {}) {
    return this.raw(method, path, body, { "x-dl-client": "web", "x-csrf-token": this.csrf, origin: ORIGIN });
  }
  post(path: string, body: unknown = {}) {
    return this.send("POST", path, body);
  }
  patch(path: string, body: unknown = {}) {
    return this.send("PATCH", path, body);
  }
  put(path: string, body: unknown = {}) {
    return this.send("PUT", path, body);
  }
  del(path: string) {
    return this.send("DELETE", path);
  }
  /** Uploads raw bytes (like the web app's photo upload). */
  async upload(path: string, bytes: Uint8Array, type = "image/jpeg") {
    const res: Response = await (exports as any).default.fetch(
      new Request(ORIGIN + path, {
        method: "POST",
        headers: { "cf-connecting-ip": this.ip, "x-dl-session": this.token, "x-dl-client": "web", "x-csrf-token": this.csrf, origin: ORIGIN, "content-type": type },
        body: bytes,
      }),
    );
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, data: json.data, error: json.error };
  }
}

export async function registerOwner(label = "Biz") {
  const client = new Client();
  const email = `owner-${rnd()}@example.com`;
  const businessName = `${label} ${rnd()}`;
  const res = await client.post("/api/auth/register", {
    name: "Owner " + label, email, password: PASSWORD, phone: phone(), businessName, city: "Pune", state: "Maharashtra",
  });
  if (res.status !== 201) throw new Error("register failed: " + JSON.stringify(res.error));
  return { client, email, businessName, business: res.data.business, user: res.data.user };
}

export async function addProduct(owner: Client, over: Record<string, unknown> = {}) {
  const res = await owner.post("/api/biz/products", { name: "Product " + rnd(), sku: "SKU-" + rnd(), unit: "piece", pricePaise: 10000, ...over });
  if (res.status !== 201) throw new Error("product failed: " + JSON.stringify(res.error));
  return res.data;
}

/** Owner adds a retailer, invites them, and the retailer registers through the invitation link. */
export async function addRetailer(owner: Client, label = "Shop") {
  const created = await owner.post("/api/biz/retailers", {
    businessName: `${label} ${rnd()}`, contactPerson: "Contact " + label, phone: phone(), city: "Pune", state: "Maharashtra",
  });
  if (created.status !== 201) throw new Error("retailer failed: " + JSON.stringify(created.error));
  const invite = await owner.post(`/api/biz/retailers/${created.data.id}/invite`);
  if (invite.status !== 201) throw new Error("invite failed: " + JSON.stringify(invite.error));
  const client = new Client();
  const email = `retailer-${rnd()}@example.com`;
  const accepted = await client.post(`/api/auth/invitations/${invite.data.token}/accept`, { name: "Retail " + label, email, password: PASSWORD });
  if (accepted.status !== 201) throw new Error("accept failed: " + JSON.stringify(accepted.error));
  return { client, email, id: created.data.id as string, token: invite.data.token as string };
}

export async function placeOrder(retailer: Client, lines: { productId: string; quantity: number }[], note?: string) {
  await retailer.del("/api/retailer/cart");
  for (const l of lines) {
    const r = await retailer.put("/api/retailer/cart/items", l);
    if (r.status !== 200) throw new Error("cart failed: " + JSON.stringify(r.error));
  }
  return retailer.post("/api/retailer/orders", { note });
}

export async function createAdmin() {
  const email = `admin-${rnd()}@example.com`;
  const ts = new Date().toISOString();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at) VALUES (?,?,?,?,'admin',?,?)")
    .bind(crypto.randomUUID(), email, await hashPassword(PASSWORD), "Platform Admin", ts, ts)
    .run();
  const client = new Client();
  const res = await client.post("/api/auth/login", { email, password: PASSWORD });
  if (res.status !== 200) throw new Error("admin login failed");
  return { client, email };
}
