import { describe, expect, it } from "vitest";
import { addProduct, addRetailer, Client, db, PASSWORD, phone, placeOrder, registerOwner } from "./helpers";

const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const pay = (owner: Client, body: Record<string, unknown>) =>
  owner.post("/api/biz/payments", { method: "upi", paymentDate: today(), ...body });

describe("Scenario A — business onboarding", () => {
  it("wholesaler registers, adds five products and two retailers, both retailers register", async () => {
    const owner = await registerOwner("Onboard");
    for (let i = 1; i <= 5; i++) await addProduct(owner.client, { name: `Item ${i}`, sku: `ITEM-${i}` });
    const products = await owner.client.get("/api/biz/products");
    expect(products.meta.total).toBe(5);

    const r1 = await addRetailer(owner.client, "One");
    const r2 = await addRetailer(owner.client, "Two");
    const retailers = await owner.client.get("/api/biz/retailers");
    expect(retailers.meta.total).toBe(2);
    expect(retailers.data.every((r: any) => r.inviteState === "registered")).toBe(true);

    for (const r of [r1, r2]) {
      const catalogue = await r.client.get("/api/retailer/products");
      expect(catalogue.meta.total).toBe(5);
      const store = await r.client.get("/api/retailer/store");
      expect(store.data.business.name).toBe(owner.businessName);
    }
    const dash = await owner.client.get("/api/biz/dashboard");
    expect(dash.data.kpis).toMatchObject({ totalRetailers: 2, totalProducts: 5, ordersToday: 0, pendingOrders: 0, monthlySalesPaise: 0, outstandingPaise: 0 });
    expect(dash.data.newRetailers).toHaveLength(2);
    // the owner was told about both registrations
    const notes = await owner.client.get("/api/notifications");
    expect(notes.data.filter((n: any) => n.type === "retailer_registered")).toHaveLength(2);
  });
});

describe("Scenario B — retailer-specific pricing", () => {
  it("each retailer sees and is charged their own price, whatever the browser sends", async () => {
    const owner = await registerOwner("Pricing");
    const product = await addProduct(owner.client, { name: "LED Bulb 12W", pricePaise: 10000 });
    const a = await addRetailer(owner.client, "A");
    const b = await addRetailer(owner.client, "B");
    const c = await addRetailer(owner.client, "C");
    await owner.client.put(`/api/biz/retailers/${a.id}/prices`, { items: [{ productId: product.id, pricePaise: 9500 }] });
    await owner.client.put(`/api/biz/retailers/${b.id}/prices`, { items: [{ productId: product.id, pricePaise: 9000 }] });

    const seen = async (r: { client: Client }) => (await r.client.get(`/api/retailer/products/${product.id}`)).data.pricePaise;
    expect(await seen(a)).toBe(9500);
    expect(await seen(b)).toBe(9000);
    expect(await seen(c)).toBe(10000);

    // the price list view shows standard, override and effective prices to the wholesaler
    const list = await owner.client.get(`/api/biz/retailers/${a.id}/prices`);
    expect(list.data[0]).toMatchObject({ standardPricePaise: 10000, overridePricePaise: 9500, effectivePricePaise: 9500 });

    // a tampered request carrying its own prices is ignored
    await a.client.put("/api/retailer/cart/items", { productId: product.id, quantity: 10, pricePaise: 1, unitPricePaise: 1 });
    const orderA = await a.client.post("/api/retailer/orders", { note: "x", totalPaise: 1, items: [{ productId: product.id, quantity: 10, unitPricePaise: 1 }] });
    expect(orderA.status).toBe(201);
    expect(orderA.data.totalPaise).toBe(95000);
    const orderB = await placeOrder(b.client, [{ productId: product.id, quantity: 10 }]);
    expect(orderB.data.totalPaise).toBe(90000);
    const orderC = await placeOrder(c.client, [{ productId: product.id, quantity: 10 }]);
    expect(orderC.data.totalPaise).toBe(100000);

    const stored = await db.prepare("SELECT unit_price_paise FROM order_items WHERE order_id = ?").bind(orderA.data.id).first<any>();
    expect(stored.unit_price_paise).toBe(9500);

    // manual orders created by the wholesaler use the same resolver
    const manual = await owner.client.post("/api/biz/orders", { retailerId: b.id, items: [{ productId: product.id, quantity: 2, unitPricePaise: 5 }] });
    expect(manual.data.totalPaise).toBe(18000);
  });

  it("supports bulk percentage discounts and clearing overrides", async () => {
    const owner = await registerOwner("Bulk");
    const p1 = await addProduct(owner.client, { pricePaise: 10000 });
    const p2 = await addProduct(owner.client, { pricePaise: 3333 });
    const r = await addRetailer(owner.client);
    const bulk = await owner.client.post(`/api/biz/retailers/${r.id}/prices/bulk`, { mode: "percent_off", percent: 5 });
    expect(bulk.data.affected).toBe(2);
    const prices = Object.fromEntries(((await owner.client.get(`/api/biz/retailers/${r.id}/prices`)).data as any[]).map((x) => [x.id, x.effectivePricePaise]));
    expect(prices[p1.id]).toBe(9500);
    expect(prices[p2.id]).toBe(3166); // 3166.35 rounded to the paisa
    // removing a single override returns that product to the standard price
    await owner.client.put(`/api/biz/retailers/${r.id}/prices`, { items: [{ productId: p1.id, pricePaise: null }] });
    expect((await r.client.get(`/api/retailer/products/${p1.id}`)).data.pricePaise).toBe(10000);
    await owner.client.post(`/api/biz/retailers/${r.id}/prices/bulk`, { mode: "clear" });
    expect((await r.client.get(`/api/retailer/products/${p2.id}`)).data.pricePaise).toBe(3333);
  });
});

