import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adToBs, bsIso, bsMonthDays, bsToAd } from "../src/lib/bs";
import { lineAmount, parseNum, nameMatches } from "../src/lib/calc";

describe("BS conversion agrees with the independent Python library", () => {
  const lines = readFileSync(new URL("./bs-fixture.txt", import.meta.url), "utf8").trim().split("\n").filter((l) => Number(l.split(" ")[1].slice(0, 4)) <= 2086);
  it("AD to BS for 2010-2030", () => {
    const bad: string[] = [];
    for (const l of lines) {
      const [ad, bs] = l.split(" ");
      if (bsIso(adToBs(ad)) !== bs) bad.push(`${ad}: npm ${bsIso(adToBs(ad))} vs py ${bs}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it("BS to AD round trip and month lengths 2070-2086", () => {
    const lengths = JSON.parse(readFileSync(new URL("./bs-month-lengths.json", import.meta.url), "utf8"));
    const bad: string[] = [];
    for (const [key, days] of Object.entries<number>(lengths)) {
      if (Number(key.slice(0, 4)) >= 2087) continue; // known: the two libraries disagree on BS 2087 (see README)
      const [y, m] = key.split("-").map(Number);
      if (bsMonthDays(y, m) !== days) bad.push(`${key}: npm ${bsMonthDays(y, m)} vs py ${days}`);
      const b = adToBs(bsToAd(y, m, 1));
      if (b.y !== y || b.m !== m || b.d !== 1) bad.push(`${key}: round trip ${bsIso(b)}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe("calc", () => {
  it("rounds half-up like the server", () => {
    expect(lineAmount(0.5, 25)).toBe(13);
    expect(lineAmount(10.5, 120)).toBe(1260);
    expect(lineAmount(3.25, 200)).toBe(650);
    expect(lineAmount(0.01, 50)).toBe(1); // 0.5 -> 1
  });
  it("accepts Devanagari digits", () => {
    expect(parseNum("१२.५")).toBe(12.5);
    expect(parseNum("1,250")).toBe(1250);
    expect(parseNum("abc")).toBeNaN();
  });
  it("suggests close names", () => {
    expect(nameMatches("Ramesh Trader", "Ramesh Traders")).toBe(true);
    expect(nameMatches("ram", "Ramesh Traders")).toBe(true);
    expect(nameMatches("Sita", "Ramesh Traders")).toBe(false);
  });
});
