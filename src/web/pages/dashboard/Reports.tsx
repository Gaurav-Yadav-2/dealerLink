import { BarChart3, Download } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@shared/constants";
import { BarList, BarSeries } from "@/components/charts";
import { WhatsAppLink } from "@/components/shared";
import { Button, Card, CardHeader, EmptyState, ErrorState, Input, ListSkeleton, PageHeader, Select, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { useAuth, useFeature } from "@/lib/auth";
import { FeatureOff } from "@/components/FeatureOff";
import { downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import { compactINR, daysAgoIST, formatDate, formatDayShort, formatINR, formatMonth, paiseToRupeesString, todayIST } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { messages } from "@/lib/whatsapp";

type Tab = "orders" | "retailers" | "products" | "outstanding" | "cancelled";
const TABS: { value: Tab; label: string }[] = [
  { value: "orders", label: "Orders over time" }, { value: "retailers", label: "Sales by retailer" }, { value: "products", label: "Sales by product" },
  { value: "outstanding", label: "Outstanding payments" }, { value: "cancelled", label: "Cancelled orders" },
];
const PRESETS: [string, () => { from: string; to: string }][] = [
  ["Today", () => ({ from: todayIST(), to: todayIST() })],
  ["Last 7 days", () => ({ from: daysAgoIST(6), to: todayIST() })],
  ["Last 30 days", () => ({ from: daysAgoIST(29), to: todayIST() })],
  ["This month", () => ({ from: todayIST().slice(0, 8) + "01", to: todayIST() })],
  ["Last 90 days", () => ({ from: daysAgoIST(89), to: todayIST() })],
];
const rupees = (p: number) => paiseToRupeesString(p);

export default function Reports() {
  return useFeature("reports") ? <ReportsPage /> : <FeatureOff title="Reports" />;
}

function ReportsPage() {
  const { session } = useAuth();
  const csvOn = useFeature("csv");
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "orders";
  const from = sp.get("from") || daysAgoIST(29);
  const to = sp.get("to") || todayIST();
  const group = sp.get("group") || "day";
  const patch = (p: Record<string, string>) => setSp((prev) => { const n = new URLSearchParams(prev); for (const [k, v] of Object.entries(p)) n.set(k, v); return n; }, { replace: true });

  const range = { from, to };
  const summary = useApi<any>("/biz/reports/summary", range);
  const paths: Record<Tab, string> = { orders: "/biz/reports/orders", retailers: "/biz/reports/sales-by-retailer", products: "/biz/reports/sales-by-product", outstanding: "/biz/reports/outstanding", cancelled: "/biz/reports/cancelled" };
  const report = useApi<any[]>(paths[tab], tab === "outstanding" ? undefined : tab === "orders" ? { ...range, group } : range);
  const rows = report.data?.data ?? [];
  const periodLabel = (p: string) => (group === "month" ? formatMonth(p) : group === "week" ? `Week of ${formatDayShort(p)}` : formatDayShort(p));

  const exportCsv = () => {
    const cols: Record<Tab, CsvColumn<any>[]> = {
      orders: [{ header: "Period", value: (r) => r.period }, { header: "Orders", value: (r) => r.orders }, { header: "Sales (INR)", value: (r) => rupees(r.salesPaise) }, { header: "Delivered", value: (r) => r.deliveredOrders }, { header: "Cancelled / rejected", value: (r) => r.cancelledOrders }],
      retailers: [{ header: "Retailer", value: (r) => r.retailerName }, { header: "City", value: (r) => r.city }, { header: "Orders", value: (r) => r.orders }, { header: "Sales (INR)", value: (r) => rupees(r.salesPaise) }, { header: "Paid (INR)", value: (r) => rupees(r.paidPaise) }, { header: "Outstanding (INR)", value: (r) => rupees(r.outstandingPaise) }],
      products: [{ header: "Product", value: (r) => r.productName }, { header: "SKU", value: (r) => r.sku }, { header: "Quantity sold", value: (r) => r.quantity }, { header: "Unit", value: (r) => r.unit }, { header: "Orders", value: (r) => r.orders }, { header: "Sales (INR)", value: (r) => rupees(r.salesPaise) }],
      outstanding: [{ header: "Retailer", value: (r) => r.retailerName }, { header: "Contact", value: (r) => r.contactPerson }, { header: "Phone", value: (r) => r.phone }, { header: "City", value: (r) => r.city }, { header: "Unpaid orders", value: (r) => r.openOrders }, { header: "Outstanding (INR)", value: (r) => rupees(r.outstandingPaise) }, { header: "Oldest unpaid order", value: (r) => r.oldestUnpaidDate }],
      cancelled: [{ header: "Order", value: (r) => r.orderNumber }, { header: "Date", value: (r) => r.orderDate }, { header: "Retailer", value: (r) => r.retailerName }, { header: "Status", value: (r) => ORDER_STATUS_LABELS[r.status as OrderStatus] }, { header: "By", value: (r) => (r.cancelledBy === "owner" ? "Wholesaler" : "Retailer") }, { header: "Reason", value: (r) => r.reason }, { header: "Value (INR)", value: (r) => rupees(r.totalPaise) }],
    };
    downloadCsv(`dealerlink-${tab}-${tab === "outstanding" ? todayIST() : `${from}_to_${to}`}.csv`, toCsv(rows, cols[tab]));
  };

  const s = summary.data?.data;
  return (
    <div>
      <PageHeader title="Reports" description="Every figure is calculated from your actual orders and payments. Dates use India time." actions={csvOn ? <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" aria-hidden /> Export CSV</Button> : undefined} />

      <Card className="mb-4 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick date ranges">
            {PRESETS.map(([label, fn]) => {
              const r = fn();
              const active = r.from === from && r.to === to;
              return <button key={label} type="button" aria-pressed={active} onClick={() => patch(r)} className={`h-8 rounded-full border px-3 text-[13px] font-medium ${active ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-slate-600 hover:bg-slate-50"}`}>{label}</button>;
            })}
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" value={from} max={to} onChange={(e) => e.target.value && patch({ from: e.target.value })} className="h-9" />
            <span className="text-slate-400">to</span>
            <Input type="date" aria-label="To date" value={to} min={from} max={todayIST()} onChange={(e) => e.target.value && patch({ to: e.target.value })} className="h-9" />
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales" value={s ? formatINR(s.salesPaise) : "—"} hint={s ? `${s.validOrders ?? 0} orders` : undefined} tone="success" />
        <Stat label="Collected on these orders" value={s ? formatINR(s.collectedPaise) : "—"} hint={s && s.salesPaise > 0 ? `${Math.round((s.collectedPaise / s.salesPaise) * 100)}% of sales` : undefined} />
        <Stat label="Retailers who ordered" value={s ? s.activeRetailers : "—"} />
        <Stat label="Cancelled / rejected" value={s ? s.cancelledOrders ?? 0 : "—"} hint={s && s.orders > 0 ? `of ${s.orders} orders placed` : undefined} tone={s?.cancelledOrders ? "warning" : "brand"} />
      </div>

      <Tabs className="mb-4" value={tab} onChange={(t) => patch({ tab: t })} options={TABS} />

      <Card>
        {report.isLoading ? <ListSkeleton /> : report.isError ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : (
          <>
            {tab === "orders" && (
              <>
                <CardHeader title="Orders over time" description={`${formatDate(from)} – ${formatDate(to)}`} action={
                  <Select aria-label="Group by" value={group} onChange={(e) => patch({ group: e.target.value })} className="h-8 w-auto">
                    <option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option>
                  </Select>
                } />
                {rows.length === 0 ? <EmptyState icon={<BarChart3 />} title="No orders in this period" description="Try a longer date range." /> : (
                  <>
                    <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-2">
                      <div><h3 className="mb-2 text-[13px] font-medium text-slate-600">Number of orders</h3><BarSeries name="Orders" data={rows.map((r) => ({ label: periodLabel(r.period), value: r.orders }))} height={200} /></div>
                      <div><h3 className="mb-2 text-[13px] font-medium text-slate-600">Sales value</h3><BarSeries name="Sales" data={rows.map((r) => ({ label: periodLabel(r.period), value: r.salesPaise }))} format={formatINR} tickFormat={compactINR} height={200} /></div>
                    </div>
                    <Table>
                      <thead><tr><Th>Period</Th><Th className="text-right">Orders</Th><Th className="text-right">Delivered</Th><Th className="text-right">Cancelled</Th><Th className="text-right">Sales</Th></tr></thead>
                      <tbody>{rows.map((r) => <tr key={r.period}><Td className="font-medium text-slate-900">{periodLabel(r.period)}</Td><Td className="text-right tabular">{r.orders}</Td><Td className="text-right tabular">{r.deliveredOrders}</Td><Td className="text-right tabular">{r.cancelledOrders}</Td><Td className="text-right font-medium tabular">{formatINR(r.salesPaise)}</Td></tr>)}</tbody>
                    </Table>
                  </>
                )}
              </>
            )}

            {tab === "retailers" && (
              <>
                <CardHeader title="Sales by retailer" description="Top retailers first" />
                {rows.length === 0 ? <EmptyState icon={<BarChart3 />} title="No sales in this period" /> : (
                  <>
                    <div className="border-b border-line p-4 sm:p-5"><h3 className="mb-3 text-[13px] font-medium text-slate-600">Top retailers by sales</h3><BarList rows={rows.slice(0, 5).map((r) => ({ key: r.retailerId, label: r.retailerName, value: r.salesPaise, sub: `${r.orders} orders` }))} format={formatINR} /></div>
                    <Table>
                      <thead><tr><Th>Retailer</Th><Th className="text-right">Orders</Th><Th className="text-right">Sales</Th><Th className="text-right">Paid</Th><Th className="text-right">Outstanding</Th></tr></thead>
                      <tbody>{rows.map((r) => (
                        <tr key={r.retailerId}>
                          <Td><Link to={`/dashboard/retailers/${r.retailerId}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{r.retailerName}</Link><span className="block text-xs text-slate-500">{r.city || "—"}</span></Td>
                          <Td className="text-right tabular">{r.orders}</Td><Td className="text-right font-medium tabular">{formatINR(r.salesPaise)}</Td><Td className="text-right text-slate-600 tabular">{formatINR(r.paidPaise)}</Td>
                          <Td className={`text-right tabular ${r.outstandingPaise > 0 ? "font-medium text-red-700" : "text-slate-500"}`}>{formatINR(r.outstandingPaise)}</Td>
                        </tr>
                      ))}</tbody>
                    </Table>
                  </>
                )}
              </>
            )}

            {tab === "products" && (
              <>
                <CardHeader title="Sales by product" description="Top-selling products first (before GST, discounts and delivery)" />
                {rows.length === 0 ? <EmptyState icon={<BarChart3 />} title="No sales in this period" /> : (
                  <>
                    <div className="border-b border-line p-4 sm:p-5"><h3 className="mb-3 text-[13px] font-medium text-slate-600">Top-selling products</h3><BarList rows={rows.slice(0, 5).map((r) => ({ key: r.productId, label: r.productName, value: r.salesPaise, sub: `${r.quantity} ${r.unit}` }))} format={formatINR} /></div>
                    <Table>
                      <thead><tr><Th>Product</Th><Th className="text-right">Quantity sold</Th><Th className="text-right">Orders</Th><Th className="text-right">Sales</Th></tr></thead>
                      <tbody>{rows.map((r) => (
                        <tr key={r.productId}><Td><span className="font-medium text-slate-900">{r.productName}</span><span className="block text-xs text-slate-500">{r.sku}</span></Td><Td className="text-right tabular">{r.quantity} {r.unit}</Td><Td className="text-right tabular">{r.orders}</Td><Td className="text-right font-medium tabular">{formatINR(r.salesPaise)}</Td></tr>
                      ))}</tbody>
                    </Table>
                  </>
                )}
              </>
            )}

            {tab === "outstanding" && (
              <>
                <CardHeader title="Outstanding payments" description={`Who owes you money as of today — ${formatINR(rows.reduce((t, r) => t + r.outstandingPaise, 0))} in total. Not affected by the date range.`} />
                {rows.length === 0 ? <EmptyState icon={<BarChart3 />} title="Nothing outstanding" description="Every order is fully paid." /> : (
                  <Table>
                    <thead><tr><Th>Retailer</Th><Th className="text-right">Unpaid orders</Th><Th>Oldest unpaid</Th><Th className="text-right">Outstanding</Th><Th><span className="sr-only">Remind</span></Th></tr></thead>
                    <tbody>{rows.map((r) => (
                      <tr key={r.retailerId}>
                        <Td><Link to={`/dashboard/retailers/${r.retailerId}?tab=payments`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{r.retailerName}</Link><span className="block text-xs text-slate-500">{r.contactPerson} · {r.phone}</span></Td>
                        <Td className="text-right tabular">{r.openOrders}</Td><Td className="text-slate-600">{formatDate(r.oldestUnpaidDate)}</Td>
                        <Td className="text-right font-semibold text-red-700 tabular">{formatINR(r.outstandingPaise)}</Td>
                        <Td className="text-right"><WhatsAppLink size="sm" variant="secondary" phone={r.phone} message={messages.paymentReminder(r.outstandingPaise, session?.business?.name ?? "")}>Remind</WhatsAppLink></Td>
                      </tr>
                    ))}</tbody>
                  </Table>
                )}
              </>
            )}

            {tab === "cancelled" && (
              <>
                <CardHeader title="Cancelled & rejected orders" description={`${formatDate(from)} – ${formatDate(to)}`} />
                {rows.length === 0 ? <EmptyState icon={<BarChart3 />} title="No cancelled orders in this period" /> : (
                  <Table>
                    <thead><tr><Th>Order</Th><Th>Date</Th><Th>Retailer</Th><Th>Outcome</Th><Th>Reason</Th><Th className="text-right">Value</Th></tr></thead>
                    <tbody>{rows.map((r) => (
                      <tr key={r.id}>
                        <Td><Link to={`/dashboard/orders/${r.id}`} className="font-medium text-brand-700 hover:underline">#{r.orderNumber}</Link></Td><Td className="text-slate-600">{formatDate(r.orderDate)}</Td><Td>{r.retailerName}</Td>
                        <Td>{ORDER_STATUS_LABELS[r.status as OrderStatus]} <span className="text-xs text-slate-500">by {r.cancelledBy === "owner" ? "you" : "retailer"}</span></Td>
                        <Td className="max-w-[16rem] truncate text-slate-600" >{r.reason || "—"}</Td><Td className="text-right tabular">{formatINR(r.totalPaise)}</Td>
                      </tr>
                    ))}</tbody>
                  </Table>
                )}
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
