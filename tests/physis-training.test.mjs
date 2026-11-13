import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { calendarModule } from './helpers/calendar-modules.mjs';
import { physisModules } from './physis-test-loader.mjs';

const t = calendarModule('app/physis/training-domain.ts');
const types = calendarModule('app/physis/types.ts');
const c = calendarModule('app/calendar-context.ts');
const calendar = calendarModule('app/calendar-data.ts');
const planning = calendarModule('app/physis/training-planning-domain.ts');
const calendarLayout = calendarModule('app/physis/training-calendar-layout.ts');
const record = (kind, data) => types.newPhysisRecord(kind, data);
const clone = value => structuredClone(value);

test('workout months preserve six quintas, actual lunar decades and Sunday/Monday Gregorian alignment', () => {
  const context = c.calendarContext({timeZone:'Europe/Moscow'});
  const sacred = calendarLayout.trainingCalendarLayout('2026-10-26','sacred',context);
  assert.equal(sacred.groups.length,6);
  assert.ok(sacred.groups.every(group=>group.cells.length===5));
  assert.deepEqual(sacred.groups.flatMap(group=>group.cells.map(cell=>cell.number)),Array.from({length:30},(_,i)=>i+1));
  const lunar = calendarLayout.trainingCalendarLayout('2026-10-26','lunar',context);
  assert.equal(lunar.groups.length,3);
  assert.equal(lunar.groups[0].cells.length,10);assert.equal(lunar.groups[1].cells.length,10);
  assert.ok([9,10].includes(lunar.groups[2].cells.length));
  const actual=lunar.groups.flatMap(group=>group.cells);
  assert.equal(actual.at(-1).date,lunar.range.end);assert.equal(actual[0].date,lunar.range.start);
  for(const [weekStart,leading] of [['sunday',4],['monday',3]]){
    const grid=calendarLayout.trainingCalendarLayout('2026-10-26','profane',context,weekStart);
    assert.equal(grid.columns,7);assert.equal(grid.groups[0].cells.length%7,0);
    assert.ok(grid.groups[0].cells.slice(0,leading).every(cell=>cell===null));
    assert.equal(grid.groups[0].cells[leading].date,'2026-10-01');
    assert.equal(grid.groups[0].cells.filter(Boolean).length,31);
  }
  const leap=calendarLayout.trainingCalendarLayout('2024-02-15','profane',context,'monday');
  assert.equal(leap.groups[0].cells.filter(Boolean).at(-1).date,'2024-02-29');
});
function program48() {
  const p = t.newProgram('Контрольный цикл');
  const micro = t.newMicrocycle(8);
  micro.days[0].kind = 'workout'; micro.days[0].name = 'Сила';
  const exercise = t.addExercise(t.STARTER_EXERCISES[0]);
  exercise.sets = [0, 1].map(() => ({ ...t.blankSet(), weightKg: 50, reps: 8, repsMax: 10 }));
  micro.days[0].exercises = [exercise];
  micro.days[4] = t.copyDay(micro.days[0]);
  const meso = t.newMesocycle(); meso.microcycles = Array.from({ length: 3 }, () => t.copyMicro(micro));
  p.versions[0].mesocycles = [meso, t.copyMeso(meso)];
  return p;
}
const assignment48 = (day = '2026-10-24', mode = 'fixed') => {
  const program = record('program', program48());
  return record('assignment', t.assignProgram(program.id, program.data.versions[0], day, mode));
};
function timedAssignment(mode = 'fixed') {
  const assignment = assignment48('2026-10-24', mode);
  assignment.data.scheduled.forEach(item => item.snapshot.exercises.forEach(ex => ex.sets.forEach(set => { set.seconds = 30; set.restSeconds = 10; })));
  return assignment;
}

test('scheduled workouts enforce dates and order while interval timing remains optional', () => {
  const a = timedAssignment(); const slot = a.data.scheduled[0];
  assert.throws(() => t.startPlannedSession(slot.day, 'UTC', undefined, undefined, []));
  assert.throws(() => t.startPlannedSession(slot.day, 'UTC', 'missing', a, []));
  assert.throws(() => t.startPlannedSession('2026-10-25', 'UTC', slot.id, a, []));
  assert.throws(() => t.startPlannedSession('2026-10-25', 'UTC', a.data.scheduled[1].id, a, []));
  a.data.paused = true;
  assert.throws(() => t.startPlannedSession(slot.day, 'UTC', slot.id, a, [])); a.data.paused = false;
  slot.state = 'skipped'; assert.throws(() => t.startPlannedSession(slot.day, 'UTC', slot.id, a, [])); slot.state = 'planned';
  slot.snapshot.exercises[0].sets[0].seconds = null;
  const untimed = t.startPlannedSession(slot.day, 'UTC', slot.id, a, []);
  assert.equal(untimed.timerPlan, undefined);
  assert.equal(untimed.exercises[0].sets[0].completed, false);
  slot.snapshot.exercises[0].sets[0].seconds = 30;
  const active = record('session', t.startPlannedSession(slot.day, 'UTC', slot.id, a, []));
  assert.throws(() => t.startPlannedSession(slot.day, 'UTC', slot.id, a, [active]));
  const sequence = timedAssignment('next');
  assert.throws(() => t.startPlannedSession('2026-10-24', 'UTC', sequence.data.scheduled[4].id, sequence, []));
});

