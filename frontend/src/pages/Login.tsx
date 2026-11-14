import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LangToggle } from "../components/Layout";
import { api } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { flushOutbox } from "../lib/sync";

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-brand">{t("appName")}</h1>
          <p className="text-sm text-muted">{t("tagline")}</p>
        </div>
        <div>
          <LangToggle />
        </div>
      </div>
      <div className="card">{children}</div>
    </div>
  );
}

export default function LoginPage({ offlineNotice }: { offlineNotice?: string }) {
  const { t } = useTranslation();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (forgot) {
        await api("/auth/reset", { body: { email: login } });
        setSent(true);
      } else {
        await api("/auth/login", { body: { login, password } });
        await queryClient.invalidateQueries();
        void flushOutbox();
      }
    } catch (err) {
      setError(err instanceof Error && err.message !== "Network unreachable" ? err.message : t("offlineNoData"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      {offlineNotice && <p className="mb-3 rounded bg-warntint p-2 text-sm text-warn">{offlineNotice}</p>}
      <form onSubmit={submit} className="space-y-3">
        <h2 className="text-lg font-semibold">{forgot ? t("resetTitle") : t("signIn")}</h2>
        <div>
          <label className="label" htmlFor="login">
            {forgot ? t("ownerEmail") : t("loginName")}
          </label>
          <input id="login" className="field" autoCapitalize="none" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </div>
        {!forgot && (
          <div>
            <label className="label" htmlFor="password">
              {t("password")}
            </label>
            <input id="password" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-owed">
            {error}
          </p>
        )}
        {sent && <p className="text-sm text-recv">{t("resetSent")}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {forgot ? t("sendResetLink") : t("signIn")}
        </button>
        <button type="button" className="min-h-touch w-full text-sm text-brand underline" onClick={() => { setForgot(!forgot); setSent(false); setError(null); }}>
          {forgot ? t("backToSignIn") : t("forgotPassword")}
        </button>
      </form>
    </Shell>
  );
}

export function ResetPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/auth/reset/confirm", { body: { token: params.get("token") ?? "", password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Shell>
      {done ? (
        <div className="space-y-3">
          <p>{t("passwordChanged")}</p>
          <a className="btn-primary w-full" href="/">
            {t("signIn")}
          </a>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <h2 className="text-lg font-semibold">{t("newPassword")}</h2>
          <input type="password" className="field" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-label={t("newPassword")} />
          <p className="muted">{t("passwordMin8")}</p>
          {error && (
            <p role="alert" className="text-sm text-owed">
              {error}
            </p>
          )}
          <button className="btn-primary w-full">{t("savePassword")}</button>
        </form>
      )}
    </Shell>
  );
}
