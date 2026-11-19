import {encodeE2eeBytes} from './envelope.ts';
import {assertTechnical} from './keys.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES} from './files.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent} from './migration.ts';

/** Backpressured in-process output. Plaintext checksums never enter HTTP; the
 * coordinator independently encrypts/signs its existing file manifests. */
export async function streamNativeSourceResults(result:{content:MigrationContent[];localContent?:MigrationContent[]},
 send:(part:Record<string,unknown>)=>Promise<unknown>,assertCurrent:()=>void){
 const remote=result.content.map(row=>({...row})),local=(result.localContent??[]).map(row=>({...row})),seen=new Set<string>();let size=0,sequence=0;
 try{
 if(remote.length+local.length<1||remote.length+local.length>10000)throw new Error('E2EE_MIGRATION_TOO_LARGE');
 for(const row of [...remote,...local]){
  assertTechnical(row.objectId);const key=row.domain+'\0'+row.objectId;
  if(seen.has(key)||!(row.bytes instanceof Uint8Array)||row.bytes.length>E2EE_MAX_FILE_BYTES||typeof(row.filename??'')!=='string'||(row.filename??'').length>512
   ||typeof(row.mediaType??'application/json')!=='string'||(row.mediaType??'application/json').length>128)throw new Error('E2EE_SOURCE_STREAM_INVALID');
  seen.add(key);size+=row.bytes.length;if(size>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_TOO_LARGE');
 }
 for(const [placement,rows]of [['remote',remote],['local',local]] as const)for(const row of rows){
  assertCurrent();const bytes=row.bytes,hash=encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))));assertCurrent();
  for(let index=0,offset=0;offset<bytes.length||index===0;index++,offset+=E2EE_CHUNK_BYTES){
   const part=bytes.subarray(offset,Math.min(offset+E2EE_CHUNK_BYTES,bytes.length));assertCurrent();
   const acknowledgement=await send({protocol:1,sequence,placement,domain:row.domain,objectId:row.objectId,filename:row.filename??'',mediaType:row.mediaType??'application/json',
    size:bytes.length,index,last:offset+part.length===bytes.length,hash,bytes:part.length?encodeE2eeBytes(part):''});
   assertCurrent();if(acknowledgement!==true)throw new Error('E2EE_SOURCE_STREAM_INVALID');
  }
  sequence++;
 }
 return{remoteCount:remote.length,localCount:local.length};
 }finally{
  // Wipe only after all rows are sent: different legitimate rows may share a
  // buffer/view, so per-row zeroization could corrupt an unsent later object.
  for(const row of [...remote,...local])if(row.bytes instanceof Uint8Array)row.bytes.fill(0);
 }
}
