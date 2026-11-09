import { featureAllowed, type FeatureAccess } from "./feature-access.ts";
export const DARK_PALETTES = ["green", "burgundy", "blue", "violet"] as const;
export type DarkPalette = typeof DARK_PALETTES[number];
export function effectiveDarkPalette(value: unknown, access?: FeatureAccess): DarkPalette {
  return featureAllowed(access, "dark-palettes", Date.now(), true) && DARK_PALETTES.includes(value as DarkPalette)
    ? value as DarkPalette : "green";
}
