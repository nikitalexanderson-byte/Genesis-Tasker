import copy from './weather-legal-copy.json';

export type WeatherLegalSection = readonly [title: string, body: string];

/** The same Russian source is used for static, JavaScript-free public documents. */
export const weatherSolarLegalSection: WeatherLegalSection = [copy.ru.solarTitle, copy.ru.solarBody];
export const weatherAndroidSolarLegalSection: WeatherLegalSection = [copy.ru.androidSolarTitle, copy.ru.androidSolarBody];
export const weatherSourcesLegalSection: WeatherLegalSection = [copy.ru.weatherTitle, copy.ru.weatherBody];

/** Complete authored disclosures, excluded from incremental DOM translation. */
export function localizedWeatherLegalSections(language: string): ReadonlyMap<string, WeatherLegalSection> {
  const value = Object.prototype.hasOwnProperty.call(copy, language) ? copy[language as keyof typeof copy] : copy.en;
  return new Map([
    [weatherSolarLegalSection[0], [value.solarTitle, value.solarBody] as const],
    [weatherAndroidSolarLegalSection[0], [value.androidSolarTitle, value.androidSolarBody] as const],
    [weatherSourcesLegalSection[0], [value.weatherTitle, value.weatherBody] as const],
  ]);
}
