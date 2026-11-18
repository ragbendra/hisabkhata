import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { Spinner } from "../components/ui";
import { LangToggle } from "../components/Layout";

/* Opens an invite link (/join?token=...): sets up the shop and the owner's login, then signs in. */
interface InviteInfo {
  shop_name: string | null;
  owner_name: string | null;
  email: string | null;
  trial_days: number;
}

export default function JoinPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const nav = useNavigate();
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<InviteInfo>(`/public/invite/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  });
  const [f, setF] = useState<{ shop_name?: string; owner_name?: string; email?: string; password: string }>({ password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-brand">{t("appName")}</h1>
        <p className="text-sm text-muted">{t("tagline")}</p>
      </div>
      <LangToggle />
    </div>
  );
  const wrap = (body: React.ReactNode) => (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-6">
      {header}
      <div className="card">{body}</div>
    </div>
  );

  if (!token || info.isError) {
    return wrap(
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("inviteInvalidTitle", { defaultValue: "This link does not work" })}</h2>
        <p className="text-sm">{t("inviteInvalidBody", { defaultValue: "The invite may have expired or was already used. Ask for a new one, or request access again." })}</p>
        <Link className="btn-primary w-full" to="/request-access">{t("requestAccessTitle", { defaultValue: "Request access" })}</Link>
        <Link className="block min-h-touch w-full text-center text-sm text-brand underline" to="/">{t("backToSignIn")}</Link>
      </div>,
    );
  }
  if (!info.data) return <Spinner />;
  const i = info.data;
  const v = {
    shop_name: f.shop_name ?? i.shop_name ?? "",
    owner_name: f.owner_name ?? i.owner_name ?? "",
    email: i.email ?? f.email ?? "",
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/public/invite/${encodeURIComponent(token)}/accept`, { body: { ...v, password: f.password } });
      await qc.invalidateQueries();
      nav("/", { replace: true });
    } catch (x) {
      setErr(x instanceof Error && x.message !== "Network unreachable" ? x.message : t("offlineNoData", { defaultValue: "No connection. Please try again." }));
    } finally {
      setBusy(false);
    }
  }

  return wrap(
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-lg font-semibold">{t("joinTitle", { defaultValue: "Create your account" })}</h2>
      <p className="muted">{t("joinTrial", { defaultValue: "Your free trial is {{days}} days. No payment is needed to start.", days: i.trial_days })}</p>
      <div>
        <label className="label" htmlFor="j-shop">{t("shopName", { defaultValue: "Shop name" })}</label>
        <input id="j-shop" className="field" value={v.shop_name} onChange={(e) => setF({ ...f, shop_name: e.target.value })} required minLength={2} />
      </div>
      <div>
        <label className="label" htmlFor="j-name">{t("yourName", { defaultValue: "Your name" })}</label>
        <input id="j-name" className="field" value={v.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} required minLength={2} autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="j-email">{t("ownerEmail")}</label>
        <input id="j-email" className="field" type="email" autoCapitalize="none" value={v.email} onChange={(e) => setF({ ...f, email: e.target.value })} required readOnly={Boolean(i.email)} autoComplete="username" />
      </div>
      <div>
        <label className="label" htmlFor="j-pass">{t("password")} ({t("min8", { defaultValue: "at least 8 characters" })})</label>
        <input id="j-pass" className="field" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} autoComplete="new-password" />
      </div>
      {err && <p role="alert" className="text-sm text-owed">{err}</p>}
      <button className="btn-primary w-full" disabled={busy}>{t("createAccount", { defaultValue: "Create account" })}</button>
    </form>,
  );
}
