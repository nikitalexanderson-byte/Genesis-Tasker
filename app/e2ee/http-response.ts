import {parseE2eeTransportJson} from './transport-json.ts';
import type {E2eeHttpBodyObservation} from './http-observation.ts';

const prefix='/e2ee/v1/',routes=new Set(['status','bootstrap','command','read','challenge','directory','source','membership-state','membership-preview','membership']);
/** Same route budgets as native E2eeTransportProtocol, before JSON parsing. */
export function isE2eeResponsePath(path:string){return path.startsWith(prefix)&&routes.has(path.slice(prefix.length));}
export function e2eeResponseLimit(path:string,status:number){
 if(!isE2eeResponsePath(path))throw new Error('E2EE_ROUTE_FORBIDDEN');
 if(status<200||status>=300)return 8192;
 return path===prefix+'directory'?32*1024*1024:path===prefix+'read'?16*1024*1024:path===prefix+'command'?8*1024*1024:path===prefix+'membership-preview'?4*1024*1024:256*1024;
}
/** Same bounded technical-code grammar as native E2eeTransportProtocol. Raw
 * error bodies and arbitrary private strings are never exception payloads. */
export function e2eeHttpErrorCode(status:number,payload:Record<string,unknown>|null){
 const value=payload?.error;return status>=400&&status<=599&&typeof value==='string'&&/^E2EE_[A-Z_]{1,80}$/.test(value)?value:null;
}
/** Consumes only bounded UTF8 JSON from the existing authenticated fetch.
 * This does not authenticate envelope content or certify remote completeness.
 * No response snippet is included in errors. Parsed values/immutable strings
 * remain caller-owned; wiping consumed wire buffers is not string zeroization. */
export async function readE2eeJsonResponse(response:Response,path:string,assertCurrent:()=>void,observation?:E2eeHttpBodyObservation):Promise<Record<string,unknown>|null>{
 const limit=e2eeResponseLimit(path,response.status),reader=response.body?.getReader(),parts:string[]=[];let tail='',eof=false;
 const invalid=():never=>{throw new Error('E2EE_INVALID_RESPONSE');};
 try{
  assertCurrent();
  if(observation){await observation.begin(Object.freeze({path,status:response.status,contentType:response.headers.get('Content-Type'),contentLength:response.headers.get('Content-Length')}));assertCurrent();}
  const declared=response.headers.get('Content-Length');
  if(declared&&/^\d+$/.test(declared)&&Number(declared)>limit){if(!response.ok)return null;throw new Error('E2EE_RESPONSE_TOO_LARGE');}
  if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json'){if(!response.ok)return null;invalid();}
  if(!reader){if(!response.ok)return null;return invalid();}
  const decoder=new TextDecoder('utf-8',{fatal:true});let size=0;
  const append=(value:string)=>{tail+=value;if(tail.length>=65536){parts.push(tail);tail='';}};
  for(;;){
   assertCurrent();const next=await reader.read();
   try{
    assertCurrent();if(next.done){eof=true;break;}
    if(!(next.value instanceof Uint8Array)||next.value.length===0)invalid();size+=next.value.length;
    if(size>limit){if(!response.ok)return null;throw new Error('E2EE_RESPONSE_TOO_LARGE');}
    if(observation)for(let at=0;at<next.value.length;at+=65536){
     const loan=next.value.slice(at,at+65536);
     try{await observation.append(loan);assertCurrent();}finally{loan.fill(0);}
    }
    try{append(decoder.decode(next.value,{stream:true}));}catch{if(!response.ok)return null;invalid();}
   }finally{if(next.value instanceof Uint8Array)next.value.fill(0);}
  }
  if(observation){await observation.finish();assertCurrent();}
  try{append(decoder.decode());}catch{if(!response.ok)return null;invalid();}
  parts.push(tail);tail='';assertCurrent();let value:unknown;
  try{value=parseE2eeTransportJson(parts.join(''));}catch{if(!response.ok)return null;return invalid();}
  assertCurrent();if(!value||typeof value!=='object'||Array.isArray(value)){if(!response.ok)return null;invalid();}
  return value as Record<string,unknown>;
 }finally{
  parts.fill('');tail='';
  try{observation?.close();}finally{if(reader){try{if(!eof)await reader.cancel();}catch{/* Preserve the original read/actor error. */}finally{reader.releaseLock();}}}
 }
}
