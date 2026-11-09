import { addCivilDays, isCivilDate, momentCivilDate, resolveCalendarWallTime,
  type CalendarContext } from "./calendar-context.ts";
import type { CalendarMode } from "./calendar-data";

export type HabitTimerPlan = {
  mode: "stopwatch" | "pomodoro";
  workMinutes: number;
  breakMinutes: number;
  timeZone: string;
  calendarMode: CalendarMode;
  context: CalendarContext;
  habitTitle: string;
  ruleId: string;
};
export type HabitTimerAllocation = {
  date: string;
  workMs: number;
  /** Integer thousandths of minutes; fractions carry across civil days. */
  value: number;
  ruleId: string;
  reason: "duration" | "not-duration" | "not-scheduled" | "rule-conflict";
};
export type HabitTimerOperation = {
  epoch: string;
  id: string;
  sessionId: string;
  habitId: string;
  owner: string;
  action: "start" | "pause" | "resume" | "finish" | "resolve" | "save" | "discard";
  parents: string[];
  at: string;
  plan?: HabitTimerPlan;
  allocations?: HabitTimerAllocation[];
  branchId?: string;
  timeOnly?: boolean;
};
type Segment = { start: number; end: number };
export type HabitTimerState = {
  root: HabitTimerOperation;
  head: HabitTimerOperation;
  status: "running" | "paused" | "finished" | "saved" | "discarded";
  segments: Segment[];
  runningSince: number | null;
  finishedAt?: string;
  allocations?: HabitTimerAllocation[];
  timeOnly?: boolean;
};
export type HabitTimerSession = {
  id: string;
  root: HabitTimerOperation;
  heads: HabitTimerState[];
  state: HabitTimerState | null;
};

const actions = ["start", "pause", "resume", "finish", "resolve", "save", "discard"];
const reasons = ["duration", "not-duration", "not-scheduled", "rule-conflict"];
const text = (value: unknown, maximum = 256): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;
const canonical = (value: unknown): string => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value) ?? "null";
const fail = (message = "INVALID_HABIT_TIMER"): never => { throw new RangeError(message); };
const instant = (value: unknown) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fail();
  return new Date(value).toISOString();
};
export function habitTimerEpoch(value: unknown): string {
  if (typeof value === "string" && value.startsWith("lifecycle7:")) value = value.slice(11);
  if (typeof value === "string" && value.startsWith("history6:")) value = value.slice(9);
  if (value == null || value === "") return "";
  if (typeof value !== "string" || !/^\d{12}-[a-zA-Z0-9-]{1,64}$/.test(value)) return fail();
  return value;
}
/** Earlier clients reject this envelope marker instead of erasing an offline history journal. */
export function habitWorkspaceEpoch(value: unknown, hasHistory: boolean, hasLifecycle = false) {
  const lifecycle = hasLifecycle || typeof value === "string" && value.startsWith("lifecycle7:");
  return `${lifecycle ? "lifecycle7:" : hasHistory ? "history6:" : ""}${habitTimerEpoch(value)}`;
}
export function nextHabitTimerEpoch(previous: string) {
  const generation = Number(habitTimerEpoch(previous).slice(0, 12) || 0) + 1;
  if (generation > 999_999_999_999) return fail();
  return `${String(generation).padStart(12, "0")}-${crypto.randomUUID()}`;
}

export function normalizeHabitTimerPlan(input: unknown): HabitTimerPlan {
  if (!input || typeof input !== "object") return fail();
  const plan = input as HabitTimerPlan;
  if (!["stopwatch", "pomodoro"].includes(plan.mode)
    || !Number.isInteger(plan.workMinutes) || plan.workMinutes < 1 || plan.workMinutes > 180
    || !Number.isInteger(plan.breakMinutes) || plan.breakMinutes < 0 || plan.breakMinutes > 120
    || !text(plan.timeZone, 100) || !["profane", "sacred", "lunar"].includes(plan.calendarMode)
    || !plan.context || ![1, 2].includes(plan.context.version)
    || !["january", "march"].includes(plan.context.gregorianYearStart)
    || plan.context.timeZone !== plan.timeZone || !text(plan.habitTitle, 2000) || !text(plan.ruleId)) return fail();
  try { new Intl.DateTimeFormat("en", { timeZone: plan.timeZone }); } catch { return fail(); }
  return { mode: plan.mode, workMinutes: plan.workMinutes, breakMinutes: plan.breakMinutes,
    timeZone: plan.timeZone, calendarMode: plan.calendarMode,
    context: { version: plan.context.version, timeZone: plan.timeZone, gregorianYearStart: plan.context.gregorianYearStart },
    habitTitle: plan.habitTitle, ruleId: plan.ruleId };
}

