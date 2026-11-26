import {sha256} from '@noble/hashes/sha2.js';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES} from './files.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {requiredPrivatePaths} from './private-paths.ts';
import type {SourceStageReadVault,SourceStageTarget} from './source-stage.ts';

export type LegacyMigrationSnapshotReference=Readonly<{migrationId:string;snapshotSize:number;snapshotParts:number;snapshotHash:string}>;
/** Shared bounded preflight for original-actor capabilities before allocating
 * an allowed-ID set or doing any original storage lookup. */
export function captureLegacyMigrationSnapshotReference(value:unknown):LegacyMigrationSnapshotReference{
 exactKeys(value,['migrationId','snapshotSize','snapshotParts','snapshotHash']);const reference={...value} as unknown as LegacyMigrationSnapshotReference;
 assertTechnical(reference.migrationId);decodeE2eeBytes(reference.snapshotHash,32);
 if(!Number.isSafeInteger(reference.snapshotSize)||reference.snapshotSize<1||reference.snapshotSize>E2EE_MAX_FILE_BYTES
  ||reference.snapshotParts!==Math.ceil(reference.snapshotSize/E2EE_CHUNK_BYTES))invalid();
 return Object.freeze(reference);
}
type Options={vault:SourceStageReadVault;target:SourceStageTarget;paths:readonly string[];reference:LegacyMigrationSnapshotReference;assertCurrent:()=>void};
type Path={id:string;size:number};
type Captured={read:SourceStageReadVault['read'];list:SourceStageReadVault['listLocal'];current:()=>void;watch:(close:()=>void)=>()=>void;target:SourceStageTarget;paths:readonly string[];reference:LegacyMigrationSnapshotReference};
function invalid():never{throw new Error('E2EE_CORRUPT_LEGACY_SNAPSHOT');}
function ended():never{throw new Error('E2EE_LEGACY_SNAPSHOT_CLOSED');}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const values=Int16Array.from({length:128},(_,code)=>alphabet.indexOf(String.fromCharCode(code)));
const whitespace=(code:number)=>code===32||code===9||code===10||code===13;
async function inventory(options:Captured){
 options.current();const prefix=`${options.reference.migrationId}:source:`,actual=await options.list('local-snapshot',prefix);options.current();
 const expected=new Set(Array.from({length:options.reference.snapshotParts},(_,index)=>prefix+index));
 if(actual.length!==expected.size||actual.some(id=>!expected.has(id)))invalid();
}
/** Only one protected source part and one decoded output buffer. The original
 * raw byte hash is never replaced by a reserialized JSON/manifest digest. */
