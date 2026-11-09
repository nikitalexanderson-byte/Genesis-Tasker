"use client";

import { IconActionButton } from "./IconActionButton";
import { withThemeColorMode, type GenesisTheme, type ThemeControllerState } from "./theme-controller";
import type { Language } from "./i18n";
import copy from "./theme-mode-copy.json";

export function ThemeModeToggle({ state, language, onChange }: {
  state: ThemeControllerState; language: Language; onChange: (theme: GenesisTheme) => void;
}) {
  const dark = state.theme.endsWith("-dark");
  return <IconActionButton className="icon-button ux-action-button theme-mode-toggle" icon="theme-contrast"
    label={copy[language][dark ? "light" : "dark"]} aria-pressed={dark} aria-busy={state.pending}
    disabled={!state.available || state.pending || ["signed-out", "loading", "load-error"].includes(state.status)}
    onClick={() => onChange(withThemeColorMode(state.theme, !dark))} />;
}
