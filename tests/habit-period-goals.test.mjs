import assert from "node:assert/strict";
import test from "node:test";
import { calendarModule } from "./helpers/calendar-modules.mjs";
const h = calendarModule("app/habits.ts"), m = calendarModule("app/habit-measurement.ts");
const period = calendarModule("app/habit-period-goal.ts"), progress = calendarModule("app/habit-period-progress.ts");
const editing = calendarModule("app/habit-editing.ts");
const context = { version: 2, timeZone: "Europe/Moscow", gregorianYearStart: "january" };
const now = new Date("2026-05-10T12:00:00Z");

test("conflicting period rules are neutral and a late choice cannot create retroactive rewards", () => {
  const f=fixture("entries",1),root=m.habitRuleForDate(f.habit,"2026-05-04");
  const left={...root,id:"left",supersedes:[root.id]},right={...root,id:"right",supersedes:[root.id],periodGoal:{...root.periodGoal,target:2}};
  const habit={...f.habit,ruleHistory:m.normalizeHabitRuleHistory([root,left,right])};
  const one={...habit,ruleHistory:[root,left]};
  const workspace=h.recordHabitMeasurement({...f.workspace,habits:[one]},one,"2026-05-04",1000,{id:"owned-entry"},"2026-05-04");
  assert.equal(progress.habitPeriodProgress(habit,"2026-05-10",workspace,now).status,"neutral");
  const chosen=editing.resolveHabitRuleConflict(habit,"left",["left","right"],"late","2026-05-20T12:00:00Z");
  const settled=progress.habitPeriodProgress(chosen,"2026-05-10",workspace,new Date("2026-05-20T12:00:00Z"));
  assert.equal(settled.completed,true);assert.equal(settled.rewardEligible,false);
});
function fixture(metric = "days", target = 3, extra = {}) {
  const habit = { ...h.defaultHabit("2026-05-04", "profane"), id: "period-habit", title: "Synthetic period goal",
    periodGoal: { version: 1, period: "week", metric, target, calendar: "profane", context, ...extra } };
  habit.schedule.timezone = context.timeZone;
  return { habit, workspace: { ...h.EMPTY_HABIT_WORKSPACE, habits: [habit], habitMeasurements: [] } };
}
const state = ({ habit, workspace }, date = "2026-05-10", clock = now) => progress.habitPeriodProgress(habit, date, workspace, clock);
function add(f, date, value, id) { return { ...f, workspace: h.recordHabitMeasurement(f.workspace, f.habit, date, value, { id }, date) }; }
test("three entries on one day are three executions and one distinct day", () => {
  let f = fixture("entries");
  for (let index = 0; index < 3; index++) f = add(f, "2026-05-04", 1000, `entry-${index}`);
  assert.equal(state(f).value, 3); assert.equal(state(f).completed, true);
  const days = { ...f, habit: { ...f.habit, periodGoal: { ...f.habit.periodGoal, metric: "days" } } };
  assert.equal(state(days).value, 1); assert.equal(state(days).completed, false);
  assert.equal(f.workspace.habitCompletions.length, 1); assert.equal(f.workspace.habitCompletions[0].xpAwarded, 10);
  assert.throws(() => add(f, "2026-05-04", 3000, "not-three-executions"), /INVALID/);
});
test("a weekly sum includes partial daily amounts with exact precision and no next-period spill", () => {
  let f = fixture("sum", 120_000);
  f.habit.measurement = { kind: "duration", unit: "min", target: 60_000, quickAdd: 15_000 };
  f = add(f, "2026-05-04", 30_125, "thirty");
  assert.equal(state(f).value, 30_125); assert.equal(state(f).remaining, 89_875);
  f = add(f, "2026-05-06", 89_875, "rest"); f = add(f, "2026-05-11", 50_000, "next-week");
  assert.equal(state(f).value, 120_000); assert.equal(state(f).completed, true);
  assert.equal(state(f).rewardEligible, true);
  assert.equal(progress.habitPeriodSettlement(f.habit, "2026-05-06", f.workspace, now), null);
  assert.equal(progress.habitPeriodSettlement(f.habit, "2026-05-10", f.workspace, now).completed, true);
});
test("quantity and quality remain separate for a periodic sum", () => {
  let f = fixture("sum", 120_000); f.habit.measurement = { kind: "duration", unit: "min", target: 60_000, quickAdd: 15_000 };
  f.habit.qualityScale = "ten"; f.habit.scoringMode = "quality-ten";
  f = add(f, "2026-05-04", 120_000, "session");
  assert.equal(state(f).value, 120_000); assert.equal(state(f).completed, false); assert.equal(state(f).qualityPending, true);
  f.workspace = h.updateHabitCompletion(f.workspace, f.habit, "2026-05-04", { qualityValue: 8, qualityConfirmedAt: "2026-05-04T12:00:00Z" }, "2026-05-04");
  assert.equal(state(f).completed, true); assert.equal(state(f).rewardEligible, true);
});
test("correction and deletion keep one execution identity and concurrent edits cannot finish the goal", () => {
  let f = add(fixture("entries", 1), "2026-05-04", 1000, "root");
  const removed = h.recordHabitMeasurement(f.workspace, f.habit, "2026-05-04", null,
    { id: "delete", entryId: "root", replaces: ["root"], source: "correction" }, "2026-05-04");
  assert.equal(state({ ...f, workspace: removed }).value, 0);
  const restored = h.recordHabitMeasurement(removed, f.habit, "2026-05-04", 1000,
    { id: "restore", entryId: "root", replaces: ["delete"], source: "correction" }, "2026-05-04");
  assert.equal(state({ ...f, workspace: restored }).value, 1);
  f.workspace.habitMeasurements = m.mergeHabitMeasurementEvents(removed.habitMeasurements,
    [{ ...f.workspace.habitMeasurements[0], id: "competing", entryId: "root", replaces: ["root"], source: "correction" }]);
  assert.equal(state(f).completed, false); assert.equal(state(f).conflicts, true);
});
test("partial first periods and unachievable different-day targets are neutral without lowering the target", () => {
  const f = fixture(); f.habit.createdDate = "2026-05-07"; f.habit.schedule.startDate = "2026-05-07";
  assert.equal(state(f, "2026-05-10", new Date("2026-05-11T12:00:00Z")).status, "neutral");
  const impossible = fixture("days", 10);
  assert.equal(state(impossible).goal.target, 10); assert.equal(state(impossible).unattainable, true);
  assert.equal(state(impossible).status, "neutral");
});
test("deadline follows permitted days and rest days do not manufacture daily obligations", () => {
  const f = fixture(); f.habit.schedule.recurrence = { ...f.habit.schedule.recurrence, pattern: "weekdays", days: [1, 3, 5] };
  const open = state(f, "2026-05-06", new Date("2026-05-06T12:00:00Z"));
  assert.equal(open.deadline, "2026-05-08"); assert.equal(open.status, "open");
  assert.equal(state(f).status, "missed");
  assert.equal(progress.habitPeriodSettlement(f.habit, "2026-05-06", f.workspace, now), null);
});
test("weeks, sacred pyatas, Apeiron and lunar months keep their saved boundaries", () => {
  const goal = fixture().habit.periodGoal;
  assert.deepEqual(JSON.parse(JSON.stringify(period.habitGoalPeriod(goal, "2026-03-08"))), { start: "2026-03-02", end: "2026-03-09" });
  assert.deepEqual(JSON.parse(JSON.stringify(period.habitGoalPeriod({ ...goal, calendar: "sacred" }, "2026-03-20"))), { start: "2026-03-20", end: "2026-03-25" });
  assert.deepEqual(JSON.parse(JSON.stringify(period.habitGoalPeriod({ ...goal, calendar: "sacred" }, "2027-03-16"))), { start: "2027-03-15", end: "2027-03-20" });
  assert.deepEqual(JSON.parse(JSON.stringify(period.habitGoalPeriod({ ...goal, calendar: "lunar", period: "month", context: { ...context, timeZone: "UTC" } }, "2026-05-01"))), { start: "2026-04-17", end: "2026-05-16" });
  assert.deepEqual(JSON.parse(JSON.stringify(period.habitGoalPeriod({ ...goal, period: "month", context: { ...context, gregorianYearStart: "march" } }, "2026-02-10"))), { start: "2026-02-01", end: "2026-03-01" });
});
test("historical roots count in statistics without becoming reward-eligible after tiny manual additions", () => {
  let f = fixture("sum", 120_000); f.habit.measurement = { kind: "duration", unit: "min", target: 60_000, quickAdd: 15_000 };
  f.workspace = h.recordHabitMeasurement(f.workspace, f.habit, "2026-05-04", 120_000,
    { id: "imported", source: "import" }, "2026-05-04");
  f = add(f, "2026-05-06", 1, "tiny");
  assert.equal(state(f).value, 120_001); assert.equal(state(f).completed, true); assert.equal(state(f).rewardValue, 1);
  assert.equal(state(f).rewardEligible, false);
});
test("period rule changes start at the next boundary and preserve the old immutable definition", () => {
  const f = fixture(); const changed = editing.applyEditableHabitUpdate(f.habit,
    { ...f.habit, periodGoal: { ...f.habit.periodGoal, target: 5 }, updatedAt: new Date().toISOString() });
  const next = changed.ruleHistory.at(-1);
  assert.equal(next.effectiveDate, period.habitGoalPeriod(f.habit.periodGoal, new Intl.DateTimeFormat("en-CA", { timeZone: context.timeZone }).format(new Date())).end);
  assert.equal(m.habitRuleForDate(changed, "2026-05-04").periodGoal.target, 3);
  assert.equal(next.periodGoal.target, 5);
});
test("malformed period definitions fail without being normalized into daily goals", () => {
  for (const value of [false, {}, { ...fixture().habit.periodGoal, target: -1 },
    { ...fixture().habit.periodGoal, target: 1.2 }, { ...fixture().habit.periodGoal, context: { ...context, timeZone: "MSK" } }])
    assert.throws(() => period.normalizeHabitPeriodGoal(value));
});

