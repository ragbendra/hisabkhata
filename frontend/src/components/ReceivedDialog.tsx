import { useState } from "react";
import { useTranslation } from "react-i18next";
import BsDatePicker from "./BsDatePicker";
import { Modal } from "./ui";
import { addDays, parseNum, todayNpl } from "../lib/calc";
import { db } from "../lib/db";
import type { LastSaved } from "../lib/draft";
import { useFmt } from "../lib/format";
import { flushOutbox } from "../lib/sync";
import { PAY_MODES, type EntryPayload, type PayMode } from "../lib/types";

/*
 * "Received" on the customer page: a small box with only what is needed to record money coming in.
 *   <ReceivedDialog customerId={s.id} customerName={s.name} owner={owner} onClose={...} onDone={invalidate} />
 * It is saved the same way as a normal entry (on the phone first, then sent), so it also works offline.
 * Only the owner can pick an earlier date, like on the New entry page.
 */
export default function ReceivedDialog({
  customerId,
  customerName,
  owner,
  onClose,
  onDone,
}: {
  customerId: string;
  customerName: string;
  owner: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const today = todayNpl();
  const yesterday = addDays(today, -1);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"payment" | "discount">("payment");
  const [mode, setMode] = useState<PayMode>("cash");
  const [note, setNote] = useState("");
  const [date, setDate] = useState<string | null>(null); // null = today
  const [pickDate, setPickDate] = useState(false);
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const n = parseNum(amount);
  const ok = Number.isFinite(n) && n > 0;
  const futureErr = owner && !!date && date > today;
  const chip = (on: boolean) => `chip ${on ? "chip-on" : ""}`;
  const otherOn = pickDate || (!!date && date !== today && date !== yesterday);

  async function save() {
    setShowErr(true);
    if (!ok || futureErr || busy) return;
    setBusy(true);
    const saveId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const payload: EntryPayload = {
      customer_id: customerId,
      created_at: new Date().toISOString(),
      payment_id: paymentId,
      received_amount: n.toFixed(2),
      kind: owner ? kind : "payment",
      mode: owner && kind === "discount" ? "other" : mode,
    };
    if (note.trim()) payload.note = note.trim();
    if (owner && date && date !== today) payload.entry_date = date;
    const last: LastSaved = { saveId, paymentId, name: customerName, savedAt: Date.now() };
    await db.transaction("rw", db.outbox, db.drafts, async () => {
      await db.outbox.put({
        id: saveId,
        payload,
        queuedAt: Date.now(),
        attempts: 0,
        summary: { customerName, total: 0, received: n, billNo: null, isNewCustomer: false },
      });
      await db.drafts.put({ key: "last-saved", data: last, updatedAt: Date.now() });
    });
    onClose();
    try {
      await flushOutbox();
    } catch {
      /* stays on the phone and is sent when online */
    }
    onDone?.();
  }

  return (
    <Modal title={`${t("receivedNow")} · ${customerName}`} onClose={onClose}>
      <div className="space-y-3">
        {owner && (
          <div className="flex gap-2">
            <button type="button" className={chip(kind === "payment")} onClick={() => setKind("payment")}>{t("payment")}</button>
            <button type="button" className={chip(kind === "discount")} onClick={() => setKind("discount")}>{t("discount")}</button>
          </div>
        )}
        <input
          className="field"
          inputMode="decimal"
          autoFocus
          aria-label={t("receivedNow")}
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={showErr && !ok}
        />
        {showErr && !ok && <p role="alert" className="text-sm text-owed">{t("badNumber")}</p>}
        {kind === "payment" || !owner ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("mode")}>
            {PAY_MODES.map((m) => (
              <button key={m} type="button" className={chip(mode === m)} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {t(`mode_${m}`)}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{t("discountHelp")}</p>
        )}
        {owner && (
          <div className="space-y-2">
            <span className="label">{t("date")}</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chip(!date || date === today)} onClick={() => { setPickDate(false); setDate(null); }}>{t("dateToday")}</button>
              <button type="button" className={chip(date === yesterday)} onClick={() => { setPickDate(false); setDate(yesterday); }}>{t("dateYesterday")}</button>
              <button type="button" className={chip(otherOn)} onClick={() => { setPickDate(true); setDate(date ?? yesterday); }}>{t("dateOther")}</button>
            </div>
            {otherOn && <BsDatePicker value={date ?? today} onChange={(d) => setDate(d === today ? null : d)} yearsBack={5} yearsForward={0} />}
            {date && <p className="font-medium">{f.date(date)}</p>}
            {futureErr && <p role="alert" className="text-sm text-owed">{t("futureDate")}</p>}
          </div>
        )}
        <input className="field" aria-label={t("note")} placeholder={t("note")} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary w-full" disabled={busy} onClick={() => void save()}>{t("save")}</button>
      </div>
    </Modal>
  );
}
