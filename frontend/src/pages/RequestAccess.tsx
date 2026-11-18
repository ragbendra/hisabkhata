import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { LangToggle } from "../components/Layout";

/*
 * "Request access": a form for people who want to try Hisab. It creates no login and no shop, only a row
 * the admin reads and approves, so the app stays invite-only without turning interested people away.
 * Route: /request-access (public).
 */
export default function RequestAccessPage() {
  const { t } = useTranslation();
  const [f, setF] = useState({ shop_name: "", owner_name: "", contact: "", city: "", message: "", website: "" });
  const [state, setState] = useState<"form" | "sent">("form");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/public/request-access", { body: { ...f, city: f.city || null, message: f.message || null } });
      setState("sent");
    } catch (x) {
      setErr(x instanceof Error && x.message !== "Network unreachable" ? x.message : t("offlineNoData", { defaultValue: "No connection. Please try again." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-brand">{t("appName")}</h1>
          <p className="text-sm text-muted">{t("tagline")}</p>
        </div>
        <LangToggle />
      </div>
      <div className="card">
        {state === "sent" ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{t("requestSentTitle", { defaultValue: "Thank you" })}</h2>
            <p className="text-sm">
              {t("requestSentBody", { defaultValue: "We received your request. We will contact you soon with a link to start your free trial." })}
            </p>
            <Link className="btn-secondary w-full" to="/">{t("backToSignIn")}</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-lg font-semibold">{t("requestAccessTitle", { defaultValue: "Request access" })}</h2>
            <p className="muted">{t("requestAccessIntro", { defaultValue: "Hisab is a digital khata for traders. Tell us about your shop and we will send you a free trial link." })}</p>
            <div>
              <label className="label" htmlFor="r-shop">{t("shopName", { defaultValue: "Shop name" })}</label>
              <input id="r-shop" className="field" value={f.shop_name} onChange={set("shop_name")} required minLength={2} maxLength={200} />
            </div>
            <div>
              <label className="label" htmlFor="r-name">{t("yourName", { defaultValue: "Your name" })}</label>
              <input id="r-name" className="field" value={f.owner_name} onChange={set("owner_name")} required minLength={2} maxLength={120} autoComplete="name" />
            </div>
            <div>
              <label className="label" htmlFor="r-contact">{t("phoneOrEmail", { defaultValue: "Phone or email" })}</label>
              <input id="r-contact" className="field" value={f.contact} onChange={set("contact")} required minLength={5} maxLength={200} autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="r-city">{t("city", { defaultValue: "City (optional)" })}</label>
              <input id="r-city" className="field" value={f.city} onChange={set("city")} maxLength={120} />
            </div>
            <div>
              <label className="label" htmlFor="r-msg">{t("whatDoYouSell", { defaultValue: "What do you sell? (optional)" })}</label>
              <input id="r-msg" className="field" value={f.message} onChange={set("message")} maxLength={500} />
            </div>
            {/* honeypot: hidden from people, filled by bots */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
              <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></label>
            </div>
            {err && <p role="alert" className="text-sm text-owed">{err}</p>}
            <button className="btn-primary w-full" disabled={busy}>{t("sendRequest", { defaultValue: "Send request" })}</button>
            <Link to="/" className="block min-h-touch w-full text-center text-sm text-brand underline">{t("backToSignIn")}</Link>
          </form>
        )}
      </div>
    </div>
  );
}

/** A link for the sign-in page. Hidden when the admin has closed requests. */
export function RequestAccessLink() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["public-status"], queryFn: () => api<{ requests_open: boolean }>("/public/status"), retry: false, staleTime: 300_000 });
  if (!q.data?.requests_open) return null;
  return (
    <Link to="/request-access" className="mt-1 block min-h-touch w-full text-center text-sm text-brand underline">
      {t("wantToTry", { defaultValue: "New here? Request access" })}
    </Link>
  );
}
