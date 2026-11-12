import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, FileDown, LogOut, Minus, Phone, Plus, RotateCcw, Search, ShoppingCart, Store, Trash2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { INDIAN_STATES, PAYMENT_METHOD_LABELS, type Availability, type OrderStatus, type PaymentStatus } from "@shared/constants";
import { AvailabilityBadge, BackLink, ChangePasswordCard, OrderItemsTable, OrderStatusBadge, OrderTimeline, OrderTotals, PaymentStatusBadge, WhatsAppLink } from "@/components/shared";
import { Badge, Button, buttonClass, Card, CardHeader, cn, ConfirmDialog, DefinitionList, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, PageHeader, Pagination, SearchInput, Select, Skeleton, Stat, Tabs, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatGstRate, formatINR, timeAgo } from "@/lib/format";
import { useAction, useApi, useUrlFilters } from "@/lib/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { PushAlertsBanner, PushAlertsCard, type PushText } from "@/components/PushAlerts";
import { downloadOrderPdf } from "@/lib/pdf";
import { messages } from "@/lib/whatsapp";
import { ProductThumb } from "../dashboard/Products";

const availKey = { in_stock: "cat.inStock", low_stock: "cat.lowStock", out_of_stock: "cat.outOfStock" } as const;

/** Phone-alert wording in the retailer's chosen language. */
const pushText = (t: (k: TKey) => string): PushText => ({
  title: t("push.title"), desc: t("push.desc"), turnOn: t("push.turnOn"), turnOff: t("push.turnOff"), on: t("push.on"), test: t("push.test"),
  testSent: t("push.testSent"), denied: t("push.denied"), unsupported: t("push.unsupported"), install: t("push.install"),
  notConfigured: t("push.notConfigured"), dismiss: t("push.dismiss"), failed: t("push.failed"),
});

/** Cart quantities by product id, shared by every screen that shows an "add to cart" control. */
function useCart() {
  const q = useApi<any>("/retailer/cart");
  const byId: Record<string, number> = {};
  for (const it of q.data?.data.items ?? []) byId[it.productId] = it.quantity;
  return { ...q, cart: q.data?.data, byId };
}

