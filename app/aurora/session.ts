import {assertEligibleSector,eligibleSectors} from './spread';
import {verifySourceDraw,validateTemporalTriad} from './draw-policy';
import {createSituation,validateContext,type AnswerRecord,confirmedBoolean} from './context';
import {verifyForecast,payloadHash,canonicalJson,type ForecastRecord,type ForecastResolution} from './forecast';
import {DEITIES,type CuratorId,type SectorId} from './registry';
import {isopsephy} from './greek';
import type {Hypothesis,OptionalTemporalTriadSnapshot,PrimaryDrawSnapshot,SituationProfile} from './types';
import type {ProfileState} from './catalog/profiles';
import type {OrganonSelection,OrganonPreferences} from './organon';
import type {ComfortMode} from './sphragis';
import type {ActionDuration} from './catalog/actions';
import {ACTIONS} from './catalog/actions';
import {CURATOR_IDS} from './registry';
import {PROFILE_STATES} from './catalog/profiles';
import {QUESTIONS} from './catalog/questions';
import {MODEL_VERSION} from './model';
export const SESSION_VERSION=1;
import {validateForecastTest,type ForecastTestDraft} from './forecast-test';
import { sameFrozenBranch,validateScenarioBranch,type ScenarioBranch } from './condition-branches';
import {validateTransformation,type TransformationDraft} from './transformation';
import {validatePersonalLearning,type PersonalLearning} from './personal-learning';
export type ContextSnapshot={id:string;profile:SituationProfile;createdAt:string;hash:string};
export type PreparedAuroraResult={id:string;methodVersion:string;forecastHashes:string[];contextHash:string;iv:string;ciphertext:string};
export type ObservationDraft={occurred:string;conditions:string;occurredAt:string;conditionAt:string;anchorAt:string;complete:boolean;contradictory:boolean;description:string};
export type ActionExecution={id:string;forecastId:string|null;actionId:string;minutes:ActionDuration;startCondition:string;plannedAt:string;
 ritualCompleted:boolean;actionCompleted:boolean;completedAt:string|null;actualDescription:string;withoutRitual:boolean;taskId:string|null;practiceSnapshot?:PracticeSnapshot};
export type PracticeSnapshot={goalText:string;goalTags:string[];sectorId:SectorId|null;primarySnapshotId:string;curatorId:CuratorId|null;
 organon:OrganonSelection|null;sphragisLetter:string|null;comfort:ComfortMode;ritualMinutes:1|3|5;ecphonesis:boolean;capturedAt:string};
export type AuroraSession={id:string;ownerId:string;version:1;createdAt:string;updatedAt:string;stage:number;highestStage:number;
 guidePage?:{stage:number;part:number};
 historyOrigins?:string[];
 forecastTest?:ForecastTestDraft;
 transformation?:TransformationDraft;
 conditionBranches?:ScenarioBranch[];selectedConditionBranchId?:string|null;
 revisingQuestionId?:string|null;
 primary:PrimaryDrawSnapshot;selectedSectorId:SectorId|null;observationOnly:boolean;finishAsObservation:boolean;intake:Record<string,string>;context:SituationProfile;answers:AnswerRecord[];hypotheses:Hypothesis[];
 contextSnapshots:ContextSnapshot[];triad:OptionalTemporalTriadSnapshot|null;goalText:string;goalTags:string[];profileState:ProfileState;curatorId:CuratorId|null;
 organon:OrganonSelection|null;organonPreferences:OrganonPreferences;comfort:ComfortMode;sphragisLetter:string|null;ritualMinutes:1|3|5;ecphonesis:boolean;
 minutes:ActionDuration;actionOptionIds:string[];selectedActionId:string|null;executions:ActionExecution[];forecasts:ForecastRecord[];resolutions:ForecastResolution[];
 selectedForecastId:string|null;resultId:string|null;preparedResults:PreparedAuroraResult[];observationNote:string;completedAt:string|null;
 forecastForm:{target:string;success:string;failure:string;conditions:string;end:string;conditionDeadline:string;scenarioId:string;horizonBasis:string;horizonMode:'absolute'|'relative';anchorEvent:string;startOffsetMinutes:number;durationMinutes:number};
 draftAnswer:{questionId:string;choiceId:string;detail:string};planStart:string;actualActionNote:string;
 observationDraft:ObservationDraft;completionDraft:{ritualDone:boolean;actionDone:boolean;withoutRitual:boolean}};
