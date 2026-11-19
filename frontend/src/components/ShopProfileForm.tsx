import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

/*
 * Address and phone, printed under the shop name at the top of every PDF bill and statement.
 * (The shop name itself is already edited in the Shop section of Settings.)
 * Put it in Settings:   <ShopProfileForm />      (owner only; the server refuses anyone else)
 */
interface Profile {
  address: string | null;
  phone: string | null;
}

export default function ShopProfileForm() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shop-profile"], queryFn: () => api<Profile>("/settings") });
  const [draft, setDraft] = useState<Profile | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const v = draft ?? { address: q.data.address ?? "", phone: q.data.phone ?? "" };
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => {
    setMsg(null);
    setDraft({ ...v, [k]: e.target.value });
  };

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api("/settings", { method: "PATCH", body: { address: v.address ?? "", phone: v.phone ?? "" } });
      setMsg(t("saved", { defaultValue: "Saved" }));
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["shop-profile"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (x) {
      setErr(x instanceof Error && x.message === "Network unreachable" ? t("needsConnection", { defaultValue: "Needs a connection" }) : String(x instanceof Error ? x.message : x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">{t("shopProfile", { defaultValue: "Address and phone on bills" })}</h2>
      <p className="muted">{t("shopProfileHint", { defaultValue: "Printed at the top of every PDF bill and ledger." })}</p>
      <div>
        <label className="label" htmlFor="sp-addr">{t("shopAddress", { defaultValue: "Address" })}</label>
        <input id="sp-addr" className="field" value={v.address ?? ""} onChange={set("address")} maxLength={300} autoComplete="street-address" />
      </div>
      <div>
        <label className="label" htmlFor="sp-phone">{t("shopPhone", { defaultValue: "Phone" })}</label>
        <input id="sp-phone" className="field" inputMode="tel" value={v.phone ?? ""} onChange={set("phone")} maxLength={60} autoComplete="tel" />
      </div>
      {err && <p role="alert" className="text-sm text-owed">{err}</p>}
      {msg && <p role="status" className="text-sm text-recv">{msg}</p>}
      <button className="btn-primary w-full" disabled={busy || draft === null} onClick={() => void save()}>
        {t("save", { defaultValue: "Save" })}
      </button>
    </section>
  );
}
