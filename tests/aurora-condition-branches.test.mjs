import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarModule } from './helpers/calendar-modules.mjs';
const {branchField,evaluateScenarioBranch,validateScenarioBranch,sameFrozenBranch}=calendarModule('app/aurora/condition-branches.ts');
const {createSituation,recordField}=calendarModule('app/aurora/context.ts');
const branch={id:'branch',title:'Reported preconditions',mode:'all',conditions:Array.from({length:8},(_,i)=>({id:`c${i}`,statement:`Observable condition ${i}`}))};
function profileFor(states){return states.reduce((profile,state,i)=>recordField(profile,{id:`e${i}`,field:branchField(branch.id,branch.conditions[i].id),
  value:state==='true',exactUserText:branch.conditions[i].statement,kind:'constraint',confirmed:state!=='unknown',
  beforeInterpretation:false,status:state==='unknown'?'unknown':'known'}),createSituation('s','UTC'));}

test('All 3^8 combinations retain three-valued AND/OR semantics without converting unknown to false',()=>{
 const values=['true','false','unknown'];
 for(let code=0;code<3**8;code++){
  let n=code;const states=Array.from({length:8},()=>{const state=values[n%3];n=Math.floor(n/3);return state;});
  const profile=profileFor(states);
  const all=states.includes('false')?'false':states.every(v=>v==='true')?'true':'unknown';
  const any=states.includes('true')?'true':states.every(v=>v==='false')?'false':'unknown';
  assert.equal(evaluateScenarioBranch(branch,profile).state,all);
  assert.equal(evaluateScenarioBranch({...branch,mode:'any'},profile).state,any);
 }
});

test('Unconfirmed, contradicted or edited conditions cannot silently become a fulfilled branch',()=>{
 let profile=profileFor(Array(8).fill('true'));
 const frozen=evaluateScenarioBranch(branch,profile);assert.equal(frozen.state,'true');assert(sameFrozenBranch(frozen,profile));
 profile.contradictions.push({field:branchField('branch','c0'),evidenceIds:['e0'],resolved:false});
 assert.equal(evaluateScenarioBranch(branch,profile).state,'unknown');assert(!sameFrozenBranch(frozen,profile));
 const edited={...branch,conditions:[{id:'c0',statement:''},...branch.conditions.slice(1)]};
 assert.equal(evaluateScenarioBranch(edited,profileFor(Array(8).fill('true'))).state,'unknown');
 assert.equal(frozen.state,'true');
});

test('Branch validation bounds imported drafts and rejects ambiguous identities',()=>{
 assert.throws(()=>validateScenarioBranch({...branch,conditions:[]}));
 assert.throws(()=>validateScenarioBranch({...branch,conditions:[...branch.conditions,branch.conditions[0]]}));
 assert.throws(()=>validateScenarioBranch({...branch,id:'../other'}));
 assert.throws(()=>validateScenarioBranch({...branch,mode:'maybe'}));
});
