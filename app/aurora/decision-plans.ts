import {unifiedSuitability} from './draw-harmony';
import T from './forecast-test-copy.ru.json';
import {ACTIONS,type ActionRecord,type ActionDuration} from './catalog/actions';
import {MYTH_TRANSITIONS} from './catalog/myths';
import {DEITIES} from './registry';
import {predicateState} from './graph';
import {knownValue} from './context';
import {weightedJaccard} from './organon';
import {hasActionSafetyStop,canRecommendContact} from './recommendation-safety';
import type {CompleteModel,GoalSelection,Interval} from './model';
import type {Predicate,SituationProfile} from './types';
export const DECISION_PLAN_VERSION='aurora-contextual-plan-v1';
export const PHI=(1+Math.sqrt(5))/2;
type Variant={id:string;text:string;requires:Predicate[]};
const yes=(field:string):Predicate=>({field,operator:'eq',value:true});
const eq=(field:string,value:string):Predicate=>({field,operator:'eq',value});
export const DECISION_AXES:readonly {id:string;variants:readonly Variant[]}[]=[
 {id:'grounds',variants:[{id:'separate',text:T.planGroundSeparate,requires:[]},{id:'source',text:T.planGroundSource,requires:[yes('source_known')]},
  {id:'compare',text:T.planGroundCompare,requires:[yes('direct_evidence'),yes('baseline_defined')]},{id:'clarify',text:T.planGroundClarify,requires:[yes('decision_owner_known'),yes('contact_safe'),yes('info_access')]}]},
 {id:'scope',variants:[{id:'micro',text:T.planScopeMicro,requires:[]},{id:'bounded',text:T.planScopeBounded,requires:[yes('clear_scope')]},
  {id:'independent',text:T.planScopeIndependent,requires:[yes('independent_alternative')]},{id:'reversible',text:T.planScopeReversible,requires:[yes('reversible_step')]}]},
 {id:'execute',variants:[{id:'draft',text:T.planExecuteDraft,requires:[]},{id:'prototype',text:T.planExecutePrototype,requires:[yes('available_materials'),yes('available_tools')]},
  {id:'agreement',text:T.planExecuteAgreement,requires:[yes('other_agreement'),yes('contact_safe')]},{id:'scheduled',text:T.planExecuteScheduled,requires:[yes('deadline_defined'),yes('phase_known')]}]},
 {id:'verify',variants:[{id:'record',text:T.planVerifyRecord,requires:[]},{id:'document',text:T.planVerifyDocument,requires:[eq('forecast_verification','written')]},
  {id:'direct',text:T.planVerifyDirect,requires:[eq('forecast_verification','direct')]},{id:'confirmation',text:T.planVerifyConfirmation,requires:[eq('forecast_verification','participant'),yes('contact_safe')]}]},
 {id:'fallback',variants:[{id:'reduce',text:T.planFallbackReduce,requires:[]},{id:'wait',text:T.planFallbackWait,requires:[yes('waiting_deadline_known')]},
  {id:'alternative',text:T.planFallbackAlternative,requires:[yes('independent_alternative')]},{id:'restore',text:T.planFallbackRestore,requires:[yes('reversible_step')]}]},
];
export const decisionDesignSpace=()=>ACTIONS.reduce((sum,action)=>sum+action.durationVariants.length,0)*DECISION_AXES.reduce((product,axis)=>product*axis.variants.length,1);
/** Authored suitability, not a probability: T=(c1+2c2+3c3+4c4)/10; S=T/phi+G/phi^2. */
export function tetractysGoldenScore(components:readonly number[],coherence:number):number {
 if(components.length!==4||[...components,coherence].some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('AURORA_PLAN_SCORE_INVALID');
 const tetractys=components.reduce((sum,value,index)=>sum+(index+1)*value,0)/10;
 return Math.min(1,Math.max(0,tetractys/PHI+coherence/(PHI*PHI)));
}
export type DecisionPlan={version:typeof DECISION_PLAN_VERSION;actionId:string;minutes:ActionDuration;variantIds:string[];steps:string[];
 suitability:Interval;feasibleVariants:number;myth:{source:string;passage:string;summary:string;application:string}|null};
export function buildDecisionPlan(action:ActionRecord,minutes:ActionDuration,profile:SituationProfile,goal:GoalSelection,model:CompleteModel):DecisionPlan {
 if(hasActionSafetyStop(profile))throw Error('AURORA_PLAN_EXCLUDED_SAFETY_STOP');
 const duration=action.durationVariants.find(row=>row.minutes===minutes);if(!duration)throw Error('AURORA_PLAN_DURATION');
 const available=new Set(['private_note',...profile.availableResources]);
 for(const resource of ['materials','tools','feedback'])if(knownValue(profile,`available_${resource}`)===true)available.add(resource);
 if(action.requiredResources.some(resource=>!available.has(resource)))throw Error('AURORA_PLAN_RESOURCE_UNAVAILABLE');
 if(action.preconditions.some(p=>predicateState(profile,p)!=='true')||action.exclusions.some(p=>predicateState(profile,p)==='true'))throw Error('AURORA_PLAN_EXCLUDED');
 const goalFit=weightedJaccard(action.goalTags,goal.goalTags),preferred=knownValue<string>(profile,'action_preference');
 const preference=preferred?preferred===action.strategy?1:0.5:0.5;
 let feasibleVariants=1;
 const chosen=DECISION_AXES.map(axis=>{
  const candidates=axis.variants.filter(v=>v.requires.every(p=>predicateState(profile,p)==='true')
   &&(!v.requires.some(p=>['contact_safe','other_agreement'].includes(p.field))||canRecommendContact(profile)));
  feasibleVariants*=candidates.length;
  return candidates.map(variant=>{
   const support=variant.requires.length?1:0.35;
   const coherence=axis.id==='grounds'&&action.strategy==='clarify'||axis.id==='execute'&&action.strategy==='change'||axis.id==='verify'&&action.strategy==='support'?1:0.7;
   return {variant,score:unifiedSuitability(tetractysGoldenScore([goalFit,preference,support,1],coherence),model.harmony,DEITIES[action.curatorId].sum)};
  }).sort((a,b)=>b.score-a.score||a.variant.id.localeCompare(b.variant.id,'en'))[0];
 });
 const coverageFields=['baseline_defined','target_observable','resource_available','decision_owner_known','nonnegotiable_constraint','reversible_step','stop_condition_known','scale_limit_known'];
 const known=coverageFields.filter(field=>knownValue(profile,field)!==null).length/coverageFields.length;
 const lower=tetractysGoldenScore([goalFit,preference,known,1],known),upper=tetractysGoldenScore([goalFit,preference,1,1],1);
 const edge=model.trace.filter(trace=>trace.active).map(trace=>MYTH_TRANSITIONS.find(edge=>edge.id===trace.edgeId)!)
  .find(edge=>(edge.sourceGodId===action.curatorId||edge.targetGodId===action.curatorId)&&!profile.rejectedThemes.includes(`myth:${edge.id}`));
 return {version:DECISION_PLAN_VERSION,actionId:action.id,minutes,variantIds:chosen.map(row=>row.variant.id),
  steps:[chosen[0].variant.text,chosen[1].variant.text,...duration.instructions,chosen[2].variant.text,chosen[3].variant.text,chosen[4].variant.text],
  suitability:{lower:unifiedSuitability(lower,model.harmony,DEITIES[action.curatorId].sum),upper:unifiedSuitability(upper,model.harmony,DEITIES[action.curatorId].sum)},feasibleVariants,myth:edge?{source:edge.antiqueSource,passage:edge.sourcePassage,summary:edge.sourceSummary,application:edge.projectInterpretation}:
   {source:DEITIES[action.curatorId].sourceUrl,passage:DEITIES[action.curatorId].name,summary:action.mythologicalMotif,application:T.planModernPractice}};
}
export function validateDecisionPlan(plan:DecisionPlan):void {
 const action=ACTIONS.find(row=>row.id===plan?.actionId);
 if(!plan||plan.version!==DECISION_PLAN_VERSION||!action||!action.durationVariants.some(row=>row.minutes===plan.minutes)||!Array.isArray(plan.variantIds)
  ||plan.variantIds.length!==DECISION_AXES.length||plan.variantIds.some((id,index)=>!DECISION_AXES[index].variants.some(v=>v.id===id))
  ||!Array.isArray(plan.steps)||plan.steps.length<5||plan.steps.length>12||plan.steps.some(step=>typeof step!=='string'||step.length>6000)
  ||!plan.suitability||![plan.suitability.lower,plan.suitability.upper].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||plan.suitability.lower>plan.suitability.upper
  ||!Number.isInteger(plan.feasibleVariants)||plan.feasibleVariants<1||plan.feasibleVariants>1024
  ||plan.myth&&(![...MYTH_TRANSITIONS.map(row=>row.antiqueSource),...Object.values(DEITIES).map(row=>row.sourceUrl)].includes(plan.myth.source)
    ||[plan.myth.passage,plan.myth.summary,plan.myth.application].some(value=>typeof value!=='string'||value.length>6000)))throw Error('AURORA_PLAN_INVALID');
}
