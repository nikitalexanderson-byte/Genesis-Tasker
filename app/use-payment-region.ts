import {useEffect,useState} from 'react';
import {grantedDevicePaymentRegion,resolvedPaymentRegion,type PaymentRegion,type PaymentRouting} from './billing-location';

/** Fresh display/availability signals only, with no new location permission.
 * Language, time zone and saved currency never establish a Russia location. */
export function useAutomaticPaymentRegion(routing:PaymentRouting|undefined,userId:string,busy:boolean):PaymentRegion {
  const [device,setDevice]=useState<{userId:string;region:PaymentRegion|null}|null>(null);
  const [ip,setIp]=useState<{userId:string;region:PaymentRegion}|null>(null);
  useEffect(()=>{
    if(busy)return;
    const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),5000);
    const base=(process.env.NEXT_PUBLIC_GENESIS_API_URL?.trim()||'/api').replace(/\/$/,'');
    void fetch(`${base}/billing/location`,{credentials:'omit',cache:'no-store',signal:controller.signal})
      .then(response=>response.ok?response.json():null).then(value=>{
        if(!controller.signal.aborted)setIp({userId,region:value?.source==='ip'&&(value.region==='RU'||value.region==='outside-RU')?value.region:'unknown'});
      }).catch(()=>{if(!controller.signal.aborted)setIp({userId,region:'unknown'});}).finally(()=>window.clearTimeout(timeout));
    return()=>{controller.abort();window.clearTimeout(timeout);};
  },[userId,busy]);
  useEffect(()=>{
    if(busy||device?.userId===userId)return;
    const controller=new AbortController();
    void grantedDevicePaymentRegion(navigator.permissions,navigator.geolocation,controller.signal).then(region=>{
      if(!controller.signal.aborted)setDevice({userId,region});
    });
    return()=>controller.abort();
  },[userId,busy,device?.userId]);
  // Catalog routing may conservatively rule out domestic checkout while the
  // fresh anonymous IP read is pending. It cannot positively enable it alone.
  if(routing?.region==='outside-RU')return 'outside-RU';
  return resolvedPaymentRegion(ip?.userId===userId?ip.region:'unknown',device?.userId===userId?device.region:null);
}
