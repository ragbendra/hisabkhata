import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

/*
 * "Send us a message": a problem, a question or an idea. It goes to the Hisab team (the platform admin page).
 * Anyone signed in can use it, owner or helper, even when the trial has ended.
 * Put it in Settings:   <FeedbackForm />
 */
const KINDS = [
  { id: "problem", key: "fbProblem", def: "Something is wrong" },
  { id: "question", key: "fbQuestion", def: "I have a question" },
  { id: "idea", key: "fbIdea", def: "An idea" },
] as const;

export default function FeedbackForm() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("problem");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await api("/feedback", { body: { kind, message, contact: contact.trim() || undefined } });
      setSent(true);
      setMessage("");
    } catch (x) {
      const m = x instanceof Error ? x.message : String(x);
      setErr(m === "Network unreachable" ? t("needsConnection", { defaultValue: "Needs a connection" }) : m);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <section className="card space-y-2">
        <h2 className="font-semibold">{t("fbThanks", { defaultValue: "Thank you" })}</h2>
        <p className="muted">{t("fbSent", { defaultValue: "We received your message and will get back to you." })}</p>
        <button className="btn-secondary w-full" onClick={() => setSent(false)}>{t("fbAnother", { defaultValue: "Send another message" })}</button>
      </section>
    );

  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <h2 className="font-semibold">{t("fbTitle", { defaultValue: "Send us a message" })}</h2>
      <p className="muted">{t("fbHint", { defaultValue: "Tell us about a problem, ask a question, or share an idea." })}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("fbTitle", { defaultValue: "Send us a message" })}>
        {KINDS.map((k) => (
          <button key={k.id} type="button" className={`chip ${kind === k.id ? "chip-on" : ""}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            {t(k.key, { defaultValue: k.def })}
          </button>
        ))}
      </div>
      <textarea className="field min-h-[110px]" value={message} onChange={(e) => setMessage(e.target.value)} minLength={5} maxLength={2000} required aria-label={t("fbMessage", { defaultValue: "Your message" })} placeholder={t("fbMessage", { defaultValue: "Your message" })} />
      <input className="field" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} inputMode="tel" placeholder={t("fbContact", { defaultValue: "Phone or email to reply to (optional)" })} aria-label={t("fbContact", { defaultValue: "Phone or email to reply to (optional)" })} />
      {err && <p role="alert" className="text-sm text-owed">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || message.trim().length < 5}>{busy ? t("preparing", { defaultValue: "Preparing…" }) : t("fbSend", { defaultValue: "Send" })}</button>
    </form>
  );
}
