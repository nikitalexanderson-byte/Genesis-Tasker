import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { calendarModule } from './helpers/calendar-modules.mjs';
import { cloudSyncClient, MemoryStorage, deferred } from './helpers/cloud-sync-client.mjs';
const { DiaryRepository } = calendarModule('app/diary-storage.ts');
const { newDiaryNote, validateDiaryNote, reactToAdvice, restoreDiaryNote, diaryCustomInk, diaryNoteCategory } = calendarModule('app/diary-model.ts');
const advice = { id:'catalog-advice-123', dayKey:'2026-10-26', title:'A useful thought', body:'Private saved advice snapshot', language:'en', categories:['aretology'], dismissed:false, sources:[{work:'Original book',kind:'inspired'}] };
const note = () => newDiaryNote('A private diary thought', 'Private diary title');
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
async function fixture() {
 const a=await cloudSyncClient({userId:'diary-owner'}), b=await cloudSyncClient({userId:a.userId,key:a.key});
 const rows=new Map(), last=new Map(), deleted=new Map(); let writes=0;
 let settings={syncEnabled:true,revision:0},settingsHash='',dreamSettings={todayMode:'off',revision:0};
 const snapshot=async()=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...rows.values()].map(row=>[row.id,row.revision]).sort((a,b)=>a[0]<b[0]?-1:1))))).toString('hex');
 const respond=async(url,init)=>{
  const path=new URL(url).pathname;
  if(path==='/api/diary')return response({notes:[...rows.values()],deleted:[...deleted.values()],settings,snapshot:await snapshot(),dreamSettings});
  if(path==='/api/diary/dream-settings'){
   const body=JSON.parse(init.body);
   if(body.expectedRevision!==dreamSettings.revision)return response({error:'DREAM_SETTINGS_CONFLICT'},409);
   dreamSettings={todayMode:body.todayMode,revision:dreamSettings.revision+1};return response({dreamSettings});
  }
  if(path==='/api/diary/settings'){
   if(init.method==='PUT'){
    const body=JSON.parse(init.body);
    if(settingsHash!==init.body){
     if(body.expectedRevision!==settings.revision)return response({error:'DIARY_SETTINGS_CONFLICT'},409);
     if(body.expectedSnapshot!==await snapshot())return response({error:'DIARY_SNAPSHOT_CHANGED'},409);
     if(!body.syncEnabled){for(const row of rows.values())deleted.set(row.id,{id:row.id,revision:row.revision+1,updatedAt:new Date().toISOString(),localOnly:true});rows.clear();}
     settings={syncEnabled:body.syncEnabled,revision:settings.revision+1};settingsHash=init.body;
    }
   }
   return response({settings,snapshot:await snapshot(),deleted:[...deleted.values()]});
  }
  assert.match(path,/^\/api\/diary\/[\w-]+$/);const id=path.split('/').at(-1),body=JSON.parse(init.body),old=rows.get(id);
  if(init.method==='DELETE'){
   const prior=deleted.get(id);
   if(prior&&prior.revision===body.expectedRevision+1)return response({...prior,deleted:true});
   if(!old||body.expectedRevision!==old.revision)return response({error:'DIARY_REVISION_CONFLICT'},409);
   const marker={id,revision:old.revision+1,updatedAt:new Date().toISOString(),localOnly:false};deleted.set(id,marker);rows.delete(id);return response({...marker,deleted:true});
  }
  if(!settings.syncEnabled)return response({error:'DIARY_SYNC_DISABLED'},409);
  if(deleted.has(id))return response({error:'DIARY_NOTE_DELETED'},409);
  if(last.get(id)===init.body)return response({revision:old.revision,updatedAt:old.updatedAt});
  if(body.expectedRevision!==(old?.revision??0))return response({error:'DIARY_REVISION_CONFLICT'},409);
  writes++;const row={id,revision:body.expectedRevision+1,schemaVersion:1,iv:body.iv,ciphertext:body.ciphertext,updatedAt:new Date().toISOString()};rows.set(id,row);last.set(id,init.body);return response({revision:row.revision,updatedAt:row.updatedAt});
 };
 a.respond(respond);b.respond(respond);const storage=new MemoryStorage(),otherStorage=new MemoryStorage();
 return {a,b,rows,last,deleted,storage,otherStorage,respond,get settings(){return settings;},get writes(){return writes;},
   left:new DiaryRepository(a.userId,storage,a.client.personalDocumentAccess(a.userId)),right:new DiaryRepository(b.userId,otherStorage,b.client.personalDocumentAccess(b.userId))};
}
test('custom palette colors survive encrypted sync and retain a legacy preset fallback', async()=>{
 const f=await fixture(), original={...note(),color:'rose',customColor:'#15aB73'};
 await f.left.save(original);
 const copied=(await f.right.list()).find(row=>row.note.id===original.id).note;
 assert.equal(copied.customColor,'#15aB73');assert.equal(copied.color,'rose');
 assert.equal(validateDiaryNote(restoreDiaryNote(copied)).customColor,'#15aB73');
 for(const customColor of ['red','#123','#12345678','url(secret)',123,{}])assert.throws(()=>validateDiaryNote({...original,customColor}));
 assert.equal(diaryCustomInk('#ffffff'),'#000000');assert.equal(diaryCustomInk('#000000'),'#ffffff');
 assert.equal(diaryCustomInk('#ffff00'),'#000000');assert.equal(diaryCustomInk('#112233'),'#ffffff');
});

