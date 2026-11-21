import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "./db";
import { todayNpl } from "./calc";
import type { PayMode } from "./types";

export interface DraftLine {
  key: string;
  fruit: string;
  kg: string;
  rate: string;
  crates: string;
  rateTouched: boolean;
}

export type CollectChoice = "auto" | "keep" | "3" | "7" | "15" | "date" | "none";

export interface EntryDraft {
  v: 1;
  /** Stable ids: saving twice (or retrying after a crash) sends the same UUIDs, so the server dedupes. */
  ids: { saveId: string; newCustomer: string; sale: string; payment: string; opening: string };
  customerText: string;
  customerId: string | null;
  showDetails: boolean;
  otherName: string;
  phone: string;
  address: string;
  oldBalance: string;
  oldBalanceDate: string;
  lines: DraftLine[];
  billNo: string;
  billNoTouched: boolean;
  date: string | null; // null = today
  received: string;
  /** crates he hands back in this visit, and crates he already holds from before (new customer) */
  cratesBack: string;
  oldCrates: string;
  mode: PayMode;
  kind: "payment" | "discount";
  note: string;
  collect: CollectChoice;
  collectDate: string;
}

const uuid = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
export const newLine = (): DraftLine => ({ key: uuid(), fruit: "", kg: "", rate: "", crates: "", rateTouched: false });

export function freshDraft(): EntryDraft {
  return {
    v: 1,
    ids: { saveId: uuid(), newCustomer: uuid(), sale: uuid(), payment: uuid(), opening: uuid() },
    customerText: "",
    customerId: null,
    showDetails: false,
    otherName: "",
    phone: "",
    address: "",
    oldBalance: "",
    oldBalanceDate: todayNpl(),
    lines: [newLine()],
    billNo: "",
    billNoTouched: false,
    date: null,
    received: "",
    cratesBack: "",
    oldCrates: "",
    mode: "cash",
    kind: "payment",
    note: "",
    collect: "auto",
    collectDate: "",
  };
}

export function draftIsBlank(d: EntryDraft): boolean {
  return (
    !d.customerText.trim() &&
    !d.customerId &&
    !d.received.trim() &&
    !(d.cratesBack ?? "").trim() &&
    d.lines.every((l) => !l.fruit.trim() && !l.kg.trim() && !l.rate.trim() && !l.crates.trim())
  );
}

const KEY = "entry";

/**
 * FR-31: everything typed is written to IndexedDB continuously, and comes back after the app is closed,
 * the phone restarts, or a call interrupts.
 */
export function useEntryDraft() {
  const [draft, setDraftState] = useState<EntryDraft | null>(null);
  const latest = useRef<EntryDraft | null>(null);
  const timer = useRef<number>();
  const frozen = useRef(false);

  const write = useCallback(() => {
    window.clearTimeout(timer.current);
    const d = latest.current;
    if (d && !frozen.current) void db.drafts.put({ key: KEY, data: d, updatedAt: Date.now() });
  }, []);

  useEffect(() => {
    let alive = true;
    db.drafts
      .get(KEY)
      .then((row) => {
        const d = row && (row.data as EntryDraft)?.v === 1 ? (row.data as EntryDraft) : freshDraft();
        latest.current = d;
        if (alive) setDraftState(d);
      })
      .catch(() => {
        const d = freshDraft();
        latest.current = d;
        if (alive) setDraftState(d);
      });
    const flush = () => write();
    const onVis = () => document.visibilityState === "hidden" && write();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      write();
    };
  }, [write]);

  const update = useCallback(
    (patch: Partial<EntryDraft> | ((d: EntryDraft) => EntryDraft)) => {
      const cur = latest.current;
      if (!cur) return;
      const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
      latest.current = next;
      setDraftState(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(write, 200);
    },
    [write],
  );

  /** Stops the debounced writer, so a draft that was just saved cannot be written back. */
  const freeze = useCallback(() => {
    frozen.current = true;
    window.clearTimeout(timer.current);
  }, []);

  const reset = useCallback(
    (base?: Partial<EntryDraft>) => {
      const d = { ...freshDraft(), ...base };
      latest.current = d;
      frozen.current = false;
      setDraftState(d);
      void db.drafts.put({ key: KEY, data: d, updatedAt: Date.now() });
    },
    [],
  );

  return { draft, update, reset, freeze };
}

export interface LastSaved {
  saveId: string;
  saleId?: string;
  paymentId?: string;
  name: string;
  savedAt: number;
}

export const UNDO_MS = 10 * 60 * 1000;
