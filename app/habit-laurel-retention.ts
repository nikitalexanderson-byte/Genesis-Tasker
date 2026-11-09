import {
  calculateLaurelsBalance,
  normalizeRewardTransactions,
  recordHabitMasteryRetention,
  resetLaurelsBalance,
  type RewardTransaction,
} from "./rewards.ts";

type CompletionEvidence = {
  habitId: string;
  date: string;
  completed: boolean;
};

export const HABIT_LAUREL_RETENTION_COMPLETIONS = 50;

export function habitCompletionCount(completions: readonly CompletionEvidence[], habitId: string) {
  return new Set(completions
    .filter((entry) => entry.habitId === habitId && entry.completed)
    .map((entry) => entry.date)).size;
}

export function habitRetainsLaurelsOnDeletion(completions: readonly CompletionEvidence[], habitId: string) {
  return habitCompletionCount(completions, habitId) >= HABIT_LAUREL_RETENTION_COMPLETIONS;
}

export function applyHabitDeletionLaurelPolicy(
  value: readonly RewardTransaction[],
  completions: readonly CompletionEvidence[],
  habitId: string,
  timestamp = new Date().toISOString(),
  operationId?: string,
) {
  const retained = habitRetainsLaurelsOnDeletion(completions, habitId);
  const transactions = retained
    ? recordHabitMasteryRetention(value, habitId, timestamp)
    : resetLaurelsBalance(value, "habit-deleted-reset", habitId, `habit-deleted:self:${habitId}${operationId ? `:${operationId}` : ""}`, timestamp);
  return { retained, transactions };
}

export function reconcileOrphanedHabitLaurels(
  habitCount: number,
  value: readonly RewardTransaction[],
  timestamp = new Date().toISOString(),
) {
  const transactions = normalizeRewardTransactions(value);
  if (habitCount > 0 || calculateLaurelsBalance(transactions) === 0) return transactions;
  if (transactions.some((transaction) => transaction.reason === "habit-mastery-retained")) return transactions;
  return resetLaurelsBalance(
    transactions,
    "habit-deleted-reset",
    "legacy-empty-workspace",
    "habit-deleted:self:legacy-empty-workspace",
    timestamp,
  );
}
