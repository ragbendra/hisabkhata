import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMe, useOnline } from "../lib/queries";
import { setLang } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import InstallHint from "./InstallHint";
import { IconBook, IconMoon, IconPlus, IconReceipt, IconSliders, IconSun } from "./icons";

export function LangToggle() {
  const { i18n } = useTranslation();
  const ne = i18n.language === "ne";
  const on = "bg-brand text-onaccent";
  return (
    <div className="flex h-10 gap-0.5 rounded-full p-[3px] ring-1 ring-line" role="group" aria-label="Language">
      <button
        className={`min-w-[40px] rounded-full text-[13px] font-semibold ${!ne ? on : "text-muted"}`}
        aria-pressed={!ne}
        onClick={() => setLang("en")}
      >
        EN
      </button>
      <button
        className={`min-w-[40px] rounded-full text-[13px] font-semibold ${ne ? on : "text-muted"}`}
        aria-pressed={ne}
        onClick={() => setLang("ne")}
      >
        ने
      </button>
    </div>
  );
}

/** Day / night. Day is the default; the choice is remembered on this phone. */
export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  const night = theme === "dark";
  return (
    <button
      className="flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-line"
      aria-label={night ? t("themeToDay") : t("themeToNight")}
      onClick={() => setTheme(night ? "light" : "dark")}
    >
      {night ? <IconSun size={20} /> : <IconMoon size={20} />}
    </button>
  );
}

export default function Layout() {
  const { t } = useTranslation();
  const me = useMe().data!;
  const online = useOnline();
  const loc = useLocation();
  const onEntry = loc.pathname === "/entry";

  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-touch min-w-[64px] flex-col items-center justify-center gap-0.5 text-[11px] ${
      isActive ? "font-semibold text-brand" : "font-medium text-muted"
    }`;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-bg px-5 pb-2 pt-[calc(1rem+env(safe-area-inset-top))]">
        <Link to="/" className="min-h-touch flex-1 truncate py-2 font-serif text-xl font-semibold tracking-tight">
          {me.shop.name}
        </Link>
        <LangToggle />
        <ThemeToggle />
        {me.role === "owner" && (
          <Link to="/settings" className="flex h-11 w-11 items-center justify-center rounded-full" aria-label={t("settings")}>
            <IconSliders size={22} />
          </Link>
        )}
      </header>

      {!online && (
        <div role="status" className="mx-5 mt-1 rounded-xl bg-warntint px-3 py-2 text-center text-sm text-warn">
          {t("offlineBanner")}
        </div>
      )}

      <main className="pb-nav flex-1 px-5 pt-2">
        <Outlet />
      </main>

      {/* floating navigation (the entry form has its own sticky save bar instead) */}
      {!onEntry && (
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex h-[68px] items-center justify-around rounded-full bg-surface px-3 shadow-float ring-1 ring-line">
          <NavLink to="/" end className={tab}>
            <IconBook />
            {t("navKhata")}
          </NavLink>
          <Link
            to="/entry"
            className={`flex h-[52px] items-center gap-1.5 rounded-full px-5 font-semibold text-onaccent ring-[1.5px] ring-gold ring-offset-[3px] ring-offset-surface ${
              onEntry ? "bg-brand-dark" : "bg-brand"
            }`}
          >
            <IconPlus size={20} />
            {t("navEntry")}
          </Link>
          <NavLink to="/sales" className={tab}>
            <IconReceipt />
            {t("navSales")}
          </NavLink>
        </div>
      </nav>
      )}

      <InstallHint />
    </div>
  );
}
