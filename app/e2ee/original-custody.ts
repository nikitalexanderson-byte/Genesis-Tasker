import {canonicalE2eeValue,signE2eeCommand,snapshotE2eeValue,verifyE2eeCommand,type WireValue,type SignedE2eeCommand} from './commands.ts';
import {decodeE2eeBytes,encodeE2eeBytes,importE2eeRoot} from './envelope.ts';
import {assertTechnical,exactKeys,openBundle,protectBundle,recoverAuthority,type ProtectedBundle,type PublicDeviceKeys,type RecoveryKit} from './keys.ts';
import {openOriginalSourceStage,openOriginalLegacySnapshot,type OriginalSourceIdentity} from './original-source.ts';
import type {E2eeRecordStorage} from './storage.ts';
import type {SourceStageReference,SourceStageTarget} from './source-stage.ts';
import type {LegacyMigrationSnapshotReference} from './legacy-snapshot-stream.ts';

/** Owner-private local root custody. A project/space authority is NEVER a
 * recipient. This is neither a device enrollment nor authority to write/restore. */
export const ORIGINAL_CUSTODY_PURPOSE='original-root-custody-v1' as const;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type OriginalCustodyArtifact=Readonly<{protocol:1;id:string;bundle:ProtectedBundle}>;
export type OriginalCustodyReference=Readonly<{protocol:1;id:string;hash:string;original:OriginalSourceIdentity;keyId:string;signer:string;authority:PublicDeviceKeys}>;
export interface OriginalCustodyStorage {
 get(ownerId:string,id:string,assertCurrent:()=>void):Promise<OriginalCustodyArtifact|null>;
 describe(ownerId:string,id:string,assertCurrent:()=>void):Promise<OriginalCustodyReference|null>;
 create(ownerId:string,artifact:OriginalCustodyArtifact,assertCurrent:()=>void,reference:OriginalCustodyReference):Promise<void>;
 list(ownerId:string,assertCurrent:()=>void):Promise<string[]>;
}
function invalid():never{throw new Error('E2EE_INVALID_ORIGINAL_CUSTODY');}
function bytes32(value:Uint8Array){if(!(value instanceof Uint8Array)||value.length!==32)invalid();return new Uint8Array(value);}
function identity(input:OriginalSourceIdentity,keyId:string){
 exactKeys(input,['ownerId','scopeId','deviceId','generation','cryptoEpoch','securityEpoch']);
 for(const field of ['ownerId','scopeId','deviceId'] as const)assertTechnical(input[field]);
 for(const field of ['generation','cryptoEpoch','securityEpoch'] as const)if(!Number.isSafeInteger(input[field])||input[field]<1)invalid();
 assertTechnical(keyId);
 if(input.scopeId!==`device:${input.deviceId}`||keyId!==`local:${input.deviceId}`)invalid();
}
function pin(value:PublicDeviceKeys){exactKeys(value,['signingKey','receivingKey']);decodeE2eeBytes(value.signingKey,91);decodeE2eeBytes(value.receivingKey,65);}
function samePin(left:PublicDeviceKeys,right:PublicDeviceKeys){pin(left);pin(right);if(left.signingKey!==right.signingKey||left.receivingKey!==right.receivingKey)throw new Error('E2EE_AUTHORITY_CHANGED');}
async function digest(value:Uint8Array<ArrayBuffer>){return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',value)));}
async function rootDigest(root:Uint8Array<ArrayBuffer>){
 const prefix=encoder.encode('GENESIS-E2EE-ORIGINAL-ROOT\0v1\0'),bytes=new Uint8Array(prefix.length+root.length);bytes.set(prefix);bytes.set(root,prefix.length);
 try{return await digest(bytes);}finally{bytes.fill(0);}
}
export async function originalCustodyPrefix(ownerId:string){assertTechnical(ownerId);return `original-custody:${await digest(encoder.encode(ownerId))}:`;}
export async function validateOriginalCustodyId(ownerId:string,id:string){
 assertTechnical(id);const prefix=await originalCustodyPrefix(ownerId);if(!id.startsWith(prefix)||!uuid.test(id.slice(prefix.length)))invalid();return id;
}
function artifact(source:OriginalCustodyArtifact){
 const saved=snapshotE2eeValue(source);exactKeys(saved,['protocol','id','bundle']);
 if(saved.protocol!==1)invalid();exactKeys(saved.bundle,['protocol','ownerId','purpose','salt','nonce','ciphertext']);
 if(saved.bundle.protocol!==1||saved.bundle.purpose!==ORIGINAL_CUSTODY_PURPOSE)invalid();
 decodeE2eeBytes(saved.bundle.salt,32);decodeE2eeBytes(saved.bundle.nonce,12);decodeE2eeBytes(saved.bundle.ciphertext,16,65552);return saved;
}
export function captureOriginalCustodyReference(source:OriginalCustodyReference){
 const saved=snapshotE2eeValue(source);exactKeys(saved,['protocol','id','hash','original','keyId','signer','authority']);
 if(saved.protocol!==1)invalid();identity(saved.original,saved.keyId);pin(saved.authority);assertTechnical(saved.id);decodeE2eeBytes(saved.hash,32);decodeE2eeBytes(saved.signer,91);return saved;
}
async function artifactHash(value:OriginalCustodyArtifact){return digest(canonicalE2eeValue(value as unknown as WireValue));}
async function publicSigner(encoded:string){return crypto.subtle.importKey('spki',decodeE2eeBytes(encoded,91),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}
type SealOptions={original:OriginalSourceIdentity;keyId:string;signer:string;root:Uint8Array;primaryPin:PublicDeviceKeys;recoveryKit:RecoveryKit;secret:Uint8Array;assertCurrent:()=>void};
/** Component codec; product callers must persist/read back using the admitted
 * provider before treating this encrypted artifact as durable custody. */
export async function sealOriginalCustody(input:SealOptions){
 const current=input.assertCurrent,held=bytes32(input.secret);let clear:Uint8Array|undefined,root:Uint8Array<ArrayBuffer>|undefined;
 try{
  root=bytes32(input.root);
  const saved=snapshotE2eeValue({original:input.original,keyId:input.keyId,signer:input.signer,primaryPin:input.primaryPin,recoveryKit:input.recoveryKit});
  current();identity(saved.original,saved.keyId);samePin(saved.primaryPin,saved.recoveryKit.authority);await publicSigner(saved.signer);current();
  const authority=await recoverAuthority(saved.original.ownerId,held,saved.recoveryKit);current();
  const operationId=crypto.randomUUID(),id=await originalCustodyPrefix(saved.original.ownerId)+operationId;current();
  const payload={purpose:ORIGINAL_CUSTODY_PURPOSE,artifactId:id,original:saved.original,keyId:saved.keyId,signer:saved.signer,rootHash:await rootDigest(root),authority:saved.primaryPin};current();
  const certificate=await signE2eeCommand({protocol:1,ownerId:saved.original.ownerId,scopeId:saved.original.scopeId,deviceId:'recovery-authority',action:ORIGINAL_CUSTODY_PURPOSE,
   expectedRevision:0,checkpointHash:'genesis',securityEpoch:saved.original.securityEpoch,operationId,payload:payload as unknown as {[key:string]:WireValue}},authority.signing.privateKey);current();
  // Deliberately no old private device keys, session, ACL, billing or queue writer.
  clear=encoder.encode(JSON.stringify({protocol:1,root:encodeE2eeBytes(root),certificate}));
  const value=snapshotE2eeValue({protocol:1 as const,id,bundle:await protectBundle(saved.original.ownerId,ORIGINAL_CUSTODY_PURPOSE,held,clear)});current();
  const reference=snapshotE2eeValue({protocol:1 as const,id,hash:await artifactHash(value),original:saved.original,keyId:saved.keyId,signer:saved.signer,authority:saved.primaryPin});current();
  return Object.freeze({artifact:value,reference});
 }finally{held.fill(0);root?.fill(0);clear?.fill(0);}
}

type OpenOptions={ownerId:string;primaryPin:PublicDeviceKeys;recoveryKit:RecoveryKit;secret:Uint8Array;reference:OriginalCustodyReference;artifact:OriginalCustodyArtifact;
 records:Pick<E2eeRecordStorage,'get'|'list'>;assertCurrent:()=>void};
/** Independently pinned primary kit + separately entered secret authenticate
 * original coordinates/public signer/root. The recovered object has no keys,
 * root getter, raw domain reader, write, account session or enrollment method. */
export async function openOriginalCustody(input:OpenOptions){
 const held=bytes32(input.secret);
 let clear:Uint8Array|undefined,raw:Uint8Array<ArrayBuffer>|undefined;
 try{
  const check=input.assertCurrent,records=input.records;
  if(typeof check!=='function'||!records||typeof records.get!=='function'||typeof records.list!=='function')invalid();
  const get=records.get.bind(records),list=records.list.bind(records);
  const saved=snapshotE2eeValue({ownerId:input.ownerId,primaryPin:input.primaryPin,recoveryKit:input.recoveryKit}),reference=captureOriginalCustodyReference(input.reference),value=artifact(input.artifact);
  check();assertTechnical(saved.ownerId);samePin(saved.primaryPin,saved.recoveryKit.authority);samePin(saved.primaryPin,reference.authority);
  if(saved.ownerId!==reference.original.ownerId||value.id!==reference.id||value.bundle.ownerId!==saved.ownerId)invalid();
  await validateOriginalCustodyId(saved.ownerId,value.id);check();if(await artifactHash(value)!==reference.hash)invalid();check();
  const authority=await recoverAuthority(saved.ownerId,held,saved.recoveryKit);check();
  clear=await openBundle(saved.ownerId,ORIGINAL_CUSTODY_PURPOSE,held,value.bundle);check();
  const payload=JSON.parse(decoder.decode(clear));exactKeys(payload,['protocol','root','certificate']);if(payload.protocol!==1)invalid();raw=decodeE2eeBytes(payload.root,32);
  const certificate=await verifyE2eeCommand(payload.certificate as SignedE2eeCommand,authority.signing.publicKey);check();
  const expected={protocol:1,ownerId:saved.ownerId,scopeId:reference.original.scopeId,deviceId:'recovery-authority',action:ORIGINAL_CUSTODY_PURPOSE,expectedRevision:0,checkpointHash:'genesis',
   securityEpoch:reference.original.securityEpoch,operationId:value.id.slice(value.id.lastIndexOf(':')+1),payload:{purpose:ORIGINAL_CUSTODY_PURPOSE,artifactId:value.id,original:reference.original,
    keyId:reference.keyId,signer:reference.signer,rootHash:await rootDigest(raw),authority:saved.primaryPin}};check();
  const actual=canonicalE2eeValue(certificate as unknown as WireValue),wanted=canonicalE2eeValue(expected as unknown as WireValue);
  if(actual.length!==wanted.length||actual.some((byte,index)=>byte!==wanted[index]))invalid();
  const signer=await publicSigner(reference.signer),root=await importE2eeRoot(raw);check();
  return originalReader({get,list},reference,root,signer,check);
 }finally{held.fill(0);clear?.fill(0);raw?.fill(0);}
}
function originalReader(records:Pick<E2eeRecordStorage,'get'|'list'>,reference:OriginalCustodyReference,root:CryptoKey,signer:CryptoKey,check:()=>void){
 let closed=false;const roots=new Map([[reference.keyId,root]]),children=new Set<{close:()=>void}>();
 const current=()=>{if(closed)throw new Error('E2EE_ORIGINAL_SOURCE_CLOSED');check();};
 const close=()=>{closed=true;roots.clear();for(const child of children)child.close();children.clear();};
 const options={storage:records,original:reference.original,roots,signer,assertCurrent:current};
 const retain=<T extends {close:()=>void}>(handle:T)=>{try{current();children.add(handle);return handle;}catch(error){handle.close();throw error;}};
 return Object.freeze({reference,close,
  async openStage(target:SourceStageTarget,stage:SourceStageReference){current();return retain(await openOriginalSourceStage({...options,target,reference:stage}));},
  async openLegacy(target:SourceStageTarget,paths:readonly string[],legacy:LegacyMigrationSnapshotReference){current();return retain(await openOriginalLegacySnapshot({...options,target,paths,reference:legacy}));}
 });
}

export async function persistOriginalCustody(storage:OriginalCustodyStorage,ownerId:string,sealed:Awaited<ReturnType<typeof sealOriginalCustody>>,assertCurrent:()=>void){
 const value=artifact(sealed.artifact),reference=captureOriginalCustodyReference(sealed.reference),create=storage.create.bind(storage),get=storage.get.bind(storage),describe=storage.describe.bind(storage),current=assertCurrent;
 current();if(ownerId!==reference.original.ownerId||value.id!==reference.id||await artifactHash(value)!==reference.hash)invalid();current();
 await validateOriginalCustodyId(ownerId,value.id);current();await create(ownerId,value,current,reference);current();
 const stored=await get(ownerId,value.id,current);current();if(!stored||await artifactHash(artifact(stored))!==reference.hash)throw new Error('E2EE_ORIGINAL_CUSTODY_UNAVAILABLE');current();
 const metadata=await describe(ownerId,value.id,current);current();
 if(!metadata)throw new Error('E2EE_ORIGINAL_CUSTODY_UNAVAILABLE');
 const actual=canonicalE2eeValue(captureOriginalCustodyReference(metadata) as unknown as WireValue),expected=canonicalE2eeValue(reference as unknown as WireValue);
 if(actual.length!==expected.length||actual.some((byte,index)=>byte!==expected[index]))throw new Error('E2EE_ORIGINAL_CUSTODY_UNAVAILABLE');
 return reference;
}
export async function recoverOriginalCustody(input:Omit<OpenOptions,'artifact'>&{storage:Pick<OriginalCustodyStorage,'get'>}){
 const held=bytes32(input.secret);
 try{
  // Own every trust field and provider callback before the first storage await.
  const current=input.assertCurrent,reference=captureOriginalCustodyReference(input.reference),get=input.storage.get.bind(input.storage);
  const saved=snapshotE2eeValue({ownerId:input.ownerId,primaryPin:input.primaryPin,recoveryKit:input.recoveryKit});
  const records={get:input.records.get.bind(input.records),list:input.records.list.bind(input.records)};
  current();samePin(saved.primaryPin,saved.recoveryKit.authority);samePin(saved.primaryPin,reference.authority);if(saved.ownerId!==reference.original.ownerId)invalid();
  await validateOriginalCustodyId(saved.ownerId,reference.id);current();const value=await get(saved.ownerId,reference.id,current);current();
  if(!value)throw new Error('E2EE_ORIGINAL_CUSTODY_UNAVAILABLE');return await openOriginalCustody({...saved,secret:held,reference,artifact:value,records,assertCurrent:current});
 }finally{held.fill(0);}
}

/** Discoverable public metadata is durably stored OUTSIDE the lost original
 * root. It remains untrusted until the independently pinned owner certificate
 * is verified. No server-provided authority or remembered reference is needed. */
export async function recoverOriginalCustodyById(input:Omit<Parameters<typeof recoverOriginalCustody>[0],'reference'|'storage'>&{id:string;storage:Pick<OriginalCustodyStorage,'get'|'describe'>}){
 const held=bytes32(input.secret);
 try{
  const current=input.assertCurrent,saved=snapshotE2eeValue({ownerId:input.ownerId,primaryPin:input.primaryPin,recoveryKit:input.recoveryKit,id:input.id});
  const storage={get:input.storage.get.bind(input.storage),describe:input.storage.describe.bind(input.storage)};
  const records={get:input.records.get.bind(input.records),list:input.records.list.bind(input.records)};
  current();samePin(saved.primaryPin,saved.recoveryKit.authority);await validateOriginalCustodyId(saved.ownerId,saved.id);current();
  const metadata=await storage.describe(saved.ownerId,saved.id,current);current();if(!metadata)throw new Error('E2EE_ORIGINAL_CUSTODY_UNAVAILABLE');const reference=captureOriginalCustodyReference(metadata);
  if(reference.id!==saved.id)invalid();return await recoverOriginalCustody({...saved,secret:held,reference,storage,records,assertCurrent:current});
 }finally{held.fill(0);}
}
