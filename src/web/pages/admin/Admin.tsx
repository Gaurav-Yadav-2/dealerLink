import { Activity, Building2, CheckCircle2, ClipboardList, KeyRound, Package, ShieldAlert, Users } from "lucide-react";
import { useState } from "react";
import { ShareLinkDialog } from "@/components/shared";
import { BarSeries } from "@/components/charts";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, ModalFooter, PageHeader, Pagination, SearchInput, Select, Skeleton, Stat, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatDayShort, formatINR, timeAgo, titleCase } from "@/lib/format";
import { useAction, useApi, useUrlFilters } from "@/lib/hooks";
import { messages } from "@/lib/whatsapp";

const StatusBadge = ({ status }: { status: string }) => (status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>);

/** Suspend / activate with a recorded reason. Used for both businesses and users. */
function StatusDialog({ target, kind, onClose }: { target: any | null; kind: "businesses" | "users"; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const suspending = target?.status === "active";
  const act = useAction(() => api.post(`/admin/${kind}/${target.id}/status`, { status: suspending ? "suspended" : "active", reason }), {
    success: () => (suspending ? "Account suspended" : "Account reactivated"),
    onSuccess: () => { setReason(""); onClose(); },
  });
  return (
    <Modal open={!!target} onOpenChange={(o) => !o && onClose()} size="sm" title={`${suspending ? "Suspend" : "Reactivate"} ${target?.name ?? ""}?`}
      description={suspending ? (kind === "businesses" ? "The owner and all of this business's retailers will be locked out immediately. No data is deleted." : "This user will be signed out and unable to sign in. No data is deleted.") : "Access will be restored immediately."}>
      {suspending && <Field label="Reason (kept in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Abuse report, spam listings" autoFocus /></Field>}
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={suspending ? "danger" : "primary"} loading={act.isPending} onClick={() => act.mutate()}>{suspending ? "Suspend" : "Reactivate"}</Button>
      </ModalFooter>
    </Modal>
  );
}

export function AdminOverview() {
  const q = useApi<any>("/admin/stats", undefined, { refetchInterval: 60_000 });
  const audit = useApi<any[]>("/admin/audit");
  if (q.isLoading) return <div><PageHeader title="Platform overview" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div></div>;
  if (q.isError || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const { counts: c, health, recentBusinesses, signups } = q.data.data;
  return (
    <div>
      <PageHeader title="Platform overview" description="Usage across all businesses on DealerLink. Tenant business data is not shown here." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Businesses" value={c.businesses} icon={<Building2 />} hint={c.suspendedBusinesses ? `${c.suspendedBusinesses} suspended` : "All active"} />
        <Stat label="Wholesaler accounts" value={c.owners} icon={<Users />} />
        <Stat label="Retailer accounts" value={c.retailers} icon={<Users />} />
        <Stat label="Products listed" value={c.products} icon={<Package />} />
        <Stat label="Orders (all time)" value={c.orders} icon={<ClipboardList />} />
        <Stat label="Orders, last 30 days" value={c.orders30d} icon={<ClipboardList />} hint={`${formatINR(c.orderValue30dPaise)} order value`} />
        <Stat label="Active sessions" value={c.activeSessions} icon={<Activity />} />
        <Stat label="Suspended users" value={c.suspendedUsers} icon={<ShieldAlert />} tone={c.suspendedUsers ? "warning" : "brand"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Platform health" />
          <div className="space-y-3 p-4 sm:p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden /> API responding</p>
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden /> Database {health.database} · {health.queryMs} ms</p>
            <p className="text-xs text-slate-500">Checked {formatDateTime(health.checkedAt)}. Refreshes every minute.</p>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="New businesses" description="Registrations per day, last 30 days" />
          <div className="p-4">{signups.length ? <BarSeries name="Businesses" data={signups.map((s: any) => ({ label: formatDayShort(s.day), value: s.businesses }))} height={180} /> : <EmptyState compact title="No registrations in the last 30 days" />}</div>
        </Card>
        <Card className="lg:col-span-1">
          <CardHeader title="Latest registrations" />
          {recentBusinesses.length === 0 ? <EmptyState compact icon={<Building2 />} title="No businesses yet" /> : (
            <ul className="divide-y divide-line/70">
              {recentBusinesses.map((b: any) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-900">{b.name}</span><span className="text-xs text-slate-500">{b.ownerName} · {timeAgo(b.createdAt)}</span></span>
                  <StatusBadge status={b.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" description="Sensitive actions across the platform, for abuse review" />
          {!audit.data?.data.length ? <EmptyState compact title="No activity yet" /> : (
            <ul className="max-h-80 divide-y divide-line/70 overflow-y-auto">
              {audit.data.data.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5">
                  <span className="min-w-0 truncate text-slate-600"><span className="font-medium text-slate-900">{titleCase(a.action)}</span> · {a.actorName ?? "system"}{a.businessName && <> · {a.businessName}</>}</span>
                  <span className="shrink-0 text-xs text-slate-500">{timeAgo(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function AdminBusinesses() {
  const { values: f, page, set } = useUrlFilters({ q: "", status: "" });
  const q = useApi<any[]>("/admin/businesses", { ...f, page });
  const [target, setTarget] = useState<any | null>(null);
  const rows = q.data?.data ?? [];
  return (
    <div>
      <PageHeader title="Businesses" description="Every wholesaler registered on the platform." />
      <Card>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto] sm:p-4">
          <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Search business, owner name or email" />
          <Select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></Select>
        </div>
        {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? <EmptyState icon={<Building2 />} title={f.q || f.status ? "No businesses match" : "No businesses registered yet"} /> : (
          <Table>
            <thead><tr><Th>Business</Th><Th>Owner</Th><Th className="text-right">Retailers</Th><Th className="text-right">Products</Th><Th className="text-right">Orders</Th><Th>Last order</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <Td><span className="font-medium text-slate-900">{b.name}</span>{!!b.isDemo && <Badge tone="warning" className="ml-2">Demo</Badge>}<span className="block text-xs text-slate-500">{[b.city, b.state].filter(Boolean).join(", ") || "—"} · joined {formatDate(b.createdAt)}</span></Td>
                  <Td><span className="block text-slate-700">{b.ownerName}</span><span className="text-xs text-slate-500">{b.ownerEmail}</span></Td>
                  <Td className="text-right tabular">{b.retailerCount}</Td><Td className="text-right tabular">{b.productCount}</Td><Td className="text-right tabular">{b.orderCount}</Td>
                  <Td className="text-slate-600">{b.lastOrderAt ? timeAgo(b.lastOrderAt) : "—"}</Td>
                  <Td><StatusBadge status={b.status} />{b.suspensionReason && <span className="mt-0.5 block max-w-[12rem] truncate text-xs text-slate-500" title={b.suspensionReason}>{b.suspensionReason}</span>}</Td>
                  <Td className="text-right"><Button size="sm" variant={b.status === "active" ? "dangerOutline" : "secondary"} onClick={() => setTarget(b)}>{b.status === "active" ? "Suspend" : "Reactivate"}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={q.data?.meta} onPage={(p) => set({ page: p } as any)} />
      </Card>
      <StatusDialog target={target} kind="businesses" onClose={() => setTarget(null)} />
    </div>
  );
}

export function AdminUsers() {
  const { session } = useAuth();
  const { values: f, page, set } = useUrlFilters({ q: "", role: "", status: "" });
  const q = useApi<any[]>("/admin/users", { ...f, page });
  const [target, setTarget] = useState<any | null>(null);
  const [share, setShare] = useState<null | { user: any; link: string }>(null);
  const reset = useAction((u: any) => api.post(`/admin/users/${u.id}/reset-link`), { onSuccess: (d: any, u) => setShare({ user: u, link: `${window.location.origin}/reset-password?token=${d.token}` }) });
  const rows = q.data?.data ?? [];
  return (
    <div>
      <PageHeader title="Users" description="All accounts. Suspend abusive accounts or issue a password reset link." />
      <Card>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto_auto] sm:p-4">
          <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Search name or email" />
          <Select aria-label="Role" value={f.role} onChange={(e) => set({ role: e.target.value })}><option value="">All roles</option><option value="owner">Wholesalers</option><option value="retailer">Retailers</option><option value="admin">Admins</option></Select>
          <Select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></Select>
        </div>
        {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? <EmptyState icon={<Users />} title="No users match" /> : (
          <Table>
            <thead><tr><Th>User</Th><Th>Role</Th><Th>Business</Th><Th>Last sign-in</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <Td><span className="font-medium text-slate-900">{u.name}</span>{!!u.isDemo && <Badge tone="warning" className="ml-2">Demo</Badge>}<span className="block text-xs text-slate-500">{u.email}</span></Td>
                  <Td><Badge tone={u.role === "admin" ? "violet" : u.role === "owner" ? "brand" : "neutral"}>{u.role === "owner" ? "Wholesaler" : titleCase(u.role)}</Badge></Td>
                  <Td className="text-slate-600">{u.businessName ?? "—"}</Td>
                  <Td className="text-slate-600">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</Td>
                  <Td><StatusBadge status={u.status} /></Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {(u.role !== "admin" || u.id === session?.user.id) && <Button size="sm" variant="secondary" loading={reset.isPending && reset.variables?.id === u.id} onClick={() => reset.mutate(u)}><KeyRound className="h-3.5 w-3.5" aria-hidden /> Reset link</Button>}
                      {u.role !== "admin" && <Button size="sm" variant={u.status === "active" ? "dangerOutline" : "secondary"} onClick={() => setTarget(u)}>{u.status === "active" ? "Suspend" : "Reactivate"}</Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={q.data?.meta} onPage={(p) => set({ page: p } as any)} />
      </Card>
      <StatusDialog target={target} kind="users" onClose={() => setTarget(null)} />
      {share && <ShareLinkDialog open onOpenChange={(o) => !o && setShare(null)} title="Password reset link ready" description={`Send this to ${share.user.name}. It works once and expires in 60 minutes.`} link={share.link} phone={share.user.phone} message={messages.passwordReset(share.link)} />}
    </div>
  );
}
