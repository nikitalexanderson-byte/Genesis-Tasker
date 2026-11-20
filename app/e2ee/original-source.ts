import {openE2eeEnvelope,validateE2eeEnvelope,type E2eeContext} from './envelope.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {localRecordKey,type E2eeRecordStorage} from './storage.ts';
import {openSourceStage,type SourceStageReadVault,type SourceStageReference,type SourceStageTarget} from './source-stage.ts';

/** These coordinates and PUBLIC signer must come from the authenticated recovery
 * handoff, not ciphertext/server metadata. Roots are already independently
 * unwrapped. This API proves only access to one original protected source; it
 * does not establish custody, a new device enrollment or whole-scope recovery. */
export type OriginalSourceIdentity=Readonly<{ownerId:string;scopeId:string;deviceId:string;generation:number;cryptoEpoch:number;securityEpoch:number}>;
export type OriginalSourceOptions={storage:Pick<E2eeRecordStorage,'get'|'list'>;original:OriginalSourceIdentity;
 roots:ReadonlyMap<string,CryptoKey>;signer:CryptoKey;target:SourceStageTarget;reference:SourceStageReference;assertCurrent:()=>void};
function invalid():never{throw new Error('E2EE_INVALID_ORIGINAL_SOURCE');}
function sourceId(id:string){assertTechnical(id);if(!id.startsWith('source-stage:')&&!id.startsWith('source-stage-catalog:'))throw new Error('E2EE_ORIGINAL_SOURCE_READ_FORBIDDEN');}

/** Intentionally has no storage property, write/commit/signing key or arbitrary
 * domain reader. Closing denies pending reads before any decrypted bytes leave. */