class Cursor {
 #options:Captured;#buffer=new Uint8Array(0);#at=0;#part=0;#hash=sha256.create();#done=false;#closed=false;
 constructor(options:Captured){this.#options=options;}
 async #fill(){
  this.#options.current();if(this.#closed)ended();if(this.#at<this.#buffer.length)return true;this.#buffer.fill(0);this.#buffer=new Uint8Array(0);this.#at=0;
  const reference=this.#options.reference;if(this.#part>=reference.snapshotParts)return false;
  const row=await this.#options.read('local-snapshot',`${reference.migrationId}:source:${this.#part}`);
  if(!row)invalid();this.#buffer=row.value;this.#options.current();
  if(row.serial!==1||row.value.length!==Math.min(E2EE_CHUNK_BYTES,reference.snapshotSize-this.#part*E2EE_CHUNK_BYTES))invalid();
  this.#hash.update(row.value);this.#part++;return true;
 }
 async peek(){return await this.#fill()?this.#buffer[this.#at]:-1;}
 async take(){if(!await this.#fill())invalid();return this.#buffer[this.#at++];}
 async spaces(){while(await this.#fill()){while(this.#at<this.#buffer.length&&whitespace(this.#buffer[this.#at]))this.#at++;if(this.#at<this.#buffer.length)return;}}
 async expect(code:number){await this.spaces();if(await this.take()!==code)invalid();}
 async #escape(){
  const code=await this.take(),simple=new Map([[34,34],[92,92],[47,47],[98,8],[102,12],[110,10],[114,13],[116,9]]);
  if(simple.has(code))return simple.get(code)!;if(code!==117)invalid();let value=0;
  for(let index=0;index<4;index++){const digit=await this.take(),hex=digit>=48&&digit<=57?digit-48:digit>=65&&digit<=70?digit-55:digit>=97&&digit<=102?digit-87:-1;if(hex<0)invalid();value=value*16+hex;}
  return value;
 }
 async string(){
  await this.expect(34);let value='';
  for(let index=0;index<4096;index++){
   let code=await this.take();if(code===34)return value;if(code===92)code=await this.#escape();else if(code<32||code>127)invalid();
   value+=String.fromCharCode(code);if(value.length>128)invalid();
  }
  return invalid();
 }
 async one(){
  await this.spaces();let raw='';while(true){const code=await this.peek();if(code<0||whitespace(code)||code===44||code===125)break;
   if(raw.length>=64||code>127)invalid();raw+=String.fromCharCode(await this.take());}
  if(!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)||Number(raw)!==1)invalid();
 }
 async *binary(emit:boolean):AsyncGenerator<Uint8Array,number>{
  await this.expect(34);let output=emit?new Uint8Array(E2EE_CHUNK_BYTES):new Uint8Array(0),written=0,size=0,bits=0,value=0,chars=0,finished=false;
  try{
   while(!finished){
    if(!await this.#fill())invalid();
    while(this.#at<this.#buffer.length){
     let code=this.#buffer[this.#at++];if(code===34){finished=true;break;}if(code===92)code=await this.#escape();
     if(code<0||code>=values.length||values[code]<0)invalid();chars++;value=(value<<6|values[code])&0xffffff;bits+=6;
     if(bits>=8){bits-=8;const byte=value>>>bits&255;if(++size>E2EE_MAX_FILE_BYTES)invalid();
      if(emit){output[written++]=byte;if(written===output.length){try{yield output;this.#options.current();}finally{output.fill(0);}output=new Uint8Array(E2EE_CHUNK_BYTES);written=0;}}
     }
    }
   }
   if(!chars||chars%4===1||bits&&value&((1<<bits)-1))invalid();
   if(emit&&written){try{yield output.subarray(0,written);this.#options.current();}finally{output.fill(0);}}
   return size;
  }finally{output.fill(0);}
 }
 async finish(){
  await this.spaces();if(await this.peek()!==-1||this.#part!==this.#options.reference.snapshotParts||this.#done)invalid();
  const bytes=this.#hash.digest();this.#done=true;try{if(encodeE2eeBytes(bytes)!==this.#options.reference.snapshotHash)invalid();}finally{bytes.fill(0);}
  await inventory(this.#options);this.#options.current();
 }
 close(){this.#buffer.fill(0);if(this.#closed)return;this.#closed=true;this.#hash.destroy();}
}
async function* pathRows(cursor:Cursor,options:Captured,selected:number|undefined):AsyncGenerator<Uint8Array,Path[]>{
 await cursor.expect(91);const rows:Path[]=[],seen=new Set<string>();
 while(true){
  if(rows.length>=options.paths.length)invalid();await cursor.expect(123);let id:string|undefined,size:number|undefined;const fields=new Set<string>();
  while(true){const name=await cursor.string();if(!['id','bytes'].includes(name)||fields.has(name))invalid();fields.add(name);await cursor.expect(58);
   if(name==='id'){id=await cursor.string();assertTechnical(id);}else size=yield*cursor.binary(rows.length===selected);
   await cursor.spaces();const separator=await cursor.take();if(separator===125)break;if(separator!==44)invalid();
  }
  if(fields.size!==2||id===undefined||size===undefined||size<1||!options.paths.includes(id)||seen.has(id))invalid();seen.add(id);rows.push({id,size});
  await cursor.spaces();const separator=await cursor.take();if(separator===93)break;if(separator!==44)invalid();
 }
 if(rows.length!==options.paths.length)invalid();return rows;
}
async function* scan(options:Captured,selected?:number):AsyncGenerator<Uint8Array,Path[]>{
 const cursor=new Cursor(options),unwatch=options.watch(()=>cursor.close());
 try{
  await inventory(options);
  // The old web UTF8 decoder accepted a leading BOM. Preserve its raw bytes
  // in the original digest; a BOM anywhere else is invalid technical JSON.
  if(await cursor.peek()===239){for(const expected of [239,187,191])if(await cursor.take()!==expected)invalid();}
  await cursor.expect(123);const fields=new Set<string>();let rows:Path[]|undefined,owner:string|undefined,scope:string|undefined;
  while(true){const name=await cursor.string();if(!['protocol','ownerId','scopeId','paths'].includes(name)||fields.has(name))invalid();fields.add(name);await cursor.expect(58);
   if(name==='protocol')await cursor.one();else if(name==='ownerId')owner=await cursor.string();else if(name==='scopeId')scope=await cursor.string();else rows=yield*pathRows(cursor,options,selected);
   await cursor.spaces();const separator=await cursor.take();if(separator===125)break;if(separator!==44)invalid();
  }
  if(fields.size!==4||!rows||owner!==options.target.ownerId||scope!==options.target.scopeId)invalid();await cursor.finish();return rows;
 }finally{cursor.close();unwatch();}
}

/** Reads old states1/2 technical path wrappers, never staged state3. Callers
 * must obtain the reference/reader from authenticated coordinator history or
 * read-only custody. This API discovers no omitted attempt and grants no
 * restoration/lease/signing authority. Each path rescans the bounded original
 * to prove its exact raw hash/EOF; partial output is inert until assertComplete. */
export async function openLegacyMigrationSnapshot(input:Options){
 const reference=captureLegacyMigrationSnapshotReference(input.reference),target={...input.target},paths=[...input.paths];
 exactKeys(target,['ownerId','scopeId','kind']);assertTechnical(target.ownerId);assertTechnical(target.scopeId);
 if(!['personal','project','space'].includes(target.kind))invalid();
 const required=requiredPrivatePaths(target.kind).map(row=>row.id);if(paths.length!==required.length||paths.some((path,index)=>path!==required[index]))throw new Error('E2EE_SOURCE_ADAPTER_REQUIRED');
 const guard=input.assertCurrent,unlocked=input.vault.assertUnlocked.bind(input.vault),read=input.vault.read.bind(input.vault),list=input.vault.listLocal.bind(input.vault);
 let closed=false,active:{revoked:boolean;borrowed?:Uint8Array}|undefined;const cursors=new Set<()=>void>();
 const current=()=>{if(closed)ended();guard();unlocked();};current();const options:Captured={read,list,current,target,paths,reference,watch(close){cursors.add(close);return()=>{cursors.delete(close);};}};
 const preflight=scan(options);let rows:Path[];
 try{for(;;){const next=await preflight.next();current();if(next.done){rows=next.value;break;}next.value.fill(0);invalid();}}
 finally{await preflight.return([]);}
 const closeCursors=()=>{for(const close of cursors)close();};
 const close=()=>{closed=true;active?.borrowed?.fill(0);closeCursors();};
 return Object.freeze({paths:Object.freeze(paths),reference:Object.freeze(reference),close,openPath(id:string){
  current();const index=rows.findIndex(row=>row.id===id);if(index<0)throw new Error('E2EE_LEGACY_SNAPSHOT_PATH');if(active)throw new Error('E2EE_LEGACY_SNAPSHOT_BUSY');
  const token:{revoked:boolean;borrowed?:Uint8Array}={revoked:false};active=token;let complete=false,reading=false;
  const live=()=>{current();if(token.revoked)ended();},release=()=>{token.borrowed?.fill(0);token.borrowed=undefined;if(active===token)active=undefined;};
  const owned=new Set<()=>void>(),closeOwned=()=>{for(const close of owned)close();};
  const pathOptions:Captured={...options,current:live,watch(close){const unwatch=options.watch(close);owned.add(close);return()=>{owned.delete(close);unwatch();};}};
  const core=(async function*(){try{
   live();for await(const bytes of scan(pathOptions,index)){live();token.borrowed=bytes;try{yield bytes;live();}finally{bytes.fill(0);token.borrowed=undefined;}}
   live();complete=true;
  }finally{release();}})();
  const chunks:AsyncIterableIterator<Uint8Array>={async next(){
   if(reading){token.revoked=true;token.borrowed?.fill(0);closeOwned();throw new Error('E2EE_LEGACY_SNAPSHOT_BUSY');}reading=true;try{live();return await core.next();}finally{reading=false;}
  },async return(){token.revoked=true;closeOwned();try{return await core.return(undefined);}finally{release();}},[Symbol.asyncIterator](){return this;}};
  return Object.freeze({chunks,assertComplete(){live();if(!complete)throw new Error('E2EE_SOURCE_STAGE_EOF_REQUIRED');}});
 }});
}
