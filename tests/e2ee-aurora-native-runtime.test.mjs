import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {collectAdvicePublicAssets,advicePublicLanguages} from '../scripts/advice-public-assets.mjs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
// Load ordinary modules before installing the isolated native window capability.
calendarModule('app/e2ee/aurora-source.ts');
const {encodeE2eeBytes,decodeE2eeBytes}=calendarModule('app/e2ee/envelope.ts');
const compiled=ts.transpileModule(readFileSync('app/aurora/source-native-entry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const CHUNK=131072,job='44444444-4444-4444-8444-444444444444';
const encode=value=>encodeE2eeBytes(new TextEncoder().encode(JSON.stringify(value)));
const publicCatalogues=collectAdvicePublicAssets(process.cwd());
const publicAssets=new Map(publicCatalogues.assets.map(row=>[row.fileName,new Uint8Array(Buffer.from(row.source))]));
async function fixture(count=1){
 const original=JSON.parse(readFileSync('tests/fixtures/backup-journal-aurora-v1.json','utf8')).document;
 const owner=original.ownerId,document=structuredClone(original),template=document.sessions[0];document.sessions=[];
 for(let index=0;index<count;index++){const session=structuredClone(template);session.id=`runtime-session-${index}`;session.context.situationId=session.id;session.observationNote='Synthetic private native runtime draft '+index;document.sessions.push(session);}
 document.activeSessionId=`runtime-session-${Math.min(5,count-1)}`;
 const raw=crypto.getRandomValues(new Uint8Array(32)),rawKey=Buffer.from(raw).toString('base64'),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);raw.fill(0);
 const seal=async(value,purpose)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`genesis-mindmap-v1:${owner}:${purpose}`)},key,new TextEncoder().encode(JSON.stringify(value)));
  return{iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')};};
 const context={ownerId:owner,scopeId:`personal:${owner}`,migrationId:'synthetic-runtime',fence:1,sourceHash:encodeE2eeBytes(new Uint8Array(32)),generation:2};
 const local={protocol:1,ownerId:owner,scopeId:context.scopeId,capturedAt:'2026-11-05T09:00:00Z',memory:{ownerId:owner,legacyKey:'',generation:0,reconciliationRequired:false,current:null},entries:[{
  key:`genesis-aurora-workspace-v1:${owner}:pending:writer:11111111-1111-4111-8111-111111111111:1:pending`,
  value:JSON.stringify({envelope:{...await seal(document,'aurora-workspace:v1'),expectedRevision:0},base:await seal({version:1,ownerId:owner,sessions:[],removed:[]},'aurora-workspace-base:v1')})}]};
 const remote={protocol:1,...context,legacyGeneration:0,checkpointHash:encodeE2eeBytes(new Uint8Array(32)),directoryRevision:1,workspace:null,results:[],legacyKey:{keyMode:'account',key:null}};delete remote.generation;
 const input={protocol:1,source:'aurora',ownerId:owner,scopeId:context.scopeId,local:encode(local),previous:[],context,remote};
 return{input,rawKey,local,document,key,owner};
}
async function withRuntime(f,action,{hold=false,corrupt=false}={}){
 const oldWindow=globalThis.window,chunks=new Map(),messages=[],requests=[],results=[];let outgoingChunks=0,replyChunks=0;
 let resolveOutcome;const outcome=new Promise(resolve=>resolveOutcome=resolve);const surface={};
 const consume=raw=>{
  const value=JSON.parse(raw);messages.push(value);
  assert.equal(value.job,job);
  if(value.kind==='result-part'){
   const part=value.part;assert.equal(part.protocol,1);assert.ok(['remote','local'].includes(part.placement));
   if(part.index===0){assert.equal(part.sequence,results.length);results.push({header:{...part,bytes:undefined,index:undefined,last:undefined},parts:[],closed:false});}
   const row=results[part.sequence];assert.ok(row&&!row.closed);assert.equal(part.index,row.parts.length);
   assert.deepEqual({...part,bytes:undefined,index:undefined,last:undefined},row.header);
   row.parts.push(part.bytes?decodeE2eeBytes(part.bytes,1,256*1024):new Uint8Array());
   if(part.last){const bytes=Buffer.concat(row.parts);assert.equal(bytes.length,part.size);assert.equal(createHash('sha256').update(bytes).digest('base64url'),part.hash);row.closed=true;row.value={domain:part.domain,objectId:part.objectId,filename:part.filename,mediaType:part.mediaType,bytes:encodeE2eeBytes(bytes)};}
   queueMicrotask(()=>surface.GenesisAuroraSourceRuntime.resolveChunk(job,value.id,0,true,encode({value:true})));return;
  }
  if(value.kind==='complete-stream'){
   assert.equal(value.protocol,1);assert.ok(results.every(row=>row.closed));
   const content=results.filter(row=>row.header.placement==='remote').map(row=>row.value),localContent=results.filter(row=>row.header.placement==='local').map(row=>row.value);
   assert.equal(value.remoteCount,content.length);assert.equal(value.localCount,localContent.length);
   resolveOutcome({...value,kind:'complete',content,localContent});return;
  }
  if(value.kind==='public-catalogue'){
   requests.push(value);assert.deepEqual(Object.keys(value).sort(),['id','job','kind','path']);assert.ok(!value.path.includes(f.owner));
   if(hold)return;
   let response;const bytes=publicAssets.get(value.path)?.slice();
   if(!bytes)response={error:'E2EE_ADVICE_CATALOGUE_UNAVAILABLE'};
   else{if(corrupt&&!value.path.endsWith('/manifest.json'))bytes[bytes.length-2]^=1;response={value:encodeE2eeBytes(bytes)};}
   queueMicrotask(()=>{const encoded=encode(response);for(let offset=0,index=0;offset<encoded.length;offset+=CHUNK,index++){replyChunks++;surface.GenesisAuroraSourceRuntime.resolveChunk(job,value.id,index,offset+CHUNK>=encoded.length,encoded.slice(offset,offset+CHUNK));}});return;
  }
  if(value.kind!=='open'){resolveOutcome(value);return;}
  requests.push(value);assert.deepEqual(Object.keys(value.envelope).sort(),['ciphertext','iv']);assert.ok(!raw.includes(f.rawKey));
  if(hold)return;
  void(async()=>{
   let response;
   try{if(corrupt)throw new Error('Synthetic AEAD failure');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(value.envelope.iv,'base64'),additionalData:new TextEncoder().encode(`genesis-mindmap-v1:${f.owner}:${value.purpose}`)},f.key,Buffer.from(value.envelope.ciphertext,'base64'));
    response={value:JSON.parse(new TextDecoder().decode(plain))};
   }catch{response={error:'E2EE_LEGACY_AURORA_CORRUPT'};}
   const encoded=encode(response);for(let offset=0,index=0;offset<encoded.length;offset+=CHUNK,index++){replyChunks++;surface.GenesisAuroraSourceRuntime.resolveChunk(job,value.id,index,offset+CHUNK>=encoded.length,encoded.slice(offset,offset+CHUNK));}
  })().catch(error=>resolveOutcome({harnessError:error}));
 };
 surface.GenesisAuroraSourceBridge={postMessage:consume,postChunk(id,index,last,value){outgoingChunks++;if(index===0)chunks.set(id,'');assert.equal(chunks.get(id).length,index*CHUNK);chunks.set(id,chunks.get(id)+value);if(last){const raw=chunks.get(id);chunks.delete(id);consume(raw);}}};
 globalThis.window=surface;
 try{
  const loaded={exports:{}};new Function('require','module','exports',compiled)(id=>calendarModule(resolve('app/aurora',id.endsWith('.ts')?id:id+'.ts')),loaded,loaded.exports);
  const runtime=surface.GenesisAuroraSourceRuntime;
  return await action({runtime,messages,requests,outcome,get outgoingChunks(){return outgoingChunks;},get replyChunks(){return replyChunks;}});
 }finally{surface.GenesisAuroraSourceRuntime?.close();await new Promise(resolve=>setImmediate(resolve));if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
}
function start(runtime,input){const encoded=encode(input);for(let offset=0,index=0;offset<encoded.length;offset+=CHUNK,index++)assert.equal(runtime.append(job,index,offset+CHUNK>=encoded.length,encoded.slice(offset,offset+CHUNK)),true);}
test('the actual native entry reconciles multi-chunk input/RPC/output through the common domain engine',async()=>{
 const f=await fixture(40),before=JSON.stringify(f.input);
 await withRuntime(f,async rig=>{
  start(rig.runtime,f.input);const result=await rig.outcome;assert.equal(result.harnessError,undefined);assert.equal(result.kind,'complete');assert.equal(result.complete,true);
  const main=result.content.find(row=>row.objectId==='personal-aurora-workspace-v1'),value=JSON.parse(new TextDecoder().decode(decodeE2eeBytes(main.bytes,1,16*1024*1024)));
  assert.deepEqual(value.document,f.document);assert.ok(rig.outgoingChunks>2);assert.ok(rig.replyChunks>2);assert.equal(JSON.stringify(f.input),before);
  assert.ok(!JSON.stringify(result).includes(f.rawKey));
 });
});
test('wrong chunk order, foreign jobs and a second start cannot reuse the native capability',async()=>{
 const f=await fixture();await withRuntime(f,async rig=>{
  assert.throws(()=>rig.runtime.append(job,1,true,'a'),/BRIDGE_INVALID/);
  assert.throws(()=>rig.runtime.append('foreign',0,true,'a'),/BRIDGE_INVALID/);
  assert.throws(()=>rig.runtime.append(job,0,false,'a'),/BRIDGE_INVALID/);
  start(rig.runtime,f.input);await rig.outcome;assert.throws(()=>rig.runtime.append(job,0,true,'a'),/RUNTIME_CLOSED/);
 });
});
test('wrong response scope and closing during an outstanding legacy read never produce content',async()=>{
 const f=await fixture();await withRuntime(f,async rig=>{
  start(rig.runtime,f.input);for(let index=0;index<10&&!rig.requests.length;index++)await new Promise(resolve=>setImmediate(resolve));assert.equal(rig.requests.length,1);
  assert.throws(()=>rig.runtime.resolveChunk('foreign',rig.requests[0].id,0,true,encode({value:{}})),/BRIDGE_INVALID/);
  rig.runtime.close();await new Promise(resolve=>setImmediate(resolve));assert.ok(!rig.messages.some(row=>row.kind==='complete'));
  assert.throws(()=>rig.runtime.resolveChunk(job,rig.requests[0].id,0,true,encode({value:{}})),/RUNTIME_CLOSED/);
 },{hold:true});
});
test('altered source headers or an AEAD failure report fixed codes and retain the immutable input',async()=>{
 const binding=await fixture();binding.input.remote.ownerId='foreign';await withRuntime(binding,async rig=>{start(rig.runtime,binding.input);const result=await rig.outcome;assert.equal(result.kind,'error');assert.equal(result.code,'E2EE_SCOPE_BINDING_MISMATCH');assert.equal(rig.requests.length,0);});
 const corrupt=await fixture(),before=JSON.stringify(corrupt.input);await withRuntime(corrupt,async rig=>{start(rig.runtime,corrupt.input);const result=await rig.outcome;assert.equal(result.kind,'error');assert.equal(result.code,'E2EE_LEGACY_AURORA_CORRUPT');assert.ok(!rig.messages.some(row=>row.kind==='complete'));assert.equal(JSON.stringify(corrupt.input),before);},{corrupt:true});
});

