import { ORDER_STATUS_LABELS, type OrderStatus } from "@shared/constants";
import { formatINR } from "@shared/money";

/**
 * WhatsApp click-to-chat links (https://wa.me/<number>?text=<url-encoded message>).
 * This is the free, official deep-link format: it opens WhatsApp with the message pre-filled
 * and the user presses send. No WhatsApp Business API is involved.
 */
export function waLink(phone: string | null | undefined, message: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const number = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export const messages = {
  orderReceived: (o: { orderNumber: string; totalPaise: number }, business: string) =>
    `Hello, your order #${o.orderNumber} has been received. Total amount: ${formatINR(o.totalPaise)}. We will update the order status shortly.\n— ${business}`,

  orderStatus: (o: { orderNumber: string; status: OrderStatus; totalPaise: number }, business: string) => {
    const lines: Record<OrderStatus, string> = {
      pending: `Your order #${o.orderNumber} has been received and is awaiting confirmation.`,
      accepted: `Your order #${o.orderNumber} has been accepted.`,
      rejected: `Sorry, we are unable to fulfil your order #${o.orderNumber}. Please contact us for details.`,
      processing: `Your order #${o.orderNumber} is being processed.`,
      ready_for_dispatch: `Your order #${o.orderNumber} is packed and ready for dispatch.`,
      dispatched: `Your order #${o.orderNumber} has been dispatched.`,
      delivered: `Your order #${o.orderNumber} has been delivered. Thank you for your business!`,
      cancelled: `Your order #${o.orderNumber} has been cancelled.`,
    };
    return `${lines[o.status]}\nOrder total: ${formatINR(o.totalPaise)}\n— ${business}`;
  },

  orderDetails: (
    o: { orderNumber: string; status: OrderStatus; totalPaise: number; amountPaidPaise: number; items: { productName: string; quantity: number; unit: string; lineSubtotalPaise: number }[] },
    business: string,
  ) => {
    const items = o.items.map((i) => `• ${i.productName} × ${i.quantity} ${i.unit} — ${formatINR(i.lineSubtotalPaise)}`).join("\n");
    const due = o.totalPaise - o.amountPaidPaise;
    return `*Order #${o.orderNumber}* (${ORDER_STATUS_LABELS[o.status]})\n${items}\n\n*Total: ${formatINR(o.totalPaise)}*${due > 0 && due !== o.totalPaise ? `\nBalance due: ${formatINR(due)}` : ""}\n— ${business}`;
  },

  paymentReminder: (outstandingPaise: number, business: string) =>
    `Hello, this is a reminder that ${formatINR(outstandingPaise)} is outstanding against your account. Kindly arrange the payment at the earliest.\n— ${business}`,

  paymentReceived: (amountPaise: number, outstandingPaise: number, business: string) =>
    `Thank you! We have received your payment of ${formatINR(amountPaise)}.${outstandingPaise > 0 ? ` Balance outstanding: ${formatINR(outstandingPaise)}.` : " Your account is fully settled."}\n— ${business}`,

  invitation: (contact: string, business: string, link: string) =>
    `Hello ${contact}, ${business} invites you to order online on DealerLink. See your price list, place orders and track payments here:\n${link}\n(This link is valid for 7 days.)`,

  passwordReset: (link: string) => `Use this link to set a new DealerLink password (valid for 60 minutes):\n${link}`,

  newOrderToWholesaler: (o: { orderNumber: string; totalPaise: number }, retailer: string) =>
    `Hello, ${retailer} has placed order #${o.orderNumber} for ${formatINR(o.totalPaise)} on DealerLink.`,
};
