import type { DailyGoalRecord } from "./daily-goal";

export type RewardCurrency = "laurels";
export type RewardReason =
  | "daily-goal"
  | "perfect-day"
  | "daily-quest"
  | "weekly-quest"
  | "epic-quest"
  | "streak-milestone"
  | "rank-up"
  | "achievement"
  | "comeback"
  | "hero-path-amphora"
  | "hestia-spark"
  | "habit-mastery-retained"
  | "practice-expired"
  | "habit-deleted-reset";

export type LaurelsResetReason = Extract<RewardReason, "habit-deleted-reset">;

export type RewardTransaction = {
  readonly id: string;
  readonly userId: "self";
  readonly currency: RewardCurrency;
  readonly amount: number;
  readonly reason: RewardReason;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
};

export const DAILY_GOAL_LAURELS = 5;
export const PERFECT_DAY_LAURELS = 3;

const REWARD_REASONS: readonly RewardReason[] = [
  "daily-goal",
  "perfect-day",
  "daily-quest",
  "weekly-quest",
  "epic-quest",
  "streak-milestone",
  "rank-up",
  "achievement",
  "comeback",
  "hero-path-amphora",
  "hestia-spark",
  "habit-mastery-retained",
  "practice-expired",
  "habit-deleted-reset",
];

const LAURELS_RESET_REASONS: readonly LaurelsResetReason[] = ["habit-deleted-reset"];
const ZERO_AMOUNT_REASONS: readonly RewardReason[] = [...LAURELS_RESET_REASONS, "habit-mastery-retained"];
const RETIRED_MISSED_HABIT_RESET = "habit-missed-reset";

function rewardAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  const rounded = Math.round(amount);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isRewardReason(value: unknown): value is RewardReason {
  return REWARD_REASONS.includes(value as RewardReason);
}

function rewardId(idempotencyKey: string) {
  return `reward:${idempotencyKey}`;
}

const rewardInstant = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : Number.MIN_SAFE_INTEGER;

export function createRewardTransaction(input: {
  amount: number;
  reason: RewardReason;
  sourceId: string;
  idempotencyKey: string;
  createdAt?: string;
}): RewardTransaction {
  return {
    id: rewardId(input.idempotencyKey),
    userId: "self",
    currency: "laurels",
    amount: rewardAmount(input.amount),
    reason: input.reason,
    sourceId: input.sourceId,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function normalizeRewardTransactions(value: unknown): RewardTransaction[] {
  if (!Array.isArray(value)) return [];
  const transactions = new Map<string, RewardTransaction>();
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const source = item as Partial<RewardTransaction>;
    // Older clients reset the whole balance once for every unchecked habit.
    // Dropping those automatic entries repairs affected encrypted ledgers.
    if (String(source.reason ?? "") === RETIRED_MISSED_HABIT_RESET) return;
    const idempotencyKey = typeof source.idempotencyKey === "string" ? source.idempotencyKey.trim() : "";
    const sourceId = typeof source.sourceId === "string" ? source.sourceId.trim() : "";
    const amount = rewardAmount(source.amount);
    if (!idempotencyKey || !sourceId || source.currency !== "laurels" || !isRewardReason(source.reason)) return;
    if (!amount && !ZERO_AMOUNT_REASONS.includes(source.reason)) return;
    const transaction: RewardTransaction = {
      id: typeof source.id === "string" && source.id ? source.id : rewardId(idempotencyKey),
      userId: "self",
      currency: "laurels",
      amount,
      reason: source.reason,
      sourceId,
      idempotencyKey,
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    };
    const previous = transactions.get(idempotencyKey);
    if (!previous || rewardInstant(transaction.createdAt) < rewardInstant(previous.createdAt)) transactions.set(idempotencyKey, transaction);
  });
  return Array.from(transactions.values()).sort((a, b) => (
    rewardInstant(a.createdAt) - rewardInstant(b.createdAt)
      || Number(LAURELS_RESET_REASONS.includes(a.reason as LaurelsResetReason)) - Number(LAURELS_RESET_REASONS.includes(b.reason as LaurelsResetReason))
      || a.idempotencyKey.localeCompare(b.idempotencyKey)
  ));
}

export function calculateLaurelsBalance(transactions: readonly RewardTransaction[]) {
  const balance = normalizeRewardTransactions(transactions).reduce((current, transaction) => {
    if (LAURELS_RESET_REASONS.includes(transaction.reason as LaurelsResetReason)) return 0;
    return current + transaction.amount;
  }, 0);
  return Math.max(0, balance);
}

export function recordHabitMasteryRetention(
  value: unknown,
  habitId: string,
  createdAt = new Date().toISOString(),
) {
  const transactions = normalizeRewardTransactions(value);
  const idempotencyKey = `habit-mastery-retained:self:${habitId}`;
  if (transactions.some((transaction) => transaction.idempotencyKey === idempotencyKey)) return transactions;
  transactions.push(createRewardTransaction({
    amount: 0,
    reason: "habit-mastery-retained",
    sourceId: habitId,
    idempotencyKey,
    createdAt,
  }));
  return normalizeRewardTransactions(transactions);
}

export function resetLaurelsBalance(
  value: unknown,
  reason: LaurelsResetReason,
  sourceId: string,
  idempotencyKey: string,
  createdAt = new Date().toISOString(),
) {
  const transactions = normalizeRewardTransactions(value);
  if (transactions.some((transaction) => transaction.idempotencyKey === idempotencyKey)) return transactions;
  transactions.push(createRewardTransaction({
    amount: -calculateLaurelsBalance(transactions),
    reason,
    sourceId,
    idempotencyKey,
    createdAt,
  }));
  return normalizeRewardTransactions(transactions);
}

export function laurelsForDailyGoal(record: Pick<DailyGoalRecord, "status">) {
  if (record.status === "perfect") return DAILY_GOAL_LAURELS + PERFECT_DAY_LAURELS;
  if (record.status === "qualified") return DAILY_GOAL_LAURELS;
  return 0;
}

export function reconcileDailyGoalRewards(
  records: readonly DailyGoalRecord[],
  value: unknown,
  today: string,
) {
  const transactions = normalizeRewardTransactions(value);
  const knownKeys = new Set(transactions.map((transaction) => transaction.idempotencyKey));
  [...records].sort((a, b) => a.date.localeCompare(b.date)).forEach((record) => {
    if (record.date > today || !["qualified", "perfect"].includes(record.status)) return;
    const dailyKey = `daily-goal:self:${record.date}`;
    if (!knownKeys.has(dailyKey)) {
      transactions.push(createRewardTransaction({
        amount: DAILY_GOAL_LAURELS,
        reason: "daily-goal",
        sourceId: record.date,
        idempotencyKey: dailyKey,
        createdAt: record.updatedAt || `${record.date}T00:00:00.000Z`,
      }));
      knownKeys.add(dailyKey);
    }
    const perfectKey = `perfect-day:self:${record.date}`;
    if (record.status === "perfect" && !knownKeys.has(perfectKey)) {
      transactions.push(createRewardTransaction({
        amount: PERFECT_DAY_LAURELS,
        reason: "perfect-day",
        sourceId: record.date,
        idempotencyKey: perfectKey,
        createdAt: record.updatedAt || `${record.date}T00:00:00.000Z`,
      }));
      knownKeys.add(perfectKey);
    }
  });
  return normalizeRewardTransactions(transactions);
}
