import { BadgeIndianRupee, ClipboardList, KeyRound, Link2, Pencil, Percent, Plus, Send, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BackLink, OrderStatusBadge, PaymentStatusBadge, ShareLinkDialog, WhatsAppLink } from "@/components/shared";
import { Badge, Button, buttonClass, Card, CardHeader, ConfirmDialog, DefinitionList, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, ModalFooter, PageHeader, Pagination, SearchInput, Select, Skeleton, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatINR, paiseToRupeesString, rupeesToPaise } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { messages } from "@/lib/whatsapp";
import { PaymentRows, RecordPaymentDialog, ReversePaymentDialog } from "./Payments";
import { InviteBadge, RetailerFormDialog } from "./Retailers";

type Tab = "overview" | "orders" | "payments" | "prices";

function PriceList({ retailerId }: { retailerId: string }) {
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [onlyOverrides, setOnlyOverrides] = useState(false);
  const [page, setPage] = useState(1);
  const list = useApi<any[]>(`/biz/retailers/${retailerId}/prices`, { q, categoryId, onlyOverrides: onlyOverrides ? 1 : undefined, page, pageSize: 50 });
  const categories = useApi<any[]>("/biz/categories");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState(false);
  const [percent, setPercent] = useState("5");
  const [bulkCat, setBulkCat] = useState("");
  const [clearing, setClearing] = useState(false);
  useEffect(() => setPage(1), [q, categoryId, onlyOverrides]);

  const rows = list.data?.data ?? [];
  const changes = useMemo(() => {
    const out: { productId: string; pricePaise: number | null }[] = [];
    let invalid = false;
    for (const r of rows) {
      if (!(r.id in draft)) continue;
      const text = draft[r.id].trim();
      const paise = text === "" ? null : rupeesToPaise(text);
      if (text !== "" && paise == null) {
        invalid = true;
        continue;
      }
      if (paise !== (r.overridePricePaise ?? null)) out.push({ productId: r.id, pricePaise: paise });
    }
    return { out, invalid };
  }, [draft, rows]);

  const save = useAction(() => api.put(`/biz/retailers/${retailerId}/prices`, { items: changes.out }), { success: (d: any) => `${d.updated} price${d.updated === 1 ? "" : "s"} updated`, onSuccess: () => setDraft({}) });
  const bulkApply = useAction(() => api.post(`/biz/retailers/${retailerId}/prices/bulk`, { mode: "percent_off", percent: Number(percent), categoryId: bulkCat || null }), {
    success: (d: any) => `Special prices set on ${d.affected} products`,
    onSuccess: () => { setBulk(false); setDraft({}); },
  });
  const clear = useAction(() => api.post(`/biz/retailers/${retailerId}/prices/bulk`, { mode: "clear" }), { success: "All special prices removed", onSuccess: () => { setClearing(false); setDraft({}); } });
  const pct = Number(percent);

  return (
    <Card>
      <CardHeader
        title="Price list"
        description="Leave “Special price” blank to charge the standard price. The price shown here is exactly what this retailer sees and is charged."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setBulk(true)}><Percent className="h-3.5 w-3.5" aria-hidden /> Bulk discount</Button>
            <Button variant="ghost" size="sm" onClick={() => setClearing(true)}>Reset all</Button>
          </div>
        }
      />
      <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:p-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search product or SKU" />
        <Select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {categories.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-brand-700" checked={onlyOverrides} onChange={(e) => setOnlyOverrides(e.target.checked)} />
          Special prices only
        </label>
      </div>
      {list.isLoading ? <ListSkeleton /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<BadgeIndianRupee />} title={q || categoryId || onlyOverrides ? "No products match" : "No products yet"} description={onlyOverrides ? "This retailer pays the standard price on everything." : "Add products to your catalogue first."} />
      ) : (
        <Table>
          <thead>
            <tr><Th>Product</Th><Th className="text-right">Standard price</Th><Th className="w-40">Special price (₹)</Th><Th className="text-right">Retailer pays</Th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const text = r.id in draft ? draft[r.id] : paiseToRupeesString(r.overridePricePaise);
              const parsed = text.trim() === "" ? null : rupeesToPaise(text);
              const bad = text.trim() !== "" && parsed == null;
              const effective = bad ? r.effectivePricePaise : parsed ?? r.standardPricePaise;
              const diff = effective - r.standardPricePaise;
              return (
                <tr key={r.id}>
                  <Td>
                    <span className="block max-w-[18rem] truncate font-medium text-slate-900">{r.name}</span>
                    <span className="text-xs text-slate-500">{r.sku} · per {r.unit}{!r.isActive && " · inactive"}</span>
                  </Td>
                  <Td className="text-right text-slate-600 tabular">{formatINR(r.standardPricePaise)}</Td>
                  <Td>
                    <Input inputMode="decimal" aria-label={`Special price for ${r.name}`} aria-invalid={bad} value={text} placeholder="Standard" onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))} className="h-9 text-right tabular" />
                  </Td>
                  <Td className="text-right">
                    <span className="font-semibold text-slate-900 tabular">{formatINR(effective)}</span>
                    {diff !== 0 && <span className={`block text-xs tabular ${diff < 0 ? "text-emerald-700" : "text-amber-700"}`}>{diff < 0 ? "−" : "+"}{formatINR(Math.abs(diff))}</span>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => { setDraft({}); setPage(p); }} />
      {(changes.out.length > 0 || changes.invalid) && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-b-xl border-t border-line bg-white px-4 py-3 shadow-[0_-4px_12px_rgb(22_31_69/0.06)] sm:px-5">
          <p className="text-sm text-slate-600">{changes.invalid ? <span className="text-red-600">Fix the highlighted prices</span> : `${changes.out.length} unsaved change${changes.out.length === 1 ? "" : "s"}`}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDraft({})}>Discard</Button>
            <Button disabled={changes.invalid || !changes.out.length} loading={save.isPending} onClick={() => save.mutate()}>Save prices</Button>
          </div>
        </div>
      )}

      <Modal open={bulk} onOpenChange={setBulk} title="Bulk discount" description="Sets a special price on every product as a percentage below the standard price. Existing special prices are replaced." size="sm">
        <div className="grid gap-4">
          <Field label="Discount (%)" error={!(pct > 0 && pct <= 90) ? "Enter a percentage between 0.01 and 90" : undefined}>
            <Input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} autoFocus />
          </Field>
          <Field label="Apply to">
            <Select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
              <option value="">All products</option>
              {categories.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}
            </Select>
          </Field>
          {pct > 0 && pct <= 90 && <p className="rounded-lg bg-slate-50 p-3 text-[13px] text-slate-600">Example: a product with a standard price of ₹100 will cost this retailer <span className="font-semibold text-slate-900">{formatINR(Math.floor((10000 * (10000 - Math.round(pct * 100)) + 5000) / 10000))}</span>.</p>}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setBulk(false)}>Cancel</Button>
          <Button disabled={!(pct > 0 && pct <= 90)} loading={bulkApply.isPending} onClick={() => bulkApply.mutate()}>Apply discount</Button>
        </ModalFooter>
      </Modal>
      <ConfirmDialog open={clearing} onOpenChange={setClearing} title="Remove all special prices?" description="This retailer will be charged the standard price on every product. Existing orders are not affected." confirmLabel="Remove special prices" loading={clear.isPending} onConfirm={() => clear.mutate()} />
    </Card>
  );
}

