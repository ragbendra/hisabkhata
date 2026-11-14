// Number and date helpers that do not depend on the language.

const DEVANAGARI = "०१२३४५६७८९";

/** Devanagari digits to Western digits (FR-41: inputs accept both). */
export function normDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI.indexOf(d)));
}

/** Parses "१२.५", "12.5" or "1,250"; returns NaN for empty or invalid text. */
export function parseNum(s: string | undefined | null): number {
  if (s === undefined || s === null) return NaN;
  const t = normDigits(s).replace(/,/g, "").trim();
  if (t === "" || !/^-?\d*\.?\d*$/.test(t) || t === "." || t === "-") return NaN;
  return Number(t);
}

/** Decimal places of the typed text (to reject 3 decimals in kg). */
export function decimals(s: string): number {
  const t = normDigits(s).trim();
  const i = t.indexOf(".");
  return i < 0 ? 0 : t.length - i - 1;
}

/** kg x rate, rounded half-up to whole rupees (requirements section 5). Integer maths, no float drift. */
export function lineAmount(kg: number, rate: number): number {
  const k = Math.round(kg * 100);
  const r = Math.round(rate * 100);
  return Math.floor((k * r + 5000) / 10000);
}

export function toDec(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

// ---- dates (plain calendar days in Nepal time)

export function todayNpl(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(ad: string, n: number): string {
  const [Y, M, D] = ad.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D + n));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromAd: string, toAd: string): number {
  const f = (s: string) => {
    const [Y, M, D] = s.split("-").map(Number);
    return Date.UTC(Y, M - 1, D);
  };
  return Math.round((f(toAd) - f(fromAd)) / 86400000);
}

export function npDateOf(iso: string): string {
  return todayNpl(new Date(iso));
}

// ---- name matching (FR-5): contains, or closely resembles

export function norm(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

function similar(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

export function nameMatches(query: string, name: string, other?: string | null): boolean {
  const q = norm(query);
  if (!q) return false;
  for (const n of [norm(name), norm(other)]) {
    if (!n) continue;
    if (n.includes(q) || q.includes(n)) return true;
    if (similar(q, n) >= 0.8) return true;
    if (q.length >= 3 && similar(q, n.slice(0, q.length)) >= 0.85) return true;
  }
  return false;
}
