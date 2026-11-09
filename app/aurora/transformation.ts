import RU from './texts.ru.json';
import {SECTORS,SECTOR_IDS,DEITIES,type SectorId,type DeityId} from './registry';
import {SOURCE_CIRCLE_REFERENCE,sourceSectorFunctions} from './source-model';
import {RESTORATION_LETTER_FOCI} from '../stoicheion-restoration-data';
import type {ScenarioMechanism} from './catalog/scenarios';
import {BASE_QUESTIONS} from './catalog/questions';
import {newForecastTest} from './forecast-test';
import {recordField} from './context';
import {harmonicScore,transformationTopology,GOLDEN_RATIO} from './transformation-math';
import {getStoicheionLetters} from '../stoicheion-data';
import type {AuroraSession} from './session';
import type {PrimaryDrawSnapshot} from './types';
import {text as adaptiveText,outcomeChoices,caseContext,situationForAnswers} from './adaptive-content';

export const TRANSFORMATION_VERSION=1;
export type TransformationDraft={version:1;sectors:SectorId[];spheres:string[];answers:Record<string,string>};
const SOURCE_URLS={hymn:'https://www.theoi.com/Text/HomericHymns2.html',demeter:'https://www.theoi.com/Text/HomericHymns1.html',aphrodite:'https://www.theoi.com/Text/HomericHymns3.html',iliad:'https://classics.mit.edu/Homer/iliad.21.xxi.html',
 odyssey:'https://classics.mit.edu/Homer/odyssey.8.viii.html',callimachus:'https://www.theoi.com/Text/CallimachusHymns1.html',
 apollodorus:'https://www.theoi.com/Text/Apollodorus3.html',perseus:'https://www.theoi.com/Text/Apollodorus2.html',pausanias:'https://www.theoi.com/Text/Pausanias1B.html',hesiod:'https://www.theoi.com/Text/HesiodTheogony.html'};
