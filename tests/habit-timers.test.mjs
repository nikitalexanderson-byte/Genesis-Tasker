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
const timer = load(resolve(root, "app/habit-timer.ts"));
const habits = load(resolve(root, "app/habits.ts"));
const adapter = load(resolve(root, "app/habit-timer-workspace.ts"));
const sync = load(resolve(root, "app/workspace-sync-state.ts"));
const storage = load(resolve(root, "app/workspace-storage.ts"));
const reset = load(resolve(root, "app/habit-reset.ts"));
const plain = value => JSON.parse(JSON.stringify(value));
const plan = (mode = "stopwatch", zone = "Europe/Moscow") => ({ mode, workMinutes: 25, breakMinutes: 5,
  timeZone: zone, calendarMode: "profane", context: { version: 2, timeZone: zone, gregorianYearStart: "march" },
  habitTitle: "Reading", ruleId: "rule" });
const state = ops => timer.habitTimerSessions(ops)[0].state;
function close(ops, at) {
  const allocations = timer.habitTimerDayAllocations(state(ops), Date.parse(at))
    .map(row => ({ ...row, ruleId: "rule", reason: "duration" }));
  return timer.appendHabitTimerOperation(ops, "session", "device", "finish", { at, id: "finish", allocations });
}

test("timestamp stopwatch survives pause, JSON reload and an idle/background display across midnight", () => {
  let ops = timer.startHabitTimer([], "reading", "device", plan(), "2026-10-16T20:50:00Z", "session");
  ops = timer.appendHabitTimerOperation(ops, "session", "device", "pause", { at: "2026-10-16T21:20:00Z", id: "pause" });
  ops = timer.appendHabitTimerOperation(ops, "session", "device", "resume", { at: "2026-10-16T21:30:00Z", id: "resume" });
  ops = timer.mergeHabitTimerOperations(JSON.parse(JSON.stringify(ops)));
  assert.equal(timer.habitTimerReading(state(ops), Date.parse("2026-10-16T21:50:00Z")).workMs, 50 * 60_000);
  ops = close(ops, "2026-10-16T21:50:00Z");
  assert.deepEqual(plain(state(ops).allocations.map(row => [row.date, row.value])), [["2026-10-16", 10_000], ["2026-10-17", 40_000]]);
  assert.equal(timer.habitTimerReading(state(ops), Date.parse("2027-01-01T00:00:00Z")).workMs, 50 * 60_000);
  assert.equal(timer.appendHabitTimerOperation(ops, "session", "device", "finish").length, ops.length);
});

test("Pomodoro excludes breaks, freezes during pause, and splits a break at midnight", () => {
  let ops = timer.startHabitTimer([], "reading", "device", plan("pomodoro"), "2026-10-16T20:35:00Z", "session");
  const duringBreak = timer.habitTimerReading(state(ops), Date.parse("2026-10-16T21:02:00Z"));
  assert.equal(duringBreak.onBreak, true); assert.equal(duringBreak.workMs, 25 * 60_000);
  ops = timer.appendHabitTimerOperation(ops, "session", "device", "pause", { at: "2026-10-16T21:02:00Z", id: "pause" });
  assert.equal(timer.habitTimerReading(state(ops), Date.parse("2026-10-17T21:02:00Z")).breakMs, 2 * 60_000);
  ops = timer.appendHabitTimerOperation(ops, "session", "device", "resume", { at: "2026-10-16T21:12:00Z", id: "resume" });
  ops = close(ops, "2026-10-16T21:20:00Z");
  assert.deepEqual(plain(state(ops).allocations.map(row => [row.date, row.value])), [["2026-10-16", 25_000], ["2026-10-17", 5_000]]);
  assert.equal(timer.habitTimerReading(state(ops)).breakMs, 5 * 60_000);
  assert.equal(timer.habitTimerWorkPrefix(100_000 * 30 * 60_000 + 27 * 60_000, plan("pomodoro")), (100_000 * 25 + 25) * 60_000);
});

