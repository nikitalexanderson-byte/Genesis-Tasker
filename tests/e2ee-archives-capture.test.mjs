import assert from 'node:assert/strict';
import test from 'node:test';
import {captureBackupMigrationEditors,registerBackupMigrationEditor,withBackupEditorTask,clearBackupMigrationMemory} from '../app/backup-migration-memory.ts';
import {captureWebArchiveInventory} from '../app/e2ee/archives-web-source.ts';
import {MemoryStorage,cloudSyncClient,deferred} from './helpers/cloud-sync-client.mjs';
const owner='archive-local-owner';
const plain=value=>JSON.parse(JSON.stringify(value));
const form=(state={},file=null)=>({state,file,settled:true});
const reset=()=>clearBackupMigrationMemory();

test('archive capture keeps the exact selected bytes, numeric input, uncertain IDs and key input before any network',async()=>{
 reset();const raw=Uint8Array.from([0,255,0xc3,0x28,17]),file=new File([raw],'незавершённый.genesisbackup',{type:'application/octet-stream',lastModified:1700000000123});
 const state={key:' unsubmitted independent archive input ',selected:['workspace'],operationId:'exact-uncertain-operation',plan:{operations:[{section:'workspace',input:{iv:'old',ciphertext:'original'}}]},rawNumber:'00.250',confirmed:true};
 const remove=registerBackupMigrationEditor(owner,'backup-panel',()=>form(state,file));
 const [captured]=await captureBackupMigrationEditors(owner,()=>{});
 assert.deepEqual(captured.state,state);assert.deepEqual(Buffer.from(captured.file.bytes,'base64url'),Buffer.from(raw));
 assert.equal(captured.file.name,file.name);assert.equal(captured.file.lastModified,file.lastModified);assert.equal(captured.mounted,true);
 state.rawNumber='changed';assert.equal(captured.state.rawNumber,'00.250');remove();reset();
});

test('navigation retains detached import and new panels without dropping either branch or attributing another owner',async()=>{
 reset();let first=form({operationId:'one',content:'unsent'},new File(['old selected file'],'old.genesisbackup'));
 const remove=registerBackupMigrationEditor(owner,'backup-panel',()=>first);remove();first.state.content='later mutation';
 registerBackupMigrationEditor(owner,'backup-panel',()=>form({operationId:'two'}));
 registerBackupMigrationEditor(owner+'-foreign','backup-panel',()=>form({private:'foreign'}));
 const captured=await captureBackupMigrationEditors(owner,()=>{});assert.equal(captured.length,2);
 assert.equal(captured[0].mounted,false);assert.equal(captured[0].state.content,'unsent');assert.equal(captured[1].mounted,true);
 assert.equal(Buffer.from(captured[0].file.bytes,'base64url').toString(),'old selected file');
 assert.equal(JSON.stringify(captured).includes('foreign'),false);reset();
});

test('an in-flight import/preview/export blocks capture until work drains, including a rejected task',async()=>{
 reset();const gate=deferred();const task=withBackupEditorTask(owner,()=>gate.promise);
 await assert.rejects(captureBackupMigrationEditors(owner,()=>{}),/OPERATION_IN_PROGRESS/);gate.resolve('finished');assert.equal(await task,'finished');
 assert.deepEqual(await captureBackupMigrationEditors(owner,()=>{}),[]);
 await assert.rejects(withBackupEditorTask(owner,async()=>{throw new Error('source failed');}),/source failed/);
 assert.deepEqual(await captureBackupMigrationEditors(owner,()=>{}),[]);reset();
});

test('a mounted React result must finish committing; a detached uncertain operation is retained explicitly for review',async()=>{
 reset();const current={state:{operationId:'uncertain'},file:null,settled:false},remove=registerBackupMigrationEditor(owner,'backup-panel',()=>current);
 await assert.rejects(captureBackupMigrationEditors(owner,()=>{}),/OPERATION_IN_PROGRESS/);remove();
 const [captured]=await captureBackupMigrationEditors(owner,()=>{});assert.equal(captured.settled,false);assert.equal(captured.mounted,false);assert.equal(captured.state.operationId,'uncertain');reset();
});

