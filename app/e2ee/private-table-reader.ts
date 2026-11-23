import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';

type Row=Record<string,unknown>;
type Read=(objectId:string)=>Promise<{bytes:Uint8Array;revision:number}>;
function invalid():never{throw new Error('E2EE_PRIVATE_SEED_REQUIRED');}
function document(bytes:Uint8Array,pathId:string,table:string){const value=parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'E2EE_PRIVATE_SEED_REQUIRED',64*1024*1024) as Row;if(!value||typeof value!=='object'||value.pathId!==pathId||value.table!==table||value.execution!=='content-only')invalid();return value;}
function rows(value:Row){exactKeys(value,['format','pathId','table','rows','execution']);if(value.format!=='genesis-private-table-v1'||!Array.isArray(value.rows)||value.rows.length>1000000||value.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))invalid();return value.rows as Row[];}
/** Bounded independently authenticated chunks, exact count/EOF and immutable
 * original IDs. Historical single-table documents remain readable. */
export async function* readPrivateTablePages(read:Read,objectId:string,pathId:string,table:string,current:()=>void,expectedCount?:number):AsyncGenerator<Row[]>{
 [objectId,pathId,table].forEach(assertTechnical);current();const opened=await read(objectId);current();let root:Row;try{if(opened.revision!==1)invalid();root=document(opened.bytes,pathId,table);}finally{opened.bytes.fill(0);}
 if(root.format==='genesis-private-table-v1'){const page=rows(root);if(expectedCount!==undefined&&page.length!==expectedCount)invalid();yield page;current();return;}
 exactKeys(root,['format','pathId','table','count','parts','execution']);if(root.format!=='genesis-private-table-shards-v2'||!Number.isSafeInteger(root.count)||Number(root.count)<1||Number(root.count)>1000000||expectedCount!==undefined&&root.count!==expectedCount||!Array.isArray(root.parts)||!root.parts.length||root.parts.length>10000)invalid();let total=0;
 for(const [index,part]of root.parts.entries()){exactKeys(part,['objectId','count','size','sha256']);if(part.objectId!==objectId+':part:'+index||!Number.isSafeInteger(part.count)||Number(part.count)<1||!Number.isSafeInteger(part.size)||Number(part.size)<1||Number(part.size)>64*1024*1024||typeof part.sha256!=='string')invalid();const value=await read(String(part.objectId));current();
  let page:Row[];try{if(value.revision!==1||value.bytes.length!==part.size||encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(value.bytes))))!==part.sha256)invalid();current();page=rows(document(value.bytes,pathId,table));if(page.length!==part.count||total+page.length>Number(root.count))invalid();total+=page.length;}finally{value.bytes.fill(0);}yield page;current();
 }if(total!==root.count)invalid();
}
export async function readPrivateTable(read:Read,objectId:string,pathId:string,table:string,current:()=>void,expectedCount?:number){const records:Row[]=[];for await(const page of readPrivateTablePages(read,objectId,pathId,table,current,expectedCount))for(const row of page)records.push(row);current();return records;}