class OriginalSourceVault implements SourceStageReadVault {
 #original:OriginalSourceIdentity;#roots:Map<string,CryptoKey>;#signer:CryptoKey;#check:()=>void;#closed=false;
 #get:E2eeRecordStorage['get'];#list:E2eeRecordStorage['list'];
 constructor(input:OriginalSourceOptions){
  const original={...input.original};exactKeys(original,['ownerId','scopeId','deviceId','generation','cryptoEpoch','securityEpoch']);
  for(const name of ['ownerId','scopeId','deviceId'] as const)assertTechnical(original[name]);
  for(const name of ['generation','cryptoEpoch','securityEpoch'] as const)if(!Number.isSafeInteger(original[name])||original[name]<1)invalid();
  this.#roots=new Map(input.roots);if(this.#roots.size<1||this.#roots.size>64)invalid();
  for(const[id,key]of this.#roots){assertTechnical(id);if(!key||key.type!=='secret'||key.algorithm.name!=='AES-KW'||(key.algorithm as AesKeyAlgorithm).length!==256||!key.usages.includes('unwrapKey')||key.extractable)invalid();}
  const signer=input.signer;if(!signer||signer.type!=='public'||signer.algorithm.name!=='ECDSA'||(signer.algorithm as EcKeyAlgorithm).namedCurve!=='P-256'||!signer.usages.includes('verify'))invalid();
  this.#original=Object.freeze(original);this.#signer=signer;this.#check=input.assertCurrent;this.#get=input.storage.get.bind(input.storage);this.#list=input.storage.list.bind(input.storage);
  this.assertUnlocked();
 }
 assertUnlocked(){if(this.#closed)throw new Error('E2EE_ORIGINAL_SOURCE_CLOSED');this.#check();}
 close(){this.#closed=true;this.#roots.clear();}
 localIdentity(){this.assertUnlocked();const{ownerId,scopeId,deviceId}=this.#original;return Object.freeze({ownerId,scopeId,deviceId});}
 async read(domain:E2eeContext['domain'],objectId:string){
  this.assertUnlocked();if(domain!=='local-snapshot')throw new Error('E2EE_ORIGINAL_SOURCE_READ_FORBIDDEN');sourceId(objectId);
  const scope=this.#original,record=await this.#get(localRecordKey(scope,domain,objectId));this.assertUnlocked();if(record===null)return null;
  const envelope=validateE2eeEnvelope(record.envelope),context=envelope.context;
  if(!Number.isSafeInteger(record.serial)||record.serial<1||context.revision!==record.serial||context.ownerId!==scope.ownerId||context.scopeId!==scope.scopeId
   ||context.deviceId!==scope.deviceId||context.domain!==domain||context.objectId!==objectId||context.schemaVersion!==1||context.dataGeneration!==scope.generation
   ||context.cryptoEpoch>scope.cryptoEpoch||context.securityEpoch>scope.securityEpoch)throw new Error('E2EE_CORRUPT_ORIGINAL_SOURCE');
  const root=this.#roots.get(context.keyId);if(!root)throw new Error('E2EE_KEY_UNAVAILABLE');
  const value=await openE2eeEnvelope(root,this.#signer,context,envelope);
  try{this.assertUnlocked();return{serial:record.serial,value};}catch(error){value.fill(0);throw error;}
 }
 async listLocal(domain:E2eeContext['domain'],objectPrefix:string){
  this.assertUnlocked();if(domain!=='local-snapshot'||objectPrefix!=='source-stage:')throw new Error('E2EE_ORIGINAL_SOURCE_READ_FORBIDDEN');
  const prefix=[this.#original.ownerId,this.#original.scopeId,domain].map(part=>`${part.length}:${part}`).join(''),keys=await this.#list(prefix);this.assertUnlocked();
  if(keys.length>10000||new Set(keys).size!==keys.length)throw new Error('E2EE_LOCAL_RECORD_LIMIT');const ids:string[]=[];
  for(const key of keys){
   if(typeof key!=='string'||!key.startsWith(prefix))throw new Error('E2EE_CORRUPT_ORIGINAL_SOURCE');const rest=key.slice(prefix.length),colon=rest.indexOf(':');
   if(colon<1||!/^[1-9][0-9]{0,2}$/.test(rest.slice(0,colon)))throw new Error('E2EE_CORRUPT_ORIGINAL_SOURCE');const id=rest.slice(colon+1);assertTechnical(id);
   if(Number(rest.slice(0,colon))!==id.length)throw new Error('E2EE_CORRUPT_ORIGINAL_SOURCE');if(id.startsWith(objectPrefix))ids.push(id);
  }
  return ids;
 }
}

/** A bounded, revocable, original-actor source capability. The caller must
 * reconcile every known stage/history separately. One valid stage/path EOF is
 * not whole-account completeness or authorization to restore any product data. */
export async function openOriginalSourceStage(input:OriginalSourceOptions){
 const options={...input,original:{...input.original},target:{...input.target},reference:{...input.reference}},vault=new OriginalSourceVault(options);
 const current=()=>vault.assertUnlocked(),borrowed=new Set<Uint8Array>(),active=new Set<string>();
 const close=()=>{vault.close();for(const bytes of borrowed)bytes.fill(0);borrowed.clear();};
 try{
  const opened=await openSourceStage(vault,options.target,options.reference,current);current();
  return Object.freeze({paths:Object.freeze([...opened.paths]),close,openPath(id:string){
   current();if(active.has(id))throw new Error('E2EE_ORIGINAL_SOURCE_PATH_BUSY');const raw=opened.openPath(id);active.add(id);let complete=false;
   const chunks=(async function*(){try{
    for await(const bytes of raw.chunks){current();borrowed.add(bytes);try{yield bytes;current();}finally{bytes.fill(0);borrowed.delete(bytes);}}
    raw.assertComplete();current();complete=true;
   }finally{active.delete(id);}})();
   return Object.freeze({chunks,assertComplete(){current();if(!complete)throw new Error('E2EE_SOURCE_STAGE_EOF_REQUIRED');}});
  }});
 }catch(error){close();throw error;}
}
