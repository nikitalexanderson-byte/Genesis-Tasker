import assert from 'node:assert/strict';
import test from 'node:test';
import {readNativeBackupFile,nativeBackupFileOrigin} from '../app/backup-native-file.ts';
import {captureBackupMigrationEditors,registerBackupMigrationEditor,clearBackupMigrationMemory} from '../app/backup-migration-memory.ts';
const id='ab24cd56-1234-5678-9012-34567890abcd',chunkSize=98304;
async function fixture(bytes=new Uint8Array([0,255,0xc3,0x28,0xed,0xa0,0x80,13,10])){
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const info={protocol:1,id,length:bytes.length,name:'исходный-α.genesisbackup',type:'APPLICATION/JSON',lastModified:1700000000123,declaredSize:bytes.length+1,sha256:hash};
 const calls=[],ports={check(){},async choose(){return info;},async chunk(fileId,offset){calls.push([fileId,offset]);const nextOffset=Math.min(offset+chunkSize,bytes.length);
  return{id:fileId,offset,bytes:Buffer.from(bytes.subarray(offset,nextOffset)).toString('base64url'),nextOffset,eof:nextOffset===bytes.length};},
  async clear(fileId){calls.push(['clear',fileId]);return true;}};
 return{bytes,info,calls,ports};
}

test('native binary import preserves invalid UTF-8, every byte, original name/time and explicit provider metadata',async()=>{
 const f=await fixture(),file=await readNativeBackupFile(f.ports);
 assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from(f.bytes));assert.equal(file.name,f.info.name);assert.equal(file.lastModified,f.info.lastModified);
 assert.equal(file.type,'application/json');assert.deepEqual(nativeBackupFileOrigin(file),f.info);assert.deepEqual(f.calls,[[id,0],['clear',id]]);
 const copied=nativeBackupFileOrigin(file);copied.name='changed';assert.equal(nativeBackupFileOrigin(file).name,f.info.name);
});

test('empty and multiple binary chunks have explicit byte lengths without text conversion or empty-loop fallback',async()=>{
 for(const length of [0,chunkSize,chunkSize+13,chunkSize*3+17]){
  const f=await fixture(Uint8Array.from({length},(_,index)=>index%256)),file=await readNativeBackupFile(f.ports);
  assert.equal(file.size,length);assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from(f.bytes));
  assert.equal(f.calls.filter(call=>call[0]!=='clear').length,Math.ceil(length/chunkSize));
 }
});

test('unknown provider fields remain null instead of becoming fabricated provenance',async()=>{
 const f=await fixture();for(const field of ['name','type','lastModified','declaredSize'])f.info[field]=null;
 const file=await readNativeBackupFile(f.ports);assert.equal(file.name,'import.genesisbackup');assert.equal(file.lastModified,0);assert.deepEqual(nativeBackupFileOrigin(file),f.info);
});

test('archive source capture retains the binary File and original native provider provenance',async()=>{
 clearBackupMigrationMemory();const f=await fixture(),file=await readNativeBackupFile(f.ports);
 const remove=registerBackupMigrationEditor('binary-native-owner','backup-panel',()=>({state:{key:'source input only'},file,settled:true}));
 try{const [captured]=await captureBackupMigrationEditors('binary-native-owner',()=>{});
  assert.deepEqual(Buffer.from(captured.file.bytes,'base64url'),Buffer.from(f.bytes));assert.deepEqual(captured.file.nativeOrigin,f.info);
 }finally{remove();clearBackupMigrationMemory();}
});

test('malformed metadata refuses before allocating or requesting a chunk and still clears the identified transfer',async()=>{
 for(const change of [info=>info.length=-1,info=>info.length=192*1024*1024+1,info=>info.length=1.2,info=>info.protocol=2,
  info=>info.sha256='wrong',info=>info.name='x'.repeat(4097),info=>info.type=17,info=>info.lastModified=NaN,
  info=>info.declaredSize=Number.MAX_SAFE_INTEGER+1,info=>info.extra=true]){
  const f=await fixture();change(f.info);await assert.rejects(readNativeBackupFile(f.ports),/BACKUP_TRANSFER/);assert.deepEqual(f.calls,[['clear',id]]);
 }
});

test('spliced reordered truncated corrupted or noncanonical chunks never produce a File',async()=>{
 for(const change of [part=>part.id='foreign',part=>part.offset++,part=>part.nextOffset--,part=>part.eof=false,
  part=>part.bytes='',part=>part.bytes+='=',part=>part.bytes='A'.repeat(part.bytes.length),part=>part.extra=true]){
  const f=await fixture(),original=f.ports.chunk;f.ports.chunk=async(...args)=>{const part=await original(...args);change(part);return part;};
  await assert.rejects(readNativeBackupFile(f.ports),/BACKUP_TRANSFER/);assert.deepEqual(f.calls.at(-1),['clear',id]);
 }
 const f=await fixture();f.info.sha256='0'.repeat(64);await assert.rejects(readNativeBackupFile(f.ports),/BACKUP_TRANSFER/);
});

test('owner invalidation at each asynchronous handoff refuses the File and retires its exact transfer',async()=>{
 for(const phase of ['choose','chunk','digest','clear']){
  const f=await fixture();let current=true,calls=0;f.ports.check=()=>{if(!current)throw new Error('BACKUP_OWNER');};
  if(phase==='choose'){const choose=f.ports.choose;f.ports.choose=async()=>{const info=await choose();current=false;return info;};}
  if(phase==='chunk'){const chunk=f.ports.chunk;f.ports.chunk=async(...args)=>{const part=await chunk(...args);current=false;return part;};}
  if(phase==='digest')f.ports.check=()=>{calls++;if(calls===4)throw new Error('BACKUP_OWNER');};
  if(phase==='clear'){const clear=f.ports.clear;f.ports.clear=async(...args)=>{const value=await clear(...args);current=false;return value;};}
  await assert.rejects(readNativeBackupFile(f.ports),/BACKUP_OWNER/);assert.deepEqual(f.calls.at(-1),['clear',id]);
 }
});

test('cleanup failure cannot become successful import or hide the original failed read',async()=>{
 const f=await fixture();f.ports.clear=async()=>{throw new Error('cleanup failed');};await assert.rejects(readNativeBackupFile(f.ports),/cleanup failed/);
 f.ports.chunk=async()=>{throw new Error('original read failed');};await assert.rejects(readNativeBackupFile(f.ports),/original read failed/);
 const other=await fixture();other.ports.clear=async()=>false;await assert.rejects(readNativeBackupFile(other.ports),/BACKUP_TRANSFER/);
});