test("Android's unambiguous GMT context normalizes to UTC without accepting ambiguous abbreviations", () => {
  const goal=fixture().habit.periodGoal;
  assert.equal(period.normalizeHabitPeriodGoal({...goal,context:{...context,timeZone:"GMT"}}).context.timeZone,"UTC");
  assert.throws(()=>period.normalizeHabitPeriodGoal({...goal,context:{...context,timeZone:"MSK"}}),/INVALID_CALENDAR_TIME_ZONE/);
});

test("intermediate days are neutral and a settled goal enters the daily goal once", () => {
  let f = fixture("entries");
  for (let index = 0; index < 3; index++) f = add(f, "2026-05-04", 1000, `complete-${index}`);
  const intermediate = h.dailyGoalForDate(f.workspace, "2026-05-06", "profane", "2026-05-06");
  assert.equal(intermediate.scheduledCount, 0); assert.equal(intermediate.status, "neutral");
  assert.equal(f.workspace.achievementUnlocks.some(item => item.achievementId === "first-step"), false);
  const closed = h.ensureDailyGoalProgress(f.workspace, "profane", "2026-05-10");
  const record = closed.dailyGoalRecords.find(item => item.date === "2026-05-10");
  assert.equal(record.scheduledCount, 1); assert.equal(record.completedCount, 1);
  assert.equal(closed.dailyGoalRecords.filter(item => item.scheduledCount).length, 1);
  assert.equal(closed.achievementUnlocks.some(item => item.achievementId === "first-step"), true);
  const again = h.refreshDailyGoalProgress(closed, ["2026-05-10"], "sacred", "2026-05-10");
  assert.deepEqual(again.rewardTransactions, closed.rewardTransactions);
  assert.equal(again.userProgress.lifetimeXp, closed.userProgress.lifetimeXp);
});

