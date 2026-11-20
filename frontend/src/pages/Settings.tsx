import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import DeleteHelperButton from "../components/DeleteHelperButton";
import FeedbackForm from "../components/FeedbackForm";
import PasswordInput from "../components/PasswordInput";
import ShopProfileForm from "../components/ShopProfileForm";
import { ConfirmButton, Section, Spinner } from "../components/ui";
import { api, apiBlob } from "../lib/api";
import { setLang } from "../lib/i18n";
import { clearLocalData } from "../lib/db";
import { useFmt } from "../lib/format";
import { useFruitNames, useSettings, useUsers } from "../lib/queries";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const f = useFmt();
  const nav = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();
  const users = useUsers(true);
  const fruits = useFruitNames();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fruitFrom, setFruitFrom] = useState("");
  const [fruitInto, setFruitInto] = useState("");
  const [helper, setHelper] = useState({ name: "", login: "", password: "" });
  const [exporting, setExporting] = useState(false);

  const fail = (e: unknown) => setErr(e instanceof Error ? (e.message === "Network unreachable" ? t("needsConnection") : e.message) : String(e));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/settings", { method: "PATCH", body }),
    onSuccess: () => {
      setErr(null);
      setMsg(t("settingsSaved"));
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: fail,
  });
  const addHelper = useMutation({
    mutationFn: () => api("/users", { body: helper }),
    onSuccess: () => {
      setHelper({ name: "", login: "", password: "" });
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: fail,
  });
  const toggleUser = useMutation({
    mutationFn: (v: { id: string; disabled: boolean }) => api(`/users/${v.id}`, { method: "PATCH", body: { disabled: v.disabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
    onError: fail,
  });
  const merge = useMutation({
    mutationFn: () => api<{ changed_lines: number }>("/fruit-names/merge", { body: { from_name: fruitFrom, into_name: fruitInto } }),
    onSuccess: (r) => {
      setMsg(t("fruitRenamed", { n: f.digits(r.changed_lines) }));
      setFruitFrom("");
      setFruitInto("");
      void qc.invalidateQueries({ queryKey: ["fruit-names"] });
      void qc.invalidateQueries({ queryKey: ["sales"] });
    },
    onError: fail,
  });

  async function exportNow() {
    setExporting(true);
    setErr(null);
    try {
      const { blob, filename } = await apiBlob("/export/full");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  }

  async function logout() {
    try {
      await api("/auth/logout", { body: {} });
    } catch {
      /* offline: the cookie will expire on its own */
    }
    await clearLocalData();
    qc.clear();
    nav("/");
    await qc.invalidateQueries();
  }

  if (settings.isLoading) return <Spinner />;
  const s = settings.data;
  if (!s) return <p className="muted">{t("offlineNoData")}</p>;

  return (
    <div className="space-y-1">
      <h1 className="text-xl font-bold">{t("settings")}</h1>
      {msg && <p role="status" className="card bg-tint text-recv">{msg}</p>}
      {err && <p role="alert" className="card bg-owedtint text-owed">{err}</p>}

      <Section title={t("shop")}>
        <ShopForm key={`${s.name}-${s.next_bill_no}`} name={s.name} next={s.next_bill_no} onSave={(b) => save.mutate(b)} />
      </Section>

      <ShopProfileForm />

      <Section title={t("language")}>
        <div className="flex gap-2">
          <button className={`chip ${i18n.language === "en" ? "chip-on" : ""}`} onClick={() => setLang("en")}>English</button>
          <button className={`chip ${i18n.language === "ne" ? "chip-on" : ""}`} onClick={() => setLang("ne")}>नेपाली</button>
        </div>
      </Section>

      <Section title={t("exportBackup")}>
        <div className="card space-y-3">
          <button className="btn-primary w-full" disabled={exporting} onClick={() => void exportNow()}>
            {exporting ? t("loading") : t("exportExcel")}
          </button>
          <p className="muted">{t("weeklyEmailHelp", { email: s.owner_email ?? "" })}</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">{t("emailDay")}</label>
              <select className="field" value={s.backup_email_day ?? 0} onChange={(e) => save.mutate({ backup_email_day: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i}>{t(`day_${d}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t("emailTime")}</label>
              <input className="field" type="time" value={s.backup_email_time ?? "20:00"} onChange={(e) => e.target.value && save.mutate({ backup_email_time: e.target.value })} />
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("helperLogin")}>
        <div className="card space-y-3">
          <p className="muted">{t("helperHelp")}</p>
          {users.data?.filter((u) => u.role === "helper").map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{u.name} <span className="muted">({u.login})</span></div>
                {u.disabled && <div className="text-sm text-owed">{t("disabled")}</div>}
              </div>
              <button className="btn-secondary" onClick={() => toggleUser.mutate({ id: u.id, disabled: !u.disabled })}>
                {u.disabled ? t("enable") : t("disable")}
              </button>
              <DeleteHelperButton id={u.id} name={u.name} onDone={() => void qc.invalidateQueries({ queryKey: ["users"] })} />
            </div>
          ))}
          <form
            className="space-y-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              addHelper.mutate();
            }}
          >
            <input className="field" placeholder={t("helperName")} value={helper.name} onChange={(e) => setHelper({ ...helper, name: e.target.value })} required />
            <input className="field" placeholder={t("loginName")} autoCapitalize="none" value={helper.login} onChange={(e) => setHelper({ ...helper, login: e.target.value })} required minLength={2} />
            <PasswordInput className="field" placeholder={t("password")} autoComplete="new-password" value={helper.password} onChange={(e) => setHelper({ ...helper, password: e.target.value })} required minLength={6} />
            <button className="btn-primary w-full">{t("addHelper")}</button>
          </form>
        </div>
      </Section>

      <Section title={t("fruitNames")}>
        <div className="card space-y-3">
          <p className="muted">{t("fruitMergeHelp")}</p>
          <datalist id="fruit-list">{fruits.data?.map((x) => <option key={x.id} value={x.name} />)}</datalist>
          <input className="field" list="fruit-list" placeholder={t("fruitFrom")} value={fruitFrom} onChange={(e) => setFruitFrom(e.target.value)} />
          <input className="field" list="fruit-list" placeholder={t("fruitInto")} value={fruitInto} onChange={(e) => setFruitInto(e.target.value)} />
          <ConfirmButton className="btn-secondary w-full" label={t("renameMerge")} confirmLabel={t("tapAgainConfirm")} disabled={!fruitFrom.trim() || !fruitInto.trim()} onConfirm={() => merge.mutate()} />
        </div>
      </Section>

      <FeedbackForm />

      <Section title={t("account")}>
        <button className="btn-secondary w-full" onClick={() => void logout()}>{t("signOut")}</button>
      </Section>
    </div>
  );
}

function ShopForm({ name, next, onSave }: { name: string; next: number; onSave: (b: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const [n, setN] = useState(name);
  const [b, setB] = useState(String(next));
  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: n.trim(), next_bill_no: Number(b) });
      }}
    >
      <div><label className="label">{t("shopName")}</label><input className="field" value={n} onChange={(e) => setN(e.target.value)} required /></div>
      <div><label className="label">{t("nextBillNo")}</label><input className="field" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} required /></div>
      <button className="btn-primary w-full">{t("save")}</button>
    </form>
  );
}
