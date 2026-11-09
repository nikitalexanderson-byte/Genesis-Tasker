import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {calendarModule} from '../../tests/helpers/calendar-modules.mjs';
const {transformationAtlas}=calendarModule('app/aurora/transformation.ts');
const {expectedSourceDraw,snapshotFromSavedDraw}=calendarModule('app/aurora/draw-policy.ts');
const start=performance.now(),seen=new Set(),digest=createHash('sha256');
let contexts=0,maxResidual=0;
outer:for(let seed=0;seed<1000;seed++){
 const snapshot=snapshotFromSavedDraw({id:`atlas-qa-${seed}`,seed,day:'2026-11-06',createdAt:'2026-11-06T11:00:00.000Z',cards:expectedSourceDraw(seed)});
 const reversed=snapshot.cards.filter(card=>card.orientation==='reversed');
 for(let mask=1;mask<2**reversed.length;mask++){
  const sectors=reversed.filter((_,index)=>mask&(1<<index)).map(card=>card.sourcePositionId);
  const base=transformationAtlas(snapshot,sectors,['agency','integration']);contexts++;
  for(const question of base.questionOptions)for(const event of base.eventOptions){
   const head={question:question.id,event:event.id},a=transformationAtlas(snapshot,sectors,['agency','integration'],head);
   maxResidual=Math.max(maxResidual,a.topology.residual);
   for(const constraint of a.choices.constraint){
    const b=transformationAtlas(snapshot,sectors,['agency','integration'],{...head,constraint:constraint.id});
    for(const resource of b.choices.resources){
     const c=transformationAtlas(snapshot,sectors,['agency','integration'],{...head,constraint:constraint.id,resources:resource.id});
     for(const unknown of c.choices.unknown){
      assert.equal(c.questionOptions.length,5);assert.equal(c.eventOptions.length,5);
      for(const options of Object.values(c.choices))assert.equal(options.length,5);
      // The seed/session ID is deliberately absent: only semantic cards, sectors,
      // selected spheres and actual answer IDs make a distinct interview route.
      const key=JSON.stringify([base.key,['agency','integration'],question.id,event.id,constraint.id,resource.id,unknown.id]);
      if(seen.has(key))continue;seen.add(key);digest.update(key+'\n');
      if(seen.size===100000)break outer;
     }
    }
   }
  }
 }
}
assert.equal(seen.size,100000);assert.ok(maxResidual<1e-10);
const report={version:1,verifiedDistinctInterviewPaths:seen.size,spreadCombinations:contexts,seedExcludedFromUniqueness:true,answersPerField:5,maxHodgeResidual:maxResidual,sha256:digest.digest('hex'),elapsedMs:Math.round(performance.now()-start),storedVariants:0};
mkdirSync('output/playwright/release-3-2-3',{recursive:true});
writeFileSync('output/playwright/release-3-2-3/atlas-100000.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