test("period streaks skip an open next week but break only after its deadline", () => {
  let f = fixture("entries", 1); f = add(f, "2026-05-04", 1000, "one");
  assert.equal(progress.habitPeriodStreak(f.habit, "2026-05-04", f.workspace, new Date("2026-05-04T12:00:00Z")), 0);
  assert.equal(progress.habitPeriodStreak(f.habit, "2026-05-11", f.workspace, new Date("2026-05-11T12:00:00Z")), 1);
  assert.equal(progress.habitPeriodStreak(f.habit, "2026-05-17", f.workspace, new Date("2026-05-18T12:00:00Z")), 0);
  const settled = progress.habitQuestCompletions([f.habit],f.workspace,"2026-05-04","2026-05-10",now);
  assert.equal(settled.length,1); assert.equal(settled[0].date,"2026-05-10");
});

test("monthly sums keep fixed boundaries and cannot borrow amounts from another month", () => {
  let f = fixture("sum",120_000,{period:"month"});
  f.habit.createdDate="2026-05-01"; f.habit.schedule.startDate="2026-05-01";
  f.habit.measurement={kind:"duration",unit:"min",target:60_000,quickAdd:15_000};
  f=add(f,"2026-05-04",60_000,"may"); f=add(f,"2026-06-01",60_000,"june");
  const result=state(f,"2026-05-31",new Date("2026-06-02T12:00:00Z"));
  assert.equal(result.value,60_000); assert.equal(result.start,"2026-05-01"); assert.equal(result.end,"2026-06-01");
  assert.equal(result.status,"missed");
});

test("a malformed sum without its measurement is rejected without losing the document", () => {
  const f=fixture("sum",120_000);
  assert.throws(()=>h.normalizeHabitWorkspace(f.workspace,"profane"),/HABIT_PERIOD_MEASUREMENT_REQUIRED/);
});
