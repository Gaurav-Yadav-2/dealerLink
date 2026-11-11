import { beforeAll, describe, expect, it } from "vitest";
import { addProduct, addRetailer, db, placeOrder, registerOwner } from "./helpers";

/**
 * Tenant isolation. Two complete businesses are built, then every cross-tenant and
 * cross-retailer access path is attempted. Foreign ids must behave exactly like ids that do not exist.
 */
describe("tenant isolation", () => {
  let A: Awaited<ReturnType<typeof registerOwner>>;
  let B: Awaited<ReturnType<typeof registerOwner>>;
  let a1: Awaited<ReturnType<typeof addRetailer>>;
  let a2: Awaited<ReturnType<typeof addRetailer>>;
  let b1: Awaited<ReturnType<typeof addRetailer>>;
  let productA: any, productB: any, categoryB: any;
  let orderA1: any, orderA2: any, orderB1: any, paymentA2: any, paymentB1: any;

  beforeAll(async () => {
    A = await registerOwner("Alpha");
    B = await registerOwner("Beta");
    productA = await addProduct(A.client, { name: "Alpha Widget", pricePaise: 10000 });
    productB = await addProduct(B.client, { name: "Beta Widget", pricePaise: 20000 });
    categoryB = (await B.client.post("/api/biz/categories", { name: "Beta Cat" })).data;
    a1 = await addRetailer(A.client, "A1");
    a2 = await addRetailer(A.client, "A2");
    b1 = await addRetailer(B.client, "B1");
    await A.client.put(`/api/biz/retailers/${a2.id}/prices`, { items: [{ productId: productA.id, pricePaise: 9000 }] });
    orderA1 = (await placeOrder(a1.client, [{ productId: productA.id, quantity: 2 }])).data;
    orderA2 = (await placeOrder(a2.client, [{ productId: productA.id, quantity: 2 }])).data;
    orderB1 = (await placeOrder(b1.client, [{ productId: productB.id, quantity: 1 }])).data;
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    paymentA2 = (await A.client.post("/api/biz/payments", { retailerId: a2.id, orderId: orderA2.id, amountPaise: 5000, method: "upi", paymentDate: today })).data;
    paymentB1 = (await B.client.post("/api/biz/payments", { retailerId: b1.id, orderId: orderB1.id, amountPaise: 5000, method: "cash", paymentDate: today })).data;
  });

  describe("Scenario E — business B cannot reach business A's data", () => {
    it("cannot read, edit, archive or restore A's product", async () => {
      expect((await B.client.get(`/api/biz/products/${productA.id}`)).status).toBe(404);
      expect((await B.client.patch(`/api/biz/products/${productA.id}`, { pricePaise: 1 })).status).toBe(404);
      expect((await B.client.del(`/api/biz/products/${productA.id}`)).status).toBe(404);
      expect((await B.client.post(`/api/biz/products/${productA.id}/restore`)).status).toBe(404);
      const row = await db.prepare("SELECT price_paise, archived_at FROM products WHERE id = ?").bind(productA.id).first<any>();
      expect(row).toEqual({ price_paise: 10000, archived_at: null });
    });

    it("never lists another tenant's products, retailers, orders or payments", async () => {
      const ids = async (path: string) => ((await B.client.get(path)).data as any[]).map((r) => r.id);
      expect(await ids("/api/biz/products")).toEqual([productB.id]);
      expect(await ids("/api/biz/retailers")).toEqual([b1.id]);
      expect(await ids("/api/biz/orders")).toEqual([orderB1.id]);
      expect(await ids("/api/biz/payments")).toEqual([paymentB1.id]);
      expect(await ids("/api/biz/products/export")).toEqual([productB.id]);
      // filter parameters cannot widen the scope
      expect(await ids(`/api/biz/orders?retailerId=${a1.id}`)).toEqual([]);
      expect(await ids(`/api/biz/payments?retailerId=${a2.id}`)).toEqual([]);
    });

    it("cannot read or modify A's retailers, pricing or ledger", async () => {
      expect((await B.client.get(`/api/biz/retailers/${a1.id}`)).status).toBe(404);
      expect((await B.client.patch(`/api/biz/retailers/${a1.id}`, { status: "inactive" })).status).toBe(404);
      expect((await B.client.get(`/api/biz/retailers/${a1.id}/ledger`)).status).toBe(404);
      expect((await B.client.get(`/api/biz/retailers/${a2.id}/prices`)).status).toBe(404);
      expect((await B.client.post(`/api/biz/retailers/${a1.id}/invite`)).status).toBe(404);
      expect((await B.client.post(`/api/biz/retailers/${a1.id}/prices/bulk`, { mode: "percent_off", percent: 50 })).status).toBe(404);
      // B's own retailer + A's product: the foreign product id is rejected
      expect((await B.client.put(`/api/biz/retailers/${b1.id}/prices`, { items: [{ productId: productA.id, pricePaise: 1 }] })).status).toBe(404);
      const overrides = await db.prepare("SELECT COUNT(*) AS n FROM retailer_product_prices WHERE product_id = ? AND business_id != ?").bind(productA.id, A.business.id).first<any>();
      expect(overrides.n).toBe(0);
    });

    it("cannot read or act on A's orders", async () => {
      expect((await B.client.get(`/api/biz/orders/${orderA1.id}`)).status).toBe(404);
      expect((await B.client.post(`/api/biz/orders/${orderA1.id}/status`, { status: "accepted" })).status).toBe(404);
      expect((await B.client.patch(`/api/biz/orders/${orderA1.id}`, { internalNote: "pwned", discountPaise: 100 })).status).toBe(404);
      const row = await db.prepare("SELECT status, internal_note, discount_paise FROM orders WHERE id = ?").bind(orderA1.id).first<any>();
      expect(row).toEqual({ status: "pending", internal_note: null, discount_paise: 0 });
    });

    it("cannot create orders or payments that mix tenants", async () => {
      // B's owner ordering for A's retailer
      expect((await B.client.post("/api/biz/orders", { retailerId: a1.id, items: [{ productId: productB.id, quantity: 1 }] })).status).toBe(404);
      // B's retailer + A's product
      const mixed = await B.client.post("/api/biz/orders", { retailerId: b1.id, items: [{ productId: productA.id, quantity: 1 }] });
      expect(mixed.status).toBe(422);
      const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      // payment for A's retailer, or B's retailer against A's order
      expect((await B.client.post("/api/biz/payments", { retailerId: a1.id, amountPaise: 100, method: "cash", paymentDate: today })).status).toBe(404);
      expect((await B.client.post("/api/biz/payments", { retailerId: b1.id, orderId: orderA1.id, amountPaise: 100, method: "cash", paymentDate: today })).status).toBe(404);
      expect((await B.client.post(`/api/biz/payments/${paymentA2.id}/reverse`, { reason: "malicious" })).status).toBe(404);
      const p = await db.prepare("SELECT status FROM payments WHERE id = ?").bind(paymentA2.id).first<any>();
      expect(p.status).toBe("recorded");
    });

    it("cannot use A's category on its own products, or edit A's categories", async () => {
      const catA = (await A.client.post("/api/biz/categories", { name: "Alpha Cat" })).data;
      expect((await B.client.post("/api/biz/products", { name: "X", sku: "X-CAT", unit: "piece", pricePaise: 100, categoryId: catA.id })).status).toBe(422);
      expect((await B.client.patch(`/api/biz/categories/${catA.id}`, { name: "Renamed" })).status).toBe(404);
      expect((await B.client.del(`/api/biz/categories/${catA.id}`)).status).toBe(404);
      expect(categoryB.id).toBeTruthy();
    });

    it("reports and dashboard only count the caller's own business", async () => {
      const dash = await B.client.get("/api/biz/dashboard");
      expect(dash.data.kpis.totalRetailers).toBe(1);
      expect(dash.data.kpis.totalProducts).toBe(1);
      expect(dash.data.kpis.outstandingPaise).toBe(20000 - 5000);
      const byRetailer = await B.client.get("/api/biz/reports/sales-by-retailer");
      expect(byRetailer.data.map((r: any) => r.retailerId)).toEqual([b1.id]);
      const outstanding = await B.client.get("/api/biz/reports/outstanding");
      expect(outstanding.data.map((r: any) => r.retailerId)).toEqual([b1.id]);
    });
  });

  describe("a retailer of business B cannot reach business A's store", () => {
    it("sees only their own wholesaler's catalogue", async () => {
      const list = await b1.client.get("/api/retailer/products");
      expect(list.data.map((p: any) => p.id)).toEqual([productB.id]);
      expect((await b1.client.get(`/api/retailer/products/${productA.id}`)).status).toBe(404);
    });
    it("cannot add another business's product to the cart or order it", async () => {
      expect((await b1.client.put("/api/retailer/cart/items", { productId: productA.id, quantity: 1 })).status).toBe(404);
      const cart = await b1.client.get("/api/retailer/cart");
      expect(cart.data.items).toEqual([]);
    });
    it("cannot view, cancel or reorder another business's order", async () => {
      expect((await b1.client.get(`/api/retailer/orders/${orderA1.id}`)).status).toBe(404);
      expect((await b1.client.post(`/api/retailer/orders/${orderA1.id}/cancel`)).status).toBe(404);
      expect((await b1.client.post(`/api/retailer/orders/${orderA1.id}/reorder`)).status).toBe(404);
    });
  });

  describe("Scenario E — retailer A1 cannot reach retailer A2 (same wholesaler)", () => {
    it("cannot see A2's payment data", async () => {
      const ledger = await a1.client.get("/api/retailer/ledger");
      expect(ledger.status).toBe(200);
      expect(ledger.data.payments).toEqual([]);
      expect(ledger.data.totals.totalPaidPaise).toBe(0);
      expect(ledger.data.totals.totalPurchasesPaise).toBe(20000);
      // the owner-side ledger and payment endpoints are closed to retailers entirely
      expect((await a1.client.get(`/api/biz/retailers/${a2.id}/ledger`)).status).toBe(403);
      expect((await a1.client.get(`/api/biz/payments?retailerId=${a2.id}`)).status).toBe(403);
      const a2Ledger = await a2.client.get("/api/retailer/ledger");
      expect(a2Ledger.data.payments.map((p: any) => p.id)).toEqual([paymentA2.id]);
    });
    it("cannot see or act on A2's orders", async () => {
      const list = await a1.client.get("/api/retailer/orders");
      expect(list.data.map((o: any) => o.id)).toEqual([orderA1.id]);
      expect((await a1.client.get(`/api/retailer/orders/${orderA2.id}`)).status).toBe(404);
      expect((await a1.client.post(`/api/retailer/orders/${orderA2.id}/cancel`)).status).toBe(404);
      expect((await a1.client.post(`/api/retailer/orders/${orderA2.id}/reorder`)).status).toBe(404);
      const row = await db.prepare("SELECT status FROM orders WHERE id = ?").bind(orderA2.id).first<any>();
      expect(row.status).toBe("pending");
    });
    it("cannot see A2's special price, the standard price, or internal notes", async () => {
      const mine = await a1.client.get(`/api/retailer/products/${productA.id}`);
      expect(mine.data.pricePaise).toBe(10000);
      const theirs = await a2.client.get(`/api/retailer/products/${productA.id}`);
      expect(theirs.data.pricePaise).toBe(9000);
      // a retailer with an override is never shown the standard price
      expect(JSON.stringify(theirs.data)).not.toContain("10000");
      expect(Object.keys(theirs.data)).not.toContain("standardPricePaise");
      await A.client.patch(`/api/biz/orders/${orderA1.id}`, { internalNote: "slow payer" });
      const order = await a1.client.get(`/api/retailer/orders/${orderA1.id}`);
      expect(order.status).toBe(200);
      expect(JSON.stringify(order.data)).not.toContain("slow payer");
      expect(Object.keys(order.data)).not.toContain("internalNote");
    });
    it("cannot read another user's notifications", async () => {
      const ownerNotes = await A.client.get("/api/notifications");
      const target = ownerNotes.data[0];
      expect(target).toBeTruthy();
      await a1.client.post(`/api/notifications/${target.id}/read`);
      const still = await A.client.get("/api/notifications");
      expect(still.data.find((n: any) => n.id === target.id).readAt).toBeNull();
      const mine = await a1.client.get("/api/notifications");
      expect(mine.data.some((n: any) => n.id === target.id)).toBe(false);
    });
  });
});
