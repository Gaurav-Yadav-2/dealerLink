import { CheckCircle2, Plus, RotateCcw, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@shared/constants";
import { WhatsAppLink } from "@/components/shared";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, ModalFooter, PageHeader, Pagination, SearchInput, Select, Stat, Table, Td, Textarea, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR, paiseToRupeesString, rupeesToPaise, todayIST } from "@/lib/format";
import { useAction, useApi, useUrlFilters } from "@/lib/hooks";
import { messages } from "@/lib/whatsapp";

/**
 * Records a payment. With `order` it is locked to that order; otherwise the wholesaler can pick an order
 * or record it "on account", in which case the server applies it to the oldest unpaid orders first.
 */
export function RecordPaymentDialog({ open, onClose, retailer, order }: { open: boolean; onClose: () => void; retailer?: { id: string; name: string; phone?: string | null } | null; order?: { id: string; orderNumber: string } | null }) {
  const { session } = useAuth();
  const [retailerId, setRetailerId] = useState(retailer?.id ?? "");
  const [orderId, setOrderId] = useState(order?.id ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("upi");
  const [date, setDate] = useState(todayIST());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { amountPaise: number; remaining: number }>(null);

  useEffect(() => {
    if (open) {
      setRetailerId(retailer?.id ?? "");
      setOrderId(order?.id ?? "");
      setAmount("");
      setMethod("upi");
      setDate(todayIST());
      setReference("");
      setNotes("");
      setError(null);
      setDone(null);
    }
  }, [open, retailer?.id, order?.id]);

  const owing = useApi<any[]>(open && !retailer ? "/biz/reports/outstanding" : null);
  const ledger = useApi<any>(open && retailerId ? `/biz/retailers/${retailerId}/ledger` : null);
  const openOrders: any[] = ledger.data?.data.openOrders ?? [];
  const selected = openOrders.find((o) => o.id === orderId);
  const max = orderId ? selected?.outstandingPaise ?? 0 : ledger.data?.data.totals.outstandingPaise ?? 0;
  const who = retailer ?? (() => { const r = owing.data?.data.find((x) => x.retailerId === retailerId); return r ? { id: r.retailerId, name: r.retailerName, phone: r.phone } : null; })();

  const save = useAction((body: any) => api.post("/biz/payments", body), {
    silentError: true,
    onSuccess: (d: any) => setDone({ amountPaise: d.amountPaise, remaining: Math.max(0, (ledger.data?.data.totals.outstandingPaise ?? 0) - d.amountPaise) }),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amountPaise = rupeesToPaise(amount);
    if (!retailerId) return setError("Choose a retailer");
    if (!amountPaise) return setError("Enter the amount received");
    if (amountPaise > max) return setError(`The most you can record here is ${formatINR(max)} (the outstanding balance).`);
    save.mutate({ retailerId, orderId: orderId || null, amountPaise, method, paymentDate: date, reference, notes }, { onError: (err) => setError(err.message) });
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={done ? "Payment recorded" : "Record payment"} description={done ? undefined : who ? `From ${who.name}` : "Money received from a retailer"} size="md">
      {done ? (
        <div>
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
            <div className="text-sm text-emerald-900">
              <p className="font-semibold">{formatINR(done.amountPaise)} received from {who?.name}</p>
              <p className="mt-0.5">{done.remaining > 0 ? `Balance still outstanding: ${formatINR(done.remaining)}` : "This retailer’s account is now fully settled."}</p>
            </div>
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>Done</Button>
            <WhatsAppLink phone={who?.phone} message={messages.paymentReceived(done.amountPaise, done.remaining, session?.business?.name ?? "")}>Send receipt on WhatsApp</WhatsAppLink>
          </ModalFooter>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 sm:col-span-2">{error}</p>}
          {!retailer && (
            <Field label="Retailer" required className="sm:col-span-2" hint={owing.data && !owing.data.data.length ? "No retailer has an outstanding balance right now." : "Only retailers with an outstanding balance are listed"}>
              <Select value={retailerId} onChange={(e) => { setRetailerId(e.target.value); setOrderId(""); }}>
                <option value="">Select retailer</option>
                {owing.data?.data.map((r) => <option key={r.retailerId} value={r.retailerId}>{r.retailerName} — owes {formatINR(r.outstandingPaise)}</option>)}
              </Select>
            </Field>
          )}
          {retailerId && (
            <Field label="Apply to" className="sm:col-span-2" hint={orderId ? undefined : "On account: applied to the oldest unpaid orders first"}>
              <Select value={orderId} onChange={(e) => setOrderId(e.target.value)} disabled={!!order}>
                {!order && <option value="">On account (oldest orders first)</option>}
                {order && !selected && <option value={order.id}>Order #{order.orderNumber}</option>}
                {openOrders.map((o) => <option key={o.id} value={o.id}>Order #{o.orderNumber} — {formatINR(o.outstandingPaise)} due</option>)}
              </Select>
            </Field>
          )}
          <Field label="Amount received (₹)" required hint={retailerId && ledger.data ? <>Outstanding: <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setAmount(paiseToRupeesString(max))}>{formatINR(max)} — fill full amount</button></> : undefined}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus={!!retailer} />
          </Field>
          <Field label="Payment method" required>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</Select>
          </Field>
          <Field label="Payment date" required><Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reference" hint="UPI ref, cheque no., etc."><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
          <div className="sm:col-span-2">
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={save.isPending} disabled={!!retailerId && ledger.isSuccess && max === 0}>Record payment</Button>
            </ModalFooter>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Reversal keeps the original payment on record and writes an adjustment entry with the reason. */
export function ReversePaymentDialog({ payment, onClose }: { payment: any | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [payment?.id]);
  const reverse = useAction(() => api.post(`/biz/payments/${payment.id}/reverse`, { reason }), { success: "Payment reversed. The balance has been restored.", onSuccess: onClose });
  return (
    <Modal open={!!payment} onOpenChange={(o) => !o && onClose()} title="Reverse this payment?" description={payment ? `${formatINR(payment.amountPaise)} · ${formatDate(payment.paymentDate)}` : undefined} size="sm">
      <p className="text-sm text-slate-600">Use this to correct a mistake or a bounced cheque. The payment stays in your records marked as reversed, and the amount becomes outstanding again.</p>
      <Field label="Reason" required className="mt-4">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque bounced / entered twice" maxLength={300} autoFocus />
      </Field>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Keep payment</Button>
        <Button variant="danger" loading={reverse.isPending} disabled={reason.trim().length < 3} onClick={() => reverse.mutate()}>Reverse payment</Button>
      </ModalFooter>
    </Modal>
  );
}

export function PaymentRows({ rows, showRetailer, onReverse }: { rows: any[]; showRetailer?: boolean; onReverse?: (p: any) => void }) {
  return (
    <Table>
      <thead>
        <tr><Th>Date</Th>{showRetailer && <Th>Retailer</Th>}<Th>Method</Th><Th>Applied to</Th><Th className="text-right">Amount</Th><Th>Status</Th>{onReverse && <Th><span className="sr-only">Actions</span></Th>}</tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className={p.status === "reversed" ? "text-slate-400" : undefined}>
            <Td className="whitespace-nowrap">{formatDate(p.paymentDate)}</Td>
            {showRetailer && <Td><Link to={`/dashboard/retailers/${p.retailerId}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{p.retailerName}</Link></Td>}
            <Td>
              {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS]}
              {p.reference && <span className="block text-xs text-slate-500">Ref: {p.reference}</span>}
            </Td>
            <Td className="max-w-[14rem] text-[13px] text-slate-600"><span className="line-clamp-2">{p.orderNumbers ? p.orderNumbers.split(", ").map((n: string) => `#${n}`).join(", ") : "—"}</span></Td>
            <Td className={`text-right font-medium tabular ${p.status === "reversed" ? "line-through" : "text-slate-900"}`}>{formatINR(p.amountPaise)}</Td>
            <Td>
              {p.status === "reversed" ? <Badge tone="danger">Reversed</Badge> : <Badge tone="success">Received</Badge>}
              {p.reversalReason && <span className="mt-0.5 block max-w-[12rem] truncate text-xs text-slate-500" title={p.reversalReason}>{p.reversalReason}</span>}
            </Td>
            {onReverse && (
              <Td className="text-right">
                {p.status === "recorded" && <Button variant="ghost" size="sm" onClick={() => onReverse(p)}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reverse</Button>}
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default function Payments() {
  const { values: f, page, set } = useUrlFilters({ q: "", method: "", status: "" });
  const q = useApi<any[]>("/biz/payments", { ...f, page });
  const [recording, setRecording] = useState(false);
  const [reversing, setReversing] = useState<any | null>(null);
  const summary = q.data?.meta?.summary;
  const rows = q.data?.data ?? [];
  return (
    <div>
      <PageHeader title="Payments" description="Money received from retailers. Payments are recorded manually — DealerLink does not collect money." actions={<Button onClick={() => setRecording(true)}><Plus className="h-4 w-4" aria-hidden /> Record payment</Button>} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Outstanding now" value={summary ? formatINR(summary.outstandingPaise) : "—"} tone={summary?.outstandingPaise > 0 ? "danger" : "success"} icon={<Wallet />} hint={<Link to="/dashboard/reports?tab=outstanding" className="font-medium text-brand-700 hover:underline">See who owes →</Link>} />
        <Stat label="Received this month" value={summary ? formatINR(summary.receivedThisMonthPaise) : "—"} tone="success" icon={<CheckCircle2 />} />
        <Stat label="Total received" value={summary ? formatINR(summary.totalReceivedPaise) : "—"} icon={<Wallet />} />
      </div>
      <Card>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto_auto] sm:p-4">
          <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Search retailer or reference" />
          <Select aria-label="Method" value={f.method} onChange={(e) => set({ method: e.target.value })}>
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
          </Select>
          <Select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All payments</option>
            <option value="recorded">Received</option>
            <option value="reversed">Reversed</option>
          </Select>
        </div>
        {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
          <EmptyState icon={<Wallet />} title={f.q || f.method || f.status ? "No payments match" : "No payments recorded yet"} description="When a retailer pays you by cash, UPI, cheque or bank transfer, record it here to keep balances accurate." action={<Button onClick={() => setRecording(true)}>Record payment</Button>} />
        ) : (
          <PaymentRows rows={rows} showRetailer onReverse={setReversing} />
        )}
        <Pagination meta={q.data?.meta} onPage={(p) => set({ page: p } as any)} />
      </Card>
      <RecordPaymentDialog open={recording} onClose={() => setRecording(false)} />
      <ReversePaymentDialog payment={reversing} onClose={() => setReversing(null)} />
    </div>
  );
}
