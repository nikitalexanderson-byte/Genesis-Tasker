import assert from 'node:assert/strict';
import {test} from 'node:test';
import {E2eeMigrationSources,requiredPrivatePaths} from '../app/e2ee/migration-sources.ts';
const bytes=value=>new TextEncoder().encode(value),text=value=>new TextDecoder().decode(value);

function fixture(kind='personal',options={}){
  const sources=new E2eeMigrationSources('owner',`${kind}:one`,kind),calls=[],live=bytes('ORIGINAL LOCAL DATA');
  for(const path of requiredPrivatePaths(kind))sources.register({id:path.id,
    async captureLocal(){calls.push(`capture:${path.id}`);return live;},
    async reconcile(local,previous){calls.push({id:path.id,local:text(local),previous:previous.map(text)});return{complete:options.incomplete!==path.id,
      content:[{domain:path.domains[0],objectId:options.duplicate?'same-id':path.id,bytes:options.alias?local:bytes(`private:${path.id}`)}]};},
  });
  return{sources,calls,live};
}
test('missing and unmounted feature adapters block the snapshot before any partial capture',async()=>{
  const sources=new E2eeMigrationSources('owner','personal:one','personal');let calls=0;
  sources.register({id:requiredPrivatePaths('personal')[0].id,async captureLocal(){calls++;return bytes('local');},async reconcile(){throw new Error('network must not run');}});
  await assert.rejects(sources.captureLocal(),/SOURCE_ADAPTER_REQUIRED/);assert.equal(calls,0);
  assert.throws(()=>sources.register({id:'project.content'}),/INVALID_SOURCE_ADAPTER/);
});
test('all prior protected attempts reach each adapter; captures never mutate live source bytes',async()=>{
  const f=fixture(),first=await f.sources.captureLocal();assert.equal(text(f.live),'ORIGINAL LOCAL DATA');
  const second=await f.sources.captureLocal(),result=await f.sources.reconcile(second,[first]);
  const calls=f.calls.filter(value=>typeof value==='object');assert.equal(calls.length,requiredPrivatePaths('personal').length);
  assert.ok(calls.every(call=>call.local==='ORIGINAL LOCAL DATA'&&call.previous[0]==='ORIGINAL LOCAL DATA'));
  assert.ok(result.coverage.every(row=>row.complete));assert.ok(result.content.every(row=>text(row.bytes).startsWith('private:')));
});
test('foreign owner/scope, missing paths and duplicate object output never activate coverage',async()=>{
  const f=fixture('project'),snapshot=await f.sources.captureLocal();
  const parsed=JSON.parse(text(snapshot));parsed.ownerId='foreign';await assert.rejects(f.sources.reconcile(bytes(JSON.stringify(parsed)),[]),/CORRUPT_SNAPSHOT/);
  parsed.ownerId='owner';parsed.paths.pop();await assert.rejects(f.sources.reconcile(bytes(JSON.stringify(parsed)),[]),/CORRUPT_SNAPSHOT/);
  const duplicate=fixture('personal',{duplicate:true});await assert.rejects(duplicate.sources.reconcile(await duplicate.sources.captureLocal(),[]),/INVALID_SOURCE_RESULT/);
});
test('an incomplete private path remains incomplete and aliased decoded output survives input wiping',async()=>{
  const id=requiredPrivatePaths('space')[0].id,f=fixture('space',{incomplete:id,alias:true});
  const result=await f.sources.reconcile(await f.sources.captureLocal(),[]);
  assert.equal(result.coverage.find(row=>row.domain===id).complete,false);assert.ok(result.content.every(row=>text(row.bytes)==='ORIGINAL LOCAL DATA'));
});
test('resource budgets reject aggregate input and amplified output before making owned content copies',async()=>{
  const f=fixture('space'),snapshot=await f.sources.captureLocal(),oversized=new Uint8Array(64*1024*1024);
  await assert.rejects(f.sources.reconcile(snapshot,Array(9).fill(oversized)),/MIGRATION_HISTORY_LIMIT/);
  const sources=new E2eeMigrationSources('owner','space:one','space'),large=new Uint8Array(4*1024*1024);
  for(const [index,path] of requiredPrivatePaths('space').entries())sources.register({id:path.id,async captureLocal(){return bytes('source');},
    async reconcile(){return{complete:true,content:index===0?Array.from({length:129},(_,i)=>({domain:path.domains[0],objectId:`object-${i}`,bytes:large})):[]};}});
  await assert.rejects(sources.reconcile(await sources.captureLocal(),[]),/MIGRATION_TOO_LARGE/);
  assert.equal(large.length,4*1024*1024);
});
test('shared local-work produces normalized private content and rejects raw remote queue domains',async()=>{
  for(const kind of ['project','space']){
    const f=fixture(kind),result=await f.sources.reconcile(await f.sources.captureLocal(),[]);
    assert.ok(!result.content.some(row=>['draft','outbox','local-snapshot'].includes(row.domain)));
    assert.ok(f.sources.requiredCoverage.includes(`${kind}.local-work`));
    assert.ok(f.sources.allowedContentDomains.includes('shared-project'));
  }
});

test('the registry keeps local-only output separate and rejects a duplicate identity across local and remote placement',async()=>{
 for(const duplicate of [false,true]){
  const sources=new E2eeMigrationSources('owner','personal:one','personal');
  for(const path of requiredPrivatePaths('personal'))sources.register({id:path.id,async captureLocal(){return bytes('Exact source');},async reconcile(){
   const row={domain:path.domains[0],objectId:path.id,bytes:bytes(`private:${path.id}`)};
   return{complete:true,content:path.id==='personal.diary'&&!duplicate?[]:[row],localContent:path.id==='personal.diary'?[row]:[]};
  }});
  const source=await sources.captureLocal();if(duplicate){await assert.rejects(sources.reconcile(source,[]),/INVALID_SOURCE_RESULT/);continue;}
  const result=await sources.reconcile(source,[]);assert.equal(result.localContent.length,1);assert.equal(text(result.localContent[0].bytes),'private:personal.diary');
  assert.ok(!result.content.some(row=>row.objectId==='personal.diary'));assert.equal(result.coverage.length,requiredPrivatePaths('personal').length);
 }
});
