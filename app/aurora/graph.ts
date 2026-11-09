import {CURATOR_IDS} from './registry';
import {multiply,total,validateMatrix,zeros} from './potentials';
import type {Channel,Matrix,MythTransition,OptionalTemporalTriadSnapshot,Predicate,SituationProfile,TransitionTrace,Truth} from './types';

export const GRAPH_VERSION='aurora-myth-flow-v1';
export const PROPAGATION_ITERATIONS=48;
export function predicateState(profile:SituationProfile,predicate:Predicate):Truth {
  const field=profile.fields[predicate.field];if(!field||field.status!=='known')return 'unknown';
  if(profile.contradictions?.some(c=>c.field===predicate.field&&!c.resolved))return 'unknown';
  const allowed=new Set(profile.answerEvidence.filter(e=>e.explicitUserConfirmation&&!e.excludedReason).map(e=>e.id));
  if(!field.evidenceIds.length||field.evidenceIds.some(id=>!allowed.has(id)))return 'unknown';
  const value=field.value;
  if(predicate.operator==='present')return value!==''&&(!Array.isArray(value)||value.length>0)?'true':'false';
  if(predicate.operator==='eq')return value===predicate.value?'true':'false';
  if(predicate.operator==='includes')return Array.isArray(value)&&value.includes(String(predicate.value))?'true':'false';
  return typeof value==='number'&&typeof predicate.value==='number'&&value>=predicate.value?'true':'false';
}
export function evaluateTransition(edge:MythTransition,profile:SituationProfile):{state:Truth;evidenceIds:string[]} {
  if(profile.rejectedThemes?.includes(`myth:${edge.id}`))return {state:'false',evidenceIds:[]};
  const activation=edge.activationPredicates.map(p=>predicateState(profile,p));
  const contradiction=edge.disconfirmingPredicates.some(p=>predicateState(profile,p)==='true');
  const state:Truth=contradiction||activation.includes('false')?'false':activation.length&&activation.every(v=>v==='true')?'true':'unknown';
  const evidenceIds=[...new Set([...edge.activationPredicates,...edge.disconfirmingPredicates].flatMap(p=>profile.fields[p.field]?.evidenceIds??[]))];
  return {state,evidenceIds};
}
const node=(god:string,channel:Channel)=>{const index=CURATOR_IDS.indexOf(god as typeof CURATOR_IDS[number]);if(index<0)throw new Error('AURORA_INVALID_MASS_NODE');return index+(channel==='tension'?13:0);};
export function transitionMatrix(edges:readonly MythTransition[],profile:SituationProfile,
  temporal?:OptionalTemporalTriadSnapshot['cards'][number]):{matrix:Matrix;trace:TransitionTrace[]} {
  const matrix=zeros(26,26);for(let i=0;i<26;i++)matrix[i][i]=1;
  const trace:TransitionTrace[]=[],seen=new Set<string>(),seenMeaning=new Set<string>();
  for(const edge of edges){
    if(seen.has(edge.id))throw new Error('AURORA_DUPLICATE_GRAPH_RULE');seen.add(edge.id);
    const meaning=JSON.stringify([edge.sourceGodId,edge.targetGodId,edge.sourceChannel,edge.targetChannel,edge.activationPredicates,edge.disconfirmingPredicates]);
    if(seenMeaning.has(meaning))throw new Error('AURORA_DUPLICATE_GRAPH_MEANING');seenMeaning.add(meaning);
    const evaluated=evaluateTransition(edge,profile),active=evaluated.state==='true';
    trace.push({edgeId:edge.id,active,predicateState:evaluated.state,evidenceIds:evaluated.evidenceIds,sourceCardInstanceIds:[]});
    if(!active||!edge.participatesInMassFlow)continue;
    const from=node(edge.sourceGodId,edge.sourceChannel),to=node(edge.targetGodId,edge.targetChannel);
    let temporalMatch=0;
    const roleApplicable=temporal?.role==='past'?predicateState(profile,{field:'repetition_count',operator:'at_least',value:2})==='true'
      :temporal?.role==='present'?predicateState(profile,{field:'current_constraint',operator:'present'})==='true'
        :predicateState(profile,{field:'alternate_action_possible',operator:'eq',value:true})==='true';
    if(temporal&&roleApplicable&&temporal.temporalAspect!=='kronos'&&edge.temporalRoles.includes(temporal.role)){
      const union=new Set([...edge.tags,...temporal.tags]),intersection=edge.tags.filter(t=>temporal.tags.includes(t)).length;
      const tagMatch=union.size?intersection/union.size:0;
      const compatibility=temporal.orientation==='unknown'?0:temporal.orientation===(edge.sourceChannel==='resource'?'upright':'reversed')?1:0.5;
      temporalMatch=tagMatch*compatibility;
    }
    matrix[to][from]+=1+0.5*temporalMatch;
  }
  for(let column=0;column<26;column++){let sum=0;for(let row=0;row<26;row++)sum+=matrix[row][column];for(let row=0;row<26;row++)matrix[row][column]/=sum;}
  return {matrix,trace};
}

