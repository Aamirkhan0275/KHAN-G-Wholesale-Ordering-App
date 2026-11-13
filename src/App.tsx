import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { CartProvider } from './lib/cart';
import { DialogProvider, Spinner } from './components/ui';
import { AdminLayout, ShopLayout } from './components/Layout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Install from './pages/Install';
import Catalogue from './pages/shop/Catalogue';
import Cart from './pages/shop/Cart';
import OrderDone from './pages/shop/OrderDone';
import Orders from './pages/shop/Orders';
import OrderDetail from './pages/shop/OrderDetail';
import Account from './pages/shop/Account';
import Notifications from './pages/Notifications';
import InvoiceView from './pages/InvoiceView';

const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminOrders = lazy(() => import('./pages/admin/Orders'));
const AdminOrderDetail = lazy(() => import('./pages/admin/OrderDetail'));
const Products = lazy(() => import('./pages/admin/Products'));
const ProductEdit = lazy(() => import('./pages/admin/ProductEdit'));
const Categories = lazy(() => import('./pages/admin/Categories'));
const Stock = lazy(() => import('./pages/admin/Stock'));
const Shops = lazy(() => import('./pages/admin/Shops'));
const ShopNew = lazy(() => import('./pages/admin/ShopNew'));
const ShopDetail = lazy(() => import('./pages/admin/ShopDetail'));
const Invoices = lazy(() => import('./pages/admin/Invoices'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Reminders = lazy(() => import('./pages/admin/Reminders'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const More = lazy(() => import('./pages/admin/More'));

function Guard({ role, children }: { role: 'admin' | 'shopkeeper'; children: ReactNode }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.must_change_password) return <Navigate to="/change-password" replace />;
  if (me.role !== role) return <Navigate to={me.role === 'admin' ? '/admin' : '/'} replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/install" element={<Install />} />
        <Route element={<Guard role="shopkeeper"><ShopLayout /></Guard>}>
          <Route index element={<Catalogue />} />
          <Route path="cart" element={<Cart />} />
          <Route path="done/:id" element={<OrderDone />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="account" element={<Account />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="invoices/:id" element={<InvoiceView />} />
        </Route>
        <Route path="/admin" element={<Guard role="admin"><AdminLayout /></Guard>}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="orders/:id" element={<AdminOrderDetail />} />
          <Route path="products" element={<Products />} />
          <Route path="products/new" element={<ProductEdit />} />
          <Route path="products/:id" element={<ProductEdit />} />
          <Route path="categories" element={<Categories />} />
          <Route path="stock" element={<Stock />} />
          <Route path="shops" element={<Shops />} />
          <Route path="shops/new" element={<ShopNew />} />
          <Route path="shops/:id" element={<ShopDetail />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="invoices/:id" element={<InvoiceView />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="settings" element={<Settings />} />
          <Route path="more" element={<More />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <DialogProvider>
          <CartProvider>
            <AppRoutes />
          </CartProvider>
        </DialogProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}
