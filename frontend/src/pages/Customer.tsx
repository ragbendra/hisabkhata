import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import BsDatePicker from "../components/BsDatePicker";
import CratesAdjustButton from "../components/CratesAdjustButton";
import CratesBadge from "../components/CratesBadge";
import { DeleteCustomerButton, DeleteEntryButton } from "../components/EntryActions";
import LedgerCompact from "../components/LedgerCompact";
import { StatementPdfButtons } from "../components/PdfActions";
import { IconBack, IconPlus, initial } from "../components/icons";
import { Balance, ConfirmButton, ErrorBox, Modal, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { decimals, lineAmount, nameMatches, norm, normDigits, parseNum, todayNpl } from "../lib/calc";
import { useFmt } from "../lib/format";
import { groupPending } from "../lib/pending";
import { useCustomers, useHistory, useMe, useSheet } from "../lib/queries";
import { PAY_MODES, type HistoryEntry, type PayMode, type Sheet } from "../lib/types";

export default function CustomerPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const f = useFmt();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe().data!;
  const owner = me.role === "owner";
  const sheetQ = useSheet(id);
  const histQ = useHistory(id);
  const { outbox } = useCustomers();
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  const [modal, setModal] = useState<null | "edit" | "merge" | "date">(null);
  const [err, setErr] = useState<string | null>(null);

  const mine = useMemo(() => groupPending(outbox).get(id), [outbox, id]);
  const focusSale = params.get("sale");

  // FR-18: scroll to the sale that was tapped elsewhere in the app
  useEffect(() => {
    if (!focusSale || !histQ.data) return;
    const el = document.getElementById(`entry-${focusSale}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusSale, histQ.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["sheet", id] });
    void qc.invalidateQueries({ queryKey: ["history", id] });
    void qc.invalidateQueries({ queryKey: ["khata"] });
    void qc.invalidateQueries({ queryKey: ["sales"] });
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/customers/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setErr(null);
      invalidate();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api(`/customers/${id}/archive`, { body: { archived } }),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (sheetQ.isLoading) return <Spinner />;
  if (sheetQ.error && !sheetQ.data) {
    // a customer that so far only exists in the outbox
    if (mine && mine.rows[0]?.payload.new_customer) {
      return (
        <div className="card">
          <h1 className="font-serif text-2xl font-semibold">{mine.rows[0].payload.new_customer.name}</h1>
          <p className="muted mt-2">{t("notSentYet")}</p>
        </div>
      );
    }
    return <ErrorBox error={sheetQ.error} />;
  }
  const s: Sheet = sheetQ.data!;
  const delta = mine?.delta ?? 0;
  const balance = parseNum(s.balance) + delta;

  return (
    <div className="space-y-1">
      {/* header: who, how much, and the two things he does most */}
      <div className="-mx-5 rounded-b-[24px] bg-surface px-5 pb-4 pt-1 shadow-sm ring-1 ring-line">
        <button className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full" onClick={() => nav(-1)} aria-label={t("back")}>
          <IconBack />
        </button>
        <div className="flex items-center gap-3.5">
          <span className="avatar !h-14 !w-14 text-[22px]">{initial(s.name)}</span>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-[22px] font-semibold leading-tight">
              {s.name}
              {s.archived && <span className="ml-2 rounded-full bg-tint px-2 py-0.5 font-sans text-xs">{t("archived")}</span>}
            </h1>
            {s.other_name && <div className="muted">{s.other_name}</div>}
            {s.phone && (
              <a className="block text-sm text-brand" href={`tel:${s.phone}`}>
                {f.digits(s.phone)}
              </a>
            )}
            {s.address && <div className="truncate text-[13px] text-muted">{s.address}</div>}
          </div>
        </div>
        <div className="mt-4">
          <div className="text-[13px] text-muted">{balance < 0 ? "" : t("totalToCollect")}</div>
          <Balance value={balance} className="block text-[40px] leading-tight tracking-tight" />
          <CratesBadge crates={s.crates} className="mt-2" />
        </div>
        <div className="mt-3 flex gap-2">
          <Link className="btn-primary flex-1" to={`/entry?customer=${s.id}`}>
            <IconPlus size={18} className="mr-1.5" />
            {t("navEntry")}
          </Link>
          <Link className="btn-secondary flex-1" to={`/entry?customer=${s.id}&focus=received`}>
            {t("receivedBtn")}
          </Link>
        </div>
      </div>

      {mine && mine.rows.length > 0 && (
        <p className="mt-5 rounded-xl bg-warntint p-3 text-sm text-warn">{t("includesWaiting", { n: f.digits(mine.rows.length) })}</p>
      )}
      {mine?.rows.map((r) => (
        <div key={r.id} className="card mt-3 bg-warntint">
          <div className="text-sm font-semibold">{t("notSentYet")}</div>
          <div className="text-sm">
            {r.summary.total > 0 && `${t("sale")} ${f.money(r.summary.total)} `}
            {r.summary.received > 0 && `${t("received")} ${f.money(r.summary.received)}`}
          </div>
        </div>
      ))}

      {/* the khata itself: the ledger page opens straight away */}
      <div className="mt-5">
        <LedgerCompact entries={histQ.data ?? []} loading={histQ.isLoading} focusSale={focusSale}
                       onOpen={setOpen} canSelect={owner} onChanged={invalidate} customerId={s.id} />
        <StatementPdfButtons customerId={s.id} />
        <div className="mt-3"><CratesAdjustButton customerId={s.id} onDone={invalidate} /></div>
      </div>

      {owner && (
        <details className="card mt-5">
          <summary className="flex min-h-touch cursor-pointer items-center font-semibold">{t("moreOptions")}</summary>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-3">
            <div>
              <div className="text-xs text-muted">{t("collectionDate")}</div>
              <div className="font-semibold">{s.next_collection_date ? f.date(s.next_collection_date) : t("noDate")}</div>
            </div>
            <button className="btn-secondary" onClick={() => setModal("date")}>{t("change")}</button>
          </div>
          {err && <p role="alert" className="mt-2 text-sm text-owed">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => setModal("edit")}>{t("edit")}</button>
            <button className="btn-secondary" onClick={() => setModal("merge")}>{t("merge")}</button>
            <ConfirmButton
              label={s.archived ? t("unarchive") : t("archive")}
              confirmLabel={t("tapAgainConfirm")}
              onConfirm={() => archive.mutate(!s.archived)}
            />
            <DeleteCustomerButton
              customer={{ id: s.id, name: s.name, balance: s.balance }}
              onDeleted={() => { invalidate(); nav("/"); }}
            />
          </div>
          {s.possible_duplicate_of && (
            <div className="mt-3 rounded-xl bg-warntint p-3 text-sm">
              {t("possibleDuplicateNote")}{" "}
              <Link className="underline" to={`/customer/${s.possible_duplicate_of}`}>{t("viewOther")}</Link>
              <button className="ml-3 underline" onClick={() => void api(`/customers/${id}/dismiss-duplicate`, { body: {} }).then(invalidate)}>
                {t("notDuplicate")}
              </button>
            </div>
          )}
        </details>
      )}

      {open && (
        <EntryDetail
          entry={open}
          owner={owner}
          paidWith={open.paid_with ? histQ.data?.find((x) => x.id === open.paid_with?.id) : undefined}
          onSwitch={setOpen}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            invalidate();
          }}
        />
      )}
      {modal === "edit" && <EditCustomer sheet={s} onClose={() => setModal(null)} onSave={(b) => patch.mutate(b, { onSuccess: () => setModal(null) })} />}
      {modal === "merge" && <MergeModal sheet={s} onClose={() => setModal(null)} onDone={(into) => { setModal(null); nav(`/customer/${into}`, { replace: true }); invalidate(); }} />}
      {modal === "date" && (
        <DateModal
          value={s.next_collection_date}
          onClose={() => setModal(null)}
          onSave={(d) => patch.mutate({ next_collection_date: d }, { onSuccess: () => setModal(null) })}
        />
      )}
    </div>
  );
}

function typeLabel(h: HistoryEntry, t: (k: string) => string): string {
  if (h.type === "opening") return t("openingBalance");
  return t(`type_${h.type}`);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ detail (FR-17)

function EntryDetail({
  entry: e,
  owner,
  paidWith,
  onSwitch,
  onClose,
  onChanged,
}: {
  entry: HistoryEntry;
  owner: boolean;
  paidWith?: HistoryEntry;
  onSwitch: (e: HistoryEntry) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const [editing, setEditing] = useState(false);
  // a bill and the money received with it are one line in the ledger, so they share one before/after
  const before = paidWith && paidWith.balance_after === e.balance_before ? paidWith.balance_before : e.balance_before;
  const after = paidWith && paidWith.balance_before === e.balance_after ? paidWith.balance_after : e.balance_after;

  if (editing) return <EditEntry entry={e} onClose={() => setEditing(false)} onSaved={onChanged} />;
  return (
    <Modal title={typeLabel(e, t)} onClose={onClose}>
      <dl className="space-y-2 text-sm">
        {e.type === "sale" && (
          <>
            {e.bill_no && <Stat label={t("billNo")} value={e.bill_no} />}
            <Stat label={t("date")} value={f.date(e.date)} />
            <table className="w-full">
              <thead>
                <tr className="muted text-left">
                  <th>{t("fruitName")}</th><th className="text-right">{t("kg")}</th><th className="text-right">{t("ratePerKg")}</th><th className="text-right">{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {e.lines?.map((l, i) => (
                  <tr key={i}>
                    <td>{l.fruit_name}{l.crates ? ` (${f.digits(l.crates)} ${t("crates")})` : ""}</td>
                    <td className="text-right">{f.kg(l.kg)}</td>
                    <td className="text-right">{f.num(l.rate)}</td>
                    <td className="text-right">{f.num(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Stat label={t("netTotal")} value={f.money(e.amount)} />
            {paidWith && (
              <button className="block w-full rounded-xl bg-tint p-3 text-left" onClick={() => onSwitch(paidWith)}>
                <span className="muted block">{t("paidWithBill")}</span>
                <span className={`font-semibold ${paidWith.voided ? "line-through" : ""}`}>
                  {f.money(paidWith.amount)} · {t(`mode_${paidWith.mode ?? "cash"}`)}
                </span>
                {paidWith.voided && <span className="ml-2 text-owed">{t("voided")}</span>}
                <span className="muted block text-xs">{t("paidWithBillNote")}</span>
              </button>
            )}
          </>
        )}
        {(e.type === "payment" || e.type === "discount") && (
          <>
            <Stat label={t("amount")} value={f.money(e.amount)} />
            {e.type === "payment" && e.mode && <Stat label={t("mode")} value={t(`mode_${e.mode}`)} />}
            <Stat label={t("date")} value={f.dateTime(e.at)} />
            {e.note && <Stat label={t("note")} value={e.note} />}
          </>
        )}
        {e.type === "opening" && (
          <>
            <Stat label={t("amount")} value={f.money(e.amount)} />
            <Stat label={t("asOf")} value={f.date(e.date)} />
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div><dt className="muted">{t("balanceBefore")}</dt><dd><Balance value={before} /></dd></div>
          <div><dt className="muted">{t("balanceAfter")}</dt><dd><Balance value={after} /></dd></div>
        </div>
        <Stat label={t("enteredBy")} value={`${e.entered_by ?? "?"} · ${f.dateTime(e.entered_at)}`} />
        {e.voided && <p className="font-semibold text-owed">{t("voided")}{e.void_reason ? `: ${e.void_reason}` : ""}</p>}
      </dl>
      {owner && !e.voided && e.type !== "opening" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-secondary flex-1" onClick={() => setEditing(true)}>{t("edit")}</button>
          <DeleteEntryButton entry={e} paidWith={paidWith} onDone={() => { onChanged(); onClose(); }} />
        </div>
      )}
    </Modal>
  );
}

function EditEntry({ entry: e, onClose, onSaved }: { entry: HistoryEntry; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const f = useFmt();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // sale
  const [bill, setBill] = useState(e.bill_no ?? "");
  const [date, setDate] = useState(e.date);
  const [lines, setLines] = useState(
    (e.lines ?? []).map((l) => ({ fruit: l.fruit_name, kg: String(parseFloat(l.kg)), rate: String(parseFloat(l.rate)), crates: l.crates ? String(l.crates) : "" })),
  );
  // payment
  const [amount, setAmount] = useState(String(parseFloat(e.amount)));
  const [mode, setMode] = useState<PayMode>((e.mode as PayMode) ?? "cash");
  const [note, setNote] = useState(e.note ?? "");
  const [payDate, setPayDate] = useState(f.npDay(e.at));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (e.type === "sale") {
        const out = lines.map((l) => ({ fruit_name: l.fruit.trim(), kg: parseNum(l.kg), rate: parseNum(l.rate), crates: l.crates.trim() ? Number(normDigits(l.crates)) : null, raw: l.kg }));
        if (!out.length || out.some((l) => !l.fruit_name || !(l.kg > 0) || !Number.isFinite(l.rate) || decimals(l.raw) > 2)) throw new Error(t("lineIncomplete"));
        await api(`/sales/${e.id}`, {
          method: "PATCH",
          body: {
            bill_no: bill.trim() || null,
            bill_date: date,
            lines: out.map((l) => ({ fruit_name: l.fruit_name, kg: l.kg.toFixed(2), rate: l.rate.toFixed(2), crates: l.crates })),
          },
        });
      } else {
        const a = parseNum(amount);
        if (!(a > 0)) throw new Error(t("badNumber"));
        await api(`/payments/${e.id}`, { method: "PATCH", body: { amount: a.toFixed(2), mode: e.type === "payment" ? mode : undefined, note: note.trim() || null, paid_date: payDate } });
      }
      onSaved();
    } catch (x) {
      setErr(x instanceof Error ? (x.message === "Network unreachable" ? t("needsConnection") : x.message) : String(x));
    } finally {
      setBusy(false);
    }
  }

  const total = lines.reduce((s, l) => s + (parseNum(l.kg) > 0 && Number.isFinite(parseNum(l.rate)) ? lineAmount(parseNum(l.kg), parseNum(l.rate)) : 0), 0);

  return (
    <Modal title={`${t("edit")}: ${typeLabel(e, t)}`} onClose={onClose}>
      <div className="space-y-3">
        {e.type === "sale" ? (
          <>
            <div>
              <label className="label">{t("billNo")}</label>
              <input className="field" value={bill} onChange={(x) => setBill(x.target.value)} />
            </div>
            <BsDatePicker label={t("date")} value={date} onChange={setDate} yearsBack={5} />
            {lines.map((l, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-line p-2">
                <input className="field" aria-label={t("fruitName")} value={l.fruit} onChange={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, fruit: x.target.value } : y)))} />
                <div className="grid grid-cols-3 gap-2">
                  <input className="field" inputMode="decimal" aria-label={t("kg")} value={l.kg} onChange={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, kg: x.target.value } : y)))} />
                  <input className="field" inputMode="decimal" aria-label={t("ratePerKg")} value={l.rate} onChange={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, rate: x.target.value } : y)))} />
                  <input className="field" inputMode="numeric" aria-label={t("crates")} value={l.crates} onChange={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, crates: x.target.value } : y)))} />
                </div>
                {lines.length > 1 && <button className="text-sm text-muted underline" onClick={() => setLines(lines.filter((_, j) => j !== i))}>{t("removeLine")}</button>}
              </div>
            ))}
            <button className="btn-secondary w-full" onClick={() => setLines([...lines, { fruit: "", kg: "", rate: "", crates: "" }])}>+ {t("addFruit")}</button>
            <p className="text-right font-semibold">{t("netTotal")}: {f.money(total)}</p>
          </>
        ) : (
          <>
            <input className="field" inputMode="decimal" aria-label={t("amount")} value={amount} onChange={(x) => setAmount(x.target.value)} />
            {e.type === "payment" && (
              <div className="flex flex-wrap gap-2">
                {PAY_MODES.map((m) => (
                  <button key={m} className={`chip ${mode === m ? "chip-on" : ""}`} onClick={() => setMode(m)}>{t(`mode_${m}`)}</button>
                ))}
              </div>
            )}
            <BsDatePicker label={t("date")} value={payDate} onChange={setPayDate} yearsBack={5} />
            <input className="field" aria-label={t("note")} placeholder={t("note")} value={note} onChange={(x) => setNote(x.target.value)} />
          </>
        )}
        {err && <p role="alert" className="text-sm text-owed">{err}</p>}
        <button className="btn-primary w-full" disabled={busy} onClick={() => void save()}>{t("save")}</button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ customer edit, merge, date

function EditCustomer({ sheet: s, onClose, onSave }: { sheet: Sheet; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(s.name);
  const [other, setOther] = useState(s.other_name ?? "");
  const [phone, setPhone] = useState(s.phone ?? "");
  const [addr, setAddr] = useState(s.address ?? "");
  const [old, setOld] = useState(s.old_balance ? String(parseFloat(s.old_balance)) : "");
  const [oldDate, setOldDate] = useState(s.old_balance_date ?? todayNpl());
  const oldNum = old.trim() ? parseNum(old) : 0;
  const bad = !name.trim() || !Number.isFinite(oldNum);
  return (
    <Modal title={t("edit")} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">{t("customer")}</label><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">{t("otherName")}</label><input className="field" value={other} onChange={(e) => setOther(e.target.value)} /></div>
        <div><label className="label">{t("phone")}</label><input className="field" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><label className="label">{t("address")}</label><input className="field" value={addr} onChange={(e) => setAddr(e.target.value)} /></div>
        <div>
          <label className="label">{t("oldBalance")}</label>
          <input className="field" inputMode="decimal" value={old} onChange={(e) => setOld(e.target.value)} placeholder="0" />
          <div className="mt-2"><BsDatePicker label={t("asOf")} value={oldDate} onChange={setOldDate} yearsBack={8} /></div>
        </div>
        <button
          className="btn-primary w-full"
          disabled={bad}
          onClick={() =>
            onSave({
              name: name.trim(),
              other_name: other.trim() || null,
              phone: phone.trim() || null,
              address: addr.trim() || null,
              old_balance: oldNum.toFixed(2),
              old_balance_date: oldDate,
            })
          }
        >
          {t("save")}
        </button>
      </div>
    </Modal>
  );
}

function MergeModal({ sheet: s, onClose, onDone }: { sheet: Sheet; onClose: () => void; onDone: (intoId: string) => void }) {
  const { t } = useTranslation();
  const { customers } = useCustomers();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const f = useFmt();
  const options = customers.filter((c) => c.id !== s.id && !c.pending_new && (!q.trim() || nameMatches(q, c.name, c.other_name) || norm(c.name).includes(norm(q)))).slice(0, 8);
  const chosen = customers.find((c) => c.id === target);

  async function merge() {
    if (!target) return;
    try {
      await api(`/customers/${s.id}/merge`, { body: { into_id: target } });
      onDone(target);
    } catch (e) {
      setErr(e instanceof Error ? (e.message === "Network unreachable" ? t("needsConnection") : e.message) : String(e));
    }
  }

  return (
    <Modal title={t("merge")} onClose={onClose}>
      <p className="mb-3 text-sm">{t("mergeHelp", { name: s.name })}</p>
      <input className="field mb-2" placeholder={t("searchCustomers")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="divide-y divide-line">
        {options.map((c) => (
          <button key={c.id} className={`flex min-h-touch w-full items-center justify-between px-2 py-2 text-left ${target === c.id ? "bg-tint" : ""}`} onClick={() => setTarget(c.id)}>
            <span className="truncate">{c.name}</span>
            <Balance value={c.balance} />
          </button>
        ))}
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-owed">{err}</p>}
      {chosen && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">{t("mergeConfirm", { from: s.name, to: chosen.name, balance: f.money(parseNum(s.balance) + parseNum(chosen.balance)) })}</p>
          <ConfirmButton className="btn-primary w-full" label={t("merge")} confirmLabel={t("tapAgainConfirm")} onConfirm={() => void merge()} />
        </div>
      )}
    </Modal>
  );
}

function DateModal({ value, onClose, onSave }: { value: string | null; onClose: () => void; onSave: (d: string | null) => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState(value ?? todayNpl());
  return (
    <Modal title={t("collectionDate")} onClose={onClose}>
      <BsDatePicker value={d} onChange={setD} />
      <div className="mt-4 flex gap-2">
        <button className="btn-primary flex-1" onClick={() => onSave(d)}>{t("save")}</button>
        <button className="btn-secondary flex-1" onClick={() => onSave(null)}>{t("noDate")}</button>
      </div>
    </Modal>
  );
}
