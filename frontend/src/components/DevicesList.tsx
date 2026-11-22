import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useFmt } from "../lib/format";
import type { Device } from "./DevicePicker";
import { ConfirmButton } from "./ui";

/*
 * "Where you are signed in": up to 3 devices, each with a Sign out button.
 * Put it in Settings:   <DevicesList />
 */
export default function DevicesList() {
  const { t } = useTranslation();
  const f = useFmt();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["devices"], queryFn: () => api<Device[]>("/auth/devices") });

  async function signOut(d: Device) {
    await api(`/auth/devices/${d.id}`, { method: "DELETE" });
    if (d.current) {
      // this very device: same as signing out
      qc.clear();
      window.location.assign("/");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["devices"] });
  }

  return (
    <div className="space-y-2">
      <p className="muted">{t("devicesHelp", { defaultValue: "You can be signed in on 3 devices at a time. A device you do not use for 7 days is signed out." })}</p>
      {q.data?.map((d) => (
        <div key={d.id} className="flex items-center gap-3 rounded-xl p-3 ring-1 ring-line">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">
              {d.label}
            </div>
            <div className="text-xs text-muted">
              {d.current ? <span className="mr-1 font-semibold text-brand">{t("devicesThis", { defaultValue: "This device" })} ·</span> : null}
              {t("devicesLastUsed", { defaultValue: "Last used" })}: {f.dateTime(d.last_seen_at)}
            </div>
          </div>
          <ConfirmButton label={t("devicesSignOut", { defaultValue: "Sign out" })} confirmLabel={t("tapAgainConfirm")} onConfirm={() => void signOut(d)} />
        </div>
      ))}
    </div>
  );
}
