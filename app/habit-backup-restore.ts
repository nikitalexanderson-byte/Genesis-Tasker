import { canonicalHabitBackup, parseHabitBackup, type HabitBackup } from "./habit-backup.ts";
import { habitEconomyHistory, habitHistoryState, type HabitHistoryEdit } from "./habit-history.ts";
import { applyHabitLifecycleCommand, habitLifecycleState } from "./habit-lifecycle.ts";
import { habitRuleForDate } from "./habit-measurement.ts";
import { appendHabitTimerOperation, habitTimerEpoch, habitTimerSessions, habitWorkspaceEpoch } from "./habit-timer.ts";
import { momentCivilDate } from "./calendar-context.ts";
import type { Habit, HabitWorkspace } from "./habits.ts";

export type HabitRestoreChoice = "keep" | "copy";
export type HabitRestorePreview = {
  backup: HabitBackup; fingerprint: string; empty: boolean;
  habits: { id: string; targetId: string; title: string; kind: "new" | "same" | "conflict" | "restored"; records: number;
    currentTitle?: string; currentRecords: number; changes: string[] }[];
};
export type HabitRestoreRequest = { preview: HabitRestorePreview; choices: Record<string, HabitRestoreChoice> };
const clone = <T,>(value: T): T => JSON.parse(canonicalHabitBackup(value)) as T;
const arrays = ["habits", "habitCompletions", "habitMeasurements", "habitTimers", "habitHistory", "dailyGoalRecords", "quests",
  "achievementUnlocks", "rewardTransactions", "streakFreezeTransactions", "hiddenDefaultTemplates"] as const;
const fail = (code: string): never => { throw new RangeError(code); };
const state = (workspace: HabitWorkspace) => Object.fromEntries([...arrays, "trackerSchemaVersion", "habitTimerEpoch", "userProgress", "habitSettings"].map(key => [key, workspace[key as keyof HabitWorkspace]]));
async function fingerprint(workspace: HabitWorkspace) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalHabitBackup(state(workspace))));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
const empty = (workspace: HabitWorkspace) => arrays.filter(key => key !== "hiddenDefaultTemplates").every(key => !workspace[key].length)
  && workspace.userProgress.lifetimeXp === 0 && workspace.userProgress.laurelsBalance === 0 && !habitTimerEpoch(workspace.habitTimerEpoch);
const definition = (habit: Habit) => ({ ...habit, version: 1, syncState: "local", updatedAt: habit.createdAt });

/** Preview is read-only. Existing conflicting habits can be kept or restored into an explicit separate copy. */
export async function previewHabitRestore(workspace: HabitWorkspace, text: string): Promise<HabitRestorePreview> {
  const backup = await parseHabitBackup(text), prefix = `restore:${backup.checksum.slice(0, 32)}`;
  const habits = backup.data.habits.map((habit, index) => {
    const current = workspace.habits.find(row => row.id === habit.id), copyId = `${prefix}:habit:${index}`;
    const restored = workspace.habits.some(row => row.id === copyId)
      || workspace.habitHistory.some(row => row.habitId === habit.id && row.id.startsWith(`${prefix}:`))
      || current?.lifecycleHistory?.some(row => row.id.startsWith(`${prefix}:`));
    const records = backup.data.habitCompletions.filter(row => row.habitId === habit.id).length
      + backup.data.habitMeasurements.filter(row => row.habitId === habit.id).length;
    const sameRecords = ["habitCompletions", "habitMeasurements", "habitHistory"].every(key => {
        const name = key as "habitCompletions" | "habitMeasurements" | "habitHistory";
        return canonicalHabitBackup(workspace[name].filter(row => row.habitId === habit.id))
          === canonicalHabitBackup(backup.data[name].filter(row => row.habitId === habit.id));
      });
    const matching = current && canonicalHabitBackup(definition(current)) === canonicalHabitBackup(definition(habit)) && sameRecords;
    const kind = restored ? "restored" : matching ? "same" : current ? "conflict" : "new";
    const currentRecords = workspace.habitCompletions.filter(row => row.habitId === habit.id).length
      + workspace.habitMeasurements.filter(row => row.habitId === habit.id).length;
    const changes = current ? [
      ...(current.title !== habit.title || current.description !== habit.description ? ["Название и описание"] : []),
      ...(canonicalHabitBackup([current.measurement ?? null, current.periodGoal ?? null, current.schedule, current.ruleHistory ?? []]) !== canonicalHabitBackup([habit.measurement ?? null, habit.periodGoal ?? null, habit.schedule, habit.ruleHistory ?? []]) ? ["Цель и расписание"] : []),
      ...(canonicalHabitBackup(current.lifecycleHistory ?? []) !== canonicalHabitBackup(habit.lifecycleHistory ?? []) || current.active !== habit.active ? ["Состояние привычки"] : []),
      ...(!sameRecords ? ["История выполнения"] : []),
    ] : [];
    return { id: habit.id, targetId: kind === "conflict" ? copyId : habit.id, title: habit.title, kind, records,
      ...(current ? { currentTitle: current.title } : {}), currentRecords, changes } as const;
  });
  return { backup, fingerprint: await fingerprint(workspace), empty: empty(workspace), habits };
}

