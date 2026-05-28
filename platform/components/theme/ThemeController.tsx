"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  isThemeName,
  type ThemeName,
} from "@/lib/theme-presets";

const STORAGE_KEY = "cleverplatform-theme";

export function ThemeController() {
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

  // Headless — applies theme from localStorage, no UI rendered here.
  // Theme picker is in the dashboard settings menu.
  return null;
}
