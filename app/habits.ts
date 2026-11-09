import type { CalendarMode } from "./calendar-data";
import { normalizeHabitTimerPreferences, type HabitTimerPreferences } from "./habit-timer-preferences.ts";
import { normalizeRestorationSnapshot, type RestorationSnapshot } from "./stoicheion-restoration-state";
import { convertTrackerRecurrenceCalendar } from "./task-recurrence";
import { defaultPracticeGoal, habitPracticeProgress, normalizePracticeGoal, practiceAllowsDate, practiceXpSources,
  reconcilePracticePenalties, type HabitPracticeGoal } from "./habit-practice-goal";
import { catalogText } from "./catalog-i18n";
import { habitAutoDeleteDue, habitAutomaticPoints, normalizeHabitAutoDelete, type HabitAutoDeletePolicy } from "./habit-auto-delete";

/** Begin documenting legacy availability at the first real edit, without inventing past pauses. */
export function observeChangedHabitAvailability(previous: HabitWorkspace, next: HabitWorkspace, at: string): HabitWorkspace {
  const records = (workspace: HabitWorkspace, id: string) => JSON.stringify([
    workspace.habitCompletions.filter(row => row.habitId === id),
    workspace.habitMeasurements.filter(row => row.habitId === id),
    workspace.habitHistory.filter(row => row.habitId === id),
    workspace.habitTimers.filter(row => row.habitId === id),
  ]);
  let changed = false;
  const habits = next.habits.map(habit => {
    if (habit.lifecycleHistory?.length) return habit;
    const old = previous.habits.find(row => row.id === habit.id);
    if (old && JSON.stringify(old) === JSON.stringify(habit) && records(previous, habit.id) === records(next, habit.id)) return habit;
    changed = true;
    return applyHabitLifecycleCommand(habit, { id: `habit-observed:${crypto.randomUUID()}`, habitId: habit.id, at, action: "observe", heads: [] });
  });
  return changed ? { ...next, habits } : next;
}
import type { Language } from "./i18n";
import { habitIntervalTimes, habitIntervalMarks, normalizeHabitInterval, normalizeHabitCompletedTimes, type HabitIntervalSchedule } from "./habit-interval";
import { effectiveHabitMeasurement, habitMeasurementProgress, habitRuleForDate, mergeHabitMeasurementEvents, newHabitMeasurementEvent,
  normalizeHabitMeasurement, normalizeHabitRuleHistory,
  type HabitMeasurement, type HabitMeasurementEvent, type HabitRuleVersion } from "./habit-measurement";
import { normalizeHabitPeriodGoal, type HabitPeriodGoal } from "./habit-period-goal";
import { habitPeriodProgress, habitPeriodSettlement, habitQuestCompletions } from "./habit-period-progress";
import { isCivilDate, momentCivilDate, resolveCalendarWallTime } from "./calendar-context";
import { appendHabitTimerOperation, mergeHabitTimerOperations, habitTimerEpoch, habitWorkspaceEpoch, habitTimerMeasurementIds, habitTimerSessions, type HabitTimerOperation } from "./habit-timer";
import { habitRuleState } from "./habit-rule-history";
import { habitEconomyHistory, mergeHabitHistoryEdits, projectHabitHistory, type HabitHistoryEdit } from "./habit-history";
import { applyHabitLifecycleCommand, habitLifecycleState, mergeHabitLifecycleEvents, projectHabitLifecycle,
  type HabitLifecycleEvent, type HabitLifecycleCommand } from "./habit-lifecycle";
import {
  normalizeAddictionEntry,
  normalizeAddictionTracker,
  scoreAddictionEntry,
  type AddictionEntry,
  type AddictionTracker,
} from "./addiction-tracker";
import { normalizeMoodEntries, type MoodEntry } from "./mood-tracker";
import {
  normalizeSleepEntry,
  normalizeSleepPlan,
  scoreSleepEntry,
  sleepDeviationMinutes,
  sleepDurationMinutes,
  type SleepEntry,
  type SleepPlan,
} from "./sleep-tracker";
import {
  defaultTrackerSchedule,
  isTrackerScheduledForDate,
  markTrackerEntityChanged,
  newTrackerEntity,
  normalizeTrackerEntity,
  normalizeTrackerSchedule,
  trackerTimeZone,
  type TrackerEntity,
  type TrackerSchedule,
} from "./tracker-core";
import { recurrenceModeForCalendar, type RecurrenceConfig } from "./task-recurrence";
import type { TrackerAnalyticsSnapshot } from "./tracker-analytics";
import { scoreHabitFormula } from "./tracker-math";
import {
  buildDailyGoalRecord,
  calculateGlobalStreak,
  calculateRhythmScore,
  dailyGoalModeForDate,
  normalizeDailyGoalModeChanges,
  normalizeDailyGoalRecords,
  scheduleDailyGoalMode,
  upsertDailyGoalRecord,
  type DailyGoalMode,
  type DailyGoalModeChange,
  type DailyGoalRecord,
} from "./daily-goal";
import {
  completionXpAward,
  HEROIC_RANKS,
  HERO_PATH_CHECKPOINTS,
  hiddenHeroicPathUnlocked,
  MAX_HABIT_XP_PER_COMPLETION,
  reconcileUserProgress,
  type UserProgress,
} from "./habit-progress";
import {
  canRecordHabitOnDate,
  DEFAULT_HABIT_EMOJI,
  DEFAULT_HABIT_PRIORITY,
  normalizeHabitColor,
  normalizeHabitEmoji,
  normalizeHabitPriority,
} from "./habit-integrity";
import {
  calculateLaurelsBalance,
  createRewardTransaction,
  normalizeRewardTransactions,
  reconcileDailyGoalRewards,
  type RewardTransaction,
} from "./rewards";
import {
  applyAutomaticStreakProtection,
  calculateStreakFreezeCount,
  normalizeStreakFreezeTransactions,
  purchaseHestiaSpark,
  reconcileComebackRewards,
  type StreakFreezeTransaction,
} from "./streak-protection";
import {
  HABIT_COLORS,
  STARTER_HABIT_TEMPLATES,
  isHabitTemplateId,
  starterTemplateRecurrencePreset,
  type HabitTemplate,
  type HabitTemplateId,
} from "./habit-templates";
import {
  SACRED_PRACTICES,
  isSacredPracticeId,
  type SacredPractice,
  type SacredPracticeSectorId,
} from "./sacred-practices";
import {
  normalizeHabitQuests,
  habitQuestWeek,
  habitQuestMonth,
  reconcileHabitQuestRewards,
  reconcileHabitQuests,
  type HabitQuest,
} from "./habit-quests";
import {
  normalizeAchievementUnlocks,
  reconcileAchievementUnlocks,
  type AchievementUnlock,
} from "./achievements";
import {
  DEFAULT_HABIT_NOTIFICATION_SETTINGS,
  normalizeHabitNotificationSettings,
  type HabitNotificationSettings,
} from "./habit-notifications";
import {
  applyHabitDeletionLaurelPolicy,
  reconcileOrphanedHabitLaurels,
} from "./habit-laurel-retention";
import {
  normalizeHabitRitualId,
  normalizeHabitRitualName,
  normalizeKeyHabitSelection,
  suggestedHabitRitual,
  type HabitRitualId,
} from "./habit-guidance";
import { reconcileStreakMilestoneRewards } from "./streak-rewards";
import {
  DEFAULT_HABIT_FEEDBACK_SETTINGS,
  normalizeHabitFeedbackSettings,
  type HabitFeedbackSettings,
} from "./habit-feedback";
import {
  DEFAULT_HABIT_SECTION_ORDER,
  normalizeHabitCollapsedSections,
  normalizeHabitSectionOrder,
  type HabitSectionId,
} from "./habit-section-state";

export { HABIT_COLORS, STARTER_HABIT_TEMPLATES } from "./habit-templates";
export type { HabitTemplate, HabitTemplateId } from "./habit-templates";
export { FOUNDATIONAL_HEROIC_RANKS, HEROIC_RANKS, HERO_PATH_CHECKPOINTS, HIDDEN_HEROIC_RANKS, MAX_HABIT_XP_PER_COMPLETION, completionXpAward, heroicRank, heroicRankForProgress, hiddenHeroicPathRevealed, hiddenHeroicPathUnlocked, nextHeroicRank, nextHeroicRankForProgress, visibleHeroicRanksForXp } from "./habit-progress";
export type { HeroicRank, HeroicRankId, HeroPathCheckpoint, UserProgress } from "./habit-progress";
export { DEFAULT_HABIT_EMOJI, DEFAULT_HABIT_PRIORITY, HABIT_EMOJI_CATEGORIES, HABIT_EMOJI_PRESETS, canRecordHabitOnDate, normalizeHabitColor, normalizeHabitEmoji, normalizeHabitPriority } from "./habit-integrity";
export type { RewardCurrency, RewardReason, RewardTransaction } from "./rewards";
export { DAILY_GOAL_LAURELS, PERFECT_DAY_LAURELS, laurelsForDailyGoal, resetLaurelsBalance } from "./rewards";
export { COMEBACK_REWARD_LAURELS, COMEBACK_TARGET_DAYS, HESTIA_SPARK_COST, HESTIA_SPARK_MAX, calculateComebackSummary, calculateStreakFreezeCount } from "./streak-protection";
export type { ComebackSummary, StreakFreezeReason, StreakFreezeTransaction } from "./streak-protection";
export { DAILY_QUEST_LAURELS, EPIC_QUEST_LAURELS, WEEKLY_QUEST_LAURELS, currentHabitQuests, habitQuestMonth, habitQuestWeek } from "./habit-quests";
export type { HabitQuest, HabitQuestCadence, HabitQuestKind } from "./habit-quests";
export { ACHIEVEMENTS, achievementMetrics } from "./achievements";
export type { AchievementDefinition, AchievementId, AchievementUnlock } from "./achievements";
export { HABIT_RITUAL_OPTIONS, buildAdaptiveHabitSuggestions, groupHabitsByRitual, habitRitualLabel, normalizeKeyHabitSelection } from "./habit-guidance";
export type { AdaptiveHabitSuggestion, HabitRitualGroup, HabitRitualId } from "./habit-guidance";
export { STREAK_REWARD_MILESTONES, claimedStreakMilestones } from "./streak-rewards";
export type { StreakRewardMilestone } from "./streak-rewards";
export { HABIT_LAUREL_RETENTION_COMPLETIONS, habitCompletionCount, habitRetainsLaurelsOnDeletion } from "./habit-laurel-retention";
export { dailyGoalTarget } from "./daily-goal";
export type { DailyGoalMode, DailyGoalModeChange, DailyGoalRecord, DailyGoalStatus } from "./daily-goal";
export { DEFAULT_HABIT_FEEDBACK_SETTINGS } from "./habit-feedback";
export type { HabitFeedbackSettings } from "./habit-feedback";
export {
  HABIT_SECTION_IDS,
  isHabitSectionId,
  moveHabitSection,
  normalizeHabitCollapsedSections,
  normalizeHabitSectionOrder,
} from "./habit-section-state";
export type { HabitSectionId } from "./habit-section-state";

