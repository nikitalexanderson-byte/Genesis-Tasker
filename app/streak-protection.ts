import {
  createRewardTransaction,
  normalizeRewardTransactions,
  type RewardTransaction,
} from "./rewards.ts";
import {
  normalizeDailyGoalRecords,
  type DailyGoalRecord,
} from "./daily-goal.ts";

export const HESTIA_SPARK_COST = 120;
export const HESTIA_SPARK_MAX = 2;
export const COMEBACK_TARGET_DAYS = 3;
export const COMEBACK_REWARD_LAURELS = 15;

export type StreakFreezeReason = "purchase" | "automatic-use";

export type StreakFreezeTransaction = {
  readonly id: string;
  readonly userId: "self";
  readonly amount: 1 | -1;
  readonly reason: StreakFreezeReason;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
};

export type HestiaSparkPurchaseResult = {
  ok: boolean;
  reason: "purchased" | "already-purchased" | "insufficient-laurels" | "inventory-full";
  rewardTransactions: RewardTransaction[];
  streakFreezeTransactions: StreakFreezeTransaction[];
};

export type ComebackSummary = {
  active: boolean;
  triggerDate: string | null;
  progress: number;
  target: typeof COMEBACK_TARGET_DAYS;
  lastCompletedDate: string | null;
};

type ComebackCompletion = {
  triggerDate: string;
  completedDate: string;
};

const FREEZE_REASONS: readonly StreakFreezeReason[] = ["purchase", "automatic-use"];

function freezeTransactionId(idempotencyKey: string) {
  return `streak-freeze:${idempotencyKey}`;
}

export function createStreakFreezeTransaction(input: {
  amount: 1 | -1;
  reason: StreakFreezeReason;
  sourceId: string;
  idempotencyKey: string;
  createdAt?: string;
}): StreakFreezeTransaction {
  return {
    id: freezeTransactionId(input.idempotencyKey),
    userId: "self",
    amount: input.amount,
    reason: input.reason,
    sourceId: input.sourceId,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function normalizeStreakFreezeTransactions(value: unknown): StreakFreezeTransaction[] {
  if (!Array.isArray(value)) return [];
  const transactions = new Map<string, StreakFreezeTransaction>();
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const source = item as Partial<StreakFreezeTransaction>;
    const idempotencyKey = typeof source.idempotencyKey === "string" ? source.idempotencyKey.trim() : "";
    const sourceId = typeof source.sourceId === "string" ? source.sourceId.trim() : "";
    if (!idempotencyKey || !sourceId || !FREEZE_REASONS.includes(source.reason as StreakFreezeReason)) return;
    if (source.amount !== 1 && source.amount !== -1) return;
    const transaction: StreakFreezeTransaction = {
      id: typeof source.id === "string" && source.id ? source.id : freezeTransactionId(idempotencyKey),
      userId: "self",
      amount: source.amount,
      reason: source.reason as StreakFreezeReason,
      sourceId,
      idempotencyKey,
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    };
    const previous = transactions.get(idempotencyKey);
    if (!previous || transaction.createdAt < previous.createdAt) transactions.set(idempotencyKey, transaction);
  });
  return Array.from(transactions.values()).sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.idempotencyKey.localeCompare(right.idempotencyKey)
  ));
}

export function calculateStreakFreezeCount(value: unknown) {
  return normalizeStreakFreezeTransactions(value).reduce((count, transaction) => {
    if (transaction.amount > 0) return Math.min(HESTIA_SPARK_MAX, count + 1);
    return Math.max(0, count - 1);
  }, 0);
}