/** No award function is called here. Clean recovery restores the ledger; a populated workspace imports history without credits. */
export async function applyHabitRestore(workspace: HabitWorkspace, request: HabitRestoreRequest, at = new Date().toISOString()): Promise<HabitWorkspace> {
  const checked = await previewHabitRestore(workspace, JSON.stringify(request.preview.backup));
  if (checked.fingerprint !== request.preview.fingerprint) return fail("HABIT_RESTORE_STALE");
  if (!Number.isFinite(Date.parse(at))) return fail("HABIT_BACKUP_INVALID");
  if (Date.parse(checked.backup.createdAt) > Date.parse(at)) return fail("HABIT_RESTORE_FUTURE");
  const source = checked.backup.data, prefix = `restore:${checked.backup.checksum.slice(0, 32)}`;
  const snapshotAt = checked.backup.createdAt;
  const selected = checked.habits.filter(row => row.kind === "new" || row.kind === "conflict" && request.choices[row.id] === "copy");
  if (checked.habits.some(row => row.kind === "conflict" && !["keep", "copy"].includes(request.choices[row.id]))) return fail("HABIT_RESTORE_CHOICE_REQUIRED");
  if (!selected.length) return workspace;
  const recover = checked.empty, ids = new Map(selected.map(row => [row.id, row.targetId]));
  const epoch = habitTimerEpoch(recover ? source.habitTimerEpoch : workspace.habitTimerEpoch);
  const related = <T extends { habitId: string }>(rows: T[]) => rows.filter(row => ids.has(row.habitId));
  const mapIds = (rows: { id: string }[], name: string) => new Map(rows.map((row, index) => [row.id, recover ? row.id : `${prefix}:${name}:${index}`]));
  const lifeIds = mapIds(source.habits.flatMap(habit => habit.lifecycleHistory ?? []), "lifecycle");
  const historyIds = mapIds(source.habitHistory, "history"), measurementIds = mapIds(source.habitMeasurements, "measurement");
  const timerIds = mapIds(source.habitTimers, "timer"), sessionIds = new Map([...new Set(source.habitTimers.map(row => row.sessionId))].map(id => [id, timerIds.get(id)!]));
  for (const row of source.habitTimers) if (row.action === "save") timerIds.set(row.id, `timer-saved:${sessionIds.get(row.sessionId)!}`);
  const entryIds = new Map([...new Set(source.habitMeasurements.map(row => row.entryId))].map(id => [id, measurementIds.get(id)!]));
  const importedHabits = source.habits.filter(habit => ids.has(habit.id)).map(habit => {
    const index = checked.habits.findIndex(row => row.id === habit.id);
    let imported: Habit = { ...clone(habit), id: ids.get(habit.id)!,
      reminder: { ...habit.reminder, syncToGoogleTasks: false, showInGoogleCalendar: false, googleTaskId: null, googleEventId: null },
      lifecycleHistory: (habit.lifecycleHistory ?? []).map(row => ({ ...clone(row), habitId: ids.get(habit.id)!,
        id: lifeIds.get(row.id)!, replaces: row.replaces.map(id => lifeIds.get(id)!), ...(row.selectedId ? { selectedId: lifeIds.get(row.selectedId)! } : {}) })) };
    if (habitLifecycleState(imported).status === "active") imported = applyHabitLifecycleCommand(imported, {
      id: `${prefix}:pause:${index}`, habitId: imported.id, at: snapshotAt, action: "pause", heads: habitLifecycleState(imported).heads.map(row => row.id) });
    else if (!imported.lifecycleHistory?.length) imported = applyHabitLifecycleCommand(imported, {
      id: `${prefix}:observe:${index}`, habitId: imported.id, at: snapshotAt, action: "observe", heads: [] });
    return imported;
  });
  const habitMap = new Map(importedHabits.map(habit => [habit.id, habit]));
  for (const row of [...related(source.habitMeasurements), ...related(source.habitHistory), ...related(source.habitCompletions)]) {
    const habit = habitMap.get(ids.get(row.habitId)!)!;
    if (row.date > momentCivilDate(new Date(at), habit.schedule.timezone)) return fail("HABIT_RESTORE_FUTURE");
  }
  const rule = (habitId: string, date: string, ruleId: string) => {
    const habit = habitMap.get(ids.get(habitId)!)!;
    return habit.ruleHistory?.some(row => row.id === ruleId) ? ruleId : habitRuleForDate(habit, date).id;
  };
  const measurements = related(source.habitMeasurements).map(row => ({ ...clone(row), id: measurementIds.get(row.id)!,
    habitId: ids.get(row.habitId)!, entryId: entryIds.get(row.entryId)!, ruleId: rule(row.habitId, row.date, row.ruleId),
    replaces: row.replaces.map(id => measurementIds.get(id)!), historical: true,
    source: recover ? row.source : "import" as const }));
  const completions = related(source.habitCompletions).map((row, index) => ({ ...clone(row),
    id: recover ? row.id : `habit-completion:${ids.get(row.habitId)!}:${row.date}`, habitId: ids.get(row.habitId)!,
    xpAwarded: recover ? row.xpAwarded : 0, version: recover ? row.version : Math.max(1, index + 1) }));
  const history: HabitHistoryEdit[] = related(source.habitHistory).map(row => ({ ...clone(row), id: historyIds.get(row.id)!,
    habitId: ids.get(row.habitId)!, epoch, ruleId: rule(row.habitId, row.date, row.ruleId), replaces: row.replaces.map(id => historyIds.get(id)!),
    baseline: recover && row.baseline ? { ...clone(row.baseline), habitId: ids.get(row.habitId)! } : null, source: "import" }));
  const economy = recover ? habitEconomyHistory(source) : null;
  const dayIds = new Map(source.habitCompletions.map((row, index) => [`${row.habitId}:${row.date}`, `${prefix}:day:${index}`]));
  for (const row of completions) {
    const habit = habitMap.get(row.habitId)!, originalId = selected.find(item => item.targetId === row.habitId)!.id;
    if (row.date > momentCivilDate(new Date(at), habit.schedule.timezone)) return fail("HABIT_RESTORE_FUTURE");
    const baseline = economy?.habitCompletions.find(item => item.habitId === originalId && item.date === row.date) ?? null;
    history.push({ id: dayIds.get(`${originalId}:${row.date}`)!, habitId: row.habitId, date: row.date,
      createdAt: snapshotAt, updatedAt: snapshotAt, version: 1, syncState: "local", source: "import", epoch,
      ruleId: habitRuleForDate(habit, row.date).id, replaces: habitHistoryState(history, row.habitId, row.date).heads.map(item => item.id),
      baseline: baseline ? { ...clone(baseline), habitId: row.habitId } : null,
      value: { completed: row.completed, qualityValue: row.qualityValue, note: row.note,
        completedTimes: row.completedTimes ?? [], qualityConfirmedAt: row.qualityConfirmedAt ?? null, ...(row.skippedAt ? { skippedAt: row.skippedAt } : {}) } });
  }
  let timers = related(source.habitTimers).map(row => ({ ...clone(row), id: timerIds.get(row.id)!, sessionId: sessionIds.get(row.sessionId)!,
    habitId: ids.get(row.habitId)!, epoch, parents: row.parents.map(id => timerIds.get(id)!),
    ...(row.plan ? { plan: { ...clone(row.plan), ruleId: rule(row.habitId, momentCivilDate(new Date(row.at), row.plan.timeZone), row.plan.ruleId) } } : {}),
    ...(row.allocations ? { allocations: row.allocations.map(item => ({ ...item, ruleId: rule(row.habitId, item.date, item.ruleId) })) } : {}),
    ...(row.branchId ? { branchId: timerIds.get(row.branchId)! } : {}) }));
  for (const session of habitTimerSessions(timers)) {
    if (!session.state) return fail("HABIT_TIMER_CONFLICT");
    if (session.state.status === "running") timers = appendHabitTimerOperation(timers, session.id, session.root.owner, "pause", {
      id: `${prefix}:timer-pause:${session.id}`, at: checked.backup.createdAt });
  }
  const next: HabitWorkspace = { ...workspace,
    ...(recover ? clone(source) : {}), habits: [...workspace.habits, ...importedHabits],
    habitMeasurements: [...workspace.habitMeasurements, ...measurements], habitCompletions: [...workspace.habitCompletions, ...completions],
    habitHistory: [...workspace.habitHistory, ...history], habitTimers: [...workspace.habitTimers, ...timers] };
  next.habitTimerEpoch = habitWorkspaceEpoch(epoch, next.habitHistory.length > 0, next.habits.some(habit => habit.lifecycleHistory?.length));
  return next;
}
