import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "../locales/en";
import { ne } from "../locales/ne";

export type Lang = "en" | "ne";
const KEY = "fk_lang";

function initial(): Lang {
  try {
    return localStorage.getItem(KEY) === "ne" ? "ne" : "en";
  } catch {
    return "en";
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ne: { translation: ne } },
  lng: initial(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18n.language;

/** FR-40: the choice is remembered per device. */
export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode */
  }
  document.documentElement.lang = lang;
  void i18n.changeLanguage(lang);
}

export default i18n;
