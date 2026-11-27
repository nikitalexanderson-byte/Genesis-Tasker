export const REGION_LANGUAGES = ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja", "he", "ar", "ko", "nl"] as const;
export type RegionLanguage = (typeof REGION_LANGUAGES)[number];

export const LANGUAGE_CHOICES = {
  ru: { name: "Русский", country: "ru", flag: "🇷🇺" },
  en: { name: "English", country: "gb", flag: "🇬🇧" },
  el: { name: "Ελληνικά", country: "gr", flag: "🇬🇷" },
  de: { name: "Deutsch", country: "de", flag: "🇩🇪" },
  fr: { name: "Français", country: "fr", flag: "🇫🇷" },
  es: { name: "Español", country: "es", flag: "🇪🇸" },
  it: { name: "Italiano", country: "it", flag: "🇮🇹" },
  pt: { name: "Português", country: "pt", flag: "🇵🇹" },
  pl: { name: "Polski", country: "pl", flag: "🇵🇱" },
  sr: { name: "Српски", country: "rs", flag: "🇷🇸" },
  uk: { name: "Українська", country: "ua", flag: "🇺🇦" },
  zh: { name: "简体中文", country: "cn", flag: "🇨🇳" },
  tr: { name: "Türkçe", country: "tr", flag: "🇹🇷" },
  ja: { name: "日本語", country: "jp", flag: "🇯🇵" },
  he: { name: "עברית", country: "il", flag: "🇮🇱" },
  ar: { name: "العربية", country: "sa", flag: "🇸🇦" },
  ko: { name: "한국어", country: "kr", flag: "🇰🇷" },
  nl: { name: "Nederlands", country: "nl", flag: "🇳🇱" },
} satisfies Record<RegionLanguage, { name: string; country: string; flag: string }>;

export function languageDirection(language: string): "rtl" | "ltr" {
  return language === "he" || language === "ar" ? "rtl" : "ltr";
}

export function languageManifest(language: RegionLanguage): string {
  if (language === "ru") return "manifest.webmanifest";
  if (language === "ar" || language === "he" || language === "ko" || language === "nl") {
    return `manifest.${language}.webmanifest`;
  }
  return "manifest.en.webmanifest";
}

export function regionFromLocales(locales: readonly string[]): string | undefined {
  for (const locale of locales) {
    try {
      const region = new Intl.Locale(locale).region;
      if (region) return region;
    } catch { /* Ignore malformed device locale tags. */ }
  }
  return undefined;
}

const COUNTRY_LANGUAGE: Record<string, RegionLanguage> = {
  RU: "ru", BY: "ru", KZ: "ru", UA: "uk", PL: "pl", RS: "sr", ME: "sr",
  GR: "el", CY: "el", DE: "de", AT: "de", FR: "fr", BE: "fr",
  ES: "es", MX: "es", AR: "es", CL: "es", CO: "es", PE: "es",
  IT: "it", PT: "pt", BR: "pt",
  CN: "zh", SG: "zh", TR: "tr", JP: "ja", IL: "he", KR: "ko", NL: "nl",
  SA: "ar", AE: "ar", EG: "ar", JO: "ar", LB: "ar", IQ: "ar", KW: "ar", QA: "ar",
  BH: "ar", OM: "ar", MA: "ar", DZ: "ar", TN: "ar", PS: "ar", YE: "ar", LY: "ar",
};

const ZONE_LANGUAGE: Record<string, RegionLanguage> = {
  "Europe/Moscow": "ru", "Europe/Kaliningrad": "ru", "Europe/Kyiv": "uk", "Europe/Kiev": "uk",
  "Europe/Warsaw": "pl", "Europe/Belgrade": "sr", "Europe/Podgorica": "sr",
  "Europe/Athens": "el", "Europe/Nicosia": "el", "Europe/Berlin": "de", "Europe/Vienna": "de",
  "Europe/Paris": "fr", "Europe/Brussels": "fr", "Europe/Madrid": "es", "Europe/Rome": "it",
  "Europe/Lisbon": "pt", "Atlantic/Azores": "pt", "America/Sao_Paulo": "pt",
  "Europe/London": "en", "Europe/Dublin": "en",
  "America/Los_Angeles": "en", "America/Denver": "en", "America/Phoenix": "en",
  "America/Chicago": "en", "America/New_York": "en", "America/Anchorage": "en",
  "America/Toronto": "en", "America/Vancouver": "en",
  "Australia/Sydney": "en", "Australia/Melbourne": "en", "Australia/Perth": "en",
  "America/Mexico_City": "es", "America/Argentina/Buenos_Aires": "es",
  "Asia/Shanghai": "zh", "Asia/Chongqing": "zh", "Asia/Singapore": "zh",
  "Europe/Istanbul": "tr", "Asia/Istanbul": "tr", "Asia/Tokyo": "ja",
  "Asia/Jerusalem": "he", "Asia/Riyadh": "ar", "Asia/Seoul": "ko", "Europe/Amsterdam": "nl",
};

/** Device zone and region are only coarse location hints; no location permission or network request. */
export function languageForRegion(timeZone: string | undefined, country: string | undefined): RegionLanguage {
  const zone = timeZone?.trim();
  if (zone && ZONE_LANGUAGE[zone]) return ZONE_LANGUAGE[zone];
  const region = country?.trim().toUpperCase();
  return region ? COUNTRY_LANGUAGE[region] ?? "en" : "en";
}
