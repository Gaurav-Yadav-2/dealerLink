/**
 * Features the platform admin can switch on or off for each business.
 * Keys are camelCase because API responses camelize object keys.
 * Everything is ON unless the admin switches it off, so existing businesses are unaffected.
 * `enforced: "server"` means the API refuses the action; "screen" means it only changes what is shown
 * (used where there is nothing for the server to block, e.g. WhatsApp links that open the user's own app).
 */
export const FEATURES = [
  { key: "retailerPricing", label: "Retailer-specific pricing", description: "Special prices per retailer. When off, every retailer pays the standard price; saved special prices are kept and return if switched back on.", enforced: "server" },
  { key: "gst", label: "GST on orders", description: "Lets the wholesaler add GST to orders. When off, orders are created without GST.", enforced: "server" },
  { key: "phoneAlerts", label: "Phone alerts", description: "Automatic push notifications for the wholesaler and its retailers.", enforced: "server" },
  { key: "productPhotos", label: "Product photo upload", description: "Uploading photos from the camera or files. Existing photos and image links keep working.", enforced: "server" },
  { key: "csv", label: "CSV import / export", description: "Bulk product import and export, and report downloads.", enforced: "server" },
  { key: "reports", label: "Reports", description: "The Reports section (sales, outstanding, cancelled). The overview dashboard always stays.", enforced: "server" },
  { key: "manualOrders", label: "Manual order entry", description: "The wholesaler can create orders on a retailer's behalf.", enforced: "server" },
  { key: "onAccountPayments", label: "On-account payments", description: "Recording a lump-sum payment applied to the oldest unpaid orders. When off, every payment must be for a specific order.", enforced: "server" },
  { key: "whatsapp", label: "WhatsApp buttons", description: "Ready-made WhatsApp messages (order updates, reminders, invitations).", enforced: "screen" },
  { key: "hindi", label: "Hindi for retailers", description: "The English / Hindi switch in the retailer app. When off, retailers see English.", enforced: "screen" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureSet = Record<FeatureKey, boolean>;

export const FEATURE_KEYS = FEATURES.map((f) => f.key) as FeatureKey[];
export const isFeatureKey = (k: string): k is FeatureKey => (FEATURE_KEYS as string[]).includes(k);

/** All features on — the default for every business. */
export const allFeaturesOn = (): FeatureSet => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as FeatureSet;
