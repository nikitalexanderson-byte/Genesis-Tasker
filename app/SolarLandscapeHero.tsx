import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {projectSolarPosition,solarLandscapeCrop,solarLandscapeState} from './solar-landscape';
import type {AutomaticSolarLocation,DeviceLocation} from './solar-times';
import type {WeatherSnapshotV1} from './weather-types';
import {useCivilWeather} from './use-civil-weather';
import {SolarWeatherClouds,SolarWeatherEffects} from './SolarWeatherEffects';
import './solar-landscape-hero.css';
import nightStars from './solar-night-stars.json';
export {SolarWeatherSummary} from './SolarWeatherSummary';

/** The Today clock supplies the current instant and refreshes on focus/visibility. */
export default function SolarLandscapeHero({now,location,deviceTimeZone,source,basePath='',ownerId=null,weather}:{
  now:Date;location:DeviceLocation|null;deviceTimeZone:string;source:AutomaticSolarLocation['source']|null;basePath?:string;ownerId?:string|null;weather?:WeatherSnapshotV1|null;
}) {
  const loaded=useCivilWeather(ownerId,location,source);
  const [unavailableArt,setUnavailableArt]=useState<string|null>(null);
  const sceneNow=ownerId&&weather===undefined?new Date(Math.max(now.valueOf(),loaded.evaluatedAt)):now;
  const scene=solarLandscapeState(sceneNow,location,deviceTimeZone,source,weather===undefined?loaded.weather:weather,unavailableArt);
  const url=scene.artPath?`${basePath.replace(/\/$/u,'')}/${scene.artPath}?v=${scene.assetRevision}`:null;
  const [failedArt,setFailedArt]=useState<string|null>(null);
  const layer=useRef<HTMLDivElement>(null);
  const [viewport,setViewport]=useState({width:0,height:0});
  useLayoutEffect(()=>{
    const element=layer.current;
    if(!element)return;
    const measure=()=>{const {width,height}=element.getBoundingClientRect();setViewport(current=>current.width===width&&current.height===height?current:{width,height});};
    measure();
    const observer=new ResizeObserver(measure);observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  // Panoramic cards share their height equally between the sky and terrain.
  const horizonY = viewport.height > 0 && viewport.width >= viewport.height * 3 ? 0.5 : scene.horizonY;
  const sun=projectSolarPosition(scene.position,scene.observer.latitude,horizonY);
  const crop=scene.plate&&viewport.width>0&&viewport.height>0?solarLandscapeCrop(scene.plate,viewport.width,viewport.height,horizonY):null;
  const previous=useRef<{instant:number;observer:string}|null>(null);
  const snapOnResume=useRef(true);
  const instant=sceneNow.valueOf();
  const observer=[location?.latitude,location?.longitude,deviceTimeZone,source,scene.artPath,horizonY].join('|');
  useEffect(()=>{
    const resume=()=>{if(document.visibilityState==='visible')snapOnResume.current=true;};
    window.addEventListener('focus',resume);
    document.addEventListener('visibilitychange',resume);
    return ()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[]);
  useLayoutEffect(()=>{
    const last=previous.current,elapsed=last?instant-last.instant:0;
    const continuous=Boolean(last&&last.observer===observer&&elapsed>0&&elapsed<=90_000&&!snapOnResume.current);
    // The existing Today clock refreshes once a minute. CSS owns the motion between samples.
    layer.current?.style.setProperty('--solar-motion-duration',continuous?'60s':'0s');
    previous.current={instant,observer};
    snapOnResume.current=false;
  },[instant,observer]);
  const hasArt=Boolean(url&&failedArt!==url);
  const style={
    '--solar-x':`${sun.x*100}%`,'--solar-y':`${sun.y*100}%`,
    '--solar-horizon':`${horizonY*100}%`,'--solar-sky-top':scene.sky.top,'--solar-sky-bottom':scene.sky.bottom,
    ...(crop?{'--solar-terrain-width':`${crop.width}px`,'--solar-terrain-height':`${crop.height}px`,'--solar-terrain-x':`${crop.x}px`,'--solar-terrain-y':`${crop.y}px`}:{}),
    '--solar-terrain-url':url?`url(${JSON.stringify(url)})`:'none',
    '--solar-terrain-brightness':scene.terrainBrightness,'--solar-terrain-saturation':scene.terrainSaturation,
    '--solar-shade-left':scene.shadeLeft,'--solar-shade-right':scene.shadeRight,'--solar-light':scene.lightOpacity,
    '--solar-warmth':scene.warmth,'--solar-night':scene.night,
    '--weather-cloud-ink':scene.daylight>0.5?'172 183 194':'39 48 67',
  } as CSSProperties;
  return <div ref={layer} className="solar-landscape-hero" aria-hidden="true" data-solar-phase={scene.position.phase}
    data-solar-polar={scene.position.polarState} data-solar-approximate={scene.approximate} data-solar-art={scene.artKey} data-solar-snow-cover={scene.snowCover} style={style}>
    <span className="solar-landscape-sky"/>
    <svg className="solar-landscape-stars" viewBox={`0 0 ${nightStars.width} ${nightStars.height}`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      {nightStars.stars.map(([x,y,radius,opacity,color],index)=><g key={index} fill={nightStars.colors[color]}>
        {radius>1.7?<circle cx={x} cy={y} r={radius*3} opacity={opacity*.08}/>:null}
        <circle cx={x} cy={y} r={radius} opacity={opacity}/>
      </g>)}
    </svg>
    <span className="solar-landscape-haze"/>
    {scene.position.sunVisible?<span className="solar-landscape-sun" style={{opacity:scene.weather.sunTransmission}}/>:null}
    <SolarWeatherClouds weather={scene.weather} paused={Boolean(ownerId&&!loaded.visible)}/>
    {hasArt?<>
      {/* The authored alpha terrain occludes the sun; its sky is never baked in. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="solar-landscape-terrain" src={url!} alt="" draggable={false} decoding="async" onError={()=>{if(scene.snowCover)setUnavailableArt(scene.artPath);else setFailedArt(url);}}/>
      <span className="solar-landscape-ground-light"/>
      <span className="solar-landscape-ground-shade"/>
    </>:null}
    <SolarWeatherEffects weather={scene.weather} paused={Boolean(ownerId&&!loaded.visible)}/>
    <span className="solar-landscape-reading-shade"/>
  </div>;
}
