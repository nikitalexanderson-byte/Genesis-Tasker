import copy from '../../contracts/e2ee/external-copy-copy-v1.json' with {type:'json'};
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {encodeE2eeBytes} from './envelope.ts';
import type {WebPrivateAccount} from './product-session.ts';

export const EXTERNAL_COPY_NOTICE_VERSION='external-copy-336-v1';
export const externalCopyText=(language:string)=>copy.locales[language as keyof typeof copy.locales]??copy.locales.en;
export type ExternalCopyProvider='gemini'|'gigachat'|'google-tasks'|'google-calendar'|'yandex-speller';
declare const consentBrand:unique symbol;
export type ExternalCopyConsent={readonly[consentBrand]:true};
type ConsentState={account:WebPrivateAccount;provider:ExternalCopyProvider;target:string;digest:string;expires:number;used:boolean};
const consents=new WeakMap<ExternalCopyConsent,ConsentState>();
const now=()=>performance.now();
async function capture(input:unknown){
 const raw=JSON.stringify(input);if(typeof raw!=='string')throw new Error('E2EE_EXTERNAL_COPY_INVALID');
 const snapshot=parseLegacyMigrationJson(raw,'E2EE_EXTERNAL_COPY_INVALID',8*1024*1024);
 const sort=(value:unknown):unknown=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,child])=>[key,sort(child)])):value;
 const bytes=new TextEncoder().encode(JSON.stringify(sort(snapshot)));try{return{snapshot,digest:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))};}finally{bytes.fill(0);}
}
/** A UI decision binds one exact external copy to one unlocked account. The
 * opaque single-use capability cannot be restored from JSON, a server flag,
 * content backup or a previous session. Its digest stays local, never in AAD,
 * network metadata or telemetry. */
export async function approveExternalCopy(account:WebPrivateAccount,provider:ExternalCopyProvider,target:string,payload:unknown,review:{confirmed:boolean;noticeVersion:string}):Promise<ExternalCopyConsent>{
 const held=structuredClone(payload);account.requireOpen();if(account.mode!=='online'||!review.confirmed||review.noticeVersion!==EXTERNAL_COPY_NOTICE_VERSION||copy.version!==EXTERNAL_COPY_NOTICE_VERSION)throw new Error('E2EE_EXTERNAL_COPY_CONSENT_REQUIRED');
 if(!['gemini','gigachat','google-tasks','google-calendar','yandex-speller'].includes(provider)||target.length<1||target.length>256)throw new Error('E2EE_EXTERNAL_COPY_INVALID');
 const {digest}=await capture(held);account.requireOpen();const token=Object.freeze({}) as ExternalCopyConsent;consents.set(token,{account,provider,target,digest,expires:now()+120000,used:false});return token;
}
export async function consumeExternalCopy<T>(account:WebPrivateAccount,token:ExternalCopyConsent|undefined,provider:ExternalCopyProvider,target:string,payload:T):Promise<T>{
 const held=structuredClone(payload),state=token?consents.get(token):undefined;account.requireOpen();
 if(!state||state.account!==account||state.used||state.expires<now()||state.provider!==provider||state.target!==target)throw new Error('E2EE_EXTERNAL_COPY_CONSENT_REQUIRED');
 state.used=true;const captured=await capture(held);account.requireOpen();if(captured.digest!==state.digest)throw new Error('E2EE_EXTERNAL_COPY_CHANGED');return captured.snapshot as T;
}
