import assert from "node:assert/strict";
import test from "node:test";
import { calendarModule } from "./helpers/calendar-modules.mjs";
const habits = calendarModule("app/habits.ts"), practices = calendarModule("app/sacred-practices.ts");
const goals = calendarModule("app/habit-practice-goal.ts"), rewards = calendarModule("app/rewards.ts");
const timers = calendarModule("app/habit-timer-workspace.ts"), timerState = calendarModule("app/habit-timer.ts");
const lifecycle = calendarModule("app/habit-lifecycle.ts"), ruleHistory = calendarModule("app/habit-rule-history.ts");
const plain = value => JSON.parse(JSON.stringify(value));
const start = "2026-10-23", next = "2026-10-24", expired = "2026-10-25";
function fixture(mode = "profane") {
  const habit = habits.createHabitFromSacredPractice(practices.SACRED_PRACTICES[0], start, mode, "ru");
  return { habit, workspace: { ...habits.EMPTY_HABIT_WORKSPACE, habits: [habit] } };
}

test("today's finite progress survives a later pause and resume, but paused or conflicted marks do not count", () => {
  const today = new Date().toISOString().slice(0, 10);
  const habit = habits.createHabitFromSacredPractice(practices.SACRED_PRACTICES[0], today, "profane", "ru");
  habit.schedule.timezone = "UTC";
  habit.practiceGoal.requiredCompletions = 3;
  const workspace = { ...habits.EMPTY_HABIT_WORKSPACE, habits: [habit] };
  const done = habits.updateHabitCompletion(workspace, habit, today, { completed: true }, today);
  const entries = done.habitCompletions.map(row => ({ ...row, updatedAt: `${today}T10:00:00.000Z` }));
  const paused = lifecycle.applyHabitLifecycleCommand(habit, {
    id: "pause", habitId: habit.id, at: `${today}T11:00:00.000Z`, action: "pause", heads: [],
  });
  const dates = (value, rows = entries) => plain(goals.habitPracticeProgress(value, rows, today).dates);
  assert.deepEqual(dates(habit), [today]);
  assert.deepEqual(dates(paused), [today]);
  assert.equal(goals.habitPracticeProgress(paused, entries, today).status, "open");
  const pausedWorkspace = { ...done, habits: [paused], habitCompletions: entries };
  assert.equal(habits.updateHabitCompletion(pausedWorkspace, paused, today, { completed: false }, today), pausedWorkspace);
  const resumed = lifecycle.applyHabitLifecycleCommand(paused, {
    id: "resume", habitId: habit.id, at: `${today}T12:00:00.000Z`, action: "resume", heads: ["pause"],
  });
  assert.deepEqual(dates(resumed), [today]);
  const stale = entries.map(row => ({ ...row, updatedAt: `${today}T11:30:00.000Z` }));
  assert.deepEqual(dates(paused, stale), []);
  assert.deepEqual(dates(resumed, stale), []);
  assert.deepEqual(dates({ ...habit, active: false }), []);
  assert.deepEqual(dates({ ...habit, practiceGoal: { ...habit.practiceGoal, startDate: "9999-12-31" } }), []);
  assert.deepEqual(dates({ ...habit, schedule: { ...habit.schedule, endDate: "2000-01-01" } }), []);
  const archive = lifecycle.applyHabitLifecycleCommand(habit, {
    id: "archive", habitId: habit.id, at: `${today}T11:00:00.000Z`, action: "archive", heads: [],
  });
  const conflict = lifecycle.projectHabitLifecycle({ ...habit,
    lifecycleHistory: lifecycle.mergeHabitLifecycleEvents(paused.lifecycleHistory, archive.lifecycleHistory) });
  assert.deepEqual(dates(conflict), []);
  const root = ruleHistory.habitRuleState(habit, today).rule;
  const rules = { ...habit, ruleHistory: [root,
    { ...root, id: "left", supersedes: [root.id] }, { ...root, id: "right", supersedes: [root.id] }] };
  assert.deepEqual(dates(rules), []);
  assert.equal(goals.habitPracticeProgress(rules, entries, today).status, "conflict");
});
test("a reading cycle does not occupy a standard sacred practice slot", () => {
  const { habit } = fixture();
  const reading = { ...habit, id: "reading-cycle", title: "Personal reading practice",
    stoicheionRestoration: { cycleId: "reading-cycle" } };
  assert.equal(habits.findStandardSacredHabit([reading], habit.sacredPracticeId), undefined);
  for (const items of [[reading, habit], [habit, reading]]) {
    assert.equal(habits.findStandardSacredHabit(items, habit.sacredPracticeId), habit);
    assert.equal(items.find(item => item.id === "reading-cycle").title, "Personal reading practice");
  }
});
for (const mode of ["profane", "sacred", "lunar"]) test(`a new sacred practice is available once in a two-day window (${mode})`, () => {
  const { habit, workspace } = fixture(mode);
  assert.equal(habit.practiceGoal.requiredCompletions, 1);
  assert.equal(habit.schedule.endDate, next);
  assert.equal(habits.isHabitScheduledForDate(habit, start, mode), true);
  assert.equal(habits.isHabitScheduledForDate(habit, next, mode), true);
  assert.equal(habits.isHabitScheduledForDate(habit, expired, mode), false);
  const done = habits.updateHabitCompletion(workspace, habit, start, { completed: true }, start);
  assert.equal(goals.habitPracticeProgress(habit, done.habitCompletions, start).status, "completed");
  assert.equal(habits.isHabitScheduledForDate(habit, next, mode, done.habitCompletions), false);
  assert.equal(habits.updateHabitCompletion(done, habit, next, { completed: true }, next), done);
  assert.equal(goals.reconcilePracticePenalties([habit], done.habitCompletions, [], expired).length, 0);
});
test("the first day is neutral; the last allowed day may complete the practice", () => {
  const { habit, workspace } = fixture();
  const neutral = habits.dailyGoalForDate(workspace, start, "profane", next);
  assert.equal(neutral.scheduledCount, 0);
  assert.equal(goals.reconcilePracticePenalties([habit], [], [], next).length, 0);
  const done = habits.updateHabitCompletion(workspace, habit, next, { completed: true }, next);
  assert.equal(goals.habitPracticeProgress(habit, done.habitCompletions, expired).status, "completed");
  assert.equal(habits.dailyGoalForDate(done, next, "profane", next).completedCount, 1);
});