test('saved day and free session keep plan snapshots and never mark copied values completed', () => {
  const program = record('program',program48()); const version = program.data.versions[0];
  const day = version.mesocycles[0].microcycles[0].days.find(d=>d.kind==='workout');
  const before = clone(program);
  const first = t.startProgramWorkout(program,day.id,'2026-11-01','Europe/Moscow');
  const second = t.startProgramWorkout(program,day.id,'2026-11-02','Europe/Moscow');
  assert.equal(first.programId,program.id); assert.equal(first.programVersionId,version.id);
  assert.equal(first.assignmentId,null); assert.equal(first.scheduledId,null);
  assert.notEqual(first.exercises[0].id,second.exercises[0].id);
  assert.ok(first.exercises.flatMap(ex=>ex.sets).every(s=>!s.completed));
  first.exercises[0].sets[0].weightKg=99;
  assert.notEqual(first.plannedExercises[0].sets[0].weightKg,99);
  assert.deepEqual(program,before);
  assert.equal(t.validateTrainingRecord(record('session',first)),true);
  assert.equal(t.validateTrainingRecord(record('session',t.startSession('2026-11-01','UTC'))),true);
});

test('actual structure changes retain assignment and original plan without stale timer references', () => {
  const assignment=timedAssignment(); const before=clone(assignment);
  const session=t.startPlannedSession('2026-10-24','UTC',assignment.data.scheduled[0].id,assignment,[]);
  const exercises=clone(session.exercises); exercises[0].sets.push(t.blankSet());
  const changed=t.withSessionExercises(session,exercises);
  assert.equal(changed.timerPlan,undefined); assert.equal(changed.assignmentId,assignment.id);
  assert.deepEqual(changed.plannedExercises,session.plannedExercises);
  assert.deepEqual(assignment,before);
  assert.equal(t.validateTrainingRecord(record('session',changed)),true);
  const input=clone(session.exercises); input[0].sets[0].weightKg=150;
  assert.deepEqual(t.withSessionExercises(session,input).timerPlan,session.timerPlan);
});

test('previous comparable result has its historical date, ignores empty later sessions and different conventions', () => {
  const program=record('program',program48()), day=program.data.versions[0].mesocycles[0].microcycles[0].days.find(d=>d.kind==='workout');
  const old=t.startProgramWorkout(program,day.id,'2026-10-28','UTC',new Date('2026-10-28T10:00:00Z'));
  old.exercises[0].sets[0].completed=true;
  const saved=record('session',t.finishSession(old,new Date('2026-10-28T10:30:00Z')));
  const empty=clone(saved);empty.id=crypto.randomUUID();empty.data.localDay='2026-10-29';empty.data.startedAt='2026-10-29T10:00:00Z';empty.data.endedAt='2026-10-29T10:30:00Z';empty.data.exercises.forEach(e=>e.sets.forEach(s=>s.completed=false));
  const result=t.previousComparableEntry(old.exercises[0],'new',[saved,empty],'2026-11-01T10:00:00Z');
  assert.equal(result.day,'2026-10-28');assert.equal(result.sessionId,saved.id);
  const other=clone(old.exercises[0]);other.snapshot.weightMode='assisted';
  assert.equal(t.previousComparableEntry(other,'new',[saved],'2026-11-01T10:00:00Z'),null);
});

test('planned clock advances through work and rest, survives reload and pauses, and never marks sets as completed', () => {
  const a = timedAssignment(); const slot = a.data.scheduled[0];
  const start = new Date('2026-10-24T10:00:00Z');
  const session = t.startPlannedSession(slot.day, 'UTC', slot.id, a, [], start);
  assert.equal(t.validateTrainingRecord(record('session', session)), true);
  assert.equal(t.plannedTimer(session, start.getTime()).total, 70);
  assert.equal(t.plannedTimer(session, start.getTime() + 30000).phase, 'rest');
  assert.equal(t.plannedTimer(session, start.getTime() + 40000).index, 1);
  const paused = t.pauseSession(session, new Date(start.getTime() + 45000));
  assert.equal(t.plannedTimer(paused, start.getTime() + 900000).remaining, 25);
  const resumed = t.pauseSession(clone(paused), new Date(start.getTime() + 145000));
  assert.equal(t.plannedTimer(resumed, start.getTime() + 150000).remaining, 20);
  a.data.scheduled[0].snapshot.exercises[0].sets[0].seconds = 1000;
  resumed.exercises[0].sets[0].seconds = 500;
  assert.equal(t.plannedTimer(clone(resumed), start.getTime() + 171000).phase, 'done');
  assert.equal(resumed.exercises.flatMap(ex => ex.sets).some(set => set.completed), false);
  assert.equal(resumed.timerPlan[0].workSeconds, 30);
  const invalid = clone(resumed); invalid.timerPlan[0].workSeconds = -1;
  assert.equal(t.validateTrainingRecord(record('session', invalid)), false);
  const legacy = t.startSession(slot.day, 'UTC');
  assert.equal(t.plannedTimer(legacy), null);
  assert.equal(t.validateTrainingRecord(record('session', legacy)), true);
});
function partialFor(assignment, slot = 0) {
  const item = assignment.data.scheduled[slot];
  const session = t.startSession(item.day, 'Europe/Moscow', item, assignment, new Date(`${item.day}T10:00:00Z`));
  session.exercises[0].sets[0].completed = true;
  return record('session', t.finishSession(session, new Date(`${item.day}T11:00:00Z`)));
}

