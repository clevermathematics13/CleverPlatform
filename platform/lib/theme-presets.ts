export type ThemeName = "whiskey" | "ocean" | "slate";

export interface ThemePreset {
  id: ThemeName;
  label: string;
  description: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "whiskey",
    label: "Whiskey",
    description: "Warm wood and amber tones",
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Deep blue and cyan contrasts",
  },
  {
    id: "slate",
    label: "Slate",
    description: "Neutral graphite and steel",
  },
];

export const DEFAULT_THEME: ThemeName = "whiskey";

export const isThemeName = (value: string | null): value is ThemeName =>
  value === "whiskey" || value === "ocean" || value === "slate";