export type HabitQualityScale = "none" | "ten" | "bipolar";
export type HabitScoringMode = "none" | "binary" | "quality-ten" | "quality-bipolar";
export type HabitReportRange = "week" | "days-30" | "month" | "quarter" | "year" | "custom";

export type HabitReminder = {
  enabled: boolean;
  time: string;
  timing?: "habit" | "custom";
  minutesBefore?: number;
  allowDuringQuietHours?: boolean;
  syncToGoogleTasks: boolean;
  showInGoogleCalendar: boolean;
  googleTaskId: string | null;
  googleEventId: string | null;
};

export type Habit = TrackerEntity & {
  autoDeletePolicy?: HabitAutoDeletePolicy | null;
  /** Native per-habit control; retained by the shared encrypted document normalizer. */
  timerEnabled?: boolean;
  timerPreferences?: HabitTimerPreferences | null;
  title: string;
  description: string;
  createdDate: string;
  emoji: string;
  priority: number;
  isKeyHabit: boolean;
  ritualId: HabitRitualId;
  ritualName: string;
  color: string;
  active: boolean;
  sourceTemplateId: HabitTemplateId | null;
  lifecycleHistory?: HabitLifecycleEvent[];
  sacredPracticeId: string | null;
  sacredSectorId: SacredPracticeSectorId | null;
  stoicheionRestoration?: RestorationSnapshot | null;
  practiceGoal?: HabitPracticeGoal | null;
  preferredTime: string;
  intervalSchedule?: HabitIntervalSchedule | null;
  measurement?: HabitMeasurement | null;
  ruleHistory?: HabitRuleVersion[];
  periodGoal?: HabitPeriodGoal | null;
  schedule: TrackerSchedule;
  scoringMode: HabitScoringMode;
  qualityScale: HabitQualityScale;
  reminder: HabitReminder;
};

export type HabitCompletion = TrackerEntity & {
  habitId: string;
  date: string;
  completed: boolean;
  skippedAt?: string | null;
  completedTimes?: string[];
  qualityValue: number | null;
  qualityConfirmedAt?: string | null;
  score: number;
  xpAwarded: number;
  note: string;
};

export type HabitSettings = {
  enabled: boolean;
  reportRange: HabitReportRange;
  customRangeStart: string;
  customRangeEnd: string;
  collapsedSections: HabitSectionId[];
  sectionOrder: HabitSectionId[];
  dailyGoalModeChanges: DailyGoalModeChange[];
  plannedRestDays: string[];
  notifications: HabitNotificationSettings;
  feedback: HabitFeedbackSettings;
};

export type HabitWorkspace = {
  trackerSchemaVersion: 16;
  userProgress: UserProgress;
  habits: Habit[];
  habitCompletions: HabitCompletion[];
  habitMeasurements: HabitMeasurementEvent[];
  habitTimers: HabitTimerOperation[];
  habitHistory: HabitHistoryEdit[];
  habitTimerEpoch: string;
  sleepPlans: SleepPlan[];
  sleepEntries: SleepEntry[];
  moodEntries: MoodEntry[];
  addictionTrackers: AddictionTracker[];
  addictionEntries: AddictionEntry[];
  analyticsSnapshots: TrackerAnalyticsSnapshot[];
  dailyGoalRecords: DailyGoalRecord[];
  quests: HabitQuest[];
  achievementUnlocks: AchievementUnlock[];
  rewardTransactions: RewardTransaction[];
  streakFreezeTransactions: StreakFreezeTransaction[];
  habitSettings: HabitSettings;
  hiddenDefaultTemplates: HabitTemplateId[];
};

type LegacyHabitSchedule = {
  calendarMode?: CalendarMode;
  cadence?: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  days?: number[];
  startDate?: string;
  endDate?: string | null;
};

type LegacyHabit = Partial<TrackerEntity> & {
  autoDeletePolicy?: HabitAutoDeletePolicy | null;
  timerEnabled?: boolean;
  timerPreferences?: HabitTimerPreferences | null;
  lifecycleHistory?: HabitLifecycleEvent[];
  id?: string;
  title?: string;
  description?: string;
  createdDate?: string;
  emoji?: string;
  priority?: number;
  isKeyHabit?: boolean;
  ritualId?: HabitRitualId;
  ritualName?: string;
  kind?: "positive" | "negative" | "monitor" | "sleep" | "wake";
  color?: string;
  active?: boolean;
  sourceTemplateId?: HabitTemplateId | null;
  sacredPracticeId?: string | null;
  sacredSectorId?: SacredPracticeSectorId | null;
  stoicheionRestoration?: RestorationSnapshot | null;
  practiceGoal?: HabitPracticeGoal | null;
  preferredTime?: string;
  intervalSchedule?: HabitIntervalSchedule | null;
  measurement?: HabitMeasurement | null;
  ruleHistory?: HabitRuleVersion[];
  periodGoal?: HabitPeriodGoal | null;
  scoringEnabled?: boolean;
  completionPoints?: number;
  failurePoints?: number;
  negativePoints?: number;
  qualityScale?: HabitQualityScale;
  schedule?: LegacyHabitSchedule | TrackerSchedule;
  reminder?: Partial<HabitReminder> & { syncToGoogle?: boolean };
  timeRules?: Array<{ id?: string; operator?: "before" | "after"; threshold?: string; points?: number }>;
};

type LegacyHabitEntry = Partial<TrackerEntity> & {
  skippedAt?: string | null;
  qualityConfirmedAt?: string | null;
  id?: string;
  habitId?: string;
  date?: string;
  completed?: boolean;
  completedTimes?: string[];
  quality?: number | null;
  qualityValue?: number | null;
  time?: string;
  note?: string;
  score?: number;
  xpAwarded?: number;
};

type HabitWorkspaceInput = Partial<HabitWorkspace> & {
  habitEntries?: LegacyHabitEntry[];
  habits?: LegacyHabit[] | Habit[];
  moodEntries?: unknown[];
};

export const DEFAULT_HABIT_SETTINGS: HabitSettings = {
  enabled: true,
  reportRange: "month",
  customRangeStart: "",
  customRangeEnd: "",
  collapsedSections: [],
  sectionOrder: DEFAULT_HABIT_SECTION_ORDER,
  dailyGoalModeChanges: [],
  plannedRestDays: [],
  notifications: DEFAULT_HABIT_NOTIFICATION_SETTINGS,
  feedback: DEFAULT_HABIT_FEEDBACK_SETTINGS,
};

export const EMPTY_HABIT_WORKSPACE: HabitWorkspace = {
  trackerSchemaVersion: 16,
  userProgress: {
    lifetimeXp: 0,
    laurelsBalance: 0,
    currentRankId: null,
    hiddenHeroicPathRevealedAt: null,
    currentStreak: 0,
    longestStreak: 0,
    lastQualifiedDate: null,
    streakGoalMode: "rhythm",
    streakFreezeCount: 0,
    rhythmScore: 0,
    updatedAt: "",
  },
  habits: [],
  habitCompletions: [],
  habitMeasurements: [],
  habitTimers: [],
  habitHistory: [],
  habitTimerEpoch: "",
  sleepPlans: [],
  sleepEntries: [],
  moodEntries: [],
  addictionTrackers: [],
  addictionEntries: [],
  analyticsSnapshots: [],
  dailyGoalRecords: [],
  quests: [],
  achievementUnlocks: [],
  rewardTransactions: [],
  streakFreezeTransactions: [],
  habitSettings: DEFAULT_HABIT_SETTINGS,
  hiddenDefaultTemplates: [],
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function habitDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function habitDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function addHabitDays(value: string, days: number) {
  const date = habitDate(value);
  date.setDate(date.getDate() + days);
  return habitDateKey(date);
}

function legacyDays(days: number[], calendarMode: CalendarMode) {
  if (calendarMode === "profane") return days.map((day) => day === 0 ? 7 : day).filter((day) => day >= 1 && day <= 7);
  return days.map((day) => day + 1);
}

function legacySchedule(value: LegacyHabitSchedule | TrackerSchedule | undefined, fallbackDate: string, accountCalendarMode: CalendarMode): TrackerSchedule {
  if (value && "recurrence" in value) return normalizeTrackerSchedule(value, fallbackDate, accountCalendarMode);
  const schedule = value as LegacyHabitSchedule | undefined;
  const startDate = DATE_PATTERN.test(schedule?.startDate ?? "") ? schedule!.startDate! : fallbackDate;
  const calendarMode = ["profane", "sacred", "lunar"].includes(schedule?.calendarMode ?? "")
    ? schedule!.calendarMode!
    : accountCalendarMode;
  const mode = recurrenceModeForCalendar(calendarMode);
  const cadence = schedule?.cadence ?? "daily";
  const pattern: RecurrenceConfig["pattern"] = mode === "classic"
    ? cadence === "weekly" ? "weekdays" : cadence
    : mode === "lunar" ? "lunar-days" : cadence === "monthly" ? "month-days" : "pyata-days";
  const days = Array.isArray(schedule?.days) && schedule!.days!.length
    ? legacyDays(schedule!.days!, calendarMode)
    : mode === "classic" && pattern === "weekdays"
      ? [((habitDate(startDate).getDay() + 6) % 7) + 1]
      : [1];
  return {
    startDate,
    endDate: DATE_PATTERN.test(schedule?.endDate ?? "") ? schedule!.endDate! : null,
    timezone: trackerTimeZone(),
    recurrence: {
      enabled: true,
      mode,
      pattern,
      days,
      interval: Math.max(1, Math.round(Number(schedule?.interval) || 1)),
      rangeStart: startDate,
      rangeEnd: DATE_PATTERN.test(schedule?.endDate ?? "") ? schedule!.endDate! : "",
      months: [],
      pyatas: [],
    },
  };
}

function normalizeReminder(value: LegacyHabit["reminder"], preferredTime = ""): HabitReminder {
  return {
    enabled: value?.enabled === true,
    time: typeof value?.time === "string" ? value.time : "09:00",
    timing: value?.timing === "custom" || (!value?.timing && preferredTime && value?.time && value.time !== preferredTime) ? "custom" : "habit",
    minutesBefore: Math.min(1440, Math.max(0, Math.trunc(Number(value?.minutesBefore) || 0))),
    allowDuringQuietHours: value?.allowDuringQuietHours === true,
    syncToGoogleTasks: value?.syncToGoogleTasks === true || value?.syncToGoogle === true,
    showInGoogleCalendar: value?.showInGoogleCalendar === true,
    googleTaskId: typeof value?.googleTaskId === "string" && value.googleTaskId ? value.googleTaskId : null,
    googleEventId: typeof value?.googleEventId === "string" && value.googleEventId ? value.googleEventId : null,
  };
}

function normalizeHiddenDefaultTemplates(value: unknown): HabitTemplateId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isHabitTemplateId)));
}