test('ordinary diary categories use retained provenance, including edited saved notes and manual copies',()=>{
 const manual={...note(),title:advice.title,body:advice.body};
 const saved=reactToAdvice(advice,'saved-advice','favorite');
 const aphorism=reactToAdvice({...advice,id:'philosopher-advice',collection:'philosophers'},'saved-aphorism','favorite');
 const archived=reactToAdvice(advice,saved.id,'dislike',saved);
 const dream={...note(),dream:{day:'2026-11-07',timeZone:'Europe/Moscow'}};
 const snapshots=[manual,saved,aphorism,archived,dream].map(value=>JSON.stringify(value));
 assert.equal(diaryNoteCategory(manual),'personal','Matching advice text is still a personal note when typed manually');
 for(const value of [saved,aphorism,archived,restoreDiaryNote(archived),{...saved,body:'My own reflection on the saved advice'}])
  assert.equal(diaryNoteCategory(value),'saved');
 assert.equal(diaryNoteCategory({...saved,id:'copy-as-personal',advice:undefined,reaction:null,archived:false}),'personal');
 assert.equal(diaryNoteCategory(dream),null,'Dreams must not enter either ordinary diary category');
 assert.deepEqual([manual,saved,aphorism,archived,dream].map(value=>JSON.stringify(value)),snapshots);
});

test('both diary categories survive existing encrypted synchronization and offline reload without a schema migration',async()=>{
 const f=await fixture();
 const values=[{...note(),body:advice.body},reactToAdvice(advice,'saved-aurora','favorite'),
  reactToAdvice({...advice,id:'philosopher',collection:'philosophers'},'saved-philosopher','favorite'),
  {...note(),dream:{day:'2026-11-07',timeZone:'UTC'}}];
 for(const value of values)await f.left.save(value);
 const remote=await f.right.list();
 for(const value of values)assert.equal(diaryNoteCategory(remote.find(row=>row.note.id===value.id).note),diaryNoteCategory(value));
 assert.equal(remote.filter(row=>diaryNoteCategory(row.note)==='personal').length,1);
 assert.equal(remote.filter(row=>diaryNoteCategory(row.note)==='saved').length,2);
 for(const row of f.rows.values())assert.ok(!Object.hasOwn(row,'category'),'Category is derived, not a new server field');
 f.a.respond(async()=>{throw new TypeError('Offline');});
 const reloaded=new DiaryRepository(f.a.userId,f.storage,f.a.client.personalDocumentAccess(f.a.userId));
 const offline=await reloaded.list();
 assert.equal(offline.filter(row=>diaryNoteCategory(row.note)==='personal').length,1);
 assert.equal(offline.filter(row=>diaryNoteCategory(row.note)==='saved').length,2);
 assert.equal(offline.filter(row=>diaryNoteCategory(row.note)===null).length,1);
});

test('all fourteen diary catalogs contain distinct personal and saved category labels and complete empty states',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../app/diary-copy.json',import.meta.url),'utf8'));
 const languages=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'];
 assert.deepEqual(Object.keys(catalog).sort(),languages.sort());
 for(const [language,copy]of Object.entries(catalog)){
  for(const field of ['personalNotes','savedNotes','categories','emptyPersonal','emptySaved','personalHint','savedHint']){
   assert.ok(typeof copy[field]==='string'&&copy[field].trim(),`${language}:${field}`);
   if(!['ru','sr','uk'].includes(language))assert.doesNotMatch(copy[field],/[А-Яа-яЁё]/u,`${language}:${field}`);
   assert.doesNotMatch(copy[field],/\{[^{}]+\}|\uFFFD/u,`${language}:${field}`);
  }
  assert.notEqual(copy.personalNotes,copy.savedNotes,language);
  assert.notEqual(copy.emptyPersonal,copy.emptySaved,language);
 }
});

