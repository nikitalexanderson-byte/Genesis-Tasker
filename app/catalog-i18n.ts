import english from "./catalog-translations/en.json";
import greek from "./catalog-translations/el.json";
import german from "./catalog-translations/de.json";
import french from "./catalog-translations/fr.json";
import spanish from "./catalog-translations/es.json";
import italian from "./catalog-translations/it.json";
import portuguese from "./catalog-translations/pt.json";
import polish from "./catalog-translations/pl.json";
import serbian from "./catalog-translations/sr.json";
import ukrainian from "./catalog-translations/uk.json";
import chinese from "./catalog-translations/zh.json";
import turkish from "./catalog-translations/tr.json";
import japanese from "./catalog-translations/ja.json";
import { translateText, type Language } from "./i18n";
import { formatGreekTerms } from "./greek-terms";

type Catalog = {
  theokyklos: Record<string, string>;
  theokyklosWords: Record<string, string>;
  stoicheion: Record<string, { name: string; tagline: string; content: string }>;
  stoicheionArt: Record<string, { body: string; bodyGreek: string; invocation: string }>;
};

const catalogues: Record<Exclude<Language, "ru">, Catalog> = {
  en: english, el: greek, de: german, fr: french, es: spanish, it: italian,
  pt: portuguese, pl: polish, sr: serbian, uk: ukrainian, zh: chinese,
  tr: turkish, ja: japanese,
};

export type LocalizedPair = { ru: string; en: string };

export function catalogText(copy: LocalizedPair, language: Language): string {
  if (language === "ru") return formatGreekTerms(copy.ru, language);
  if (language === "en") return copy.en;
  return catalogues[language].theokyklos[copy.ru]
    ?? translateText(copy.ru, language) ?? copy.en;
}

export function stoicheionCopy(id: string, language: Language) {
  if (language === "ru") return null;
  return catalogues[language].stoicheion[id] ?? null;
}

export function stoicheionArtCopy(id: string, language: Language) {
  if (language === "ru") return null;
  return catalogues[language].stoicheionArt[id] ?? null;
}

export function sacredWordCopy(greek: string, language: Language, pronunciation?: string): string {
  if (language === "ru") return pronunciation ?? formatGreekTerms(greek, language);
  return catalogues[language].theokyklosWords[greek] ?? greek;
}
