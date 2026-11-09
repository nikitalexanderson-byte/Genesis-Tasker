import type {AuroraSession} from './session';
import type {ForecastRecord,ForecastResolution} from './forecast';
import {GOLDEN_RATIO} from './transformation-math';

export const PERSONAL_LEARNING_VERSION=1;
export const LEARNING_DIMENSIONS=128;
export const LEARNING_MAX_BYTES=49152;
const BLOOM_BYTES=16384;
type Bin={n:number;p:number;y:number};
export type PersonalLearning={version:1;n:number;positive:number;z:number[];squared:number[];seen:string;brier:number;baselineBrier:number;bins:Bin[]};
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export function newPersonalLearning():PersonalLearning{return {version:1,n:0,positive:0,z:Array(LEARNING_DIMENSIONS).fill(0),squared:Array(LEARNING_DIMENSIONS).fill(0),seen:encode(new Uint8Array(BLOOM_BYTES)),brier:0,baselineBrier:0,bins:Array.from({length:10},()=>({n:0,p:0,y:0}))};}
export function validatePersonalLearning(value:PersonalLearning):void{
 if(!value||value.version!==1||!Number.isSafeInteger(value.n)||value.n<0||value.n>1e8||!Number.isSafeInteger(value.positive)||value.positive<0||value.positive>value.n
  ||!Array.isArray(value.z)||!Array.isArray(value.squared)||value.z.length!==LEARNING_DIMENSIONS||value.squared.length!==LEARNING_DIMENSIONS
  ||value.z.some(v=>!Number.isFinite(v)||Math.abs(v)>1e9)||value.squared.some(v=>!Number.isFinite(v)||v<0||v>1e9)
  ||typeof value.seen!=='string'||value.seen.length!==21848||!/^[A-Za-z0-9+/]+={0,2}$/u.test(value.seen)
  ||![value.brier,value.baselineBrier].every(v=>Number.isFinite(v)&&v>=0&&v<=value.n+1e-8)
  ||!Array.isArray(value.bins)||value.bins.length!==10||value.bins.some(bin=>!Number.isSafeInteger(bin.n)||bin.n<0||!Number.isFinite(bin.p)||bin.p<0||bin.p>bin.n||!Number.isSafeInteger(bin.y)||bin.y<0||bin.y>bin.n)
  ||value.bins.reduce((sum,bin)=>sum+bin.n,0)!==value.n||new TextEncoder().encode(JSON.stringify(value)).length>LEARNING_MAX_BYTES)throw Error('AURORA_LEARNING_INVALID');
 if(decode(value.seen).length!==BLOOM_BYTES)throw Error('AURORA_LEARNING_INVALID');
}
const hash=(text:string)=>{let value=2166136261;for(const char of text)value=Math.imul(value^char.charCodeAt(0),16777619);return value>>>0;};
function weights(model:PersonalLearning){return model.z.map((z,i)=>Math.abs(z)<=.01?0:-(z-Math.sign(z)*.01)/((1+Math.sqrt(model.squared[i]))*GOLDEN_RATIO**2+GOLDEN_RATIO));}
/** Fixed hashed features contain only catalog IDs and pre-forecast explicit answers.
 * Free text, names, later answers and observed outcomes never enter the feature vector. */
