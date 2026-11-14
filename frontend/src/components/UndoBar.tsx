import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { db } from "../lib/db";
import { UNDO_MS, type LastSaved } from "../lib/draft";
import { undoEntry } from "../lib/sync";
import { useFmt } from "../lib/format";

/** FR-12: for 10 minutes after saving, the person who made the entry can undo it (the entry is voided). */
export default function UndoBar() {
  const { t } = useTranslation();
  const f = useFmt();
  const row = useLiveQuery(() => db.drafts.get("last-saved"), []);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const last = row?.data as LastSaved | undefined;
  if (!last || now - last.savedAt > UNDO_MS) return null;
  const minutes = Math.max(1, Math.ceil((UNDO_MS - (now - last.savedAt)) / 60000));

  async function undo() {
    if (!last) return;
    setBusy(true);
    setError(null);
    try {
      await undoEntry(last.saveId, { sale: last.saleId, payment: last.paymentId });
      await db.drafts.delete("last-saved");
    } catch (e) {
      setError(e instanceof Error && e.message === "Network unreachable" ? t("undoNeedsConnection") : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-3 flex items-center justify-between gap-3 bg-warntint">
      <div className="min-w-0 text-sm">
        <div className="truncate font-medium">{t("justSaved", { name: last.name })}</div>
        <div className="muted">{t("undoFor", { n: f.digits(minutes) })}</div>
        {error && <div className="text-owed">{error}</div>}
      </div>
      <button className="btn-secondary shrink-0" disabled={busy} onClick={undo}>
        {t("undo")}
      </button>
    </div>
  );
}
