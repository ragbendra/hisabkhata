import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PasswordInput from "../../components/PasswordInput";
import { useState, type FormEvent } from "react";
import { Spinner } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import ShopPanel from "./ShopPanel";
import { ago, errMsg, fmtDate, LinkBox, StatePill, type ShopRow } from "./shared";

/*
 * Platform admin (the person who runs Hisab). Mounted at /admin, outside the shop sign-in.
 * It talks to /api/admin/* with its own cookie, so a shop owner's login never opens it.
 */

interface Admin {
  id: string;
  email: string;
  name: string;
  two_step: boolean;
}
interface RequestRow {
  id: string;
  shop_name: string;
  owner_name: string;
  contact: string;
  city: string | null;
  message: string | null;
  created_at: string;
}
interface InviteRow {
  id: string;
  email: string | null;
  shop_name: string | null;
  owner_name: string | null;
  trial_days: number;
  status: "open" | "used" | "expired" | "revoked";
  created_at: string;
  expires_at: string;
}
interface MadeInvite extends InviteRow {
  link: string;
  emailed: boolean;
  contact?: string;
}
interface Platform {
  trial_days: number;
  invite_days: number;
  requests_open: boolean;
}

export default function AdminApp() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api<Admin>("/admin/me"),
    retry: false,
    staleTime: 60_000,
  });
  if (me.isLoading) return <Spinner />;
  if (!me.data) {
    const down = me.error && !(me.error instanceof ApiError);
    return <AdminLogin offline={Boolean(down)} />;
  }
  return (
    <AdminHome
      admin={me.data}
      onSignOut={async () => {
        await api("/admin/logout", { body: {} }).catch(() => undefined);
        qc.clear();
        await qc.invalidateQueries();
      }}
    />
  );
}

// ---------------------------------------------------------------- sign in

