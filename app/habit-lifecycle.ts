import { isCivilDate, momentCivilDate } from "./calendar-context.ts";
import { habitAutomaticPoints } from "./habit-auto-delete.ts";

export type HabitLifecycleStatus = "active" | "paused" | "archived" | "deleted";
export type HabitLifecycleAction = "pause" | "resume" | "archive" | "delete" | "restore" | "resolve" | "observe";
export type HabitLifecycleEvent = {
  id: string; habitId: string; at: string; date: string;
  action: HabitLifecycleAction; status: HabitLifecycleStatus;
  replaces: string[]; baselineActive: boolean; selectedId?: string;
  automaticPoints?: "keep" | "remove";
};
export type HabitLifecycleCommand = {
  id: string; habitId: string; at: string; action: HabitLifecycleAction;
  heads: string[]; selectedId?: string; automaticPoints?: "keep" | "remove";
};
type LifecycleHabit = {
  id: string; active: boolean; schedule: { timezone: string };
  lifecycleHistory?: HabitLifecycleEvent[];
};
const statuses = new Set(["active", "paused", "archived", "deleted"]);
const actions = new Set(["pause", "resume", "archive", "delete", "restore", "resolve", "observe"]);
const transitions: Record<HabitLifecycleStatus, Partial<Record<HabitLifecycleAction, HabitLifecycleStatus>>> = {
  active: { pause: "paused", archive: "archived", delete: "deleted", observe: "active" },
  paused: { resume: "active", archive: "archived", delete: "deleted", observe: "paused" },
  archived: { restore: "paused", delete: "deleted", observe: "archived" }, deleted: { restore: "paused", observe: "deleted" },
};
const compatibleObservations = (rows: HabitLifecycleEvent[]) => rows.length > 0 && rows.every(row => row.action === "observe" && row.status === rows[0].status);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
const canonical = (row: HabitLifecycleEvent) => JSON.stringify({ ...row, replaces: sorted(row.replaces) });
const fail = (): never => { throw new RangeError("INVALID_HABIT_LIFECYCLE"); };
const utcInstant = (value: unknown) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : "";