test("UTC elapsed time handles DST overlap and a 23-hour local day without invented minutes", () => {
  let overlap = timer.startHabitTimer([], "reading", "device", plan("stopwatch", "Europe/Berlin"), "2026-10-25T00:30:00Z", "session");
  overlap = close(overlap, "2026-10-25T02:30:00Z");
  assert.deepEqual(plain(state(overlap).allocations.map(row => [row.date, row.value])), [["2026-10-25", 120_000]]);
  let spring = timer.startHabitTimer([], "reading", "device", plan("stopwatch", "Europe/Berlin"), "2026-03-28T22:30:00Z", "session");
  spring = close(spring, "2026-03-29T22:30:00Z");
  assert.deepEqual(plain(state(spring).allocations.map(row => [row.date, row.value])), [["2026-03-28", 30_000], ["2026-03-29", 1_380_000], ["2026-03-30", 30_000]]);
});

test("sub-minute precision carries its remainder across midnight and cannot inflate the total", () => {
  let ops = timer.startHabitTimer([], "reading", "device", plan("stopwatch", "UTC"), "2026-10-16T23:59:59.960Z", "session");
  ops = close(ops, "2026-10-17T00:00:00.040Z");
  assert.deepEqual(plain(state(ops).allocations.map(row => row.value)), [0, 1]);
  assert.equal(state(ops).allocations.reduce((sum, row) => sum + row.workMs, 0), 80);
});

test("concurrent tabs retain both branches, require resolution, and replay an old operation without rewinding", () => {
  const initial = timer.startHabitTimer([], "reading", "device", plan(), "2026-10-16T10:00:00Z", "session");
  const left = timer.appendHabitTimerOperation(initial, "session", "device", "pause", { at: "2026-10-16T10:10:00Z", id: "left" });
  const right = timer.appendHabitTimerOperation(initial, "session", "device", "pause", { at: "2026-10-16T10:20:00Z", id: "right" });
  const merged = timer.mergeHabitTimerOperations(left, right);
  assert.equal(timer.habitTimerSessions(merged)[0].heads.length, 2);
  assert.equal(state(merged), null);
  assert.throws(() => timer.appendHabitTimerOperation(merged, "session", "device", "save"), /TIMER_CONFLICT/);
  let resolved = timer.appendHabitTimerOperation(merged, "session", "device", "resolve", { branchId: "left", at: "2026-10-16T10:30:00Z", id: "resolve" });
  assert.equal(timer.habitTimerReading(state(resolved)).workMs, 10 * 60_000);
  resolved = timer.appendHabitTimerOperation(resolved, "session", "device", "resume", { at: "2026-10-16T10:40:00Z", id: "resume" });
  assert.equal(timer.appendHabitTimerOperation(resolved, "session", "device", "pause", { at: "2026-10-16T10:10:00Z", id: "left" }).length, resolved.length);
  assert.equal(state(resolved).status, "running");
  assert.throws(() => timer.appendHabitTimerOperation(resolved, "session", "device", "pause", { at: "2026-10-16T10:39:59Z" }), /TIMER_HISTORY_CONFLICT/);
});

test("one pending session per device, foreign sessions are independent, and immutable IDs are guarded", () => {
  const initial = timer.startHabitTimer([], "reading", "device", plan(), "2026-10-16T10:00:00Z", "session");
  assert.throws(() => timer.startHabitTimer(initial, "other-habit", "device", plan()), /TIMER_ACTIVE/);
  const two = timer.startHabitTimer(initial, "reading", "phone", plan(), "2026-10-16T10:01:00Z", "phone-session");
  assert.equal(timer.habitTimerSessions(two).length, 2);
  assert.throws(() => timer.appendHabitTimerOperation(two, "phone-session", "device", "pause"), /OTHER_DEVICE/);
  assert.throws(() => timer.mergeHabitTimerOperations(initial, [{ ...initial[0], habitId: "other" }]), /ID_CONFLICT/);
  assert.throws(() => timer.habitTimerSessions([{ ...initial[0], id: "broken", action: "pause", parents: ["missing"] }]), /HISTORY_CONFLICT/);
});

function workspaceFixture(kind = "duration") {
  const date = new Date().toISOString().slice(0, 10);
  const habit = habits.defaultHabit(date, "profane"); habit.title = "Reading"; habit.schedule.timezone = "UTC";
  habit.measurement = kind === "binary" ? null : { kind, unit: kind === "duration" ? "min" : "pages", target: 10_000, quickAdd: 1000 };
  return { habit, date, workspace: { ...habits.EMPTY_HABIT_WORKSPACE, habits: [habit] } };
}

