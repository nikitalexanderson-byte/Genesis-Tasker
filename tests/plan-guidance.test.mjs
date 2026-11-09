import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {applyGuidanceInboxUpdate,contextualGuidance,GUIDANCE_QUIET_MS,GUIDANCE_ERROR_BACKOFF_MS,guidanceWorkspaceQuiet,planGuidanceEligible,planGuidanceWait} from '../app/plan-guidance-model.ts';

const free={uid:'fixture-a',emailVerification:{required:false},featureAccess:{schemaVersion:1,enforcementEnabled:true,effectivePlan:'free',source:'subscription',lifetimePremium:false}};
test('a late read acknowledgement cannot clear a replacement or another account notification',()=>{
  const old={userId:'a',notice:{id:'old'}},replacement={userId:'a',notice:{id:'new'}};
  assert.deepEqual(applyGuidanceInboxUpdate('a',old,{userId:'a',notice:null,readId:'old'}),{userId:'a',notice:null,readId:'old'});
  assert.equal(applyGuidanceInboxUpdate('a',replacement,{userId:'a',notice:null,readId:'old'}),replacement);
  assert.equal(applyGuidanceInboxUpdate('a',replacement,{userId:'b',notice:null}),replacement);
  assert.equal(applyGuidanceInboxUpdate('a',old,replacement),replacement);
});
test('guidance requires a verified canonical FREE profile and fails closed for guests, paid and trial',()=>{
  assert.equal(planGuidanceEligible(free),true);
  for(const user of [null,{...free,uid:''},{...free,emailVerification:undefined},{...free,emailVerification:{required:true}},
    {...free,featureAccess:undefined},{...free,subscriptionPlan:'free',featureAccess:{...free.featureAccess,effectivePlan:'premium'}},
    {...free,featureAccess:{...free.featureAccess,source:'trial'}},{...free,featureAccess:{...free.featureAccess,lifetimePremium:true}},
    {...free,featureAccess:{...free.featureAccess,enforcementEnabled:false}}])assert.equal(planGuidanceEligible(user),false);
});
test('server timestamps establish a bounded monotonic wait independent of the computer clock',()=>{
  const original=Date.now;
  try{
    for(const clock of [0,Date.parse('2100-01-01T00:00:00Z')]){
      Date.now=()=>clock;
      assert.equal(planGuidanceWait('2026-11-09T12:00:00Z','2026-11-06T12:00:00Z'),259200000);
      assert.equal(planGuidanceWait('2026-11-06T12:05:00Z','2026-11-06T12:00:00Z'),300000);
      assert.equal(planGuidanceWait('2026-11-01T12:00:00Z','2026-11-06T12:00:00Z'),GUIDANCE_QUIET_MS);
    }
  }finally{Date.now=original;}
  assert.equal(planGuidanceWait(null,null),GUIDANCE_ERROR_BACKOFF_MS);
  assert.equal(planGuidanceWait('corrupt','corrupt'),GUIDANCE_ERROR_BACKOFF_MS);
  assert.equal(planGuidanceWait('2100-01-01T00:00:00Z','2026-11-06T12:00:00Z'),259200000);
});
test('only explicit quota/feature events become contextual notices; free Google sync and disabled assistant are not sold',()=>{
  assert.deepEqual(contextualGuidance({reason:'quota',resource:'personal-projects'}),{topic:'projects',reason:'quota',resource:'personal-projects'});
  assert.deepEqual(contextualGuidance({reason:'feature',feature:'dream-voice'}),{topic:'dreams',reason:'feature',feature:'dream-voice'});
  assert.deepEqual(contextualGuidance({reason:'feature',feature:'habit-timer'}),{topic:'habits',reason:'feature',feature:'habit-timer'});
  assert.deepEqual(contextualGuidance({reason:'feature',feature:'private/data',resource:'other'}),{topic:'overview',reason:'feature'});
  for(const request of [{},{reason:'compare'},{reason:'trial-expired'},{reason:'feature',feature:'assistant'},{reason:'feature',feature:'calendar-sync'}])assert.equal(contextualGuidance(request),null);
});

function element({visible=true,hidden=false,input=false,children=[]}={}){
  return {getClientRects:()=>visible?[{}]:[],closest:()=>hidden?{}:null,matches:()=>input,contains:child=>children.includes(child)};
}
const quiet=(elements=[],activeElement=null,visibilityState='visible')=>({querySelectorAll:()=>elements,activeElement,visibilityState});
test('dialogs, active controls and visible inline drafts block automatic guidance; hidden surfaces do not',()=>{
  assert.equal(guidanceWorkspaceQuiet(quiet()),true);
  assert.equal(guidanceWorkspaceQuiet(quiet([],null,'hidden')),false);
  assert.equal(guidanceWorkspaceQuiet(quiet([],element({input:true}))),false);
  assert.equal(guidanceWorkspaceQuiet(quiet([element()])),false);
  assert.equal(guidanceWorkspaceQuiet(quiet([element({hidden:true}),element({visible:false})])),true);
  const child=element({input:true}),ownDialog=element({children:[child]});
  assert.equal(guidanceWorkspaceQuiet(quiet([ownDialog,child],child),ownDialog),true);
  assert.equal(guidanceWorkspaceQuiet(quiet([ownDialog,element()],child),ownDialog),false);
});
test('the shared introduction copy has the same complete 13-key contract in all 14 languages',()=>{
  const copy=JSON.parse(readFileSync(new URL('../app/plan-guidance-copy.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(copy).length,14);
  const keys=Object.keys(copy.ru).sort();assert.equal(keys.length,13);
  for(const [language,text]of Object.entries(copy)){
    assert.deepEqual(Object.keys(text).sort(),keys,language);
    for(const [key,value]of Object.entries(text))assert.ok(typeof value==='string'&&value.trim(),`${language}.${key}`);
    assert.ok(text.choose.includes('{plan}'),language);
  }
});
