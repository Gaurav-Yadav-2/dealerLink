import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, BadgeIndianRupee, CheckCircle2, ClipboardList, MessageCircle, Package, ShieldCheck, Store, Users, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useForm, type UseFormSetError } from "react-hook-form";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { INDIAN_STATES } from "@shared/constants";
import { acceptInviteSchema, forgotSchema, loginSchema, registerSchema, resetSchema } from "@shared/schemas";
import { Logo } from "@/components/shared";
import { Button, buttonClass, Card, cn, ErrorState, Field, FullPageSpinner, Input, Select } from "@/components/ui";
import { HumanCheck, useHumanCheck } from "@/components/HumanCheck";
import { api, ApiError, errorMessage } from "@/lib/api";
import { homeFor, useAuth, type Session } from "@/lib/auth";
import { useApi } from "@/lib/hooks";

/** Maps `{ path, message }` validation details from the API onto form fields. */
export function applyServerErrors(e: unknown, setError: UseFormSetError<any>): boolean {
  if (e instanceof ApiError && Array.isArray(e.details)) {
    let applied = false;
    for (const d of e.details as { path?: string; message: string }[]) {
      if (d.path) {
        setError(d.path, { message: d.message });
        applied = true;
      }
    }
    return applied;
  }
  return false;
}

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-brand-900 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/"><Logo light /></Link>
        <div>
          <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight">Your wholesale counter, online.</p>
          <ul className="mt-8 space-y-4 text-sm text-brand-100">
            {[
              [ClipboardList, "Orders arrive structured — no more decoding WhatsApp messages."],
              [BadgeIndianRupee, "Every retailer sees their own price list, set by you."],
              [Wallet, "Know exactly who owes what, order by order."],
            ].map(([Icon, text]: any) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10"><Icon className="h-4 w-4 text-accent" aria-hidden /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-brand-300">Built for Indian wholesalers and distributors.</p>
        <div className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full border-[40px] border-white/[0.04]" aria-hidden />
      </aside>
      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 inline-block lg:hidden"><Logo /></Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-sm text-slate-600">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

const FormError = ({ message }: { message?: string | null }) =>
  message ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{message}</p> : null;

const TextLink = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="font-medium text-brand-700 hover:underline">{children}</Link>;

// ── Landing ───────────────────────────────────────────────────────────

export function LandingPage() {
  const { session } = useAuth();
  const features: [any, string, string][] = [
    [Package, "Digital catalogue", "Add products once. Retailers always see current prices, units, minimum quantities and stock."],
    [BadgeIndianRupee, "Retailer-wise pricing", "Give each retailer their own rate. The right price is applied automatically on every order."],
    [ClipboardList, "Structured orders", "Accept, process and dispatch from one screen, with a full status history."],
    [Wallet, "Payments & outstanding", "Record cash, UPI, cheque or bank payments. See who owes what, instantly."],
    [MessageCircle, "WhatsApp-ready", "Share order updates, invitations and payment reminders in one tap."],
    [ShieldCheck, "Private by design", "Each business's data is isolated. Retailers only ever see their own account."],
  ];
  return (
    <div className="min-h-dvh bg-white">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          {session ? (
            <Link to={homeFor(session.user.role)} className={buttonClass("primary", "md")}>Open dashboard</Link>
          ) : (
            <>
              <Link to="/login" className={buttonClass("ghost", "md")}>Sign in</Link>
              <Link to="/register" className={buttonClass("primary", "md", "hidden sm:inline-flex")}>Create your store</Link>
            </>
          )}
        </nav>
      </header>
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-10 pb-14 sm:px-6 sm:pt-20 sm:pb-20">
          <p className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <Store className="h-3.5 w-3.5" aria-hidden /> B2B ordering for wholesalers &amp; distributors
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
            Stop taking orders on WhatsApp. <span className="text-brand-600">Run your wholesale business from one place.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            DealerLink gives your retailers a simple ordering app with their own prices, and gives you one dashboard for the catalogue, orders, and outstanding payments.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/register" className={buttonClass("primary", "lg")}>Create your wholesale store <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <Link to="/login" className={buttonClass("secondary", "lg")}>I’m a retailer — sign in</Link>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
            {["Free to start", "Works on any phone", "No app install needed"].map((x) => (
              <li key={x} className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />{x}</li>
            ))}
          </ul>
        </section>
        <section className="border-y border-line bg-canvas">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {features.map(([Icon, title, text]) => (
              <Card key={title} className="p-5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                <h2 className="mt-3 text-[15px] font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
              </Card>
            ))}
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Up and running in three steps</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              ["Add your products", "Type them in or upload your existing Excel sheet as CSV."],
              ["Invite your retailers", "Send each retailer a private link on WhatsApp."],
              ["Receive orders", "Orders arrive priced and totalled. Accept, dispatch, record payment."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-800 text-sm font-semibold text-white">{i + 1}</span>
                <div>
                  <h3 className="text-[15px] font-semibold">{t}</h3>
                  <p className="mt-1 text-sm text-slate-600">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:px-6">
          <Logo className="opacity-80" />
          <p>© {new Date().getFullYear()} DealerLink</p>
        </div>
      </footer>
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────

const DEMO_ACCOUNTS = [
  ["Wholesaler", "demo.owner@dealerlink.test"],
  ["Retailer A", "demo.retailer1@dealerlink.test"],
  ["Retailer B", "demo.retailer2@dealerlink.test"],
  ["Admin", "demo.admin@dealerlink.test"],
];

export function LoginPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const human = useHumanCheck();
  const { register, handleSubmit, setValue, formState } = useForm<any>({ resolver: zodResolver(loginSchema) });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<Session>("/auth/login", values, human.headers());
      setSession(res.data);
      const from = (location.state as any)?.from as string | undefined;
      const home = homeFor(res.data.user.role);
      navigate(from && from.startsWith(home.split("/").slice(0, 2).join("/")) ? from : home, { replace: true });
    } catch (e) {
      setFormError(errorMessage(e));
      human.reset();
    }
  });
  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Enter your details to continue." footer={<>New wholesaler? <TextLink to="/register">Create your store</TextLink></>}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormError message={formError} />
        <Field label="Email" error={formState.errors.email?.message as string}>
          <Input type="email" autoComplete="email" inputMode="email" autoFocus aria-invalid={!!formState.errors.email} {...register("email")} />
        </Field>
        <Field label="Password" error={formState.errors.password?.message as string}>
          <Input type="password" autoComplete="current-password" aria-invalid={!!formState.errors.password} {...register("password")} />
        </Field>
        <div className="flex justify-end"><TextLink to="/forgot-password">Forgot password?</TextLink></div>
        <HumanCheck ref={human.ref} onToken={human.setToken} onStatus={human.setStatus} />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting} disabled={!human.canSubmit}>Sign in</Button>
      </form>
      {import.meta.env.DEV && (
        <div className="mt-6 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">Local demo accounts (development build only)</p>
          <p className="mt-0.5 text-xs text-amber-800">Created by <code>npm run db:seed</code>. Password: <code>Demo@12345</code></p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DEMO_ACCOUNTS.map(([label, email]) => (
              <button key={email} type="button" className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100" onClick={() => { setValue("email", email); setValue("password", "Demo@12345"); }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}

// ── Register (owner onboarding: account → business) ───────────────────

export function RegisterPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [formError, setFormError] = useState<string | null>(null);
  const human = useHumanCheck();
  const { register, handleSubmit, trigger, watch, setError, formState } = useForm<any>({ resolver: zodResolver(registerSchema), mode: "onTouched" });
  const errors = formState.errors as Record<string, { message?: string }>;

  const businessName: string = watch("businessName") ?? "";
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(businessName.trim()), 400);
    return () => clearTimeout(t);
  }, [businessName]);
  const check = useApi<{ available: boolean; slug: string | null }>(debounced.length >= 3 ? "/auth/check-business-name" : null, { name: debounced });

  const next = async () => {
    if (await trigger(["name", "email", "phone", "password"])) setStep(2);
  };
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<Session>("/auth/register", values, human.headers());
      setSession(res.data);
      toast.success("Your store is ready. Start by adding products.");
      navigate("/dashboard", { replace: true });
    } catch (e) {
      const applied = applyServerErrors(e, setError);
      if (applied && ["name", "email", "phone", "password"].some((f) => (e as ApiError).details && JSON.stringify((e as ApiError).details).includes(`"${f}"`))) setStep(1);
      if (e instanceof ApiError && e.status === 409 && /email/i.test(e.message)) setStep(1);
      setFormError(errorMessage(e));
      human.reset();
    }
  });

  return (
    <AuthLayout
      title={step === 1 ? "Create your account" : "Tell us about your business"}
      subtitle={<span>Step {step} of 2 · {step === 1 ? "Your sign-in details" : "This becomes your wholesale store"}</span>}
      footer={<>Already registered? <TextLink to="/login">Sign in</TextLink> · Retailers join using the invitation link from their wholesaler.</>}
    >
      <div className="mb-6 flex gap-2" aria-hidden>
        <span className="h-1 flex-1 rounded-full bg-brand-700" />
        <span className={cn("h-1 flex-1 rounded-full", step === 2 ? "bg-brand-700" : "bg-slate-200")} />
      </div>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormError message={formError} />
        <div className={cn("space-y-4", step !== 1 && "hidden")}>
          <Field label="Your name" error={errors.name?.message} required><Input autoComplete="name" autoFocus {...register("name")} /></Field>
          <Field label="Email" error={errors.email?.message} required><Input type="email" inputMode="email" autoComplete="email" {...register("email")} /></Field>
          <Field label="Mobile number" error={errors.phone?.message} hint="10-digit Indian mobile number" required><Input type="tel" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" {...register("phone")} /></Field>
          <Field label="Password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number" required><Input type="password" autoComplete="new-password" {...register("password")} /></Field>
          <Button size="lg" className="w-full" onClick={next}>Continue <ArrowRight className="h-4 w-4" aria-hidden /></Button>
        </div>
        <div className={cn("space-y-4", step !== 2 && "hidden")}>
          <Field
            label="Business name"
            error={errors.businessName?.message ?? (check.data && !check.data.data.available && debounced.length >= 3 ? "This business name is already registered" : undefined)}
            hint={check.data?.data.available && check.data.data.slug ? <>Available · your store link will be <span className="font-medium text-slate-700">/store/{check.data.data.slug}</span></> : "Must be unique on DealerLink"}
            required
          >
            <Input placeholder="e.g. Sharma Electricals" {...register("businessName")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" error={errors.city?.message}><Input autoComplete="address-level2" {...register("city")} /></Field>
            <Field label="State" error={errors.state?.message}>
              <Select {...register("state")} defaultValue="">
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
          {step === 2 && <HumanCheck ref={human.ref} onToken={human.setToken} onStatus={human.setStatus} />}
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={() => setStep(1)}>Back</Button>
            <Button type="submit" size="lg" className="flex-1" loading={formState.isSubmitting} disabled={!human.canSubmit}>Create my store</Button>
          </div>
        </div>
      </form>
    </AuthLayout>
  );
}