describe("Scenario C — order processing", () => {
  it("retailer orders five products; wholesaler accepts, processes and dispatches; retailer tracks it", async () => {
    const owner = await registerOwner("Flow");
    const products = [];
    for (let i = 1; i <= 5; i++) products.push(await addProduct(owner.client, { name: `Flow ${i}`, pricePaise: 1000 * i }));
    const r = await addRetailer(owner.client);

    for (const p of products) await r.client.put("/api/retailer/cart/items", { productId: p.id, quantity: 2 });
    const cart = await r.client.get("/api/retailer/cart");
    expect(cart.data.items).toHaveLength(5);
    expect(cart.data.totalPaise).toBe(2 * (1000 + 2000 + 3000 + 4000 + 5000));
    const placed = await r.client.post("/api/retailer/orders", { note: "Deliver before Friday" });
    expect(placed.status).toBe(201);
    expect(placed.data.orderNumber).toBe("DL1000");
    expect((await r.client.get("/api/retailer/cart")).data.items).toEqual([]);

    // wholesaler receives it
    const incoming = await owner.client.get("/api/biz/orders?status=pending");
    expect(incoming.data.map((o: any) => o.id)).toEqual([placed.data.id]);
    expect((await owner.client.get("/api/notifications")).data.some((n: any) => n.type === "order_new")).toBe(true);

    const move = (status: string, note?: string) => owner.client.post(`/api/biz/orders/${placed.data.id}/status`, { status, note });
    expect((await move("accepted")).status).toBe(200);
    expect((await move("processing")).status).toBe(200);
    expect((await move("dispatched", "Sent via Blue Dart")).status).toBe(200);

    const tracked = await r.client.get(`/api/retailer/orders/${placed.data.id}`);
    expect(tracked.data.status).toBe("dispatched");
    expect(tracked.data.items).toHaveLength(5);
    expect(tracked.data.history.map((h: any) => h.toStatus)).toEqual(["pending", "accepted", "processing", "dispatched"]);
    expect(tracked.data.history[3]).toMatchObject({ fromStatus: "processing", actorRole: "owner", note: "Sent via Blue Dart" });
    expect(tracked.data.history.every((h: any) => h.createdAt && h.actorName)).toBe(true);
    const rNotes = await r.client.get("/api/notifications");
    expect(rNotes.data.filter((n: any) => n.type === "order_status")).toHaveLength(3);
    expect(rNotes.meta.unread).toBe(3);
  });

  it("enforces the status state machine and cancellation rules", async () => {
    const owner = await registerOwner("Rules");
    const p = await addProduct(owner.client);
    const r = await addRetailer(owner.client);
    const o1 = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    const move = (id: string, status: string) => owner.client.post(`/api/biz/orders/${id}/status`, { status });
    expect((await move(o1.id, "dispatched")).status).toBe(409); // cannot skip acceptance
    expect((await move(o1.id, "delivered")).status).toBe(409);
    // retailer may cancel while pending...
    expect((await r.client.post(`/api/retailer/orders/${o1.id}/cancel`)).status).toBe(200);
    expect((await move(o1.id, "accepted")).status).toBe(409); // terminal
    // ...but not once accepted
    const o2 = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    await move(o2.id, "accepted");
    expect((await r.client.post(`/api/retailer/orders/${o2.id}/cancel`)).status).toBe(409);
    // rejected orders are terminal too
    const o3 = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    expect((await owner.client.post(`/api/biz/orders/${o3.id}/status`, { status: "rejected", note: "Out of range" })).status).toBe(200);
    expect((await move(o3.id, "accepted")).status).toBe(409);
    const cancelled = await owner.client.get("/api/biz/reports/cancelled");
    expect(cancelled.data.map((x: any) => x.id).sort()).toEqual([o1.id, o3.id].sort());
    expect(cancelled.data.find((x: any) => x.id === o3.id).reason).toBe("Out of range");
  });

  it("applies minimum order quantity and stock rules, and restores stock when an order is cancelled", async () => {
    const owner = await registerOwner("Stock");
    const p = await addProduct(owner.client, { minOrderQty: 5, stockQty: 20 });
    const r = await addRetailer(owner.client);
    expect((await r.client.put("/api/retailer/cart/items", { productId: p.id, quantity: 4 })).status).toBe(422);
    expect((await r.client.put("/api/retailer/cart/items", { productId: p.id, quantity: 21 })).status).toBe(422);
    const order = await placeOrder(r.client, [{ productId: p.id, quantity: 15 }]);
    expect(order.status).toBe(201);
    const stock = async () => (await db.prepare("SELECT stock_qty FROM products WHERE id = ?").bind(p.id).first<any>()).stock_qty;
    expect(await stock()).toBe(5);
    expect((await r.client.get(`/api/retailer/products/${p.id}`)).data.availabilityStatus).toBe("low_stock");
    // only 5 left: a second order for 15 is refused and nothing changes
    await db.prepare("DELETE FROM cart_items").run();
    const again = await owner.client.post("/api/biz/orders", { retailerId: r.id, items: [{ productId: p.id, quantity: 15 }] });
    expect(again.status).toBe(422);
    expect(await stock()).toBe(5);
    await r.client.post(`/api/retailer/orders/${order.data.id}/cancel`);
    expect(await stock()).toBe(20);
  });

  it("the database refuses to oversell even if validation is bypassed", async () => {
    const owner = await registerOwner("Race");
    const p = await addProduct(owner.client, { stockQty: 3 });
    await expect(db.prepare("UPDATE products SET stock_qty = stock_qty - 5 WHERE id = ?").bind(p.id).run()).rejects.toThrow(/CHECK/);
  });

  it("lets a wholesaler turn inventory tracking off", async () => {
    const owner = await registerOwner("NoStock");
    const p = await addProduct(owner.client, { stockQty: 0 });
    const r = await addRetailer(owner.client);
    expect((await r.client.put("/api/retailer/cart/items", { productId: p.id, quantity: 1 })).status).toBe(422);
    const s = (await owner.client.get("/api/biz/settings")).data;
    const saved = await owner.client.patch("/api/biz/settings", { name: s.name, phone: s.phone, email: s.email, trackInventory: false, lowStockThreshold: 10, gstEnabled: false, orderPrefix: "NS" });
    expect(saved.status).toBe(200);
    const order = await placeOrder(r.client, [{ productId: p.id, quantity: 4 }]);
    expect(order.status).toBe(201);
    expect(order.data.orderNumber).toMatch(/^NS\d+$/);
    expect((await db.prepare("SELECT stock_qty FROM products WHERE id = ?").bind(p.id).first<any>()).stock_qty).toBe(0);
    // manual availability still applies
    await owner.client.patch(`/api/biz/products/${p.id}`, { availability: "out_of_stock" });
    expect((await r.client.put("/api/retailer/cart/items", { productId: p.id, quantity: 1 })).status).toBe(422);
  });

  it("reorder copies a previous order into the cart at current prices and reports unavailable items", async () => {
    const owner = await registerOwner("Reorder");
    const keep = await addProduct(owner.client, { name: "Keep", pricePaise: 5000 });
    const gone = await addProduct(owner.client, { name: "Gone", pricePaise: 7000 });
    const r = await addRetailer(owner.client);
    const first = await placeOrder(r.client, [{ productId: keep.id, quantity: 3 }, { productId: gone.id, quantity: 1 }]);
    await owner.client.del(`/api/biz/products/${gone.id}`);
    await owner.client.patch(`/api/biz/products/${keep.id}`, { pricePaise: 6000 });
    const re = await r.client.post(`/api/retailer/orders/${first.data.id}/reorder`);
    expect(re.data.added).toBe(1);
    expect(re.data.skipped).toHaveLength(1);
    const cart = await r.client.get("/api/retailer/cart");
    expect(cart.data.items).toHaveLength(1);
    expect(cart.data.items[0]).toMatchObject({ productId: keep.id, quantity: 3, unitPricePaise: 6000 });
  });

  it("adds GST per line when the business enables it", async () => {
    const owner = await registerOwner("Gst");
    const s = (await owner.client.get("/api/biz/settings")).data;
    await owner.client.patch("/api/biz/settings", { name: s.name, trackInventory: true, lowStockThreshold: 10, gstEnabled: true, orderPrefix: "DL", gstin: "27ABCDE1234F1Z5" });
    const p18 = await addProduct(owner.client, { pricePaise: 10000, gstRateBp: 1800 });
    const p5 = await addProduct(owner.client, { pricePaise: 999, gstRateBp: 500 });
    const r = await addRetailer(owner.client);
    const order = await placeOrder(r.client, [{ productId: p18.id, quantity: 2 }, { productId: p5.id, quantity: 1 }]);
    const detail = (await r.client.get(`/api/retailer/orders/${order.data.id}`)).data;
    expect(detail.subtotalPaise).toBe(20999);
    expect(detail.taxPaise).toBe(3600 + 50);
    expect(detail.totalPaise).toBe(20999 + 3650);
    // discount and delivery charge adjust the total
    const patched = await owner.client.patch(`/api/biz/orders/${order.data.id}`, { discountPaise: 649, deliveryPaise: 1000 });
    expect(patched.data.totalPaise).toBe(20999 + 3650 - 649 + 1000);
  });
});

