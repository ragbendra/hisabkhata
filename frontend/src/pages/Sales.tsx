import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import BsDatePicker from "../components/BsDatePicker";
import { ErrorBox, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { addDays, parseNum, toDec, todayNpl } from "../lib/calc";
import { useFmt } from "../lib/format";
import { useSales } from "../lib/queries";
import type { SalesGroup } from "../lib/types";

type Period = "today" | "d7" | "d30" | "pick";
type Bill = SalesGroup["bill_list"][number];

const PERIODS: { id: Period; key: string; def: string }[] = [
  { id: "today", key: "periodToday", def: "Today" },
  { id: "d7", key: "period7", def: "Last 7 days" },
  { id: "d30", key: "period30", def: "Last 30 days" },
  { id: "pick", key: "periodPick", def: "Choose dates" },
];

export default function SalesPage() {
  const { t } = useTranslation();
  const f = useFmt();
  const [period, setPeriod] = useState<Period>("today");
  const [pickFrom, setPickFrom] = useState(addDays(todayNpl(), -7));
  const [pickTo, setPickTo] = useState(todayNpl());
  const [customer, setCustomer] = useState("");
  const [fruitsOpen, setFruitsOpen] = useState(false);

  const today = todayNpl();
  const from = period === "today" ? today : period === "d7" ? addDays(today, -6) : period === "d30" ? addDays(today, -29) : pickFrom;
  const to = period === "pick" ? pickTo : today;
  const q = useSales({ group: "range", from, to, customer: customer.trim() || undefined });

  // the server gives one group for the whole range; everything below is read from it
  const g = q.data?.groups[0];
  const days = useMemo(() => {
    const by = new Map<string, Bill[]>();
    for (const b of g?.bill_list ?? []) by.set(b.date, [...(by.get(b.date) ?? []), b]);
    return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [g]);

  return (
    <div className="space-y-3">
      <h1 className="font-serif text-2xl font-semibold">{t("navSales")}</h1>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("period", { defaultValue: "Period" })}>
        {PERIODS.map((p) => (
          <button key={p.id} className={`chip ${period === p.id ? "chip-on" : ""}`} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
            {t(p.key, { defaultValue: p.def })}
          </button>
        ))}
      </div>

      {period === "pick" && (
        <div className="card space-y-3">
          <BsDatePicker label={t("from")} value={pickFrom} onChange={setPickFrom} yearsBack={5} />
          <BsDatePicker label={t("to")} value={pickTo} onChange={setPickTo} yearsBack={5} />
        </div>
      )}

      <input className="field" type="search" placeholder={t("filterByCustomer")} aria-label={t("filterByCustomer")} value={customer} onChange={(e) => setCustomer(e.target.value)} />

      {q.isLoading && <Spinner />}
      {q.error && !q.data && <ErrorBox error={q.error} />}

      {q.data && !g && <p className="muted">{t("noSales")}</p>}

      {g && (
        <>
          <div className="card">
            <div className="muted">{t("totalSales")}</div>
            <div className="font-serif text-3xl font-semibold">{f.money(g.total_sales)}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <span className="muted">{t("bills")}<b className="block text-ink">{f.digits(g.bills)}</b></span>
              <span className="muted">{t("totalKg")}<b className="block text-ink">{f.kg(g.total_kg)}</b></span>
              <span className="muted">{t("totalReceived")}<b className="block text-ink">{f.money(g.received)}</b></span>
            </div>
          </div>

          {days.map(([date, bills]) => (
            <section key={date} className="card p-0">
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <h2 className="font-semibold">{f.date(date)}</h2>
                <span className="font-semibold">{f.money(toDec(bills.reduce((s, b) => s + parseNum(b.total), 0)))}</span>
              </div>
              <div className="divide-y divide-line">
                {bills.map((b) => (
                  <BillRow key={b.sale_id} b={b} />
                ))}
              </div>
            </section>
          ))}

          {g.fruits.length > 0 && (
            <div className="card">
              <button className="flex w-full items-center justify-between text-left font-semibold" aria-expanded={fruitsOpen} onClick={() => setFruitsOpen(!fruitsOpen)}>
                {t("byFruit", { defaultValue: "By fruit" })}
                <span className="text-muted">{fruitsOpen ? "−" : "+"}</span>
              </button>
              {fruitsOpen && (
                <ul className="mt-2 space-y-1">
                  {g.fruits.map((fr) => (
                    <li key={fr.fruit} className="flex justify-between">
                      <span>{fr.fruit} · {f.kg(fr.kg)} {t("kg")}</span>
                      <span>{f.money(fr.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BillRow({ b }: { b: Bill }) {
  const { t } = useTranslation();
  const f = useFmt();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/sales/${b.sale_id}?with_payment=true`, { method: "DELETE" });
      await qc.invalidateQueries(); // sales, khata and customers all change
    } catch (x) {
      setErr(x instanceof Error ? (x.message === "Network unreachable" ? t("needsConnection", { defaultValue: "Needs a connection" }) : x.message) : String(x));
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="flex min-h-touch w-full items-center justify-between gap-2 px-4 py-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="min-w-0">
          <span className="block truncate font-medium">{b.customer_name}</span>
          {b.bill_no && <span className="muted">#{b.bill_no}</span>}
        </span>
        <span className="font-semibold">{f.money(b.total)}</span>
      </button>
      {open && (
        <div className="space-y-2 bg-black/[0.02] px-4 pb-3">
          {!asking ? (
            <div className="flex gap-2">
              <Link to={`/customer/${b.customer_id}?sale=${b.sale_id}`} className="btn-secondary flex-1 text-center">
                {t("openBill", { defaultValue: "Open" })}
              </Link>
              <button className="btn-secondary flex-1 !text-owed" onClick={() => setAsking(true)}>
                {t("deleteEntry", { defaultValue: "Delete" })}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                {t("deleteBillAsk", { defaultValue: "Delete this bill? The money taken with it at the counter is removed too, and the customer's balance changes." })}
              </p>
              {err && <p role="alert" className="text-sm text-owed">{err}</p>}
              <div className="flex gap-2">
                <button className="btn-secondary flex-1" onClick={() => setAsking(false)} disabled={busy}>{t("cancel", { defaultValue: "Cancel" })}</button>
                <button className="btn-primary flex-1 !bg-owed" onClick={() => void remove()} disabled={busy}>{t("deleteYes", { defaultValue: "Yes, delete" })}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