test('favorites and dislikes retain the original advice; dislikes archive and can be restored',()=>{
 const favorite=reactToAdvice(advice,'opaque-key','favorite');assert.equal(favorite.reaction,'favorite');assert.equal(favorite.archived,false);
 const unstarred=reactToAdvice(advice,'opaque-key','favorite',favorite);assert.equal(unstarred.reaction,null);assert.equal(unstarred.body,advice.body);
 const disliked=reactToAdvice(advice,'opaque-key','dislike',favorite);assert.equal(disliked.archived,true);assert.equal(disliked.reaction,'dislike');assert.deepEqual(disliked.advice,advice);
 const restored=restoreDiaryNote(disliked);assert.equal(restored.archived,false);assert.equal(restored.reaction,null);assert.equal(restored.id,favorite.id);
 assert.equal(reactToAdvice({...advice,title:'x'.repeat(500)},'opaque-key','favorite').advice.title.length,500);
 for(const change of [{version:2},{body:''},{body:'x'.repeat(30001)},{reaction:'dislike',archived:false},{id:'../escape'}])assert.throws(()=>validateDiaryNote({...favorite,...change}));
});
test('real account encryption protects server envelopes, cache and account-private advice identifiers',async()=>{
 const f=await fixture();await f.left.list();const value=note();await f.left.save(value);assert.deepEqual((await f.right.list())[0].note,value);
 const serialized=JSON.stringify([...f.rows.values()])+JSON.stringify([...f.storage.data.values()]);assert.ok(!serialized.includes(value.body)&&!serialized.includes(value.title));
 assert.ok(f.a.requests.every(row=>!row.url.endsWith('/workspace')));
 const id=await f.left.adviceId(advice.id);assert.equal(id,await f.right.adviceId(advice.id));assert.match(id,/^[0-9a-f]{64}$/);assert.ok(!id.includes(advice.id));
 const other=await cloudSyncClient({userId:'different-owner',key:f.a.key});assert.notEqual(id,await other.client.personalDocumentAccess(other.userId).privateId(`diary-advice:${advice.id}`));
 const access=f.a.client.personalDocumentAccess(f.a.userId),e=await access.seal(value,`diary-note:v1:${value.id}`);
 await assert.rejects(access.open(e,'diary-note:v1:another-id'));await assert.rejects(other.client.personalDocumentAccess(other.userId).open(e,`diary-note:v1:${value.id}`));
});
test('a lost reply reuses the same encrypted attempt after reload and does not duplicate a note',async()=>{
 const f=await fixture();await f.left.list();let lost=true;f.a.respond(async(url,init)=>{const result=await f.respond(url,init);if(init.method==='PUT'&&lost){lost=false;throw new TypeError('Lost reply');}return result;});
 const value=note();await assert.rejects(f.left.save(value));assert.equal(f.writes,1);assert.ok([...f.storage.data.keys()].some(k=>k.includes(':draft:')));
 const reloaded=new DiaryRepository(f.a.userId,f.storage,f.a.client.personalDocumentAccess(f.a.userId));const pending=(await reloaded.list()).find(row=>row.draftKey);assert.deepEqual(pending.note,value);
 await reloaded.save({...value,updatedAt:new Date(Date.now()+1000).toISOString()},pending);assert.equal(f.writes,1);assert.equal((await reloaded.list()).filter(row=>row.draftKey).length,0);
});
test('two tabs keep independent encrypted drafts and conflicts preserve both versions',async()=>{
 const f=await fixture();await f.left.list();const value=note(),saved=await f.left.save(value);const remote=(await f.right.list())[0];
 await f.left.save({...value,body:'First window version'},saved);await assert.rejects(f.right.save({...value,body:'Second window version'},remote),/DIARY_REVISION_CONFLICT/);
 const records=await f.right.list();assert.equal(records.find(row=>!row.draftKey).note.body,'First window version');assert.equal(records.find(row=>row.draftKey).note.body,'Second window version');
 const third=new DiaryRepository(f.a.userId,f.otherStorage,f.b.client.personalDocumentAccess(f.b.userId));await third.keepDraft({...value,body:'Third window draft'},remote);
 assert.equal((await third.list()).filter(row=>row.draftKey).length,2);assert.ok(![...f.otherStorage.data.values()].join('').includes('Second window version'));
});
test('offline drafts survive reload and storage failure prevents an unjournaled network write',async()=>{
 const f=await fixture();await f.left.list();f.a.respond(async()=>{throw new TypeError('Offline');});const value=note();await assert.rejects(f.left.save(value));
 const reloaded=new DiaryRepository(f.a.userId,f.storage,f.a.client.personalDocumentAccess(f.a.userId));assert.equal((await reloaded.list()).find(row=>row.draftKey).note.body,value.body);assert.equal(reloaded.offline,true);
 f.storage.setItem=()=>{throw new Error('Quota');};const before=f.a.requests.length;await assert.rejects(f.left.save({...note(),body:'Another note'}),/Quota/);assert.equal(f.a.requests.length,before);
});
test('a malformed save receipt and a late response after session close retain the encrypted draft',async()=>{
 const f=await fixture();await f.left.list();f.a.respond(async(url,init)=>init.method==='PUT'?response({revision:0,updatedAt:'invalid'}):f.respond(url,init));await assert.rejects(f.left.save(note()),/DIARY_INVALID_RESPONSE/);assert.ok([...f.storage.data.keys()].some(k=>k.includes(':draft:')));
 const g=await fixture();await g.left.list();const gate=deferred(),entered=deferred();g.a.respond(async(url,init)=>{if(init.method==='PUT'){entered.resolve();await gate.promise;}return g.respond(url,init);});const write=g.left.save(note());await entered.promise;g.left.dispose();gate.resolve();await assert.rejects(write,/DIARY_SESSION_CLOSED/);assert.ok([...g.storage.data.keys()].some(k=>k.includes(':draft:')));
});
test('a draft encryption already in flight finishes before save and cannot recreate an acknowledged draft',async()=>{
 const f=await fixture();await f.left.list();const value=note(),gate=f.a.holdCrypto('encrypt');
 const draft=f.left.keepDraft(value);await gate.entered;const save=f.left.save(value);gate.release();await draft;await save;
 assert.equal((await f.left.list()).filter(row=>row.draftKey).length,0);assert.equal(f.writes,1);
});
test('an earlier slow read cannot erase a newly acknowledged note from the encrypted offline cache',async()=>{
 const f=await fixture();await f.left.list();const gate=deferred(),entered=deferred();let slow=true;
 f.a.respond(async(url,init)=>{if(!init.method&&slow){slow=false;entered.resolve();await gate.promise;return response({notes:[]});}return f.respond(url,init);});
 const read=f.left.list();await entered.promise;const value=note();await f.left.save(value);gate.resolve();await read;
 f.a.respond(async()=>{throw new TypeError('Offline');});assert.equal((await f.left.list())[0].note.body,value.body);
});

