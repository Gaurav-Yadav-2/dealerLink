import { Minus, Plus, ShoppingCart, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { gstAmount } from "@shared/money";
import { BackLink } from "@/components/shared";
import { Button, buttonClass, Card, CardHeader, EmptyState, ErrorState, Field, Input, ListSkeleton, PageHeader, Pagination, SearchInput, Select, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth, useFeature } from "@/lib/auth";
import { FeatureOff } from "@/components/FeatureOff";
import { formatINR, rupeesToPaise } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";

type Line = { product: any; quantity: number };

/**
 * Wholesaler enters an order for a retailer (phone / walk-in orders).
 * The totals shown here are a preview; the server re-prices every line with the retailer's price list when the order is saved.
 */
export default function NewOrder() {
  return useFeature("manualOrders") ? <NewOrderPage /> : <FeatureOff title="Creating orders for retailers" back="/dashboard/orders" />;
}

function NewOrderPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const gstOn = !!session?.business?.gstEnabled;
  const [sp, setSp] = useSearchParams();
  const retailerId = sp.get("retailerId") ?? "";
  const retailers = useApi<any[]>("/biz/retailers", { status: "active", pageSize: 100 });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const products = useApi<any[]>(retailerId ? `/biz/retailers/${retailerId}/prices` : null, { q, page, pageSize: 20, activeOnly: 1 });
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("");
  const [delivery, setDelivery] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});

  const setQty = (product: any, quantity: number) =>
    setLines((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[product.id];
      else next[product.id] = { product, quantity };
      return next;
    });

  const list = Object.values(lines);
  const totals = useMemo(() => {
    const subtotal = list.reduce((s, l) => s + l.product.effectivePricePaise * l.quantity, 0);
    const tax = gstOn ? list.reduce((s, l) => s + gstAmount(l.product.effectivePricePaise * l.quantity, l.product.gstRateBp), 0) : 0;
    const d = discount.trim() ? rupeesToPaise(discount) : 0;
    const dl = delivery.trim() ? rupeesToPaise(delivery) : 0;
    return { subtotal, tax, discount: d, delivery: dl, total: subtotal + tax - (d ?? 0) + (dl ?? 0), valid: d != null && dl != null };
  }, [list, discount, delivery, gstOn]);

  const create = useAction(
    () => api.post("/biz/orders", { retailerId, items: list.map((l) => ({ productId: l.product.id, quantity: l.quantity })), note, discountPaise: totals.discount ?? 0, deliveryPaise: totals.delivery ?? 0 }),
    {
      success: (d: any) => `Order #${d.orderNumber} created`,
      silentError: true,
      onSuccess: (d: any) => navigate(`/dashboard/orders/${d.id}`),
    },
  );
  const submit = () => {
    setIssues({});
    create.mutate(undefined, {
      onError: (e) => {
        if (e instanceof ApiError && Array.isArray(e.details)) setIssues(Object.fromEntries((e.details as any[]).filter((d) => d.productId).map((d) => [d.productId, d.message])));
        toast.error(e.message);
      },
    });
  };

  const changeRetailer = (id: string) => {
    setLines({});
    setIssues({});
    setPage(1);
    setSp(id ? { retailerId: id } : {}, { replace: true });
  };

  return (
    <div>
      <PageHeader back={<BackLink to="/dashboard/orders">Orders</BackLink>} title="Create order" description="Enter an order on behalf of a retailer. Their own price list is applied automatically." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <Field label="Retailer" required>
              <Select value={retailerId} onChange={(e) => changeRetailer(e.target.value)}>
                <option value="">Select a retailer</option>
                {retailers.data?.data.map((r) => <option key={r.id} value={r.id}>{r.businessName}{r.city ? ` — ${r.city}` : ""}</option>)}
              </Select>
            </Field>
            {retailers.data && retailers.data.data.length === 0 && (
              <p className="mt-2 text-[13px] text-slate-500">You have no active retailers yet. <Link to="/dashboard/retailers?new=1" className="font-medium text-brand-700 hover:underline">Add a retailer</Link> first.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Products" description={retailerId ? "Prices shown are this retailer’s prices" : undefined} />
            {!retailerId ? (
              <EmptyState icon={<Users />} title="Choose a retailer first" description="Each retailer can have different prices, so pick who the order is for." />
            ) : (
              <>
                <div className="border-b border-line p-3 sm:p-4"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search product or SKU" /></div>
                {products.isLoading ? <ListSkeleton /> : products.isError ? <ErrorState error={products.error} onRetry={() => products.refetch()} /> : !products.data?.data.length ? (
                  <EmptyState compact title={q ? "No products match" : "No active products"} description={q ? undefined : "Add products to your catalogue first."} />
                ) : (
                  <ul className="divide-y divide-line/70">
                    {products.data.data.map((p) => {
                      const qty = lines[p.id]?.quantity ?? 0;
                      return (
                        <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                            <p className="text-xs text-slate-500">
                              {p.sku} · <span className="font-medium text-slate-700 tabular">{formatINR(p.effectivePricePaise)}</span>/{p.unit}
                              {p.overridePricePaise != null && <span className="text-emerald-700"> (special)</span>} · min {p.minOrderQty}
                              {p.stockQty != null && !!session?.business?.trackInventory && ` · ${p.stockQty} in stock`}
                            </p>
                          </div>
                          {qty === 0 ? (
                            <Button variant="secondary" size="sm" onClick={() => setQty(p, p.minOrderQty)}><Plus className="h-3.5 w-3.5" aria-hidden /> Add</Button>
                          ) : (
                            <QtyStepper value={qty} onChange={(v) => setQty(p, v)} label={p.name} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Pagination meta={products.data?.meta} onPage={setPage} />
              </>
            )}
          </Card>
        </div>

        <div>
          <Card className="lg:sticky lg:top-20">
            <CardHeader title="Order summary" description={`${list.length} product${list.length === 1 ? "" : "s"}`} />
            {list.length === 0 ? (
              <EmptyState compact icon={<ShoppingCart />} title="No products added" description="Add products from the list to build the order." />
            ) : (
              <>
                <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto">
                  {list.map((l) => (
                    <li key={l.product.id} className="px-4 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-slate-900">{l.product.name}</p>
                          <p className="text-xs text-slate-500 tabular">{l.quantity} × {formatINR(l.product.effectivePricePaise)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-[13px] font-medium tabular">{formatINR(l.quantity * l.product.effectivePricePaise)}</span>
                          <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label={`Remove ${l.product.name}`} onClick={() => setQty(l.product, 0)}><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      {issues[l.product.id] && <p role="alert" className="mt-1 text-xs text-red-600">{issues[l.product.id]}</p>}
                    </li>
                  ))}
                </ul>
                <div className="space-y-3 border-t border-line p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Discount (₹)" error={totals.discount == null ? "Invalid" : undefined}><Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
                    <Field label="Delivery (₹)" error={totals.delivery == null ? "Invalid" : undefined}><Input inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="0" /></Field>
                  </div>
                  <Field label="Note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional" /></Field>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between text-slate-600"><dt>Subtotal</dt><dd className="tabular">{formatINR(totals.subtotal)}</dd></div>
                    {totals.tax > 0 && <div className="flex justify-between text-slate-600"><dt>GST</dt><dd className="tabular">{formatINR(totals.tax)}</dd></div>}
                    {!!totals.discount && <div className="flex justify-between text-slate-600"><dt>Discount</dt><dd className="tabular">− {formatINR(totals.discount)}</dd></div>}
                    {!!totals.delivery && <div className="flex justify-between text-slate-600"><dt>Delivery</dt><dd className="tabular">{formatINR(totals.delivery)}</dd></div>}
                    <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold text-slate-900"><dt>Total</dt><dd className="tabular">{formatINR(Math.max(0, totals.total))}</dd></div>
                  </dl>
                  <Button size="lg" className="w-full" disabled={!totals.valid || totals.total < 0} loading={create.isPending} onClick={submit}>Create order</Button>
                  <p className="text-center text-xs text-slate-500">Final prices are confirmed when the order is saved.</p>
                </div>
              </>
            )}
          </Card>
          <Link to="/dashboard/orders" className={buttonClass("ghost", "md", "mt-2 w-full")}>Cancel</Link>
        </div>
      </div>
    </div>
  );
}

export function QtyStepper({ value, onChange, label, min = 0, size = "md" }: { value: number; onChange: (v: number) => void; label: string; min?: number; size?: "md" | "lg" }) {
  const h = size === "lg" ? "h-11" : "h-9";
  const w = size === "lg" ? "w-11" : "w-9";
  return (
    <div className={`inline-flex shrink-0 items-center rounded-lg border border-line bg-white shadow-sm ${h}`} role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" className={`grid ${w} h-full place-items-center rounded-l-lg text-slate-600 hover:bg-slate-100 active:bg-slate-200`} aria-label="Decrease quantity" onClick={() => onChange(Math.max(min, value - 1))}>
        {value <= 1 && min === 0 ? <Trash2 className="h-4 w-4 text-red-600" /> : <Minus className="h-4 w-4" />}
      </button>
      <input
        inputMode="numeric"
        aria-label={`Quantity for ${label}`}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Number.isFinite(n) ? Math.min(n, 1_000_000) : value);
        }}
        className="h-full w-12 border-x border-line bg-transparent text-center text-sm font-medium tabular focus:outline-none"
      />
      <button type="button" className={`grid ${w} h-full place-items-center rounded-r-lg text-slate-600 hover:bg-slate-100 active:bg-slate-200`} aria-label="Increase quantity" onClick={() => onChange(value + 1)}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
