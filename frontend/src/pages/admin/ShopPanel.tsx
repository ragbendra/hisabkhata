import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { ShopActivityModal } from "./Users";
import { copyText, errMsg, fmtDate, ago, StatePill, type ShopDetail } from "./shared";

const MODES = ["esewa", "khalti", "bank", "cash", "other"];
const today = () => new Date().toISOString().slice(0, 10);

/** Everything the admin can do to one shop. Shop-level numbers only: no customer or ledger data is shown. */
export default function ShopPanel({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["admin-shop", shopId], queryFn: () => api<ShopDetail>(`/admin/shops/${shopId}`) });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [activity, setActivity] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-shop", shopId] });
    void qc.invalidateQueries({ queryKey: ["admin-shops"] });
  };
  const run = useMutation({
    mutationFn: async (f: () => Promise<unknown>) => f(),
    onSuccess: () => {
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const act = (ok: string, f: () => Promise<unknown>) =>
    run.mutate(async () => {
      await f();
      setMsg(ok);
    });

  const s = detail.data;
  const [pay, setPay] = useState({ amount: "", mode: "esewa", paid_on: today(), extend_days: "30", note: "" });
  const [edit, setEdit] = useState<{ name: string; status: string; until: string; notes: string } | null>(null);

  return (
    <Modal title={s?.name ?? "Shop"} onClose={onClose}>
      {!s ? (
        <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatePill shop={s} />
            <span className="muted">
              {s.access_until_date ? `until ${fmtDate(s.access_until_date)}` : "no end date"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="muted">Owner</span>
            <span>{s.owner_name} · {s.owner_email}</span>
            <span className="muted">Joined</span>
            <span>{fmtDate(s.created_at)}</span>
            <span className="muted">Last entry</span>
            <span>{ago(s.last_activity)}</span>
            <span className="muted">Customers · bills · users</span>
            <span>{s.customers} · {s.bills} · {s.users}</span>
          </div>
          <button className="btn-secondary w-full" onClick={() => setActivity(true)}>Devices and activity</button>
          {activity && <ShopActivityModal shopId={s.id} onClose={() => setActivity(false)} />}
          {msg && <p role="status" className="rounded-xl bg-tint p-2 text-recv">{msg}</p>}
          {err && <p role="alert" className="rounded-xl bg-owedtint p-2 text-owed">{err}</p>}

          <section>
            <h3 className="sec-title mb-2">Extend access</h3>
            <div className="flex gap-2">
              {[7, 14, 30, 90].map((d) => (
                <button key={d} className="btn-secondary !min-h-[40px] flex-1 !px-2" disabled={run.isPending}
                  onClick={() => act(`Extended by ${d} days`, () => api(`/admin/shops/${s.id}/extend`, { body: { days: d } }))}>
                  +{d}d
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="sec-title">Record a payment</h3>
            <div className="grid grid-cols-2 gap-2">
              <input className="field" inputMode="decimal" placeholder="Amount (Rs)" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
              <select className="field" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
                {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input className="field" type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} />
              <input className="field" inputMode="numeric" placeholder="Days to add" value={pay.extend_days} onChange={(e) => setPay({ ...pay, extend_days: e.target.value })} />
            </div>
            <input className="field" placeholder="Note (optional)" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            <button className="btn-primary w-full" disabled={run.isPending || !pay.amount}
              onClick={() => act("Payment recorded", async () => {
                await api(`/admin/shops/${s.id}/payments`, { body: { amount: pay.amount, mode: pay.mode, paid_on: pay.paid_on, extend_days: Number(pay.extend_days) || 0, note: pay.note || null } });
                setPay({ ...pay, amount: "", note: "" });
              })}>
              Save payment
            </button>
          </section>

          <section className="space-y-2">
            <h3 className="sec-title">Edit shop</h3>
            {!edit ? (
              <button className="btn-secondary w-full" onClick={() => setEdit({ name: s.name, status: s.status, until: s.access_until_date ?? "", notes: s.admin_notes ?? "" })}>
                Change name, status, end date or notes
              </button>
            ) : (
              <div className="space-y-2">
                <input className="field" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                <select className="field" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  <option value="trial">Trial</option>
                  <option value="active">Active (paid)</option>
                  <option value="suspended">Suspended (cannot sign in)</option>
                </select>
                <label className="label">Access until (empty = no end date)</label>
                <input className="field" type="date" value={edit.until} onChange={(e) => setEdit({ ...edit, until: e.target.value })} />
                <textarea className="field !py-2" rows={2} placeholder="Private notes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                <div className="flex gap-2">
                  <button className="btn-secondary flex-1" onClick={() => setEdit(null)}>Cancel</button>
                  <button className="btn-primary flex-1" disabled={run.isPending}
                    onClick={() => act("Saved", async () => {
                      await api(`/admin/shops/${s.id}`, { method: "PATCH", body: { name: edit.name, status: edit.status, access_until: edit.until || null, admin_notes: edit.notes } });
                      setEdit(null);
                    })}>
                    Save
                  </button>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              {s.status === "suspended" ? (
                <button className="btn-secondary flex-1" disabled={run.isPending} onClick={() => act("Shop restored", () => api(`/admin/shops/${s.id}`, { method: "PATCH", body: { status: "active" } }))}>
                  Restore shop
                </button>
              ) : (
                <button className="btn-secondary flex-1 !text-owed" disabled={run.isPending}
                  onClick={() => { if (confirm(`Suspend ${s.name}? Everyone is signed out and cannot sign in.`)) act("Shop suspended", () => api(`/admin/shops/${s.id}`, { method: "PATCH", body: { status: "suspended" } })); }}>
                  Suspend
                </button>
              )}
              <button className="btn-secondary flex-1" disabled={run.isPending}
                onClick={() => act("Reset link made", async () => {
                  const r = await api<{ link: string; emailed: boolean }>(`/admin/shops/${s.id}/reset-owner-password`, { body: {} });
                  setLink(r.link);
                  if (!r.emailed) await copyText(r.link);
                })}>
                Reset owner password
              </button>
            </div>
            {link && (
              <div className="rounded-xl bg-tint p-2">
                <p className="muted mb-1">Send this link to the owner (valid 1 hour). It is also emailed when email is set up.</p>
                <input className="field !min-h-[40px] text-xs" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              </div>
            )}
          </section>

          <section>
            <h3 className="sec-title mb-2">Payments to Hisab</h3>
            {s.payments.length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              <ul className="card-list text-sm">
                {s.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between p-3">
                    <span>
                      <b>Rs {Number(p.amount).toLocaleString("en-IN")}</b> · {p.mode}
                      {p.note ? ` · ${p.note}` : ""}
                    </span>
                    <span className="muted">{fmtDate(p.paid_on)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="sec-title mb-2">People</h3>
            <ul className="card-list text-sm">
              {s.users_list.map((u) => (
                <li key={u.id} className="flex items-center justify-between p-3">
                  <span>{u.name} <span className="muted">({u.login})</span></span>
                  <span className="muted">{u.role}{u.disabled ? " · off" : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
