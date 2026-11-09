import type { CalendarMode } from "./calendar-data.ts";
import type { DailyGoalRecord } from "./daily-goal.ts";
import {
  createRewardTransaction,
  normalizeRewardTransactions,
} from "./rewards.ts";
import type { TrackerEntity, TrackerSchedule } from "./tracker-core.ts";

export type HabitQuestCadence = "daily" | "weekly" | "epic";
export type HabitQuestKind = "daily-goal" | "weekly-completions" | "daily-goals" | "perfect-days" | "habit-completions" | "epic-completions";

export type HabitQuest = TrackerEntity & {
  cadence: HabitQuestCadence;
  kind: HabitQuestKind;
  habitId: string | null;
  startDate: string;
  endDate: string;
  target: number;
  progress: number;
  rewardLaurels: number;
  completedAt: string | null;
};

type QuestHabit = {
  id: string;
  active: boolean;
  priority?: number;
  schedule: TrackerSchedule;
};

type QuestCompletion = {
  habitId: string;
  date: string;
  completed: boolean;
};

export const DAILY_QUEST_LAURELS = 3;
export const WEEKLY_QUEST_LAURELS = 25;
export const EPIC_QUEST_LAURELS = 80;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const QUEST_KINDS: readonly HabitQuestKind[] = ["daily-goal", "weekly-completions", "daily-goals", "perfect-days", "habit-completions", "epic-completions"];
const QUEST_CADENCES: readonly HabitQuestCadence[] = ["daily", "weekly", "epic"];

function safeCount(value: unknown) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function localDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const date = localDate(value);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function datesBetween(start: string, end: string) {
  const values: string[] = [];
  for (let value = start; value <= end; value = addDays(value, 1)) values.push(value);
  return values;
}

export function habitQuestWeek(today: string) {
  const date = localDate(today);
  const offset = (date.getDay() + 6) % 7;
  const startDate = addDays(today, -offset);
  return { startDate, endDate: addDays(startDate, 6) };
}

export function habitQuestMonth(today: string) {
  const date = localDate(today);
  const startDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  return { startDate, endDate: dateKey(end) };
}

function questId(cadence: HabitQuestCadence, startDate: string) {
  return `quest:${cadence}:${startDate}`;
}

function scheduledOccurrences(
  habits: readonly QuestHabit[],
  dates: readonly string[],
  calendarMode: CalendarMode,
  isScheduledForDate: (schedule: TrackerSchedule, date: string, calendarMode: CalendarMode, habit?: QuestHabit) => boolean,
  habitId: string | null = null,
) {
  return habits.reduce((total, habit) => total + dates.filter((date) => (
    habit.active && (!habitId || habit.id === habitId) && isScheduledForDate(habit.schedule, date, calendarMode, habit)
  )).length, 0);
}

function completionKeys(completions: readonly QuestCompletion[]) {
  return new Set(completions.filter((completion) => completion.completed).map((completion) => `${completion.habitId}:${completion.date}`));
}

function attainableCompletions(input: {
  habits: readonly QuestHabit[];
  completions: readonly QuestCompletion[];
  dates: readonly string[];
  today: string;
  calendarMode: CalendarMode;
  isScheduledForDate: (schedule: TrackerSchedule, date: string, calendarMode: CalendarMode, habit?: QuestHabit) => boolean;
  habitId?: string | null;
}) {
  const completed = completionKeys(input.completions);
  return input.habits.reduce((total, habit) => total + input.dates.filter((date) => {
    if (!habit.active || (input.habitId && habit.id !== input.habitId) || !input.isScheduledForDate(habit.schedule, date, input.calendarMode, habit)) return false;
    return date >= input.today || completed.has(`${habit.id}:${date}`);
  }).length, 0);
}

function attainableGoalDays(
  dates: readonly string[],
  today: string,
  dailyGoalRecords: readonly DailyGoalRecord[],
  habits: readonly QuestHabit[],
  calendarMode: CalendarMode,
  isScheduledForDate: (schedule: TrackerSchedule, date: string, calendarMode: CalendarMode, habit?: QuestHabit) => boolean,
  perfectOnly = false,
) {
  return dates.filter((date) => {
    const record = dailyGoalRecords.find((item) => item.date === date);
    if (date < today) return perfectOnly ? record?.status === "perfect" : Boolean(record && ["qualified", "perfect"].includes(record.status));
    return scheduledOccurrences(habits, [date], calendarMode, isScheduledForDate) > 0;
  }).length;
}

