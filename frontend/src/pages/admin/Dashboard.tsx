import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { Card, Columns, HBars, Tile } from "./charts";
import { errMsg } from "./shared";

interface Dash {
  numbers: { shops: Record<string, number>; users_today: number; users_7d: number; entries_today: number; open_flags: number };
  days: string[];
  entries: number[];
  active_shops: number[];
  signins_ok: number[];
  signins_failed: number[];
  by_hour: number[];
  funnel: { created: number; paying: number; on_trial: number; expired_unpaid: number };
  money: { month: string; amount: number }[];
}

const short = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "short" });
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");

export default function Dashboard({ onOpenSecurity }: { onOpenSecurity: () => void }) {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["admin-dashboard", days], queryFn: () => api<Dash>(`/admin/dashboard?days=${days}`), refetchInterval: 120_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <p role="alert" className="text-owed">{errMsg(q.error)}</p>;
  const d = q.data;
  const s = d.numbers.shops;
  const labels = d.days.map(short);
  const hourLabels = d.by_hour.map((_, h) => `${h}:00`);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Paying shops" value={s.active ?? 0} />
        <Tile label="On trial" value={s.trial ?? 0} />
        <Tile label="Expired" value={s.expired ?? 0} tone={s.expired ? "warn" : undefined} />
        <Tile label="Entries today" value={d.numbers.entries_today} />
        <Tile label="Users in last 7 days" value={`${d.numbers.users_7d}`} />
        {d.numbers.open_flags > 0 ? (
          <button className="text-left" onClick={onOpenSecurity}><Tile label="Security flags to review" value={d.numbers.open_flags} tone="warn" /></button>
        ) : (
          <Tile label="Security flags to review" value={0} />
        )}
      </div>

      <div className="flex gap-2">
        {[7, 30, 90].map((n) => (
          <button key={n} className={`chip ${days === n ? "chip-on" : ""}`} onClick={() => setDays(n)}>{n} days</button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Entries per day" sub="Bills and payments entered, all shops" table={{ head: ["Day", "Entries"], rows: d.days.map((x, i) => [short(x), d.entries[i]]) }}>
          <Columns labels={labels} values={d.entries} barName="Entries" />
        </Card>
        <Card title="Shops that entered something" sub="A falling line is a shop drifting away" table={{ head: ["Day", "Shops"], rows: d.days.map((x, i) => [short(x), d.active_shops[i]]) }}>
          <Columns labels={labels} values={d.active_shops} barName="Active shops" />
        </Card>
        <Card title="Sign-ins per day" sub="Successful (columns) and failed (red line)" table={{ head: ["Day", "Successful", "Failed"], rows: d.days.map((x, i) => [short(x), d.signins_ok[i], d.signins_failed[i]]) }}>
          <Columns labels={labels} values={d.signins_ok} line={d.signins_failed} barName="Successful" lineName="Failed" />
        </Card>
        <Card title="Busiest hours" sub={`Entries by hour of the day (Nepal time), last ${days} days`} table={{ head: ["Hour", "Entries"], rows: d.by_hour.map((v, h) => [`${h}:00`, v]) }}>
          <Columns labels={hourLabels} values={d.by_hour} barName="Entries" tick={(i) => i % 4 === 0} />
        </Card>
        <Card title="From sign-up to paying" sub="Shops by where they are now" table={{ head: ["Stage", "Shops"], rows: [["Created", d.funnel.created], ["Paying at least once", d.funnel.paying], ["On trial now", d.funnel.on_trial], ["Trial ended, never paid", d.funnel.expired_unpaid]] }}>
          <HBars rows={[
            { label: "Created", value: d.funnel.created },
            { label: "Paid at least once", value: d.funnel.paying },
            { label: "On trial now", value: d.funnel.on_trial },
            { label: "Trial ended, never paid", value: d.funnel.expired_unpaid },
          ]} />
        </Card>
        <Card title="Money collected per month" sub="Subscription payments you recorded" table={{ head: ["Month", "Rs"], rows: d.money.map((m) => [m.month, Math.round(m.amount)]) }}>
          <Columns labels={d.money.map((m) => monthName(m.month))} values={d.money.map((m) => m.amount)} barName="Collected" fmt={rs} tick={() => true} />
        </Card>
      </div>
    </div>
  );
}
