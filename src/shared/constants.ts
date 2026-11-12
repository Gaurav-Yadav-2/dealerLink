export const ORDER_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "processing",
  "ready_for_dispatch",
  "dispatched",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  processing: "Processing",
  ready_for_dispatch: "Ready for dispatch",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Transitions a wholesaler may make. Retailers may only cancel a pending order. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["accepted", "rejected", "cancelled"],
  accepted: ["processing", "cancelled"],
  processing: ["ready_for_dispatch", "dispatched", "cancelled"],
  ready_for_dispatch: ["dispatched", "cancelled"],
  dispatched: ["delivered"],
  delivered: [],
  rejected: [],
  cancelled: [],
};

/** Orders in these states are void: they do not count as sales or as money owed. */
export const VOID_STATUSES: OrderStatus[] = ["rejected", "cancelled"];

export const PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Partially paid",
  paid: "Paid",
};

export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

export const UNITS = ["piece", "box", "packet", "dozen", "kg", "gram", "litre", "ml", "metre", "set", "carton", "bag"] as const;

export const AVAILABILITIES = ["in_stock", "low_stock", "out_of_stock"] as const;
export type Availability = (typeof AVAILABILITIES)[number];
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
};

/** GST slabs offered in the UI, in basis points. */
export const GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

export const MAX_ORDER_LINES = 80;
export const INVITATION_TTL_DAYS = 7;
export const RESET_TTL_MINUTES = 60;
/** A session ends after this long no matter what … */
export const SESSION_TTL_DAYS = 7;
/** … or after this long without any activity. */
export const SESSION_IDLE_HOURS = 12;
/** All business-day maths (today, daily reports) uses India Standard Time. */
export const IST_OFFSET_MINUTES = 330;
