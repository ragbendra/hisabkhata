import Dexie, { type Table } from "dexie";
import type { EntryPayload } from "./types";

/** An entry saved on this phone that the server has not confirmed yet (FR-32). */
export interface OutboxRow {
  id: string; // client UUID of this save
  payload: EntryPayload;
  summary: { customerName: string; total: number; received: number; billNo: string | null; isNewCustomer: boolean };
  queuedAt: number;
  attempts: number;
  sending?: boolean;
  undone?: boolean;
  failed?: boolean; // the server refused it (not a connection problem)
  error?: string;
}

export interface DraftRow {
  key: string;
  data: unknown;
  updatedAt: number;
}

export interface CacheRow {
  key: string;
  value: unknown;
  updatedAt: number;
}

class FruitKhataDb extends Dexie {
  outbox!: Table<OutboxRow, string>;
  drafts!: Table<DraftRow, string>;
  cache!: Table<CacheRow, string>;

  constructor() {
    super("fruit-khata");
    this.version(1).stores({
      outbox: "id, queuedAt",
      drafts: "key",
      cache: "key",
    });
  }
}

export const db = new FruitKhataDb();

export async function clearLocalData() {
  await Promise.all([db.cache.clear(), db.drafts.clear()]);
  // The outbox is deliberately kept: unsent entries must never be thrown away by a sign-out.
}