function legacyScoringMode(value: LegacyHabit): HabitScoringMode {
  if (value.scoringEnabled === false || value.kind === "monitor") return "none";
  if (value.qualityScale === "ten") return "quality-ten";
  if (value.qualityScale === "bipolar") return "quality-bipolar";
  return "binary";
}

function normalizeHabit(value: LegacyHabit, fallbackDate: string, calendarMode: CalendarMode): Habit | null {
  if (typeof value.id !== "string" || !value.id || typeof value.title !== "string" || !value.title) return null;
  const scoringMode = ["none", "binary", "quality-ten", "quality-bipolar"].includes(String((value as Habit).scoringMode))
    ? (value as Habit).scoringMode
    : legacyScoringMode(value);
  const qualityScale: HabitQualityScale = scoringMode === "quality-ten" ? "ten" : scoringMode === "quality-bipolar" ? "bipolar" : "none";
  const normalizedSchedule = legacySchedule(value.schedule, fallbackDate, calendarMode);
  const createdDate = DATE_PATTERN.test(value.createdDate ?? "") ? value.createdDate! : normalizedSchedule.startDate;
  const sourceTemplateId = isHabitTemplateId(value.sourceTemplateId) ? value.sourceTemplateId : null;
  const sacredPracticeId = isSacredPracticeId(value.sacredPracticeId) ? value.sacredPracticeId : null;
  const sacredSectorId = sacredPracticeId ? SACRED_PRACTICES.find((practice) => practice.id === sacredPracticeId)?.sectorId ?? null : null;
  const templateEmoji = STARTER_HABIT_TEMPLATES.find((template) => template.id === sourceTemplateId)?.icon;
  const measurement = normalizeHabitMeasurement(value.measurement);
  const periodGoal = normalizeHabitPeriodGoal(value.periodGoal);
  if (periodGoal?.metric === "sum" && !measurement) throw new RangeError("HABIT_PERIOD_MEASUREMENT_REQUIRED");
  const schedule: TrackerSchedule = {
    ...normalizedSchedule,
    startDate: createdDate,
    recurrence: { ...normalizedSchedule.recurrence, rangeStart: createdDate },
  };
  return {
    ...normalizeTrackerEntity(value, "habit"),
    title: value.title,
    ...(value.autoDeletePolicy !== undefined ? { autoDeletePolicy: normalizeHabitAutoDelete(value.autoDeletePolicy) } : {}),
    ...(value.timerEnabled === false ? { timerEnabled: false } : {}),
    ...(value.timerPreferences != null ? { timerPreferences: normalizeHabitTimerPreferences(value.timerPreferences) } : {}),
    description: typeof value.description === "string" ? value.description : "",
    createdDate,
    emoji: normalizeHabitEmoji(value.emoji ?? templateEmoji),
    priority: normalizeHabitPriority(value.priority),
    isKeyHabit: value.isKeyHabit === true,
    ritualId: normalizeHabitRitualId(value.ritualId),
    ritualName: normalizeHabitRitualName(value.ritualName),
    color: normalizeHabitColor(value.color, HABIT_COLORS[0]),
    active: value.active !== false,
    lifecycleHistory: mergeHabitLifecycleEvents(value.lifecycleHistory),
    sourceTemplateId,
    sacredPracticeId,
    sacredSectorId,
    stoicheionRestoration: normalizeRestorationSnapshot(value.stoicheionRestoration),
    ...(value.practiceGoal ? { practiceGoal: normalizePracticeGoal(value.practiceGoal) } : {}),
    preferredTime: TIME_PATTERN.test(value.preferredTime ?? "") ? value.preferredTime! : "",
    intervalSchedule: normalizeHabitInterval(value.intervalSchedule),
    measurement,
    periodGoal,
    ruleHistory: normalizeHabitRuleHistory(value.ruleHistory),
    schedule,
    scoringMode,
    qualityScale,
    reminder: normalizeReminder(value.reminder, value.preferredTime),
  };
}

export function scoreHabitCompletion(habit: Habit, completion: Pick<HabitCompletion, "completed" | "qualityValue">) {
  return scoreHabitFormula(habit.scoringMode, completion.completed, completion.qualityValue);
}

export function updateHabitCompletion(
  workspace: HabitWorkspace,
  habit: Habit,
  date: string,
  patch: Partial<HabitCompletion>,
  today = habitDateKey(new Date()),
) {
  if (!canRecordHabitOnDate(habit.createdDate, date, today)) return workspace;
  const currentHabit = workspace.habits.find(row => row.id === habit.id);
  if (!currentHabit?.active || !isHabitScheduledForDate(currentHabit, date, "sacred", workspace.habitCompletions)) return workspace;
  habit = currentHabit;
  if (habitRuleState(habit, date).conflicts.length) throw new RangeError("HABIT_RULE_CONFLICT");
  const current = workspace.habitCompletions.find((entry) => entry.habitId === habit.id && entry.date === date);
  const base: HabitCompletion = current ?? {
    ...newTrackerEntity("habit-completion"),
    id: `habit-completion:${habit.id}:${date}`,
    habitId: habit.id,
    date,
    completed: false,
    qualityValue: null,
    score: 0,
    xpAwarded: 0,
    note: "",
  };
  const patched = markTrackerEntityChanged({ ...base, ...patch,
    ...(patch.completed === true ? { skippedAt: null } : {}),
    ...(habit.intervalSchedule?.completionMode === "each" && patch.completed !== undefined ? {
      completedTimes: patch.completedTimes !== undefined ? normalizeHabitCompletedTimes(patch.completedTimes)
        : patch.completed ? habitIntervalTimes(habit.intervalSchedule) : [],
    } : {}),
    ...(base.qualityConfirmedAt ? { qualityValue: base.qualityValue, qualityConfirmedAt: base.qualityConfirmedAt } : {}) });
  if (effectiveHabitMeasurement(habitRuleForDate(habit, date))) {
    const progress = habitMeasurementProgress(habit, date, workspace.habitMeasurements ?? []);
    patched.completed = progress.completed && (habit.qualityScale === "none" || Boolean(patched.qualityConfirmedAt));
  }
  const score = scoreHabitCompletion(habit, patched);
  const measured = effectiveHabitMeasurement(habitRuleForDate(habit, date));
  const measuredProgress = measured ? habitMeasurementProgress(habit, date, workspace.habitMeasurements ?? []) : null;
  const rewardEligible = !measured || date === today
    && measuredProgress!.rewardTotal >= measuredProgress!.target;
  const entry = { ...patched, score, xpAwarded: rewardEligible
    ? completionXpAward(base.xpAwarded, score, MAX_HABIT_XP_PER_COMPLETION) : base.xpAwarded };
  return {
    ...workspace,
    habitCompletions: [
      ...workspace.habitCompletions.filter((item) => !(item.habitId === habit.id && item.date === date)),
      entry,
    ],
  };
}