test("shared document normalization preserves the Android timer choice through a JSON round trip", () => {
  const { habit, workspace } = workspaceFixture();
  const normalize = value => habits.normalizeHabitWorkspace(plain({ ...workspace, habits: [value] })).habits[0];
  assert.equal(normalize({ ...habit, timerEnabled: false }).timerEnabled, false);
  assert.notEqual(normalize(habit).timerEnabled, false);
  assert.notEqual(normalize({ ...habit, timerEnabled: true }).timerEnabled, false);
  const preferences = { modes: ["pomodoro"], workMinutes: 40, breakMinutes: 8, progress: "time-only" };
  assert.deepEqual(plain(normalize({ ...habit, timerPreferences: preferences }).timerPreferences), preferences);
  assert.throws(() => normalize({ ...habit, timerPreferences: { ...preferences, modes: [] } }), /INVALID_HABIT_TIMER_PREFERENCES/);
});
const command = (action, at, extra = {}) => ({ action, owner: "device", at, id: action, sessionId: "session", ...extra });

test("disabled and removed timer modes cannot start or resume; time-only never awards habit progress", () => {
  const { habit, date, workspace } = workspaceFixture();
  const preferences = { modes: ["stopwatch"], workMinutes: 40, breakMinutes: 8, progress: "time-only" };
  let current = { ...workspace, habits: [{ ...habit, timerPreferences: preferences }] };
  assert.throws(() => adapter.applyHabitTimerCommand(current, command("start", `${date}T01:00:00Z`, {habitId: habit.id, mode:"pomodoro"})), /HABIT_TIMER_DISABLED/);
  current = adapter.applyHabitTimerCommand(current, command("start", `${date}T01:00:00Z`, { id:"session",habitId:habit.id }));
  current = adapter.applyHabitTimerCommand(current, command("pause", `${date}T01:05:00Z`));
  for (const changed of [{timerEnabled:false}, {timerPreferences:{...preferences,modes:["pomodoro"]}}]) {
    assert.throws(() => adapter.applyHabitTimerCommand({...current,habits:[{...current.habits[0],...changed}]}, command("resume",`${date}T01:06:00Z`)), /HABIT_TIMER_DISABLED/);
  }
  current = adapter.applyHabitTimerCommand(current, command("finish", `${date}T01:10:00Z`));
  current = adapter.applyHabitTimerCommand(current, command("save", `${date}T01:11:00Z`));
  assert.equal(current.habitMeasurements.length,0); assert.equal(current.habitCompletions.length,0);
  assert.equal(timer.habitTimerReading(timer.habitTimerSessions(current.habitTimers)[0].state).workMs,300_000);
});

test("removing an active timer saves elapsed time once and cannot close another device’s session", () => {
  const {habit,date,workspace}=workspaceFixture();
  const started=adapter.applyHabitTimerCommand(workspace,command("start",`${date}T01:00:00Z`,{id:"session",habitId:habit.id}));
  const disabled={...started,habits:[{...habit,timerEnabled:false}]};
  assert.equal(adapter.finishDisabledHabitTimers(disabled,"phone",`${date}T01:05:00Z`),disabled);
  const saved=adapter.finishDisabledHabitTimers(disabled,"device",`${date}T01:05:00Z`);
  assert.equal(timer.habitTimerSessions(saved.habitTimers)[0].state.status,"saved");
  assert.equal(timer.habitTimerReading(timer.habitTimerSessions(saved.habitTimers)[0].state).workMs,300_000);
  assert.equal(saved.habitMeasurements.length,0);assert.equal(saved.habitCompletions.length,0);
  assert.equal(adapter.finishDisabledHabitTimers(saved,"device",`${date}T01:10:00Z`),saved);
});

