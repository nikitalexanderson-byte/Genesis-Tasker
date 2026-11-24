export type DonationMethods=Readonly<{schemaVersion:1;region:'RU'|'outside-RU'|'unknown';boosty:Readonly<{available:boolean;url:string|null}>}>;
export function verifiedBoostyUrl(value:unknown):string|null {
  if(typeof value!=='string'||!/^https:\/\/boosty\.to\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\/donate\/?$/.test(value))return null;
  return value;
}
export function readDonationMethods(value:unknown):DonationMethods {
  if(!value||typeof value!=='object')throw new Error('DONATION_METHODS_INVALID');
  const data=value as DonationMethods;
  if(data.schemaVersion!==1||!['RU','outside-RU','unknown'].includes(data.region)||!data.boosty||typeof data.boosty.available!=='boolean')throw new Error('DONATION_METHODS_INVALID');
  const url=verifiedBoostyUrl(data.boosty.url);
  if(data.boosty.available&&!url||!data.boosty.available&&data.boosty.url!==null)throw new Error('DONATION_METHODS_INVALID');
  return Object.freeze({schemaVersion:1,region:data.region,boosty:Object.freeze({available:data.boosty.available,url})});
}
export async function loadDonationMethods(signal:AbortSignal):Promise<DonationMethods>{
  const base=(process.env.NEXT_PUBLIC_GENESIS_API_URL?.trim()||'/api').replace(/\/$/,'');
  const response=await fetch(base+'/donations/methods',{credentials:'omit',cache:'no-store',signal});
  if(!response.ok)throw new Error('DONATION_METHODS_UNAVAILABLE');
  return readDonationMethods(await response.json());
}
