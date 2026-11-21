import { useTranslation } from "react-i18next";
import { useTrackCrates } from "../lib/crates";
import { useFmt } from "../lib/format";

/*
 * How many crates a customer still holds.
 *   <CratesBadge crates={s.crates} />            on the customer page (bigger, with words)
 *   <CratesBadge crates={c.crates} compact />    in the Khata list (small chip)
 * Shows nothing when the shop does not track crates, or the customer holds none.
 */
export default function CratesBadge({ crates, compact = false, className = "" }: { crates?: number; compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  const f = useFmt();
  const track = useTrackCrates();
  if (!track || !crates) return null;
  if (compact)
    return (
      <span className={`inline-flex items-center rounded-full bg-warntint px-2 py-0.5 text-xs font-semibold text-warn ${className}`}>
        {f.digits(crates)} {t("crates")}
      </span>
    );
  return (
    <div className={`rounded-xl bg-warntint px-3 py-2 text-warn ${className}`}>
      <span className="text-sm font-semibold">
        {crates > 0
          ? t("cratesWithHim", { defaultValue: "Crates with him: {{n}}", n: f.digits(crates) })
          : t("cratesExtra", { defaultValue: "He returned {{n}} extra crates", n: f.digits(-crates) })}
      </span>
    </div>
  );
}

/** For the top of the Khata: all crates out in the market.   <CratesOutSummary crates={k.crates_out} holders={k.crates_holders} /> */
export function CratesOutSummary({ crates, holders }: { crates?: number; holders?: number }) {
  const { t } = useTranslation();
  const f = useFmt();
  const track = useTrackCrates();
  if (!track || !crates) return null;
  return (
    <div className="mt-1 text-sm text-warn">
      {t("cratesOutTotal", { defaultValue: "Crates out: {{n}} with {{c}} customers", n: f.digits(crates), c: f.digits(holders ?? 0) })}
    </div>
  );
}
