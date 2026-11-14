import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import UndoBar from "../components/UndoBar";
import { IconChevron, IconSearch, initial } from "../components/icons";
import { Balance, ErrorBox, Modal, Section, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { addDays, nameMatches, norm } from "../lib/calc";
import { useFmt } from "../lib/format";
import { useCustomers, useMe } from "../lib/queries";
import { oldestWaitingMs, retryFailed, discardEntry, flushOutbox } from "../lib/sync";
import type { OwingGroup, TodayEntry } from "../lib/types";

export default function KhataPage() {
  const { t } = useTranslation();
  const f = useFmt();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe().data!;
  const { customers, totals, khata, outbox } = useCustomers();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"balance" | "oldest">("balance");
  const [group, setGroup] = useState<OwingGroup | null>(null);
  const [drill, setDrill] = useState<{ title: string; kind: string; value?: string } | null>(null);
  const [moreToday, setMoreToday] = useState(false);

  const tomorrow = useMutation({
    mutationFn: (v: { id: string; date: string }) => api(`/customers/${v.id}`, { method: "PATCH", body: { next_collection_date: v.date } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["khata"] }),
  });

  const list = useMemo(() => {
    const rows = customers.filter((c) => !c.archived && (!q.trim() || nameMatches(q, c.name, c.other_name) || norm(c.phone).includes(norm(q))));
    if (sort === "oldest") {
      return [...rows].sort((a, b) => (b.days_owing ?? -1) - (a.days_owing ?? -1) || a.name.localeCompare(b.name));
    }
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

  const ageColor: Record<string, string> = { "0-7": "bg-age-1", "8-14": "bg-age-2", "15-30": "bg-age-3", "30+": "bg-age-4" };
  const owingTotal = k.owing_for.reduce((a, g) => a + Math.max(0, parseFloat(g.total)), 0);

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

      {/* FR-22 */}
      {k.collect_now.length > 0 && (
        <Section title={t("collectNow")} right={<span className="sec-title text-owed">{f.digits(k.collect_now.length)}</span>}>
          <div className="card-list">
            {k.collect_now.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <Link to={`/customer/${c.id}`} className="flex min-h-[48px] items-center gap-3">
                  <span className="avatar">{initial(c.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className={`text-[13px] font-medium ${c.overdue_days ? "text-owed" : "text-warn"}`}>
                      {c.overdue_days ? t("overdueDays", { n: f.digits(c.overdue_days) }) : t("dueToday")}
                    </span>
                  </span>
                  <Balance value={c.balance} />
                </Link>
                <div className="mt-2.5 flex gap-2 pl-[52px]">
                  <button className="btn-primary flex-1" onClick={() => nav(`/entry?customer=${c.id}&focus=received`)}>
                    {t("receivedBtn")}
                  </button>
                  {owner && (
                    <button
                      className="btn-secondary flex-1"
                      disabled={tomorrow.isPending}
                      onClick={() => tomorrow.mutate({ id: c.id, date: addDays(k.today, 1) })}
                    >
                      {t("tomorrow")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* FR-48: how long money has been waiting */}
      <Section title={t("owingFor")} right={<span className="text-[13px] text-muted">{t("estimated")}</span>}>
        <div className="card">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {k.owing_for.map((g) => (
              <div key={g.bucket} className={ageColor[g.bucket]} style={{ flex: `${owingTotal > 0 ? Math.max(0, parseFloat(g.total)) : 1} 1 0%` }} />
            ))}
          </div>
          <div className="mt-1.5 divide-y divide-line">
            {k.owing_for.map((g) => (
              <button key={g.bucket} className="flex min-h-[48px] w-full items-center gap-3 py-1 text-left" onClick={() => setGroup(g)}>
                <span className={`h-2.5 w-2.5 flex-none rounded-full ${ageColor[g.bucket]}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t(`bucket_${g.bucket}`)}</span>
                  <span className="text-xs text-muted">{t("customersCount", { n: f.digits(g.count) })}</span>
                </span>
                <span className="money">{f.money(g.total)}</span>
              </button>
            ))}
          </div>
        </div>
      </Section>

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
              {Object.entries(card.received_by_mode)
                .filter(([, v]) => parseFloat(v) > 0)
                .map(([m, v]) => `${t(`mode_${m}`)} ${f.money(v)}`)
                .join(" · ") || t("nothingToday")}
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

      {k.coming_up.length > 0 && (
        <Section title={t("comingUp")}>
          <div className="card-list">
            {k.coming_up.map((c) => (
              <CustomerRow key={c.id} id={c.id} name={c.name} sub={f.date(c.next_collection_date)} balance={c.balance} />
            ))}
          </div>
        </Section>
      )}

      {/* FR-23 */}
      {k.no_date.length > 0 && (
        <Section title={t("noDateSet")}>
          <div className="card-list">
            {k.no_date.map((c) => (
              <CustomerRow key={c.id} id={c.id} name={c.name} sub={`${t("lastActivity")}: ${f.date(c.last_activity) || "—"}`} balance={c.balance} />
            ))}
          </div>
        </Section>
      )}

      {/* FR-24, FR-47 */}
      <Section title={t("allCustomers")}>
        <div className="relative">
          <IconSearch size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field !h-[52px] !rounded-card !pl-11" type="search" placeholder={t("searchCustomers")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("searchCustomers")} />
        </div>
        <div className="my-3 flex gap-2">
          <button className={`chip ${sort === "balance" ? "chip-on" : ""}`} onClick={() => setSort("balance")}>{t("sortBalance")}</button>
          <button className={`chip ${sort === "oldest" ? "chip-on" : ""}`} onClick={() => setSort("oldest")}>{t("sortOldest")}</button>
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
              owing={c.days_owing !== null && parseFloat(c.balance) > 0 ? t("owingDays", { n: f.digits(c.days_owing) }) : undefined}
            />
          ))}
        </div>
      </Section>

      {group && (
        <Modal title={`${t(`bucket_${group.bucket}`)} · ${t("estimated")}`} onClose={() => setGroup(null)}>
          <div className="divide-y divide-line">
            {group.customers.length === 0 && <p className="muted">{t("noCustomers")}</p>}
            {group.customers.map((c) => (
              <Link key={c.id} to={`/customer/${c.id}`} className="flex min-h-touch items-center gap-3 py-2">
                <span className="avatar">{initial(c.name)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="money">{f.money(c.amount)}</span>
              </Link>
            ))}
          </div>
        </Modal>
      )}
      {drill && <DrillModal {...drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

function CustomerRow({ id, name, sub, balance, owing, pending }: { id: string; name: string; sub: string; balance: string; owing?: string; pending?: boolean }) {
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
        {owing && <span className="block text-xs text-muted">{owing}</span>}
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