describe("Scenario D — partial payments", () => {
  it("₹10,000 order: ₹4,000 then ₹6,000 → outstanding goes 6,000 → 0 and the order becomes Paid", async () => {
    const owner = await registerOwner("Pay");
    const p = await addProduct(owner.client, { pricePaise: 100000 });
    const r = await addRetailer(owner.client);
    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 10 }])).data;
    expect(order.totalPaise).toBe(1000000);

    const ledger = async () => (await owner.client.get(`/api/biz/retailers/${r.id}/ledger`)).data.totals;
    expect(await ledger()).toMatchObject({ totalPurchasesPaise: 1000000, totalPaidPaise: 0, outstandingPaise: 1000000 });

    const first = await pay(owner.client, { retailerId: r.id, orderId: order.id, amountPaise: 400000, reference: "UPI-1" });
    expect(first.status).toBe(201);
    expect(await ledger()).toMatchObject({ totalPaidPaise: 400000, outstandingPaise: 600000 });
    expect((await owner.client.get(`/api/biz/orders/${order.id}`)).data.paymentStatus).toBe("partial");

    // overpayment is refused and changes nothing
    const over = await pay(owner.client, { retailerId: r.id, orderId: order.id, amountPaise: 600001 });
    expect(over.status).toBe(422);
    expect(await ledger()).toMatchObject({ outstandingPaise: 600000 });

    const second = await pay(owner.client, { retailerId: r.id, orderId: order.id, amountPaise: 600000, method: "cash" });
    expect(second.status).toBe(201);
    expect(await ledger()).toMatchObject({ totalPaidPaise: 1000000, outstandingPaise: 0 });
    const detail = (await owner.client.get(`/api/biz/orders/${order.id}`)).data;
    expect(detail.paymentStatus).toBe("paid");
    expect(detail.payments).toHaveLength(2);

    // the retailer sees the same ledger
    const mine = (await r.client.get("/api/retailer/ledger")).data;
    expect(mine.totals.outstandingPaise).toBe(0);
    expect(mine.payments).toHaveLength(2);
    expect((await pay(owner.client, { retailerId: r.id, orderId: order.id, amountPaise: 1 })).status).toBe(422);
    expect((await owner.client.get("/api/biz/dashboard")).data.kpis.outstandingPaise).toBe(0);
  });

  it("on-account payments are applied to the oldest unpaid orders first", async () => {
    const owner = await registerOwner("Fifo");
    const p = await addProduct(owner.client, { pricePaise: 10000 });
    const r = await addRetailer(owner.client);
    const o1 = (await placeOrder(r.client, [{ productId: p.id, quantity: 3 }])).data; // 300
    const o2 = (await placeOrder(r.client, [{ productId: p.id, quantity: 5 }])).data; // 500
    const res = await pay(owner.client, { retailerId: r.id, amountPaise: 45000 });
    expect(res.status).toBe(201);
    expect(res.data.applied).toEqual([{ orderNumber: o1.orderNumber, amountPaise: 30000 }, { orderNumber: o2.orderNumber, amountPaise: 15000 }]);
    const status = async (id: string) => (await owner.client.get(`/api/biz/orders/${id}`)).data;
    expect((await status(o1.id)).paymentStatus).toBe("paid");
    expect(await status(o2.id)).toMatchObject({ paymentStatus: "partial", amountPaidPaise: 15000 });
    // cannot pay more than the retailer owes in total (no advance credit)
    const tooMuch = await pay(owner.client, { retailerId: r.id, amountPaise: 35001 });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.error!.message).toMatch(/Advance payments are not supported/);
  });

  it("payments are never deleted: a reversal is recorded and balances are restored", async () => {
    const owner = await registerOwner("Reverse");
    const p = await addProduct(owner.client, { pricePaise: 50000 });
    const r = await addRetailer(owner.client);
    const order = (await placeOrder(r.client, [{ productId: p.id, quantity: 2 }])).data;
    const payment = (await pay(owner.client, { retailerId: r.id, orderId: order.id, amountPaise: 100000 })).data;
    expect((await owner.client.get(`/api/biz/orders/${order.id}`)).data.paymentStatus).toBe("paid");

    // a paid order cannot be cancelled until the payment is reversed
    expect((await owner.client.post(`/api/biz/orders/${order.id}/status`, { status: "cancelled" })).status).toBe(409);
    expect((await owner.client.post(`/api/biz/payments/${payment.id}/reverse`, { reason: "" })).status).toBe(422);
    expect((await owner.client.post(`/api/biz/payments/${payment.id}/reverse`, { reason: "Cheque bounced" })).status).toBe(200);
    expect((await owner.client.post(`/api/biz/payments/${payment.id}/reverse`, { reason: "again" })).status).toBe(409);

    const after = (await owner.client.get(`/api/biz/orders/${order.id}`)).data;
    expect(after).toMatchObject({ paymentStatus: "unpaid", amountPaidPaise: 0 });
    const rows = await db.prepare("SELECT status FROM payments WHERE id = ?").bind(payment.id).first<any>();
    expect(rows.status).toBe("reversed");
    const adj = await db.prepare("SELECT type, amount_paise, reason FROM payment_adjustments WHERE payment_id = ?").bind(payment.id).first<any>();
    expect(adj).toEqual({ type: "reversal", amount_paise: 100000, reason: "Cheque bounced" });
    const list = await owner.client.get("/api/biz/payments");
    expect(list.data[0]).toMatchObject({ status: "reversed", reversalReason: "Cheque bounced" });
    expect(list.meta.summary.totalReceivedPaise).toBe(0);
    // there is no endpoint that deletes a payment
    expect((await owner.client.del(`/api/biz/payments/${payment.id}`)).status).toBe(404);
    expect((await owner.client.post(`/api/biz/orders/${order.id}/status`, { status: "cancelled" })).status).toBe(200);
  });

  it("rejects payments on cancelled orders and future-dated payments; the DB blocks overpayment", async () => {
    const owner = await registerOwner("Guards");
    const p = await addProduct(owner.client, { pricePaise: 10000 });
    const r = await addRetailer(owner.client);
    const cancelled = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    await r.client.post(`/api/retailer/orders/${cancelled.id}/cancel`);
    expect((await pay(owner.client, { retailerId: r.id, orderId: cancelled.id, amountPaise: 100 })).status).toBe(409);
    // cancelled orders are not owed
    expect((await owner.client.get(`/api/biz/retailers/${r.id}/ledger`)).data.totals.outstandingPaise).toBe(0);
    const live = (await placeOrder(r.client, [{ productId: p.id, quantity: 1 }])).data;
    expect((await pay(owner.client, { retailerId: r.id, orderId: live.id, amountPaise: 100, paymentDate: "2999-01-01" })).status).toBe(422);
    await expect(db.prepare("UPDATE orders SET amount_paid_paise = total_paise + 1 WHERE id = ?").bind(live.id).run()).rejects.toThrow(/CHECK/);
  });
});

