export const REGION_LANGUAGES = ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"] as const;
export type RegionLanguage = (typeof REGION_LANGUAGES)[number];

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
  CN: "zh", SG: "zh", TR: "tr", JP: "ja",
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
};

/** Device zone and region are only coarse location hints; no location permission or network request. */
export function languageForRegion(timeZone: string | undefined, country: string | undefined): RegionLanguage {
  const zone = timeZone?.trim();
  if (zone && ZONE_LANGUAGE[zone]) return ZONE_LANGUAGE[zone];
  const region = country?.trim().toUpperCase();
  return region ? COUNTRY_LANGUAGE[region] ?? "en" : "en";
}