function normalizeQuestEntity(value: Partial<TrackerEntity>): TrackerEntity {
  const fallbackTimestamp = new Date().toISOString();
  return {
    id: typeof value.id === "string" && value.id ? value.id : `quest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: typeof value.createdAt === "string" && value.createdAt ? value.createdAt : fallbackTimestamp,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : fallbackTimestamp,
    version: Math.max(1, Math.round(Number(value.version) || 1)),
    syncState: ["local", "pending", "synced"].includes(value.syncState ?? "") ? value.syncState! : "local",
  };
}

function questProgress(
  quest: HabitQuest,
  completions: readonly QuestCompletion[],
  dailyGoalRecords: readonly DailyGoalRecord[],
) {
  const records = dailyGoalRecords.filter((item) => item.date >= quest.startDate && item.date <= quest.endDate);
  if (quest.kind === "daily-goal") {
    const record = records.find((item) => item.date === quest.startDate);
    return record && ["qualified", "perfect"].includes(record.status) ? 1 : 0;
  }
  if (quest.kind === "daily-goals") return records.filter((record) => ["qualified", "perfect"].includes(record.status)).length;
  if (quest.kind === "perfect-days") return records.filter((record) => record.status === "perfect").length;
  return new Set(completions
    .filter((completion) => completion.completed
      && completion.date >= quest.startDate
      && completion.date <= quest.endDate
      && (!quest.habitId || completion.habitId === quest.habitId))
    .map((completion) => `${completion.habitId}:${completion.date}`)).size;
}

function updateQuest(
  quest: HabitQuest,
  completions: readonly QuestCompletion[],
  dailyGoalRecords: readonly DailyGoalRecord[],
  timestamp: string,
) {
  const measuredProgress = Math.min(quest.target, questProgress(quest, completions, dailyGoalRecords));
  const progress = quest.completedAt ? Math.max(quest.progress, measuredProgress) : measuredProgress;
  const completedAt = quest.completedAt ?? (progress >= quest.target ? timestamp : null);
  if (progress === quest.progress && completedAt === quest.completedAt) return quest;
  return { ...quest, progress, completedAt, updatedAt: timestamp, version: quest.version + 1, syncState: "pending" as const };
}

function createQuest(input: {
  cadence: HabitQuestCadence;
  kind: HabitQuestKind;
  habitId?: string | null;
  startDate: string;
  endDate: string;
  target: number;
  rewardLaurels: number;
  timestamp: string;
}): HabitQuest {
  return {
    id: questId(input.cadence, input.startDate),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    version: 1,
    syncState: "local",
    cadence: input.cadence,
    kind: input.kind,
    habitId: input.habitId ?? null,
    startDate: input.startDate,
    endDate: input.endDate,
    target: Math.max(1, safeCount(input.target)),
    progress: 0,
    rewardLaurels: Math.max(1, safeCount(input.rewardLaurels)),
    completedAt: null,
  };
}

export function normalizeHabitQuests(value: unknown): HabitQuest[] {
  if (!Array.isArray(value)) return [];
  const quests = new Map<string, HabitQuest>();
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const source = item as Partial<HabitQuest>;
    if (!QUEST_CADENCES.includes(source.cadence as HabitQuestCadence)
      || !QUEST_KINDS.includes(source.kind as HabitQuestKind)
      || !DATE_PATTERN.test(source.startDate ?? "")
      || !DATE_PATTERN.test(source.endDate ?? "")
      || source.endDate! < source.startDate!) return;
    const entity = normalizeQuestEntity(source);
    const target = Math.max(1, safeCount(source.target));
    const completedAt = typeof source.completedAt === "string" && !Number.isNaN(Date.parse(source.completedAt)) ? source.completedAt : null;
    const quest: HabitQuest = {
      ...entity,
      cadence: source.cadence!,
      kind: source.kind!,
      habitId: typeof source.habitId === "string" && source.habitId ? source.habitId : null,
      startDate: source.startDate!,
      endDate: source.endDate!,
      target,
      progress: Math.min(target, safeCount(source.progress)),
      rewardLaurels: Math.max(1, safeCount(source.rewardLaurels)),
      completedAt,
    };
    const previous = quests.get(quest.id);
    if (!previous || quest.version > previous.version || (quest.version === previous.version && quest.updatedAt > previous.updatedAt)) quests.set(quest.id, quest);
  });
  return Array.from(quests.values()).sort((left, right) => left.startDate.localeCompare(right.startDate) || left.cadence.localeCompare(right.cadence));
}

export function reconcileHabitQuests(input: {
  quests: unknown;
  habits: readonly QuestHabit[];
  completions: readonly QuestCompletion[];
  dailyGoalRecords: readonly DailyGoalRecord[];
  today: string;
  calendarMode: CalendarMode;
  isScheduledForDate: (schedule: TrackerSchedule, date: string, calendarMode: CalendarMode, habit?: QuestHabit) => boolean;
  timestamp?: string;
}) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const normalized = normalizeHabitQuests(input.quests);
  const quests = new Map(normalized.map((quest) => [quest.id, updateQuest(quest, input.completions, input.dailyGoalRecords, timestamp)]));
  const todayScheduled = scheduledOccurrences(input.habits, [input.today], input.calendarMode, input.isScheduledForDate);
  const dailyId = questId("daily", input.today);
  if (todayScheduled > 0 && !quests.has(dailyId)) {
    const quest = createQuest({ cadence: "daily", kind: "daily-goal", startDate: input.today, endDate: input.today, target: 1, rewardLaurels: DAILY_QUEST_LAURELS, timestamp });
    quests.set(quest.id, updateQuest(quest, input.completions, input.dailyGoalRecords, timestamp));
  }

  const week = habitQuestWeek(input.today);
  const weekDates = datesBetween(week.startDate, week.endDate);
  const weeklyId = questId("weekly", week.startDate);
  if (!quests.has(weeklyId)) {
    const variant = Number(week.startDate.replaceAll("-", "")) % 4;
    let kind: HabitQuestKind = "weekly-completions";
    let habitId: string | null = null;
    let capacity = attainableCompletions({ ...input, dates: weekDates });
    let target = Math.min(10, capacity);
    if (variant === 1) {
      kind = "daily-goals";
      capacity = attainableGoalDays(weekDates, input.today, input.dailyGoalRecords, input.habits, input.calendarMode, input.isScheduledForDate);
      target = Math.min(5, capacity);
    } else if (variant === 2) {
      kind = "perfect-days";
      capacity = attainableGoalDays(weekDates, input.today, input.dailyGoalRecords, input.habits, input.calendarMode, input.isScheduledForDate, true);
      target = Math.min(3, capacity);
    } else if (variant === 3) {
      const candidate = input.habits
        .filter((habit) => habit.active)
        .map((habit) => ({ habit, capacity: attainableCompletions({ ...input, dates: weekDates, habitId: habit.id }) }))
        .filter((item) => item.capacity > 0)
        .sort((left, right) => right.capacity - left.capacity || (right.habit.priority ?? 0) - (left.habit.priority ?? 0) || left.habit.id.localeCompare(right.habit.id))[0];
      kind = "habit-completions";
      habitId = candidate?.habit.id ?? null;
      capacity = candidate?.capacity ?? 0;
      target = Math.min(5, capacity);
    }
    if (target > 0) {
      const quest = createQuest({ cadence: "weekly", kind, habitId, startDate: week.startDate, endDate: week.endDate, target, rewardLaurels: WEEKLY_QUEST_LAURELS, timestamp });
      quests.set(quest.id, updateQuest(quest, input.completions, input.dailyGoalRecords, timestamp));
    }
  }

  const month = habitQuestMonth(input.today);
  const monthDates = datesBetween(month.startDate, month.endDate);
  const epicId = questId("epic", month.startDate);
  if (!quests.has(epicId)) {
    const capacity = attainableCompletions({ ...input, dates: monthDates });
    const target = Math.min(30, capacity);
    if (target > 0) {
      const quest = createQuest({ cadence: "epic", kind: "epic-completions", startDate: month.startDate, endDate: month.endDate, target, rewardLaurels: EPIC_QUEST_LAURELS, timestamp });
      quests.set(quest.id, updateQuest(quest, input.completions, input.dailyGoalRecords, timestamp));
    }
  }
  return Array.from(quests.values()).sort((left, right) => left.startDate.localeCompare(right.startDate) || left.cadence.localeCompare(right.cadence));
}

export function reconcileHabitQuestRewards(
  quests: readonly HabitQuest[],
  value: unknown,
  timestamp = new Date().toISOString(),
) {
  const transactions = normalizeRewardTransactions(value);
  const knownKeys = new Set(transactions.map((transaction) => transaction.idempotencyKey));
  quests.filter((quest) => Boolean(quest.completedAt)).forEach((quest) => {
    const idempotencyKey = `quest:self:${quest.id}`;
    if (knownKeys.has(idempotencyKey)) return;
    transactions.push(createRewardTransaction({
      amount: quest.rewardLaurels,
      reason: quest.cadence === "epic" ? "epic-quest" : quest.cadence === "weekly" ? "weekly-quest" : "daily-quest",
      sourceId: quest.id,
      idempotencyKey,
      createdAt: quest.completedAt ?? timestamp,
    }));
    knownKeys.add(idempotencyKey);
  });
  return normalizeRewardTransactions(transactions);
}

export function currentHabitQuests(quests: readonly HabitQuest[], today: string) {
  const cadenceOrder: Record<HabitQuestCadence, number> = { daily: 0, weekly: 1, epic: 2 };
  return quests.filter((quest) => quest.startDate <= today && quest.endDate >= today)
    .sort((left, right) => cadenceOrder[left.cadence] - cadenceOrder[right.cadence]);
}
