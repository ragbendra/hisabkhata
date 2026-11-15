import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import UndoBar from "../components/UndoBar";
import { IconChevron, IconSearch, initial } from "../components/icons";
import { Balance, ErrorBox, Modal, Section, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { nameMatches, norm } from "../lib/calc";
import { useFmt } from "../lib/format";
import { useCustomers, useMe } from "../lib/queries";
import { oldestWaitingMs, retryFailed, discardEntry, flushOutbox } from "../lib/sync";
import type { TodayEntry } from "../lib/types";

export default function KhataPage() {
  const { t } = useTranslation();
  const f = useFmt();
  const me = useMe().data!;
  const { customers, totals, khata, outbox } = useCustomers();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"balance" | "name">("balance");
  const [drill, setDrill] = useState<{ title: string; kind: string; value?: string } | null>(null);
  const [moreToday, setMoreToday] = useState(false);

  const list = useMemo(() => {
    const rows = customers.filter((c) => !c.archived && (!q.trim() || nameMatches(q, c.name, c.other_name) || norm(c.phone).includes(norm(q))));
    if (sort === "name") return [...rows].sort((a, b) => a.name.localeCompare(b.name));
    return [...rows].sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance) || a.name.localeCompare(b.name));
  }, [customers, q, sort]);

  if (khata.isLoading) return <Spinner />;
  if (khata.error && !khata.data) return <ErrorBox error={khata.error} />;
  const k = khata.data!;
  const waiting = outbox.filter((r) => !r.failed);
  const failed = outbox.filter((r) => r.failed);
  const stuck = oldestWaitingMs(outbox) > 24 * 3600 * 1000;
  const card = k.today_card;
  const owner = me.role === "owner";

  // money received today in plain words: cash, and everything that came in online
  const rbm = card.received_by_mode;
  const cashToday = parseFloat(rbm.cash ?? "0");
  const onlineToday = ["esewa", "khalti", "bank"].reduce((a, m) => a + parseFloat(rbm[m] ?? "0"), 0);
  const otherToday = parseFloat(rbm.other ?? "0");
  const todaySplit = [
    cashToday > 0 && `${t("mode_cash")} ${f.money(cashToday)}`,
    onlineToday > 0 && `${t("online")} ${f.money(onlineToday)}`,
    otherToday > 0 && `${t("mode_other")} ${f.money(otherToday)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-1">
      <UndoBar />

      {/* FR-25, FR-33: entries waiting to be sent */}
      {waiting.length > 0 && (
        <div role="status" className={`card mb-3 ${stuck ? "bg-owedtint" : "bg-warntint"}`}>
          <div className="font-medium">{t("waitingCount", { n: f.digits(waiting.length) })}</div>
          {stuck && <div className="mt-1 text-sm font-semibold text-owed">{t("waitingTooLong")}</div>}
          <button className="btn-secondary mt-2" onClick={() => void flushOutbox()}>
            {t("sendNow")}
          </button>
        </div>
      )}
      {failed.map((r) => (
        <div key={r.id} role="alert" className="card mb-3 bg-owedtint">
          <div className="font-medium">{t("refusedEntry", { name: r.summary.customerName })}</div>
          <div className="text-sm text-owed">{r.error}</div>
          <div className="mt-2 flex gap-2">
            <button className="btn-secondary" onClick={() => void retryFailed(r.id)}>{t("retry")}</button>
            <button className="btn-secondary" onClick={() => void discardEntry(r.id)}>{t("discard")}</button>
          </div>
        </div>
      ))}

      {/* FR-21: the one number the owner opens the app for */}
      <div className="px-1 pb-1 pt-4">
        <div className="text-sm text-muted">{t("totalToCollect")}</div>
        <div className="money mt-1 text-5xl leading-tight tracking-tight">{f.money(totals.total)}</div>
        <div className="mt-2 text-sm text-muted">{t("customersOwe", { n: f.digits(totals.count) })}</div>
      </div>

      {/* FR-20 */}
      {owner && k.possible_duplicates && k.possible_duplicates.length > 0 && (
        <Section title={t("possibleDuplicates")}>
          <div className="space-y-2">
            {k.possible_duplicates.map((d) => (
              <Link key={d.id} to={`/customer/${d.id}`} className="card block bg-warntint">
                <div className="font-medium">{d.name}</div>
                <div className="muted">{t("sameNameAs", { name: d.twin_name ?? "?" })}</div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* FR-44, FR-45: end of day */}
      <Section title={`${t("today")} · ${f.date(card.date)}`}>
        <div className="card">
          <div className="grid grid-cols-3 gap-2">
            <TodayStat label={t("bills")} value={f.digits(card.bills)} onClick={() => setDrill({ title: t("bills"), kind: "sales" })} />
            <TodayStat label={t("totalSales")} value={f.money(card.total_sales)} onClick={() => setDrill({ title: t("totalSales"), kind: "sales" })} />
            <TodayStat label={t("totalReceived")} value={f.money(card.total_received)} onClick={() => setDrill({ title: t("totalReceived"), kind: "received" })} />
          </div>
          <button
            className="mt-3 flex min-h-touch w-full items-center justify-between border-t border-line pt-2 text-sm font-medium text-brand"
            aria-expanded={moreToday}
            onClick={() => setMoreToday((v) => !v)}
          >
            <span className="text-muted">
              {todaySplit || t("nothingToday")}
            </span>
            <IconChevron size={18} className={moreToday ? "rotate-90" : ""} />
          </button>
          {moreToday && (
            <div className="space-y-1 pt-1">
              {Object.entries(card.received_by_mode).map(([m, v]) =>
                parseFloat(v) > 0 ? (
                  <TodayLine key={m} indent label={t(`mode_${m}`)} value={f.money(v)} onClick={() => setDrill({ title: t(`mode_${m}`), kind: "mode", value: m })} />
                ) : null,
              )}
              {parseFloat(card.discounts) > 0 && (
                <TodayLine label={t("discountsToday")} value={f.money(card.discounts)} onClick={() => setDrill({ title: t("discountsToday"), kind: "discounts" })} />
              )}
              {card.people.length > 0 && (
                <div className="border-t border-line pt-2">
                  <div className="muted mb-1">{t("byPerson")}</div>
                  {card.people.map((p) => (
                    <TodayLine
                      key={p.user_id}
                      label={p.name}
                      value={`${f.digits(p.entries)} · ${f.money(p.sales)} / ${f.money(p.received)}`}
                      onClick={() => setDrill({ title: p.name, kind: "person", value: p.user_id })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* FR-24, FR-47 */}
      <Section title={t("allCustomers")}>
        <div className="relative">
          <IconSearch size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field !h-[52px] !rounded-card !pl-11" type="search" placeholder={t("searchCustomers")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("searchCustomers")} />
        </div>
        <div className="my-3 flex gap-2">
          <button className={`chip ${sort === "balance" ? "chip-on" : ""}`} onClick={() => setSort("balance")}>{t("sortBalance")}</button>
          <button className={`chip ${sort === "name" ? "chip-on" : ""}`} onClick={() => setSort("name")}>{t("sortName")}</button>
        </div>
        <div className="card-list">
          {list.length === 0 && <p className="muted p-4">{t("noCustomers")}</p>}
          {list.map((c) => (
            <CustomerRow
              key={c.id}
              id={c.id}
              name={c.name}
              pending={c.pending_new}
              sub={`${t("lastActivity")}: ${f.date(c.last_activity) || "—"}`}
              balance={c.balance}
            />
          ))}
        </div>
      </Section>

      {drill && <DrillModal {...drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

function CustomerRow({ id, name, sub, balance, pending }: { id: string; name: string; sub: string; balance: string; pending?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link to={`/customer/${id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
      <span className="avatar">{initial(name)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {name}
          {pending && <span className="ml-2 rounded-full bg-warntint px-2 py-0.5 text-xs font-medium text-warn">{t("notSentYet")}</span>}
        </span>
        <span className="block truncate text-[13px] text-muted">{sub}</span>
      </span>
      <span className="shrink-0 text-right">
        <Balance value={balance} />
      </span>
    </Link>
  );
}

function TodayStat({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button className="min-w-0 text-left" onClick={onClick}>
      <span className="block text-xs text-muted">{label}</span>
      <span className="money block truncate text-lg">{value}</span>
    </button>
  );
}

function TodayLine({ label, value, onClick, strong, indent }: { label: string; value: string; onClick: () => void; strong?: boolean; indent?: boolean }) {
  return (
    <button className={`flex min-h-touch w-full items-center justify-between text-left ${indent ? "pl-4 text-sm" : ""} ${strong ? "font-bold" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <span>{value}</span>
    </button>
  );
}

function DrillModal({ title, kind, value, onClose }: { title: string; kind: string; value?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const f = useFmt();
  const [rows, setRows] = useState<TodayEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams({ kind });
    if (value) qs.set("value", value);
    api<TodayEntry[]>(`/khata/today-entries?${qs}`)
      .then(setRows)
      .catch((e) => setErr(e instanceof Error && e.message === "Network unreachable" ? t("offlineNoData") : String(e)));
  }, [kind, value, t]);
  return (
    <Modal title={title} onClose={onClose}>
      {err && <p className="text-owed">{err}</p>}
      {!rows && !err && <Spinner />}
      {rows && rows.length === 0 && <p className="muted">{t("nothingToday")}</p>}
      <div className="divide-y divide-line">
        {rows?.map((r) => (
          <Link key={r.id} to={r.type === "sale" ? `/customer/${r.customer_id}?sale=${r.id}` : `/customer/${r.customer_id}`} className="flex min-h-touch items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.customer_name}</span>
              <span className="muted">
                {t(`type_${r.type}`)} · {f.time(r.at)} · {r.entered_by}
              </span>
            </span>
            <span className="font-semibold">{f.money(r.amount)}</span>
          </Link>
        ))}
      </div>
    </Modal>
  );
}
