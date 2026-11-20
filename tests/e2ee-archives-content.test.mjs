import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {readLegacyArchiveOperations,readLegacyArchiveTables,LEGACY_BACKUP_CONTENT_TABLES} from '../app/e2ee/archives-content.ts';
import {physisAad} from '../app/physis/crypto.ts';
import {importE2eeRoot,sealE2eeEnvelope,openE2eeEnvelope} from '../app/e2ee/envelope.ts';
const owner='server-archive-owner',at='2026-11-20T04:00:00Z',encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const originalKey=new Uint8Array(32).fill(41),physisKey=new Uint8Array(32).fill(73),phyId='12345678-1234-5678-9012-123456789abc';
const b64=raw=>Buffer.from(raw).toString('base64');
async function rig(){
 let key=await crypto.subtle.importKey('raw',originalKey,{name:'AES-GCM'},false,['encrypt','decrypt']);
 let phy=await crypto.subtle.importKey('raw',physisKey,{name:'AES-GCM'},false,['encrypt','decrypt']);const pinned=new Set(),calls=[];
 async function sealRaw(raw,purpose){const iv=crypto.getRandomValues(new Uint8Array(12)),aad=purpose==='workspace'?new Uint8Array():encoder.encode(`genesis-mindmap-v1:${owner}:${purpose}`);
  const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,encoder.encode(raw)));
  const value={iv:b64(iv),ciphertext:b64(bytes)};bytes.fill(0);pinned.add(purpose+'\0'+value.iv+'\0'+value.ciphertext);return value;}
 const seal=(value,purpose)=>sealRaw(JSON.stringify(value),purpose);
 const ports={assertCurrent(){},async openAccount(uid,envelope,purpose){calls.push(purpose);assert.equal(uid,owner);assert.ok(key);assert.ok(pinned.has(purpose+'\0'+envelope.iv+'\0'+envelope.ciphertext));
  const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:purpose==='workspace'?new Uint8Array():encoder.encode(`genesis-mindmap-v1:${uid}:${purpose}`)},key,Buffer.from(envelope.ciphertext,'base64')));
  try{return decoder.decode(raw);}finally{raw.fill(0);}},
  async openPhysis(uid,id,envelope){calls.push('physis:'+id);assert.equal(uid,owner);assert.ok(phy);
   const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:physisAad(uid,id,1,envelope.keyVersion)},phy,Buffer.from(envelope.ciphertext,'base64')));
   try{return decoder.decode(raw);}finally{raw.fill(0);}},
 };
 async function physis(value){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:physisAad(owner,phyId,1,3)},phy,encoder.encode(JSON.stringify(value))));
  return{version:1,schemaVersion:1,keyVersion:3,iv:b64(iv),ciphertext:b64(bytes)};}
 return{seal,sealRaw,ports,calls,physis,retire(){key=undefined;phy=undefined;}};
}
async function tablesFixture(r){
 const tables=Object.fromEntries(LEGACY_BACKUP_CONTENT_TABLES.map(name=>[name,[]])),hash='a'.repeat(64);
 tables.workspace_blobs.push({...await r.seal({private:'workspace original',zero:0,enabled:false},'workspace'),version:4,updated_at:at,minimum_writer_protocol:9,writer_protocol_version:9});
 tables.personal_mindmaps.push({id:'map-one',schema_version:2,revision:2,...await r.seal({id:'map-one',private:'current map'},'map:map-one'),updated_at:at});
 tables.personal_mindmap_versions.push({map_id:'map-one',schema_version:2,revision:1,...await r.seal({id:'map-one',private:'historical map'},'map:map-one'),updated_at:at});
 tables.personal_mindmap_deletions.push({map_id:'map-deleted',deleted_at:at});
 tables.personal_diary_notes.push({id:'note-one',schema_version:1,revision:1,...await r.seal({id:'note-one',private:'independent note'},'diary-note:v1:note-one'),payload_hash:hash,updated_at:at});
 tables.personal_diary_deletions.push({id:'note-deleted',revision:2,local_only:1,updated_at:at});
 tables.personal_diary_settings.push({sync_enabled:0,revision:3,command_hash:hash,removed_count:0,updated_at:at});
 tables.personal_diary_dreams.push({note_id:'note-one',dream_day:'2026-11-20',time_zone:'Europe/Moscow'});
 tables.dream_journal_preferences.push({today_mode:'off',revision:1,updated_at:at});
 tables.stoicheion_workspaces.push({revision:2,...await r.seal({private:'practice'},'stoicheion-workspace:v1'),payload_hash:hash,updated_at:at});
 tables.aurora_workspaces.push({revision:1,...await r.seal({ownerId:owner,private:'Aurora'},'aurora-workspace:v1'),payload_hash:hash,updated_at:at});
 tables.personal_recovered_tasks.push({id:'task-one',revision:1,...await r.seal({id:'task-one',title:'Recovered private task',syncToGoogle:false},'recovered-task:v1:task-one'),updated_at:at});
 tables.personal_recovered_task_deletions.push({id:'task-deleted',revision:2,updated_at:at});
 tables.physis_records.push({id:phyId,revision:1,sequence:2,updated_at:at,deleted_at:null,envelope_json:JSON.stringify(await r.physis({id:phyId,private:'Physis original'}))});
 tables.physis_records.push({id:'23456789-1234-5678-9012-123456789abc',revision:2,sequence:3,updated_at:at,deleted_at:at,envelope_json:null});
 return tables;
}
test('all fourteen actual server safety tables retain plaintext histories, tombstones and settings with no replay',async()=>{
 const r=await rig(),tables=await tablesFixture(r),raw=JSON.stringify(tables),before=JSON.stringify(tables);const read=await readLegacyArchiveTables(raw,owner,r.ports);
 assert.equal(read.entries.length,15);assert.equal(r.calls.length,8);assert.equal(read.execution,'history-only');assert.equal('complete' in read,false);
 assert.equal(read.entries.find(row=>row.source.startsWith('personal_diary_settings')).metadata.sync_enabled,0);
 assert.equal(read.entries.find(row=>row.source.startsWith('workspace_blobs')).document.enabled,false);
 assert.equal(read.entries.find(row=>row.source.startsWith('personal_mindmap_versions')).document.private,'historical map');
 assert.equal(read.entries.find(row=>row.source.startsWith('physis_records:'+phyId)).document.private,'Physis original');
 assert.equal(read.entries.filter(row=>row.document===null).length,7);assert.equal(JSON.stringify(tables),before);assert.equal(raw,JSON.stringify(tables));
 for(const table of Object.values(tables))for(const row of table)if(row.ciphertext)assert.equal(JSON.stringify(read).includes(row.ciphertext),false);
});
test('six supported staged operation formats open exact old AAD and remain inert independent content',async()=>{
 const r=await rig(),operations=[];
 for(const [section,id,purpose]of [['workspace','','workspace'],['mindmaps','map-one','map:map-one'],['diary','note-one','diary-note:v1:note-one'],['stoicheion','','stoicheion-workspace:v1'],['aurora','','aurora-workspace:v1'],['recovered-tasks','task-one','recovered-task:v1:task-one']]){
  operations.push({section,...id?{id}:{},input:{...await r.seal({private:section,falseValue:false,zero:0},purpose),...section==='workspace'?{expectedVersion:0,version:1,writerProtocol:9,minimumWriterProtocol:9}:{expectedRevision:0}}});
 }
 const read=await readLegacyArchiveOperations(JSON.stringify(operations),owner,r.ports);assert.equal(read.entries.length,6);assert.equal(r.calls.length,6);assert.equal(read.entries[0].metadata.input.expectedVersion,0);
 assert.equal(read.entries.every(row=>row.document.falseValue===false&&row.document.zero===0),true);assert.equal(read.execution,'history-only');assert.equal('operations' in read,false);
});
test('future fields, foreign authority tables, duplicate operations and escaped raw names fail before any key opening',async()=>{
 const r=await rig(),input={section:'workspace',input:await r.seal({private:'never opened'},'workspace')};
 for(const raw of [JSON.stringify([input,input]),JSON.stringify([{...input,id:null}]),JSON.stringify([{...input,section:'billing'}]),JSON.stringify([{...input,input:{...input.input,entitlement:true}}]),
  JSON.stringify([input]).replace('"section":"workspace"','"section":"billing","sect\\u0069on":"workspace"')]){
  await assert.rejects(readLegacyArchiveOperations(raw,owner,r.ports),/E2EE_/);assert.equal(r.calls.length,0);
 }
 const tables=Object.fromEntries(LEGACY_BACKUP_CONTENT_TABLES.map(name=>[name,[]]));for(const value of [{tables},{...tables,users:[{is_admin:true}]},{...tables,personal_diary_settings:[{user_id:'foreign'}]}]){
  await assert.rejects(readLegacyArchiveTables(JSON.stringify(value),owner,r.ports),/E2EE_/);assert.equal(r.calls.length,0);
 }
});
test('locked Physis, corrupt native-type frames and duplicate encrypted plaintext never become empty archive content',async()=>{
 const r=await rig(),tables=await tablesFixture(r);await assert.rejects(readLegacyArchiveTables(JSON.stringify(tables),owner,{...r.ports,openPhysis:undefined}),/E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED/);
 const duplicate=await r.sealRaw('{"private":1,"priv\\u0061te":2}','workspace');await assert.rejects(readLegacyArchiveOperations(JSON.stringify([{section:'workspace',input:duplicate}]),owner,r.ports),/E2EE_ARCHIVE_CONTENT_INVALID/);
 const frame=await r.seal({private:'original'},'workspace');await assert.rejects(readLegacyArchiveOperations(JSON.stringify([{section:'workspace',input:{...frame,iv:frame.iv+'='}}]),owner,r.ports),/E2EE_/);
});
test('an owner change after authenticated opening refuses the whole result and leaves all original archive text intact',async()=>{
 const r=await rig(),input=JSON.stringify([{section:'workspace',input:await r.seal({private:'original'},'workspace')}]);let live=true;
 const ports={...r.ports,assertCurrent(){if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},openAccount:async(...args)=>{const raw=await r.ports.openAccount(...args);live=false;return raw;}};
 await assert.rejects(readLegacyArchiveOperations(input,owner,ports),/E2EE_ACCOUNT_CHANGED/);assert.equal(typeof input,'string');
});
test('a null, projected object or non-JSON key-opening reply cannot turn encrypted content into metadata-only success',async()=>{
 const r=await rig(),raw=JSON.stringify([{section:'workspace',input:await r.seal({private:'must survive'},'workspace')}]);
 for(const value of [null,undefined,{private:'projected without original text'},'','"not a document"'])await assert.rejects(readLegacyArchiveOperations(raw,owner,{...r.ports,openAccount:async()=>value}),/E2EE_/);
});
test('new-root cold decrypt returns every archive plaintext after old account and independent keys are retired',async()=>{
 const r=await rig(),tables=await tablesFixture(r),content=await readLegacyArchiveTables(JSON.stringify(tables),owner,r.ports);
 const fixture=JSON.parse(await readFile(new URL('./fixtures/e2ee/v1.json',import.meta.url),'utf8'));
 const root=await importE2eeRoot(crypto.getRandomValues(new Uint8Array(32))),signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const context={...fixture.envelope.context,ownerId:owner,scopeId:'personal:'+owner,domain:'local-snapshot',objectId:'archive:'+crypto.randomUUID()};
 const raw=encoder.encode(JSON.stringify(content)),sealed=await sealE2eeEnvelope(root,signing.privateKey,context,raw);raw.fill(0);r.retire();
 const opened=await openE2eeEnvelope(root,signing.publicKey,context,JSON.parse(JSON.stringify(sealed)));
 try{const read=JSON.parse(decoder.decode(opened));assert.deepEqual(read,content);assert.equal(read.entries.find(row=>row.source.startsWith('physis_records:'+phyId)).document.private,'Physis original');}
 finally{opened.fill(0);}
});
test('actual current PHP/SQLite snapshot exporter and server wrapper feed the shared reader with all owner tables intact',async()=>{
 const r=await rig(),tables=await tablesFixture(r),operations=[{section:'workspace',input:await r.seal({private:'actual server wrapper original'},'workspace')}];
 const runtime=fileURLToPath(new URL('../output/release-3.3.6/runtime/',import.meta.url));await mkdir(runtime,{recursive:true});const directory=await mkdtemp(join(runtime,'archive-content-qa-')),input=join(runtime,'archives-server-content-input-'+crypto.randomUUID()+'.json');
 await writeFile(input,JSON.stringify({ownerId:owner,tables,operations}));
 const php=process.env.GENESIS_QA_PHP??'php',script=fileURLToPath(new URL('../scripts/qa/archives-content-fixture.php',import.meta.url));
 const fixture=JSON.parse(execFileSync(php,[script,input,directory],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024}));
 assert.equal(fixture.synthetic,true);assert.equal(fixture.ownerId,owner);
 const exported=await readLegacyArchiveTables(fixture.tables,owner,r.ports),staged=await readLegacyArchiveOperations(fixture.operations,owner,r.ports);
 assert.equal(exported.entries.length,15);assert.equal(staged.entries[0].document.private,'actual server wrapper original');
 assert.equal(exported.entries.find(row=>row.source.startsWith('personal_diary_settings')).metadata.sync_enabled,0);
 assert.equal(exported.entries.find(row=>row.source.startsWith('physis_records:'+phyId)).document.private,'Physis original');
});