test("failed save leaves a finished session; repeated save and sync give one entry and one XP ceiling", () => {
  const { habit, date, workspace } = workspaceFixture();
  let current = adapter.applyHabitTimerCommand(workspace, command("start", `${date}T01:00:00Z`, { id: "session", habitId: habit.id }));
  current = adapter.applyHabitTimerCommand(current, command("finish", `${date}T01:15:00Z`));
  const finishedBytes = JSON.stringify(current);
  const edited = { ...current, habits: [{ ...habit, active: false }] };
  assert.throws(() => adapter.applyHabitTimerCommand(edited, command("save", `${date}T01:16:00Z`)), /GOAL_CHANGED/);
  assert.equal(JSON.stringify(current), finishedBytes);
  const saved = adapter.applyHabitTimerCommand(current, command("save", `${date}T01:16:00Z`));
  assert.equal(saved.habitMeasurements.length, 1); assert.equal(saved.habitMeasurements[0].value, 15_000);
  assert.equal(saved.habitCompletions[0].xpAwarded, 10);
  assert.equal(adapter.applyHabitTimerCommand(saved, command("save", `${date}T01:20:00Z`)), saved);
  const clock = { version: 2, updatedAt: `${date}T01:16:00Z`, deviceId: "device" };
  const merged = sync.mergeWorkspaceDocuments({ left: saved, right: plain(saved), leftFallback: clock, rightFallback: clock });
  const restored = habits.normalizeHabitWorkspace(merged.document);
  assert.equal(restored.habitMeasurements.length, 1); assert.equal(restored.habitCompletions[0].xpAwarded, 10);
  assert.equal(timer.habitTimerSessions(restored.habitTimers)[0].state.status, "saved");
});

test("quantity and binary habits retain timer duration without substituting minutes for their unit", () => {
  for (const kind of ["quantity", "binary"]) {
    const { habit, date, workspace } = workspaceFixture(kind);
    let current = adapter.applyHabitTimerCommand(workspace, command("start", `${date}T01:00:00Z`, { id: "session", habitId: habit.id }));
    current = adapter.applyHabitTimerCommand(current, command("finish", `${date}T01:15:00Z`));
    current = adapter.applyHabitTimerCommand(current, command("save", `${date}T01:16:00Z`));
    assert.equal(current.habitMeasurements.length, 0); assert.equal(current.habitCompletions.length, 0);
    assert.equal(timer.habitTimerSessions(current.habitTimers)[0].state.allocations[0].value, 15_000);
  }
});

test("a stale tab cannot erase a durable timer receipt, while explicit reset cannot resurrect it", () => {
  const { habit, date, workspace } = workspaceFixture();
  let latest = adapter.applyHabitTimerCommand(workspace, command("start", `${date}T01:00:00Z`, { id: "session", habitId: habit.id }));
  latest = adapter.applyHabitTimerCommand(latest, command("finish", `${date}T01:15:00Z`));
  latest = adapter.applyHabitTimerCommand(latest, command("save", `${date}T01:16:00Z`));
  const rows = new Map(), sharedStorage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
  storage.writeProtectedWorkspace(sharedStorage, "account", latest);
  storage.writeProtectedWorkspace(sharedStorage, "account", { ...workspace, habitSettings: { ...workspace.habitSettings, reportRange: "week" } });
  const survived = habits.normalizeHabitWorkspace(JSON.parse(rows.get("account")));
  assert.equal(timer.habitTimerSessions(survived.habitTimers)[0].state.status, "saved");
  assert.equal(survived.habitMeasurements.length, 1); assert.equal(survived.habitCompletions[0].xpAwarded, 10);
  const cleared = reset.resetHabitWorkspace(survived);
  storage.writeProtectedWorkspace(sharedStorage, "account", cleared);
  assert.throws(() => storage.writeProtectedWorkspace(sharedStorage, "account", survived), /TIMER_RESET/);
  const replayed = habits.normalizeHabitWorkspace({ ...cleared, habitTimers: survived.habitTimers, habitMeasurements: survived.habitMeasurements });
  assert.equal(replayed.habitTimers.length, 0); assert.equal(replayed.habitMeasurements.length, 0);
  assert.equal(replayed.userProgress.lifetimeXp, 0);
});

test("web and native share the same immutable timer vectors", () => {
  const vectors = JSON.parse(readFileSync(resolve(root, "android/app/src/test/resources/habit-timers-web.json"), "utf8"));
  for (const vector of vectors.cases) {
    const operations = timer.mergeHabitTimerOperations(vector.operations), current = state(operations);
    const reading = timer.habitTimerReading(current);
    assert.equal(current.status, vector.expected.status); assert.equal(reading.workMs, vector.expected.workMs);
    assert.equal(reading.breakMs, vector.expected.breakMs);
    assert.deepEqual(plain(current.allocations.map(({ date, workMs, value }) => ({ date, workMs, value }))), vector.expected.days);
    assert.deepEqual(plain(operations), vector.operations);
  }
});

