import type { ForecastRecord, ForecastResolution } from './forecast';

export const EMPIRICAL_VERSION = 'aurora-empirical-beta-binomial-v1';
export const EMPIRICAL_MIN_OBSERVATIONS = 30;
export type EmpiricalHistory = readonly { forecasts: readonly ForecastRecord[]; resolutions: readonly ForecastResolution[] }[];
export type EmpiricalEstimate = {
  version: typeof EMPIRICAL_VERSION;
  cutoff: string;
  probability: number | null;
  reason: 'history_disabled' | 'forecast_abstained' | 'insufficient_history' | 'unstable_history' | null;
  observations: number;
  successes: number;
  interval95: { lower: number; upper: number } | null;
  validation: { observations: number; brier: number; calibrationError: number; trainProbability: number } | null;
  forecastHashes: string[];
  evidenceSource: 'personal_observations';
};

const normalized = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru');
const timestamp = (value: string | null | undefined) => value ? Date.parse(value) : NaN;

/** Only repeated, operationally equivalent events are pooled. Symbols are never labels. */
export function empiricalCohort(record: ForecastRecord): string {
  const minutes=record.horizon.mode==='relative' ? record.horizon.durationMinutes
    : (timestamp(record.horizon.end)-timestamp(record.horizon.start))/60_000;
  // A two-day and a seven-day window must not share an event frequency merely
  // because both fit in a week. Preserve minute precision and the relative anchor.
  const horizon=[Math.ceil(minutes),...(record.horizon.mode==='relative'
    ?[record.horizon.startOffsetMinutes,normalized(record.horizon.anchorEvent)]:[])];
  return JSON.stringify([record.scenarioId,record.plannedActionId,record.horizon.mode,horizon,
    normalized(record.targetEvent),normalized(record.observableSuccessCriterion),normalized(record.observableFailureCriterion),
    record.conditions.filter(value=>value!==record.actionCondition).map(normalized).sort(),
    record.conditionBranch ? [record.conditionBranch.mode,record.conditionBranch.conditions.map(value=>normalized(value.statement)).sort()] : null]);
}

export function wilsonInterval(successes: number, observations: number) {
  if(!Number.isInteger(observations)||observations<1||!Number.isInteger(successes)||successes<0||successes>observations)
    throw new Error('AURORA_EMPIRICAL_COUNTS');
  const z=1.959963984540054,p=successes/observations,denominator=1+z*z/observations;
  const center=(p+z*z/(2*observations))/denominator;
  const radius=z*Math.sqrt(p*(1-p)/observations+z*z/(4*observations*observations))/denominator;
  return {lower:Math.max(0,center-radius),upper:Math.min(1,center+radius)};
}

