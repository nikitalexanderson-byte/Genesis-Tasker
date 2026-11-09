import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { calendarModule } from "./helpers/calendar-modules.mjs";
import { cloudSyncClient, MemoryStorage } from "./helpers/cloud-sync-client.mjs";

const model = calendarModule("app/stoicheion-restoration-strategy.ts");
const commit = calendarModule("app/stoicheion-restoration-commit.ts");
const { EMPTY_HABIT_WORKSPACE } = calendarModule("app/habits.ts");
const { RESTORATION_SECTORS, RESTORATION_LETTER_FOCI, RESTORATION_AUXILIARIES } = calendarModule("app/stoicheion-restoration-data.ts");
const { SACRED_PRACTICES } = calendarModule("app/sacred-practices.ts");
const { restorationLocal, restorationCopy } = calendarModule("app/stoicheion-restoration-copy.ts");
const languages = ["ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"];
const options = {today:"2026-10-22",startedAt:"2026-10-22T10:00:00Z",calendarMode:"sacred",language:"ru"};
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const source = {version:1,sourceDate:"2026-10-22",sourceSeed:305419896,
    cards:["mu","psi","omega","theta","upsilon","chi","omicron","pi","beta"].map((letterId,index) => ({letterId,reversed:index%2===0})),activeSectorId:"northwest",plans:{}};
  for (const id of model.reversedSectors(source)) {
    const guidance = RESTORATION_SECTORS.find(item => item.id===id).needs.conflict;
    const plan = {need:"conflict",supportIds:[guidance.supportId],resourceLetterId:"",intention:guidance.intention.ru,linkedHabitId:"",step:3,prepared:true,touched:true};
    plan.resourceLetterId = model.restorationPlanEquation(source,id,plan).candidates[0].id;
    source.plans[id] = plan;
  }
  return source;
}
function workspace() { return clone(EMPTY_HABIT_WORKSPACE); }

