import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Balance, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useFmt } from "../lib/format";
import { useCustomers } from "../lib/queries";

/*
 * Archived customers: hidden from the Khata list, so they are listed here. Pick one or more and delete
 * their whole khata, or open one to look first. Route: /archived (owner only).
 * "All customers" lets the owner pick from every customer, not just archived ones.
 */
export default function ArchivedPage() {
  const { t } = useTranslation();
  const f = useFmt();
  const qc = useQueryClient();
  const { customers, khata } = useCustomers();
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      customers
        .filter((c) => all || c.archived)
        .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance) || a.name.localeCompare(b.name)),
    [customers, all],
  );
  if (khata.isLoading) return <Spinner />;

  const sel = rows.filter((c) => picked.has(c.id));
  const owed = sel.reduce((s, c) => s + Math.max(parseFloat(c.balance), 0), 0);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ customers: number }>("/customers/bulk-delete", { body: { ids: sel.map((c) => c.id), confirm: typed.trim() } });
      setDone(t("deletedCustomers", { defaultValue: "Deleted {{n}} customers.", n: r.customers }));
      setPicked(new Set());
      setAsking(false);
      setTyped("");
      await qc.invalidateQueries();
    } catch (x) {
      setErr(x instanceof Error && x.message === "Network unreachable" ? t("needsConnection", { defaultValue: "Needs a connection" }) : String(x instanceof Error ? x.message : x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold">{t("archivedTitle", { defaultValue: "Archived customers" })}</h1>
        <Link to="/" className="text-sm text-brand underline">{t("back", { defaultValue: "Back" })}</Link>
      </div>
      <p className="muted">
        {all
          ? t("archivedHintAll", { defaultValue: "Every customer. Tick the ones to delete." })
          : t("archivedHint", { defaultValue: "These are hidden from the Khata list and are not counted in Total to collect. Tick the ones to delete." })}
      </p>
      <div className="flex gap-2">
        <button className={`chip ${!all ? "chip-on" : ""}`} onClick={() => setAll(false)}>{t("archivedOnly", { defaultValue: "Archived" })}</button>
        <button className={`chip ${all ? "chip-on" : ""}`} onClick={() => setAll(true)}>{t("allCustomers", { defaultValue: "All customers" })}</button>
      </div>
      {done && <p role="status" className="rounded-xl bg-tint p-3 text-sm text-recv">{done}</p>}

      {rows.length === 0 ? (
        <p className="muted">{t("noArchived", { defaultValue: "Nothing here." })}</p>
      ) : (
        <ul className="card-list">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-3 p-3">
              <input type="checkbox" className="h-5 w-5 shrink-0" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={c.name} />
              <Link to={`/customer/${c.id}`} className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}{c.archived && <span className="ml-2 rounded-full bg-tint px-2 py-0.5 text-xs font-normal">{t("archived")}</span>}</p>
                <p className="muted text-xs">{c.last_activity ? `${t("lastActivity")}: ${f.date(c.last_activity)}` : ""}</p>
              </Link>
              <Balance value={c.balance} />
            </li>
          ))}
        </ul>
      )}

      {sel.length > 0 && (
        <div className="sticky bottom-24 z-10 rounded-2xl bg-surface p-3 shadow-lg ring-1 ring-line">
          {!asking ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{t("selectedCount", { defaultValue: "{{n}} selected", n: f.digits(sel.length) })}</span>
              <button className="btn-primary !bg-owed !min-h-[44px] px-5" onClick={() => setAsking(true)}>{t("deleteEntry", { defaultValue: "Delete" })}</button>
            </div>
          ) : (
            <div role="alertdialog" className="space-y-2">
              <p className="text-sm font-semibold">
                {t("deleteManyCustomersAsk", { defaultValue: "Delete {{n}} customers and their whole khata?", n: f.digits(sel.length) })}
              </p>
              <p className="text-sm">
                {t("deleteCustomerNote", { defaultValue: "Every bill and payment of these customers is erased and cannot be brought back from the app." })}
                {owed > 0 && <strong className="block text-owed">{t("deleteManyOwes", { defaultValue: "They owe {{amount}} in total.", amount: f.money(owed) })}</strong>}
              </p>
              <label className="block text-sm">
                {t("typeDelete", { defaultValue: "Type DELETE to confirm" })}
                <input className="field mt-1" value={typed} autoCapitalize="characters" autoCorrect="off" onChange={(e) => setTyped(e.target.value)} />
              </label>
              {err && <p role="alert" className="text-sm text-owed">{err}</p>}
              <div className="flex gap-2">
                <button className="btn-secondary flex-1" disabled={busy} onClick={() => { setAsking(false); setTyped(""); }}>{t("cancel", { defaultValue: "Cancel" })}</button>
                <button className="btn-primary flex-1 !bg-owed" disabled={busy || typed.trim() !== "DELETE"} onClick={() => void remove()}>{t("deleteForever", { defaultValue: "Delete forever" })}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