/** Append-only corrections keep both conflicting edits until the user resolves their heads. */
export function recordHabitMeasurement(workspace: HabitWorkspace, habit: Habit, date: string,
  value: number | null, options: Parameters<typeof newHabitMeasurementEvent>[3] = {},
  today = habitDateKey(new Date())): HabitWorkspace {
  const currentHabit = workspace.habits.find(row => row.id === habit.id);
  if (!currentHabit?.active) throw new RangeError("HABIT_MEASUREMENT_DATE_UNAVAILABLE");
  habit = currentHabit;
  const timerHistory = options.source === "timer" && isCivilDate(date) && date >= habit.createdDate && date <= today;
  if ((!canRecordHabitOnDate(habit.createdDate, date, today) && !timerHistory)
    || !isHabitScheduledForDate(habit, date, "sacred", workspace.habitCompletions))
    throw new RangeError("HABIT_MEASUREMENT_DATE_UNAVAILABLE");
  if (!effectiveHabitMeasurement(habitRuleForDate(habit, date))) throw new RangeError("HABIT_MEASUREMENT_NOT_ENABLED");
  if (!habitRuleForDate(habit, date).measurement && value !== null && value !== 1000)
    throw new RangeError("INVALID_HABIT_MEASUREMENT_EVENT");
  const replay = options.id && workspace.habitMeasurements?.find(event => event.id === options.id);
  if (replay) {
    if (replay.habitId !== habit.id || replay.date !== date || replay.value !== value
      || replay.entryId !== (options.entryId ?? options.id)
      || JSON.stringify(replay.replaces) !== JSON.stringify([...(options.replaces ?? [])].sort()))
      throw new RangeError("HABIT_MEASUREMENT_ID_CONFLICT");
    return workspace;
  }
  const event = newHabitMeasurementEvent(habit, date, value, { ...options, historical: date < today || options.historical });
  const current = habitMeasurementProgress(habit, date, workspace.habitMeasurements ?? []);
  if (options.entryId) {
    const entry = current.entries.find(item => item.id === options.entryId);
    const expected = entry?.heads.map(item => item.id).sort() ?? [];
    if (!entry || JSON.stringify(expected) !== JSON.stringify([...new Set(options.replaces ?? [])].sort()))
      throw new RangeError("HABIT_MEASUREMENT_EDIT_CONFLICT");
  } else if (value === null || options.replaces?.length) throw new RangeError("INVALID_HABIT_MEASUREMENT_EVENT");
  const habitMeasurements = mergeHabitMeasurementEvents(workspace.habitMeasurements ?? [], [event]);
  // Validate overflow before writing anything; partial history is never committed.
  habitMeasurementProgress(habit, date, habitMeasurements);
  return updateHabitCompletion({ ...workspace, habitMeasurements }, habit, date, {}, today);
}

export function updateHabitIntervalCompletion(workspace: HabitWorkspace, habit: Habit, date: string,
  time: string, completed: boolean, today = habitDateKey(new Date())) {
  if (habit.intervalSchedule?.completionMode !== "each") return workspace;
  const times = habitIntervalTimes(habit.intervalSchedule);
  if (!times.includes(time)) return workspace;
  const current = workspace.habitCompletions.find(entry => entry.habitId === habit.id && entry.date === date);
  const marks = new Set(habitIntervalMarks(habit.intervalSchedule, current));
  if (completed) marks.add(time); else marks.delete(time);
  return updateHabitCompletion(workspace, habit, date, {
    completed: times.every(value => marks.has(value)) && (habit.qualityScale === "none" || Boolean(current?.qualityConfirmedAt)), completedTimes: [...marks].sort(),
  }, today);
}

function normalizeHabitCompletion(value: LegacyHabitEntry, habits: Map<string, Habit>): HabitCompletion | null {
  const habitId = typeof value.habitId === "string" ? value.habitId : "";
  const date = typeof value.date === "string" ? value.date : "";
  const habit = habits.get(habitId);
  if (!habit || !DATE_PATTERN.test(date) || date < habit.createdDate) return null;
  if (value.skippedAt != null && (typeof value.skippedAt !== "string" || !Number.isFinite(Date.parse(value.skippedAt)))) throw new RangeError("INVALID_HABIT_HISTORY");
  const qualityValue = typeof value.qualityValue === "number"
    ? value.qualityValue
    : typeof value.quality === "number" ? value.quality : null;
  const completion = {
    completed: value.completed === true,
    qualityValue,
  };
  const score = scoreHabitCompletion(habit, completion);
  return {
    ...normalizeTrackerEntity(value, "habit-completion"),
    habitId,
    date,
    ...completion,
    completedTimes: normalizeHabitCompletedTimes(value.completedTimes),
    ...(value.skippedAt ? { skippedAt: value.skippedAt } : {}),
    qualityConfirmedAt: typeof value.qualityConfirmedAt === "string" ? value.qualityConfirmedAt : null,
    score,
    xpAwarded: typeof value.xpAwarded === "number"
      ? completionXpAward(value.xpAwarded, 0, MAX_HABIT_XP_PER_COMPLETION)
      : completionXpAward(0, score, MAX_HABIT_XP_PER_COMPLETION),
    note: typeof value.note === "string" ? value.note : "",
  };
}

function migrateSleepPlan(value: LegacyHabit, fallbackDate: string, calendarMode: CalendarMode): SleepPlan | null {
  if (typeof value.id !== "string" || !value.id || (value.kind !== "sleep" && value.kind !== "wake")) return null;
  const relevantRule = value.timeRules?.find((rule) => typeof rule.threshold === "string");
  return normalizeSleepPlan({
    ...value,
    id: `sleep-plan-${value.id}`,
    title: value.title || (value.kind === "sleep" ? "Отход ко сну" : "Пробуждение"),
    schedule: legacySchedule(value.schedule, fallbackDate, calendarMode),
    targetBedtime: value.kind === "sleep" ? relevantRule?.threshold ?? "23:00" : "23:00",
    targetWakeTime: value.kind === "wake" ? relevantRule?.threshold ?? "07:00" : "07:00",
    qualityEnabled: value.qualityScale !== "none",
    scoringEnabled: value.scoringEnabled === true,
    rules: (value.timeRules ?? []).map((rule, index) => ({
      id: rule.id || `sleep-rule-${index}`,
      field: value.kind === "sleep" ? "bedtime" : "wake",
      operator: rule.operator === "after" ? "after" : "on-or-before",
      threshold: rule.threshold || (value.kind === "sleep" ? "23:00" : "07:00"),
      points: Math.round(Number(rule.points) || 0),
    })),
  }, fallbackDate, calendarMode);
}

function migrateAddictionTracker(value: LegacyHabit, fallbackDate: string, calendarMode: CalendarMode): AddictionTracker | null {
  if (typeof value.id !== "string" || !value.id || value.kind !== "negative") return null;
  return normalizeAddictionTracker({
    ...value,
    id: `addiction-${value.id}`,
    trackedBehavior: value.title || "Наблюдаемое поведение",
    status: value.active === false ? "paused" : "active",
    schedule: legacySchedule(value.schedule, fallbackDate, calendarMode),
    cleanDayPoints: 10,
    relapsePenalty: Math.abs(Math.round(Number(value.negativePoints ?? value.failurePoints) || 0)),
  }, fallbackDate, calendarMode);
}

function migrateSleepEntry(value: LegacyHabitEntry, legacyHabit: LegacyHabit, plan: SleepPlan): SleepEntry | null {
  const date = typeof value.date === "string" ? value.date : "";
  if (!DATE_PATTERN.test(date)) return null;
  const fellAsleepAt = legacyHabit.kind === "sleep" && typeof value.time === "string" ? value.time : "";
  const wokeAt = legacyHabit.kind === "wake" && typeof value.time === "string" ? value.time : "";
  const draft = { date, fellAsleepAt, wokeAt };
  return {
    ...normalizeTrackerEntity(value, "sleep-entry"),
    id: `sleep-entry-${value.id ?? `${plan.id}-${date}`}`,
    planId: plan.id,
    ...draft,
    durationMinutes: sleepDurationMinutes(date, fellAsleepAt, wokeAt, plan.schedule.timezone),
    quality: typeof value.quality === "number" ? Math.max(1, Math.min(10, Math.round(value.quality))) : null,
    deviationMinutes: sleepDeviationMinutes(plan, draft),
    note: typeof value.note === "string" ? value.note : "",
    score: scoreSleepEntry(plan, draft),
  };
}

function migrateAddictionEntry(value: LegacyHabitEntry, tracker: AddictionTracker): AddictionEntry | null {
  const date = typeof value.date === "string" ? value.date : "";
  if (!DATE_PATTERN.test(date)) return null;
  const relapse = value.completed === true;
  const draft = { cleanDay: !relapse, relapse };
  return {
    ...normalizeTrackerEntity(value, "addiction-entry"),
    id: `addiction-entry-${value.id ?? `${tracker.id}-${date}`}`,
    trackerId: tracker.id,
    date,
    ...draft,
    cravingIntensity: 0,
    trigger: "",
    note: typeof value.note === "string" ? value.note : "",
    timestamp: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    score: scoreAddictionEntry(tracker, draft),
  };
}

function normalizeSettings(value: Partial<HabitSettings> | undefined): HabitSettings {
  const legacyRange = String(value?.reportRange ?? "month");
  const reportRange: HabitReportRange = legacyRange === "half-year"
    ? "year"
    : ["week", "days-30", "month", "quarter", "year", "custom"].includes(legacyRange)
      ? legacyRange as HabitReportRange
      : "month";
  return {
    ...DEFAULT_HABIT_SETTINGS,
    ...value,
    reportRange,
    collapsedSections: normalizeHabitCollapsedSections(value?.collapsedSections),
    sectionOrder: normalizeHabitSectionOrder(value?.sectionOrder),
    dailyGoalModeChanges: normalizeDailyGoalModeChanges(value?.dailyGoalModeChanges),
    plannedRestDays: Array.isArray(value?.plannedRestDays)
      ? Array.from(new Set(value.plannedRestDays.filter((date) => DATE_PATTERN.test(date)))).sort()
      : [],
    notifications: normalizeHabitNotificationSettings(value?.notifications),
    feedback: normalizeHabitFeedbackSettings(value?.feedback),
  };
}