/** Hold out the latest third. An outcome is usable only after the whole horizon has ended. */
export function estimateEmpiricalProbability(record: ForecastRecord, history: EmpiricalHistory, enabled: boolean): EmpiricalEstimate {
  const report:EmpiricalEstimate={version:EMPIRICAL_VERSION,cutoff:record.frozenAt,probability:null,
    reason:!enabled?'history_disabled':record.status!=='issued'?'forecast_abstained':'insufficient_history',
    observations:0,successes:0,interval95:null,validation:null,forecastHashes:[],evidenceSource:'personal_observations'};
  if(!enabled||record.status!=='issued')return report;
  const cutoff=timestamp(record.frozenAt),cohort=empiricalCohort(record);
  const latest=new Map<string,ForecastResolution>(),forecasts=new Map<string,ForecastRecord>(),conflicts=new Set<string>();
  for(const session of history){
    for(const forecast of session.forecasts) {
      const existing=forecasts.get(forecast.id);
      // A conflicting identity is not a second training observation.
      if(existing&&existing.payloadHash!==forecast.payloadHash){conflicts.add(forecast.id);continue;}
      forecasts.set(forecast.id,forecast);
    }
    for(const resolution of session.resolutions){
      const previous=latest.get(resolution.forecastId);
      if(!Number.isFinite(timestamp(resolution.recordedAt)))continue;
      if(previous&&timestamp(previous.recordedAt)===timestamp(resolution.recordedAt)&&JSON.stringify(previous)!==JSON.stringify(resolution))conflicts.add(resolution.forecastId);
      if(!previous||timestamp(previous.recordedAt)<timestamp(resolution.recordedAt))latest.set(resolution.forecastId,resolution);
    }
  }
  const situations=new Map<string,{label:number;conflict:boolean}>();
  const rows=[...forecasts.values()].flatMap(forecast=>{
    const outcome=latest.get(forecast.id),window=outcome?.resolvedHorizon;
    if(conflicts.has(forecast.id)||forecast.id===record.id||forecast.status!=='issued'||empiricalCohort(forecast)!==cohort
      ||!outcome||!['confirmed','contradicted'].includes(outcome.status)||typeof outcome.observedOccurred!=='boolean'
      ||outcome.conditionStatus!=='met'||!outcome.outcomeEvidenceIds.length||!window
      ||!Number.isFinite(timestamp(window.start))||!Number.isFinite(timestamp(window.end))
      ||timestamp(window.end)<=timestamp(window.start)||timestamp(window.start)<timestamp(forecast.frozenAt)
      ||timestamp(outcome.recordedAt)<timestamp(window.end)||timestamp(outcome.recordedAt)>=cutoff
      ||timestamp(forecast.frozenAt)>=cutoff||!Number.isFinite(timestamp(forecast.frozenAt))
      ||(outcome.status==='confirmed')!==(outcome.observedOccurred===(forecast.predictedOutcome==='occurs'))
      ||(outcome.observedOccurred&&(!Number.isFinite(timestamp(outcome.occurredAt))||timestamp(outcome.occurredAt)<timestamp(window.start)||timestamp(outcome.occurredAt)>timestamp(window.end))))return [];
    // Reissued/copy forecasts for the same situation do not multiply one observed event.
    const identity=JSON.stringify([forecast.situationId,empiricalCohort(forecast)]),label=outcome.observedOccurred?1:0;
    const previous=situations.get(identity);
    situations.set(identity,{label,conflict:Boolean(previous?.conflict||previous&&previous.label!==label)});
    return [{forecast,outcome,label,identity}];
  }).sort((a,b)=>timestamp(a.outcome.recordedAt)-timestamp(b.outcome.recordedAt)||a.forecast.id.localeCompare(b.forecast.id))
    .filter((row,index,all)=>!situations.get(row.identity)!.conflict&&all.findIndex(other=>other.identity===row.identity)===index);
  report.observations=rows.length;report.successes=rows.reduce((sum,row)=>sum+row.label,0);
  report.forecastHashes=rows.map(row=>row.forecast.payloadHash);
  if(rows.length<EMPIRICAL_MIN_OBSERVATIONS)return report;
  const split=Math.floor(rows.length*2/3),train=rows.slice(0,split),validation=rows.slice(split);
  const trainProbability=(train.reduce((sum,row)=>sum+row.label,0)+1)/(train.length+2);
  const heldOutRate=validation.reduce((sum,row)=>sum+row.label,0)/validation.length;
  const brier=validation.reduce((sum,row)=>sum+(trainProbability-row.label)**2,0)/validation.length;
  report.validation={observations:validation.length,brier,calibrationError:Math.abs(heldOutRate-trainProbability),trainProbability};
  report.interval95=wilsonInterval(report.successes,rows.length);
  if(brier>0.25+1e-12||report.validation.calibrationError>0.25){report.reason='unstable_history';return report;}
  report.reason=null;report.probability=(report.successes+1)/(rows.length+2);
  return report;
}

export function validEmpiricalEstimate(value: EmpiricalEstimate, record: ForecastRecord): boolean {
  if(!value||value.version!==EMPIRICAL_VERSION||value.cutoff!==record.frozenAt||value.evidenceSource!=='personal_observations'
    ||!Number.isInteger(value.observations)||value.observations<0||!Number.isInteger(value.successes)
    ||value.successes<0||value.successes>value.observations||!Array.isArray(value.forecastHashes)
    ||value.forecastHashes.length!==value.observations||value.forecastHashes.some(hash=>!/^[a-f0-9]{64}$/.test(hash)))return false;
  if(value.probability===null)return value.reason!==null&&['history_disabled','forecast_abstained','insufficient_history','unstable_history'].includes(value.reason);
  if(value.reason!==null||value.observations<EMPIRICAL_MIN_OBSERVATIONS||!value.interval95||!value.validation)return false;
  const interval=wilsonInterval(value.successes,value.observations);
  return value.probability===(value.successes+1)/(value.observations+2)
    &&value.interval95.lower===interval.lower&&value.interval95.upper===interval.upper
    &&Number.isInteger(value.validation.observations)&&value.validation.observations>=10
    &&Number.isFinite(value.validation.brier)&&value.validation.brier>=0&&value.validation.brier<=0.25+1e-12
    &&Number.isFinite(value.validation.calibrationError)&&value.validation.calibrationError>=0&&value.validation.calibrationError<=0.25
    &&Number.isFinite(value.validation.trainProbability)&&value.validation.trainProbability>=0&&value.validation.trainProbability<=1;
}