/** Immutable operations merge by ID. A partial entity pair need not include its causal parents. */
export function mergeHabitTimerOperations(...sources: unknown[]): HabitTimerOperation[] {
  const operations = new Map<string, HabitTimerOperation>();
  for (const source of sources) {
    if (source == null) continue;
    if (!Array.isArray(source)) return fail();
    for (const input of source) {
      if (!input || typeof input !== "object") return fail();
      const op = input as HabitTimerOperation;
      if (!text(op.id) || !text(op.sessionId) || !text(op.habitId) || !text(op.owner, 100)
        || !actions.includes(op.action) || !Array.isArray(op.parents) || op.parents.length > 64
        || op.parents.some(parent => !text(parent) || parent === op.id)
        || new Set(op.parents).size !== op.parents.length) return fail();
      const normalized: HabitTimerOperation = { epoch: habitTimerEpoch(op.epoch), id: op.id, sessionId: op.sessionId, habitId: op.habitId,
        owner: op.owner, action: op.action, parents: [...op.parents].sort(), at: instant(op.at) };
      if (op.action === "start") {
        if (op.id !== op.sessionId || op.parents.length) return fail();
        normalized.plan = normalizeHabitTimerPlan(op.plan);
      } else if (op.action === "resolve") {
        if (op.parents.length < 2 || !text(op.branchId) || !op.parents.includes(op.branchId)) return fail();
        normalized.branchId = op.branchId;
      } else if (op.parents.length !== 1) return fail();
      if (op.action === "finish") {
        if (!Array.isArray(op.allocations) || op.allocations.length > 3700) return fail();
        normalized.allocations = op.allocations.map(row => {
          if (!row || !isCivilDate(row.date) || !Number.isSafeInteger(row.workMs) || row.workMs <= 0
            || !Number.isSafeInteger(row.value) || row.value < 0 || !text(row.ruleId) || !reasons.includes(row.reason)) return fail();
          return { date: row.date, workMs: row.workMs, value: row.value, ruleId: row.ruleId, reason: row.reason };
        });
      }
      if (op.action === "save" && op.timeOnly !== undefined) {
        if (typeof op.timeOnly !== "boolean") return fail();
        normalized.timeOnly = op.timeOnly;
      }
      const previous = operations.get(op.id);
      if (previous && canonical(previous) !== canonical(normalized)) return fail("HABIT_TIMER_ID_CONFLICT");
      operations.set(op.id, normalized);
    }
  }
  return [...operations.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export function habitTimerWorkPrefix(activeMs: number, plan: HabitTimerPlan) {
  if (!Number.isSafeInteger(activeMs) || activeMs < 0) return fail("HABIT_TIMER_CLOCK_CHANGED");
  if (plan.mode === "stopwatch") return activeMs;
  const work = plan.workMinutes * 60_000, cycle = work + plan.breakMinutes * 60_000;
  return Math.floor(activeMs / cycle) * work + Math.min(activeMs % cycle, work);
}

const closeSegment = (state: HabitTimerState, end: number): Segment[] => {
  if (state.runningSince === null) return state.segments;
  if (end < state.runningSince) return fail("HABIT_TIMER_CLOCK_CHANGED");
  return end === state.runningSince ? state.segments : [...state.segments, { start: state.runningSince, end }];
};

export function habitTimerReading(state: HabitTimerState, now = Date.now()) {
  const segments = closeSegment(state, now);
  const activeMs = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const plan = state.root.plan!;
  const workMs = habitTimerWorkPrefix(activeMs, plan);
  const cycleMs = (plan.workMinutes + plan.breakMinutes) * 60_000;
  const cyclePosition = activeMs % cycleMs;
  const onBreak = plan.mode === "pomodoro" && cyclePosition >= plan.workMinutes * 60_000;
  return { activeMs, workMs, breakMs: activeMs - workMs, onBreak,
    phaseRemainingMs: plan.mode === "stopwatch" ? 0 :
      (onBreak ? cycleMs : plan.workMinutes * 60_000) - cyclePosition };
}

/** Split elapsed UTC segments at local midnight, with O(days), not O(Pomodoro cycles), work. */
export function habitTimerDayAllocations(state: HabitTimerState, end: number) {
  const plan = state.root.plan!;
  const totals = new Map<string, number>();
  let elapsed = 0, days = 0;
  for (const segment of closeSegment(state, end)) {
    let cursor = segment.start;
    while (cursor < segment.end) {
      if (++days > 100_000 || totals.size > 3700) return fail("HABIT_TIMER_RANGE_TOO_LARGE");
      const date = momentCivilDate(new Date(cursor), plan.timeZone);
      const boundary = resolveCalendarWallTime(addCivilDays(date, 1), "00:00", plan.timeZone).instant.getTime();
      const until = Math.min(segment.end, boundary);
      if (until <= cursor) return fail("HABIT_TIMER_CLOCK_CHANGED");
      const workMs = habitTimerWorkPrefix(elapsed + until - segment.start, plan)
        - habitTimerWorkPrefix(elapsed + cursor - segment.start, plan);
      if (workMs) totals.set(date, (totals.get(date) ?? 0) + workMs);
      cursor = until;
    }
    elapsed += segment.end - segment.start;
  }
  let accumulatedMs = 0;
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, workMs]) => {
    const previousValue = Math.floor(accumulatedMs / 60);
    accumulatedMs += workMs;
    return { date, workMs, value: Math.floor(accumulatedMs / 60) - previousValue };
  });
}

