import { useSyncExternalStore } from "react";

/** Which calendar the shop shows first: Nepali (BS) or the international one (AD). Saved on the shop, cached here. */
export type DateSystem = "bs" | "ad";
const KEY = "fk_datesys";

function read(): DateSystem {
  try {
    return localStorage.getItem(KEY) === "ad" ? "ad" : "bs";
  } catch {
    return "bs";
  }
}

let current: DateSystem = read();
const listeners = new Set<() => void>();

export const getDateSystem = () => current;

export function setDateSystem(next: DateSystem) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: keep it in memory */
  }
  listeners.forEach((l) => l());
}

export const useDateSystem = (): DateSystem =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
