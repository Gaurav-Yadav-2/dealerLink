import { Archive, Camera, Download, FileUp, ImageOff, ImagePlus, Loader2, MoreHorizontal, Package, Pencil, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AVAILABILITIES, AVAILABILITY_LABELS, GST_RATES_BP, UNITS } from "@shared/constants";
import { AvailabilityBadge } from "@/components/shared";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, ModalFooter, PageHeader, Pagination, SearchInput, Select, Table, Td, Textarea, Th, Toggle } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { downloadCsv, parseCsv, PRODUCT_CSV_HEADERS, toCsv } from "@/lib/csv";
import { formatGstRate, formatINR, paiseToRupeesString, rupeesToPaise } from "@/lib/format";
import { useAction, useApi, useUrlFilters } from "@/lib/hooks";
import { applyServerErrors } from "../public/Public";
import { prepareProductPhoto } from "@/lib/image";

export function ProductThumb({ url, name, className = "h-10 w-10" }: { url?: string | null; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]); // a new photo gets a fresh chance to load
  if (!url || broken) {
    return (
      <span className={`grid shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400 ${className}`} aria-hidden>
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  return <img src={url} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`shrink-0 rounded-lg bg-slate-100 object-cover ${className}`} />;
}

/**
 * Product photo: take one with the camera, pick one from the phone / computer, drag one in, or paste a link.
 * Photos are resized and compressed in the browser, then uploaded straight away.
 */
