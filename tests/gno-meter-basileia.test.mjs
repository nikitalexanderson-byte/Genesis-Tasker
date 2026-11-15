import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const g=calendarModule('app/aurora/gno-engine.ts');
const sessions=calendarModule('app/aurora/session.ts');
const policy=calendarModule('app/aurora/draw-policy.ts');
const storage=calendarModule('app/aurora/storage-compatibility.ts');
const {mergeAuroraDocuments}=calendarModule('app/aurora/repository.ts');
const {MYTH_TRANSITIONS}=calendarModule('app/aurora/catalog/myths.ts');
const {SECTOR_IDS}=calendarModule('app/aurora/registry.ts');
const NOW='2026-11-15T09:00:00Z';
const snapshot=(seed=123)=>policy.snapshotFromSavedDraw({id:`source-${seed}`,seed,day:'2026-11-15',createdAt:NOW,cards:policy.expectedSourceDraw(seed)});
const answer=(value='yes',detail='A specific reported example')=>({value,detail,at:NOW});
// These fixtures also protect pre-v2 persisted calculations from reinterpretation.
const draft=(overrides={})=>({...g.newGnoDraft(),modelVersion:undefined,guided:undefined,domain:'learning',goal:'Resume piano',episode:'Stopped at bar 12 yesterday',object:'transition between two bars',criterion:'Play the transition three times without stopping',deadline:'2026-12-01',people:'teacher',...overrides});
const known=()=>Object.fromEntries(g.CORE_QUESTIONS.map(key=>[key,answer(key==='repeat'?'no':'yes')]));
const doc=(d=draft(),seed=123)=>({version:1,ownerId:'owner',sessions:[{...sessions.newSession({id:'gno-session',ownerId:'owner',now:NOW,primary:snapshot(seed),timezone:'Europe/Moscow'}),gno:d}],removed:[],activeSessionId:'gno-session'});

