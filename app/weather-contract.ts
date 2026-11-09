import type {WeatherSnapshotV1} from './weather-types';

const conditions=new Set(['clear','partly-cloudy','cloudy','fog','drizzle','rain','snow','sleet','freezing-rain','thunderstorm','unknown']);
const phenomena=new Set(['fog','drizzle','rain','snow','sleet','freezing-rain','thunderstorm','hail']);
const precipitation=new Set(['none','drizzle','rain','snow','sleet','freezing-rain','hail','unknown']);
const numeric=['temperatureC','apparentTemperatureC','humidityPercent','pressureMslHpa','windSpeedMps','windDirectionDeg','windGustMps','cloudCoverPercent','precipitation1hMm','rain1hMm','snowWaterEquivalent1hMm','precipitationRateMmH','snowDepthCm','visibilityM'];
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const nullableNumber=(value:unknown)=>value===null||typeof value==='number'&&Number.isFinite(value);
const nullableTime=(value:unknown)=>value===null||typeof value==='string'&&Number.isFinite(Date.parse(value));

/** A malformed response cannot start effects or break the header. */
export function isWeatherSnapshotV1(value:unknown):value is WeatherSnapshotV1 {
  if(!record(value)||value.schemaVersion!==1||!['fresh','stale','unavailable','disabled','requires-location'].includes(String(value.status)))return false;
  const provider=value.provider;
  if(!record(provider)||!['met-norway','open-meteo'].includes(String(provider.id))||typeof provider.name!=='string'||provider.name.length>100
    ||!['forecast','analysis','observation'].includes(String(provider.dataKind))||typeof provider.attributionUrl!=='string'||typeof provider.licenseUrl!=='string')return false;
  if(!['issuedAt','observedAt','validAt','validUntil','fetchedAt','expiresAt','retryAt'].every(key=>nullableTime(value[key])))return false;
  if(value.location!==null&&(!record(value.location)||typeof value.location.latitude!=='number'||!Number.isFinite(value.location.latitude)||Math.abs(value.location.latitude)>90
    ||typeof value.location.longitude!=='number'||!Number.isFinite(value.location.longitude)||Math.abs(value.location.longitude)>180||typeof value.location.approximate!=='boolean'))return false;
  const current=value.current;if(current===null)return true;
  return record(current)&&numeric.every(key=>nullableNumber(current[key]))&&conditions.has(String(current.condition))&&precipitation.has(String(current.precipitationKind))
    &&['none','light','moderate','heavy','unknown'].includes(String(current.intensity))&&Array.isArray(current.phenomena)&&current.phenomena.every(kind=>typeof kind==='string'&&phenomena.has(kind))
    &&['thunderstorm','storm','blizzard'].every(key=>current[key]===null||typeof current[key]==='boolean')&&(current.providerCode===null||typeof current.providerCode==='string');
}
