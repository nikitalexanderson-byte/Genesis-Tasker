import type { Habit, HabitCompletion } from "./habits";
import { addCivilDays, isCivilDate, momentCivilDate, resolveCalendarWallTime } from "./calendar-context.ts";
import { habitRuleState } from "./habit-rule-history.ts";
import { habitLifecycleState } from "./habit-lifecycle.ts";
import { isTrackerScheduledForDate } from "./tracker-core.ts";
import { createRewardTransaction, normalizeRewardTransactions } from "./rewards.ts";
import { defaultPracticeGoal } from "./habit-practice-policy.ts";
export { defaultPracticeGoal, normalizePracticeGoal, type HabitPracticeGoal } from "./habit-practice-policy.ts";

export function habitPracticeProgress(habit: Habit, entries: readonly HabitCompletion[], date: string) {
  if (!habit.practiceGoal && !habit.sacredPracticeId) return null;
  const current = new Map<string, HabitCompletion>();
  for (const entry of entries.filter(row => row.habitId === habit.id).sort((a, b) => b.version - a.version
    || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))) if (!current.has(entry.date)) current.set(entry.date, entry);
  // Recognize only untouched historical factory schedules with an existing timely success.
  // This closes the old ten-day presentation without enrolling old failures in penalties.
  const recurrence = habit.schedule.recurrence;
  const legacyStart = habit.stoicheionRestoration?.startedDate ?? habit.createdDate;
  const legacyEnd = habit.stoicheionRestoration ? addCivilDays(habit.stoicheionRestoration.sourceDate, 1) : legacyStart;
  const legacyFactory = !habit.practiceGoal && Boolean(habit.sacredPracticeId) && !habit.ruleHistory?.length
    && !habit.measurement && !habit.periodGoal && !habit.intervalSchedule && !habit.schedule.endDate
    && (!recurrence.enabled || Boolean(habit.stoicheionRestoration) && recurrence.interval === 1 && !recurrence.months.length && !recurrence.pyatas.length
      && (recurrence.pattern === "daily" || recurrence.pattern === "pyata-days" && [1,2,3,4,5].every(day => recurrence.days.includes(day))
        || recurrence.pattern === "lunar-days" && recurrence.days.length === 30));
  const legacyDone = legacyFactory && [...current.values()].some(entry => entry.completed && entry.date >= legacyStart && entry.date <= legacyEnd && entry.date <= date);
  const goal = habit.practiceGoal ?? (legacyDone ? defaultPracticeGoal(legacyStart) : null);
  if (!goal) return null;
  const state = habitRuleState(habit, date), schedule = state.rule.schedule;
  const deadline = legacyDone ? legacyEnd : schedule.endDate || schedule.recurrence.rangeEnd || schedule.startDate;
  const start = goal.startDate || schedule.startDate;
  const dates = [...current.values()].filter(entry => {
    if (!entry.completed || !isCivilDate(entry.date) || entry.date < start || entry.date > deadline || entry.date > date
      || habit.stoicheionRestoration?.excludeStartDate && entry.date === habit.stoicheionRestoration.startedDate) return false;
    const rule = habitRuleState(habit, entry.date), dayLife = habitLifecycleState(habit, entry.date);
    if (rule.conflicts.length || dayLife.conflict || dayLife.unknown) return false;
    const markedAt = Date.parse(entry.updatedAt);
    if (!Number.isFinite(markedAt)) return false;
    // Preserve an earlier same-day completion after Pause without accepting marks
    // written while unavailable. The write guard still uses current availability.
    const lifecycleHistory = (habit.lifecycleHistory ?? []).filter(row => Date.parse(row.at) <= markedAt);
    if (!lifecycleHistory.length && new Set((habit.lifecycleHistory ?? [])
      .filter(row => !row.replaces.length).map(row => row.baselineActive)).size > 1) return false;
    const life = habitLifecycleState({ ...habit, active: dayLife.baselineActive, lifecycleHistory }, entry.date);
    return life.status === "active" && !life.conflict && !life.unknown
      && isTrackerScheduledForDate(rule.rule.schedule, entry.date, "sacred");
  }).map(entry => entry.date).sort().slice(0, goal.requiredCompletions);
  const completedDate = dates.length >= goal.requiredCompletions ? dates.at(-1)! : null;
  return { goal, start, deadline, dates, completedDate, historical: Boolean(legacyDone),
    status: state.conflicts.length ? "conflict" as const : completedDate ? "completed" as const
      : date > deadline ? "missed" as const : date < start ? "pending" as const : "open" as const };
}

