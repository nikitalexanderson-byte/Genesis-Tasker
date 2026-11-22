import {exactKeys,assertTechnical} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {privatePathSource} from './private-path-source.ts';
import type {PrivateScopeKind} from './private-paths.ts';
import type {MigrationSourceContext} from './migration.ts';

export type PrivatePathSourceRow={original:Record<string,unknown>;content:Record<string,unknown>;execution:'history-only'};
export type PrivatePathRemote={protocol:1;ownerId:string;scopeId:string;kind:PrivateScopeKind;resourceId:string;pathId:string;
 tables:Readonly<Record<string,readonly PrivatePathSourceRow[]>>};
const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder(),MAX=64*1024*1024;
function invalid():never{throw new Error('E2EE_PRIVATE_PATH_TRANSPORT_INVALID');}
function integer(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<0||(value as number)>=Number.MAX_SAFE_INTEGER)invalid();}
function row(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}

/** Exact table inventory, byte offsets, totals, EOF and complete-row hashes.
 * One response is at most1MiB of original row; no page length implies EOF. */
export async function collectPrivatePathFragments(context:MigrationSourceContext,target:{kind:PrivateScopeKind;resourceId:string;pathId:string},ports:{assertCurrent:()=>void;
 read:(context:MigrationSourceContext,pathId:string,table:string,offset:number,byteOffset:number)=>Promise<unknown>;
 readBatch?:(context:MigrationSourceContext,pathId:string,table:string,offset:number,byteOffset:number)=>Promise<unknown>}):Promise<PrivatePathRemote>{
 const scope=Object.freeze({...target}),lease=Object.freeze({...context}),schema=privatePathSource(scope.kind,scope.pathId),tables:Record<string,PrivatePathSourceRow[]>={};
 assertTechnical(scope.resourceId);assertTechnical(lease.ownerId);assertTechnical(lease.scopeId);assertTechnical(lease.migrationId);integer(lease.fence);decodeE2eeBytes(lease.sourceHash,32).fill(0);
 let totals:Record<string,unknown>|undefined,checkpoint:string|undefined,revision:number|undefined,requests=0,size=0,wire=0;
 let buffered:unknown[]=[];
 const read=async(table:string,offset:number,byteOffset:number)=>{ports.assertCurrent();if(!ports.readBatch)return ports.read(lease,scope.pathId,table,offset,byteOffset);
  if(!buffered.length){const value=structuredClone(await ports.readBatch(lease,scope.pathId,table,offset,byteOffset));ports.assertCurrent();row(value);if(Object.hasOwn(value,'fragments')){exactKeys(value,['protocol','ownerId','scopeId','kind','resourceId','migrationId','fence','sourceHash','checkpointHash','directoryRevision','pathId','table','offset','byteOffset','fragments']);if(value.protocol!==1||value.ownerId!==lease.ownerId||value.scopeId!==lease.scopeId||value.kind!==scope.kind||value.resourceId!==scope.resourceId||value.migrationId!==lease.migrationId||value.fence!==lease.fence||value.sourceHash!==lease.sourceHash||value.pathId!==scope.pathId||value.table!==table||value.offset!==offset||value.byteOffset!==byteOffset||!Array.isArray(value.fragments)||value.fragments.length<1||value.fragments.length>50)invalid();buffered=value.fragments;}else buffered=[value];}
  const value=buffered.shift();row(value);if(value.pathId!==scope.pathId||value.table!==table||value.offset!==offset||value.byteOffset!==byteOffset)invalid();return value;
 };
 for(const table of schema.tables){const rows:PrivatePathSourceRow[]=[];tables[table.table]=rows;let offset=0;
  for(;;){let position=0,buffer:Uint8Array|undefined,expectedLength:number|undefined,expectedHash:string|undefined,last=false;
   try{
    for(;;){
     ports.assertCurrent();if(++requests>1000000)throw new Error('E2EE_SOURCE_TOO_LARGE');
     const page=structuredClone(await read(table.table,offset,position));ports.assertCurrent();
     exactKeys(page,['protocol','ownerId','scopeId','kind','resourceId','migrationId','fence','sourceHash','checkpointHash','directoryRevision','pathId','table','offset','byteOffset','totals','rowBytes','rowHash','chunk','nextByteOffset','nextOffset']);
     if(page.protocol!==1||page.ownerId!==lease.ownerId||page.scopeId!==lease.scopeId||page.kind!==scope.kind||page.resourceId!==scope.resourceId||page.pathId!==scope.pathId
      ||page.migrationId!==lease.migrationId||page.fence!==lease.fence||page.sourceHash!==lease.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
     if(page.table!==table.table||page.offset!==offset||page.byteOffset!==position)invalid();integer(page.directoryRevision);decodeE2eeBytes(page.checkpointHash,32).fill(0);
     exactKeys(page.totals,schema.server);let count=0;for(const name of schema.server){integer(page.totals[name]);count+=page.totals[name] as number;}if(count>1000000)throw new Error('E2EE_SOURCE_TOO_LARGE');
     if(!totals){totals=page.totals;checkpoint=page.checkpointHash as string;revision=page.directoryRevision;}
     else if(page.checkpointHash!==checkpoint||page.directoryRevision!==revision||schema.server.some(name=>totals![name]!==page.totals[name]))invalid();
     const encoded=encoder.encode(JSON.stringify(page));wire+=encoded.length;const pageSize=encoded.length;encoded.fill(0);if(pageSize>2*1024*1024||wire>2147483647)throw new Error('E2EE_SOURCE_TOO_LARGE');
     integer(page.rowBytes);if(page.rowBytes>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');const total=page.totals[table.table] as number;
     if(total===0){if(offset!==0||position!==0||page.rowBytes!==0||page.rowHash!==null||page.chunk!==''||page.nextByteOffset!==null||page.nextOffset!==null)invalid();last=true;break;}
     if(offset>=total||page.rowBytes<1||typeof page.rowHash!=='string')invalid();decodeE2eeBytes(page.rowHash,32).fill(0);
     if(!buffer){expectedLength=page.rowBytes;expectedHash=page.rowHash;size+=page.rowBytes;if(size>512*1024*1024)throw new Error('E2EE_SOURCE_TOO_LARGE');buffer=new Uint8Array(page.rowBytes);}
     if(page.rowBytes!==expectedLength||page.rowHash!==expectedHash)invalid();const bytes=decodeE2eeBytes(page.chunk,1,1024*1024);
     try{const next=position+bytes.length;if(next>buffer.length||page.nextByteOffset!==(next<buffer.length?next:null)||page.nextOffset!==(next<buffer.length?offset:offset+1<total?offset+1:null))invalid();buffer.set(bytes,position);position=next;}finally{bytes.fill(0);}
     if(position===buffer.length){
      const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(buffer)));try{ports.assertCurrent();if(encodeE2eeBytes(hash)!==expectedHash)invalid();}finally{hash.fill(0);}
      const value=parseLegacyMigrationJson(decoder.decode(buffer),'E2EE_PRIVATE_PATH_TRANSPORT_INVALID',MAX);exactKeys(value,['original','content','execution']);row(value.original);row(value.content);
      if(value.execution!=='history-only'||Object.keys(value.original).some(name=>!table.columns.includes(name))||Object.keys(value.original).length!==table.columns.length)invalid();
      rows.push(value as PrivatePathSourceRow);last=page.nextOffset===null;if(last&&rows.length!==total)invalid();break;
     }
    }
   }finally{buffer?.fill(0);}
   if(last)break;offset++;
  }
 }
 ports.assertCurrent();if(buffered.length)invalid();return{protocol:1,ownerId:lease.ownerId,scopeId:lease.scopeId,kind:scope.kind,resourceId:scope.resourceId,pathId:scope.pathId,tables};
}

