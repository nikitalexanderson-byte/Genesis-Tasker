import {useEffect,useState} from 'react';
import {grantedDevicePaymentRegion,type PaymentRegion,type PaymentRouting} from './billing-location';

/** Region is an internal ordering hint. No settings or permission prompt is shown by this hook. */
export function useAutomaticPaymentRegion(routing:PaymentRouting|undefined,userId:string,busy:boolean):PaymentRegion {
  const [device,setDevice]=useState<{userId:string;region:PaymentRegion|null}|null>(null);
  useEffect(()=>{
    if(busy||device?.userId===userId)return;
    const controller=new AbortController();
    void grantedDevicePaymentRegion(navigator.permissions,navigator.geolocation,controller.signal).then(region=>{
      if(!controller.signal.aborted)setDevice({userId,region});
    });
    return()=>controller.abort();
  },[userId,busy,device?.userId]);
  return device?.userId===userId&&device.region?device.region:routing?.region??'unknown';
}