// ── Retailer invitation ───────────────────────────────────────────────

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const { setSession, session, logout } = useAuth();
  const navigate = useNavigate();
  const invite = useApi<any>(`/auth/invitations/${encodeURIComponent(token)}`);
  const [formError, setFormError] = useState<string | null>(null);
  const human = useHumanCheck();
  const { register, handleSubmit, setError, reset, formState } = useForm<any>({ resolver: zodResolver(acceptInviteSchema) });
  const errors = formState.errors as Record<string, { message?: string }>;
  useEffect(() => {
    if (invite.data) reset({ name: invite.data.data.contactPerson ?? "", email: invite.data.data.email ?? "" });
  }, [invite.data, reset]);

  if (invite.isLoading) return <FullPageSpinner />;
  if (invite.isError) {
    return (
      <AuthLayout title="Invitation not available" subtitle={errorMessage(invite.error)} footer={<TextLink to="/login">Go to sign in</TextLink>}>
        <p className="text-sm text-slate-600">Invitation links work once and expire after 7 days. Ask your wholesaler to send a new link.</p>
      </AuthLayout>
    );
  }
  const inv = invite.data!.data;
  if (session) {
    return (
      <AuthLayout title="You’re already signed in" subtitle={`Signed in as ${session.user.email}. Sign out to accept this invitation.`}>
        <Button onClick={() => logout()}>Sign out and continue</Button>
      </AuthLayout>
    );
  }
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await api.post<Session>(`/auth/invitations/${encodeURIComponent(token)}/accept`, values, human.headers());
      setSession(res.data);
      toast.success(`Welcome! You can now order from ${inv.wholesalerName}.`);
      navigate("/retailer/catalogue", { replace: true });
    } catch (e) {
      applyServerErrors(e, setError);
      setFormError(errorMessage(e));
      human.reset();
    }
  });
  return (
    <AuthLayout title={`Join ${inv.wholesalerName}`} subtitle={<>You’ve been invited to order online as <span className="font-medium text-slate-700">{inv.retailerName}</span>. Create your account to see your price list.</>}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormError message={formError} />
        <Field label="Your name" error={errors.name?.message} required><Input autoComplete="name" {...register("name")} /></Field>
        <Field label="Email" error={errors.email?.message} hint="You will use this to sign in" required><Input type="email" inputMode="email" autoComplete="email" {...register("email")} /></Field>
        <Field label="Create a password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number" required><Input type="password" autoComplete="new-password" {...register("password")} /></Field>
        <HumanCheck ref={human.ref} onToken={human.setToken} onStatus={human.setStatus} />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting} disabled={!human.canSubmit}>Create account &amp; view catalogue</Button>
      </form>
    </AuthLayout>
  );
}