function normalizeSnapshots(value: unknown): TrackerAnalyticsSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof (item as TrackerAnalyticsSnapshot).id !== "string" || typeof (item as TrackerAnalyticsSnapshot).periodStart !== "string") return [];
    const snapshot = item as TrackerAnalyticsSnapshot;
    const metrics = snapshot.metrics ?? {} as TrackerAnalyticsSnapshot["metrics"];
    return [{
      ...snapshot,
      metrics: {
        scheduled: Number(metrics.scheduled) || 0,
        completed: Number(metrics.completed) || 0,
        score: Number(metrics.score) || 0,
        qualityTotal: Number(metrics.qualityTotal) || 0,
        qualityCount: Number(metrics.qualityCount) || 0,
        sleepTotalMinutes: Number(metrics.sleepTotalMinutes) || 0,
        sleepCount: Number(metrics.sleepCount) || 0,
        sleepQualityTotal: Number(metrics.sleepQualityTotal) || 0,
        sleepQualityCount: Number(metrics.sleepQualityCount) || 0,
        sleepDeviationTotal: Number(metrics.sleepDeviationTotal) || 0,
        sleepBedtimeMinutesTotal: Number(metrics.sleepBedtimeMinutesTotal) || 0,
        sleepWakeMinutesTotal: Number(metrics.sleepWakeMinutesTotal) || 0,
        moodTotal: Number(metrics.moodTotal) || 0,
        moodCount: Number(metrics.moodCount) || 0,
        moodDistribution: Array.from({ length: 12 }, (_, index) => Math.max(0, Number(Array.isArray(metrics.moodDistribution) ? metrics.moodDistribution[index] : 0) || 0)),
        cleanDays: Number(metrics.cleanDays) || 0,
        relapses: Number(metrics.relapses) || 0,
        cravingTotal: Number(metrics.cravingTotal) || 0,
        cravingCount: Number(metrics.cravingCount) || 0,
      },
    }];
  });
}

export function normalizeHabitWorkspace(
  input: HabitWorkspaceInput | null | undefined,
  calendarMode: CalendarMode = "sacred",
): HabitWorkspace {
  const value = input ?? {};
  const fallbackDate = habitDateKey(new Date());
  const rawHabits = Array.isArray(value.habits) ? value.habits as LegacyHabit[] : [];
  const regularRaw = rawHabits.filter((habit) => !["negative", "sleep", "wake"].includes(habit.kind ?? "positive"));
  const habits = normalizeKeyHabitSelection(regularRaw
    .map((habit) => normalizeHabit(habit, fallbackDate, calendarMode))
    .filter((habit): habit is Habit => habit !== null).map(projectHabitLifecycle));
  const habitMap = new Map(habits.map((habit) => [habit.id, habit]));
  const timerEpoch = habitTimerEpoch(value.habitTimerEpoch);
  const habitTimers = mergeHabitTimerOperations(value.habitTimers ?? []).filter(op => op.epoch === timerEpoch);
  const habitHistory = mergeHabitHistoryEdits(value.habitHistory ?? []).filter(row => row.epoch === timerEpoch);
  const timerMeasurementIds = habitTimerMeasurementIds(habitTimerSessions(habitTimers));
  const habitMeasurements = mergeHabitMeasurementEvents(value.habitMeasurements ?? []).filter(event =>
    !event.entryId.startsWith("timer-value:") || timerMeasurementIds.has(event.entryId));
  const rawEntries = Array.isArray(value.habitCompletions)
    ? value.habitCompletions as LegacyHabitEntry[]
    : Array.isArray(value.habitEntries) ? value.habitEntries : [];
  let habitCompletions = rawEntries
    .map((entry) => normalizeHabitCompletion(entry, habitMap))
    .filter((entry): entry is HabitCompletion => entry !== null);
  const measurementDays = new Map(habitMeasurements.map(event => [`${event.habitId}:${event.date}`, event]));
  for (const event of measurementDays.values()) {
    const habit = habitMap.get(event.habitId);
    if (!habit || !effectiveHabitMeasurement(habitRuleForDate(habit, event.date))) continue;
    const progress = habitMeasurementProgress(habit, event.date, habitMeasurements);
    const prior = habitCompletions.find(entry => entry.habitId === habit.id && entry.date === event.date);
    const completed = progress.completed && (habit.qualityScale === "none" || Boolean(prior?.qualityConfirmedAt));
    const base: HabitCompletion = prior ?? { ...newTrackerEntity("habit-completion"),
      id: `habit-completion:${habit.id}:${event.date}`, habitId: habit.id, date: event.date,
      completed: false, qualityValue: null, score: 0, xpAwarded: 0, note: "" };
    const score = scoreHabitCompletion(habit, { ...base, completed });
    const timerDay = habitMeasurements.some(item => item.habitId === habit.id && item.date === event.date && item.source === "timer");
    const eligible = event.date === (timerDay ? momentCivilDate(new Date(),
      progress.rule.periodGoal?.context.timeZone ?? progress.rule.schedule.timezone) : fallbackDate)
      && progress.rewardTotal >= progress.target;
    const projection = { ...base, completed, score,
      xpAwarded: eligible ? completionXpAward(base.xpAwarded, score, MAX_HABIT_XP_PER_COMPLETION) : base.xpAwarded };
    const index = habitCompletions.indexOf(base);
    if (index < 0) habitCompletions.push(projection); else habitCompletions[index] = projection;
  }
  habitCompletions = projectHabitHistory(habits, habitHistory, habitCompletions, habitMeasurements);
  const rewardTransactions = reconcileOrphanedHabitLaurels(
    habits.length,
    normalizeRewardTransactions(value.rewardTransactions),
    new Date().toISOString(),
  );
  const streakFreezeTransactions = normalizeStreakFreezeTransactions(value.streakFreezeTransactions);
  const quests = normalizeHabitQuests(value.quests);
  const achievementUnlocks = normalizeAchievementUnlocks(value.achievementUnlocks);
  const userProgress = reconcileUserProgress(
    value.userProgress,
    practiceXpSources(habits, habitCompletions),
    new Date().toISOString(),
    undefined,
    calculateLaurelsBalance(rewardTransactions),
    calculateStreakFreezeCount(streakFreezeTransactions),
  );

  const explicitSleepPlans = Array.isArray(value.sleepPlans)
    ? value.sleepPlans.map((plan) => normalizeSleepPlan(plan as unknown as Record<string, unknown>, fallbackDate, calendarMode)).filter((plan): plan is SleepPlan => plan !== null)
    : [];
  const migratedSleepPlans = explicitSleepPlans.length ? [] : rawHabits.map((habit) => migrateSleepPlan(habit, fallbackDate, calendarMode)).filter((plan): plan is SleepPlan => plan !== null);
  const sleepPlans = [...explicitSleepPlans, ...migratedSleepPlans];
  const sleepPlanMap = new Map(sleepPlans.map((plan) => [plan.id, plan]));
  const explicitSleepEntries = Array.isArray(value.sleepEntries)
    ? value.sleepEntries.map((entry) => normalizeSleepEntry(entry as unknown as Record<string, unknown>, sleepPlanMap)).filter((entry): entry is SleepEntry => entry !== null)
    : [];
  const migratedSleepEntries = explicitSleepEntries.length ? [] : rawEntries.flatMap((entry) => {
    const habit = rawHabits.find((item) => item.id === entry.habitId);
    const plan = habit ? sleepPlanMap.get(`sleep-plan-${habit.id}`) : undefined;
    const migrated = habit && plan ? migrateSleepEntry(entry, habit, plan) : null;
    return migrated ? [migrated] : [];
  });

  const explicitAddictionTrackers = Array.isArray(value.addictionTrackers)
    ? value.addictionTrackers.map((tracker) => normalizeAddictionTracker(tracker as unknown as Record<string, unknown>, fallbackDate, calendarMode)).filter((tracker): tracker is AddictionTracker => tracker !== null)
    : [];
  const migratedAddictionTrackers = explicitAddictionTrackers.length ? [] : rawHabits.map((habit) => migrateAddictionTracker(habit, fallbackDate, calendarMode)).filter((tracker): tracker is AddictionTracker => tracker !== null);
  const addictionTrackers = [...explicitAddictionTrackers, ...migratedAddictionTrackers];
  const addictionMap = new Map(addictionTrackers.map((tracker) => [tracker.id, tracker]));
  const explicitAddictionEntries = Array.isArray(value.addictionEntries)
    ? value.addictionEntries.map((entry) => normalizeAddictionEntry(entry as unknown as Record<string, unknown>, addictionMap)).filter((entry): entry is AddictionEntry => entry !== null)
    : [];
  const migratedAddictionEntries = explicitAddictionEntries.length ? [] : rawEntries.flatMap((entry) => {
    const habit = rawHabits.find((item) => item.id === entry.habitId);
    const tracker = habit ? addictionMap.get(`addiction-${habit.id}`) : undefined;
    const migrated = tracker ? migrateAddictionEntry(entry, tracker) : null;
    return migrated ? [migrated] : [];
  });

  const workspace: HabitWorkspace = {
    trackerSchemaVersion: 16,
    userProgress,
    habits,
    habitCompletions,
    habitMeasurements,
    habitTimers,
    habitHistory,
    habitTimerEpoch: habitWorkspaceEpoch(value.habitTimerEpoch, habitHistory.length > 0, habits.some(habit => habit.lifecycleHistory?.length)
      || habitHistory.some(row => row.source === "decision") || habitCompletions.some(row => row.skippedAt)),
    sleepPlans,
    sleepEntries: [...explicitSleepEntries, ...migratedSleepEntries],
    moodEntries: normalizeMoodEntries(value.moodEntries),
    addictionTrackers,
    addictionEntries: [...explicitAddictionEntries, ...migratedAddictionEntries],
    analyticsSnapshots: normalizeSnapshots(value.analyticsSnapshots),
    dailyGoalRecords: normalizeDailyGoalRecords(value.dailyGoalRecords),
    quests,
    achievementUnlocks,
    rewardTransactions,
    streakFreezeTransactions,
    habitSettings: normalizeSettings(value.habitSettings),
    hiddenDefaultTemplates: normalizeHiddenDefaultTemplates(value.hiddenDefaultTemplates),
  };
  return ensureDailyGoalProgress(reconcileHabitAutoDeletePoints(reconcileHabitAutoDeleteEvidence(workspace)), calendarMode);
}

export function isHabitScheduledForDate(habit: Habit, value: string, calendarMode: CalendarMode = "sacred", completions: readonly HabitCompletion[] = []) {
  const state = habitRuleState(habit, value);
  const lifecycle = habitLifecycleState(habit, value);
  return lifecycle.status === "active" && !lifecycle.conflict && !state.conflicts.length
    && practiceAllowsDate(habit, completions, value) && isTrackerScheduledForDate(state.rule.schedule, value, calendarMode);
}

