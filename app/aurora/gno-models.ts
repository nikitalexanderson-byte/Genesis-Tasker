import {DEITIES, SECTOR_IDS, type SectorId, type CuratorId} from './registry';
import {SOURCE_SECTOR_PROJECTION} from './source-model';
import {MYTH_TRANSITIONS} from './catalog/myths';
import {isopsephy, normalizeGreek} from './greek';
import olympians from '../olympian-isopsephy.json';
import knowledge from '../olympian-knowledge.json';
import {olympianBalance} from '../olympian-reading-math';
import type {Domain, GnoDraft, Mechanism} from './gno-engine';

/** The owner's table, supplied 2026-11-15. This is independent of the legacy
 * Aurora registry. Directions describe two different models, not new draws. */
export const CROSS_MODEL_VERSION = 'gno-winds-v2';
export const EXTRA_DEITIES = {
 muses:'Μοῦσαι', prometheus:'Προμηθεύς', helios:'Ἥλιος', ploutos:'Πλοῦτος', tyche:'Τύχη', zeusHerkeios:'Ζεὺς Ἑρκεῖος',
} as const;
export type ModelDeity = CuratorId | keyof typeof EXTRA_DEITIES;
export function modelName(id:ModelDeity){
 const record=olympians.deities.find(row=>row.id===id);
 const greek=id in EXTRA_DEITIES?EXTRA_DEITIES[id as keyof typeof EXTRA_DEITIES]:record!.greek;
 const sum=isopsephy(greek,{phrases:true});
 if(record&&(sum!==record.number||sum!==DEITIES[id as CuratorId].sum))throw Error('GNO_OLYMPIAN_REGISTRY_MISMATCH');
 return {id,greek,canonical:normalizeGreek(greek,{phrases:true}),sum,root:1+(sum-1)%9};
}
export const EXTERNAL_SECTORS:Readonly<Record<SectorId,{deities:readonly ModelDeity[];wind:string;traits:readonly string[];actions:readonly Mechanism[]}>>={
 northwest:{deities:['hermes'],wind:'Σκίρων',traits:['exchange','travel','communication'],actions:['ask','consult','prepare']},
 north:{deities:['athena'],wind:'Βορέας',traits:['strategy','learning','stability'],actions:['compare','schedule','boundary']},
 northeast:{deities:['hephaestus','prometheus'],wind:'Καικίας',traits:['craft','learning','action'],actions:['trial','prepare','consult']},
 west:{deities:['muses','dionysus'],wind:'Ζέφυρος',traits:['expression','rest','emotion'],actions:['restore','trial','observe']},
 center:{deities:['hestia','zeusHerkeios'],wind:'',traits:['stability','care','boundary','connection'],actions:['boundary','cooperate','restore']},
 east:{deities:['demeter','helios'],wind:'Εὖρος / Ἀπηλιώτης',traits:['care','growth','clarity'],actions:['prepare','observe','schedule']},
 southwest:{deities:['aphrodite'],wind:'Λίψ',traits:['connection','desire','exchange'],actions:['ask','cooperate','boundary']},
 south:{deities:['apollo'],wind:'Νότος',traits:['clarity','expression','growth'],actions:['observe','compare','trial']},
 southeast:{deities:['ploutos','tyche'],wind:'Εὐρόνοτος',traits:['resources','growth','exchange'],actions:['compare','prepare','consult']},
};
export const INTRO_TRAITS:Readonly<Record<SectorId,readonly string[]>>={
 northwest:['clarity','learning','expression'],north:['strategy','learning','stability'],northeast:['boundary','autonomy','growth'],
 west:['emotion','rest','care'],center:['connection','meaning','expression'],east:['communication','exchange','travel'],
 southwest:['care','growth','resources'],south:['action','desire','connection'],southeast:['craft','action','expression'],
};
export const DOMAIN_TARGET:Readonly<Record<Domain,SectorId>>={relationships:'southwest',family:'east',wellbeing:'east',home:'center',learning:'northeast',creativity:'west',money:'southeast',community:'northwest',meaning:'center',leisure:'west',transition:'east',work:'north',other:'center'};
/** Six facets per external sector. Multiple domains can reach a sector;
 * these are editorial meanings, not a historical claim about Aristotle. */
