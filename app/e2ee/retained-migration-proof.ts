import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,e2eeCommandHash,verifyE2eeCommand,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {E2EE_SUITE,decodeE2eeBytes,encodeE2eeBytes,openE2eeEnvelope,validateE2eeEnvelope,type E2eeContext} from './envelope.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES,envelopePayloadHash,objectManifestHash,openE2eeFileStream} from './files.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {signingPublicKey,type VerifiedDirectory,type VerifiedDevice} from './directory.ts';
import {validateMigrationLocalEntries} from './migration-local.ts';
import {requiredPrivatePaths} from './private-paths.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {SourceStageReadVault,SourceStageTarget} from './source-stage.ts';
import type {MigrationState} from './migration.ts';

export type RetainedMigrationFrame=Readonly<Pick<VerifiedDirectory,'ownerId'|'scopeId'|'resourceId'|'kind'|'cryptoEpoch'|'securityEpoch'|'keyId'|'checkpoint'>&{own:VerifiedDevice|null}>;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function invalid():never{throw new Error('E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED');}
function equal(a:unknown,b:unknown){const left=canonicalE2eeValue(a as WireValue),right=canonicalE2eeValue(b as WireValue);try{return left.length===right.length&&left.every((byte,at)=>byte===right[at]);}finally{left.fill(0);right.fill(0);}}
function positive(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<1)invalid();}

/** Authenticate the ACTION as well as its signature. These packets are retained
 * evidence only: this reader has no transport, signer or replay capability. */
export async function authenticateRetainedMigrationControls(state:MigrationState,frame:RetainedMigrationFrame,deviceId:string,current:()=>void){
 const own=frame.own;if(!own||own.revoked||own.deviceId!==deviceId||own.role!=='owner')invalid();
 const signer=await signingPublicKey(own.signingKey);current();
 if(state.sourceHash!==null)decodeE2eeBytes(state.sourceHash,32);
 if(state.lease){exactKeys(state.lease,['fence','leaseUntil','generation']);Object.values(state.lease).forEach(positive);if(!state.sourceHash)invalid();}
 const entries:readonly[string,SignedE2eeCommand|null][]=[['pending',state.pending],['resuming',state.resuming],['cancelReceipt',state.protocol===4?state.cancelReceipt?.packet??null:null]];
 for(const[name,packet]of entries){
  if(!packet)continue;const command=await verifyE2eeCommand(packet,signer);current();
  if(command.ownerId!==frame.ownerId||command.scopeId!==frame.scopeId||command.deviceId!==deviceId
   ||command.expectedRevision!==frame.checkpoint.revision||command.checkpointHash!==frame.checkpoint.hash||command.securityEpoch!==frame.securityEpoch
   ||command.payload.migrationId!==state.migrationId)invalid();
  const payload=command.payload;
  if(name==='resuming'){
   exactKeys(payload,['migrationId','fence','sourceHash','pendingOperationId','pendingHash']);
   if(command.action!=='migration-resume'||!state.lease||payload.fence!==state.lease.fence||payload.sourceHash!==state.sourceHash
    ||payload.pendingOperationId!==(state.pending?.command.operationId??null)||payload.pendingHash!==(state.pending?await e2eeCommandHash(state.pending.command):null))invalid();current();
  }else if(command.action==='migration-cancel'){
   exactKeys(payload,['migrationId','fence']);
   if(!state.lease||!Number.isSafeInteger(payload.fence)||(payload.fence as number)>state.lease.fence
    ||(payload.fence as number)<state.lease.fence-(name==='cancelReceipt'?1:0))invalid();
  }else if(name==='cancelReceipt')invalid();
  else if(command.action==='migration-start'){
   exactKeys(payload,['migrationId','sourceHash']);if(state.lease||payload.sourceHash!==state.sourceHash)invalid();
  }else if(command.action==='put'){
   exactKeys(payload,['envelope','expectedObjectRevision','migrationId','fence']);
   const envelope=validateE2eeEnvelope(payload.envelope),item=state.plan[state.uploaded];
   if(!state.lease||payload.fence!==state.lease.fence||payload.expectedObjectRevision!==0||!item||envelope.context.operationId!==command.operationId
    ||envelope.context.ownerId!==frame.ownerId||envelope.context.scopeId!==frame.scopeId||envelope.context.deviceId!==deviceId
    ||envelope.context.domain!==item.domain||envelope.context.objectId!==item.objectId||await envelopePayloadHash(envelope)!==item.hash)invalid();current();
  }else if(command.action==='migration-verify'||command.action==='migration-commit'){
   exactKeys(payload,['migrationId','fence','manifestHash','objectCount','verifiedCheckpoint',...(command.action==='migration-commit'?['generation']:[])]);
   if(!state.lease||payload.fence!==state.lease.fence||payload.manifestHash!==state.manifestHash||payload.objectCount!==state.plan.length
    ||!state.verifiedCheckpoint||payload.verifiedCheckpoint!==state.verifiedCheckpoint||command.action==='migration-commit'&&payload.generation!==state.lease.generation)invalid();
  }else invalid();
  if(state.protocol===4&&name==='pending'&&!['migration-start','migration-cancel'].includes(command.action))invalid();
 }
 if(!state.lease&&(state.resuming||state.sourceHash!==null&&!state.pending)||['active','cancelled'].includes(state.phase)&&(state.pending||state.resuming))invalid();
 if(state.protocol===4&&state.cancelReceipt){exactKeys(state.cancelReceipt.result,['state']);if(state.phase!=='cancelled'||state.cancelReceipt.result.state!=='preparing')invalid();}
 return signer;
}