/** A route joins attested interactions. Composite routes never claim a single lost myth. */
export const TRANSFORMATION_BRIDGES:Readonly<Record<SectorId,{route:DeityId[];links?:[DeityId,DeityId][];sources:{url:string;passage:string}[];summary:string;mechanisms:ScenarioMechanism[]}>>={
 northwest:{route:['apollo','artemis','hera'],sources:[{url:SOURCE_URLS.iliad,passage:'Iliad XXI, 435–513'}],summary:RU.bridgeNorthwest,mechanisms:['boundary','values','information','dependency','form']},
 north:{route:['athena','poseidon'],sources:[{url:SOURCE_URLS.apollodorus,passage:'Bibliotheca III, 14.1'}],summary:RU.bridgeNorth,mechanisms:['resources','values','pressure','form','information']},
 northeast:{route:['artemis','zeus'],sources:[{url:SOURCE_URLS.callimachus,passage:'Hymn III to Artemis, 1–40'}],summary:RU.bridgeNortheast,mechanisms:['boundary','dependency','values','pressure','information']},
 west:{route:['poseidon','apollo','hermes'],sources:[{url:SOURCE_URLS.iliad,passage:'Iliad XXI, 435–469'},{url:SOURCE_URLS.hymn,passage:'Homeric Hymn IV to Hermes'}],summary:RU.bridgeWest,mechanisms:['information','rhythm','dependency','boundary','values']},
 center:{route:['dionysus','hephaestus','hera','zeus','hestia','kronos'],links:[['dionysus','hephaestus'],['hephaestus','hera'],['zeus','hestia'],['zeus','kronos'],['hestia','kronos']],sources:[{url:SOURCE_URLS.pausanias,passage:'Description of Greece I, 20.3'},{url:SOURCE_URLS.aphrodite,passage:'Homeric Hymn V, 21–32'},{url:SOURCE_URLS.hesiod,passage:'Theogony, 453–506'}],summary:RU.bridgeCenter,mechanisms:['rhythm','form','boundary','values','resources']},
 east:{route:['hermes','apollo','athena'],links:[['hermes','apollo'],['hermes','athena']],sources:[{url:SOURCE_URLS.hymn,passage:'Homeric Hymn IV to Hermes'},{url:SOURCE_URLS.perseus,passage:'Bibliotheca II, 4.2'}],summary:RU.bridgeEast,mechanisms:['information','form','values','dependency','resources']},
 southwest:{route:['demeter','zeus','hera','hephaestus'],links:[['demeter','zeus'],['hera','hephaestus']],sources:[{url:SOURCE_URLS.demeter,passage:'Homeric Hymn II to Demeter'},{url:SOURCE_URLS.pausanias,passage:'Description of Greece I, 20.3'}],summary:RU.bridgeSouthwest,mechanisms:['resources','form','rhythm','dependency','values']},
 south:{route:['aphrodite','hephaestus','ares'],sources:[{url:SOURCE_URLS.odyssey,passage:'Odyssey VIII, 266–366'}],summary:RU.bridgeSouth,mechanisms:['pressure','boundary','values','dependency','rhythm']},
 southeast:{route:['hephaestus','aphrodite','dionysus'],links:[['hephaestus','aphrodite'],['hephaestus','dionysus']],sources:[{url:SOURCE_URLS.odyssey,passage:'Odyssey VIII, 266–366'},{url:SOURCE_URLS.pausanias,passage:'Description of Greece I, 20.3'}],summary:RU.bridgeSoutheast,mechanisms:['form','values','resources','dependency','rhythm']},
};
export const PSYCHOLOGICAL_LENSES=[
 {id:'agency',title:RU.lensAgency,tags:['responsibility','clarity'],field:'goal_is_own'},
 {id:'shadow',title:RU.lensShadow,tags:['measure','clarity'],field:'inference_distinguished'},
 {id:'boundary',title:RU.lensBoundary,tags:['boundary','protection'],field:'clear_scope'},
 {id:'relationship',title:RU.lensRelationship,tags:['reciprocity','agreement'],field:'explicit_agreement'},
 {id:'integration',title:RU.lensIntegration,tags:['stability','completion'],field:'small_step_possible'},
] as const;
const LETTER_MECHANISMS:Record<string,ScenarioMechanism[]>={alpha:['values','information'],beta:['dependency','values'],gamma:['form','resources'],delta:['form','boundary'],epsilon:['values','rhythm'],zeta:['pressure','resources'],eta:['resources','dependency'],theta:['rhythm','boundary'],iota:['values','information'],kappa:['rhythm','boundary'],lambda:['form','dependency'],mu:['resources','rhythm'],nu:['values','information'],xi:['dependency','values'],omicron:['rhythm','boundary'],pi:['pressure','boundary'],rho:['pressure','rhythm'],sigma:['rhythm','values'],tau:['boundary','dependency'],upsilon:['values','information'],phi:['information','form'],chi:['form','dependency'],psi:['values','dependency'],omega:['rhythm','form']};