function RetailerOrders({ retailerId }: { retailerId: string }) {
  const [page, setPage] = useState(1);
  const q = useApi<any[]>("/biz/orders", { retailerId, page });
  const rows = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader title="Order history" action={<Link to={`/dashboard/orders/new?retailerId=${retailerId}`} className={buttonClass("secondary", "sm")}><Plus className="h-3.5 w-3.5" aria-hidden /> Create order</Link>} />
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No orders yet" description="Orders placed by this retailer will appear here." />
      ) : (
        <Table>
          <thead><tr><Th>Order</Th><Th>Date</Th><Th>Status</Th><Th>Payment</Th><Th className="text-right">Total</Th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50/60">
                <Td><Link to={`/dashboard/orders/${o.id}`} className="font-medium text-brand-700 hover:underline">#{o.orderNumber}</Link></Td>
                <Td className="text-slate-600">{formatDate(o.createdAt)}</Td>
                <Td><OrderStatusBadge status={o.status} /></Td>
                <Td>{["rejected", "cancelled"].includes(o.status) ? <span className="text-slate-400">—</span> : <PaymentStatusBadge status={o.paymentStatus} />}</Td>
                <Td className="text-right font-medium tabular">{formatINR(o.totalPaise)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination meta={q.data?.meta} onPage={setPage} />
    </Card>
  );
}

