import {useSyncExternalStore} from 'react';
import {grantedDevicePaymentRegion,locatePaymentRegion} from './billing-location';
import type {WebsiteRegion} from './website-region-policy';
export {websiteRegionRussia,websiteDomesticRedirect,websiteDonationsAvailable} from './website-region-policy';
export type {WebsiteRegion} from './website-region-policy';

const initial:WebsiteRegion=Object.freeze({ip:'unknown',device:null,loading:true,locating:false,error:false});
let value=initial,users=0,epoch=0,manualEpoch=0,controller:AbortController|undefined,interval:ReturnType<typeof setInterval>|undefined;
const listeners=new Set<()=>void>();
const update=(patch:Partial<WebsiteRegion>)=>{value=Object.freeze({...value,...patch});for(const listener of listeners)listener();};
/** Country display signals never grant identity, billing entitlement or access.
 * Device coordinates stay in the local country-boundary lookup. */
function refresh(){
 if(!users||document.visibilityState!=='visible')return;const ticket=++epoch,manual=manualEpoch;controller?.abort();controller=new AbortController();const request=controller,timeout=setTimeout(()=>request.abort(),5000);
 update({ip:'unknown',device:null,loading:true});const base=(process.env.NEXT_PUBLIC_GENESIS_API_URL?.trim()||'/api').replace(/\/$/,'');
 const ip=fetch(`${base}/billing/location`,{credentials:'omit',cache:'no-store',signal:request.signal}).then(response=>response.ok?response.json():null).then(result=>{if(ticket===epoch)update({ip:result?.source==='ip'&&['RU','outside-RU'].includes(result.region)?result.region:'unknown'});}).catch(()=>{if(ticket===epoch)update({ip:'unknown'});}).finally(()=>clearTimeout(timeout));
 const device=grantedDevicePaymentRegion(navigator.permissions,navigator.geolocation).then(region=>{if(ticket===epoch&&manual===manualEpoch)update({device:region});});
 void Promise.allSettled([ip,device]).then(()=>{if(ticket===epoch)update({loading:false});});
}
const wake=()=>refresh();
function subscribe(listener:()=>void){listeners.add(listener);if(++users===1){refresh();document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);interval=setInterval(wake,120000);}
 return()=>{listeners.delete(listener);if(--users===0){epoch++;manualEpoch++;controller?.abort();clearInterval(interval);document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);value=initial;}};
}
const noSubscription=()=>()=>{};
export function useWebsiteRegion(enabled=true){
 return useSyncExternalStore(enabled?subscribe:noSubscription,enabled?()=>value:()=>initial,()=>initial);
}
/** Called only by an explicit location button, so the visitor controls the
 * browser's permission prompt. Already granted access is checked automatically. */
export async function requestWebsiteLocation(){const ticket=++manualEpoch;update({locating:true,error:false});try{if(!navigator.geolocation)throw new Error('LOCATION_UNAVAILABLE');const device=await locatePaymentRegion(navigator.geolocation);if(ticket===manualEpoch)update({device:device==='unknown'?null:device,error:device==='unknown'});}catch{if(ticket===manualEpoch)update({device:null,error:true});}finally{if(ticket===manualEpoch)update({locating:false});}}