export function selectedTransformationSectors(session:Pick<AuroraSession,'transformation'|'selectedSectorId'>):SectorId[]{
 return session.transformation?.sectors??(session.selectedSectorId?[session.selectedSectorId]:[]);
}
export function transformationKey(snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[]):string{
 return snapshot.cards.filter(card=>sectors.includes(card.sourcePositionId)).map(card=>`${card.sourcePositionId}:${card.cardId}:${card.orientation}`).sort().join('|');
}
export function validateTransformation(value:TransformationDraft,snapshot:PrimaryDrawSnapshot){
 if(!value||value.version!==1||!Array.isArray(value.sectors)||value.sectors.length>9||new Set(value.sectors).size!==value.sectors.length
  ||value.sectors.some(id=>!snapshot.cards.some(card=>card.sourcePositionId===id&&card.orientation==='reversed'))
  ||!Array.isArray(value.spheres)||value.spheres.length>5||new Set(value.spheres).size!==value.spheres.length||value.spheres.some(id=>!PSYCHOLOGICAL_LENSES.some(lens=>lens.id===id))
  ||!value.answers||typeof value.answers!=='object'||Object.keys(value.answers).length>12||Object.values(value.answers).some(answer=>typeof answer!=='string'||answer.length>150))throw Error('AURORA_TRANSFORMATION_INVALID');
}
export function toggleTransformationSector(session:AuroraSession,id:SectorId):AuroraSession{
 const old=selectedTransformationSectors(session),sectors=SECTOR_IDS.filter(sector=>sector===id?!old.includes(sector):old.includes(sector));
 const transformation:TransformationDraft={version:1,sectors,spheres:[],answers:{}};validateTransformation(transformation,session.primary);
 return {...session,selectedSectorId:sectors[0]??null,transformation,goalText:'',goalTags:[],intake:{},answers:[],draftAnswer:{questionId:'',choiceId:'',detail:''},forecastTest:undefined,
  context:{...session.context,fields:{},originalQuestion:'',acceptedThemes:[],rejectedThemes:[]}};
}
export function transformationAtlas(snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[],spheres:readonly string[]=[],previous:Readonly<Record<string,string>>={}){
 const cards=snapshot.cards.filter(card=>sectors.includes(card.sourcePositionId));
 const interactions=new Map<string,{from:string;to:string;weight:number}>();
 for(const card of cards){const bridge=TRANSFORMATION_BRIDGES[card.sourcePositionId],links=bridge.links??bridge.route.slice(1).map((to,index)=>[bridge.route[index],to]);
  links.forEach(([from,to],index)=>{const key=[from,to].sort().join('|'),weight=1/GOLDEN_RATIO**Math.min(index,4),old=interactions.get(key);
   if(!old||old.weight<weight)interactions.set(key,{from,to,weight});});
 }
 // Reusing one myth from two sectors does not create a second topological edge.
 const edges=[...interactions.values()];
 const signal=Object.fromEntries(cards.flatMap(card=>sourceSectorFunctions(card.sourcePositionId).map(share=>[share.deityId,1])));
 const topology=transformationTopology(edges,signal),key=transformationKey(snapshot,sectors);
 const focal=cards.map(card=>({card,focus:RESTORATION_LETTER_FOCI[card.cardId],source:SOURCE_CIRCLE_REFERENCE.find(row=>row.id===card.sourcePositionId)!,target:SECTORS.find(row=>row.id===card.sourcePositionId)!,bridge:TRANSFORMATION_BRIDGES[card.sourcePositionId]}));
 const letters=getStoicheionLetters('ru');
 const context=focal.map(row=>`${letters.find(letter=>letter.id===row.card.cardId)!.symbol} · ${row.source.patrons.ru} → ${row.target.deities.map(id=>DEITIES[id].name).join(', ')}: ${row.card.orientation==='reversed'?row.focus.risk.ru:row.focus.quality.ru}`).join('; ');
 const mechanisms=[...new Set(focal.flatMap(row=>row.bridge.mechanisms))];
 const ranked=mechanisms.map(mechanism=>{
  const fit=cards.length?cards.reduce((sum,card)=>sum+(LETTER_MECHANISMS[card.cardId].includes(mechanism)?1:.2),0)/cards.length:0;
  const prior=previous.event===mechanism?1:.5;
  const sphereFit=spheres.includes('boundary')&&mechanism==='boundary'||spheres.includes('relationship')&&mechanism==='dependency'||spheres.includes('shadow')&&mechanism==='values'?1:.4;
  return {mechanism,score:harmonicScore([fit,sphereFit,prior,topology.beta0<=1?1:1/topology.beta0,Math.min(1,topology.beta1/5)])};
 }).sort((a,b)=>b.score-a.score||a.mechanism.localeCompare(b.mechanism,'en'));
 const eventOptions=ranked.slice(0,5).map(({mechanism})=>{
  const example=situationForAnswers(snapshot,sectors,{...previous,event:mechanism},spheres);
  return {id:mechanism,title:adaptiveText(`mechanism_${mechanism}`),value:adaptiveText(`situation_${mechanism}`),description:example.paragraphs.slice(1,3).join(' '),situationId:example.id};
 });
 const goals=PSYCHOLOGICAL_LENSES.map(lens=>({id:lens.id,title:adaptiveText(`lens_${lens.id}`),description:adaptiveText(`lens_example_${lens.id}`),value:adaptiveText(`lens_${lens.id}`),goalTags:[...new Set([...lens.tags,...PSYCHOLOGICAL_LENSES.filter(row=>spheres.includes(row.id)).flatMap(row=>[...row.tags])])],field:lens.field}));
 const questionOptions=outcomeChoices(snapshot,sectors,previous.domain);
 const byMechanism:Record<ScenarioMechanism,{constraint:string[];resources:string[];unknown:string[]}>= {
  information:{constraint:['direct_evidence','source_known','info_access','external_dependency'],resources:['info_access','source_known','skill_available','independent_alternative','available_time_known','resource_available'],unknown:['source_known','inference_distinguished','decision_owner_known','lead_time_known','other_agreement','baseline_defined']},
  resources:{constraint:['resource_available','available_time_known','external_dependency','scale_limit_known'],resources:['resource_available','available_time_known','other_agreement','independent_alternative','skill_available','info_access'],unknown:['lead_time_known','source_known','decision_owner_known','scale_limit_known','other_agreement','baseline_defined']},
  dependency:{constraint:['external_dependency','explicit_agreement','decision_owner_known','contact_safe'],resources:['other_agreement','contact_safe','independent_alternative','info_access','skill_available','resource_available'],unknown:['decision_owner_known','other_agreement','source_known','waiting_deadline_known','lead_time_known','baseline_defined']},
  boundary:{constraint:['nonnegotiable_constraint','voluntary_commitment','clear_scope','external_dependency'],resources:['independent_alternative','reversible_step','info_access','small_step_possible','resource_available','available_time_known'],unknown:['clear_scope','decision_owner_known','source_known','stop_condition_known','other_agreement','baseline_defined']},
  pressure:{constraint:['nonnegotiable_constraint','scale_limit_known','contact_safe','external_dependency'],resources:['independent_alternative','stop_condition_known','reversible_step','available_time_known','resource_available','skill_available'],unknown:['stop_condition_known','scale_limit_known','decision_owner_known','earlier_result_observed','source_known','baseline_defined']},
  values:{constraint:['values_share_constraint','voluntary_commitment','goal_is_own','cost_acceptable'],resources:['value_named','goal_is_own','independent_alternative','reversible_step','skill_available','resource_available'],unknown:['inference_distinguished','undesired_outcome_known','cost_acceptable','source_known','other_agreement','baseline_defined']},
  form:{constraint:['clear_scope','skill_available','explicit_agreement','resource_available'],resources:['skill_available','info_access','small_step_possible','reversible_step','resource_available','available_time_known'],unknown:['baseline_defined','target_observable','decision_owner_known','lead_time_known','other_agreement','source_known']},
  rhythm:{constraint:['deadline_defined','available_time_known','pattern_same_context','scale_limit_known'],resources:['available_time_known','reversible_step','small_step_possible','resource_available','independent_alternative','skill_available'],unknown:['lead_time_known','earlier_result_observed','event_order_known','waiting_deadline_known','source_known','baseline_defined']},
 };
 const mechanism=(previous.event&&previous.event in byMechanism?previous.event:ranked[0]?.mechanism??'information') as ScenarioMechanism;
 const choiceFields=byMechanism[mechanism];
 const choices=Object.fromEntries(Object.entries(choiceFields).map(([kind,pool])=>{
 const fields=pool.filter(field=>kind==='constraint'||field!==previous.constraint&&(kind==='resources'||field!==previous.resources)).slice(0,4);
 return [kind,[...fields.map((field,index)=>{
  const sector=sectors[(index+['constraint','resources','unknown'].indexOf(kind))%Math.max(1,sectors.length)]??'center';
  const probe=BASE_QUESTIONS.find(question=>question.sectorTags.includes(sector)&&question.resolvesFields[0]===field)!;
  const value=kind==='unknown'?false:kind==='constraint'?!['direct_evidence','source_known','info_access','resource_available','explicit_agreement','clear_scope','small_step_possible','available_time_known','contact_safe','skill_available','goal_is_own','cost_acceptable'].includes(field):true;
  const answer=probe.answerSchema.choices.find(choice=>choice.id===(value?'yes':'no'))!;
  return {id:field,label:answer.label,field,value,question:adaptiveText(`question_${field}`)||probe.text,description:adaptiveText(`example_${field}`)};
 }),{id:'unknown',label:RU.text0127,field:'',value:false,question:''}]];}));
 return {key,focal,context,topology,goals,questionOptions,eventOptions,example:caseContext(snapshot,sectors,previous.domain),choices:choices as Record<'constraint'|'resources'|'unknown',{id:string;label:string;field:string;value:boolean;question:string;description?:string}[]>};
}