export function habitScore(habit: Habit, entry: HabitCompletion | undefined, value: string, _today?: string, calendarMode: CalendarMode = "sacred") {
  if (!entry || !isHabitScheduledForDate(habit, value, calendarMode)) return 0;
  return scoreHabitCompletion(habit, entry);
}

export function calculateHabitTotal(workspace: HabitWorkspace) {
  return workspace.userProgress.lifetimeXp;
}

function dailyGoalCounts(workspace: HabitWorkspace, date: string, calendarMode: CalendarMode, today: string) {
  let scheduledCount = 0, completedCount = 0, rewardCompletedCount = 0;
  for (const habit of workspace.habits) {
    if (habitLifecycleState(habit, date).status !== "active") continue;
    const practice = habitPracticeProgress(habit, workspace.habitCompletions, today);
    if (practice && date >= practice.start) {
      if (practice.status !== "conflict" && (practice.completedDate === date || !practice.completedDate && practice.deadline === date)) {
        scheduledCount++; if (practice.completedDate) { completedCount++; rewardCompletedCount++; }
      }
      continue;
    }
    const goal = habitRuleForDate(habit, date).periodGoal;
    if (goal) {
      const settlement = habitPeriodSettlement(habit, date, workspace, resolveCalendarWallTime(today, "12:00", goal.context.timeZone).instant);
      if (!settlement) continue;
      scheduledCount++;
      if (settlement.completed) completedCount++;
      if (settlement.rewardEligible) rewardCompletedCount++;
    } else if (isHabitScheduledForDate(habit, date, calendarMode)) {
      scheduledCount++;
      if (workspace.habitCompletions.some(entry => entry.habitId === habit.id && entry.date === date && entry.completed)) {
        completedCount++; rewardCompletedCount++;
      }
    }
  }
  return { scheduledCount, completedCount, rewardCompletedCount };
}

export function dailyGoalForDate(
  workspace: HabitWorkspace,
  date: string,
  calendarMode: CalendarMode,
  today = habitDateKey(new Date()),
) {
  const existing = workspace.dailyGoalRecords.find((record) => record.date === date);
  const mode = existing && date < today
    ? existing.mode
    : dailyGoalModeForDate(workspace.habitSettings.dailyGoalModeChanges, date);
  const counts = dailyGoalCounts(workspace, date, calendarMode, today);
  const next = buildDailyGoalRecord({
    date,
    mode,
    timezone: existing?.timezone ?? trackerTimeZone(),
    ...counts,
    today,
    isRestDay: workspace.habitSettings.plannedRestDays.includes(date),
    isStreakProtected: existing?.status === "protected",
  });
  return existing
    && existing.mode === next.mode
    && existing.timezone === next.timezone
    && existing.scheduledCount === next.scheduledCount
    && existing.completedCount === next.completedCount
    && existing.targetCount === next.targetCount
    && existing.status === next.status
    ? existing
    : next;
}

function withDailyGoalStreak(
  workspace: HabitWorkspace,
  today: string,
  calendarMode: CalendarMode,
  protectableDates: ReadonlySet<string> = new Set(),
) {
  const timestamp = new Date().toISOString();
  const protection = applyAutomaticStreakProtection({
    records: workspace.dailyGoalRecords,
    transactions: workspace.streakFreezeTransactions,
    protectableDates: new Set([...protectableDates].filter(date => !workspace.habitHistory?.some(row => row.date === date))),
    today,
    timestamp,
  });
  const protectedWorkspace = {
    ...workspace,
    dailyGoalRecords: protection.records,
    streakFreezeTransactions: protection.transactions,
  };
  const streak = calculateGlobalStreak(protectedWorkspace.dailyGoalRecords, today);
  const hasPeriods = workspace.habits.some(habit => habit.periodGoal || habit.ruleHistory?.some(rule => rule.periodGoal));
  const economyWorkspace = habitEconomyHistory(protectedWorkspace);
  const hasHistory = Boolean(workspace.habitHistory?.length);
  const rewardRecords = hasPeriods || hasHistory ? protectedWorkspace.dailyGoalRecords.map(record => {
    const counts = dailyGoalCounts(economyWorkspace, record.date, calendarMode, today);
    const ineligible = counts.completedCount - counts.rewardCompletedCount;
    if (!ineligible && !hasHistory) return record;
    return buildDailyGoalRecord({ ...record, today, completedCount: hasHistory ? counts.rewardCompletedCount : Math.max(0, record.completedCount - ineligible),
      isRestDay: record.status === "rest", isTimezoneShift: record.status === "timezone-shift", isStreakProtected: record.status === "protected" });
  }) : protectedWorkspace.dailyGoalRecords;
  const questStart = [habitQuestWeek(today).startDate, habitQuestMonth(today).startDate,
    ...protectedWorkspace.quests.map(quest => quest.startDate), ...protectedWorkspace.habits.map(habit => habit.createdDate)].sort()[0];
  const questClock = new Date(`${today}T12:00:00Z`);
  const questCompletions = hasPeriods ? [
    ...economyWorkspace.habitCompletions.filter(entry => {
      const habit = workspace.habits.find(habit => habit.id === entry.habitId);
      return !habit || !habitRuleForDate(habit, entry.date).periodGoal;
    }),
    ...habitQuestCompletions(workspace.habits, economyWorkspace, questStart, today, questClock).filter(entry => {
      const habit = workspace.habits.find(habit => habit.id === entry.habitId);
      return habit && habitRuleForDate(habit, entry.date).periodGoal && habitPeriodSettlement(habit, entry.date, economyWorkspace, questClock)?.rewardEligible;
    }),
  ] : economyWorkspace.habitCompletions;
  const earnedTransactions = reconcileDailyGoalRewards(rewardRecords, protectedWorkspace.rewardTransactions, today);
  const milestoneTransactions = reconcileStreakMilestoneRewards(rewardRecords, earnedTransactions);
  const comebackTransactions = reconcileComebackRewards(rewardRecords, milestoneTransactions, today, timestamp);
  const quests = protectedWorkspace.habitSettings.feedback.questsEnabled
    ? reconcileHabitQuests({
      quests: protectedWorkspace.quests,
      habits: protectedWorkspace.habits,
      completions: questCompletions,
      dailyGoalRecords: rewardRecords,
      today,
      calendarMode,
      isScheduledForDate: (schedule, date, mode, questHabit) => {
        const habit = questHabit && workspace.habits.find(habit => habit.id === questHabit.id);
        if (!habit) return isTrackerScheduledForDate(schedule, date, mode);
        return habitRuleForDate(habit, date).periodGoal
          ? Boolean(habitPeriodSettlement(habit, date, economyWorkspace, questClock)) : isHabitScheduledForDate(habit, date, mode);
      },
      timestamp,
    })
    : protectedWorkspace.quests;
  const rewardTransactions = protectedWorkspace.habitSettings.feedback.questsEnabled
    ? reconcileHabitQuestRewards(quests, comebackTransactions, timestamp)
    : comebackTransactions;
  const achievementUnlocks = reconcileAchievementUnlocks({
    unlocks: protectedWorkspace.achievementUnlocks,
    habitCompletions: questCompletions,
    dailyGoalRecords: rewardRecords,
    longestStreak: hasHistory ? calculateGlobalStreak(rewardRecords, today).longestStreak : Math.max(streak.longestStreak, workspace.userProgress.longestStreak),
    rewardTransactions,
    timestamp,
  });
  return {
    ...protectedWorkspace,
    quests,
    achievementUnlocks,
    rewardTransactions,
    userProgress: reconcileUserProgress(
      workspace.userProgress,
      practiceXpSources(workspace.habits, workspace.habitCompletions),
      timestamp,
      streak,
      calculateLaurelsBalance(rewardTransactions),
      calculateStreakFreezeCount(protection.transactions),
      calculateRhythmScore(protectedWorkspace.dailyGoalRecords, today),
    ),
  };
}

export function refreshDailyGoalProgress(
  workspace: HabitWorkspace,
  dates: Iterable<string>,
  calendarMode: CalendarMode,
  today = habitDateKey(new Date()),
): HabitWorkspace {
  let records = normalizeDailyGoalRecords(workspace.dailyGoalRecords);
  const protectableDates = new Set<string>();
  for (const date of dates) {
    if (!DATE_PATTERN.test(date)) continue;
    const previous = records.find((record) => record.date === date);
    const record = dailyGoalForDate({ ...workspace, dailyGoalRecords: records }, date, calendarMode, today);
    if (previous?.status === "open" && record.status === "missed") protectableDates.add(date);
    records = upsertDailyGoalRecord(records, record);
  }
  return withDailyGoalStreak({ ...workspace, dailyGoalRecords: records }, today, calendarMode, protectableDates);
}