test("pausing a finite practice still removes it from the daily goal", () => {
  const { habit, workspace } = fixture();
  const paused = { ...workspace, habits: [{ ...habit, active: false }] };
  assert.equal(habits.dailyGoalForDate(paused, next, "profane", next).scheduledCount, 0);
  assert.equal(habits.dailyGoalForDate(workspace, next, "profane", next).scheduledCount, 1);
});
test("expiry debits ten Laurels once, preserves XP and is repaired by a timely offline completion", () => {
  const { habit, workspace } = fixture();
  const seed = rewards.createRewardTransaction({ amount: 40, reason: "achievement", sourceId: "test", idempotencyKey: "test", createdAt: `${start}T00:00:00Z` });
  const first = goals.reconcilePracticePenalties([habit], [], [seed], expired);
  const second = goals.reconcilePracticePenalties([habit], [], [...first, ...first], "2026-11-25");
  assert.equal(rewards.calculateLaurelsBalance(first), 30);
  assert.deepEqual(plain(second), plain(first));
  const done = habits.updateHabitCompletion(workspace, habit, next, { completed: true }, next);
  assert.equal(rewards.calculateLaurelsBalance(goals.reconcilePracticePenalties([habit], done.habitCompletions, second, expired)), 40);
  const closed = habits.ensureDailyGoalProgress({ ...workspace, rewardTransactions: [seed], userProgress: { ...workspace.userProgress, lifetimeXp: 160 } }, "profane", expired);
  assert.equal(closed.userProgress.lifetimeXp, 160);
  assert.equal(closed.userProgress.laurelsBalance, 30);
});
test("a configured longer deadline is honored and two offline days do not double XP", () => {
  const { habit, workspace } = fixture();
  habit.schedule.endDate = "2026-10-30"; habit.schedule.recurrence.rangeEnd = "2026-10-30";
  assert.equal(goals.habitPracticeProgress(habit, [], expired).status, "open");
  const a = habits.updateHabitCompletion(workspace, habit, start, { completed: true }, start);
  const b = habits.updateHabitCompletion(workspace, habit, next, { completed: true }, next);
  const credits = goals.practiceXpSources([habit], [...a.habitCompletions, ...b.habitCompletions]);
  assert.equal(credits.length, 1); assert.equal(credits[0].xpAwarded, 10);
});
test("legacy sacred habits retain their original schedule, history and economy", () => {
  const { habit } = fixture(); delete habit.practiceGoal;
  habit.schedule.endDate = null; habit.schedule.recurrence.rangeEnd = "";
  assert.equal(goals.habitPracticeProgress(habit, [], expired), null);
  assert.equal(goals.reconcilePracticePenalties([habit], [], [], expired).length, 0);
  assert.equal(habits.isHabitScheduledForDate(habit, expired), true);
});

