import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFmt } from "../lib/format";
import { parseNum } from "../lib/calc";
import { IconClose } from "./icons";

export function Spinner() {
  const { t } = useTranslation();
  return (
    <div role="status" className="p-8 text-center text-muted">
      {t("loading")}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const msg = error instanceof Error ? error.message : String(error);
  const offline = msg === "Network unreachable";
  return (
    <div role="alert" className="card bg-owedtint text-owed">
      {offline ? t("offlineNoData") : msg}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="sec-title pl-1">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** FR-15: to collect, advance or Nil. */
export function Balance({ value, className = "" }: { value: string | number; className?: string }) {
  const { t } = useTranslation();
  const f = useFmt();
  const n = typeof value === "number" ? value : parseNum(value);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return <span className={`text-muted ${className}`}>{t("nil")}</span>;
  if (n < 0)
    return (
      <span className={`money text-advance ${className}`}>
        {t("advance")} {f.money(n)}
      </span>
    );
  return <span className={`money text-owed ${className}`}>{f.money(n)}</span>;
}

/** A button that needs a second tap to confirm (FR-28). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = "btn-secondary",
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      disabled={disabled}
      className={armed ? "btn-danger" : className}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 4000);
        } else {
          window.clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold">{title}</h2>
          <button className="btn-secondary !px-0" onClick={onClose} aria-label={t("close")}>
            <IconClose size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 3500);
    return () => window.clearTimeout(id);
  }, [onDone]);
  return (
    <div role="status" className="fixed inset-x-4 bottom-24 z-50 rounded-2xl bg-ink px-4 py-3 text-center text-bg shadow-float">
      {message}
    </div>
  );
}