describe("Scenario F — order price integrity", () => {
  it("existing orders keep their price when the catalogue price changes; new orders use the new price", async () => {
    const owner = await registerOwner("Snapshot");
    const p = await addProduct(owner.client, { name: "Cable 1m", pricePaise: 10000 });
    const r = await addRetailer(owner.client);
    const old = (await placeOrder(r.client, [{ productId: p.id, quantity: 3 }])).data;
    expect((await owner.client.patch(`/api/biz/products/${p.id}`, { pricePaise: 12000, name: "Cable 1m (new)" })).status).toBe(200);

    for (const client of [owner.client, r.client]) {
      const path = client === owner.client ? `/api/biz/orders/${old.id}` : `/api/retailer/orders/${old.id}`;
      const detail = (await client.get(path)).data;
      expect(detail.items[0]).toMatchObject({ unitPricePaise: 10000, lineSubtotalPaise: 30000, productName: "Cable 1m" });
      expect(detail.totalPaise).toBe(30000);
    }
    const fresh = (await placeOrder(r.client, [{ productId: p.id, quantity: 3 }])).data;
    expect(fresh.totalPaise).toBe(36000);
    const item = (await r.client.get(`/api/retailer/orders/${fresh.id}`)).data.items[0];
    expect(item.unitPricePaise).toBe(12000);
    // the price change itself is audit-logged
    const audit = await db.prepare("SELECT metadata FROM audit_logs WHERE entity_id = ? AND action = 'product.updated'").bind(p.id).first<any>();
    expect(JSON.parse(audit.metadata)).toEqual({ priceFrom: 10000, priceTo: 12000 });
  });
});

