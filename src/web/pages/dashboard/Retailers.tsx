import { Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { INDIAN_STATES } from "@shared/constants";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, ModalFooter, PageHeader, Pagination, SearchInput, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { useAction, useApi, useUrlFilters } from "@/lib/hooks";
import { applyServerErrors } from "../public/Public";

export const InviteBadge = ({ state }: { state: string }) =>
  state === "registered" ? <Badge tone="success">Registered</Badge> : state === "invited" ? <Badge tone="info">Invite sent</Badge> : <Badge>Not invited</Badge>;

export function RetailerFormDialog({ open, onClose, retailer, onSaved }: { open: boolean; onClose: () => void; retailer?: any | null; onSaved?: (r: any) => void }) {
  const { register, handleSubmit, reset, setError, formState } = useForm<any>();
  const errors = formState.errors as Record<string, { message?: string }>;
  useEffect(() => {
    if (open) {
      reset({
        businessName: retailer?.businessName ?? "", contactPerson: retailer?.contactPerson ?? "", phone: retailer?.phone ?? "", email: retailer?.email ?? "",
        address: retailer?.address ?? "", city: retailer?.city ?? "", state: retailer?.state ?? "", gstin: retailer?.gstin ?? "",
      });
    }
  }, [open, retailer, reset]);
  const save = useAction((body: any) => (retailer ? api.patch(`/biz/retailers/${retailer.id}`, body) : api.post("/biz/retailers", body)), {
    success: retailer ? "Retailer updated" : "Retailer added",
    silentError: true,
    onSuccess: (d) => {
      onClose();
      onSaved?.(d);
    },
  });
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={retailer ? "Edit retailer" : "Add retailer"} description={retailer ? undefined : "After adding, you can send them an invitation link to start ordering."} size="md">
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={handleSubmit((v) => save.mutate(v, { onError: (e) => { applyServerErrors(e, setError); toast.error(errorMessage(e)); } }))}
      >
        <Field label="Shop / business name" error={errors.businessName?.message} required className="sm:col-span-2">
          <Input autoFocus {...register("businessName", { required: "Enter the shop name", minLength: { value: 2, message: "Enter the shop name" } })} placeholder="e.g. Gupta General Store" />
        </Field>
        <Field label="Contact person" error={errors.contactPerson?.message} required>
          <Input {...register("contactPerson", { required: "Enter a contact person", minLength: { value: 2, message: "Enter a contact person" } })} />
        </Field>
        <Field label="Mobile number" error={errors.phone?.message} hint="Used for WhatsApp messages" required>
          <Input type="tel" inputMode="numeric" {...register("phone", { required: "Enter a mobile number", validate: (v) => /^(\+?91)?[6-9]\d{9}$/.test(String(v).replace(/[\s-]/g, "")) || "Enter a valid 10-digit mobile number" })} placeholder="98765 43210" />
        </Field>
        <Field label="Email" error={errors.email?.message} hint="Optional"><Input type="email" inputMode="email" {...register("email")} /></Field>
        <Field label="GSTIN" error={errors.gstin?.message} hint="Optional"><Input {...register("gstin")} className="uppercase" maxLength={15} /></Field>
        <Field label="Address" error={errors.address?.message} className="sm:col-span-2"><Textarea rows={2} {...register("address")} /></Field>
        <Field label="City" error={errors.city?.message}><Input {...register("city")} /></Field>
        <Field label="State" error={errors.state?.message}>
          <Select {...register("state")}>
            <option value="">Select state</option>
            {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{retailer ? "Save changes" : "Add retailer"}</Button>
          </ModalFooter>
        </div>
      </form>
    </Modal>
  );
}

export default function Retailers() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { values: f, page, set } = useUrlFilters({ q: "", status: "" });
  const q = useApi<any[]>("/biz/retailers", { ...f, page });
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (sp.get("new") === "1") {
      setAdding(true);
      setSp((p) => { const n = new URLSearchParams(p); n.delete("new"); return n; }, { replace: true });
    }
  }, [sp, setSp]);
  const rows = q.data?.data ?? [];
  return (
    <div>
      <PageHeader title="Retailers" description="The shops that buy from you. Each retailer gets a private login and their own price list." actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add retailer</Button>} />
      <Card>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto] sm:p-4">
          <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Search name, contact, phone or city" />
          <Select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All retailers</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
          f.q || f.status ? (
            <EmptyState icon={<Users />} title="No retailers match" action={<Button variant="secondary" size="sm" onClick={() => set({ q: "", status: "" })}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<Users />} title="Add your first retailer" description="Add the shops you supply, then invite them with a private link so they can order online." action={<Button onClick={() => setAdding(true)}>Add retailer</Button>} />
          )
        ) : (
          <Table>
            <thead>
              <tr><Th>Retailer</Th><Th>Contact</Th><Th>Access</Th><Th className="text-right">Orders</Th><Th className="text-right">Total purchases</Th><Th className="text-right">Outstanding</Th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => navigate(`/dashboard/retailers/${r.id}`)}>
                  <Td>
                    <Link to={`/dashboard/retailers/${r.id}`} className="block max-w-[16rem] truncate font-medium text-slate-900 hover:text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.businessName}</Link>
                    <span className="text-xs text-slate-500">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</span>
                  </Td>
                  <Td>
                    <span className="block text-slate-700">{r.contactPerson}</span>
                    <span className="text-xs text-slate-500 tabular">{r.phone}</span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <InviteBadge state={r.inviteState} />
                      {r.status === "inactive" && <Badge tone="danger">Inactive</Badge>}
                    </div>
                  </Td>
                  <Td className="text-right text-slate-600 tabular">{r.orderCount}</Td>
                  <Td className="text-right tabular">{formatINR(r.totalPurchasesPaise)}</Td>
                  <Td className={`text-right font-medium tabular ${r.outstandingPaise > 0 ? "text-red-700" : "text-slate-500"}`}>{formatINR(r.outstandingPaise)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={q.data?.meta} onPage={(p) => set({ page: p } as any)} />
      </Card>
      <RetailerFormDialog open={adding} onClose={() => setAdding(false)} onSaved={(r) => navigate(`/dashboard/retailers/${r.id}?invite=1`)} />
    </div>
  );
}
