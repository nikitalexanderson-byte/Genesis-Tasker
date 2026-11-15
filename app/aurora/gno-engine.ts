import {SECTOR_IDS, SECTORS, DEITIES, type SectorId, type CuratorId} from './registry';
import {SOURCE_SECTOR_PROJECTION} from './source-model';
import {MYTH_TRANSITIONS} from './catalog/myths';
import type {PrimaryDrawSnapshot} from './types';

export const GNO_VERSION = 'gno-meter-basileia-v1';
export const DOMAINS = ['relationships','family','wellbeing','home','learning','creativity','money','community','meaning','leisure','transition','work','other'] as const;
export type Domain = typeof DOMAINS[number];
export const BLOCKERS = ['uncertainty','dependency','resources','overload','conflict','starting'] as const;
export type Blocker = typeof BLOCKERS[number];
export const MECHANISMS = ['observe','compare','trial','prepare','ask','cooperate','boundary','restore','schedule','consult'] as const;
export type Mechanism = typeof MECHANISMS[number];
export type Answer = {value:'yes'|'no'|'unknown';detail:string;at:string};
export type GnoObservation = {id:string;at:string;planId:string;execution:'done'|'partial'|'not_done';outcome:'met'|'not_met'|'unknown';note:string;ritualDone?:boolean;organon?:string|null};
export type GnoPlan = {id:string;createdAt:string;binding:string;mechanism:Mechanism;minutes:number;title:string;steps:string[];criterion:string;deadline:string;fallback:string;conditions:string[]};
export type GnoDraft = {
 version:typeof GNO_VERSION;step:0|1|2|3;domain:Domain;goal:string;episode:string;people:string;object:string;criterion:string;deadline:string;
 blocker:Blocker;minutes:0|2|10|30;focus:SectorId;support:SectorId|null;answers:Record<string,Answer>;
 answerHistory:{field:string;answer:Answer}[];plans:GnoPlan[];selectedPlanId:string|null;observations:GnoObservation[];
};
export function newGnoDraft():GnoDraft {return {version:GNO_VERSION,step:0,domain:'other',goal:'',episode:'',people:'',object:'',criterion:'',deadline:'',blocker:'uncertainty',minutes:10,focus:'center',support:null,answers:{},answerHistory:[],plans:[],selectedPlanId:null,observations:[]};}
export const draftBinding=(d:GnoDraft)=>JSON.stringify([d.version,d.domain,d.goal,d.episode,d.people,d.object,d.criterion,d.deadline,d.blocker,d.minutes,d.focus,d.support,Object.entries(d.answers).sort(([a],[b])=>a.localeCompare(b))]);
export function answerDraft(d:GnoDraft,field:string,answer:Answer):GnoDraft {
 return {...d,answers:{...d.answers,[field]:answer},answerHistory:d.answers[field]?[...d.answerHistory,{field,answer:d.answers[field]}].slice(-200):d.answerHistory,selectedPlanId:null};
}
const known=(d:GnoDraft,key:string)=>d.answers[key]?.value??'unknown';
const confirmed=(d:GnoDraft,key:string)=>known(d,key)==='yes'&&Boolean(d.answers[key].detail.trim());
export const CORE_QUESTIONS=['control','contact','consent','access','reversible','energy','repeat'] as const;
type QuestionKey=typeof CORE_QUESTIONS[number];
const requirementMap:Record<Mechanism,QuestionKey[]>={observe:[],compare:[],trial:['control','access','reversible','energy'],prepare:['access'],ask:['contact'],cooperate:['contact','consent','energy'],boundary:['control'],restore:[],schedule:['control','energy'],consult:['contact']};
const matching:Record<Blocker,Mechanism[]>={uncertainty:['observe','compare','ask','consult'],dependency:['ask','cooperate','prepare','boundary'],resources:['prepare','compare','cooperate','consult'],overload:['restore','boundary','schedule'],conflict:['boundary','ask','consult','compare'],starting:['trial','schedule','prepare']};
const actionSector:Record<Mechanism,SectorId>={observe:'northwest',compare:'north',trial:'southeast',prepare:'southwest',ask:'east',cooperate:'center',boundary:'northeast',restore:'west',schedule:'south',consult:'east'};
// Editorial preferences choose a useful opening, never establish a fact about a person.
const domainPreference:Record<Domain,Mechanism[]>={relationships:['ask','boundary','cooperate'],family:['cooperate','prepare','boundary'],wellbeing:['observe','restore','consult'],home:['prepare','trial','schedule'],learning:['trial','ask','schedule'],creativity:['trial','restore','compare'],money:['compare','prepare','consult'],community:['cooperate','ask','boundary'],meaning:['observe','compare','restore'],leisure:['prepare','schedule','compare'],transition:['compare','trial','consult'],work:['prepare','cooperate','schedule'],other:[]};
const minimumMinutes:Record<Mechanism,number>={observe:2,compare:10,trial:10,prepare:2,ask:2,cooperate:10,boundary:2,restore:2,schedule:2,consult:2};
export type Candidate={id:string;mechanism:Mechanism;minutes:number;requirements:string[];missing:string[];blocked:string[];quality:number;regret:number;sector:SectorId};
/** Feasibility precedes ranking. Unknown prerequisites stay conditional. No event probabilities are inferred. */
export function actionCandidates(d:GnoDraft):Candidate[] {
 const rows:Candidate[]=[];
 for(const mechanism of MECHANISMS)for(const minutes of [2,10,30]){
  if(minutes<minimumMinutes[mechanism])continue;
  const requirements=[...requirementMap[mechanism]];
  const blocked=requirements.filter(key=>known(d,key)==='no');
  if(minutes>d.minutes)blocked.push('budget' as QuestionKey);
  // A failed repetition calls for a different mechanism, not a longer dose of the same attempt.
  if(known(d,'repeat')==='yes'&&['trial','schedule'].includes(mechanism))blocked.push('repeat');
  const missing=requirements.filter(key=>!confirmed(d,key)&&known(d,key)!=='no');
  if(['ask','cooperate','consult'].includes(mechanism)&&!d.people.trim())missing.push('people' as QuestionKey);
  const match=matching[d.blocker].includes(mechanism)?1:0;
  const support=bridgeStrength(d)>0&&d.support===actionSector[mechanism]?1:0;
  const quality=0.45*match+0.20*(1-missing.length/Math.max(1,requirements.length+1))+0.15*(1-minutes/60)+0.10*Number(domainPreference[d.domain].includes(mechanism))+0.10*support;
  rows.push({id:`${mechanism}-${minutes}`,mechanism,minutes,requirements,missing,blocked,quality,regret:0,sector:actionSector[mechanism]});
 }
 // Minimax regret over two explicit interpretations: address the reported obstacle, or conserve capacity.
 const eligible=rows.filter(row=>!row.blocked.length);
 const utility=(row:Candidate,h:number)=>h===0?row.quality:1-row.minutes/60-0.15*row.missing.length;
 const best=[0,1].map(h=>Math.max(0,...eligible.map(row=>utility(row,h))));
 return rows.map(row=>({...row,regret:Math.max(...[0,1].map(h=>best[h]-utility(row,h)))}));
}
export function diverseActions(d:GnoDraft,limit=5):Candidate[] {
 const pool=actionCandidates(d).filter(row=>!row.blocked.length),selected:Candidate[]=[];
 while(pool.length&&selected.length<limit){
  const score=(a:Candidate)=>0.7*(a.quality-a.regret)-0.3*Math.max(0,...selected.map(b=>a.mechanism===b.mechanism?1:a.sector===b.sector?0.4:0));
  pool.sort((a,b)=>Number(Boolean(a.missing.length))-Number(Boolean(b.missing.length))||score(b)-score(a)||a.minutes-b.minutes||a.id.localeCompare(b.id));
  const row=pool.shift()!;selected.push(row);
  // Longer and shorter versions of the same mechanism are not presented as different solutions.
  for(let i=pool.length-1;i>=0;i--)if(pool[i].mechanism===row.mechanism)pool.splice(i,1);
 }
 return selected;
}
/** Deterministic decision impact: ask first about the unknown that changes the most feasible mechanisms. */
export function nextQuestion(d:GnoDraft):QuestionKey|null {
 const unanswered=CORE_QUESTIONS.filter(key=>!d.answers[key]);
 const priority=(key:QuestionKey)=>{
  const yes=actionCandidates({...d,answers:{...d.answers,[key]:{value:'yes',detail:'comparison only',at:''}}}).filter(a=>!a.blocked.length);
  const no=actionCandidates({...d,answers:{...d.answers,[key]:{value:'no',detail:'comparison only',at:''}}}).filter(a=>!a.blocked.length);
  return new Set(yes.filter(a=>!no.some(b=>b.id===a.id)).map(a=>a.mechanism)).size;
 };
 return unanswered.filter(key=>priority(key)>0).sort((a,b)=>priority(b)-priority(a))[0]??null;
}
export function readiness(d:GnoDraft):boolean {
 const date=new Date(`${d.deadline}T12:00:00Z`);
 return [d.goal,d.episode,d.object,d.criterion,d.deadline].every(s=>Boolean(s.trim()))&&/^\d{4}-\d{2}-\d{2}$/.test(d.deadline)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===d.deadline;
}

