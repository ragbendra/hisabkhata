import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errMsg, fmtDate } from "./shared";
import { EVENT_LABEL } from "./Users";

interface Flag {
  id: string;
  kind: string;
  severity: "info" | "warning" | "high";
  title: string;
  detail: string | null;
  shop: { id: string; name: string | null } | null;
  at: string;
  reviewed: boolean;
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
interface LogRow {
  at: string;
  what: string;
  by: string | null;
  shop: string | null;
  target: string | null;
  detail: string | number | null;
}

const SEV: Record<Flag["severity"], string> = { info: "bg-bg text-muted", warning: "bg-warntint text-warn", high: "bg-owedtint text-owed" };
const SEV_LABEL: Record<Flag["severity"], string> = { info: "Note", warning: "Look at this", high: "Important" };

export default function SecurityTab() {
  const [sub, setSub] = useState<"flags" | "signins" | "log">("flags");
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {([["flags", "Flags"], ["signins", "Sign-ins"], ["log", "Admin log"]] as const).map(([k, l]) => (
          <button key={k} className={`chip ${sub === k ? "chip-on" : ""}`} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>
      {sub === "flags" && <Flags />}
      {sub === "signins" && <SignIns />}
      {sub === "log" && <AdminLog />}
    </div>
  );
}

function Flags() {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ["admin-flags", all], queryFn: () => api<Flag[]>(`/admin/security/flags?status=${all ? "all" : "new"}`), refetchOnMount: "always" });
  const review = useMutation({
    mutationFn: (a: { id: string; reviewed: boolean }) => api(`/admin/security/flags/${a.id}/review?reviewed=${a.reviewed}`, { body: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-flags"] });
      void qc.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
  });
  return (
    <div className="space-y-3">
      <p className="muted">Hints found automatically. Nothing here blocks anyone: look, and decide. Mark a flag reviewed when you are done with it.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show reviewed ones too</label>
      {q.isLoading && <Spinner />}
      {q.error && <p role="alert" className="text-owed">{errMsg(q.error)}</p>}
      {q.data?.length === 0 && <p className="muted">Nothing to review.</p>}
      {q.data?.map((f) => (
        <div key={f.id} className={`card ${f.reviewed ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEV[f.severity]}`}>{SEV_LABEL[f.severity]}</span>
              <div className="mt-1 font-semibold">{f.title}</div>
              {f.detail && <div className="text-sm text-muted">{f.detail}</div>}
              <div className="mt-1 text-xs text-muted">{fmtDate(f.at, true)}</div>
            </div>
            <button className="btn-secondary !min-h-[40px] !px-3 text-sm" onClick={() => review.mutate({ id: f.id, reviewed: !f.reviewed })}>
              {f.reviewed ? "Reopen" : "Reviewed"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SignIns() {
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const rows = useQuery({
    queryKey: ["admin-events", kind, q],
    queryFn: () => api<EventRow[]>(`/admin/security/events?kind=${kind}&q=${encodeURIComponent(q)}`),
    refetchOnMount: "always",
  });
  const kinds: [string, string][] = [["", "All"], ["login_failed", "Failed"], ["device_limit", "3-device refusals"], ["export_full", "Exports"], ["login_ok", "Successful"]];
  return (
    <div className="space-y-3">
      <input className="field" type="search" placeholder="Search a login, shop or address" aria-label="Search sign-ins" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-2 overflow-x-auto">
        {kinds.map(([k, l]) => <button key={k} className={`chip whitespace-nowrap ${kind === k ? "chip-on" : ""}`} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {rows.isLoading && <Spinner />}
      {rows.data?.length === 0 && <p className="muted">Nothing recorded yet. Records are kept for 90 days.</p>}
      <div className="card-list">
        {rows.data?.map((e) => (
          <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <div className={`font-medium ${e.kind === "login_failed" || e.kind === "device_limit" ? "text-owed" : ""}`}>
                {EVENT_LABEL[e.kind] ?? e.kind}{e.detail ? <span className="font-normal text-muted"> · {e.detail}</span> : null}
              </div>
              <div className="truncate text-xs text-muted">{[e.login, e.shop].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="shrink-0 text-right text-xs text-muted">
              <div>{fmtDate(e.at, true)}</div>
              <div>{[e.device, e.ip].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminLog() {
  const q = useQuery({ queryKey: ["admin-log"], queryFn: () => api<LogRow[]>("/admin/log"), refetchOnMount: "always" });
  return (
    <div className="space-y-3">
      <p className="muted">Everything changed from this admin page: shops, trials, payments, users and devices.</p>
      {q.isLoading && <Spinner />}
      {q.data?.length === 0 && <p className="muted">Nothing yet.</p>}
      <div className="card-list">
        {q.data?.map((r, i) => (
          <div key={i} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="font-medium capitalize">{r.what}</div>
              <div className="truncate text-xs text-muted">{[r.shop, r.target, r.detail].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="shrink-0 text-right text-xs text-muted">
              <div>{fmtDate(r.at, true)}</div>
              <div>{r.by}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