test('48 real days: two mesocycles, three eight-day microcycles, rest and training cross months and leap day', () => {
  const a = assignment48('2024-02-20');
  assert.equal(t.programDuration(a.data.snapshot), 48);
  assert.equal(a.data.scheduled.length, 48);
  assert.equal(a.data.scheduled.at(-1).day, '2024-04-07');
  assert.equal(a.data.scheduled.filter(s => s.snapshot.kind === 'workout').length, 12);
  assert.equal(new Set(a.data.scheduled.map(s => s.id)).size, 48);
  assert.equal(new Set(a.data.scheduled.map(s => s.micro)).size, 6);
  assert.ok(a.data.scheduled.some(s => s.day === '2024-02-29'));
  assert.equal(t.validateTrainingRecord(a), true);
});

test('all supported calendar adapters keep exactly one canonical slot and stable identifiers', () => {
  const assignment = assignment48('2026-03-01');
  const before = JSON.stringify(assignment);
  for (const mode of ['profane', 'sacred', 'lunar']) for (const zone of ['Europe/Moscow', 'America/New_York']) {
    const context = c.calendarContext({ timeZone: zone });
    for (const item of assignment.data.scheduled) {
      const range = calendar.calendarMonthRange(item.day, mode, context);
      assert.ok(item.day >= range.start && item.day <= range.end);
      assert.ok(calendar.formatCalendarDateValue(item.day, mode, true, context));
    }
  }
  assert.equal(JSON.stringify(assignment), before);
});

test('assignment and session are deep snapshots; editing or archiving a template cannot rewrite history', () => {
  const program = record('program', program48());
  const a = record('assignment', t.assignProgram(program.id, program.data.versions[0], '2026-10-24', 'fixed'));
  const session = t.startSession('2026-10-24', 'UTC', a.data.scheduled[0], a);
  const snapshot = JSON.stringify(session);
  program.data.archived = true;
  program.data.versions[0].mesocycles[0].microcycles[0].days[0].exercises[0].snapshot.name = 'Changed catalog';
  a.data.scheduled[0].snapshot.exercises[0].sets[0].weightKg = 400;
  assert.equal(JSON.stringify(session), snapshot);
  assert.equal(session.exercises[0].sets[0].weightKg, 50);
});

test('prefilled plan is never completed; copied actual set starts unchecked; incomplete session is partial', () => {
  const a = assignment48();
  const session = t.startSession('2026-10-24', 'UTC', a.data.scheduled[0], a);
  assert.equal(t.sessionSummary(session).completedSets, 0);
  assert.equal(t.sessionSummary(session).volumeKg, 0);
  session.exercises[0].sets[0].completed = true;
  assert.equal(t.copyExercise(session.exercises[0]).sets[0].completed, false);
  const finished = t.finishSession(session);
  assert.equal(finished.status, 'partial');
  assert.equal(t.sessionSummary(finished).completedSets, 1);
  assert.equal(t.sessionSummary(finished).volumeKg, 400);
});

test('absolute rest timer and pause accounting survive a background interval and crossing midnight', () => {
  let s = t.startSession('2026-10-24', 'Europe/Moscow', undefined, undefined, new Date('2026-10-24T20:59:00Z'));
  s = t.pauseSession(s, new Date('2026-10-24T21:00:00Z'));
  s = t.pauseSession(s, new Date('2026-10-24T21:10:00Z'));
  s = t.finishSession(s, new Date('2026-10-24T21:12:00Z'));
  assert.equal(s.localDay, '2026-10-24');
  assert.equal(t.sessionSummary(s).seconds, 180);
  assert.equal(t.restSecondsRemaining('2026-10-24T21:02:00Z', Date.parse('2026-10-24T21:00:30Z')), 90);
  assert.equal(t.restSecondsRemaining('2026-10-24T21:02:00Z', Date.parse('2026-10-24T22:02:00Z')), 0);
  assert.equal(t.validateTrainingRecord(record('session', s)), true);
});

test('next-workout advancement is explicit for partial completion and skip, with no silent date shift', () => {
  const a = assignment48('2026-10-24', 'next'); const dates = a.data.scheduled.map(s => s.day);
  assert.equal(t.nextScheduled(a, [], '2026-10-23'), undefined);
  const partial = partialFor(a);
  assert.equal(t.nextScheduled(a, [partial], '2026-10-25').id, a.data.scheduled[4].id);
  a.data.advanceOn = 'complete';
  assert.equal(t.nextScheduled(a, [partial], '2026-10-25').id, a.data.scheduled[0].id);
  a.data.scheduled[0].state = 'skipped';
  assert.equal(t.nextScheduled(a, [partial], '2026-10-25').id, a.data.scheduled[4].id);
  assert.deepEqual(a.data.scheduled.map(s => s.day), dates);
  a.data.paused = true;
  assert.equal(t.nextScheduled(a, [partial], '2026-10-25'), undefined);
});