test('Thirteen life areas have precise prompts and ten distinct action mechanisms in all fourteen locales',()=>{
 const base=JSON.parse(readFileSync(new URL('../app/aurora/gno-copy.en.json',import.meta.url),'utf8'));
 const flatten=obj=>Object.entries(obj).flatMap(([k,v])=>Array.isArray(v)?v.map((s,i)=>[`${k}.${i}`,s]):[[k,v]]);
 for(const lang of ['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']){
  const copy=JSON.parse(readFileSync(new URL(`../app/aurora/${['ru','en'].includes(lang)?`gno-copy.${lang}.json`:`gno-locales/${lang}.json`}`,import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(copy).sort(),Object.keys(base).sort(),lang);
  assert.equal(copy.domains.length,g.DOMAINS.length);assert.equal(new Set(copy.domainPrompts).size,13);assert.equal(copy.actionBodies.length,g.MECHANISMS.length);
  for(const [key,original]of flatten(base)){
   const text=flatten(copy).find(([k])=>k===key)?.[1];assert.ok(typeof text==='string'&&text.trim(),`${lang}:${key}`);
   assert.deepEqual((text.match(/\{\w+\}/g)??[]).sort(),(original.match(/\{\w+\}/g)??[]).sort(),`${lang}:${key}`);
   assert.doesNotMatch(text,/ZXQ\d+XZ|97500\d579/);
  }
 }
});
test('Conditions precede scores; unknown and unsubstantiated yes never enable a dependent action',()=>{
 const d=draft({answers:{contact:answer('no'),access:answer('no'),consent:answer(),control:answer('yes','')}});
 const rows=g.actionCandidates(d);
 for(const m of ['ask','cooperate','consult'])assert.ok(rows.filter(r=>r.mechanism===m).every(r=>r.blocked.includes('contact')));
 assert.ok(rows.filter(r=>r.mechanism==='trial').every(r=>r.blocked.includes('access')));
 assert.ok(rows.filter(r=>r.mechanism==='boundary').every(r=>r.missing.includes('control')));
 assert.ok(g.diverseActions(d).every(r=>!r.blocked.length));
});
test('The next question only asks about an answer that changes feasible mechanisms',()=>{
 const d=draft({answers:{contact:answer('no'),control:answer('no')}});const questions=[];let next=d;
 while(g.nextQuestion(next)){const key=g.nextQuestion(next);questions.push(key);next=g.answerDraft(next,key,answer('unknown',''));assert.ok(questions.length<=7);}
 assert.ok(!questions.includes('consent'));assert.ok(!questions.includes('reversible'));assert.ok(!questions.includes('repeat'));
 assert.equal(g.nextQuestion(draft({minutes:0})),null);
});

test('A question whose yes answer rules out failed repetition still has decision value',()=>{
 const answers=known();delete answers.repeat;
 const d=draft({answers});
 assert.equal(g.nextQuestion(d),'repeat');
 const repeated=g.answerDraft(d,'repeat',answer('yes','The same attempt failed twice under the same conditions'));
 assert.ok(g.diverseActions(repeated,10).every(row=>!['trial','schedule'].includes(row.mechanism)));
 const fresh=g.answerDraft(d,'repeat',answer('no','This is a new approach'));
 assert.ok(g.diverseActions(fresh,10).some(row=>row.mechanism==='trial'));
 assert.equal(g.nextQuestion(repeated),null);
});
test('Choices span mechanisms and always respect a single time budget over a broad state sweep',()=>{
 let checked=0;
 for(const domain of g.DOMAINS)for(const blocker of g.BLOCKERS)for(const minutes of [0,2,10,30])for(const value of ['yes','no','unknown']){
  const d=draft({domain,blocker,minutes,answers:Object.fromEntries(g.CORE_QUESTIONS.map(k=>[k,answer(k==='repeat'?'no':value,value==='unknown'?'':'Concrete example')]))});
  const rows=g.diverseActions(d,10);assert.equal(new Set(rows.map(r=>r.mechanism)).size,rows.length);
  assert.ok(rows.every(r=>r.minutes<=minutes&&!r.blocked.length&&Number.isFinite(r.regret)&&r.quality>=0&&r.quality<=1));
  if(!minutes)assert.equal(rows.length,0);checked++;
 }
 assert.equal(checked,936);
 const all=g.diverseActions(draft({minutes:30,answers:known()}),10);assert.equal(all.length,10);
});
test('A changed answer preserves its evidence and invalidates the selected plan',()=>{
 const d=draft({answers:{contact:answer()},selectedPlanId:'old'}),next=g.answerDraft(d,'contact',answer('no','The person declined further contact'));
 assert.equal(next.answers.contact.value,'no');assert.equal(next.answerHistory[0].answer.value,'yes');assert.equal(next.selectedPlanId,null);
});
test('Bridge suggestions never activate a resource; exact numerics and identity are distinct',()=>{
 const d=draft({focus:'northwest',support:'east'});assert.equal(g.bridgeStrength(d),0);
 const suggestions=g.suggestedBridges(snapshot(),d);assert.ok(suggestions.length<=3&&suggestions.every(s=>s.source!==d.focus));
 d.answers['resource:east']=answer();assert.equal(g.bridgeStrength(d),0);d.answers['bridge:east:northwest']=answer();assert.equal(g.bridgeStrength(d),1);
 assert.equal(g.bridgeStrength({...d,minutes:0}),0);
 const relation=g.numericRelation('apollo','apollo');assert.equal(relation.index,1);assert.equal(relation.identity,true);
 assert.equal(g.numericRelation('apollo','hermes').identity,false);
});
test('Every myth needs both confirmations AND a documented disconfirmation check',()=>{
 for(const m of MYTH_TRANSITIONS){let d=draft();assert.equal(g.mythStatus(d,m.id),'unknown');
  for(const p of m.activationPredicates)d.answers[`myth:${p.field}`]=answer();
  assert.equal(g.mythStatus(d,m.id),'unknown');
  for(const p of m.disconfirmingPredicates)d.answers[`myth:${p.field}`]=answer('no');
  assert.equal(g.mythStatus(d,m.id),'active');
  d.answers[`myth:${m.disconfirmingPredicates[0].field}`]=answer();assert.equal(g.mythStatus(d,m.id),'blocked');
 }
});
test('Projection retains positions and total mass, including all-upright and all-reversed real draws',()=>{
 const seeds=[123];for(const reversed of [false,true]){let found=-1;for(let seed=0;seed<30000;seed++)if(policy.expectedSourceDraw(seed).every(c=>c.reversed===reversed)){found=seed;break;}assert.notEqual(found,-1);seeds.push(found);}
 for(const seed of seeds){const p=snapshot(seed),before=JSON.stringify(p),d=draft({answers:known()});
  for(const m of MYTH_TRANSITIONS){for(const q of m.activationPredicates)d.answers[`myth:${q.field}`]=answer();for(const q of m.disconfirmingPredicates)d.answers[`myth:${q.field}`]=answer('no');}
  const result=g.semanticProjection(p,d),sum=a=>a.reduce((s,v)=>s+v,0);
  assert.ok(Math.abs(sum(result.base)-sum(result.values))<1e-9);
  assert.ok(result.values.every(v=>v>=0));for(let j=0;j<9;j++)assert.ok(Math.abs(sum(result.matrix.map(row=>row[j]))-1)<1e-10);
  assert.equal(JSON.stringify(p),before);assert.deepEqual(p.cards.map(c=>c.sourcePositionId),SECTOR_IDS);
 }
});
test('Additive records survive encryption codec and merge; issued plans and observations are immutable',async()=>{
 const d=draft(),binding=g.draftBinding(d),plan={id:'plan',createdAt:NOW,binding,mechanism:'observe',minutes:2,title:'Observe',steps:['Record one actual event'],criterion:d.criterion,deadline:d.deadline,fallback:'Review',conditions:[]};
 d.plans=[plan];d.selectedPlanId=plan.id;d.observations=[{id:'observation',at:NOW,planId:'plan',execution:'not_done',outcome:'met',note:'The outcome occurred independently',ritualDone:false}];
 const before=doc(d);await sessions.validateDocument(before,'owner');assert.deepEqual(await storage.decodeAuroraStorage(await storage.encodeAuroraStorage(before)),before);
 const later=structuredClone(before);later.sessions[0].gno.plans[0].criterion='changed';assert.throws(()=>sessions.assertImmutableSession(before.sessions[0],later.sessions[0]),/IMMUTABLE/);
 const local=structuredClone(before),remote=structuredClone(before);local.sessions[0].gno.goal='Local edit';remote.sessions.push({...sessions.newSession({id:'old-session',ownerId:'owner',now:NOW,primary:snapshot(0),timezone:'UTC'})});
 const merged=await mergeAuroraDocuments(before,local,remote);assert.equal(merged.sessions.length,2);assert.equal(merged.sessions[0].gno.goal,'Local edit');
});
test('Malformed drafts and impossible dates fail closed while empty drafts remain readable',async()=>{
 assert.equal(g.readiness(g.newGnoDraft()),false);for(const date of ['2026-02-30','2026-99-01','yesterday',''])assert.equal(g.readiness(draft({deadline:date})),false);
 assert.equal(g.readiness(draft()),true);
 await sessions.validateDocument(doc(g.newGnoDraft()),'owner');
 for(const patch of [{step:9},{minutes:-1},{domain:'unknown'},{answers:{x:{value:'yes',detail:1,at:NOW}}},{plans:[{}]}])await assert.rejects(sessions.validateDocument(doc(draft(patch)),'owner'));
});
