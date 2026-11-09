import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {loadCivilWeather} from './cloud-sync';
import {createWeatherStore} from './weather-store';
import type {AutomaticSolarLocation,DeviceLocation} from './solar-times';
import type {WeatherRequestV1} from './weather-types';

const stores=new Map<string,ReturnType<typeof createWeatherStore>>();
const serverSnapshot={status:'idle',weather:null,evaluatedAt:0,visible:false} as const;
function storedWeather(ownerId:string|null,location:DeviceLocation|null,source:AutomaticSolarLocation['source']|null) {
  const valid=Boolean(ownerId&&location&&Number.isFinite(location.latitude)&&Math.abs(location.latitude)<=90&&Number.isFinite(location.longitude)&&Math.abs(location.longitude)<=180&&(source==='selected-city'||source==='network'));
  const key=valid?`${ownerId}|${location!.latitude}|${location!.longitude}|${source}`:`${ownerId??''}|no-location`;
  let store=stores.get(key);
  if(!store) {
    const request:WeatherRequestV1|null=valid?{latitude:location!.latitude,longitude:location!.longitude,locationSource:source as WeatherRequestV1['locationSource']}:null;
    store=createWeatherStore(request,loadCivilWeather,{now:()=>Date.now(),visible:()=>typeof document!=='undefined'&&document.visibilityState==='visible',setTimer:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimer:id=>globalThis.clearTimeout(id as ReturnType<typeof setTimeout>)});
    stores.set(key,store);
    if(stores.size>12)for(const [oldKey,oldStore] of stores)if(oldKey!==key&&!oldStore.hasListeners()){stores.delete(oldKey);if(stores.size<=12)break;}
  }
  return store;
}

export function useCivilWeather(ownerId:string|null,location:DeviceLocation|null,source:AutomaticSolarLocation['source']|null) {
  const latitude=location?.latitude,longitude=location?.longitude;
  const store=useMemo(()=>storedWeather(ownerId,latitude===undefined||longitude===undefined?null:{latitude,longitude},source),[ownerId,latitude,longitude,source]);
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,()=>serverSnapshot);
  useEffect(()=>{
    const resume=()=>store.resume();window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    return ()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[store]);
  return snapshot;
}
