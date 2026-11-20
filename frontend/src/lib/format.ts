import { useTranslation } from "react-i18next";
import { adToBs, bsMonthDays, bsToAd, BS_MONTHS_EN, BS_MONTHS_NE } from "./bs";
import { getDateSystem, useDateSystem, type DateSystem } from "./datesystem";
import { parseNum } from "./calc";

const DEV = "०१२३४५६७८९";
const AD_MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AD_MONTHS_NE = ["जनवरी", "फेब्रुअरी", "मार्च", "अप्रिल", "मे", "जुन", "जुलाई", "अगस्ट", "सेप्टेम्बर", "अक्टोबर", "नोभेम्बर", "डिसेम्बर"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Formatting helpers that follow the chosen language: Devanagari digits and BS dates in Nepali mode. */
export function makeFmt(lang: string, system: DateSystem = getDateSystem()) {
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
  const ad = system === "ad";
  const months = ad ? (ne ? AD_MONTHS_NE : AD_MONTHS_EN) : ne ? BS_MONTHS_NE : BS_MONTHS_EN;
  /** Year, month and day of an AD date string in the shop's calendar. */
  const ymd = (adStr: string) => {
    if (!ad) return adToBs(adStr.slice(0, 10));
    const [y, m, d] = adStr.slice(0, 10).split("-").map(Number);
    return { y, m, d };
  };
  /** The AD string for a day picked in the shop's calendar. */
  const fromYmd = (y: number, m: number, d: number) => (ad ? `${y}-${pad(m)}-${pad(d)}` : bsToAd(y, m, d));
  const daysIn = (y: number, m: number) => (ad ? new Date(Date.UTC(y, m, 0)).getUTCDate() : bsMonthDays(y, m));
  /** Every displayed date, in the calendar the shop chose (BS by default). */
  const date = (adStr: string | null | undefined) => {
    if (!adStr) return "";
    const b = ymd(adStr);
    return digits(`${b.d} `) + months[b.m - 1] + digits(` ${b.y}`);
  };
  const dateShort = (adStr: string | null | undefined) => {
    if (!adStr) return "";
    const b = ymd(adStr);
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
  return { lang, system, ymd, fromYmd, daysIn, digits, num, money, date, dateShort, monthName, time, dateTime, kg, npDay };
}

export type Fmt = ReturnType<typeof makeFmt>;

/** Subscribes the component to language changes, so every number and date re-renders. */
export function useFmt(): Fmt {
  const { i18n } = useTranslation();
  return makeFmt(i18n.language, useDateSystem());
}
