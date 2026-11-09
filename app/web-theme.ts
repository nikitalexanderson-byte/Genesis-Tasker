import { normalizeGenesisTheme, type GenesisTheme } from "./theme-controller";
export { withThemeColorMode } from "./theme-controller";

/** Historical account values retain their color mode in the single web theme. */
export function normalizeWebTheme(value: unknown): GenesisTheme {
  return normalizeGenesisTheme(value).endsWith("-dark") ? "standart-dark" : "standart";
}
