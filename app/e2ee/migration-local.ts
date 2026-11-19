import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes,type E2eeContext} from './envelope.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES} from './files.ts';
import type {MigrationContent} from './migration.ts';
import type {UnlockedE2eeVault,LocalWrite} from './storage.ts';

/** This manifest is stored ONLY inside the encrypted device migration journal.
 * Neither private object IDs, filenames, plaintext hashes nor these chunks have
 * a transport representation. A local-only record cannot enter the upload plan. */
export type MigrationLocalEntry={domain:E2eeContext['domain'];objectId:string;recordId:string;parts:number;size:number;plaintextHash:string;filename:string;mediaType:string};
const MAX_TOTAL=128*1024*1024;
async function digest(bytes:Uint8Array){return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))));}
function invalid():never{throw new Error('E2EE_CORRUPT_LOCAL_CONTENT');}
export function validateMigrationLocalEntries(value:unknown,migrationId:string,allowed:readonly E2eeContext['domain'][]):MigrationLocalEntry[]{
 assertTechnical(migrationId);if(!Array.isArray(value)||value.length>10000)invalid();const seen=new Set<string>();let total=0;
 for(const [index,row]of value.entries()){
  exactKeys(row,['domain','objectId','recordId','parts','size','plaintextHash','filename','mediaType']);assertTechnical(row.objectId);
  if(!allowed.includes(row.domain as E2eeContext['domain'])||row.recordId!==`${migrationId}:private:${index}`||!Number.isSafeInteger(row.size)
   ||(row.size as number)<0||(row.size as number)>E2EE_MAX_FILE_BYTES||row.parts!==Math.ceil((row.size as number)/E2EE_CHUNK_BYTES)
   ||typeof row.filename!=='string'||row.filename.length>512||typeof row.mediaType!=='string'||row.mediaType.length>128)invalid();
  decodeE2eeBytes(row.plaintextHash,32);const identity=row.domain+'\0'+row.objectId;if(seen.has(identity))invalid();seen.add(identity);
  total+=row.size as number;if(total>MAX_TOTAL)invalid();
 }
 return value as MigrationLocalEntry[];
}
export async function planMigrationLocalContent(migrationId:string,records:readonly MigrationContent[]):Promise<{entries:MigrationLocalEntry[];changes:LocalWrite[]}>{
 assertTechnical(migrationId);const entries:MigrationLocalEntry[]=[],changes:LocalWrite[]=[];
 try{
  if(records.length>10000||records.reduce((total,row)=>total+row.bytes.length,0)>MAX_TOTAL)throw new Error('E2EE_MIGRATION_TOO_LARGE');
  for(const [index,row]of records.entries()){
   assertTechnical(row.objectId);if(!(row.bytes instanceof Uint8Array)||row.bytes.length>E2EE_MAX_FILE_BYTES||row.filename!==undefined&&(typeof row.filename!=='string'||row.filename.length>512)
    ||row.mediaType!==undefined&&(typeof row.mediaType!=='string'||row.mediaType.length>128))throw new Error('E2EE_INVALID_SOURCE_RESULT');
   const recordId=`${migrationId}:private:${index}`,parts=Math.ceil(row.bytes.length/E2EE_CHUNK_BYTES);
   entries.push({domain:row.domain,objectId:row.objectId,recordId,parts,size:row.bytes.length,plaintextHash:await digest(row.bytes),filename:row.filename??'',mediaType:row.mediaType??'application/json'});
   for(let part=0;part<parts;part++)changes.push({domain:'local-snapshot',objectId:`${recordId}:${part}`,value:row.bytes.slice(part*E2EE_CHUNK_BYTES,(part+1)*E2EE_CHUNK_BYTES),expected:null});
  }
  return{entries,changes};
 }catch(error){changes.forEach(row=>row.value.fill(0));throw error;}
}
export async function openMigrationLocalContent(vault:UnlockedE2eeVault,entry:MigrationLocalEntry):Promise<MigrationContent>{
 vault.assertUnlocked();if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>E2EE_MAX_FILE_BYTES||entry.parts!==Math.ceil(entry.size/E2EE_CHUNK_BYTES))invalid();
 const bytes=new Uint8Array(entry.size);let offset=0;
 try{
  for(let part=0;part<entry.parts;part++){
   const row=await vault.read('local-snapshot',`${entry.recordId}:${part}`);if(!row)invalid();
   try{if(row.value.length!==Math.min(E2EE_CHUNK_BYTES,bytes.length-offset))invalid();bytes.set(row.value,offset);offset+=row.value.length;}
   finally{row.value.fill(0);}
  }
  if(offset!==bytes.length||await digest(bytes)!==entry.plaintextHash)invalid();vault.assertUnlocked();
  return{domain:entry.domain,objectId:entry.objectId,bytes,filename:entry.filename,mediaType:entry.mediaType};
 }catch(error){bytes.fill(0);throw error;}
}
