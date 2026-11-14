import { lineAmount, parseNum } from "./calc";
import type { OutboxRow } from "./db";
import type { CustomerRow, EntryPayload } from "./types";

/** How much one saved-but-unsent entry changes its customer's balance. */
export function entryDelta(p: EntryPayload): number {
  let delta = 0;
  for (const ln of p.lines ?? []) delta += lineAmount(parseNum(ln.kg), parseNum(ln.rate));
  if (p.received_amount) delta -= parseNum(p.received_amount);
  const old = p.new_customer?.old_balance;
  if (old) delta += parseNum(old);
  return delta;
}

export function entryCustomerId(p: EntryPayload): string {
  return (p.customer_id ?? p.new_customer?.id) as string;
}

export interface PendingByCustomer {
  delta: number;
  rows: OutboxRow[];
}

export function groupPending(rows: OutboxRow[]): Map<string, PendingByCustomer> {
  const map = new Map<string, PendingByCustomer>();
  for (const r of rows) {
    if (r.failed) continue; // refused by the server: not part of any balance
    const id = entryCustomerId(r.payload);
    const cur = map.get(id) ?? { delta: 0, rows: [] };
    cur.delta += entryDelta(r.payload);
    cur.rows.push(r);
    map.set(id, cur);
  }
  return map;
}

/** Balances that include entries still waiting to be sent (FR-34); brand-new customers appear too. */
export function overlayCustomers(list: CustomerRow[], pending: Map<string, PendingByCustomer>): CustomerRow[] {
  const known = new Set(list.map((c) => c.id));
  const out = list.map((c) => {
    const p = pending.get(c.id);
    return p ? { ...c, balance: (parseNum(c.balance) + p.delta).toFixed(2) } : c;
  });
  for (const [id, p] of pending) {
    if (known.has(id)) continue;
    const nc = p.rows[0].payload.new_customer;
    if (!nc) continue; // an existing customer we have not loaded yet
    out.push({
      id,
      name: nc.name,
      other_name: nc.other_name ?? null,
      phone: nc.phone ?? null,
      address: nc.address ?? null,
      balance: p.delta.toFixed(2),
      last_activity: null,
      days_owing: null,
      next_collection_date: null,
      archived: false,
      possible_duplicate_of: null,
      pending_new: true,
    });
  }
  return out;
}

export function totalToCollect(list: CustomerRow[]): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const c of list) {
    const b = parseNum(c.balance);
    if (b > 0) {
      total += b;
      count++;
    }
  }
  return { total, count };
}
