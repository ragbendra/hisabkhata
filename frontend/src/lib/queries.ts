import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { api, fetchWithCache } from "./api";
import { setDateSystem } from "./datesystem";
import { db, type OutboxRow } from "./db";
import { groupPending, overlayCustomers, totalToCollect } from "./pending";
import type { Khata, FruitName, HistoryEntry, Me, SalesGroup, Settings, Sheet, UserRow, CustomerRow } from "./types";

export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const m = await fetchWithCache<Me>("me", "/auth/me");
      if (m?.shop?.date_system) setDateSystem(m.shop.date_system);
      return m;
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

export const useKhata = (enabled = true) =>
  useQuery({ queryKey: ["khata"], queryFn: () => fetchWithCache<Khata>("khata", "/khata"), enabled });

export const useSettings = (enabled = true) =>
  useQuery({ queryKey: ["settings"], queryFn: () => fetchWithCache<Settings>("settings", "/settings"), enabled });

export const useFruitNames = () =>
  useQuery({ queryKey: ["fruit-names"], queryFn: () => fetchWithCache<FruitName[]>("fruit-names", "/fruit-names") });

export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: ["users"], queryFn: () => api<UserRow[]>("/users"), enabled });

export const useSheet = (id: string) =>
  useQuery({ queryKey: ["sheet", id], queryFn: () => fetchWithCache<Sheet>(`sheet:${id}`, `/customers/${id}`) });

/** Oldest first; the screen flips it (FR-16). */
export const useHistory = (id: string) =>
  useQuery({
    queryKey: ["history", id],
    queryFn: () => fetchWithCache<HistoryEntry[]>(`history:${id}`, `/customers/${id}/history?order=asc`),
  });

export interface SalesParams {
  group: "day" | "week" | "month" | "range";
  from?: string;
  to?: string;
  customer?: string;
}

export const useSales = (p: SalesParams) => {
  const qs = new URLSearchParams({ group: p.group });
  if (p.group === "range") {
    if (p.from) qs.set("from", p.from);
    if (p.to) qs.set("to", p.to);
  }
  if (p.customer) qs.set("customer", p.customer);
  const path = `/reports/sales?${qs}`;
  return useQuery({
    queryKey: ["sales", path],
    queryFn: () => fetchWithCache<{ group: string; groups: SalesGroup[] }>(`sales:${path}`, path),
  });
};

export function useOutbox(): OutboxRow[] {
  return useLiveQuery(() => db.outbox.orderBy("queuedAt").toArray(), [], [] as OutboxRow[]) ?? [];
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Customer list with entries still waiting to be sent included in each balance (FR-34). */
export function useCustomers() {
  const khata = useKhata();
  const outbox = useOutbox();
  return useMemo(() => {
    const pending = groupPending(outbox);
    const customers: CustomerRow[] = overlayCustomers(khata.data?.customers ?? [], pending);
    return { customers, pending, totals: totalToCollect(customers), khata, outbox };
  }, [khata, outbox]);
}
