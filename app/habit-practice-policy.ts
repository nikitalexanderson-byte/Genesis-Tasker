import { isCivilDate } from "./calendar-context.ts";

/** Explicit opt-in on new practices. Missing metadata preserves legacy settings. */
export type HabitPracticeGoal = { version: 1; requiredCompletions: number; penaltyLaurels: 10; startDate?: string };
export const defaultPracticeGoal = (startDate?: string): HabitPracticeGoal => ({ version: 1, requiredCompletions: 1, penaltyLaurels: 10, ...(startDate ? { startDate } : {}) });
export function normalizePracticeGoal(input: unknown): HabitPracticeGoal | null {
  if (input == null) return null;
  const goal = input as Partial<HabitPracticeGoal>;
  if (goal.version !== 1 || !Number.isSafeInteger(goal.requiredCompletions) || goal.requiredCompletions! < 1
    || goal.requiredCompletions! > 366 || goal.penaltyLaurels !== 10 || goal.startDate !== undefined && !isCivilDate(goal.startDate)) throw new RangeError("INVALID_PRACTICE_GOAL");
  return { version: 1, requiredCompletions: goal.requiredCompletions!, penaltyLaurels: 10, ...(goal.startDate ? { startDate: goal.startDate } : {}) };
}