test('fixed mode only offers a workout scheduled today, not an overdue slot', () => {
  const a = assignment48();
  assert.equal(t.nextScheduled(a, [], '2026-10-25'), undefined);
  assert.equal(t.nextScheduled(a, [], '2026-10-28').id, a.data.scheduled[4].id);
});

test('move preview is immutable; one/tail, prior move and locked session rules are preserved', () => {
  const a = assignment48(); const before = JSON.stringify(a);
  const item = a.data.scheduled[4];
  const one = t.previewMove(a.data, item.id, '2026-10-30', 'one');
  assert.equal(one.scheduled[4].day, '2026-10-30');
  assert.equal(one.scheduled[5].day, a.data.scheduled[5].day);
  const twice = t.previewMove(one, item.id, '2026-10-31', 'one');
  assert.equal(twice.scheduled[4].movedFrom, '2026-10-28');
  const tail = t.previewMove(a.data, item.id, '2026-10-30', 'tail', new Set([a.data.scheduled[8].id]));
  assert.equal(tail.scheduled[5].day, c.addCivilDays(a.data.scheduled[5].day, 2));
  assert.equal(tail.scheduled[8].day, a.data.scheduled[8].day);
  assert.throws(() => t.previewMove(a.data, item.id, '2026-10-30', 'one', new Set([item.id])));
  assert.equal(JSON.stringify(a), before);
});

test('plan score excludes rest/future/moved original, counts partial fraction once, and counts explicit skip as zero', () => {
  const a = assignment48(); const partial = partialFor(a);
  assert.deepEqual(t.completionScore(a, [partial], '2026-10-27'), { due: 1, earned: .5, percent: 50 });
  assert.equal(t.completionScore(a, [partial, clone(partial)], '2026-10-27').earned, .5);
  a.data.scheduled[4].state = 'skipped';
  assert.deepEqual(t.completionScore(a, [partial], '2026-10-28'), { due: 2, earned: .5, percent: 25 });
  a.data.scheduled[4].state = 'planned';
  a.data = t.previewMove(a.data, a.data.scheduled[4].id, '2026-11-01', 'one');
  assert.equal(t.completionScore(a, [partial], '2026-10-28').due, 1);
});

test('weight semantics: external only, per-dumbbell/per-side and unilateral, no body mass or assistance summation', () => {
  const ex = t.addExercise(t.STARTER_EXERCISES[0]);
  const set = { ...t.blankSet(), completed: true, reps: 10, weightKg: 20 };
  assert.equal(t.setVolume(ex, set), 200);
  ex.snapshot.weightMode = 'per-hand'; assert.equal(t.setVolume(ex, set), 400);
  assert.equal(t.setVolume(ex, { ...set, side: 'left' }), 200);
  ex.snapshot.weightMode = 'per-side'; assert.equal(t.setVolume(ex, set), 400);
  ex.snapshot.weightMode = 'bodyweight'; assert.equal(t.setVolume(ex, set), 200);
  assert.equal(t.setVolume(ex, { ...set, weightKg: null }), 0);
  ex.snapshot.weightMode = 'assisted'; assert.equal(t.setVolume(ex, set), 0);
  ex.snapshot.weightMode = 'total'; assert.equal(t.setVolume(ex, { ...set, kind: 'warmup' }), 0);
});

test('estimated 1RM and progression never mix assistance/bodyweight/high reps; target acceptance is separate', () => {
  const ex = t.addExercise(t.STARTER_EXERCISES[0]);
  ex.sets[0] = { ...ex.sets[0], weightKg: 60, reps: 10, repsMax: 10, completed: true };
  assert.equal(t.estimatedOneRepMax(ex, ex.sets[0]), 80);
  assert.equal(t.estimatedOneRepMax(ex, { ...ex.sets[0], reps: 11 }), null);
  assert.equal(t.progressionSuggestion(ex, { mode: 'top-reps', stepKg: 2.5 }), 62.5);
  assert.equal(ex.sets[0].weightKg, 60);
  ex.sets[0].reps = 9;
  assert.equal(t.progressionSuggestion(ex, { mode: 'top-reps', stepKg: 2.5 }), null);
  assert.equal(t.progressionSuggestion(ex, { mode: 'step', stepKg: 2.5 }), 62.5);
  ex.snapshot.weightMode = 'assisted';
  assert.equal(t.estimatedOneRepMax(ex, ex.sets[0]), null);
  assert.equal(t.progressionSuggestion(ex, { mode: 'step', stepKg: 2.5 }), null);
});