function AdminLogin({ offline }: { offline: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Admin | { need_code: true }>("/admin/login", {
        body: { email, password, code: needCode ? code : undefined },
      });
      if ("need_code" in r) setNeedCode(true);
      else await qc.invalidateQueries({ queryKey: ["admin-me"] });
    } catch (x) {
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="font-serif text-3xl font-semibold text-brand">Hisab admin</h1>
      <p className="mb-4 text-sm text-muted">Platform sign-in. This is not the shop login.</p>
      <form onSubmit={submit} className="card space-y-3">
        {offline && <p className="rounded bg-warntint p-2 text-sm text-warn">No connection to the server.</p>}
        <div>
          <label className="label" htmlFor="a-email">Email</label>
          <input id="a-email" className="field" type="email" autoCapitalize="none" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={needCode} />
        </div>
        <div>
          <label className="label" htmlFor="a-pass">Password</label>
          <PasswordInput id="a-pass" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={needCode} />
        </div>
        {needCode && (
          <div>
            <label className="label" htmlFor="a-code">6-digit code from your authenticator app</label>
            <input id="a-code" className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          </div>
        )}
        {err && <p role="alert" className="text-sm text-owed">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{needCode ? "Verify" : "Sign in"}</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- shell with tabs

type Tab = "shops" | "requests" | "feedback" | "invites" | "settings";

function AdminHome({ admin, onSignOut }: { admin: Admin; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("shops");
  const reqs = useQuery({ queryKey: ["admin-requests"], queryFn: () => api<RequestRow[]>("/admin/requests?status=new"), refetchInterval: 60_000, refetchOnMount: "always" });
  const waiting = reqs.data?.length ?? 0;
  const fb = useQuery({ queryKey: ["admin-feedback"], queryFn: () => api<FeedbackRow[]>("/admin/feedback?status=new"), refetchInterval: 60_000, refetchOnMount: "always" });
  const unread = fb.data?.length ?? 0;
  const tabs: [Tab, string][] = [["shops", "Shops"], ["requests", waiting ? `Requests (${waiting})` : "Requests"], ["feedback", unread ? `Feedback (${unread})` : "Feedback"], ["invites", "Invites"], ["settings", "Settings"]];
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-brand">Hisab admin</h1>
          <p className="text-xs text-muted">{admin.name} · {admin.email}</p>
        </div>
        <button className="btn-secondary !min-h-[40px] !px-4 text-sm" onClick={onSignOut}>Sign out</button>
      </header>
      <nav className="mb-4 flex gap-2 overflow-x-auto" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-line ${tab === k ? "bg-tint text-brand" : "bg-surface text-ink"}`}
            onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "shops" && <ShopsTab />}
      {tab === "requests" && <RequestsTab rows={reqs.data} loading={reqs.isLoading} />}
      {tab === "feedback" && <FeedbackTab rows={fb.data} loading={fb.isLoading} />}
      {tab === "invites" && <InvitesTab />}
      {tab === "settings" && <SettingsTab admin={admin} />}
    </div>
  );
}

// ---------------------------------------------------------------- feedback

interface FeedbackRow {
  id: string;
  kind: "problem" | "question" | "idea";
  message: string;
  contact: string | null;
  created_at: string;
  shop_name: string;
  user_name: string;
  user_login: string | null;
}

function FeedbackTab({ rows, loading }: { rows?: FeedbackRow[]; loading: boolean }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const done = useMutation({
    mutationFn: (id: string) => api(`/admin/feedback/${id}/done`, { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-feedback"] }),
    onError: (e) => setErr(errMsg(e)),
  });
  if (loading) return <Spinner />;
  return (
    <div className="space-y-3">
      {err && <p role="alert" className="text-owed">{err}</p>}
      {(rows ?? []).length === 0 && <p className="muted">No new messages.</p>}
      {(rows ?? []).map((r) => (
        <div key={r.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{r.shop_name}</p>
              <p className="truncate text-xs text-muted">{r.user_name}{r.user_login ? ` · ${r.user_login}` : ""} · {ago(r.created_at)}</p>
            </div>
            <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold capitalize text-brand">{r.kind}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{r.message}</p>
          {r.contact && <p className="text-sm">Reply to: <b>{r.contact}</b></p>}
          <button className="btn-secondary !min-h-[40px] w-full text-sm" onClick={() => done.mutate(r.id)}>Mark as done</button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- shops

function ShopsTab() {
  const q = useQuery({
    queryKey: ["admin-shops"],
    queryFn: () => api<{ summary: Record<string, string | number>; shops: ShopRow[] }>("/admin/shops"),
    refetchOnMount: "always", // new shops can appear any time; always show the latest when the tab opens
  });
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <p role="alert" className="text-owed">{errMsg(q.error)}</p>;
  const { summary, shops } = q.data;
  const shown = shops.filter((s) => `${s.name} ${s.owner_name} ${s.owner_email}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(["trial", "active", "expired", "suspended"] as const).map((k) => (
          <div key={k} className="card !p-3">
            <p className="text-xs capitalize text-muted">{k}</p>
            <p className="text-xl font-semibold">{summary[k]}</p>
          </div>
        ))}
        <div className="card !p-3 col-span-2 sm:col-span-1">
          <p className="text-xs text-muted">Received this month</p>
          <p className="text-xl font-semibold">Rs {Number(summary.received_this_month).toLocaleString("en-IN")}</p>
        </div>
      </div>
      {shops.length > 5 && <input className="field" placeholder="Search shops" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <ul className="space-y-2">
        {shown.map((s) => (
          <li key={s.id}>
            <button className="card w-full text-left" onClick={() => setOpen(s.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.name}</p>
                  <p className="truncate text-xs text-muted">{s.owner_name} · {s.owner_email}</p>
                </div>
                <StatePill shop={s} />
              </div>
              <p className="mt-2 text-xs text-muted">
                {s.customers} customers · {s.bills} bills · last entry {ago(s.last_activity)}
              </p>
            </button>
          </li>
        ))}
        {shown.length === 0 && <p className="muted">No shops yet. Invite someone from the Invites tab.</p>}
      </ul>
      {open && <ShopPanel shopId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- requests

function RequestsTab({ rows, loading }: { rows?: RequestRow[]; loading: boolean }) {
  const qc = useQueryClient();
  // An approved request leaves the server's "new" list at once, so its link is kept here until the tab is left.
  const [made, setMade] = useState<Record<string, { req: RequestRow; inv: MadeInvite }>>({});
  const [err, setErr] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: (r: RequestRow) => api<MadeInvite>(`/admin/requests/${r.id}/approve`, { body: {} }).then((inv) => ({ r, inv })),
    onSuccess: ({ r, inv }) => {
      setMade((m) => ({ ...m, [r.id]: { req: r, inv } }));
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["admin-invites"] });
      void qc.invalidateQueries({ queryKey: ["admin-requests"] }); // the tab count drops; the link stays shown here
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/admin/requests/${id}/reject`, { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-requests"] }),
    onError: (e) => setErr(errMsg(e)),
  });
  if (loading) return <Spinner />;
  const waiting = (rows ?? []).filter((r) => !made[r.id]);
  const done = Object.values(made);
  return (
    <div className="space-y-3">
      {err && <p role="alert" className="text-owed">{err}</p>}
      {waiting.length === 0 && done.length === 0 && <p className="muted">No new requests.</p>}
      {done.map(({ req, inv }) => (
        <div key={req.id} className="card space-y-2">
          <p className="font-semibold">{req.shop_name}</p>
          <p className="text-sm">{req.owner_name} · {req.contact}</p>
          <LinkBox link={inv.link} note={inv.emailed ? "Approved. Invite emailed, the link is here too." : "Approved. Send them this link."} />
        </div>
      ))}
      {waiting.map((r) => (
        <div key={r.id} className="card space-y-2">
          <div>
            <p className="font-semibold">{r.shop_name}</p>
            <p className="text-sm">{r.owner_name} · {r.contact}{r.city ? ` · ${r.city}` : ""}</p>
            {r.message && <p className="muted mt-1">“{r.message}”</p>}
            <p className="mt-1 text-xs text-muted">{ago(r.created_at)}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" disabled={reject.isPending} onClick={() => reject.mutate(r.id)}>Reject</button>
            <button className="btn-primary flex-1" disabled={approve.isPending} onClick={() => approve.mutate(r)}>Approve</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- invites

function InvitesTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin-invites"], queryFn: () => api<InviteRow[]>("/admin/invites"), refetchOnMount: "always" });
  const [f, setF] = useState({ email: "", shop_name: "", owner_name: "", trial_days: "" });
  const [made, setMade] = useState<MadeInvite | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<MadeInvite>("/admin/invites", {
        body: { email: f.email || null, shop_name: f.shop_name || null, owner_name: f.owner_name || null, trial_days: f.trial_days ? Number(f.trial_days) : null },
      }),
    onSuccess: (r) => {
      setMade(r);
      setErr(null);
      setF({ email: "", shop_name: "", owner_name: "", trial_days: "" });
      void qc.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/admin/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-invites"] }),
  });
  return (
    <div className="space-y-4">
      <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <h2 className="font-semibold">Invite someone</h2>
        <input className="field" type="email" placeholder="Email (optional, the invite is sent there)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className="field" placeholder="Shop name" value={f.shop_name} onChange={(e) => setF({ ...f, shop_name: e.target.value })} />
          <input className="field" placeholder="Owner name" value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} />
        </div>
        <input className="field" inputMode="numeric" placeholder="Trial days (empty = default)" value={f.trial_days} onChange={(e) => setF({ ...f, trial_days: e.target.value })} />
        {err && <p role="alert" className="text-sm text-owed">{err}</p>}
        <button className="btn-primary w-full" disabled={create.isPending}>Create invite link</button>
        {made && <LinkBox link={made.link} note={made.emailed ? "Invite emailed. The link is also here." : "Invite created. Send this link."} />}
      </form>
      <div>
        <h2 className="sec-title mb-2">All invites</h2>
        {list.isLoading ? <Spinner /> : (
          <ul className="card-list text-sm">
            {(list.data ?? []).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.shop_name || i.email || "Open invite"}</p>
                  <p className="text-xs text-muted">{i.email ?? "no email"} · {i.trial_days}-day trial · {i.status === "open" ? `expires ${fmtDate(i.expires_at)}` : fmtDate(i.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i.status === "used" ? "bg-tint text-recv" : i.status === "open" ? "bg-warntint text-warn" : "bg-owedtint text-owed"}`}>{i.status}</span>
                  {i.status === "open" && <button className="muted underline" onClick={() => revoke.mutate(i.id)}>Revoke</button>}
                </div>
              </li>
            ))}
            {(list.data ?? []).length === 0 && <li className="muted p-3">No invites yet.</li>}
          </ul>
        )}
        <p className="muted mt-2">A link is shown only once, when it is created. If it is lost, revoke it and make a new one.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings and two-step sign-in

function SettingsTab({ admin }: { admin: Admin }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<Platform>("/admin/settings") });
  const [draft, setDraft] = useState<{ trial: string; invite: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Partial<Platform>) => api<Platform>("/admin/settings", { method: "PUT", body }),
    onSuccess: (r) => {
      qc.setQueryData(["admin-settings"], r);
      setMsg("Saved");
      setErr(null);
    },
    onError: (e) => setErr(errMsg(e)),
  });
  if (!q.data) return <Spinner />;
  const s = q.data;
  const d = draft ?? { trial: String(s.trial_days), invite: String(s.invite_days) };
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Platform settings</h2>
        <div>
          <label className="label">Free trial for new shops (days)</label>
          <input className="field" inputMode="numeric" value={d.trial} onChange={(e) => setDraft({ ...d, trial: e.target.value })} />
        </div>
        <div>
          <label className="label">Invite link valid for (days)</label>
          <input className="field" inputMode="numeric" value={d.invite} onChange={(e) => setDraft({ ...d, invite: e.target.value })} />
        </div>
        <label className="flex items-center gap-3">
          <input type="checkbox" className="h-5 w-5" checked={s.requests_open} onChange={(e) => save.mutate({ requests_open: e.target.checked })} />
          <span>Accept access requests (shows the request form)</span>
        </label>
        {err && <p role="alert" className="text-sm text-owed">{err}</p>}
        {msg && <p role="status" className="text-sm text-recv">{msg}</p>}
        <button className="btn-primary w-full" disabled={save.isPending}
          onClick={() => save.mutate({ trial_days: Number(d.trial), invite_days: Number(d.invite) })}>
          Save
        </button>
        <p className="muted">After a trial or paid period ends a shop becomes read-only: they can look and export, but not add or change entries.</p>
      </div>
      <TwoStep admin={admin} />
    </div>
  );
}