async function stoicheionFixture(){
 const f=await fixture(1),value=JSON.parse(readFileSync('tests/fixtures/e2ee/stoicheion-content-v1.json','utf8'));assert.equal(value.synthetic,true);
 const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`genesis-mindmap-v1:${f.owner}:stoicheion-workspace:v1`)},f.key,new TextEncoder().encode(JSON.stringify(value.document)));
 f.local.entries=[];f.local.memory={ownerId:f.owner,legacyKey:'',generation:0,reconciliationRequired:false,current:null,draws:[],timeline:null,nativeDraws:{days:{'2026-10-22':{spread:{seed:123,firstAt:Date.parse('2026-10-22T09:00:00Z'),attempts:2,unlimited:true}}}}};
 f.input.source='stoicheion';f.input.local=encode(f.local);delete f.input.remote.results;
 Object.assign(f.input.remote,{workspace:{iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64'),revision:1,updatedAt:'2026-10-22T09:00:00Z'},draws:[],spreadCards:[],timelineSessions:[],timelineWindows:[]});
 return{...f,expectedDocument:value.document};
}
test('the actual headless entry also migrates real practice and native draw history with only its chosen content domain',async()=>{
 const f=await stoicheionFixture(),before=JSON.stringify(f.input);
 await withRuntime(f,async rig=>{start(rig.runtime,f.input);const result=await rig.outcome;assert.equal(result.kind,'complete');assert.equal(result.complete,true);
  assert.ok(result.content.every(row=>row.domain==='stoicheion'));const document=JSON.parse(new TextDecoder().decode(decodeE2eeBytes(result.content.find(row=>row.objectId==='personal-stoicheion-workspace-v1').bytes)));
  assert.deepEqual(document.document,f.expectedDocument);const history=JSON.parse(new TextDecoder().decode(decodeE2eeBytes(result.content.find(row=>row.objectId==='personal-stoicheion-draw-history-v1').bytes)));
  assert.equal(history.device.native.draws[0].seed,123);assert.ok(!JSON.stringify(history).includes('unlimited'));assert.deepEqual(rig.requests.map(row=>row.purpose),['stoicheion-workspace:v1']);});
 assert.equal(JSON.stringify(f.input),before);
});
test('a foreign domain selector or mismatched keyless snapshot cannot broaden the native source runtime',async()=>{
 for(const source of ['shared-project','unknown','aurora']){const f=await stoicheionFixture();f.input.source=source;
  await withRuntime(f,async rig=>{start(rig.runtime,f.input);const result=await rig.outcome;assert.equal(result.kind,'error');assert.equal(result.content,undefined);});}
});

async function adviceFixture(){
 const f=await fixture(1),entry={...JSON.parse(readFileSync('server/content/daily-advice.json','utf8')).items[0],collection:'aurora'},day='2026-11-19',now=day+'T09:00:00Z';
 const shown=structuredClone(entry);for(const key of ['contentVersion','topics'])delete shown[key];Object.assign(shown,{body:'Synthetic private old advice display',dayKey:day,language:'en',dismissed:false,sequence:1});
 const response={dayKey:day,state:'ready',advice:shown,history:[shown],sequence:1,dailyLimit:9,canNext:true,remaining:8};
 f.local={protocol:1,ownerId:f.owner,scopeId:f.input.context.scopeId,capturedAt:now,generationMarker:null,memory:{ownerId:f.owner,generation:0,reconciliationRequired:false,preferences:null,
  mounted:{language:'en',result:response,selection:entry.id},rendered:[],seen:[],unassignedLegacy:false}};
 f.input.source='advice';f.input.local=encode(f.local);f.input.remote={protocol:1,...f.input.context,legacyGeneration:0,checkpointHash:encodeE2eeBytes(new Uint8Array(32)),directoryRevision:1,
  preferencesJson:'{}',collectionsJson:'["aurora"]',notificationsJson:'{}',psychopompiaJson:'{}',philosophersPerDay:1,
  days:[{dayKey:day,adviceId:entry.id,entryJson:JSON.stringify(entry),createdAt:now,viewedAt:now,dismissedAt:null,selectionJson:'{}'}],entries:[],extraEntries:[],metrics:null};delete f.input.remote.generation;
 return{...f,advice:entry,day};
}

test('actual Advice entry resolves all eighteen exact public editions through bounded native RPC and keeps dates inside its encrypted index',async()=>{
 const f=await adviceFixture(),before=JSON.stringify(f.input);
 await withRuntime(f,async rig=>{start(rig.runtime,f.input);const result=await rig.outcome;assert.equal(result.kind,'complete');assert.equal(result.complete,true);
  assert.equal(result.content.length,4);assert.ok(result.content.every(row=>row.domain==='workspace'&&!row.objectId.includes(f.day)&&!row.objectId.includes(f.advice.id)));
  const decode=row=>JSON.parse(new TextDecoder().decode(decodeE2eeBytes(row.bytes)));
  const index=decode(result.content.find(row=>row.objectId==='personal-advice-history-index-v1'));assert.equal(index.days[0].dayKey,f.day);assert.match(index.days[0].objectId,/^personal-advice-day:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const day=decode(result.content.find(row=>row.objectId===index.days[0].objectId));assert.equal(Object.keys(day.pointer.translations).length,18);
  const history=decode(result.content.find(row=>row.objectId==='personal-advice-local-history-v1'));assert.equal(history.mounted.result.advice.body,'Synthetic private old advice display');assert.equal(history.mounted.result.canNext,undefined);
  assert.equal(rig.requests.length,1+advicePublicLanguages.length);assert.ok(rig.requests.every(row=>row.kind==='public-catalogue'&&publicAssets.has(row.path)&&!row.path.includes(f.advice.id)));assert.ok(rig.replyChunks>rig.requests.length);
 });assert.equal(JSON.stringify(f.input),before);
});

test('changed public Advice bytes and closing a pending public RPC cannot complete migration',async()=>{
 const corrupt=await adviceFixture(),before=JSON.stringify(corrupt.input);
 await withRuntime(corrupt,async rig=>{start(rig.runtime,corrupt.input);const result=await rig.outcome;assert.equal(result.kind,'error');assert.equal(result.code,'E2EE_ADVICE_CATALOGUE_INTEGRITY');assert.equal(result.content,undefined);},{corrupt:true});assert.equal(JSON.stringify(corrupt.input),before);
 const closing=await adviceFixture();await withRuntime(closing,async rig=>{start(rig.runtime,closing.input);
  for(let index=0;index<10&&!rig.requests.length;index++)await new Promise(resolve=>setImmediate(resolve));assert.equal(rig.requests[0].kind,'public-catalogue');
  rig.runtime.close();await new Promise(resolve=>setImmediate(resolve));assert.ok(!rig.messages.some(row=>row.kind==='complete'));
  assert.throws(()=>rig.runtime.resolveChunk(job,rig.requests[0].id,0,true,encode({value:'ignored'})),/RUNTIME_CLOSED/);
 },{hold:true});
});

async function nativeAdviceFixture(){
 const f=await adviceFixture(),{advicePreferences}=calendarModule('app/daily-advice.ts'),preferences=JSON.stringify(advicePreferences({enabled:false}));
 const sha=value=>createHash('sha256').update(value).digest('hex'),hash=sha(`${f.owner}\0en\0${preferences}`),response=f.local.memory.mounted.result;
 const container=body=>({protocol:2,ownerId:f.owner,profiles:{[hash]:{language:'en',preferences,current:{deviceDay:f.day,response:{...response,advice:{...response.advice,body},history:response.history.map(card=>({...card,body}))}},seen:{},legacyOriginal:null}}});
 const record=(kind,value,encrypted='synthetic-native-encrypted-'+kind)=>({kind,revision:1,encrypted,plain:JSON.stringify(value)});
 const oldCipher='synthetic-old-exact-native-ciphertext',kind=`advice-snapshot-v1-${f.day}-aurora-${f.advice.id}`;
 const raw={protocol:1,ownerId:f.owner,scopeId:f.input.context.scopeId,capturedAt:f.local.capturedAt,generation:0,pendingGeneration:null,outbox:[],unknownLegacyCount:0,
  knownProfiles:[{language:'en',preferences}],mounted:{preferences:null,mounted:f.local.memory.mounted},legacy:[{key:hash,value:JSON.stringify({deviceDay:f.day,response})}],
  documents:[record('advice-cache-v2',container('Current private Room cache')),record('advice-cache-history-v2:'+sha(oldCipher),container('Earlier private Room cache'),oldCipher),
   record(kind,{...response,dailyLimit:1,remaining:0,canNext:false}),record('advice-snapshots-v1',{entries:[kind],latest:[{day:f.day,language:'en',kind}],targets:[{day:f.day,kind}],delivered:[f.day]})]};
 f.input.local=encode(raw);return{...f,raw};
}

test('actual native Room/v1 wire shapes are normalized inside the packaged entry with profiles and notification history preserved',async()=>{
 const f=await nativeAdviceFixture(),before=JSON.stringify(f.raw);
 await withRuntime(f,async rig=>{start(rig.runtime,f.input);const result=await rig.outcome;assert.equal(result.kind,'complete');assert.equal(result.complete,true);assert.equal(result.content.length,5);
  const decode=row=>JSON.parse(new TextDecoder().decode(decodeE2eeBytes(row.bytes)));
  const metadata=decode(result.content.find(row=>row.objectId==='personal-advice-native-metadata-v1'));assert.equal(metadata.profiles.length,2);assert.deepEqual(metadata.indexes[0].delivered,[f.day]);assert.equal(metadata.legacy.length,1);
  const history=decode(result.content.find(row=>row.objectId==='personal-advice-local-history-v1'));assert.ok(history.rendered.some(row=>row.response.advice.body==='Current private Room cache'));assert.ok(history.rendered.some(row=>row.response.advice.body==='Earlier private Room cache'));
  for(const forbidden of ['"canNext":','"dailyLimit":','synthetic-old-exact-native-ciphertext'])assert.ok(!JSON.stringify([history,metadata]).includes(forbidden));
  assert.ok(rig.requests.every(row=>row.kind==='public-catalogue'));assert.equal(JSON.stringify(f.raw),before);
 });
});

test('native unknown provenance or changed protected Room lineage is rejected before public RPC',async()=>{
 const provenance=await nativeAdviceFixture();provenance.raw.unknownLegacyCount=1;provenance.input.local=encode(provenance.raw);
 await withRuntime(provenance,async rig=>{start(rig.runtime,provenance.input);const result=await rig.outcome;assert.equal(result.code,'E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED');assert.equal(rig.requests.length,0);});
 const history=await nativeAdviceFixture(),old=structuredClone(history.raw);old.documents[0].revision=0;history.input.previous=[encode(old)];
 await withRuntime(history,async rig=>{start(rig.runtime,history.input);const result=await rig.outcome;assert.equal(result.code,'E2EE_ADVICE_HISTORY_REVIEW_REQUIRED');assert.equal(rig.requests.length,0);});
});
