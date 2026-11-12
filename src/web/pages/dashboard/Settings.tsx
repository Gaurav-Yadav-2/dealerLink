import { Copy, ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { INDIAN_STATES } from "@shared/constants";
import { ChangePasswordCard, copyText } from "@/components/shared";
import { PushAlertsCard, PUSH_TEXT_EN_OWNER } from "@/components/PushAlerts";
import { InstallAppCard, INSTALL_TEXT_EN } from "@/components/InstallApp";
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Textarea, Toggle } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, titleCase } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { applyServerErrors } from "../public/Public";

export default function Settings() {
  const { session, refresh } = useAuth();
  const biz = session!.business!;
  const { register, handleSubmit, reset, watch, setValue, setError, formState } = useForm<any>();
  const errors = formState.errors as Record<string, { message?: string }>;
  useEffect(() => {
    reset({
      name: biz.name, phone: biz.phone ?? "", email: biz.email ?? "", address: biz.address ?? "", city: biz.city ?? "", state: biz.state ?? "", gstin: biz.gstin ?? "",
      about: biz.about ?? "", trackInventory: !!biz.trackInventory, lowStockThreshold: biz.lowStockThreshold, gstEnabled: !!biz.gstEnabled, orderPrefix: biz.orderPrefix,
    });
  }, [biz, reset]);
  const save = useAction((v: any) => api.patch("/biz/settings", { ...v, lowStockThreshold: Number(v.lowStockThreshold) || 0 }), {
    success: "Settings saved",
    silentError: true,
    onSuccess: () => refresh(),
  });
  const audit = useApi<any[]>("/biz/audit-log");
  const storeUrl = `${window.location.origin}/store/${biz.slug}`;

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Settings" description="Your business profile and how your store behaves." />
      <form noValidate onSubmit={handleSubmit((v) => save.mutate(v, { onError: (e) => { applyServerErrors(e, setError); toast.error(errorMessage(e)); } }))} className="space-y-4">
        <Card>
          <CardHeader title="Business profile" description="Shown to your retailers and on order PDFs." />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <Field label="Business name" error={errors.name?.message} required className="sm:col-span-2"><Input {...register("name", { required: "Enter your business name", minLength: { value: 3, message: "At least 3 characters" } })} /></Field>
            <Field label="Phone" error={errors.phone?.message} hint="Retailers contact you on this number"><Input type="tel" inputMode="numeric" {...register("phone")} /></Field>
            <Field label="Email" error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
            <Field label="Address" error={errors.address?.message} className="sm:col-span-2"><Textarea rows={2} {...register("address")} /></Field>
            <Field label="City" error={errors.city?.message}><Input {...register("city")} /></Field>
            <Field label="State" error={errors.state?.message}>
              <Select {...register("state")}><option value="">Select state</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
            </Field>
            <Field label="GSTIN" error={errors.gstin?.message} hint="Optional"><Input {...register("gstin")} className="uppercase" maxLength={15} /></Field>
            <Field label="Order number prefix" error={errors.orderPrefix?.message} hint="1–5 letters, e.g. DL → DL1024"><Input {...register("orderPrefix", { pattern: { value: /^[A-Za-z]{1,5}$/, message: "Use 1–5 letters" } })} className="uppercase" maxLength={5} /></Field>
            <Field label="About your business" error={errors.about?.message} hint="Shown on your public store page" className="sm:col-span-2"><Textarea rows={2} maxLength={500} {...register("about")} /></Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Inventory" />
          <div className="space-y-4 p-4 sm:p-5">
            <Toggle
              checked={!!watch("trackInventory")}
              onChange={(v) => setValue("trackInventory", v, { shouldDirty: true })}
              label="Track stock quantities automatically"
              description="When on, stock is reduced as orders are placed and retailers cannot order more than you have. Turn this off if you don’t keep exact counts — you can still mark products as in stock, low or out of stock by hand."
            />
            {watch("trackInventory") && (
              <Field label="Low-stock warning level" hint="Products at or below this quantity show as “Low stock”" className="max-w-xs">
                <Input inputMode="numeric" {...register("lowStockThreshold", { pattern: { value: /^\d+$/, message: "Enter a whole number" } })} />
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="GST" />
          <div className="p-4 sm:p-5">
            <Toggle
              checked={!!watch("gstEnabled")}
              onChange={(v) => setValue("gstEnabled", v, { shouldDirty: true })}
              label="Add GST to orders"
              description="When on, each product’s GST rate is added on top of its price at checkout and shown on orders and PDFs. Product prices are treated as exclusive of GST. Order PDFs are order summaries, not statutory tax invoices."
            />
          </div>
        </Card>

        <div className="sticky bottom-3 z-10 flex justify-end">
          <Button type="submit" size="lg" loading={save.isPending} disabled={!formState.isDirty} className="shadow-pop">Save settings</Button>
        </div>
      </form>

      <Card>
        <CardHeader title="Your store link" description="A public page with your business name only. Products and prices stay private to invited retailers." />
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:p-5">
          <p className="min-w-0 flex-1 truncate rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-slate-700">{storeUrl}</p>
          <Button variant="secondary" onClick={() => copyText(storeUrl)}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
          <a href={storeUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"><ExternalLink className="h-4 w-4" aria-hidden /> Open</a>
        </div>
      </Card>

      <InstallAppCard text={INSTALL_TEXT_EN} />

      <PushAlertsCard text={PUSH_TEXT_EN_OWNER} />

      <ChangePasswordCard />

      <Card>
        <CardHeader title="Recent activity" description="A record of important changes in your account (last 50)." />
        {!audit.data?.data.length ? <EmptyState compact title="No activity yet" /> : (
          <ul className="max-h-80 divide-y divide-line/70 overflow-y-auto">
            {audit.data.data.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5">
                <span className="min-w-0 truncate text-slate-700"><span className="font-medium text-slate-900">{titleCase(a.action)}</span>{a.actorName && <> · {a.actorName}</>}</span>
                <span className="shrink-0 text-xs text-slate-500">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