test("changing the goal while a timer runs requires an explicit time-only save", () => {
  const { habit, date, workspace } = workspaceFixture();
  const started = adapter.applyHabitTimerCommand(workspace, command("start", `${date}T01:00:00Z`, { id: "session", habitId: habit.id }));
  const changed = { ...started, habits: [{ ...habit, active: false }] };
  const finished = adapter.applyHabitTimerCommand(changed, command("finish", `${date}T01:15:00Z`));
  assert.equal(state(finished.habitTimers).allocations[0].reason, "rule-conflict");
  assert.throws(() => adapter.applyHabitTimerCommand(finished, command("save", `${date}T01:16:00Z`)), /GOAL_CHANGED/);
  const saved = adapter.applyHabitTimerCommand(finished, command("save", `${date}T01:16:00Z`, { timeOnly: true }));
  assert.equal(saved.habitMeasurements.length, 0); assert.equal(state(saved.habitTimers).status, "saved");
});

test("midnight splits respect all four calendar contexts and historical parts never earn retroactive XP", () => {
  const periods = load(resolve(root, "app/habit-period-goal.ts"));
  const dates = load(resolve(root, "app/calendar-context.ts"));
  for (const [calendar, yearStart, sample] of [["profane", "january", "2026-01-31"], ["profane", "march", "2026-02-28"],
    ["sacred", "march", "2026-03-19"], ["lunar", "march", "2026-05-15"]]) {
    const context = { version: 2, timeZone: "UTC", gregorianYearStart: yearStart };
    const goal = { version: 1, period: "month", metric: "sum", target: 20_000, calendar, context };
    const boundary = periods.habitGoalPeriod(goal, sample).end, previous = dates.addCivilDays(boundary, -1);
    const habit = { ...habits.defaultHabit(previous, "profane"), id: "reading", title: "Reading", periodGoal: goal,
      measurement: { kind: "duration", unit: "min", target: 10_000, quickAdd: 1000 } };
    habit.schedule.timezone = "UTC";
    let current = { ...habits.EMPTY_HABIT_WORKSPACE, habits: [habit] };
    const now = new Date(`${boundary}T01:00:00Z`);
    current = adapter.applyHabitTimerCommand(current, command("start", `${previous}T23:50:00Z`, { id: "session", habitId: habit.id }), now);
    current = adapter.applyHabitTimerCommand(current, command("finish", `${boundary}T00:10:00Z`), now);
    current = adapter.applyHabitTimerCommand(current, command("save", `${boundary}T00:11:00Z`), now);
    assert.deepEqual(plain(current.habitMeasurements.map(row => [row.date, row.value, row.historical])), [[previous, 10_000, true], [boundary, 10_000, false]]);
    assert.equal(current.habitCompletions.find(row => row.date === previous).xpAwarded, 0);
    assert.notEqual(periods.habitGoalPeriod(goal, previous).start, periods.habitGoalPeriod(goal, boundary).start);
    assert.equal(state(current.habitTimers).root.plan.calendarMode, calendar);
    assert.equal(state(current.habitTimers).root.plan.context.gregorianYearStart, yearStart);
  }
});

test("the native account patch returns timer measurements to web normalization and a merge without duplication", () => {
  const returned = JSON.parse(readFileSync(resolve(root, "android/app/src/test/resources/habit-timers-native.json"), "utf8"));
  const imported = habits.normalizeHabitWorkspace(returned);
  assert.equal(imported.habitTimers.length, 3); assert.equal(imported.habitMeasurements.length, 2);
  assert.equal(state(imported.habitTimers).status, "saved");
  assert.equal(imported.habitCompletions.find(row => row.date === "2026-10-16").xpAwarded, 0);
  assert.equal(imported.habitCompletions.find(row => row.date === "2026-10-17").xpAwarded, 10);
  const fallback = { version: 2, updatedAt: "2026-10-17T01:00:00Z", deviceId: "native" };
  const merged = sync.mergeWorkspaceDocuments({ left: returned, right: plain(returned), leftFallback: fallback, rightFallback: fallback });
  const restored = habits.normalizeHabitWorkspace(merged.document);
  assert.equal(restored.habitMeasurements.length, 2); assert.deepEqual(plain(restored.habitTimers), plain(imported.habitTimers));
});
