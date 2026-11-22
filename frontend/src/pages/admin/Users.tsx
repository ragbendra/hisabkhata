import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmButton, Modal, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { Columns, Tile } from "./charts";
import { ago, errMsg, fmtDate } from "./shared";

export interface Device {
  id: string;
  label: string;
  ip: string | null;
  signed_in_at: string;
  last_seen_at: string;
}
export interface AdminUser {
  id: string;
  name: string;
  login: string;
  role: "owner" | "helper";
  disabled: boolean;
  shop: { id: string; name: string; state: string } | null;
  devices: Device[];
  last_seen_at: string | null;
}
interface EventRow {
  id: string;
  at: string;
  kind: string;
  login: string | null;
  shop: string | null;
  ip: string | null;
  device: string | null;
  detail: string | null;
}

export const EVENT_LABEL: Record<string, string> = {
  login_ok: "Signed in",
  login_failed: "Failed sign-in",
  device_limit: "Refused: 3 devices",
  device_signout: "Signed a device out",
  export_full: "Full export",
};

/** One person: their devices and everything the admin can do about them. */
export function UserCard({ u, showShop = true }: { u: AdminUser; showShop?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const events = useQuery({ queryKey: ["admin-user-events", u.id], queryFn: () => api<EventRow[]>(`/admin/users/${u.id}/events`), enabled: open });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
    void qc.invalidateQueries({ queryKey: ["admin-shop-activity"] });
    void qc.invalidateQueries({ queryKey: ["admin-user-events", u.id] });
  };
  const run = useMutation({
    mutationFn: async (a: { ok: string; f: () => Promise<unknown> }) => {
      await a.f();
      return a.ok;
    },
    onSuccess: (ok) => {
      setErr(null);
      setMsg(ok);
      refresh();
    },
    onError: (e) => {
      setMsg(null);
      setErr(errMsg(e));
    },
  });

  return (
    <div className="rounded-xl ring-1 ring-line">
      <button className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            {u.name}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${u.role === "owner" ? "bg-tint text-brand" : "bg-bg text-muted"}`}>{u.role}</span>
            {u.disabled && <span className="ml-1 rounded-full bg-owedtint px-2 py-0.5 text-xs font-medium text-owed">disabled</span>}
          </div>
          <div className="truncate text-xs text-muted">
            {u.login}
            {showShop && u.shop ? ` · ${u.shop.name}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted">
          <div>{u.devices.length} of 3 devices</div>
          <div>{u.last_seen_at ? ago(u.last_seen_at) : "not signed in"}</div>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line p-3 text-sm">
          {msg && <p role="status" className="rounded-xl bg-tint p-2 text-recv">{msg}</p>}
          {err && <p role="alert" className="rounded-xl bg-owedtint p-2 text-owed">{err}</p>}

          <div className="space-y-2">
            <div className="sec-title">Devices signed in</div>
            {u.devices.length === 0 && <p className="muted">None.</p>}
            {u.devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg bg-bg p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.label}</div>
                  <div className="text-xs text-muted">{d.ip ?? "unknown address"} · since {fmtDate(d.signed_in_at, true)} · last used {ago(d.last_seen_at)}</div>
                </div>
                <ConfirmButton label="Sign out" confirmLabel="Tap again" className="btn-secondary !min-h-[40px] !px-3 text-xs"
                  onConfirm={() => run.mutate({ ok: `Signed out ${d.label}`, f: () => api(`/admin/sessions/${d.id}`, { method: "DELETE" }) })} />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <ConfirmButton label="Sign out everywhere" confirmLabel="Tap again to confirm" disabled={u.devices.length === 0}
              onConfirm={() => run.mutate({ ok: "Signed out everywhere", f: () => api(`/admin/users/${u.id}/signout-all`, { body: {} }) })} />
            <ConfirmButton label={u.disabled ? "Enable login" : "Disable login"} confirmLabel="Tap again to confirm"
              onConfirm={() => run.mutate({ ok: u.disabled ? "Login enabled" : "Login disabled and signed out", f: () => api(`/admin/users/${u.id}/disabled`, { body: { disabled: !u.disabled } }) })} />
            <button className="btn-secondary" onClick={() => setPw(pw === null ? "" : null)}>Set a new password</button>
          </div>

          {pw !== null && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run.mutate({ ok: "Password changed. Tell them to change it after signing in.", f: () => api(`/admin/users/${u.id}/password`, { body: { password: pw } }) });
                setPw(null);
              }}
            >
              <input className="field" type="text" autoComplete="off" placeholder="New password (8 or more characters)" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} />
              <button className="btn-primary">Save</button>
            </form>
          )}

          <div className="space-y-1">
            <div className="sec-title">Recent sign-ins</div>
            {events.isLoading && <Spinner />}
            {events.data?.length === 0 && <p className="muted">Nothing recorded in the last 90 days.</p>}
            {events.data?.slice(0, 12).map((e) => (
              <div key={e.id} className="flex justify-between gap-2 text-xs">
                <span className={e.kind === "login_failed" || e.kind === "device_limit" ? "text-owed" : ""}>{EVENT_LABEL[e.kind] ?? e.kind}{e.detail ? ` · ${e.detail}` : ""}</span>
                <span className="shrink-0 text-muted">{e.device ?? ""} {e.ip ?? ""} · {fmtDate(e.at, true)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the Users tab

export function UsersTab() {
  const [q, setQ] = useState("");
  const [shopId, setShopId] = useState<string | null>(null);
  const users = useQuery({ queryKey: ["admin-users", q], queryFn: () => api<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q)}`), refetchOnMount: "always" });
  const groups = new Map<string, { name: string; id: string; users: AdminUser[] }>();
  for (const u of users.data ?? []) {
    const k = u.shop?.id ?? "none";
    if (!groups.has(k)) groups.set(k, { id: k, name: u.shop?.name ?? "(no shop)", users: [] });
    groups.get(k)!.users.push(u);
  }
  return (
    <div className="space-y-3">
      <input className="field" type="search" placeholder="Search a person, login or shop" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
      {users.isLoading && <Spinner />}
      {users.error && <p role="alert" className="text-owed">{errMsg(users.error)}</p>}
      {users.data?.length === 0 && <p className="muted">No one matches.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {[...groups.values()].map((g) => (
          <section key={g.id} className="card space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{g.name}</h3>
              {g.id !== "none" && <button className="text-sm text-brand underline" onClick={() => setShopId(g.id)}>Activity</button>}
            </div>
            {g.users.map((u) => <UserCard key={u.id} u={u} showShop={false} />)}
          </section>
        ))}
      </div>
      {shopId && <ShopActivityModal shopId={shopId} onClose={() => setShopId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- one shop: week numbers, graph and timeline

interface Activity {
  shop: { id: string; name: string; state: string };
  users: AdminUser[];
  week: { bills: number; payments: number; deleted_or_voided: number; exports: number; sign_ins: number; failed_sign_ins: number };
  days: string[];
  entries: number[];
  timeline: { at: string; what: string; who: string | null; where: string | null; detail: string | null }[];
}

export function ShopActivityModal({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["admin-shop-activity", shopId], queryFn: () => api<Activity>(`/admin/shops/${shopId}/activity`) });
  const a = q.data;
  return (
    <Modal title={a ? `${a.shop.name}: devices and activity` : "Activity"} onClose={onClose}>
      {q.isLoading && <Spinner />}
      {q.error && <p role="alert" className="text-owed">{errMsg(q.error)}</p>}
      {a && (
        <div className="space-y-4 text-sm">
          <div>
            <div className="sec-title mb-2">Last 7 days</div>
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Bills" value={a.week.bills} />
              <Tile label="Payments" value={a.week.payments} />
              <Tile label="Deleted or voided" value={a.week.deleted_or_voided} tone={a.week.deleted_or_voided >= 5 ? "warn" : undefined} />
              <Tile label="Sign-ins" value={a.week.sign_ins} />
              <Tile label="Failed sign-ins" value={a.week.failed_sign_ins} tone={a.week.failed_sign_ins >= 5 ? "warn" : undefined} />
              <Tile label="Full exports" value={a.week.exports} />
            </div>
          </div>
          <div>
            <div className="sec-title mb-1">Entries per day, last 14 days</div>
            <Columns labels={a.days.map((d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }))} values={a.entries} barName="Entries" height={120} />
          </div>
          <div className="space-y-2">
            <div className="sec-title">People and devices</div>
            {a.users.map((u) => <UserCard key={u.id} u={u} showShop={false} />)}
          </div>
          <div>
            <div className="sec-title mb-1">Timeline</div>
            {a.timeline.length === 0 && <p className="muted">Nothing in the last 7 days.</p>}
            <div className="max-h-72 divide-y divide-line overflow-auto">
              {a.timeline.map((t, i) => (
                <div key={i} className="flex justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0">
                    <span className="font-medium">{t.what}</span>
                    {t.who ? <span className="text-muted"> · {t.who}</span> : null}
                    {t.detail ? <span className="text-muted"> · {t.detail}</span> : null}
                  </span>
                  <span className="shrink-0 text-muted">{t.where ? `${t.where} · ` : ""}{fmtDate(t.at, true)}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted">Counts and who/when only. Customer names, bills and balances are never shown here.</p>
        </div>
      )}
    </Modal>
  );
}
