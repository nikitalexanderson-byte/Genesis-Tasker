import { normalizeDailyGoalRecords, type DailyGoalRecord } from "./daily-goal.ts";
import { createRewardTransaction, normalizeRewardTransactions, type RewardTransaction } from "./rewards.ts";

export type StreakRewardMilestone = {
  days: number;
  laurels: number;
  title: string;
  titleEn: string;
};

export const STREAK_REWARD_MILESTONES: readonly StreakRewardMilestone[] = [
  { days: 3, laurels: 5, title: "Первая нить", titleEn: "First Thread" },
  { days: 7, laurels: 12, title: "Семь восходов", titleEn: "Seven Sunrises" },
  { days: 14, laurels: 20, title: "Укреплённый ритм", titleEn: "Anchored Rhythm" },
  { days: 30, laurels: 40, title: "Железный месяц", titleEn: "Iron Month" },
  { days: 50, laurels: 60, title: "Пятьдесят шагов", titleEn: "Fifty Steps" },
  { days: 100, laurels: 100, title: "Стодневный путь", titleEn: "Hundred-Day Path" },
  { days: 180, laurels: 160, title: "Полугодовой круг", titleEn: "Half-Year Circle" },
  { days: 365, laurels: 300, title: "Полный оборот", titleEn: "Full Revolution" },
  { days: 500, laurels: 450, title: "Пятьсот восходов", titleEn: "Five Hundred Sunrises" },
  { days: 1_000, laurels: 1_000, title: "Тысяча дней пути", titleEn: "A Thousand Days" },
] as const;

export function streakMilestoneDates(records: readonly DailyGoalRecord[]) {
  const result = new Map<number, string>();
  let streak = 0;
  normalizeDailyGoalRecords(records).forEach((record) => {
    if (["qualified", "perfect"].includes(record.status)) {
      streak += 1;
      if (STREAK_REWARD_MILESTONES.some((milestone) => milestone.days === streak)) result.set(streak, record.date);
    } else if (record.status === "missed") {
      streak = 0;
    }
  });
  return result;
}

export function reconcileStreakMilestoneRewards(
  records: readonly DailyGoalRecord[],
  value: unknown,
) {
  const transactions = normalizeRewardTransactions(value);
  const knownKeys = new Set(transactions.map((transaction) => transaction.idempotencyKey));
  const dates = streakMilestoneDates(records);
  STREAK_REWARD_MILESTONES.forEach((milestone) => {
    const reachedOn = dates.get(milestone.days);
    const idempotencyKey = `streak-milestone:self:${milestone.days}`;
    if (!reachedOn || knownKeys.has(idempotencyKey)) return;
    transactions.push(createRewardTransaction({
      amount: milestone.laurels,
      reason: "streak-milestone",
      sourceId: String(milestone.days),
      idempotencyKey,
      createdAt: `${reachedOn}T23:59:58.000Z`,
    }));
    knownKeys.add(idempotencyKey);
  });
  return normalizeRewardTransactions(transactions);
}

export function claimedStreakMilestones(transactions: readonly RewardTransaction[]) {
  const claimed = new Set(transactions
    .filter((transaction) => transaction.reason === "streak-milestone")
    .map((transaction) => Number(transaction.sourceId)));
  return STREAK_REWARD_MILESTONES.filter((milestone) => claimed.has(milestone.days));
}