test('permanent deletion removes archive notes, propagates across devices and blocks stale resurrection',async()=>{
 const f=await fixture();const value={...note(),archived:true};const saved=await f.left.save(value);await f.right.list();
 await f.left.remove(saved);assert.equal(f.rows.size,0);assert.equal((await f.left.list()).length,0);assert.equal((await f.right.list()).length,0);
 await assert.rejects(f.right.save(value,{note:value,revision:1}),/DIARY_NOTE_DELETED/);
 f.a.respond(async()=>{throw new TypeError('Offline');});assert.equal((await f.left.list()).length,0);
 assert.ok(![...f.storage.data.values()].some(value=>value.includes('A private diary thought')));
});
test('a lost delete acknowledgment can be retried without restoring or duplicating a note',async()=>{
 const f=await fixture(),saved=await f.left.save(note());let lost=true;
 f.a.respond(async(url,init)=>{const result=await f.respond(url,init);if(init.method==='DELETE'&&lost){lost=false;throw new TypeError('Lost acknowledgment');}return result;});
 await assert.rejects(f.left.remove(saved));assert.equal(f.rows.size,0);await f.left.remove(saved);assert.equal((await f.left.list()).length,0);
});
test('deleting a stale revision preserves a newer note and requires an explicit new decision',async()=>{
 const f=await fixture(),saved=await f.left.save(note());const other=(await f.right.list())[0];await f.right.save({...other.note,body:'Newer content'},other);
 await assert.rejects(f.left.remove(saved),/DIARY_REVISION_CONFLICT/);assert.equal((await f.left.list())[0].note.body,'Newer content');
});
test('local-only mode keeps encrypted notes, purges the server and allows offline edits without uploads',async()=>{
 const f=await fixture();const saved=await f.left.save(note());await f.right.list();const before=f.writes;
 await f.left.setSyncEnabled(false);assert.equal(f.rows.size,0);assert.equal(f.settings.syncEnabled,false);assert.equal(f.left.syncEnabled,false);
 const offlineCalls=[];f.a.respond(async(url,init)=>{offlineCalls.push([url,init.method]);throw new TypeError('Offline');});
 const local=(await f.left.list()).find(row=>!row.draftKey);await f.left.save({...local.note,body:'Local edit'},local);
 const reopened=new DiaryRepository(f.a.userId,f.storage,f.a.client.personalDocumentAccess(f.a.userId));assert.equal(reopened.syncEnabled,false);assert.equal((await reopened.list())[0].note.body,'Local edit');
 assert.equal(f.writes,before);assert.ok(offlineCalls.every(([url,method])=>url.endsWith('/diary/settings')&&!method));
 const other=(await f.right.list())[0];assert.equal(f.right.syncEnabled,false);await f.right.save({...other.note,body:'Other local edit'},other);assert.equal(f.rows.size,0);
 assert.ok(f.deleted.get(saved.note.id).localOnly);
});
test('explicitly enabling sync uploads local notes once and does not reactivate another device',async()=>{
 const f=await fixture();await f.left.save(note());await f.right.list();await f.left.setSyncEnabled(false);await f.right.list();
 const local=(await f.left.list())[0];await f.left.save({...local.note,body:'Edited locally'},local);
 await f.left.setSyncEnabled(true);assert.equal(f.left.syncEnabled,true);assert.equal(f.rows.size,1);assert.equal(f.left.pendingUploads,0);
 const row=(await f.left.list()).find(row=>!row.draftKey);assert.equal(row.note.body,'Edited locally');assert.notEqual(row.note.id,local.note.id);
 await f.right.list();assert.equal(f.right.syncEnabled,false);assert.equal(f.rows.size,1);
 const calls=f.writes;await f.left.setSyncEnabled(true);assert.equal(f.writes,calls);
});
test('device storage failure prevents disabling synchronization and deleting server notes',async()=>{
 const f=await fixture();await f.left.save(note());const original=f.storage.setItem.bind(f.storage);f.storage.setItem=()=>{throw new Error('Quota exceeded');};
 await assert.rejects(f.left.setSyncEnabled(false));assert.equal(f.rows.size,1);assert.equal(f.settings.syncEnabled,true);f.storage.setItem=original;
});