test("an already completed historical default practice closes without enrolling old failures in penalties", () => {
  const { habit, workspace } = fixture();
  const done = habits.updateHabitCompletion(workspace, habit, start, { completed: true }, start);
  delete habit.practiceGoal;
  habit.schedule.endDate = null; habit.schedule.recurrence.rangeEnd = ""; habit.schedule.recurrence.enabled = false;
  assert.equal(goals.habitPracticeProgress(habit, done.habitCompletions, expired).status, "completed");
  assert.equal(goals.reconcilePracticePenalties([habit], [], [], expired).length, 0);
  const untouched = plain(habit);
  goals.habitPracticeProgress(habit, done.habitCompletions, expired);
  assert.deepEqual(plain(habit), untouched);
});

test("a configured multi-completion practice stays open until its selected target is met", () => {
  const { habit, workspace } = fixture(); habit.practiceGoal.requiredCompletions = 2;
  const first = habits.updateHabitCompletion(workspace, habit, start, { completed: true }, start);
  assert.equal(goals.habitPracticeProgress(habit, first.habitCompletions, next).status, "open");
  const second = habits.updateHabitCompletion(first, habit, next, { completed: true }, next);
  assert.equal(goals.habitPracticeProgress(habit, second.habitCompletions, expired).status, "completed");
});

test("the stored timezone owns expiry even when the device has already crossed midnight", () => {
  const { habit } = fixture(); habit.schedule.timezone = "Pacific/Honolulu";
  assert.equal(goals.reconcilePracticePenalties([habit], [], [], expired, new Date("2026-10-25T09:59:59.999Z")).length, 0);
  const ledger = goals.reconcilePracticePenalties([habit], [], [], expired, new Date("2026-10-25T10:00:00.000Z"));
  assert.equal(ledger.length, 1); assert.equal(ledger[0].createdAt, "2026-10-25T10:00:00.000Z");
});

test("an older client's fifty-day deletion reset cannot wipe a finite practice's Laurel balance", () => {
  const { habit, workspace } = fixture();
  const seed = rewards.createRewardTransaction({ amount: 40, reason: "achievement", sourceId: "seed", idempotencyKey: "seed", createdAt: `${start}T00:00:00Z` });
  const old = rewards.resetLaurelsBalance([seed], "habit-deleted-reset", habit.id, "old-client-delete", `${next}T10:00:00Z`);
  const done = habits.updateHabitCompletion(workspace, habit, start, { completed: true }, start);
  assert.equal(rewards.calculateLaurelsBalance(goals.reconcilePracticePenalties([habit], done.habitCompletions, old, expired)), 40);
  assert.equal(rewards.calculateLaurelsBalance(goals.reconcilePracticePenalties([habit], [], old, expired)), 30);
});

