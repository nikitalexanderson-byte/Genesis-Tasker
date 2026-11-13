import policy from './weather-visuals-v1.json';
import type {WeatherSnapshotV1,WeatherPrecipitationKind} from './weather-types';

const clamp=(value:number,min=0,max=1)=>Math.min(max,Math.max(min,value));
const metric=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export const weatherTimestamp=(value:string|null|undefined)=>value?Date.parse(value):NaN;
export function cloudDriftDuration(windSpeedMps:number):number {
  return 240/(1+Math.min(100,Math.max(0,Number.isFinite(windSpeedMps)?windSpeedMps:0))*.3);
}

export function weatherFreshUntil(weather:WeatherSnapshotV1|null):number {
  if(!weather||weather.schemaVersion!==1||weather.status!=='fresh'||!weather.current)return NaN;
  const start=weatherTimestamp(weather.validAt),end=weatherTimestamp(weather.validUntil),expiry=weatherTimestamp(weather.expiresAt);
  return [start,end,expiry].every(Number.isFinite)&&end>start&&expiry>start?Math.min(end,expiry):NaN;
}

export function isWeatherFresh(weather:WeatherSnapshotV1|null,now:number):boolean {
  const end=weatherFreshUntil(weather),start=weatherTimestamp(weather?.validAt);
  return Number.isFinite(now)&&Number.isFinite(end)&&now>=start&&now<end;
}

export function weatherVisualState(weather:WeatherSnapshotV1|null,now:number) {
  const fresh=isWeatherFresh(weather,now),current=fresh?weather!.current:null;
  const rate=current?(metric(current.precipitationRateMmH)??metric(current.precipitation1hMm)):null;
  const kind=current?.precipitationKind;
  const precipitation:WeatherPrecipitationKind=current&&rate!==null&&rate>0&&current.intensity!=='none'
    &&kind&&['drizzle','rain','snow','sleet','freezing-rain','hail'].includes(kind)?kind:'none';
  const snow=precipitation==='snow'||precipitation==='sleet';
  const explicitCloud=current?.condition==='cloudy'?0.9:current?.condition==='partly-cloudy'?0.45:0;
  const cloudCover=current?clamp((metric(current.cloudCoverPercent)??explicitCloud*100)/100):0;
  const windSpeed=current?metric(current.windSpeedMps)??0:0,gust=current?metric(current.windGustMps)??0:0;
  const wind=Math.max(windSpeed,gust),direction=current?metric(current.windDirectionDeg):null;
  const hemisphere=(weather?.location?.latitude??0)<0?-1:1;
  const drift=direction===null?0:Math.sin(direction*Math.PI/180)*hemisphere*Math.min(policy.wind.maxDriftPixels,wind*policy.wind.pixelsPerMps);
  const visibility=current?metric(current.visibilityM):null;
  const fog=current&&(current.condition==='fog'||visibility!==null&&visibility<policy.fog.visibleBelowM)
    ?Math.max(current.condition==='fog'?0.3:0,visibility===null?0.5:1-clamp(visibility/policy.fog.visibleBelowM)):0;
  const heavyThreshold=snow?policy.precipitation.snowHeavyFromMmH:policy.precipitation.rainHeavyFromMmH;
  const lightThreshold=snow?policy.precipitation.snowLightBelowMmH:policy.precipitation.rainLightBelowMmH;
  const intensity=precipitation==='none'?'none':current!.intensity==='light'||current!.intensity==='moderate'||current!.intensity==='heavy'?current!.intensity
    :rate!>=heavyThreshold?'heavy':precipitation==='drizzle'||rate!<lightThreshold?'light':'moderate';
  const particles=intensity==='none'?0:policy.precipitation.particles[intensity];
  return {fresh,precipitation,intensity,particles,cloudCover,sunTransmission:1-cloudCover**policy.cloud.transmissionPower,
    groundDimming:cloudCover*policy.cloud.groundDimming,fogOpacity:fog*policy.fog.maxOpacity,
    windVisible:wind>=policy.wind.visibleFromMps,windStrong:wind>=policy.wind.strongFromMps,windSpeed,windGust:gust,drift,
    cloudDurationSeconds:cloudDriftDuration(windSpeed),cloudMoving:fresh&&windSpeed>0,
    storm:Boolean(current?.storm||current?.thunderstorm),thunderstorm:current?.thunderstorm===true,
    blizzard:current?.blizzard===true&&snow,
    snowCover:fresh&&(metric(current?.snowDepthCm)??0)>0};
}
