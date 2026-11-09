import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "package.json")), ts = require("typescript"), cache = new Map();
function load(path) {
  if (path.endsWith("?raw")) return readFileSync(path.slice(0, -4), "utf8");
  if (!extname(path)) path += ".ts";
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  if (cache.has(path)) return cache.get(path).exports;
  const loaded = { exports: {} }; cache.set(path, loaded);
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: loaded, exports: loaded.exports, process: { env: {} }, Date, Math, Map, Set,
    Intl, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto,
    require: id => id.startsWith(".") && existsSync(resolve(dirname(path), id.split("?")[0]) + (extname(id.split("?")[0]) ? "" : ".ts"))
      ? load(resolve(dirname(path), id)) : require(id) }, { filename: path });
  return loaded.exports;
}
const h = load(resolve(root, "app/habits.ts")), m = load(resolve(root, "app/habit-measurement.ts"));
const sync = load(resolve(root, "app/workspace-sync-state.ts"));
const editing = load(resolve(root, "app/habit-editing.ts"));
const storageGuard = load(resolve(root, "app/workspace-storage.ts"));
const rules = load(resolve(root, "app/habit-rule-history.ts"));
test("web-to-native measurement vector retains exact values and saved calendar context", () => {
  const vector = JSON.parse(readFileSync(resolve(root, "android/app/src/test/resources/habit-measurements-web.json"), "utf8"));
  const restored = h.normalizeHabitWorkspace(vector);
  const habit = restored.habits[0];
  assert.equal(m.habitMeasurementProgress(habit, "2026-10-16", restored.habitMeasurements).total, 30_125);
  assert.equal(m.habitRuleForDate(habit, "2026-10-16").measurement.target, 60_000);
  assert.equal(m.habitRuleForDate(habit, "2026-10-17").measurement.target, 90_000);
  assert.equal(habit.ruleHistory[0].schedule.recurrence.calendarContext.timeZone, "Europe/Moscow");
  assert.equal(habit.ruleHistory[0].schedule.recurrence.calendarContext.gregorianYearStart, "march");
});
const today = h.habitDateKey(new Date());
function fixture(qualityScale = "none") {
  const habit = h.defaultHabit(today, "profane");
  habit.title = "Water";
  habit.measurement = { kind: "quantity", unit: "ml", target: 100_000, quickAdd: 25_000 };
  habit.qualityScale = qualityScale;
  habit.scoringMode = qualityScale === "ten" ? "quality-ten" : "binary";
  return { habit, workspace: { ...h.EMPTY_HABIT_WORKSPACE, habits: [habit], habitMeasurements: [] } };
}
const progress = (habit, workspace) => m.habitMeasurementProgress(habit, today, workspace.habitMeasurements);
test("exact thousandths accept decimal comma and preserve fractional additions", () => {
  assert.equal(m.parseHabitValue("0,125"), 125);
  assert.equal(m.parseHabitValue("0.1"), 100);
  for (const invalid of ["-1", "0", "NaN", "Infinity", "1e3", "1,234.5", "0.0001", "1000000001", "1 000"])
    assert.equal(m.parseHabitValue(invalid), null, invalid);
  assert.equal(m.formatHabitValue(1250, "de"), "1,25");
});
test("partial, threshold and over-target values have one daily XP ceiling and stable replay", () => {
  const { habit, workspace } = fixture();
  const partial = h.recordHabitMeasurement(workspace, habit, today, 50_000, { id: "first" });
  assert.equal(partial.habitCompletions[0].completed, false);
  assert.equal(partial.habitCompletions[0].xpAwarded, 0);
  assert.equal(h.recordHabitMeasurement(partial, habit, today, 50_000, { id: "first" }), partial);
  assert.throws(() => h.recordHabitMeasurement(partial, habit, today, 60_000, { id: "first" }), /ID_CONFLICT/);
  const full = h.recordHabitMeasurement(partial, habit, today, 75_000, { id: "second" });
  assert.equal(progress(habit, full).total, 125_000);
  assert.equal(full.habitCompletions[0].completed, true);
  assert.equal(full.habitCompletions[0].xpAwarded, 10);
  const more = h.recordHabitMeasurement(full, habit, today, 100_000, { id: "third" });
  assert.equal(more.habitCompletions.length, 1);
  assert.equal(more.habitCompletions[0].xpAwarded, 10);
  assert.equal(h.updateHabitCompletion(partial, habit, today, { completed: true }).habitCompletions[0].completed, false);
});
test("quality remains separate from quantity and corrections preserve XP history", () => {
  const { habit, workspace } = fixture("ten");
  const values = h.recordHabitMeasurement(workspace, habit, today, 100_000, { id: "value" });
  assert.equal(values.habitCompletions[0].completed, false);
  const confirmed = h.updateHabitCompletion(values, habit, today, { qualityValue: 7, qualityConfirmedAt: new Date().toISOString() });
  assert.equal(confirmed.habitCompletions[0].xpAwarded, 7);
  const corrected = h.recordHabitMeasurement(confirmed, habit, today, 40_000,
    { id: "correction", entryId: "value", replaces: ["value"], source: "correction" });
  assert.equal(corrected.habitCompletions[0].completed, false);
  assert.equal(corrected.habitCompletions[0].xpAwarded, 7);
  assert.equal(corrected.habitMeasurements.length, 2);
  assert.throws(() => h.recordHabitMeasurement(corrected, habit, today, 20_000,
    { entryId: "value", replaces: ["value"] }), /EDIT_CONFLICT/);
});
test("two clients merge independent entries, detect concurrent corrections, then resolve explicitly", () => {
  const { habit, workspace } = fixture();
  const left = h.recordHabitMeasurement(workspace, habit, today, 60_000, { id: "left" });
  const right = h.recordHabitMeasurement(workspace, habit, today, 60_000, { id: "right" });
  const clock = { version: 2, updatedAt: new Date().toISOString(), deviceId: "one" };
  const merged = sync.mergeWorkspaceDocuments({ left, right, leftFallback: clock, rightFallback: { ...clock, deviceId: "two" } });
  const normalized = h.normalizeHabitWorkspace(merged.document, "profane");
  assert.equal(progress(habit, normalized).total, 120_000);
  assert.equal(normalized.habitCompletions.length, 1);
  assert.equal(normalized.habitCompletions[0].xpAwarded, 10);
  const edit1 = h.recordHabitMeasurement(left, habit, today, 30_000,
    { id: "edit1", entryId: "left", replaces: ["left"] });
  const edit2 = h.recordHabitMeasurement(left, habit, today, 50_000,
    { id: "edit2", entryId: "left", replaces: ["left"] });
  const conflicted = { ...left, habitMeasurements: m.mergeHabitMeasurementEvents(edit1.habitMeasurements, edit2.habitMeasurements) };
  assert.equal(progress(habit, conflicted).conflicts.length, 1);
  assert.equal(progress(habit, conflicted).total, 0);
  const resolved = h.recordHabitMeasurement(conflicted, habit, today, 50_000,
    { id: "resolve", entryId: "left", replaces: ["edit1", "edit2"], source: "correction" });
  assert.equal(progress(habit, resolved).conflicts.length, 0);
  assert.equal(progress(habit, resolved).total, 50_000);
});
test("rule edits take effect tomorrow, preserving original schedule and goal", () => {
  const { habit } = fixture();
  const candidate = { ...habit, version: habit.version + 1, updatedAt: new Date().toISOString(),
    measurement: { ...habit.measurement, target: 200_000 } };
  const changed = editing.applyEditableHabitUpdate(habit, candidate);
  assert.equal(m.habitRuleForDate(changed, today).measurement.target, 100_000);
  assert.equal(m.habitRuleForDate(changed, h.addHabitDays(today, 1)).measurement.target, 200_000);
  assert.equal(h.normalizeHabitWorkspace({ ...h.EMPTY_HABIT_WORKSPACE, habits: [changed] }).habits[0].ruleHistory.length, 2);
});
test("invalid values, future dates, pauses and overflow cannot mutate the workspace", () => {
  const { habit, workspace } = fixture();
  for (const value of [-1, 0, 1.2, NaN, Infinity, m.MAX_HABIT_VALUE + 1])
    assert.throws(() => h.recordHabitMeasurement(workspace, habit, today, value), /INVALID/);
  assert.throws(() => h.recordHabitMeasurement(workspace, habit, h.addHabitDays(today, 1), 1000), /DATE_UNAVAILABLE/);
  const paused = { ...workspace, habits: workspace.habits.map(row => ({ ...row, active: false })) };
  assert.throws(() => h.recordHabitMeasurement(paused, habit, today, 1000), /DATE_UNAVAILABLE/);
  assert.throws(() => h.recordHabitMeasurement({ ...workspace, habits: [] }, habit, today, 1000), /DATE_UNAVAILABLE/);
  const maximum = h.recordHabitMeasurement(workspace, habit, today, m.MAX_HABIT_VALUE);
  assert.throws(() => h.recordHabitMeasurement(maximum, habit, today, 1), /TOTAL_TOO_LARGE/);
  assert.equal(workspace.habitMeasurements.length, 0);
});

