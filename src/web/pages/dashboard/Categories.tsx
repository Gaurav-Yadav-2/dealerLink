import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, ListSkeleton, Modal, ModalFooter, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";

export default function Categories() {
  const q = useApi<any[]>("/biz/categories");
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<any | null>(null);

  const save = useAction(
    () => (editing === "new" ? api.post("/biz/categories", { name }) : api.patch(`/biz/categories/${editing.id}`, { name })),
    { success: () => (editing === "new" ? "Category added" : "Category renamed"), onSuccess: () => setEditing(null) },
  );
  const remove = useAction((id: string) => api.del(`/biz/categories/${id}`), { success: "Category deleted", onSuccess: () => setDeleting(null) });
  const open = (c: any | "new") => {
    setName(c === "new" ? "" : c.name);
    setEditing(c);
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Categories" description="Group products so retailers can browse your catalogue quickly." actions={<Button onClick={() => open("new")}><Plus className="h-4 w-4" aria-hidden /> Add category</Button>} />
      <Card>
        {q.isLoading ? (
          <ListSkeleton rows={4} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.data.length ? (
          <EmptyState icon={<Tags />} title="No categories yet" description="Create categories such as “Lighting” or “Switches”, then assign products to them." action={<Button onClick={() => open("new")}>Add category</Button>} />
        ) : (
          <ul className="divide-y divide-line/70">
            {q.data.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{c.name}</p>
                  <Link to={`/dashboard/products?categoryId=${c.id}`} className="text-xs text-slate-500 hover:text-brand-700 hover:underline">
                    {c.productCount} {c.productCount === 1 ? "product" : "products"}
                  </Link>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Rename ${c.name}`} onClick={() => open(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "Add category" : "Rename category"} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
          <Field label="Category name" required>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Lighting" />
          </Field>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" loading={save.isPending} disabled={!name.trim()}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description={deleting?.productCount ? `${deleting.productCount} product(s) in this category will become uncategorised. The products themselves are not deleted.` : "This category has no products."}
        confirmLabel="Delete category"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(deleting.id)}
      />
    </div>
  );
}
