import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@shared/constants";
import { formatDate } from "./format";

/** jsPDF's built-in fonts have no ₹ glyph, so the PDF uses "Rs." */
const rs = (paise: number) => "Rs. " + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Biz = { name: string; address?: string | null; city?: string | null; state?: string | null; phone?: string | null; gstin?: string | null };

/**
 * Generates an order summary PDF entirely in the browser (jsPDF is loaded on demand so it
 * does not slow down the first page load). This is an order summary, not a statutory GST tax invoice.
 */
export async function downloadOrderPdf(order: any, business: Biz) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const navy: [number, number, number] = [30, 42, 94];

  doc.setFillColor(...navy);
  doc.rect(0, 0, W, 6, "F");
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...navy);
  doc.text(business.name, M, 44);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  const bizLines = [[business.address, business.city, business.state].filter(Boolean).join(", "), business.phone ? `Phone: ${business.phone}` : "", business.gstin ? `GSTIN: ${business.gstin}` : ""].filter(Boolean);
  bizLines.forEach((l, i) => doc.text(l, M, 60 + i * 12));

  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(30);
  doc.text("ORDER SUMMARY", W - M, 44, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  [`Order #${order.orderNumber}`, `Date: ${formatDate(order.createdAt)}`, `Status: ${ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]}`, `Payment: ${PAYMENT_STATUS_LABELS[order.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS]}`]
    .forEach((l, i) => doc.text(l, W - M, 60 + i * 12, { align: "right" }));

  let y = 122;
  doc.setDrawColor(225).line(M, y - 12, W - M, y - 12);
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(120).text("BILL TO", M, y);
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(30).text(order.retailerName, M, y + 15);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  const to = [order.retailerContact, [order.retailerAddress, order.retailerCity, order.retailerState].filter(Boolean).join(", "), order.retailerPhone ? `Phone: ${order.retailerPhone}` : "", order.retailerGstin ? `GSTIN: ${order.retailerGstin}` : ""].filter(Boolean);
  to.forEach((l: string, i: number) => doc.text(l, M, y + 29 + i * 12));
  y += 40 + to.length * 12;

  const hasGst = order.taxPaise > 0;
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["#", "Product", "SKU", "Qty", "Rate", ...(hasGst ? ["GST"] : []), "Amount"]],
    body: order.items.map((it: any, i: number) => [
      i + 1, it.productName, it.sku, `${it.quantity} ${it.unit}`, rs(it.unitPricePaise),
      ...(hasGst ? [`${it.gstRateBp / 100}%`] : []), rs(it.lineSubtotalPaise),
    ]),
    styles: { fontSize: 9, cellPadding: 6, textColor: 40, lineColor: 230, lineWidth: 0.5 },
    headStyles: { fillColor: navy, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 251] },
    columnStyles: { 0: { cellWidth: 24 }, 3: { halign: "right" }, 4: { halign: "right" }, [hasGst ? 5 : 99]: { halign: "right" }, [hasGst ? 6 : 5]: { halign: "right" } },
  });

  let ty = (doc as any).lastAutoTable.finalY + 18;
  const row = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(bold ? 11 : 9).setTextColor(bold ? 20 : 90);
    doc.text(label, W - M - 170, ty);
    doc.text(value, W - M, ty, { align: "right" });
    ty += bold ? 18 : 14;
  };
  row("Subtotal", rs(order.subtotalPaise));
  if (hasGst) row("GST", rs(order.taxPaise));
  if (order.discountPaise > 0) row("Discount", "- " + rs(order.discountPaise));
  if (order.deliveryPaise > 0) row("Delivery charges", rs(order.deliveryPaise));
  doc.setDrawColor(210).line(W - M - 170, ty - 6, W - M, ty - 6);
  ty += 6;
  row("Total", rs(order.totalPaise), true);
  row("Paid", rs(order.amountPaidPaise));
  row("Balance due", rs(order.totalPaise - order.amountPaidPaise), true);

  if (order.retailerNote) {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(120).text("NOTE FROM RETAILER", M, ty + 6);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60).text(doc.splitTextToSize(order.retailerNote, W - 2 * M), M, ty + 20);
  }
  doc.setFontSize(8).setTextColor(150).text("Generated with DealerLink. This is an order summary, not a tax invoice.", M, doc.internal.pageSize.getHeight() - 28);
  doc.save(`Order-${order.orderNumber}.pdf`);
}