test("duration corrections, deletion and restoration retain exact values and earned XP", () => {
  const { habit, workspace } = fixture();
  habit.measurement = { kind: "duration", unit: "min", target: 60_000, quickAdd: 15_000 };
  const initial = h.recordHabitMeasurement(workspace, habit, today, 60_125, { id: "session" });
  const removed = h.recordHabitMeasurement(initial, habit, today, null,
    { id: "delete", entryId: "session", replaces: ["session"], source: "correction" });
  assert.equal(progress(habit, removed).total, 0);
  assert.equal(removed.habitCompletions[0].completed, false);
  assert.equal(removed.habitCompletions[0].xpAwarded, 10);
  const restored = h.recordHabitMeasurement(removed, habit, today, 60_125,
    { id: "restore", entryId: "session", replaces: ["delete"], source: "correction" });
  assert.equal(progress(habit, restored).total, 60_125);
  assert.equal(restored.habitCompletions[0].xpAwarded, 10);
  assert.equal(h.normalizeHabitWorkspace(JSON.parse(JSON.stringify(restored))).habitMeasurements.length, 3);
});

test("imported or historical progress cannot earn XP through a small manual addition or quality confirmation", () => {
  for (const options of [{ source: "import" }, { historical: true }]) {
    const { habit, workspace } = fixture("ten");
    const imported = h.recordHabitMeasurement(workspace, habit, today, 100_000, { id: "imported", ...options });
    const adjusted = h.recordHabitMeasurement(imported, habit, today, 100_125,
      { id: "edit", entryId: "imported", replaces: ["imported"], source: "correction" });
    const mixed = h.recordHabitMeasurement(adjusted, habit, today, 125, { id: "manual" });
    const confirmed = h.updateHabitCompletion(mixed, habit, today, { qualityValue: 10, qualityConfirmedAt: new Date().toISOString() });
    assert.equal(confirmed.habitCompletions[0].completed, true);
    assert.equal(confirmed.habitCompletions[0].xpAwarded, 0);
    assert.equal(h.normalizeHabitWorkspace(confirmed).habitCompletions[0].xpAwarded, 0);
    const earned = h.recordHabitMeasurement(confirmed, habit, today, 100_000, { id: "own-work" });
    assert.equal(earned.habitCompletions[0].xpAwarded, 10);
  }
});

