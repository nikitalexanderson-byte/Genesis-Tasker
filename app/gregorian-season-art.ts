type SeasonLocation = { latitude: number; timeZone?: string };
type Season = "winter" | "spring" | "summer" | "autumn";

/** Offline climate hints remain consistent with the native season families. */
function climate(location: SeasonLocation) {
  const zone = location.timeZone ?? "";
  const latitude = Math.abs(location.latitude);
  const southern = location.latitude < -5 || /^(Australia|Antarctica)\//.test(zone)
    || /^America\/Argentina\//.test(zone)
    || /Auckland|Chatham|Buenos_Aires|Montevideo|Santiago|Sao_Paulo|Johannesburg|Windhoek|Harare|Maputo/.test(zone);
  let region = "";
  if (/Phoenix|Hermosillo|Chihuahua|Cairo|Tripoli|Algiers|Tunis|Khartoum|Riyadh|Dubai|Abu_Dhabi|Kuwait|Baghdad|Tehran|Ashgabat|Alice_Springs|Lima/.test(zone)) region = "arid";
  else if (/Rome|Madrid|Lisbon|Athens|Malta|Nicosia|Istanbul|Los_Angeles|Perth|Tel_Aviv|Beirut|Casablanca/.test(zone)) region = "mediterranean";
  else if (/Darwin|Sao_Paulo|Singapore|Bangkok|Jakarta|Manila|Kolkata/.test(zone)) region = "tropical";
  else if ((latitude >= 58 || /Helsinki|Stockholm|Oslo|Reykjavik|Anchorage/.test(zone)) && !southern) region = "boreal";
  else if (southern && (latitude >= 23 || /Johannesburg|Windhoek|Harare|Maputo|Auckland|Chatham/.test(zone))) region = "southern";
  else if (latitude < 23.5 || /^(Pacific|Indian)\//.test(zone)) region = "tropical";
  return { region: region || "temperate", southern };
}

/** Retained native season assets and their original selection contract. */
export function gregorianSeasonArt(monthIndex: number, location: SeasonLocation): string {
  const { region, southern } = climate(location);
  const seasonMonth = ((monthIndex + (southern ? 6 : 0)) % 12 + 12) % 12;
  const season: Season = seasonMonth < 2 || seasonMonth === 11 ? "winter"
    : seasonMonth < 5 ? "spring" : seasonMonth < 8 ? "summer" : "autumn";
  return `gregorian-seasons/${region === "temperate" ? "" : `${region}/`}${season}.jpg`;
}

/** A distinct web illustration for every Gregorian month and climate family. */
export function gregorianMonthArt(monthIndex: number, location: SeasonLocation): string {
  if (!Number.isInteger(monthIndex)) throw new TypeError("Invalid Gregorian month");
  const { region, southern } = climate(location);
  // Southern temperate art is authored in actual January–December order.
  const month = ((monthIndex + (southern && region !== "southern" ? 6 : 0)) % 12 + 12) % 12;
  return `gregorian-months-v1/${region}/${String(month + 1).padStart(2, "0")}.webp`;
}

/** Panoramic web headers keep the same regional and hemispheric month selection. */
export function gregorianMonthPanoramaArt(monthIndex: number, location: SeasonLocation): string {
  return gregorianMonthArt(monthIndex, location).replace("gregorian-months-v1/", "gregorian-panoramas-v2/");
}
