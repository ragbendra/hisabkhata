import { useTranslation } from "react-i18next";
import { useMe } from "../lib/queries";

/*
 * A thin notice for shops on a trial or past the end date. Add it once at the top of the page content
 * (for example in Layout, above <Outlet />):   <SubscriptionBanner />
 * It shows nothing for paid shops, and does not need any change to lib/types.ts.
 */
interface Sub {
  state: "active" | "trial" | "expired" | "suspended";
  read_only: boolean;
  days_left: number | null;
}

export default function SubscriptionBanner() {
  const { t } = useTranslation();
  const me = useMe();
  const sub = (me.data as unknown as { subscription?: Sub } | undefined)?.subscription;
  if (!sub) return null;
  if (sub.state === "expired") {
    return (
      <p role="alert" className="mx-auto mb-3 max-w-xl rounded-xl bg-owedtint px-4 py-2 text-sm text-owed">
        {t("subExpired", { defaultValue: "Your trial or subscription has ended. You can still view and export your khata, but not add or change entries. Please contact Hisab to continue." })}
      </p>
    );
  }
  if (sub.state === "trial" && sub.days_left != null && sub.days_left <= 5) {
    return (
      <p role="status" className="mx-auto mb-3 max-w-xl rounded-xl bg-warntint px-4 py-2 text-sm text-warn">
        {t("subTrialEnding", { defaultValue: "Your free trial ends in {{n}} days.", n: Math.max(sub.days_left, 0) })}
      </p>
    );
  }
  return null;
}