export function habitTimerSessions(input: readonly HabitTimerOperation[]): HabitTimerSession[] {
  const operations = new Map(input.map(op => [op.id, op]));
  const states = new Map<string, HabitTimerState>(), visiting = new Set<string>();
  const evaluate = (op: HabitTimerOperation): HabitTimerState => {
    const cached = states.get(op.id);
    if (cached) return cached;
    if (visiting.has(op.id)) return fail();
    visiting.add(op.id);
    const at = Date.parse(op.at);
    let state: HabitTimerState;
    if (op.action === "start") state = { root: op, head: op, status: "running", segments: [], runningSince: at };
    else {
      const parents = op.parents.map(id => {
        const parent = operations.get(id);
        if (!parent || parent.epoch !== op.epoch || parent.sessionId !== op.sessionId || parent.habitId !== op.habitId
          || parent.owner !== op.owner || Date.parse(parent.at) > at) return fail("HABIT_TIMER_HISTORY_CONFLICT");
        return evaluate(parent);
      });
      const base = parents.find(parent => parent.head.id === op.branchId) ?? parents[0];
      if (!base) return fail();
      state = { ...base, head: op };
      switch (op.action) {
        case "pause":
          if (base.status !== "running") return fail();
          state = { ...state, segments: closeSegment(base, at), runningSince: null, status: "paused" }; break;
        case "resume":
          if (base.status !== "paused") return fail();
          state = { ...state, runningSince: at, status: "running" }; break;
        case "finish": {
          if (!["running", "paused"].includes(base.status)) return fail();
          const expected = habitTimerDayAllocations(base, at);
          if (canonical(expected) !== canonical(op.allocations!.map(({ date, workMs, value }) => ({ date, workMs, value })))) return fail();
          state = { ...state, segments: closeSegment(base, at), runningSince: null, status: "finished",
            finishedAt: op.at, allocations: op.allocations }; break;
        }
        case "save":
          if (base.status !== "finished") return fail();
          state = { ...state, status: "saved", timeOnly: op.timeOnly === true }; break;
        case "discard":
          if (["saved", "discarded"].includes(base.status)) return fail();
          state = { ...state, segments: closeSegment(base, at), runningSince: null, status: "discarded" }; break;
        case "resolve": {
          if (parents.some(parent => parent.status === "saved") && base.status !== "saved") return fail("HABIT_TIMER_ALREADY_SAVED");
          if (base.status === "running") state = { ...state, segments: closeSegment(base, at), runningSince: null, status: "paused" };
          break;
        }
      }
    }
    visiting.delete(op.id); states.set(op.id, state); return state;
  };
  const referenced = new Set(input.flatMap(op => op.parents));
  input.forEach(evaluate);
  return input.filter(op => op.action === "start").map(root => {
    const heads = input.filter(op => op.sessionId === root.id && !referenced.has(op.id)).map(evaluate);
    if (!heads.length) return fail();
    return { id: root.id, root, heads, state: heads.length === 1 ? heads[0] : null };
  }).sort((a, b) => b.root.at.localeCompare(a.root.at) || a.id.localeCompare(b.id));
}