export function purchaseHestiaSpark(input: {
  rewardTransactions: readonly RewardTransaction[];
  streakFreezeTransactions: readonly StreakFreezeTransaction[];
  laurelsBalance: number;
  purchaseId: string;
  createdAt?: string;
}): HestiaSparkPurchaseResult {
  const rewardTransactions = normalizeRewardTransactions(input.rewardTransactions);
  const streakFreezeTransactions = normalizeStreakFreezeTransactions(input.streakFreezeTransactions);
  const idempotencyKey = `hestia-spark-purchase:self:${input.purchaseId}`;
  if (streakFreezeTransactions.some((transaction) => transaction.idempotencyKey === idempotencyKey)) {
    return { ok: true, reason: "already-purchased", rewardTransactions, streakFreezeTransactions };
  }
  if (calculateStreakFreezeCount(streakFreezeTransactions) >= HESTIA_SPARK_MAX) {
    return { ok: false, reason: "inventory-full", rewardTransactions, streakFreezeTransactions };
  }
  if (Math.max(0, Math.round(Number(input.laurelsBalance) || 0)) < HESTIA_SPARK_COST) {
    return { ok: false, reason: "insufficient-laurels", rewardTransactions, streakFreezeTransactions };
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  rewardTransactions.push(createRewardTransaction({
    amount: -HESTIA_SPARK_COST,
    reason: "hestia-spark",
    sourceId: input.purchaseId,
    idempotencyKey,
    createdAt,
  }));
  streakFreezeTransactions.push(createStreakFreezeTransaction({
    amount: 1,
    reason: "purchase",
    sourceId: input.purchaseId,
    idempotencyKey,
    createdAt,
  }));
  return {
    ok: true,
    reason: "purchased",
    rewardTransactions: normalizeRewardTransactions(rewardTransactions),
    streakFreezeTransactions: normalizeStreakFreezeTransactions(streakFreezeTransactions),
  };
}

export function applyAutomaticStreakProtection(input: {
  records: readonly DailyGoalRecord[];
  transactions: readonly StreakFreezeTransaction[];
  protectableDates: ReadonlySet<string>;
  today: string;
  timestamp?: string;
}) {
  let transactions = normalizeStreakFreezeTransactions(input.transactions);
  let available = calculateStreakFreezeCount(transactions);
  let runningStreak = 0;
  const timestamp = input.timestamp ?? new Date().toISOString();
  const records = normalizeDailyGoalRecords(input.records).map((record) => {
    if (record.date > input.today) return record;
    if (record.status === "qualified" || record.status === "perfect") {
      runningStreak += 1;
      return record;
    }
    if (record.status === "protected") return record;
    if (record.status !== "missed") return record;
    const idempotencyKey = `hestia-spark-use:self:${record.date}`;
    const existingUse = transactions.some((transaction) => transaction.idempotencyKey === idempotencyKey);
    if (existingUse) return { ...record, status: "protected" as const };
    if (!input.protectableDates.has(record.date) || runningStreak === 0 || available === 0) {
      runningStreak = 0;
      return record;
    }
    transactions.push(createStreakFreezeTransaction({
      amount: -1,
      reason: "automatic-use",
      sourceId: record.date,
      idempotencyKey,
      createdAt: timestamp,
    }));
    transactions = normalizeStreakFreezeTransactions(transactions);
    available = Math.max(0, available - 1);
    return { ...record, status: "protected" as const, updatedAt: timestamp };
  });
  return { records: normalizeDailyGoalRecords(records), transactions };
}

function comebackCompletions(records: readonly DailyGoalRecord[], today: string) {
  let runningStreak = 0;
  let active: { triggerDate: string; progress: number } | null = null;
  const completions: ComebackCompletion[] = [];
  for (const record of normalizeDailyGoalRecords(records)) {
    if (record.date > today) continue;
    if (record.status === "qualified" || record.status === "perfect") {
      runningStreak += 1;
      if (!active) continue;
      active.progress += 1;
      if (active.progress >= COMEBACK_TARGET_DAYS) {
        completions.push({ triggerDate: active.triggerDate, completedDate: record.date });
        active = null;
      }
      continue;
    }
    if (record.status !== "missed") continue;
    if (!active && runningStreak > 0) active = { triggerDate: record.date, progress: 0 };
    else if (active) active.progress = 0;
    runningStreak = 0;
  }
  return { active, completions };
}

export function calculateComebackSummary(records: readonly DailyGoalRecord[], today: string): ComebackSummary {
  const state = comebackCompletions(records, today);
  return {
    active: Boolean(state.active),
    triggerDate: state.active?.triggerDate ?? null,
    progress: state.active?.progress ?? 0,
    target: COMEBACK_TARGET_DAYS,
    lastCompletedDate: state.completions.at(-1)?.completedDate ?? null,
  };
}

export function reconcileComebackRewards(
  records: readonly DailyGoalRecord[],
  value: unknown,
  today: string,
  timestamp = new Date().toISOString(),
) {
  const transactions = normalizeRewardTransactions(value);
  const knownKeys = new Set(transactions.map((transaction) => transaction.idempotencyKey));
  comebackCompletions(records, today).completions.forEach((completion) => {
    const idempotencyKey = `comeback:self:${completion.triggerDate}`;
    if (knownKeys.has(idempotencyKey)) return;
    transactions.push(createRewardTransaction({
      amount: COMEBACK_REWARD_LAURELS,
      reason: "comeback",
      sourceId: completion.triggerDate,
      idempotencyKey,
      createdAt: completion.completedDate ? `${completion.completedDate}T23:59:59.000Z` : timestamp,
    }));
    knownKeys.add(idempotencyKey);
  });
  return normalizeRewardTransactions(transactions);
}
