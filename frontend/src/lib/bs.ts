import NepaliDate from "nepali-date-converter";

export const BS_MONTHS_EN = [
  "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
];
export const BS_MONTHS_NE = [
  "बैशाख", "जेठ", "असार", "श्रावण", "भदौ", "असोज",
  "कार्तिक", "मंसिर", "पौष", "माघ", "फाल्गुन", "चैत",
];

export interface BsDate {
  y: number;
  m: number; // 1-12
  d: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** AD date string (YYYY-MM-DD) to BS. Dates are plain calendar dates, no time zone involved. */
export function adToBs(ad: string): BsDate {
  const [Y, M, D] = ad.split("-").map(Number);
  const nd = new NepaliDate(new Date(Y, M - 1, D));
  return { y: nd.getYear(), m: nd.getMonth() + 1, d: nd.getDate() };
}

export function bsToAd(y: number, m: number, d: number): string {
  const js = new NepaliDate(y, m - 1, d).toJsDate();
  return `${js.getFullYear()}-${pad(js.getMonth() + 1)}-${pad(js.getDate())}`;
}

/** Days in a BS month, taken from the converter itself (no hand-written calendar). */
export function bsMonthDays(y: number, m: number): number {
  const utcDay = (ad: string) => {
    const [Y, M, D] = ad.split("-").map(Number);
    return Date.UTC(Y, M - 1, D);
  };
  const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
  return Math.round((utcDay(bsToAd(ny, nm, 1)) - utcDay(bsToAd(y, m, 1))) / 86400000);
}

export function bsIso(b: BsDate): string {
  return `${b.y}-${pad(b.m)}-${pad(b.d)}`;
}
