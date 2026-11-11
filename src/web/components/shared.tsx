import { useQueryClient } from "@tanstack/react-query";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Bell, Check, CheckCheck, Copy, MessageCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AVAILABILITY_LABELS, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, type Availability, type OrderStatus, type PaymentStatus } from "@shared/constants";
import { api } from "@/lib/api";
import { formatDateTime, formatGstRate, formatINR, timeAgo } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { waLink } from "@/lib/whatsapp";
import { Badge, Button, buttonClass, Card, CardHeader, cn, EmptyState, Field, Input, Modal, ModalFooter, type Tone } from "./ui";

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", light ? "text-white" : "text-brand-900", className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" className={light ? "fill-white/10" : "fill-brand-800"} />
        <path d="M9 9h6.5a7 7 0 0 1 0 14H9z" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M19 23h5" stroke="#f5b83d" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <span className="text-[17px]">DealerLink</span>
    </span>
  );
}

// ── Status indicators (always text + colour, never colour alone) ──────

const ORDER_TONES: Record<OrderStatus, Tone> = {
  pending: "warning", accepted: "info", processing: "violet", ready_for_dispatch: "brand", dispatched: "brand", delivered: "success", rejected: "danger", cancelled: "neutral",
};
export const OrderStatusBadge = ({ status, label }: { status: OrderStatus; label?: string }) => (
  <Badge tone={ORDER_TONES[status] ?? "neutral"} dot>{label ?? ORDER_STATUS_LABELS[status] ?? status}</Badge>
);

const PAY_TONES: Record<PaymentStatus, Tone> = { unpaid: "danger", partial: "warning", paid: "success" };
export const PaymentStatusBadge = ({ status, label }: { status: PaymentStatus; label?: string }) => (
  <Badge tone={PAY_TONES[status] ?? "neutral"}>{label ?? PAYMENT_STATUS_LABELS[status] ?? status}</Badge>
);

const AVAIL_TONES: Record<Availability, Tone> = { in_stock: "success", low_stock: "warning", out_of_stock: "danger" };
export const AvailabilityBadge = ({ status, label }: { status: Availability; label?: string }) => (
  <Badge tone={AVAIL_TONES[status] ?? "neutral"}>{label ?? AVAILABILITY_LABELS[status] ?? status}</Badge>
);

// ── Orders ────────────────────────────────────────────────────────────