test('future version updates keep past and started snapshots, slot IDs and moves', () => {
  const a = assignment48(); const locked = a.data.scheduled[8].id;
  a.data = t.previewMove(a.data, a.data.scheduled[4].id, '2026-10-30', 'one');
  const version = clone(a.data.snapshot); version.id = crypto.randomUUID(); version.version = 2;
  for (const m of version.mesocycles) for (const micro of m.microcycles) for (const d of micro.days) d.name = 'New plan';
  const next = t.applyVersionFrom(a.data, version, '2026-10-28', new Set([locked]));
  assert.equal(next.scheduled[0].snapshot.name, 'Сила');
  assert.equal(next.scheduled[4].snapshot.name, 'New plan');
  assert.equal(next.scheduled[4].day, '2026-10-30');
  assert.equal(next.scheduled[4].id, a.data.scheduled[4].id);
  assert.equal(next.scheduled[8].snapshot.name, 'Сила');
  assert.equal(a.data.snapshot.version, 1);
});

test('typed import validator rejects malformed sets, duplicate IDs, invalid dates, chronology and dangerous nested shapes', () => {
  const a = assignment48(); const valid = partialFor(a);
  assert.equal(t.validateTrainingRecord(valid), true);
  for (const bad of [NaN, Infinity, -10, '50']) { const s = clone(valid); s.data.exercises[0].sets[0].weightKg = bad; assert.equal(t.validateTrainingRecord(s), false); }
  const duplicate = clone(valid); duplicate.data.exercises[0].sets.push(clone(duplicate.data.exercises[0].sets[0])); assert.equal(t.validateTrainingRecord(duplicate), false);
  const impossible = clone(valid); impossible.data.localDay = '2026-02-30'; assert.equal(t.validateTrainingRecord(impossible), false);
  const chronology = clone(valid); chronology.data.endedAt = '2020-01-01T00:00:00Z'; assert.equal(t.validateTrainingRecord(chronology), false);
  const missing = clone(valid); delete missing.data.exercises[0].sets; assert.equal(t.validateTrainingRecord(missing), false);
  const checkedBlank = clone(valid); checkedBlank.data.exercises[0].sets[0].reps = null; assert.equal(t.validateTrainingRecord(checkedBlank), false);
  const tz = clone(valid); tz.data.timeZone = 'Somewhere/NotATimeZone'; assert.equal(t.validateTrainingRecord(tz), false);
  const large = record('program', program48()); large.data.versions[0].mesocycles[0].repeats = 100; assert.equal(t.validateTrainingRecord(large), false);
});

test('decimal comma and blank inputs do not convert unknown values to zero', () => {
  assert.equal(types.physisNumber('2,5'), 2.5); assert.equal(types.physisNumber('0'), 0);
  assert.equal(types.physisNumber(''), null); assert.equal(types.physisNumber('−'), null);
  const exercise = t.STARTER_EXERCISES[0].data;
  assert.equal(t.setCanComplete(exercise, { ...t.blankSet(), reps: 5 }), false);
  assert.equal(t.setCanComplete(exercise, { ...t.blankSet(), reps: 5, weightKg: 0 }), true);
});

test('historical civil day survives timezone changes and midnight while absolute moments stay intact', () => {
  const original = t.startSession('2026-11-01', 'America/New_York', undefined, undefined, new Date('2026-11-02T04:55:00Z'));
  const finished = t.finishSession(original, new Date('2026-11-02T05:05:00Z'));
  assert.equal(finished.localDay, '2026-11-01'); assert.equal(t.sessionSummary(finished).seconds, 600);
  const before = JSON.stringify(finished);
  for (const timeZone of ['UTC', 'Pacific/Auckland', 'Europe/Moscow']) calendar.formatCalendarDateValue(finished.localDay, 'sacred', true, c.calendarContext({ timeZone }));
  assert.equal(JSON.stringify(finished), before);
});

