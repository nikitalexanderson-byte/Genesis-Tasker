import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PersonalWorkspaceSource} from '../app/e2ee/workspace-source.ts';
import {prepareWorkspaceForSync} from '../app/workspace-sync-state.ts';
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)),decode=value=>JSON.parse(new TextDecoder().decode(value));
const clock={version:1,updatedAt:'2026-11-18T00:00:00Z',deviceId:'local-device'};
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const project=(id,title=id)=>({id,title,description:'',updatedAt:clock.updatedAt});
const prepared=(current,base=null)=>prepareWorkspaceForSync({current,base,metadata:current.syncMetadata,baseMetadata:base?.syncMetadata,clock}).document;
async function fixture(options={}){
  const raw=crypto.getRandomValues(new Uint8Array(32)),rawKey=Buffer.from(raw).toString('base64');
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);raw.fill(0);
  const seal=async(document,version=1)=>{const iv=crypto.getRandomValues(new Uint8Array(12));return{ciphertext:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes(document))).toString('base64'),
    iv:Buffer.from(iv).toString('base64'),version,updatedAt:clock.updatedAt,minimumWriterProtocol:9};};
  const remoteDoc=options.remote??{projects:[],categories:[]},envelope=options.empty?null:await seal(remoteDoc);
  const remote={protocol:1,ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:context.sourceHash,legacyGeneration:0,
    checkpointHash:'A'.repeat(43),directoryRevision:1,workspace:{keyMode:options.empty?'empty':'account',key:options.empty?null:rawKey,envelope},projects:[],categories:[]};
  const memory={ownerId:'owner',key:rawKey,version:1,deviceId:'local-device',base:options.base??null,baseMetadata:options.base?.syncMetadata??null,
    metadata:options.local?.syncMetadata??null,current:options.current??null,draftSource:null};
  const rows=new Map(),storage={get length(){return rows.size;},key:index=>[...rows.keys()][index]??null,getItem:key=>rows.get(key)??null,
    setItem(){throw new Error('SOURCE_MUTATION');},removeItem(){throw new Error('SOURCE_MUTATION');}};
  if(options.local)rows.set('genesis-calendar-v2:owner',JSON.stringify(options.local));
  let calls=0,open=true,protectedSnapshot=false;
  const source=new PersonalWorkspaceSource('owner','personal:owner',{storage,memory:()=>memory,assertCurrent(){if(!open)throw new Error('SESSION_CHANGED');},
    async legacyWorkspace(actual){assert.ok(protectedSnapshot,'network is forbidden before protected capture');assert.deepEqual(actual,context);calls++;return structuredClone(remote);},review:options.review});
  return{source,rows,memory,remote,rawKey,seal,get calls(){return calls;},lock(){open=false;},
    async capture(){const snapshot=await source.captureLocal();protectedSnapshot=true;return snapshot;},
    async run(previous=[]){return source.reconcile(await this.capture(),previous,context);}};
}

