import { useState } from "react";
import { ApiError } from "../../lib/api";

/* Small helpers shared by the admin screens. The admin pages are English only: they are for the person who runs Hisab. */

export interface ShopRow {
  id: string;
  name: string;
  owner_name: string | null;
  owner_email: string | null;
  status: "active" | "trial" | "suspended";
  state: "active" | "trial" | "expired" | "suspended";
  access_until: string | null;
  access_until_date: string | null;
  days_left: number | null;
  created_at: string | null;
  last_activity: string | null;
  customers: number;
  bills: number;
  users: number;
  admin_notes: string | null;
}

export interface ShopDetail extends ShopRow {
  total_to_collect: string;
  users_list: { id: string; name: string; login: string; role: string; disabled: boolean }[];
  payments: { id: string; amount: string; mode: string; paid_on: string; extended_to: string | null; note: string | null }[];
}

export const errMsg = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error && e.message === "Network unreachable" ? "No connection" : String(e);

export function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

const PILL: Record<ShopRow["state"], string> = {
  active: "bg-tint text-recv",
  trial: "bg-warntint text-warn",
  expired: "bg-owedtint text-owed",
  suspended: "bg-owedtint text-owed",
};

export function StatePill({ shop }: { shop: Pick<ShopRow, "state" | "days_left"> }) {
  const label =
    shop.state === "trial" ? `Trial${shop.days_left != null ? ` · ${Math.max(shop.days_left, 0)}d left` : ""}`
    : shop.state === "active" ? (shop.days_left != null ? `Paid · ${shop.days_left}d left` : "Active")
    : shop.state === "expired" ? `Expired${shop.days_left != null ? ` ${Math.abs(shop.days_left)}d ago` : ""}`
    : "Suspended";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[shop.state]}`}>{label}</span>;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A link that was just made: shown once, with copy and WhatsApp buttons. */
export function LinkBox({ link, note, contact }: { link: string; note?: string; contact?: string }) {
  const [copied, setCopied] = useState(false);
  const wa = `https://wa.me/?text=${encodeURIComponent(`Your Hisab invitation: ${link}`)}`;
  return (
    <div className="rounded-xl bg-tint p-3 text-sm">
      {note && <p className="mb-2 font-semibold text-recv">{note}</p>}
      {contact && <p className="mb-2 text-muted">Contact: {contact}</p>}
      <input className="field !min-h-[40px] text-xs" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      <div className="mt-2 flex gap-2">
        <button
          className="btn-secondary !min-h-[40px] flex-1 !px-3 text-sm"
          onClick={async () => setCopied(await copyText(link))}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <a className="btn-secondary !min-h-[40px] flex-1 !px-3 text-sm" href={wa} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
      </div>
    </div>
  );
}
