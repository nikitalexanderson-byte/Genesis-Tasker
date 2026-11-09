import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {AuroraRepository,emptyAuroraDocument}=calendarModule('app/aurora/repository.ts');
const {newSession}=calendarModule('app/aurora/session.ts');
const policy=calendarModule('app/aurora/draw-policy.ts');
const NOW='2026-11-05T09:00:00Z';
function store(){const rows=new Map();return {getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k),rows};}
function fixture(){const database=new Map(),keys=new Map();let offline=false,lostAck=false,locked=false;
 return {database,offline:()=>{offline=true;},online:()=>{offline=false;},loseAck:()=>{lostAck=true;},lock:()=>{locked=true;},
 access(owner){if(!keys.has(owner))keys.set(owner,crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']));
 const check=()=>{if(locked)throw Object.assign(new Error('AUTH_REQUIRED'),{status:401});};
 return {check,async request(path,init={}){check();assert.equal(path,'/aurora-workspace');if(offline)throw new TypeError('Synthetic offline');
  const old=database.get(owner);if((init.method??'GET')==='GET')return {document:old??null};
  const body=JSON.parse(init.body),same=old&&old.iv===body.iv&&old.ciphertext===body.ciphertext&&old.expectedRevision===body.expectedRevision;
  if(same)return {revision:old.revision};if((old?.revision??0)!==body.expectedRevision)throw new Error('AURORA_REVISION_CONFLICT');
  const row={...body,revision:body.expectedRevision+1};database.set(owner,row);if(lostAck){lostAck=false;throw new TypeError('Synthetic lost acknowledgement');}return {revision:row.revision};
 },async seal(value,scope){check();const iv=crypto.getRandomValues(new Uint8Array(12)),key=await keys.get(owner),aad=new TextEncoder().encode(owner+':'+scope);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(JSON.stringify(value)));return {iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(encrypted).toString('base64')};
 },async open(envelope,scope){check();const key=await keys.get(owner),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:new TextEncoder().encode(owner+':'+scope)},key,Buffer.from(envelope.ciphertext,'base64'));return JSON.parse(new TextDecoder().decode(plain));}};
 }};
}
function session(id,owner='a'){
 const primary=policy.snapshotFromSavedDraw({id:'source',seed:123,day:'2026-11-05',createdAt:NOW,cards:policy.expectedSourceDraw(123)});
 return newSession({id,ownerId:owner,now:NOW,primary,timezone:'Europe/Moscow'});
}
test('Encrypted local/cache/remote persistence survives offline reload without plaintext or cross-owner access',async()=>{
 const f=fixture(),disk=store(),repo=new AuroraRepository('a',disk,f.access('a'));await repo.load();const s=session('one');s.observationNote='Private synthetic Aurora reflection';
 await repo.save({...emptyAuroraDocument('a'),sessions:[s]});for(const text of disk.rows.values())assert.ok(!text.includes(s.observationNote));assert.ok(!JSON.stringify([...f.database.values()]).includes(s.observationNote));
 f.offline();const offline=new AuroraRepository('a',disk,f.access('a'));assert.equal((await offline.load()).sessions[0].observationNote,s.observationNote);
 const changed=structuredClone(s);changed.observationNote='New offline synthetic thought';await offline.save({...emptyAuroraDocument('a'),sessions:[changed]});assert.equal(offline.syncState,'offline');
 const reload=new AuroraRepository('a',disk,f.access('a'));assert.equal((await reload.load()).sessions[0].observationNote,changed.observationNote);
 await assert.rejects(f.access('b').open(f.database.get('a'),'aurora-workspace:v1'));
 f.online();await reload.load();assert.equal(f.database.get('a').revision,2);assert.equal(reload.syncState,'saved');
});
test('Lost acknowledgement replays identical envelope without duplicating the revision',async()=>{
 const f=fixture(),disk=store(),repo=new AuroraRepository('a',disk,f.access('a'));await repo.load();f.loseAck();await repo.save({...emptyAuroraDocument('a'),sessions:[session('one')]});assert.equal(repo.syncState,'offline');assert.equal(f.database.get('a').revision,1);
 await new AuroraRepository('a',disk,f.access('a')).load();assert.equal(f.database.get('a').revision,1);
});
test('Independent sessions merge; concurrent edits to one session remain explicit recoverable conflicts',async()=>{
 const f=fixture(),left=new AuroraRepository('a',store(),f.access('a')),rightDisk=store(),right=new AuroraRepository('a',rightDisk,f.access('a'));await left.load();await right.load();
 await left.save({...emptyAuroraDocument('a'),sessions:[session('left')]});const merged=await right.save({...emptyAuroraDocument('a'),sessions:[session('right')]});assert.equal(merged.sessions.length,2);
 const a=new AuroraRepository('a',store(),f.access('a')),bDisk=store(),b=new AuroraRepository('a',bDisk,f.access('a')),adoc=await a.load(),bdoc=await b.load();
 adoc.sessions[0].observationNote='left edit';bdoc.sessions[0].observationNote='right edit';await a.save(adoc);await assert.rejects(b.save(bdoc),/REVISION_CONFLICT/);assert.equal(b.syncState,'conflict');assert.ok([...bDisk.rows.keys()].some(k=>k.endsWith('pending')));
});
test('Deleting saved work survives offline replay, concurrent stale edits and removal of the final work',async()=>{
 const {removeSavedSession}=calendarModule('app/aurora/session.ts');
 const f=fixture(),aDisk=store(),a=new AuroraRepository('a',aDisk,f.access('a'));await a.load();
 await a.save({...emptyAuroraDocument('a'),activeSessionId:'delete-me',sessions:[session('keep'),session('delete-me')]});
 const b=new AuroraRepository('a',store(),f.access('a')),stale=await b.load();
 let doc=removeSavedSession(await a.load(),'delete-me',NOW);await a.save(doc);
 stale.sessions.find(row=>row.id==='delete-me').goalText='Stale device edit';
 const merged=await b.save(stale);assert.deepEqual(merged.sessions.map(row=>row.id),['keep']);assert.equal(merged.activeSessionId,'keep');
 // A writer with the new revision still cannot strip the deletion marker and resurrect it.
 const attempted={...merged,removed:[],sessions:[...merged.sessions,session('delete-me')]};
 assert.deepEqual((await b.save(attempted)).sessions.map(row=>row.id),['keep']);
 f.offline(true);doc=await a.save(removeSavedSession(await a.load(),'keep',NOW));assert.equal(doc.sessions.length,0);assert.equal(a.syncState,'offline');
 f.offline(false);const reloaded=await new AuroraRepository('a',aDisk,f.access('a')).load();assert.equal(reloaded.sessions.length,0);assert.equal(reloaded.removed.length,2);
 assert.equal(reloaded.activeSessionId,undefined);
});

