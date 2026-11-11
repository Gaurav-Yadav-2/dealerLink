// Seeds ONE clearly-labelled demo wholesaler, two demo retailers and a demo admin into the LOCAL database.
//
// Safety:
//   * This script only ever targets the local D1 database (there is no --remote option).
//   * Every demo user has is_demo = 1. The API refuses demo logins unless ALLOW_DEMO_ACCOUNTS="true",
//     which is set only in .dev.vars — so even if these rows reached production they could not be used.
import { randomUUID } from "node:crypto";
import { hashPassword, insert, q, runSql } from "./lib.mjs";

if (process.argv.includes("--remote")) {
  console.error("Refusing to seed a remote database. Demo data is for local development only.");
  process.exit(1);
}

const PASSWORD = "Demo@12345";
const BIZ = "d0000000-0000-4000-8000-000000000001";
const U = { owner: "d0000000-0000-4000-8000-0000000000a1", r1: "d0000000-0000-4000-8000-0000000000a2", r2: "d0000000-0000-4000-8000-0000000000a3", admin: "d0000000-0000-4000-8000-0000000000a4" };
const R = { r1: "d0000000-0000-4000-8000-0000000000b1", r2: "d0000000-0000-4000-8000-0000000000b2", r3: "d0000000-0000-4000-8000-0000000000b3" };

const iso = (daysAgo, hour = 11) => {
  const d = new Date(Date.now() - daysAgo * 86400000);
  d.setUTCHours(hour - 5, 30 - 30, 0, 0); // roughly `hour` o'clock IST
  return d > new Date() ? new Date(Date.now() - 60000).toISOString() : d.toISOString();
};
const istDate = (isoStr) => new Date(new Date(isoStr).getTime() + 330 * 60000).toISOString().slice(0, 10);
const now = new Date().toISOString();
const sql = [];

