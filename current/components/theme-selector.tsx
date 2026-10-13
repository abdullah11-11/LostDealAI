"use client";

import { useSyncExternalStore } from "react";

const themes = ["light", "dark", "system"] as const;
type Theme = (typeof themes)[number];
const THEME_EVENT = "lostdeal-theme-change";

function isTheme(value: string | undefined | null): value is Theme {
  return themes.includes(value as Theme);
}

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const active = document.documentElement.dataset.theme;
  return isTheme(active) ? active : "light";
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem("lostdeal-theme", theme);
  } catch {
    // The visible theme still updates when storage is unavailable.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light");

  if (compact) {
    return (
      <label className="relative">
        <span className="sr-only">Appearance</span>
        <select
          aria-label="Appearance"
          value={theme}
          onChange={(event) => {
            const next = event.target.value;
            if (isTheme(next)) applyTheme(next);
          }}
          className="h-11 rounded-lg border border-line-strong bg-panel px-3 text-sm font-medium text-content outline-none transition-colors hover:bg-panel-hover focus:border-brand focus:ring-2 focus:ring-brand/20"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </label>
    );
  }

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-muted">Appearance</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-panel-raised p-1">
        {themes.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={theme === option}
            onClick={() => applyTheme(option)}
            className={`rounded-md px-2 py-1.5 text-[13px] font-bold capitalize transition-colors ${theme === option ? "bg-panel text-content shadow-sm" : "text-secondary hover:bg-panel-hover hover:text-content"}`}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
