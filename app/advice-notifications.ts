import type {AdviceCollection} from './daily-advice';

export type AdviceNotifications={enabled:boolean;time:string;timeZone:string};
export type AdviceTarget={id:string;dayKey:string;collection:AdviceCollection};
export const advicePushDeviceKey=(userId:string)=>'genesis.advice-push.'+userId;
export function adviceDeviceTimeZone():string {
  try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/Moscow';}catch{return 'Europe/Moscow';}
}
export function adviceNotificationPreferences(value?:Partial<AdviceNotifications>|null):AdviceNotifications {
  let timeZone=adviceDeviceTimeZone();
  if(typeof value?.timeZone==='string')try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone});timeZone=value.timeZone;}catch{/* Invalid cached zones never authorize a delivery. */}
  return {enabled:value?.enabled===true,time:typeof value?.time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)?value.time:'09:00',timeZone};
}
/** Notification links identify a saved entry; they can never supply content or a new draw. */
export function adviceTargetFromUrl(value:string|URL):AdviceTarget|null {
  let url:URL;try{url=value instanceof URL?value:new URL(value,'https://genesiscalendar.com');}catch{return null;}
  const id=url.searchParams.get('advice'),dayKey=url.searchParams.get('adviceDay'),collection=url.searchParams.get('adviceCollection');
  if(!id||!/^advice-[a-f0-9]{24}$/.test(id)||!dayKey||!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)
    ||!['aurora','philosophers'].includes(collection??''))return null;
  const date=new Date(dayKey+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==dayKey)return null;
  return {id,dayKey,collection:collection as AdviceCollection};
}
