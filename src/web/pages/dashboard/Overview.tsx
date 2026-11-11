import { CheckCircle2, Circle, ClipboardList, Clock, IndianRupee, Package, Plus, ShoppingBag, UserPlus, Users, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, type OrderStatus } from "@shared/constants";
import { BarList, BarSeries, LineSeries } from "@/components/charts";
import { OrderStatusBadge } from "@/components/shared";
import { buttonClass, Card, CardHeader, cn, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { compactINR, formatDayShort, formatINR, formatMonth, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";

const STATUS_ORDER: OrderStatus[] = ["pending", "accepted", "processing", "ready_for_dispatch", "dispatched", "delivered", "rejected", "cancelled"];

export default function Overview() {
  const { session } = useAuth();
  const q = useApi<any>("/biz/dashboard");

  if (q.isLoading) {
    return (
      <div>
        <PageHeader title="Overview" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2"><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
      </div>
    );
  }
  if (q.isError || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;

  const d = q.data.data;
  const k = d.kpis;
  const isNew = k.totalProducts === 0 || k.totalRetailers === 0;
  const hasOrders = d.statusDistribution.length > 0;
  const statusRows = STATUS_ORDER.map((s) => ({ s, count: d.statusDistribution.find((x: any) => x.status === s)?.count ?? 0 })).filter((r) => r.count > 0);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${session?.user.name.split(" ")[0]}`}
        description="Here’s what’s happening in your wholesale business today."
        actions={
          <>
            <Link to="/dashboard/orders/new" className={buttonClass("secondary", "md")}><Plus className="h-4 w-4" aria-hidden /> Create order</Link>
            <Link to="/dashboard/products?new=1" className={buttonClass("primary", "md")}><Plus className="h-4 w-4" aria-hidden /> Add product</Link>
          </>
        }
      />

      {isNew && (
        <Card className="mb-4 border-brand-200 bg-brand-50/60 p-5">
          <h2 className="text-[15px] font-semibold">Get your store ready</h2>
          <p className="mt-0.5 text-sm text-slate-600">Three steps and your retailers can start ordering.</p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { done: k.totalProducts > 0, title: "Add your products", text: "One by one or by CSV upload.", to: "/dashboard/products?new=1", cta: "Add product" },
              { done: k.totalRetailers > 0, title: "Add your retailers", text: "Then send each an invitation link.", to: "/dashboard/retailers?new=1", cta: "Add retailer" },
              { done: hasOrders, title: "Receive your first order", text: "Orders appear here automatically.", to: "/dashboard/orders", cta: "View orders" },
            ].map((s) => (
              <li key={s.title} className="rounded-lg border border-line bg-white p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Done" /> : <Circle className="h-4 w-4 text-slate-300" aria-label="To do" />}
                  {s.title}
                </p>
                <p className="mt-1 text-[13px] text-slate-500">{s.text}</p>
                {!s.done && <Link to={s.to} className="mt-2 inline-block text-[13px] font-medium text-brand-700 hover:underline">{s.cta} →</Link>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Orders today" value={k.ordersToday} icon={<ShoppingBag />} />
        <Stat label="Pending orders" value={k.pendingOrders} icon={<Clock />} tone={k.pendingOrders > 0 ? "warning" : "brand"} hint={k.pendingOrders > 0 ? <Link to="/dashboard/orders?status=pending" className="font-medium text-brand-700 hover:underline">Review now →</Link> : "Nothing waiting"} />
        <Stat label="Sales this month" value={formatINR(k.monthlySalesPaise)} icon={<IndianRupee />} tone="success" />
        <Stat label="Outstanding" value={formatINR(k.outstandingPaise)} icon={<Wallet />} tone={k.outstandingPaise > 0 ? "danger" : "success"} hint={k.outstandingPaise > 0 ? <Link to="/dashboard/reports?tab=outstanding" className="font-medium text-brand-700 hover:underline">Who owes →</Link> : "All settled"} />
        <Stat label="Active retailers" value={k.totalRetailers} icon={<Users />} />
        <Stat label="Products" value={k.totalProducts} icon={<Package />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Orders received" description="Number of orders per day, last 14 days" />
          <div className="p-4">
            {hasOrders ? (
              <BarSeries name="Orders" data={d.ordersOverTime.map((r: any) => ({ label: formatDayShort(r.day), value: r.orders }))} />
            ) : (
              <EmptyState compact icon={<ClipboardList />} title="No orders yet" description="When retailers place orders, daily volumes will be charted here." />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Monthly sales" description="Order value per month, excluding cancelled and rejected orders" />
          <div className="p-4">
            {d.monthlySales.length ? (
              <LineSeries name="Sales" data={d.monthlySales.map((r: any) => ({ label: formatMonth(r.month), value: r.salesPaise }))} format={formatINR} tickFormat={compactINR} />
            ) : (
              <EmptyState compact icon={<IndianRupee />} title="No sales yet" description="Your month-by-month sales trend will appear here." />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Top-selling products" description="By sales value, last 30 days" action={<Link to="/dashboard/reports?tab=products" className="text-[13px] font-medium text-brand-700 hover:underline">Full report</Link>} />
          <div className="p-4 sm:p-5">
            {d.topProducts.length ? (
              <BarList rows={d.topProducts.map((p: any) => ({ key: p.productId, label: p.productName, value: p.salesPaise, sub: `${p.quantity} sold` }))} format={formatINR} />
            ) : (
              <EmptyState compact icon={<Package />} title="No sales in the last 30 days" />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Orders by status" description="All orders to date" />
          <div className="p-4 sm:p-5">
            {statusRows.length ? (
              <BarList rows={statusRows.map((r) => ({ key: r.s, label: ORDER_STATUS_LABELS[r.s], value: r.count }))} />
            ) : (
              <EmptyState compact icon={<ClipboardList />} title="No orders yet" />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Awaiting your approval" action={<Link to="/dashboard/orders?status=pending" className="text-[13px] font-medium text-brand-700 hover:underline">View all</Link>} />
          {d.awaitingApproval.length ? (
            <ul className="divide-y divide-line/70">
              {d.awaitingApproval.map((o: any) => (
                <li key={o.id}>
                  <Link to={`/dashboard/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{o.retailerName}</span>
                      <span className="text-xs text-slate-500">#{o.orderNumber} · {timeAgo(o.createdAt)}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular">{formatINR(o.totalPaise)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<CheckCircle2 />} title="Nothing waiting" description="New orders that need accepting will be listed here." />
          )}
        </Card>
        <Card>
          <CardHeader title="Latest orders" action={<Link to="/dashboard/orders" className="text-[13px] font-medium text-brand-700 hover:underline">View all</Link>} />
          {d.latestOrders.length ? (
            <ul className="divide-y divide-line/70">
              {d.latestOrders.map((o: any) => (
                <li key={o.id}>
                  <Link to={`/dashboard/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{o.retailerName}</span>
                      <span className="text-xs text-slate-500">#{o.orderNumber} · {formatINR(o.totalPaise)}</span>
                    </span>
                    <OrderStatusBadge status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<ClipboardList />} title="No orders yet" />
          )}
        </Card>
        <Card>
          <CardHeader title="Recent payments" action={<Link to="/dashboard/payments" className="text-[13px] font-medium text-brand-700 hover:underline">View all</Link>} />
          {d.recentPayments.length ? (
            <ul className="divide-y divide-line/70">
              {d.recentPayments.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0">
                    <Link to={`/dashboard/retailers/${p.retailerId}`} className="block truncate text-sm font-medium text-slate-900 hover:underline">{p.retailerName}</Link>
                    <span className="text-xs text-slate-500">{PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS]} · {timeAgo(p.createdAt)}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-emerald-700 tabular">+ {formatINR(p.amountPaise)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<Wallet />} title="No payments recorded" description="Record a payment from any order or retailer page." />
          )}
        </Card>
        <Card>
          <CardHeader title="New retailer registrations" action={<Link to="/dashboard/retailers" className="text-[13px] font-medium text-brand-700 hover:underline">View all</Link>} />
          {d.newRetailers.length ? (
            <ul className="divide-y divide-line/70">
              {d.newRetailers.map((r: any) => (
                <li key={r.id}>
                  <Link to={`/dashboard/retailers/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{r.businessName}</span>
                      <span className="text-xs text-slate-500">{r.city || "—"}</span>
                    </span>
                    <span className={cn("shrink-0 text-xs text-slate-500")}>{timeAgo(r.registeredAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<UserPlus />} title="No registrations yet" description="Retailers appear here once they accept your invitation." action={<Link to="/dashboard/retailers?new=1" className={buttonClass("secondary", "sm")}>Add retailer</Link>} />
          )}
        </Card>
      </div>
    </div>
  );
}
