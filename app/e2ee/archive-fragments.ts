import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {MigrationSourceContext} from './migration.ts';

type Row=Record<string,unknown>;
export const LEGACY_ARCHIVE_TABLES=['stages','safety','receipts'] as const;
type Table=typeof LEGACY_ARCHIVE_TABLES[number];
export type ArchiveFragmentPorts={assertCurrent:()=>void;
 readFragment:(context:MigrationSourceContext,table:Table,offset:number,byteOffset:number)=>Promise<unknown>};
type OldKey={keyMode:'account'|'client'|'empty';key:string|null};
const headerFields=['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision'];
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_ROW=64*1024*1024,MAX_TOTAL=128*1024*1024,MAX_CHUNK=1024*1024,MAX_WIRE=192*1024*1024;
function invalid():never{throw new Error('E2EE_ARCHIVE_TRANSPORT_INVALID');}
function integer(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>=Number.MAX_SAFE_INTEGER)invalid();}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function oldKey(value:unknown,opaque:boolean):OldKey{
 exactKeys(value,['keyMode','key']);if(!['account','client','empty'].includes(String(value.keyMode)))invalid();
 if(value.keyMode==='account'){
  if(opaque){if(value.key!==null)throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');}
  else{
   if(typeof value.key!=='string'||value.key.length!==44||!/^[A-Za-z0-9+/]{43}=$/.test(value.key))invalid();
   try{const raw=atob(value.key);if(raw.length!==32||btoa(raw)!==value.key)invalid();}catch{return invalid();}
  }
 }else if(value.key!==null)invalid();
 return{keyMode:value.keyMode as OldKey['keyMode'],key:value.key as string|null};
}

/** Transport integrity/completeness only. Call AFTER the complete protected
 * device capture. Nested archive formats, old keys, content-only import and
 * reconciliation still need the category adapter; this returns no activation,
 * restored authority or executable legacy request. Hashes stay in this old
 * source transport, never in new remote AAD/identifiers. */
export async function collectLegacyArchiveFragments(context:MigrationSourceContext,ports:ArchiveFragmentPorts,options:{opaqueKeys?:boolean}={}):Promise<Row>{
 context=Object.freeze({...context});assertTechnical(context.ownerId);assertTechnical(context.scopeId);assertTechnical(context.migrationId);
 integer(context.fence,1);integer(context.generation,1);decodeE2eeBytes(context.sourceHash,32).fill(0);
 let header:Row|undefined,totals:Row|undefined,key:OldKey={keyMode:'empty',key:null},wireBytes=0,sourceBytes=0,requests=0;
 const result:Row={};
 async function read(table:Table,offset:number,byteOffset:number){
  ports.assertCurrent();if(++requests>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const page=structuredClone(await ports.readFragment(context,table,offset,byteOffset));ports.assertCurrent();
  exactKeys(page,[...headerFields,'encoding','table','offset','byteOffset','totals','rowBytes','rowHash','chunk','nextByteOffset','nextOffset','legacyKey']);
  if(page.protocol!==1||page.ownerId!==context.ownerId||page.scopeId!==context.scopeId||page.migrationId!==context.migrationId||page.fence!==context.fence||page.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  integer(page.legacyGeneration);integer(page.directoryRevision,1);decodeE2eeBytes(page.checkpointHash,32).fill(0);
  if(page.legacyGeneration>=context.generation)throw new Error('E2EE_GENERATION_REVIEW_REQUIRED');
  if(page.encoding!=='utf8-json-fragments-v1'||page.table!==table||page.offset!==offset||page.byteOffset!==byteOffset)invalid();
  exactKeys(page.totals,LEGACY_ARCHIVE_TABLES);let count=0;
  for(const name of LEGACY_ARCHIVE_TABLES){integer(page.totals[name]);count+=page.totals[name] as number;if(count>1000000)throw new Error('E2EE_SOURCE_TOO_LARGE');}
  const identity=Object.fromEntries(headerFields.map(name=>[name,page[name]])),counts=page.totals;
  if(!header){header=identity;totals=structuredClone(counts);}
  else if(headerFields.some(name=>header![name]!==identity[name])||LEGACY_ARCHIVE_TABLES.some(name=>totals![name]!==counts[name]))invalid();
  const old=oldKey(page.legacyKey,options.opaqueKeys===true);
  if(old.keyMode!=='empty'){
   if(key.keyMode!=='empty'&&(key.keyMode!==old.keyMode||key.key!==old.key))invalid();key=old;
  }
  integer(page.rowBytes);if(page.rowBytes>MAX_ROW)throw new Error('E2EE_SOURCE_TOO_LARGE');
  if((table==='receipts'||page.rowBytes===0)?old.keyMode!=='empty':old.keyMode==='empty')invalid();
  if(typeof page.chunk!=='string')invalid();
  const bytes=encoder.encode(JSON.stringify(page));const size=bytes.length;bytes.fill(0);wireBytes+=size;
  if(size>2*1024*1024||wireBytes>MAX_WIRE)throw new Error('E2EE_SOURCE_TOO_LARGE');
  return page;
 }
 for(const table of LEGACY_ARCHIVE_TABLES){
  const rows:Row[]=[];let offset=0;
  for(;;){
   let page=await read(table,offset,0);const total=totals![table] as number,length=page.rowBytes as number;
   if(total===0){
    if(offset!==0||length!==0||page.rowHash!==null||page.chunk!==''||page.nextByteOffset!==null||page.nextOffset!==null||oldKey(page.legacyKey,options.opaqueKeys===true).keyMode!=='empty')invalid();break;
   }
   if(offset>=total||length<1)invalid();
   const rowHash=page.rowHash,expectedHash=decodeE2eeBytes(rowHash,32);let buffer:Uint8Array<ArrayBuffer>|undefined;
   try{
    sourceBytes+=length;if(sourceBytes>MAX_TOTAL)throw new Error('E2EE_SOURCE_TOO_LARGE');
    buffer=new Uint8Array(length);let position=0;
    for(;;){
     if(page.rowBytes!==length||page.rowHash!==rowHash)invalid();
     const part=decodeE2eeBytes(page.chunk,1,MAX_CHUNK);let next:number;
     try{
      next=position+part.length;
      if(next>length||page.nextByteOffset!==(next<length?next:null)||page.nextOffset!==(next<length?offset:offset+1<total?offset+1:null))invalid();
      buffer.set(part,position);
     }finally{part.fill(0);}
     position=next;
     if(position===length)break;
     page=await read(table,offset,position);
    }
    const actual=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer));
    try{ports.assertCurrent();let difference=0;for(let i=0;i<32;i++)difference|=actual[i]^expectedHash[i];if(difference)invalid();}finally{actual.fill(0);}
    let value:unknown;try{value=parseLegacyMigrationJson(decoder.decode(buffer),'E2EE_ARCHIVE_TRANSPORT_INVALID',MAX_ROW);}catch{return invalid();}
    object(value);rows.push(value);
   }finally{buffer?.fill(0);expectedHash.fill(0);}
   if(page.nextOffset===null){if(rows.length!==total)invalid();break;}offset++;
  }
  result[table]=rows;
 }
 ports.assertCurrent();return{...header,...result,legacyKey:key};
}

/** Kotlin retains the ORIGINAL row text until this common duplicate-name parser
 * sees it. The native capability must remove every old account key first. This
 * normalizes transport only, never a complete category or restore permission. */
export function normalizeNativeArchiveRows(value:unknown,context:MigrationSourceContext,assertCurrent:()=>void):Row{
 assertCurrent();exactKeys(value,[...headerFields,'encoding',...LEGACY_ARCHIVE_TABLES,'legacyKey']);
 assertTechnical(context.ownerId);assertTechnical(context.scopeId);assertTechnical(context.migrationId);
 integer(context.fence,1);integer(context.generation,1);decodeE2eeBytes(context.sourceHash,32).fill(0);
 if(value.protocol!==1||value.ownerId!==context.ownerId||value.scopeId!==context.scopeId||value.migrationId!==context.migrationId||value.fence!==context.fence||value.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 integer(value.legacyGeneration);integer(value.directoryRevision,1);decodeE2eeBytes(value.checkpointHash,32).fill(0);
 if(value.legacyGeneration>=context.generation)throw new Error('E2EE_GENERATION_REVIEW_REQUIRED');
 if(value.encoding!=='utf8-json-rows-v1')invalid();
 const key=oldKey(value.legacyKey,true),result:Row=Object.fromEntries(headerFields.map(name=>[name,value[name]]));let bytes=0,rows=0;
 for(const table of LEGACY_ARCHIVE_TABLES){
  const raw=value[table];if(!Array.isArray(raw))invalid();rows+=raw.length;if(rows>1000000)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const parsed:Row[]=[];
  for(const text of raw){
   assertCurrent();if(typeof text!=='string'||text.length<1||text.length>MAX_ROW)invalid();
   const encoded=encoder.encode(text),size=encoded.length;encoded.fill(0);bytes+=size;
   if(size>MAX_ROW||bytes>MAX_TOTAL)throw new Error('E2EE_SOURCE_TOO_LARGE');
   const row=parseLegacyMigrationJson(text,'E2EE_ARCHIVE_TRANSPORT_INVALID',MAX_ROW);object(row);parsed.push(row);
  }
  result[table]=parsed;
 }
 const needsKey=(result.stages as Row[]).length+(result.safety as Row[]).length>0;
 if(needsKey?key.keyMode==='empty':key.keyMode!=='empty')invalid();
 assertCurrent();return{...result,legacyKey:key};
}
