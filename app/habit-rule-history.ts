import type { HabitRuleVersion, HabitMeasurement } from "./habit-measurement.ts";
import type { HabitPeriodGoal } from "./habit-period-goal.ts";
import type { TrackerSchedule } from "./tracker-core";

type RuleHabit = { id: string; createdDate: string; schedule: TrackerSchedule;
  measurement?: HabitMeasurement | null; periodGoal?: HabitPeriodGoal | null; ruleHistory?: HabitRuleVersion[] };
const order = (a: HabitRuleVersion, b: HabitRuleVersion) => a.effectiveDate.localeCompare(b.effectiveDate)
  || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id);

/** Pre-D3 histories retain their established order; new rules carry explicit causal edges. */
function ruleGraph(rules: readonly HabitRuleVersion[]) {
  const sorted = [...rules].sort(order), byId = new Map(sorted.map(rule => [rule.id, rule]));
  const parents = new Map<string, string[]>();
  let legacy: string | undefined;
  for (const rule of sorted) {
    parents.set(rule.id, rule.supersedes ?? (legacy ? [legacy] : []));
    if (rule.supersedes === undefined) legacy = rule.id;
  }
  return { sorted, byId, parents };
}

function ancestors(id: string, parents: Map<string, string[]>) {
  const found = new Set<string>(), pending = [...(parents.get(id) ?? [])];
  while (pending.length) {
    const parent = pending.pop()!;
    if (found.has(parent)) continue;
    found.add(parent); pending.push(...(parents.get(parent) ?? []));
  }
  return found;
}

const canonical = (value: unknown): string => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value) ?? "null";
const definition = (rule: HabitRuleVersion) => canonical([rule.measurement, rule.periodGoal ?? null, rule.schedule]);

export function validateHabitRuleHistory(rules: readonly HabitRuleVersion[]) {
  const { byId, parents } = ruleGraph(rules);
  const children = new Map<string, string[]>(), remaining = new Map<string, number>();
  for (const rule of rules) {
    if ((parents.get(rule.id) ?? []).some(id => !byId.has(id) || id === rule.id))
      throw new RangeError("INVALID_HABIT_RULE_HISTORY");
    const predecessors = parents.get(rule.id) ?? [];
    remaining.set(rule.id, predecessors.length);
    for (const id of predecessors) children.set(id, [...(children.get(id) ?? []), rule.id]);
    if (rule.selectedRuleId) {
      const selected = byId.get(rule.selectedRuleId);
      if (!selected || !ancestors(rule.id, parents).has(selected.id) || definition(selected) !== definition(rule))
        throw new RangeError("INVALID_HABIT_RULE_HISTORY");
    }
  }
  const pending = rules.filter(rule => remaining.get(rule.id) === 0).map(rule => rule.id);
  let visited = 0;
  while (pending.length) {
    const id = pending.pop()!; visited++;
    for (const child of children.get(id) ?? []) {
      remaining.set(child, remaining.get(child)! - 1);
      if (remaining.get(child) === 0) pending.push(child);
    }
  }
  if (visited !== rules.length) throw new RangeError("INVALID_HABIT_RULE_HISTORY");
}

/** The frontier is causal, so two offline edits cannot silently win by clock or UUID. */
export function habitRuleState(habit: RuleHabit, date: string) {
  const { sorted, byId, parents } = ruleGraph(habit.ruleHistory ?? []);
  const due = sorted.filter(rule => rule.effectiveDate <= date);
  const covered = new Set<string>(), pending = due.flatMap(rule => parents.get(rule.id) ?? []);
  while (pending.length) {
    const id = pending.pop()!;
    if (covered.has(id)) continue;
    covered.add(id); pending.push(...(parents.get(id) ?? []));
  }
  const frontier = due.filter(rule => !covered.has(rule.id));
  const fallback: HabitRuleVersion = { id: `initial:${habit.id}`, effectiveDate: habit.createdDate,
    recordedAt: "1970-01-01T00:00:00.000Z", measurement: habit.measurement ?? null, schedule: habit.schedule,
    ...(habit.periodGoal ? { periodGoal: habit.periodGoal } : {}) };
  let selected = frontier[0] ?? fallback;
  if (frontier.length > 1) {
    const common = ancestors(frontier[0].id, parents);
    for (const head of frontier.slice(1)) {
      const prior = ancestors(head.id, parents);
      for (const id of common) if (!prior.has(id)) common.delete(id);
    }
    selected = due.filter(rule => common.has(rule.id)).at(-1) ?? fallback;
  }
  const appliedVersion = selected;
  const seen = new Set<string>();
  while (selected.selectedRuleId && !seen.has(selected.id)) {
    seen.add(selected.id); selected = byId.get(selected.selectedRuleId) ?? selected;
  }
  return { rule: selected, appliedVersion, frontier, conflicts: frontier.length > 1 ? frontier : [] };
}

export const habitRuleFrontier = (habit: RuleHabit) => habitRuleState(habit, "9999-12-31").frontier;