export function habitTimerMeasurementIds(sessions: readonly HabitTimerSession[]) {
  return new Set(sessions.flatMap(session => session.heads.filter(state => state.status === "saved" && !state.timeOnly)
    .flatMap(state => (state.allocations ?? []).filter(row => row.reason === "duration" && row.value > 0)
      .map(row => `timer-value:${session.id}:${row.date}`))));
}

export function startHabitTimer(operations: readonly HabitTimerOperation[], habitId: string, owner: string,
  plan: HabitTimerPlan, at = new Date().toISOString(), id = `habit-timer-${crypto.randomUUID()}`, epoch = "") {
  const replay = operations.find(op => op.id === id);
  if (replay) {
    if (replay.epoch !== habitTimerEpoch(epoch) || replay.owner !== owner || replay.habitId !== habitId || replay.at !== instant(at)
      || canonical(replay.plan) !== canonical(normalizeHabitTimerPlan(plan))) return fail("HABIT_TIMER_ID_CONFLICT");
    return [...operations];
  }
  if (habitTimerSessions(operations).some(session => session.root.owner === owner
    && (!session.state || !["saved", "discarded"].includes(session.state.status)))) return fail("HABIT_TIMER_ACTIVE");
  return mergeHabitTimerOperations(operations, [{ epoch, id, sessionId: id, habitId, owner, action: "start", parents: [], at, plan }]);
}

export function appendHabitTimerOperation(operations: readonly HabitTimerOperation[], sessionId: string,
  owner: string, action: Exclude<HabitTimerOperation["action"], "start">,
  options: { at?: string; id?: string; allocations?: HabitTimerAllocation[]; branchId?: string; timeOnly?: boolean } = {}) {
  const session = habitTimerSessions(operations).find(item => item.id === sessionId);
  if (!session || session.root.owner !== owner) return fail("HABIT_TIMER_OTHER_DEVICE");
  const replay = options.id && operations.find(op => op.id === options.id);
  if (replay) {
    if (replay.sessionId !== sessionId || replay.owner !== owner || replay.action !== action
      || options.at && replay.at !== instant(options.at)) return fail("HABIT_TIMER_ID_CONFLICT");
    return [...operations];
  }
  const state = session.state;
  if (!state && action !== "resolve") return fail("HABIT_TIMER_CONFLICT");
  if (state && (state.status === "saved" && ["save", "finish"].includes(action)
    || state.status === "finished" && action === "finish"
    || state.status === "paused" && action === "pause"
    || state.status === "running" && action === "resume"
    || state.status === "discarded" && action === "discard")) return [...operations];
  const id = action === "save" ? `timer-saved:${sessionId}` : options.id ?? `timer-op-${crypto.randomUUID()}`;
  const op: HabitTimerOperation = { epoch: session.root.epoch, id, sessionId, habitId: session.root.habitId, owner, action,
    parents: session.heads.map(head => head.head.id).sort(),
    at: action === "save" ? state!.head.at : options.at ?? new Date().toISOString(),
    ...(options.allocations ? { allocations: options.allocations } : {}),
    ...(action === "save" ? { timeOnly: options.timeOnly === true } : {}),
    ...(options.branchId ? { branchId: options.branchId } : {}) };
  const next = mergeHabitTimerOperations(operations, [op]);
  habitTimerSessions(next);
  return next;
}