export function learningFeatures(session:AuroraSession,forecast:ForecastRecord):number[]{
 const context=session.contextSnapshots.find(row=>row.id===forecast.contextSnapshotId)?.profile;
 if(!context)throw Error('AURORA_LEARNING_CONTEXT');
 const features=[`scenario:${forecast.scenarioId??'none'}`,`action:${forecast.plannedActionId??'none'}`,`horizon:${forecast.horizon.mode}`];
 for(const card of session.primary.cards)features.push(`card:${card.sourcePositionId}:${card.cardId}:${card.orientation}`);
 for(const [field,value]of Object.entries(context.fields))if(value.status==='known'&&typeof value.value==='boolean'&&value.evidenceIds.every(id=>context.answerEvidence.some(row=>row.id===id&&row.explicitUserConfirmation&&!row.excludedReason)))features.push(`answer:${field}:${value.value}`);
 const result=Array(LEARNING_DIMENSIONS).fill(0);result[0]=1;
 for(const feature of features){const h=hash(feature),index=1+h%(LEARNING_DIMENSIONS-1);result[index]+=(h&0x80000000)?-1:1;}
 const norm=Math.max(1,Math.hypot(...result.slice(1)));for(let i=1;i<result.length;i++)result[i]/=norm;
 return result;
}
const logistic=(score:number)=>1/(1+Math.exp(-Math.max(-20,Math.min(20,score))));
export function personalPrediction(model:PersonalLearning,features:readonly number[]){
 validatePersonalLearning(model);if(features.length!==LEARNING_DIMENSIONS||features.some(v=>!Number.isFinite(v)||Math.abs(v)>1))throw Error('AURORA_LEARNING_FEATURES');
 const probability=logistic(weights(model).reduce((sum,value,i)=>sum+value*features[i],0));
 const calibration=model.bins.reduce((sum,bin)=>sum+(bin.n?Math.abs(bin.p-bin.y):0),0)/Math.max(1,model.n);
 const usable=model.n>=40&&model.positive>=5&&model.n-model.positive>=5&&model.brier<model.baselineBrier&&calibration<=.15;
 return {probability:usable?probability:null,observations:model.n,brier:model.n?model.brier/model.n:null,baselineBrier:model.n?model.baselineBrier/model.n:null,calibration,raw:probability};
}
const bloomPositions=(fingerprint:string)=>[0,1,2,3].map(index=>hash(`${index}:${fingerprint}`)%(BLOOM_BYTES*8));
/** Conservative replay filter: a collision skips a lesson; it can never teach twice. */
export function updatePersonalLearning(previous:PersonalLearning,features:readonly number[],label:0|1,fingerprint:string):PersonalLearning{
 validatePersonalLearning(previous);if(!/^[a-f0-9]{64}$/u.test(fingerprint)||![0,1].includes(label))throw Error('AURORA_LEARNING_LABEL');
 const bits=decode(previous.seen),positions=bloomPositions(fingerprint);
 if(positions.every(bit=>(bits[bit>>3]&(1<<(bit&7)))!==0))return previous;
 const prediction=personalPrediction(previous,features),probability=prediction.raw,oldWeights=weights(previous),alpha=GOLDEN_RATIO**-2;
 const model=structuredClone(previous),baseline=(previous.positive+1)/(previous.n+2);
 for(let i=0;i<LEARNING_DIMENSIONS;i++){
  const gradient=(probability-label)*features[i],squared=previous.squared[i]+gradient*gradient;
  model.z[i]+=gradient-(Math.sqrt(squared)-Math.sqrt(previous.squared[i]))/alpha*oldWeights[i];model.squared[i]=squared;
 }
 for(const bit of positions)bits[bit>>3]|=1<<(bit&7);
 model.seen=encode(bits);model.n++;model.positive+=label;model.brier+=(probability-label)**2;model.baselineBrier+=(baseline-label)**2;
 const bin=model.bins[Math.min(9,Math.floor(probability*10))];bin.n++;bin.p+=probability;bin.y+=label;
 validatePersonalLearning(model);return model;
}
export function learnResolvedForecast(model:PersonalLearning,session:AuroraSession,forecast:ForecastRecord,resolution:ForecastResolution):PersonalLearning{
 const horizon=resolution.resolvedHorizon;
 if(!session.context.historyPermission||forecast.status!=='issued'||!['confirmed','contradicted'].includes(resolution.status)||typeof resolution.observedOccurred!=='boolean'
  ||resolution.conditionStatus!=='met'||!resolution.outcomeEvidenceIds.length||!horizon||Date.parse(horizon.end)>Date.parse(resolution.recordedAt)
  ||Date.parse(forecast.frozenAt)>Date.parse(horizon.start)||resolution.outcomeEvidenceIds.some(id=>!session.context.answerEvidence.some(row=>row.id===id&&row.explicitUserConfirmation&&!row.excludedReason)))return model;
 const episode=session.forecasts.find(row=>row.id===(forecast.parentForecastId??forecast.id))??forecast;
 return updatePersonalLearning(model,learningFeatures(session,forecast),resolution.observedOccurred?1:0,episode.payloadHash);
}
/** Simultaneous devices cannot safely average two SGD histories. Preserve the replay
 * filter, reset unmergeable parameters/validation, and learn from future outcomes. */
export function mergePersonalLearning(base:PersonalLearning|undefined,left:PersonalLearning|undefined,right:PersonalLearning|undefined):PersonalLearning|undefined{
 const same=(a:unknown,b:unknown)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 if(same(left,base))return right;if(same(right,base)||same(left,right))return left;
 const merged=newPersonalLearning(),bits=new Uint8Array(BLOOM_BYTES);
 for(const value of [base,left,right])if(value){validatePersonalLearning(value);const seen=decode(value.seen);for(let i=0;i<bits.length;i++)bits[i]|=seen[i];}
 merged.seen=encode(bits);return merged;
}
