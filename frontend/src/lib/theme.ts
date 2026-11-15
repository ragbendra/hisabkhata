import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "hisab-theme";
const BAR = { light: "#faf8f4", dark: "#12140f" } as const;
const listeners = new Set<() => void>();

/** Day mode is the default; only an explicit choice of night mode is remembered. */
function read(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function setTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[t]);
  try {
    if (t === "dark") localStorage.setItem(KEY, "dark");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the choice lasts until the page is closed */
  }
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "light" as Theme,
  );
  return [theme, setTheme];
}
