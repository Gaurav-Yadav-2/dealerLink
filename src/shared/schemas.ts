import { z } from "zod";
import { AVAILABILITIES, ORDER_STATUSES, PAYMENT_METHODS, MAX_ORDER_LINES } from "./constants";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), trimmed(max).nullable().optional());

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Password must contain a letter and a number");
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .refine((v) => /^(\+?91)?[6-9]\d{9}$/.test(v), "Enter a valid 10-digit Indian mobile number")
  .transform((v) => v.slice(-10));
const gstinSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim().toUpperCase() : v),
  z
    .string()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "Enter a valid 15-character GSTIN")
    .nullable()
    .optional(),
);
const paise = z.number().int("Amount must be a whole number of paise").min(0).max(10_000_000_000);
const id = z.string().uuid();

export const registerSchema = z.object({
  name: trimmed(100).min(2, "Enter your name"),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  businessName: trimmed(100).min(3, "Business name must be at least 3 characters"),
  city: optionalText(80),
  state: optionalText(80),
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password").max(128) });
export const forgotSchema = z.object({ email: emailSchema });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
export const acceptInviteSchema = z.object({ name: trimmed(100).min(2, "Enter your name"), email: emailSchema, password: passwordSchema });

export const businessSettingsSchema = z.object({
  name: trimmed(100).min(3),
  phone: z.union([phoneSchema, z.literal("").transform(() => null), z.null()]).optional(),
  email: z.union([emailSchema, z.literal("").transform(() => null), z.null()]).optional(),
  address: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  gstin: gstinSchema,
  about: optionalText(500),
  trackInventory: z.boolean(),
  lowStockThreshold: z.number().int().min(0).max(100000),
  gstEnabled: z.boolean(),
  orderPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{1,5}$/, "Use 1-5 letters"),
});

export const categorySchema = z.object({ name: trimmed(60).min(1, "Enter a category name") });

export const productSchema = z.object({
  name: trimmed(150).min(1, "Enter a product name"),
  sku: trimmed(40).min(1, "Enter a SKU").regex(/^[A-Za-z0-9._\-/]+$/, "SKU may contain letters, numbers, . _ - /"),
  description: optionalText(1000),
  categoryId: id.nullable().optional(),
  unit: trimmed(20).min(1),
  pricePaise: paise,
  mrpPaise: paise.nullable().optional(),
  gstRateBp: z.number().int().min(0).max(2800).default(0),
  minOrderQty: z.number().int().min(1).max(100000).default(1),
  stockQty: z.number().int().min(0).max(100_000_000).nullable().optional(),
  availability: z.enum(AVAILABILITIES).default("in_stock"),
  imageUrl: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().url("Enter a valid image URL").max(500).refine((u) => /^https?:\/\//i.test(u), "Image URL must start with http(s)://").nullable().optional(),
  ),
  isActive: z.boolean().default(true),
});
export const productPatchSchema = productSchema.partial();

/** A CSV row after the client has parsed it; category is matched/created by name. */
export const productImportRowSchema = productSchema.omit({ categoryId: true }).extend({ category: optionalText(60) });
export const productImportSchema = z.object({
  rows: z.array(z.unknown()).min(1, "The file has no rows").max(500, "Import at most 500 rows at a time"),
  commit: z.boolean().default(false),
});

export const retailerSchema = z.object({
  businessName: trimmed(120).min(2, "Enter the shop / business name"),
  contactPerson: trimmed(100).min(2, "Enter a contact person"),
  phone: phoneSchema,
  email: z.union([emailSchema, z.literal("").transform(() => null), z.null()]).optional(),
  address: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  gstin: gstinSchema,
});
export const retailerPatchSchema = retailerSchema.partial().extend({ status: z.enum(["active", "inactive"]).optional() });
export const retailerSelfProfileSchema = retailerSchema.pick({ contactPerson: true, address: true, city: true, state: true, gstin: true }).partial();

export const retailerPricesSchema = z.object({
  items: z.array(z.object({ productId: id, pricePaise: paise.nullable() })).min(1).max(90),
});
export const bulkPriceSchema = z.object({
  /** percent off the standard price, e.g. 5 = 5% cheaper. 0 clears nothing; use `clear` to remove overrides. */
  mode: z.enum(["percent_off", "clear"]),
  percent: z.number().min(0.01).max(90).optional(),
  categoryId: id.nullable().optional(),
}).refine((v) => v.mode === "clear" || v.percent != null, { message: "Enter a percentage", path: ["percent"] });

export const orderLineSchema = z.object({ productId: id, quantity: z.number().int().min(1).max(1_000_000) });
export const manualOrderSchema = z.object({
  retailerId: id,
  items: z.array(orderLineSchema).min(1, "Add at least one product").max(MAX_ORDER_LINES),
  note: optionalText(500),
  discountPaise: paise.default(0),
  deliveryPaise: paise.default(0),
});
export const placeOrderSchema = z.object({ note: optionalText(500) });
export const cartItemSchema = z.object({ productId: id, quantity: z.number().int().min(0).max(1_000_000) });
export const orderStatusSchema = z.object({ status: z.enum(ORDER_STATUSES), note: optionalText(300) });
export const orderPatchSchema = z.object({
  internalNote: optionalText(1000),
  discountPaise: paise.optional(),
  deliveryPaise: paise.optional(),
});

export const paymentSchema = z.object({
  retailerId: id,
  orderId: id.nullable().optional(),
  amountPaise: z.number().int().min(1, "Enter an amount greater than zero").max(10_000_000_000),
  method: z.enum(PAYMENT_METHODS),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a payment date"),
  reference: optionalText(80),
  notes: optionalText(300),
});
export const reversalSchema = z.object({ reason: trimmed(300).min(3, "Give a reason for the reversal") });

export const adminStatusSchema = z.object({ status: z.enum(["active", "suspended"]), reason: optionalText(300) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type RetailerInput = z.infer<typeof retailerSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
