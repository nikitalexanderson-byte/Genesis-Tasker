import {unifiedSuitability} from './draw-harmony';
import {SECTOR_IDS} from './registry';
import RU from './texts.ru.json';
import { SCENARIOS, type ScenarioRecord } from './catalog/scenarios';
import { predicateState } from './graph';
import { confirmedBoolean, currentEvidenceIds, knownValue } from './context';
import type { ActionRecord } from './catalog/actions';
import type { CompleteModel, Interval } from './model';
import type { PrimaryDrawSnapshot, SituationProfile } from './types';
import { MODEL_VERSION } from './model';
import { GRAPH_VERSION } from './graph';
import { estimateEmpiricalProbability, validEmpiricalEstimate, type EmpiricalEstimate, type EmpiricalHistory } from './empirical';
import { evaluateScenarioBranch, type ScenarioBranch, type FrozenScenarioBranch } from './condition-branches';
export const FORECAST_VERSION = 'aurora-conditional-forecast-v1';
export type Horizon = {
    mode: 'absolute';
    start: string;
    end: string;
    timezone: string;
} | {
    mode: 'relative';
    anchorEvent: string;
    startOffsetMinutes: number;
    durationMinutes: number;
    anchorDeadline: string;
    timezone: string;
};
export type ForecastRecord = {
    id: string;
    situationId: string;
    parentForecastId?: string;
    createdAt: string;
    frozenAt: string;
    payloadHash: string;
    contextSnapshotId: string;
    baseSpreadSnapshotId: string;
    temporalSpreadSnapshotId: string | null;
    projectionVersion: string;
    mythGraphVersion: string;
    algorithmVersion: string;
    contentVersion: string;
    targetEvent: string;
    horizon: Horizon;
    conditionDeadline: string;
    conditions: string[];
    observableSuccessCriterion: string;
    observableFailureCriterion: string;
    predictedOutcome: 'occurs' | 'does_not_occur';
    evidenceIds: string[];
    acceptedThemeIds: string[];
    competingScenarioId: string | null;
    scenarioId: string | null;
    plannedActionId: string | null;
    actionCondition: string | null;
    /** Estimated frequency of the target event; absent data never becomes a symbolic percentage. */
    probability: number | null;
    empirical?: EmpiricalEstimate;
    conditionBranch?: FrozenScenarioBranch;
    wordingSource?: 'choice_test_v1';
    status: 'issued' | 'abstained';
    abstentionReason: string | null;
};
export type ForecastResolution = {
    id: string;
    forecastId: string;
    status: 'pending' | 'confirmed' | 'contradicted' | 'condition_unmet' | 'indeterminate' | 'unobserved' | 'not_selected';
    observedOccurred: boolean | null;
    outcomeEvidenceIds: string[];
    occurredAt: string | null;
    resolvedHorizon: {
        start: string;
        end: string;
    } | null;
    recordedAt: string;
    actualActionsDuringHorizon: string[];
    evidenceSource: 'user_report' | 'documented';
    conditionStatus: 'met' | 'unmet' | 'unknown';
    experienceNote: string;
};
const finiteDate = (value: string) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('AURORA_NONFINITE_PAYLOAD');
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (typeof value === 'object' && value) {
        return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    throw new Error('AURORA_INVALID_CANONICAL_PAYLOAD');
}
export async function payloadHash(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalJson(value));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const nested of Object.values(value))
            deepFreeze(nested);
    }
    return value;
}
export function validateHorizon(horizon: Horizon, issuedAt: string): void {
    if (!horizon || !horizon.timezone || !finiteDate(issuedAt))
        throw new Error('AURORA_INVALID_HORIZON');
    try {
        new Intl.DateTimeFormat('en', { timeZone: horizon.timezone });
    }
    catch {
        throw new Error('AURORA_INVALID_TIMEZONE');
    }
    if (horizon.mode === 'absolute') {
        if (!finiteDate(horizon.start) || !finiteDate(horizon.end) || Date.parse(horizon.start) < Date.parse(issuedAt) || Date.parse(horizon.end) <= Date.parse(horizon.start) || Date.parse(horizon.end) <= Date.parse(issuedAt))
            throw new Error('AURORA_INVALID_HORIZON');
    }
    else if (horizon.mode !== 'relative' || !horizon.anchorEvent.trim() || !finiteDate(horizon.anchorDeadline) || Date.parse(horizon.anchorDeadline) <= Date.parse(issuedAt)
        || !Number.isInteger(horizon.startOffsetMinutes) || horizon.startOffsetMinutes < 0 || !Number.isInteger(horizon.durationMinutes) || horizon.durationMinutes < 1 || horizon.durationMinutes > 525600)
        throw new Error('AURORA_INVALID_HORIZON');
}
function featureInterval(states: readonly string[]): Interval {
    if (!states.length)
        return { lower: 0, upper: 1 };
    return { lower: states.filter(s => s === 'true').length / states.length, upper: states.filter(s => s !== 'false').length / states.length };
}
export function rankScenarios(profile: SituationProfile, model: CompleteModel, sectorId: string | null) {
    const scope=knownValue<string>(profile,'forecast_scope_mechanism'),phase=knownValue<string>(profile,'forecast_scope_phase');
    const rows = SCENARIOS.filter(s => (!scope||s.mechanismId===scope)&&(!phase||s.phase===phase)&&(sectorId === null || s.sectorId === sectorId) && !profile.rejectedThemes.includes(s.mechanismId)
        && s.exclusions.every(p => predicateState(profile, p) !== 'true') && s.required.every(p => predicateState(profile, p) !== 'false'));
    return rows.map(s => {
        const factual = featureInterval(s.required.map(p => predicateState(profile, p))), mechanism = featureInterval(s.required.slice(0, 2).map(p => predicateState(profile, p)));
        const temporal = featureInterval([{ field: 'horizon_defined', operator: 'eq' as const, value: true }, { field: 'phase_known', operator: 'eq' as const, value: true }].map(p => predicateState(profile, p)));
        const sector = model.sectors.find(x => x.id === s.sectorId)!, sum = sector.tension + sector.resource, symbolic = sum ? sector.tension / sum : 0;
        const score = { lower: 0.5 * factual.lower + 0.2 * mechanism.lower + 0.2 * temporal.lower + 0.1 * symbolic, upper: 0.5 * factual.upper + 0.2 * mechanism.upper + 0.2 * temporal.upper + 0.1 * symbolic };
        return { scenario: s, score: {lower:unifiedSuitability(score.lower,model.harmony,SECTOR_IDS.indexOf(s.sectorId)+1),upper:unifiedSuitability(score.upper,model.harmony,SECTOR_IDS.indexOf(s.sectorId)+1)}, fullyApplicable: s.required.every(p => predicateState(profile, p) === 'true'), unknownFields: s.required.filter(p => predicateState(profile, p) === 'unknown').map(p => p.field) };
    }).sort((a, b) => b.score.lower - a.score.lower || b.score.upper - a.score.upper || (a.scenario.id < b.scenario.id ? -1 : 1));
}
export function distinguishingFields(ranked: ReturnType<typeof rankScenarios>): string[] {
    const leader = ranked[0];
    if (!leader)
        return [];
    return [...new Set(ranked.filter(s => s.score.upper >= leader.score.lower).slice(0, 3).flatMap(s => s.unknownFields))];
}
export type ForecastDraftInput = {
    id: string;
    now: string;
    profile: SituationProfile;
    primary: PrimaryDrawSnapshot;
    model: CompleteModel;
    contextSnapshotId: string;
    temporalId: string | null;
    sectorId: string | null;
    horizon: Horizon;
    targetEvent: string;
    successCriterion: string;
    failureCriterion: string;
    conditions: string[];
    conditionDeadline: string;
    selectedScenarioId: string | null;
    actions: readonly ActionRecord[];
    parentForecastId?: string;
    predictedOutcome?: 'occurs' | 'does_not_occur';
    empiricalHistory?: EmpiricalHistory;
    historyPermission?: boolean;
    conditionBranch?: ScenarioBranch;
    wordingSource?: 'choice_test_v1';
};
export async function issueForecast(input: ForecastDraftInput): Promise<ForecastRecord> {
    validateHorizon(input.horizon, input.now);
    if (!input.id || !input.contextSnapshotId || input.conditions.length > 20 || !finiteDate(input.conditionDeadline))
        throw new Error('AURORA_INVALID_FORECAST_INPUT');
    if (confirmedBoolean(input.profile, 'outcome_not_known', false))
        throw new Error('AURORA_RETROSPECTIVE_FORECAST_FORBIDDEN');
    const contextConfirmed = confirmedBoolean(input.profile, 'context_confirmed'), outcomeUnknown = confirmedBoolean(input.profile, 'outcome_not_known');
    const ranked = rankScenarios(input.profile, input.model, input.sectorId), selected = ranked.find(r => r.scenario.id === input.selectedScenarioId);
    const horizonEnd = input.horizon.mode === 'absolute' ? input.horizon.end : input.horizon.anchorDeadline;
    if (Date.parse(input.conditionDeadline) > Date.parse(horizonEnd) || Date.parse(input.conditionDeadline) < Date.parse(input.now))
        throw new Error('AURORA_INVALID_CONDITION_DEADLINE');
    const basis = currentEvidenceIds(input.profile), distinct = input.targetEvent.trim() !== input.successCriterion.trim() && input.successCriterion.trim() !== input.failureCriterion.trim();
    const targetOkay = input.targetEvent.trim().length >= 8 && input.successCriterion.trim().length >= 8 && input.failureCriterion.trim().length >= 8 && distinct
        && !input.actions.some(a => a.title.trim() === input.targetEvent.trim() || a.observableCompletion.trim() === input.targetEvent.trim());
    const horizonBasis = knownValue<string>(input.profile, 'horizon_basis');
    const opposite = selected ? ranked.find(r => r.scenario.id !== selected.scenario.id && r.scenario.predictedOutcome !== selected.scenario.predictedOutcome && r.score.upper >= selected.score.lower - 1e-12) : null;
    const conditionBranch=input.conditionBranch?evaluateScenarioBranch(input.conditionBranch,input.profile):null;
    const reason = !contextConfirmed ? 'context_not_confirmed' : !outcomeUnknown ? 'outcome_already_known_or_unknown' : !targetOkay ? 'target_not_distinguishable' : !horizonBasis || horizonBasis.trim().length < 8 ? 'time_basis_missing' : !selected ? 'no_compatible_scenario' : !selected.fullyApplicable ? 'conditions_not_established' : conditionBranch&&conditionBranch.state!=='true' ? 'branch_conditions_not_established' : opposite ? 'scenario_ambiguity' : null;
    const record: ForecastRecord = { id: input.id, situationId: input.profile.situationId, ...(input.parentForecastId ? { parentForecastId: input.parentForecastId } : {}), createdAt: input.now, frozenAt: input.now, payloadHash: '',
        contextSnapshotId: input.contextSnapshotId, baseSpreadSnapshotId: input.primary.id, temporalSpreadSnapshotId: input.temporalId, projectionVersion: input.primary.projectionVersion, mythGraphVersion: GRAPH_VERSION, algorithmVersion: FORECAST_VERSION, contentVersion: 'aurora-content-v1',
        targetEvent: input.targetEvent.trim(), horizon: structuredClone(input.horizon), conditionDeadline: input.conditionDeadline, conditions: [...input.conditions], observableSuccessCriterion: input.successCriterion.trim(), observableFailureCriterion: input.failureCriterion.trim(),
        predictedOutcome: input.predictedOutcome ?? selected?.scenario.predictedOutcome ?? 'occurs', evidenceIds: basis, acceptedThemeIds: [...input.profile.acceptedThemes], competingScenarioId: opposite?.scenario.id ?? ranked.find(r => r.scenario.id !== selected?.scenario.id && r.score.upper >= (selected?.score.lower ?? 1))?.scenario.id ?? null,
        scenarioId: selected?.scenario.id ?? null, plannedActionId: null, actionCondition: null, probability: null, status: reason ? 'abstained' : 'issued', abstentionReason: reason };
    if(conditionBranch)record.conditionBranch=conditionBranch;
    if(input.wordingSource)record.wordingSource=input.wordingSource;
    if(input.empiricalHistory){
        record.empirical=estimateEmpiricalProbability(record,input.empiricalHistory,input.historyPermission===true);
        record.probability=record.empirical.probability;
    }
    record.payloadHash = await payloadHash({ ...record, payloadHash: undefined });
    return deepFreeze(record);
}
export async function conditionalForecast(base: ForecastRecord, action: ActionRecord, id: string, now: string,
    history?: EmpiricalHistory, historyPermission=false): Promise<ForecastRecord> {
    if (!finiteDate(now) || Date.parse(now) < Date.parse(base.frozenAt))
        throw new Error('AURORA_INVALID_FORECAST_TIME');
    const actionCondition = (RU.text1610 + action.title + "\u00BB: " + action.durationVariants.map(v => ("" + v.minutes + RU.text1611 + v.observableCompletion)).join('; '));
    const record: ForecastRecord = { ...structuredClone(base), id, parentForecastId: base.id, createdAt: now, frozenAt: now, payloadHash: '', plannedActionId: action.id, actionCondition,
        conditions: [...base.conditions, actionCondition],probability:null };
    delete record.empirical;
    if(history){record.empirical=estimateEmpiricalProbability(record,history,historyPermission);record.probability=record.empirical.probability;}
    record.payloadHash = await payloadHash({ ...record, payloadHash: undefined });
    return deepFreeze(record);
}
export async function verifyForecast(record: ForecastRecord): Promise<void> {
    if ((record.empirical ? !validEmpiricalEstimate(record.empirical,record)||record.probability!==record.empirical.probability : record.probability!==null)
        || record.wordingSource!==undefined&&record.wordingSource!=='choice_test_v1'
        || record.status==='issued'&&record.conditionBranch&&record.conditionBranch.state!=='true'
        || record.algorithmVersion !== FORECAST_VERSION || !/^[a-f0-9]{64}$/.test(record.payloadHash) || record.payloadHash !== await payloadHash({ ...record, payloadHash: undefined }))
        throw new Error('AURORA_FORECAST_HASH_MISMATCH');
    validateHorizon(record.horizon, record.frozenAt);
}
export function resolveHorizon(record: ForecastRecord, anchorAt: string | null): {
    start: string;
    end: string;
} | null {
    if (record.horizon.mode === 'absolute')
        return { start: record.horizon.start, end: record.horizon.end };
    if (!anchorAt)
        return null;
    if (!finiteDate(anchorAt) || Date.parse(anchorAt) < Date.parse(record.frozenAt) || Date.parse(anchorAt) > Date.parse(record.horizon.anchorDeadline))
        throw new Error('AURORA_ANCHOR_OUTSIDE_WINDOW');
    const start = Date.parse(anchorAt) + record.horizon.startOffsetMinutes * 60000;
    return { start: new Date(start).toISOString(), end: new Date(start + record.horizon.durationMinutes * 60000).toISOString() };
}
export function reviewCalendarPoint(record: ForecastRecord, anchorAt: string | null = null): {
    date: string;
    time: string;
    timezone: string;
} | null {
    const horizon = resolveHorizon(record, anchorAt);
    if (!horizon)
        return null;
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: record.horizon.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(horizon.end));
    const get = (type: string) => parts.find(p => p.type === type)!.value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, timezone: record.horizon.timezone };
}
export function evaluateForecast(record: ForecastRecord, input: {
    id: string;
    now: string;
    selected: boolean;
    conditionStatus: 'met' | 'unmet' | 'unknown';
    conditionAt: string | null;
    anchorAt: string | null;
    observedOccurred: boolean | null;
    occurredAt: string | null;
    observationComplete: boolean;
    contradictoryObservation: boolean;
    evidenceIds: string[];
    actualActionIds: string[];
    completedConditionActionIds?: string[];
    evidenceSource: 'user_report' | 'documented';
    experienceNote: string;
}): ForecastResolution {
    if (!finiteDate(input.now) || Date.parse(input.now) < Date.parse(record.frozenAt) || input.occurredAt && (!finiteDate(input.occurredAt) || Date.parse(input.occurredAt) > Date.parse(input.now) || Date.parse(input.occurredAt) < Date.parse(record.frozenAt)))
        throw new Error('AURORA_INVALID_OBSERVATION_TIME');
    if (input.observedOccurred !== null && !input.evidenceIds.length)
        throw new Error('AURORA_OUTCOME_EVIDENCE_REQUIRED');
    if (input.conditionStatus === 'met' && (!input.conditionAt || !finiteDate(input.conditionAt) || Date.parse(input.conditionAt) < Date.parse(record.frozenAt) || Date.parse(input.conditionAt) > Date.parse(input.now)))
        throw new Error('AURORA_CONDITION_TIME_REQUIRED');
    if (record.plannedActionId && input.selected && input.conditionStatus === 'met' && !(input.completedConditionActionIds ?? input.actualActionIds).includes(record.plannedActionId))
        throw new Error('AURORA_ACTION_CONDITION_UNCONFIRMED');
    if (input.observedOccurred === true && !input.occurredAt)
        throw new Error('AURORA_EVENT_TIME_REQUIRED');
    const horizon = resolveHorizon(record, input.anchorAt), now = Date.parse(input.now), expiredCondition = now >= Date.parse(record.conditionDeadline);
    if (input.observedOccurred === true && horizon && input.occurredAt && (Date.parse(input.occurredAt) < Date.parse(horizon.start) || Date.parse(input.occurredAt) > Date.parse(horizon.end)))
        throw new Error('AURORA_EVENT_OUTSIDE_HORIZON');
    const lateCondition = input.conditionStatus === 'met' && Date.parse(input.conditionAt!) > Date.parse(record.conditionDeadline);
    let status: ForecastResolution['status'] = 'pending';
    if (!input.selected)
        status = 'not_selected';
    else if (record.status === 'abstained' || input.contradictoryObservation)
        status = 'indeterminate';
    else if ((input.conditionStatus === 'unmet' || lateCondition) && expiredCondition)
        status = 'condition_unmet';
    else if (input.conditionStatus === 'unknown')
        status = expiredCondition ? 'unobserved' : 'pending';
    else if (input.conditionStatus === 'unmet' || lateCondition)
        status = 'pending';
    else if (!horizon)
        status = record.horizon.mode === 'relative' && now >= Date.parse(record.horizon.anchorDeadline) ? input.observationComplete ? 'condition_unmet' : 'unobserved' : 'pending';
    else if (input.observedOccurred === true && input.occurredAt && Date.parse(input.occurredAt) >= Date.parse(horizon.start) && Date.parse(input.occurredAt) <= Date.parse(horizon.end))
        status = record.predictedOutcome === 'occurs' ? 'confirmed' : 'contradicted';
    else if (now < Date.parse(horizon.end))
        status = 'pending';
    else if (input.observedOccurred === null || !input.observationComplete)
        status = 'unobserved';
    else
        status = record.predictedOutcome === 'does_not_occur' ? 'confirmed' : 'contradicted';
    return { id: input.id, forecastId: record.id, status, observedOccurred: input.observedOccurred, outcomeEvidenceIds: [...input.evidenceIds], occurredAt: input.occurredAt, resolvedHorizon: horizon, recordedAt: input.now, actualActionsDuringHorizon: [...input.actualActionIds], evidenceSource: input.evidenceSource, conditionStatus: input.conditionStatus, experienceNote: input.experienceNote };
}
export function scenarioSummary(scenario: ScenarioRecord): string { return scenario.development; }
export function forecastAuditSummary(records: readonly ForecastRecord[], resolutions: readonly ForecastResolution[]) {
    const issued = records.filter(r => r.status === 'issued'), latest = new Map<string, ForecastResolution>();
    for (const row of resolutions)
        if (!latest.has(row.forecastId) || latest.get(row.forecastId)!.recordedAt < row.recordedAt)
            latest.set(row.forecastId, row);
    const outcomes = issued.map(r => latest.get(r.id)), determined = outcomes.filter(r => r && ['confirmed', 'contradicted'].includes(r.status));
    return { version: MODEL_VERSION, issued: issued.length, resolved: determined.length, confirmed: determined.filter(r => r?.status === 'confirmed').length,
        unknown: outcomes.filter(r => !r || ['pending', 'unobserved', 'indeterminate'].includes(r.status)).length, conditionUnmet: outcomes.filter(r => r?.status === 'condition_unmet').length,
        notSelected: outcomes.filter(r => r?.status === 'not_selected').length, calibratedProbabilities: issued.filter(r=>r.probability!==null&&r.empirical?.validation).length };
}
export function contextNowLines(profile: SituationProfile): string[] {
    return ['event_description', 'current_constraint', 'available_resources'].flatMap(field => { const value = knownValue<string>(profile, field); return value ? [value] : []; }).slice(0, 2);
}
