import type { DeviceLocation } from "./solar-times";
import { privateDeviceAccessBlocked } from "./local-sign-out.ts";

export const SOLAR_PLACE_KEY = "genesis-solar-place-v1";
export const SOLAR_PLACE_CHANGED = "genesis-solar-place-changed";
const SOLAR_DISPLAY_KEY = "genesis-solar-times-visible-v1";

export function readSolarTimesVisible(): boolean {
  return typeof window === "undefined" || localStorage.getItem(SOLAR_DISPLAY_KEY) !== "false";
}

export function saveSolarTimesVisible(visible: boolean) {
  localStorage.setItem(SOLAR_DISPLAY_KEY, String(visible));
  window.dispatchEvent(new Event(SOLAR_PLACE_CHANGED));
}

export type SolarPlace = DeviceLocation & {
  id?: number;
  name: string;
  country: string;
  region: string;
  timeZone: string;
};

export function solarPlaceLabel(place: SolarPlace) {
  return Array.from(new Set([place.name, place.region, place.country].filter(Boolean))).join(", ");
}

export function readSolarPlace(): SolarPlace | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(SOLAR_PLACE_KEY);
    if (!value) return null;
    const place = JSON.parse(value) as SolarPlace;
    if (!place.name || !place.country || !place.timeZone ||
      !Number.isFinite(place.latitude) || place.latitude < -90 || place.latitude > 90 ||
      !Number.isFinite(place.longitude) || place.longitude < -180 || place.longitude > 180) return null;
    new Intl.DateTimeFormat("en", { timeZone: place.timeZone });
    return place;
  } catch { return null; }
}

export function saveSolarPlace(place: SolarPlace | null) {
  if (privateDeviceAccessBlocked()) return;
  if (place) window.localStorage.setItem(SOLAR_PLACE_KEY, JSON.stringify(place));
  else window.localStorage.removeItem(SOLAR_PLACE_KEY);
  window.dispatchEvent(new Event(SOLAR_PLACE_CHANGED));
}

type GeocodingResult = Partial<SolarPlace> & { timezone?: string; admin1?: string };

function parseSolarPlace(result: GeocodingResult): SolarPlace | null {
  const latitude = Number(result.latitude);
  const longitude = Number(result.longitude);
  const timeZone = result.timezone;
  if (!result.name || !result.country || !timeZone || !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) || latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180) return null;
  return { id: Number.isInteger(result.id) ? result.id : undefined,
    name: result.name, country: result.country, region: result.admin1 ?? "",
    latitude, longitude, timeZone };
}

async function searchSolarPlacesInLanguage(name: string, language: string, signal?: AbortSignal): Promise<SolarPlace[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "8");
  url.searchParams.set("format", "json");
  url.searchParams.set("language", language.toLowerCase());
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Location lookup failed: ${response.status}`);
  const data = await response.json() as { results?: GeocodingResult[] };
  return (data.results ?? []).flatMap((result) => parseSolarPlace(result) ?? []);
}

export async function searchSolarPlaces(query: string, language = "ru", signal?: AbortSignal): Promise<SolarPlace[]> {
  const name = query.trim().slice(0, 120);
  if (name.length < 2) return [];
  const locale = language.toLowerCase();
  const localized = await searchSolarPlacesInLanguage(name, locale, signal);
  if (localized.length) return localized;

  // Some indexed aliases only match in their own language. Keep the suggestions
  // in the interface language even when the query was entered in another one.
  const inputLanguage = /[а-яё]/i.test(name) ? "ru" : /[a-z]/i.test(name) ? "en" : "";
  if (!inputLanguage || inputLanguage === locale) return [];
  const fallback = await searchSolarPlacesInLanguage(name, inputLanguage, signal);
  return Promise.all(fallback.map(async (place) => {
    try { return await localizedSolarPlace(place, locale, signal); }
    catch (error) { if (signal?.aborted) throw error; return place; }
  }));
}

export async function localizedSolarPlace(place: SolarPlace, language: string, signal?: AbortSignal): Promise<SolarPlace> {
  if (!place.id) return place;
  const url = new URL("https://geocoding-api.open-meteo.com/v1/get");
  url.searchParams.set("id", String(place.id));
  url.searchParams.set("language", language.toLowerCase());
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Location lookup failed: ${response.status}`);
  return parseSolarPlace(await response.json() as GeocodingResult) ?? place;
}
