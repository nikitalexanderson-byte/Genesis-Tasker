"use client";
import {useEffect} from 'react';
import {publicDomesticDestination} from './public-route';
import {requestWebsiteLocation,useWebsiteRegion,websiteDomesticRedirect} from './website-region';
import copy from './website-region-copy.json';

export function PublicEditionRouting({language}:{language:string}){
 const domestic=websiteDomesticRedirect(useWebsiteRegion());
 useEffect(()=>{if(!domestic)return;const next=publicDomesticDestination(window.location.href,(process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||'').replace(/\/$/,''));
  if(next)window.location.replace(next);
 },[domestic,language]);return null;
}
export function PublicRegionControl({language}:{language:string}){
 const state=useWebsiteRegion(),c=copy[language as keyof typeof copy]??copy.en;
 return <div className="public-currency-controls public-region-controls" data-no-translate>
  <button type="button" className="public-currency-locate" onClick={()=>void requestWebsiteLocation()} disabled={state.locating} title={c.privacy}>{state.locating?c.locating:c.locate}</button>
  {state.error?<p role="status">{c.unavailable}</p>:null}
 </div>;
}
