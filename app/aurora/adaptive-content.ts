import COPY from './adaptive-copy.ru.json';
import {RESTORATION_LETTER_FOCI} from '../stoicheion-restoration-data';
import {getStoicheionLetters} from '../stoicheion-data';
import {SECTORS,type SectorId} from './registry';
import type {PrimaryDrawSnapshot,SituationProfile} from './types';
import type {QuestionRecord} from './catalog/questions';
import type {ScenarioMechanism} from './catalog/scenarios';
import type {Language} from '../i18n';
import {MYTH_TRANSITIONS} from './catalog/myths';
import {canRecommendContact,hasActionSafetyStop} from './recommendation-safety';

export const ADAPTIVE_VERSION='aurora-guided-situations-v2';
const copy=COPY as Record<string,string>;
export const DOMAINS=['work','study','relationship','home','creative','time','other'] as const;
export const MECHANISMS=['information','resources','dependency','boundary','pressure','values','form','rhythm'] as const;
export const LENSES=['agency','shadow','boundary','relationship','integration'] as const;
export const OUTCOMES=['response','agreement','access','accepted','milestone'] as const;
const LETTER_THEMES:Record<string,ScenarioMechanism>={alpha:'values',beta:'dependency',gamma:'form',delta:'boundary',epsilon:'values',zeta:'pressure',eta:'resources',theta:'rhythm',iota:'values',kappa:'rhythm',lambda:'dependency',mu:'resources',nu:'information',xi:'dependency',omicron:'rhythm',pi:'boundary',rho:'pressure',sigma:'rhythm',tau:'boundary',upsilon:'values',phi:'information',chi:'form',psi:'values',omega:'form'};
export const text=(key:string)=>copy[key]??'';
export const domainChoices=()=>DOMAINS.map(id=>({id,label:text(`domain_${id}`),description:text(`domain_example_${id}`)}));
export function focusCards(snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[]){
 const reversed=snapshot.cards.filter(card=>card.orientation==='reversed');
 const selected=reversed.filter(card=>sectors.includes(card.sourcePositionId));
 return selected.length?selected:reversed.length?reversed:snapshot.cards;
}
export function caseContext(snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[],domain='other',index=0,language:Language='ru'){
 const cards=focusCards(snapshot,sectors),card=cards[index%cards.length];
 const letter=getStoicheionLetters(language).find(row=>row.id===card.cardId)!;
 const sector=SECTORS.find(row=>row.id===card.sourcePositionId)!;
 return {card,mechanism:LETTER_THEMES[card.cardId],label:`${letter.name} · ${sector.title}`,
  example:card.orientation==='reversed'?text(`card_${card.cardId}`):text('uprightExample'),
  domain:text(`domain_example_${DOMAINS.includes(domain as never)?domain:'other'}`),
  meaning:RESTORATION_LETTER_FOCI[card.cardId][card.orientation==='reversed'?'risk':'quality'].ru};
}
export function mechanismChoices(snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[],domain='other'){
 const cards=focusCards(snapshot,sectors),themes=cards.map(card=>LETTER_THEMES[card.cardId]);
 return MECHANISMS.map(id=>({id,label:text(`mechanism_${id}`),description:text(`situation_${id}`),
  example:text(`domain_example_${DOMAINS.includes(domain as never)?domain:'other'}`),score:themes.filter(theme=>theme===id).length}))
  .sort((a,b)=>b.score-a.score||MECHANISMS.indexOf(a.id)-MECHANISMS.indexOf(b.id));
}
const EXAMPLE_FIELDS:Record<string,string>={
 multiple_versions:'clear_scope',needs_one_form:'target_observable',validated_message_exists:'direct_evidence',rigid_version_blocks_exchange:'explicit_agreement',
 terms_are_negotiable:'voluntary_commitment',single_form_is_mandatory:'nonnegotiable_constraint',routine_is_closed:'independent_alternative',external_contact_needed:'external_dependency',contact_is_unsafe:'contact_safe',
 messages_fragment_attention:'available_time_known',daily_result_defined:'target_observable',all_messages_are_urgent:'deadline_defined',
 essential_need_ignored:'resource_available',review_is_possible:'reversible_step',need_is_already_met:'resource_available',plan_has_resource_gap:'resource_available',resource_gap_confirmed:'resource_available',resources_are_sufficient:'resource_available',
 pressure_has_failed:'previous_attempt_effect',success_criterion_possible:'target_observable',immediate_danger:'stop_condition_known',goal_shifted_to_winning:'goal_is_own',cost_is_disproportionate:'cost_acceptable',original_goal_unchanged:'change_desired',
 past_hurt_shapes_current_dispute:'inference_distinguished',current_fact_not_separated:'direct_evidence',ongoing_harm:'contact_safe',
 autonomy_meets_shared_duty:'values_share_constraint',consent_is_possible:'other_agreement',boundary_contact_is_unsafe:'contact_safe',shared_rule_intrudes:'nonnegotiable_constraint',personal_boundary_confirmed:'clear_scope',rule_is_nonnegotiable_safety:'nonnegotiable_constraint',
 desire_touches_commitment:'values_share_constraint',terms_can_be_revised:'explicit_agreement',revision_causes_irreversible_harm:'reversible_step',
 evidence_keeps_conflict_open:'contrary_evidence',mediation_is_possible:'contact_safe',mediator_not_trusted:'source_known',control_excludes_contact:'contact_safe',trusted_format_exists:'source_known',contact_is_overwhelming:'scale_limit_known',
 impulse_leaves_no_result:'earlier_result_observed',small_output_possible:'small_step_possible',recovery_needed_first:'resource_available',
 contribution_not_acknowledged:'explicit_agreement',specific_contribution_known:'direct_evidence',contribution_is_only_assumed:'inference_distinguished',
 preserved_order_blocks_renewal:'attempted_again',responsibility_transfer_possible:'decision_owner_known',transfer_forbidden_by_real_constraint:'nonnegotiable_constraint',decisions_centralized_again:'decision_owner_known',authority_can_be_limited:'clear_scope',delegation_already_works:'independent_alternative',
};
const INVERTED_EXAMPLES=new Set(['contact_is_unsafe','boundary_contact_is_unsafe','ongoing_harm','resource_gap_confirmed','plan_has_resource_gap','essential_need_ignored','cost_is_disproportionate','revision_causes_irreversible_harm','mediator_not_trusted','contact_is_overwhelming','contribution_is_only_assumed']);
const CONSEQUENCE_EXAMPLES:Record<string,string>={clarify:'source_known',verify:'direct_evidence',act:'small_step_possible',wait:'waiting_deadline_known',rescale:'scale_limit_known',independent:'independent_alternative',reconsider:'contrary_evidence',observe:'earlier_result_observed'};
export function questionPresentation(question:QuestionRecord,snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[],domain='other',index=0,language:Language='ru',profile?:SituationProfile){
 const field=question.resolvesFields[0],context=caseContext(snapshot,sectors,domain,index,language);
 const exampleField=EXAMPLE_FIELDS[field]??field;
 const example=text(`example_${exampleField}`);
 if(!example)throw Error(`AURORA_QUESTION_EXAMPLE_MISSING:${field}`);
 const transition=MYTH_TRANSITIONS.find(edge=>edge.questionIds.includes(question.id));
 const situation=situationForAnswers(snapshot,sectors,{domain,event:context.mechanism},[],profile);
 const contextual=question.informationFamily==='grounds'?situation.paragraphs[9]:question.informationFamily==='dependency'?situation.paragraphs[8]:question.informationFamily==='capability'?situation.paragraphs[10]:context.example;
 return {title:text(`question_${field}`)||question.text,context,family:question.informationFamily,
  choices:question.answerSchema.choices.map(choice=>({id:choice.id,label:choice.label,
   description:text(`${(choice.value===true)!==INVERTED_EXAMPLES.has(field)?'yes':'no'}_${exampleField}`)||text(`example_${CONSEQUENCE_EXAMPLES[choice.consequence]}`)})),
  example:[context.domain,example,transition?.projectInterpretation??contextual].filter(Boolean).join(' '),situationId:situation.id};
}
export function outcomeChoices(snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[],domain='other'){
 const context=caseContext(snapshot,sectors,domain);
 return OUTCOMES.map(id=>({id,title:text(`outcome_${id}`),description:`${text(`outcome_example_${id}`)} ${context.domain}`,value:text(`outcome_${id}`)}));
}

