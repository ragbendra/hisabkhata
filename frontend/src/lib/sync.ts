import { api, ApiError, NetworkError } from "./api";
import { db, type OutboxRow } from "./db";
import { queryClient } from "./queryClient";
import { parseNum } from "./calc";
import type { EntryPayload, EntryResult, Khata } from "./types";

let flushing = false;

/** Merge the server's answer into the cached Khata data so the screen is right before the next refetch. */
async function applyResult(res: EntryResult, payload: EntryPayload) {
  const current = queryClient.getQueryData<Khata>(["khata"]) ?? ((await db.cache.get("khata"))?.value as Khata | undefined);
  if (!current) return;
  const has = current.customers.some((c) => c.id === res.customer.id);
  const customers = has
    ? current.customers.map((c) =>
        c.id === res.customer.id
          ? { ...c, balance: res.customer.balance, next_collection_date: res.customer.next_collection_date }
          : c,
      )
    : [
        ...current.customers,
        {
          id: res.customer.id,
          name: res.customer.name,
          other_name: payload.new_customer?.other_name ?? null,
          phone: payload.new_customer?.phone ?? null,
          address: payload.new_customer?.address ?? null,
          balance: res.customer.balance,
          last_activity: null,
          days_owing: null,
          next_collection_date: res.customer.next_collection_date,
          archived: false,
          possible_duplicate_of: null,
        },
      ];
  const next: Khata = { ...current, customers };
  queryClient.setQueryData(["khata"], next);
  await db.cache.put({ key: "khata", value: next, updatedAt: Date.now() });
}

async function voidSent(res: EntryResult) {
  // The person pressed Undo while the entry was being sent: undo it on the server now.
  if (res.sale) await api(`/sales/${res.sale.id}?with_payment=false`, { method: "DELETE" });
  if (res.payment) await api(`/payments/${res.payment.id}`, { method: "DELETE" });
}

/** Sends every waiting entry, oldest first. Sending the same entry twice is safe (the server dedupes by UUID). */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  let sentAny = false;
  try {
    const rows = await db.outbox.orderBy("queuedAt").toArray();
    for (const row of rows) {
      if (row.failed) continue;
      if (!(await db.outbox.get(row.id))) continue;
      await db.outbox.update(row.id, { sending: true });
      try {
        const res = await api<EntryResult>("/entries", { method: "POST", body: row.payload });
        const latest = await db.outbox.get(row.id);
        await applyResult(res, row.payload);
        await db.outbox.delete(row.id);
        sentAny = true;
        if (latest?.undone) await voidSent(res).catch(() => undefined);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await db.outbox.update(row.id, { sending: false });
          queryClient.invalidateQueries({ queryKey: ["me"] });
          break;
        }
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
          await db.outbox.update(row.id, { sending: false, failed: true, error: e.message });
          continue;
        }
        // connection problem or server error: keep it, try again later
        await db.outbox.update(row.id, { sending: false, attempts: row.attempts + 1 });
        if (!(e instanceof NetworkError)) console.warn("send failed", e);
        break;
      }
    }
  } finally {
    flushing = false;
  }
  if (sentAny) queryClient.invalidateQueries();
}

export async function retryFailed(id: string) {
  await db.outbox.update(id, { failed: false, error: undefined });
  void flushOutbox();
}

export async function discardEntry(id: string) {
  await db.outbox.delete(id);
}

/** Undo for an entry saved in this session (FR-12). Returns what happened. */
export async function undoEntry(id: string, ids: { sale?: string; payment?: string }): Promise<"removed" | "pending-undo" | "voided"> {
  const outcome = await db.transaction("rw", db.outbox, async () => {
    const row = await db.outbox.get(id);
    if (!row) return "sent" as const;
    if (row.sending) {
      await db.outbox.update(id, { undone: true });
      return "pending-undo" as const;
    }
    await db.outbox.delete(id);
    return "removed" as const;
  });
  if (outcome !== "sent") return outcome;
  if (ids.sale) await api(`/sales/${ids.sale}?with_payment=false`, { method: "DELETE" });
  if (ids.payment) await api(`/payments/${ids.payment}`, { method: "DELETE" });
  queryClient.invalidateQueries();
  return "voided";
}

export function oldestWaitingMs(rows: OutboxRow[]): number {
  const waiting = rows.filter((r) => !r.failed);
  if (!waiting.length) return 0;
  return Date.now() - Math.min(...waiting.map((r) => r.queuedAt));
}

export function startSync() {
  // a crash in the middle of a send must not leave rows stuck in "sending"
  void db.outbox.toCollection().modify({ sending: false }).then(() => flushOutbox());
  window.addEventListener("online", () => void flushOutbox());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushOutbox();
  });
  window.setInterval(() => void flushOutbox(), 30_000);
  // Ask the browser not to evict this site's data (iOS may still clear it if the app is not installed: FR-35).
  void navigator.storage?.persist?.().catch(() => undefined);
}

export function paymentTotal(p: EntryPayload): number {
  return p.received_amount ? parseNum(p.received_amount) : 0;
}
