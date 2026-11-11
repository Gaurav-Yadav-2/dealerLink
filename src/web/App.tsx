import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { RetailerShell } from "./layouts/RetailerShell";
import { GuestOnly, RequireRole } from "./lib/auth";
import { AcceptInvitePage, ForgotPasswordPage, LandingPage, LoginPage, NotFoundPage, RegisterPage, ResetPasswordPage, StorePage } from "./pages/public/Public";

// Each area is its own chunk, so a retailer on a slow phone never downloads the wholesaler dashboard or charts.
const Overview = lazy(() => import("./pages/dashboard/Overview"));
const Products = lazy(() => import("./pages/dashboard/Products"));
const Categories = lazy(() => import("./pages/dashboard/Categories"));
const Retailers = lazy(() => import("./pages/dashboard/Retailers"));
const RetailerDetail = lazy(() => import("./pages/dashboard/RetailerDetail"));
const Orders = lazy(() => import("./pages/dashboard/Orders"));
const OrderDetail = lazy(() => import("./pages/dashboard/OrderDetail"));
const NewOrder = lazy(() => import("./pages/dashboard/NewOrder"));
const Payments = lazy(() => import("./pages/dashboard/Payments"));
const Reports = lazy(() => import("./pages/dashboard/Reports"));
const Settings = lazy(() => import("./pages/dashboard/Settings"));

const retailer = () => import("./pages/retailer/Retailer");
const RetailerDashboard = lazy(() => retailer().then((m) => ({ default: m.RetailerDashboard })));
const Catalogue = lazy(() => retailer().then((m) => ({ default: m.Catalogue })));
const CartPage = lazy(() => retailer().then((m) => ({ default: m.CartPage })));
const RetailerOrders = lazy(() => retailer().then((m) => ({ default: m.RetailerOrders })));
const RetailerOrderDetail = lazy(() => retailer().then((m) => ({ default: m.RetailerOrderDetail })));
const RetailerPayments = lazy(() => retailer().then((m) => ({ default: m.RetailerPayments })));
const RetailerProfile = lazy(() => retailer().then((m) => ({ default: m.RetailerProfile })));

const admin = () => import("./pages/admin/Admin");
const AdminOverview = lazy(() => admin().then((m) => ({ default: m.AdminOverview })));
const AdminBusinesses = lazy(() => admin().then((m) => ({ default: m.AdminBusinesses })));
const AdminUsers = lazy(() => admin().then((m) => ({ default: m.AdminUsers })));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/store/:slug" element={<StorePage />} />

      <Route path="/dashboard" element={<RequireRole role="owner"><AppShell variant="owner" /></RequireRole>}>
        <Route index element={<Overview />} />
        <Route path="products" element={<Products />} />
        <Route path="categories" element={<Categories />} />
        <Route path="retailers" element={<Retailers />} />
        <Route path="retailers/:id" element={<RetailerDetail />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/new" element={<NewOrder />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="payments" element={<Payments />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="/retailer" element={<RequireRole role="retailer"><RetailerShell /></RequireRole>}>
        <Route index element={<Navigate to="/retailer/dashboard" replace />} />
        <Route path="dashboard" element={<RetailerDashboard />} />
        <Route path="catalogue" element={<Catalogue />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="orders" element={<RetailerOrders />} />
        <Route path="orders/:id" element={<RetailerOrderDetail />} />
        <Route path="payments" element={<RetailerPayments />} />
        <Route path="profile" element={<RetailerProfile />} />
      </Route>

      <Route path="/admin" element={<RequireRole role="admin"><AppShell variant="admin" /></RequireRole>}>
        <Route index element={<AdminOverview />} />
        <Route path="businesses" element={<AdminBusinesses />} />
        <Route path="users" element={<AdminUsers />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