export type AuroraDocument={version:1;ownerId:string;activeSessionId?:string;sessions:AuroraSession[];removed:{id:string;removedAt:string}[];learning?:PersonalLearning};
export function removeSavedSession(document:AuroraDocument,id:string,removedAt:string):AuroraDocument {
 if(!Number.isFinite(Date.parse(removedAt)))throw new Error('AURORA_INVALID_DELETION');
 if(document.removed.some(row=>row.id===id))return document;
 if(!document.sessions.some(row=>row.id===id))throw new Error('AURORA_SESSION_NOT_FOUND');
 const sessions=document.sessions.filter(row=>row.id!==id);
 return {...document,sessions,removed:[...document.removed,{id,removedAt}],
  activeSessionId:document.activeSessionId===id?sessions.at(-1)?.id:document.activeSessionId};
}
export function newSession(input:{id:string;ownerId:string;now:string;primary:PrimaryDrawSnapshot;timezone:string}):AuroraSession{
 verifySourceDraw(input.primary);
 return {id:input.id,ownerId:input.ownerId,version:1,createdAt:input.now,updatedAt:input.now,stage:0,highestStage:0,primary:structuredClone(input.primary),selectedSectorId:null,
  observationOnly:eligibleSectors(input.primary).length===0,finishAsObservation:false,intake:{},context:createSituation(input.id,input.timezone),answers:[],hypotheses:[],contextSnapshots:[],triad:null,goalText:'',goalTags:[],profileState:'integration',curatorId:null,organon:null,
  organonPreferences:{goalTags:[],qualityTags:[],valueTags:[],barrierTags:[],lastFiveCanonicalForms:[],excludedCanonicalForms:[],preferShort:false,avoidedLetters:[]},
  comfort:'visual',sphragisLetter:null,ritualMinutes:1,ecphonesis:false,minutes:10,actionOptionIds:[],selectedActionId:null,executions:[],forecasts:[],resolutions:[],selectedForecastId:null,resultId:null,preparedResults:[],observationNote:'',completedAt:null,
  forecastForm:{target:'',success:'',failure:'',conditions:'',end:'',conditionDeadline:'',scenarioId:'',horizonBasis:'',horizonMode:'absolute',anchorEvent:'',startOffsetMinutes:0,durationMinutes:1440},draftAnswer:{questionId:'',choiceId:'',detail:''},planStart:'',actualActionNote:'',
  observationDraft:{occurred:'unknown',conditions:'unknown',occurredAt:'',conditionAt:'',anchorAt:'',complete:false,contradictory:false,description:''},completionDraft:{ritualDone:false,actionDone:false,withoutRitual:false}};
}
export function moveStage(session:AuroraSession,stage:number,now:string):AuroraSession{
 const observing=session.observationOnly||session.finishAsObservation;
 const viewingIssued=stage===8&&session.forecasts.some(f=>f.id===session.selectedForecastId&&f.status==='issued');
 if(!Number.isInteger(stage)||stage<0||stage>8||stage>session.highestStage+1&&!(observing&&session.stage===5&&stage===8)&&!viewingIssued)throw new Error('AURORA_STAGE_UNAVAILABLE');
 if(stage>0&&!session.observationOnly&&stage>1&&session.selectedSectorId===null)throw new Error('AURORA_SECTOR_REQUIRED');
 assertEligibleSector(session.primary,session.selectedSectorId);
 if(stage>=3&&!viewingIssued&&(session.context.originalQuestion.trim().length<5||session.goalText.trim().length<5||!session.context.fields.event_description))throw new Error('AURORA_CONTEXT_REQUIRED');
 if(stage>=5&&!viewingIssued&&!confirmedBoolean(session.context,'context_confirmed'))throw new Error('AURORA_CONTEXT_CONFIRMATION_REQUIRED');
 if(stage>=6&&!observing&&!viewingIssued&&(!session.curatorId||!session.goalTags.length))throw new Error('AURORA_CURATOR_REQUIRED');
 if(stage>=7&&!observing&&!viewingIssued&&(!session.organon||!session.sphragisLetter))throw new Error('AURORA_ORGANON_REQUIRED');
 return {...session,stage,highestStage:Math.max(stage,session.highestStage),updatedAt:now};
}
export async function freezeContext(session:AuroraSession,id:string,now:string):Promise<ContextSnapshot>{
 validateContext(session.context);if(!confirmedBoolean(session.context,'context_confirmed'))throw new Error('AURORA_CONTEXT_CONFIRMATION_REQUIRED');
 const profile=structuredClone(session.context);return {id,profile,createdAt:now,hash:await payloadHash(profile)};
}
export function selectSector(session:AuroraSession,sectorId:SectorId):AuroraSession{
 assertEligibleSector(session.primary,sectorId);return {...session,selectedSectorId:sectorId};
}
/** Editing evidence starts a fresh forecast draft, while frozen results and history remain intact. */
export function invalidateSessionDraft(session:AuroraSession):AuroraSession{
 const fields={...session.context.fields};
 for(const field of ['context_confirmed','forecast_scope_mechanism','forecast_scope_phase','horizon_defined','horizon_end','horizon_basis','forecast_verification'])delete fields[field];
 return {...session,context:{...session.context,fields},forecastTest:undefined,resultId:null,selectedForecastId:null,
  organon:null,sphragisLetter:null,actionOptionIds:[],selectedActionId:null,planStart:'',actualActionNote:'',
  completionDraft:{ritualDone:false,actionDone:false,withoutRitual:false},
  observationDraft:{occurred:'unknown',conditions:'unknown',occurredAt:'',conditionAt:'',anchorAt:'',complete:false,contradictory:false,description:''}};
}
export function recordExecution(session:AuroraSession,input:ActionExecution):AuroraSession{
 const previous=session.executions.find(e=>e.id===input.id);
 if(previous?.completedAt){if(canonicalJson(previous)!==canonicalJson(input))throw new Error('AURORA_EXECUTION_HISTORY_IMMUTABLE');return session;}
 if(session.executions.some(e=>e.completedAt&&e.forecastId===input.forecastId&&e.actionId===input.actionId))return session;
 if(!session.actionOptionIds.includes(input.actionId)||input.actionId!==session.selectedActionId||!input.startCondition.trim())throw new Error('AURORA_EXECUTION_NOT_SELECTED');
 if(input.actionCompleted&&(!input.completedAt||!input.actualDescription.trim()))throw new Error('AURORA_ACTUAL_ACTION_REQUIRED');
 if(input.completedAt&&(!input.actionCompleted||(!input.withoutRitual&&!input.ritualCompleted)))throw new Error('AURORA_COMPLETION_NOT_CONFIRMED');
 const forecast=input.forecastId?session.forecasts.find(f=>f.id===input.forecastId):null;
 if(input.forecastId&&!forecast)throw new Error('AURORA_FORECAST_NOT_FOUND');
 if(input.completedAt&&forecast&&Date.parse(input.completedAt)<=Date.parse(forecast.frozenAt))throw new Error('AURORA_ACTION_BEFORE_FORECAST');
 const pending=session.executions.find(e=>!e.completedAt&&e.actionId===input.actionId&&e.forecastId===input.forecastId);
 const practiceSnapshot:PracticeSnapshot={goalText:session.goalText,goalTags:[...session.goalTags],sectorId:session.selectedSectorId,primarySnapshotId:session.primary.id,
  curatorId:session.curatorId,organon:structuredClone(session.organon),sphragisLetter:session.sphragisLetter,comfort:session.comfort,ritualMinutes:session.ritualMinutes,
  ecphonesis:session.ecphonesis,capturedAt:input.completedAt??input.plannedAt};
 const row={...structuredClone(input),id:pending?.id??input.id,plannedAt:pending?.plannedAt??input.plannedAt,practiceSnapshot};
 return {...session,executions:[...session.executions.filter(e=>e.id!==row.id&&(e.completedAt||e.actionId!==input.actionId||e.forecastId!==input.forecastId)),row],completedAt:input.completedAt??session.completedAt};
}
export function appendResolution(session:AuroraSession,resolution:ForecastResolution):AuroraSession{
 if(!session.forecasts.some(f=>f.id===resolution.forecastId))throw new Error('AURORA_RESOLUTION_REFERENCE');
 const sameId=session.resolutions.find(r=>r.id===resolution.id);
 if(sameId){if(canonicalJson(sameId)!==canonicalJson(resolution))throw new Error('AURORA_OBSERVATION_IMMUTABLE');return session;}
 const comparable=(r:ForecastResolution)=>canonicalJson({...r,id:undefined,recordedAt:undefined,outcomeEvidenceIds:r.outcomeEvidenceIds.map(id=>session.context.answerEvidence.find(e=>e.id===id)?.exactUserText??'')});
 if(session.resolutions.some(r=>comparable(r)===comparable(resolution)))return session;
 return {...session,resolutions:[...session.resolutions,structuredClone(resolution)]};
}
export function assertImmutableSession(previous:AuroraSession,next:AuroraSession):void{
 if(previous.id!==next.id||canonicalJson(previous.primary)!==canonicalJson(next.primary)||previous.ownerId!==next.ownerId)throw new Error('AURORA_PRIMARY_SNAPSHOT_IMMUTABLE');
 for(const record of previous.forecasts){const after=next.forecasts.find(r=>r.id===record.id);if(!after||canonicalJson(after)!==canonicalJson(record))throw new Error('AURORA_ISSUED_FORECAST_IMMUTABLE');}
 for(const context of previous.contextSnapshots){const after=next.contextSnapshots.find(c=>c.id===context.id);if(!after||canonicalJson(after)!==canonicalJson(context))throw new Error('AURORA_FROZEN_CONTEXT_IMMUTABLE');}
 for(const old of previous.executions.filter(e=>e.completedAt)){const after=next.executions.find(e=>e.id===old.id);if(!after||canonicalJson(after)!==canonicalJson(old))throw new Error('AURORA_EXECUTION_HISTORY_IMMUTABLE');}
 for(const old of previous.resolutions){const after=next.resolutions.find(r=>r.id===old.id);if(!after||canonicalJson(after)!==canonicalJson(old))throw new Error('AURORA_OBSERVATION_IMMUTABLE');}
}
export async function validateDocument(value:AuroraDocument,ownerId:string):Promise<AuroraDocument>{
 if(value?.learning)validatePersonalLearning(value.learning);
 if(!value||value.version!==1||value.ownerId!==ownerId||!ownerId||!Array.isArray(value.sessions)||value.sessions.length>100||!Array.isArray(value.removed))throw new Error('AURORA_INVALID_DOCUMENT_OWNER');
 if(value.removed.length>10000||value.removed.some(row=>!row||typeof row.id!=='string'||!row.id||row.id.length>150||!Number.isFinite(Date.parse(row.removedAt)))
  ||new Set(value.removed.map(row=>row.id)).size!==value.removed.length)throw new Error('AURORA_INVALID_DELETION');
 const ids=new Set<string>(),removed=new Set(value.removed.map(r=>r.id));
 for(const session of value.sessions){
  if(!session||session.version!==1||session.ownerId!==ownerId||ids.has(session.id)||removed.has(session.id)||!Number.isInteger(session.stage)||session.stage<0||session.stage>8||!Number.isInteger(session.highestStage)||session.highestStage<session.stage||session.highestStage>8)throw new Error('AURORA_INVALID_SESSION');
  if(session.forecastTest)validateForecastTest(session.forecastTest);
  if(session.transformation){validateTransformation(session.transformation,session.primary);if((session.transformation.sectors[0]??null)!==session.selectedSectorId)throw Error('AURORA_TRANSFORMATION_FOCUS');}
  ids.add(session.id);verifySourceDraw(session.primary);assertEligibleSector(session.primary,session.selectedSectorId);validateContext(session.context);
  if(typeof session.id!=='string'||!session.id||session.id.length>150||!Number.isFinite(Date.parse(session.createdAt))||!Number.isFinite(Date.parse(session.updatedAt))
   ||!Array.isArray(session.answers)||session.answers.length>1000||new Set(session.answers.map(a=>a.id)).size!==session.answers.length
   ||session.answers.some(a=>!QUESTIONS.some(q=>q.id===a.questionId)||!session.context.answerEvidence.some(e=>e.id===a.evidenceId))
   ||session.curatorId!==null&&!CURATOR_IDS.includes(session.curatorId)||!PROFILE_STATES.includes(session.profileState)
   ||![2,10,30].includes(session.minutes)||![1,3,5].includes(session.ritualMinutes)||!['gesture','without_hands','visual','mental'].includes(session.comfort))throw new Error('AURORA_INVALID_SESSION_CONTENT');
  if(session.triad)validateTemporalTriad(session.triad);
  if(session.observationOnly!==!eligibleSectors(session.primary).length)throw new Error('AURORA_INVALID_OBSERVATION_MODE');
  // All-upright and inconclusive situations may still have a practice. Exact word,
  // curator, seal and execution checks below apply equally to these sessions.
  if(session.guidePage&&(!Number.isInteger(session.guidePage.stage)||session.guidePage.stage<0||session.guidePage.stage>8||!Number.isInteger(session.guidePage.part)||session.guidePage.part<0||session.guidePage.part>5))throw Error('AURORA_INVALID_GUIDE_PAGE');
  const forecastIds=new Set<string>();for(const forecast of session.forecasts){
   if(forecastIds.has(forecast.id)||forecast.baseSpreadSnapshotId!==session.primary.id||forecast.situationId!==session.id&&!session.historyOrigins?.includes(forecast.situationId))throw new Error('AURORA_INVALID_FORECAST_REFERENCE');
   forecastIds.add(forecast.id);await verifyForecast(forecast);
   const context=session.contextSnapshots.find(c=>c.id===forecast.contextSnapshotId);if(!context)throw new Error('AURORA_FROZEN_CONTEXT_MISSING');
   if(forecast.conditionBranch&&!sameFrozenBranch(forecast.conditionBranch,context.profile))throw new Error('AURORA_INVALID_CONDITION_BRANCH');
  }
  if(session.conditionBranches){
   if(session.conditionBranches.length>8||new Set(session.conditionBranches.map(branch=>branch.id)).size!==session.conditionBranches.length)throw new Error('AURORA_INVALID_CONDITION_BRANCH');
   session.conditionBranches.forEach(validateScenarioBranch);
  }
  if(session.selectedConditionBranchId&&!session.conditionBranches?.some(branch=>branch.id===session.selectedConditionBranchId))throw new Error('AURORA_INVALID_CONDITION_BRANCH');
  for(const context of session.contextSnapshots)if(context.hash!==await payloadHash(context.profile))throw new Error('AURORA_CONTEXT_HASH_MISMATCH');
  if(session.organon&&(!session.curatorId||session.organon.entry.isopsephy!==DEITIES[session.curatorId].sum||isopsephy(session.organon.entry.canonicalForm)!==DEITIES[session.curatorId].sum))throw new Error('AURORA_ORGANON_CURATOR_MISMATCH');
  if(session.sphragisLetter&&!session.organon?.entry.canonicalForm.includes(session.sphragisLetter))throw new Error('AURORA_SPHRAGIS_NOT_IN_WORD');
  if(session.actionOptionIds.some(id=>!ACTIONS.some(a=>a.id===id)))throw new Error('AURORA_UNKNOWN_ACTION');
  if(new Set(session.executions.map(e=>e.id)).size!==session.executions.length)throw new Error('AURORA_DUPLICATE_EXECUTION');
  for(const execution of session.executions){
   if(!ACTIONS.some(a=>a.id===execution.actionId)||execution.forecastId&&!forecastIds.has(execution.forecastId)||!Number.isFinite(Date.parse(execution.plannedAt))
    ||![2,10,30].includes(execution.minutes)||execution.completedAt&&(!execution.actionCompleted||!execution.withoutRitual&&!execution.ritualCompleted||!execution.actualDescription.trim()
     ||!Number.isFinite(Date.parse(execution.completedAt))))throw new Error('AURORA_INVALID_EXECUTION');
   const practice=execution.practiceSnapshot;
   if(practice&&(practice.primarySnapshotId!==session.primary.id||!Number.isFinite(Date.parse(practice.capturedAt))
    ||practice.curatorId!==null&&!CURATOR_IDS.includes(practice.curatorId)||![1,3,5].includes(practice.ritualMinutes)
    ||!['gesture','without_hands','visual','mental'].includes(practice.comfort)
    ||practice.organon&&(!practice.curatorId||isopsephy(practice.organon.entry.canonicalForm)!==DEITIES[practice.curatorId].sum)
    ||practice.sphragisLetter&&!practice.organon?.entry.canonicalForm.includes(practice.sphragisLetter)))throw new Error('AURORA_INVALID_PRACTICE_SNAPSHOT');
  }
  for(const resolution of session.resolutions)if(!forecastIds.has(resolution.forecastId)||!Number.isFinite(Date.parse(resolution.recordedAt))
   ||!['pending','confirmed','contradicted','condition_unmet','indeterminate','unobserved','not_selected'].includes(resolution.status)
   ||resolution.outcomeEvidenceIds.some(id=>!session.context.answerEvidence.some(e=>e.id===id)))throw new Error('AURORA_RESOLUTION_REFERENCE');
  const resultIds=new Set<string>();for(const result of session.preparedResults){
   if(resultIds.has(result.id)||result.methodVersion!==MODEL_VERSION||!session.contextSnapshots.some(c=>c.hash===result.contextHash)
    ||!result.forecastHashes.length||result.forecastHashes.some(hash=>!session.forecasts.some(f=>f.payloadHash===hash))||!result.iv||!result.ciphertext)throw new Error('AURORA_RESULT_MANIFEST_INVALID');resultIds.add(result.id);
  }
  if(session.resultId&&!resultIds.has(session.resultId))throw new Error('AURORA_RESULT_REFERENCE');
 }
 return value;
}
