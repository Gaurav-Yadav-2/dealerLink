import { ClipboardList, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ORDER_STATUS_LABELS, ORDER_STATUSES, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES } from "@shared/constants";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/shared";
import { Badge, Button, buttonClass, Card, EmptyState, ErrorState, Input, ListSkeleton, PageHeader, Pagination, SearchInput, Select, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatINR, timeAgo } from "@/lib/format";
import { useApi, useUrlFilters } from "@/lib/hooks";
import { useFeature } from "@/lib/auth";

export default function Orders() {
  const navigate = useNavigate();
  const manualOn = useFeature("manualOrders");
  const { values: f, page, set } = useUrlFilters({ q: "", status: "", paymentStatus: "", from: "", to: "" });
  const q = useApi<any[]>("/biz/orders", { ...f, page }, { refetchInterval: 60_000 });
  const rows = q.data?.data ?? [];
  const filtered = Object.values(f).some(Boolean);
  const isVoid = (s: string) => s === "rejected" || s === "cancelled";

  return (
    <div>
      <PageHeader title="Orders" description="Incoming orders from your retailers. New orders wait as Pending until you accept or reject them." actions={manualOn ? <Link to="/dashboard/orders/new" className={buttonClass("primary", "md")}><Plus className="h-4 w-4" aria-hidden /> Create order</Link> : undefined} />
      <Card>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[1fr_auto_auto_auto_auto]">
          <SearchInput className="sm:col-span-2 lg:col-span-1" value={f.q} onChange={(v) => set({ q: v })} placeholder="Search order number or retailer" />
          <Select aria-label="Order status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
          </Select>
          <Select aria-label="Payment status" value={f.paymentStatus} onChange={(e) => set({ paymentStatus: e.target.value })}>
            <option value="">Any payment</option>
            {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>)}
          </Select>
          <Input type="date" aria-label="From date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          <Input type="date" aria-label="To date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} />
        </div>
        {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={<ClipboardList />} title="No orders match these filters" action={<Button variant="secondary" size="sm" onClick={() => set({ q: "", status: "", paymentStatus: "", from: "", to: "" })}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<ClipboardList />} title="No orders yet" description={manualOn ? "Orders placed by your retailers appear here. You can also enter an order yourself for a retailer who phones it in." : "Orders placed by your retailers appear here."} action={manualOn ? <Link to="/dashboard/orders/new" className={buttonClass("primary", "md")}>Create order</Link> : undefined} />
          )
        ) : (
          <>
            {/* phones: tappable cards instead of a wide table */}
            <ul className="divide-y divide-line/70 md:hidden">
              {rows.map((o) => (
                <li key={o.id}>
                  <Link to={`/dashboard/orders/${o.id}`} className="block px-4 py-3 active:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{o.retailerName}</p>
                        <p className="text-xs text-slate-500">#{o.orderNumber} · {o.itemCount} items · {timeAgo(o.createdAt)}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular">{formatINR(o.totalPaise)}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <OrderStatusBadge status={o.status} />
                      {!isVoid(o.status) && <PaymentStatusBadge status={o.paymentStatus} />}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <thead><tr><Th>Order</Th><Th>Retailer</Th><Th>Placed</Th><Th>Status</Th><Th>Payment</Th><Th className="text-right">Total</Th></tr></thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => navigate(`/dashboard/orders/${o.id}`)}>
                      <Td>
                        <Link to={`/dashboard/orders/${o.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>#{o.orderNumber}</Link>
                        <span className="block text-xs text-slate-500">{o.itemCount} items{o.source === "owner" && <> · <Badge className="ml-0.5">Entered by you</Badge></>}</span>
                      </Td>
                      <Td className="max-w-[16rem] truncate font-medium text-slate-900">{o.retailerName}</Td>
                      <Td className="whitespace-nowrap text-slate-600">{formatDateTime(o.createdAt)}</Td>
                      <Td><OrderStatusBadge status={o.status} /></Td>
                      <Td>{isVoid(o.status) ? <span className="text-slate-400">—</span> : <PaymentStatusBadge status={o.paymentStatus} />}</Td>
                      <Td className="text-right font-semibold tabular">{formatINR(o.totalPaise)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
        <Pagination meta={q.data?.meta} onPage={(p) => set({ page: p } as any)} />
      </Card>
    </div>
  );
}
