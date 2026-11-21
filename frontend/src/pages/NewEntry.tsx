import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import BsDatePicker from "../components/BsDatePicker";
import { CratesField, parseCrates } from "../components/CratesFields";
import UndoBar from "../components/UndoBar";
import { IconAlert, IconBack, IconCheck, IconClock, IconClose, IconPlus, initial } from "../components/icons";
import { Balance, Spinner } from "../components/ui";
import { api, NetworkError } from "../lib/api";
import { addDays, decimals, lineAmount, nameMatches, norm, normDigits, parseNum, todayNpl } from "../lib/calc";
import { useTrackCrates } from "../lib/crates";
import { db } from "../lib/db";
import { draftIsBlank, newLine, useEntryDraft, type CollectChoice, type EntryDraft, type LastSaved } from "../lib/draft";
import { useFmt } from "../lib/format";
import { useCustomers, useFruitNames, useMe, useSettings } from "../lib/queries";
import { flushOutbox } from "../lib/sync";
import { PAY_MODES, type EntryPayload } from "../lib/types";

interface Saved {
  saveId: string;
  name: string;
  total: number;
  received: number;
  customerId: string;
  date: string | null;
}

export default function NewEntryPage() {
  const { draft, update, reset, freeze } = useEntryDraft();
  const [params] = useSearchParams();
  const me = useMe().data!;
  const customersQ = useCustomers();
  const [saved, setSaved] = useState<Saved | null>(null);
  const appliedParam = useRef(false);

  // Arriving from "Received" in Collect now: preselect the customer and focus the received amount.
  const paramCustomer = params.get("customer");
  useEffect(() => {
    if (!draft || appliedParam.current || !paramCustomer || !customersQ.customers.length) return;
    const c = customersQ.customers.find((x) => x.id === paramCustomer);
    if (!c) return;
    appliedParam.current = true;
    if (draftIsBlank(draft) || draft.customerId === c.id) update({ customerId: c.id, customerText: c.name });
  }, [draft, paramCustomer, customersQ.customers, update]);

  if (!draft) return <Spinner />;

  if (saved) {
    return (
      <SavedScreen
        saved={saved}
        onNew={(keepContext) => {
          setSaved(null);
          appliedParam.current = true;
          // typing in a stack of old bills: keep the same customer and date for the next one
          reset(keepContext ? { customerId: saved.customerId, customerText: saved.name, date: saved.date } : undefined);
        }}
      />
    );
  }

  return (
    <EntryForm
      draft={draft}
      update={update}
      focusReceived={params.get("focus") === "received"}
      isOwner={me.role === "owner"}
      onClear={() => reset()}
      onSaved={(s) => {
        freeze();
        setSaved(s);
      }}
    />
  );
}

// ------------------------------------------------------------------------------------------------