export default function RetailerDetail() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "overview";
  const setTab = (t: Tab) => setSp((p) => { const n = new URLSearchParams(p); t === "overview" ? n.delete("tab") : n.set("tab", t); return n; }, { replace: true });
  const q = useApi<any>(`/biz/retailers/${id}`);
  const ledger = useApi<any>(tab === "payments" ? `/biz/retailers/${id}/ledger` : null);
  const [editing, setEditing] = useState(false);
  const [share, setShare] = useState<null | { kind: "invite" | "reset"; link: string }>(null);
  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState<any | null>(null);
  const [toggling, setToggling] = useState(false);

  const invite = useAction(() => api.post(`/biz/retailers/${id}/invite`), { onSuccess: (d: any) => setShare({ kind: "invite", link: `${window.location.origin}/invite/${d.token}` }) });
  const revoke = useAction(() => api.del(`/biz/retailers/${id}/invite`), { success: "Invitation revoked. The old link no longer works." });
  const resetLink = useAction(() => api.post(`/biz/retailers/${id}/reset-link`), { onSuccess: (d: any) => setShare({ kind: "reset", link: `${window.location.origin}/reset-password?token=${d.token}` }) });
  const setStatus = useAction((status: string) => api.patch(`/biz/retailers/${id}`, { status }), { success: (_d, s) => (s === "active" ? "Retailer activated" : "Retailer deactivated and signed out"), onSuccess: () => setToggling(false) });

  // arriving from "Add retailer": offer the invitation straight away
  useEffect(() => {
    if (sp.get("invite") === "1" && q.data && q.data.data.inviteState === "not_invited" && !invite.isPending) {
      setSp((p) => { const n = new URLSearchParams(p); n.delete("invite"); return n; }, { replace: true });
      invite.mutate();
    }
  }, [sp, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <div><Skeleton className="mb-4 h-8 w-64" /><Skeleton className="h-64 rounded-xl" /></div>;
  if (q.isError || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const r = q.data.data;
  const t = r.totals;
  const bizName = session?.business?.name ?? "";

  return (
    <div>
      <PageHeader
        back={<BackLink to="/dashboard/retailers">Retailers</BackLink>}
        title={r.businessName}
        description={<span className="flex flex-wrap items-center gap-2">{r.contactPerson} · <span className="tabular">{r.phone}</span> <InviteBadge state={r.inviteState} /> {r.status === "inactive" && <Badge tone="danger">Inactive</Badge>}</span>}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
            <Button onClick={() => setPaying(true)} disabled={t.outstandingPaise === 0}><Wallet className="h-4 w-4" aria-hidden /> Record payment</Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding" value={formatINR(t.outstandingPaise)} tone={t.outstandingPaise > 0 ? "danger" : "success"} icon={<Wallet />} />
        <Stat label="Total purchases" value={formatINR(t.totalPurchasesPaise)} icon={<BadgeIndianRupee />} />
        <Stat label="Total paid" value={formatINR(t.totalPaidPaise)} tone="success" icon={<Wallet />} />
        <Stat label="Orders" value={t.orderCount} icon={<ClipboardList />} />
      </div>
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[{ value: "overview", label: "Details" }, { value: "orders", label: "Orders", count: t.orderCount }, { value: "payments", label: "Payments & ledger" }, { value: "prices", label: "Price list", count: r.priceOverrideCount || undefined }]}
      />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Business information" />
            <div className="p-4 sm:p-5">
              <DefinitionList
                items={[
                  ["Business name", r.businessName], ["Contact person", r.contactPerson], ["Phone", r.phone], ["Email", r.email], ["GSTIN", r.gstin],
                  ["Address", [r.address, r.city, r.state].filter(Boolean).join(", ")], ["Added on", formatDate(r.createdAt)], ["Registered on", r.registeredAt ? formatDate(r.registeredAt) : "Not registered yet"],
                ]}
              />
            </div>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Portal access" />
              <div className="space-y-3 p-4 sm:p-5">
                {r.inviteState === "registered" ? (
                  <>
                    <p className="text-sm text-slate-600">Signs in as <span className="font-medium text-slate-900">{r.account?.email}</span></p>
                    <p className="text-xs text-slate-500">Last sign-in: {r.account?.lastLoginAt ? formatDateTime(r.account.lastLoginAt) : "never"}</p>
                    <Button variant="secondary" className="w-full" loading={resetLink.isPending} onClick={() => resetLink.mutate()}><KeyRound className="h-4 w-4" aria-hidden /> Create password reset link</Button>
                  </>
                ) : r.inviteState === "invited" ? (
                  <>
                    <p className="text-sm text-slate-600">Invitation sent. It expires on <span className="font-medium text-slate-900">{formatDate(r.invitation.expiresAt)}</span>.</p>
                    <Button variant="secondary" className="w-full" loading={invite.isPending} onClick={() => invite.mutate()} disabled={r.status !== "active"}><Link2 className="h-4 w-4" aria-hidden /> Create a new link</Button>
                    <Button variant="dangerOutline" className="w-full" loading={revoke.isPending} onClick={() => revoke.mutate()}><X className="h-4 w-4" aria-hidden /> Revoke invitation</Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-600">This retailer cannot order online yet. Send them a private invitation link.</p>
                    <Button className="w-full" loading={invite.isPending} onClick={() => invite.mutate()} disabled={r.status !== "active"}><Send className="h-4 w-4" aria-hidden /> Invite retailer</Button>
                  </>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Account status" />
              <div className="space-y-3 p-4 sm:p-5">
                <p className="text-sm text-slate-600">{r.status === "active" ? "Active — can sign in and place orders." : "Inactive — cannot sign in or place orders."}</p>
                {r.status === "active" ? (
                  <Button variant="dangerOutline" className="w-full" onClick={() => setToggling(true)}>Deactivate retailer</Button>
                ) : (
                  <Button variant="secondary" className="w-full" loading={setStatus.isPending} onClick={() => setStatus.mutate("active")}>Activate retailer</Button>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "orders" && <RetailerOrders retailerId={id} />}

      {tab === "payments" && (
        ledger.isLoading ? <Card><ListSkeleton /></Card> : ledger.isError || !ledger.data ? <Card><ErrorState error={ledger.error} onRetry={() => ledger.refetch()} /></Card> : (
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Unpaid orders"
                description={t.outstandingPaise > 0 ? `${formatINR(t.outstandingPaise)} outstanding in total` : "Nothing outstanding"}
                action={t.outstandingPaise > 0 ? <WhatsAppLink size="sm" phone={r.phone} message={messages.paymentReminder(t.outstandingPaise, bizName)}>Send reminder</WhatsAppLink> : undefined}
              />
              {ledger.data.data.openOrders.length === 0 ? (
                <EmptyState compact icon={<Wallet />} title="All settled" description="This retailer has no unpaid orders." />
              ) : (
                <Table>
                  <thead><tr><Th>Order</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th className="text-right">Due</Th></tr></thead>
                  <tbody>
                    {ledger.data.data.openOrders.map((o: any) => (
                      <tr key={o.id}>
                        <Td><Link to={`/dashboard/orders/${o.id}`} className="font-medium text-brand-700 hover:underline">#{o.orderNumber}</Link></Td>
                        <Td className="text-slate-600">{formatDate(o.createdAt)}</Td>
                        <Td><OrderStatusBadge status={o.status} /></Td>
                        <Td className="text-right tabular">{formatINR(o.totalPaise)}</Td>
                        <Td className="text-right text-slate-600 tabular">{formatINR(o.amountPaidPaise)}</Td>
                        <Td className="text-right font-semibold text-red-700 tabular">{formatINR(o.outstandingPaise)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader title="Payment history" />
              {ledger.data.data.payments.length === 0 ? (
                <EmptyState compact icon={<Wallet />} title="No payments recorded" action={t.outstandingPaise > 0 ? <Button size="sm" onClick={() => setPaying(true)}>Record payment</Button> : undefined} />
              ) : (
                <PaymentRows rows={ledger.data.data.payments} onReverse={setReversing} />
              )}
            </Card>
          </div>
        )
      )}

      {tab === "prices" && <PriceList retailerId={id} />}

      <RetailerFormDialog open={editing} onClose={() => setEditing(false)} retailer={r} />
      <RecordPaymentDialog open={paying} onClose={() => setPaying(false)} retailer={{ id: r.id, name: r.businessName, phone: r.phone }} />
      <ReversePaymentDialog payment={reversing} onClose={() => setReversing(null)} />
      <ConfirmDialog open={toggling} onOpenChange={setToggling} title={`Deactivate ${r.businessName}?`} description="They will be signed out immediately and will not be able to sign in or place orders until you activate them again. Their orders and payment history are kept." confirmLabel="Deactivate" loading={setStatus.isPending} onConfirm={() => setStatus.mutate("inactive")} />
      {share && (
        <ShareLinkDialog
          open
          onOpenChange={(o) => { if (!o) { setShare(null); toast.dismiss(); } }}
          title={share.kind === "invite" ? "Invitation link ready" : "Password reset link ready"}
          description={share.kind === "invite" ? `Send this private link to ${r.contactPerson}. It works once and expires in 7 days.` : `Send this link to ${r.contactPerson}. It works once and expires in 60 minutes.`}
          link={share.link}
          phone={r.phone}
          message={share.kind === "invite" ? messages.invitation(r.contactPerson, bizName, share.link) : messages.passwordReset(share.link)}
        />
      )}
      <span className="sr-only" aria-live="polite">{invite.isError ? errorMessage(invite.error) : ""}</span>
    </div>
  );
}
