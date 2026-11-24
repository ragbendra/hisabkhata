import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { parseNum } from "../lib/calc";
import { useTrackCrates } from "../lib/crates";
import { useFmt } from "../lib/format";
import type { HistoryEntry } from "../lib/types";
import { SelectedPdfButton } from "./PdfActions";
import { Spinner } from "./ui";

/*
 * A short customer ledger, with selection.
 *
 * Drop-in for <Ledger />, same props plus two optional ones:
 *   <LedgerCompact entries={...} loading={...} focusSale={focusSale} onOpen={setOpen}
 *                  canSelect={owner} onChanged={invalidate} />
 *
 * - Oldest first. The latest RECENT lines (at the bottom) are shown in full. Everything older is folded into one line per month
 *   (with that month's debit and credit); tap a month to open it. A long history stays one screen.
 * - Owners get "Select": tick bills, payments and old balances (or a whole month) and delete them together.
 *   A bill and the money taken with it are one line and are selected together.
 */

const RECENT = 10;

interface Row {
  e: HistoryEntry;
  debit: number;
  credit: number;
  creditVoided: boolean;
  balance: number;
  paidMode: string | null;
  also?: string; // the payment received with this bill
  cOut: number; // crates handed over
  cIn: number; // crates handed back
  cBal: number; // crates he still holds after this line
}

const keyOf = (type: HistoryEntry["type"], id: string) => `${type === "discount" || type === "crates" ? "payment" : type}:${id}`;
const rowKeys = (r: Row) => [keyOf(r.e.type, r.e.id), ...(r.also ? [keyOf("payment", r.also)] : [])];

function buildRows(entries: HistoryEntry[]): Row[] {
  const at = new Map(entries.map((e, i) => [e.id, i]));
  const out: Row[] = [];
  entries.forEach((e, i) => {
    if ((e.type === "payment" || e.type === "crates") && e.with_sale && at.has(e.with_sale)) return; // shown on the bill's line
    const amount = parseNum(e.amount);
    let row: Row = {
      e, debit: 0, credit: 0, creditVoided: false, balance: parseNum(e.balance_after), paidMode: null,
      cOut: e.crates_out ?? 0, cIn: e.crates_in ?? 0, cBal: e.crates_after ?? 0,
    };
    if (e.type === "sale") {
      const pw = e.paid_with;
      const paid = pw ? parseNum(pw.amount) : 0;
      const counted = pw && !pw.voided ? paid : 0;
      row = {
        ...row,
        debit: Math.max(amount - counted, 0),
        credit: paid,
        creditVoided: !!pw?.voided,
        paidMode: pw && !pw.voided ? pw.mode : null,
        also: pw?.id,
      };
      const pi = pw ? at.get(pw.id) : undefined;
      if (pw && pi !== undefined && pi > i) row.balance = parseNum(entries[pi].balance_after);
      if (pw && !pw.voided) {
        // crates handed back with this bill sit on the same line
        row.cIn += pw.crates_in ?? 0;
        row.cOut += pw.crates_out ?? 0;
        if (pw.crates_after !== undefined) row.cBal = pw.crates_after;
      }
    } else if (e.type === "opening") {
      row = amount >= 0 ? { ...row, debit: amount } : { ...row, credit: -amount };
    } else {
      row = { ...row, credit: amount, creditVoided: e.voided, paidMode: e.type === "payment" ? (e.mode ?? "cash") : null };
      if (e.voided) row = { ...row, cOut: 0, cIn: 0 };
    }
    out.push(row);
  });
  return out;
}

