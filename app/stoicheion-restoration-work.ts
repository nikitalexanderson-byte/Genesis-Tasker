import type { Habit, HabitCompletion, HabitWorkspace } from "./habits";
import { addCivilDays, isCivilDate } from "./calendar-context";
import { habitLifecycleState } from "./habit-lifecycle";
import { habitPracticeProgress } from "./habit-practice-goal";
import { normalizeRestorationSnapshot, restorationCompletionDates, type RestorationSnapshot } from "./stoicheion-restoration-state";
import { markTrackerEntityChanged, type TrackerEntity } from "./tracker-core";

/** A separate encrypted workspace record: a practice does not have to be a habit. */
export type RestorationWork = TrackerEntity & {
  snapshot: RestorationSnapshot; linkedHabitId: string | null;
  completionDates: string[]; completionEntries: HabitCompletion[];
  requiredCompletions: number; deadline: string; archivedAt: string | null;
};
export type RestorationWorkspace = HabitWorkspace & { stoicheionWorks?: RestorationWork[]; stoicheionRemovedWorks?: TrackerEntity[] };
export type RestorationDocument = { version: 1; works: RestorationWork[]; removed: TrackerEntity[] };
export function validateRestorationDocument(input: unknown): RestorationDocument {
  if (!input || typeof input !== "object" || (input as RestorationDocument).version !== 1) throw new RangeError("RESTORATION_WORK_INVALID");
  const value = input as RestorationDocument;
  if (!Array.isArray(value.works) || !Array.isArray(value.removed)) throw new RangeError("RESTORATION_WORK_INVALID");
  const removed = normalizeRemovedRestorationWorks(value.removed);
  const deleted = new Set(removed.map(row => row.id));
  return { version: 1, works: normalizeRestorationWorks(value.works).filter(row => !deleted.has(row.id)), removed };
}
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
export const restorationExpired = (sourceDate: string, today: string) => today > addCivilDays(sourceDate, 1);
export const restorationWorkId = (snapshot: RestorationSnapshot, habitId: string | null) => habitId ? `restoration-habit:${habitId}` : `restoration-work:${snapshot.cycleId}`;

export function normalizeRemovedRestorationWorks(input: unknown): TrackerEntity[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new RangeError("RESTORATION_WORK_INVALID");
  const ids = new Set<string>();
  return input.map(row => {
    if (!row || typeof row.id !== "string" || !/^restoration-(?:habit|work):.{1,200}$/.test(row.id) || ids.has(row.id)
      || !instant(row.createdAt) || !instant(row.updatedAt) || !Number.isSafeInteger(row.version) || row.version < 1
      || !["local", "pending", "synced"].includes(row.syncState)) throw new RangeError("RESTORATION_WORK_INVALID");
    ids.add(row.id);
    return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version, syncState: row.syncState };
  });
}

/** Fail closed so a malformed archive is never silently replaced by an empty list. */
export function normalizeRestorationWorks(input: unknown): RestorationWork[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new RangeError("RESTORATION_WORK_INVALID");
  const ids = new Set<string>();
  return input.map(row => {
    if (!row || typeof row !== "object") throw new RangeError("RESTORATION_WORK_INVALID");
    const snapshot = normalizeRestorationSnapshot(row.snapshot);
    if (!snapshot || typeof row.id !== "string" || ids.has(row.id) || row.id !== restorationWorkId(snapshot, row.linkedHabitId)
      || !(row.linkedHabitId === null || typeof row.linkedHabitId === "string" && row.linkedHabitId.length > 0)
      || !instant(row.createdAt) || !instant(row.updatedAt) || !Number.isSafeInteger(row.version) || row.version < 1
      || !["local", "pending", "synced"].includes(row.syncState)
      || !Number.isSafeInteger(row.requiredCompletions) || row.requiredCompletions < 1 || row.requiredCompletions > 366
      || !isCivilDate(row.deadline) || row.deadline < snapshot.startedDate
      || !(row.archivedAt === null || instant(row.archivedAt))
      || !Array.isArray(row.completionDates) || row.completionDates.length > 366
      || row.completionDates.some((date: unknown) => typeof date !== "string" || !isCivilDate(date) || date < snapshot.startedDate || date > row.deadline)
      || !Array.isArray(row.completionEntries) || row.completionEntries.some((entry: HabitCompletion) => !entry || entry.habitId !== row.linkedHabitId
        || !isCivilDate(entry.date) || !instant(entry.updatedAt) || typeof entry.completed !== "boolean")) throw new RangeError("RESTORATION_WORK_INVALID");
    ids.add(row.id);
    const completionDates = [...new Set<string>(row.completionDates)].sort();
    if (row.archivedAt && (completionDates.length < row.requiredCompletions || !snapshot.reflection)) throw new RangeError("RESTORATION_WORK_INVALID");
    return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version, syncState: row.syncState,
      snapshot, linkedHabitId: row.linkedHabitId, completionDates, completionEntries: structuredClone(row.completionEntries),
      requiredCompletions: row.requiredCompletions, deadline: row.deadline, archivedAt: row.archivedAt };
  });
}

export function workFromSnapshot(snapshot: RestorationSnapshot, habitId: string | null): RestorationWork {
  return { id: restorationWorkId(snapshot, habitId), createdAt: snapshot.startedAt, updatedAt: snapshot.startedAt, version: 1, syncState: "pending",
    snapshot, linkedHabitId: habitId, completionDates: [], completionEntries: [], requiredCompletions: 1,
    deadline: habitId ? addCivilDays(snapshot.sourceDate, 1) : addCivilDays(snapshot.startedDate, 9), archivedAt: null };
}