test('Account switch/signout guard blocks delayed encrypted writes',async()=>{
 const f=fixture(),repo=new AuroraRepository('a',store(),f.access('a'));await repo.load();f.lock();await assert.rejects(repo.save({...emptyAuroraDocument('a'),sessions:[session('one')]}),/AUTH_REQUIRED/);assert.equal(f.database.size,0);
});

test('All-upright practice remains readable by version-1 clients and round-trips online and offline',async()=>{
 const {validateDocument,recordExecution}=calendarModule('app/aurora/session.ts');
 const {selectOrganon}=calendarModule('app/aurora/organon.ts'),{chooseSphragis}=calendarModule('app/aurora/sphragis.ts');
 const {ACTIONS}=calendarModule('app/aurora/catalog/actions.ts');
 const f=fixture(),disk=store(),access=f.access('a'),repo=new AuroraRepository('a',disk,access);await repo.load();
 let s=newSession({id:'upright',ownerId:'a',now:NOW,timezone:'Europe/Moscow',primary:policy.snapshotFromSavedDraw({id:'upright-source',seed:270,day:'2026-11-05',createdAt:NOW,cards:policy.expectedSourceDraw(270)})});
 assert.equal(s.observationOnly,true);
 s={...s,stage:7,highestStage:7,guidePage:{stage:7,part:1},curatorId:'athena',goalText:'A manageable step',goalTags:['clarity'],organon:selectOrganon('athena',s.organonPreferences,true),actionOptionIds:[ACTIONS[0].id],selectedActionId:ACTIONS[0].id};
 s.sphragisLetter=chooseSphragis(s.organon.entry.canonicalForm,s.goalTags,s.comfort).letter;
 s=recordExecution(s,{id:'done',forecastId:null,actionId:ACTIONS[0].id,minutes:2,startCondition:'After breakfast',plannedAt:NOW,ritualCompleted:true,actionCompleted:true,completedAt:NOW,actualDescription:'Wrote one next step',withoutRitual:false,taskId:null});
 const doc={...emptyAuroraDocument('a'),activeSessionId:s.id,sessions:[s]};await repo.save(doc);
 const wire=await access.open(f.database.get('a'),'aurora-workspace:v1');
 // The released validator rejects exactly these top-level fields for an upright spread.
 for(const old of wire.sessions)assert.ok(!old.observationOnly||!old.organon&&!old.sphragisLetter&&!old.executions.length);
 await validateDocument(wire,'a');assert.equal(wire.sessions[0].stage,8);
 const loaded=await new AuroraRepository('a',store(),access).load();assert.deepEqual(loaded,doc);
 f.offline();const offline=new AuroraRepository('a',disk,access);const local=await offline.load();local.sessions[0].observationNote='My later observation';await offline.save(local);
 assert.deepEqual(await new AuroraRepository('a',disk,access).load(),local);f.online();await offline.load();
 // A legacy client keeps unknown properties while changing the goal. Its new goal
 // invalidates the active ritual, but the finished practice remains immutable history.
 const legacy=await access.open(f.database.get('a'),'aurora-workspace:v1');legacy.sessions[0].goalText='A different goal';
 const revision=f.database.get('a').revision;const sealed=await access.seal(legacy,'aurora-workspace:v1');
 await access.request('/aurora-workspace',{method:'PUT',body:JSON.stringify({...sealed,expectedRevision:revision})});
 const revised=await new AuroraRepository('a',store(),access).load();assert.equal(revised.sessions[0].organon,null);assert.equal(revised.sessions[0].sphragisLetter,null);
 assert.deepEqual(revised.sessions[0].executions,s.executions);assert.equal(revised.sessions[0].goalText,'A different goal');
});
test('The last active completed journal reopens instead of an older unfinished session',async()=>{
 const f=fixture(),disk=store(),repo=new AuroraRepository('a',disk,f.access('a'));await repo.load();
 const finished=session('finished');finished.completedAt=NOW;
 await repo.save({...emptyAuroraDocument('a'),activeSessionId:finished.id,sessions:[session('older-unfinished'),finished]});
 const restored=await new AuroraRepository('a',disk,f.access('a')).load();assert.equal(restored.activeSessionId,'finished');assert.equal(restored.sessions.find(s=>s.id===restored.activeSessionId).completedAt,NOW);
});
test('Explicit conflict recovery retains both branches including immutable forecast hashes',async()=>{
 const {recordField}=calendarModule('app/aurora/context.ts'),{calculateModel}=calendarModule('app/aurora/model.ts'),{issueForecast}=calendarModule('app/aurora/forecast.ts'),{freezeContext}=calendarModule('app/aurora/session.ts');
 const f=fixture(),a=new AuroraRepository('a',store(),f.access('a'));await a.load();const s=session('issued');
 for(const [field,value]of Object.entries({direct_evidence:false,info_access:true,repetition_known:false,phase_known:true,horizon_basis:'Согласованный срок в учебном примере.',context_confirmed:true,outcome_not_known:true,event_description:'Учебный вопрос ещё не получил ответа.'}))s.context=recordField(s.context,{id:field,field,value,exactUserText:String(value),kind:'reported_event',confirmed:true,beforeInterpretation:true});
 const snapshot=await freezeContext(s,'context',NOW),forecast=await issueForecast({id:'issued-forecast',now:NOW,profile:s.context,primary:s.primary,model:calculateModel(s.primary,s.context,null),contextSnapshotId:snapshot.id,temporalId:null,sectorId:'east',horizon:{mode:'absolute',start:NOW,end:'2026-11-12T09:00:00Z',timezone:'Europe/Moscow'},targetEvent:'Ответственный пришлёт содержательный ответ.',successCriterion:'В ответе приведено применимое правило.',failureCriterion:'Содержательный ответ за период отсутствует.',conditions:['Передан согласованный запрос.'],conditionDeadline:'2026-11-06T09:00:00Z',selectedScenarioId:'east-information-onset',actions:[]});
 assert.equal(forecast.status,'issued');s.forecasts=[forecast];s.contextSnapshots=[snapshot];await a.save({...emptyAuroraDocument('a'),sessions:[s]});
 const b=new AuroraRepository('a',store(),f.access('a')),bd=await b.load(),ad=await a.load();ad.sessions[0].observationNote='Cloud branch';bd.sessions[0].observationNote='Local branch';await a.save(ad);await assert.rejects(b.save(bd),/CONFLICT/);
 const versions=await b.conflictVersions();assert.deepEqual(versions.sessionIds,['issued']);assert.equal(versions.local.sessions[0].observationNote,'Local branch');
 const recovered=await b.recoverAsCopy({issued:'explicit-copy'},'2026-11-05T12:00:00Z');assert.equal(recovered.sessions.length,2);
 assert.equal(recovered.sessions.find(s=>s.id==='issued').observationNote,'Cloud branch');const copy=recovered.sessions.find(s=>s.id==='explicit-copy');assert.equal(copy.observationNote,'Local branch');assert.equal(copy.forecasts[0].payloadHash,forecast.payloadHash);assert.equal(copy.forecasts[0].situationId,'issued');assert.equal(copy.context.situationId,'explicit-copy');assert.equal(b.syncState,'saved');
});
