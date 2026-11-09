import type { Language } from "./i18n";
import content from "./stoicheion-restoration-content.json";
import ui from "./stoicheion-restoration-ui.json";
import web from "./stoicheion-restoration-web-ui.json";
import { SACRED_PRACTICES } from "./sacred-practices";
import el from "./stoicheion-restoration-locales/el.json";
import de from "./stoicheion-restoration-locales/de.json";
import fr from "./stoicheion-restoration-locales/fr.json";
import es from "./stoicheion-restoration-locales/es.json";
import it from "./stoicheion-restoration-locales/it.json";
import pt from "./stoicheion-restoration-locales/pt.json";
import pl from "./stoicheion-restoration-locales/pl.json";
import sr from "./stoicheion-restoration-locales/sr.json";
import uk from "./stoicheion-restoration-locales/uk.json";
import zh from "./stoicheion-restoration-locales/zh.json";
import tr from "./stoicheion-restoration-locales/tr.json";
import ja from "./stoicheion-restoration-locales/ja.json";

type Pair = { ru: string; en: string };
const sources = new Map<string, number>();
function collect(value: unknown) {
  if (!value || typeof value !== "object") return;
  if ("ru" in value && "en" in value && typeof value.en === "string") {
    if (!sources.has(value.en)) sources.set(value.en, sources.size);
  } else Object.values(value).forEach(collect);
}
collect(content);
for (const auxiliary of content.auxiliaries) {
  const practice = SACRED_PRACTICES.find(item => item.id === auxiliary.practiceId)!;
  collect(practice.title); collect(practice.description);
}
const locales = { el, de, fr, es, it, pt, pl, sr, uk, zh, tr, ja };

/** Authored translations are bundled; recommendations never call a translation service. */
export function restorationLocal(text: Pair, language: Language): string {
  if (language === "ru" || language === "en") return text[language];
  const index = sources.get(text.en);
  return index === undefined ? text.en : locales[language].values[index];
}

export function restorationCopy(language: Language) {
  return { ...ui[language], ...web[language] };
}
