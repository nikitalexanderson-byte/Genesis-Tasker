import {QUESTIONS,type QuestionRecord} from './catalog/questions';
import {MYTH_TRANSITIONS} from './catalog/myths';
import {predicateState} from './graph';
import type {ContextEvidence,EvidenceKind,FieldValue,Hypothesis,PrimaryDrawSnapshot,SituationProfile} from './types';
import {SECTORS,type SectorId} from './registry';
import {answeredQuestionCount,questionLimitForStage} from './question-budget';
import {routeQuestion} from './adaptive-routing';
import {questionInformationGains} from './question-information';

export const CONTEXT_VERSION='aurora-explicit-evidence-v1';
export type AnswerInput={id:string;questionId:string;choiceId:'yes'|'no'|'unknown'|'skipped'|'not_applicable';detail:string;confirmed:boolean;createdAt:string;responseMode?:'choice'};
export type AnswerRecord=AnswerInput&{field:string;consequence:string;evidenceId:string;revisesAnswerId?:string;invalidatedByAnswerId?:string};
export function createSituation(id:string,timezone:string):SituationProfile{
 if(!id||!timezone)throw new Error('AURORA_CONTEXT_ID_REQUIRED');
 return {situationId:id,topic:'',domain:'',originalQuestion:'',fields:{},participants:[],timeline:[],facts:[],interpretations:[],unknowns:[],contradictions:[],feelings:[],values:[],competingValues:[],barrierTypes:[],controllableFactors:[],externalDependencies:[],availableResources:[],existingCommitments:[],constraints:[],previousAttempts:[],repeatedEpisodes:[],exceptionsToPattern:[],answerEvidence:[],acceptedThemes:[],rejectedThemes:[],historyPermission:false,referencedSessionIds:[],timezone};
}
const validTime=(value:string)=>Number.isFinite(Date.parse(value));
export function recordField(profile:SituationProfile,input:{id:string;field:string;value:string|number|boolean|string[];
 exactUserText:string;kind:EvidenceKind;confirmed:boolean;beforeInterpretation:boolean;status?:'known'|'unknown'|'skipped'|'not_applicable'}):SituationProfile{
 if(!input.id||!input.field||input.field.length>100||input.exactUserText.length>12000)throw new Error('AURORA_INVALID_EVIDENCE');
 if(profile.answerEvidence.some(e=>e.id===input.id))return profile;
 const next=structuredClone(profile),previous=next.fields[input.field];
 if(previous)for(const e of next.answerEvidence)if(previous.evidenceIds.includes(e.id))e.excludedReason='superseded_by_explicit_edit';
 const evidence:ContextEvidence={id:input.id,situationId:profile.situationId,answerId:input.id,exactUserText:input.exactUserText,
  collectedBeforeDetailedInterpretation:input.beforeInterpretation,usedIn:[],kind:input.kind,timeframe:null,explicitUserConfirmation:input.confirmed,
  ...(previous?.evidenceIds[0]?{supersedesEvidenceId:previous.evidenceIds[0]}:{})};
 next.answerEvidence.push(evidence);
 const status=input.status??(input.confirmed?'known':'unknown');
 next.fields[input.field]=status==='known'?{status,value:input.value,evidenceIds:[input.id]}:{status,evidenceIds:[input.id]};
 next.contradictions=next.contradictions.map(c=>c.field===input.field?{...c,resolved:true}:c);
 return next;
}
export function applyAnswer(profile:SituationProfile,input:AnswerInput,beforeInterpretation:boolean):{profile:SituationProfile;answer:AnswerRecord}{
 const q=QUESTIONS.find(q=>q.id===input.questionId);if(!q||!input.id||!validTime(input.createdAt))throw new Error('AURORA_UNKNOWN_QUESTION');
 const choice=q.answerSchema.choices.find(c=>c.id===input.choiceId),special=['unknown','skipped','not_applicable'].includes(input.choiceId);
 if(!choice&&!special)throw new Error('AURORA_INVALID_ANSWER');
 if(choice&&(!input.confirmed||input.responseMode!=='choice'&&q.answerSchema.detailRequiredWhen.includes(input.choiceId)&&input.detail.trim().length<5))throw new Error('AURORA_CONCRETE_BASIS_REQUIRED');
 const field=q.resolvesFields[0],consequence=choice?.consequence??'clarify';
 const next=recordField(profile,{id:input.id,field,value:choice?.value??'',exactUserText:input.detail||choice?.label||input.choiceId,
  kind:q.evidenceRequirement,confirmed:input.confirmed,beforeInterpretation,status:special?input.choiceId as 'unknown'|'skipped'|'not_applicable':'known'});
 return {profile:next,answer:{...input,field,consequence,evidenceId:input.id}};
}
export const currentInterviewAnswers=(answers:readonly AnswerRecord[])=>answers.filter((answer,index)=>!answer.invalidatedByAnswerId&&!answers.slice(index+1).some(row=>!row.invalidatedByAnswerId&&row.field===answer.field));
export function reviseAnswer(profile:SituationProfile,answers:readonly AnswerRecord[],answerId:string,input:AnswerInput,beforeInterpretation:boolean):{profile:SituationProfile;answers:AnswerRecord[]}{
 const previous=answers.find(answer=>answer.id===answerId);
 if(!previous||previous.questionId!==input.questionId||!QUESTIONS.find(q=>q.id===previous.questionId)?.resolvesFields.includes(previous.field)||!currentInterviewAnswers(answers).includes(previous)||answers.some(answer=>answer.id===input.id))throw Error('AURORA_REVISION_NOT_CURRENT');
 const result=applyAnswer(profile,input,beforeInterpretation);
 const changed=previous.choiceId!==input.choiceId;
 const dependent=changed?answers.slice(answers.indexOf(previous)+1).filter(row=>row.field!==previous.field):[];
 const fields={...result.profile.fields};
 const invalid=new Set(dependent.map(row=>row.evidenceId));
 for(const row of dependent){for(const id of fields[row.field]?.evidenceIds??[])invalid.add(id);delete fields[row.field];}
 return {profile:{...result.profile,fields,answerEvidence:result.profile.answerEvidence.map(row=>invalid.has(row.id)?{...row,excludedReason:'superseded_by_branch_change'}:row)},
  answers:[...answers.map(row=>invalid.has(row.evidenceId)?{...row,invalidatedByAnswerId:input.id}:row),{...result.answer,revisesAnswerId:previous.id}]};
}
export function knownValue<T extends string|number|boolean|string[]>(profile:SituationProfile,field:string):T|null{
 const entry=profile.fields[field];return entry?.status==='known'&&predicateState(profile,{field,operator:'present'})==='true'?entry.value as T:null;
}
export function confirmedBoolean(profile:SituationProfile,field:string,value=true):boolean{
 return predicateState(profile,{field,operator:'eq',value})==='true';
}
export function currentEvidenceIds(profile:SituationProfile):string[]{
 return [...new Set(Object.values(profile.fields).filter(f=>f.status==='known').flatMap(f=>f.evidenceIds))].filter(id=>profile.answerEvidence.some(e=>e.id===id&&e.explicitUserConfirmation&&!e.excludedReason));
}
export function acceptHypothesis(profile:SituationProfile,hypothesis:Hypothesis,accept:boolean):{profile:SituationProfile;hypothesis:Hypothesis}{
 const next=structuredClone(profile),h=structuredClone(hypothesis);
 if(!accept){h.status='rejected';h.userConfirmation='false';next.rejectedThemes=[...new Set([...next.rejectedThemes,h.themeId])];next.acceptedThemes=next.acceptedThemes.filter(t=>t!==h.themeId);}
 else{
  const valid=new Set(currentEvidenceIds(profile));
  if(profile.rejectedThemes.includes(h.themeId)||h.contradictingEvidenceIds.length||!h.supportingEvidenceIds.length||h.supportingEvidenceIds.some(id=>!valid.has(id))||h.criteria.some(c=>c.contradiction===1))throw new Error('AURORA_HYPOTHESIS_NOT_SUPPORTED');
  h.status='accepted_lens';h.userConfirmation='true';next.acceptedThemes=[...new Set([...next.acceptedThemes,h.themeId])];
 }
 return {profile:next,hypothesis:h};
}
/** No NLP guessing: changes of wording retain the explicit typed field values. */
export function selectQuestion(profile:SituationProfile,sector:SectorId|null,snapshot:PrimaryDrawSnapshot,answered:readonly AnswerRecord[],priorityFields:readonly string[]=[],additionalSectors:readonly SectorId[]=[],revisingQuestionId:string|null=null):QuestionRecord|null{
 // Count every response, including unknown/skip and records from older sessions.
 // The cap also precedes a persisted revision so an old draft cannot trap Next.
 if(answeredQuestionCount(answered)>=questionLimitForStage(3))return null;
 if(revisingQuestionId)return QUESTIONS.find(q=>q.id===revisingQuestionId)??null;
 const focusSectors=new Set([sector??'center',...additionalSectors]);
 const sourceFunctions=new Set([
  ...snapshot.cards.filter(c=>focusSectors.has(c.sourcePositionId)).flatMap(c=>c.functions?.map(f=>f.deityId)??[]),
  ...SECTORS.filter(row=>focusSectors.has(row.id)).flatMap(row=>row.deities),
 ]);
 const relevantMyths=new Set(MYTH_TRANSITIONS.filter(edge=>sourceFunctions.has(edge.sourceGodId)||sourceFunctions.has(edge.targetGodId)).flatMap(edge=>edge.questionIds));
 // Prefer checks with an observable basis before broad motives or metaphors.
 // These are ranking preferences; a discriminating typed field still wins.
 const concreteFields=new Set(['event_observed','target_observable','baseline_defined','event_order_known','deadline_defined','repetition_known','prior_exception','attempted_again','earlier_result_observed','direct_evidence','source_known','explicit_agreement','resource_available','small_step_possible','decision_owner_known','external_dependency','independent_alternative','contact_safe','nonnegotiable_constraint','reversible_step','stop_condition_known','clear_scope']);
 const relatedChecks=[['actor_role_known','decision_owner_known'],['baseline_defined','earlier_result_observed','previous_attempt_effect'],['available_time_known','resource_available','resources_are_sufficient'],['deadline_defined','waiting_deadline_known','horizon_defined']];
 const askedFields=new Set(answered.filter(a=>!a.invalidatedByAnswerId).map(a=>a.field));
 const candidates=QUESTIONS.filter(q=>!q.resolvesFields.every(f=>askedFields.has(f)||profile.fields[f])
  &&(!q.id.startsWith('myth-')||relevantMyths.has(q.id))
  &&(!q.sectorTags.length||q.sectorTags.includes(sector??'center')||additionalSectors.some(id=>q.sectorTags.includes(id)))
  &&q.applicableWhen.every(p=>predicateState(profile,p)==='true'));
 const familyWeights:Record<string,number>={event:9,sequence:7,grounds:8,limits:7,capability:6,dependency:6,meaning:5,repetition:5};
 const gains=questionInformationGains(profile,focusSectors);
 const ranked=candidates.map(q=>{
  const myth=q.id.startsWith('myth-');
  const priority=q.resolvesFields.some(f=>priorityFields.includes(f))?30:0;
  const concrete=q.resolvesFields.some(f=>concreteFields.has(f))?12:0;
  const related=relatedChecks.filter(group=>group.some(field=>q.resolvesFields.includes(field))).flat();
  const overlap=answered.some(a=>related.includes(a.field))?5:0;
  const knownInFamily=answered.filter(a=>QUESTIONS.find(x=>x.id===a.questionId)?.informationFamily===q.informationFamily).length;
  const combinationFocus=additionalSectors.length&&q.sectorTags.includes(additionalSectors[answered.length%additionalSectors.length])?8:0;
  const information=20*Math.max(0,...q.resolvesFields.map(field=>gains.get(field)??0));
  return {q,score:priority+concrete+information+combinationFocus+(familyWeights[q.informationFamily]??0)-2*knownInFamily-overlap-q.burden+(myth?3:0)};
 }).sort((a,b)=>b.score-a.score||a.q.id.localeCompare(b.q.id,'en')).map(row=>row.q);
 return routeQuestion(ranked,answered);
}
export function branchingConsequences(profile:SituationProfile,answers:readonly AnswerRecord[]){
 const latest=answers.filter(a=>profile.fields[a.field]?.evidenceIds.includes(a.evidenceId));
 return {needsClarification:latest.filter(a=>a.consequence==='clarify').map(a=>a.field),
  reduceScale:latest.some(a=>a.consequence==='rescale'),independentOnly:latest.some(a=>a.consequence==='independent')||confirmedBoolean(profile,'contact_safe',false),
  waitForCondition:latest.some(a=>a.consequence==='wait'),excludedThemes:[...profile.rejectedThemes],
  observationOnly:confirmedBoolean(profile,'outcome_not_known',false)||confirmedBoolean(profile,'small_step_possible',false),
  unavailableResources:confirmedBoolean(profile,'resource_available',false)};
}
export function validateContext(profile:SituationProfile):void{
 if(!profile||!profile.situationId||!Array.isArray(profile.answerEvidence)||!profile.fields)throw new Error('AURORA_INVALID_CONTEXT');
 const ids=new Set<string>();for(const e of profile.answerEvidence){if(ids.has(e.id)||e.situationId!==profile.situationId||typeof e.exactUserText!=='string')throw new Error('AURORA_INVALID_EVIDENCE');ids.add(e.id);}
 for(const field of Object.values(profile.fields) as FieldValue<unknown>[]){
  if(!['known','unknown','skipped','not_applicable'].includes(field.status)||field.evidenceIds.some(id=>!ids.has(id)))throw new Error('AURORA_INVALID_CONTEXT_FIELD');
  if(field.status==='known'&&!field.evidenceIds.length)throw new Error('AURORA_UNSOURCED_CONTEXT_FIELD');
 }
 if(!profile.historyPermission&&profile.referencedSessionIds.length)throw new Error('AURORA_HISTORY_PERMISSION_REQUIRED');
}
