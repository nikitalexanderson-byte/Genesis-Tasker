import { EXERCISE_GUIDES } from './exercise-library-data.ts';
import { addCivilDays, civilDayNumber, isCivilDate } from '../calendar-context.ts';
import type { PhysisRecord, PhysisStore } from './types.ts';

export type WeightMode = 'total' | 'per-hand' | 'per-side' | 'bodyweight' | 'assisted';
export type ExerciseDefinition = {
  name: string; nameEn: string; aliases: string[]; muscles: string; movement: string;
  equipment: string; environment: string; technique: string; mistakes: string;
  variants: string; source: string; metric: 'strength' | 'time' | 'distance';
  weightMode: WeightMode; unilateral: boolean; favorite: boolean; notes: string;
  catalogId?: string;
  benchAngleDegrees?: number;
};
export type ExerciseChoice = { id: string; data: ExerciseDefinition; personal: boolean };
export type TrainingSet = {
  id: string; kind: 'warmup' | 'work'; weightKg: number | null; reps: number | null;
  repsMax: number | null; seconds: number | null; distanceKm: number | null;
  restSeconds: number; rpe: number | null; rir: number | null; completed: boolean;
  side: 'both' | 'left' | 'right';
};
export type TrainingExercise = {
  id: string; exerciseId: string; snapshot: ExerciseDefinition; sets: TrainingSet[];
  group: string; notes: string;
};
export type CycleDay = { id: string; name: string; kind: 'workout' | 'rest'; exercises: TrainingExercise[]; notes: string };
export type Microcycle = { id: string; name: string; repeats: number; days: CycleDay[]; notes: string };
export type Mesocycle = { id: string; name: string; repeats: number; deload: boolean; microcycles: Microcycle[]; notes: string };
export type ProgramVersion = {
  periodization?: 'linear' | 'weekly-wave' | 'daily-wave' | 'block';
  id: string; version: number; createdAt: string; name: string; description: string;
  goal: string; symbol: string; tags: string[]; mesocycles: Mesocycle[];
  progression: { mode: 'manual' | 'step' | 'top-reps'; stepKg: number };
};
export type TrainingProgram = { name: string; collection: 'personal' | 'alchemy'; archived: boolean; versions: ProgramVersion[] };
export type ScheduledWorkout = {
  id: string; day: string; snapshot: CycleDay; state: 'planned' | 'skipped';
  movedFrom: string | null; meso: string; micro: string; cycleDay: number;
};
export type TrainingAssignment = {
  programId: string; snapshot: ProgramVersion; mode: 'fixed' | 'next';
  advanceOn: 'complete' | 'finished'; startDay: string; paused: boolean;
  scheduled: ScheduledWorkout[];
};
export type TrainingSession = {
  plannedExercises?: TrainingExercise[];
  programDayId?: string;
  name: string; localDay: string; timeZone: string; startedAt: string; endedAt: string | null;
  status: 'active' | 'paused' | 'completed' | 'partial'; exercises: TrainingExercise[];
  plannedSetCount: number; notes: string; restEndAt: string | null;
  assignmentId: string | null; scheduledId: string | null; programId: string | null;
  programVersionId: string | null; editedAt: string | null; pauseStartedAt: string | null;
  pausedSeconds: number;
  timerPlan?: { exerciseId: string; setId: string; workSeconds: number; restSeconds: number }[];
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const uid = () => crypto.randomUUID();
export const TRAINING_LIMIT = 1098;
/** One creation intent survives an unknown network outcome with its original IDs.
 * Clear it only after acknowledged success; an explicit discard remounts the UI. */
export class TrainingCreationDrafts<T> {
  private records = new Map<string, PhysisRecord<T>>();
  get(key: string, create: () => PhysisRecord<T>): PhysisRecord<T> {
    let record = this.records.get(key);
    if (!record) { record = create(); this.records.set(key, record); }
    return record;
  }
  confirmed(key: string) { this.records.delete(key); }
  async save(key: string, create: () => PhysisRecord<T>, store: PhysisStore): Promise<PhysisRecord<T>> {
    const retry = this.records.has(key);
    const record = this.get(key, create);
    const current = store.records.find(saved => saved.id === record.id);
    // A background retry may already have acknowledged this operation. Preserve
    // later edits instead of sending its old frozen payload over the current one.
    const versionPresent = record.kind !== 'program' || (record.data as TrainingProgram).versions.every(version =>
      (current?.data as TrainingProgram | undefined)?.versions.some(saved => saved.id === version.id));
    if (store.status === 'saved' && current && versionPresent) {
      this.confirmed(key); return current as PhysisRecord<T>;
    }
    const latest = retry && current && versionPresent ? current as PhysisRecord<T> : record;
    await store.save(latest); this.confirmed(key); return latest;
  }
  open(recordId: string) {
    for (const [key, record] of this.records) if (record.id === recordId) this.records.delete(key);
  }
}
export function trainingDraftIsConfirmed(record: PhysisRecord, store: Pick<PhysisStore, 'records' | 'status'>) {
  return store.status === 'saved' && store.records.some(saved => saved.id === record.id && JSON.stringify(saved) === JSON.stringify(record));
}
// Canonical storage and calculations always use kg/km. Unit preferences only
// convert the input/output boundary, using the exact international definitions.
const KG_PER_POUND = 0.45359237;
const KM_PER_MILE = 1.609344;
export function trainingWeightFromKg(value: number, unit: 'kg' | 'lb') { return unit === 'lb' ? value / KG_PER_POUND : value; }
export function trainingWeightToKg(value: number, unit: 'kg' | 'lb') { return unit === 'lb' ? value * KG_PER_POUND : value; }
export function trainingDistanceFromKm(value: number, unit: 'km' | 'mi') { return unit === 'mi' ? value / KM_PER_MILE : value; }
export function trainingDistanceToKm(value: number, unit: 'km' | 'mi') { return unit === 'mi' ? value * KM_PER_MILE : value; }
export function blankSet(restSeconds = 90): TrainingSet {
  return { id: uid(), kind: 'work', weightKg: null, reps: null, repsMax: null, seconds: null, distanceKm: null, restSeconds, rpe: null, rir: null, completed: false, side: 'both' };
}
export function addExercise(choice: ExerciseChoice, restSeconds = 90): TrainingExercise {
  return { id: uid(), exerciseId: choice.id, snapshot: clone(choice.data), sets: [blankSet(restSeconds)], group: '', notes: '' };
}
export function copyExercise(exercise: TrainingExercise): TrainingExercise {
  return { ...clone(exercise), id: uid(), sets: exercise.sets.map(set => ({ ...set, id: uid(), completed: false })) };
}
export function copyDay(day: CycleDay): CycleDay { return { ...clone(day), id: uid(), exercises: day.exercises.map(copyExercise) }; }
export function copyMicro(micro: Microcycle): Microcycle { return { ...clone(micro), id: uid(), days: micro.days.map(copyDay) }; }
export function copyMeso(meso: Mesocycle): Mesocycle { return { ...clone(meso), id: uid(), microcycles: meso.microcycles.map(copyMicro) }; }
export function newCycleDay(kind: CycleDay['kind'] = 'workout'): CycleDay {
  return { id: uid(), name: '', kind, exercises: [], notes: '' };
}
export function newMicrocycle(length = 7): Microcycle {
  return { id: uid(), name: '', repeats: 1, notes: '', days: Array.from({ length: Math.max(1, Math.min(100, length)) }, () => newCycleDay('rest')) };
}
export function newMesocycle(): Mesocycle { return { id: uid(), name: '', repeats: 1, deload: false, notes: '', microcycles: [newMicrocycle()] }; }
export function newProgram(name = ''): TrainingProgram {
  const meso = newMesocycle(); meso.microcycles[0].days[0].kind = 'workout';
  return { name, collection: 'personal', archived: false, versions: [{ id: uid(), version: 1, createdAt: new Date().toISOString(), name, description: '', goal: '', symbol: '', tags: [], mesocycles: [meso], progression: { mode: 'manual', stepKg: 2.5 } }] };
}
export function programDuration(version: ProgramVersion): number {
  return version.mesocycles.reduce((total, meso) => total + meso.repeats * meso.microcycles.reduce((n, micro) => n + micro.repeats * micro.days.length, 0), 0);
}
export function assignProgram(programId: string, version: ProgramVersion, startDay: string, mode: TrainingAssignment['mode'], advanceOn: TrainingAssignment['advanceOn'] = 'finished'): TrainingAssignment {
  if (!isCivilDate(startDay) || programDuration(version) > TRAINING_LIMIT || programDuration(version) < 1) throw new Error('Программа должна содержать от 1 до 1098 дней.');
  const scheduled: ScheduledWorkout[] = [];
  for (const [mi, meso] of version.mesocycles.entries()) for (let mr = 0; mr < meso.repeats; mr++) {
    for (const [ci, micro] of meso.microcycles.entries()) for (let cr = 0; cr < micro.repeats; cr++) {
      for (const [di, day] of micro.days.entries()) scheduled.push({ id: uid(), day: addCivilDays(startDay, scheduled.length), snapshot: clone(day), state: 'planned', movedFrom: null, meso: `${mi + 1}.${mr + 1}`, micro: `${mi + 1}.${mr + 1}/${ci + 1}.${cr + 1}`, cycleDay: di + 1 });
    }
  }
  return { programId, snapshot: clone(version), mode, advanceOn, startDay, paused: false, scheduled };
}
export function sessionForSchedule(sessions: PhysisRecord<TrainingSession>[], assignmentId: string, scheduledId: string) {
  return sessions.filter(s => s.data.assignmentId === assignmentId && s.data.scheduledId === scheduledId);
}
export function scheduleStatus(item: ScheduledWorkout, sessions: PhysisRecord<TrainingSession>[], assignmentId: string): 'rest' | 'planned' | 'moved' | 'skipped' | TrainingSession['status'] {
  const related = sessionForSchedule(sessions, assignmentId, item.id);
  if (related.some(s => s.data.status === 'active')) return 'active';
  if (related.some(s => s.data.status === 'paused')) return 'paused';
  if (related.some(s => s.data.status === 'completed')) return 'completed';
  if (related.some(s => s.data.status === 'partial')) return 'partial';
  if (item.state === 'skipped') return 'skipped';
  if (item.snapshot.kind === 'rest') return 'rest';
  return item.movedFrom ? 'moved' : 'planned';
}
export function nextScheduled(assignment: PhysisRecord<TrainingAssignment>, sessions: PhysisRecord<TrainingSession>[], today: string): ScheduledWorkout | undefined {
  if (assignment.data.paused || today < assignment.data.startDay) return undefined;
  return assignment.data.scheduled.find(item => {
    if (item.snapshot.kind === 'rest' || item.state === 'skipped') return false;
    const status = scheduleStatus(item, sessions, assignment.id);
    if (status === 'completed' || (status === 'partial' && assignment.data.advanceOn === 'finished')) return false;
    return assignment.data.mode === 'next' || item.day === today;
  });
}
export function previewMove(assignment: TrainingAssignment, scheduledId: string, newDay: string, scope: 'one' | 'tail', lockedIds: Set<string> = new Set()): TrainingAssignment {
  if (!isCivilDate(newDay)) throw new Error('Нужна корректная дата.');
  const index = assignment.scheduled.findIndex(s => s.id === scheduledId);
  if (index < 0 || lockedIds.has(scheduledId)) throw new Error('Нельзя переносить начатую тренировку.');
  const delta = civilDayNumber(newDay) - civilDayNumber(assignment.scheduled[index].day);
  return { ...assignment, scheduled: assignment.scheduled.map((item, i) => {
    if (i < index || (scope === 'one' && i !== index) || lockedIds.has(item.id) || item.state === 'skipped') return item;
    return { ...item, day: addCivilDays(item.day, delta), movedFrom: item.movedFrom ?? item.day };
  }) };
}
/** Applies a new immutable version only to unstarted future slots, preserving IDs and moves. */
export function applyVersionFrom(assignment: TrainingAssignment, version: ProgramVersion, from: string, lockedIds: Set<string>): TrainingAssignment {
  if (!isCivilDate(from)) throw new Error('Нужна корректная дата.');
  const generated = assignProgram(assignment.programId, version, assignment.startDay, assignment.mode, assignment.advanceOn);
  const scheduled = generated.scheduled.map((item, index) => {
    const old = assignment.scheduled[index];
    if (!old) return item;
    if (old.day < from || lockedIds.has(old.id) || old.state === 'skipped') return old;
    return { ...item, id: old.id, day: old.day, movedFrom: old.movedFrom };
  });
  for (const old of assignment.scheduled.slice(generated.scheduled.length)) if (old.day < from || lockedIds.has(old.id)) scheduled.push(old);
  return { ...assignment, snapshot: clone(version), scheduled };
}
export function startSession(day: string, timeZone: string, scheduled?: ScheduledWorkout, assignment?: PhysisRecord<TrainingAssignment>, now = new Date()): TrainingSession {
  const exercises = (scheduled?.snapshot.exercises ?? []).map(copyExercise);
  return { name: scheduled?.snapshot.name || assignment?.data.snapshot.name || '', localDay: day, timeZone, startedAt: now.toISOString(), endedAt: null, status: 'active', exercises, plannedExercises: clone(exercises), ...(scheduled ? { programDayId: scheduled.snapshot.id } : {}), plannedSetCount: exercises.reduce((n, ex) => n + ex.sets.length, 0), notes: '', restEndAt: null, assignmentId: assignment?.id ?? null, scheduledId: scheduled?.id ?? null, programId: assignment?.data.programId ?? null, programVersionId: assignment?.data.snapshot.id ?? null, editedAt: null, pauseStartedAt: null, pausedSeconds: 0 };
}
/** Eligibility belongs to the schedule; optional interval timing must not block logging. */
export function plannedWorkoutError(assignment: PhysisRecord<TrainingAssignment> | undefined, scheduledId: string | undefined, sessions: PhysisRecord<TrainingSession>[], day: string): string | null {
  const item = assignment?.data.scheduled.find(s => s.id === scheduledId);
  if (!assignment || !item) return 'Сначала составьте и назначьте программу во вкладке «Тренировки».';
  if (assignment.data.paused) return 'Программа приостановлена.';
  if (item.snapshot.kind !== 'workout' || item.state === 'skipped') return 'Этот день не содержит запланированной тренировки.';
  if (day < assignment.data.startDay || assignment.data.mode === 'fixed' && item.day !== day) return 'Тренировка доступна в назначенный день.';
  const status = scheduleStatus(item, sessions, assignment.id);
  if (['active', 'paused', 'completed'].includes(status) || status === 'partial' && assignment.data.advanceOn === 'finished') return 'Это занятие уже начато или завершено. Откройте его запись.';
  if (assignment.data.mode === 'next' && nextScheduled(assignment, sessions, day)?.id !== item.id) return 'Сначала выполните предыдущее занятие программы.';
  if (!item.snapshot.exercises.length || item.snapshot.exercises.some(ex => !ex.sets.length)) return 'Добавьте упражнения и подходы в программу, затем примените новую версию к назначению.';
  return null;
}
export function startPlannedSession(day: string, timeZone: string, scheduledId: string | undefined, assignment: PhysisRecord<TrainingAssignment> | undefined, sessions: PhysisRecord<TrainingSession>[], now = new Date()): TrainingSession {
  const error = plannedWorkoutError(assignment, scheduledId, sessions, day);
  if (error) throw new Error(error);
  const item = assignment!.data.scheduled.find(s => s.id === scheduledId)!;
  const session = startSession(day, timeZone, item, assignment, now);
  const timed = session.exercises.every(ex => ex.sets.every(set => set.seconds !== null && set.seconds > 0));
  return timed ? { ...session, timerPlan: session.exercises.flatMap(ex => ex.sets.map(set => ({ exerciseId: ex.id, setId: set.id, workSeconds: set.seconds!, restSeconds: set.restSeconds }))) } : session;
}
/** Derive the clock from timestamps, so background throttling and reload never lose time. */
export function plannedTimer(session: TrainingSession, now = Date.now()) {
  const plan = session.timerPlan;
  if (!plan?.length) return null;
  const elapsed = Math.max(0, sessionSummary(session, now).seconds);
  const total = plan.reduce((n, step, i) => n + step.workSeconds + (i === plan.length - 1 ? 0 : step.restSeconds), 0);
  let offset = 0;
  for (const [index, step] of plan.entries()) {
    for (const phase of ['work', 'rest'] as const) {
      const duration = phase === 'work' ? step.workSeconds : index === plan.length - 1 ? 0 : step.restSeconds;
      offset += duration;
      if (elapsed < offset) return { phase, index, step, remaining: Math.ceil(offset - elapsed), total, totalRemaining: Math.ceil(total - elapsed) };
    }
  }
  return { phase: 'done' as const, index: plan.length - 1, step: plan[plan.length - 1], remaining: 0, total, totalRemaining: 0 };
}
export function pauseSession(session: TrainingSession, now = new Date()): TrainingSession {
  if (session.status === 'active') return { ...session, status: 'paused', pauseStartedAt: now.toISOString(), restEndAt: null };
  if (session.status !== 'paused') return session;
  return { ...session, status: 'active', pauseStartedAt: null, pausedSeconds: session.pausedSeconds + Math.max(0, (now.getTime() - Date.parse(session.pauseStartedAt ?? now.toISOString())) / 1000) };
}
export function finishSession(session: TrainingSession, now = new Date()): TrainingSession {
  const resumed = session.status === 'paused' ? pauseSession(session, now) : session;
  const all = resumed.exercises.flatMap(ex => ex.sets);
  return { ...resumed, endedAt: now.toISOString(), status: all.length > 0 && all.every(set => set.completed) ? 'completed' : 'partial', restEndAt: null };
}
export function restSecondsRemaining(end: string | null, now = Date.now()) { return end ? Math.max(0, Math.ceil((Date.parse(end) - now) / 1000)) : 0; }
export function setCanComplete(exercise: ExerciseDefinition, set: TrainingSet): boolean {
  if (exercise.metric === 'time') return set.seconds !== null && set.seconds > 0;
  if (exercise.metric === 'distance') return set.distanceKm !== null && set.distanceKm > 0;
  return set.reps !== null && set.reps > 0 && (exercise.weightMode === 'bodyweight' || set.weightKg !== null);
}
export function exerciseDisplayName(exercise: ExerciseDefinition, en = false): string {
  const name = en ? exercise.nameEn || exercise.name : exercise.name;
  return exercise.benchAngleDegrees === undefined ? name : `${name} · ${exercise.benchAngleDegrees}°`;
}
export function comparableKey(exercise: TrainingExercise) {
  return `${exercise.snapshot.catalogId || exercise.exerciseId}|${exercise.snapshot.metric}|${exercise.snapshot.weightMode}|${exercise.snapshot.unilateral}${exercise.snapshot.benchAngleDegrees === undefined ? '' : `|angle:${exercise.snapshot.benchAngleDegrees}`}`;
}
/** External load only. Body mass and assistance are never inferred as barbell load. */
export function setVolume(exercise: TrainingExercise, set: TrainingSet): number {
  if (!set.completed || set.kind !== 'work' || exercise.snapshot.metric !== 'strength' || exercise.snapshot.weightMode === 'assisted') return 0;
  const multiplier = (exercise.snapshot.weightMode === 'per-hand' || exercise.snapshot.weightMode === 'per-side') && set.side === 'both' ? 2 : 1;
  return (set.weightKg ?? 0) * (set.reps ?? 0) * multiplier;
}
export function estimatedOneRepMax(exercise: TrainingExercise, set: TrainingSet): number | null {
  if (!set.completed || set.kind !== 'work' || !set.weightKg || !set.reps || set.reps > 10 || ['bodyweight', 'assisted'].includes(exercise.snapshot.weightMode)) return null;
  return set.weightKg * (1 + set.reps / 30);
}
export function sessionSummary(session: TrainingSession, now = Date.now()) {
  const sets = session.exercises.flatMap(ex => ex.sets);
  const end = session.endedAt ? Date.parse(session.endedAt) : session.pauseStartedAt ? Date.parse(session.pauseStartedAt) : now;
  return { completedSets: sets.filter(set => set.completed).length, sets: sets.length, volumeKg: session.exercises.reduce((n, ex) => n + ex.sets.reduce((v, set) => v + setVolume(ex, set), 0), 0), seconds: Math.max(0, (end - Date.parse(session.startedAt)) / 1000 - session.pausedSeconds), secondsLogged: sets.filter(s => s.completed).reduce((n, s) => n + (s.seconds ?? 0), 0), distanceKm: sets.filter(s => s.completed).reduce((n, s) => n + (s.distanceKm ?? 0), 0) };
}
export function previousComparable(exercise: TrainingExercise, sessionId: string, sessions: PhysisRecord<TrainingSession>[], before: string) {
  return previousComparableEntry(exercise, sessionId, sessions, before)?.exercise;
}
export function previousComparableEntry(exercise: TrainingExercise, sessionId: string, sessions: PhysisRecord<TrainingSession>[], before: string) {
  for (const record of [...sessions].filter(s => s.id !== sessionId && !!s.data.endedAt && s.data.startedAt < before).sort((a, b) => b.data.startedAt.localeCompare(a.data.startedAt))) {
    const match = record.data.exercises.find(ex => comparableKey(ex) === comparableKey(exercise) && ex.sets.some(set => set.completed && set.kind === 'work'));
    if (match) return { exercise: match, day: record.data.localDay, startedAt: record.data.startedAt, sessionId: record.id };
  }
  return null;
}
/** A saved day starts a new fact without altering its program or scheduled dates. */
export function startProgramWorkout(program: PhysisRecord<TrainingProgram>, dayId: string, day: string, timeZone: string, now = new Date()): TrainingSession {
  const version = program.data.versions.at(-1)!;
  const template = version.mesocycles.flatMap(m => m.microcycles.flatMap(c => c.days)).find(d => d.id === dayId && d.kind === 'workout');
  if (program.data.archived || !template?.exercises.length) throw new Error('Выберите сохранённый тренировочный день с упражнениями.');
  const exercises = template.exercises.map(copyExercise);
  return { ...startSession(day, timeZone, undefined, undefined, now), name: template.name || program.data.name, programId: program.id, programVersionId: version.id, programDayId: template.id, exercises, plannedExercises: clone(exercises), plannedSetCount: exercises.reduce((n, ex) => n + ex.sets.length, 0) };
}
/** Changing actual structure never rewrites the immutable planned interval timeline. */
export function withSessionExercises(session: TrainingSession, exercises: TrainingExercise[]): TrainingSession {
  const shape = (values: TrainingExercise[]) => values.map(ex => [ex.id, ex.exerciseId, ex.sets.map(set => set.id)]);
  const changed = JSON.stringify(shape(session.exercises)) !== JSON.stringify(shape(exercises));
  return { ...session, exercises, ...(changed ? { timerPlan: undefined, restEndAt: null } : {}) };
}
export function progressionSuggestion(exercise: TrainingExercise, rule: ProgramVersion['progression']): number | null {
  const work = exercise.sets.filter(s => s.kind === 'work');
  if (rule.mode === 'manual' || exercise.snapshot.metric !== 'strength' || ['assisted', 'bodyweight'].includes(exercise.snapshot.weightMode) || !work.length || work.some(s => !s.completed || s.weightKg === null)) return null;
  if (rule.mode === 'top-reps' && work.some(s => s.repsMax === null || (s.reps ?? 0) < s.repsMax)) return null;
  return Math.max(...work.map(s => s.weightKg ?? 0)) + rule.stepKg;
}
/** Due workout slots only; rest/future slots excluded. Partial = completed/planned sets, capped at 1. */
export function completionScore(assignment: PhysisRecord<TrainingAssignment>, sessions: PhysisRecord<TrainingSession>[], today: string, range?: { start: string; end: string }) {
  const items = assignment.data.scheduled.filter(s => s.snapshot.kind === 'workout' && s.day <= today && (!range || s.day >= range.start && s.day <= range.end));
  const earned = items.reduce((n, item) => {
    const related = sessionForSchedule(sessions, assignment.id, item.id).filter(s => !!s.data.endedAt);
    return n + Math.max(0, ...related.map(s => s.data.status === 'completed' ? 1 : Math.min(1, sessionSummary(s.data).completedSets / Math.max(1, s.data.plannedSetCount || sessionSummary(s.data).sets))));
  }, 0);
  return { due: items.length, earned, percent: items.length ? Math.round(earned / items.length * 100) : null };
}

export const STARTER_EXERCISES: ExerciseChoice[] = EXERCISE_GUIDES.map(guide => ({
  id: `genesis:${guide.id}`, personal: false,
  data: { catalogId: `genesis:${guide.id}`, name: guide.name, nameEn: guide.nameEn,
    aliases: [guide.nameEn, ...(guide.aliases ?? [])], muscles: guide.muscles, movement: guide.movement, equipment: guide.equipment,
    environment: guide.equipment === 'bodyweight' ? 'home' : 'gym',
    technique: guide.steps.join(' '), mistakes: guide.mistakes, variants: '',
    source: 'GENESIS — оригинальное описание; техника: ACE/NSCA/NASM; иллюстрации движения: GENESIS, 2026.',
    metric: guide.metric, weightMode: guide.weightMode, unilateral: guide.unilateral, favorite: false, notes: '',
    ...(guide.benchAngleDegrees === undefined ? {} : { benchAngleDegrees: guide.benchAngleDegrees }) },
}));

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (v: unknown, max = 20000): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown, max = 1e7, min = 0): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const optNum = (v: unknown, max = 1e7, min = 0) => v === null || num(v, max, min);
const inList = (v: unknown, list: unknown[]) => list.includes(v);
const array = (v: unknown, max: number, valid: (v: unknown) => boolean): boolean => Array.isArray(v) && v.length <= max && v.every(valid);
const instant = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const uniqueIds = (values: unknown) => Array.isArray(values) && new Set(values.map(v => object(v) ? v.id : null)).size === values.length;
function validExercise(v: unknown): boolean {
  if (object(v) && v.benchAngleDegrees !== undefined && (!num(v.benchAngleDegrees, 85) || !Number.isInteger(v.benchAngleDegrees))) return false;
  return object(v) && ['name', 'nameEn', 'muscles', 'movement', 'equipment', 'environment', 'technique', 'mistakes', 'variants', 'source', 'notes'].every(k => text(v[k])) && array(v.aliases, 100, x => text(x, 500)) && inList(v.metric, ['strength', 'time', 'distance']) && inList(v.weightMode, ['total', 'per-hand', 'per-side', 'bodyweight', 'assisted']) && typeof v.unilateral === 'boolean' && typeof v.favorite === 'boolean' && (v.catalogId === undefined || text(v.catalogId, 200));
}
function validSet(v: unknown): boolean {
  return object(v) && text(v.id, 100) && inList(v.kind, ['warmup', 'work']) && optNum(v.weightKg, 10000) && optNum(v.reps, 10000) && (v.reps === null || Number.isInteger(v.reps)) && optNum(v.repsMax, 10000) && (v.repsMax === null || Number.isInteger(v.repsMax)) && optNum(v.seconds, 604800) && optNum(v.distanceKm, 10000) && num(v.restSeconds, 86400) && optNum(v.rpe, 10) && optNum(v.rir, 100) && typeof v.completed === 'boolean' && inList(v.side, ['both', 'left', 'right']);
}
function validTrainingExercise(v: unknown): boolean {
  return object(v) && text(v.id, 100) && text(v.exerciseId, 200) && validExercise(v.snapshot) && array(v.sets, 100, validSet) && uniqueIds(v.sets) && text(v.group, 500) && text(v.notes) && (v.sets as TrainingSet[]).every(s => !s.completed || setCanComplete(v.snapshot as ExerciseDefinition, s));
}
function validDay(v: unknown): boolean { return object(v) && text(v.id, 100) && text(v.name, 500) && inList(v.kind, ['workout', 'rest']) && array(v.exercises, 100, validTrainingExercise) && uniqueIds(v.exercises) && text(v.notes) && (v.exercises as TrainingExercise[]).every(ex => ex.sets.every(s => !s.completed && (s.repsMax === null || s.reps === null || s.repsMax >= s.reps))); }
function repeat(v: unknown) { return num(v, 100, 1) && Number.isInteger(v); }
function validVersion(v: unknown): boolean {
  if (object(v) && v.periodization !== undefined && !inList(v.periodization,['linear','weekly-wave','daily-wave','block'])) return false;
  if (!object(v) || !text(v.id, 100) || !num(v.version, 10000, 1) || !instant(v.createdAt) || !['name', 'description', 'goal', 'symbol'].every(k => text(v[k])) || !array(v.tags, 100, x => text(x, 500)) || !object(v.progression) || !inList(v.progression.mode, ['manual', 'step', 'top-reps']) || !num(v.progression.stepKg, 100) || !array(v.mesocycles, 100, m => object(m) && text(m.id, 100) && text(m.name, 500) && text(m.notes) && repeat(m.repeats) && typeof m.deload === 'boolean' && array(m.microcycles, 100, c => object(c) && text(c.id, 100) && text(c.name, 500) && text(c.notes) && repeat(c.repeats) && array(c.days, 100, validDay)))) return false;
  const version = v as unknown as ProgramVersion;
  return version.mesocycles.length > 0 && version.mesocycles.every(m => m.microcycles.length > 0 && m.microcycles.every(c => c.days.length > 0)) && programDuration(version) <= TRAINING_LIMIT;
}
export function validateTrainingRecord(record: PhysisRecord): boolean {
  const v = record.data;
  if (!object(v)) return false;
  if (record.kind === 'exercise') return validExercise(v);
  if (record.kind === 'program') return text(v.name, 500) && inList(v.collection, ['personal', 'alchemy']) && typeof v.archived === 'boolean' && Array.isArray(v.versions) && v.versions.length > 0 && array(v.versions, 100, validVersion);
  if (record.kind === 'assignment') return text(v.programId, 100) && validVersion(v.snapshot) && inList(v.mode, ['fixed', 'next']) && inList(v.advanceOn, ['complete', 'finished']) && typeof v.startDay === 'string' && isCivilDate(v.startDay) && typeof v.paused === 'boolean' && uniqueIds(v.scheduled) && array(v.scheduled, TRAINING_LIMIT, s => object(s) && text(s.id, 100) && typeof s.day === 'string' && isCivilDate(s.day) && validDay(s.snapshot) && inList(s.state, ['planned', 'skipped']) && (s.movedFrom === null || typeof s.movedFrom === 'string' && isCivilDate(s.movedFrom)) && text(s.meso, 100) && text(s.micro, 100) && num(s.cycleDay, 100, 1));
  if (record.kind === 'session') {
    if (v.plannedExercises !== undefined && (!array(v.plannedExercises, 100, validTrainingExercise) || !uniqueIds(v.plannedExercises))) return false;
    if (v.programDayId !== undefined && !text(v.programDayId, 100)) return false;
    if (v.timerPlan !== undefined && (!Array.isArray(v.timerPlan) || !v.timerPlan.length || !array(v.timerPlan, 10000, s => object(s) && text(s.exerciseId, 100) && text(s.setId, 100) && num(s.workSeconds, 604800, .001) && num(s.restSeconds, 86400)) || new Set(v.timerPlan.map(s => `${s.exerciseId}:${s.setId}`)).size !== v.timerPlan.length)) return false;
    if (!(text(v.name, 500) && typeof v.localDay === 'string' && isCivilDate(v.localDay) && text(v.timeZone, 100) && instant(v.startedAt) && (v.endedAt === null || instant(v.endedAt) && Date.parse(String(v.endedAt)) >= Date.parse(String(v.startedAt))) && inList(v.status, ['active', 'paused', 'completed', 'partial']) && array(v.exercises, 100, validTrainingExercise) && uniqueIds(v.exercises) && num(v.plannedSetCount, 10000) && text(v.notes) && [v.restEndAt, v.editedAt, v.pauseStartedAt].every(t => t === null || instant(t)) && [v.assignmentId, v.scheduledId, v.programId, v.programVersionId].every(id => id === null || text(id, 100)) && num(v.pausedSeconds, 1e10))) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: String(v.timeZone) }).format(); } catch { return false; }
    if ((v.status === 'completed' || v.status === 'partial') !== (v.endedAt !== null)) return false;
    if ((v.status === 'paused') !== (v.pauseStartedAt !== null)) return false;
    if (v.status === 'completed') { const sets = (v.exercises as TrainingExercise[]).flatMap(ex => ex.sets); if (!sets.length || sets.some(s => !s.completed)) return false; }
    return true;
  }
  return false;
}
