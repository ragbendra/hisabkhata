import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

/** Delete a helper login. Asks first. Their old bills and payments stay. */
export default function DeleteHelperButton({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/users/${id}`, { method: "DELETE" });
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
      setBusy(false);
    }
  }

  if (!asking)
    return (
      <button className="btn-secondary !text-owed" onClick={() => setAsking(true)}>
        {t("delete", { defaultValue: "Delete" })}
      </button>
    );
  return (
    <div className="basis-full space-y-2 rounded-lg border border-line p-3">
      <p className="text-sm">
        {t("deleteHelperAsk", { defaultValue: "Delete {{name}}'s login? They will not be able to sign in again. Bills they entered stay.", name })}
      </p>
      {err && <p role="alert" className="text-sm text-owed">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={() => setAsking(false)} disabled={busy}>{t("cancel", { defaultValue: "Cancel" })}</button>
        <button className="btn-primary flex-1 !bg-owed" onClick={() => void remove()} disabled={busy}>{t("deleteYes", { defaultValue: "Yes, delete" })}</button>
      </div>
    </div>
  );
}