test('imperial input keeps canonical plan/session values and equivalent load, distance and progression results', () => {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);
  const program = record('program', t.newProgram('Imperial input'));
  const strength = t.addExercise(t.STARTER_EXERCISES[0]);
  strength.sets = [{ ...t.blankSet(), weightKg: t.trainingWeightToKg(100, 'lb'), reps: 6 }];
  const run = t.addExercise(t.STARTER_EXERCISES.find(exercise => exercise.data.metric === 'distance'));
  run.sets = [{ ...t.blankSet(), distanceKm: t.trainingDistanceToKm(3.5, 'mi'), seconds: 1800 }];
  program.data.versions[0].mesocycles[0].microcycles[0].days = [{ ...t.newCycleDay(), exercises: [strength, run] }];
  program.data.versions[0].progression = { mode: 'step', stepKg: t.trainingWeightToKg(5, 'lb') };
  const assignment = record('assignment', t.assignProgram(program.id, program.data.versions[0], '2026-10-24', 'fixed'));
  const session = t.startSession('2026-10-24', 'UTC', assignment.data.scheduled[0], assignment);
  session.exercises.forEach(exercise => exercise.sets.forEach(set => { set.completed = true; }));
  const finished = t.finishSession(session);
  const before = JSON.stringify({ program, assignment, finished });
  const summary = t.sessionSummary(finished);
  near(finished.exercises[0].sets[0].weightKg, 45.359237);
  near(finished.exercises[1].sets[0].distanceKm, 5.632704);
  near(t.trainingWeightFromKg(summary.volumeKg, 'lb'), 600);
  near(t.trainingDistanceFromKm(summary.distanceKm, 'mi'), 3.5);
  near(t.trainingWeightFromKg(t.estimatedOneRepMax(finished.exercises[0], finished.exercises[0].sets[0]), 'lb'), 120);
  near(t.trainingWeightFromKg(t.progressionSuggestion(finished.exercises[0], program.data.versions[0].progression), 'lb'), 105);
  assert.equal(t.trainingWeightFromKg(summary.volumeKg, 'kg'), summary.volumeKg);
  assert.equal(t.trainingDistanceFromKm(summary.distanceKm, 'km'), summary.distanceKm);
  for (let i = 0; i < 20; i++) {
    near(t.trainingWeightToKg(t.trainingWeightFromKg(summary.volumeKg, 'lb'), 'lb'), summary.volumeKg);
    near(t.trainingDistanceToKm(t.trainingDistanceFromKm(summary.distanceKm, 'mi'), 'mi'), summary.distanceKm);
  }
  assert.equal(JSON.stringify({ program, assignment, finished }), before);
  assert.equal(t.validateTrainingRecord(program), true);
  assert.equal(t.validateTrainingRecord(assignment), true);
  assert.equal(t.validateTrainingRecord(record('session', finished)), true);
});

test('training creation retries retain IDs after a lost committed response and a deliberate next action gets a new ID', async () => {
  const owner = 'a3c19e26-eef9-4e51-a1cd-04bfe46d2e0a';
  const factories = {
    exercise: () => record('exercise', clone(t.STARTER_EXERCISES[0].data)),
    program: () => record('program', t.newProgram('Retry program')),
    assignment: () => assignment48(),
    session: () => record('session', t.startSession('2026-10-24', 'UTC')),
  };
  for (const [kind, factory] of Object.entries(factories)) {
    const rows = new Map(), receipts = new Map(), drafts = new t.TrainingCreationDrafts();
    let lost = true, cursor = 0, creations = 0;
    const transport = async (path, init) => {
      assert.equal(path, '/records');
      const body = JSON.parse(init.body);
      if (receipts.has(body.requestId)) return clone(receipts.get(body.requestId));
      const records = body.changes.map(change => {
        assert.equal(change.expectedRevision, rows.get(change.id)?.revision ?? 0);
        const result = { id: change.id, revision: change.expectedRevision + 1, sequence: ++cursor, updatedAt: '2026-10-24T12:00:00Z', deletedAt: null };
        rows.set(change.id, result); return result;
      });
      const response = { records, cursor }; receipts.set(body.requestId, clone(response));
      if (lost) { lost = false; throw new TypeError('Response lost after commit'); }
      return response;
    };
    const modules = physisModules();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const store = new (modules.store().PhysisMemoryStore)(owner, key, 1, transport, () => {});
    const create = () => { creations++; return factory(); };
    const attempt = () => drafts.save(kind, create, store.getSnapshot());
    await assert.rejects(attempt());
    const pending = store.getSnapshot().records[0];
    assert.equal(rows.size, 1, kind); assert.equal(creations, 1, kind);
    assert.equal(t.trainingDraftIsConfirmed(pending, store.getSnapshot()), false);
    const retried = await attempt();
    assert.equal(retried.id, pending.id, kind); assert.equal(rows.size, 1, kind); assert.equal(creations, 1, kind);
    assert.equal(t.trainingDraftIsConfirmed(retried, store.getSnapshot()), true);
    const deliberateNext = await attempt();
    assert.notEqual(deliberateNext.id, retried.id, kind); assert.equal(rows.size, 2, kind); assert.equal(creations, 2, kind);
  }
});

test('background acknowledgement confirms the exact draft only; optimistic, invalid and changed drafts stay unsaved', () => {
  const draft = record('session', t.startSession('2026-10-24', 'UTC'));
  const stored = clone(draft);
  assert.equal(t.trainingDraftIsConfirmed(draft, { status: 'offline', records: [stored] }), false);
  assert.equal(t.trainingDraftIsConfirmed(draft, { status: 'saving', records: [stored] }), false);
  assert.equal(t.trainingDraftIsConfirmed(draft, { status: 'saved', records: [stored] }), true);
  const invalidLocal = clone(draft); invalidLocal.data.localDay = 'invalid';
  assert.equal(t.trainingDraftIsConfirmed(invalidLocal, { status: 'saved', records: [stored] }), false);
  const otherDraft = clone(draft); otherDraft.data.notes = 'Changed locally after acknowledgement';
  assert.equal(t.trainingDraftIsConfirmed(otherDraft, { status: 'saved', records: [stored] }), false);
  assert.equal(t.trainingDraftIsConfirmed(draft, { status: 'saved', records: [] }), false);
});