// ── Password reset ────────────────────────────────────────────────────

export function ForgotPasswordPage() {
  const [done, setDone] = useState<null | { devResetToken?: string }>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const human = useHumanCheck();
  const { register, handleSubmit, formState } = useForm<any>({ resolver: zodResolver(forgotSchema) });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      setDone((await api.post("/auth/forgot-password", values, human.headers())).data);
    } catch (e) {
      setFormError(errorMessage(e));
      human.reset();
    }
  });
  if (done) {
    return (
      <AuthLayout title="Request received" footer={<TextLink to="/login">Back to sign in</TextLink>}>
        <div className="space-y-3 text-sm leading-relaxed text-slate-600">
          <p>If an account exists for that email, a reset has been requested.</p>
          <p className="rounded-lg border border-line bg-white p-3">
            <span className="font-medium text-slate-800">How you’ll get your link:</span> DealerLink does not send emails. <br />
            <span className="font-medium">Retailers</span> — your wholesaler has been notified and will send you a reset link (usually on WhatsApp). <br />
            <span className="font-medium">Wholesalers</span> — DealerLink support has been notified and will send your link.
          </p>
          {done.devResetToken && (
            <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-amber-900">
              Development mode: <Link className="font-medium underline" to={`/reset-password?token=${done.devResetToken}`}>open the reset link</Link>
            </p>
          )}
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Forgot your password?" subtitle="Enter your email and we’ll arrange a reset link." footer={<TextLink to="/login">Back to sign in</TextLink>}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormError message={formError} />
        <Field label="Email" error={formState.errors.email?.message as string}><Input type="email" inputMode="email" autoComplete="email" autoFocus {...register("email")} /></Field>
        <HumanCheck ref={human.ref} onToken={human.setToken} onStatus={human.setStatus} />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting} disabled={!human.canSubmit}>Request reset link</Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const token = sp.get("token") ?? "";
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<any>({ resolver: zodResolver(resetSchema), defaultValues: { token } });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post("/auth/reset-password", values);
      toast.success("Password updated. Please sign in.");
      navigate("/login", { replace: true });
    } catch (e) {
      setFormError(errorMessage(e));
    }
  });
  if (!token) {
    return (
      <AuthLayout title="Reset link missing" subtitle="Open the full link you were sent, or request a new one." footer={<TextLink to="/forgot-password">Request a reset link</TextLink>}>
        <span />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Set a new password" footer={<TextLink to="/login">Back to sign in</TextLink>}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <FormError message={formError ?? (formState.errors.token?.message as string)} />
        <input type="hidden" {...register("token")} />
        <Field label="New password" error={formState.errors.password?.message as string} hint="At least 8 characters, with a letter and a number">
          <Input type="password" autoComplete="new-password" autoFocus {...register("password")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>Update password</Button>
      </form>
    </AuthLayout>
  );
}

// ── Public store card ─────────────────────────────────────────────────

export function StorePage() {
  const { slug = "" } = useParams();
  const { session } = useAuth();
  const store = useApi<any>(`/public/store/${encodeURIComponent(slug)}`);
  if (store.isLoading) return <FullPageSpinner />;
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 inline-block"><Logo /></Link>
        {store.isError ? (
          <Card><ErrorState error={new Error("This store does not exist or is not available.")} /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="bg-brand-800 px-6 py-7 text-white">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-lg font-semibold">{store.data!.data.name.slice(0, 1).toUpperCase()}</span>
              <h1 className="mt-3 text-xl font-semibold text-white">{store.data!.data.name}</h1>
              <p className="mt-0.5 text-sm text-brand-200">{[store.data!.data.city, store.data!.data.state].filter(Boolean).join(", ") || "Wholesale store"}</p>
            </div>
            <div className="space-y-4 p-6">
              {store.data!.data.about && <p className="text-sm leading-relaxed text-slate-600">{store.data!.data.about}</p>}
              <div className="flex gap-6 text-sm">
                <p><span className="block text-lg font-semibold text-slate-900 tabular">{store.data!.data.productCount}</span><span className="text-slate-500">products</span></p>
                <p><span className="block text-lg font-semibold text-slate-900 tabular">{store.data!.data.categoryCount}</span><span className="text-slate-500">categories</span></p>
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-[13px] text-slate-600">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                This is a private wholesale store. Prices and products are visible only to invited retailers.
              </p>
              {session?.user.role === "retailer" && session.business?.slug === slug ? (
                <Link to="/retailer/catalogue" className={buttonClass("primary", "lg", "w-full")}>Open catalogue</Link>
              ) : (
                <Link to="/login" className={buttonClass("primary", "lg", "w-full")}>Retailer sign in</Link>
              )}
              <p className="text-center text-xs text-slate-500">Not invited yet? Ask the wholesaler for your invitation link.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">The page you’re looking for doesn’t exist or has moved.</p>
        <Link to="/" className={buttonClass("primary", "md", "mt-6")}>Go home</Link>
      </div>
    </div>
  );
}