test("corrupt definitions and immutable rule collisions are rejected without binary fallback", () => {
  const { habit, workspace } = fixture();
  for (const measurement of [false, {}, { ...habit.measurement, target: -1 },
    { ...habit.measurement, kind: "duration", unit: "hours" }])
    assert.throws(() => h.normalizeHabitWorkspace({ ...workspace, habits: [{ ...habit, measurement }] }), /INVALID_HABIT_MEASUREMENT/);
  const rule = m.habitRuleForDate(habit, today);
  const reordered = { ...rule, schedule: Object.fromEntries(Object.entries(rule.schedule).reverse()) };
  assert.equal(m.normalizeHabitRuleHistory([rule, reordered]).length, 1);
  assert.throws(() => m.normalizeHabitRuleHistory([rule, { ...rule, measurement: { ...habit.measurement, target: 200_000 } }]), /ID_CONFLICT/);
  assert.throws(() => m.normalizeHabitRuleHistory([rule, { id: "broken" }]), /INVALID/);
  assert.throws(() => h.normalizeHabitWorkspace({ ...workspace, habitMeasurements: {} }), /INVALID/);
});

test("failed local validation preserves original bytes and blocks autosave until a valid recovery", () => {
  const { habit, workspace } = fixture();
  const corrupt = JSON.stringify({ ...workspace, habits: [{ ...habit, measurement: { ...habit.measurement, target: 0 } }] });
  const values = new Map([["mine", corrupt], ["other", JSON.stringify(workspace)]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.throws(() => storageGuard.readProtectedWorkspace(storage, "mine", h.normalizeHabitWorkspace, () => h.EMPTY_HABIT_WORKSPACE), /RECOVERY_REQUIRED/);
  assert.throws(() => storageGuard.writeProtectedWorkspace(storage, "mine", h.EMPTY_HABIT_WORKSPACE), /RECOVERY_REQUIRED/);
  assert.equal(storage.getItem("mine"), corrupt);
  storageGuard.writeProtectedWorkspace(storage, "other", workspace);
  values.set("mine", JSON.stringify(workspace));
  storageGuard.readProtectedWorkspace(storage, "mine", h.normalizeHabitWorkspace, () => h.EMPTY_HABIT_WORKSPACE);
  storageGuard.writeProtectedWorkspace(storage, "mine", workspace);
  assert.equal(JSON.parse(storage.getItem("mine")).habits[0].measurement.target, 100_000);
});

function ruleConflictFixture() {
  const { habit, workspace } = fixture();
  const initial = m.habitRuleForDate(habit, today);
  const left = { ...initial, id: "rule-left", recordedAt: new Date().toISOString(), supersedes: [initial.id],
    measurement: { ...habit.measurement, target: 150_000 } };
  const right = { ...left, id: "rule-right", measurement: { ...habit.measurement, target: 200_000 } };
  return { habit, workspace, initial, left, right,
    conflicted: { ...habit, ruleHistory: m.normalizeHabitRuleHistory([initial, left, right]) } };
}

test("causal rule history distinguishes sequential edits from two offline branches", () => {
  const f = ruleConflictFixture();
  assert.equal(rules.habitRuleState(f.conflicted, today).conflicts.length, 2);
  assert.equal(m.habitRuleForDate(f.conflicted, today).id, f.initial.id);
  assert.equal(h.isHabitScheduledForDate(f.conflicted, today), false);
  assert.throws(() => editing.applyEditableHabitUpdate(f.conflicted, f.conflicted), /HABIT_RULE_CONFLICT/);
  const sequential = { ...f.conflicted, ruleHistory: m.normalizeHabitRuleHistory([f.initial, f.left,
    { ...f.right, supersedes: [f.left.id] }]) };
  assert.equal(rules.habitRuleState(sequential, today).conflicts.length, 0);
  assert.equal(m.habitRuleForDate(sequential, today).measurement.target, 200_000);
});

test("new edits supersede known pending versions while legacy histories keep their meaning", () => {
  const f = ruleConflictFixture();
  const old = { ...f.habit, ruleHistory: m.normalizeHabitRuleHistory([f.initial,
    { ...f.left, supersedes: undefined }, { ...f.right, supersedes: undefined }]) };
  assert.equal(m.habitRuleForDate(old, today).id, f.right.id);
  assert.equal(rules.habitRuleState(old, today).conflicts.length, 0);
  const first = editing.applyEditableHabitUpdate(f.habit, { ...f.habit, measurement: f.left.measurement });
  const second = editing.applyEditableHabitUpdate(first, { ...first, measurement: f.right.measurement });
  assert.equal(rules.habitRuleFrontier(second).length, 1);
  assert.equal(rules.habitRuleFrontier(second)[0].supersedes[0], first.ruleHistory.at(-1).id);
  assert.equal(m.habitRuleForDate(second, today).id, f.initial.id);
});

test("choosing a rule retains alternatives and original measurement identities without repeated XP", () => {
  const f = ruleConflictFixture(), leftHabit = { ...f.habit, ruleHistory: [f.initial, f.left] };
  const before = h.recordHabitMeasurement({ ...f.workspace, habits: [leftHabit] }, leftHabit, today, 150_000, { id: "rule-owned-value" });
  const blocked = h.normalizeHabitWorkspace({ ...before, habits: [f.conflicted] }, "profane");
  assert.equal(blocked.habitCompletions[0].xpAwarded, 10);
  assert.equal(progress(f.conflicted, blocked).completed, false);
  const choice = editing.resolveHabitRuleConflict(f.conflicted, f.left.id, [f.left.id, f.right.id], "choice-one");
  assert.equal(choice.ruleHistory.length, 4);
  assert.equal(m.habitRuleForDate(choice, today).id, f.left.id);
  assert.equal(progress(choice, blocked).total, 150_000);
  assert.equal(progress(choice, blocked).completed, true);
  assert.equal(editing.resolveHabitRuleConflict(choice, f.left.id, [f.left.id, f.right.id], "choice-one"), choice);
  assert.throws(() => editing.resolveHabitRuleConflict(choice, f.right.id, [f.left.id, f.right.id], "choice-one"), /ID_CONFLICT/);
  const normalized = h.normalizeHabitWorkspace({ ...blocked, habits: [choice] }, "profane");
  assert.equal(h.normalizeHabitWorkspace(normalized, "profane").habitCompletions[0].xpAwarded, 10);
  assert.equal(normalized.habitMeasurements[0].ruleId, f.left.id);
});

test("concurrent choices remain conflicts and a stale choice cannot erase a third branch", () => {
  const f = ruleConflictFixture(), heads = [f.left.id, f.right.id];
  const one = editing.resolveHabitRuleConflict(f.conflicted, f.left.id, heads, "choice-left");
  const two = editing.resolveHabitRuleConflict(f.conflicted, f.right.id, heads, "choice-right");
  const merged = { ...f.conflicted, ruleHistory: m.normalizeHabitRuleHistory([...one.ruleHistory, ...two.ruleHistory]) };
  assert.equal(rules.habitRuleState(merged, today).conflicts.length, 2);
  const extra = { ...f.right, id: "third-rule" };
  const changed = { ...f.conflicted, ruleHistory: m.normalizeHabitRuleHistory([...f.conflicted.ruleHistory, extra]) };
  assert.throws(() => editing.resolveHabitRuleConflict(changed, f.left.id, heads), /EDIT_CONFLICT/);
});

test("rule graphs reject cycles, missing predecessors, invented choices and divergent immutable IDs", () => {
  const f = ruleConflictFixture();
  for (const invalid of [
    [f.initial, { ...f.left, supersedes: ["missing"] }],
    [f.initial, { ...f.left, supersedes: [f.right.id] }, { ...f.right, supersedes: [f.left.id] }],
    [f.initial, { ...f.left, selectedRuleId: f.initial.id }],
    [f.initial, f.left, { ...f.left, supersedes: [] }],
  ]) assert.throws(() => m.normalizeHabitRuleHistory(invalid), /HISTORY|ID_CONFLICT/);
});

test("workspace merge keeps causal alternatives and restores the selected period snapshot", () => {
  const f = ruleConflictFixture(), goal = { version: 1, period: "month", metric: "sum", target: 120_000,
    calendar: "lunar", context: { version: 2, timeZone: "UTC", gregorianYearStart: "january" } };
  const left = { ...f.workspace, habits: [{ ...f.habit, ruleHistory: [f.initial, { ...f.left, periodGoal: goal }] }] };
  const right = { ...f.workspace, habits: [{ ...f.habit, ruleHistory: [f.initial, f.right] }] };
  const clock = { version: 2, updatedAt: new Date().toISOString(), deviceId: "one" };
  const merged = sync.mergeWorkspaceDocuments({ left, right, leftFallback: clock, rightFallback: { ...clock, deviceId: "two" } }).document;
  const habit = merged.habits[0];
  assert.equal(rules.habitRuleState(habit, today).conflicts.length, 2);
  const chosen = editing.resolveHabitRuleConflict(habit, f.left.id, [f.left.id, f.right.id], "choose-period");
  const again = sync.mergeWorkspaceDocuments({ left: { ...merged, habits: [chosen] }, right, leftFallback: { ...clock, version: 3 }, rightFallback: clock }).document;
  assert.equal(again.habits[0].periodGoal.calendar, "lunar");
  assert.equal(again.habits[0].periodGoal.target, 120_000);
});
