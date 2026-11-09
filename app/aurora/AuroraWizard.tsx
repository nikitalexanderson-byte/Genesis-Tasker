"use client";
import availability from './availability.json';
import type { OptionalTemporalTriadSnapshot } from './types';
import RU from './texts.ru.json';
import A from './adaptive-copy.ru.json';
import {MethodSheet} from './MethodSheet';
import {QuestionGuidance,guidedCopy} from './QuestionGuidance';
import {domainChoices,questionPresentation,practicalGuidance,text as adaptiveText} from './adaptive-content';
import {useAuroraAnalysis} from './use-aurora-analysis';
/* eslint-disable @next/next/no-img-element -- Original local card and deity artwork is preserved. */
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DialogCloseButton } from '../DialogCloseButton';
import {IconActionButton} from '../IconActionButton';
import sessionCopy from './session-copy.json';
import { useDialogAccessibility } from '../use-dialog-accessibility';
import { getStoicheionLetters } from '../stoicheion-data';
import { SECTORS, DEITIES, CURATOR_IDS, type CuratorId } from './registry';
import { newSession, removeSavedSession, moveStage, freezeContext, recordExecution, appendResolution, validateDocument, invalidateSessionDraft, type AuroraDocument, type AuroraSession, type ActionExecution, type ObservationDraft } from './session';
import { calculateModel, recommendCurators, chooseActions } from './model';
import {toggleTransformationSector,updateTransformationIntake} from './transformation';
import {TransformationView} from './TransformationView';
import {newPersonalLearning,learnResolvedForecast,personalPrediction,learningFeatures,type PersonalLearning} from './personal-learning';
import { ForecastTest } from './ForecastTest';
import { compileForecastTest,recordForecastAnswers, forecastScreenMissing,moveForecastScreen, forecastTestProblems, newForecastTest,hasObservationEvidence } from './forecast-test';
import {ChoiceOptions,ChoiceSelect,RecordedTimeChoices} from './ChoiceOptions';
import {AuroraCards} from './AuroraCards';
import { buildDecisionPlan } from './decision-plans';
import T from './forecast-test-copy.ru.json';
import { useAuroraLanguage } from './use-aurora-language';
import { transliterateGreek } from './transliteration';
import { translateText } from '../i18n';
import { applyAnswer, reviseAnswer, currentInterviewAnswers, recordField, knownValue, confirmedBoolean, branchingConsequences, type AnswerInput } from './context';
import {answeredQuestionCount,questionLimitForStage} from './question-budget';
import { createTemporalTriad, validateTemporalTriad } from './draw-policy';
import { issueForecast, conditionalForecast, evaluateForecast, resolveHorizon, reviewCalendarPoint, contextNowLines, type Horizon } from './forecast';
import { verifyPreparedSolution, type VerifiedAuroraSolution } from './result';
import type { AuroraConflict } from './repository';
import { MEANING_PROFILES, PROFILE_STATES, type ProfileState } from './catalog/profiles';
import { MYTH_TRANSITIONS } from './catalog/myths';
import { ACTIONS, type ActionDuration } from './catalog/actions';
import { QUESTIONS } from './catalog/questions';
import { STEP_HELP } from './help';
import { SPHRAGISES } from './catalog/sphragises';
import { chooseSphragis, ritualInstructions, type ComfortMode } from './sphragis';
import type { OrganonSelection, OrganonPreferences } from './organon';
import type { PrimaryDrawSnapshot, SituationProfile, EvidenceKind } from './types';
import type { AuroraHost } from './host';
import { AuroraPayment } from './AuroraPayment';
import './aurora.css';
const STAGES = [A.cardsTitle, RU.text0003, RU.text0004, RU.text0005, RU.text0006, RU.text0007, RU.text0008, RU.text0009, RU.text0010];
const QUALITY = [['clarity', RU.text0011], ['strategy', RU.text0012], ['measure', RU.text0013], ['responsibility', RU.text0014], ['boundary', RU.text0015], ['protection', RU.text0016], ['exchange', RU.text0017], ['request', RU.text0018], ['reciprocity', RU.text0019], ['agreement', RU.text0020], ['belonging', RU.text0021], ['feeling', RU.text0022], ['pause', RU.text0023], ['care', RU.text0024], ['growth', RU.text0025], ['craft', RU.text0026], ['completion', RU.text0027], ['initiative', RU.text0028], ['action', RU.text0029], ['rhythm', RU.text0030], ['stability', RU.text0031], ['expression', RU.text0032], ['creativity', RU.text0033]] as const;
const MODES: Record<ProfileState, string> = { resource: RU.text0043, excess: RU.text0044, deficit: RU.text0045, integration: RU.text0046 };
const RESOLUTION_LABELS: Record<string, string> = { pending: RU.text0047, confirmed: RU.text0048, contradicted: RU.text0049, condition_unmet: RU.text0050, indeterminate: RU.text0051, unobserved: RU.text0052, not_selected: RU.text0053 };
const now = () => new Date().toISOString();
const authoredGoals=new Set(ACTIONS.flatMap(action=>[action.title,`${action.title}: ${action.instructions[0]}`]));
function Notice({ children }: {
    children: ReactNode;
}) { return <p className="aurora-notice">{children}</p>; }
async function computeOrganon(curatorId: CuratorId, preferences: OrganonPreferences): Promise<OrganonSelection> {
    const worker = new Worker(new URL('./organon.worker.ts', import.meta.url), { type: 'module' }), requestId = crypto.randomUUID();
    try {
        return await new Promise((resolve, reject) => { worker.onmessage = event => { if (event.data.requestId === requestId) {
            if (event.data.result)
                resolve(event.data.result);
            else
                reject(new Error('AURORA_NO_COMFORTABLE_EXACT_FORM'));
        } }; worker.onerror = () => reject(new Error('AURORA_WORD_UNAVAILABLE')); worker.postMessage({ requestId, curatorId, preferences }); });
    }
    finally {
        worker.terminate();
    }
}
export function AuroraWizard({ host, primary, temporal = null, lockSource = false }: {
    host: AuroraHost;
    primary: PrimaryDrawSnapshot | null;
    temporal?: OptionalTemporalTriadSnapshot | null;
    lockSource?: boolean;
}) {
    const [document, setDocument] = useState<AuroraDocument | null>(null), [activeId, setActiveId] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saveState, setSaveState] = useState(RU.text0065), [unlockedId, setUnlockedId] = useState<string | null>(null);
    const [conflict, setConflict] = useState<AuroraConflict | null>(null), [archivedSolution, setArchivedSolution] = useState<VerifiedAuroraSolution | null>(null);
    const [deleteId,setDeleteId]=useState<string|null>(null);
    const [historyEdit,setHistoryEdit]=useState<{sessionId:string;answerId:string;choiceId:AnswerInput['choiceId']}|null>(null);
    const cancelDelete=useRef<HTMLButtonElement|null>(null);
    useEffect(()=>{if(deleteId)cancelDelete.current?.focus();},[deleteId]);
    const documentRef = useRef<AuroraDocument | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), alive = useRef(true), heading = useRef<HTMLHeadingElement | null>(null);
    const visibleSessions = document?.sessions.filter(s => !lockSource || primary && s.primary.sourceSeed === primary.sourceSeed && s.primary.sourceDay === primary.sourceDay) ?? [];
    const session = visibleSessions.find(s => s.id === activeId) ?? null;
    const observation = session?.observationDraft ?? { occurred: 'unknown', conditions: 'unknown', occurredAt: '', conditionAt: '', anchorAt: '', complete: false, contradictory: false, description: '' };
    const { ritualDone = false, actionDone = false, withoutRitual = false } = session?.completionDraft ?? {};
    function setObservation(value: ObservationDraft) { if (session)
        change({ ...session, observationDraft: value }); }
    function setRitualDone(value: boolean) { if (session)
        change({ ...session, completionDraft: { ...session.completionDraft, ritualDone: value } }); }
    function setActionDone(value: boolean) { if (session)
        change({ ...session, completionDraft: { ...session.completionDraft, actionDone: value } }); }
    function setWithoutRitual(value: boolean) { if (session)
        change({ ...session, completionDraft: { ...session.completionDraft, withoutRitual: value } }); }
    const resultId = session?.resultId;
    const currentStage = session?.stage, sessionId = session?.id;
    const {model,candidates,selectedSectors,question,atlas}=useAuroraAnalysis(session);
    const goalOptions=atlas&&(selectedSectors.length||session?.observationOnly)?atlas.goals:[];
    // Keep a saved handwritten goal selectable without modifying existing work or adding a sixth option.
    const displayedGoals = session?.goalText && !goalOptions.some(option => option.value === session.goalText || option.title === session.goalText)
        ? [{ id: 'saved-goal', title: session.goalText, description: '', value: session.goalText, goalTags: session.goalTags }, ...goalOptions].slice(0, 5) : goalOptions;
    const reportingError = useCallback((reason: unknown) => {
        const code = reason instanceof Error ? reason.message : '';
        if (code.includes('CONFLICT'))
            void host.conflictVersions().then(setConflict).catch(() => undefined);
        setError(code.includes('OBSERVATION_TIME') || code.includes('CONDITION_TIME') || code.includes('EVENT_TIME') ? RU.observationTime : code.includes('OUTCOME_EVIDENCE') ? RU.observationEvidence : code.includes('CONFLICT') ? RU.text0066 : code.includes('ACTIONS_UNAVAILABLE') ? RU.text0067 : code.includes('HORIZON') || code.includes('DEADLINE') ? RU.text0068 : code.includes('BASIS') ? RU.text0069 : code.includes('RETROSPECTIVE') ? RU.text0070 : code.includes('COMPLETION') || code.includes('ACTUAL_ACTION') || code.includes('ACTION_CONDITION') ? RU.text0071 : code.includes('ORGANON') || code.includes('WORD') ? RU.text0072 : RU.text0073);
    }, [host]);
    async function persist(value = documentRef.current) {
        if (!value || host.syncState() === 'conflict')
            return;
        setSaveState(RU.text0074);
        const saved = await host.save(value);
        if (!alive.current)
            return;
        if (documentRef.current === value) {
            documentRef.current = saved;
            setDocument(saved);
        }
        setSaveState(host.syncState() === 'offline' ? RU.text0075 : RU.text0076);
    }
    function change(next: AuroraSession, invalidateForecast = false, learning?:PersonalLearning) {
        const current = documentRef.current;
        if (!current)
            return;
        if (invalidateForecast) next=invalidateSessionDraft(next);
        const value = { ...current, ...(learning?{learning}:{}), activeSessionId:next.id, sessions: current.sessions.map(s => s.id === next.id ? { ...next, updatedAt: now() } : s) };
        documentRef.current = value;
        setDocument(value);
        setError('');
        setSaveState(RU.text0074);
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = setTimeout(() => void persist(value).catch(reportingError), 400);
    }
    async function close() { if (timer.current)
        clearTimeout(timer.current); try {
        await persist();
        host.close();
    }
    catch (reason) {
        reportingError(reason);
    } }
    const dialogElement = useRef<HTMLElement | null>(null);
    const locale=useAuroraLanguage(dialogElement,host.language);
    const dialog = useDialogAccessibility<HTMLElement>(() => void close(),locale.ready);
    useEffect(() => {
        alive.current = true;
        const oldOverflow = globalThis.document.body.style.overflow;
        globalThis.document.body.style.overflow = 'hidden';
        void host.load().then(async (value) => {
            const loaded = await validateDocument(value, host.ownerId);
            if (!alive.current)
                return;
            if (temporal) validateTemporalTriad(temporal);
            const candidates = loaded.sessions.filter(s => !lockSource || primary && s.primary.sourceSeed === primary.sourceSeed && s.primary.sourceDay === primary.sourceDay);
            const existing = candidates.find(s=>s.id===loaded.activeSessionId) ?? candidates.filter(s => !s.completedAt && (!primary || s.primary.sourceSeed === primary.sourceSeed && s.primary.sourceDay === primary.sourceDay)).at(-1) ?? candidates.at(-1);
            const changedTemporal = lockSource && temporal && existing && existing.triad?.sourceSeed !== temporal.sourceSeed;
            const frozenResult = changedTemporal && existing.forecasts.length > 0;
            const base = frozenResult && primary ? newSession({ id: crypto.randomUUID(), ownerId: host.ownerId, now: now(), primary, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : existing ?? (primary&&!loaded.removed.length ? newSession({ id: crypto.randomUUID(), ownerId: host.ownerId, now: now(), primary, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) : null);
            const selected = base && temporal && !base.forecasts.length ? { ...base, triad: structuredClone(temporal) } : base;
            const doc = selected ? { ...loaded, sessions: [...loaded.sessions.filter(s => s.id !== selected.id), selected] } : loaded;
            documentRef.current = doc;
            setDocument(doc);
            setActiveId(selected?.id ?? '');
            setSaveState(host.syncState() === 'offline' ? RU.text0075 : RU.text0076);
        }).catch(reportingError);
        return () => { alive.current = false; globalThis.document.body.style.overflow = oldOverflow; if (timer.current)
            clearTimeout(timer.current); if (documentRef.current && host.syncState() !== 'conflict')
            void host.save(documentRef.current).catch(() => undefined); };
    }, [host, primary, temporal, lockSource, reportingError]);
    useEffect(() => { if (sessionId) {
        dialogElement.current?.scrollTo({top:0});
        heading.current?.focus({ preventScroll: true });
    } }, [currentStage, sessionId]);
    useEffect(() => {
        let active = true;
        if (resultId)
            void (async () => {
                const manifest = documentRef.current?.sessions.find(s => s.id === activeId)?.preparedResults.find(r => r.id === resultId);
                if (!manifest)
                    return;
                await host.prepareResult(manifest);
                const result = await host.readResult(resultId);
                const verified = await verifyPreparedSolution(result.solution, manifest);
                if (active) {
                    setArchivedSolution(verified);
                    setUnlockedId(resultId);
                }
            })().catch(() => undefined);
        return () => { active = false; };
    }, [host, resultId, activeId]);
    async function run(operation: () => Promise<void>) { if (busy)
        return; setBusy(true); setError(''); try {
        await operation();
    }
    catch (reason) {
        reportingError(reason);
    }
    finally {
        if (alive.current)
            setBusy(false);
    } }
    function next(stage: number, value = session) { if (!value)
        return; try {
        change(moveStage(value, stage, now()));
    }
    catch (reason) {
        reportingError(reason);
    } }
    function field(profile: SituationProfile, name: string, value: string | boolean, kind: EvidenceKind = 'reported_event') {
        return recordField(profile, { id: crypto.randomUUID(), field: name, value, exactUserText: String(value), kind, confirmed: true, beforeInterpretation: (session?.highestStage ?? 0) < 4 });
    }
    function answerIntake(kind:'constraint'|'resources'|'unknown',id:string){
        if(session)change(updateTransformationIntake(session,kind,id,crypto.randomUUID()),true);
    }
    function saveHistoryAnswer(){
        if(!session||!historyEdit||historyEdit.sessionId!==session.id)return;
        const previous=session.answers.find(answer=>answer.id===historyEdit.answerId);if(!previous)return;
        try{
            const choiceId=historyEdit.choiceId;
            const result=reviseAnswer(session.context,session.answers,previous.id,{id:crypto.randomUUID(),questionId:previous.questionId,choiceId,detail:'',responseMode:'choice',confirmed:choiceId==='yes'||choiceId==='no',createdAt:now()},session.highestStage<4);
            change({...session,context:result.profile,answers:result.answers,revisingQuestionId:null},true);setHistoryEdit(null);
        }catch(reason){reportingError(reason);}
    }
    function intakeNext() {
        if (!session)
            return;
        let context = { ...session.context, originalQuestion: session.intake.question ?? '', domain: session.intake.domain ?? 'other' };
        for (const [key, kind] of [['event_description', 'reported_event'], ['current_constraint', 'constraint'], ['available_resources', 'constraint'], ['unknown_description', 'interpretation']] as const) {
            const text = session.intake[key]?.trim();
            if (text&&text!==RU.text0127)
                context = field(context, key, text, kind);
        }
        context = field(context, 'desired_change', session.goalText, 'value');
        const fields = { ...context.fields };
        delete fields.context_confirmed;
        next(3, { ...session, context: { ...context, fields } });
    }
    async function prepareForecast() {
        if (!session || model?.status !== 'complete')
            return;
        const stamp = now();
        if(!session.forecastTest)throw new Error('AURORA_FORECAST_TEST_INCOMPLETE');
        const compiled=compileForecastTest(session.forecastTest,session.context,session.selectedSectorId,stamp,()=>crypto.randomUUID()),form=compiled.form;
        const end = new Date(form.end).toISOString(), deadline = new Date(form.conditionDeadline || form.end).toISOString();
        let profile = field(compiled.context, 'horizon_defined', true, 'constraint');
        if(atlas&&session.transformation){profile=field(profile,'transformation_selection',JSON.stringify({version:1,sectors:selectedSectors,spheres:session.transformation.spheres,answers:session.transformation.answers,key:atlas.key}),'value');
         profile=field(profile,'transformation_meaning',atlas.context,'interpretation');}
        profile = field(profile, 'horizon_end', end, 'constraint');
        profile = field(profile, 'horizon_basis', form.horizonBasis ?? '', 'constraint');
        const working = { ...session, context: profile,forecastForm:form,minutes:session.forecastTest.minutes,selectedConditionBranchId:null }, snapshot = await freezeContext(working, crypto.randomUUID(), stamp);
        const currentModel = calculateModel(session.primary, profile, session.triad);
        const meaning = MEANING_PROFILES.find(p => p.curatorId === session.curatorId && p.state === session.profileState);
        const actions = !session.curatorId ? [] : chooseActions({ curatorId: session.curatorId, state: session.profileState, minutes: session.forecastTest.minutes, profile, harmony: currentModel.status === 'complete' ? currentModel.harmony : undefined, goal: { goalTags: session.goalTags, barrierTags: meaning?.barrierTags ?? null, sectorId: session.selectedSectorId, confirmed: true } });

        if (currentModel.status !== 'complete')
            throw new Error('AURORA_INCOMPLETE');
        const horizon: Horizon = form.horizonMode === 'relative' ? { mode: 'relative', anchorEvent: form.anchorEvent, startOffsetMinutes: form.startOffsetMinutes, durationMinutes: form.durationMinutes, anchorDeadline: end, timezone: profile.timezone } : { mode: 'absolute', start: stamp, end, timezone: profile.timezone };
        const record = await issueForecast({ id: crypto.randomUUID(), now: stamp, profile, primary: session.primary, model: currentModel, contextSnapshotId: snapshot.id, temporalId: session.triad?.id ?? null, sectorId: session.selectedSectorId,
            horizon, targetEvent: form.target, successCriterion: form.success, failureCriterion: form.failure, conditions: form.conditions.split('\n').map(s => s.trim()).filter(Boolean), conditionDeadline: deadline,
            selectedScenarioId: form.scenarioId || candidates.find(c => c.fullyApplicable)?.scenario.id || null, actions, parentForecastId: session.forecasts.filter(f => !f.plannedActionId).at(-1)?.id,
            empiricalHistory: document?.sessions ?? [],historyPermission: profile.historyPermission,
            conditionBranch:undefined,wordingSource:'choice_test_v1' });
        if (record.status === 'abstained') {
            await preparePractice({ ...working, contextSnapshots: [...session.contextSnapshots, snapshot], forecasts: [...session.forecasts, record], selectedForecastId: record.id });
            return;
        }
        const variants = await Promise.all(actions.map(action => conditionalForecast(record, action, crypto.randomUUID(), stamp,
            document?.sessions ?? [],profile.historyPermission))), id = crypto.randomUUID();
        const preferences = { ...session.organonPreferences, drawHarmony: currentModel.harmony, goalTags: session.goalTags, qualityTags: session.goalTags, barrierTags: meaning?.barrierTags ?? [], lastFiveCanonicalForms: profile.historyPermission ? (document?.sessions.filter(s => s.id !== session.id && s.organon).slice(-5).map(s => s.organon!.entry.canonicalForm) ?? []) : [] };
        const word = !session.curatorId ? null : await computeOrganon(session.curatorId, preferences);
        const plans=actions.map(action=>buildDecisionPlan(action,session.forecastTest!.minutes,profile,{goalTags:session.goalTags,barrierTags:meaning?.barrierTags??null,sectorId:session.selectedSectorId,confirmed:true},currentModel));
        const learning=documentRef.current?.learning;
        const personalComparison=learning&&session.context.historyPermission?[record,...variants].map(forecast=>{const {probability,observations,brier,baselineBrier,calibration}=personalPrediction(learning,learningFeatures({...session,contextSnapshots:[...session.contextSnapshots,snapshot]},forecast));return {forecastId:forecast.id,probability,observations,brier,baselineBrier,calibration};}):[];
        const personalRank=(id:string)=>personalComparison.find(row=>row.forecastId===variants.find(forecast=>forecast.plannedActionId===id)?.id)?.probability;
        actions.sort((a,b)=>{const left=personalRank(a.id),right=personalRank(b.id);return left!=null&&right!=null?right-left:0;});
        plans.sort((a,b)=>actions.findIndex(action=>action.id===a.actionId)-actions.findIndex(action=>action.id===b.actionId));
        const transformation=atlas&&session.transformation&&selectedSectors.length?{version:1,key:atlas.key,sectors:selectedSectors,spheres:session.transformation.spheres,meaning:atlas.context,topology:atlas.topology,routes:atlas.focal.map(row=>({sector:row.card.sourcePositionId,cardId:row.card.cardId,summary:row.bridge.summary,route:row.bridge.route,sources:row.bridge.sources}))}:null;
        const solution = { version: 1, plans, transformation, personalComparison, harmony: currentModel.harmony, modelVersion: currentModel.version, contextHash: snapshot.hash, forecastHashes: [record, ...variants].map(f => f.payloadHash), forecasts: [record, ...variants], organon: word, actionIds: actions.map(a => a.id) };
        const sealed = await host.sealResult(solution, id), prepared = { id, methodVersion: currentModel.version, forecastHashes: solution.forecastHashes, contextHash: snapshot.hash, ...sealed };
        const updated = { ...working, contextSnapshots: [...session.contextSnapshots, snapshot], forecasts: [...session.forecasts, record, ...variants], selectedForecastId: record.id, resultId: id, preparedResults: [...session.preparedResults, prepared], organon: word, organonPreferences: preferences,
            sphragisLetter: word ? chooseSphragis(word.entry.canonicalForm, session.goalTags, session.comfort).letter : null, actionOptionIds: actions.map(a => a.id), finishAsObservation: false };
        change(updated);
        await persist();
        await host.prepareResult(prepared);
    }
    async function preparePractice(value = session) {
        if (!value) return;
        // Existing paid forecasts retain their entitlement check. A standalone practice has no forecast payload.
        if(value.resultId&&!unlocked)return;
        if(value.organon){next(6,value);return;}
        const practiceTest=value.forecastTest;
        if(practiceTest){
            value={...value,context:recordForecastAnswers(practiceTest,value.context,value.selectedSectorId,()=>crypto.randomUUID())};
            if(practiceTest.preference)value={...value,context:field(value.context,'action_preference',practiceTest.preference,'value')};
        }
        const currentModel=calculateModel(value.primary,value.context,value.triad);
        if(currentModel.status!=='complete')throw Error('AURORA_INCOMPLETE');
        const tags=value.goalTags.length?value.goalTags:['clarity','stability'];
        const goal={goalTags:tags,barrierTags:null,sectorId:value.selectedSectorId,confirmed:true};
        const curator=value.curatorId??recommendCurators(goal,currentModel)[0]?.id??'athena';
        const lastFiveCanonicalForms=value.context.historyPermission?[...new Set((documentRef.current?.sessions??[]).filter(row=>row.id!==value.id&&row.organon)
            .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(row=>row.organon!.entry.canonicalForm))].slice(0,5):[];
        const preferences={...value.organonPreferences,goalTags:tags,qualityTags:tags,lastFiveCanonicalForms,drawHarmony:currentModel.harmony};
        const word=await computeOrganon(curator,preferences);
        const actions=chooseActions({curatorId:curator,state:value.profileState,minutes:value.minutes,profile:value.context,goal,harmony:currentModel.harmony});
        change(moveStage({...value,curatorId:curator,goalTags:tags,organon:word,organonPreferences:preferences,
            sphragisLetter:chooseSphragis(word.entry.canonicalForm,tags,value.comfort).letter,actionOptionIds:actions.map(row=>row.id),
            finishAsObservation:true,guidePage:{stage:6,part:0}},6,now()));
        await persist();
    }
    async function savePracticeCompletion(){
        if(!session||!actionDone||!session.selectedActionId)return;
        const stamp=now(),planned=session.executions.filter(row=>row.actionId===session.selectedActionId&&!row.completedAt).at(-1);
        change(recordExecution(session,{id:planned?.id??crypto.randomUUID(),forecastId:session.selectedForecastId,
            actionId:session.selectedActionId,minutes:session.minutes,startCondition:session.planStart,plannedAt:planned?.plannedAt??stamp,
            ritualCompleted:ritualDone,actionCompleted:true,completedAt:stamp,actualDescription:session.actualActionNote,withoutRitual,taskId:planned?.taskId??null}));
        await persist();
    }
    async function unlock(solution: unknown) {
        if (!session || !solution || typeof solution !== 'object')
            throw new Error('AURORA_RESULT_MISMATCH');
        const expected = session.preparedResults.find(r => r.id === session.resultId);
        if (!expected)
            throw new Error('AURORA_RESULT_MISMATCH');
        setArchivedSolution(await verifyPreparedSolution(solution, expected));
        setUnlockedId(session.resultId);
    }
    async function newPass() {
        if (!primary || !documentRef.current)
            return;
        await persist();
        const fresh = newSession({ id: crypto.randomUUID(), ownerId: host.ownerId, now: now(), primary, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        if (temporal) { validateTemporalTriad(temporal); fresh.triad = structuredClone(temporal); }
        const value = { ...documentRef.current, activeSessionId:fresh.id, sessions: [...documentRef.current.sessions, fresh] };
        documentRef.current = value;
        setDocument(value);
        setActiveId(fresh.id);
        setUnlockedId(null);
        await persist(value);
    }
    async function deleteWork() {
        const current=documentRef.current;
        if(!current||!deleteId)return;
        if(timer.current)clearTimeout(timer.current);
        if(host.syncState()==='conflict')throw new Error('AURORA_REVISION_CONFLICT');
        const saved=await host.save(removeSavedSession(current,deleteId,now()));
        documentRef.current=saved;setDocument(saved);setActiveId(saved.activeSessionId??saved.sessions.at(-1)?.id??'');
        setUnlockedId(null);setArchivedSolution(null);setDeleteId(null);
        setSaveState(host.syncState()==='offline'?RU.text0075:sessionCopy[locale.language].deleted);
    }
    async function task(kind: 'action' | 'review') {
        if (!session)
            return;
        await persist();
        const action = ACTIONS.find(a => a.id === session.selectedActionId), forecast = session.forecasts.find(f => f.id === session.selectedForecastId);
        const point = kind === 'review' && forecast ? reviewCalendarPoint(forecast, session.observationDraft.anchorAt ? new Date(session.observationDraft.anchorAt).toISOString() : null) : null;
        host.addTask({ title: kind === 'review' ? RU.text0078 : action?.title ?? session.goalText,
            description: kind === 'review' ? `${forecast?.targetEvent ?? session.goalText}\n${forecast?.observableSuccessCriterion ?? ''}` : ("" + (action?.instructions.join('\n') ?? '') + RU.text0079 + session.planStart),
            dueDate: point?.date ?? null, dueTime: point?.time ?? null, zoneId: point?.timezone ?? session.context.timezone, kind, sourceId: `${session.id}:${kind}:${forecast?.id ?? 'observation'}` });
        host.close();
    }
    function saveObservation() {
        if (!session)
            return;
        const selected = session.forecasts.find(f => f.id === session.selectedForecastId);
        if (!selected)
            return;
        try {
            const evidenceId = crypto.randomUUID(), profile = field(session.context, `outcome_${evidenceId}`, observation.description), anchorAt = observation.anchorAt ? new Date(observation.anchorAt).toISOString() : null;
            const horizon = resolveHorizon(selected, anchorAt), actual = session.executions.filter(e => e.completedAt && horizon && Date.parse(e.completedAt) >= Date.parse(horizon.start) && Date.parse(e.completedAt) <= Date.parse(horizon.end));
            const input = { id: crypto.randomUUID(), now: now(), selected: true, conditionStatus: (observation.conditions==='met'&&!observation.conditionAt?'unknown':observation.conditions) as 'met' | 'unmet' | 'unknown', conditionAt: observation.conditionAt ? new Date(observation.conditionAt).toISOString() : null, anchorAt,
                observedOccurred: !hasObservationEvidence(observation.description)||observation.occurred === 'unknown'||observation.occurred==='yes'&&!observation.occurredAt ? null : observation.occurred === 'yes', occurredAt: observation.occurredAt ? new Date(observation.occurredAt).toISOString() : null, observationComplete: observation.complete, contradictoryObservation: observation.contradictory,
                evidenceIds: hasObservationEvidence(observation.description) ? profile.fields[`outcome_${evidenceId}`].evidenceIds : [], actualActionIds: actual.map(e => e.actionId),
                completedConditionActionIds: session.executions.filter(e => e.completedAt && Date.parse(e.completedAt) >= Date.parse(selected.frozenAt) && Date.parse(e.completedAt) <= Date.parse(selected.conditionDeadline)).map(e => e.actionId), evidenceSource: 'user_report' as const, experienceNote: session.observationNote };
            const record = evaluateForecast(selected, input);
            let updated = appendResolution({ ...session, context: profile }, record);
            const groupBase = selected.plannedActionId ? selected.parentForecastId : selected.id;
            const base = selected.plannedActionId ? session.forecasts.find(f => f.id === groupBase) : null;
            if (base)
                updated = appendResolution(updated, evaluateForecast(base, { ...input, id: `${record.id}:base` }));
            for (const forecast of session.forecasts.filter(f => f.parentForecastId === groupBase && f.plannedActionId && f.id !== selected.id)) {
                const excluded = evaluateForecast(forecast, { id: `${record.id}:not-selected:${forecast.id}`, now: record.recordedAt, selected: false, conditionStatus: 'unknown', conditionAt: null, anchorAt: null, observedOccurred: null, occurredAt: null, observationComplete: false, contradictoryObservation: false, evidenceIds: [], actualActionIds: [], evidenceSource: 'user_report', experienceNote: '' });
                updated = appendResolution(updated, excluded);
            }
            const learned=session.context.historyPermission?learnResolvedForecast(documentRef.current?.learning??newPersonalLearning(),updated,selected,record):documentRef.current?.learning;
            change(updated,false,learned);
        }
        catch (reason) {
            reportingError(reason);
        }
    }
    const stage = session?.stage ?? 0, unlocked = Boolean(session?.resultId && unlockedId === session.resultId);
    const selectedForecast = session?.forecasts.find(f => f.id === session.selectedForecastId) ?? null;
    const activeProfile = MEANING_PROFILES.find(p => p.curatorId === session?.curatorId && p.state === session?.profileState);
    const curatorOptions = session && model?.status === 'complete' && session.goalTags.length ? recommendCurators({ goalTags: session.goalTags, barrierTags: activeProfile?.barrierTags ?? null, sectorId: session.selectedSectorId, confirmed: true }, model).map(r => r.id) : [...CURATOR_IDS];
    const actionOptions = session?.actionOptionIds.flatMap(id => { const action = ACTIONS.find(a => a.id === id); return action ? [action] : []; }) ?? [];
    const seal = session?.organon ? chooseSphragis(session.organon.entry.canonicalForm, session.goalTags, session.comfort, session.sphragisLetter) : null;
    const forecastDraft=session?.forecastTest??newForecastTest();
    const testing=stage===5&&selectedForecast?.status!=='issued';
    const part=session?.guidePage?.stage===stage?session.guidePage.part:0;
    const partCount=stage===1?(session?.observationOnly?1:2):stage===2?6:stage===4?5:stage===7?2:1;
    const setPart=(value:number)=>{if(session)change({...session,guidePage:{stage,part:value}});heading.current?.scrollIntoView({block:'start'});heading.current?.focus();};
    const presentation=question&&session?questionPresentation(question,session.primary,selectedSectors,session.intake.domain,answeredQuestionCount(session.answers),locale.language,session.context):null;
    const guidance=session?practicalGuidance(session.context,session.primary,selectedSectors,session.transformation?.answers.event):null;
    const practiceAvailable=unlocked||Boolean(session?.organon&&!session.resultId);
    const intakeKeys=['question','domain','event_description','current_constraint','available_resources','unknown_description'];
    const forwardDisabled=!session||stage===8
     ||stage===0&&!session.observationOnly&&!selectedSectors.length
     ||stage===1&&(part===0&&!session.observationOnly?!session.transformation?.spheres.length:session.goalText.trim().length<5)
     ||stage===2&&!session.intake[intakeKeys[part]]
     ||stage===3&&Boolean(question&&(session.draftAnswer.questionId!==question.id||!session.draftAnswer.choiceId))
     ||stage===4&&(part===1?!session.goalTags.length:part===2?!session.curatorId:part===4&&!confirmedBoolean(session.context,'context_confirmed'))
     ||stage===5&&(testing?(forecastDraft.page<6?forecastScreenMissing(forecastDraft,session.selectedSectorId):!forecastDraft.confirmed):!unlocked)
     ||stage===6&&(!practiceAvailable||!session.organon)
     ||stage===7&&part===1&&actionOptions.length>0&&(!session.selectedActionId||!session.planStart);
    function forward(){
     if(!session||forwardDisabled||busy)return;
     if([1,2,4,7].includes(stage)&&part<partCount-1){setPart(part+1);return;}
     if(stage===2){intakeNext();return;}
     if(stage===3&&question){try{
      const choiceId=session.draftAnswer.choiceId as 'yes'|'no'|'unknown'|'skipped'|'not_applicable';
      const result=applyAnswer(session.context,{id:crypto.randomUUID(),questionId:question.id,choiceId,detail:'',responseMode:'choice',confirmed:choiceId==='yes'||choiceId==='no',createdAt:now()},true);
      change({...session,context:result.profile,answers:[...session.answers,result.answer],draftAnswer:{questionId:'',choiceId:'',detail:''},revisingQuestionId:null},true);
      heading.current?.scrollIntoView({block:'start'});
     }catch(reason){reportingError(reason);}return;}
     if(stage===5){if(testing){if(forecastDraft.page<6)change({...session,forecastTest:moveForecastScreen(forecastDraft,session.selectedSectorId,1)});else if(forecastTestProblems(forecastDraft,session.context,session.selectedSectorId).length)void run(preparePractice);else void run(prepareForecast);}else if(session.organon)next(6);else void run(preparePractice);return;}
     if(stage===7){try{
      if(actionDone){const stamp=now(),plan=session.executions.filter(row=>row.actionId===session.selectedActionId&&!row.completedAt).at(-1);
       next(8,recordExecution(session,{id:plan?.id??crypto.randomUUID(),forecastId:session.selectedForecastId,actionId:session.selectedActionId!,minutes:session.minutes,startCondition:session.planStart,plannedAt:plan?.plannedAt??stamp,ritualCompleted:ritualDone,actionCompleted:true,completedAt:stamp,actualDescription:session.actualActionNote,withoutRitual,taskId:plan?.taskId??null}));
      }else next(8);
     }catch(reason){reportingError(reason);}return;}
     next(stage+1);
    }
    if(!locale.ready)return <div className="modal-backdrop aurora-backdrop"><section key={locale.language} className="aurora-dialog" role="dialog" aria-modal="true" lang={locale.language}
      ref={element=>{dialogElement.current=element;dialog(element);}} tabIndex={-1} data-no-translate>
      <header className="aurora-header"><h2>GENESIS</h2><DialogCloseButton data-dialog-save="false" aria-label={translateText('Закрыть',locale.language)} onClick={()=>void close()}/></header>
      <p role="status">{locale.failed?availability[locale.language as keyof typeof availability]?.loadError??availability.en.loadError:translateText('Загрузка…',locale.language)}</p>
      {locale.failed?<button type="button" className="secondary-button" onClick={locale.retry}>{translateText('Повторить загрузку',locale.language)}</button>:null}
    </section></div>;
    return <div className="modal-backdrop aurora-backdrop"><section className={`aurora-dialog${!session ? ' aurora-empty' : ''}`} key={locale.language} role="dialog" aria-modal="true" aria-labelledby="aurora-title" ref={element=>{dialogElement.current=element;dialog(element);}} tabIndex={-1} lang={locale.language} data-no-translate>
  <header className="aurora-header"><div><h2 id="aurora-title">{RU.text0080}</h2><p>{RU.text0081}</p></div><DialogCloseButton data-dialog-save="false" onClick={() => void close()} aria-label={RU.text0082}/></header>
    <div className="aurora-save" role="status" aria-live="polite">{saveState}</div>
  {conflict ? <div className="aurora-error" role="alert"><h3>{RU.text0083}</h3><p>{RU.text0084}</p>
   {conflict.sessionIds.map(id => { const local = conflict.local.sessions.find(s => s.id === id), remote = conflict.remote.sessions.find(s => s.id === id); return <MethodSheet key={id} title={<><span data-no-translate={Boolean(local?.goalText || remote?.goalText)}>{local?.goalText || remote?.goalText || RU.text0085}</span></>}>{[[RU.text0086, local], [RU.text0087, remote]].map(([label, row]) => { const s = row as AuroraSession | undefined; return <div key={String(label)}><h4>{String(label)}</h4><p data-no-translate>{s?.goalText}</p><p data-no-translate>{s?.intake.event_description}</p><p data-no-translate>{s?.observationNote}</p><small>{s ? new Date(s.updatedAt).toLocaleString(locale.language) : RU.text0088}</small><ul>{s?.answers.map(a => <li key={a.id} data-no-translate>{a.detail || a.choiceId}</li>)}</ul></div>; })}</MethodSheet>; })}
   <button type="button" className="primary-button" disabled={busy} onClick={() => void run(async () => { const ids = Object.fromEntries(conflict.sessionIds.map(id => [id, crypto.randomUUID()])), value = await host.recoverConflict(ids, now()); documentRef.current = value; setDocument(value); setActiveId(ids[activeId] ?? Object.values(ids)[0] ?? value.sessions.at(-1)?.id ?? ''); setConflict(null); setError(''); setSaveState(RU.text0089); })}>{RU.text0090}</button>
  </div> : null}
  {error ? <div className="aurora-error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => void run(async () => { await persist(); if (session?.resultId) {
        const value = session.preparedResults.find(r => r.id === session.resultId);
        if (value)
            await host.prepareResult(value);
    } })}>{RU.text0091}</button></div> : null}
  {conflict ? null : !document ? <p>{RU.text0092}</p> : !session ? <><Notice><span data-no-translate>{sessionCopy[locale.language].empty}</span></Notice><button type="button" className="secondary-button aurora-new-pass" disabled={busy||!primary} onClick={()=>void run(newPass)}>{RU.text0097}</button></> : <>
   <div className="aurora-workspace-tools"><IconActionButton icon="save" label={RU.saveShort} disabled={busy} onClick={()=>void run(async()=>{await persist();})}/><MethodSheet className="aurora-work-menu" icon="history" label={RU.text0094} title={<>{RU.text0094}</>}>
   <div className="aurora-session-nav"><div className="aurora-session-picker"><ChoiceSelect disabled={busy} aria-label={RU.text0094} value={activeId} onChange={e => { const selected=document.sessions.find(s=>s.id===e.target.value);if(selected)change(selected);setActiveId(e.target.value); setUnlockedId(null);setDeleteId(null); setError(''); }}>{visibleSessions.map((s, i) => <option data-no-translate={Boolean(s.goalText)&&!s.transformation&&!authoredGoals.has(s.goalText)} key={s.id} value={s.id}>{s.goalText || (RU.text0095 + (i + 1))} · {s.primary.sourceDay}</option>)}</ChoiceSelect></div><div className="aurora-session-actions"><button type="button" className="secondary-button" disabled={busy || !session.forecasts.some(f => f.status === 'issued')} onClick={() => { const record = session.forecasts.filter(f => f.status === 'issued').at(-1)!; const result = session.preparedResults.find(r => r.forecastHashes.includes(record.payloadHash)); next(8, { ...session, selectedForecastId: record.id, resultId: result?.id ?? null }); }}>{RU.text0096}</button><button type="button" className="secondary-button" disabled={busy || !primary} onClick={() => void run(newPass)}>{RU.text0097}</button></div></div>
   <nav className="aurora-progress" aria-label={RU.text0098}>{STAGES.map((title, index) => <button type="button" key={title} aria-label={`${index + 1}. ${title}`} aria-current={stage === index ? 'step' : undefined} disabled={index > session.highestStage || index >= 6 && index <=7 && !practiceAvailable} onClick={() => next(index)}><span aria-hidden="true">{index + 1}</span><span>{title}</span></button>)}</nav>
   </MethodSheet><IconActionButton icon="delete" className="aurora-delete-work" label={sessionCopy[locale.language].deleteLabel} disabled={busy} data-dialog-save="false" onClick={()=>setDeleteId(session.id)}/><span className="aurora-step-navigation">{RU.text0098} · {stage+1}/{STAGES.length}</span></div>
   {deleteId?<section data-no-translate className="aurora-delete-confirm" role="group" aria-labelledby="aurora-delete-title"><h4 id="aurora-delete-title">{sessionCopy[locale.language].confirmTitle}</h4><p>{sessionCopy[locale.language].confirmBody}</p><div className="aurora-actions"><button type="button" className="secondary-button" ref={cancelDelete} disabled={busy} onClick={()=>{setDeleteId(null);dialogElement.current?.querySelector<HTMLButtonElement>('.aurora-delete-work')?.focus();}}>{sessionCopy[locale.language].cancel}</button><button type="button" className="secondary-button" disabled={busy} data-dialog-save="false" onClick={()=>void run(deleteWork)}>{sessionCopy[locale.language].confirm}</button></div></section>:null}
   <main className="aurora-stage" data-stage={stage} data-part={part} inert={Boolean(busy&&deleteId)} key={`${session.id}:${stage}`}><h3 ref={heading} tabIndex={-1}>{STAGES[stage]}</h3>{partCount>1?<p className="aurora-question-progress" role="status">{T.testPart} {part+1} {T.testOf} {partCount}</p>:null}
    {stage === 0 ? <>
     <p>{A.cardsHelp}</p>
     <AuroraCards snapshot={session.primary} secondary selected={session.selectedSectorId} selectedSectors={selectedSectors} language={locale.language} onChoose={id=>change(toggleTransformationSector(session,id),true)}/>
     <div className="aurora-draw-summary"><span>{model?.draw.negativeCardCount}{RU.text0100}{model?.draw.negativeSectorCount}{RU.text0101}</span></div>
     {model?.draw.orientation === 'upright' || model?.draw.orientation === 'reversed' ? <Notice>{RU.text0102}{model.draw.orientation === 'upright' ? RU.text0103 : RU.text0104}</Notice> : null}
     {session.observationOnly ? <Notice>{A.uprightHelp}</Notice> : null}
    </> : null}
    {stage === 1 ? <>
     {part===0?<TransformationView session={session} onChange={value=>change(value,true)}/>:null}
     {part===1||session.observationOnly?<>
     {displayedGoals.length ? <fieldset className="aurora-goal-options"><legend>{RU.text0107}</legend>
       {displayedGoals.map(option => <label key={option.id} className="aurora-choice" data-selected={session.goalText === option.value || session.goalText === option.title}>
         <input type="radio" name="aurora-goal" value={option.id} checked={session.goalText === option.value || session.goalText === option.title} disabled={busy}
           onChange={() => change({ ...session, goalText: option.value, goalTags: [...option.goalTags] }, true)} />
       <span><strong data-no-translate={option.id==='saved-goal'}>{option.title}</strong>{option.description ? <small>{option.description}</small> : null}</span>
       </label>)}
     </fieldset> : <Notice>{RU.chooseGoalDirection}</Notice>}
     </>:null}
    </> : null}
    {stage === 2 ? <>
     <p>{A.intakeHelp}</p><p className="aurora-example-note">{A.exampleNote}</p>
     {atlas?<QuestionGuidance language={locale.language} family={(['event','event','grounds','limits','capability','grounds'] as const)[part]}
      example={[atlas.example.domain,adaptiveText(`example_${['target_observable','event_observed','inference_distinguished','nonnegotiable_constraint','resource_available','source_known'][part]}`)].join(' ')}/>:null}
     {part===0?<>
     <ChoiceOptions label={A.questionTitle} value={session.transformation?.answers.question??null} disabled={busy}
      choices={(atlas?.questionOptions??[]).map(outcome=>({id:outcome.id,label:outcome.title,description:outcome.description}))}
      onChange={id=>change(updateTransformationIntake(session,'question',id,crypto.randomUUID()),true)} /></>:null}
     {part===1?<>
     <ChoiceOptions label={A.domainTitle} value={session.intake.domain??null} disabled={busy}
      choices={domainChoices()}
      onChange={id=>change(updateTransformationIntake(session,'domain',id,crypto.randomUUID()),true)}/></>:null}
     {part===2?<ChoiceOptions label={A.eventTitle} value={session.transformation?.answers.event??null} disabled={busy}
      choices={(atlas?.eventOptions??[]).map(row=>({id:row.id,label:row.title,description:row.description}))}
      onChange={id=>change(updateTransformationIntake(session,'event',id,crypto.randomUUID()),true)}/>:null}
     {part===3?<ChoiceOptions label={A.constraintTitle} value={session.transformation?.answers.constraint??null} disabled={busy} choices={atlas!.choices.constraint} onChange={id=>answerIntake('constraint',id)}/>:null}
     {part===4?<ChoiceOptions label={A.resourcesTitle} value={session.transformation?.answers.resources??null} disabled={busy} choices={atlas!.choices.resources} onChange={id=>answerIntake('resources',id)}/>:null}
     {part===5?<ChoiceOptions label={A.unknownTitle} value={session.transformation?.answers.unknown??null} disabled={busy} choices={atlas!.choices.unknown} onChange={id=>answerIntake('unknown',id)}/>:null}
    </> : null}
    {stage === 3 ? <>
     <p className="aurora-question-progress" role="status"><span>{RU.text0138}</span> {Math.min(answeredQuestionCount(session.answers)+(question?1:0),questionLimitForStage(stage))} <span>{T.testOf}</span> {questionLimitForStage(stage)}</p>
     {question ? <ChoiceOptions label={presentation?.title??question.text} disabled={busy}
      description={presentation?<QuestionGuidance language={locale.language} family={presentation.family} example={presentation.example}/>:null}
      value={session.draftAnswer.questionId===question.id?session.draftAnswer.choiceId:null}
      choices={[...(presentation?.choices??question.answerSchema.choices),{id:'unknown',label:RU.text0127,description:A.answerUnknown},{id:'skipped',label:RU.text0128,description:A.branchSkipped},{id:'not_applicable',label:RU.text0129,description:A.branchNotApplicable}]}
      onChange={choiceId=>change({...session,draftAnswer:{questionId:question.id,choiceId,detail:''}})}/>
      : <Notice>{RU.text0130}</Notice>}
     {session.answers.filter(row=>!row.invalidatedByAnswerId).at(-1)?<p className="aurora-branch-reason">{({yes:A.branchYes,no:A.branchNo,unknown:A.answerUnknown,skipped:A.branchSkipped,not_applicable:A.branchNotApplicable})[session.answers.filter(row=>!row.invalidatedByAnswerId).at(-1)!.choiceId]}</p>:null}
     {session.answers.length ? <MethodSheet  title={<>{RU.text0131}{answeredQuestionCount(session.answers)}</>}><ul>{currentInterviewAnswers(session.answers).map(a => {
      const editing=historyEdit?.sessionId===session.id&&historyEdit.answerId===a.id,record=QUESTIONS.find(q=>q.id===a.questionId)!;
      return <li key={a.id}><p>{record.text}</p><p>{a.detail || ({ yes: RU.text0132, no: RU.text0133, unknown: RU.text0134, skipped: RU.text0135, not_applicable: RU.text0129 }[a.choiceId])}</p>
       {editing?<div className="aurora-history-edit"><ChoiceOptions label={record.text} disabled={busy} value={historyEdit?.choiceId??a.choiceId}
        description={<QuestionGuidance language={locale.language} family={record.informationFamily} example={questionPresentation(record,session.primary,selectedSectors,session.intake.domain,0,locale.language,session.context).example}/>}
        choices={[...record.answerSchema.choices.map(choice=>({id:choice.id,label:choice.label})),{id:'unknown',label:RU.text0127},{id:'skipped',label:RU.text0128},{id:'not_applicable',label:RU.text0129}]}
        onChange={choiceId=>setHistoryEdit({sessionId:session.id,answerId:a.id,choiceId:choiceId as AnswerInput['choiceId']})}/>
        <div className="aurora-session-actions"><button type="button" className="secondary-button" disabled={busy} onClick={saveHistoryAnswer}>{RU.saveShort}</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>setHistoryEdit(null)}>{sessionCopy[locale.language].cancel}</button></div></div>
        :<button type="button" className="secondary-button" disabled={busy} onClick={()=>setHistoryEdit({sessionId:session.id,answerId:a.id,choiceId:a.choiceId})}>{RU.text0136}</button>}
      </li>;
     })}</ul></MethodSheet> : null}
    </> : null}
    {stage === 4 ? <>
     {part===0?<>
     {guidance?<section className="aurora-guidance"><h4>{A.holdingTitle}</h4><p>{guidance.holding}</p><h4>{A.movementTitle}</h4><p>{guidance.movement}</p><h4>{A.stepsTitle}</h4><ol>{guidance.steps.map(line=><li key={line}>{line}</li>)}</ol></section>:null}
     <TransformationView session={session} readOnly/>
     <h4>{RU.text0137}</h4><dl className="aurora-review"><dt>{RU.text0138}</dt><dd data-no-translate={!session.transformation}>{session.context.originalQuestion}</dd><dt>{RU.text0139}</dt><dd data-no-translate={!session.transformation}>{knownValue<string>(session.context, 'event_description')}</dd><dt>{RU.text0140}</dt><dd data-no-translate={!session.transformation}>{session.goalText}</dd><dt>{RU.text0141}</dt><dd>{session.intake.unknown_description?<span data-no-translate={!session.transformation}>{session.intake.unknown_description}</span>:RU.text0142}</dd></dl>
     <button type="button" className="secondary-button" onClick={() => next(2)}>{RU.text0143}</button>
     {model?.status === 'complete' ? model.trace.filter(t => t.active && t.sourceCardInstanceIds.length).slice(0, 2).map(trace => { const edge = MYTH_TRANSITIONS.find(e => e.id === trace.edgeId)!; return <div className="aurora-connection" key={edge.id}><p>{edge.projectInterpretation}</p><button type="button" className="secondary-button" onClick={() => change({ ...session, context: { ...session.context, rejectedThemes: [...session.context.rejectedThemes, `myth:${edge.id}`] } }, true)}>{RU.text0144}</button></div>; }) : null}
     <h4>{RU.text0145}</h4><p>{RU.text0146}</p>
     {!session.triad ? lockSource ? null : <div className="aurora-actions"><button type="button" className="secondary-button" onClick={() => change({ ...session, triad: createTemporalTriad({ id: crypto.randomUUID(), seed: crypto.getRandomValues(new Uint32Array(1))[0], createdAt: now() }) }, true)}>{RU.text0147}</button><span>{RU.text0148}</span></div> : <div className="aurora-temporal">{session.triad.cards.map(card => {
      const letter=getStoicheionLetters('ru').find(letter=>letter.id===card.cardId)!;
      return <article key={card.instanceId}><strong>{{ past: RU.text0149, present: RU.text0150, future: RU.text0151 }[card.role]}</strong><span className="aurora-temporal-symbol" lang="el" data-no-translate aria-hidden="true">{letter.symbol}</span><span>{letter.name}</span><small>{card.orientation === 'reversed' ? RU.text0056 : RU.text0057}</small></article>;
     })}</div>}
     </>:null}
     {part===1?<>
      <QuestionGuidance language={locale.language} family="meaning" example={adaptiveText('example_value_named')}/>
      <h4>{RU.text0152}</h4><div className="aurora-quality">{QUALITY.map(([tag, label]) => <label className="aurora-choice" key={tag}><input type="checkbox" checked={session.goalTags.includes(tag)} onChange={e => change({ ...session, goalTags: e.target.checked ? [...session.goalTags, tag] : session.goalTags.filter(t => t !== tag) }, true)}/>{label}</label>)}</div>
     </>:null}
     {part===2?<>
      <QuestionGuidance language={locale.language} family="meaning" example={[atlas?.example.domain,adaptiveText('example_goal_is_own')].join(' ')}/>
      <h4>{RU.text0153}</h4><div className="aurora-curators">{curatorOptions.slice(0, 3).map((id, index) => <label className="aurora-curator" key={id} data-selected={session.curatorId === id} aria-label={(RU.text0154 + DEITIES[id].name)}><input type="radio" name="aurora-curator" checked={session.curatorId === id} onChange={() => change({ ...session, curatorId: id }, true)}/><img src={`/theokyklos-symbols/olympian-${id}-v313.png`} alt="" width="56" height="56"/><span><strong>{DEITIES[id].name}</strong><small>{SECTORS.find(s => s.deities.includes(id))!.title}{index === 0 && session.goalTags.length ? RU.text0155 : ''}</small><span>{MEANING_PROFILES.find(p => p.curatorId === id && p.state === 'resource')!.description}</span></span></label>)}</div>
      <MethodSheet  title={<>{RU.text0156}</>}><div className="aurora-curators">{curatorOptions.slice(3).map((id, index) => <label className="aurora-curator" key={id} data-selected={session.curatorId === id} aria-label={(RU.text0154 + DEITIES[id].name)}><input type="radio" name="aurora-curator" checked={session.curatorId === id} onChange={() => change({ ...session, curatorId: id }, true)}/><img src={`/theokyklos-symbols/olympian-${id}-v313.png`} alt="" width="56" height="56"/><span><strong>{DEITIES[id].name}</strong><small>{SECTORS.find(s => s.deities.includes(id))!.title}{index === 0 && session.goalTags.length ? RU.text0155 : ''}</small><span>{MEANING_PROFILES.find(p => p.curatorId === id && p.state === 'resource')!.description}</span></span></label>)}</div></MethodSheet>
     </>:null}
     {part===3?<>
      <QuestionGuidance language={locale.language} family="capability" example={adaptiveText('example_available_time_known')}/>
      <div className="aurora-field"><span>{RU.text0157}</span><ChoiceSelect description={<QuestionGuidance language={locale.language} family="capability" example={adaptiveText('example_resource_available')}/>} aria-label={RU.text0157} value={session.profileState} onChange={e => change({ ...session, profileState: e.target.value as ProfileState }, true)}>{PROFILE_STATES.map(mode => <option key={mode} value={mode}>{MODES[mode]}</option>)}</ChoiceSelect></div>{activeProfile ? <Notice>{activeProfile.description}</Notice> : null}
      <MethodSheet  title={<>{RU.text0158}</>}><p>{RU.text0159}</p><QuestionGuidance language={locale.language} family="capability" example={adaptiveText('example_resource_available')}/>
       {[['materials', RU.text0160], ['tools', RU.text0161], ['feedback', RU.text0162]].map(([key, label]) => <label key={key} className="aurora-choice"><input type="checkbox" checked={confirmedBoolean(session.context, `available_${key}`)} onChange={e => change({ ...session, context: field(session.context, `available_${key}`, e.target.checked, 'constraint') }, true)}/>{label}</label>)}
       <div className="aurora-field"><span>{RU.text0163}</span><ChoiceSelect description={<QuestionGuidance language={locale.language} family="capability" example={adaptiveText('example_small_step_possible')}/>} aria-label={RU.text0163} value={knownValue<string>(session.context, 'action_preference') ?? ''} onChange={e => change({ ...session, context: field(session.context, 'action_preference', e.target.value, 'value') }, true)}><option value="">{RU.text0164}</option><option value="clarify">{RU.text0165}</option><option value="change">{RU.text0166}</option><option value="support">{RU.text0167}</option></ChoiceSelect></div>
      </MethodSheet>
     </> : null}
     {part===4?<>
     <QuestionGuidance language={locale.language} family="grounds" example={adaptiveText('example_falsification_criterion')}/>
     <label className="aurora-choice"><input type="checkbox" checked={session.context.historyPermission} onChange={e => change({ ...session, context: { ...session.context, historyPermission: e.target.checked, referencedSessionIds: [] } })}/>{RU.text0168}</label>
     <label className="aurora-choice"><input type="checkbox" checked={confirmedBoolean(session.context, 'context_confirmed')} onChange={e => { let context = field(session.context, 'context_confirmed', e.target.checked); if (e.target.checked && session.curatorId) {
                context = { ...context, acceptedThemes: [...new Set([...context.acceptedThemes, `${session.curatorId}-${session.profileState}`])] };
            } change({ ...session, context }); }}/>{RU.text0169}</label></>:null}
    </> : null}
    {stage === 5 ? <>
     {selectedForecast?.status === 'issued' && session.resultId ? <>
      {!unlocked ? <><Notice>{RU.text0170}</Notice><AuroraPayment key={session.resultId} host={host} resultId={session.resultId} onUnlocked={value => void run(() => unlock(value))}/></> : <>{archivedSolution?.transformation?<section className="aurora-transformation"><h4>{RU.transformationTitle}</h4><p>{archivedSolution.transformation.meaning}</p>{archivedSolution.transformation.routes.map(row=><article key={row.sector}><p>{row.summary}</p>{row.sources.map(source=><a key={source.passage} href={source.url} target="_blank" rel="noreferrer">{source.passage}</a>)}</article>)}</section>:null}<h4>{RU.text0171}</h4>{contextNowLines(session.context).map(line => <p key={line} data-no-translate>{line}</p>)}<h4>{RU.text0172}</h4><p data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{selectedForecast.targetEvent}</p><p>{selectedForecast.predictedOutcome === 'occurs' ? RU.text0173 : RU.text0174}</p><ul>{selectedForecast.conditions.map(c => <li key={c} data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{c}</li>)}</ul><h4>{RU.text0175}</h4><p data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{selectedForecast.horizon.mode === 'absolute' ? new Date(selectedForecast.horizon.end).toLocaleString(locale.language) : selectedForecast.horizon.anchorEvent}</p><h4>{RU.text0176}</h4><p data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{selectedForecast.observableSuccessCriterion}</p><h4>{RU.text0177}</h4><p data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{selectedForecast.observableFailureCriterion}</p><h4>{RU.text0178}</h4>{actionOptions.map(a => <p key={a.id}>{a.strategy === 'clarify' ? RU.text0165 : a.strategy === 'change' ? RU.text0166 : RU.text0167}: {a.title}</p>)}<Notice>{RU.text0179}</Notice></>}
      {unlocked && selectedForecast.conditionBranch ? <MethodSheet className="aurora-frozen-branch" title={<>{RU.branchTitle}: <span data-no-translate>{selectedForecast.conditionBranch.title}</span></>}><p>{selectedForecast.conditionBranch.mode==='all'?RU.branchAll:RU.branchAny}</p><ul>{selectedForecast.conditionBranch.conditions.map((condition,index)=><li key={condition.id}><span data-no-translate>{condition.statement}</span> · {{true:RU.branchMet,false:RU.branchUnmet,unknown:RU.branchUnknown}[selectedForecast.conditionBranch!.conditionStates[index]]}</li>)}</ul></MethodSheet>:null}
      {unlocked ? <Notice>{selectedForecast.probability!==null&&selectedForecast.empirical?.interval95 ? <>
        <strong>{RU.empiricalFrequency}</strong>: {Math.round(selectedForecast.probability*100)}% · {RU.empiricalObservations} {selectedForecast.empirical.observations}.
        {' '}{RU.empiricalInterval}: {Math.round(selectedForecast.empirical.interval95.lower*100)}–{Math.round(selectedForecast.empirical.interval95.upper*100)}%.
        {' '}{RU.empiricalPersonalOnly}
      </> : !session.context.historyPermission ? RU.empiricalPermission : selectedForecast.empirical?.reason==='unstable_history' ? RU.empiricalUnstable : RU.empiricalInsufficient}</Notice> : null}
     </> : <>
      <ForecastTest session={session} language={locale.language} busy={busy}
        onChange={forecastTest=>change({...session,forecastTest,resultId:null,selectedForecastId:null,selectedConditionBranchId:null})}/>
     </>}

    </> : null}
    {stage === 6 && session.organon && practiceAvailable ? <>
     <div className="aurora-word"><strong lang="grc">{session.organon.entry.displayForm}</strong><p data-no-translate>{locale.language==='ru'?session.organon.entry.pronunciation:transliterateGreek(session.organon.entry.displayForm)}</p>{session.organon.entry.dictionaryMeaning ? <p>{session.organon.entry.dictionaryMeaning}</p> : <small>{RU.text0203}</small>}<p>{RU.text0204}<span data-no-translate={!session.transformation&&!authoredGoals.has(session.goalText)}>{session.goalText}</span></p></div>
     <div className="aurora-actions"><button type="button" className="secondary-button" onClick={() => host.speak(session.organon!.entry.pronunciation)}>{RU.text0205}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { const preferences = { ...session.organonPreferences, preferShort: true, excludedCanonicalForms: [...session.organonPreferences.excludedCanonicalForms, session.organon!.entry.canonicalForm] }, word = await computeOrganon(session.curatorId!, preferences); change({ ...session, organon: word, organonPreferences: preferences, sphragisLetter: chooseSphragis(word.entry.canonicalForm, session.goalTags, session.comfort).letter }); })}>{RU.text0206}</button></div>
     <Notice>{RU.text0207}</Notice>
    </> : null}
    {stage === 7 && session.organon && seal && practiceAvailable ? <>
     {part===0?<>
     <div className="aurora-seal"><strong lang="el">{seal.letter}</strong><span>{seal.name} · {seal.association}</span></div>
     <div className="aurora-field"><span>{RU.text0208}</span><ChoiceSelect optionDescriptions={{visual:seal.visual,gesture:seal.gesture,without_hands:seal.withoutHands,mental:RU.text0207}} description={<QuestionGuidance language={locale.language} family="capability" example={seal.visual}/> } aria-label={RU.text0208} value={session.comfort} onChange={e => change({ ...session, comfort: e.target.value as ComfortMode })}><option value="visual">{RU.text0209}</option><option value="gesture">{RU.text0210}</option><option value="without_hands">{RU.text0211}</option><option value="mental">{RU.text0212}</option></ChoiceSelect></div>
     <div className="aurora-field"><span>{RU.text0213}</span><ChoiceSelect optionDescriptions={Object.fromEntries(SPHRAGISES.filter(s=>session.organon!.entry.canonicalForm.includes(s.letter)).map(s=>[s.letter,s.visual]))} description={<QuestionGuidance language={locale.language} family="meaning" example={seal.association+'. '+seal.visual}/>} aria-label={RU.text0213} value={session.sphragisLetter ?? seal.letter} onChange={e => change({ ...session, sphragisLetter: e.target.value })}>{SPHRAGISES.filter(s => session.organon!.entry.canonicalForm.includes(s.letter)).map(s => <option key={s.id} value={s.letter}>{s.letter} · {s.association}</option>)}</ChoiceSelect></div>
     <div className="aurora-field"><span>{RU.text0214}</span><ChoiceSelect description={<QuestionGuidance language={locale.language} family="capability" example={adaptiveText('example_available_time_known')}/>} aria-label={RU.text0214} value={session.ritualMinutes} onChange={e => change({ ...session, ritualMinutes: Number(e.target.value) as 1 | 3 | 5 })}>{[1, 3, 5].map(n => <option key={n} value={n}>{n}{RU.text0215}</option>)}</ChoiceSelect></div>
     <label className="aurora-choice"><input type="checkbox" checked={session.ecphonesis} onChange={e => change({ ...session, ecphonesis: e.target.checked })}/>{RU.text0216}</label>
     <ol className="aurora-ritual">{ritualInstructions(session.ritualMinutes, session.organon.entry.displayForm, '{{AURORA_USER_INTENTION}}', seal, session.comfort, session.ecphonesis).map(line => <li key={line}>{line.split('{{AURORA_USER_INTENTION}}').map((part,index)=><Fragment key={index}>{index>0?<span data-no-translate={!session.transformation&&!authoredGoals.has(session.goalText)}>{session.goalText}</span>:null}{part}</Fragment>)}</li>)}</ol>
     </>:null}
     {part===1?<>
     {guidance?<section className="aurora-guidance"><h4>{A.stepsTitle}</h4><ol>{guidance.steps.map(line=><li key={line}>{line}</li>)}</ol><p>{guidance.alternative}</p></section>:null}
     <h4>{RU.text0217}</h4>{branchingConsequences(session.context, session.answers).reduceScale ? <Notice>{RU.text0218}</Notice> : null}<div className="aurora-field"><span>{RU.text0219}</span><ChoiceSelect description={<QuestionGuidance language={locale.language} family="capability" example={adaptiveText('example_small_step_possible')}/>} aria-label={RU.text0219} value={session.minutes} onChange={e => change({ ...session, minutes: Number(e.target.value) as ActionDuration })}>{[2, 10, 30].map(n => <option key={n} value={n}>{n}{RU.text0215}</option>)}</ChoiceSelect></div>
     <div className="aurora-action-options">{actionOptions.map(action => <article key={action.id} data-selected={session.selectedActionId === action.id}><label className="aurora-choice" aria-label={(RU.text0220 + action.title)}><input type="radio" name="aurora-action" checked={session.selectedActionId === action.id} onChange={() => change({ ...session, selectedActionId: action.id, selectedForecastId: session.forecasts.filter(f => f.plannedActionId === action.id).at(-1)?.id ?? session.selectedForecastId })}/><span><small>{action.strategy === 'clarify' ? RU.text0165 : action.strategy === 'change' ? RU.text0166 : RU.text0167}</small><strong>{action.title}</strong></span></label><ol>{action.durationVariants.find(v => v.minutes === session.minutes)!.instructions.map(line => <li key={line}>{line}</li>)}</ol><p>{action.independentAlternative}</p><MethodSheet  title={<>{RU.text0221}</>}><p>{action.lowEffortAlternative}</p></MethodSheet></article>)}</div>
     <ChoiceOptions description={<QuestionGuidance language={locale.language} family="sequence" example={adaptiveText('example_condition_before_outcome')}/>} label={RU.text0222} value={session.planStart||null} choices={[RU.startNow,T.testAnchorRequest,T.testAnchorAgreement,T.testAnchorResource].map(label=>({id:label,label}))} onChange={planStart=>change({...session,planStart})}/>
     {session.selectedActionId && session.planStart ? <Notice>{RU.text0223}{session.planStart}{RU.text0224}{ACTIONS.find(a => a.id === session.selectedActionId)!.title}{RU.text0225}{session.minutes}{RU.text0226}</Notice> : null}
     <div className="aurora-actions"><button type="button" className="secondary-button" disabled={!session.selectedActionId || !session.planStart.trim()} onClick={() => { const previous = session.executions.filter(e => e.actionId === session.selectedActionId && e.forecastId === session.selectedForecastId && !e.completedAt).at(-1); const execution: ActionExecution = { id: previous?.id ?? crypto.randomUUID(), forecastId: session.selectedForecastId, actionId: session.selectedActionId!, minutes: session.minutes, startCondition: session.planStart, plannedAt: previous?.plannedAt ?? now(), ritualCompleted: false, actionCompleted: false, completedAt: null, actualDescription: '', withoutRitual: false, taskId: previous?.taskId ?? null }; try {
                change(recordExecution(session, execution));
            }
            catch (reason) {
                reportingError(reason);
            } }}>{RU.text0227}</button>{host.canAddTask ? <button type="button" className="secondary-button" disabled={!session.selectedActionId} onClick={() => void run(() => task('action'))}>{RU.text0228}</button> : null}</div>
     {archivedSolution?.plans?.filter(plan=>plan.actionId===session.selectedActionId).map(plan=><section key={plan.actionId} className="aurora-practical-plan"><h4>{T.planSteps}</h4><ol>{plan.steps.map((step,index)=><li key={index}>{step}</li>)}</ol>{plan.myth?<MethodSheet  title={<>{T.planMythTitle}: {plan.myth.passage}</>}><p>{plan.myth.summary}</p><h5>{T.planMythApplication}</h5><p>{plan.myth.application}</p><a href={plan.myth.source} target="_blank" rel="noreferrer">{T.planSource}</a></MethodSheet>:null}<p>{T.planLimits}</p></section>)}
     <Notice>{A.practiceReady}</Notice>
     </>:null}
    </> : null}
    {stage === 8 ? <>
     <p>{A.practiceReady}</p>
     {practiceAvailable&&session.organon?<section><h4>{A.afterPractice}</h4>     <h4>{RU.text0229}</h4><QuestionGuidance language={locale.language} family="event" example={adaptiveText('example_earlier_result_observed')}/><label className="aurora-choice"><input type="checkbox" checked={withoutRitual} onChange={e => setWithoutRitual(e.target.checked)}/>{RU.text0230}</label>{!withoutRitual ? <label className="aurora-choice"><input type="checkbox" checked={ritualDone} onChange={e => setRitualDone(e.target.checked)}/>{RU.text0231}</label> : null}<label className="aurora-choice"><input type="checkbox" checked={actionDone} onChange={e => setActionDone(e.target.checked)}/>{RU.text0232}</label>
     <ChoiceOptions label={RU.text0233} value={session.actualActionNote||null} description={<QuestionGuidance language={locale.language} family="event" example={adaptiveText('example_earlier_result_observed')}/>} choices={session.selectedActionId?[RU.actionAllSteps,...ACTIONS.find(action=>action.id===session.selectedActionId)!.durationVariants.find(variant=>variant.minutes===session.minutes)!.instructions].map(label=>({id:label,label})):[]} onChange={actualActionNote=>change({...session,actualActionNote})}/>

<button type="button" className="secondary-button" onClick={()=>void run(savePracticeCompletion)} disabled={!actionDone||!session.selectedActionId||!session.planStart||!session.actualActionNote||!withoutRitual&&!ritualDone}>{RU.text0272}</button></section>:null}
     {session.forecasts.length ? <MethodSheet  title={<>{RU.text0237}</>}><div className="aurora-field"><span>{RU.text0238}</span><ChoiceSelect aria-label={RU.text0238} value={session.selectedForecastId ?? ''} onChange={e => { const forecast = session.forecasts.find(f => f.id === e.target.value); if (!forecast)
                return; const result = session.preparedResults.find(r => r.forecastHashes.includes(forecast.payloadHash)); change({ ...session, selectedForecastId: forecast.id, resultId: result?.id ?? null }); }}><option value="">{RU.text0239}</option>{session.forecasts.map(f => <option key={f.id} value={f.id}>{new Date(f.frozenAt).toLocaleString(locale.language)} · {f.plannedActionId ? ACTIONS.find(a => a.id === f.plannedActionId)?.title : RU.text0240}{f.status === 'abstained' ? RU.text0241 : ''}</option>)}</ChoiceSelect></div></MethodSheet> : null}
     <h4>{RU.text0242}</h4>{session.executions.length ? <ul>{session.executions.map(e => <li key={e.id}>{ACTIONS.find(a => a.id === e.actionId)?.title} · {e.completedAt ? RU.text0243 : RU.text0244}{e.actualDescription ? <span data-no-translate>: {e.actualDescription}</span> : ''}{e.practiceSnapshot ? <MethodSheet  title={<>{RU.text0245}</>}><p data-no-translate>{e.practiceSnapshot.goalText}</p><p>{e.practiceSnapshot.curatorId ? DEITIES[e.practiceSnapshot.curatorId].name : ''} · <span lang="grc">{e.practiceSnapshot.organon?.entry.displayForm}</span> · {e.practiceSnapshot.sphragisLetter}</p><p>{e.withoutRitual ? RU.text0246 : (RU.text0247 + e.practiceSnapshot.ritualMinutes + RU.text0215)}{RU.text0248}{e.minutes}{RU.text0215}</p></MethodSheet> : null}</li>)}</ul> : <p>{RU.text0249}</p>}
     {selectedForecast?.status === 'issued' && !unlocked && session.resultId ? <AuroraPayment key={session.resultId} host={host} resultId={session.resultId} onUnlocked={value => void run(() => unlock(value))}/> : null}
     {selectedForecast?.status === 'issued' && unlocked ? <><h4>{RU.text0250}</h4><p data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{selectedForecast.targetEvent}</p><p>{selectedForecast.predictedOutcome === 'occurs' ? RU.text0251 : RU.text0252}</p><p>{RU.text0253}<span data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{selectedForecast.observableSuccessCriterion}</span></p><MethodSheet  title={<>{RU.text0254}</>}><ul>{selectedForecast.conditions.map((condition, index) => <li key={index} data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{condition}</li>)}</ul>{archivedSolution?.organon ? <p>{RU.text0255}<span lang="grc">{archivedSolution.organon.entry.displayForm}</span></p> : null}</MethodSheet>
      {selectedForecast.horizon.mode === 'relative' ? <><p>{RU.text0256}<span data-no-translate={selectedForecast.wordingSource!=='choice_test_v1'}>{selectedForecast.horizon.anchorEvent}</span></p><RecordedTimeChoices language={locale.language} label={RU.text0257} value={observation.anchorAt ?? ''} onChange={anchorAt => setObservation({ ...observation, anchorAt })}/></> : null}
      <div className="aurora-field"><span>{RU.text0258}</span><ChoiceSelect description={<QuestionGuidance language={locale.language} family="grounds" example={adaptiveText('example_condition_before_outcome')}/>} aria-label={RU.text0258} value={observation.conditions} onChange={e => setObservation({ ...observation, conditions: e.target.value })}><option value="unknown">{RU.text0259}</option><option value="met">{RU.text0260}</option><option value="unmet">{RU.text0261}</option></ChoiceSelect></div>
      {observation.conditions === 'met' ? <RecordedTimeChoices language={locale.language} label={RU.text0262} value={observation.conditionAt} onChange={conditionAt => setObservation({ ...observation, conditionAt })}/> : null}
      <div className="aurora-field"><span>{RU.text0263}</span><ChoiceSelect description={<QuestionGuidance language={locale.language} family="event" example={adaptiveText('example_event_observed')}/>} aria-label={RU.text0263} value={observation.occurred} onChange={e => setObservation({ ...observation, occurred: e.target.value })}><option value="unknown">{RU.text0259}</option><option value="yes">{RU.text0264}</option><option value="no">{RU.text0261}</option></ChoiceSelect></div>
      {observation.occurred === 'yes' ? <RecordedTimeChoices language={locale.language} label={RU.text0265} value={observation.occurredAt} onChange={occurredAt => setObservation({ ...observation, occurredAt })}/> : null}
      <ChoiceOptions label={RU.text0266} value={observation.description||null} description={<QuestionGuidance language={locale.language} family="grounds" example={adaptiveText('example_direct_evidence')}/>} choices={[T.testWritten,T.testDirect,T.testParticipant,T.testNoEvidence].map(label=>({id:label,label}))} onChange={description=>setObservation({...observation,description})}/>
      <label className="aurora-choice"><input type="checkbox" checked={observation.complete} onChange={e => setObservation({ ...observation, complete: e.target.checked })}/>{RU.text0267}</label><label className="aurora-choice"><input type="checkbox" checked={observation.contradictory} onChange={e => setObservation({ ...observation, contradictory: e.target.checked })}/>{RU.text0268}</label>
      {(observation.conditions==='met'&&!observation.conditionAt||observation.occurred==='yes'&&!observation.occurredAt)?<p>{RU.observationRequiredDates}</p>:null}
      <button type="button" className="primary-button" disabled={busy || (observation.occurred !== 'unknown' || Boolean(observation.anchorAt)) && !observation.description.trim()} onClick={saveObservation}>{RU.text0269}</button>
     </> : null}
     {session.resolutions.length ? <ul className="aurora-outcomes">{session.resolutions.map(row => <li key={row.id}><small>{session.forecasts.find(f => f.id === row.forecastId)?.plannedActionId ? ACTIONS.find(a => a.id === session.forecasts.find(f => f.id === row.forecastId)?.plannedActionId)?.title : RU.text0240}</small><strong>{RESOLUTION_LABELS[row.status]}</strong><span>{new Date(row.recordedAt).toLocaleString(locale.language)}</span></li>)}</ul> : null}
     <ChoiceOptions label={RU.text0270} value={session.observationNote||null} description={<QuestionGuidance language={locale.language} family="repetition" example={adaptiveText('example_earlier_result_observed')}/>} choices={[RU.text0011,RU.text0031,RU.text0027,RU.text0134].map(label=>({id:label,label}))} onChange={observationNote=>change({...session,observationNote})}/>{session.observationNote&&![RU.text0011,RU.text0031,RU.text0027,RU.text0134].includes(session.observationNote)?<Notice><span data-no-translate>{session.observationNote}</span></Notice>:null}
     <div className="aurora-actions"><button type="button" className="primary-button" onClick={() => void run(async () => { await persist(); })}>{RU.text0272}</button>{host.canAddTask && selectedForecast && unlocked ? <button type="button" className="secondary-button" onClick={() => void run(() => task('review'))}>{RU.text0273}</button> : null}{host.canAddTask && session.selectedActionId ? <button type="button" className="secondary-button" onClick={() => void run(() => task('action'))}>{RU.text0274}</button> : null}</div>
     <Notice>{RU.text0275}</Notice>
    </> : null}
    <MethodSheet className="aurora-step-help" title={<>{RU.text0276}</>}><p>{RU.text0081}</p>{stage===3?<p>{A.interviewHelp}</p>:null}{stage===5?<><p>{A.forecastHelp}</p><p>{T.testIntro}</p><p>{T.testFactsHelp}</p><p>{T.testQuestion}: <span data-no-translate={!session.transformation}>{session.context.originalQuestion}</span></p></>:null}{STEP_HELP[stage].map(line => <p key={line}>{line}</p>)}</MethodSheet>
   </main>
   {busy||forwardDisabled&&stage!==8&&!(stage===5&&!testing)?<p className="aurora-next-hint" id="aurora-next-hint" role="status" data-no-translate>{guidedCopy(locale.language)[busy?'processing':'choose']}</p>:null}
   <footer className="aurora-footer">
    <button type="button" className="secondary-button" disabled={busy||stage===0} onClick={()=>{
     if(part>0){setPart(part-1);return;}
     if(testing&&(forecastDraft.page>0||(forecastDraft.cursor??0)>0))change({...session,forecastTest:moveForecastScreen(forecastDraft,session.selectedSectorId,-1)});else next(stage-1);
    }}>{RU.text0277}</button>

    <button type="button" className="primary-button" disabled={busy||forwardDisabled} aria-busy={busy} aria-describedby={busy||forwardDisabled&&stage!==8&&!(stage===5&&!testing)?'aurora-next-hint':undefined} title={testing&&forecastDraft.page===6?T.testPrepare:undefined} onClick={forward}>{stage===5&&(!testing||forecastDraft.page===6&&forecastTestProblems(forecastDraft,session.context,session.selectedSectorId).length)?A.practiceNext:RU.text0279}</button>
   </footer>
  </>}
 </section></div>;
}