test("every reversed card has its own validated draft and choices survive serialization", () => {
  const draft = fixture();
  draft.plans.northwest.intention="Моё собственное намерение";
  draft.activeSectorId="southeast";
  const recovered=model.validateRestorationStrategy(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(recovered,draft);
  recovered.plans.northwest.supportIds.push("exit");
  assert.notDeepEqual(recovered.plans.northwest.supportIds,draft.plans.northwest.supportIds);
  assert.equal(model.restorationPreparedCount(draft,[]),5);
  for (const mutate of [value=>{value.cards[0].letterId="beta";},value=>{value.plans.northwest.resourceLetterId="nonexistent";},value=>{delete value.plans.southeast;},value=>{value.sourceDate="2026-02-30";}]) {
    const invalid=clone(draft);mutate(invalid);assert.throws(()=>model.validateRestorationStrategy(invalid));
  }
});
test("saving the whole strategy creates all practices atomically, preserves the draw, and prevents duplicates", () => {
  const source=fixture(),before=workspace(),original=clone(before);
  const result=commit.materializeRestorationStrategy(source,before,options);
  assert.deepEqual(before,original);
  assert.equal(result.habits.length,5);
  for(const habit of result.habits){assert.deepEqual(habit.stoicheionRestoration.cards,source.cards);assert.equal(habit.stoicheionRestoration.sourceSeed,source.sourceSeed);assert.equal(habit.schedule.recurrence.enabled,true);}
  assert.equal(commit.materializeRestorationStrategy(source,result,options).habits.length,5);
  const partial={...result,habits:result.habits.slice(0,2),stoicheionWorks:result.stoicheionWorks.slice(0,2)};
  assert.equal(commit.materializeRestorationStrategy(source,partial,options).habits.length,5);
  const invalid=clone(source);invalid.plans.southeast.prepared=false;
  assert.throws(()=>commit.materializeRestorationStrategy(invalid,before,options),/INCOMPLETE/);
  assert.deepEqual(before,original);
  assert.throws(()=>commit.materializeRestorationStrategy(source,{...before,habitSettings:{...before.habitSettings,enabled:false}},options),/DISABLED/);
});

const work = calendarModule("app/stoicheion-restoration-work.ts");
const {RestorationRepository}=calendarModule("app/stoicheion-restoration-storage.ts");
async function archiveClients() {
  const first=await cloudSyncClient({userId:"restoration-qa"});
  let document=null,last=null;
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
  const respond=async(url,init)=>{
    assert.equal(new URL(url).pathname,"/api/stoicheion-workspace");
    if(init.method!=="PUT")return response({document});
    const body=JSON.parse(init.body);
    if(init.body===last)return response({revision:document.revision});
    if(body.expectedRevision!==(document?.revision??0))return response({error:"RESTORATION_REVISION_CONFLICT"},409);
    last=init.body;document={iv:body.iv,ciphertext:body.ciphertext,revision:body.expectedRevision+1};
    return response({revision:document.revision});
  };
  first.respond(respond);
  const second=await cloudSyncClient({userId:first.userId,key:first.key});second.respond(respond);
  const storage=new MemoryStorage();
  return {first,second,storage,respond,get document(){return document;},
    a:new RestorationRepository(first.userId,storage,first.client.personalDocumentAccess(first.userId)),
    b:new RestorationRepository(second.userId,new MemoryStorage(),second.client.personalDocumentAccess(second.userId))};
}
const independentDocument=()=>{
  const source=fixture();for(const plan of Object.values(source.plans))plan.withoutHabit=true;
  return {version:1,works:commit.materializeRestorationStrategy(source,workspace(),options).stoicheionWorks,removed:[]};
};

test("the independent encrypted archive survives another client and reload without changing the legacy workspace",async()=>{
  const fixture=await archiveClients();await fixture.a.load();
  const initial=independentDocument();await fixture.a.save(initial);
  assert.deepEqual(await fixture.b.load(),initial);
  assert.ok(!JSON.stringify(fixture.document).includes(initial.works[0].snapshot.intention));
  assert.ok(fixture.first.requests.every(row=>!row.url.endsWith('/workspace')));
  const reloaded=new RestorationRepository(fixture.first.userId,new MemoryStorage(),fixture.first.client.personalDocumentAccess(fixture.first.userId));
  assert.deepEqual(await reloaded.load(),initial);
});

test("a lost archive acknowledgement replays the same encrypted request after reload, without another revision",async()=>{
  const fixture=await archiveClients();await fixture.a.load();
  let lost=true;fixture.first.respond(async(url,init)=>{const result=await fixture.respond(url,init);if(init.method==='PUT'&&lost){lost=false;throw new TypeError('Synthetic lost response');}return result;});
  const initial=independentDocument();await assert.rejects(fixture.a.save(initial));
  assert.equal(fixture.document.revision,1);assert.equal(fixture.storage.length,1);
  assert.ok(![...fixture.storage.data.values()].join('').includes(initial.works[0].snapshot.intention));
  const reloaded=new RestorationRepository(fixture.first.userId,fixture.storage,fixture.first.client.personalDocumentAccess(fixture.first.userId));
  assert.deepEqual(await reloaded.load(),initial);assert.equal(fixture.document.revision,1);assert.equal(fixture.storage.length,0);
});

test("independent archive edits merge, explicit deletions win, and conflicting final notes keep an encrypted recovery copy",async()=>{
  const fixture=await archiveClients();await fixture.a.load();const initial=independentDocument();await fixture.a.save(initial);await fixture.b.load();
  const left=clone(initial);left.works[0].snapshot.reflection='Наблюдение слева';await fixture.a.save(left);
  const right=clone(initial);right.works[1].snapshot.reflection='Наблюдение справа';await fixture.b.save(right);
  let merged=await fixture.a.load();assert.equal(merged.works[0].snapshot.reflection,'Наблюдение слева');assert.equal(merged.works[1].snapshot.reflection,'Наблюдение справа');
  await fixture.b.load();const conflict=clone(merged);conflict.works[0].snapshot.reflection='Из другого окна';await fixture.b.save(conflict);
  merged.works[0].snapshot.reflection='Мой несохранённый итог';await assert.rejects(fixture.a.save(merged),/CONFLICT/);
  assert.equal(fixture.a.conflict,true);assert.equal(fixture.storage.length,1);
  const restored=await fixture.a.keepPending();assert.equal(restored.works[0].snapshot.reflection,'Мой несохранённый итог');
  assert.equal(fixture.storage.length,0);
  const combined={...workspace(),stoicheionWorks:restored.works,stoicheionRemovedWorks:[]};
  const deleted=work.deleteRestorationWork(combined,restored.works[0],'2026-11-02');
  await fixture.a.save({version:1,works:deleted.stoicheionWorks,removed:deleted.stoicheionRemovedWorks});
  assert.equal((await fixture.b.load()).works.length,4);
});
test("a strategy without habits saves all choices, completes independently, and freezes the final reflection in the archive", () => {
  const source=fixture(); for(const plan of Object.values(source.plans))plan.withoutHabit=true;
  const before=workspace(), saved=commit.materializeRestorationStrategy(source,{...before,habitSettings:{...before.habitSettings,enabled:false}},options);
  assert.equal(saved.habits.length,0);assert.equal(saved.stoicheionWorks.length,5);
  assert.equal(commit.materializeRestorationStrategy(source,saved,options).stoicheionWorks.length,5);
  const row=saved.stoicheionWorks[0];
  assert.equal(row.deadline,"2026-10-31","The work window is independent of the two-day creation window");
  const tomorrow=commit.materializeRestorationStrategy(source,before,{...options,today:"2026-10-23",startedAt:"2026-10-23T12:00:00Z"});
  assert.equal(tomorrow.stoicheionWorks[0].deadline,"2026-11-01");
  const observed=work.reflectRestorationWork(saved,row,"Наблюдение до поступка",options.today,options.startedAt);
  assert.equal(observed.stoicheionWorks.find(item=>item.id===row.id).archivedAt,null);
  const completed=work.completeRestorationWork(observed,row,options.today);
  const current=completed.stoicheionWorks.find(item=>item.id===row.id);
  const archived=work.reflectRestorationWork(completed,current,"Итог: действие выполнено",options.today,"2026-10-22T12:00:00Z");
  const frozen=archived.stoicheionWorks.find(item=>item.id===row.id);
  assert.equal(frozen.archivedAt,"2026-10-22T12:00:00Z");assert.equal(frozen.snapshot.reflection,"Итог: действие выполнено");
  assert.deepEqual(frozen.snapshot.cards,source.cards);assert.deepEqual(frozen.completionDates,[options.today]);
  assert.deepEqual(work.normalizeRestorationWorks(clone(archived.stoicheionWorks)),archived.stoicheionWorks);
  assert.throws(()=>work.completeRestorationWork(archived,frozen,options.today),/CLOSED/);
  assert.throws(()=>work.deleteRestorationWork(archived,frozen,"2026-10-25"),/NOT_EXPIRED/);
  assert.deepEqual(before,workspace());
});

test("expired work deletion keeps habits and their full history, and cannot reappear through legacy projection", () => {
  const saved=commit.materializeRestorationStrategy(fixture(),workspace(),options);
  const row=work.restorationWorks(saved,"2026-10-25")[0];
  const deleted=work.deleteRestorationWork(saved,row,"2026-10-25");
  assert.deepEqual(deleted.habits,saved.habits);assert.deepEqual(deleted.habitCompletions,saved.habitCompletions);
  assert.ok(!work.restorationWorks(deleted,"2026-10-25").some(item=>item.id===row.id));
  assert.equal(deleted.stoicheionRemovedWorks[0].id,row.id);
  assert.throws(()=>work.deleteRestorationWork(saved,row,options.today),/NOT_EXPIRED/);
  assert.throws(()=>commit.materializeRestorationStrategy(fixture(),workspace(),{...options,today:"2026-10-25"}),/EXPIRED/);
});

test("legacy linked practice archives preserve completion notes and remain immutable after habit edits", () => {
  const {updateHabitCompletion}=calendarModule("app/habits.ts");
  let saved=commit.materializeRestorationStrategy(fixture(),workspace(),options);
  const habit=saved.habits[0];
  saved=updateHabitCompletion(saved,habit,options.today,{completed:true,note:"Факт поступка"},options.today);
  // A legacy client stores its reflection in the habit; the independent archive freezes it on final save.
  const row=work.restorationWorks(saved,options.today)[0];
  assert.equal(row.completionDates.length,1);
  const archived=work.reflectRestorationWork(saved,row,"Полный итог",options.today,"2026-10-22T14:00:00Z");
  const frozen=archived.stoicheionWorks.find(item=>item.id===row.id);
  assert.equal(frozen.completionEntries[0].note,"Факт поступка");
  const edited={...archived,habits:archived.habits.map(item=>({...item,stoicheionRestoration:{...item.stoicheionRestoration,reflection:"Иное"}}))};
  assert.equal(work.restorationWorks(edited,"2026-10-25").find(item=>item.id===row.id).snapshot.reflection,"Полный итог");
  assert.throws(()=>work.validateRestorationDocument({version:1}),/INVALID/);
  assert.throws(()=>work.normalizeRestorationWorks([{...frozen,completionDates:[]}]),/INVALID/);
});
test("provenance compares all nine cards, and saved copies remain independent", () => {
  const source=fixture(),saved=commit.materializeRestorationStrategy(source,workspace(),options);
  const snapshot=saved.habits[0].stoicheionRestoration;
  const another=clone(source);another.cards[1].reversed=!another.cards[1].reversed;
  assert.equal(model.snapshotMatchesSource(snapshot,another),false);
  const copy={...clone(saved.habits[0]),id:crypto.randomUUID()};
  const withCopy={...saved,habits:[...saved.habits,copy]};
  const result=commit.materializeRestorationStrategy(source,withCopy,options);
  assert.equal(result.habits.length,6);assert.equal(result.habits.filter(habit=>habit.stoicheionRestoration.cycleId===snapshot.cycleId).length,2);
});
test("one existing habit cannot be assigned to two different cards", () => {
  const source=fixture(),before=workspace();
  const initial=commit.materializeRestorationStrategy(source,before,options).habits[0];
  const habit={...initial,id:crypto.randomUUID(),stoicheionRestoration:undefined,practiceGoal:null,sacredPracticeId:null,sacredSectorId:null};
  const [a,b]=model.reversedSectors(source);source.plans[a].linkedHabitId=habit.id;source.plans[b].linkedHabitId=habit.id;
  assert.throws(()=>commit.materializeRestorationStrategy(source,{...before,habits:[habit]},options),/DUPLICATE_HABIT/);
  assert.equal(habit.stoicheionRestoration,undefined);
});
test("all 14 languages cover every recommendation, preserve source indexes, and fit saved snapshots", () => {
  const sources=new Map();
  const collect=value=>{if(!value||typeof value!=="object")return;if(typeof value.ru==="string"&&typeof value.en==="string"){if(!sources.has(value.en))sources.set(value.en,value);}else Object.values(value).forEach(collect);};
  const content=JSON.parse(readFileSync(new URL("../app/stoicheion-restoration-content.json",import.meta.url),"utf8"));collect(content);
  const helpers=RESTORATION_AUXILIARIES.map(item=>SACRED_PRACTICES.find(practice=>practice.id===item.practiceId));helpers.forEach(helper=>{collect(helper.title);collect(helper.description);});
  const sourceHash=createHash("sha256").update(JSON.stringify([...sources.keys()])).digest("hex");
  const keys=Object.keys(restorationCopy("en")).sort();
  for(const language of languages){
    const copy=restorationCopy(language);assert.deepEqual(Object.keys(copy).sort(),keys,language);
    for(const text of Object.values(copy))assert.ok(typeof text==="string"&&text.trim(),language);
    if(!["ru","en"].includes(language)){
      const locale=JSON.parse(readFileSync(new URL(`../app/stoicheion-restoration-locales/${language}.json`,import.meta.url),"utf8"));
      assert.equal(locale.sourceHash,sourceHash,language);assert.equal(locale.values.length,sources.size,language);
    }
    for(const text of sources.values()){
      const localized=restorationLocal(text,language);assert.ok(localized?.trim(),`${language}: ${text.en}`);
      if(!["ru","en"].includes(language))assert.notEqual(localized,text.en,`${language}: English fallback: ${text.en}`);
      assert.doesNotMatch(localized,/ZXQ|⟦\d+⟧|〔\d+〕|\bTODO\b/u,language);
      if(!["ru","sr","uk"].includes(language))assert.doesNotMatch(localized,/\p{Script=Cyrillic}/u,language);
    }
    const helperText=helpers.map(helper=>`${restorationLocal(helper.title,language)}: ${restorationLocal(helper.description,language)}`).join("\n\n");
    for(const sector of RESTORATION_SECTORS)for(const need of ["deficit","excess","conflict"])for(const focus of Object.values(RESTORATION_LETTER_FOCI)){
      const action=[restorationLocal(sector.needs[need].action,language),restorationLocal(focus.needs[need].action,language),helperText].join("\n\n");
      assert.ok(action.length<=1600,`${language}: ${sector.id}/${need}: ${action.length} > 1600`);
    }
  }
});


test("reading practices append beside the standard pair, and deleting one leaves other cycles intact", () => {
  const habits = calendarModule("app/habits.ts");
  const lifecycle = calendarModule("app/habit-lifecycle.ts");
  const factory = calendarModule("app/stoicheion-restoration-habits.ts");
  const sector = "northwest";
  const pair = SACRED_PRACTICES.filter(item => item.sectorId === sector).map(item => habits.createHabitFromSacredPractice(item, options.today, "sacred", "ru"));
  assert.equal(pair.length, 2);
  const before = {...workspace(), habits: pair};
  const first = commit.materializeRestorationStrategy(fixture(), before, options);
  const another = fixture(); another.sourceSeed += 1;
  const second = commit.materializeRestorationStrategy(another, first, options);
  for (const standard of pair) {
    assert.deepEqual(second.habits.find(row => row.id === standard.id), standard);
    assert.equal(factory.isEligibleRestorationHabit({...standard, practiceGoal: null}), false);
    assert.equal(habits.findStandardSacredHabit(second.habits, standard.sacredPracticeId).id, standard.id);
  }
  const extra = habits.additionalSacredHabits(second.habits, sector);
  assert.equal(extra.length, 2);
  assert.notEqual(extra[0].id, extra[1].id);
  const deleted = lifecycle.applyHabitLifecycleCommand(extra[0], {id:"delete-extra",habitId:extra[0].id,action:"delete",at:options.startedAt,heads:lifecycle.habitLifecycleState(extra[0]).heads.map(row=>row.id)});
  const after = second.habits.map(row => row.id === deleted.id ? deleted : row);
  assert.equal(habits.additionalSacredHabits(after,sector).length, 1);
  assert.equal(habits.findStandardSacredHabit(after,pair[0].sacredPracticeId).id,pair[0].id);
});

test("permanent archive deletion wins over another client's stale edit and drops its private payload",async()=>{
 const fixture=await archiveClients();await fixture.a.load();
 const initial=independentDocument(),row=initial.works[0];
 row.requiredCompletions=1;row.completionDates=[row.snapshot.startedDate];row.archivedAt='2026-10-22T12:00:00Z';row.snapshot.reflection='Final private note';
 await fixture.a.save(initial);await fixture.b.load();
 const current={...workspace(),stoicheionWorks:initial.works,stoicheionRemovedWorks:[]};
 const removed=work.deleteArchivedRestorationWorks(current,[row],'2026-11-06T12:00:00Z');
 assert.deepEqual(removed.habits,current.habits);assert.equal(removed.stoicheionWorks.some(item=>item.id===row.id),false);
 await fixture.a.save({version:1,works:removed.stoicheionWorks,removed:removed.stoicheionRemovedWorks});
 const stale=clone(initial);stale.works[0].snapshot.reflection='Stale private note';
 const merged=await fixture.b.save(stale);assert.equal(merged.works.some(item=>item.id===row.id),false);
 assert.equal(JSON.stringify(merged).includes('private note'),false);assert.ok(merged.removed.some(item=>item.id===row.id));
 const normalized=work.validateRestorationDocument({...initial,removed:merged.removed});assert.equal(normalized.works.some(item=>item.id===row.id),false);
 assert.throws(()=>work.deleteArchivedRestorationWorks(current,[{...row,archivedAt:null}]),/NOT_ARCHIVED/);
});
