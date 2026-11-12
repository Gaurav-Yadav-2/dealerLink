import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, clearSession } from "./api";
import { FullPageSpinner } from "@/components/ui";

export type Role = "owner" | "retailer" | "admin";
export type Session = {
  user: { id: string; email: string; name: string; phone: string | null; role: Role; isDemo: number };
  business: null | {
    id: string; name: string; slug: string; phone: string | null; email: string | null; address: string | null; city: string | null;
    state: string | null; gstin: string | null; about: string | null; status: string; trackInventory: number; lowStockThreshold: number;
    gstEnabled: number; orderPrefix: string;
  };
  retailer: null | { id: string; businessName: string; contactPerson: string; phone: string; status: string };
};

type AuthValue = {
  session: Session | null;
  loading: boolean;
  setSession: (s: Session | null) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
};
const AuthContext = createContext<AuthValue | null>(null);

export const homeFor = (role: Role) => (role === "owner" ? "/dashboard" : role === "retailer" ? "/retailer/dashboard" : "/admin");

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: async () => (await api.get<Session | null>("/auth/me")).data, staleTime: 5 * 60_000, retry: 1 });
  const value: AuthValue = {
    session: me.data ?? null,
    loading: me.isLoading,
    setSession: (s) => {
      // Drop every cached tenant query but keep the "me" query itself: clearing it would detach this observer.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.setQueryData(["me"], s);
    },
    logout: async () => {
      await api.post("/auth/logout").catch(() => undefined);
      clearSession(); // only this tab: other tabs keep their own sessions
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
    refresh: () => me.refetch(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Route guard. The server enforces the same rules; this only keeps people on the screens meant for them. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (session.user.role !== role) return <Navigate to={homeFor(session.user.role)} replace />;
  return <>{children}</>;
}

/** Sends signed-in users away from login / register pages. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (session) return <Navigate to={homeFor(session.user.role)} replace />;
  return <>{children}</>;
}
