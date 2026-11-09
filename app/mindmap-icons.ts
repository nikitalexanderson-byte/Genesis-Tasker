import catalog from "./mindmap-icon-catalog.json";
import names from "./mindmap-icon-names.json";
import vectors from "./mindmap-icon-vectors.json";

export const MINDMAP_ICONS = catalog;
export const MINDMAP_ICON_IDS = new Set(catalog.map(icon => icon.id));
export const MINDMAP_ICON_GROUPS = ["ideas", "work", "people", "study", "health", "time", "resources", "creative", "world", "symbols"] as const;
export function mindmapIconLabel(id: string, language = "ru") {
  const icon = catalog.find(icon => icon.id === id);
  if (!icon) return "";
  const translated = (names as Record<string, string[]>)[language] ?? names.en;
  return translated[icon.index] ?? names.en[icon.index];
}
export function mindmapIconPath(id: string) { return `/mindmap-icons/${id}.png`; }
export function mindmapIconVector(id: string) { return (vectors as Record<string,string>)[id] ?? ""; }
