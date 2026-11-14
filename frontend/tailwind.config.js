/** @type {import('tailwindcss').Config} */
// Ivory and Pine. Every colour is a CSS variable (see src/index.css), so dark mode needs no dark: variants.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        tint: "var(--tint)",
        owed: "var(--owed)",
        owedtint: "var(--owed-tint)",
        recv: "var(--recv)",
        warn: "var(--warn)",
        warntint: "var(--warn-tint)",
        advance: "var(--advance)",
        gold: "var(--gold)",
        onaccent: "var(--accent-ink)",
        brand: { DEFAULT: "var(--accent)", dark: "var(--accent-press)", light: "var(--tint)" },
        age: { 1: "var(--b1)", 2: "var(--b2)", 3: "var(--b3)", 4: "var(--b4)" },
      },
      fontFamily: {
        sans: ["Inter Variable", "Noto Sans Devanagari", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        serif: ["Source Serif 4 Variable", "Noto Serif Devanagari", "Georgia", "serif"],
      },
      borderRadius: { card: "18px" },
      boxShadow: {
        float: "var(--shadow)",
        bar: "var(--shadow-up)",
      },
      minHeight: { touch: "44px" },
      minWidth: { touch: "44px" },
    },
  },
  plugins: [],
};
