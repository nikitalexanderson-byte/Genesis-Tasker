import regions from './solar-water-regions.json';
import {weatherVisualState} from './weather-visuals';
import type {WeatherSnapshotV1} from './weather-types';
import plates from '../public/solar-landscapes-v1/manifest.json';

export type WaterSurface = {points:number[][];rocks:number[][];top:number;bottom:number};
type WaterRegion={kind:string;winterMonths:number[];waterlines:number[];bottom:number;bottoms?:number[];shore:number[][];rocks:number[][]};
const waterRegions:Record<string,WaterRegion>=regions;
const clamp=(value:number)=>Math.min(1,Math.max(0,value));

/** Surface coordinates follow the existing regional plates, including their month offset. */
export function solarWaterState(artKey:string,weather:WeatherSnapshotV1|null,now:number,displayedHorizon?:number) {
  const match=/^(temperate|boreal|mediterranean|arid|tropical|southern)\/(0[1-9]|1[0-2])\.webp$/u.exec(artKey);
  if(!match)return null;
  const region=waterRegions[match[1]],month=Number(match[2]);
  const original=(plates.entries as Record<string,{horizonY:number}>)[artKey];
  const shift=typeof displayedHorizon==='number'&&Number.isFinite(displayedHorizon)?displayedHorizon-original.horizonY:0;
  const bottom=region.bottoms?.[month-1]??region.bottom,top=Math.min(bottom-.04,Math.max(.1,region.waterlines[month-1]+shift));
  const visual=weatherVisualState(weather,now),wind=Math.max(visual.windSpeed,visual.windGust);
  const temperature=visual.fresh?weather?.current?.temperatureC:null;
  const frozen=region.kind==='lake'&&region.winterMonths.includes(month)&&typeof temperature==='number'&&Number.isFinite(temperature)&&temperature<0;
  const strength=clamp(wind/18);
  const surface:WaterSurface={top,bottom,points:region.shore.map(([x,y])=>[x,top+(bottom-top)*y]),rocks:region.rocks};
  return {surface,phase:frozen?'ice' as const:visual.windStrong?'waves' as const:'ripple' as const,
    rain:frozen||!['drizzle','rain','sleet','freezing-rain','hail'].includes(visual.precipitation)?0:visual.intensity==='heavy'?1:visual.intensity==='moderate'?.65:.3,
    amplitude:frozen?0:0.35+3.2*strength**1.35,speed:frozen?0:0.28+strength*1.3,
    frost:frozen?Math.min(0.9,0.68+Math.abs(temperature!)*0.018):0};
}