describe("catalogue management", () => {
  it("rejects duplicate SKUs, archives instead of deleting, and supports search / filter / sort", async () => {
    const owner = await registerOwner("Catalog");
    const cat = (await owner.client.post("/api/biz/categories", { name: "Lighting" })).data;
    expect((await owner.client.post("/api/biz/categories", { name: "lighting" })).status).toBe(409);
    const a = await addProduct(owner.client, { name: "Apple Lamp", sku: "LAMP-1", pricePaise: 300, categoryId: cat.id });
    await addProduct(owner.client, { name: "Zebra Cable", sku: "CBL-1", pricePaise: 100 });
    const dup = await owner.client.post("/api/biz/products", { name: "Dup", sku: "lamp-1", unit: "piece", pricePaise: 100 });
    expect(dup.status).toBe(409);
    expect(dup.error!.message).toMatch(/SKU/);

    const names = async (qs: string) => ((await owner.client.get(`/api/biz/products?${qs}`)).data as any[]).map((p) => p.name);
    expect(await names("q=lamp")).toEqual(["Apple Lamp"]);
    expect(await names("q=CBL")).toEqual(["Zebra Cable"]);
    expect(await names(`categoryId=${cat.id}`)).toEqual(["Apple Lamp"]);
    expect(await names("sort=-name")).toEqual(["Zebra Cable", "Apple Lamp"]);
    expect(await names("sort=price")).toEqual(["Zebra Cable", "Apple Lamp"]);
    expect(await names("q=%25")).toEqual([]); // wildcards are literal

    expect((await owner.client.del(`/api/biz/products/${a.id}`)).status).toBe(200);
    expect(await names("")).toEqual(["Zebra Cable"]);
    expect(await names("status=archived")).toEqual(["Apple Lamp"]);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM products WHERE id = ?").bind(a.id).first<any>()).n).toBe(1);
    // the SKU is free again, and restoring the old product then conflicts
    await addProduct(owner.client, { name: "New Lamp", sku: "LAMP-1" });
    expect((await owner.client.post(`/api/biz/products/${a.id}/restore`)).status).toBe(409);
    // pagination metadata
    const page = await owner.client.get("/api/biz/products?pageSize=1&page=2");
    expect(page.meta).toEqual({ page: 2, pageSize: 1, total: 2 });
    expect(page.data).toHaveLength(1);
  });

  it("CSV import validates every row before committing anything", async () => {
    const owner = await registerOwner("Import");
    await addProduct(owner.client, { sku: "EXIST-1" });
    const good = { name: "Switch 6A", sku: "SW-6A", category: "Switches", unit: "piece", price: "45.50", mrp: "60", gst_rate: "18", min_order_qty: "10", stock_qty: "500" };
    const bad = [
      good,
      { name: "", sku: "NO-NAME", price: "10" },
      { name: "Bad price", sku: "BAD-P", price: "ten" },
      { name: "Existing", sku: "exist-1", price: "10" },
      { name: "Twin", sku: "SW-6A", price: "10" },
    ];
    const res = await owner.client.post("/api/biz/products/import", { rows: bad, commit: true });
    expect(res.status).toBe(200);
    expect(res.data.committed).toBe(false);
    expect(res.data.errors.map((e: any) => e.row)).toEqual([3, 4, 5, 6]);
    expect(res.data.errors[1].messages.join(" ")).toMatch(/not a valid amount/);
    expect(res.data.errors[2].messages.join(" ")).toMatch(/already exists/);
    expect(res.data.errors[3].messages.join(" ")).toMatch(/Duplicate SKU/);
    expect((await owner.client.get("/api/biz/products")).meta.total).toBe(1); // nothing was imported

    const preview = await owner.client.post("/api/biz/products/import", { rows: [good], commit: false });
    expect(preview.data).toMatchObject({ committed: false, validCount: 1, errors: [] });
    expect((await owner.client.get("/api/biz/products")).meta.total).toBe(1);

    const commit = await owner.client.post("/api/biz/products/import", { rows: [good, { name: "Socket", sku: "SOC-1", category: "switches", price: "30" }], commit: true });
    expect(commit.status).toBe(201);
    const imported = (await owner.client.get("/api/biz/products?q=SW-6A")).data[0];
    expect(imported).toMatchObject({ pricePaise: 4550, mrpPaise: 6000, gstRateBp: 1800, minOrderQty: 10, stockQty: 500, categoryName: "Switches" });
    expect((await owner.client.get("/api/biz/categories")).data).toHaveLength(1); // category created once, case-insensitively
    const exported = await owner.client.get("/api/biz/products/export");
    expect(exported.data).toHaveLength(3);
  });
});

