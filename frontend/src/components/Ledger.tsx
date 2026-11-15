import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adToBs } from "../lib/bs";
import { parseNum } from "../lib/calc";
import { useFmt } from "../lib/format";
import type { HistoryEntry } from "../lib/types";
import { Spinner } from "./ui";

const PAGE = 60;

interface Row {
  e: HistoryEntry;
  debit: number; // still to be paid on this line
  credit: number; // paid on this line
  creditVoided: boolean;
  balance: number; // total left to collect after this line
  paidMode: string | null; // how the money paid with a bill came in
  also?: string; // id of the payment that was received with this bill
}

/**
 * The customer's khata as a paper ledger page: Date | Particulars | Debit | Credit | Balance.
 *
 * Debit is what is still to be paid, credit is what has been paid. A bill of 10,000 paid 3,000 on
 * the spot is one line: debit 7,000, credit 3,000. Instalments that follow are credit-only lines.
 * Every line opens the full bill (items, kg, rate, who entered it, edit and void).
 * `entries` come oldest first, each with the balance left after it.
 */
export default function Ledger({
  entries,
  loading,
  focusSale,
  onOpen,
}: {
  entries: HistoryEntry[];
  loading: boolean;
  focusSale: string | null;
  onOpen: (e: HistoryEntry) => void;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const [newestFirst, setNewestFirst] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const at = new Map(entries.map((e, i) => [e.id, i]));
    const out: Row[] = [];
    entries.forEach((e, i) => {
      // money received together with a bill is shown on the bill's own line
      if (e.type === "payment" && e.with_sale && at.has(e.with_sale)) return;
      const amount = parseNum(e.amount);
      let row: Row = { e, debit: 0, credit: 0, creditVoided: false, balance: parseNum(e.balance_after), paidMode: null };
      if (e.type === "sale") {
        const pw = e.paid_with;
        const paid = pw ? parseNum(pw.amount) : 0;
        const counted = pw && !pw.voided ? paid : 0; // a voided payment no longer reduces what is owed
        row = {
          ...row,
          debit: Math.max(amount - counted, 0),
          credit: paid,
          creditVoided: !!pw?.voided,
          paidMode: pw && !pw.voided ? pw.mode : null,
          also: pw?.id,
        };
        // the line ends where the later of the two records ends
        const pi = pw ? at.get(pw.id) : undefined;
        if (pw && pi !== undefined && pi > i) row.balance = parseNum(entries[pi].balance_after);
      } else if (e.type === "opening") {
        row = amount >= 0 ? { ...row, debit: amount } : { ...row, credit: -amount };
      } else {
        row = { ...row, credit: amount, creditVoided: e.voided, paidMode: e.type === "payment" ? (e.mode ?? "cash") : null };
      }
      out.push(row);
    });
    return out;
  }, [entries]);

  const ordered = newestFirst ? [...rows].reverse() : rows;
  // a bill tapped elsewhere in the app must be on screen, so no page limit then
  const shown = focusSale ? ordered : ordered.slice(0, limit);

  /** "Cash" or "Online · eSewa": how money came in, in words. */
  const mode = (m: string) => {
    if (m === "cash") return t("mode_cash");
    if (m === "esewa" || m === "khalti" || m === "bank") return `${t("online")} · ${t(`mode_${m}`)}`;
    return t("mode_other");
  };

  const particulars = (r: Row): { head: string; tag: string | null; items: string } => {
    const e = r.e;
    if (e.type === "sale") {
      const head = e.bill_no ? `${t("bill")} ${f.digits(e.bill_no)}` : t("type_sale");
      const items = (e.lines ?? []).map((l) => `${l.fruit_name} ${f.kg(l.kg)} ${t("kg")}`).join(", ");
      return { head, tag: r.paidMode ? mode(r.paidMode) : t("onCredit"), items };
    }
    if (e.type === "payment") return { head: t("type_payment"), tag: mode(e.mode ?? "cash"), items: e.note ?? "" };
    if (e.type === "discount") return { head: t("type_discount"), tag: null, items: e.note ?? "" };
    return { head: t("openingBalance"), tag: null, items: "" };
  };

  const th = "px-1.5 py-2 text-[11px] font-bold uppercase tracking-wide text-brand";
  const num = "whitespace-nowrap border-l border-rule px-1.5 py-2 text-right align-top font-serif text-[13px] font-semibold";

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="muted">{t("ledgerHint")}</p>
        <button className="min-h-touch shrink-0 text-sm text-brand underline" onClick={() => setNewestFirst(!newestFirst)}>
          {newestFirst ? t("newestFirst") : t("oldestFirst")} ⇅
        </button>
      </div>

      {loading && <Spinner />}

      {/* the page: pale green paper, pine ruling, a brass edge like the spine of a book */}
      <div className="-mx-3 overflow-hidden rounded-2xl border-l-[3px] border-gold bg-paper ring-1 ring-rule">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-paper2">
              <tr className="border-b-[3px] border-double border-brand text-left">
                <th className={`${th} text-center`}>{t("date")}</th>
                <th className={`${th} w-full border-l border-rule`}>{t("ledgerParticulars")}</th>
                <th className={`${th} border-l border-rule text-right`}>{t("ledgerDebit")}</th>
                <th className={`${th} border-l border-rule text-right`}>{t("ledgerCredit")}</th>
                <th className={`${th} border-l border-rule text-right`}>{t("ledgerBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const e = r.e;
                const p = particulars(r);
                const b = adToBs(e.date);
                const hot = focusSale === e.id || (!!focusSale && focusSale === r.also);
                const dead = e.voided;
                return (
                  <tr
                    key={e.id}
                    id={`entry-${e.id}`}
                    onClick={() => onOpen(e)}
                    className={`cursor-pointer border-b border-rule hover:bg-tint ${hot ? "bg-tint" : ""} ${dead ? "opacity-60" : ""}`}
                  >
                    <td className="whitespace-nowrap px-1.5 py-2 text-center align-top leading-tight">
                      <div className={`font-serif text-base font-semibold ${dead ? "line-through" : ""}`}>{f.digits(b.d)}</div>
                      <div className="text-[11px] text-muted">{f.monthName(b.m)}</div>
                      <div className="text-[11px] text-muted">{f.digits(b.y)}</div>
                    </td>
                    <td className="border-l border-rule px-1.5 py-2 align-top">
                      {/* a real button inside the row, so the keyboard and screen readers can open it too */}
                      <button className="block w-full text-left" aria-label={`${f.date(e.date)}, ${p.head}`}>
                        <span className={`block text-[13px] font-semibold leading-snug ${dead ? "line-through" : ""}`}>{p.head}</span>
                        {(p.tag || dead) && (
                          <span className="mt-0.5 block text-xs font-medium text-brand">
                            {dead ? <span className="text-owed">{t("voided")}</span> : p.tag}
                          </span>
                        )}
                        {p.items && <span className={`mt-0.5 line-clamp-3 block text-xs text-muted ${dead ? "line-through" : ""}`}>{p.items}</span>}
                      </button>
                    </td>
                    <td className={`${num} text-owed ${dead ? "line-through" : ""}`}>{r.debit > 0 ? f.num(r.debit) : ""}</td>
                    <td className={`${num} text-recv ${dead || r.creditVoided ? "line-through" : ""}`}>{r.credit > 0 ? f.num(r.credit) : ""}</td>
                    <td className={`${num} !font-bold ${r.balance < 0 ? "text-advance" : ""}`}>
                      {r.balance < 0 ? "−" : ""}
                      {f.num(Math.abs(r.balance))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && rows.length === 0 && <p className="muted mt-3">{t("noEntries")}</p>}
      {!focusSale && ordered.length > limit && (
        <button className="btn-secondary mt-3 w-full" onClick={() => setLimit(limit + PAGE)}>
          {t("showMore")} ({f.digits(ordered.length - limit)})
        </button>
      )}
      <p className="muted mt-2 text-xs">{t("ledgerUnit")}</p>
    </section>
  );
}
