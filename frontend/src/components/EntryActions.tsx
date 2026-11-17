import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { norm } from "../lib/calc";
import { useFmt } from "../lib/format";
import type { HistoryEntry } from "../lib/types";

type PaidWith = { id: string; amount: string; mode: string; voided: boolean };

/*
 * Delete and PDF buttons. Self-contained on purpose: they only use lib/api, lib/format and the
 * button classes from index.css, so they can be dropped into any screen.
 *
 *   <DeleteEntryButton entry={e} paidWith={paidWith} onDone={onChanged} />   a bill or a payment
 *   <DeleteCustomerButton customer={...} onDeleted={() => nav("/")} />       the whole khata
 *   <PdfButton path={`/sales/${id}/pdf`} label="Bill (PDF)" />               one bill as a PDF
 *   <PdfButton path={`/customers/${id}/statement.pdf`} label="Statement (PDF)" />
 */

const errText = (x: unknown, offline: string) =>
  x instanceof Error ? (x.message === "Network unreachable" ? offline : x.message) : String(x);

/** Delete one bill or payment. Asks first, and says what goes with it. */
export function DeleteEntryButton({
  entry: e,
  paidWith,
  onDone,
  className = "btn-secondary flex-1",
}: {
  entry: HistoryEntry;
  /** the payment that was received together with this bill, if any */
  paidWith?: PaidWith;
  onDone: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const [asking, setAsking] = useState(false);
  const [withPayment, setWithPayment] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isSale = e.type === "sale";
  const what = isSale
    ? e.bill_no
      ? `${t("bill", { defaultValue: "Bill" })} ${e.bill_no}`
      : t("type_sale", { defaultValue: "Sale" })
    : t("type_payment", { defaultValue: "Payment" });

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      if (isSale) await api(`/sales/${e.id}?with_payment=${paidWith && withPayment ? "true" : "false"}`, { method: "DELETE" });
      else await api(`/payments/${e.id}`, { method: "DELETE" });
      onDone();
    } catch (x) {
      setErr(errText(x, t("needsConnection", { defaultValue: "Needs a connection" })));
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button className={`${className} !text-owed`} onClick={() => setAsking(true)}>
        {t("deleteEntry", { defaultValue: "Delete" })}
      </button>
    );
  }
  return (
    <div className="w-full basis-full rounded-xl bg-owedtint p-3" role="alertdialog" aria-label={t("deleteEntry", { defaultValue: "Delete" })}>
      <p className="text-sm font-semibold">
        {t("deleteEntryAsk", { defaultValue: "Delete {{what}} for {{amount}}?", what, amount: f.money(e.amount) })}
      </p>
      <p className="muted mt-1 text-xs">
        {t("deleteEntryNote", { defaultValue: "It is removed from the khata and the balance changes. This cannot be undone." })}
      </p>
      {isSale && paidWith && (
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={withPayment} onChange={(x) => setWithPayment(x.target.checked)} />
          <span>
            {t("deleteWithPayment", { defaultValue: "Also delete the {{amount}} received with this bill", amount: f.money(paidWith.amount) })}
          </span>
        </label>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-owed">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-secondary flex-1" disabled={busy} onClick={() => setAsking(false)}>
          {t("cancel", { defaultValue: "Cancel" })}
        </button>
        <button className="btn-primary flex-1 !bg-owed" disabled={busy} onClick={() => void remove()}>
          {t("deleteYes", { defaultValue: "Yes, delete" })}
        </button>
      </div>
    </div>
  );
}

/** Delete a customer and their whole khata. The owner types the name again to confirm. */
export function DeleteCustomerButton({
  customer,
  onDeleted,
}: {
  customer: { id: string; name: string; balance: string };
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const owes = parseFloat(customer.balance) > 0;

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/customers/${customer.id}?confirm_name=${encodeURIComponent(typed.trim())}`, { method: "DELETE" });
      onDeleted();
    } catch (x) {
      setErr(errText(x, t("needsConnection", { defaultValue: "Needs a connection" })));
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button className="btn-secondary !text-owed" onClick={() => setAsking(true)}>
        {t("deleteCustomer", { defaultValue: "Delete customer" })}
      </button>
    );
  }
  return (
    <div className="mt-3 w-full basis-full rounded-xl bg-owedtint p-3" role="alertdialog">
      <p className="text-sm font-semibold">
        {t("deleteCustomerAsk", { defaultValue: "Delete {{name}} and the whole khata?", name: customer.name })}
      </p>
      <p className="mt-1 text-sm">
        {t("deleteCustomerNote", {
          defaultValue: "Every bill and payment of this customer is erased and cannot be brought back from the app.",
        })}
        {owes && (
          <strong className="block text-owed">
            {t("deleteCustomerOwes", { defaultValue: "He still owes {{amount}}.", amount: f.money(customer.balance) })}
          </strong>
        )}
      </p>
      <label className="mt-3 block text-sm">
        {t("typeNameToConfirm", { defaultValue: "Type the name to confirm: {{name}}", name: customer.name })}
        <input
          className="field mt-1"
          value={typed}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(x) => setTyped(x.target.value)}
        />
      </label>
      {err && <p role="alert" className="mt-2 text-sm text-owed">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-secondary flex-1" disabled={busy} onClick={() => setAsking(false)}>
          {t("cancel", { defaultValue: "Cancel" })}
        </button>
        <button
          className="btn-primary flex-1 !bg-owed"
          disabled={busy || norm(typed) !== norm(customer.name)}
          onClick={() => void remove()}
        >
          {t("deleteForever", { defaultValue: "Delete forever" })}
        </button>
      </div>
    </div>
  );
}