export const internalSectors=(id:SectorId)=>SOURCE_SECTOR_PROJECTION[id].map(f=>({deity:f.deityId,share:f.share,sector:SECTORS.find(s=>s.deities.includes(f.deityId))!.id}));
export function numericRelation(a:CuratorId,b:CuratorId){
 const x=DEITIES[a].sum,y=DEITIES[b].sum,root=(v:number)=>1+(v-1)%9;
 const exact=Number(x===y),harmony=(1+Math.cos(2*Math.PI*(root(x)-root(y))/9))/2,closeness=Math.min(x,y)/Math.max(x,y);
 return {x,y,exact,harmony,closeness,index:0.6*exact+0.25*harmony+0.15*closeness,identity:a===b};
}
export function relevantMyths(source:SectorId,target:SectorId){
 const from=SOURCE_SECTOR_PROJECTION[source].map(f=>f.deityId),to=SOURCE_SECTOR_PROJECTION[target].map(f=>f.deityId);
 return MYTH_TRANSITIONS.filter(m=>from.includes(m.sourceGodId as CuratorId)&&to.includes(m.targetGodId as CuratorId));
}
/** Symbolic suggestions are explicitly candidates. Personal examples, not the rank, activate a bridge. */
export function suggestedBridges(primary:PrimaryDrawSnapshot,d:GnoDraft){
 return primary.cards.filter(card=>card.sourcePositionId!==d.focus&&card.temporalRole!=='kronos').map(card=>{
  const source=card.sourcePositionId,myths=relevantMyths(source,d.focus);
  const numeric=Math.max(...internalSectors(source).flatMap(a=>internalSectors(d.focus).map(b=>{const n=numericRelation(a.deity,b.deity);return n.identity?0:n.index;})));
  const confirmedResource=confirmed(d,`resource:${source}`);
  return {source,myths:myths.map(m=>m.id),numeric,score:Number(confirmedResource)*4+Number(card.orientation==='upright')*2+Number(myths.length>0)+numeric};
 }).sort((a,b)=>b.score-a.score||a.source.localeCompare(b.source)).slice(0,3);
}
export function mythStatus(d:GnoDraft,id:string):'active'|'blocked'|'unknown'{
 const myth=MYTH_TRANSITIONS.find(m=>m.id===id);if(!myth)return 'unknown';
 if(myth.disconfirmingPredicates.some(p=>known(d,`myth:${p.field}`)==='yes')||myth.activationPredicates.some(p=>known(d,`myth:${p.field}`)==='no'))return 'blocked';
 return myth.activationPredicates.every(p=>confirmed(d,`myth:${p.field}`))&&myth.disconfirmingPredicates.every(p=>known(d,`myth:${p.field}`)==='no'&&Boolean(d.answers[`myth:${p.field}`].detail.trim()))?'active':'unknown';
}
export function bridgeStrength(d:GnoDraft){
 if(!d.support||d.support===d.focus)return 0;
 const gate=confirmed(d,`resource:${d.support}`)&&confirmed(d,`bridge:${d.support}:${d.focus}`);
 return Number(gate)*Math.min(1,d.minutes/2); // One confirmed source, one context fit, one shared time budget.
}
/** Column-substochastic semantic graph; it cannot manufacture resources or multiply a card's mass. */
export function semanticProjection(primary:PrimaryDrawSnapshot,d:GnoDraft){
 const base=SECTOR_IDS.map(()=>0),P=SECTOR_IDS.map(()=>SECTOR_IDS.map(()=>0));
 for(const card of primary.cards){if(card.temporalRole==='kronos')continue;for(const f of internalSectors(card.sourcePositionId))base[SECTOR_IDS.indexOf(f.sector)]+=f.share*card.weight;}
 for(const myth of MYTH_TRANSITIONS.filter(m=>m.participatesInMassFlow&&mythStatus(d,m.id)==='active')){
  const from=SECTORS.find(s=>s.deities.includes(myth.sourceGodId))!.id,to=SECTORS.find(s=>s.deities.includes(myth.targetGodId))!.id;
  P[SECTOR_IDS.indexOf(to)][SECTOR_IDS.indexOf(from)]+=1;
 }
 for(let j=0;j<9;j++){
  const sum=P.reduce((v,row)=>v+row[j],0);
  if(!sum)P[j][j]=1;else for(let i=0;i<9;i++)P[i][j]/=sum;
 }
 const alpha=0.2;let values=[...base];
 for(let k=0;k<40;k++)values=base.map((b,i)=>(1-alpha)*b+alpha*P[i].reduce((sum,p,j)=>sum+p*values[j],0));
 return {base,values,matrix:P,alpha};
}
export function validateGno(d:GnoDraft):void {
 const bad=()=>{throw Error('GNO_INVALID_DOCUMENT');};
 if(!d||d.version!==GNO_VERSION||![0,1,2,3].includes(d.step)||!DOMAINS.includes(d.domain)||!BLOCKERS.includes(d.blocker)||![0,2,10,30].includes(d.minutes)||!SECTOR_IDS.includes(d.focus)||d.support!==null&&!SECTOR_IDS.includes(d.support))bad();
 for(const key of ['goal','episode','people','object','criterion','deadline'] as const)if(typeof d[key]!=='string'||d[key].length>2000)bad();
 if(!d.answers||typeof d.answers!=='object'||Object.keys(d.answers).length>150||!Array.isArray(d.answerHistory)||d.answerHistory.length>200||!Array.isArray(d.plans)||d.plans.length>100||!Array.isArray(d.observations)||d.observations.length>500)bad();
 const answer=(a:Answer)=>{if(!a||!['yes','no','unknown'].includes(a.value)||typeof a.detail!=='string'||a.detail.length>2000||!Number.isFinite(Date.parse(a.at)))bad();};
 Object.values(d.answers).forEach(answer);d.answerHistory.forEach(h=>answer(h.answer));
 for(const p of d.plans)if(!p||!p.id||!Number.isFinite(Date.parse(p.createdAt))||!MECHANISMS.includes(p.mechanism)||![2,10,30].includes(p.minutes)||typeof p.binding!=='string'||p.binding.length>350000||!Array.isArray(p.steps)||p.steps.length>12||!Array.isArray(p.conditions)||p.conditions.length>20||[p.title,p.criterion,p.deadline,p.fallback,...p.steps,...p.conditions].some(t=>typeof t!=='string'||t.length>6000))bad();
 if(new Set(d.plans.map(p=>p.id)).size!==d.plans.length||d.selectedPlanId&&!d.plans.some(p=>p.id===d.selectedPlanId))bad();
 for(const o of d.observations)if(!o||!o.id||!d.plans.some(p=>p.id===o.planId)||!Number.isFinite(Date.parse(o.at))||!['done','partial','not_done'].includes(o.execution)||!['met','not_met','unknown'].includes(o.outcome)||typeof o.note!=='string'||!o.note.trim()||o.note.length>2000)bad();
 if(new Set(d.observations.map(o=>o.id)).size!==d.observations.length)bad();
}
export function assertGnoHistory(previous:GnoDraft|undefined,next:GnoDraft|undefined):void {
 if(!previous)return;if(!next)throw Error('GNO_HISTORY_IMMUTABLE');
 for(const field of ['plans','observations'] as const)for(const item of previous[field])if(JSON.stringify(next[field].find(row=>row.id===item.id))!==JSON.stringify(item))throw Error('GNO_HISTORY_IMMUTABLE');
}
