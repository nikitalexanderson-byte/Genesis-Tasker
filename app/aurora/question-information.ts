import {SCENARIOS,type ScenarioRecord} from './catalog/scenarios';
import {predicateState} from './graph';
import type {SituationProfile} from './types';
import type {SectorId} from './registry';

const entropy=(probability:number)=>probability<=0||probability>=1?0:-probability*Math.log2(probability)-(1-probability)*Math.log2(1-probability);
/** Mutual information under a uniform candidate-model prior, in bits; not a life-event probability.
 * Unconstrained candidates contribute half to either answer and one bit of conditional entropy. */
export function splitInformationGain(yes:number,no:number,unconstrained=0):number {
 if([yes,no,unconstrained].some(n=>!Number.isFinite(n)||n<0))throw Error('AURORA_INVALID_QUESTION_SPLIT');
 const total=yes+no+unconstrained;
 if(!Number.isFinite(total))throw Error('AURORA_INVALID_QUESTION_SPLIT');
 return total?Math.max(0,entropy((yes+unconstrained/2)/total)-unconstrained/total):0;
}
export function questionInformationGains(profile:SituationProfile,sectors:ReadonlySet<SectorId>,scenarios:readonly ScenarioRecord[]=SCENARIOS){
 const compatible=scenarios.filter(row=>sectors.has(row.sectorId)&&!profile.rejectedThemes.includes(row.mechanismId)
  &&row.required.every(p=>predicateState(profile,p)!=='false')&&row.exclusions.every(p=>predicateState(profile,p)!=='true'));
 const fields=new Set(compatible.flatMap(row=>row.required.filter(p=>p.operator==='eq'&&typeof p.value==='boolean').map(p=>p.field)));
 return new Map([...fields].map(field=>{
  let yes=0,no=0;
  for(const row of compatible){const predicate=row.required.find(p=>p.field===field&&p.operator==='eq'&&typeof p.value==='boolean');if(predicate?.value===true)yes++;else if(predicate?.value===false)no++;}
  return [field,splitInformationGain(yes,no,compatible.length-yes-no)];
 }));
}