export default function LedgerCompact({
  entries,
  loading,
  focusSale,
  onOpen,
  canSelect = false,
  onChanged,
  customerId,
}: {
  entries: HistoryEntry[];
  loading: boolean;
  focusSale: string | null;
  onOpen: (e: HistoryEntry) => void;
  canSelect?: boolean;
  onChanged?: () => void;
  /** with it, picked lines can also be exported as a PDF */
  customerId?: string;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const track = useTrackCrates();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // oldest first, like the paper ledger: old months folded at the top, the latest lines at the bottom
  const rows = useMemo(() => buildRows(entries), [entries]);
  const splitAt = Math.max(0, rows.length - RECENT);
  const older = useMemo(() => rows.slice(0, splitAt), [rows, splitAt]);
  const recent = rows.slice(splitAt);

  const months = useMemo(() => {
    const groups: { key: string; label: string; rows: Row[]; debit: number; credit: number; cOut: number; cIn: number }[] = [];
    for (const r of older) {
      const b = f.ymd(r.e.date);
      const key = `${b.y}-${b.m}`;
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: `${f.monthName(b.m)} ${f.digits(b.y)}`, rows: [], debit: 0, credit: 0, cOut: 0, cIn: 0 };
        groups.push(g);
      }
      g.rows.push(r);
      g.debit += r.debit;
      g.credit += r.credit;
      g.cOut += r.cOut;
      g.cIn += r.cIn;
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [older]);

  const keysOf = (rows: Row[]) => rows.flatMap(rowKeys);
  const allKeys = useMemo(() => keysOf(rows), [rows]);
  const toggleRows = (rows: Row[]) => {
    const ks = keysOf(rows);
    setPicked((p) => {
      const n = new Set(p);
      const all = ks.every((k) => n.has(k));
      ks.forEach((k) => (all ? n.delete(k) : n.add(k)));
      return n;
    });
  };
  const stop = () => {
    setSelecting(false);
    setPicked(new Set());
    setAsking(false);
    setErr(null);
  };

  // a bill opened from elsewhere must be on screen: open the month that holds it
  const focusMonth = focusSale ? months.find((g) => g.rows.some((r) => r.e.id === focusSale || r.also === focusSale))?.key : undefined;
  const isOpen = (key: string) => openMonths.has(key) || key === focusMonth;

  async function remove() {
    setBusy(true);
    setErr(null);
    const ids = (kind: string) => [...picked].filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1));
    try {
      await api("/entries/bulk-delete", { body: { sales: ids("sale"), payments: ids("payment"), openings: ids("opening") } });
      stop();
      onChanged?.();
    } catch (x) {
      setErr(x instanceof Error && x.message === "Network unreachable" ? t("needsConnection", { defaultValue: "Needs a connection" }) : String(x instanceof Error ? x.message : x));
    } finally {
      setBusy(false);
    }
  }

  const mode = (m: string) => {
    if (m === "cash") return t("mode_cash");
    if (m === "esewa" || m === "khalti" || m === "bank") return `${t("online")} · ${t(`mode_${m}`)}`;
    return t("mode_other");
  };
  const particulars = (r: Row) => {
    const e = r.e;
    if (e.type === "sale") {
      const head = e.bill_no ? `${t("bill")} ${f.digits(e.bill_no)}` : t("type_sale");
      const items = (e.lines ?? []).map((l) => `${l.fruit_name} ${f.kg(l.kg)} ${t("kg")}`).join(", ");
      return { head, tag: r.paidMode ? mode(r.paidMode) : t("onCredit"), items };
    }
    if (e.type === "payment") return { head: t("type_payment"), tag: mode(e.mode ?? "cash"), items: e.note ?? "" };
    if (e.type === "discount") return { head: t("type_discount"), tag: null, items: e.note ?? "" };
    if (e.type === "crates") return { head: e.crates_in ? t("cratesReturned", { defaultValue: "Crates returned" }) : t("cratesGiven", { defaultValue: "Crates given" }), tag: null, items: e.note ?? "" };
    return { head: t("openingBalance"), tag: null, items: "" };
  };

  const th = `${track ? "px-0.5 !text-[10px]" : "px-1.5"} py-2 text-[11px] font-bold uppercase tracking-wide text-brand`;
  const num = `whitespace-nowrap border-l border-rule ${track ? "px-0.5 text-[11px]" : "px-1.5 text-[13px]"} py-2 text-right align-top font-serif font-semibold`;
  const cnum = "whitespace-nowrap border-l border-rule/60 px-0.5 py-2 text-right align-top text-[11px] font-semibold";
  const isPicked = (r: Row) => rowKeys(r).every((k) => picked.has(k));

  const line = (r: Row) => {
    const e = r.e;
    const p = particulars(r);
    const b = f.ymd(e.date);
    const dead = e.voided;
    const hot = focusSale === e.id || (!!focusSale && focusSale === r.also);
    const on = selecting && isPicked(r);
    return (
      <tr
        key={e.id}
        id={`entry-${e.id}`}
        onClick={() => (selecting ? toggleRows([r]) : onOpen(e))}
        className={`cursor-pointer border-b border-rule hover:bg-tint ${hot || on ? "bg-tint" : ""} ${dead ? "opacity-60" : ""}`}
      >
        {selecting && (
          <td className="w-8 pl-2 align-middle">
            <input type="checkbox" className="h-5 w-5" checked={on} readOnly aria-label={`${f.date(e.date)}, ${p.head}`} />
          </td>
        )}
        <td className={`whitespace-nowrap ${track ? "px-0.5" : "px-1.5"} py-2 text-center align-top leading-tight`}>
          <div className={`font-serif text-base font-semibold ${dead ? "line-through" : ""}`}>{f.digits(b.d)}</div>
          <div className="text-[11px] text-muted">{f.monthName(b.m)}</div>
          <div className="text-[11px] text-muted">{f.digits(b.y)}</div>
        </td>
        <td className={`border-l border-rule ${track ? "px-1" : "px-1.5"} py-2 align-top ${track ? "text-[12px]" : ""}`}>
          <span className={`block text-[13px] font-semibold leading-snug ${dead ? "line-through" : ""}`}>{p.head}</span>
          {(p.tag || dead) && (
            <span className="mt-0.5 block text-xs font-medium text-brand">{dead ? <span className="text-owed">{t("voided")}</span> : p.tag}</span>
          )}
          {p.items && <span className={`mt-0.5 line-clamp-2 block text-xs text-muted ${dead ? "line-through" : ""}`}>{p.items}</span>}
        </td>
        <td className={`${num} text-owed ${dead ? "line-through" : ""}`}>{r.debit > 0 ? f.num(r.debit) : ""}</td>
        {track && <td className={`${cnum} text-owed ${dead ? "line-through" : ""}`}>{r.cOut > 0 ? f.digits(r.cOut) : ""}</td>}
        <td className={`${num} text-recv ${dead || r.creditVoided ? "line-through" : ""}`}>{r.credit > 0 ? f.num(r.credit) : ""}</td>
        {track && <td className={`${cnum} text-recv ${dead ? "line-through" : ""}`}>{r.cIn > 0 ? f.digits(r.cIn) : ""}</td>}
        <td className={`${num} !font-bold ${r.balance < 0 ? "text-advance" : ""}`}>
          {r.balance < 0 ? "−" : ""}
          {f.num(Math.abs(r.balance))}
        </td>
        {track && <td className={`${cnum} !font-bold`}>{f.digits(r.cBal)}</td>}
      </tr>
    );
  };

  const cols = (selecting ? 6 : 5) + (track ? 3 : 0);
  const count = picked.size;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="muted">{t("ledgerHintShort", { defaultValue: "Older months are folded at the top; tap one to open it." })}</p>
        {canSelect && entries.length > 0 && (
          <button className="min-h-touch shrink-0 text-sm text-brand underline" onClick={() => (selecting ? stop() : setSelecting(true))}>
            {selecting ? t("cancel", { defaultValue: "Cancel" }) : t("select", { defaultValue: "Select" })}
          </button>
        )}
      </div>
      {selecting && (
        <div className="mb-2 flex items-center gap-3 text-sm">
          <button className="text-brand underline" onClick={() => setPicked(new Set(allKeys.length === count ? [] : allKeys))}>
            {allKeys.length === count ? t("selectNone", { defaultValue: "Select none" }) : t("selectAll", { defaultValue: "Select all" })}
          </button>
          <span className="muted">{t("selectedCount", { defaultValue: "{{n}} selected", n: f.digits(count) })}</span>
        </div>
      )}

      {loading && <Spinner />}

      <div className="-mx-3 overflow-hidden rounded-2xl border-l-[3px] border-gold bg-paper ring-1 ring-rule">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-paper2">
              <tr className={`${track ? "" : "border-b-[3px] border-double border-brand"} text-left`}>
                {selecting && <th className="w-8" rowSpan={track ? 2 : 1} />}
                <th className={`${th} text-center`} rowSpan={track ? 2 : 1}>{t("date")}</th>
                <th className={`${th} w-full border-l border-rule`} rowSpan={track ? 2 : 1}>{t("ledgerParticulars")}</th>
                <th className={`${th} border-l border-rule ${track ? "text-center" : "text-right"}`} colSpan={track ? 2 : 1}>{t("ledgerDebit")}</th>
                <th className={`${th} border-l border-rule ${track ? "text-center" : "text-right"}`} colSpan={track ? 2 : 1}>{t("ledgerCredit")}</th>
                <th className={`${th} border-l border-rule ${track ? "text-center" : "text-right"}`} colSpan={track ? 2 : 1}>{t("ledgerBalance")}</th>
              </tr>
              {track && (
                <tr className="border-b-[3px] border-double border-brand text-right text-[10px] font-bold uppercase text-muted">
                  {["rs", "crates", "rs", "crates", "rs", "crates"].map((c, i) => (
                    <th key={i} className="border-l border-rule/60 px-1 py-1">{c === "rs" ? "Rs" : t("crates")}</th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {months.map((g) => (
                <MonthRows
                  key={g.key}
                  cols={cols}
                  label={g.label}
                  count={g.rows.length}
                  debit={g.debit}
                  credit={g.credit}
                  crates={track ? { out: g.cOut, back: g.cIn } : undefined}
                  open={isOpen(g.key)}
                  selecting={selecting}
                  allPicked={g.rows.every(isPicked)}
                  onToggleOpen={() =>
                    setOpenMonths((s) => {
                      const n = new Set(s);
                      if (n.has(g.key)) n.delete(g.key);
                      else n.add(g.key);
                      return n;
                    })
                  }
                  onPickAll={() => toggleRows(g.rows)}
                >
                  {g.rows.map(line)}
                </MonthRows>
              ))}
              {recent.map(line)}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && rows.length === 0 && <p className="muted mt-3">{t("noEntries")}</p>}
      <p className="muted mt-2 text-xs">{t("ledgerUnit")}</p>

      {selecting && count > 0 && (
        <div className="sticky bottom-24 z-10 mt-3 rounded-2xl bg-surface p-3 shadow-lg ring-1 ring-line">
          {!asking ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{t("selectedCount", { defaultValue: "{{n}} selected", n: f.digits(count) })}</span>
              <div className="flex items-center gap-2">
                {customerId && <SelectedPdfButton customerId={customerId} keys={[...picked]} />}
                <button className="btn-primary !bg-owed !min-h-[44px] px-5" onClick={() => setAsking(true)}>
                  {t("deleteEntry", { defaultValue: "Delete" })}
                </button>
              </div>
            </div>
          ) : (
            <div role="alertdialog">
              <p className="text-sm font-semibold">
                {t("deleteManyAsk", { defaultValue: "Delete {{n}} selected records?", n: f.digits(count) })}
              </p>
              <p className="muted mt-1 text-xs">
                {t("deleteManyNote", { defaultValue: "They are removed from the khata and the balance changes. This cannot be undone." })}
              </p>
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
          )}
        </div>
      )}
    </section>
  );
}

function MonthRows({
  cols, label, count, debit, credit, crates, open, selecting, allPicked, onToggleOpen, onPickAll, children,
}: {
  cols: number;
  label: string;
  count: number;
  debit: number;
  credit: number;
  crates?: { out: number; back: number };
  open: boolean;
  selecting: boolean;
  allPicked: boolean;
  onToggleOpen: () => void;
  onPickAll: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  return (
    <>
      <tr className="border-b border-rule bg-paper2">
        <td colSpan={cols} className="px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <button className="flex min-h-touch flex-1 items-center gap-2 text-left" aria-expanded={open} onClick={onToggleOpen}>
              <span aria-hidden className="text-brand">{open ? "▾" : "▸"}</span>
              <span>
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-muted">
                  {f.digits(count)} {count === 1 ? t("entryOne", { defaultValue: "entry" }) : t("entries", { defaultValue: "entries" })} · {t("ledgerDebit")} <span className="text-owed">{f.num(debit)}</span> · {t("ledgerCredit")}{" "}
                  <span className="text-recv">{f.num(credit)}</span>
                  {crates && (crates.out > 0 || crates.back > 0) && (
                    <>
                      {" · "}{t("crates")} <span className="text-owed">{f.digits(crates.out)}</span> / <span className="text-recv">{f.digits(crates.back)}</span>
                    </>
                  )}
                </span>
              </span>
            </button>
            {selecting && (
              <button className="shrink-0 text-xs text-brand underline" onClick={onPickAll}>
                {allPicked ? t("selectNone", { defaultValue: "Select none" }) : t("selectMonth", { defaultValue: "Select month" })}
              </button>
            )}
          </div>
        </td>
      </tr>
      {open && children}
    </>
  );
}