function SavedScreen({ saved, onNew }: { saved: Saved; onNew: (keepContext?: boolean) => void }) {
  const { t } = useTranslation();
  const f = useFmt();
  const row = useLiveQuery(async () => (await db.outbox.get(saved.saveId)) ?? null, [saved.saveId], undefined);
  const undone = useLiveQuery(async () => !(await db.drafts.get("last-saved")), [], false);
  const failed = row?.failed;
  const waiting = row === undefined || row !== null;

  return (
    <div className="space-y-3">
      <div className={`card py-8 text-center ${failed ? "bg-owedtint" : waiting ? "bg-warntint" : ""}`}>
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${failed ? "bg-owed text-white" : waiting ? "bg-warn text-white" : "bg-brand text-onaccent"}`}
          aria-hidden
        >
          {failed ? <IconAlert size={28} /> : waiting ? <IconClock size={28} /> : <IconCheck size={28} />}
        </div>
        <h1 className="mt-3 font-serif text-2xl font-semibold" role="status">
          {failed ? t("saveRefused") : waiting ? t("savedOnPhone") : t("saved")}
        </h1>
        {failed && <p className="mt-1 text-owed">{row?.error}</p>}
        <p className="mt-2 text-muted">
          {saved.name}
          {saved.total > 0 && ` · ${t("sale")} ${f.money(saved.total)}`}
          {saved.received > 0 && ` · ${t("received")} ${f.money(saved.received)}`}
        </p>
      </div>
      {!undone && <UndoBar />}
      {saved.date && saved.date < todayNpl() && (
        <button className="btn-primary w-full" onClick={() => onNew(true)}>
          {t("addAnotherPast", { name: saved.name, date: f.date(saved.date) })}
        </button>
      )}
      <div className="flex gap-2">
        <button className={saved.date && saved.date < todayNpl() ? "btn-secondary flex-1" : "btn-primary flex-1"} onClick={() => onNew()}>
          {t("newEntry")}
        </button>
        <Link className="btn-secondary flex-1" to="/">
          {t("navKhata")}
        </Link>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------

function EntryForm({
  draft,
  update,
  focusReceived,
  isOwner,
  onClear,
  onSaved,
}: {
  draft: EntryDraft;
  update: (p: Partial<EntryDraft> | ((d: EntryDraft) => EntryDraft)) => void;
  focusReceived: boolean;
  isOwner: boolean;
  onClear: () => void;
  onSaved: (s: Saved) => void;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const { customers, pending } = useCustomers();
  const fruits = useFruitNames().data ?? [];
  const settings = useSettings().data;
  const outbox = useLiveQuery(() => db.outbox.toArray(), [], []) ?? [];
  const today = todayNpl();
  const yesterday = addDays(today, -1);
  // FR-10: only the owner can change the date. A past entry is a bill or payment from an earlier day.
  const isPast = isOwner && !!draft.date && draft.date < today;
  const futureDateErr = isOwner && !!draft.date && draft.date > today;
  const [pickDate, setPickDate] = useState(false);
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsChoice, setNeedsChoice] = useState(false);
  const [billDup, setBillDup] = useState<string | null>(null);
  const receivedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusReceived && draft.customerId) receivedRef.current?.focus();
  }, [focusReceived, draft.customerId]);

  // ---- customer
  const selected = draft.customerId ? customers.find((c) => c.id === draft.customerId) ?? null : null;
  const typed = draft.customerText.trim();
  const suggestions = useMemo(() => {
    if (!typed || selected) return [];
    return customers.filter((c) => !c.archived && nameMatches(typed, c.name, c.other_name)).slice(0, 6);
  }, [customers, typed, selected]);
  const exact = useMemo(
    () => (selected || !typed ? [] : customers.filter((c) => !c.archived && norm(c.name) === norm(typed))),
    [customers, typed, selected],
  );
  const isNew = !!typed && !selected;

  // ---- bill number suggestion: last number plus 1, counting entries still waiting to be sent
  const suggestedBill = useMemo(() => {
    let n = settings?.next_bill_no ?? 0;
    for (const r of outbox) {
      const b = r.payload.bill_no;
      if (b && /^\d+$/.test(b)) n = Math.max(n, Number(b) + 1);
    }
    return n > 0 && !isPast ? String(n) : ""; // an old paper slip has its own number: the owner types it
  }, [settings, outbox, isPast]);
  const billNo = draft.billNoTouched ? draft.billNo : suggestedBill;

  useEffect(() => {
    const b = billNo.trim();
    if (!b) return setBillDup(null);
    const local = outbox.find((r) => r.payload.bill_no === b);
    if (local) return setBillDup(local.summary.customerName);
    const id = window.setTimeout(() => {
      api<{ exists: boolean; customer: string | null }>(`/bills/check?bill_no=${encodeURIComponent(b)}`)
        .then((r) => setBillDup(r.exists ? r.customer ?? "?" : null))
        .catch(() => setBillDup(null));
    }, 400);
    return () => window.clearTimeout(id);
  }, [billNo, outbox]);

  // ---- lines
  const parsed = draft.lines.map((l) => {
    const kg = parseNum(l.kg);
    const rate = parseNum(l.rate);
    const blank = !l.fruit.trim() && !l.kg.trim() && !l.rate.trim() && !l.crates.trim();
    const kgOk = Number.isFinite(kg) && kg > 0 && decimals(l.kg) <= 2;
    const rateOk = Number.isFinite(rate) && rate >= 0 && l.rate.trim() !== "";
    const cratesOk = !l.crates.trim() || /^\d+$/.test(normDigits(l.crates.trim()));
    const ok = !blank && !!l.fruit.trim() && kgOk && rateOk && cratesOk;
    return { l, kg, rate, blank, ok, kgOk, rateOk, cratesOk, amount: ok ? lineAmount(kg, rate) : 0 };
  });
  const goodLines = parsed.filter((p) => p.ok);
  const badLines = parsed.filter((p) => !p.blank && !p.ok);
  const billTotal = goodLines.reduce((s, p) => s + p.amount, 0);

  // ---- money
  const trackCrates = useTrackCrates();
  const cratesBackN = trackCrates ? parseCrates(draft.cratesBack) : 0;
  const oldCratesN = trackCrates && isNew && isOwner ? parseCrates(draft.oldCrates) : 0;
  const cratesBad = cratesBackN === null || oldCratesN === null;
  const cratesBack = cratesBackN ?? 0;
  const oldCrates = oldCratesN ?? 0;
  const receivedNum = parseNum(draft.received);
  const hasReceived = Number.isFinite(receivedNum) && receivedNum > 0;
  const receivedBad = draft.received.trim() !== "" && !hasReceived;
  const received = hasReceived ? receivedNum : 0;

  const oldBalNum = isOwner && isNew && draft.oldBalance.trim() ? parseNum(draft.oldBalance) : 0;
  const prevBalance = selected ? parseNum(selected.balance) : Number.isFinite(oldBalNum) ? oldBalNum : 0;
  const balanceAfter = prevBalance + billTotal - received;

  // ---- collect by (FR-11)
  const futureDate = selected?.next_collection_date && selected.next_collection_date > today ? selected.next_collection_date : null;
  const effectiveCollect: CollectChoice = draft.collect !== "auto" ? draft.collect : futureDate || isPast ? "keep" : "7";
  const showCollect = balanceAfter > 0.005;
  const collectDate = draft.collectDate || addDays(today, 7);
  let collectBy: string | null | undefined;
  if (showCollect) {
    if (effectiveCollect === "keep") collectBy = undefined;
    else if (effectiveCollect === "none") collectBy = null;
    else if (effectiveCollect === "date") collectBy = collectDate;
    else collectBy = addDays(today, Number(effectiveCollect));
  }

  const valid =
    !!typed && (goodLines.length > 0 || hasReceived || cratesBack > 0) && badLines.length === 0 && !receivedBad && !cratesBad && !futureDateErr && (!isNew || !draft.oldBalance.trim() || Number.isFinite(oldBalNum));

  const setLine = (key: string, patch: Partial<EntryDraft["lines"][number]>) =>
    update((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  async function save(forceNew: boolean) {
    setShowErrors(true);
    if (!valid || busy) return;
    if (isNew && exact.length > 0 && !forceNew) {
      setNeedsChoice(true);
      return;
    }
    setBusy(true);
    const ids = draft.ids;
    const createdAt = new Date().toISOString();
    const payload: EntryPayload = { created_at: createdAt };
    if (selected) payload.customer_id = selected.id;
    else {
      payload.new_customer = {
        id: ids.newCustomer,
        name: typed,
        other_name: draft.otherName.trim() || null,
        phone: draft.phone.trim() || null,
        address: draft.address.trim() || null,
      };
      if (isOwner && draft.oldBalance.trim() && oldBalNum !== 0) {
        payload.new_customer.old_balance = oldBalNum.toFixed(2);
        payload.new_customer.old_balance_date = draft.oldBalanceDate;
      }
      if (oldCrates > 0) {
        payload.new_customer.old_crates = oldCrates;
        payload.new_customer.old_balance_date = draft.oldBalanceDate;
      }
    }
    if (goodLines.length) {
      payload.sale_id = ids.sale;
      payload.lines = goodLines.map((p) => ({
        fruit_name: p.l.fruit.trim(),
        kg: p.kg.toFixed(2),
        rate: p.rate.toFixed(2),
        crates: p.l.crates.trim() ? Number(normDigits(p.l.crates.trim())) : null,
      }));
      if (billNo.trim()) payload.bill_no = billNo.trim();
    }
    if (cratesBack > 0) payload.crates_back = cratesBack;
    if (hasReceived || cratesBack > 0) payload.payment_id = ids.payment;
    if (hasReceived) {
      payload.received_amount = received.toFixed(2);
      payload.kind = isOwner ? draft.kind : "payment";
      payload.mode = payload.kind === "discount" ? "other" : draft.mode;
      if (draft.note.trim()) payload.note = draft.note.trim();
    }
    if (isOwner && draft.date && draft.date !== today) payload.entry_date = draft.date;
    if (collectBy !== undefined) payload.collect_by = collectBy;

    // FR-32: write to the phone first (and clear the draft in the same transaction), then send.
    const last: LastSaved = {
      saveId: ids.saveId,
      saleId: payload.sale_id,
      paymentId: payload.payment_id,
      name: typed,
      savedAt: Date.now(),
    };
    await db.transaction("rw", db.outbox, db.drafts, async () => {
      await db.outbox.put({
        id: ids.saveId,
        payload,
        queuedAt: Date.now(),
        attempts: 0,
        summary: { customerName: typed, total: billTotal, received, billNo: payload.bill_no ?? null, isNewCustomer: isNew },
      });
      await db.drafts.delete("entry");
      await db.drafts.put({ key: "last-saved", data: last, updatedAt: Date.now() });
    });
    onSaved({ saveId: ids.saveId, name: typed, total: billTotal, received, customerId: selected?.id ?? ids.newCustomer, date: draft.date });
    void flushOutbox().catch((e) => e instanceof NetworkError || console.warn(e));
  }

  const chip = (on: boolean) => `chip ${on ? "chip-on" : ""}`;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      onKeyDown={(e) => {
        // Computer keyboard: Enter moves to the next box instead of saving by accident.
        // Ctrl+Enter saves. Shift+Enter adds another fruit line.
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        const el = e.target as HTMLElement;
        if (el.tagName !== "INPUT" || (el as HTMLInputElement).type === "search") return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          void save(false);
          return;
        }
        if (e.shiftKey) {
          update((d) => ({ ...d, lines: [...d.lines, newLine()] }));
          window.setTimeout(() => {
            const all = document.querySelectorAll<HTMLInputElement>("input[data-fruit]");
            all[all.length - 1]?.focus();
          }, 30);
          return;
        }
        const boxes = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>("input:not([disabled]):not([type=hidden])"));
        boxes[boxes.indexOf(el as HTMLInputElement) + 1]?.focus();
      }}
    >
      <UndoBar />
      <div className="-ml-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Link to="/" className="flex h-11 w-11 items-center justify-center rounded-full" aria-label={t("navKhata")}>
            <IconBack />
          </Link>
          <h1 className="font-serif text-2xl font-semibold">{t("newEntry")}</h1>
        </div>
        {!draftIsBlank(draft) && (
          <button type="button" className="min-h-touch px-2 text-sm text-muted underline" onClick={onClear}>
            {t("clearForm")}
          </button>
        )}
      </div>

      {/* ---- customer */}
      <section className="card">
        <label className="label" htmlFor="cust">
          {t("customer")}
        </label>
        {selected ? (
          <div className="flex items-center gap-3 rounded-xl bg-tint p-3">
            <span className="avatar bg-surface">{initial(selected.name)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{selected.name}</div>
              <div className="text-sm">
                <Balance value={selected.balance} />
              </div>
            </div>
            <button type="button" className="btn-secondary" onClick={() => update({ customerId: null })}>
              {t("change")}
            </button>
          </div>
        ) : (
          <>
            <input
              id="cust"
              className="field"
              autoComplete="off"
              value={draft.customerText}
              placeholder={t("customerPlaceholder")}
              onChange={(e) => {
                setNeedsChoice(false);
                update({ customerText: e.target.value });
              }}
            />
            {suggestions.length > 0 && (
              <ul className="card-list mt-2 !bg-bg">
                {suggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex min-h-touch w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      onClick={() => update({ customerId: c.id, customerText: c.name })}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="muted block truncate">{[c.phone, c.address].filter(Boolean).join(" · ") || "—"}</span>
                      </span>
                      <Balance value={c.balance} className="shrink-0 text-sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {isNew && <p className="mt-2 inline-block rounded-full bg-warntint px-3 py-1 text-sm font-semibold text-warn">{t("newCustomer")}</p>}
          </>
        )}

        {isNew && (
          <div className="mt-3">
            <button type="button" className="min-h-touch text-sm text-brand underline" onClick={() => update({ showDetails: !draft.showDetails })}>
              {draft.showDetails ? t("hideDetails") : t("addDetails")}
            </button>
            {draft.showDetails && (
              <div className="mt-2 space-y-3">
                <div>
                  <label className="label" htmlFor="phone">{t("phone")}</label>
                  <input id="phone" className="field" inputMode="tel" value={draft.phone} onChange={(e) => update({ phone: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="addr">{t("address")}</label>
                  <input id="addr" className="field" value={draft.address} onChange={(e) => update({ address: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="other">{t("otherName")}</label>
                  <input id="other" className="field" value={draft.otherName} onChange={(e) => update({ otherName: e.target.value })} />
                </div>
                {isOwner && (
                  <div className="rounded-xl p-3 ring-1 ring-line">
                    <label className="label" htmlFor="oldbal">{t("oldBalance")}</label>
                    <input
                      id="oldbal"
                      className="field"
                      inputMode="decimal"
                      value={draft.oldBalance}
                      onChange={(e) => update({ oldBalance: e.target.value })}
                      placeholder="0"
                    />
                    {draft.oldBalance.trim() !== "" && !Number.isFinite(oldBalNum) && showErrors && <p className="mt-1 text-sm text-owed">{t("badNumber")}</p>}
                    {trackCrates && isOwner && (
                      <div className="mt-3">
                        <CratesField id="oldcrates" label={t("oldCrates", { defaultValue: "Crates he already holds" })} value={draft.oldCrates} onChange={(v) => update({ oldCrates: v })} showError={showErrors} />
                      </div>
                    )}
                    <div className="mt-2">
                      <BsDatePicker label={t("asOf")} value={draft.oldBalanceDate} onChange={(d) => update({ oldBalanceDate: d })} yearsBack={5} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {showErrors && !typed && <p className="mt-1 text-sm text-owed">{t("customerRequired")}</p>}
      </section>

      {needsChoice && (
        <section className="card bg-warntint">
          <p className="mb-3 font-medium">{t("sameNameExists", { name: typed })}</p>
          <div className="space-y-2">
            {exact.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn-primary w-full justify-between"
                onClick={() => {
                  setNeedsChoice(false);
                  update({ customerId: c.id, customerText: c.name });
                }}
              >
                <span className="truncate">{t("useExisting")}: {[c.name, c.phone, c.address].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() => {
                setNeedsChoice(false);
                void save(true);
              }}
            >
              {t("createSeparate")}
            </button>
          </div>
        </section>
      )}

      {/* ---- bill number and date */}
      <section className="card space-y-3">
        <div>
          <label className="label" htmlFor="bill">{t("billNo")}</label>
          <input
            id="bill"
            className="field"
            inputMode="numeric"
            value={billNo}
            onChange={(e) => update({ billNo: e.target.value, billNoTouched: true })}
          />
          {billDup && <p role="alert" className="mt-1 text-sm text-warn">{t("billUsed", { name: billDup })}</p>}
        </div>
        {isOwner ? (
          <div className="space-y-2">
            <span className="label">{t("date")}</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chip(!draft.date || draft.date === today)} onClick={() => { setPickDate(false); update({ date: null }); }}>
                {t("dateToday")}
              </button>
              <button type="button" className={chip(draft.date === yesterday)} onClick={() => { setPickDate(false); update({ date: yesterday }); }}>
                {t("dateYesterday")}
              </button>
              <button
                type="button"
                className={chip(pickDate || (!!draft.date && draft.date !== today && draft.date !== yesterday))}
                onClick={() => { setPickDate(true); update({ date: draft.date ?? yesterday }); }}
              >
                {t("dateOther")}
              </button>
            </div>
            {(pickDate || (!!draft.date && draft.date !== today && draft.date !== yesterday)) && (
              <BsDatePicker value={draft.date ?? today} onChange={(d) => update({ date: d === today ? null : d })} yearsBack={5} yearsForward={0} />
            )}
            {draft.date && <p className="font-medium">{f.date(draft.date)}</p>}
            {isPast && (
              <div className="flex items-start gap-2.5 rounded-2xl bg-warntint p-3 text-[13px] font-medium text-warn">
                <IconClock size={18} className="mt-0.5 flex-none" />
                <p>{t("pastEntryBanner", { date: f.date(draft.date!) })}</p>
              </div>
            )}
            {futureDateErr && <p role="alert" className="text-sm text-owed">{t("futureDate")}</p>}
          </div>
        ) : (
          <p className="muted">{t("date")}: {f.date(today)}</p>
        )}
      </section>

      {/* ---- fruit lines */}
      <section className="space-y-3">
        <h2 className="sec-title pl-1">{t("fruits")}</h2>
        {draft.lines.map((l, idx) => {
          const p = parsed[idx];
          const matches =
            activeLine === l.key && l.fruit.trim()
              ? fruits.filter((x) => nameMatches(l.fruit, x.name) && norm(x.name) !== norm(l.fruit)).slice(0, 5)
              : [];
          return (
            <div key={l.key} className="card space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted">{f.digits(idx + 1)}</span>
                {draft.lines.length > 1 && (
                  <button
                    type="button"
                    className="min-h-touch min-w-touch text-muted"
                    aria-label={t("removeLine")}
                    onClick={() => update((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) }))}
                  >
                    <IconClose size={20} />
                  </button>
                )}
              </div>
              <input
                className="field"
                data-fruit
                aria-label={t("fruitName")}
                placeholder={t("fruitName")}
                autoComplete="off"
                value={l.fruit}
                onFocus={() => setActiveLine(l.key)}
                onBlur={() => window.setTimeout(() => setActiveLine((a) => (a === l.key ? null : a)), 150)}
                onChange={(e) => {
                  const v = e.target.value;
                  // when the name matches a remembered fruit, prefill its last rate (stays editable)
                  const hit = fruits.find((x) => norm(x.name) === norm(v));
                  setLine(l.key, {
                    fruit: v,
                    ...(hit && hit.last_rate && !l.rateTouched ? { rate: String(parseNum(hit.last_rate)) } : {}),
                  });
                }}
              />
              {matches.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {matches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="chip"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        setLine(l.key, {
                          fruit: m.name,
                          ...(m.last_rate && !l.rateTouched ? { rate: String(parseNum(m.last_rate)) } : {}),
                        })
                      }
                    >
                      {m.name}
                      {m.last_rate && <span className="muted ml-1">{f.num(m.last_rate)}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label">{t("kg")}</label>
                  <input className="field" inputMode="decimal" value={l.kg} onChange={(e) => setLine(l.key, { kg: e.target.value })} aria-invalid={showErrors && !p.blank && !p.kgOk} />
                </div>
                <div>
                  <label className="label">{t("ratePerKg")}</label>
                  <input
                    className="field"
                    inputMode="decimal"
                    value={l.rate}
                    onChange={(e) => setLine(l.key, { rate: e.target.value, rateTouched: true })}
                    aria-invalid={showErrors && !p.blank && !p.rateOk}
                  />
                </div>
                <div>
                  <label className="label">{t("crates")}</label>
                  <input className="field" inputMode="numeric" value={l.crates} onChange={(e) => setLine(l.key, { crates: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-owed">{showErrors && !p.blank && !p.ok ? t("lineIncomplete") : ""}</span>
                <span className="money text-lg">{p.ok ? f.money(p.amount) : ""}</span>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn-secondary w-full" onClick={() => update((d) => ({ ...d, lines: [...d.lines, newLine()] }))}>
          <IconPlus size={18} className="mr-1.5" />
          {t("addFruit")}
        </button>
      </section>

      {/* ---- received */}
      <section className="card space-y-3">
        <h2 className="sec-title pl-1">{t("receivedNow")}</h2>
        {isOwner && (
          <div className="flex gap-2">
            <button type="button" className={chip(draft.kind === "payment")} onClick={() => update({ kind: "payment" })}>
              {t("payment")}
            </button>
            <button type="button" className={chip(draft.kind === "discount")} onClick={() => update({ kind: "discount" })}>
              {t("discount")}
            </button>
          </div>
        )}
        <input
          ref={receivedRef}
          className="field"
          inputMode="decimal"
          aria-label={t("receivedNow")}
          placeholder="0"
          value={draft.received}
          onChange={(e) => update({ received: e.target.value })}
        />
        {receivedBad && showErrors && <p className="text-sm text-owed">{t("badNumber")}</p>}
        {trackCrates && (
          <CratesField id="cratesback" label={t("cratesBack", { defaultValue: "Crates he gave back" })} value={draft.cratesBack} onChange={(v) => update({ cratesBack: v })} showError={showErrors} />
        )}
        {draft.kind === "payment" || !isOwner ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("mode")}>
            {PAY_MODES.map((m) => (
              <button key={m} type="button" className={chip(draft.mode === m)} aria-pressed={draft.mode === m} onClick={() => update({ mode: m })}>
                {t(`mode_${m}`)}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{t("discountHelp")}</p>
        )}
        <input className="field" aria-label={t("note")} placeholder={t("note")} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
      </section>

      {/* ---- totals (FR-8): the bill total and balance after saving live in the sticky bar below */}
      <section className="card space-y-1.5 text-sm" aria-live="polite">
        <Row label={t("previousBalance")} value={<Balance value={prevBalance} />} />
        <Row label={t("billTotal")} value={f.money(billTotal)} />
        <Row label={t("received")} value={f.money(received)} />
      </section>

      {/* ---- collect by (FR-11) */}
      {showCollect && (
        <section className="card space-y-3">
          <h2 className="sec-title pl-1">{t("collectBy")}</h2>
          <div className="flex flex-wrap gap-2">
            {(futureDate || isPast) && (
              <button type="button" className={chip(effectiveCollect === "keep")} onClick={() => update({ collect: "keep" })}>
                {futureDate ? t("keepDate", { date: f.dateShort(futureDate) }) : t("noChange")}
              </button>
            )}
            {(["3", "7", "15"] as const).map((n) => (
              <button key={n} type="button" className={chip(effectiveCollect === n)} onClick={() => update({ collect: n })}>
                {t("inDays", { n: f.digits(n) })}
              </button>
            ))}
            <button type="button" className={chip(effectiveCollect === "date")} onClick={() => update({ collect: "date", collectDate })}>
              {t("chooseDate")}
            </button>
            <button type="button" className={chip(effectiveCollect === "none")} onClick={() => update({ collect: "none" })}>
              {t("noDate")}
            </button>
          </div>
          {effectiveCollect === "date" && <BsDatePicker value={collectDate} onChange={(d) => update({ collect: "date", collectDate: d })} />}
        </section>
      )}

      {showErrors && !valid && !needsChoice && (
        <p role="alert" className="text-sm text-owed">
          {!goodLines.length && !hasReceived ? t("needLineOrAmount") : t("fixHighlighted")}
        </p>
      )}

      {/* sticky bar: what the owner needs to see while typing, and the one button */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl rounded-t-3xl bg-surface px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-bar ring-1 ring-line">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1" aria-live="polite">
            <div className="text-xs text-muted">
              {t("billTotal")} {f.money(billTotal)}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="truncate text-xs text-muted">{t("balanceAfter")}</span>
              <Balance value={balanceAfter} className="text-xl" />
            </div>
          </div>
          <button className="btn-primary !h-[52px] px-7 text-base" disabled={busy} title={t("saveKeys", { defaultValue: "Ctrl+Enter" })}>
            {t("save")}
          </button>
        </div>
      </div>
      <p className="muted hidden text-center lg:block">{t("entryKeysHint", { defaultValue: "Enter: next box · Shift+Enter: add a fruit · Ctrl+Enter: save" })}</p>
      {pending.size > 0 && <p className="muted text-center">{t("waitingCount", { n: f.digits(outbox.filter((r) => !r.failed).length) })}</p>}
      <div className="h-24" aria-hidden />
    </form>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
