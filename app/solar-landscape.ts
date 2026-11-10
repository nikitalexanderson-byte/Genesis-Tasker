import manifest from '../public/solar-landscapes-v1/manifest.json';
import palette from './solar-landscape-palette.json';
import {gregorianMonthArt} from './gregorian-season-art';
import {getDeviceDaySolarTimes,getSolarPosition,getTimezoneFallbackLocation,type DeviceLocation,type AutomaticSolarLocation,type SolarPosition} from './solar-times';
import {weatherVisualState} from './weather-visuals';
import type {WeatherSnapshotV1} from './weather-types';

export type SolarLandscapePlate={width:number;height:number;horizonY:number};
const plates=manifest.entries as Record<string,SolarLandscapePlate>;
const snowPlates=(manifest as typeof manifest&{snowCoverEntries?:Record<string,SolarLandscapePlate&{path:string}>}).snowCoverEntries??{};
const validPlate=(plate:SolarLandscapePlate|undefined)=>Boolean(plate&&[plate.width,plate.height,plate.horizonY].every(Number.isFinite)&&plate.width>0&&plate.height>0&&plate.horizonY>palette.projection.skyTop&&plate.horizonY<1);
const clamp=(value:number,min=0,max=1)=>Math.min(max,Math.max(min,value));
const smooth=(start:number,end:number,value:number)=>{const x=clamp((value-start)/(end-start));return x*x*(3-2*x);};
const mix=(from:number,to:number,amount:number)=>from+(to-from)*amount;
function colorMix(from:string,to:string,amount:number):string {
  const channel=(color:string,offset:number)=>parseInt(color.slice(offset,offset+2),16);
  return '#'+[1,3,5].map(offset=>Math.round(mix(channel(from,offset),channel(to,offset),amount)).toString(16).padStart(2,'0')).join('');
}
function skyColors(altitude:number) {
  const stops=palette.skyStops;
  const upper=stops.findIndex(stop=>stop.altitude>=altitude);
  if(upper===0)return {top:stops[0].top,bottom:stops[0].bottom};
  if(upper===-1)return {top:stops.at(-1)!.top,bottom:stops.at(-1)!.bottom};
  const a=stops[upper-1],b=stops[upper],amount=(altitude-a.altitude)/(b.altitude-a.altitude);
  return {top:colorMix(a.top,b.top,amount),bottom:colorMix(a.bottom,b.bottom,amount)};
}
function validLocation(location:DeviceLocation|null):location is DeviceLocation {
  return Boolean(location&&Number.isFinite(location.latitude)&&Math.abs(location.latitude)<=90&&Number.isFinite(location.longitude)&&Math.abs(location.longitude)<=180);
}
function validZone(zone:string):string {
  try{new Intl.DateTimeFormat('en',{timeZone:zone});return zone;}catch{return 'UTC';}
}

/** Keep the exact existing month/region and southern-offset selection. */
export function solarLandscapeArtKey(monthIndex:number,location:DeviceLocation):string {
  return gregorianMonthArt(monthIndex,location).replace('gregorian-months-v1/','');
}

/** The eastward unit-vector component stays continuous at the zenith and polar midnight.
 * It mirrors the observer's view toward the equator in the southern hemisphere.
 */
export function projectSolarPosition(position:Pick<SolarPosition,'altitudeDeg'|'azimuthDeg'>,latitude:number,horizonY:number) {
  if(!Number.isFinite(position.altitudeDeg)||!Number.isFinite(position.azimuthDeg)||!Number.isFinite(latitude)||Math.abs(latitude)>90
    ||!Number.isFinite(horizonY)||horizonY<=palette.projection.skyTop||horizonY>=1)throw new RangeError('Invalid solar projection');
  const radians=Math.PI/180,hemisphere=latitude<0?-1:1,altitude=clamp(position.altitudeDeg,0,90)*radians;
  return {x:0.5-palette.projection.horizontalAmplitude*Math.cos(altitude)*Math.sin(position.azimuthDeg*radians)*hemisphere,
    y:horizonY-(horizonY-palette.projection.skyTop)*Math.sin(altitude)};
}

