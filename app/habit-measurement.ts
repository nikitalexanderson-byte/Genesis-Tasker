import { isCivilDate } from "./calendar-context.ts";
import type { TrackerEntity, TrackerSchedule } from "./tracker-core";
import { normalizeHabitPeriodGoal, type HabitPeriodGoal } from "./habit-period-goal.ts";
import { habitRuleState, validateHabitRuleHistory } from "./habit-rule-history.ts";

/** Values are integer thousandths; user input is never accumulated as binary floats. */
export const HABIT_VALUE_SCALE = 1000;
export const MAX_HABIT_VALUE = 1_000_000_000_000;
export type HabitMeasurement = {
  kind: "quantity" | "duration";
  unit: string;
  target: number;
  quickAdd: number;
};
export type HabitRuleVersion = {
  id: string;
  effectiveDate: string;
  recordedAt: string;
  measurement: HabitMeasurement | null;
  schedule: TrackerSchedule;
  periodGoal?: HabitPeriodGoal | null;
  supersedes?: string[];
  selectedRuleId?: string;
};
export type HabitMeasurementEvent = TrackerEntity & {
  habitId: string;
  date: string;
  entryId: string;
  ruleId: string;
  replaces: string[];
  /** null is an explicit deletion, retaining the event and its correction history. */
  value: number | null;
  note: string;
  source: "manual" | "correction" | "timer" | "import";
  historical: boolean;
};
type MeasurableHabit = { id: string; createdDate: string; schedule: TrackerSchedule;
  measurement?: HabitMeasurement | null; ruleHistory?: HabitRuleVersion[]; periodGoal?: HabitPeriodGoal | null };
const canonical = (value: unknown): string => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value) ?? "null";

export function parseHabitValue(input: string): number | null {
  const text = input.trim().replace(/[\u00a0\u202f]/g, " ");
  // No grouping or scientific notation: neither an ambiguous separator nor rounding is silent.
  const matched = /^(\d{1,10})(?:[.,](\d{1,3}))?$/.exec(text);
  if (!matched) return null;
  const value = Number(matched[1]) * HABIT_VALUE_SCALE + Number((matched[2] ?? "").padEnd(3, "0"));
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_HABIT_VALUE ? value : null;
}

export function formatHabitValue(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value / HABIT_VALUE_SCALE);
}

export function normalizeHabitMeasurement(input: unknown): HabitMeasurement | null {
  if (input == null) return null;
  if (typeof input !== "object") throw new RangeError("INVALID_HABIT_MEASUREMENT");
  const value = input as Partial<HabitMeasurement>;
  if (value.kind !== "quantity" && value.kind !== "duration") throw new RangeError("INVALID_HABIT_MEASUREMENT");
  const unit = typeof value.unit === "string" ? value.unit.trim() : "";
  if (!unit || unit.length > 40 || value.kind === "duration" && unit !== "min"
    || !Number.isSafeInteger(value.target) || value.target! <= 0 || value.target! > MAX_HABIT_VALUE
    || !Number.isSafeInteger(value.quickAdd) || value.quickAdd! <= 0 || value.quickAdd! > MAX_HABIT_VALUE)
    throw new RangeError("INVALID_HABIT_MEASUREMENT");
  return { kind: value.kind, unit, target: value.target!, quickAdd: value.quickAdd! };
}

