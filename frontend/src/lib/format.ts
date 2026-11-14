import { useTranslation } from "react-i18next";
import { adToBs, BS_MONTHS_EN, BS_MONTHS_NE } from "./bs";
import { parseNum } from "./calc";

const DEV = "०१२३४५६७८९";

/** Formatting helpers that follow the chosen language: Devanagari digits and BS dates in Nepali mode. */
export function makeFmt(lang: string) {
  const ne = lang === "ne";
  const digits = (s: string | number) => (ne ? String(s).replace(/\d/g, (d) => DEV[+d]) : String(s));
  const num = (n: number | string, maxFraction = 2) => {
    const v = typeof n === "string" ? parseNum(n) : n;
    if (!Number.isFinite(v)) return "";
    return digits(v.toLocaleString("en-IN", { maximumFractionDigits: maxFraction }));
  };
  const money = (n: number | string) => {
    const v = typeof n === "string" ? parseNum(n) : n;
    if (!Number.isFinite(v)) return "";
    return `${ne ? "रु" : "Rs"} ${num(Math.abs(v))}`;
  };
  const months = ne ? BS_MONTHS_NE : BS_MONTHS_EN;
  /** FR-42: every displayed date is BS. */
  const date = (ad: string | null | undefined) => {
    if (!ad) return "";
    const b = adToBs(ad.slice(0, 10));
    return digits(`${b.d} `) + months[b.m - 1] + digits(` ${b.y}`);
  };
  const dateShort = (ad: string | null | undefined) => {
    if (!ad) return "";
    const b = adToBs(ad.slice(0, 10));
    return digits(`${b.d} `) + months[b.m - 1];
  };
  const monthName = (m: number) => months[m - 1];
  const time = (iso: string) =>
    digits(
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kathmandu", hour: "numeric", minute: "2-digit", hour12: true }).format(
        new Date(iso),
      ),
    );
  /** Nepal calendar day of an instant, as an AD string. */
  const npDay = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(iso),
    );
  const dateTime = (iso: string) => `${date(npDay(iso))}, ${time(iso)}`;
  const kg = (s: string | number) => num(s, 2);
  return { lang, digits, num, money, date, dateShort, monthName, time, dateTime, kg, npDay };
}

export type Fmt = ReturnType<typeof makeFmt>;

/** Subscribes the component to language changes, so every number and date re-renders. */
export function useFmt(): Fmt {
  const { i18n } = useTranslation();
  return makeFmt(i18n.language);
}