/** Align the authored horizon with the display horizon without uncovering an edge. */
export function solarLandscapeCrop(plate:SolarLandscapePlate,width:number,height:number,horizonY=plate.horizonY) {
  if(![plate.width,plate.height,width,height].every(value=>Number.isFinite(value)&&value>0)||![plate.horizonY,horizonY].every(value=>Number.isFinite(value)&&value>0&&value<1))throw new RangeError('Invalid solar landscape crop');
  const scale=Math.max(width/plate.width,height*horizonY/(plate.height*plate.horizonY),height*(1-horizonY)/(plate.height*(1-plate.horizonY)));
  const scaledWidth=plate.width*scale,scaledHeight=plate.height*scale;
  return {scale,width:scaledWidth,height:scaledHeight,x:(width-scaledWidth)/2,y:height*horizonY-scaledHeight*plate.horizonY};
}

/** A pure scene model: no permission, location lookup, selected date or own clock. */
export function solarLandscapeState(now:Date,location:DeviceLocation|null,deviceTimeZone:string,source:AutomaticSolarLocation['source']|null=null,weather:WeatherSnapshotV1|null=null,unavailableArt:string|null=null) {
  const zone=validZone(deviceTimeZone),hasLocation=validLocation(location);
  const observer=hasLocation?location:getTimezoneFallbackLocation(zone);
  const locationSource=hasLocation&&source?source:'timezone-fallback';
  const monthIndex=Number(new Intl.DateTimeFormat('en',{timeZone:zone,month:'numeric'}).format(now))-1;
  const artKey=solarLandscapeArtKey(monthIndex,observer),candidate=plates[artKey],visuals=weatherVisualState(weather,now.valueOf());
  const coverCandidate=snowPlates[artKey],coverPath=coverCandidate?`solar-landscapes-v1/${coverCandidate.path}`:null;
  const useCover=Boolean(visuals.snowCover&&validPlate(candidate)&&validPlate(coverCandidate)&&/^snow-cover\/[a-z]+\/\d{2}\.webp$/u.test(coverCandidate.path)&&coverPath!==unavailableArt);
  const plate=useCover?coverCandidate:validPlate(candidate)?candidate:null;
  const horizonY=plate?.horizonY??0.64,position=getSolarPosition(now,observer),sun=projectSolarPosition(position,observer.latitude,horizonY);
  const events=getDeviceDaySolarTimes(now,observer,zone),instant=now.valueOf();
  const sunVisible=events.sunrise&&events.sunset
    ? events.sunrise<events.sunset
      ? instant>=events.sunrise.valueOf()&&instant<events.sunset.valueOf()
      : instant>=events.sunrise.valueOf()||instant<events.sunset.valueOf()
    : position.altitudeDeg>-0.833;
  const daylight=smooth(-12,8,position.altitudeDeg),directLight=smooth(0,30,position.altitudeDeg);
  const warmth=smooth(-12,-2,position.altitudeDeg)*(1-smooth(8,28,position.altitudeDeg));
  const side=(sun.x-0.5)/palette.projection.horizontalAmplitude;
  return {monthIndex,artKey,artPath:useCover?coverPath:plate?`solar-landscapes-v1/${artKey}`:null,assetRevision:manifest.assetRevision,snowCover:useCover,weather:visuals,plate,horizonY,position,sun,observer,
    // Use the same apparent rise/set times as the visible Today panel.
    sunrise:events.sunrise,sunset:events.sunset,sunVisible,sunOpacity:sunVisible?0.4+0.6*visuals.sunTransmission:0,
    approximate:locationSource!=='selected-city',locationSource,
    sky:skyColors(position.altitudeDeg),daylight,directLight,warmth:warmth*(1-visuals.cloudCover*0.7),night:(1-smooth(-18,-6,position.altitudeDeg))*(1-visuals.cloudCover),
    terrainBrightness:mix(palette.terrain.nightBrightness,palette.terrain.dayBrightness,daylight)*(1-visuals.groundDimming*daylight),
    terrainSaturation:mix(palette.terrain.nightSaturation,palette.terrain.daySaturation,daylight),
    shadeLeft:Math.max(0,side)*directLight*palette.terrain.directionalShade*visuals.sunTransmission,
    shadeRight:Math.max(0,-side)*directLight*palette.terrain.directionalShade*visuals.sunTransmission,
    lightOpacity:directLight*palette.terrain.directionalLight*visuals.sunTransmission};
}
