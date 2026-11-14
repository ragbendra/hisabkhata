import { IconChevron } from "../components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import BsDatePicker from "../components/BsDatePicker";
import { ErrorBox, Spinner } from "../components/ui";
import { addDays, todayNpl } from "../lib/calc";
import { useFmt } from "../lib/format";
import { useSales, type SalesParams } from "../lib/queries";
import type { SalesGroup } from "../lib/types";

const GROUPS = ["day", "week", "month", "range"] as const;

export default function SalesPage() {
  const { t } = useTranslation();
  const [group, setGroup] = useState<SalesParams["group"]>("day");
  const [from, setFrom] = useState(addDays(todayNpl(), -7));
  const [to, setTo] = useState(todayNpl());
  const [customer, setCustomer] = useState("");
  const q = useSales({ group, from, to, customer: customer.trim() || undefined });

  return (
    <div className="space-y-3">
      <h1 className="font-serif text-2xl font-semibold">{t("navSales")}</h1>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("groupBy")}>
        {GROUPS.map((g) => (
          <button key={g} className={`chip ${group === g ? "chip-on" : ""}`} aria-pressed={group === g} onClick={() => setGroup(g)}>
            {t(`group_${g}`)}
          </button>
        ))}
      </div>
      {group === "range" && (
        <div className="card space-y-3">
          <BsDatePicker label={t("from")} value={from} onChange={setFrom} yearsBack={5} />
          <BsDatePicker label={t("to")} value={to} onChange={setTo} yearsBack={5} />
        </div>
      )}
      <input className="field" type="search" placeholder={t("filterByCustomer")} aria-label={t("filterByCustomer")} value={customer} onChange={(e) => setCustomer(e.target.value)} />

      {q.isLoading && <Spinner />}
      {q.error && !q.data && <ErrorBox error={q.error} />}
      {q.data && q.data.groups.length === 0 && <p className="muted">{t("noSales")}</p>}
      <div className="space-y-2">
        {q.data?.groups.map((g) => (
          <Group key={g.key} g={g} group={group} />
        ))}
      </div>
    </div>
  );
}

function Group({ g, group }: { g: SalesGroup; group: string }) {
  const { t } = useTranslation();
  const f = useFmt();
  const [open, setOpen] = useState(false);
  const title =
    group === "day"
      ? f.date(g.start)
      : group === "month"
        ? monthTitle(g.label, f)
        : `${f.date(g.start)} – ${f.date(g.end)}`;
  return (
    <div className="card p-0">
      <button className="w-full p-4 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-serif text-lg font-semibold">{title}</span>
          <IconChevron size={18} className={`text-muted transition ${open ? "rotate-90" : ""}`} />
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-3 text-sm">
          <span className="muted">{t("bills")}: <b className="text-ink">{f.digits(g.bills)}</b></span>
          <span className="muted">{t("totalKg")}: <b className="text-ink">{f.kg(g.total_kg)}</b></span>
          <span className="muted">{t("totalSales")}: <b className="text-ink">{f.money(g.total_sales)}</b></span>
          <span className="muted">{t("totalReceived")}: <b className="text-ink">{f.money(g.received)}</b></span>
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-4">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted">{t("fruits")}</h3>
            {g.fruits.map((fr) => (
              <div key={fr.fruit} className="mb-2">
                <div className="flex justify-between font-medium">
                  <span>{fr.fruit} · {f.kg(fr.kg)} {t("kg")}</span>
                  <span>{f.money(fr.amount)}</span>
                </div>
                <ul className="muted pl-3">
                  {fr.customers.map((c) => (
                    <li key={c.customer_id}>{c.name}: {f.kg(c.kg)} {t("kg")}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted">{t("billsList")}</h3>
            <div className="divide-y divide-line">
              {g.bill_list.map((b) => (
                <Link key={b.sale_id} to={`/customer/${b.customer_id}?sale=${b.sale_id}`} className="flex min-h-touch items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{b.customer_name}</span>
                    <span className="muted">{b.bill_no ? `#${b.bill_no} · ` : ""}{f.date(b.date)}</span>
                  </span>
                  <span className="font-semibold">{f.money(b.total)}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function monthTitle(label: string, f: ReturnType<typeof useFmt>): string {
  // label is "Kartik 2083" from the server; show it with the chosen language's month name and digits
  const [name, year] = label.split(" ");
  const idx = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"].indexOf(name);
  return `${idx >= 0 ? f.monthName(idx + 1) : name} ${f.digits(year)}`;
}
