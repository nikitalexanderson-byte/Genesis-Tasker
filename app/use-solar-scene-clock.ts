import {useEffect,useState} from 'react';
import {getDeviceDaySolarTimes,getTimezoneFallbackLocation,type DeviceLocation} from './solar-times';

/** One minute sample plus exact rise/set deadlines; no animation-frame clock. */
export function useSolarSceneClock(now:number,location:DeviceLocation|null,timeZone:string,visible:boolean) {
  const [instant,setInstant]=useState(now);
  const latitude=location?.latitude,longitude=location?.longitude;
  useEffect(()=>{
    if(!visible)return;
    const current=Date.now();
    const observer=typeof latitude==='number'&&Math.abs(latitude)<=90&&typeof longitude==='number'&&Math.abs(longitude)<=180
      ?{latitude,longitude}:getTimezoneFallbackLocation(timeZone);
    const events=getDeviceDaySolarTimes(new Date(current),observer,timeZone);
    const boundaries=[events.sunrise?.valueOf(),events.sunset?.valueOf()].filter((value):value is number=>typeof value==='number'&&value>current);
    const deadline=Math.min(current+60_000,...boundaries);
    const timer=window.setTimeout(()=>setInstant(Date.now()),Math.max(1,deadline-current+1));
    return()=>window.clearTimeout(timer);
  },[now,instant,latitude,longitude,timeZone,visible]);
  useEffect(()=>{
    const resume=()=>{if(document.visibilityState==='visible')setInstant(Date.now());};
    window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    return()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[]);
  return Math.max(now,instant);
}