const INTAKE_ORDER=['question','domain','event','constraint','resources','unknown'] as const;
export type TransformationIntakeKind=typeof INTAKE_ORDER[number];
const INTAKE_FIELDS={question:'question',domain:'domain',event:'event_description',constraint:'current_constraint',resources:'available_resources',unknown:'unknown_description'} as const;
/** An earlier edit invalidates dependent choices and all later diagnostic evidence.
 * Keep the audit trail, but rebuild facts from the answers that still apply. */
export function updateTransformationIntake(session:AuroraSession,kind:TransformationIntakeKind,id:string,evidenceId:string):AuroraSession{
 const sectors=selectedTransformationSectors(session),spheres=session.transformation?.spheres??[];
 const answers={...session.transformation?.answers},intake={...session.intake};
 const atlas=transformationAtlas(session.primary,session.observationOnly?session.primary.cards.map(card=>card.sourcePositionId):sectors,spheres,answers);
 const option=kind==='question'?atlas.questionOptions.find(row=>row.id===id):kind==='event'?atlas.eventOptions.find(row=>row.id===id)
  :kind==='domain'?['work','study','relationship','home','creative','time','other'].includes(id)?{id,value:id}:undefined:atlas.choices[kind].find(row=>row.id===id);
 if(!option)throw Error('AURORA_TRANSFORMATION_ANSWER');
 answers[kind]=id;intake[INTAKE_FIELDS[kind]]='label' in option?option.label:option.value;
 for(const later of INTAKE_ORDER.slice(INTAKE_ORDER.indexOf(kind)+1)){delete answers[later];delete intake[INTAKE_FIELDS[later]];}
 const context={...session.context,fields:{},originalQuestion:intake.question??'',domain:intake.domain??'',acceptedThemes:[],rejectedThemes:[],
  contradictions:[],answerEvidence:session.context.answerEvidence.map(row=>({...row,excludedReason:row.excludedReason??'superseded_by_explicit_edit'}))};
 let profile=context as AuroraSession['context'];
 const retained=transformationAtlas(session.primary,session.observationOnly?session.primary.cards.map(card=>card.sourcePositionId):sectors,spheres,answers);
 for(const group of ['constraint','resources','unknown'] as const){const answer=retained.choices[group].find(row=>row.id===answers[group]);
  if(answer?.field)profile=recordField(profile,{id:`${evidenceId}:${group}`,field:answer.field,value:answer.value,exactUserText:answer.label,
   kind:group==='unknown'?'interpretation':'constraint',confirmed:group!=='unknown',status:group==='unknown'?'unknown':'known',beforeInterpretation:session.highestStage<4});
 }
 return {...session,intake,context:profile,transformation:{version:1,sectors,spheres,answers},answers:[],hypotheses:[],revisingQuestionId:null,
  draftAnswer:{questionId:'',choiceId:'',detail:''},forecastTest:{...newForecastTest(),outcome:answers.question??null,mechanism:(answers.event??null) as ScenarioMechanism|null}};
}