test("attaching a practice preserves a regular habit's earlier legitimate Laurel reset", () => {
  const { habit, workspace } = fixture();
  habit.stoicheionRestoration = { startedAt: `${start}T12:00:00Z`, startedDate: start, sourceDate: start };
  const seed = rewards.createRewardTransaction({ amount: 40, reason: "achievement", sourceId: "seed", idempotencyKey: "seed", createdAt: `${start}T00:00:00Z` });
  const before = rewards.resetLaurelsBalance([seed], "habit-deleted-reset", habit.id, "before-attachment", `${start}T11:00:00Z`);
  const earned = rewards.createRewardTransaction({ amount: 20, reason: "achievement", sourceId: "earned", idempotencyKey: "earned", createdAt: `${start}T13:00:00Z` });
  const ledger = rewards.resetLaurelsBalance([...before, earned], "habit-deleted-reset", habit.id, "after-attachment", `${start}T14:00:00Z`);
  const done = habits.updateHabitCompletion(workspace, habit, start, { completed: true }, start);
  const reconciled = goals.reconcilePracticePenalties([habit], done.habitCompletions, ledger, expired);
  assert.equal(rewards.calculateLaurelsBalance(reconciled), 20);
  assert.equal(reconciled.filter(row => row.reason === "habit-deleted-reset").length, 1);
  assert.equal(rewards.calculateLaurelsBalance(goals.reconcilePracticePenalties([habit], [], ledger, expired)), 10);
});

function measuredFixture() {
  const { habit, workspace } = fixture();
  habit.schedule.timezone = "UTC";
  habit.measurement = { kind: "duration", unit: "min", target: 1000, quickAdd: 1000 };
  return { habit, workspace };
}
const timerCommand = (action, at, extra = {}) => ({ action, at, owner: "practice-device", id: `practice-${action}`,
  sessionId: "practice-session", ...extra });

test("a measured one-shot practice rejects a second day without appending data or replaying rewards", () => {
  const { habit, workspace } = measuredFixture();
  const first = habits.recordHabitMeasurement(workspace, habit, start, 1000, { id: "practice-first" }, start);
  const before = JSON.stringify(first);
  assert.throws(() => habits.recordHabitMeasurement(first, habit, next, 1000, { id: "practice-second" }, next),
    /HABIT_MEASUREMENT_DATE_UNAVAILABLE/);
  assert.equal(JSON.stringify(first), before);
  const restored = habits.normalizeHabitWorkspace(plain(first), "profane");
  assert.equal(restored.habitMeasurements.length, 1);
  assert.deepEqual(restored.habitCompletions.map(row => row.date), [start]);
  assert.equal(goals.habitPracticeProgress(habit, restored.habitCompletions, next).status, "completed");
});

test("a completed practice cannot start a timer the following day", () => {
  const { habit, workspace } = measuredFixture();
  const first = habits.recordHabitMeasurement(workspace, habit, start, 1000, { id: "practice-first" }, start);
  assert.throws(() => timers.applyHabitTimerCommand(first, timerCommand("start", `${next}T01:00:00Z`, {
    id: "practice-session", habitId: habit.id }), new Date(`${next}T01:00:00Z`)), /HABIT_TIMER_DATE_UNAVAILABLE/);
  assert.equal(first.habitTimers.length, 0);
});

test("one timer across midnight previews and records only the first completed practice day", () => {
  const { habit, workspace } = measuredFixture();
  const now = new Date(`${next}T01:00:00Z`);
  let current = timers.applyHabitTimerCommand(workspace, timerCommand("start", `${start}T23:59:00Z`, {
    id: "practice-session", habitId: habit.id }), now);
  current = timers.applyHabitTimerCommand(current, timerCommand("finish", `${next}T00:02:00Z`), now);
  const allocations = timerState.habitTimerSessions(current.habitTimers)[0].state.allocations;
  assert.deepEqual(allocations.map(row => [row.date, row.value, row.reason]), [
    [start, 1000, "duration"], [next, 2000, "not-scheduled"],
  ]);
  current = timers.applyHabitTimerCommand(current, timerCommand("save", `${next}T00:03:00Z`), now);
  assert.deepEqual(current.habitMeasurements.map(row => [row.date, row.value]), [[start, 1000]]);
  assert.deepEqual(current.habitCompletions.map(row => row.date), [start]);
  assert.equal(timerState.habitTimerReading(timerState.habitTimerSessions(current.habitTimers)[0].state).workMs, 180_000);
  assert.equal(timers.applyHabitTimerCommand(current, timerCommand("save", `${next}T00:04:00Z`), now), current);
});

