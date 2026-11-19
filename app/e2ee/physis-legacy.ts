import {exactKeys,assertTechnical} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {unlockPhysisVault,physisAad,type PhysisVault,type LegacyPhysisVault,type PhysisEnvelope,type WrappedKey} from '../physis/crypto.ts';

const MAX_CIPHER=256*1024,MAX_PLAIN=MAX_CIPHER-16;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const decoder=new TextDecoder('utf-8',{fatal:true});
function invalid():never{throw new Error('E2EE_PHYSIS_SOURCE_INVALID');}
function integer(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<1)invalid();}
function bytes(value:unknown,min:number,max=min):Uint8Array<ArrayBuffer>{
 if(typeof value!=='string'||value.length>4*Math.ceil(max/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid();
 let raw:string;try{raw=atob(value);}catch{invalid();}
 if(raw.length<min||raw.length>max||btoa(raw)!==value)invalid();
 return Uint8Array.from(raw,char=>char.charCodeAt(0));
}
function wrapped(value:unknown,length:number):asserts value is WrappedKey{
 exactKeys(value,['iv','ciphertext']);bytes(value.iv,12).fill(0);bytes(value.ciphertext,length).fill(0);
}

/** Validate the retained original before any KDF, key opening or normalization.
 * Keep vault_json/envelope_json as text until duplicate-name validation passes. */
export function parseLegacyPhysisJson(value:unknown,maximum=8192):unknown{
 return parseLegacyMigrationJson(value,'E2EE_PHYSIS_SOURCE_INVALID',maximum);
}
export function validateLegacyPhysisVault(input:unknown):PhysisVault{
 if(!input||typeof input!=='object'||Array.isArray(input))invalid();
 const value=input as Record<string,unknown>;integer(value.keyVersion);
 if(value.version===2){exactKeys(value,['version','keyVersion','account']);wrapped(value.account,62);}
 else if(value.version===1){
  exactKeys(value,['version','keyVersion','password','recovery']);exactKeys(value.password,['iv','ciphertext','salt','iterations']);
  if(value.password.iterations!==600000)invalid();
  bytes(value.password.salt,16).fill(0);wrapped({iv:value.password.iv,ciphertext:value.password.ciphertext},48);wrapped(value.recovery,48);
 }else throw new Error('E2EE_PHYSIS_FORMAT_UNSUPPORTED');
 return structuredClone(value) as PhysisVault;
}
export function validateLegacyPhysisEnvelope(input:unknown,keyVersion:number):PhysisEnvelope{
 integer(keyVersion);exactKeys(input,['version','schemaVersion','keyVersion','iv','ciphertext']);
 if(input.version!==1||input.schemaVersion!==1)throw new Error('E2EE_PHYSIS_FORMAT_UNSUPPORTED');
 if(input.keyVersion!==keyVersion)invalid();
 bytes(input.iv,12).fill(0);bytes(input.ciphertext,16,MAX_CIPHER).fill(0);return structuredClone(input) as PhysisEnvelope;
}
export type PhysisLegacyCredential={method:'password'|'recovery';secret:string};
export type PhysisLegacyUnlockPorts={assertCurrent:()=>void;
 accountOpen?:(envelope:WrappedKey,purpose:string)=>Promise<unknown>;
 independentUnlock?:(vault:LegacyPhysisVault)=>Promise<PhysisLegacyCredential|null>};
const knownError=(error:unknown)=>error instanceof Error&&/^E2EE_[A-Z_]{1,100}$/.test(error.message)?error:null;

/** Web-only legacy reader. Native provides a bound opening capability instead;
 * it must never send an old key into the packaged JavaScript engine. A missing
 * independent password/recovery source is locked, never empty. */
export async function unlockLegacyPhysisSource(ownerId:string,input:unknown,ports:PhysisLegacyUnlockPorts):Promise<CryptoKey>{
 assertTechnical(ownerId);ports.assertCurrent();const vault=validateLegacyPhysisVault(input);let raw:Uint8Array<ArrayBuffer>|undefined;
 try{
  if(vault.version===2){
   if(!ports.accountOpen)throw new Error('E2EE_PHYSIS_UNLOCK_REQUIRED');
   let opened:unknown;try{opened=await ports.accountOpen(structuredClone(vault.account),`physis-vault:v2:${vault.keyVersion}`);}
   catch(error){ports.assertCurrent();throw knownError(error)??new Error('E2EE_PHYSIS_UNLOCK_REQUIRED');}
   ports.assertCurrent();raw=bytes(opened,32);
  }else{
   if(!ports.independentUnlock)throw new Error('E2EE_PHYSIS_UNLOCK_REQUIRED');
   let credential:PhysisLegacyCredential|null;
   try{credential=await ports.independentUnlock(structuredClone(vault));}
   catch(error){ports.assertCurrent();throw knownError(error)??new Error('E2EE_PHYSIS_UNLOCK_REQUIRED');}
   ports.assertCurrent();
   if(credential===null)throw new Error('E2EE_PHYSIS_UNLOCK_REQUIRED');
   exactKeys(credential,['method','secret']);
   if(!['password','recovery'].includes(credential.method)||typeof credential.secret!=='string'||credential.secret.length<1||credential.secret.length>1024)invalid();
   if(credential.method==='recovery'){
    const recovery=credential.secret.trim();if(!/^PHY1-[A-Za-z0-9_-]{43}$/.test(recovery))invalid();
    bytes(recovery.slice(5).replace(/-/g,'+').replace(/_/g,'/')+'=',32).fill(0);
   }
   try{
    const old=await unlockPhysisVault(ownerId,vault,credential.secret,credential.method);ports.assertCurrent();
    raw=new Uint8Array(await crypto.subtle.exportKey('raw',old));
   }catch(error){ports.assertCurrent();throw knownError(error)??new Error('E2EE_PHYSIS_UNLOCK_REQUIRED');}
  }
  ports.assertCurrent();if(raw.length!==32)invalid();
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);ports.assertCurrent();return key;
 }finally{raw?.fill(0);}
}

/** Return the original parsed plaintext, without projecting away optional or
 * unknown record fields. Category schema validation is a separate mandatory
 * step. This path cannot rotate, bootstrap, acknowledge or upload old records. */
export async function readLegacyPhysisRecord(ownerId:string,id:string,keyVersion:number,key:CryptoKey,input:unknown,assertCurrent:()=>void):Promise<unknown>{
 assertTechnical(ownerId);if(typeof id!=='string'||!UUID.test(id))invalid();assertCurrent();
 const envelope=validateLegacyPhysisEnvelope(input,keyVersion),iv=bytes(envelope.iv,12),cipher=bytes(envelope.ciphertext,16,MAX_CIPHER);
 let plain:Uint8Array<ArrayBuffer>|undefined;
 try{
  try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:physisAad(ownerId,id,1,keyVersion)},key,cipher));}
  catch{assertCurrent();throw new Error('E2EE_LEGACY_PHYSIS_CORRUPT');}
  assertCurrent();if(plain.length>MAX_PLAIN)invalid();
  let text:string;try{text=decoder.decode(plain);}catch{invalid();}
  const value=parseLegacyPhysisJson(text,MAX_PLAIN);assertCurrent();return value;
 }finally{iv.fill(0);cipher.fill(0);plain?.fill(0);}
}