export function OrderTimeline({ history, statusLabel }: { history: any[]; statusLabel?: (s: OrderStatus) => string }) {
  return (
    <ol className="space-y-0">
      {history.map((h, i) => {
        const last = i === history.length - 1;
        const bad = h.toStatus === "rejected" || h.toStatus === "cancelled";
        return (
          <li key={h.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span className="absolute top-5 left-[9px] h-full w-px bg-line" aria-hidden />}
            <span className={cn("relative mt-0.5 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full ring-4 ring-white", last ? (bad ? "bg-red-500" : "bg-brand-700") : "bg-slate-300")}>
              {last && <Check className="h-3 w-3 text-white" aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm font-medium", last ? "text-slate-900" : "text-slate-600")}>{statusLabel ? statusLabel(h.toStatus) : ORDER_STATUS_LABELS[h.toStatus as OrderStatus]}</p>
              <p className="text-xs text-slate-500">
                {formatDateTime(h.createdAt)} · {h.actorName} ({h.actorRole === "owner" ? "wholesaler" : h.actorRole})
              </p>
              {h.note && <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[13px] text-slate-600">{h.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderItemsTable({ items, showGst }: { items: any[]; showGst: boolean }) {
  return (
    <ul className="divide-y divide-line/70">
      {items.map((it) => (
        <li key={it.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">{it.productName}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {it.sku} · {formatINR(it.unitPricePaise)} × {it.quantity} {it.unit}
              {showGst && it.gstRateBp > 0 && ` · GST ${formatGstRate(it.gstRateBp)}`}
            </p>
          </div>
          <p className="shrink-0 text-sm font-medium text-slate-900 tabular">{formatINR(it.lineSubtotalPaise)}</p>
        </li>
      ))}
    </ul>
  );
}

export function OrderTotals({ order, labels }: { order: any; labels?: Partial<Record<"subtotal" | "gst" | "discount" | "delivery" | "total" | "paid" | "balance", string>> }) {
  const L = { subtotal: "Subtotal", gst: "GST", discount: "Discount", delivery: "Delivery charges", total: "Total", paid: "Paid", balance: "Balance due", ...labels };
  const row = (label: string, value: string, strong?: boolean) => (
    <div className={cn("flex justify-between gap-4 text-sm", strong ? "font-semibold text-slate-900" : "text-slate-600")}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
  const balance = order.totalPaise - order.amountPaidPaise;
  return (
    <dl className="space-y-1.5 px-4 py-3 sm:px-5">
      {row(L.subtotal, formatINR(order.subtotalPaise))}
      {order.taxPaise > 0 && row(L.gst, formatINR(order.taxPaise))}
      {order.discountPaise > 0 && row(L.discount, "− " + formatINR(order.discountPaise))}
      {order.deliveryPaise > 0 && row(L.delivery, formatINR(order.deliveryPaise))}
      <div className="border-t border-line pt-1.5">{row(L.total, formatINR(order.totalPaise), true)}</div>
      {order.amountPaidPaise > 0 && row(L.paid, formatINR(order.amountPaidPaise))}
      {order.amountPaidPaise > 0 && balance > 0 && row(L.balance, formatINR(balance), true)}
    </dl>
  );
}

// ── WhatsApp & link sharing ───────────────────────────────────────────

export function WhatsAppLink({ phone, message, children, size = "md", variant = "whatsapp", className }: { phone?: string | null; message: string; children: ReactNode; size?: "sm" | "md" | "lg"; variant?: "whatsapp" | "secondary"; className?: string }) {
  return (
    <a href={waLink(phone, message)} target="_blank" rel="noopener noreferrer" className={buttonClass(variant, size, className)}>
      <MessageCircle className="h-4 w-4" aria-hidden />
      {children}
    </a>
  );
}

export async function copyText(text: string, label = "Link") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy automatically. Select the text and copy it manually.");
  }
}

/** Shows a one-time link (invitation / password reset) with copy and WhatsApp actions. */
export function ShareLinkDialog({ open, onOpenChange, title, description, link, phone, message }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; link: string; phone?: string | null; message: string }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm">
      <div className="rounded-lg border border-line bg-slate-50 p-3">
        <p className="text-[13px] break-all text-slate-700 select-all">{link}</p>
      </div>
      <p className="mt-2 text-xs text-slate-500">For security this link is shown only once. If it is lost, create a new one.</p>
      <ModalFooter>
        <Button variant="secondary" onClick={() => copyText(link)}>
          <Copy className="h-4 w-4" aria-hidden /> Copy link
        </Button>
        <WhatsAppLink phone={phone} message={message}>Send on WhatsApp</WhatsAppLink>
      </ModalFooter>
    </Modal>
  );
}

// ── Notification centre ───────────────────────────────────────────────

export function NotificationBell({ light }: { light?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // light polling keeps the badge fresh without websockets (fine for the free tier)
  const q = useApi<any[]>("/notifications", undefined, { refetchInterval: 60_000 });
  const unread = q.data?.meta?.unread ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ["/notifications"] });
  const open = async (n: any) => {
    if (!n.readAt) api.post(`/notifications/${n.id}/read`).then(refresh).catch(() => undefined);
    if (n.link) navigate(n.link);
  };
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className={cn("relative grid h-9 w-9 place-items-center rounded-lg", light ? "text-white/90 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100")} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="dl-pop z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" onClick={() => api.post("/notifications/read-all").then(refresh)}>
                <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60dvh] overflow-y-auto">
            {!q.data?.data.length ? (
              <EmptyState compact icon={<Bell />} title="You’re all caught up" description="Order updates and payments will show up here." />
            ) : (
              q.data.data.map((n) => (
                <Dropdown.Item key={n.id} onSelect={() => open(n)} className="flex cursor-pointer gap-3 border-b border-line/60 px-4 py-3 outline-none last:border-0 data-[highlighted]:bg-slate-50">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} aria-hidden />
                  <span className="min-w-0">
                    <span className={cn("block text-[13px]", n.readAt ? "text-slate-600" : "font-medium text-slate-900")}>{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-xs text-slate-500">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                  </span>
                </Dropdown.Item>
              ))
            )}
          </div>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

// ── Account ───────────────────────────────────────────────────────────

export function ChangePasswordCard({ title = "Change password" }: { title?: string }) {
  const { register, handleSubmit, reset, formState } = useForm<{ currentPassword: string; newPassword: string }>();
  const change = useAction((v: { currentPassword: string; newPassword: string }) => api.post("/auth/change-password", v), {
    success: "Password changed. Other devices have been signed out.",
    onSuccess: () => reset(),
  });
  return (
    <Card>
      <CardHeader title={title} description="Use at least 8 characters with a letter and a number." />
      <form className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5" onSubmit={handleSubmit((v) => change.mutate(v))}>
        <Field label="Current password" error={formState.errors.currentPassword?.message}>
          <Input type="password" autoComplete="current-password" {...register("currentPassword", { required: "Enter your current password" })} />
        </Field>
        <Field label="New password" error={formState.errors.newPassword?.message}>
          <Input
            type="password"
            autoComplete="new-password"
            {...register("newPassword", { required: "Enter a new password", minLength: { value: 8, message: "At least 8 characters" }, validate: (v) => (/[a-zA-Z]/.test(v) && /\d/.test(v)) || "Include a letter and a number" })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={change.isPending}>Update password</Button>
        </div>
      </form>
    </Card>
  );
}

export const BackLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="mb-1 inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-brand-700">
    ← {children}
  </Link>
);
