import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const harmony=calendarModule('app/aurora/draw-harmony.ts');
const {makePrimarySnapshot}=calendarModule('app/aurora/spread.ts');
const {SECTOR_IDS}=calendarModule('app/aurora/registry.ts');
const {createTemporalTriad}=calendarModule('app/aurora/draw-policy.ts');
const ids=['zeta','omega','pi','upsilon','kappa','gamma','nu','xi','tau'];
const source=()=>makePrimarySnapshot({id:'actual-nine',sourceDay:'2026-11-06',sourceSeed:2,createdAt:'2026-11-06T09:00:00Z',cards:ids.map((cardId,i)=>({cardId,positionId:SECTOR_IDS[i],reversed:i%2===0}))});
test('the displayed 1720 → 10 → 1 includes all nine letters, including zero-mass Kronos',()=>{
 const value=harmony.drawHarmony(source());
 assert.equal(value.total,1720);assert.equal(value.pythmen,1);assert.equal(value.sourceSnapshotId,'actual-nine');
 const reversed=source();reversed.cards=reversed.cards.map(card=>({...card,orientation:card.orientation==='upright'?'reversed':'upright'}));
 assert.deepEqual(harmony.drawHarmony(reversed),value);
});
test('the actual temporal triad supplements the numerical term without changing the nine-card root',()=>{
 const base=harmony.drawHarmony(source());
 const triad=createTemporalTriad({id:'actual-three',seed:123,createdAt:'2026-11-06T10:00:00Z'});
 const combined=harmony.drawHarmony(source(),triad);
 assert.equal(combined.total,base.total);assert.equal(combined.pythmen,base.pythmen);
 assert.ok(combined.temporalTotal>0);assert.ok(combined.temporalPythmen>=1&&combined.temporalPythmen<=9);
 assert.notEqual(harmony.unifiedSuitability(.5,combined,4),harmony.unifiedSuitability(.5,base,4));
});
test('one bounded suitability formula uses the root and rejects inconsistent imported arithmetic',()=>{
 const draw=harmony.drawHarmony(source());
 assert.ok(harmony.unifiedSuitability(.5,draw,1)>harmony.unifiedSuitability(.5,draw,5));
 for(let target=1;target<=100;target++)for(const core of [0,.25,.5,.75,1]){
  const score=harmony.unifiedSuitability(core,draw,target);assert.ok(score>=0&&score<=1);
 }
 assert.throws(()=>harmony.unifiedSuitability(.5,{...draw,pythmen:9},1),/HARMONY_INVALID/);
 assert.throws(()=>harmony.unifiedSuitability(NaN,draw,1),/HARMONY_SCORE/);
 assert.equal(harmony.unifiedSuitability(.5,undefined,1),.5);
});
