import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import CustomerPage from "./pages/Customer";
import KhataPage from "./pages/Khata";
import LoginPage, { ResetPage } from "./pages/Login";
import NewEntryPage from "./pages/NewEntry";
import SalesPage from "./pages/Sales";
import SettingsPage from "./pages/Settings";
import { ApiError } from "./lib/api";
import { useMe } from "./lib/queries";

const AdminApp = lazy(() => import("./pages/admin/AdminApp"));
const RequestAccessPage = lazy(() => import("./pages/RequestAccess"));
const JoinPage = lazy(() => import("./pages/Join"));
const ArchivedPage = lazy(() => import("./pages/Archived"));

export default function App() {
  const me = useMe();
  const { t } = useTranslation();
  const { pathname } = useLocation();

  if (pathname.startsWith("/admin")) {
    return (
      <Suspense fallback={<Spinner />}>
        <AdminApp />
      </Suspense>
    );
  }

  if (me.isLoading && !me.isError) return <Spinner />;

  if (!me.data) {
    const unreachable = me.error && !(me.error instanceof ApiError);
    return (
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/reset" element={<ResetPage />} />
          <Route path="/request-access" element={<RequestAccessPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="*" element={<LoginPage offlineNotice={unreachable ? t("offlineLogin") : undefined} />} />
        </Routes>
      </Suspense>
    );
  }

  const owner = me.data.role === "owner";
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<KhataPage />} />
          <Route path="/entry" element={<NewEntryPage />} />
          <Route path="/customer/:id" element={<CustomerPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/archived" element={owner ? <ArchivedPage /> : <Navigate to="/" replace />} />
          <Route path="/settings" element={owner ? <SettingsPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