describe("retailer management", () => {
  it("creates, edits, searches and filters retailers and prevents duplicate phone numbers", async () => {
    const owner = await registerOwner("Retailers");
    const ph = phone();
    const created = await owner.client.post("/api/biz/retailers", { businessName: "Gupta Stores", contactPerson: "Mr Gupta", phone: ph, city: "Nagpur", gstin: "27ABCDE1234F1Z5" });
    expect(created.status).toBe(201);
    expect((await owner.client.post("/api/biz/retailers", { businessName: "Copy", contactPerson: "Copy", phone: ph })).status).toBe(409);
    expect((await owner.client.post("/api/biz/retailers", { businessName: "Bad", contactPerson: "Bad", phone: "123" })).status).toBe(422);
    await owner.client.post("/api/biz/retailers", { businessName: "Verma Mart", contactPerson: "Ms Verma", phone: phone(), city: "Pune" });
    const names = async (qs: string) => ((await owner.client.get(`/api/biz/retailers?${qs}`)).data as any[]).map((r) => r.businessName);
    expect(await names("q=gupta")).toEqual(["Gupta Stores"]);
    expect(await names("q=Pune")).toEqual(["Verma Mart"]);
    await owner.client.patch(`/api/biz/retailers/${created.data.id}`, { status: "inactive", city: "Wardha" });
    expect(await names("status=inactive")).toEqual(["Gupta Stores"]);
    expect(await names("status=active")).toEqual(["Verma Mart"]);
    const detail = (await owner.client.get(`/api/biz/retailers/${created.data.id}`)).data;
    expect(detail).toMatchObject({ city: "Wardha", status: "inactive", inviteState: "not_invited", gstin: "27ABCDE1234F1Z5" });
    // inactive retailers cannot be invited or ordered for
    expect((await owner.client.post(`/api/biz/retailers/${created.data.id}/invite`)).status).toBe(409);
  });
});

