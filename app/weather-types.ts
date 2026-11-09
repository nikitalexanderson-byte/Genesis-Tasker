/** Provider-independent metric weather contract. UTC timestamps are ISO 8601 or null.
 * Forecast values are never represented as measured observations. */
export type WeatherCondition = 'clear'|'partly-cloudy'|'cloudy'|'fog'|'drizzle'|'rain'|'snow'|'sleet'|'freezing-rain'|'thunderstorm'|'unknown';
export type WeatherPrecipitationKind = 'none'|'drizzle'|'rain'|'snow'|'sleet'|'freezing-rain'|'hail'|'unknown';
export type WeatherPhenomenon = Exclude<WeatherCondition,'clear'|'partly-cloudy'|'cloudy'|'unknown'>|'hail';
export type WeatherCurrentV1 = {
  // Wind direction is meteorological FROM, clockwise from north (east=90).
  temperatureC:number|null; apparentTemperatureC:number|null; humidityPercent:number|null; pressureMslHpa:number|null;
  windSpeedMps:number|null; windDirectionDeg:number|null; windGustMps:number|null; cloudCoverPercent:number|null;
  precipitation1hMm:number|null; rain1hMm:number|null; snowWaterEquivalent1hMm:number|null;
  precipitationRateMmH:number|null; snowDepthCm:number|null; visibilityM:number|null;
  condition:WeatherCondition; phenomena:WeatherPhenomenon[]; precipitationKind:WeatherPrecipitationKind;
  intensity:'none'|'light'|'moderate'|'heavy'|'unknown'; providerCode:string|null;
  thunderstorm:boolean|null; storm:boolean|null; blizzard:boolean|null;
};
export type WeatherSnapshotV1 = {
  schemaVersion:1;
  status:'fresh'|'stale'|'unavailable'|'disabled'|'requires-location';
  reason:string|null;
  provider:{id:'met-norway'|'open-meteo';name:string;attributionUrl:string;licenseUrl:string;dataKind:'forecast'|'analysis'|'observation'};
  location:{latitude:number;longitude:number;approximate:boolean}|null;
  issuedAt:string|null; observedAt:string|null; validAt:string|null; validUntil:string|null;
  fetchedAt:string|null; expiresAt:string|null; retryAt:string|null;
  current:WeatherCurrentV1|null;
};
export type WeatherRequestV1 = {latitude:number;longitude:number;locationSource:'selected-city'|'network'};
