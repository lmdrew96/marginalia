"use client";

import { useEffect, useState } from "react";

type ThemeName = "moss" | "riga";
type Mode = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>("moss");
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    const root = document.documentElement;
    setTheme((root.getAttribute("data-theme") as ThemeName) || "moss");
    setMode((root.getAttribute("data-mode") as Mode) || "light");
  }, []);

  function applyTheme(next: ThemeName) {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("marginalia-theme", next);
  }

  function applyMode(next: Mode) {
    setMode(next);
    document.documentElement.setAttribute("data-mode", next);
    localStorage.setItem("marginalia-mode", next);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        value={theme}
        onChange={(e) => applyTheme(e.target.value as ThemeName)}
        aria-label="Theme"
        className="rounded-md border border-border bg-transparent px-2 py-1 text-foreground"
      >
        <option value="moss">Moss</option>
        <option value="riga">Riga</option>
      </select>
      <button
        type="button"
        onClick={() => applyMode(mode === "light" ? "dark" : "light")}
        className="rounded-md border border-border px-2 py-1 text-foreground"
      >
        {mode === "light" ? "Dark mode" : "Light mode"}
      </button>
    </div>
  );
}