export function normalizeHabitRuleHistory(input: unknown): HabitRuleVersion[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new RangeError("INVALID_HABIT_RULE_HISTORY");
  const byId = new Map<string, HabitRuleVersion>();
  for (const item of input) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id
      || !isCivilDate(item.effectiveDate) || !Number.isFinite(Date.parse(item.recordedAt))
      || !item.schedule || !isCivilDate(item.schedule.startDate) || !item.schedule.recurrence
      || (item.measurement != null && !normalizeHabitMeasurement(item.measurement)))
      throw new RangeError("INVALID_HABIT_RULE_HISTORY");
    const periodGoal = normalizeHabitPeriodGoal(item.periodGoal);
    if (item.supersedes !== undefined && (!Array.isArray(item.supersedes)
      || item.supersedes.some((id: unknown) => typeof id !== "string" || !id || id === item.id)
      || new Set(item.supersedes).size !== item.supersedes.length)
      || item.selectedRuleId !== undefined && (typeof item.selectedRuleId !== "string" || !item.selectedRuleId || !item.supersedes))
      throw new RangeError("INVALID_HABIT_RULE_HISTORY");
    const rule: HabitRuleVersion = { id: item.id, effectiveDate: item.effectiveDate, recordedAt: item.recordedAt,
      schedule: item.schedule, measurement: normalizeHabitMeasurement(item.measurement), ...(periodGoal ? { periodGoal } : {}) };
    if (item.supersedes !== undefined) rule.supersedes = [...item.supersedes].sort();
    if (item.selectedRuleId !== undefined) rule.selectedRuleId = item.selectedRuleId;
    if (periodGoal?.metric === "sum" && !rule.measurement) throw new RangeError("HABIT_PERIOD_MEASUREMENT_REQUIRED");
    try { new Intl.DateTimeFormat("en", { timeZone: rule.schedule.timezone }); }
    catch { throw new RangeError("INVALID_HABIT_RULE_HISTORY"); }
    const prior = byId.get(item.id);
    if (prior && canonical(prior) !== canonical(rule)) throw new RangeError("HABIT_RULE_ID_CONFLICT");
    byId.set(item.id, rule);
  }
  const rules = [...byId.values()].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)
    || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
  validateHabitRuleHistory(rules);
  return rules;
}

export function habitRuleForDate(habit: MeasurableHabit, date: string): HabitRuleVersion {
  return habitRuleState(habit, date).rule;
}

export function effectiveHabitMeasurement(rule: Pick<HabitRuleVersion, "measurement" | "periodGoal">): HabitMeasurement | null {
  return rule.measurement ?? (rule.periodGoal?.metric === "entries"
    ? { kind: "quantity", unit: "count", target: 1000, quickAdd: 1000 } : null);
}

