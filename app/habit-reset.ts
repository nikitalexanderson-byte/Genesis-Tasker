import type { HabitWorkspace } from "./habits";
import { nextHabitTimerEpoch } from "./habit-timer.ts";

export function resetHabitWorkspace(
  workspace: HabitWorkspace,
  timestamp = new Date().toISOString(),
): HabitWorkspace {
  return {
    trackerSchemaVersion: 16,
    userProgress: {
      lifetimeXp: 0,
      laurelsBalance: 0,
      currentRankId: null,
      hiddenHeroicPathRevealedAt: null,
      currentStreak: 0,
      longestStreak: 0,
      lastQualifiedDate: null,
      streakGoalMode: workspace.userProgress.streakGoalMode,
      streakFreezeCount: 0,
      rhythmScore: 0,
      updatedAt: timestamp,
    },
    habits: [],
    habitCompletions: [],
    habitMeasurements: [],
    habitTimers: [],
    habitHistory: [],
    habitTimerEpoch: nextHabitTimerEpoch(workspace.habitTimerEpoch),
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
    habitSettings: {
      enabled: workspace.habitSettings.enabled,
      reportRange: workspace.habitSettings.reportRange,
      customRangeStart: workspace.habitSettings.customRangeStart,
      customRangeEnd: workspace.habitSettings.customRangeEnd,
      collapsedSections: workspace.habitSettings.collapsedSections,
      sectionOrder: workspace.habitSettings.sectionOrder,
      dailyGoalModeChanges: [],
      plannedRestDays: [],
      notifications: workspace.habitSettings.notifications,
      feedback: workspace.habitSettings.feedback,
    },
    hiddenDefaultTemplates: [],
  };
}
