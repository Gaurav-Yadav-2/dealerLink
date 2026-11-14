import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURE_KEYS } from "../src/shared/features";
import { b64u } from "../src/worker/lib/webpush";
import { addProduct, addRetailer, createAdmin, db, placeOrder, registerOwner } from "./helpers";

const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

async function setup(label: string) {
  const owner = await registerOwner(label);
  const admin = await createAdmin();
  const set = (features: Record<string, boolean>) => admin.client.put(`/api/admin/businesses/${owner.business.id}/features`, { features });
  return { owner, admin, set };
}

describe("feature switches: admin control", () => {
  it("every feature is on by default and is reported to the signed-in user", async () => {
    const { owner } = await setup("FeatDefault");
    const me = await owner.client.get("/api/auth/me");
    expect(Object.keys(me.data.features).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(Object.values(me.data.features).every((v) => v === true)).toBe(true);
  });

  it("only the platform admin can read or change switches; changes are audited and counted", async () => {
    const { owner, admin, set } = await setup("FeatAdmin");
    expect((await owner.client.put(`/api/admin/businesses/${owner.business.id}/features`, { features: { reports: false } })).status).toBe(403);
    expect((await owner.client.get(`/api/admin/businesses/${owner.business.id}/features`)).status).toBe(403);
    expect((await set({ notAFeature: false })).status).toBe(422);
    expect((await set({})).status).toBe(422);

    const res = await set({ reports: false, csv: false });
    expect(res.status).toBe(200);
    expect(res.data.changed.sort()).toEqual(["csv", "reports"]);
    expect(res.data.features).toMatchObject({ reports: false, csv: false, gst: true });
    // setting the same value again changes nothing
    expect((await set({ reports: false })).data.changed).toEqual([]);

    const list = await admin.client.get(`/api/admin/businesses?q=${encodeURIComponent(owner.businessName)}`);
    expect(list.data[0].featuresOff).toBe(2);
    const audit = await db.prepare("SELECT action FROM audit_logs WHERE business_id = ? AND action LIKE 'admin.feature_%'").bind(owner.business.id).all<any>();
    expect(audit.results.map((r) => r.action).sort()).toEqual(["admin.feature_disabled", "admin.feature_disabled"]);
    // the user sees the change on their next request
    expect((await owner.client.get("/api/auth/me")).data.features.reports).toBe(false);
    await set({ reports: true });
    expect((await owner.client.get("/api/auth/me")).data.features.reports).toBe(true);
  });

  it("switching a feature off for one business never affects another", async () => {
    const a = await setup("FeatIsoA");
    const b = await registerOwner("FeatIsoB");
    await a.set({ reports: false });
    expect((await a.owner.client.get("/api/biz/reports/summary")).status).toBe(403);
    expect((await b.client.get("/api/biz/reports/summary")).status).toBe(200);
  });
});

describe("feature switches: each feature is enforced by the server", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports", async () => {
    const { owner, set } = await setup("FeatReports");
    await set({ reports: false });
    const res = await owner.client.get("/api/biz/reports/orders");
    expect(res.status).toBe(403);
    expect(res.error!.code).toBe("FEATURE_DISABLED");
    // the overview dashboard and every other section keep working
    expect((await owner.client.get("/api/biz/dashboard")).status).toBe(200);
    expect((await owner.client.get("/api/biz/products")).status).toBe(200);
    expect((await owner.client.get("/api/biz/orders")).status).toBe(200);
  });

  it("CSV import / export", async () => {
    const { owner, set } = await setup("FeatCsv");
    await set({ csv: false });
    expect((await owner.client.get("/api/biz/products/export")).status).toBe(403);
    expect((await owner.client.post("/api/biz/products/import", { rows: [{ name: "A", sku: "A1", price: "1" }] })).status).toBe(403);
    expect((await owner.client.post("/api/biz/products", { name: "Still OK", sku: "OK-1", unit: "piece", pricePaise: 100 })).status).toBe(201);
  });

  it("product photo upload (existing photos keep showing)", async () => {
    const { owner, set } = await setup("FeatPhotos");
    const before = await owner.client.upload("/api/biz/images", jpeg());
    expect(before.status).toBe(201);
    await set({ productPhotos: false });
    expect((await owner.client.upload("/api/biz/images", jpeg())).status).toBe(403);
    expect((await owner.client.get(before.data.url)).status).not.toBe(404);
  });

  it("manual order entry (retailers can still order)", async () => {
    const { owner, set } = await setup("FeatManual");
    const p = await addProduct(owner.client);
    const r = await addRetailer(owner.client);
    await set({ manualOrders: false });
    expect((await owner.client.post("/api/biz/orders", { retailerId: r.id, items: [{ productId: p.id, quantity: 1 }] })).status).toBe(403);
    expect((await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).status).toBe(201);
  });

  it("on-account payments (payments for a specific order still work)", async () => {
    const { owner, set } = await setup("FeatOnAccount");
    const p = await addProduct(owner.client, { pricePaise: 10000 });
    const r = await addRetailer(owner.client);
    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 2 }])).data;
    await set({ onAccountPayments: false });
    const lump = await owner.client.post("/api/biz/payments", { retailerId: r.id, amountPaise: 5000, method: "cash", paymentDate: today() });
    expect(lump.status).toBe(403);
    const forOrder = await owner.client.post("/api/biz/payments", { retailerId: r.id, orderId: order.id, amountPaise: 5000, method: "cash", paymentDate: today() });
    expect(forOrder.status).toBe(201);
  });

  it("retailer-specific pricing: everyone pays the standard price, special prices are kept and come back", async () => {
    const { owner, set } = await setup("FeatPricing");
    const p = await addProduct(owner.client, { pricePaise: 10000 });
    const r = await addRetailer(owner.client);
    await owner.client.put(`/api/biz/retailers/${r.id}/prices`, { items: [{ productId: p.id, pricePaise: 9000 }] });
    expect((await r.client.get(`/api/retailer/products/${p.id}`)).data.pricePaise).toBe(9000);

    await set({ retailerPricing: false });
    expect((await r.client.get(`/api/retailer/products/${p.id}`)).data.pricePaise).toBe(10000);
    expect((await r.client.get("/api/retailer/products")).data.find((x: any) => x.id === p.id).pricePaise).toBe(10000);
    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 2 }])).data;
    expect(order.totalPaise).toBe(20000); // charged the standard price
    // the price list used for manual orders shows standard prices too, and special prices can't be edited
    const list = await owner.client.get(`/api/biz/retailers/${r.id}/prices`);
    expect(list.data[0].effectivePricePaise).toBe(10000);
    expect((await owner.client.put(`/api/biz/retailers/${r.id}/prices`, { items: [{ productId: p.id, pricePaise: 1 }] })).status).toBe(403);
    expect((await owner.client.post(`/api/biz/retailers/${r.id}/prices/bulk`, { mode: "clear" })).status).toBe(403);

    await set({ retailerPricing: true });
    expect((await r.client.get(`/api/retailer/products/${p.id}`)).data.pricePaise).toBe(9000);
  });

  it("GST: no tax while off, and the wholesaler's own GST setting is kept for when it returns", async () => {
    const { owner, set } = await setup("FeatGst");
    const s = (await owner.client.get("/api/biz/settings")).data;
    await owner.client.patch("/api/biz/settings", { name: s.name, trackInventory: true, lowStockThreshold: 10, gstEnabled: true, orderPrefix: "DL" });
    const p = await addProduct(owner.client, { pricePaise: 10000, gstRateBp: 1800 });
    const r = await addRetailer(owner.client);

    await set({ gst: false });
    expect((await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data.totalPaise).toBe(10000);
    // saving settings while GST is off (the screen sends gstEnabled false) must not wipe the stored choice
    await owner.client.patch("/api/biz/settings", { name: s.name, trackInventory: true, lowStockThreshold: 10, gstEnabled: false, orderPrefix: "DL" });

    await set({ gst: true });
    expect((await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data.totalPaise).toBe(11800);
  });

  it("phone alerts: can't turn them on, and no alerts are sent while off", async () => {
    const { owner, set } = await setup("FeatAlerts");
    const p = await addProduct(owner.client);
    const r = await addRetailer(owner.client);
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const keys = { p256dh: b64u.encode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)), auth: b64u.encode(crypto.getRandomValues(new Uint8Array(16))) };
    const endpoint = `https://fcm.googleapis.com/fcm/send/feat-${crypto.randomUUID()}`;
    expect((await r.client.post("/api/push/subscribe", { endpoint, keys })).status).toBe(201); // subscribed while on

    const sent: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://fcm.googleapis.com/")) {
        sent.push(url);
        return new Response(null, { status: 201 });
      }
      return real(input, init);
    });

    await set({ phoneAlerts: false });
    expect((await r.client.post("/api/push/subscribe", { endpoint, keys })).status).toBe(403);
    expect((await r.client.post("/api/push/test")).status).toBe(403);
    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    await owner.client.post(`/api/biz/orders/${order.id}/status`, { status: "accepted" });
    await new Promise((res) => setTimeout(res, 300));
    expect(sent).toEqual([]);
    // the in-app notification still exists
    const notes = await r.client.get("/api/notifications");
    expect(notes.data.some((n: any) => n.title.includes(order.orderNumber))).toBe(true);
  });
});