/** An operation ID is immutable. Divergent reuse fails instead of silently doubling or replacing data. */
export function mergeHabitMeasurementEvents(...sources: unknown[]): HabitMeasurementEvent[] {
  const result = new Map<string, HabitMeasurementEvent>();
  for (const source of sources) {
    if (source == null) continue;
    if (!Array.isArray(source)) throw new RangeError("INVALID_HABIT_MEASUREMENT_EVENTS");
    for (const value of source) {
      if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id
        || typeof value.habitId !== "string" || !value.habitId || !isCivilDate(value.date)
        || typeof value.entryId !== "string" || !value.entryId || typeof value.ruleId !== "string" || !value.ruleId
        || !Number.isFinite(Date.parse(value.createdAt))
        || !(value.value === null || Number.isSafeInteger(value.value) && value.value > 0 && value.value <= MAX_HABIT_VALUE)
        || !Array.isArray(value.replaces) || value.replaces.some((id: unknown) => typeof id !== "string" || !id || id === value.id)
        || !["manual", "correction", "timer", "import"].includes(value.source)) throw new RangeError("INVALID_HABIT_MEASUREMENT_EVENT");
      const event: HabitMeasurementEvent = { ...value, replaces: [...new Set<string>(value.replaces)].sort(),
        note: typeof value.note === "string" ? value.note.slice(0, 2000) : "", historical: value.historical === true };
      const prior = result.get(event.id);
      const content = (item: HabitMeasurementEvent) => JSON.stringify([item.habitId, item.date, item.entryId,
        item.ruleId, item.value, item.replaces, item.createdAt, item.note, item.source, item.historical]);
      if (prior && content(prior) !== content(event)) throw new RangeError("HABIT_MEASUREMENT_ID_CONFLICT");
      result.set(event.id, event);
    }
  }
  return [...result.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function habitMeasurementProgress(habit: MeasurableHabit, date: string, events: readonly HabitMeasurementEvent[]) {
  const rule = habitRuleForDate(habit, date);
  const ruleConflicts = habitRuleState(habit, date).conflicts;
  const relevant = events.filter(event => event.habitId === habit.id && event.date === date);
  const grouped = new Map<string, HabitMeasurementEvent[]>();
  for (const event of relevant) grouped.set(event.entryId, [...(grouped.get(event.entryId) ?? []), event]);
  const entries = [...grouped.entries()].map(([id, revisions]) => {
    const byId = new Map(revisions.map(event => [event.id, event]));
    const visiting = new Set<string>(), visited = new Set<string>();
    const validate = (event: HabitMeasurementEvent) => {
      if (visited.has(event.id)) return;
      if (visiting.has(event.id) || !event.replaces.length && event.entryId !== event.id)
        throw new RangeError("INVALID_HABIT_MEASUREMENT_HISTORY");
      visiting.add(event.id);
      for (const predecessor of event.replaces) {
        const prior = byId.get(predecessor);
        if (!prior) throw new RangeError("INVALID_HABIT_MEASUREMENT_HISTORY");
        validate(prior);
      }
      visiting.delete(event.id); visited.add(event.id);
    };
    revisions.forEach(validate);
    const replaced = new Set(revisions.flatMap(event => event.replaces));
    const heads = revisions.filter(event => !replaced.has(event.id));
    return { id, revisions, heads, conflict: heads.length !== 1,
      current: heads.length === 1 ? heads[0] : null };
  });
  const conflicts = entries.filter(entry => entry.conflict);
  const incompatible = entries.some(entry => entry.current?.value != null && entry.current.ruleId !== rule.id);
  const total = entries.reduce((sum, entry) => sum + (entry.current?.ruleId === rule.id ? entry.current.value ?? 0 : 0), 0);
  if (!Number.isSafeInteger(total) || total > MAX_HABIT_VALUE) throw new RangeError("HABIT_MEASUREMENT_TOTAL_TOO_LARGE");
  const definition = effectiveHabitMeasurement(rule);
  const target = rule.periodGoal && rule.periodGoal.metric !== "days" ? 1 : definition?.target ?? 0;
  const rewardTotal = entries.reduce((sum, entry) => {
    const root = entry.revisions.find(event => event.id === entry.id && !event.replaces.length);
    const current = entry.current;
    return sum + (root && !root.historical && root.source !== "import" && current && !current.historical
      && current.source !== "import" && current.ruleId === rule.id ? current.value ?? 0 : 0);
  }, 0);
  return { rule, entries, conflicts, ruleConflicts, incompatible, total, target, rewardTotal,
    remaining: Math.max(0, target - total),
    completed: Boolean(target > 0 && total >= target && !conflicts.length && !ruleConflicts.length && !incompatible) };
}

export function newHabitMeasurementEvent(habit: MeasurableHabit, date: string, value: number | null,
  options: { id?: string; entryId?: string; replaces?: string[]; note?: string;
    source?: HabitMeasurementEvent["source"]; historical?: boolean; recordedAt?: string } = {}): HabitMeasurementEvent {
  const timestamp = options.recordedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new RangeError("INVALID_HABIT_MEASUREMENT_EVENT");
  const id = options.id ?? `habit-value-${crypto.randomUUID()}`;
  const entity: TrackerEntity = { id, createdAt: timestamp, updatedAt: timestamp, version: 1, syncState: "local" };
  return { ...entity, id, habitId: habit.id, date, entryId: options.entryId ?? id,
    ruleId: habitRuleForDate(habit, date).id, value, replaces: options.replaces ?? [],
    note: options.note ?? "", source: options.source ?? "manual", historical: options.historical === true };
}
