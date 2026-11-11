import { describe, expect, it } from "vitest";
import { formatINR, gstAmount, paiseToRupeesString, rupeesToPaise } from "../src/shared/money";
import { ORDER_TRANSITIONS } from "../src/shared/constants";
import { passwordSchema, phoneSchema, productSchema, retailerSchema } from "../src/shared/schemas";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "../src/worker/lib/crypto";
import { priceLines, type PricedProduct } from "../src/worker/lib/orders";
import { resolveAvailability, slugify } from "../src/worker/lib/util";
import { camelize, like } from "../src/worker/lib/http";

describe("money", () => {
  it("converts rupees to integer paise without float drift", () => {
    expect(rupeesToPaise("100")).toBe(10000);
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise("1,250.50")).toBe(125050);
    expect(rupeesToPaise("₹ 80")).toBe(8000);
  });
  it("rejects invalid amounts", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "."]) expect(rupeesToPaise(bad)).toBeNull();
  });
  it("round-trips paise to a rupee string", () => {
    expect(paiseToRupeesString(125050)).toBe("1250.50");
    expect(paiseToRupeesString(8000)).toBe("80");
    expect(paiseToRupeesString(null)).toBe("");
  });
  it("formats INR with Indian digit grouping", () => {
    expect(formatINR(12345678)).toContain("1,23,456.78");
  });
  it("computes GST with half-up rounding in integer maths", () => {
    expect(gstAmount(10000, 1800)).toBe(1800);
    expect(gstAmount(999, 500)).toBe(50); // 49.95 -> 50
    expect(gstAmount(333, 1200)).toBe(40); // 39.96 -> 40
    expect(gstAmount(10000, 0)).toBe(0);
  });
});

describe("validation schemas", () => {
  it("normalises Indian phone numbers", () => {
    expect(phoneSchema.parse("+91 98765 43210")).toBe("9876543210");
    expect(phoneSchema.safeParse("12345").success).toBe(false);
  });
  it("enforces password strength", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("allletters").success).toBe(false);
    expect(passwordSchema.safeParse("goodPass123").success).toBe(true);
  });
  it("rejects fractional or negative prices", () => {
    const base = { name: "X", sku: "X-1", unit: "piece" };
    expect(productSchema.safeParse({ ...base, pricePaise: 10.5 }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, pricePaise: -1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, pricePaise: 100 }).success).toBe(true);
  });
  it("validates GSTIN format", () => {
    const base = { businessName: "Shop", contactPerson: "Ravi", phone: "9876543210" };
    expect(retailerSchema.safeParse({ ...base, gstin: "27ABCDE1234F1Z5" }).success).toBe(true);
    expect(retailerSchema.safeParse({ ...base, gstin: "NOTAGSTIN" }).success).toBe(false);
    expect(retailerSchema.parse({ ...base, gstin: "" }).gstin).toBeNull();
  });
});

describe("crypto", () => {
  it("hashes passwords with a per-password salt and verifies them", async () => {
    const a = await hashPassword("secret123");
    const b = await hashPassword("secret123");
    expect(a).not.toBe(b);
    expect(a.startsWith("pbkdf2$100000$")).toBe(true);
    expect(a).not.toContain("secret123");
    expect(await verifyPassword("secret123", a)).toBe(true);
    expect(await verifyPassword("secret124", a)).toBe(false);
    expect(await verifyPassword("secret123", "garbage")).toBe(false);
  });
  it("generates unguessable url-safe tokens", async () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("helpers", () => {
  it("slugifies business names", () => {
    expect(slugify("Sharma Electricals & Sons Pvt. Ltd.")).toBe("sharma-electricals-sons-pvt-ltd");
    expect(slugify("!!!")).toBe("store");
  });
  it("escapes LIKE wildcards", () => {
    expect(like("50%_off")).toBe("%50\\%\\_off%");
  });
  it("camelizes nested rows", () => {
    expect(camelize({ order_number: "DL1", items: [{ unit_price_paise: 5 }] })).toEqual({ orderNumber: "DL1", items: [{ unitPricePaise: 5 }] });
  });
  it("derives availability from stock only when tracking is on", () => {
    const biz = { track_inventory: 1, low_stock_threshold: 10 };
    expect(resolveAvailability({ stock_qty: 0, availability: "in_stock" }, biz)).toBe("out_of_stock");
    expect(resolveAvailability({ stock_qty: 5, availability: "in_stock" }, biz)).toBe("low_stock");
    expect(resolveAvailability({ stock_qty: 50, availability: "out_of_stock" }, biz)).toBe("in_stock");
    expect(resolveAvailability({ stock_qty: 0, availability: "in_stock" }, { ...biz, track_inventory: 0 })).toBe("in_stock");
    expect(resolveAvailability({ stock_qty: null, availability: "low_stock" }, biz)).toBe("low_stock");
  });
  it("never allows leaving a terminal order state", () => {
    for (const s of ["delivered", "rejected", "cancelled"] as const) expect(ORDER_TRANSITIONS[s]).toEqual([]);
    expect(ORDER_TRANSITIONS.pending).toContain("accepted");
    expect(ORDER_TRANSITIONS.dispatched).toEqual(["delivered"]);
  });
});

describe("priceLines", () => {
  const biz: any = { track_inventory: 1, low_stock_threshold: 5, gst_enabled: 1 };
  const product = (over: Partial<PricedProduct> = {}): PricedProduct => ({
    id: "p1", name: "Bulb", sku: "B1", unit: "piece", price_paise: 8000, effective_price_paise: 7500, gst_rate_bp: 1800,
    min_order_qty: 2, stock_qty: 10, availability: "in_stock", is_active: 1, archived_at: null, ...over,
  });
  it("prices with the effective price and adds GST", () => {
    const r = priceLines(biz, new Map([["p1", product()]]), [{ productId: "p1", quantity: 4 }]);
    expect(r.issues).toEqual([]);
    expect(r.subtotal).toBe(30000);
    expect(r.tax).toBe(5400);
  });
  it("skips GST when the business has it disabled", () => {
    const r = priceLines({ ...biz, gst_enabled: 0 }, new Map([["p1", product()]]), [{ productId: "p1", quantity: 4 }]);
    expect(r.tax).toBe(0);
  });
  it("reports minimum quantity, stock and availability problems", () => {
    const map = new Map([["p1", product()]]);
    expect(priceLines(biz, map, [{ productId: "p1", quantity: 1 }]).issues[0].message).toContain("minimum order quantity");
    expect(priceLines(biz, map, [{ productId: "p1", quantity: 11 }]).issues[0].message).toContain("only 10");
    expect(priceLines(biz, new Map([["p1", product({ is_active: 0 })]]), [{ productId: "p1", quantity: 2 }]).issues).toHaveLength(1);
    expect(priceLines(biz, new Map(), [{ productId: "nope", quantity: 2 }]).issues).toHaveLength(1);
    const manual = product({ stock_qty: null, availability: "out_of_stock" });
    expect(priceLines(biz, new Map([["p1", manual]]), [{ productId: "p1", quantity: 2 }]).issues[0].message).toContain("out of stock");
  });
});
