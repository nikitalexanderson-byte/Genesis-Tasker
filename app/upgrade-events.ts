export const UPGRADE_REQUEST_EVENT='genesis:upgrade-request';
export type UpgradeRequest={feature?:string;resource?:string;limit?:number|null;used?:number;plan?:'standart'|'premium'|'business';reason?:'feature'|'quota'|'compare'|'trial-expired'};

/** This event opens a comparison. It never grants access or changes a saved plan. */
export function requestUpgrade(detail:UpgradeRequest={reason:'compare'}) {
  if(typeof window!=='undefined'&&typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent<UpgradeRequest>(UPGRADE_REQUEST_EVENT,{detail}));
}

export function notifyUpgradeError(code:unknown,feature?:unknown) {
  if(typeof code!=='string'||feature==='calendar-sync'||feature==='assistant')return;
  if(code.startsWith('SUBSCRIPTION_QUOTA_'))requestUpgrade({resource:code.slice('SUBSCRIPTION_QUOTA_'.length),reason:'quota'});
  else if(code==='FEATURE_SUBSCRIPTION_REQUIRED')requestUpgrade({feature:typeof feature==='string'?feature:undefined,reason:'feature'});
}