export function practiceLibraryStatus(habit: Habit, entries: readonly HabitCompletion[], date: string) {
  const lifecycle = habitLifecycleState(habit);
  if (lifecycle.status !== "active" || lifecycle.conflict) return lifecycle.status;
  const progress = habitPracticeProgress(habit, entries, date);
  return progress?.status === "completed" || progress?.status === "missed" ? progress.status : lifecycle.status;
}

export function practiceAllowsDate(habit: Habit, entries: readonly HabitCompletion[], date: string) {
  const progress = habitPracticeProgress(habit, entries, date);
  return !progress || date < progress.start || progress.status !== "conflict" && progress.status !== "missed"
    && (!progress.completedDate || date <= progress.completedDate);
}

/** Credit at most the configured number of days, including concurrent offline completions. */
export function practiceXpSources(habits: readonly Habit[], entries: readonly HabitCompletion[]) {
  const output = entries.filter(entry => !habits.find(habit => habit.id === entry.habitId)?.practiceGoal);
  for (const habit of habits.filter(row => row.practiceGoal)) {
    const dates = new Map<string, HabitCompletion>();
    for (const entry of entries.filter(row => row.habitId === habit.id && row.xpAwarded > 0)) {
      if (habit.practiceGoal?.startDate && entry.date < habit.practiceGoal.startDate) { output.push(entry); continue; }
      if ((dates.get(entry.date)?.xpAwarded ?? -1) < entry.xpAwarded) dates.set(entry.date, entry);
    }
    output.push(...[...dates.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, habit.practiceGoal!.requiredCompletions));
  }
  return output;
}

/** One deterministic debit per practice. A late, timely offline completion repairs its projection. */
export function reconcilePracticePenalties(habits: readonly Habit[], entries: readonly HabitCompletion[], ledger: unknown, date: string, now?: Date) {
  const ids = new Set(habits.filter(habit => habit.practiceGoal).map(habit => habit.id));
  const transactions = normalizeRewardTransactions(ledger).filter(row => {
    if (!ids.has(row.sourceId)) return true;
    if (row.reason === "practice-expired") return false;
    if (row.reason !== "habit-deleted-reset") return true;
    const attached = habits.find(habit => habit.id === row.sourceId)?.stoicheionRestoration;
    // Keep a regular habit's legitimate economy from before it was attached to this practice.
    return Boolean(attached && (!Number.isFinite(Date.parse(attached.startedAt)) || !Number.isFinite(Date.parse(row.createdAt))
      || Date.parse(row.createdAt) < Date.parse(attached.startedAt)));
  });
  for (const habit of habits) {
    if (!habit.practiceGoal) continue;
    const progress = habitPracticeProgress(habit, entries, now ? momentCivilDate(now, habit.schedule.timezone) : date);
    if (progress?.status !== "missed") continue;
    const createdAt = resolveCalendarWallTime(addCivilDays(progress.deadline, 1), "00:00", habit.schedule.timezone).instant.toISOString();
    transactions.push(createRewardTransaction({ amount: -progress.goal.penaltyLaurels, reason: "practice-expired", sourceId: habit.id,
      idempotencyKey: `practice-expired:self:${habit.id}`, createdAt }));
  }
  return normalizeRewardTransactions(transactions);
}
