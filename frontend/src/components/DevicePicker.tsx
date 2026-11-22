import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useFmt } from "../lib/format";

export interface Device {
  id: string;
  label: string;
  last_seen_at: string;
  signed_in_at: string;
  current: boolean;
}

/*
 * Shown on the sign-in page when the login is already on 3 devices.
 * It lists them and signs the chosen one out so this device can sign in. Nothing else to understand.
 *   <DevicePicker login={login} password={password} onDone={...} onCancel={...} />
 */
export default function DevicePicker({
  login,
  password,
  onDone,
  onCancel,
}: {
  login: string;
  password: string;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const f = useFmt();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Device[]>("/auth/login/devices", { body: { login, password } })
      .then(setDevices)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [login, password]);

  async function pick(id: string) {
    setBusy(true);
    setErr(null);
    try {
      await api("/auth/login", { body: { login, password, replace_session_id: id } });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t("devicesFullTitle", { defaultValue: "You are signed in on 3 devices" })}</h2>
      <p className="text-sm text-muted">{t("devicesFullHelp", { defaultValue: "Sign one of them out to continue on this device." })}</p>
      {!devices && !err && <p className="muted">{t("loading")}</p>}
      <div className="space-y-2">
        {devices?.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-xl p-3 ring-1 ring-line">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{d.label}</div>
              <div className="text-xs text-muted">{t("devicesLastUsed", { defaultValue: "Last used" })}: {f.dateTime(d.last_seen_at)}</div>
            </div>
            <button type="button" className="btn-secondary !min-h-[44px] px-4 text-sm" disabled={busy} onClick={() => void pick(d.id)}>
              {t("devicesSignOut", { defaultValue: "Sign out" })}
            </button>
          </div>
        ))}
      </div>
      {err && <p role="alert" className="text-sm text-owed">{err}</p>}
      <button type="button" className="min-h-touch w-full text-sm text-muted underline" onClick={onCancel}>
        {t("cancel")}
      </button>
    </div>
  );
}
