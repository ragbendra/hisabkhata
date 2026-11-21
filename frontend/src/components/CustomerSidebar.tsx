import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Balance } from "./ui";
import { initial } from "./icons";
import CratesBadge from "./CratesBadge";
import { nameMatches, norm } from "../lib/calc";
import { useCustomers } from "../lib/queries";

/*
 * Computer screens only (hidden below the "lg" breakpoint): the customer list stays on the left
 * while a customer's ledger is open on the right. On a phone nothing changes.
 * Put it in Layout.tsx, see WIRING.md.
 */
export default function CustomerSidebar() {
  const { t } = useTranslation();
  const { customers } = useCustomers();
  const [q, setQ] = useState("");
  const { pathname } = useLocation();
  const current = /^\/customer\/([^/]+)/.exec(pathname)?.[1];

  const list = useMemo(() => {
    const rows = customers.filter((c) => !c.archived && (!q.trim() || nameMatches(q, c.name, c.other_name) || norm(c.phone).includes(norm(q))));
    return [...rows].sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance) || a.name.localeCompare(b.name));
  }, [customers, q]);

  return (
    <aside className="sticky top-[72px] self-start hidden max-h-[calc(100vh-96px)] w-80 flex-none flex-col overflow-hidden rounded-card bg-surface ring-1 ring-line lg:flex" aria-label={t("allCustomers")}>
      <div className="p-3">
        <input className="field !min-h-[44px]" type="search" placeholder={t("searchCustomers")} aria-label={t("searchCustomers")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto border-t border-line">
        {list.length === 0 && <p className="muted p-4">{t("noCustomers")}</p>}
        {list.map((c) => (
          <Link
            key={c.id}
            to={`/customer/${c.id}`}
            aria-current={c.id === current ? "page" : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 ${c.id === current ? "bg-tint" : "hover:bg-bg"}`}
          >
            <span className="avatar !h-9 !w-9 text-sm">{initial(c.name)}</span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{c.name}</span>
            <span className="shrink-0 text-right text-sm">
              <Balance value={c.balance} />
              <CratesBadge crates={c.crates} compact className="mt-0.5 block text-right" />
            </span>
          </Link>
        ))}
      </div>
    </aside>
  );
}
