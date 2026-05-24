"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  isThemeName,
  THEME_PRESETS,
  type ThemeName,
} from "@/lib/theme-presets";

const STORAGE_KEY = "cleverplatform-theme";

export function ThemeController() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeName(stored)) {
      setTheme(stored);
      return;
    }
    document.documentElement.setAttribute("data-theme", DEFAULT_THEME);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <div className="fixed bottom-4 right-4 z-[90]">
      <div className="rounded-xl border border-da-border bg-da-surface/95 p-2 shadow-lg shadow-black/40 backdrop-blur-sm">
        <button
          type="button"
          className="da-btn da-btn-ghost w-full justify-between"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="theme-controller-menu"
        >
          <span>Theme</span>
          <span className="text-xs opacity-80">{open ? "▲" : "▼"}</span>
        </button>

        {open && (
          <div id="theme-controller-menu" className="mt-2 space-y-1">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setTheme(preset.id);
                  setOpen(false);
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  theme === preset.id
                    ? "border-da-accent bg-da-hover text-da-text"
                    : "border-da-border bg-da-bg text-da-muted hover:bg-da-hover hover:text-da-text"
                }`}
              >
                <p className="text-sm font-semibold">{preset.label}</p>
                <p className="text-xs opacity-80">{preset.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