/** Add button that becomes a − qty + stepper. Every change is saved to the server-side cart. */
function CartControl({ product, quantity, size = "md" }: { product: { id: string; name: string; minOrderQty: number; availableQty: number | null; availabilityStatus: Availability }; quantity: number; size?: "md" | "lg" }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [text, setText] = useState(String(quantity));
  useEffect(() => setText(String(quantity)), [quantity]);
  const update = useAction((q: number) => api.put("/retailer/cart/items", { productId: product.id, quantity: q }), {
    silentError: true,
    onSuccess: (data) => qc.setQueryData(["/retailer/cart", null], { data }),
  });
  const set = (q: number) => {
    let next = q;
    if (next > 0 && next < product.minOrderQty) next = q < quantity ? 0 : product.minOrderQty; // stepping below the minimum removes the item
    if (product.availableQty != null && next > product.availableQty) {
      toast.info(t("cat.onlyLeft", { n: product.availableQty }));
      next = product.availableQty;
    }
    if (next === quantity) return setText(String(quantity));
    update.mutate(next, { onError: (e) => { toast.error(errorMessage(e)); setText(String(quantity)); } });
  };
  const h = size === "lg" ? "h-12" : "h-10";
  if (product.availabilityStatus === "out_of_stock" && quantity === 0) {
    return <Button variant="secondary" size={size} disabled className="w-full">{t("cat.outOfStock")}</Button>;
  }
  if (quantity === 0) {
    return (
      <Button size={size} className="w-full" loading={update.isPending} onClick={() => set(product.minOrderQty)}>
        <Plus className="h-4 w-4" aria-hidden /> {t("cat.add")}
      </Button>
    );
  }
  return (
    <div className={cn("flex w-full items-center rounded-lg border border-brand-700 bg-brand-50", h, update.isPending && "opacity-70")} role="group" aria-label={`${product.name}: ${quantity} ${t("cat.inCart")}`}>
      <button type="button" className="grid h-full w-11 shrink-0 place-items-center rounded-l-lg text-brand-800 active:bg-brand-100" aria-label="−" onClick={() => set(quantity - 1)}>
        {quantity <= product.minOrderQty ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
      </button>
      <input
        inputMode="numeric"
        aria-label={product.name}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 7))}
        onBlur={() => set(Number(text) || 0)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-full min-w-0 flex-1 bg-transparent text-center text-sm font-semibold text-brand-900 tabular focus:outline-none"
      />
      <button type="button" className="grid h-full w-11 shrink-0 place-items-center rounded-r-lg text-brand-800 active:bg-brand-100" aria-label="+" onClick={() => set(quantity + 1)}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function Price({ product, large }: { product: any; large?: boolean }) {
  const { t } = useT();
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={cn("font-semibold text-slate-900 tabular", large ? "text-2xl" : "text-base")}>{formatINR(product.pricePaise)}</span>
        <span className="text-xs text-slate-500">/ {product.unit}</span>
      </p>
      <p className="text-[11px] text-slate-500">
        {product.mrpPaise != null && <span className="tabular">{t("cat.mrp")} {formatINR(product.mrpPaise)}</span>}
        {product.mrpPaise != null && product.gstRateBp > 0 && " · "}
        {product.gstRateBp > 0 && t("cat.plusGst", { r: formatGstRate(product.gstRateBp) })}
      </p>
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────────────

export function RetailerDashboard() {
  const { session } = useAuth();
  const { t } = useT();
  const q = useApi<any>("/retailer/dashboard");
  const store = useApi<any>("/retailer/store");
  const d = q.data?.data;
  const sLabel = (s: OrderStatus) => t(`status.${s}` as any);
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">{t("home.greeting")}, {session?.user.name.split(" ")[0]}</h1>
        <p className="mt-0.5 text-sm text-slate-500">{t("home.orderingFrom")}: <span className="font-medium text-slate-700">{session?.business?.name}</span></p>
      </div>
      <PushAlertsBanner text={pushText(t)} className="mb-4" />
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : q.isError || !d ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className="col-span-2 lg:col-span-1"><Stat label={t("home.outstanding")} value={formatINR(d.totals.outstandingPaise)} tone={d.totals.outstandingPaise > 0 ? "danger" : "success"} icon={<Wallet />} hint={<Link to="/retailer/payments" className="font-medium text-brand-700 hover:underline">{t("common.view")} →</Link>} /></div>
            <Stat label={t("home.activeOrders")} value={d.activeOrders} icon={<ClipboardList />} />
            <Stat label={t("home.totalPurchases")} value={formatINR(d.totals.totalPurchasesPaise)} icon={<Store />} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link to="/retailer/catalogue" className={buttonClass("primary", "lg")}><Search className="h-4 w-4" aria-hidden /> {t("home.browse")}</Link>
            {d.cartCount > 0 ? (
              <Link to="/retailer/cart" className={buttonClass("secondary", "lg")}><ShoppingCart className="h-4 w-4" aria-hidden /> {t("cat.viewCart")} · {t("cat.items", { n: d.cartCount })}</Link>
            ) : store.data?.data.business.phone ? (
              <a href={`tel:${store.data.data.business.phone}`} className={buttonClass("secondary", "lg")}><Phone className="h-4 w-4" aria-hidden /> {t("home.contact")}</a>
            ) : null}
          </div>
          <Card className="mt-4">
            <CardHeader title={t("home.recentOrders")} action={<Link to="/retailer/orders" className="text-[13px] font-medium text-brand-700 hover:underline">{t("common.viewAll")}</Link>} />
            {d.recentOrders.length === 0 ? (
              <EmptyState compact icon={<ClipboardList />} title={t("home.noOrders")} description={t("home.noOrdersHint")} />
            ) : (
              <ul className="divide-y divide-line/70">
                {d.recentOrders.map((o: any) => (
                  <li key={o.id}>
                    <Link to={`/retailer/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-slate-50 sm:px-5">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">#{o.orderNumber}</span>
                        <span className="text-xs text-slate-500">{timeAgo(o.createdAt)} · {formatINR(o.totalPaise)}</span>
                      </span>
                      <OrderStatusBadge status={o.status} label={sLabel(o.status)} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ── Catalogue ─────────────────────────────────────────────────────────

export function Catalogue() {
  const { t } = useT();
  const { values: f, page, set } = useUrlFilters({ q: "", categoryId: "" });
  const store = useApi<any>("/retailer/store");
  const q = useApi<any[]>("/retailer/products", { ...f, page });
  const { cart, byId } = useCart();
  const [detail, setDetail] = useState<any | null>(null);
  const rows = q.data?.data ?? [];
  const categories: any[] = store.data?.data.categories ?? [];

  return (
    <div className={cn(cart?.itemCount > 0 && "pb-20 md:pb-0")}>
      <div className="sticky top-14 z-10 -mx-3 bg-canvas px-3 pt-1 pb-3 sm:-mx-5 sm:px-5">
        <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder={t("common.search")} className="[&_input]:h-11" />
        {categories.length > 0 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Categories">
            {[{ id: "", name: t("common.all") }, ...categories].map((c) => (
              <button key={c.id} type="button" aria-pressed={f.categoryId === c.id} onClick={() => set({ categoryId: c.id })} className={cn("h-8 shrink-0 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap", f.categoryId === c.id ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-white text-slate-600")}>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      ) : q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : rows.length === 0 ? (
        <Card>{f.q || f.categoryId ? <EmptyState icon={<Search />} title={t("cat.empty")} description={t("cat.emptyHint")} /> : <EmptyState icon={<Store />} title={t("cat.noProducts")} description={t("cat.noProductsHint")} />}</Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card">
              <button type="button" className="block text-left" onClick={() => setDetail(p)} aria-label={`${t("cat.details")}: ${p.name}`}>
                <ProductThumb url={p.imageUrl} name={p.name} className="aspect-[4/3] h-auto w-full rounded-none" />
                <div className="px-3 pt-2.5">
                  <p className="line-clamp-2 min-h-[2.5rem] text-sm leading-tight font-medium text-slate-900">{p.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">{p.sku}</p>
                </div>
              </button>
              <div className="mt-auto space-y-2 p-3 pt-2">
                <Price product={p} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <AvailabilityBadge status={p.availabilityStatus} label={t(availKey[p.availabilityStatus as Availability])} />
                  {p.minOrderQty > 1 && <span className="text-[11px] text-slate-500">{t("cat.minQty")}: {p.minOrderQty}</span>}
                </div>
                <CartControl product={p} quantity={byId[p.id] ?? 0} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination meta={q.data?.meta} onPage={(p) => { set({ page: p } as any); window.scrollTo({ top: 0 }); }} />

      {cart?.itemCount > 0 && (
        <div className="no-print fixed inset-x-0 bottom-[3.75rem] z-10 border-t border-line bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mt-4 md:rounded-xl md:border md:pb-3 md:shadow-card">
          <Link to="/retailer/cart" className={buttonClass("primary", "lg", "w-full justify-between")}>
            <span className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" aria-hidden /> {t("cat.viewCart")} · {t("cat.items", { n: cart.itemCount })}</span>
            <span className="tabular">{formatINR(cart.totalPaise)}</span>
          </Link>
        </div>
      )}

      <Modal open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title={detail?.name ?? ""} description={detail ? `${detail.sku}${detail.categoryName ? " · " + detail.categoryName : ""}` : undefined} size="sm">
        {detail && (
          <div className="space-y-4">
            <ProductThumb url={detail.imageUrl} name={detail.name} className="aspect-[4/3] h-auto w-full" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">{t("cat.yourPrice")}</p>
                <Price product={detail} large />
              </div>
              <AvailabilityBadge status={detail.availabilityStatus} label={detail.availableQty != null && detail.availabilityStatus === "low_stock" ? t("cat.onlyLeft", { n: detail.availableQty }) : t(availKey[detail.availabilityStatus as Availability])} />
            </div>
            <p className="text-[13px] text-slate-600">{t("cat.minQty")}: <span className="font-medium text-slate-900">{detail.minOrderQty} {detail.unit}</span></p>
            {detail.description && <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-600">{detail.description}</p>}
            <CartControl product={detail} quantity={byId[detail.id] ?? 0} size="lg" />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Cart & checkout ───────────────────────────────────────────────────

export function CartPage() {
  const { t } = useT();
  const { session } = useAuth();
  const store = useApi<any>("/retailer/store");
  const q = useCart();
  const [note, setNote] = useState("");
  const [clearing, setClearing] = useState(false);
  const [placed, setPlaced] = useState<any | null>(null);
  const place = useAction(() => api.post("/retailer/orders", { note }), { onSuccess: (d) => { setPlaced(d); setNote(""); } });
  const clear = useAction(() => api.del("/retailer/cart"), { onSuccess: () => setClearing(false) });
  const cart = q.cart;

  if (placed) {
    return (
      <Card className="mx-auto max-w-lg">
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-7 w-7" aria-hidden /></span>
          <h1 className="mt-4 text-xl font-semibold">{t("cart.placed")}</h1>
          <p className="mt-1 text-sm text-slate-500">#{placed.orderNumber} · {formatINR(placed.totalPaise)}</p>
          <p className="mt-3 max-w-sm text-sm text-slate-600">{t("cart.placedHint")}</p>
          <div className="mt-6 flex w-full flex-col gap-2">
            {store.data?.data.business.phone && (
              <WhatsAppLink size="lg" phone={store.data.data.business.phone} message={messages.newOrderToWholesaler(placed, session?.retailer?.businessName ?? "")}>{t("cart.tellOnWhatsApp")}</WhatsAppLink>
            )}
            <Link to={`/retailer/orders/${placed.id}`} className={buttonClass("secondary", "lg")}>{t("cart.viewOrder")}</Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader title={t("cart.title")} actions={cart?.itemCount > 0 ? <Button variant="ghost" size="sm" onClick={() => setClearing(true)}><Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("cart.clear")}</Button> : undefined} />
      {q.isLoading ? <Card><ListSkeleton rows={3} /></Card> : q.isError || !cart ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : cart.items.length === 0 ? (
        <Card><EmptyState icon={<ShoppingCart />} title={t("cart.empty")} description={t("cart.emptyHint")} action={<Link to="/retailer/catalogue" className={buttonClass("primary", "md")}>{t("home.browse")}</Link>} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <Card>
            <ul className="divide-y divide-line/70">
              {cart.items.map((it: any) => (
                <li key={it.productId} className={cn("p-3 sm:p-4", it.issue && "bg-red-50/60")}>
                  <div className="flex gap-3">
                    <ProductThumb url={it.imageUrl} name={it.name} className="h-14 w-14" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-tight font-medium text-slate-900">{it.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{it.sku} · {it.unitPricePaise != null ? `${formatINR(it.unitPricePaise)} / ${it.unit}` : "—"}</p>
                      {it.issue && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{it.issue}</p>}
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular">{it.lineSubtotalPaise != null ? formatINR(it.lineSubtotalPaise) : "—"}</p>
                  </div>
                  <div className="mt-2 ml-[4.25rem] max-w-[11rem]">
                    <CartControl product={{ id: it.productId, name: it.name, minOrderQty: it.minOrderQty, availableQty: it.availableQty, availabilityStatus: "in_stock" }} quantity={it.quantity} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <div>
            <Card className="lg:sticky lg:top-20">
              <CardHeader title={t("cart.summary")} />
              <div className="space-y-3 p-4">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-slate-600"><dt>{t("cart.subtotal")}</dt><dd className="tabular">{formatINR(cart.subtotalPaise)}</dd></div>
                  {cart.taxPaise > 0 && <div className="flex justify-between text-slate-600"><dt>{t("cart.gst")}</dt><dd className="tabular">{formatINR(cart.taxPaise)}</dd></div>}
                  <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-slate-900"><dt>{t("cart.total")}</dt><dd className="tabular">{formatINR(cart.totalPaise)}</dd></div>
                </dl>
                <Field label={t("cart.note")}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("cart.notePlaceholder")} /></Field>
                {!cart.canCheckout && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{t("cart.fix")}</p>}
                <Button size="lg" className="hidden w-full lg:inline-flex" disabled={!cart.canCheckout} loading={place.isPending} onClick={() => place.mutate()}>{t("cart.place")} · {formatINR(cart.totalPaise)}</Button>
                <p className="text-xs text-slate-500">{t("cart.priceNote")}</p>
              </div>
            </Card>
          </div>
          <div className="no-print fixed inset-x-0 bottom-[3.75rem] z-10 border-t border-line bg-white p-3 md:bottom-0 lg:hidden">
            <Button size="lg" className="w-full justify-between" disabled={!cart.canCheckout} loading={place.isPending} onClick={() => place.mutate()}>
              <span>{t("cart.place")}</span><span className="tabular">{formatINR(cart.totalPaise)}</span>
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={clearing} onOpenChange={setClearing} title={`${t("cart.clear")}?`} confirmLabel={t("cart.clear")} loading={clear.isPending} onConfirm={() => clear.mutate()} />
    </div>
  );
}

// ── Orders ────────────────────────────────────────────────────────────

export function RetailerOrders() {
  const { t } = useT();
  const { values: f, page, set } = useUrlFilters({ status: "" });
  const q = useApi<any[]>("/retailer/orders", { ...f, page }, { refetchInterval: 60_000 });
  const rows = q.data?.data ?? [];
  const isVoid = (s: string) => s === "rejected" || s === "cancelled";
  return (
    <div>
      <PageHeader title={t("orders.title")} />
      <Tabs className="mb-3" value={f.status} onChange={(v) => set({ status: v })} options={[{ value: "", label: t("common.all") }, { value: "active", label: t("orders.active") }, { value: "delivered", label: t("status.delivered") }, { value: "cancelled", label: t("status.cancelled") }]} />
      <Card>
        {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
          <EmptyState icon={<ClipboardList />} title={t("orders.empty")} description={t("orders.emptyHint")} action={<Link to="/retailer/catalogue" className={buttonClass("primary", "md")}>{t("home.browse")}</Link>} />
        ) : (
          <ul className="divide-y divide-line/70">
            {rows.map((o) => (
              <li key={o.id}>
                <Link to={`/retailer/orders/${o.id}`} className="block px-4 py-3 hover:bg-slate-50 active:bg-slate-50 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">#{o.orderNumber}</p>
                      <p className="text-xs text-slate-500">{formatDateTime(o.createdAt)} · {t("orders.items", { n: o.itemCount })}</p>
                    </div>
                    <p className="text-sm font-semibold tabular">{formatINR(o.totalPaise)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <OrderStatusBadge status={o.status} label={t(`status.${o.status}` as any)} />
                    {!isVoid(o.status) && <PaymentStatusBadge status={o.paymentStatus} label={t(`pstatus.${o.paymentStatus}` as any)} />}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={q.data?.meta} onPage={(p) => set({ page: p } as any)} />
      </Card>
    </div>
  );
}

export function RetailerOrderDetail() {
  const { id = "" } = useParams();
  const { t } = useT();
  const navigate = useNavigate();
  const store = useApi<any>("/retailer/store");
  const q = useApi<any>(`/retailer/orders/${id}`, undefined, { refetchInterval: 60_000 });
  const [cancelling, setCancelling] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const cancel = useAction(() => api.post(`/retailer/orders/${id}/cancel`), { success: t("status.cancelled"), onSuccess: () => setCancelling(false) });
  const reorder = useAction(() => api.post(`/retailer/orders/${id}/reorder`), {
    onSuccess: (d: any) => {
      if (d.added > 0) toast.success(t("orders.reordered", { n: d.added }));
      if (d.skipped.length) toast.warning(t("orders.skipped", { n: d.skipped.length }), { description: d.skipped.map((s: any) => s.reason).join(" · ") });
      if (d.added > 0) navigate("/retailer/cart");
    },
  });
  const order = q.data?.data;
  if (q.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (q.isError || !order) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const isVoid = order.status === "rejected" || order.status === "cancelled";
  const sLabel = (s: OrderStatus) => t(`status.${s}` as any);
  const pdf = async () => {
    setPdfBusy(true);
    try {
      await downloadOrderPdf(order, store.data?.data.business ?? { name: "" });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <div>
      <PageHeader
        back={<BackLink to="/retailer/orders">{t("orders.title")}</BackLink>}
        title={`${t("orders.order")} #${order.orderNumber}`}
        description={<span className="flex flex-wrap items-center gap-2">{formatDateTime(order.createdAt)} <OrderStatusBadge status={order.status} label={sLabel(order.status)} /> {!isVoid && <PaymentStatusBadge status={order.paymentStatus as PaymentStatus} label={t(`pstatus.${order.paymentStatus}` as any)} />}</span>}
        actions={
          <>
            <Button variant="secondary" onClick={pdf} loading={pdfBusy}><FileDown className="h-4 w-4" aria-hidden /> {t("orders.pdf")}</Button>
            <Button onClick={() => reorder.mutate()} loading={reorder.isPending}><RotateCcw className="h-4 w-4" aria-hidden /> {t("orders.reorder")}</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={`${t("orders.itemsTitle")} (${order.items.length})`} />
            <OrderItemsTable items={order.items} showGst={order.taxPaise > 0} />
            <div className="border-t border-line"><OrderTotals order={order} labels={{ subtotal: t("cart.subtotal"), gst: t("cart.gst"), discount: t("orders.discount"), delivery: t("orders.delivery"), total: t("cart.total"), paid: t("orders.paid"), balance: t("orders.balance") }} /></div>
          </Card>
          {order.retailerNote && <Card><CardHeader title={t("orders.yourNote")} /><p className="px-4 py-3 text-sm whitespace-pre-wrap text-slate-700 sm:px-5">{order.retailerNote}</p></Card>}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("orders.track")} />
            <div className="p-4 sm:p-5"><OrderTimeline history={order.history} statusLabel={sLabel} /></div>
          </Card>
          {order.status === "pending" && <Button variant="dangerOutline" className="w-full" onClick={() => setCancelling(true)}>{t("orders.cancel")}</Button>}
        </div>
      </div>
      <ConfirmDialog open={cancelling} onOpenChange={setCancelling} title={t("orders.cancelConfirm")} description={t("orders.cancelHint")} confirmLabel={t("orders.cancel")} loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
    </div>
  );
}

// ── Payments ──────────────────────────────────────────────────────────

export function RetailerPayments() {
  const { t } = useT();
  const q = useApi<any>("/retailer/ledger");
  const d = q.data?.data;
  return (
    <div>
      <PageHeader title={t("pay.title")} />
      {q.isLoading ? <Skeleton className="h-64 rounded-xl" /> : q.isError || !d ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className="col-span-2 lg:col-span-1"><Stat label={t("home.outstanding")} value={formatINR(d.totals.outstandingPaise)} tone={d.totals.outstandingPaise > 0 ? "danger" : "success"} icon={<Wallet />} /></div>
            <Stat label={t("home.totalPurchases")} value={formatINR(d.totals.totalPurchasesPaise)} />
            <Stat label={t("pay.totalPaid")} value={formatINR(d.totals.totalPaidPaise)} tone="success" />
          </div>
          <Card>
            <CardHeader title={t("pay.unpaidOrders")} />
            {d.openOrders.length === 0 ? <EmptyState compact icon={<CheckCircle2 />} title={t("pay.allClear")} description={t("pay.allClearHint")} /> : (
              <ul className="divide-y divide-line/70">
                {d.openOrders.map((o: any) => (
                  <li key={o.id}>
                    <Link to={`/retailer/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-slate-50 sm:px-5">
                      <span>
                        <span className="block text-sm font-medium text-slate-900">#{o.orderNumber}</span>
                        <span className="text-xs text-slate-500">{formatDate(o.createdAt)} · {t("cart.total")} {formatINR(o.totalPaise)}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold text-red-700 tabular">{formatINR(o.outstandingPaise)}</span>
                        <span className="text-[11px] text-slate-500">{t("orders.balance")}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t("pay.history")} />
            {d.payments.length === 0 ? <EmptyState compact icon={<Wallet />} title={t("pay.empty")} description={t("pay.emptyHint")} /> : (
              <ul className="divide-y divide-line/70">
                {d.payments.map((p: any) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                    <span className="min-w-0">
                      <span className={cn("block text-sm font-medium", p.status === "reversed" ? "text-slate-400" : "text-slate-900")}>{formatDate(p.paymentDate)} · {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS]}</span>
                      <span className="block text-xs text-slate-500">{p.orderNumbers && <>{t("pay.appliedTo")}: {p.orderNumbers.split(", ").map((n: string) => `#${n}`).join(", ")}</>}{p.reference && ` · Ref ${p.reference}`}</span>
                      {p.status === "reversed" && <Badge tone="danger" className="mt-1">{t("pay.reversed")}{p.reversalReason ? `: ${p.reversalReason}` : ""}</Badge>}
                    </span>
                    <span className={cn("shrink-0 text-sm font-semibold tabular", p.status === "reversed" ? "text-slate-400 line-through" : "text-emerald-700")}>{formatINR(p.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────

export function RetailerProfile() {
  const { t, lang, setLang } = useT();
  const { session, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const q = useApi<any>("/retailer/profile");
  const { register, handleSubmit, reset, formState } = useForm<any>();
  useEffect(() => {
    const p = q.data?.data;
    if (p) reset({ contactPerson: p.contactPerson ?? "", address: p.address ?? "", city: p.city ?? "", state: p.state ?? "", gstin: p.gstin ?? "" });
  }, [q.data, reset]);
  const save = useAction((v: any) => api.patch("/retailer/profile", v), { success: "✓", onSuccess: () => refresh() });
  const p = q.data?.data;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t("profile.title")} />
      <Card>
        <CardHeader title={t("profile.shop")} description={t("profile.managedBy")} />
        {q.isLoading || !p ? <ListSkeleton rows={3} /> : (
          <form className="space-y-4 p-4 sm:p-5" onSubmit={handleSubmit((v) => save.mutate(v))}>
            <DefinitionList items={[["Shop", p.businessName], ["Phone", p.phone], ["Email", session?.user.email], ["Wholesaler", session?.business?.name]]} />
            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Field label="Contact person"><Input {...register("contactPerson", { minLength: 2 })} /></Field>
              <Field label="GSTIN" hint="Optional"><Input {...register("gstin")} className="uppercase" maxLength={15} /></Field>
              <Field label="Address" className="sm:col-span-2"><Textarea rows={2} {...register("address")} /></Field>
              <Field label="City"><Input {...register("city")} /></Field>
              <Field label="State"><Select {...register("state")}><option value="">—</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            </div>
            <Button type="submit" loading={save.isPending} disabled={!formState.isDirty}>{t("common.save")}</Button>
          </form>
        )}
      </Card>
      <Card>
        <CardHeader title={t("profile.language")} />
        <div className="flex gap-2 p-4 sm:p-5" role="group" aria-label={t("profile.language")}>
          {([["en", "English"], ["hi", "हिंदी"]] as const).map(([code, label]) => (
            <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)} className={cn("h-10 flex-1 rounded-lg border text-sm font-medium sm:flex-none sm:px-6", lang === code ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-white text-slate-700")}>{label}</button>
          ))}
        </div>
      </Card>
      <PushAlertsCard text={pushText(t)} />
      <ChangePasswordCard title={t("profile.changePassword")} />
      <Button variant="secondary" size="lg" className="w-full md:hidden" onClick={async () => { await logout(); navigate("/login"); }}><LogOut className="h-4 w-4" aria-hidden /> {t("nav.logout")}</Button>
    </div>
  );
}