function ProductPhotoField({ value, onChange, error, productName }: { value: string; onChange: (url: string) => void; error?: string; productName: string }) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showLink, setShowLink] = useState(() => !!value && !value.startsWith("/api/images/"));
  const [dragging, setDragging] = useState(false);
  const hasCamera = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const photo = await prepareProductPhoto(file);
      const res = await api.upload<{ url: string }>("/biz/images", photo);
      onChange(res.data.url);
      setShowLink(false);
      toast.success("Photo added");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    void upload(e.target.files?.[0]);
    e.target.value = ""; // allow choosing the same file again
  };

  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Product photo</span>
      <div
        className={`flex flex-col gap-3 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center ${dragging ? "border-brand-500 bg-brand-50" : "border-line"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="relative shrink-0">
          <ProductThumb url={value || null} name={productName || "Product photo"} className="h-24 w-24" />
          {busy && (
            <span className="absolute inset-0 grid place-items-center rounded-lg bg-white/70" role="status" aria-label="Uploading photo">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            {hasCamera && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => cameraInput.current?.click()}>
                <Camera className="h-4 w-4" aria-hidden /> Take photo
              </Button>
            )}
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
              <ImagePlus className="h-4 w-4" aria-hidden /> {hasCamera ? "Choose from gallery" : "Upload photo"}
            </Button>
            {value && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onChange("")}>
                <Trash2 className="h-4 w-4 text-red-600" aria-hidden /> Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">{hasCamera ? "Use your camera or a photo from your gallery." : "Click to choose a photo, or drag one here."} JPG, PNG or WebP — it is resized automatically.</p>
          {showLink ? (
            <Input type="url" inputMode="url" aria-label="Image link" value={value.startsWith("/api/images/") ? "" : value} onChange={(e) => onChange(e.target.value)} placeholder="https://… (link to a photo)" />
          ) : (
            <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setShowLink(true)}>Use an image link instead</button>
          )}
          {error && <span role="alert" className="block text-xs text-red-600">{error}</span>}
        </div>
        {/* capture="environment" opens the back camera directly on phones */}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={pick} />
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={pick} />
      </div>
    </div>
  );
}

type FormValues = {
  name: string; sku: string; description: string; categoryId: string; unit: string; price: string; mrp: string; gstRateBp: string;
  minOrderQty: string; stockQty: string; availability: string; imageUrl: string; isActive: boolean;
};

function ProductForm({ product, onClose }: { product: any | null; onClose: () => void }) {
  const { session } = useAuth();
  const tracking = !!session?.business?.trackInventory;
  const gst = !!session?.business?.gstEnabled;
  const categories = useApi<any[]>("/biz/categories");
  const { register, handleSubmit, setError, setValue, watch, formState } = useForm<FormValues>({
    defaultValues: {
      name: product?.name ?? "", sku: product?.sku ?? "", description: product?.description ?? "", categoryId: product?.categoryId ?? "",
      unit: product?.unit ?? "piece", price: paiseToRupeesString(product?.pricePaise), mrp: paiseToRupeesString(product?.mrpPaise),
      gstRateBp: String(product?.gstRateBp ?? 0), minOrderQty: String(product?.minOrderQty ?? 1), stockQty: product?.stockQty != null ? String(product.stockQty) : "",
      availability: product?.availability ?? "in_stock", imageUrl: product?.imageUrl ?? "", isActive: product ? !!product.isActive : true,
    },
  });
  const errors = formState.errors;
  const save = useAction(
    (body: any) => (product ? api.patch(`/biz/products/${product.id}`, body) : api.post("/biz/products", body)),
    { success: product ? "Product updated" : "Product added", onSuccess: onClose, silentError: true },
  );
  const onSubmit = handleSubmit((v) => {
    const pricePaise = rupeesToPaise(v.price);
    const mrpPaise = v.mrp.trim() ? rupeesToPaise(v.mrp) : null;
    if (pricePaise == null) return setError("price", { message: "Enter a valid price, e.g. 80 or 79.50" });
    if (v.mrp.trim() && mrpPaise == null) return setError("mrp", { message: "Enter a valid MRP" });
    if (v.stockQty.trim() && !/^\d+$/.test(v.stockQty.trim())) return setError("stockQty", { message: "Enter a whole number" });
    save.mutate(
      {
        name: v.name, sku: v.sku, description: v.description, categoryId: v.categoryId || null, unit: v.unit, pricePaise, mrpPaise,
        gstRateBp: Number(v.gstRateBp), minOrderQty: Number(v.minOrderQty) || 1, stockQty: v.stockQty.trim() ? Number(v.stockQty) : null,
        availability: v.availability, imageUrl: v.imageUrl, isActive: v.isActive,
      },
      {
        onError: (e) => {
          const map: Record<string, keyof FormValues> = { pricePaise: "price", mrpPaise: "mrp" };
          if (!applyServerErrors(e, (path: any, err: any) => setError((map[path] ?? path) as any, err))) toast.error(errorMessage(e));
          else toast.error(errorMessage(e));
        },
      },
    );
  });
  const stockQty = watch("stockQty");
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Product name" error={errors.name?.message} required className="sm:col-span-2">
        <Input autoFocus {...register("name", { required: "Enter a product name" })} placeholder="e.g. LED Bulb 12W" />
      </Field>
      <Field label="SKU / product code" error={errors.sku?.message} required>
        <Input {...register("sku", { required: "Enter a SKU" })} placeholder="e.g. LED-12W" />
      </Field>
      <Field label="Category" error={errors.categoryId?.message}>
        <Select {...register("categoryId")}>
          <option value="">Uncategorised</option>
          {categories.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Wholesale price (₹)" error={errors.price?.message} hint={gst ? "Excluding GST" : undefined} required>
        <Input inputMode="decimal" {...register("price", { required: "Enter a price" })} placeholder="0.00" />
      </Field>
      <Field label="MRP (₹)" error={errors.mrp?.message} hint="Optional">
        <Input inputMode="decimal" {...register("mrp")} placeholder="0.00" />
      </Field>
      <Field label="Unit" error={errors.unit?.message}>
        <Select {...register("unit")}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select>
      </Field>
      <Field label="Minimum order quantity" error={errors.minOrderQty?.message}>
        <Input inputMode="numeric" {...register("minOrderQty", { pattern: { value: /^[1-9]\d*$/, message: "Enter a whole number of 1 or more" } })} />
      </Field>
      <Field label="GST rate" hint={gst ? undefined : "Applied only when GST is enabled in Settings"}>
        <Select {...register("gstRateBp")}>{GST_RATES_BP.map((r) => <option key={r} value={r}>{formatGstRate(r)}</option>)}</Select>
      </Field>
      <Field label="Stock quantity" error={errors.stockQty?.message} hint={tracking ? "Leave blank if you don’t count this product" : "Inventory tracking is off in Settings"}>
        <Input inputMode="numeric" {...register("stockQty")} placeholder="Not tracked" />
      </Field>
      {(!tracking || !stockQty.trim()) && (
        <Field label="Availability" hint="Shown to retailers when stock is not counted" className="sm:col-span-2">
          <Select {...register("availability")}>{AVAILABILITIES.map((a) => <option key={a} value={a}>{AVAILABILITY_LABELS[a]}</option>)}</Select>
        </Field>
      )}
      <div className="sm:col-span-2">
        <ProductPhotoField
          value={watch("imageUrl")}
          onChange={(url) => setValue("imageUrl", url, { shouldDirty: true })}
          error={errors.imageUrl?.message}
          productName={watch("name")}
        />
      </div>
      <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
        <Textarea {...register("description")} placeholder="Optional details retailers should know" />
      </Field>
      <div className="sm:col-span-2">
        <Toggle checked={watch("isActive")} onChange={(v) => setValue("isActive", v)} label="Visible to retailers" description="Inactive products stay in your catalogue but cannot be ordered." />
      </div>
      <div className="sm:col-span-2">
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{product ? "Save changes" : "Add product"}</Button>
        </ModalFooter>
      </div>
    </form>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<any>(null);
  const validate = useAction((r: Record<string, string>[]) => api.post("/biz/products/import", { rows: r, commit: false }), { onSuccess: setResult });
  const commit = useAction(() => api.post("/biz/products/import", { rows, commit: true }), {
    success: (d: any) => (d.committed ? `${d.total} products imported` : null),
    onSuccess: (d: any) => (d.committed ? onClose() : setResult(d)),
  });
  const template = () => downloadCsv("dealerlink-products-template.csv", [PRODUCT_CSV_HEADERS.join(","), "LED Bulb 12W,LED-12W,Cool daylight B22,Lighting,piece,80,120,12,10,500,,,yes"].join("\r\n"));
  const onFile = async (file: File) => {
    setResult(null);
    setFileName(file.name);
    if (file.size > 2_000_000) return toast.error("File is too large. Import at most 500 products at a time.");
    const parsed = parseCsv(await file.text());
    if (!parsed.rows.length) return toast.error("That file has no product rows.");
    const missing = ["name", "sku", "price"].filter((h) => !parsed.headers.includes(h));
    if (missing.length) return toast.error(`Missing required column(s): ${missing.join(", ")}. Download the template to see the format.`);
    if (parsed.rows.length > 500) return toast.error(`The file has ${parsed.rows.length} rows. Import at most 500 at a time.`);
    setRows(parsed.rows);
    validate.mutate(parsed.rows);
  };
  const ok = result && result.errors.length === 0;
  return (
    <div>
      <ol className="space-y-1 text-sm text-slate-600">
        <li>1. Download the template and fill it in Excel or Google Sheets.</li>
        <li>2. Save / export it as <span className="font-medium">CSV</span> and upload it here.</li>
        <li>3. We check every row first. Nothing is imported unless the whole file is valid.</li>
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={template}><Download className="h-4 w-4" aria-hidden /> Download template</Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={validate.isPending}><FileUp className="h-4 w-4" aria-hidden /> Choose CSV file</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </div>
      {result && (
        <div className="mt-4" aria-live="polite">
          <p className="text-sm font-medium text-slate-900">{fileName}: {result.total} rows · <span className="text-emerald-700">{result.validCount} valid</span>{result.errors.length > 0 && <> · <span className="text-red-700">{result.errors.length} with problems</span></>}</p>
          {result.errors.length > 0 ? (
            <>
              <p className="mt-1 text-[13px] text-slate-500">Fix these rows in your file and upload it again. Row numbers match your spreadsheet.</p>
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3">
                {result.errors.map((e: any) => (
                  <li key={e.row} className="text-[13px] text-red-800">
                    <span className="font-semibold">Row {e.row}{e.sku ? ` (${e.sku})` : ""}:</span> {e.messages.join("; ")}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">All rows are valid. New categories will be created automatically.</p>
          )}
        </div>
      )}
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!ok} loading={commit.isPending} onClick={() => commit.mutate()}><Upload className="h-4 w-4" aria-hidden /> Import {ok ? `${result.validCount} products` : ""}</Button>
      </ModalFooter>
    </div>
  );
}

export default function Products() {
  const { session } = useAuth();
  const [sp, setSp] = useSearchParams();
  const { values: f, page, set } = useUrlFilters({ q: "", categoryId: "", status: "current", sort: "name" });
  const q = useApi<any[]>("/biz/products", { ...f, page });
  const categories = useApi<any[]>("/biz/categories");
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [archiving, setArchiving] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (sp.get("new") === "1") {
      setEditing("new");
      setSp((p) => { const n = new URLSearchParams(p); n.delete("new"); return n; }, { replace: true });
    }
  }, [sp, setSp]);

  const archive = useAction((id: string) => api.del(`/biz/products/${id}`), { success: "Product archived", onSuccess: () => setArchiving(null) });
  const restore = useAction((id: string) => api.post(`/biz/products/${id}/restore`), { success: "Product restored" });
  const toggle = useAction((p: any) => api.patch(`/biz/products/${p.id}`, { isActive: !p.isActive }), { success: (_d, p: any) => (p.isActive ? "Hidden from retailers" : "Visible to retailers") });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { data } = await api.get<any[]>("/biz/products/export");
      if (!data.length) return void toast.info("There are no products to export yet.");
      downloadCsv(
        `${session?.business?.slug ?? "dealerlink"}-products.csv`,
        toCsv(data, [
          { header: "name", value: (p) => p.name }, { header: "sku", value: (p) => p.sku }, { header: "description", value: (p) => p.description },
          { header: "category", value: (p) => p.categoryName }, { header: "unit", value: (p) => p.unit }, { header: "price", value: (p) => paiseToRupeesString(p.pricePaise) },
          { header: "mrp", value: (p) => paiseToRupeesString(p.mrpPaise) }, { header: "gst_rate", value: (p) => p.gstRateBp / 100 }, { header: "min_order_qty", value: (p) => p.minOrderQty },
          { header: "stock_qty", value: (p) => p.stockQty }, { header: "availability", value: (p) => p.availability }, { header: "image_url", value: (p) => p.imageUrl },
          { header: "active", value: (p) => (p.isActive ? "yes" : "no") },
        ]),
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const rows = q.data?.data ?? [];
  const filtered = !!(f.q || f.categoryId || f.status !== "current");

  return (
    <div>
      <PageHeader
        title="Products"
        description="Your wholesale catalogue. Prices here are the standard prices; set special prices per retailer from the retailer’s page."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} loading={exporting}><Download className="h-4 w-4" aria-hidden /> Export</Button>
            <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" aria-hidden /> Import CSV</Button>
            <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden /> Add product</Button>
          </>
        }
      />
      <Card>
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:p-4">
          <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Search by name or SKU" />
          <Select aria-label="Category" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">All categories</option>
            <option value="none">Uncategorised</option>
            {categories.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="current">Active &amp; inactive</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="archived">Archived</option>
          </Select>
          <Select aria-label="Sort by" value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="name">Name A–Z</option>
            <option value="-name">Name Z–A</option>
            <option value="price">Price: low to high</option>
            <option value="-price">Price: high to low</option>
            <option value="newest">Newest first</option>
            <option value="stock">Lowest stock first</option>
          </Select>
        </div>
        {q.isLoading ? (
          <ListSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={<Package />} title="No products match" description="Try a different search or clear the filters." action={<Button variant="secondary" size="sm" onClick={() => set({ q: "", categoryId: "", status: "current" })}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<Package />} title="Add your first product" description="Add products one at a time, or upload your existing price list as a CSV file." action={<div className="flex gap-2"><Button variant="secondary" onClick={() => setImporting(true)}>Import CSV</Button><Button onClick={() => setEditing("new")}>Add product</Button></div>} />
          )
        ) : (
          <Table>
            <thead>
              <tr><Th>Product</Th><Th>Category</Th><Th className="text-right">Price</Th><Th className="text-right">Min qty</Th><Th>Stock</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <Td>
                    <div className="flex items-center gap-3">
                      <ProductThumb url={p.imageUrl} name={p.name} />
                      <div className="min-w-0">
                        <button type="button" className="block max-w-[16rem] truncate text-left text-sm font-medium text-slate-900 hover:text-brand-700 hover:underline" onClick={() => !p.archivedAt && setEditing(p)}>{p.name}</button>
                        <span className="text-xs text-slate-500">{p.sku} · per {p.unit}</span>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-slate-600">{p.categoryName ?? <span className="text-slate-400">—</span>}</Td>
                  <Td className="text-right">
                    <span className="font-medium text-slate-900 tabular">{formatINR(p.pricePaise)}</span>
                    {p.mrpPaise != null && <span className="block text-xs text-slate-500 tabular">MRP {formatINR(p.mrpPaise)}</span>}
                  </Td>
                  <Td className="text-right text-slate-600 tabular">{p.minOrderQty}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <AvailabilityBadge status={p.availabilityStatus} />
                      {p.stockQty != null && !!session?.business?.trackInventory && <span className="text-xs text-slate-500 tabular">{p.stockQty}</span>}
                    </div>
                  </Td>
                  <Td>{p.archivedAt ? <Badge>Archived</Badge> : p.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                  <Td className="text-right">
                    {p.archivedAt ? (
                      <Button variant="secondary" size="sm" onClick={() => restore.mutate(p.id)}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore</Button>
                    ) : (
                      <Dropdown.Root>
                        <Dropdown.Trigger className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`Actions for ${p.name}`}><MoreHorizontal className="h-4 w-4" /></Dropdown.Trigger>
                        <Dropdown.Portal>
                          <Dropdown.Content align="end" className="dl-pop z-50 w-44 rounded-xl border border-line bg-white p-1 shadow-pop">
                            <Dropdown.Item onSelect={() => setEditing(p)} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-slate-100"><Pencil className="h-4 w-4" aria-hidden /> Edit</Dropdown.Item>
                            <Dropdown.Item onSelect={() => toggle.mutate(p)} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-slate-100">{p.isActive ? "Hide from retailers" : "Show to retailers"}</Dropdown.Item>
                            <Dropdown.Item onSelect={() => setArchiving(p)} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 outline-none data-[highlighted]:bg-red-50"><Archive className="h-4 w-4" aria-hidden /> Archive</Dropdown.Item>
                          </Dropdown.Content>
                        </Dropdown.Portal>
                      </Dropdown.Root>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={q.data?.meta} onPage={(p) => set({ page: p } as any)} />
      </Card>

      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "Add product" : "Edit product"} size="lg">
        {editing && <ProductForm product={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal open={importing} onOpenChange={setImporting} title="Import products from CSV" size="md">
        {importing && <ImportDialog onClose={() => setImporting(false)} />}
      </Modal>
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name}?`}
        description="Retailers will no longer see or be able to order this product. Past orders are not affected, and you can restore it later from the Archived filter."
        confirmLabel="Archive product"
        loading={archive.isPending}
        onConfirm={() => archive.mutate(archiving.id)}
      />
    </div>
  );
}
