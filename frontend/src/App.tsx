import { Navigate, Route, Routes } from "react-router-dom";
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

export default function App() {
  const me = useMe();
  const { t } = useTranslation();

  if (me.isLoading && !me.isError) return <Spinner />;

  if (!me.data) {
    const unreachable = me.error && !(me.error instanceof ApiError);
    return (
      <Routes>
        <Route path="/reset" element={<ResetPage />} />
        <Route path="*" element={<LoginPage offlineNotice={unreachable ? t("offlineLogin") : undefined} />} />
      </Routes>
    );
  }

  const owner = me.data.role === "owner";
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<KhataPage />} />
        <Route path="/entry" element={<NewEntryPage />} />
        <Route path="/customer/:id" element={<CustomerPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/settings" element={owner ? <SettingsPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
