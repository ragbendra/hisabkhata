import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { adToBs, bsMonthDays, bsToAd } from "../lib/bs";
import { todayNpl } from "../lib/calc";
import { useFmt } from "../lib/format";

/**
 * FR-42: pick a date in BS; the AD date is shown beside it.
 * `value` and `onChange` use AD strings (YYYY-MM-DD), which is what is stored.
 */
export default function BsDatePicker({
  value,
  onChange,
  label,
  yearsBack = 3,
  yearsForward = 1,
}: {
  value: string;
  onChange: (ad: string) => void;
  label?: string;
  yearsBack?: number;
  yearsForward?: number;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const cur = useMemo(() => adToBs(value || todayNpl()), [value]);
  const nowYear = adToBs(todayNpl()).y;
  const years: number[] = [];
  for (let y = Math.min(nowYear - yearsBack, cur.y); y <= Math.max(nowYear + yearsForward, cur.y); y++) years.push(y);
  const days = bsMonthDays(cur.y, cur.m);

  const change = (y: number, m: number, d: number) => {
    const max = bsMonthDays(y, m);
    onChange(bsToAd(y, m, Math.min(d, max)));
  };

  return (
    <div>
      {label && <span className="label">{label}</span>}
      <div className="flex gap-2">
        <select aria-label={t("day")} className="field px-2" value={cur.d} onChange={(e) => change(cur.y, cur.m, +e.target.value)}>
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {f.digits(d)}
            </option>
          ))}
        </select>
        <select aria-label={t("month")} className="field px-2" value={cur.m} onChange={(e) => change(cur.y, +e.target.value, cur.d)}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {f.monthName(m)}
            </option>
          ))}
        </select>
        <select aria-label={t("year")} className="field px-2" value={cur.y} onChange={(e) => change(+e.target.value, cur.m, cur.d)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {f.digits(y)}
            </option>
          ))}
        </select>
      </div>
      <p className="muted mt-1">
        {t("adDate")}: {f.digits(value || todayNpl())}
      </p>
    </div>
  );
}
