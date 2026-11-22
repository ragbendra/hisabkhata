import { useState } from "react";

/*
 * Small SVG charts for the admin dashboard. No library.
 * Single series use the app's accent colour; failed sign-ins use the "owed" red as a line, so the
 * two are told apart by shape as well as colour. Every chart has a hover tooltip and a table view.
 */

const ACCENT = "var(--accent)";
const RED = "var(--owed)";
const GRID = "var(--line)";

export function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const compact = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n));

export function Card({ title, sub, children, table }: { title: string; sub?: string; children: React.ReactNode; table?: { head: string[]; rows: (string | number)[][] } }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <h3 className="font-semibold">{title}</h3>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      <div className="mt-3">{children}</div>
      {table && (
        <div className="mt-2">
          <button type="button" className="text-xs text-muted underline" onClick={() => setOpen(!open)}>{open ? "Hide table" : "Show as table"}</button>
          {open && (
            <div className="mt-2 max-h-56 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted">{table.head.map((h) => <th key={h} className="pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="pr-3">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface ColProps {
  labels: string[]; // x labels, one per value
  values: number[];
  line?: number[]; // optional second series drawn as a line (same scale)
  lineName?: string;
  barName: string;
  height?: number;
  tick?: (i: number) => boolean; // which x labels to print
  fmt?: (n: number) => string;
}

/** Columns (<= 24px, rounded tops) with an optional second series as a line. One axis. */
export function Columns({ labels, values, line, lineName, barName, height = 150, tick, fmt = String }: ColProps) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, padL = 34, padR = 8, padT = 10, padB = 20;
  const H = height;
  const max = niceMax(Math.max(1, ...values, ...(line ?? [0])));
  const n = values.length;
  const slot = (W - padL - padR) / n;
  const bw = Math.min(24, Math.max(3, slot - 3));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const x = (i: number) => padL + slot * i + slot / 2;
  const showTick = tick ?? ((i: number) => i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0);
  const ticks = [0, max / 2, max];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={barName}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{compact(t)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 2 : 0, H - padB - y(v));
          const r = Math.min(4, bw / 2, h);
          const bx = x(i) - bw / 2, top = H - padB - h;
          return (
            <path key={i} fill={ACCENT} opacity={hover === null || hover === i ? 1 : 0.55}
              d={h === 0 ? "" : `M${bx},${H - padB} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + bw - r} Q${bx + bw},${top} ${bx + bw},${top + r} V${H - padB} Z`} />
          );
        })}
        {line && (
          <>
            <polyline fill="none" stroke={RED} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={line.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {line.map((v, i) => (v > 0 ? <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={RED} stroke="var(--surface)" strokeWidth={2} /> : null))}
          </>
        )}
        {labels.map((l, i) => (showTick(i) ? <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--muted)">{l}</text> : null))}
        {/* a wide invisible target per column, bigger than the mark */}
        {values.map((_, i) => (
          <rect key={i} x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-ink px-2 py-1 text-xs text-bg shadow"
          style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="font-semibold">{labels[hover]}</div>
          <div>{barName}: {fmt(values[hover])}</div>
          {line && <div>{lineName}: {line[hover]}</div>}
        </div>
      )}
      {line && (
        <div className="mt-1 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ACCENT }} />{barName}</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-3" style={{ background: RED }} />{lineName}</span>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars with the value at the tip. For a handful of named things (the funnel). */
export function HBars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-sm"><span>{r.label}</span><span className="font-semibold">{r.value}</span></div>
          <div className="mt-1 h-2.5 rounded-full bg-tint">
            <div className="h-2.5 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: ACCENT }} />
          </div>
          {r.note && <div className="text-xs text-muted">{r.note}</div>}
        </div>
      ))}
    </div>
  );
}

export function Tile({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div className={`rounded-card p-3 ring-1 ring-line ${tone === "warn" ? "bg-warntint" : "bg-surface"}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-serif text-2xl font-semibold">{value}</div>
    </div>
  );
}