test('real storage capture is read-only, owner-scoped and contains unmounted journals before network',async()=>{
  const f=await fixture({local:{projects:[project('local')],categories:[],tasks:[{id:'task-owned-by-other-adapter'}]}});
  f.rows.set('genesis-calendar-v2:foreign','FOREIGN PRIVATE DATA');
  const pending={key:'workspace:unmounted',path:'/workspace',method:'PUT',body:JSON.stringify(await f.seal(prepared({projects:[project('queue')],categories:[]}))),workspaceBase:await f.seal({projects:[],categories:[]})};
  f.rows.set('genesis-pending-mutations-v2:owner:workspace:workspace:unmounted',JSON.stringify(pending));
  const before=[...f.rows],snapshot=await f.capture();assert.equal(f.calls,0);assert.deepEqual([...f.rows],before);
  assert.ok(!new TextDecoder().decode(snapshot).includes('FOREIGN PRIVATE DATA'));
  const result=await f.source.reconcile(snapshot,[],context),main=decode(result.content[0].bytes);
  assert.equal(result.complete,true);assert.deepEqual(main.projects.map(row=>row.id).sort(),['local','queue']);assert.equal(main.tasks,undefined);
  assert.ok(!JSON.stringify(result.content.map(row=>decode(row.bytes))).includes(f.rawKey));assert.deepEqual([...f.rows],before);
});
test('an explicit local deletion keeps its tombstone and never resurrects unchanged remote content',async()=>{
  const base=prepared({projects:[project('deleted')],categories:[]});
  const f=await fixture({base,remote:base,local:{projects:[],categories:[]}}),result=await f.run(),main=decode(result.content[0].bytes);
  assert.equal(main.projects.length,0);assert.ok(main.syncMetadata.tombstones.some(row=>row.collection==='projects'&&row.id==='deleted'));
});
test('delete against a remote edit blocks until an explicit conflict decision',async()=>{
  const base=prepared({projects:[project('conflict','base')],categories:[]}),remote=prepared({projects:[project('conflict','remote edit')],categories:[]},base);
  const f=await fixture({base,remote,local:{projects:[],categories:[]}});await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);
  const stages=[],review=async(conflicts,stage)=>{stages.push(stage);return Object.fromEntries(conflicts.map(row=>[row.key,'local']));};
  const accepted=await fixture({base,remote,local:{projects:[],categories:[]},review}),result=await accepted.run();
  assert.equal(decode(result.content[0].bytes).projects.length,0);assert.ok(stages.includes('local:0'));
});
test('changed earlier attempts are retained for history review and are never blindly unioned',async()=>{
  const f=await fixture({local:{projects:[project('previous-unsent')],categories:[]}}),old=await f.capture();
  f.rows.set('genesis-calendar-v2:owner',JSON.stringify({projects:[],categories:[]}));
  await assert.rejects(f.run([old]),/HISTORY_REVIEW_REQUIRED/);assert.equal(f.calls,0);assert.equal(decode(old).entries.find(row=>row.key==='genesis-calendar-v2:owner').value.includes('previous-unsent'),true);
});
test('an unscoped legacy cache or queue always needs explicit account attribution',async()=>{
  for(const key of ['genesis-calendar-v1','genesis-pending-mutations-v2']){
    const f=await fixture();f.rows.set(key,'[]');await assert.rejects(f.run(),/ATTRIBUTION_REQUIRED/);assert.equal(f.calls,0);assert.equal(f.rows.get(key),'[]');
  }
});
test('corrupt JSON, missing keys, future writers and legacy tracker projections never become empty data',async()=>{
  const malformed=await fixture();malformed.rows.set('genesis-calendar-v2:owner','{damaged');await assert.rejects(malformed.run(),/SOURCE_INVALID/);
  const missing=await fixture();missing.memory.key='';missing.remote.workspace.keyMode='client';missing.remote.workspace.key=null;await assert.rejects(missing.run(),/LEGACY_KEY_UNAVAILABLE/);
  const changed=await fixture();changed.remote.workspace.envelope.ciphertext=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');await assert.rejects(changed.run(),/WORKSPACE_CORRUPT/);
  const future=await fixture();future.remote.workspace.envelope.minimumWriterProtocol=10;await assert.rejects(future.run(),/FORMAT_UNSUPPORTED/);
  const schema=await fixture({remote:{projects:[],categories:[],trackerSchemaVersion:17}});await assert.rejects(schema.run(),/FORMAT_UNSUPPORTED/);
  const legacy=await fixture({remote:{projects:[],categories:[],habitEntries:[]}});await assert.rejects(legacy.run(),/LEGACY_TRACKER_REVIEW_REQUIRED/);
  const ids=await fixture({remote:{projects:[project('duplicate'),project('duplicate')],categories:[]}});await assert.rejects(ids.run(),/SOURCE_INVALID/);
});
test('server owner, migration, fence, source and account changes invalidate the whole reconciliation',async()=>{
  for(const [field,value] of Object.entries({ownerId:'foreign',scopeId:'personal:foreign',migrationId:'other',fence:6,sourceHash:'B'.repeat(43)})){
    const f=await fixture();f.remote[field]=value;await assert.rejects(f.run(),/SCOPE_BINDING_MISMATCH/);
  }
  const f=await fixture(),snapshot=await f.capture();f.lock();await assert.rejects(f.source.reconcile(snapshot,[],context),/SESSION_CHANGED/);
  const other=await fixture();await assert.rejects(other.source.reconcile(await other.capture(),[],{...context,ownerId:'foreign'}),/SCOPE_BINDING_MISMATCH/);assert.equal(other.calls,0);
});
test('historical relational rows are preserved separately and cannot resurrect deleted current projects',async()=>{
  const f=await fixture({remote:prepared({projects:[],categories:[]})});f.remote.projects=[{id:'stale-project',parent_id:null,category_id:null,title:'Historical title',description:'',tags_json:'[]',status:'active',position:0,created_at:clock.updatedAt,updated_at:clock.updatedAt}];
  const result=await f.run();assert.equal(decode(result.content[0].bytes).projects.length,0);assert.equal(decode(result.content[1].bytes).projects[0].title,'Historical title');
  const empty=await fixture({empty:true});empty.remote.projects=f.remote.projects;const restored=await empty.run();assert.equal(decode(restored.content[0].bytes).projects[0].id,'stale-project');
});
test('raw HTTP queue metadata stays in the protected local snapshot, never in migrated content',async()=>{
  const f=await fixture();f.rows.set('genesis-pending-mutations-v2:owner',JSON.stringify([{key:'task:one',path:'/tasks/one',method:'PUT',body:'SYNTHETIC SESSION AUTHORITY MUST STAY LOCAL'}]));
  const result=await f.run();assert.ok(result.content.every(row=>!new TextDecoder().decode(row.bytes).includes('SESSION AUTHORITY')));
  const corrupt=await fixture();corrupt.rows.set('genesis-pending-mutations-v2:owner','{"not":"array"}');await assert.rejects(corrupt.run(),/SOURCE_INVALID/);
});
test('a stale persisted cache cannot imply deletion of a different mounted editor or sync base',async()=>{
  const f=await fixture({local:{projects:[],categories:[]},current:{projects:[project('mounted-unsaved')],categories:[]}});
  await assert.rejects(f.run(),/LOCAL_BASE_REVIEW_REQUIRED/);
  const bases=await fixture({base:{projects:[project('memory')],categories:[]},local:{projects:[],categories:[]}});
  bases.rows.set('genesis-workspace-sync-state-v1:owner',JSON.stringify({version:2,base:{projects:[project('persisted')],categories:[]},baseMetadata:null,metadata:null}));
  await assert.rejects(bases.run(),/LOCAL_BASE_REVIEW_REQUIRED/);
});
test('conflict review rejects unknown choices instead of treating any truthy value as consent',async()=>{
  const base=prepared({projects:[project('choice','base')],categories:[]}),remote=prepared({projects:[project('choice','remote')],categories:[]},base);
  const f=await fixture({base,remote,local:{projects:[],categories:[]},review:async conflicts=>Object.fromEntries(conflicts.map(row=>[row.key,'anything']))});
  await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);
});
test('the persisted document alone retains its deletion metadata when no in-memory sync cache is mounted',async()=>{
  const base=prepared({projects:[project('removed-offline')],categories:[]}),local=prepared({projects:[],categories:[]},base);
  const f=await fixture({remote:base,local,review:async conflicts=>{
    assert.ok(conflicts.some(row=>row.local===null));return Object.fromEntries(conflicts.map(row=>[row.key,'local']));
  }});f.memory.metadata=null;
  const main=decode((await f.run()).content[0].bytes);assert.equal(main.projects.length,0);assert.ok(main.syncMetadata.tombstones.some(row=>row.id==='removed-offline'));
});
test('migration rejects malformed or unknown event fields instead of accepting lossy feature projections',async()=>{
  for(const collection of ['habitMeasurements','habitTimers','habitHistory']){
    const f=await fixture({remote:{projects:[],categories:[],[collection]:[{id:'event',futurePrivateField:'must survive'}]}});
    await assert.rejects(f.run(),/EVENT_REVIEW_REQUIRED/);
  }
});
test('large valid legacy ciphertext does not overflow a base64 parser stack',async()=>{
  const f=await fixture({remote:{projects:[project('large','x'.repeat(512*1024))],categories:[]}});
  assert.equal(decode((await f.run()).content[0].bytes).projects[0].title.length,512*1024);
});