test('retry after background acknowledgement never overwrites later edits or creates another template version', async () => {
  const drafts = new t.TrainingCreationDrafts();
  const original = record('program', t.newProgram('Original'));
  const version = clone(original.data.versions[0]); version.id = crypto.randomUUID(); version.version = 2;
  const pending = types.editPhysisRecord(original, { ...original.data, versions: [...original.data.versions, version] });
  drafts.get('template-version', () => pending);
  const later = clone(pending); later.data.name = 'Edited after background acknowledgement';
  let writes = 0;
  const resolved = await drafts.save('template-version', () => { throw new Error('Do not recreate version'); }, {
    status: 'saved', records: [later], save: async () => { writes++; },
  });
  assert.equal(resolved.data.name, later.data.name); assert.equal(writes, 0);
  assert.equal(resolved.data.versions.length, 2);
});


test('automatic periodization previews preserve source/history, rest and timers, with explicit deload and safe rep ranges', () => {
  const program=program48(), original=clone(program), base=program.versions[0];
  base.mesocycles[0].microcycles[0].days[0].exercises[0].sets.forEach(s=>s.seconds=30);
  const frozen=clone(base);
  for(const model of ['linear','weekly-wave','block']) {
    const stages=planning.suggestedLoadStages(model,'strength',4);
    const version=planning.periodizedVersion(base,model,stages);
    assert.deepEqual(base,frozen);assert.equal(version.periodization,model);
    assert.ok(t.validateTrainingRecord(record('program',{...program,versions:[version]})));
    const micros=version.mesocycles.flatMap(m=>m.microcycles);
    assert.equal(micros.length,4);
    assert.equal(micros[0].days[1].kind,'rest');
    const ex=micros[0].days[0].exercises[0];
    assert.equal(ex.sets[0].weightKg,45);assert.equal(ex.sets[0].seconds,30);
    assert.equal(ex.sets[0].repsMax,null);assert.equal(ex.sets[0].completed,false);
    assert.notEqual(ex.id,base.mesocycles[0].microcycles[0].days[0].exercises[0].id);
    assert.equal(micros[3].days[0].exercises[0].sets[0].weightKg,40);
    assert.equal(micros[3].days[0].exercises[0].sets[0].reps,3);
    assert.equal(micros[3].days[0].exercises[0].sets.length,2);
  }
  assert.equal(original.versions[0].mesocycles.length,2);
  const waves=planning.periodizedVersion(base,'daily-wave',planning.suggestedLoadStages('daily-wave','hypertrophy',2));
  assert.equal(waves.mesocycles[0].microcycles[0].days[4].exercises[0].sets[0].weightKg,50);
  assert.throws(()=>planning.periodizedVersion(base,'daily-wave',planning.suggestedLoadStages('daily-wave','strength',3)));
  assert.throws(()=>planning.suggestedLoadStages('linear','strength',1));
  assert.throws(()=>planning.percentLoad(100,110,2.5));
  assert.equal(planning.percentLoad(110,72,2.5),80);
});

test('progress uses actual work, separates sides and conventions, and computes reps and repetition-weighted intensity', () => {
  const ex=t.addExercise(t.STARTER_EXERCISES[0]);
  ex.sets=[{...t.blankSet(),weightKg:50,reps:5,completed:true,side:'left'},
    {...t.blankSet(),weightKg:60,reps:10,completed:true,side:'left'},
    {...t.blankSet(),weightKg:900,reps:5,completed:true,kind:'warmup',side:'left'},
    {...t.blankSet(),weightKg:200,reps:5,completed:false,side:'left'},
    {...t.blankSet(),weightKg:30,reps:5,completed:true,side:'right'}];
  const s=t.startSession('2026-10-24','UTC');s.exercises=[ex];
  const finished=record('session',t.finishSession(s)), pending=record('session',t.startSession('2026-10-25','UTC'));
  const comparison=`${t.comparableKey(ex)}|left`;
  const sessions=[finished,pending];
  assert.deepEqual(planning.trainingProgressSeries(sessions,'reps',comparison),[{day:s.localDay,value:15}]);
  assert.deepEqual(planning.trainingProgressSeries(sessions,'volume',comparison),[{day:s.localDay,value:850}]);
  assert.equal(planning.trainingProgressSeries(sessions,'average-weight',comparison)[0].value,850/15);
  assert.ok(Math.abs(planning.trainingProgressSeries(sessions,'intensity',comparison,100)[0].value-850/15)<1e-9);
  assert.deepEqual(planning.trainingProgressSeries(sessions,'intensity',comparison),[]);
  assert.deepEqual(planning.trainingProgressSeries(sessions,'e1rm'),[]);
  assert.equal(planning.trainingProgressSeries(sessions,'e1rm',comparison)[0].value,80);
  assert.equal(planning.trainingProgressSeries(sessions,'reps',`${t.comparableKey(ex)}|right`)[0].value,5);
  const external=planning.exerciseAtPercent(ex,100,75,2.5);
  assert.equal(external.sets[0].weightKg,75);assert.equal(external.sets[2].weightKg,900);
  assert.equal(ex.sets[0].weightKg,50);
});


