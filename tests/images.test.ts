import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sniffImageType } from "../src/worker/lib/images";
import { addProduct, addRetailer, Client, ORIGIN, registerOwner } from "./helpers";

const jpeg = (size = 2048) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) b[i] = i % 251;
  return b;
};
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const webp = () => Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);

async function fetchImage(url: string) {
  const res: Response = await (exports as any).default.fetch(new Request(ORIGIN + url));
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}

describe("product photos", () => {
  it("identifies image types from their bytes, not their name", () => {
    expect(sniffImageType(jpeg())).toBe("image/jpeg");
    expect(sniffImageType(png())).toBe("image/png");
    expect(sniffImageType(webp())).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("uploads a photo and serves it back with long caching and safe headers", async () => {
    const owner = await registerOwner("Photo");
    const bytes = jpeg();
    const up = await owner.client.upload("/api/biz/images", bytes, "image/png"); // wrong declared type is ignored
    expect(up.status).toBe(201);
    expect(up.data.url).toMatch(/^\/api\/images\/[0-9a-f-]{36}$/);
    expect(up.data.contentType).toBe("image/jpeg");

    const img = await fetchImage(up.data.url); // public: no sign-in needed (img tags can't send the session header)
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(img.bytes).toEqual(bytes);
    expect((await fetchImage("/api/images/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await fetchImage("/api/images/not-a-real-id")).status).toBe(404);
  });

  it("rejects files that are not photos, empty uploads and oversized uploads", async () => {
    const owner = await registerOwner("PhotoBad");
    expect((await owner.client.upload("/api/biz/images", new TextEncoder().encode("<html>hi</html>"), "image/jpeg")).status).toBe(422);
    expect((await owner.client.upload("/api/biz/images", new Uint8Array(), "image/jpeg")).status).toBe(422);
    expect((await owner.client.upload("/api/biz/images", jpeg(400_001))).status).toBe(422);
    expect((await owner.client.upload("/api/biz/images", png(), "image/png")).status).toBe(201);
    expect((await owner.client.upload("/api/biz/images", webp(), "image/webp")).status).toBe(201);
  });

  it("only wholesalers can upload, and only with a valid session and CSRF token", async () => {
    const owner = await registerOwner("PhotoRole");
    const r = await addRetailer(owner.client);
    expect((await r.client.upload("/api/biz/images", jpeg())).status).toBe(403);
    expect((await new Client().upload("/api/biz/images", jpeg())).status).toBe(401);
    const noCsrf = new Client();
    noCsrf.token = owner.client.token;
    expect((await noCsrf.upload("/api/biz/images", jpeg())).status).toBe(403);
  });

  it("products can use their own business's photos, never another business's", async () => {
    const a = await registerOwner("PhotoA");
    const b = await registerOwner("PhotoB");
    const aImg = (await a.client.upload("/api/biz/images", jpeg())).data.url;
    const bImg = (await b.client.upload("/api/biz/images", jpeg())).data.url;

    const own = await addProduct(a.client, { imageUrl: aImg });
    expect(own.imageUrl).toBe(aImg);
    const foreign = await a.client.post("/api/biz/products", { name: "X", sku: "FOREIGN-1", unit: "piece", pricePaise: 100, imageUrl: bImg });
    expect(foreign.status).toBe(422);
    const made_up = await a.client.post("/api/biz/products", { name: "Y", sku: "FAKE-1", unit: "piece", pricePaise: 100, imageUrl: "/api/images/00000000-0000-4000-8000-000000000000" });
    expect(made_up.status).toBe(422);
    expect((await a.client.patch(`/api/biz/products/${own.id}`, { imageUrl: bImg })).status).toBe(422);
    // external links still work
    expect((await addProduct(a.client, { imageUrl: "https://example.com/bulb.jpg" })).imageUrl).toBe("https://example.com/bulb.jpg");

    // CSV import can't smuggle in another business's photo either
    const imp = await a.client.post("/api/biz/products/import", { rows: [{ name: "Z", sku: "IMP-1", price: "10", image_url: bImg }], commit: false });
    expect(imp.data.errors[0].messages.join(" ")).toMatch(/not in your catalogue/);
    const ok = await a.client.post("/api/biz/products/import", { rows: [{ name: "Z", sku: "IMP-2", price: "10", image_url: aImg }], commit: false });
    expect(ok.data.errors).toEqual([]);
  });

  it("replacing or removing a product's photo deletes the old one; archiving keeps it", async () => {
    const owner = await registerOwner("PhotoSwap");
    const first = (await owner.client.upload("/api/biz/images", jpeg())).data.url;
    const second = (await owner.client.upload("/api/biz/images", jpeg(3000))).data.url;
    const p = await addProduct(owner.client, { imageUrl: first });
    expect((await owner.client.patch(`/api/biz/products/${p.id}`, { imageUrl: second })).status).toBe(200);
    expect((await fetchImage(first)).status).toBe(404);
    expect((await fetchImage(second)).status).toBe(200);
    await owner.client.del(`/api/biz/products/${p.id}`);
    expect((await fetchImage(second)).status).toBe(200); // archived products can be restored with their photo

    // a photo shared by two products is kept until neither uses it
    const shared = (await owner.client.upload("/api/biz/images", jpeg())).data.url;
    const p1 = await addProduct(owner.client, { imageUrl: shared });
    const p2 = await addProduct(owner.client, { imageUrl: shared });
    await owner.client.patch(`/api/biz/products/${p1.id}`, { imageUrl: null });
    expect((await fetchImage(shared)).status).toBe(200);
    await owner.client.patch(`/api/biz/products/${p2.id}`, { imageUrl: null });
    expect((await fetchImage(shared)).status).toBe(404);
  });

  it("retailers see the photo on the catalogue", async () => {
    const owner = await registerOwner("PhotoShop");
    const url = (await owner.client.upload("/api/biz/images", jpeg())).data.url;
    const p = await addProduct(owner.client, { imageUrl: url });
    const r = await addRetailer(owner.client);
    expect((await r.client.get(`/api/retailer/products/${p.id}`)).data.imageUrl).toBe(url);
  });
});

describe("push subscription key formats", () => {
  it("accepts padded and standard-base64 browser keys and stores them normalised", async () => {
    const owner = await registerOwner("PushKeys");
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const std = (b: Uint8Array) => btoa(String.fromCharCode(...b)); // standard base64 with '=' padding and + /
    const endpoint = `https://updates.push.services.mozilla.com/wpush/v2/${crypto.randomUUID()}`;
    const res = await owner.client.post("/api/push/subscribe", { endpoint, keys: { p256dh: std(raw), auth: std(crypto.getRandomValues(new Uint8Array(16))) } });
    expect(res.status).toBe(201);
    expect((await owner.client.post("/api/push/status", { endpoint })).data.subscribed).toBe(true);
  });
});
