import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {calendarModule} from './helpers/calendar-modules.mjs';
const require=createRequire(import.meta.url),ts=require('typescript');
// Load ordinary modules before installing the isolated native window capability.
calendarModule('app/e2ee/aurora-source.ts');
const {encodeE2eeBytes,decodeE2eeBytes}=calendarModule('app/e2ee/envelope.ts');
const compiled=ts.transpileModule(readFileSync('app/aurora/source-native-entry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const CHUNK=131072,job='44444444-4444-4444-8444-444444444444';
const encode=value=>encodeE2eeBytes(new TextEncoder().encode(JSON.stringify(value)));
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
 const oldWindow=globalThis.window,chunks=new Map(),messages=[],requests=[];let outgoingChunks=0,replyChunks=0;
 let resolveOutcome;const outcome=new Promise(resolve=>resolveOutcome=resolve);const surface={};
 const consume=raw=>{
  const value=JSON.parse(raw);messages.push(value);
  assert.equal(value.job,job);
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
