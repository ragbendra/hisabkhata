import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { adToBs } from "../lib/bs";
import { norm } from "../lib/calc";
import { useFmt } from "../lib/format";
import type { HistoryEntry } from "../lib/types";
import { IconChevron, IconSearch } from "./icons";
import { Balance, Section, Spinner } from "./ui";

type View = "ledger" | "bills" | "payments";
const PAGE = 40;

const monthKey = (ad: string) => {
  const b = adToBs(ad);
  return `${b.y}-${String(b.m).padStart(2, "0")}`;
};

const TAG: Record<HistoryEntry["type"], string> = {
  sale: "bg-tint text-muted",
  payment: "bg-tint text-recv",
  discount: "bg-tint text-advance",
  crates: "bg-tint text-brand",
  opening: "bg-warntint text-warn",
};

/**
 * The customer's history, kept short enough to read on a phone:
 * grouped by BS month (latest month open), one compact line per entry, three views
 * (Ledger = everything, Bills = what was sold in full, Payments), search, and a per-fruit summary.
 * `entries` come oldest first, each with the balance left after it.
 */
export default function HistoryPanel({
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
  const [view, setView] = useState<View>("ledger");
  const [q, setQ] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [showFruits, setShowFruits] = useState(false);

  const search = norm(q);
  const latestKey = entries.length ? monthKey(entries[entries.length - 1].date) : "";
  const focusEntry = focusSale ? entries.find((e) => e.id === focusSale) : undefined;
  const focusKey = focusEntry ? monthKey(focusEntry.date) : "";

  // Month totals use every entry, so they do not change when a view or a search is applied.
  const months = useMemo(() => {
    const m = new Map<string, { sold: number; received: number; end: string }>();
    for (const e of entries) {
      const k = monthKey(e.date);
      const cur = m.get(k) ?? { sold: 0, received: 0, end: e.balance_after };
      if (!e.voided) {
        if (e.type === "sale") cur.sold += parseFloat(e.amount);
        if (e.type === "payment") cur.received += parseFloat(e.amount);
      }
      cur.end = e.balance_after;
      m.set(k, cur);
    }
    return m;
  }, [entries]);

  // What he buys: fruit totals over the whole history (voided bills excluded).
  const fruits = useMemo(() => {
    const m = new Map<string, { name: string; kg: number; amount: number; lastRate: string; lastDate: string }>();
    for (const e of entries) {
      if (e.type !== "sale" || e.voided) continue;
      for (const l of e.lines ?? []) {
        const k = norm(l.fruit_name);
        const cur = m.get(k) ?? { name: l.fruit_name, kg: 0, amount: 0, lastRate: l.rate, lastDate: e.date };
        cur.kg += parseFloat(l.kg);
        cur.amount += parseFloat(l.amount);
        cur.lastRate = l.rate;
        cur.lastDate = e.date;
        m.set(k, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [entries]);

  const shown = useMemo(() => {
    let rows = entries.filter((e) => {
      if (view === "bills" && e.type !== "sale") return false;
      if (view === "payments" && e.type !== "payment" && e.type !== "discount") return false;
      if (!search) return true;
      const hay = [e.bill_no, e.note, e.mode, ...(e.lines ?? []).map((l) => l.fruit_name)].map(norm).join(" ");
      return hay.includes(search);
    });
    if (newestFirst) rows = [...rows].reverse();
    return rows;
  }, [entries, view, search, newestFirst]);

  // a tapped bill from elsewhere must be on screen, so no page limit then
  const visible = focusSale || search ? shown : shown.slice(0, limit);
  const groups: { key: string; rows: HistoryEntry[] }[] = [];
  for (const e of visible) {
    const k = monthKey(e.date);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.rows.push(e);
    else groups.push({ key: k, rows: [e] });
  }

  const label = (e: HistoryEntry) => (e.type === "opening" ? t("openingBalance") : t(`type_${e.type}`));
  const summary = (e: HistoryEntry) => {
    if (e.type === "sale") {
      const ls = e.lines ?? [];
      const head = ls.slice(0, 3).map((l) => `${l.fruit_name} ${f.kg(l.kg)} ${t("kg")}`).join(" · ");
      return ls.length > 3 ? `${head} ${t("moreFruits", { n: f.digits(ls.length - 3) })}` : head;
    }
    if (e.type === "payment") return [t(`mode_${e.mode}`), e.note].filter(Boolean).join(" · ");
    if (e.type === "discount") return e.note ?? "";
    return "";
  };

  return (
    <Section
      title={t("history")}
      right={
        <button className="min-h-touch text-sm text-brand underline" onClick={() => setNewestFirst(!newestFirst)}>
          {newestFirst ? t("newestFirst") : t("oldestFirst")} ⇅
        </button>
      }
    >
      <div className="seg mb-3" role="group" aria-label={t("history")}>
        {(["ledger", "bills", "payments"] as const).map((v) => (
          <button
            key={v}
            className={`seg-btn ${view === v ? "seg-on" : ""}`}
            aria-pressed={view === v}
            onClick={() => {
              setView(v);
              setLimit(PAGE);
            }}
          >
            {t(`view_${v}`)}
          </button>
        ))}
      </div>
      <div className="relative mb-3">
        <IconSearch size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="field !h-[52px] !rounded-card !pl-11"
          type="search"
          placeholder={t("searchHistory")}
          aria-label={t("searchHistory")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {fruits.length > 0 && (
        <div className="card mb-3 overflow-hidden p-0">
          <button className="flex min-h-touch w-full items-center justify-between px-4 text-left font-medium" aria-expanded={showFruits} onClick={() => setShowFruits(!showFruits)}>
            <span>{t("fruitSummary")}</span>
            <IconChevron size={18} className={`text-muted transition ${showFruits ? "rotate-90" : ""}`} />
          </button>
          {showFruits && (
            <div className="divide-y divide-line border-t border-line">
              {fruits.map((x) => (
                <div key={x.name} className="flex items-start justify-between gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{x.name}</div>
                    <div className="muted">
                      {t("lastRate")} {f.num(x.lastRate)} · {f.dateShort(x.lastDate)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold">{f.kg(x.kg)} {t("kg")}</div>
                    <div className="muted">{f.money(x.amount)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && <Spinner />}
      <div className="space-y-5">
        {groups.map((g) => {
          const [y, m] = g.key.split("-").map(Number);
          const open = toggled[g.key] ?? (g.key === latestKey || g.key === focusKey || !!search);
          const tot = months.get(g.key);
          return (
            <div key={g.key} className="card overflow-hidden p-0">
              <button
                className="flex w-full items-start justify-between gap-2 p-4 text-left"
                aria-expanded={open}
                onClick={() => setToggled({ ...toggled, [g.key]: !open })}
              >
                <div>
                  <div className="flex items-center gap-1 font-serif text-lg font-semibold">
                    <IconChevron size={16} className={`text-muted transition ${open ? "rotate-90" : ""}`} />
                    {f.monthName(m)} {f.digits(y)}
                  </div>
                  {tot && (
                    <div className="muted">
                      {t("soldLabel")} {f.money(tot.sold)} · {t("received")} {f.money(tot.received)}
                    </div>
                  )}
                </div>
                {tot && (
                  <div className="shrink-0 text-right text-sm">
                    <div className="muted">{t("balEnd")}</div>
                    <Balance value={tot.end} />
                  </div>
                )}
              </button>
              {open && (
                <div className="divide-y divide-line border-t border-line">
                  {g.rows.map((e) => (
                    <Row key={e.id} e={e} full={view === "bills"} focus={focusSale === e.id} label={label(e)} summary={summary(e)} onOpen={onOpen} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!loading && shown.length === 0 && <p className="muted mt-2">{entries.length ? t("noMatches") : t("noEntries")}</p>}
      {!focusSale && !search && shown.length > limit && (
        <button className="btn-secondary mt-3 w-full" onClick={() => setLimit(limit + PAGE)}>
          {t("showMore")} ({f.digits(shown.length - limit)})
        </button>
      )}
    </Section>
  );
}

function Row({
  e,
  full,
  focus,
  label,
  summary,
  onOpen,
}: {
  e: HistoryEntry;
  full: boolean;
  focus: boolean;
  label: string;
  summary: string;
  onOpen: (e: HistoryEntry) => void;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const credit = e.type === "payment" || e.type === "discount";
  // the clock time is only meaningful when the entry was made on the day it is dated
  const sameDay = f.npDay(e.at) === e.date;
  return (
    <button
      id={`entry-${e.id}`}
      onClick={() => onOpen(e)}
      className={`block w-full px-4 py-3 text-left ${e.voided ? "opacity-60" : ""} ${focus ? "bg-tint" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`min-w-0 ${e.voided ? "line-through" : ""}`}>
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-semibold">{f.dateShort(e.date)}</span>
            <span className={`rounded-full px-2 text-xs font-medium ${TAG[e.type]}`}>{label}</span>
            {e.bill_no && <span className="muted">#{e.bill_no}</span>}
            {credit && sameDay && <span className="muted">{f.time(e.at)}</span>}
          </div>
          {!full && summary && <div className="muted line-clamp-2">{summary}</div>}
        </div>
        <div className={`shrink-0 text-right ${e.voided ? "line-through" : ""}`}>
          <div className={`money ${credit ? "text-recv" : ""}`}>
            {credit ? "− " : ""}
            {f.money(e.amount)}
          </div>
          {e.voided ? (
            <div className="muted no-underline">{t("voided")}</div>
          ) : (
            <div className="text-xs text-muted">
              {t("balShort")} <Balance value={e.balance_after} className="text-xs" />
            </div>
          )}
        </div>
      </div>
      {full && e.type === "sale" && (
        <ul className={`mt-1 space-y-0.5 text-sm ${e.voided ? "line-through" : ""}`}>
          {e.lines?.map((l, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {l.fruit_name} · {f.kg(l.kg)} {t("kg")} × {f.num(l.rate)}
                {l.crates ? ` · ${f.digits(l.crates)} ${t("crates")}` : ""}
              </span>
              <span>{f.num(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}
