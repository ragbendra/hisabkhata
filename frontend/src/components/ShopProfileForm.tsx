import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { setDateSystem, useDateSystem, type DateSystem } from "../lib/datesystem";

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
  const system = useDateSystem();
  const [sysErr, setSysErr] = useState<string | null>(null);
  async function chooseSystem(next: DateSystem) {
    const before = system;
    setSysErr(null);
    setDateSystem(next); // switch at once; undo if the server refuses
    try {
      await api("/settings", { method: "PATCH", body: { date_system: next } });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (x) {
      setDateSystem(before);
      setSysErr(x instanceof Error && x.message === "Network unreachable" ? t("needsConnection", { defaultValue: "Needs a connection" }) : String(x instanceof Error ? x.message : x));
    }
  }
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
      <h2 className="font-semibold">{t("shopProfile", { defaultValue: "Address, phone and dates" })}</h2>
      <p className="muted">{t("shopProfileHint", { defaultValue: "Printed at the top of every PDF bill and ledger." })}</p>
      <div>
        <label className="label" htmlFor="sp-addr">{t("shopAddress", { defaultValue: "Address" })}</label>
        <input id="sp-addr" className="field" value={v.address ?? ""} onChange={set("address")} maxLength={300} autoComplete="street-address" />
      </div>
      <div>
        <label className="label" htmlFor="sp-phone">{t("shopPhone", { defaultValue: "Phone" })}</label>
        <input id="sp-phone" className="field" inputMode="tel" value={v.phone ?? ""} onChange={set("phone")} maxLength={60} autoComplete="tel" />
      </div>
      <div>
        <span className="label">{t("calendar", { defaultValue: "Calendar for dates" })}</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("calendar", { defaultValue: "Calendar for dates" })}>
          <button type="button" className={`chip ${system === "bs" ? "chip-on" : ""}`} aria-pressed={system === "bs"} onClick={() => void chooseSystem("bs")}>
            {t("calendarBs", { defaultValue: "Nepali (BS)" })}
          </button>
          <button type="button" className={`chip ${system === "ad" ? "chip-on" : ""}`} aria-pressed={system === "ad"} onClick={() => void chooseSystem("ad")}>
            {t("calendarAd", { defaultValue: "International (AD)" })}
          </button>
        </div>
        <p className="muted mt-1">{t("calendarHint", { defaultValue: "Dates in the app and on PDFs use this calendar. Saved dates do not change." })}</p>
        {sysErr && <p role="alert" className="text-sm text-owed">{sysErr}</p>}
      </div>
      {err && <p role="alert" className="text-sm text-owed">{err}</p>}
      {msg && <p role="status" className="text-sm text-recv">{msg}</p>}
      <button className="btn-primary w-full" disabled={busy || draft === null} onClick={() => void save()}>
        {t("save", { defaultValue: "Save" })}
      </button>
    </section>
  );
}
