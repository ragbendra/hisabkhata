import { useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * PDF buttons: one bill, a customer's whole ledger, or only the entries picked in the ledger.
 * Self-contained: it only needs the button classes from index.css.
 *
 *   <BillPdfButton saleId={e.id} className="btn-secondary w-full" />
 *   <StatementPdfButtons customerId={s.id} />                         Share + Download for the whole ledger
 *   <SelectedPdfButton customerId={s.id} keys={[...picked]} />        only the picked entries
 *
 * "Share" opens the phone's share sheet with the PDF attached (WhatsApp, Viber, Messenger, Files...).
 * Where the browser cannot share files (most computers) it downloads the file instead.
 */

interface Source {
  path: string;
  /** with a body the request is a POST (picked entries); without, a GET */
  body?: unknown;
}

async function fetchPdf({ path, body }: Source): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch("/api" + path, {
      method: body !== undefined ? "POST" : "GET",
      credentials: "include",
      headers: { "X-Requested-With": "fruit-khata", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Network unreachable");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : "";
    } catch {
      /* not JSON */
    }
    throw new Error(res.status >= 502 && res.status <= 504 ? "Network unreachable" : detail || "Could not make the PDF");
  }
  const m = /filename="?([^"]+)"?/.exec(res.headers.get("content-disposition") ?? "");
  return { blob: await res.blob(), filename: m?.[1] ?? "Hisab.pdf" };
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function PdfButton({
  source,
  label,
  mode = "download",
  className = "btn-secondary",
  disabled = false,
}: {
  source: Source;
  label: string;
  mode?: "download" | "share";
  className?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const { blob, filename } = await fetchPdf(source);
      const file = new File([blob], filename, { type: "application/pdf" });
      if (mode === "share" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
        } catch (x) {
          if (!(x instanceof DOMException && x.name === "AbortError")) throw x; // closing the sheet is not an error
        }
      } else {
        saveFile(blob, filename);
      }
    } catch (x) {
      const m = x instanceof Error ? x.message : String(x);
      setErr(m === "Network unreachable" ? t("needsConnection", { defaultValue: "Needs a connection" }) : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={className} disabled={busy || disabled} onClick={() => void go()}>
        {busy ? t("preparing", { defaultValue: "Preparing…" }) : label}
      </button>
      {err && <p role="alert" className="w-full basis-full text-sm text-owed">{err}</p>}
    </>
  );
}

export const BillPdfButton = ({ saleId, className }: { saleId: string; className?: string }) => {
  const { t } = useTranslation();
  return (
    <>
      <PdfButton source={{ path: `/sales/${saleId}/pdf` }} mode="share" label={t("shareBill", { defaultValue: "Share bill (PDF)" })} className={className} />
    </>
  );
};

/** Share and Download side by side, for a customer's whole ledger. */
export const StatementPdfButtons = ({ customerId, className = "btn-secondary flex-1" }: { customerId: string; className?: string }) => {
  const { t } = useTranslation();
  const source = { path: `/customers/${customerId}/statement.pdf` };
  return (
    <div className="flex w-full flex-wrap gap-2">
      <PdfButton source={source} mode="share" label={t("shareLedger", { defaultValue: "Share ledger" })} className={className} />
      <PdfButton source={source} mode="download" label={t("downloadPdf", { defaultValue: "Download PDF" })} className={className} />
    </div>
  );
};

/** The ledger lines that were ticked: keys look like "sale:<id>", "payment:<id>", "opening:<id>". */
export const SelectedPdfButton = ({
  customerId,
  keys,
  className = "btn-secondary !min-h-[44px] px-4",
}: {
  customerId: string;
  keys: string[];
  className?: string;
}) => {
  const { t } = useTranslation();
  return (
    <PdfButton
      source={{ path: `/customers/${customerId}/statement.pdf`, body: { keys } }}
      mode="share"
      label={t("pdfSelected", { defaultValue: "PDF" })}
      className={className}
      disabled={keys.length === 0}
    />
  );
};
