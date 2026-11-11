import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { BarChart3, Building2, ChevronDown, ClipboardList, ExternalLink, LayoutDashboard, LogOut, Menu, Package, Settings, ShieldCheck, Tags, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo, NotificationBell } from "@/components/shared";
import { Badge, cn, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; badgeKey?: "pendingOrders" };

const OWNER_NAV: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/dashboard/orders", label: "Orders", icon: ClipboardList, badgeKey: "pendingOrders" },
  { to: "/dashboard/products", label: "Products", icon: Package },
  { to: "/dashboard/categories", label: "Categories", icon: Tags },
  { to: "/dashboard/retailers", label: "Retailers", icon: Users },
  { to: "/dashboard/payments", label: "Payments", icon: Wallet },
  { to: "/dashboard/reports", label: "Reports", icon: BarChart3 },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
];
const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Platform overview", icon: ShieldCheck, end: true },
  { to: "/admin/businesses", label: "Businesses", icon: Building2 },
  { to: "/admin/users", label: "Users", icon: Users },
];

function NavList({ items, badges, onNavigate }: { items: NavItem[]; badges: Record<string, number>; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              isActive ? "bg-white/12 text-white" : "text-brand-200 hover:bg-white/6 hover:text-white",
            )
          }
        >
          <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className="flex-1">{item.label}</span>
          {item.badgeKey && badges[item.badgeKey] > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-brand-900 tabular" aria-label={`${badges[item.badgeKey]} pending`}>
              {badges[item.badgeKey]}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/** Shell shared by the wholesaler dashboard and the (separate) platform admin panel. */
export function AppShell({ variant }: { variant: "owner" | "admin" }) {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const items = variant === "owner" ? OWNER_NAV : ADMIN_NAV;
  const dash = useApi<any>(variant === "owner" ? "/biz/dashboard" : null);
  const badges = { pendingOrders: dash.data?.data?.kpis?.pendingOrders ?? 0 };
  const title = variant === "owner" ? session?.business?.name : "Platform admin";

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-brand-900">
      <div className="flex h-14 items-center px-5">
        <Logo light />
      </div>
      <div className="px-5 pt-1 pb-4">
        <p className="text-[11px] font-medium tracking-wider text-brand-300 uppercase">{variant === "owner" ? "Wholesale store" : "Administration"}</p>
        <p className="mt-0.5 truncate text-sm font-medium text-white">{title}</p>
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        <NavList items={items} badges={badges} onNavigate={onNavigate} />
      </div>
      {variant === "owner" && session?.business && (
        <a href={`/store/${session.business.slug}`} target="_blank" rel="noreferrer" className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[13px] text-brand-200 hover:bg-white/6 hover:text-white">
          <ExternalLink className="h-4 w-4" aria-hidden /> Public store page
        </a>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">{sidebar()}</aside>

      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="dl-overlay fixed inset-0 z-40 bg-brand-900/50 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[17rem] max-w-[85vw] shadow-pop focus:outline-none lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Description className="sr-only">Main navigation menu</Dialog.Description>
            {sidebar(() => setDrawer(false))}
            <Dialog.Close className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-lg text-white/80 hover:bg-white/10" aria-label="Close menu">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-white/95 px-3 backdrop-blur sm:px-6">
        <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 lg:hidden">{title}</p>
        <div className="hidden flex-1 items-center gap-2 lg:flex">
          {session?.user.isDemo ? <Badge tone="warning">Demo account — sample data</Badge> : null}
        </div>
        <NotificationBell />
        <Dropdown.Root>
          <Dropdown.Trigger className="flex h-9 items-center gap-2 rounded-lg pr-1.5 pl-1 text-sm hover:bg-slate-100" aria-label="Account menu">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{session?.user.name.slice(0, 1).toUpperCase()}</span>
            <span className="hidden max-w-[10rem] truncate font-medium text-slate-700 sm:block">{session?.user.name}</span>
            <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" sideOffset={8} className="dl-pop z-50 w-56 rounded-xl border border-line bg-white p-1 shadow-pop">
              <div className="px-3 py-2">
                <p className="truncate text-sm font-medium text-slate-900">{session?.user.name}</p>
                <p className="truncate text-xs text-slate-500">{session?.user.email}</p>
              </div>
              <Dropdown.Separator className="my-1 h-px bg-line" />
              {variant === "owner" && (
                <Dropdown.Item onSelect={() => navigate("/dashboard/settings")} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100">
                  <Settings className="h-4 w-4" aria-hidden /> Settings
                </Dropdown.Item>
              )}
              <Dropdown.Item
                onSelect={async () => {
                  await logout();
                  navigate("/login");
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100"
              >
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </header>

      <main key={location.pathname.split("/").slice(0, 3).join("/")} className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-6">
        <Suspense fallback={<div className="grid place-items-center py-24"><Spinner /></div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