describe("reports", () => {
  it("aggregates real orders by period, retailer and product and excludes void orders from sales", async () => {
    const owner = await registerOwner("Reports");
    const p1 = await addProduct(owner.client, { name: "Alpha", pricePaise: 10000 });
    const p2 = await addProduct(owner.client, { name: "Beta", pricePaise: 2500 });
    const big = await addRetailer(owner.client, "Big");
    const small = await addRetailer(owner.client, "Small");
    const o1 = (await placeOrder(big.client, [{ productId: p1.id, quantity: 5 }, { productId: p2.id, quantity: 4 }])).data; // 600
    await placeOrder(small.client, [{ productId: p2.id, quantity: 2 }]); // 50
    const voided = (await placeOrder(small.client, [{ productId: p1.id, quantity: 9 }])).data;
    await small.client.post(`/api/retailer/orders/${voided.id}/cancel`);
    await pay(owner.client, { retailerId: big.id, orderId: o1.id, amountPaise: 10000 });

    const summary = (await owner.client.get("/api/biz/reports/summary")).data;
    expect(summary).toMatchObject({ orders: 3, validOrders: 2, salesPaise: 65000, collectedPaise: 10000, cancelledOrders: 1, activeRetailers: 2 });

    for (const group of ["day", "week", "month"]) {
      const rows = (await owner.client.get(`/api/biz/reports/orders?group=${group}`)).data;
      expect(rows, group).toHaveLength(1);
      expect(rows[0], group).toMatchObject({ orders: 3, salesPaise: 65000, cancelledOrders: 1 });
    }
    const byRetailer = (await owner.client.get("/api/biz/reports/sales-by-retailer")).data;
    expect(byRetailer.map((r: any) => [r.retailerId, r.salesPaise, r.outstandingPaise])).toEqual([[big.id, 60000, 50000], [small.id, 5000, 5000]]);
    const byProduct = (await owner.client.get("/api/biz/reports/sales-by-product")).data;
    expect(byProduct.map((r: any) => [r.productName, r.quantity, r.salesPaise])).toEqual([["Alpha", 5, 50000], ["Beta", 6, 15000]]);
    const outstanding = (await owner.client.get("/api/biz/reports/outstanding")).data;
    expect(outstanding.map((r: any) => r.outstandingPaise)).toEqual([50000, 5000]);

    // date range filtering: a window in the past contains nothing
    const past = (await owner.client.get("/api/biz/reports/summary?from=2020-01-01&to=2020-01-31")).data;
    expect(past.orders).toBe(0);
    expect((await owner.client.get("/api/biz/reports/summary?from=2025-02-01&to=2025-01-01")).status).toBe(422);

    const dash = (await owner.client.get("/api/biz/dashboard")).data;
    expect(dash.kpis).toMatchObject({ ordersToday: 3, pendingOrders: 2, monthlySalesPaise: 65000, outstandingPaise: 55000 });
    expect(dash.topProducts[0]).toMatchObject({ productName: "Alpha", quantity: 5 });
    expect(dash.ordersOverTime).toHaveLength(14);
    expect(dash.ordersOverTime[13].orders).toBe(3);
    expect(Object.fromEntries(dash.statusDistribution.map((s: any) => [s.status, s.count]))).toEqual({ pending: 2, cancelled: 1 });
  });
});

describe("misc", () => {
  it("retailer can update their own profile but not their identity fields", async () => {
    const owner = await registerOwner("Profile");
    const r = await addRetailer(owner.client);
    const res = await r.client.patch("/api/retailer/profile", { address: "12 MG Road", businessName: "Hacked", status: "inactive", businessId: "x" });
    expect(res.status).toBe(200);
    expect(res.data.address).toBe("12 MG Road");
    expect(res.data.businessName).not.toBe("Hacked");
    expect(res.data.status).toBe("active");
  });
  it("change password requires the current password", async () => {
    const owner = await registerOwner("Pw");
    expect((await owner.client.post("/api/auth/change-password", { currentPassword: "wrong", newPassword: "Another0ne!" })).status).toBe(422);
    expect((await owner.client.post("/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "Another0ne!" })).status).toBe(200);
    expect((await new Client().post("/api/auth/login", { email: owner.email, password: "Another0ne!" })).status).toBe(200);
  });
});