export function normalizeNativePrivatePathRemote(input:unknown,current:()=>void):PrivatePathRemote{
 current();exactKeys(input,['protocol','ownerId','scopeId','kind','resourceId','pathId','tables','encoding']);
 if(input.protocol!==1||input.encoding!=='utf8-json-rows-v1'||!['personal','project','space'].includes(String(input.kind))||typeof input.pathId!=='string')invalid();
 assertTechnical(input.ownerId);assertTechnical(input.scopeId);assertTechnical(input.resourceId);
 const kind=input.kind as PrivateScopeKind,schema=privatePathSource(kind,input.pathId);exactKeys(input.tables,schema.server);
 const tables:Record<string,PrivatePathSourceRow[]>={};let size=0;
 for(const table of schema.tables){const source=input.tables[table.table];if(!Array.isArray(source)||source.length>1000000)invalid();const rows:PrivatePathSourceRow[]=[];
  for(const raw of source){current();if(typeof raw!=='string')invalid();const encoded=encoder.encode(raw);size+=encoded.length;const length=encoded.length;encoded.fill(0);
   if(length>MAX||size>512*1024*1024)throw new Error('E2EE_SOURCE_TOO_LARGE');
   const value=parseLegacyMigrationJson(raw,'E2EE_PRIVATE_PATH_TRANSPORT_INVALID',MAX);exactKeys(value,['original','content','execution']);exactKeys(value.original,table.columns);row(value.content);if(value.execution!=='history-only')invalid();rows.push(value as PrivatePathSourceRow);
  }tables[table.table]=rows;
 }
 current();return{protocol:1,ownerId:input.ownerId,scopeId:input.scopeId,kind,resourceId:input.resourceId,pathId:input.pathId,tables};
}