test("a completion synced after a timer finishes blocks the obsolete measured save and preserves elapsed time", () => {
  const { habit, workspace } = measuredFixture();
  const now = new Date(`${next}T01:00:00Z`);
  let current = timers.applyHabitTimerCommand(workspace, timerCommand("start", `${next}T00:01:00Z`, {
    id: "practice-session", habitId: habit.id }), now);
  current = timers.applyHabitTimerCommand(current, timerCommand("finish", `${next}T00:02:00Z`), now);
  const first = habits.recordHabitMeasurement(workspace, habit, start, 1000, { id: "practice-first" }, start);
  const synced = { ...current, habitMeasurements: first.habitMeasurements, habitCompletions: first.habitCompletions };
  const before = JSON.stringify(synced);
  assert.throws(() => timers.applyHabitTimerCommand(synced, timerCommand("save", `${next}T00:03:00Z`), now), /HABIT_TIMER_GOAL_CHANGED/);
  assert.equal(JSON.stringify(synced), before);
  const saved = timers.applyHabitTimerCommand(synced, timerCommand("save", `${next}T00:03:00Z`, { timeOnly: true }), now);
  assert.equal(saved.habitMeasurements.length, 1);
  assert.equal(timerState.habitTimerSessions(saved.habitTimers)[0].state.status, "saved");
});

test("a synced correction cannot commit a stale finite timer allocation preview", () => {
  const { habit, workspace } = measuredFixture(), now = new Date(`${next}T01:00:00Z`);
  const initial = habits.recordHabitMeasurement(workspace, habit, start, 500, { id: "prior-half-minute" }, start);
  let finished = timers.applyHabitTimerCommand(initial, timerCommand("start", `${start}T23:59:30Z`, {
    id: "practice-session", habitId: habit.id }), now);
  finished = timers.applyHabitTimerCommand(finished, timerCommand("finish", `${next}T00:01:00Z`), now);
  assert.deepEqual(timerState.habitTimerSessions(finished.habitTimers)[0].state.allocations.map(row => row.reason),
    ["duration", "not-scheduled"]);
  const save = timerCommand("save", `${next}T00:02:00Z`);
  const accepted = timers.applyHabitTimerCommand(finished, save, now);
  assert.equal(goals.habitPracticeProgress(habit, accepted.habitCompletions, next).status, "completed");

  for (const value of [null, 250]) {
    const corrected = habits.recordHabitMeasurement(initial, habit, start, value, {
      id: `synced-correction-${value}`, entryId: "prior-half-minute", replaces: ["prior-half-minute"], source: "correction",
    }, start);
    const synced = { ...finished, habitMeasurements: corrected.habitMeasurements, habitCompletions: corrected.habitCompletions };
    const bytes = JSON.stringify(synced);
    assert.throws(() => timers.applyHabitTimerCommand(synced, save, now), /HABIT_TIMER_GOAL_CHANGED/);
    assert.equal(JSON.stringify(synced), bytes);
    assert.equal(timerState.habitTimerSessions(synced.habitTimers)[0].state.status, "finished");
    const timeOnly = timers.applyHabitTimerCommand(synced, { ...save, timeOnly: true }, now);
    assert.deepEqual(timeOnly.habitMeasurements, corrected.habitMeasurements);
    assert.equal(timerState.habitTimerReading(timerState.habitTimerSessions(timeOnly.habitTimers)[0].state).workMs, 90_000);
  }
  // A note-only correction does not invalidate an unchanged allocation plan.
  const note = habits.recordHabitMeasurement(initial, habit, start, 500, {
    id: "same-value-new-note", entryId: "prior-half-minute", replaces: ["prior-half-minute"], source: "correction", note: "Clarified",
  }, start);
  const updated = timers.applyHabitTimerCommand({ ...finished, habitMeasurements: note.habitMeasurements,
    habitCompletions: note.habitCompletions }, save, now);
  assert.equal(goals.habitPracticeProgress(habit, updated.habitCompletions, next).status, "completed");
});

test("ordinary recurring measured habits still accept both consecutive days", () => {
  const { habit, workspace } = measuredFixture();
  habit.practiceGoal = null; habit.sacredPracticeId = null;
  const first = habits.recordHabitMeasurement(workspace, habit, start, 1000, { id: "recurring-first" }, start);
  const second = habits.recordHabitMeasurement(first, habit, next, 1000, { id: "recurring-second" }, next);
  assert.equal(second.habitMeasurements.length, 2);
  assert.deepEqual(second.habitCompletions.filter(row => row.completed).map(row => row.date), [start, next]);
});
