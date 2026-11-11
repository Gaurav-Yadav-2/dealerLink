import { Check, FileDown, Pencil, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PAYMENT_METHOD_LABELS, type OrderStatus } from "@shared/constants";
import { BackLink, OrderItemsTable, OrderStatusBadge, OrderTimeline, OrderTotals, PaymentStatusBadge, WhatsAppLink } from "@/components/shared";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, Modal, ModalFooter, PageHeader, Skeleton, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatINR, paiseToRupeesString, rupeesToPaise } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { downloadOrderPdf } from "@/lib/pdf";
import { messages } from "@/lib/whatsapp";
import { RecordPaymentDialog } from "./Payments";

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  accepted: "Accept order", processing: "Start processing", ready_for_dispatch: "Mark ready for dispatch", dispatched: "Mark dispatched", delivered: "Mark delivered",
};

export default function OrderDetail() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const q = useApi<any>(`/biz/orders/${id}`);
  const [confirming, setConfirming] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const [paying, setPaying] = useState(false);
  const [charges, setCharges] = useState(false);
  const [discount, setDiscount] = useState("");
  const [delivery, setDelivery] = useState("");
  const [internal, setInternal] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [lastChange, setLastChange] = useState<OrderStatus | null>(null);

  const order = q.data?.data;
  useEffect(() => setInternal(null), [id]);

  const move = useAction((v: { status: OrderStatus; note: string }) => api.post(`/biz/orders/${id}/status`, v), {
    success: (_d, v) => `Order marked ${ORDER_STATUS_LABELS[v.status].toLowerCase()}`,
    onSuccess: (_d, v) => { setConfirming(null); setNote(""); setLastChange(v.status); },
  });
  const saveNote = useAction(() => api.patch(`/biz/orders/${id}`, { internalNote: internal ?? "" }), { success: "Note saved", onSuccess: () => setInternal(null) });
  const saveCharges = useAction((v: { discountPaise: number; deliveryPaise: number }) => api.patch(`/biz/orders/${id}`, v), { success: "Order total updated", onSuccess: () => setCharges(false) });

  if (q.isLoading) return <div><Skeleton className="mb-4 h-8 w-56" /><div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96 rounded-xl lg:col-span-2" /><Skeleton className="h-64 rounded-xl" /></div></div>;
  if (q.isError || !order) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;

  const biz = session!.business!;
  const transitions = ORDER_TRANSITIONS[order.status as OrderStatus];
  const forward = transitions.filter((s) => s !== "rejected" && s !== "cancelled");
  const canReject = transitions.includes("rejected");
  const canCancel = transitions.includes("cancelled");
  const isVoid = order.status === "rejected" || order.status === "cancelled";
  const due = order.totalPaise - order.amountPaidPaise;
  const destructive = confirming === "rejected" || confirming === "cancelled";
  const canEditCharges = !isVoid && order.status !== "delivered";

  const openCharges = () => {
    setDiscount(paiseToRupeesString(order.discountPaise || null));
    setDelivery(paiseToRupeesString(order.deliveryPaise || null));
    setCharges(true);
  };
  const submitCharges = () => {
    const d = discount.trim() ? rupeesToPaise(discount) : 0;
    const dl = delivery.trim() ? rupeesToPaise(delivery) : 0;
    if (d == null || dl == null) return void toast.error("Enter valid amounts");
    saveCharges.mutate({ discountPaise: d, deliveryPaise: dl });
  };
  const pdf = async () => {
    setPdfBusy(true);
    try {
      await downloadOrderPdf(order, biz);
    } catch (e) {
      toast.error("Could not create the PDF. " + errorMessage(e));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        back={<BackLink to="/dashboard/orders">Orders</BackLink>}
        title={`Order #${order.orderNumber}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {formatDateTime(order.createdAt)} <OrderStatusBadge status={order.status} /> {!isVoid && <PaymentStatusBadge status={order.paymentStatus} />}
            {order.source === "owner" && <Badge>Entered by you</Badge>}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={pdf} loading={pdfBusy}><FileDown className="h-4 w-4" aria-hidden /> PDF</Button>
            <WhatsAppLink variant="secondary" phone={order.retailerPhone} message={messages.orderDetails(order, biz.name)}>Share</WhatsAppLink>
          </>
        }
      />

      {lastChange && lastChange === order.status && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-emerald-900">Order is now <span className="font-semibold">{ORDER_STATUS_LABELS[order.status as OrderStatus].toLowerCase()}</span>. {order.retailerName} has been notified in the app — you can also tell them on WhatsApp.</p>
          <WhatsAppLink size="sm" phone={order.retailerPhone} message={messages.orderStatus(order, biz.name)} className="shrink-0">Send update on WhatsApp</WhatsAppLink>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={`Items (${order.items.length})`} />
            <OrderItemsTable items={order.items} showGst={order.taxPaise > 0} />
            <div className="border-t border-line">
              <OrderTotals order={order} />
            </div>
            {canEditCharges && (
              <div className="border-t border-line px-4 py-2.5 sm:px-5">
                <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline" onClick={openCharges}><Pencil className="h-3.5 w-3.5" aria-hidden /> {order.discountPaise || order.deliveryPaise ? "Edit discount / delivery charges" : "Add discount or delivery charges"}</button>
              </div>
            )}
          </Card>

          {order.retailerNote && (
            <Card>
              <CardHeader title="Note from retailer" />
              <p className="px-4 py-3 text-sm whitespace-pre-wrap text-slate-700 sm:px-5">{order.retailerNote}</p>
            </Card>
          )}

          <Card>
            <CardHeader title="Payments" description={isVoid ? "This order is void, so nothing is owed." : due > 0 ? `${formatINR(due)} still due` : "Fully paid"} action={!isVoid && due > 0 ? <Button size="sm" onClick={() => setPaying(true)}><Wallet className="h-3.5 w-3.5" aria-hidden /> Record payment</Button> : undefined} />
            {order.payments.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">No payments recorded against this order yet.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {order.payments.map((p: any, i: number) => (
                  <li key={p.id + i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                    <span className={p.status === "reversed" ? "text-slate-400" : "text-slate-700"}>
                      {formatDate(p.paymentDate)} · {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS]}{p.reference && ` · Ref ${p.reference}`}
                      {p.status === "reversed" && <Badge tone="danger" className="ml-2">Reversed</Badge>}
                    </span>
                    <span className={`font-medium tabular ${p.status === "reversed" ? "text-slate-400 line-through" : "text-emerald-700"}`}>{formatINR(p.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Internal notes" description="Only you can see this. It is never shown to the retailer." />
            <div className="p-4 sm:p-5">
              <Textarea aria-label="Internal notes" rows={3} maxLength={1000} value={internal ?? order.internalNote ?? ""} onChange={(e) => setInternal(e.target.value)} placeholder="e.g. Send with Thursday’s tempo. Collect cheque on delivery." />
              {internal != null && internal !== (order.internalNote ?? "") && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" loading={saveNote.isPending} onClick={() => saveNote.mutate()}>Save note</Button>
                  <Button size="sm" variant="ghost" onClick={() => setInternal(null)}>Discard</Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {transitions.length > 0 && (
            <Card className="hidden lg:block">
              <CardHeader title="Next step" />
              <div className="space-y-2 p-4">
                {forward.map((s, i) => <Button key={s} variant={i === 0 ? "primary" : "secondary"} className="w-full" onClick={() => setConfirming(s)}>{i === 0 && <Check className="h-4 w-4" aria-hidden />}{NEXT_LABEL[s]}</Button>)}
                {canReject && <Button variant="dangerOutline" className="w-full" onClick={() => setConfirming("rejected")}><X className="h-4 w-4" aria-hidden /> Reject order</Button>}
                {!canReject && canCancel && <Button variant="dangerOutline" className="w-full" onClick={() => setConfirming("cancelled")}>Cancel order</Button>}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Retailer" action={<Link to={`/dashboard/retailers/${order.retailerId}`} className="text-[13px] font-medium text-brand-700 hover:underline">View</Link>} />
            <div className="space-y-1 p-4 text-sm sm:px-5">
              <p className="font-medium text-slate-900">{order.retailerName}</p>
              <p className="text-slate-600">{order.retailerContact} · <a href={`tel:${order.retailerPhone}`} className="tabular hover:underline">{order.retailerPhone}</a></p>
              {(order.retailerAddress || order.retailerCity) && <p className="text-slate-500">{[order.retailerAddress, order.retailerCity, order.retailerState].filter(Boolean).join(", ")}</p>}
              {order.retailerGstin && <p className="text-xs text-slate-500">GSTIN {order.retailerGstin}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Status history" />
            <div className="p-4 sm:p-5"><OrderTimeline history={order.history} /></div>
          </Card>
        </div>
      </div>

      {/* sticky primary action on phones */}
      {transitions.length > 0 && (
        <div className="no-print fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-line bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
          {(canReject || canCancel) && <Button variant="dangerOutline" size="lg" onClick={() => setConfirming(canReject ? "rejected" : "cancelled")}>{canReject ? "Reject" : "Cancel"}</Button>}
          {forward[0] && <Button size="lg" className="flex-1" onClick={() => setConfirming(forward[0])}>{NEXT_LABEL[forward[0]]}</Button>}
        </div>
      )}

      <Modal
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        size="sm"
        title={confirming === "rejected" ? "Reject this order?" : confirming === "cancelled" ? "Cancel this order?" : confirming ? `${NEXT_LABEL[confirming]}?` : ""}
        description={destructive ? "This cannot be undone. Any reserved stock is returned and the retailer is notified." : `Order #${order.orderNumber} for ${order.retailerName}. The retailer will be notified.`}
      >
        <Field label={destructive ? "Reason (shown to the retailer)" : "Note for the retailer (optional)"}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={destructive ? "e.g. Item out of stock" : confirming === "dispatched" ? "e.g. Sent by transport, LR no. 1234" : ""} autoFocus />
        </Field>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirming(null)}>Go back</Button>
          <Button variant={destructive ? "danger" : "primary"} loading={move.isPending} onClick={() => confirming && move.mutate({ status: confirming, note })}>
            {confirming === "rejected" ? "Reject order" : confirming === "cancelled" ? "Cancel order" : confirming ? NEXT_LABEL[confirming] : ""}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={charges} onOpenChange={setCharges} title="Discount & delivery charges" description="Adjusts the order total. The retailer sees the updated total." size="sm">
        <div className="grid gap-4">
          <Field label="Discount (₹)"><Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" autoFocus /></Field>
          <Field label="Delivery charges (₹)"><Input inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="0" /></Field>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCharges(false)}>Cancel</Button>
          <Button loading={saveCharges.isPending} onClick={submitCharges}>Update total</Button>
        </ModalFooter>
      </Modal>

      <RecordPaymentDialog open={paying} onClose={() => setPaying(false)} retailer={{ id: order.retailerId, name: order.retailerName, phone: order.retailerPhone }} order={{ id: order.id, orderNumber: order.orderNumber }} />
    </div>
  );
}