export function ensureDailyGoalProgress(
  workspace: HabitWorkspace,
  calendarMode: CalendarMode,
  today = habitDateKey(new Date()),
): HabitWorkspace {
  workspace = { ...workspace, rewardTransactions: reconcilePracticePenalties(workspace.habits, workspace.habitCompletions, workspace.rewardTransactions, today,
    today === habitDateKey(new Date()) ? new Date() : undefined) };
  const currentTimezone = trackerTimeZone();
  const normalizedRecords = normalizeDailyGoalRecords(workspace.dailyGoalRecords);
  const previousCurrentRecord = normalizedRecords.filter((record) => record.date <= today).at(-1);
  const timezoneChanged = Boolean(previousCurrentRecord && previousCurrentRecord.timezone !== currentTimezone);
  const timezoneBoundaryDate = timezoneChanged ? addHabitDays(today, -1) : "";
  const protectableDates = new Set<string>();
  let records = normalizedRecords.map((record) => {
    if (record.status !== "open" || record.date >= today) return record;
    const closed = buildDailyGoalRecord({
      date: record.date,
      mode: record.mode,
      timezone: record.timezone,
      scheduledCount: record.scheduledCount,
      completedCount: record.completedCount,
      today,
      isTimezoneShift: record.date === timezoneBoundaryDate,
      updatedAt: record.updatedAt,
    });
    if (closed.status === "missed") protectableDates.add(record.date);
    return closed;
  });
  const latestDate = records.filter((record) => record.date <= today).at(-1)?.date;
  const earliestSource = [
    ...workspace.habits.filter((habit) => habit.active).map((habit) => habit.schedule.startDate),
    ...workspace.habitCompletions.map((entry) => entry.date),
  ].filter((date) => DATE_PATTERN.test(date)).sort()[0];
  const historyFloor = addHabitDays(today, -3_699);
  const start = latestDate
    ? addHabitDays(latestDate, 1)
    : earliestSource && earliestSource <= today ? (earliestSource < historyFloor ? historyFloor : earliestSource) : "";
  if (start && start <= today) {
    const draft = { ...workspace, dailyGoalRecords: records };
    dateValuesBetween(start, today).forEach((date) => {
      const calculated = dailyGoalForDate({ ...draft, dailyGoalRecords: records }, date, calendarMode, today);
      const record = date === timezoneBoundaryDate
        ? { ...calculated, timezone: currentTimezone, status: "timezone-shift" as const }
        : calculated;
      if (record.status === "missed") protectableDates.add(date);
      records = upsertDailyGoalRecord(records, record);
    });
  }
  for (const date of new Set(workspace.habitHistory?.map(row => row.date) ?? [])) {
    if (date < today) records = upsertDailyGoalRecord(records, dailyGoalForDate({ ...workspace, dailyGoalRecords: records }, date, calendarMode, today));
  }
  if (records.some((record) => record.date === today)) {
    const current = dailyGoalForDate({ ...workspace, dailyGoalRecords: records }, today, calendarMode, today);
    records = upsertDailyGoalRecord(records, current);
  }
  return withDailyGoalStreak({ ...workspace, dailyGoalRecords: records }, today, calendarMode, protectableDates);
}

export function buyHestiaSpark(
  workspace: HabitWorkspace,
  purchaseId = `spark-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  timestamp = new Date().toISOString(),
): HabitWorkspace {
  const purchase = purchaseHestiaSpark({
    rewardTransactions: workspace.rewardTransactions,
    streakFreezeTransactions: workspace.streakFreezeTransactions,
    laurelsBalance: workspace.userProgress.laurelsBalance,
    purchaseId,
    createdAt: timestamp,
  });
  if (!purchase.ok) return workspace;
  return {
    ...workspace,
    rewardTransactions: purchase.rewardTransactions,
    streakFreezeTransactions: purchase.streakFreezeTransactions,
    userProgress: reconcileUserProgress(
      workspace.userProgress,
      practiceXpSources(workspace.habits, workspace.habitCompletions),
      timestamp,
      undefined,
      calculateLaurelsBalance(purchase.rewardTransactions),
      calculateStreakFreezeCount(purchase.streakFreezeTransactions),
    ),
  };
}

export function claimHeroPathAmphora(
  workspace: HabitWorkspace,
  rankId: string,
  timestamp = new Date().toISOString(),
): HabitWorkspace {
  const checkpoint = HERO_PATH_CHECKPOINTS.find((item) => item.rankId === rankId);
  if (!checkpoint) return workspace;
  const rank = HEROIC_RANKS.find((item) => item.id === checkpoint.rankId);
  if (!rank || workspace.userProgress.lifetimeXp < rank.threshold) return workspace;
  const idempotencyKey = `hero-path-amphora:self:${checkpoint.rankId}`;
  if (workspace.rewardTransactions.some((transaction) => transaction.idempotencyKey === idempotencyKey)) return workspace;
  const rewardTransactions = normalizeRewardTransactions([
    ...workspace.rewardTransactions,
    createRewardTransaction({
      amount: checkpoint.rewardLaurels,
      reason: "hero-path-amphora",
      sourceId: checkpoint.rankId,
      idempotencyKey,
      createdAt: timestamp,
    }),
  ]);
  return {
    ...workspace,
    rewardTransactions,
    userProgress: reconcileUserProgress(
      workspace.userProgress,
      practiceXpSources(workspace.habits, workspace.habitCompletions),
      timestamp,
      undefined,
      calculateLaurelsBalance(rewardTransactions),
      calculateStreakFreezeCount(workspace.streakFreezeTransactions),
    ),
  };
}

export function revealHiddenHeroicPath(
  workspace: HabitWorkspace,
  timestamp = new Date().toISOString(),
): HabitWorkspace {
  if (!hiddenHeroicPathUnlocked(workspace.userProgress.lifetimeXp) || workspace.userProgress.hiddenHeroicPathRevealedAt) return workspace;
  return {
    ...workspace,
    userProgress: {
      ...workspace.userProgress,
      hiddenHeroicPathRevealedAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

export function removeHabitFromWorkspace(
  workspace: HabitWorkspace,
  habitId: string,
  timestamp = new Date().toISOString(),
): HabitWorkspace {
  const habit = workspace.habits.find((item) => item.id === habitId);
  if (!habit) return workspace;
  if (habitLifecycleState(habit).status === "deleted") return workspace;
  return applyHabitLifecycleToWorkspace(workspace, { id: `habit-delete:${crypto.randomUUID()}`, habitId,
    action: "delete", at: timestamp, heads: habitLifecycleState(habit).heads.map(row => row.id) });
}

/** Lifecycle commands preserve evidence and credits; only explicit deletion invokes the established reset. */
export function applyHabitLifecycleToWorkspace(workspace: HabitWorkspace, command: HabitLifecycleCommand): HabitWorkspace {
  const habit = workspace.habits.find(row => row.id === command.habitId);
  if (!habit) throw new RangeError("HABIT_LIFECYCLE_TRANSITION_UNAVAILABLE");
  const updated = applyHabitLifecycleCommand(habit, command);
  if (updated === habit) return workspace;
  let habitTimers = workspace.habitTimers;
  if (!updated.active) for (const session of habitTimerSessions(habitTimers).filter(row => row.root.habitId === habit.id)) {
    if (!session.state) throw new RangeError("HABIT_TIMER_CONFLICT");
    if (session.state.status === "running") habitTimers = appendHabitTimerOperation(habitTimers, session.id,
      session.root.owner, "pause", { at: command.at, id: `${command.id}:timer:${session.id}` });
  }
  const finitePractice = habitPracticeProgress(habit, workspace.habitCompletions, command.at.slice(0, 10));
  const rewardTransactions = command.action === "delete" && !command.automaticPoints && !finitePractice ? applyHabitDeletionLaurelPolicy(workspace.rewardTransactions,
    habitEconomyHistory(workspace).habitCompletions, habit.id, command.at, command.id).transactions : workspace.rewardTransactions;
  return { ...workspace, habits: workspace.habits.map(row => row.id === habit.id ? markTrackerEntityChanged(updated) : row),
    habitTimers, habitTimerEpoch: habitWorkspaceEpoch(workspace.habitTimerEpoch, workspace.habitHistory.length > 0, true),
    rewardTransactions, userProgress: { ...workspace.userProgress, laurelsBalance: calculateLaurelsBalance(rewardTransactions) } };
}

/** Automatic deletion uses the existing recoverable library and never erases completion evidence. */
export function applyHabitAutoDeletion(workspace: HabitWorkspace, timestamp = new Date().toISOString()): HabitWorkspace {
  let next = reconcileHabitAutoDeleteEvidence(workspace);
  for (const habit of next.habits) {
    const policy = normalizeHabitAutoDelete(habit.autoDeletePolicy);
    const state = habitLifecycleState(habit);
    if (!policy || state.status !== "active" || state.conflict || !workspace.habitSettings.enabled) continue;
    const today = momentCivilDate(new Date(timestamp), habit.schedule.timezone);
    const periodWorkspace = { habitCompletions: workspace.habitCompletions, habitMeasurements: workspace.habitMeasurements };
    const evidence = habit.periodGoal || habit.ruleHistory?.some(row => row.periodGoal)
      ? habitQuestCompletions([habit], periodWorkspace, [habit.createdDate, policy.startOn].sort().at(-1)!, today, new Date(timestamp), false)
      : workspace.habitCompletions.filter(row => row.habitId === habit.id);
    const due = habitAutoDeleteDue(policy, habit.createdDate, today,
      habitPeriodProgress(habit, today, periodWorkspace, new Date(timestamp))?.completed ? [...evidence, { date: today, completed: true }] : evidence,
      day => habitLifecycleState(habit, day), day => {
        if (habitRuleForDate(habit, day).periodGoal) return habitPeriodSettlement(habit, day, periodWorkspace, new Date(timestamp))?.status === "missed";
        return isHabitScheduledForDate(habit, day, "profane", workspace.habitCompletions);
      });
    if (!due) continue;
    const boundary = resolveCalendarWallTime(due.deadline, "00:00", habit.schedule.timezone).instant.toISOString();
    const at = [boundary, ...state.heads.map(row => row.at)].sort().at(-1)!;
    next = applyHabitLifecycleToWorkspace(next, { id: due.id, habitId: habit.id, action: "delete", at,
      heads: state.heads.map(row => row.id), automaticPoints: policy.points });
  }
  return reconcileHabitAutoDeletePoints(next);
}

/** A completion received from an offline device can disprove an automatic expiry. Keep both records. */
export function reconcileHabitAutoDeleteEvidence(workspace: HabitWorkspace): HabitWorkspace {
  let next = workspace;
  for (const habit of workspace.habits) {
    const state = habitLifecycleState(habit), event = state.heads[0];
    if (state.conflict || state.status !== "deleted" || state.heads.length !== 1 || !event || !habitAutomaticPoints(event)) continue;
    const firstMissed = /^habit-auto-delete:[a-f0-9-]{36}:(\d{4}-\d{2}-\d{2}):/.exec(event.id)?.[1];
    if (!firstMissed || !workspace.habitCompletions.some(row => row.habitId === habit.id && row.completed && row.date >= firstMissed)) continue;
    const restoreId = `habit-auto-delete-reset:${event.id}:restore`;
    next = applyHabitLifecycleToWorkspace(next, { id: restoreId, habitId: habit.id, action: "restore", at: event.at, heads: [event.id] });
    next = applyHabitLifecycleToWorkspace(next, { id: `habit-auto-delete-reset:${event.id}:resume`, habitId: habit.id, action: "resume", at: event.at, heads: [restoreId] });
  }
  return next;
}

export function reconcileHabitAutoDeletePoints(workspace: HabitWorkspace): HabitWorkspace {
  const cutoffs = new Map<string, string>();
  for (const habit of workspace.habits) for (const event of habit.lifecycleHistory ?? []) {
    if (habitAutomaticPoints(event) === "remove" && !habit.lifecycleHistory?.some(row => row.id === `habit-auto-delete-reset:${event.id}:restore`))
      cutoffs.set(habit.id, [cutoffs.get(habit.id) ?? "", event.date].sort().at(-1)!);
  }
  if (!cutoffs.size && !workspace.userProgress.forfeitedHabitXp) return workspace;
  const credits = new Map<string, number>();
  for (const row of practiceXpSources(workspace.habits, habitEconomyHistory(workspace).habitCompletions)) {
    const cutoff = cutoffs.get(row.habitId);
    if (cutoff && row.date < cutoff) credits.set(`${row.habitId}:${row.date}`, Math.max(credits.get(`${row.habitId}:${row.date}`) ?? 0, row.xpAwarded));
  }
  const forfeitedHabitXp = [...credits.values()].reduce((sum, xp) => sum + Math.max(0, xp), 0);
  const progress = workspace.userProgress;
  const grossLifetimeXp = progress.grossLifetimeXp ?? progress.lifetimeXp + (progress.forfeitedHabitXp ?? 0);
  if (progress.forfeitedHabitXp === forfeitedHabitXp && progress.grossLifetimeXp === grossLifetimeXp && progress.lifetimeXp === Math.max(0, grossLifetimeXp - forfeitedHabitXp)) return workspace;
  return { ...workspace, userProgress: reconcileUserProgress({ ...progress, grossLifetimeXp, forfeitedHabitXp },
    practiceXpSources(workspace.habits, workspace.habitCompletions)) };
}

export function setDailyGoalMode(
  workspace: HabitWorkspace,
  mode: DailyGoalMode,
  today = habitDateKey(new Date()),
): HabitWorkspace {
  const effectiveFrom = addHabitDays(today, 1);
  const timestamp = new Date().toISOString();
  return {
    ...workspace,
    userProgress: { ...workspace.userProgress, streakGoalMode: mode, updatedAt: timestamp },
    habitSettings: {
      ...workspace.habitSettings,
      dailyGoalModeChanges: scheduleDailyGoalMode(workspace.habitSettings.dailyGoalModeChanges, mode, effectiveFrom, timestamp),
    },
  };
}

export function setPlannedRestDay(
  workspace: HabitWorkspace,
  date: string,
  planned: boolean,
  calendarMode: CalendarMode,
  today = habitDateKey(new Date()),
): HabitWorkspace {
  if (!DATE_PATTERN.test(date) || date < today) return workspace;
  const restDays = new Set(workspace.habitSettings.plannedRestDays);
  if (planned) restDays.add(date);
  else restDays.delete(date);
  return refreshDailyGoalProgress({
    ...workspace,
    habitSettings: { ...workspace.habitSettings, plannedRestDays: Array.from(restDays).sort() },
  }, [date], calendarMode, today);
}

function startOfMonth(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function startOfQuarter(value: string) {
  const [year, month] = value.split("-").map(Number);
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(quarterMonth).padStart(2, "0")}-01`;
}