// ── wipe previous demo data (child tables first) ──
for (const t of ["notifications", "audit_logs", "payment_adjustments", "payment_allocations", "payments", "order_status_history", "order_items", "orders", "cart_items", "carts", "retailer_product_prices", "products", "categories", "retailer_invitations", "retailer_profiles", "business_members"]) {
  sql.push(`DELETE FROM ${t} WHERE business_id = ${q(BIZ)};`);
}
sql.push(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1);`);
sql.push(`DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE is_demo = 1);`);
sql.push(`DELETE FROM businesses WHERE id = ${q(BIZ)};`);
sql.push(`DELETE FROM users WHERE is_demo = 1;`);

// ── users ──
const users = [
  { id: U.owner, email: "demo.owner@dealerlink.test", name: "Rajesh Sharma (Demo)", phone: "9810000001", role: "owner" },
  { id: U.r1, email: "demo.retailer1@dealerlink.test", name: "Anil Gupta (Demo)", phone: "9810000002", role: "retailer" },
  { id: U.r2, email: "demo.retailer2@dealerlink.test", name: "Sunita Verma (Demo)", phone: "9810000003", role: "retailer" },
  { id: U.admin, email: "demo.admin@dealerlink.test", name: "Platform Admin (Demo)", phone: null, role: "admin" },
];
for (const u of users) sql.push(insert("users", { ...u, password_hash: await hashPassword(PASSWORD), is_demo: 1, created_at: iso(60), updated_at: iso(60) }));

// ── business ──
sql.push(insert("businesses", {
  id: BIZ, name: "Sharma Electricals (Demo)", slug: "sharma-electricals-demo", owner_user_id: U.owner, phone: "9810000001", email: "demo.owner@dealerlink.test",
  address: "14, Lohar Chawl, Kalbadevi", city: "Mumbai", state: "Maharashtra", gstin: "27ABCDE1234F1Z5",
  about: "DEMO STORE — sample data for trying DealerLink. Wholesale distributor of lighting, switches and wiring accessories.",
  track_inventory: 1, low_stock_threshold: 25, gst_enabled: 1, order_prefix: "DL", next_order_seq: 1000, created_at: iso(60), updated_at: iso(60),
}));
sql.push(insert("business_members", { id: randomUUID(), business_id: BIZ, user_id: U.owner, role: "owner", created_at: iso(60) }));

// ── retailers (two registered, one not yet invited) ──
const retailers = [
  { id: R.r1, user_id: U.r1, business_name: "Gupta Light House (Demo)", contact_person: "Anil Gupta", phone: "9810000002", email: "demo.retailer1@dealerlink.test", address: "Shop 7, Station Road", city: "Thane", registered_at: iso(55) },
  { id: R.r2, user_id: U.r2, business_name: "Verma Hardware & Electricals (Demo)", contact_person: "Sunita Verma", phone: "9810000003", email: "demo.retailer2@dealerlink.test", address: "221, MG Road", city: "Pune", registered_at: iso(50) },
  { id: R.r3, user_id: null, business_name: "New Bharat Traders (Demo)", contact_person: "Imran Shaikh", phone: "9810000004", email: null, address: "Market Yard", city: "Nashik", registered_at: null },
];
for (const r of retailers) sql.push(insert("retailer_profiles", { ...r, business_id: BIZ, state: "Maharashtra", gstin: null, status: "active", created_at: iso(58), updated_at: iso(58) }));

// ── catalogue ──
const cats = Object.fromEntries(["Lighting", "Switches & Sockets", "Wires & Cables", "Fans"].map((n) => [n, randomUUID()]));
for (const [name, id] of Object.entries(cats)) sql.push(insert("categories", { id, business_id: BIZ, name, created_at: iso(58), updated_at: iso(58) }));

//           name,                     sku,        category,             unit,     price, mrp,   gst,  moq, stock
const rows = [
  ["LED Bulb 9W Cool Daylight", "LED-9W", "Lighting", "piece", 6500, 11000, 1200, 10, 800],
  ["LED Bulb 12W Cool Daylight", "LED-12W", "Lighting", "piece", 8000, 13500, 1200, 10, 640],
  ["LED Tube Light 20W 4ft", "TUBE-20W", "Lighting", "piece", 19500, 32000, 1200, 6, 210],
  ["LED Panel Light 15W Round", "PANEL-15W", "Lighting", "piece", 28000, 45000, 1200, 4, 18],
  ["Modular Switch 6A One-way", "SW-6A", "Switches & Sockets", "piece", 2800, 4500, 1800, 20, 1500],
  ["Modular Socket 6A 3-pin", "SOC-6A", "Switches & Sockets", "piece", 6200, 9900, 1800, 10, 700],
  ["Modular Socket 16A 3-pin", "SOC-16A", "Switches & Sockets", "piece", 11800, 18500, 1800, 10, 0],
  ["4-Module Switch Plate White", "PLATE-4M", "Switches & Sockets", "piece", 5400, 8500, 1800, 10, 420],
  ["FR PVC Wire 1.5 sq mm (90m)", "WIRE-1.5", "Wires & Cables", "box", 132000, 185000, 1800, 1, 60],
  ["FR PVC Wire 2.5 sq mm (90m)", "WIRE-2.5", "Wires & Cables", "box", 210000, 295000, 1800, 1, 44],
  ["Ceiling Fan 1200mm Brown", "FAN-1200", "Fans", "piece", 145000, 219000, 1800, 2, 35],
  ["Insulation Tape Black (pack of 10)", "TAPE-10", "Wires & Cables", "packet", 9000, 15000, 1800, 5, null],
];
const P = {};
for (const [name, sku, cat, unit, price, mrp, gst, moq, stock] of rows) {
  const id = randomUUID();
  P[sku] = { id, name, sku, unit, price, gst };
  sql.push(insert("products", { id, business_id: BIZ, category_id: cats[cat], name, sku, description: null, unit, price_paise: price, mrp_paise: mrp, gst_rate_bp: gst, min_order_qty: moq, stock_qty: stock, availability: "in_stock", image_url: null, is_active: 1, created_at: iso(57), updated_at: iso(57) }));
}

// ── retailer-specific prices: Retailer A gets ₹75 on the 12W bulb, Retailer B ₹72 (standard is ₹80) ──
const overrides = { [R.r1]: { "LED-12W": 7500, "LED-9W": 6200, "SW-6A": 2650 }, [R.r2]: { "LED-12W": 7200, "WIRE-1.5": 128000 } };
for (const [rid, map] of Object.entries(overrides)) {
  for (const [sku, price] of Object.entries(map)) sql.push(insert("retailer_product_prices", { id: randomUUID(), business_id: BIZ, retailer_id: rid, product_id: P[sku].id, price_paise: price, created_at: iso(56), updated_at: iso(56) }));
}
const priceFor = (rid, sku) => overrides[rid]?.[sku] ?? P[sku].price;
const gstOn = (sub, bp) => Math.floor((sub * bp + 5000) / 10000);

// ── orders with full status history and payments ──
const FLOW = ["pending", "accepted", "processing", "ready_for_dispatch", "dispatched", "delivered"];
let seq = 1000;
const orders = [
  { r: "r1", days: 34, status: "delivered", lines: [["LED-12W", 100], ["LED-9W", 60], ["SW-6A", 200]], pay: "full" },
  { r: "r2", days: 29, status: "delivered", lines: [["WIRE-1.5", 6], ["SOC-6A", 80]], pay: "full" },
  { r: "r1", days: 21, status: "delivered", lines: [["TUBE-20W", 48], ["PLATE-4M", 60]], pay: "full" },
  { r: "r2", days: 16, status: "delivered", lines: [["LED-12W", 150], ["FAN-1200", 6]], pay: 1000000 },
  { r: "r1", days: 12, status: "cancelled", lines: [["FAN-1200", 4]], pay: 0 },
  { r: "r2", days: 9, status: "dispatched", lines: [["WIRE-2.5", 4], ["TAPE-10", 20]], pay: 0 },
  { r: "r1", days: 6, status: "processing", lines: [["LED-12W", 80], ["SOC-6A", 40], ["PANEL-15W", 12]], pay: 500000 },
  { r: "r2", days: 3, status: "accepted", lines: [["LED-9W", 120], ["SW-6A", 300]], pay: 0 },
  { r: "r1", days: 1, status: "pending", lines: [["TUBE-20W", 24], ["LED-9W", 50]], pay: 0, note: "Please deliver before Saturday." },
  { r: "r2", days: 0, status: "pending", lines: [["PLATE-4M", 40], ["SOC-6A", 30]], pay: 0 },
];
for (const o of orders) {
  const rid = R[o.r];
  const uid = U[o.r];
  const id = randomUUID();
  const orderNumber = `DL${seq++}`;
  const created = iso(o.days, 10);
  let subtotal = 0;
  let tax = 0;
  const items = o.lines.map(([sku, qty]) => {
    const unit = priceFor(rid, sku);
    const line = unit * qty;
    const gst = gstOn(line, P[sku].gst);
    subtotal += line;
    tax += gst;
    return { id: randomUUID(), order_id: id, business_id: BIZ, product_id: P[sku].id, product_name: P[sku].name, sku, unit: P[sku].unit, unit_price_paise: unit, quantity: qty, line_subtotal_paise: line, gst_rate_bp: P[sku].gst, gst_amount_paise: gst, stock_deducted: 0, created_at: created };
  });
  const total = subtotal + tax;
  const paid = o.pay === "full" ? total : Math.min(o.pay, total);
  sql.push(insert("orders", {
    id, business_id: BIZ, retailer_id: rid, order_number: orderNumber, status: o.status, payment_status: paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid",
    subtotal_paise: subtotal, tax_paise: tax, discount_paise: 0, delivery_paise: 0, total_paise: total, amount_paid_paise: paid, retailer_note: o.note ?? null,
    internal_note: null, source: "retailer", placed_by_user_id: uid, created_at: created, updated_at: created,
  }));
  for (const it of items) sql.push(insert("order_items", it));

  const path = o.status === "cancelled" ? ["pending", "cancelled"] : FLOW.slice(0, FLOW.indexOf(o.status) + 1);
  path.forEach((to, i) => {
    const byRetailer = i === 0 || to === "cancelled";
    sql.push(insert("order_status_history", {
      id: randomUUID(), order_id: id, business_id: BIZ, from_status: i === 0 ? null : path[i - 1], to_status: to, actor_user_id: byRetailer ? uid : U.owner, actor_role: byRetailer ? "retailer" : "owner",
      note: to === "cancelled" ? "Cancelled by retailer" : to === "dispatched" ? "Sent by tempo" : null, created_at: new Date(new Date(created).getTime() + i * 5 * 3600000 > Date.now() ? Date.now() - (path.length - i) * 60000 : new Date(created).getTime() + i * 5 * 3600000).toISOString(),
    }));
  });
  if (paid > 0) {
    const pid = randomUUID();
    const when = iso(Math.max(0, o.days - 2), 16);
    sql.push(insert("payments", { id: pid, business_id: BIZ, retailer_id: rid, order_id: id, reference: o.pay === "full" ? `UPI${Math.floor(100000 + Math.random() * 899999)}` : null, payment_date: istDate(when), amount_paise: paid, method: o.pay === "full" ? "upi" : "cash", notes: null, status: "recorded", recorded_by: U.owner, created_at: when }));
    sql.push(insert("payment_allocations", { id: randomUUID(), payment_id: pid, order_id: id, business_id: BIZ, amount_paise: paid, created_at: when }));
  }
  if (o.status === "pending") sql.push(insert("notifications", { id: randomUUID(), user_id: U.owner, business_id: BIZ, type: "order_new", title: `New order ${orderNumber}`, body: `${retailers.find((x) => x.id === rid).business_name} placed an order.`, link: `/dashboard/orders/${id}`, created_at: created }));
}
sql.push(`UPDATE businesses SET next_order_seq = ${seq} WHERE id = ${q(BIZ)};`);
sql.push(insert("audit_logs", { id: randomUUID(), business_id: BIZ, actor_user_id: U.owner, action: "demo.seeded", entity_type: "business", entity_id: BIZ, metadata: null, created_at: now }));

runSql("scripts/.seed.sql", sql.join("\n"));

console.log(`
Demo data seeded into the LOCAL database.

  Wholesaler   demo.owner@dealerlink.test
  Retailer A   demo.retailer1@dealerlink.test   (special prices, e.g. LED Bulb 12W at Rs 75)
  Retailer B   demo.retailer2@dealerlink.test   (special prices, e.g. LED Bulb 12W at Rs 72)
  Admin        demo.admin@dealerlink.test
  Password     ${PASSWORD}   (all demo accounts)

Demo logins work only when ALLOW_DEMO_ACCOUNTS=true (set in .dev.vars for local development).
`);