test('dream flags stay encrypted, deletion cannot resurrect a draft and preference CAS survives reload',async()=>{
 const f=await fixture();await f.left.list();
 const value={...note(),dream:{day:'2026-01-01',timeZone:'UTC',lucid:true},reaction:'favorite'};
 const saved=await f.left.save(value);const wire=JSON.parse(f.last.get(value.id));
 const opened=(await f.right.list())[0];assert.equal(opened.note.dream.lucid,true);assert.equal(opened.note.reaction,'favorite');
 assert.equal(JSON.stringify(wire).includes('lucid'),false);
 assert.deepEqual(wire.dream,{day:'2026-01-01',timeZone:'UTC'});
 const inFlight=f.left.keepDraft({...value,body:'Unfinished dictation'},saved);
 await f.left.discardEditorDraft(value.id);await inFlight;
 assert.equal((await f.left.list()).some(row=>row.draftKey),false);
 await f.left.remove(saved);await assert.rejects(f.left.keepDraft(value,saved),/DIARY_NOTE_DELETED/);
 await f.left.setDreamTodayMode('morning');
 const reloaded=new DiaryRepository(f.a.userId,f.storage,f.a.client.personalDocumentAccess(f.a.userId));
 assert.equal(reloaded.dreamSettings.todayMode,'morning');
 await assert.rejects(f.right.setDreamTodayMode('all-day'),/DREAM_SETTINGS_CONFLICT/);
 await f.right.list();assert.equal(f.right.dreamSettings.todayMode,'morning');
 await f.right.setDreamTodayMode('all-day');await f.left.list();assert.equal(f.left.dreamSettings.todayMode,'all-day');
});