/** Full v1/v2 plan custody, including every inner file signature, byte hash and
 * local-only part. Old plans are never discarded because their source snapshot
 * happens to be readable, nor promoted to a new-generation executable intent. */
export async function inspectRetainedLegacyPlan(options:{vault:SourceStageReadVault;target:SourceStageTarget;state:Extract<MigrationState,{protocol:1|2}>;
 frame:RetainedMigrationFrame;root:CryptoKey;assertCurrent:()=>void}){
 const {vault,target,state,frame,root,assertCurrent:current}=options;current();
 const own=frame.own;if(!own)invalid();const signer=await signingPublicKey(own.signingKey);current();
 const allowed=[...new Set(requiredPrivatePaths(target.kind).flatMap(path=>path.domains))] as E2eeContext['domain'][];
 const local=state.protocol===1?[]:validateMigrationLocalEntries(state.local,state.migrationId,allowed);
 const planned=state.protocol===1?state.plan.length>0:state.planned;
 if(!Array.isArray(state.logical)||state.logical.length>10000||state.plan.length>8000||!planned&&(state.plan.length||state.logical.length||local.length)
  ||planned&&!state.lease||state.logical.length+local.length>10000)invalid();
 const records=new Map<string,typeof state.plan[number]>(),names=new Set<string>(),used=new Set<string>();
 for(const[index,item]of state.plan.entries()){
  exactKeys(item,['recordId','domain','objectId','hash']);assertTechnical(item.objectId);decodeE2eeBytes(item.hash,32);
  if(item.recordId!==`${state.migrationId}:upload:${index}`||!allowed.includes(item.domain as E2eeContext['domain']))invalid();
  const coordinate=item.domain+'\0'+item.objectId;if(records.has(coordinate))invalid();records.set(coordinate,item);
 }
 const envelope=async(item:typeof state.plan[number])=>{
  current();const row=await vault.read('outbox',item.recordId);if(!row)invalid();
  try{
   current();if(row.serial!==1||row.value.length>4*1024*1024)invalid();
   const value=validateE2eeEnvelope(parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED',4*1024*1024)),context=value.context;
   if(context.cryptoProtocol!==1||context.suite!==E2EE_SUITE||context.ownerId!==target.ownerId||context.scopeId!==target.scopeId||context.deviceId!==own.deviceId
    ||context.domain!==item.domain||context.objectId!==item.objectId||context.schemaVersion!==1||context.dataGeneration!==state.lease?.generation
    ||context.writerProtocol!==9||context.cryptoEpoch!==frame.cryptoEpoch||context.securityEpoch!==frame.securityEpoch||context.keyId!==frame.keyId||context.revision!==1
    ||await envelopePayloadHash(value)!==item.hash)invalid();current();return value;
  }finally{row.value.fill(0);}
 };
 for(const logical of state.logical){
  exactKeys(logical,['domain','objectId','plaintextHash','size']);assertTechnical(logical.objectId);decodeE2eeBytes(logical.plaintextHash,32);
  const coordinate=logical.domain+'\0'+logical.objectId,item=records.get(coordinate);
  if(!allowed.includes(logical.domain)||!Number.isSafeInteger(logical.size)||logical.size<0||logical.size>E2EE_MAX_FILE_BYTES
   ||logical.domain==='shared-comment'&&logical.size>65536||!item||names.has(coordinate))invalid();names.add(coordinate);
  const manifest=await envelope(item),digest=sha256.create();let size=0;
  try{
   if(logical.domain==='shared-comment'){
    const bytes=await openE2eeEnvelope(root,signer,manifest.context,manifest);try{current();digest.update(bytes);size=bytes.length;}finally{bytes.fill(0);}
   }else await openE2eeFileStream({root,signer,expectedContext:manifest.context,manifestEnvelope:manifest,assertCurrent:current,
    fetchChunk:async objectId=>{const chunk=records.get('attachment\0'+objectId);if(!chunk||used.has(chunk.recordId))invalid();used.add(chunk.recordId);return envelope(chunk);},
    writeQuarantinedPlaintext:async bytes=>{current();digest.update(bytes);size+=bytes.length;}});
   const result=digest.digest();try{if(size!==logical.size||encodeE2eeBytes(result)!==logical.plaintextHash||used.has(item.recordId))invalid();used.add(item.recordId);}finally{result.fill(0);}
  }finally{digest.destroy();}
 }
 if(used.size!==state.plan.length)invalid();
 const exact=async(domain:E2eeContext['domain'],prefix:string,expected:string[])=>{const actual=(await vault.listLocal(domain,prefix)).sort();current();if(!equal(actual,[...expected].sort()))invalid();};
 await exact('outbox',state.migrationId+':',state.plan.map(item=>item.recordId));
 await exact('local-snapshot',state.migrationId+':private:',local.flatMap(item=>Array.from({length:item.parts},(_,at)=>`${item.recordId}:${at}`)));
 for(const item of local){
  const coordinate=item.domain+'\0'+item.objectId;if(names.has(coordinate))invalid();names.add(coordinate);
  const digest=sha256.create();let size=0;
  try{
   for(let at=0;at<item.parts;at++){
    current();const row=await vault.read('local-snapshot',`${item.recordId}:${at}`);if(!row)invalid();
    try{current();if(row.serial!==1||row.value.length!==Math.min(E2EE_CHUNK_BYTES,item.size-size))invalid();size+=row.value.length;digest.update(row.value);}finally{row.value.fill(0);}
   }
   const result=digest.digest();try{if(size!==item.size||encodeE2eeBytes(result)!==item.plaintextHash)invalid();}finally{result.fill(0);}
  }finally{digest.destroy();}
 }
 if(state.manifestHash!==null){
  decodeE2eeBytes(state.manifestHash,32);if(await objectManifestHash(state.plan.map(item=>({domain:item.domain,objectId:item.objectId,revision:1,payloadHash:item.hash})))!==state.manifestHash)invalid();current();
 }
 if(state.verifiedCheckpoint!==null)decodeE2eeBytes(state.verifiedCheckpoint,32);
 return Object.freeze({remote:state.plan.length,local:local.reduce((total,item)=>total+item.parts,0),logical:state.logical.length});
}
