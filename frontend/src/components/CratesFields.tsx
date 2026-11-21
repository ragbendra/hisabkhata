import { useTranslation } from "react-i18next";
import { normDigits } from "../lib/calc";

/*
 * Crate counts typed by hand. Used where the shop records crates:
 *   <CratesField label={...} value={draft.cratesBack} onChange={(v) => update({ cratesBack: v })} showError={showErrors} />
 */

/** "12" or "१२" -> 12. Blank -> 0. Anything else -> null (not a valid count). */
export function parseCrates(v: string | undefined): number | null {
  const s = normDigits((v ?? "").trim());
  if (!s) return 0;
  return /^\d{1,6}$/.test(s) ? Number(s) : null;
}

export function CratesField({
  label,
  value,
  onChange,
  showError = false,
  id,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  showError?: boolean;
  id?: string;
}) {
  const { t } = useTranslation();
  const bad = parseCrates(value) === null;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="field" inputMode="numeric" placeholder="0" value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-invalid={bad} />
      {bad && showError && <p className="mt-1 text-sm text-owed">{t("badNumber")}</p>}
    </div>
  );
}
