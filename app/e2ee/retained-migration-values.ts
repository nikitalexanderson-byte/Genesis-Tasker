import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {encodeE2eeBytes,openE2eeEnvelope,validateE2eeEnvelope,type E2eeContext} from './envelope.ts';
import {E2EE_CHUNK_BYTES,envelopePayloadHash,openE2eeFileStream} from './files.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {MigrationLocalEntry} from './migration-local.ts';
import type {SourceStageReadVault,SourceStageTarget} from './source-stage.ts';

type Scope=SourceStageTarget&{resourceId:string};
type Planned={recordId:string;domain:string;objectId:string;hash:string};
type Logical={domain:E2eeContext['domain'];objectId:string;size:number;plaintextHash:string;filename?:string;mediaType?:string};
export type RetainedMigrationValue=Readonly<{id:string;scope:Readonly<Scope>;migrationId:string;attemptId:string;placement:'local'|'remote';domain:E2eeContext['domain'];objectId:string;size:number;sha256:string}>;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function invalid():never{throw new Error('E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED');}
function equal(a:unknown,b:unknown){const left=canonicalE2eeValue(a as WireValue),right=canonicalE2eeValue(b as WireValue);try{return left.length===right.length&&left.every((byte,at)=>byte===right[at]);}finally{left.fill(0);right.fill(0);}}

/** Only already authenticated user values enter this memory-only collection.
 * Sources, controls, enrollments, directory pins, capsules and HTTP originals
 * are deliberately absent. Stream callbacks receive quarantined bytes: publish
 * them only after read() and its enclosing catalogue guard both succeed. */
export function retainedMigrationValueCollector(vault:SourceStageReadVault,current:()=>void){
 const entries=new Map<string,{descriptor:RetainedMigrationValue;read:(write:(bytes:Uint8Array)=>Promise<void>)=>Promise<{filename:string;mediaType:string}>}>();
 let closed=false,reading=false;const check=()=>{current();vault.assertUnlocked();if(closed)throw new Error('E2EE_MIGRATION_HISTORY_CLOSED');};
 const add=(options:{scope:Scope;migrationId:string;attemptId:string;root:CryptoKey;signer:CryptoKey;plan:readonly Planned[];logical:readonly Logical[];local:readonly MigrationLocalEntry[]})=>{
  check();const scope=Object.freeze({...options.scope}),plan=structuredClone(options.plan),byCoordinate=new Map(plan.map(item=>[item.domain+'\0'+item.objectId,item]));
  const load=async(item:Planned)=>{
   check();const row=await vault.read('outbox',item.recordId);if(!row)invalid();
   try{check();if(row.serial!==1||row.value.length>4*1024*1024)invalid();const envelope=validateE2eeEnvelope(parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED',4*1024*1024));
    if(envelope.context.ownerId!==scope.ownerId||envelope.context.scopeId!==scope.scopeId||envelope.context.domain!==item.domain||envelope.context.objectId!==item.objectId||await envelopePayloadHash(envelope)!==item.hash)invalid();check();return envelope;
   }finally{row.value.fill(0);}
  };
  const register=(placement:'local'|'remote',logical:Logical,open:(write:(bytes:Uint8Array)=>Promise<void>)=>Promise<{filename:string;mediaType:string}>)=>{
   const coordinate=canonicalE2eeValue([scope.scopeId,options.migrationId,options.attemptId,placement,logical.domain,logical.objectId]);
   let id:string;try{id='retained:'+encodeE2eeBytes(sha256(coordinate));}finally{coordinate.fill(0);}
   const descriptor=Object.freeze({id,scope,migrationId:options.migrationId,attemptId:options.attemptId,placement,domain:logical.domain,objectId:logical.objectId,size:logical.size,sha256:logical.plaintextHash});
   const old=entries.get(id);if(old){if(!equal(old.descriptor,descriptor))invalid();return;}
   entries.set(id,{descriptor,read:async write=>{
    const hash=sha256.create();let size=0;
    try{
     const metadata=await open(async bytes=>{check();size+=bytes.length;if(size>logical.size)invalid();hash.update(bytes);await write(bytes);check();});check();
     const digest=hash.digest();try{if(size!==logical.size||encodeE2eeBytes(digest)!==logical.plaintextHash)invalid();}finally{digest.fill(0);}
     return metadata;
    }finally{hash.destroy();}
   }});
  };
  for(const item of structuredClone(options.logical)){
   const manifest=byCoordinate.get(item.domain+'\0'+item.objectId);if(!manifest)invalid();
   register('remote',item,async write=>{
    const envelope=await load(manifest);check();
    if(item.domain==='shared-comment'){
     const bytes=await openE2eeEnvelope(options.root,options.signer,envelope.context,envelope);try{check();await write(bytes);check();return{filename:'',mediaType:'application/json'};}finally{bytes.fill(0);}
    }
    const opened=await openE2eeFileStream({root:options.root,signer:options.signer,expectedContext:envelope.context,manifestEnvelope:envelope,assertCurrent:check,
     fetchChunk:async objectId=>{const chunk=byCoordinate.get('attachment\0'+objectId);if(!chunk)invalid();return load(chunk);},writeQuarantinedPlaintext:write});check();
    if(opened.size!==item.size||item.filename!==undefined&&opened.filename!==item.filename||item.mediaType!==undefined&&opened.mediaType!==item.mediaType)invalid();return{filename:opened.filename,mediaType:opened.mediaType};
   });
  }
  for(const item of structuredClone(options.local))register('local',item,async write=>{
   let size=0;for(let at=0;at<item.parts;at++){
    check();const row=await vault.read('local-snapshot',`${item.recordId}:${at}`);if(!row)invalid();
    try{check();if(row.serial!==1||row.value.length!==Math.min(E2EE_CHUNK_BYTES,item.size-size))invalid();size+=row.value.length;await write(row.value);check();}finally{row.value.fill(0);}
   }
   if(size!==item.size)invalid();return{filename:item.filename,mediaType:item.mediaType};
  });
 };
 return Object.freeze({add,list(){check();return Object.freeze([...entries.values()].map(row=>row.descriptor));},async read(id:string,write:(bytes:Uint8Array)=>Promise<void>){
  check();if(reading)throw new Error('E2EE_SOURCE_INPUT_BUSY');const entry=entries.get(id);if(!entry)invalid();reading=true;try{return await entry.read(write);}finally{reading=false;}
 },close(){closed=true;entries.clear();}});
}