export const EXTERNAL_FACETS:Readonly<Record<SectorId,readonly string[]>>={
 northwest:['communication','friendship','travel','trade','mediation','networks'],
 north:['strategy','education','rights','career','judgment','resilience'],
 northeast:['craft','technology','repair','skills','invention','implementation'],
 west:['art','play','rest','emotion','celebration','completion'],
 center:['home','boundaries','belonging','ancestry','security','balance'],
 east:['care','health','family','nourishment','growth','beginnings'],
 southwest:['intimacy','partnership','desire','body','reciprocity','fertility'],
 south:['clarity','purpose','recognition','expression','truth','flourishing'],
 southeast:['money','provision','opportunity','risk','harvest','sufficiency'],
};
export const TOPIC_TARGETS:Readonly<Record<Domain,readonly SectorId[]>>={
 relationships:['southwest','southwest','center','southwest'],family:['east','center','east','center'],
 wellbeing:['east','west','east','east'],home:['center','northeast','center','east'],
 learning:['north','northeast','north','northeast'],creativity:['west','south','northeast','west'],
 money:['southeast','southeast','north','southeast'],community:['northwest','center','northwest','northwest'],
 meaning:['south','center','south','west'],leisure:['west','northwest','west','southwest'],
 transition:['center','north','east','south'],work:['north','northeast','center','south'],other:['center','northwest','south','east'],
};
export const externalTarget=(d:GnoDraft)=>d.externalFocus??(d.guided&&d.guided.topic>=0?TOPIC_TARGETS[d.domain][d.guided.topic]:undefined)??DOMAIN_TARGET[d.domain];
export const sourceCurator=(sector:SectorId)=>SOURCE_SECTOR_PROJECTION[sector][0].deityId;
export const bridgeKey=(d:GnoDraft)=>`cross:${CROSS_MODEL_VERSION}:${d.support}:${d.focus}:${externalTarget(d)}`;
export const limitKey=(d:GnoDraft)=>`limit:${bridgeKey(d)}`;
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
/** Exact arithmetic, not numerically adjacent roots on an invented circle. */
export function modelNumberRelation(a:ModelDeity,b:ModelDeity){
 const left=modelName(a),right=modelName(b),x=left.sum,y=right.sum;
 const exact=Number(x===y),sameRoot=Number(left.root===right.root),divisor=gcd(x,y),ratio=2*divisor/(x+y);
 const identity=a===b;
 return {left,right,x,y,exact,sameRoot,divisor,ratio,identity,balance:olympianBalance(x,y),index:identity?0:0.55*exact+0.25*sameRoot+0.20*ratio};
}
type ExtraMyth={id:string;from:ModelDeity;to:ModelDeity;source:string;passage:string;copyIndex:number};
export const EXTRA_MYTHS:readonly ExtraMyth[]=[
 {id:'demeter-ploutos',from:'demeter',to:'ploutos',source:'https://chs.harvard.edu/primary-source/hesiod-theogony-sb/',passage:'Hesiod, Theogony 969–974',copyIndex:0},
 {id:'athena-prometheus',from:'athena',to:'prometheus',source:'https://adfonteslibrary.org/work-plato-protagoras',passage:'Plato, Protagoras 321d–322a',copyIndex:1},
 {id:'hephaestus-prometheus',from:'hephaestus',to:'prometheus',source:'https://adfonteslibrary.org/work-plato-protagoras',passage:'Plato, Protagoras 321d–322a',copyIndex:1},
];
const mythIdentity=(id:ModelDeity)=>id==='zeusHerkeios'?'zeus':id;
export function crossMyths(source:SectorId,target:SectorId){
 const from=SOURCE_SECTOR_PROJECTION[source].map(f=>f.deityId),to:ModelDeity[]=EXTERNAL_SECTORS[target].deities.map(mythIdentity);
 return {
  existing:MYTH_TRANSITIONS.filter(m=>from.includes(m.sourceGodId as CuratorId)&&to.includes(m.targetGodId as ModelDeity)),
  extra:EXTRA_MYTHS.filter(m=>from.includes(m.from as CuratorId)&&to.includes(m.to)),
  olympian:knowledge.interactions.filter(row=>from.some(a=>to.some(b=>a!==b&&row.ids.includes(a)&&row.ids.includes(b)))),
 };
}
/** Equal deity shares avoid giving a sector extra evidence just because its
 * label has two patrons. Historical links are not automatically supportive. */
export function crossRelation(source:SectorId,target:SectorId){
 const a=INTRO_TRAITS[source],b=EXTERNAL_SECTORS[target].traits;
 const semantic=a.filter(t=>b.includes(t)).length/Math.sqrt(a.length*b.length);
 const to=EXTERNAL_SECTORS[target].deities,from=SOURCE_SECTOR_PROJECTION[source];
 const numbers=from.flatMap(f=>to.map(deity=>({...modelNumberRelation(f.deityId,deity),weight:f.share/to.length})));
 const identity=from.reduce((sum,f)=>sum+(to.includes(f.deityId)?Math.min(f.share,1/to.length):0),0);
 const numeric=numbers.reduce((sum,n)=>sum+n.weight*n.index,0);
 const myths=crossMyths(source,target),myth=Number(myths.existing.length+myths.extra.length+myths.olympian.length>0);
 const score=0.50*semantic+0.25*identity+0.20*myth+0.05*numeric;
 return {source,target,semantic,identity,numeric,myth,myths,numbers,score};
}
export const crossRelations=()=>SECTOR_IDS.flatMap(source=>SECTOR_IDS.map(target=>crossRelation(source,target)));
export const externalActionFit=(d:GnoDraft,mechanism:Mechanism)=>Number(EXTERNAL_SECTORS[externalTarget(d)].actions.includes(mechanism));
/** Zenith/union/hearth are contextual functions of the existing 13-god system,
 * never additional drawn cards and never additional units of resource. */
export const CONTEXT_PATRONS:Readonly<Record<Domain,readonly CuratorId[]>>={
 relationships:['hera','hestia'],family:['hera','hestia'],wellbeing:['hestia'],home:['hestia','zeus'],
 learning:['zeus'],creativity:['hestia'],money:['zeus'],community:['hera','zeus'],meaning:['zeus','hestia'],
 leisure:['hestia'],transition:['hera','hestia'],work:['zeus','hera'],other:['zeus','hera','hestia'],
};
const CONTEXT_ACTIONS:Partial<Record<CuratorId,readonly Mechanism[]>>={
 zeus:['compare','boundary','consult'],hera:['cooperate','ask','boundary'],hestia:['restore','prepare','schedule'],
};
export function olympianContext(d:GnoDraft){
 const source=sourceCurator(d.support??d.focus);
 return CONTEXT_PATRONS[d.domain].map(deity=>({deity,number:modelNumberRelation(source,deity),pair:knowledge.interactions.find(pair=>pair.ids.includes(source)&&pair.ids.includes(deity)),actions:CONTEXT_ACTIONS[deity]??[]}));
}
export const contextualActionFit=(d:GnoDraft,mechanism:Mechanism)=>{
 const patrons=CONTEXT_PATRONS[d.domain];
 return patrons.filter(id=>CONTEXT_ACTIONS[id]?.includes(mechanism)).length/Math.max(1,patrons.length);
};
