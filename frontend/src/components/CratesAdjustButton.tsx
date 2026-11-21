import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useTrackCrates } from "../lib/crates";
import { CratesField, parseCrates } from "./CratesFields";

/*
 * "Crates" button for the customer page: record crates coming back, or crates handed out without a bill
 * (for example the crates he already held before you started using the app).
 *   <CratesAdjustButton customerId={s.id} onDone={invalidate} />
 */
export default function CratesAdjustButton({ customerId, onDone, className = "btn-secondary w-full" }: { customerId: string; onDone?: () => void; className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const track = useTrackCrates();
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"back" | "lent">("back");
  const [n, setN] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!track) return null;

  const count = parseCrates(n);
  const ok = count !== null && count > 0;

  async function save() {
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/entries", {
        body: {
          customer_id: customerId,
          payment_id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          ...(dir === "back" ? { crates_back: count } : { crates_lent: count }),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setOpen(false);
      setN("");
      setNote("");
      await qc.invalidateQueries();
      onDone?.();
    } catch (x) {
      setErr(x instanceof Error && x.message === "Network unreachable" ? t("needsConnection", { defaultValue: "Needs a connection" }) : String(x instanceof Error ? x.message : x));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className={className} onClick={() => setOpen(true)}>
        {t("cratesButton", { defaultValue: "Crates in / out" })}
      </button>
    );
  return (
    <div className="card space-y-3" role="group" aria-label={t("cratesButton", { defaultValue: "Crates in / out" })}>
      <div className="flex gap-2">
        <button type="button" className={`chip ${dir === "back" ? "chip-on" : ""}`} aria-pressed={dir === "back"} onClick={() => setDir("back")}>
          {t("cratesDirBack", { defaultValue: "He gave back" })}
        </button>
        <button type="button" className={`chip ${dir === "lent" ? "chip-on" : ""}`} aria-pressed={dir === "lent"} onClick={() => setDir("lent")}>
          {t("cratesDirLent", { defaultValue: "I gave him" })}
        </button>
      </div>
      <CratesField id="adjcrates" label={t("cratesCount", { defaultValue: "Number of crates" })} value={n} onChange={setN} showError />
      <input className="field" maxLength={300} placeholder={t("noteOptional", { defaultValue: "Note (optional)" })} value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p role="alert" className="text-sm text-owed">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={busy}>{t("cancel", { defaultValue: "Cancel" })}</button>
        <button className="btn-primary flex-1" onClick={() => void save()} disabled={!ok || busy}>{t("save")}</button>
      </div>
    </div>
  );
}
