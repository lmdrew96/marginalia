"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/icons";

type ThemeName = "moss" | "riga";
type Mode = "light" | "dark";

const THEMES: { name: ThemeName; label: string; swatch: string }[] = [
  { name: "moss", label: "Moss", swatch: "var(--swatch-moss)" },
  { name: "riga", label: "Riga", swatch: "var(--swatch-riga)" },
];

// The theme lives on <html> (set before paint by the init script in
// layout.tsx), so read it from there instead of copying it into state.
const subscribe = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-mode"],
  });
  return () => observer.disconnect();
};
const readTheme = (): string =>
  `${document.documentElement.getAttribute("data-theme") ?? "moss"}:${
    document.documentElement.getAttribute("data-mode") ?? "dark"
  }`;

const save = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Private windows can refuse storage; the choice still applies now.
    console.warn("Couldn't save theme preference:", err);
  }
};

/** Theme swatches and the light/dark switch, as one pill. */
export const ThemeToggle = (): React.JSX.Element => {
  const [theme, mode] = useSyncExternalStore(
    subscribe,
    readTheme,
    () => "moss:dark",
  ).split(":") as [ThemeName, Mode];

  const applyTheme = (next: ThemeName): void => {
    document.documentElement.setAttribute("data-theme", next);
    save("marginalia-theme", next);
  };
  const toggleMode = (): void => {
    const next = mode === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-mode", next);
    save("marginalia-mode", next);
  };

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="flex items-center gap-0.5 rounded-full border border-border bg-surface/60 p-0.5 text-sm"
    >
      {THEMES.map((t) => (
        <button
          key={t.name}
          type="button"
          onClick={() => applyTheme(t.name)}
          aria-pressed={theme === t.name}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
            theme === t.name
              ? "bg-background text-foreground shadow-sm"
              : "text-secondary hover:text-foreground"
          }`}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: t.swatch }}
            aria-hidden
          />
          {t.label}
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      <button
        type="button"
        onClick={toggleMode}
        aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={mode === "dark" ? "Light mode" : "Dark mode"}
        className="rounded-full p-1.5 text-secondary transition-colors hover:text-foreground"
      >
        {mode === "dark" ? (
          <SunIcon className="h-4 w-4" />
        ) : (
          <MoonIcon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
};