export function reportDateRange(
  settings: HabitSettings,
  today = habitDateKey(new Date()),
  calendarStarts?: { month: string; quarter: string; year: string },
) {
  if (settings.reportRange === "custom" && DATE_PATTERN.test(settings.customRangeStart) && DATE_PATTERN.test(settings.customRangeEnd)) {
    const end = settings.customRangeEnd > today ? today : settings.customRangeEnd;
    const start = settings.customRangeStart > end ? end : settings.customRangeStart;
    return { start, end };
  }
  if (settings.reportRange === "month") return { start: calendarStarts?.month ?? startOfMonth(today), end: today };
  if (settings.reportRange === "quarter") return { start: calendarStarts?.quarter ?? startOfQuarter(today), end: today };
  if (settings.reportRange === "year") return { start: calendarStarts?.year ?? `${today.slice(0, 4)}-01-01`, end: today };
  const days = settings.reportRange === "week" ? 7 : 30;
  return { start: addHabitDays(today, -(days - 1)), end: today };
}

export function dateValuesBetween(start: string, end: string, limit = 3_700) {
  const result: string[] = [];
  for (let value = start; value <= end && result.length < limit; value = addHabitDays(value, 1)) result.push(value);
  return result;
}

export function habitRangeEnd(startDate: string, preset: "week" | "month" | "half-year" | "year" | "custom" | "forever", customEnd = "") {
  if (preset === "forever") return null;
  if (preset === "custom") return DATE_PATTERN.test(customEnd) ? customEnd : null;
  const start = habitDate(startDate);
  if (preset === "week") start.setDate(start.getDate() + 6);
  if (preset === "month") start.setMonth(start.getMonth() + 1);
  if (preset === "half-year") start.setMonth(start.getMonth() + 6);
  if (preset === "year") start.setFullYear(start.getFullYear() + 1);
  return habitDateKey(start);
}

export function defaultHabit(date: string, calendarMode: CalendarMode): Habit {
  return {
    ...normalizeTrackerEntity(null, "habit"),
    title: "",
    description: "",
    createdDate: date,
    emoji: DEFAULT_HABIT_EMOJI,
    priority: DEFAULT_HABIT_PRIORITY,
    isKeyHabit: false,
    ritualId: "none",
    ritualName: "",
    color: HABIT_COLORS[0],
    active: true,
    sourceTemplateId: null,
    sacredPracticeId: null,
    sacredSectorId: null,
    preferredTime: "",
    schedule: defaultTrackerSchedule(date, calendarMode),
    scoringMode: "binary",
    qualityScale: "none",
    reminder: {
      enabled: false,
      time: "09:00",
      timing: "habit",
      syncToGoogleTasks: false,
      showInGoogleCalendar: false,
      googleTaskId: null,
      googleEventId: null,
    },
  };
}

function templateSchedule(template: HabitTemplate, date: string, calendarMode: CalendarMode): TrackerSchedule {
  const schedule = defaultTrackerSchedule(date, calendarMode);
  const preset = starterTemplateRecurrencePreset(template, calendarMode);
  return { ...schedule, recurrence: { ...schedule.recurrence, ...preset } };
}

export function createHabitFromTemplate(
  template: HabitTemplate,
  startDate: string,
  calendarMode: CalendarMode,
  language: Language = "ru",
): Habit {
  const schedule = templateSchedule(template, startDate, calendarMode);
  return {
    ...defaultHabit(startDate, calendarMode),
    sourceTemplateId: template.id,
    emoji: normalizeHabitEmoji(template.icon),
    title: language === "en" ? template.titleEn : template.title,
    description: language === "en" ? template.descriptionEn : template.description,
    color: template.color,
    preferredTime: template.suggestedTime,
    ritualId: suggestedHabitRitual(template.suggestedTime),
    schedule,
    reminder: {
      enabled: false,
      time: template.suggestedTime,
      timing: "habit",
      syncToGoogleTasks: false,
      showInGoogleCalendar: false,
      googleTaskId: null,
      googleEventId: null,
    },
  };
}

/** Every non-deleted reading cycle is an additional card, even when several use the same practice. */
export function additionalSacredHabits(habits: readonly Habit[], sectorId: string): Habit[] {
  return habits.filter(habit => habit.stoicheionRestoration?.sectorId === sectorId && habitLifecycleState(habit).status !== "deleted");
}

/** Reading cycles remain separate from the two standard practices in each sacred sector. */
export function findStandardSacredHabit(habits: readonly Habit[], practiceId: string): Habit | undefined {
  return habits.find(habit => habit.sacredPracticeId === practiceId && !habit.stoicheionRestoration);
}

export function createHabitFromSacredPractice(
  practice: SacredPractice,
  startDate: string,
  calendarMode: CalendarMode,
  language: Language = "ru",
): Habit {
  const habit = defaultHabit(startDate, calendarMode);
  return {
    ...habit,
    practiceGoal: defaultPracticeGoal(startDate),
    schedule: { ...habit.schedule, endDate: addHabitDays(startDate, 1), recurrence: convertTrackerRecurrenceCalendar({ ...habit.schedule.recurrence,
      enabled: true, mode: "classic", pattern: "daily", interval: 1, days: [1], months: [], pyatas: [], rangeEnd: addHabitDays(startDate, 1) }, calendarMode, startDate) },
    sacredPracticeId: practice.id,
    sacredSectorId: practice.sectorId,
    emoji: normalizeHabitEmoji(practice.emoji),
    title: catalogText(practice.title, language),
    description: catalogText(practice.description, language),
    color: practice.color,
    priority: normalizeHabitPriority(practice.priority),
    preferredTime: practice.suggestedTime,
    ritualId: suggestedHabitRitual(practice.suggestedTime),
    reminder: {
      enabled: false,
      time: practice.suggestedTime,
      timing: "habit",
      syncToGoogleTasks: false,
      showInGoogleCalendar: false,
      googleTaskId: null,
      googleEventId: null,
    },
  };
}

export function setKeyHabit(
  workspace: HabitWorkspace,
  habitId: string | null,
  timestamp = new Date().toISOString(),
): HabitWorkspace {
  if (habitId && !workspace.habits.some((habit) => habit.id === habitId)) return workspace;
  let changed = false;
  const habits = workspace.habits.map((habit) => {
    const isKeyHabit = habit.id === habitId;
    if (habit.isKeyHabit === isKeyHabit) return habit;
    changed = true;
    return { ...habit, isKeyHabit, updatedAt: timestamp, version: habit.version + 1, syncState: "pending" as const };
  });
  return changed ? { ...workspace, habits } : workspace;
}