test('expanded movement library preserves historical exercise identity and supplies valid human atlases', () => {
  const guides = calendarModule('app/physis/exercise-library-data.ts').EXERCISE_GUIDES;
  const media = JSON.parse(readFileSync(new URL('../app/physis/exercise-media-data.json', import.meta.url), 'utf8'));
  assert.ok(guides.length >= 98);
  const facePull = guides.find(guide => guide.id === 'cable-face-pull');
  const facePullCopy = JSON.parse(readFileSync(new URL('../app/physis/exercise-face-pull-copy.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(facePullCopy).sort(), ['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'].sort());
  assert.deepEqual(facePull.steps, facePullCopy.ru.steps);
  assert.deepEqual(facePull.stepsEn, facePullCopy.en.steps);
  for (const localized of Object.values(facePullCopy)) {
    assert.equal(localized.steps.length, facePull.steps.length);
    for (const text of [localized.name, localized.purpose, ...localized.steps, localized.mistakes, localized.trapezius]) assert.ok(text.trim());
  }
  assert.equal(new Set(guides.map(guide => guide.id)).size, guides.length);
  for (const guide of guides) {
    assert.equal(guide.steps.length, 3);
    assert.equal(guide.stepsEn.length, 3);
    assert.ok(guide.primary.length && guide.mistakes && guide.mistakesEn);
    assert.ok(t.validateTrainingRecord(record('exercise', t.STARTER_EXERCISES.find(entry => entry.id === `genesis:${guide.id}`).data)));
  }
  assert.deepEqual(new Set(Object.keys(media)), new Set(guides.map(entry => entry.id)));
  const legacy = { squat: 'total', hinge: 'total', press: 'total', row: 'per-hand', pushup: 'bodyweight', pullup: 'assisted', lunge: 'per-hand', plank: 'bodyweight', run: 'bodyweight', walk: 'bodyweight' };
  for (const [id, mode] of Object.entries(legacy)) {
    const exercise = t.STARTER_EXERCISES.find(entry => entry.id === `genesis:${id}`);
    assert.ok(exercise);
    assert.equal(exercise.data.catalogId, exercise.id);
    assert.equal(exercise.data.weightMode, mode);
    assert.equal(exercise.data.unilateral, id === 'lunge');
  }
  assert.equal(t.STARTER_EXERCISES.find(entry => entry.id === 'genesis:plank').data.movement, 'hold');
  for (const asset of Object.values(media)) {
    assert.ok([2, 3].includes(asset.frames ?? 3));
    assert.equal(asset.width % (asset.frames ?? 3), 0);
    assert.ok(asset.split > 0 && asset.split < asset.height);
    for (const key of ['src', 'poster']) {
      assert.match(asset[key], /human-v[1-9][0-9]*\.webp$/);
      const file = readFileSync(new URL(`../public${asset[key]}`, import.meta.url));
      assert.equal(file.toString('ascii', 0, 4), 'RIFF');
      assert.equal(file.toString('ascii', 8, 12), 'WEBP');
    }
  }
});

test('incline angle survives plan snapshots, validates its range and separates comparable sessions', () => {
  for (const id of ['incline-bench', 'incline-barbell-bench']) {
    const choice = t.STARTER_EXERCISES.find(entry => entry.id === `genesis:${id}`);
    assert.equal(choice.data.benchAngleDegrees, 30);
    const exercise = t.addExercise(choice);
    exercise.snapshot.benchAngleDegrees = 45;
    assert.equal(choice.data.benchAngleDegrees, 30);
    const day = t.newCycleDay('workout'); day.exercises = [exercise];
    assert.equal(t.copyDay(day).exercises[0].snapshot.benchAngleDegrees, 45);
    assert.notEqual(t.comparableKey(exercise), t.comparableKey(t.addExercise(choice)));
    for (const angle of [0, 30, 45, 85]) assert.ok(t.validateTrainingRecord(record('exercise', { ...choice.data, benchAngleDegrees: angle })));
    for (const angle of [-1, 86, NaN, Infinity, 30.5, '45', null]) assert.equal(t.validateTrainingRecord(record('exercise', { ...choice.data, benchAngleDegrees: angle })), false);
    const legacy = { ...choice.data }; delete legacy.benchAngleDegrees;
    assert.ok(t.validateTrainingRecord(record('exercise', legacy)));
    assert.notEqual(t.comparableKey({ ...exercise, snapshot: legacy }), t.comparableKey(exercise));
  }
  const drill = t.STARTER_EXERCISES.find(entry => entry.id === 'genesis:dowel-hinge');
  assert.ok(drill.data.aliases.includes('Лечебная становая тяга'));
  assert.equal(t.STARTER_EXERCISES.find(entry => entry.id === 'genesis:single-leg-rdl-one-dumbbell').data.weightMode, 'total');
  assert.equal(t.STARTER_EXERCISES.find(entry => entry.id === 'genesis:walking-lunge-dumbbell').data.weightMode, 'per-hand');
  assert.notEqual(t.STARTER_EXERCISES.find(entry => entry.id === 'genesis:nordic-curl').data.equipment, t.STARTER_EXERCISES.find(entry => entry.id === 'genesis:glute-ham-raise').data.equipment);
});