/** Fixed operation count, stable summation order, no clock/random convergence decision. */
export function propagate(z0:Matrix,p:Matrix):{values:Matrix;mass:number;residual:number;errorBound:number;iterations:48} {
  validateMatrix(z0,26,9);validateMatrix(p,26,26);
  for(let col=0;col<26;col++){let sum=0;for(let row=0;row<26;row++)sum+=p[row][col];if(Math.abs(sum-1)>1e-12)throw new Error('AURORA_GRAPH_NOT_COLUMN_STOCHASTIC');}
  let z=z0.map(row=>[...row]);
  for(let iteration=0;iteration<PROPAGATION_ITERATIONS;iteration++){const moved=multiply(p,z);z=z0.map((row,i)=>row.map((v,j)=>0.5*v+0.5*moved[i][j]));}
  const mass=total(z0),moved=multiply(p,z);let residual=0;
  for(let i=0;i<26;i++)for(let j=0;j<9;j++)residual+=Math.abs(0.5*z0[i][j]+0.5*moved[i][j]-z[i][j]);
  const tolerance=1e-12*Math.max(1,mass);
  if(Math.abs(total(z)-mass)>tolerance||2*residual>tolerance)throw new Error('AURORA_GRAPH_NUMERIC_INVARIANT');
  for(let column=0;column<9;column++){let before=0,after=0;for(let row=0;row<26;row++){before+=z0[row][column];after+=z[row][column];}if(Math.abs(before-after)>tolerance)throw new Error('AURORA_GRAPH_COLUMN_MASS');}
  return {values:z,mass,residual,errorBound:2*residual,iterations:48};
}

export function modelWithTemporalTriad(z0:Matrix,edges:readonly MythTransition[],profile:SituationProfile,triad:OptionalTemporalTriadSnapshot|null) {
  const {matrix,trace}=transitionMatrix(edges,profile),base=propagate(z0,matrix);
  // No triad must return the very same baseline, without normalization/recomputation.
  if(!triad||triad.cards.length!==3)return {base,final:base.values,trace,temporal:null};
  const roles=['past','present','future'] as const;
  if(new Set(triad.cards.map(c=>c.instanceId)).size!==3||roles.some(role=>triad.cards.filter(c=>c.role===role).length!==1))throw new Error('AURORA_INVALID_TEMPORAL_TRIAD');
  const matrices=roles.map(role=>transitionMatrix(edges,profile,triad.cards.find(c=>c.role===role)!).matrix);
  const p=zeros(26,26);for(let row=0;row<26;row++)for(let col=0;col<26;col++)p[row][col]=0.25*matrices[0][row][col]+0.5*matrices[1][row][col]+0.25*matrices[2][row][col];
  const temporal=propagate(z0,p),final=base.values.map((row,i)=>row.map((value,j)=>0.8*value+0.2*temporal.values[i][j]));
  let deviation=0;for(let row=0;row<26;row++)for(let col=0;col<9;col++)deviation+=Math.abs(final[row][col]-base.values[row][col]);
  if(deviation>0.4*base.mass+1e-12*Math.max(1,base.mass))throw new Error('AURORA_TEMPORAL_BOUND');
  return {base,final,trace,temporal};
}