for(const change of ['input','file','navigate','new-task','logout','account'])test('asynchronous selected file capture refuses a concurrent '+change+' and wipes its owned bytes',async()=>{
 reset();const start=deferred(),release=deferred(),raw=new Uint8Array([1,2,3]);let live=true;
 class HeldFile extends File{async arrayBuffer(){start.resolve();await release.promise;return raw.buffer;}}
 let current=form({key:'source only',operationId:'old'},new HeldFile([raw],'held.genesisbackup'));
 const remove=registerBackupMigrationEditor(owner,'backup-panel',()=>current);
 const capture=captureBackupMigrationEditors(owner,()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');});await start.promise;
 if(change==='input')current.state.operationId='new';
 if(change==='file')current={...current,file:new File(['new'],'new.genesisbackup')};
 if(change==='navigate')remove();
 if(change==='new-task')await withBackupEditorTask(owner,async()=>{});
 if(change==='logout')clearBackupMigrationMemory();
 if(change==='account')live=false;
 release.resolve();await assert.rejects(capture,/E2EE_(?:ARCHIVE_CAPTURE_CHANGED|ACCOUNT_CHANGED)/);assert.equal(raw.every(byte=>byte===0),true);reset();
});

test('file read failures and oversize files are errors, never an empty staged archive',async()=>{
 reset();class BadFile extends File{async arrayBuffer(){throw new Error('selected file unavailable');}}
 let selected=new BadFile(['original'],'bad.genesisbackup');registerBackupMigrationEditor(owner,'backup-panel',()=>form({},selected));
 await assert.rejects(captureBackupMigrationEditors(owner,()=>{}),/selected file unavailable/);
 selected=new File(['original'],'large.genesisbackup');Object.defineProperty(selected,'size',{value:192*1024*1024+1});
 selected.arrayBuffer=async()=>{throw new Error('Oversized file must refuse before reading');};
 await assert.rejects(captureBackupMigrationEditors(owner,()=>{}),/SOURCE_TOO_LARGE/);reset();
});

test('local inventory preserves malformed raw originals and expired copies without pruning or reading another owner',async()=>{
 reset();const storage=new MemoryStorage();storage.setItem(`genesis-backup-safety-v1:${owner}:expired`,'{ "broken":');
 storage.setItem(`genesis-backup-held-v1:${owner}:generation-7`,'{ "exact":1,"exact":2 }');storage.setItem(`genesis-backup-history-v1:${owner}`,'{"attempt":"invalid original"}');
 storage.setItem(`genesis-backup-safety-v1:${owner}-other:private`,'foreign secret');storage.setItem('unrelated','foreign value');
 const before=[...storage.data],memory={owner,at:'old',storage:{raw:'held local'}},result=await captureWebArchiveInventory(owner,{storage,memorySafety:()=>memory,assertCurrent:()=>{}});
 assert.deepEqual([...storage.data],before);assert.equal(result.platform,'web');assert.equal(result.entries.length,5);
 assert.equal(result.entries.find(row=>row.key.includes(':expired')).value,'{ "broken":');assert.equal(result.entries.some(row=>row.key.includes('other')||row.key==='unrelated'),false);
 assert.deepEqual(result.memorySafety,memory);assert.equal(result.entries.find(row=>row.key.startsWith('genesis-data-generation')).value,null);reset();
});

for(const kind of ['storage','memory','storage-error'])test('inventory refuses a changed or inaccessible '+kind+' during selected file IO',async()=>{
 reset();const start=deferred(),release=deferred(),storage=new MemoryStorage();let memory={content:'old'},failed=false;
 class HeldFile extends File{async arrayBuffer(){start.resolve();await release.promise;return super.arrayBuffer();}}
 const file=new HeldFile(['exact'],'selected.genesisbackup');registerBackupMigrationEditor(owner,'backup-panel',()=>form({},file));
 const port={get length(){if(failed)throw new Error('source storage unavailable');return storage.length;},key:index=>storage.key(index),getItem:key=>storage.getItem(key)};
 const capture=captureWebArchiveInventory(owner,{storage:port,memorySafety:()=>memory,assertCurrent:()=>{}});await start.promise;
 if(kind==='storage')storage.setItem(`genesis-backup-safety-v1:${owner}:new`,'new');if(kind==='memory')memory={content:'new'};if(kind==='storage-error')failed=true;
 release.resolve();await assert.rejects(capture,/CAPTURE_CHANGED|source storage unavailable/);reset();
});

test('actual cloud/device capture includes memory-only quota safety, selected forms and old key provenance with no IO',async()=>{
 const f=await cloudSyncClient({userId:'actual-archive-owner',withBackups:true});
 f.backups.sources.registerBackupSource('workspace',{owner:f.userId,capture:()=>({tasks:[{id:'only',title:'original private'}]})});
 const frozen=f.backups.device.freezeBackupDevice(f.userId,f.storage);
 const full={get length(){return f.storage.length;},key:index=>f.storage.key(index),getItem:key=>f.storage.getItem(key),setItem(){throw new Error('QUOTA');},removeItem(){throw new Error('Do not prune');}};
 assert.equal((await f.backups.device.retainBackupSafety(frozen,full)).persistent,false);
 f.backups.memory.registerBackupMigrationEditor(f.userId,'backup-panel',()=>form({key:'independent input',operationId:'uncertain'}));
 const capture=await f.client.createPersonalArchivesLocalCapture(f.userId,'personal:'+f.userId),before=[...f.storage.data],requests=f.requests.length;
 const bytes=await capture.captureLocal();let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}finally{bytes.fill(0);}
 assert.equal(value.memory.ownerId,f.userId);assert.equal(value.memory.legacyKey,f.key);assert.equal(value.memory.local.memorySafety.sources.workspace.tasks[0].title,'original private');
 assert.equal(value.memory.local.editors[0].state.operationId,'uncertain');assert.deepEqual([...f.storage.data],before);assert.equal(f.requests.length,requests);
 f.window.dispatchEvent(new Event('genesis-local-session-ended'));assert.equal(f.backups.device.captureBackupMemorySafety(f.userId),null);
 assert.deepEqual(plain(await f.backups.memory.captureBackupMigrationEditors(f.userId,()=>{})),[]);
});
