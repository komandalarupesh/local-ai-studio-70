import {
  ACCENTS,
  ACCENT_LABEL,
  DEFAULT_ACCENT,
  DEFAULT_MODE,
  applyAppearance,
  readStoredAccent,
  readStoredMode,
  resolveMode,
  storeAccent,
  storeMode,
  type Accent,
  type ThemeMode,
} from "@/lib/appearance";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ThemeContextValue = {
  mode: ThemeMode;
  accent: Accent;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [accent, setAccentState] = useState<Accent>(DEFAULT_ACCENT);
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  // Read the stored preference after hydration so SSR markup and the first
  // client render agree (the shell always ships the dark class).
  useEffect(() => {
    const storedMode = readStoredMode();
    const storedAccent = readStoredAccent();
    setModeState(storedMode);
    setAccentState(storedAccent);
    setResolved(resolveMode(storedMode));
    applyAppearance(storedMode, storedAccent);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (mode !== "system") return;
      setResolved(resolveMode("system"));
      applyAppearance("system", accent);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode, accent]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      setResolved(resolveMode(next));
      storeMode(next);
      applyAppearance(next, readStoredAccent());
    },
    [],
  );

  const setAccent = useCallback((next: Accent) => {
    setAccentState(next);
    storeAccent(next);
    applyAppearance(readStoredMode(), next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, accent, resolved, setMode, setAccent }),
    [mode, accent, resolved, setMode, setAccent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>.");
  return ctx;
}

const MODE_ITEMS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "system", label: "Match system", icon: Monitor },
];

export function AppearanceMenu() {
  const { mode, accent, resolved, setMode, setAccent } = useTheme();
  const ModeIcon = resolved === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Appearance settings">
          <ModeIcon className="size-4" />
          <span className="sr-only">Appearance</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {MODE_ITEMS.map((item) => (
          <DropdownMenuItem key={item.mode} onSelect={() => setMode(item.mode)}>
            <item.icon className="size-4" />
            <span className="flex-1">{item.label}</span>
            {mode === item.mode ? <Check className="size-3.5 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          <Palette className="size-3.5" /> Accent
        </DropdownMenuLabel>
        {ACCENTS.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => setAccent(option)}>
            <span
              data-accent={option}
              className="size-3.5 rounded-full bg-primary ring-1 ring-border"
              aria-hidden
            />
            <span className="flex-1">{ACCENT_LABEL[option]}</span>
            {accent === option ? <Check className="size-3.5 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