/** Status transitions are immutable; a stale snapshot cannot erase a pause, archive or deletion. */
export function mergeHabitLifecycleEvents(...sources: unknown[]): HabitLifecycleEvent[] {
  const events = new Map<string, HabitLifecycleEvent>();
  for (const source of sources) {
    if (source == null) continue;
    if (!Array.isArray(source)) return fail();
    for (const input of source) {
      if (!input || typeof input !== "object") return fail();
      const row = input as HabitLifecycleEvent;
      if (row.automaticPoints !== undefined && (row.action !== "delete" || !["keep", "remove"].includes(row.automaticPoints))) return fail();
      if (!identifier(row.id) || !identifier(row.habitId) || !statuses.has(row.status) || !actions.has(row.action)
        || !utcInstant(row.at) || typeof row.date !== "string" || !isCivilDate(row.date)
        || typeof row.baselineActive !== "boolean" || !Array.isArray(row.replaces) || row.replaces.length > 64
        || row.replaces.some(id => !identifier(id) || id === row.id)
        || (row.action === "resolve" ? !identifier(row.selectedId) : row.selectedId !== undefined)) return fail();
      const value: HabitLifecycleEvent = { id: row.id, habitId: row.habitId, at: utcInstant(row.at), date: row.date,
        action: row.action, status: row.status, replaces: sorted(row.replaces), baselineActive: row.baselineActive,
        ...(row.selectedId ? { selectedId: row.selectedId } : {}),
        ...(habitAutomaticPoints(row) ? { automaticPoints: habitAutomaticPoints(row) } : {}) };
      const previous = events.get(value.id);
      if (previous && canonical(previous) !== canonical(value)) throw new RangeError("HABIT_LIFECYCLE_ID_CONFLICT");
      events.set(value.id, value);
    }
  }
  const rows = [...events.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (row: HabitLifecycleEvent) => {
    if (visiting.has(row.id)) return fail();
    if (visited.has(row.id)) return;
    visiting.add(row.id);
    for (const id of row.replaces) {
      const parent = events.get(id);
      if (!parent || parent.habitId !== row.habitId || parent.at > row.at || parent.date > row.date) return fail();
      visit(parent);
    }
    if (row.selectedId && (!row.replaces.includes(row.selectedId) || events.get(row.selectedId)?.status !== row.status)) return fail();
    if (row.action === "resolve") {
      if (row.replaces.length < 2) return fail();
      const frontier = new Set(row.replaces);
      for (const parentId of row.replaces) {
        const pending = [...events.get(parentId)!.replaces], seen = new Set<string>();
        while (pending.length) {
          const ancestor = pending.pop()!;
          if (frontier.has(ancestor)) return fail();
          if (seen.has(ancestor)) continue;
          seen.add(ancestor); pending.push(...events.get(ancestor)!.replaces);
        }
      }
    } else {
      if (row.replaces.length > 1 && !compatibleObservations(row.replaces.map(id => events.get(id)!))) return fail();
      const previous = row.replaces.length ? events.get(row.replaces[0])!.status : row.baselineActive ? "active" : "paused";
      if (transitions[previous][row.action] !== row.status) return fail();
    }
    visiting.delete(row.id); visited.add(row.id);
  };
  rows.forEach(visit);
  return rows;
}

/** Past availability follows saved transition dates, rather than the current active flag. */
export function habitLifecycleState(habit: Pick<LifecycleHabit, "id" | "active" | "lifecycleHistory">, date = "9999-12-31") {
  const all = (habit.lifecycleHistory ?? []).filter(row => row.habitId === habit.id);
  const rows = all.filter(row => row.date <= date);
  const replaced = new Set(rows.flatMap(row => row.replaces));
  const heads = rows.filter(row => !replaced.has(row.id));
  const roots = all.filter(row => row.replaces.length === 0);
  const baselineUncertain = new Set(roots.map(row => row.baselineActive)).size > 1;
  const baselineActive = roots[0]?.baselineActive ?? habit.active;
  const compatible = compatibleObservations(heads), conflict = heads.length > 1 && !compatible;
  const status: HabitLifecycleStatus = heads.length === 1 || compatible ? heads[0].status : conflict
    ? heads.some(row => row.status === "deleted") ? "deleted" : heads.some(row => row.status === "archived") ? "archived" : "paused"
    : !baselineUncertain && baselineActive ? "active" : "paused";
  return { rows, heads, status, conflict, baselineActive, unknown: heads.length === 0 && baselineUncertain };
}

export function projectHabitLifecycle<T extends LifecycleHabit>(habit: T): T {
  const lifecycleHistory = mergeHabitLifecycleEvents(habit.lifecycleHistory);
  if (!lifecycleHistory.length) return habit;
  if (lifecycleHistory.some(row => row.habitId !== habit.id)) return fail();
  const state = habitLifecycleState({ ...habit, lifecycleHistory });
  return { ...habit, active: state.status === "active" && !state.conflict, lifecycleHistory };
}

/** Restore intentionally returns to pause; a separate Resume expresses consent to scheduling again. */
export function applyHabitLifecycleCommand<T extends LifecycleHabit>(habit: T, command: HabitLifecycleCommand): T {
  if (command.automaticPoints !== undefined && (command.action !== "delete" || !["keep", "remove"].includes(command.automaticPoints))) return fail();
  if (habit.id !== command.habitId || !identifier(command.id) || !Array.isArray(command.heads)
    || command.heads.some(id => !identifier(id)) || !actions.has(command.action)
    || !utcInstant(command.at)) return fail();
  const journal = mergeHabitLifecycleEvents(habit.lifecycleHistory);
  const at = utcInstant(command.at);
  const replay = journal.find(row => row.id === command.id);
  if (replay) {
    if (replay.at !== at || replay.habitId !== command.habitId || replay.action !== command.action
      || replay.selectedId !== command.selectedId || replay.automaticPoints !== habitAutomaticPoints(command)
      || JSON.stringify(replay.replaces) !== JSON.stringify(sorted(command.heads)))
      throw new RangeError("HABIT_LIFECYCLE_ID_CONFLICT");
    return habit;
  }
  const state = habitLifecycleState({ ...habit, lifecycleHistory: journal });
  if (JSON.stringify(sorted(state.heads.map(row => row.id))) !== JSON.stringify(sorted(command.heads)))
    throw new RangeError("HABIT_LIFECYCLE_EDIT_CONFLICT");
  const selected = command.action === "resolve" ? state.heads.find(row => row.id === command.selectedId) : null;
  const status = command.action === "resolve" ? selected?.status : state.conflict ? undefined : transitions[state.status][command.action];
  if (!status || command.action === "resolve" && !state.conflict || command.action !== "resolve" && command.selectedId !== undefined)
    throw new RangeError("HABIT_LIFECYCLE_TRANSITION_UNAVAILABLE");
  const date = momentCivilDate(new Date(at), habit.schedule.timezone);
  if (state.heads.some(row => row.at > at || row.date > date)) throw new RangeError("HABIT_LIFECYCLE_CLOCK_CONFLICT");
  const event: HabitLifecycleEvent = { id: command.id, habitId: habit.id, at, date, action: command.action,
    status, replaces: sorted(command.heads), baselineActive: state.baselineActive,
    ...(selected ? { selectedId: selected.id } : {}),
    ...(habitAutomaticPoints(command) ? { automaticPoints: habitAutomaticPoints(command) } : {}) };
  return projectHabitLifecycle({ ...habit, lifecycleHistory: [...journal, event] });
}