/** Legacy linked cycles remain visible; sync tombstones prevent a removed cycle reappearing. */
export function restorationWorks(workspace: RestorationWorkspace, today: string): RestorationWork[] {
  const rows = [...(workspace.stoicheionWorks ?? [])];
  const removed = new Set((workspace.stoicheionRemovedWorks ?? []).map(row => row.id));
  for (const habit of workspace.habits.filter(row => row.stoicheionRestoration && habitLifecycleState(row).status !== "deleted")) {
    const id = restorationWorkId(habit.stoicheionRestoration!, habit.id);
    if (removed.has(id) || rows.some(row => row.id === id)) continue;
    rows.push(workFromSnapshot(habit.stoicheionRestoration!, habit.id));
  }
  return rows.filter(row => !removed.has(row.id)).map(row => projectRestorationWork(row, workspace, today));
}

export function projectRestorationWork(row: RestorationWork, workspace: RestorationWorkspace, today: string): RestorationWork {
  if (row.archivedAt || !row.linkedHabitId) return row;
  const habit = workspace.habits.find(item => item.id === row.linkedHabitId);
  if (!habit) return row;
  const snapshot = habit.stoicheionRestoration?.cycleId === row.snapshot.cycleId ? habit.stoicheionRestoration : row.snapshot;
  const finite = habitPracticeProgress(habit, workspace.habitCompletions, today);
  return { ...row, snapshot, requiredCompletions: finite?.goal.requiredCompletions ?? 10,
    deadline: finite?.deadline ?? row.deadline,
    completionDates: finite?.dates ?? restorationCompletionDates(snapshot, habit.id, workspace.habitCompletions, today),
    completionEntries: workspace.habitCompletions.filter(entry => entry.habitId === habit.id && entry.date >= snapshot.startedDate
      && Date.parse(entry.updatedAt) >= Date.parse(snapshot.startedAt)) };
}

export function saveRestorationWork(workspace: RestorationWorkspace, work: RestorationWork): RestorationWorkspace {
  return { ...workspace, stoicheionWorks: [...(workspace.stoicheionWorks ?? []).filter(row => row.id !== work.id), markTrackerEntityChanged(work)] };
}

export function completeRestorationWork(workspace: RestorationWorkspace, work: RestorationWork, today: string): RestorationWorkspace {
  if (work.archivedAt || work.linkedHabitId || !isCivilDate(today) || today < work.snapshot.startedDate || today > work.deadline) throw new RangeError("RESTORATION_WORK_CLOSED");
  return saveRestorationWork(workspace, { ...work, completionDates: [...new Set([...work.completionDates, today])].sort().slice(0, work.requiredCompletions) });
}

/** Save the final reflection and freeze the complete record in the server-synced archive. */
export function reflectRestorationWork(workspace: RestorationWorkspace, input: RestorationWork, reflection: string, today: string, at = new Date().toISOString()): RestorationWorkspace {
  const work = projectRestorationWork(input, workspace, today);
  const note = reflection.trim();
  if (!note || note.length > 2000 || !instant(at) || work.archivedAt) throw new RangeError("RESTORATION_REFLECTION_INVALID");
  const updated = { ...work, snapshot: { ...work.snapshot, reflection: note },
    archivedAt: work.completionDates.length >= work.requiredCompletions ? at : null };
  const next = saveRestorationWork(workspace, updated);
  return { ...next, habits: next.habits.map(habit => habit.id === work.linkedHabitId && habit.stoicheionRestoration?.cycleId === work.snapshot.cycleId
    ? markTrackerEntityChanged({ ...habit, stoicheionRestoration: updated.snapshot }) : habit) };
}

/** Only expired unfinished work can be deleted. Linked habits and their history are untouched. */
export function deleteRestorationWork(workspace: RestorationWorkspace, work: RestorationWork, today: string): RestorationWorkspace {
  if (work.archivedAt || today <= work.deadline || work.completionDates.length >= work.requiredCompletions) throw new RangeError("RESTORATION_WORK_NOT_EXPIRED");
  return { ...workspace, stoicheionWorks: (workspace.stoicheionWorks ?? []).filter(row => row.id !== work.id),
    stoicheionRemovedWorks: [...(workspace.stoicheionRemovedWorks ?? []).filter(row => row.id !== work.id),
      { id: work.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, syncState: "pending" }] };
}

/** Permanent archive removal retains only synchronization tombstones. Linked
 * habits and their independent statistics are not archive records. */
export function deleteArchivedRestorationWorks(workspace: RestorationWorkspace, works: readonly RestorationWork[], at = new Date().toISOString()): RestorationWorkspace {
  if (!works.length || works.some(work => !work.archivedAt) || !instant(at)) throw new RangeError("RESTORATION_WORK_NOT_ARCHIVED");
  const ids = new Set(works.map(work => work.id));
  return { ...workspace, stoicheionWorks: (workspace.stoicheionWorks ?? []).filter(work => !ids.has(work.id)),
    stoicheionRemovedWorks: [...(workspace.stoicheionRemovedWorks ?? []).filter(row => !ids.has(row.id)),
      ...works.map(work => ({ id: work.id, createdAt: work.createdAt, updatedAt: at, version: work.version + 1, syncState: "pending" as const }))] };
}

export const linkedRestorationHabit = (work: RestorationWork, workspace: RestorationWorkspace): Habit | undefined => workspace.habits.find(habit => habit.id === work.linkedHabitId);
