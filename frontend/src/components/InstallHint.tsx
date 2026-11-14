import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./ui";

const KEY = "fk_install_hint_seen";

function shouldShow(): boolean {
  try {
    if (localStorage.getItem(KEY)) return false;
  } catch {
    /* ignore */
  }
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return iOS && !standalone;
}

/** FR-35: on first launch on an iPhone, explain how to add the app to the home screen. */
export default function InstallHint() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(shouldShow);
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };
  return (
    <Modal title={t("installTitle")} onClose={close}>
      <p className="mb-3">{t("installWhy")}</p>
      <ol className="mb-4 list-decimal space-y-2 pl-5">
        <li>{t("installStep1")}</li>
        <li>{t("installStep2")}</li>
        <li>{t("installStep3")}</li>
      </ol>
      <button className="btn-primary w-full" onClick={close}>
        {t("gotIt")}
      </button>
    </Modal>
  );
}