/** A finite, addressable situation space. No stored bulk prose, probability or inferred biography. */
export const SITUATION_AXES={domain:DOMAINS,lens:LENSES,mechanism:MECHANISMS,outcome:OUTCOMES,
 constraint:['time','information','agreement','energy'],resource:['note','skill','support','window'],
 phase:['first','repeated','changed'],
 agency:['known','unclear','dependent','independent','unknown'],
 evidence:['direct','source','assumed','unknown'],capacity:['ready','limited','small','unknown']} as const;
const SITUATION_CONTEXT_COPY:Record<string,Record<string,string>>={
 agency:{known:'example_decision_owner_known',unclear:'example_actor_role_known',dependent:'example_external_dependency',independent:'example_independent_alternative',unknown:'example_other_agreement'},
 evidence:{direct:'example_direct_evidence',source:'example_source_known',assumed:'example_inference_distinguished',unknown:'example_contrary_evidence'},
 capacity:{ready:'example_resource_available',limited:'example_scale_limit_known',small:'example_small_step_possible',unknown:'example_available_time_known'},
};
export const situationDesignSpace=()=>Object.values(SITUATION_AXES).reduce((n,axis)=>n*axis.length,1);
export function situationVariant(snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[],ordinal:number){
 if(!Number.isInteger(ordinal)||ordinal<0||ordinal>=situationDesignSpace())throw Error('AURORA_SITUATION_VARIANT');
 let cursor=ordinal;
 const axes=Object.fromEntries(Object.entries(SITUATION_AXES).map(([key,values])=>{const value=values[cursor%values.length];cursor=Math.floor(cursor/values.length);return [key,value];}));
 const context=caseContext(snapshot,sectors,axes.domain);
 return {id:`${ADAPTIVE_VERSION}:${snapshot.sourceSeed}:${ordinal}`,axes,
  paragraphs:[context.domain,context.example,text(`situation_${axes.mechanism}`),text(`lens_example_${axes.lens}`),text(`outcome_${axes.outcome}`),text(`constraint_${axes.constraint}`),text(`resource_${axes.resource}`),text(`phase_${axes.phase}`),
   ...Object.entries(SITUATION_CONTEXT_COPY).map(([axis,rows])=>text(rows[axes[axis]]))]};
}
export function situationForAnswers(snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[],answers:Readonly<Record<string,string>>,spheres:readonly string[]=[],profile?:SituationProfile){
 const constraint=answers.constraint?.includes('time')?'time':answers.constraint?.includes('agreement')||answers.constraint==='external_dependency'?'agreement':answers.constraint?.includes('resource')?'energy':'information';
 const resource=answers.resources?.includes('time')?'window':answers.resources?.includes('skill')?'skill':answers.resources==='other_agreement'?'support':'note';
 const fact=(field:string)=>profile?.fields[field]?.status==='known'?profile.fields[field].value:null;
 const agency=fact('external_dependency')===true?'dependent':fact('external_dependency')===false?'independent':fact('decision_owner_known')===true?'known':fact('decision_owner_known')===false?'unclear':'unknown';
 const evidence=fact('direct_evidence')===true?'direct':fact('source_known')===true?'source':fact('inference_distinguished')===false?'assumed':'unknown';
 const capacity=fact('resource_available')===true?'ready':fact('resource_available')===false?'limited':fact('small_step_possible')===true?'small':'unknown';
 const chosen:Record<string,string>={domain:answers.domain??'other',lens:spheres[0]??'agency',mechanism:answers.event??caseContext(snapshot,sectors).mechanism,outcome:answers.question??'response',constraint,resource,phase:answers.phase??'first',agency,evidence,capacity};
 let ordinal=0,multiplier=1;
 for(const [axis,values] of Object.entries(SITUATION_AXES)){ordinal+=Math.max(0,(values as readonly string[]).indexOf(chosen[axis]))*multiplier;multiplier*=values.length;}
 return situationVariant(snapshot,sectors,ordinal);
}
const value=(profile:SituationProfile,key:string)=>profile.fields[key]?.status==='known'?profile.fields[key].value:null;
export function practicalGuidance(profile:SituationProfile,snapshot:PrimaryDrawSnapshot,sectors:readonly SectorId[],mechanism?:string){
 const context=caseContext(snapshot,sectors,profile.domain);
 const theme=mechanism&&MECHANISMS.includes(mechanism as never)?mechanism:context.mechanism;
 const contact=canRecommendContact(profile);
 const small=value(profile,'resource_available')!==true||value(profile,'available_time_known')!==true;
 const situation=situationForAnswers(snapshot,sectors,{domain:profile.domain,event:theme},[],profile);
 return {context,situationId:situation.id,holding:text(`holding_${theme}`),movement:text(`movement_${theme}`),
  steps:hasActionSafetyStop(profile)?[text('step_pause'),text('step_fallback')]:[text(`action_${theme}`),text(contact?'step_contact':'step_independent'),text(small?'step_small':'step_ready'),text('step_verify')],
  alternative:text(value(profile,'small_step_possible')===false?'step_pause':'step_fallback'),
  basis:Object.entries(profile.fields).filter(([,row])=>row.status==='known').map(([field])=>field)};
}
