/**
 * Appearance preferences (theme mode + accent colour).
 *
 * Stored in localStorage so the choice survives refresh without a round trip.
 * The tokens themselves live in src/styles.css: `.light` / `.dark` swap the
 * surface tokens and `[data-accent="..."]` swaps the accent tokens. No component
 * hardcodes a colour.
 */

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const ACCENTS = ["teal", "violet", "blue", "amber", "emerald", "rose"] as const;
export type Accent = (typeof ACCENTS)[number];

export const ACCENT_LABEL: Record<Accent, string> = {
  teal: "Signal teal",
  violet: "Violet",
  blue: "Cobalt",
  amber: "Amber",
  emerald: "Emerald",
  rose: "Rose",
};

const MODE_KEY = "rls:theme-mode";
const ACCENT_KEY = "rls:accent";

export const DEFAULT_MODE: ThemeMode = "dark";
export const DEFAULT_ACCENT: Accent = "teal";

function isMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

function isAccent(value: unknown): value is Accent {
  return typeof value === "string" && (ACCENTS as readonly string[]).includes(value);
}

export function readStoredMode(): ThemeMode {
  if (typeof localStorage === "undefined") return DEFAULT_MODE;
  const raw = localStorage.getItem(MODE_KEY);
  return isMode(raw) ? raw : DEFAULT_MODE;
}

export function readStoredAccent(): Accent {
  if (typeof localStorage === "undefined") return DEFAULT_ACCENT;
  const raw = localStorage.getItem(ACCENT_KEY);
  return isAccent(raw) ? raw : DEFAULT_ACCENT;
}

export function storeMode(mode: ThemeMode): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, mode);
}

export function storeAccent(accent: Accent): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(ACCENT_KEY, accent);
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

/** Applies the resolved theme to <html>. Safe to call repeatedly. */
export function applyAppearance(mode: ThemeMode, accent: Accent): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveMode(mode);
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.dataset["accent"] = accent;
}