function TwoStep({ admin }: { admin: Admin }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = () => { setSetup(null); setCode(""); setPassword(""); setErr(null); void qc.invalidateQueries({ queryKey: ["admin-me"] }); };
  const go = async (f: () => Promise<unknown>) => { try { await f(); done(); } catch (x) { setErr(errMsg(x)); } };
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Two-step sign-in</h2>
      {admin.two_step ? (
        <>
          <p className="text-sm text-recv">On. Signing in needs a code from your authenticator app.</p>
          <PasswordInput className="field" placeholder="Your password, to turn it off" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn-secondary w-full !text-owed" disabled={!password} onClick={() => void go(() => api("/admin/two-step/off", { body: { password } }))}>Turn off</button>
        </>
      ) : setup ? (
        <>
          <p className="text-sm">Open your authenticator app (Google Authenticator, Authy, Microsoft Authenticator), choose “Enter a setup key”, and type this key:</p>
          <p className="break-all rounded-xl bg-tint p-3 font-mono text-sm tracking-wider">{setup.secret}</p>
          <p className="muted">Account name: {admin.email}. Then enter the 6-digit code it shows.</p>
          <input className="field" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-primary w-full" disabled={code.length !== 6} onClick={() => void go(() => api("/admin/two-step/confirm", { body: { code } }))}>Turn on</button>
        </>
      ) : (
        <>
          <p className="muted">Strongly recommended: this login can reach every shop. Add a code from your phone on top of the password.</p>
          <button className="btn-primary w-full" onClick={async () => { try { setErr(null); setSetup(await api("/admin/two-step/start", { body: {} })); } catch (x) { setErr(errMsg(x)); } }}>Set up</button>
        </>
      )}
      {err && <p role="alert" className="text-sm text-owed">{err}</p>}
    </div>
  );
}
