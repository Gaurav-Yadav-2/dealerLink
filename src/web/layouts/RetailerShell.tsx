import { ClipboardList, Home, Languages, LogOut, ShoppingCart, Store, User, Wallet, type LucideIcon } from "lucide-react";
import { Suspense } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { NotificationBell } from "@/components/shared";
import { cn, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import { I18nProvider, useT, type TKey } from "@/lib/i18n";

const NAV: { to: string; key: TKey; icon: LucideIcon }[] = [
  { to: "/retailer/dashboard", key: "nav.home", icon: Home },
  { to: "/retailer/catalogue", key: "nav.catalogue", icon: Store },
  { to: "/retailer/orders", key: "nav.orders", icon: ClipboardList },
  { to: "/retailer/payments", key: "nav.payments", icon: Wallet },
  { to: "/retailer/profile", key: "nav.profile", icon: User },
];

function Shell() {
  const { session, logout } = useAuth();
  const { t, lang, setLang } = useT();
  const navigate = useNavigate();
  const cart = useApi<any>("/retailer/cart");
  const cartCount = cart.data?.data?.itemCount ?? 0;

  return (
    <div className="min-h-dvh pb-[4.5rem] md:pb-0">
      <header className="no-print sticky top-0 z-20 bg-brand-800 text-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:px-5">
          <Link to="/retailer/dashboard" className="min-w-0 flex-1 md:flex-none">
            <p className="truncate text-[15px] leading-tight font-semibold">{session?.business?.name}</p>
            <p className="truncate text-[11px] leading-tight text-brand-200">{session?.retailer?.businessName}</p>
          </Link>
          <nav className="mx-4 hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cn("rounded-lg px-3 py-1.5 text-sm font-medium", isActive ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10")}>
                {t(n.key)}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setLang(lang === "en" ? "hi" : "en")}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-white/90 hover:bg-white/10"
            aria-label={lang === "en" ? "हिंदी में बदलें" : "Switch to English"}
          >
            <Languages className="h-4 w-4" aria-hidden />
            {lang === "en" ? "हिंदी" : "English"}
          </button>
          <NotificationBell light />
          <Link to="/retailer/cart" className="relative grid h-9 w-9 place-items-center rounded-lg text-white/90 hover:bg-white/10" aria-label={`${t("nav.cart")} (${cartCount})`}>
            <ShoppingCart className="h-[18px] w-[18px]" />
            {cartCount > 0 && <span className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-brand-900">{cartCount}</span>}
          </Link>
          <button
            type="button"
            className="hidden h-9 w-9 place-items-center rounded-lg text-white/90 hover:bg-white/10 md:grid"
            aria-label={t("nav.logout")}
            title={t("nav.logout")}
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-5 sm:py-6">
        <Suspense fallback={<div className="grid place-items-center py-24"><Spinner /></div>}>
          <Outlet />
        </Suspense>
      </main>

      {/* thumb-reach bottom navigation on phones */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => cn("flex h-[3.75rem] flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-brand-800" : "text-slate-500")}>
            {({ isActive }) => (
              <>
                <n.icon className={cn("h-5 w-5", isActive && "stroke-[2.4]")} aria-hidden />
                {t(n.key)}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function RetailerShell() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
