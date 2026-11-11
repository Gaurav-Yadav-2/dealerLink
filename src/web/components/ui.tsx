import * as Dialog from "@radix-ui/react-dialog";
import { clsx, type ClassValue } from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// ── Buttons ───────────────────────────────────────────────────────────

const BUTTON_VARIANTS = {
  primary: "bg-brand-800 text-white hover:bg-brand-700 active:bg-brand-900 shadow-sm",
  secondary: "bg-white text-slate-700 border border-line hover:bg-slate-50 active:bg-slate-100 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100 active:bg-slate-200",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm",
  dangerOutline: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
  whatsapp: "bg-[#1fa855] text-white hover:bg-[#198f48] shadow-sm",
} as const;
const BUTTON_SIZES = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-5 text-base gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg justify-center",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  loading?: boolean;
};
export const buttonClass = (variant: keyof typeof BUTTON_VARIANTS = "primary", size: keyof typeof BUTTON_SIZES = "md", className?: string) =>
  cn(
    "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none disabled:opacity-50 disabled:pointer-events-none",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ── Form controls ─────────────────────────────────────────────────────

const CONTROL =
  "w-full rounded-lg border border-line bg-white px-3 text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-100";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(CONTROL, "h-10", className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(CONTROL, "py-2 leading-relaxed", className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(CONTROL, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, error, hint, required, children, className, htmlFor }: { label: string; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label className={cn("block", className)} htmlFor={htmlFor}>
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden>*</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-brand-700" : "bg-slate-300")}
      >
        <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
      </button>
    </label>
  );
}

/** Search box that reports its value after the user pauses typing. */
export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-9" />
    </div>
  );
}

// ── Surfaces ──────────────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-xl border border-line bg-white shadow-card", className)}>{children}</section>;
}
export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
} as const;
export type Tone = keyof typeof BADGE_TONES;
export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", BADGE_TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />}
      {children}
    </span>
  );
}

// ── Tables ────────────────────────────────────────────────────────────

/** Scrolls inside its own box on narrow screens so the page itself never overflows horizontally. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full min-w-max text-left text-sm", className)}>{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={cn("border-b border-line bg-slate-50/70 px-4 py-2.5 text-xs font-medium tracking-wide text-slate-500 uppercase first:pl-5 last:pr-5", className)}>{children}</th>
);
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cn("border-b border-line/70 px-4 py-3 align-middle first:pl-5 last:pr-5", className)}>{children}</td>
);

// ── Loading / empty / error states ────────────────────────────────────

export const Skeleton = ({ className }: { className?: string }) => <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} aria-hidden />;

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line/70" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/5" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn("h-5 w-5 animate-spin text-brand-600", className)} aria-label="Loading" />;
export const FullPageSpinner = () => (
  <div className="grid min-h-dvh place-items-center" role="status">
    <Spinner className="h-7 w-7" />
  </div>
);

export function EmptyState({ icon, title, description, action, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center px-6 text-center", compact ? "py-8" : "py-14")}>
      {icon && <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-600 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold">Couldn’t load this</h3>
      <p className="mt-1 max-w-sm text-[13px] text-slate-500">{error instanceof Error ? error.message : "Something went wrong."}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta?: { page: number; pageSize: number; total: number }; onPage: (p: number) => void }) {
  if (!meta || meta.total <= meta.pageSize) return null;
  const pages = Math.ceil(meta.total / meta.pageSize);
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <nav className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5" aria-label="Pagination">
      <p className="text-[13px] text-slate-500">
        {from}–{to} of {meta.total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
        </Button>
        <span className="text-[13px] text-slate-500 tabular">
          {meta.page} / {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={meta.page >= pages} onClick={() => onPage(meta.page + 1)}>
          Next <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

// ── Dialogs ───────────────────────────────────────────────────────────

const MODAL_SIZES = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl" } as const;

/** Accessible modal (focus trap, Esc to close). Becomes a bottom sheet on phones. */
export function Modal({ open, onOpenChange, title, description, children, size = "md" }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; size?: keyof typeof MODAL_SIZES }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dl-overlay fixed inset-0 z-40 bg-brand-900/40" />
        <Dialog.Content
          className={cn(
            "dl-pop fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-pop focus:outline-none",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[88dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
            MODAL_SIZES[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-slate-900">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-[13px] text-slate-500">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="-mt-1 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalFooter = ({ children }: { children: ReactNode }) => (
  <div className="sticky bottom-0 -mx-5 mt-5 -mb-4 flex flex-col-reverse gap-2 border-t border-line bg-white px-5 py-3 sm:flex-row sm:justify-end">{children}</div>
);

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "Confirm", tone = "danger", onConfirm, loading, children,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; confirmLabel?: string;
  tone?: "danger" | "primary"; onConfirm: () => void; loading?: boolean; children?: ReactNode;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm">
      {children}
      <ModalFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
        <Button variant={tone} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
            value === o.value ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {o.label}
          {o.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 tabular">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = "brand" }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: "brand" | "success" | "warning" | "danger" }) {
  const tones = { brand: "bg-brand-50 text-brand-700", success: "bg-emerald-50 text-emerald-700", warning: "bg-amber-50 text-amber-700", danger: "bg-red-50 text-red-700" };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        {icon && <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4", tones[tone])}>{icon}</span>}
      </div>
      <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900 tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export const DefinitionList = ({ items }: { items: [string, ReactNode][] }) => (
  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
    {items.map(([k, v]) => (
      <div key={k} className="min-w-0">
        <dt className="text-xs font-medium text-slate-500">{k}</dt>
        <dd className="mt-0.5 text-sm break-words text-slate-800">{v || "—"}</dd>
      </div>
    ))}
  </dl>
);
