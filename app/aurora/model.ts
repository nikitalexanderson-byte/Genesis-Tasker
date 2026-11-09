import {drawHarmony,unifiedSuitability,type DrawHarmony} from './draw-harmony';
import {hasActionSafetyStop,canRecommendContact} from './recommendation-safety';
import {semanticProjection,aggregateSectors,applyKronos,summarizeDraw,total} from './potentials';
import {kronosOrientation,eligibleSectors,validatePrimarySnapshot} from './spread';
import {modelWithTemporalTriad} from './graph';
import {MYTH_TRANSITIONS} from './catalog/myths';
import {SECTOR_IDS,CURATOR_IDS,SECTORS,DEITIES,type CuratorId,type SectorId} from './registry';
import {MEANING_PROFILES,type ProfileState} from './catalog/profiles';
import {ACTIONS,ACTION_STRATEGIES,type ActionDuration,type ActionRecord} from './catalog/actions';
import {weightedJaccard} from './organon';
import {confirmedBoolean,knownValue} from './context';
import {predicateState} from './graph';
import type {OptionalTemporalTriadSnapshot,PrimaryDrawSnapshot,SituationProfile} from './types';
import {tetractysGoldenScore} from './decision-plans';
export const MODEL_VERSION='aurora-two-circles-v2';
export type Interval={lower:number;upper:number};
export function calculateModel(snapshot:PrimaryDrawSnapshot,profile:SituationProfile,triad:OptionalTemporalTriadSnapshot|null){
 validatePrimarySnapshot(snapshot);const harmony=drawHarmony(snapshot,triad);const projection=semanticProjection(snapshot),draw=summarizeDraw(snapshot);
 if(projection.status!=='complete'||draw.orientation==='unknown')return {status:'incomplete' as const,draw,eligible:eligibleSectors(snapshot)};
 const moved=modelWithTemporalTriad(projection.z0,MYTH_TRANSITIONS,profile,triad);
 const base=aggregateSectors(moved.final),adjusted=applyKronos(base,kronosOrientation(snapshot));
 const trace=moved.trace.map(t=>{
  const edge=MYTH_TRANSITIONS.find(e=>e.id===t.edgeId)!;
  const sourceIndex=CURATOR_IDS.indexOf(edge.sourceGodId as CuratorId)+(edge.sourceChannel==='tension'?13:0);
  return {...t,sourceCardInstanceIds:snapshot.cards.filter((c,column)=>edge.sourceGodId==='kronos'?c.temporalRole==='kronos'
   :sourceIndex>=0&&(moved.final[sourceIndex]?.[column]??0)>0).map(c=>c.cardInstanceId),
   sourceModelId:snapshot.sourceModelId,targetModelId:snapshot.secondaryModelId};
 });
 return {status:'complete' as const,harmony,draw,eligible:eligibleSectors(snapshot),base,adjusted,trace,
  semantic:moved.final,mass:projection.mass,residual:moved.base.residual,temporalApplied:Boolean(moved.temporal),
  sectors:SECTOR_IDS.map((id,index)=>({id,resource:total([adjusted.values[index]]),tension:total([adjusted.values[index+9]])})),version:MODEL_VERSION};
}
export type CompleteModel=Extract<ReturnType<typeof calculateModel>,{status:'complete'}>;
export type GoalSelection={goalTags:string[];barrierTags:string[]|null;sectorId:SectorId|null;confirmed:boolean};
export function recommendCurators(goal:GoalSelection,model:CompleteModel){
 if(!goal.confirmed||!goal.goalTags.length)throw new Error('AURORA_CONFIRMED_GOAL_REQUIRED');
 const massByFunction=CURATOR_IDS.map((_,i)=>total([model.semantic[i],model.semantic[i+13]])),max=Math.max(...massByFunction,1e-12);
 return CURATOR_IDS.map((id,index)=>{
  const profile=MEANING_PROFILES.find(p=>p.curatorId===id)!;
  const goalFit=weightedJaccard(profile.goalTags,goal.goalTags),sectorFit=goal.sectorId===null?null:SECTORS.find(s=>s.id===goal.sectorId)!.deities.includes(id)?1:0;
  const barrierFit=goal.barrierTags===null?null:weightedJaccard(profile.barrierTags,goal.barrierTags),modelFit=massByFunction[index]/max;
  const parts:[number,number|null][]=[[0.45,goalFit],[0.2,sectorFit],[0.2,barrierFit],[0.15,modelFit]];
  const lower=parts.reduce((s,[w,v])=>s+w*(v??0),0),upper=parts.reduce((s,[w,v])=>s+w*(v??1),0);
  return {id,interval:{lower:unifiedSuitability(lower,model.harmony,DEITIES[id].sum),upper:unifiedSuitability(upper,model.harmony,DEITIES[id].sum)},basis:{goalFit,sectorFit,barrierFit,modelFit,pythmen:model.harmony.pythmen}};
 }).sort((a,b)=>b.interval.lower-a.interval.lower||CURATOR_IDS.indexOf(a.id)-CURATOR_IDS.indexOf(b.id));
}
export function attentionPriority(input:{negativeOrdinaryFraction:number;negativeKronos:boolean;ratings:readonly (number|null)[]}):number|null{
 if(input.ratings.length!==4||input.ratings.some(n=>n===null))return null;
 if(input.ratings.some(n=>!Number.isInteger(n)||n!<0||n!>4)||!Number.isFinite(input.negativeOrdinaryFraction)||input.negativeOrdinaryFraction<0||input.negativeOrdinaryFraction>1)throw new Error('AURORA_INVALID_ATTENTION_RATING');
 const h=input.ratings.reduce<number>((sum,n,index)=>sum+(index+1)*n!/4,0)/10;
 return 100*(0.45*Math.max(input.negativeOrdinaryFraction,input.negativeKronos?1:0)+0.55*h);
}
export function chooseActions(input:{curatorId:CuratorId;state:ProfileState;minutes:ActionDuration;profile:SituationProfile;goal:GoalSelection;excludedIds?:readonly string[];harmony?:DrawHarmony}):ActionRecord[]{
 if(!input.goal.confirmed||!input.goal.goalTags.length||![2,10,30].includes(input.minutes))throw new Error('AURORA_ACTION_INPUT_REQUIRED');
 if(hasActionSafetyStop(input.profile))return [];
 const available=new Set(['private_note',...input.profile.availableResources]);
 for(const resource of ['materials','tools','feedback'])if(confirmedBoolean(input.profile,`available_${resource}`))available.add(resource);
 const pool=ACTIONS.filter(a=>a.curatorId===input.curatorId&&a.profileState===input.state&&!input.excludedIds?.includes(a.id)
  &&weightedJaccard(a.goalTags,input.goal.goalTags)>0&&a.requiredResources.every(r=>available.has(r))
  &&a.preconditions.every(p=>predicateState(input.profile,p)==='true')&&a.exclusions.every(p=>predicateState(input.profile,p)!=='true')
  &&a.durationVariants.some(v=>v.minutes===input.minutes)
  &&(!a.preconditions.some(p=>['contact_safe','other_agreement'].includes(p.field))||canRecommendContact(input.profile)));
 const rank=(a:ActionRecord)=>{
  const lowScale=confirmedBoolean(input.profile,'resource_available',false)||input.minutes===2;
  const drafting=a.requiredResources.length===1&&a.requiredResources[0]==='private_note';
  const feasibility=drafting?1:lowScale?0.5:0.85;
  const agency=a.preconditions.length?0.75:1;
  const preferred=knownValue<string>(input.profile,'action_preference'),preference=preferred?(preferred===a.strategy?1:0):0.5;
  return unifiedSuitability(tetractysGoldenScore([weightedJaccard(a.barrierTags,input.goal.barrierTags??[]),weightedJaccard(a.goalTags,input.goal.goalTags),feasibility,agency],preference),input.harmony,DEITIES[a.curatorId].sum);
 };
 return ACTION_STRATEGIES.flatMap(strategy=>pool.filter(a=>a.strategy===strategy).sort((a,b)=>rank(b)-rank(a)||(a.id<b.id?-1:1)).slice(0,1));
}
