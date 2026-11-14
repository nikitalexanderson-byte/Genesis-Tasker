import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { createLocalVoicePlan } from "../app/local-voice-plan.ts";
import {
  MAX_TASK_REMINDERS,
  formatTaskReminder,
  normalizeTaskReminders,
  reminderMinutesBeforeTask,
} from "../app/task-reminders.ts";
import { formatClockTime, formatTimeValue, hourFromTwelveHour, twelveHourParts } from "../app/time-format.ts";
import { cleanTaskDescription } from "../app/task-description.ts";
import { DAY_RHYTHM_PERIODS, formatDayRhythmRange, getDayRhythmMoment } from "../app/day-rhythm.ts";
import { THEOKYKLOS_DIRECTION_IDS, THEOKYKLOS_SEGMENTS } from "../app/theokyklos-data.ts";
import {
  SACRED_AXIS_SECTOR_IDS,
  SACRED_COMPASS_SECTOR_IDS,
  SACRED_PRACTICE_SECTOR_IDS,
  SACRED_PRACTICES,
  SACRED_SECTOR_NAMES,
  SACRED_THRESHOLD_SECTOR_IDS,
  STOICHEION_PRACTICE_SECTOR_IDS,
  sacredPracticesForSector,
  sacredSectorGuidance,
} from "../app/sacred-practices.ts";
import {
  calculateSleepDuration,
  currentAbstinenceStreak,
  moodValueColor,
  nonNegativeTrackerTotal,
  scoreAbstinenceDay,
  scoreHabitFormula,
  scoreSleepRules,
} from "../app/tracker-math.ts";
import {
  HABIT_COLORS,
  STARTER_HABIT_TEMPLATES,
  isHabitTemplateId,
  starterTemplateRecurrencePreset,
} from "../app/habit-templates.ts";
import {
  HEROIC_RANKS,
  FOUNDATIONAL_HEROIC_RANKS,
  HERO_PATH_CHECKPOINTS,
  HIDDEN_HEROIC_PATH_UNLOCK_XP,
  HIDDEN_HEROIC_RANKS,
  INTRODUCTORY_HEROIC_RANKS,
  MAX_HABIT_XP_PER_COMPLETION,
  completionXpAward,
  heroicRank,
  heroicRankForProgress,
  highestRankForXp,
  hiddenHeroicPathRevealed,
  hiddenHeroicPathUnlocked,
  nextHeroicRankForProgress,
  reconcileUserProgress,
  visibleHeroicRanksForXp,
} from "../app/habit-progress.ts";
import { HEROIC_RANK_ICON_ASSETS, HERO_PATH_CHECKPOINT_ICON_ASSETS } from "../app/hero-path-assets.ts";
import {
  HABIT_EMOJI_CATEGORIES,
  canRecordHabitOnDate,
  normalizeHabitColor,
  normalizeHabitEmoji,
  normalizeHabitPriority,
} from "../app/habit-integrity.ts";
import { applyEditableHabitUpdate, applyHabitReminderSyncResult, setNewHabitStartDate } from "../app/habit-editing.ts";
import {
  buildAdaptiveHabitSuggestions,
  groupHabitsByRitual,
  normalizeKeyHabitSelection,
  normalizeHabitRitualId,
} from "../app/habit-guidance.ts";
import {
  resetHabitWorkspace,
} from "../app/habit-reset.ts";
import {
  buildDailyGoalRecord,
  calculateGlobalStreak,
  calculateRhythmScore,
  dailyGoalModeForDate,
  dailyGoalTarget,
  scheduleDailyGoalMode,
  upsertDailyGoalRecord,
} from "../app/daily-goal.ts";
import {
  HABIT_MASTERY_MILESTONES,
  buildHabitPersonalRecord,
  buildHabitYearMosaic,
  buildWeeklyHabitSummary,
} from "../app/habit-insights.ts";
import {
  DAILY_GOAL_LAURELS,
  PERFECT_DAY_LAURELS,
  calculateLaurelsBalance,
  createRewardTransaction,
  normalizeRewardTransactions,
  reconcileDailyGoalRewards,
  resetLaurelsBalance,
} from "../app/rewards.ts";
import {
  COMEBACK_REWARD_LAURELS,
  HESTIA_SPARK_COST,
  HESTIA_SPARK_MAX,
  applyAutomaticStreakProtection,
  calculateComebackSummary,
  calculateStreakFreezeCount,
  purchaseHestiaSpark,
  reconcileComebackRewards,
} from "../app/streak-protection.ts";
import {
  mergeWorkspaceDocuments,
  mergeIndependentWorkspaceDocuments,
  prepareWorkspaceForSync,
} from "../app/workspace-sync-state.ts";
import {
  DAILY_QUEST_LAURELS,
  EPIC_QUEST_LAURELS,
  WEEKLY_QUEST_LAURELS,
  currentHabitQuests,
  reconcileHabitQuestRewards,
  reconcileHabitQuests,
} from "../app/habit-quests.ts";
import {
  STREAK_REWARD_MILESTONES,
  claimedStreakMilestones,
  reconcileStreakMilestoneRewards,
} from "../app/streak-rewards.ts";
import {
  ACHIEVEMENTS,
  achievementMetrics,
  reconcileAchievementUnlocks,
} from "../app/achievements.ts";
import {
  DEFAULT_HABIT_NOTIFICATION_SETTINGS,
  buildHabitNotificationPlan,
  isHabitNotificationQuietTime,
  normalizeHabitNotificationSettings,
  suggestHabitReminderTime,
} from "../app/habit-notifications.ts";
import { habitNotificationMessage } from "../app/habit-notification-message.ts";
import { habitReminderTime, habitReminderDateTime } from "../app/habit-reminder-time.ts";
import {
  HABIT_LAUREL_RETENTION_COMPLETIONS,
  applyHabitDeletionLaurelPolicy,
  habitCompletionCount,
  reconcileOrphanedHabitLaurels,
} from "../app/habit-laurel-retention.ts";
import {
  DEFAULT_HABIT_FEEDBACK_SETTINGS,
  normalizeHabitFeedbackSettings,
} from "../app/habit-feedback.ts";
import {
  HABIT_SECTION_IDS,
  moveHabitSection,
  normalizeHabitCollapsedSections,
  normalizeHabitSectionOrder,
} from "../app/habit-section-state.ts";
import { gregorianMonthNumber, gregorianWeekdayOffset } from "../app/calendar-layout.ts";

test("Gregorian calendar offsets support Sunday-first and Monday-first weeks", () => {
  const thursday = new Date(2026, 0, 1, 12);
  assert.equal(gregorianWeekdayOffset(thursday, "sunday"), 4);
  assert.equal(gregorianWeekdayOffset(thursday, "monday"), 3);
  assert.equal(gregorianWeekdayOffset(new Date(2026, 0, 4, 12), "sunday"), 0);
  assert.equal(gregorianWeekdayOffset(new Date(2026, 0, 4, 12), "monday"), 6);
});

test("Gregorian month numbers follow the configured year start through January and February", () => {
  const dates = Array.from({length:12}, (_, month) => new Date(2026, month, 1, 12));
  assert.deepEqual(dates.map(date => gregorianMonthNumber(date, "january")), [1,2,3,4,5,6,7,8,9,10,11,12]);
  assert.deepEqual(dates.map(date => gregorianMonthNumber(date, "march")), [11,12,1,2,3,4,5,6,7,8,9,10]);
  assert.equal(gregorianMonthNumber(new Date(2027, 0, 1, 12), "march"), 11);
  assert.equal(gregorianMonthNumber(new Date(2027, 1, 28, 12), "march"), 12);
});

function syncClock(version, updatedAt, deviceId) {
  return { version, updatedAt, deviceId };
}

test("encrypted workspace sync merges concurrent entities and preserves deletions", () => {
  const initial = prepareWorkspaceForSync({
    current: {
      projects: [{ id: "project-existing", title: "Existing" }],
      categories: [],
      taskListLinks: [],
      habits: [],
      habitCompletions: [],
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
      trackerSchemaVersion: 16,
      userProgress: { lifetimeXp: 0 },
      habitSettings: { enabled: true },
      hiddenDefaultTemplates: [],
    },
    clock: syncClock(1, "2026-09-18T08:00:00.000Z", "origin"),
  });
  const base = initial.document;
  const left = prepareWorkspaceForSync({
    current: {
      ...base,
      projects: [],
      habitCompletions: [{ id: "completion-left", habitId: "habit", date: "2026-09-18" }],
    },
    base,
    metadata: initial.metadata,
    baseMetadata: initial.metadata,
    clock: syncClock(2, "2026-09-18T09:00:00.000Z", "device-a"),
  });
  const right = prepareWorkspaceForSync({
    current: {
      ...base,
      projects: [
        { id: "project-existing", title: "Existing" },
        { id: "project-remote", title: "Remote" },
      ],
      habitCompletions: [{ id: "completion-right", habitId: "habit", date: "2026-09-18" }],
    },
    base,
    metadata: initial.metadata,
    baseMetadata: initial.metadata,
    clock: syncClock(2, "2026-09-18T09:00:00.000Z", "device-b"),
  });
  const merged = mergeWorkspaceDocuments({
    left: left.document,
    right: right.document,
    leftFallback: syncClock(2, "2026-09-18T09:00:00.000Z", "device-a"),
    rightFallback: syncClock(2, "2026-09-18T09:00:00.000Z", "device-b"),
  }).document;
  assert.deepEqual(merged.projects.map((item) => item.id), ["project-remote"], "a tombstone must beat a stale copy without deleting a concurrent addition");
  assert.deepEqual(merged.habitCompletions.map((item) => item.id), ["completion-left", "completion-right"]);
});

test("independent account merge keeps both collections and rejects conflicting records", () => {
  const defaults = { projects: [], categories: [], trackerSchemaVersion: 16,
    userProgress: { xp: 0 }, habitSettings: { enabled: true }, hiddenDefaultTemplates: [] };
  const clock = syncClock(1, "2026-10-03T00:00:00.000Z", "merge-test");
  const primary = { ...defaults, projects: [{ id: "primary", title: "First" }],
    syncMetadata: { schemaVersion: 1, entities: {}, fields: {},
      tombstones: [{ collection: "projects", id: "secondary", ...clock }] } };
  const secondary = { ...defaults, projects: [{ id: "secondary", title: "Second" }] };
  const merged = mergeIndependentWorkspaceDocuments({ primary, secondary, defaults, clock });
  assert.deepEqual(merged.document.projects.map((item) => item.id), ["primary", "secondary"]);
  assert.deepEqual(merged.metadata.tombstones, []);
  assert.throws(() => mergeIndependentWorkspaceDocuments({
    primary, secondary: { ...secondary, projects: [{ id: "primary", title: "Different" }] }, defaults, clock,
  }), /одинаковым ID/);
  assert.throws(() => mergeIndependentWorkspaceDocuments({
    primary: { ...primary, userProgress: { xp: 5 } },
    secondary: { ...secondary, userProgress: { xp: 10 } }, defaults, clock,
  }), /прогресс/);
});

test("workspace merge deduplicates reward ledger entries by idempotency key", () => {
  const common = {
    projects: [], categories: [], taskListLinks: [], habits: [], habitCompletions: [], sleepPlans: [], sleepEntries: [],
    moodEntries: [], addictionTrackers: [], addictionEntries: [], analyticsSnapshots: [], dailyGoalRecords: [],
    quests: [], achievementUnlocks: [], trackerSchemaVersion: 16, userProgress: {}, habitSettings: {}, hiddenDefaultTemplates: [], streakFreezeTransactions: [],
  };
  const left = prepareWorkspaceForSync({
    current: {
      ...common,
      rewardTransactions: [{ id: "one", idempotencyKey: "daily-goal:self:2026-09-18", amount: 5 }],
      streakFreezeTransactions: [{ id: "spark-one", idempotencyKey: "hestia-spark-purchase:self:spark-one", amount: 1 }],
    },
    clock: syncClock(1, "2026-09-18T09:00:00.000Z", "device-a"),
  });
  const right = prepareWorkspaceForSync({
    current: {
      ...common,
      rewardTransactions: [{ id: "two", idempotencyKey: "daily-goal:self:2026-09-18", amount: 5 }],
      streakFreezeTransactions: [{ id: "spark-two", idempotencyKey: "hestia-spark-purchase:self:spark-one", amount: 1 }],
    },
    clock: syncClock(1, "2026-09-18T09:00:00.000Z", "device-b"),
  });
  const merged = mergeWorkspaceDocuments({
    left: left.document,
    right: right.document,
    leftFallback: syncClock(1, "2026-09-18T09:00:00.000Z", "device-a"),
    rightFallback: syncClock(1, "2026-09-18T09:00:00.000Z", "device-b"),
  }).document;
  assert.equal(merged.rewardTransactions.length, 1);
  assert.equal(merged.rewardTransactions[0].idempotencyKey, "daily-goal:self:2026-09-18");
  assert.equal(merged.streakFreezeTransactions.length, 1);
  assert.equal(merged.streakFreezeTransactions[0].idempotencyKey, "hestia-spark-purchase:self:spark-one");
});

test("habit section disclosure state is normalized for encrypted cross-device storage", () => {
  assert.deepEqual(
    normalizeHabitCollapsedSections(["statistics", "statistics", "regular-habits", "unknown-section"]),
    ["statistics", "regular-habits"],
  );
  const order = normalizeHabitSectionOrder(["statistics", "regular-habits", "statistics", "unknown-section"]);
  assert.deepEqual(order.slice(0, 2), ["statistics", "regular-habits"]);
  assert.equal(order.length, HABIT_SECTION_IDS.length);
  assert.deepEqual(moveHabitSection(order, "statistics", "regular-habits").slice(0, 2), ["regular-habits", "statistics"]);
  assert.ok(order.includes("sacred-habits"));
});

test("workspace API uses monotonic compare-and-swap without exposing plaintext", async () => {
  const [repository, router, cloud] = await Promise.all([
    readFile(new URL("../server/src/repository.php", import.meta.url), "utf8"),
    readFile(new URL("../server/public/api/index.php", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
  ]);
  assert.match(repository, /class GenesisWorkspaceConflictException/);
  assert.match(repository, /expectedVersion/);
  assert.match(repository, /BEGIN IMMEDIATE/);
  assert.match(repository, /\$version = \$currentVersion \+ 1/);
  assert.doesNotMatch(repository, /excluded\.version >= workspace_blobs\.version/);
  assert.match(router, /\$method === 'GET' && \$path === 'workspace'/);
  assert.match(router, /currentVersion' => \$error->currentVersion/);
  assert.match(cloud, /mergeWorkspaceDocuments/);
  assert.match(cloud, /expectedVersion: workspaceVersion/);
  assert.match(cloud, /pendingStorageKey\(userId = workspaceUserId\)/);
  assert.match(cloud, /restoreOfflineWorkspaceSession/);
  assert.doesNotMatch(cloud, /let workspaceVersion = Date\.now\(\)/);
});

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the GENESIS application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /GENESIS/);
  assert.match(html, /К основному содержанию/);
  assert.match(html, /Календарь/);
  assert.doesNotMatch(html, /class="month-rail"/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
  assert.doesNotMatch(html, /href=["']\/admin-access/);
});

test("account deletion atomically purges only the authenticated user's server and device data", async () => {
  const [repository, apiRouter, cloud, account, smoke] = await Promise.all([
    readFile(new URL("../server/src/repository.php", import.meta.url), "utf8"),
    readFile(new URL("../server/public/api/index.php", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/tests/smoke.php", import.meta.url), "utf8"),
  ]);
  const deletion = repository.slice(repository.indexOf("function genesisAccountDataLocations"), repository.indexOf("function genesisRemoveLinkedGoogleAccount"));
  for (const table of [
    "categories",
    "projects",
    "tasks",
    "task_links",
    "workspace_blobs",
    "user_metrics",
    "stoicheion_draws",
    "linked_google_accounts",
    "users",
  ]) assert.match(deletion, new RegExp(`'${table}'`));
  assert.match(deletion, /\$ownsTransaction = !\$db->inTransaction\(\)/);
  assert.match(deletion, /\$db->beginTransaction\(\)/);
  assert.match(deletion, /DELETE FROM users WHERE id = :id/);
  assert.match(deletion, /array_sum\(\$remaining\) !== 0/);
  assert.match(deletion, /\$db->rollBack\(\)/);

  const accountRoute = apiRouter.match(/if \(\$method === 'DELETE' && \$path === 'account'\) \{[\s\S]*?\r?\n {4}\}/)?.[0] ?? "";
  assert.match(accountRoute, /\$userId = genesisRequireUserId\(\);[\s\S]*genesisRequireCsrf\(\);[\s\S]*genesisDeleteAccount\(\$userId\)/);
  assert.match(accountRoute, /'deleted' => true/);
  assert.doesNotMatch(accountRoute, /genesisReadJson\(\)/);

  assert.match(cloud, /deleteGenesisAccount\(userId\?: string\)/);
  assert.match(cloud, /GENESIS_USER_WORKSPACE_STORAGE_PREFIX/);
  assert.match(cloud, /localStorage\.removeItem\(PENDING_KEY\)/);
  assert.match(cloud, /clearTrackerAnalyticsCache\(deletedUserId\)/);
  assert.match(account, /deleteGenesisAccount\(user\.uid\)/);
  assert.match(account, /все связанные с ним данные с сервера GENESIS/);
  assert.match(smoke, /test-account-deletion-survivor/);
  assert.match(smoke, /array_sum\(genesisAccountDataCounts\(\$userId\)\) === 0/);
  assert.match(smoke, /Account deletion removed another user/);
});

test("admin moderation exposes only aggregate habit counts and can optionally blacklist a deleted identity", async () => {
  const [repository, apiRouter, cloud, adminPanel, migration, smoke, styles] = await Promise.all([
    readFile(new URL("../server/src/repository.php", import.meta.url), "utf8"),
    readFile(new URL("../server/public/api/index.php", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/migrations/011_admin_moderation.sql", import.meta.url), "utf8"),
    readFile(new URL("../server/tests/smoke.php", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /ALTER TABLE user_metrics ADD COLUMN habit_count/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS blocked_identities/);
  assert.doesNotMatch(migration, /\bemail\s+TEXT|google_sub\s+TEXT/);
  assert.match(repository, /genesisClampInt\(\$metrics\['habitCount'\][\s\S]*100_000/);
  assert.match(repository, /COALESCE\(m\.habit_count, 0\) AS habit_count/);
  assert.match(repository, /function genesisAdminDeleteUser/);
  assert.match(repository, /\$linkedIdentities = genesisLinkedGoogleAccounts\(\$targetUserId\)/);
  assert.match(repository, /foreach \(\$linkedIdentities as \$linkedIdentity\)/);
  assert.match(repository, /genesisIdentifierHash\('google-sub'/);
  assert.match(repository, /genesisIdentifierHash\('email'/);
  assert.match(repository, /genesisAssertIdentityAllowed\(\$googleSub, \$email\)/);
  assert.match(apiRouter, /count\(\$segments\) === 3[\s\S]*\$segments\[0\] === 'admin'[\s\S]*genesisRequireCsrf\(\)[\s\S]*genesisRequireAdmin\(\$user\)[\s\S]*genesisAdminDeleteUser/);
  assert.match(cloud, /habitCount: number/);
  assert.match(cloud, /deleteAdminUser\(userId: string, blacklist: boolean\)/);
  assert.match(adminPanel, /stats\.totals\.habits/);
  assert.match(adminPanel, /user\.habitCount/);
  assert.doesNotMatch(adminPanel, /user\.yandexCalendarConnected|Яндекс|Yandex/);
  assert.match(adminPanel, /admin-users-table/);
  assert.match(adminPanel, /user\.androidReportedVersion/);
  assert.match(adminPanel, /data-testid="admin-feature-usage"/);
  assert.match(adminPanel, /admin-android-note/);
  assert.match(adminPanel, /Добавить в чёрный список после удаления/);
  assert.match(adminPanel, /confirmation\.trim\(\)\.toLowerCase\(\) !== deleteTarget\.email\.toLowerCase\(\)/);
  assert.match(styles, /\.admin-totals \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(smoke, /genesisAdminDeleteUser/);
  assert.match(smoke, /A blacklisted identity was unexpectedly allowed to sign in/);
});

test("ships the modular encrypted tracker across dashboard, calendars and account settings", async () => {
  const [calendar, tracker, habitInsightsPanel, habitInsights, habitGuidance, streakRewards, cosmeticsBacklog, heroPath, habits, habitReset, habitQuests, achievements, habitNotifications, progress, dailyGoal, rewards, streakProtection, sleep, mood, addiction, analytics, cache, trackerMath, cloud, account, recoveryDialog, repository, migration, styles, sigil, metricSigil, achievementSigil, rankArt, rankSourceArt] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitInsightsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/habit-insights.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/habit-guidance.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/streak-rewards.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/PROJECT_OVERVIEW.md", import.meta.url), "utf8"),
    readFile(new URL("../app/HeroPathPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/habits.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/habit-reset.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/habit-quests.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/achievements.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/habit-notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/habit-progress.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/daily-goal.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/rewards.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/streak-protection.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sleep-tracker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/mood-tracker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/addiction-tracker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/tracker-analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/tracker-cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/tracker-math.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/WorkspaceRecoveryDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/src/repository.php", import.meta.url), "utf8"),
    readFile(new URL("../server/migrations/010_client_workspace_keys.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/HeroicRankSigil.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitMetricSigil.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AchievementSigil.tsx", import.meta.url), "utf8"),
    stat(new URL("../public/habit-ranks/heroic-ranks.webp", import.meta.url)),
    stat(new URL("../assets/habit-ranks/source/heroic-ranks-banner.png", import.meta.url)),
  ]);

  assert.match(calendar, /id: "habits", label: "Привычки", symbol: "✦"/);
  assert.match(calendar, /<HabitDailyPanel[\s\S]*date=\{todayDateValue\}/);
  assert.match(calendar, /<HabitDailyPanel[\s\S]*date=\{selectedDateValue\}/);
  assert.ok(calendar.indexOf("<DayRhythmPanel") < calendar.indexOf('className="today-tasks-panel"'));
  assert.doesNotMatch(calendar, /className="today-create-panel"/);
  assert.ok(calendar.indexOf('className="today-tasks-panel"') < calendar.indexOf("<HabitDailyPanel"));
  assert.match(calendar, /openTaskComposer\("today"\)/);
  assert.match(calendar, /Задачи на сегодня/);
  assert.match(calendar, /На сегодня задач нет/);
  assert.match(calendar, /calendarMode=\{activeTaskCalendarMode\}/);
  assert.match(calendar, /<HabitTrackerPage/);
  assert.match(calendar, /habitTrackingEnabled=\{habitWorkspace\.habitSettings\.enabled\}/);
  assert.match(calendar, /createHabitGoogleReminder/);
  assert.match(calendar, /advanceHabitGoogleReminder/);
  assert.match(calendar, /nextHabitReminderDate/);
  assert.match(calendar, /taskLists\.find\(\(item\) => item\.title === "Привычки GENESIS"\)/);
  assert.match(calendar, /onResetHabitTracking=\{resetAllHabitTracking\}/);
  assert.match(calendar, /clearTrackerAnalyticsCache\(cloudUser\.uid\)/);
  assert.match(calendar, /registerWorkspaceRecoveryRequestHandler/);
  assert.match(calendar, /<WorkspaceRecoveryDialog/);
  assert.match(calendar, /const deleteProject = async/);
  assert.match(calendar, /const deleteProject = async[\s\S]*projectsRef\.current = nextProjects;[\s\S]*taskListLinksRef\.current = nextTaskListLinks;[\s\S]*await persistStructure/);

  assert.match(cloud, /crypto\.subtle\.encrypt\(\{ name: "AES-GCM"/);
  assert.match(cloud, /JSON\.stringify\(\{[\s\S]*\.\.\.encryptedHabitWorkspace/);
  assert.match(cloud, /habits: structure\.habits/);
  assert.match(cloud, /habitCompletions: structure\.habitCompletions/);
  assert.match(cloud, /userProgress: structure\.userProgress/);
  assert.match(cloud, /dailyGoalRecords: structure\.dailyGoalRecords/);
  assert.match(cloud, /quests: structure\.quests/);
  assert.match(cloud, /achievementUnlocks: structure\.achievementUnlocks/);
  assert.match(cloud, /rewardTransactions: structure\.rewardTransactions/);
  assert.match(cloud, /streakFreezeTransactions: structure\.streakFreezeTransactions/);
  assert.match(cloud, /hiddenDefaultTemplates: structure\.hiddenDefaultTemplates/);
  assert.match(cloud, /sleepEntries: structure\.sleepEntries/);
  assert.match(cloud, /addictionEntries: structure\.addictionEntries/);
  assert.match(cloud, /moodEntries: structure\.moodEntries/);
  assert.match(cloud, /WORKSPACE_DEVICE_KEY_PREFIX/);
  assert.match(cloud, /wrapWorkspaceKey/);
  assert.match(cloud, /body: JSON\.stringify\(\{ key: rawKey, wrappedKey:/);
  assert.match(cloud, /recoverWorkspaceKey/);
  assert.doesNotMatch(cloud, /window\.prompt/);
  assert.match(recoveryDialog, /role="dialog"/);
  assert.match(recoveryDialog, /Расшифровать данные/);
  assert.match(recoveryDialog, /request\.validate\(code\)/);
  assert.match(recoveryDialog, /Код обрабатывается только на этом устройстве/);
  assert.match(repository, /workspace_key_enc = :workspace_key/);
  assert.match(repository, /'workspace_key' => genesisEncrypt\(\$key\)/);
  assert.match(repository, /'keyMode' => \$clientManaged \? \(empty\([\s\S]*\) : 'account'/);
  assert.match(migration, /workspace_key_wrapped/);

  assert.doesNotMatch(habits, /type HabitKind/);
  assert.match(habits, /type HabitCompletion/);
  assert.match(habits, /type HabitQualityScale = "none" \| "ten" \| "bipolar"/);
  assert.match(habits, /export function isHabitScheduledForDate/);
  assert.match(habits, /export function habitScore/);
  assert.match(habits, /FOUNDATIONAL_HEROIC_RANKS, HEROIC_RANKS, HERO_PATH_CHECKPOINTS/);
  assert.match(habits, /STARTER_HABIT_TEMPLATES/);
  assert.match(habits, /createHabitFromTemplate/);
  assert.match(habits, /normalizeHiddenDefaultTemplates/);
  assert.match(habits, /trackerSchemaVersion: 16/);
  assert.match(habits, /collapsedSections: HabitSectionId\[\]/);
  assert.match(habits, /sectionOrder: HabitSectionId\[\]/);
  assert.match(habits, /createdDate: string/);
  assert.match(habits, /emoji: string/);
  assert.match(habits, /priority: number/);
  assert.match(habits, /isKeyHabit: boolean/);
  assert.match(habits, /ritualId: HabitRitualId/);
  assert.match(habits, /export function setKeyHabit/);
  assert.match(habits, /userProgress: UserProgress/);
  assert.match(habits, /xpAwarded: number/);
  assert.match(habits, /dailyGoalRecords: DailyGoalRecord/);
  assert.match(habits, /quests: HabitQuest/);
  assert.match(habits, /achievementUnlocks: AchievementUnlock/);
  assert.match(habits, /rewardTransactions: RewardTransaction/);
  assert.match(habits, /streakFreezeTransactions: StreakFreezeTransaction/);
  assert.match(habits, /refreshDailyGoalProgress/);
  assert.match(dailyGoal, /calculateGlobalStreak/);
  assert.match(rewards, /reconcileDailyGoalRewards/);
  assert.match(rewards, /daily-goal:self:/);
  assert.match(habitQuests, /quest:self:/);
  assert.match(habitQuests, /HabitQuestCadence = "daily" \| "weekly" \| "epic"/);
  assert.match(habitQuests, /attainableCompletions/);
  assert.match(habitQuests, /EPIC_QUEST_LAURELS/);
  assert.equal((achievements.match(/id: "/g) ?? []).length, 18);
  assert.match(achievements, /reconcileAchievementUnlocks/);
  assert.match(achievements, /hidden: true/);
  assert.match(habitNotifications, /buildHabitNotificationPlan/);
  assert.doesNotMatch(habitNotifications, /GROUP_WINDOW_MINUTES/);
  assert.match(habitNotifications, /hasNotificationFatigue/);
  assert.doesNotMatch(habitNotifications, /fetch\(|\/api\//);
  assert.match(habits, /applyHabitDeletionLaurelPolicy/);
  assert.doesNotMatch(habits, /reconcileMissedHabitLaurels/);
  assert.match(rewards, /RETIRED_MISSED_HABIT_RESET/);
  assert.match(habits, /export function removeHabitFromWorkspace/);
  assert.match(habits, /export function buyHestiaSpark/);
  assert.match(habits, /export function claimHeroPathAmphora/);
  assert.match(habits, /export function revealHiddenHeroicPath/);
  assert.match(streakProtection, /export function applyAutomaticStreakProtection/);
  assert.match(streakProtection, /hestia-spark-use:self:/);
  assert.match(streakProtection, /comeback:self:/);
  assert.match(habitReset, /export function resetHabitWorkspace/);
  assert.equal((progress.match(/titleEn:/g) ?? []).length, 39);
  assert.match(sleep, /type SleepPlan/);
  assert.match(sleep, /type SleepEntry/);
  assert.match(sleep, /calculateSleepDuration/);
  assert.match(trackerMath, /timeZoneOffset/);
  assert.match(mood, /moodValue: MoodValue/);
  assert.equal((mood.match(/labelEn: "/g) ?? []).length, 12);
  assert.match(addiction, /type AddictionTracker/);
  assert.match(addiction, /type AddictionEntry/);
  assert.match(analytics, /refreshTrackerAnalytics/);
  assert.match(cache, /indexedDB\.open/);

  assert.match(tracker, /type="range"/);
  assert.match(tracker, /sleep-rule-editor/);
  assert.match(tracker, /mood-options/);
  assert.match(tracker, /mood-summary-action/);
  assert.match(tracker, /className="mood-summary" aria-haspopup="dialog"/);
  assert.match(tracker, /className="mood-modal" role="dialog" aria-modal="true"/);
  assert.match(tracker, /Выбрать/);
  assert.match(tracker, /destination="tracker"/);
  assert.doesNotMatch(tracker, /Система календаря/);
  assert.match(tracker, /habit-line-chart/);
  assert.match(tracker, /habit-heatmap/);
  assert.match(tracker, /<HeroPathPanel/);
  assert.match(tracker, /Путь Героя/);
  assert.match(heroPath, /ranks\.map/);
  assert.match(heroPath, /hiddenHeroicPathRevealed\(workspace\.userProgress\)/);
  assert.match(heroPath, /hiddenUnlocked && !hiddenRevealed/);
  assert.match(heroPath, /hiddenRevealed \? <section className="hero-path-second-path"/);
  assert.match(heroPath, /HIDDEN_HEROIC_RANKS/);
  assert.match(heroPath, /hero-path-amphora:self:/);
  assert.match(heroPath, /Путь продолжается…/);
  assert.doesNotMatch(heroPath, /12 тайных|24 rank|24 ран/);
  assert.match(tracker, /daily-goal-ring/);
  assert.match(tracker, /habits-hero-laurels/);
  assert.match(tracker, /hestia-spark-card/);
  assert.match(tracker, /comeback-card/);
  assert.match(tracker, /не начисляя XP и не создавая ложного выполнения/);
  assert.match(tracker, /laurel-ledger/);
  assert.match(tracker, /habit-quest-panel/);
  assert.match(tracker, /achievement-panel/);
  assert.match(tracker, /История, которую нельзя купить/);
  assert.match(tracker, /Тайное достижение/);
  assert.match(tracker, /Лавры, а не опыт ранга/);
  assert.match(tracker, /Лавров начислено/);
  assert.match(tracker, /Режим дневной цели/);
  assert.match(tracker, /Ещё один шаг — и дневная цель выполнена/);
  assert.match(tracker, /habit-template-library/);
  assert.match(tracker, /lockRangeStart=\{isExisting\}/);

  assert.match(tracker, /lockRangeStart=\{isExisting\}/);
  assert.doesNotMatch(tracker, /Начать с завтрашнего дня/);
  assert.match(tracker, /setEditingHabit\(habit\)/);
  assert.match(tracker, /isExisting=\{workspace\.habits\.some/);
  assert.match(tracker, /<HabitLifecycleLibrary/);
  const lifecycleLibrary = await readFile(new URL("../app/HabitLifecycleLibrary.tsx", import.meta.url), "utf8");
  assert.match(lifecycleLibrary, /act\(habit, habit\.active \? "pause" : "resume"\)/);
  assert.match(lifecycleLibrary, /Можно изменять все настройки, кроме баллов и шкалы качества/);
  assert.match(tracker, /applyEditableHabitUpdate/);
  assert.match(tracker, /MAX_HABIT_XP_PER_COMPLETION/);
  assert.match(tracker, /HabitPriorityControl/);
  assert.match(tracker, /HabitEmojiField/);
  assert.match(tracker, /HabitRoleFields/);
  assert.match(tracker, /Главная привычка/);
  assert.match(tracker, /habit-ritual-group/);
  assert.match(tracker, /AdaptiveDifficultyPanel/);
  assert.match(tracker, /StreakRewardLadder/);
  assert.match(habitGuidance, /buildAdaptiveHabitSuggestions/);
  assert.match(streakRewards, /STREAK_REWARD_MILESTONES/);
  assert.match(cosmeticsBacklog, /До отдельного одобрения эту механику не реализовывать/);
  assert.match(tracker, /Точно настроить повторение и дни/);
  assert.match(account, /onHabitTrackingChange/);
  assert.match(account, /Восстановить стандартные привычки/);
  assert.match(account, /Обнулить все привычки/);
  assert.match(account, /role="alertdialog"/);
  assert.match(account, /window\.crypto\.getRandomValues/);
  assert.match(account, /Подтвердить удаление/);
  assert.doesNotMatch(account, /workspaceRecoveryCode/);
  assert.match(account, /код восстановления не нужен/);
  assert.match(account, /Уведомления привычек/);
  assert.match(account, /Тихих часов|тихих часов/);
  assert.doesNotMatch(calendar, /--mobile-nav-count/);
  assert.match(calendar, /<HabitReminderBridge/);
  assert.match(styles, /\.habits-hero[\s\S]*grid-template-areas:[\s\S]*"copy status"[\s\S]*"copy actions"/);
  assert.match(styles, /\.habits-hero-status \{[\s\S]*position:relative;[\s\S]*grid-area:status;/);
  assert.match(styles, /\.daily-goal-ring/);
  assert.match(styles, /\.habit-heatmap > div \{[^}]*grid-template-columns: repeat\(5,minmax\(0,1fr\)\)[^}]*grid-template-rows: repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.laurel-ledger/);
  assert.match(styles, /\.today-tasks-panel/);
  assert.match(styles, /\.habit-quest-panel/);
  assert.match(styles, /\.workspace-recovery-dialog/);
  assert.match(styles, /\.achievement-panel/);
  assert.match(styles, /\.mobile-nav[\s\S]*overflow:hidden/);
  assert.match(styles, /\.app-sidebar \{ overflow:hidden; \}/);
  assert.match(styles, /max-height:900px/);
  assert.match(styles, /\.mood-tracker\.is-open \.mood-summary-action svg/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(sigil, /<svg/);
  assert.match(sigil, /onPointerMove/);
  assert.match(sigil, /rank-sigil-orbit/);
  assert.match(sigil, /HEROIC_RANK_SIGIL_MOTIFS/);
  assert.equal((sigil.match(/primary:/g) ?? []).length, 30);
  assert.match(tracker, /HabitMetricSigil variant="laurels"/);
  assert.match(tracker, /HabitMetricSigil variant="streak"/);
  assert.doesNotMatch(tracker, /habits-hero-laurels"><span/);
  assert.doesNotMatch(tracker, /habits-hero-streak"><span/);
  const trackerPage = tracker.slice(tracker.indexOf("export function HabitTrackerPage"));
  assert.match(trackerPage, /const hasHabits = workspace\.habits\.length > 0;/);
  assert.match(trackerPage, /const dailyPanel = <HabitDailyPanel/);
  assert.ok(trackerPage.indexOf('{hasHabits ? <HabitSectionBlock') < trackerPage.indexOf('className="habit-range-toolbar"'));
  assert.ok(trackerPage.indexOf("<SacredHabitLibrary") > trackerPage.indexOf("<HabitStatistics"));
  assert.ok(trackerPage.indexOf('className="tracker-module-grid"') < trackerPage.indexOf('className="habit-range-toolbar"'));
  assert.ok(trackerPage.includes('rangeToolbar={<section className="habit-range-toolbar">'));
  assert.ok(tracker.indexOf('{rangeToolbar}') > tracker.indexOf('showCompletionCalendar={experimental}'));
  assert.ok(tracker.indexOf('{rangeToolbar}') < tracker.indexOf('className="habit-stat-cards"'));
  assert.match(tracker, /Статистика моих привычек/);
  assert.doesNotMatch(tracker, /Клиентская аналитика/);
  assert.match(tracker, /<HabitInsightsPanel/);
  assert.match(habitInsightsPanel, /Итоги периода/);
  assert.match(habitInsightsPanel, /Индекс Ритма/);
  assert.match(habitInsightsPanel, /Мозаика года/);
  assert.match(habitInsightsPanel, /className="habit-year-mosaic-toggle"/);
  assert.match(habitInsightsPanel, /aria-expanded=\{mosaicOpen\}/);
  assert.match(habitInsightsPanel, /disclosure-chevron\$\{mosaicOpen \? " open" : ""\}/);
  assert.match(habitInsightsPanel, /Личные рекорды и мастерство/);
  assert.match(habitInsights, /HABIT_MASTERY_MILESTONES = \[7, 30, 50, 100, 365, 500, 1_000\]/);
  assert.match(styles, /\.habit-year-mosaic-grid/);
  assert.match(styles, /grid-template-columns:repeat\(14,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.habit-year-mosaic-body \{ padding:4px 13px 15px; overflow-x:visible; \}/);
  assert.match(styles, /\.habit-personal-record-grid/);
  assert.match(styles, /\.streak-reward-track/);
  assert.match(styles, /\.adaptive-habit-panel/);
  assert.match(styles, /\.habit-role-fields/);
  assert.equal((trackerPage.match(/<HabitDailyPanel/g) ?? []).length, 1);
  assert.match(metricSigil, /metric-sigil-laurel-core/);
  assert.match(metricSigil, /metric-sigil-streak-core/);
  assert.match(metricSigil, /onPointerMove/);
  assert.match(metricSigil, /setHighlight/);
  assert.match(achievementSigil, /<svg/);
  assert.match(achievementSigil, /onPointerMove/);
  assert.match(achievementSigil, /achievement-sigil-orbit/);
  assert.match(achievementSigil, /achievement-sigil-secret-lock/);
  assert.match(achievementSigil, /concealed \? \(/);
  assert.match(achievementSigil, /\) : \(\s*<image className="achievement-sigil-art"/);
  assert.doesNotMatch(achievementSigil, /AchievementMotif/);
  assert.match(tracker, /artwork=\{achievement\.artwork\}/);
  assert.match(tracker, /concealed=\{concealed\}/);
  assert.doesNotMatch(tracker, /<AchievementSigil motif=/);
  assert.match(styles, /\.achievement-sigil\.locked \.achievement-sigil-art/);
  assert.match(styles, /\.achievement-sigil-secret-lock/);
  assert.match(styles, /@keyframes metric-sigil-awaken/);
  assert.match(styles, /\.hero-path-panel/);
  assert.match(styles, /\.hero-path-map/);
  assert.match(styles, /\.hero-path-checkpoint/);
  assert.match(styles, /\.hero-path-reveal-gate/);
  assert.match(styles, /@keyframes heroGateOpening/);
  assert.match(styles, /\.habit-reset-dialog/);
  assert.match(styles, /\/habit-ranks\/heroic-ranks\.webp/);
  assert.ok(rankArt.size > 100_000, "heroic rank artwork should be a production image");
  assert.ok(rankSourceArt.size > 1_000_000, "the supplied heroic rank PNG should be preserved as a source asset");
});

test("resetting habit tracking clears every tracker and statistic while preserving preferences", () => {
  const populated = {
    userProgress: {
      lifetimeXp: 9_999,
      laurelsBalance: 321,
      currentRankId: "icarus",
      currentStreak: 14,
      longestStreak: 28,
      streakGoalMode: "perfect",
    },
    habits: [{ id: "habit" }],
    habitCompletions: [{ id: "completion" }],
    sleepPlans: [{ id: "sleep-plan" }],
    sleepEntries: [{ id: "sleep-entry" }],
    moodEntries: [{ id: "mood-entry" }],
    addictionTrackers: [{ id: "addiction" }],
    addictionEntries: [{ id: "addiction-entry" }],
    analyticsSnapshots: [{ id: "snapshot" }],
    dailyGoalRecords: [{ id: "goal" }],
    quests: [{ id: "quest" }],
    achievementUnlocks: [{ id: "achievement" }],
    rewardTransactions: [{ id: "reward" }],
    streakFreezeTransactions: [{ id: "freeze" }],
    habitSettings: {
      enabled: false,
      reportRange: "custom",
      customRangeStart: "2026-01-01",
      customRangeEnd: "2026-02-01",
      dailyGoalModeChanges: [{ id: "mode-change" }],
      plannedRestDays: ["2026-01-10"],
      notifications: { ...DEFAULT_HABIT_NOTIFICATION_SETTINGS, enabled: true, tone: "heroic" },
      feedback: { ...DEFAULT_HABIT_FEEDBACK_SETTINGS, animations: false, sound: true, haptics: true },
    },
    hiddenDefaultTemplates: ["morning-water"],
  };
  const reset = resetHabitWorkspace(populated, "2026-09-18T12:00:00.000Z");

  for (const field of [
    "habits",
    "habitCompletions",
    "sleepPlans",
    "sleepEntries",
    "moodEntries",
    "addictionTrackers",
    "addictionEntries",
    "analyticsSnapshots",
    "dailyGoalRecords",
    "quests",
    "achievementUnlocks",
    "rewardTransactions",
    "streakFreezeTransactions",
    "hiddenDefaultTemplates",
  ]) assert.deepEqual(reset[field], []);
  assert.equal(reset.userProgress.lifetimeXp, 0);
  assert.equal(reset.userProgress.laurelsBalance, 0);
  assert.equal(reset.userProgress.currentRankId, null);
  assert.equal(reset.userProgress.hiddenHeroicPathRevealedAt, null);
  assert.equal(reset.userProgress.currentStreak, 0);
  assert.equal(reset.userProgress.longestStreak, 0);
  assert.equal(reset.userProgress.rhythmScore, 0);
  assert.equal(reset.userProgress.streakGoalMode, "perfect");
  assert.equal(reset.habitSettings.enabled, false);
  assert.equal(reset.habitSettings.reportRange, "custom");
  assert.equal(reset.habitSettings.customRangeStart, "2026-01-01");
  assert.equal(reset.habitSettings.customRangeEnd, "2026-02-01");
  assert.deepEqual(reset.habitSettings.dailyGoalModeChanges, []);
  assert.deepEqual(reset.habitSettings.plannedRestDays, []);
  assert.equal(reset.habitSettings.notifications.enabled, true);
  assert.equal(reset.habitSettings.notifications.tone, "heroic");
  assert.equal(reset.habitSettings.feedback.animations, false);
  assert.equal(reset.habitSettings.feedback.sound, true);
  assert.equal(reset.habitSettings.feedback.haptics, true);
});

test("habit feedback settings are conservative, normalized and independently configurable", () => {
  assert.deepEqual(normalizeHabitFeedbackSettings(undefined), DEFAULT_HABIT_FEEDBACK_SETTINGS);
  assert.deepEqual(normalizeHabitFeedbackSettings({
    animations: false,
    sound: true,
    haptics: true,
    achievementPopups: false,
    questsEnabled: false,
    gamificationWidgets: false,
  }), {
    animations: false,
    sound: true,
    haptics: true,
    achievementPopups: false,
    questsEnabled: false,
    gamificationWidgets: false,
    soundScheme: "calm",
  });
  assert.equal(DEFAULT_HABIT_FEEDBACK_SETTINGS.sound, false, "sound must require explicit consent");
  assert.equal(DEFAULT_HABIT_FEEDBACK_SETTINGS.haptics, false, "haptics must require explicit consent");
});

test("Phase L ships accessible immediate feedback and reduced-motion controls", async () => {
  const [calendar, account, tracker, feedback, styles] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitCompletionFeedback.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(calendar, /deliverHabitFeedback/);
  assert.match(calendar, /HabitCompletionFeedback/);
  assert.match(calendar, /habit-animations-off/);
  assert.match(account, /Отклик и доступность/);
  assert.match(account, /Тактильный отклик/);
  assert.match(account, /Игровые блоки/);
  assert.match(tracker, /role="progressbar"/);
  assert.match(tracker, /aria-valuenow/);
  assert.match(feedback, /aria-live="polite"/);
  assert.match(feedback, /aria-atomic="true"/);
  assert.match(styles, /@keyframes habit-feedback-enter/);
  assert.match(styles, /\.habit-animations-off/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.habit-completion-feedback/);
});

test("starter habit template catalog exposes ten inert calendar-aware suggestions", () => {
  assert.equal(STARTER_HABIT_TEMPLATES.length, 10);
  assert.equal(new Set(STARTER_HABIT_TEMPLATES.map((template) => template.id)).size, 10);
  assert.ok(STARTER_HABIT_TEMPLATES.every((template) => isHabitTemplateId(template.id)));
  assert.ok(STARTER_HABIT_TEMPLATES.every((template) => /\p{Extended_Pictographic}/u.test(template.icon)));

  const focus = STARTER_HABIT_TEMPLATES.find((template) => template.id === "focus-session");
  assert.ok(focus);
  const classicFocus = starterTemplateRecurrencePreset(focus, "profane");
  assert.equal(classicFocus.pattern, "weekdays");
  assert.deepEqual(classicFocus.days, [1, 2, 3, 4, 5]);

  const water = STARTER_HABIT_TEMPLATES.find((template) => template.id === "morning-water");
  assert.ok(water);
  assert.equal(starterTemplateRecurrencePreset(water, "profane").pattern, "daily");
  assert.deepEqual(starterTemplateRecurrencePreset(water, "sacred").days, [1, 2, 3, 4, 5]);
  assert.equal(starterTemplateRecurrencePreset(water, "lunar").days.length, 30);
});

test("habit settings remain editable while scoring and first tracking identity stay locked", () => {
  const recurrence = {
    enabled: true,
    mode: "profane",
    pattern: "daily",
    days: [1, 2, 3, 4, 5, 6, 7],
    interval: 1,
    rangeStart: "2026-09-18",
    rangeEnd: "",
    months: [],
    pyatas: [],
  };
  const previous = {
    id: "habit-original",
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    syncState: "local",
    title: "Чтение",
    description: "20 минут",
    createdDate: "2026-09-18",
    emoji: "📚",
    priority: 4,
    color: "#b28a4a",
    active: true,
    sourceTemplateId: "reading",
    sacredPracticeId: null,
    sacredSectorId: null,
    preferredTime: "20:00",
    schedule: { startDate: "2026-09-18", endDate: null, timezone: "Europe/Moscow", recurrence },
    scoringMode: "quality-ten",
    qualityScale: "ten",
    reminder: { enabled: true, time: "20:00", syncToGoogleTasks: true, showInGoogleCalendar: false, googleTaskId: "task-1", googleEventId: null },
  };
  const candidate = {
    ...previous,
    id: "tampered-id",
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2026-09-20T08:00:00.000Z",
    version: 2,
    title: "Вечернее чтение",
    description: "30 минут без телефона",
    createdDate: "2026-09-01",
    emoji: "🌙",
    priority: 9,
    color: "#356d68",
    sourceTemplateId: null,
    sacredPracticeId: "tampered-practice",
    sacredSectorId: "south",
    preferredTime: "21:30",
    schedule: {
      startDate: "2026-09-01",
      endDate: "2027-01-31",
      timezone: "Europe/Athens",
      recurrence: { ...recurrence, pattern: "weekly", days: [2, 4, 6], rangeStart: "2026-09-01", rangeEnd: "2027-01-31" },
    },
    scoringMode: "none",
    qualityScale: "none",
    reminder: { enabled: true, time: "21:25", syncToGoogleTasks: false, showInGoogleCalendar: true, googleTaskId: null, googleEventId: "event-2" },
  };

  const updated = applyEditableHabitUpdate(previous, candidate);
  assert.equal(updated.title, "Вечернее чтение");
  assert.equal(updated.description, "30 минут без телефона");
  assert.equal(updated.emoji, "🌙");
  assert.equal(updated.priority, 9);
  assert.equal(updated.color, "#356d68");
  assert.equal(updated.preferredTime, "21:30");
  assert.equal(updated.schedule.endDate, "2027-01-31");
  assert.equal(updated.schedule.timezone, "Europe/Athens");
  assert.deepEqual(updated.schedule.recurrence.days, [2, 4, 6]);
  assert.equal(updated.reminder.time, "21:25");
  assert.equal(updated.reminder.showInGoogleCalendar, true);
  assert.equal(updated.id, previous.id);
  assert.equal(updated.createdAt, previous.createdAt);
  assert.equal(updated.createdDate, previous.createdDate);
  assert.equal(updated.schedule.startDate, previous.schedule.startDate);
  assert.equal(updated.schedule.recurrence.rangeStart, previous.schedule.recurrence.rangeStart);
  assert.equal(updated.sourceTemplateId, previous.sourceTemplateId);
  assert.equal(updated.sacredPracticeId, previous.sacredPracticeId);
  assert.equal(updated.sacredSectorId, previous.sacredSectorId);
  assert.equal(updated.scoringMode, previous.scoringMode);
  assert.equal(updated.qualityScale, previous.qualityScale);
  const planned = setNewHabitStartDate(previous, "2026-09-25", "2026-09-18");
  assert.equal(planned.createdDate, "2026-09-25");
  assert.equal(planned.schedule.startDate, "2026-09-25");
  assert.equal(planned.schedule.recurrence.rangeStart, "2026-09-25");
  assert.equal(planned.createdAt, previous.createdAt);
  assert.equal(setNewHabitStartDate(previous, "2026-09-01", "2026-09-18"), previous);
  const editedPlan = applyEditableHabitUpdate(planned, candidate);
  assert.equal(editedPlan.createdDate, "2026-09-25");
  assert.equal(editedPlan.schedule.startDate, "2026-09-25");
  assert.equal(editedPlan.qualityScale, planned.qualityScale);
});

test("task reminder labels express whole days and hours without exposing raw minute offsets", () => {
  assert.equal(formatTaskReminder({ kind: "relative", minutes: 1440 }, "ru"), "За 1 день");
  assert.equal(formatTaskReminder({ kind: "relative", minutes: 4320 }, "ru"), "За 3 дня");
  assert.equal(formatTaskReminder({ kind: "relative", minutes: 7200 }, "ru"), "За 5 дней");
  assert.equal(formatTaskReminder({ kind: "relative", minutes: 120 }, "ru"), "За 2 часа");
  assert.equal(formatTaskReminder({ kind: "relative", minutes: 30 }, "ru"), "За 30 минут");
});

test("habit weekday schedules keep their owning calendar and survive delayed reminder sync", () => {
  const recurrence = {
    enabled: true,
    mode: "classic",
    pattern: "weekdays",
    days: [1, 2, 3, 4, 5, 6, 7],
    interval: 1,
    rangeStart: "2026-09-18",
    rangeEnd: "",
    months: [],
    pyatas: [],
  };
  assert.deepEqual(recurrence.days, [1, 2, 3, 4, 5, 6, 7]);

  const currentWorkspace = {
    habits: [
      {
        id: "habit-with-reminder",
        version: 4,
        updatedAt: "2026-09-23T10:00:00.000Z",
        syncState: "pending",
        schedule: { recurrence },
        reminder: { googleTaskId: null, googleEventId: null },
      },
      {
        id: "newer-habit",
        version: 3,
        updatedAt: "2026-09-23T10:01:00.000Z",
        syncState: "pending",
        schedule: { recurrence: { ...recurrence, days: [2, 4, 6] } },
        reminder: { googleTaskId: null, googleEventId: null },
      },
    ],
  };
  const merged = applyHabitReminderSyncResult(
    currentWorkspace,
    "habit-with-reminder",
    { googleTaskId: "google-task", googleEventId: null },
    "2026-09-23T10:02:00.000Z",
  );
  assert.deepEqual(merged.habits[0].schedule.recurrence.days, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(merged.habits[1].schedule.recurrence.days, [2, 4, 6]);
  assert.equal(merged.habits[0].reminder.googleTaskId, "google-task");
  assert.equal(merged.habits[0].version, 5);
});

test("every habit tracker owns an explicit calendar and can be deliberately converted", async () => {
  const [habits, sleep, addiction, trackerCore, recurrenceBuilder] = await Promise.all([
    readFile(new URL("../app/habits.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sleep-tracker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/addiction-tracker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/tracker-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/RecurrenceBuilder.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(habits, /createHabitFromSacredPractice[\s\S]*defaultHabit\(startDate, calendarMode\)/, "a sacred-practice source must not force a sacred schedule");
  assert.match(sleep, /schedule: normalizeTrackerSchedule\(value\.schedule as Partial<TrackerSchedule>, fallbackDate, calendarMode\)/);
  assert.match(addiction, /schedule: normalizeTrackerSchedule\(value\.schedule as Partial<TrackerSchedule>, fallbackDate, calendarMode\)/);
  assert.match(trackerCore, /A saved tracker schedule owns its calendar mode/);
  assert.match(recurrenceBuilder, /convertTrackerRecurrenceCalendar\(value, nextMode, rangeStart\)/);
});

test("removes legacy GENESIS metadata from user-visible task descriptions", () => {
  const legacy = "Только пользовательский текст\r\n\r\n— GENESIS —\r\nПриоритет: 10\r\nGENESIS-DATA:eyJ0YXNrSWQiOiIxIn0";
  assert.equal(cleanTaskDescription(legacy), "Только пользовательский текст");
  assert.equal(cleanTaskDescription("Заметка\nПриоритет: 10\nGENESIS-DATA:eyJ4IjoxfQ"), "Заметка");
  assert.equal(cleanTaskDescription("Заметка\nСоздано в GENESIS\nПриоритет: 10\nGENESIS-DATA:eyJ4IjoxfQ"), "Заметка");
  assert.equal(cleanTaskDescription("Пользователь написал GENESIS в обычном тексте"), "Пользователь написал GENESIS в обычном тексте");
  assert.equal(cleanTaskDescription("Пользователь написал\n— GENESIS —\nобычную заметку"), "Пользователь написал\n— GENESIS —\nобычную заметку");
});

test("lifetime XP follows four overture, twelve heroic and twelve hidden ranks without moving backwards", () => {
  assert.equal(HEROIC_RANKS.length, 28);
  assert.equal(INTRODUCTORY_HEROIC_RANKS.length, 4);
  assert.equal(FOUNDATIONAL_HEROIC_RANKS.length, 16);
  assert.equal(HIDDEN_HEROIC_RANKS.length, 12);
  assert.deepEqual(HERO_PATH_CHECKPOINTS.map((checkpoint) => checkpoint.rankId), ["icarus", "mountain-tamer", "iron-charioteer", "risen-from-the-abyss", "golden-argonaut", "arcadian-arrow", "spear-of-athena", "calydonian-glory-bearer"]);
  assert.deepEqual(HERO_PATH_CHECKPOINTS.map((checkpoint) => checkpoint.rewardLaurels), [15, 25, 40, 60, 90, 130, 180, 260]);
  assert.deepEqual(INTRODUCTORY_HEROIC_RANKS.map((rank) => rank.id), ["tantalus", "sisyphus", "cyclops", "icarus"]);
  assert.deepEqual(HEROIC_RANKS.map((rank) => rank.threshold), [10, 40, 90, 160, 250, 450, 750, 1_100, 1_550, 2_100, 2_800, 3_700, 4_800, 6_200, 8_000, 10_500, 14_000, 18_500, 24_000, 31_000, 40_000, 52_000, 67_000, 86_000, 110_000, 141_000, 180_000, 230_000]);
  assert.equal(new Set(HEROIC_RANKS.map((rank) => rank.id)).size, 28);
  assert.equal(HIDDEN_HEROIC_PATH_UNLOCK_XP, 10_500);
  assert.equal(hiddenHeroicPathUnlocked(10_499), false);
  assert.equal(hiddenHeroicPathUnlocked(10_500), true);
  assert.equal(visibleHeroicRanksForXp(10_499).length, 16);
  assert.equal(visibleHeroicRanksForXp(10_500).length, 16);
  assert.equal(visibleHeroicRanksForXp(10_500, true).length, 28);

  assert.equal(highestRankForXp(0), null);
  assert.equal(highestRankForXp(9), null);
  assert.equal(heroicRank(9).title, "Путь ещё не начат");
  assert.equal(heroicRank(10).id, "tantalus");
  assert.equal(heroicRank(160).id, "icarus");
  assert.equal(heroicRank(250).id, "lion-heart");
  assert.equal(heroicRank(10_500).id, "risen-from-the-abyss");
  assert.equal(heroicRank(14_000).id, "mirror-victor");
  const lockedHiddenPath = { lifetimeXp: 14_000, hiddenHeroicPathRevealedAt: null };
  assert.equal(hiddenHeroicPathRevealed(lockedHiddenPath), false);
  assert.equal(hiddenHeroicPathRevealed({ lifetimeXp: 14_000, hiddenHeroicPathRevealedAt: "invalid" }), false);
  assert.equal(heroicRankForProgress(lockedHiddenPath).id, "risen-from-the-abyss");
  assert.equal(nextHeroicRankForProgress(lockedHiddenPath), null);
  const revealedHiddenPath = { lifetimeXp: 14_000, hiddenHeroicPathRevealedAt: "2026-09-18T12:00:00.000Z" };
  assert.equal(hiddenHeroicPathRevealed(revealedHiddenPath), true);
  assert.equal(heroicRankForProgress(revealedHiddenPath).id, "mirror-victor");
  assert.equal(nextHeroicRankForProgress(revealedHiddenPath)?.id, "lord-of-the-thread");

  assert.equal(completionXpAward(0, 10), 10);
  assert.equal(completionXpAward(10, 10), 10);
  assert.equal(completionXpAward(10, 20), 20);
  assert.equal(completionXpAward(20, 0), 20);
  assert.equal(MAX_HABIT_XP_PER_COMPLETION, 20);
  assert.equal(completionXpAward(999, 999), 20);
  assert.equal(completionXpAward(999, 999, 10), 10);

  assert.equal(normalizeHabitPriority(-20), 1);
  assert.equal(normalizeHabitPriority(999), 10);
  assert.equal(normalizeHabitPriority("7"), 7);
  assert.equal(normalizeHabitEmoji("not an emoji"), "✨");
  assert.equal(normalizeHabitEmoji("🎯"), "🎯");
  assert.equal(normalizeHabitEmoji("👨‍👩‍👧‍👦extra"), "👨‍👩‍👧‍👦");
  assert.ok(HABIT_EMOJI_CATEGORIES.length >= 10);
  assert.ok(new Set(HABIT_EMOJI_CATEGORIES.flatMap((category) => category.emojis)).size >= 200);
  assert.ok(HABIT_COLORS.length >= 20);
  assert.equal(normalizeHabitColor("#ABCDEF"), "#abcdef");
  assert.equal(normalizeHabitColor("red"), "#bb8f4a");
  assert.equal(canRecordHabitOnDate("2026-09-18", "2026-09-18", "2026-09-18"), true);
  assert.equal(canRecordHabitOnDate("2026-09-18", "2026-09-17", "2026-09-18"), false);
  assert.equal(canRecordHabitOnDate("2026-09-18", "2026-09-19", "2026-09-18"), false);

  const migrated = reconcileUserProgress(null, [{ xpAwarded: 10 }, { xpAwarded: 20 }], "2026-09-18T00:00:00.000Z");
  assert.equal(migrated.lifetimeXp, 30);
  assert.equal(migrated.currentRankId, "tantalus");
  assert.equal(migrated.hiddenHeroicPathRevealedAt, null);

  const afterDeletion = reconcileUserProgress({
    lifetimeXp: 100,
    currentRankId: "cyclops",
    updatedAt: "2026-09-17T00:00:00.000Z",
  }, [], "2026-09-18T00:00:00.000Z");
  assert.equal(afterDeletion.lifetimeXp, 100);
  assert.equal(afterDeletion.currentRankId, "cyclops");
  assert.equal(afterDeletion.updatedAt, "2026-09-17T00:00:00.000Z");
});

test("Hero Path uses the supplied artwork for all sixteen visible ranks and four amphora checkpoints", async () => {
  const rankIds = FOUNDATIONAL_HEROIC_RANKS.map((rank) => rank.id);
  const checkpointIds = HERO_PATH_CHECKPOINTS.slice(0, 4).map((checkpoint) => checkpoint.rankId);
  assert.deepEqual(Object.keys(HEROIC_RANK_ICON_ASSETS), rankIds);
  assert.deepEqual(Object.keys(HERO_PATH_CHECKPOINT_ICON_ASSETS), checkpointIds);
  assert.equal(HEROIC_RANK_ICON_ASSETS["tamer-of-might"]?.src, "/hero-path/256/11_tamer_of_might.webp");

  const artwork = [
    ...Object.values(HEROIC_RANK_ICON_ASSETS),
    ...Object.values(HERO_PATH_CHECKPOINT_ICON_ASSETS),
  ];
  assert.equal(artwork.length, 20);
  for (const asset of artwork) {
    assert.ok(asset);
    const fileName = asset.src.slice(asset.src.lastIndexOf("/") + 1, -".webp".length);
    const [source, small, large] = await Promise.all([
      stat(new URL(`../assets/hero-path/source/${fileName}.png`, import.meta.url)),
      stat(new URL(`../public/hero-path/256/${fileName}.webp`, import.meta.url)),
      stat(new URL(`../public/hero-path/512/${fileName}.webp`, import.meta.url)),
    ]);
    assert.ok(source.size > 0);
    assert.ok(small.size > 0);
    assert.ok(large.size > small.size);
    assert.match(asset.srcSet, new RegExp(`/hero-path/256/${fileName}\\.webp 256w, /hero-path/512/${fileName}\\.webp 512w`));
  }

  const [rankSigil, heroPath, styles, serviceWorker] = await Promise.all([
    readFile(new URL("../app/HeroicRankSigil.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HeroPathPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(rankSigil, /HEROIC_RANK_ICON_ASSETS/);
  assert.match(rankSigil, /className="rank-sigil-image"/);
  assert.match(heroPath, /HERO_PATH_CHECKPOINT_ICON_ASSETS/);
  assert.match(heroPath, /<AmphoraSigil open=\{claimed\} rankId=\{item\.id\}/);
  assert.match(styles, /\.rank-sigil-image \{[^}]*object-fit:contain/);
  assert.match(styles, /\.hero-amphora-sigil img \{[^}]*object-fit:contain/);
  assert.match(serviceWorker, /\.\.\.HERO_PATH_ART/);
});

test("daily goals preserve future-only modes and global streak rules", () => {
  assert.equal(dailyGoalTarget("easy", 7), 1);
  assert.equal(dailyGoalTarget("rhythm", 7), 5);
  assert.equal(dailyGoalTarget("perfect", 7), 7);
  assert.equal(dailyGoalTarget("rhythm", 0), 0);

  const changes = scheduleDailyGoalMode([], "perfect", "2026-09-20", "2026-09-18T10:00:00.000Z");
  assert.equal(dailyGoalModeForDate(changes, "2026-09-19"), "rhythm");
  assert.equal(dailyGoalModeForDate(changes, "2026-09-20"), "perfect");

  const record = (date, scheduledCount, completedCount, options = {}) => buildDailyGoalRecord({
    date,
    mode: "rhythm",
    timezone: options.timezone ?? "Europe/Moscow",
    scheduledCount,
    completedCount,
    today: "2026-09-22",
    isRestDay: options.isRestDay,
    isTimezoneShift: options.isTimezoneShift,
    updatedAt: `${date}T12:00:00.000Z`,
  });
  const successful = [
    record("2026-09-18", 3, 2),
    record("2026-09-19", 0, 0),
    record("2026-09-20", 3, 0, { isRestDay: true }),
    record("2026-09-21", 3, 3),
    record("2026-09-22", 3, 0),
  ];
  assert.deepEqual(successful.map((item) => item.status), ["qualified", "neutral", "rest", "perfect", "open"]);
  assert.deepEqual(calculateGlobalStreak(successful, "2026-09-22"), {
    currentStreak: 2,
    longestStreak: 2,
    lastQualifiedDate: "2026-09-21",
  });

  const failed = [...successful, buildDailyGoalRecord({
    date: "2026-09-22",
    mode: "rhythm",
    timezone: "Europe/Moscow",
    scheduledCount: 3,
    completedCount: 0,
    today: "2026-09-23",
    updatedAt: "2026-09-23T00:00:00.000Z",
  })];
  assert.equal(calculateGlobalStreak(failed, "2026-09-23").currentStreak, 0);

  const timezoneReplacement = { ...record("2026-09-21", 3, 3), timezone: "Asia/Tokyo", updatedAt: "2026-09-21T13:00:00.000Z" };
  const deduplicated = upsertDailyGoalRecord(successful, timezoneReplacement);
  assert.equal(deduplicated.filter((item) => item.date === "2026-09-21").length, 1);
  assert.equal(deduplicated.find((item) => item.date === "2026-09-21").timezone, "Asia/Tokyo");
  assert.equal(upsertDailyGoalRecord(deduplicated, timezoneReplacement).length, deduplicated.length);

  const timezoneTransition = [
    record("2026-09-18", 3, 2),
    record("2026-09-19", 3, 0, { timezone: "Pacific/Auckland", isTimezoneShift: true }),
    record("2026-09-20", 3, 2, { timezone: "America/Los_Angeles" }),
  ];
  assert.equal(timezoneTransition[1].status, "timezone-shift");
  assert.equal(calculateGlobalStreak(timezoneTransition, "2026-09-20").currentStreak, 2, "a timezone transition must not destroy a valid streak");
  assert.equal(reconcileDailyGoalRewards(timezoneTransition, [], "2026-09-20").filter((item) => item.sourceId === "2026-09-19").length, 0, "a timezone transition cannot mint a duplicate daily reward");
});

test("ritual grouping and adaptive difficulty keep the user in control", () => {
  const schedule = { startDate: "2026-09-01", endDate: null, timezone: "Europe/Moscow", recurrence: {} };
  const base = { active: true, createdDate: "2026-09-01", priority: 5, isKeyHabit: false, ritualName: "", schedule };
  const habits = [
    { ...base, id: "reading", title: "Чтение", ritualId: "evening", isKeyHabit: true },
    { ...base, id: "water", title: "Вода", ritualId: "morning", priority: 8 },
    { ...base, id: "journal", title: "Дневник", ritualId: "custom", ritualName: "Тихий час" },
  ];
  const groups = groupHabitsByRitual(habits, false);
  assert.deepEqual(groups.map((group) => group.title), ["Утро", "Вечер", "Тихий час"]);
  assert.equal(groups[1].habits[0].isKeyHabit, true);
  assert.equal(normalizeHabitRitualId("unknown"), "none");
  const singleKey = normalizeKeyHabitSelection([
    { id: "older", isKeyHabit: true, updatedAt: "2026-09-01T00:00:00.000Z", version: 2 },
    { id: "newer", isKeyHabit: true, updatedAt: "2026-09-02T00:00:00.000Z", version: 1 },
  ]);
  assert.deepEqual(singleKey.filter((habit) => habit.isKeyHabit).map((habit) => habit.id), ["newer"]);

  const completions = ["2026-09-03", "2026-09-10", "2026-09-20"].map((date) => ({ habitId: "reading", date, completed: true }));
  const suggestions = buildAdaptiveHabitSuggestions({
    habits: [habits[0]],
    completions,
    today: "2026-09-30",
    calendarMode: "profane",
    isScheduledForDate: () => true,
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].scheduledCount, 28);
  assert.equal(suggestions[0].completedCount, 3);
  assert.ok(suggestions[0].completionRate < 40);
  assert.deepEqual(buildAdaptiveHabitSuggestions({ ...suggestions, habits: [], completions: [], today: "2026-09-30", calendarMode: "profane", isScheduledForDate: () => true }), []);
});

test("the complete streak ladder rewards every milestone once", () => {
  assert.deepEqual(STREAK_REWARD_MILESTONES.map((milestone) => milestone.days), [3, 7, 14, 30, 50, 100, 180, 365, 500, 1_000]);
  const records = Array.from({ length: 7 }, (_, index) => buildDailyGoalRecord({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    mode: "rhythm",
    timezone: "Europe/Moscow",
    scheduledCount: 1,
    completedCount: 1,
    today: "2026-09-08",
    updatedAt: `2026-09-${String(index + 1).padStart(2, "0")}T20:00:00.000Z`,
  }));
  const first = reconcileStreakMilestoneRewards(records, []);
  assert.deepEqual(claimedStreakMilestones(first).map((milestone) => milestone.days), [3, 7]);
  assert.equal(calculateLaurelsBalance(first), 17);
  assert.deepEqual(reconcileStreakMilestoneRewards(records, first), first, "replaying sync must not mint a milestone twice");
});

test("Phase K builds weighted rhythm, weekly comparison, year mosaic and per-habit records locally", () => {
  const goalRecord = (date, completedCount, scheduledCount = 1) => buildDailyGoalRecord({
    date,
    mode: "rhythm",
    timezone: "Europe/Moscow",
    scheduledCount,
    completedCount,
    today: "2026-09-18",
    updatedAt: `${date}T20:00:00.000Z`,
  });
  assert.equal(calculateRhythmScore([goalRecord("2026-09-17", 1), goalRecord("2026-09-18", 1)], "2026-09-18"), 100);
  assert.equal(calculateRhythmScore([], "2026-09-18"), 0);
  const recoveringRhythm = calculateRhythmScore([
    goalRecord("2026-09-01", 0),
    goalRecord("2026-09-16", 1),
    goalRecord("2026-09-17", 1),
    goalRecord("2026-09-18", 1),
  ], "2026-09-18");
  assert.ok(recoveringRhythm > 75 && recoveringRhythm < 100, "recent successful days should restore Rhythm quickly without erasing older history");

  const habit = {
    id: "habit-reading",
    title: "Чтение",
    createdDate: "2026-09-01",
    schedule: { startDate: "2026-09-01", endDate: null },
  };
  const completionDates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-09", "2026-09-10", "2026-09-18"];
  const completions = completionDates.map((date, index) => ({ habitId: habit.id, date, completed: true, xpAwarded: 10, id: `completion-${index}` }));
  const personal = buildHabitPersonalRecord(habit, completions, "2026-09-18", "profane", () => true);
  assert.equal(personal.totalCompletions, 10);
  assert.equal(personal.longestStreak, 7);
  assert.equal(personal.currentStreak, 1);
  assert.equal(personal.completionRate, 56);
  assert.equal(personal.bestMonth, "2026-09");
  assert.equal(personal.reachedMilestone, 7);
  assert.equal(personal.nextMilestone, 30);
  assert.deepEqual(HABIT_MASTERY_MILESTONES, [7, 30, 50, 100, 365, 500, 1_000]);

  const workspace = {
    habits: [habit],
    habitCompletions: [
      { habitId: habit.id, date: "2026-09-10", completed: true, xpAwarded: 10 },
      { habitId: habit.id, date: "2026-09-14", completed: true, xpAwarded: 10 },
      { habitId: habit.id, date: "2026-09-15", completed: true, xpAwarded: 10 },
      { habitId: habit.id, date: "2026-09-18", completed: true, xpAwarded: 10 },
    ],
    dailyGoalRecords: [goalRecord("2026-09-14", 1), goalRecord("2026-09-15", 1), goalRecord("2026-09-18", 1)],
    rewardTransactions: [{ amount: 5, sourceId: "2026-09-18", createdAt: "2026-09-18T18:00:00.000Z" }],
  };
  const weekly = buildWeeklyHabitSummary(workspace, "2026-09-18");
  assert.equal(weekly.startDate, "2026-09-14");
  assert.equal(weekly.completed, 3);
  assert.equal(weekly.previousCompleted, 1);
  assert.equal(weekly.changePercent, 200);
  assert.equal(weekly.xp, 30);
  assert.equal(weekly.laurels, 5);
  assert.equal(weekly.bestHabitTitle, "Чтение");

  const mosaic = buildHabitYearMosaic(workspace.dailyGoalRecords, "2026-09-18");
  assert.equal(mosaic.length, 365);
  assert.equal(mosaic.find((cell) => cell.date === "2026-09-18").status, "perfect");
  assert.equal(mosaic.find((cell) => cell.date === "2026-12-31").status, "future");
  assert.ok(mosaic.every((cell) => cell.week >= 1 && cell.week <= 53 && cell.weekday >= 1 && cell.weekday <= 7));

  const calendarYearMosaic = buildHabitYearMosaic(workspace.dailyGoalRecords, "2026-09-18", { start: "2026-03-20", end: "2027-03-19" });
  assert.equal(calendarYearMosaic[0].date, "2026-03-20");
  assert.equal(calendarYearMosaic.at(-1).date, "2027-03-19");
  assert.equal(calendarYearMosaic.length, 365);

  const presentedMonth = buildHabitPersonalRecord(habit, completions, "2026-09-18", "sacred", () => true, () => ({ key: "sacred:2026:5", label: "ТРИГЕ · 2026" }));
  assert.equal(presentedMonth.bestMonth, "ТРИГЕ · 2026");
});

test("daily, weekly and epic trials stay achievable and reward idempotently", () => {
  const habit = {
    id: "habit-daily",
    active: true,
    schedule: { startDate: "2026-09-14", endDate: null, timezone: "Europe/Moscow", recurrence: {} },
  };
  const isScheduledForDate = (schedule, date) => date >= schedule.startDate && (!schedule.endDate || date <= schedule.endDate);
  const completedDates = ["2026-09-14", "2026-09-15", "2026-09-18"];
  const completions = completedDates.map((date) => ({ habitId: habit.id, date, completed: true }));
  const dailyGoalRecords = [buildDailyGoalRecord({
    date: "2026-09-18",
    mode: "rhythm",
    timezone: "Europe/Moscow",
    scheduledCount: 1,
    completedCount: 1,
    today: "2026-09-18",
    updatedAt: "2026-09-18T09:00:00.000Z",
  })];
  const first = reconcileHabitQuests({
    quests: [],
    habits: [habit],
    completions,
    dailyGoalRecords,
    today: "2026-09-18",
    calendarMode: "profane",
    isScheduledForDate,
    timestamp: "2026-09-18T09:00:00.000Z",
  });
  const daily = first.find((quest) => quest.cadence === "daily");
  const weekly = first.find((quest) => quest.cadence === "weekly");
  const epic = first.find((quest) => quest.cadence === "epic");
  assert.equal(daily?.target, 1);
  assert.equal(daily?.progress, 1);
  assert.equal(daily?.rewardLaurels, DAILY_QUEST_LAURELS);
  assert.ok(weekly && weekly.target > 0 && weekly.target <= 7, "a weekly target must fit the remaining schedule");
  assert.ok(weekly.progress <= weekly.target);
  assert.equal(weekly?.rewardLaurels, WEEKLY_QUEST_LAURELS);
  assert.ok(epic && epic.target > 0 && epic.target <= 30, "an epic target must fit the remaining month");
  assert.equal(epic?.rewardLaurels, EPIC_QUEST_LAURELS);
  assert.deepEqual(currentHabitQuests(first, "2026-09-18").map((quest) => quest.cadence), ["daily", "weekly", "epic"]);

  const dailyReward = reconcileHabitQuestRewards(first, [], "2026-09-18T09:01:00.000Z");
  assert.equal(calculateLaurelsBalance(dailyReward), DAILY_QUEST_LAURELS);
  const fullWeekDates = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"];
  const fullMonthCompletions = Array.from({ length: 17 }, (_, index) => `2026-09-${String(index + 14).padStart(2, "0")}`)
    .map((date) => ({ habitId: habit.id, date, completed: true }));
  const fullGoalRecords = fullWeekDates.map((date) => buildDailyGoalRecord({ date, mode: "perfect", timezone: "Europe/Moscow", scheduledCount: 1, completedCount: 1, today: "2026-09-20", updatedAt: `${date}T20:00:00.000Z` }));
  const completed = reconcileHabitQuests({
    quests: first,
    habits: [habit],
    completions: fullMonthCompletions,
    dailyGoalRecords: fullGoalRecords,
    today: "2026-09-18",
    calendarMode: "profane",
    isScheduledForDate,
    timestamp: "2026-09-18T20:00:00.000Z",
  });
  const allRewards = reconcileHabitQuestRewards(completed, dailyReward, "2026-09-18T20:00:00.000Z");
  assert.equal(calculateLaurelsBalance(allRewards), DAILY_QUEST_LAURELS + WEEKLY_QUEST_LAURELS + EPIC_QUEST_LAURELS);
  assert.deepEqual(reconcileHabitQuestRewards(completed, allRewards), allRewards, "replayed sync cannot reward a quest twice");
  assert.deepEqual(reconcileHabitQuests({ quests: [], habits: [], completions: [], dailyGoalRecords: [], today: "2026-09-18", calendarMode: "profane", isScheduledForDate }), []);
});

test("achievements unlock from real history without changing Rank XP", () => {
  assert.equal(ACHIEVEMENTS.length, 18);
  assert.equal(ACHIEVEMENTS.filter((achievement) => achievement.hidden).length, 8);
  const firstSource = {
    habitCompletions: [{ habitId: "reading", completed: true }],
    dailyGoalRecords: [{ date: "2026-09-18", status: "perfect" }],
    longestStreak: 3,
    rewardTransactions: [],
  };
  assert.deepEqual(achievementMetrics(firstSource), {
    totalCompletions: 1,
    longestStreak: 3,
    longestPerfectRun: 1,
    bestHabitCompletions: 1,
    hasPerfectDay: true,
    hasComeback: false,
  });
  const first = reconcileAchievementUnlocks({ ...firstSource, unlocks: [], timestamp: "2026-09-18T12:00:00.000Z" });
  assert.deepEqual(first.map((unlock) => unlock.achievementId), ["first-step", "three-day-rhythm", "perfect-day"]);
  assert.ok(first.every((unlock) => unlock.userId === "self" && unlock.id === `achievement:${unlock.achievementId}`));

  const perfectWeek = Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 7, 20 + index)).toISOString().slice(0, 10), status: "perfect" }));
  const fullSource = {
    habitCompletions: Array.from({ length: 1_000 }, () => ({ habitId: "reading", completed: true })),
    dailyGoalRecords: perfectWeek,
    longestStreak: 1_000,
    rewardTransactions: [{ reason: "comeback" }],
  };
  const all = reconcileAchievementUnlocks({ ...fullSource, unlocks: first, timestamp: "2026-09-19T12:00:00.000Z" });
  assert.equal(all.length, ACHIEVEMENTS.length);
  assert.equal(all.find((unlock) => unlock.achievementId === "first-step")?.unlockedAt, "2026-09-18T12:00:00.000Z");
  assert.deepEqual(reconcileAchievementUnlocks({ ...fullSource, unlocks: all, timestamp: "2026-09-20T12:00:00.000Z" }), all, "achievement reconciliation must be idempotent");
  assert.deepEqual(reconcileAchievementUnlocks({ habitCompletions: [], dailyGoalRecords: [], longestStreak: 0, rewardTransactions: [], unlocks: [] }), []);
});

test("achievement artwork uses PNG icons and places hidden achievements after public milestones", async () => {
  const expectedArtwork = [
    ["first-step", "/achievement-art/first-step.png"],
    ["three-day-rhythm", "/achievement-art/three-day-rhythm.png"],
    ["seven-sunrises", "/achievement-art/seven-sunrises.png"],
    ["fortnight-rhythm", "/achievement-art/fortnight-rhythm.png"],
    ["perfect-day", "/achievement-art/perfect-day.png"],
    ["habit-thirty", "/achievement-art/habit-thirty.png"],
    ["century", "/achievement-art/century.png"],
    ["iron-rhythm", "/achievement-art/iron-rhythm.png"],
    ["fifty-sunrises", "/achievement-art/fifty-sunrises.png"],
    ["hundred-day-path", "/achievement-art/hundred-day-path.png"],
    ["perfect-week", "/achievement-art/perfect-week.png"],
    ["perfect-month", "/achievement-art/perfect-month.png"],
    ["half-year-circle", "/achievement-art/half-year-circle.png"],
    ["full-revolution", "/achievement-art/full-revolution.png"],
    ["five-hundred-sunrises", "/achievement-art/five-hundred-sunrises.png"],
    ["thousand-day-path", "/achievement-art/thousand-day-path.png"],
    ["comeback", "/achievement-art/comeback.png"],
    ["consistency", "/achievement-art/consistency.png"],
  ];
  assert.deepEqual(ACHIEVEMENTS.map(({ id, artwork }) => [id, artwork]), expectedArtwork);
  const firstHiddenIndex = ACHIEVEMENTS.findIndex(({ hidden }) => hidden);
  assert.equal(firstHiddenIndex, 10);
  assert.ok(ACHIEVEMENTS.slice(0, firstHiddenIndex).every(({ hidden }) => !hidden));
  assert.ok(ACHIEVEMENTS.slice(firstHiddenIndex).every(({ hidden }) => hidden));
  await Promise.all(ACHIEVEMENTS.map(({ artwork }) => access(new URL(`../public${artwork}`, import.meta.url))));
});

test("habit notifications preserve personal times, respect quiet hours and keep the goal separate", () => {
  const settings = normalizeHabitNotificationSettings({
    enabled: true,
    motivational: true,
    tone: "heroic",
    dailyGoalTime: "20:30",
    quietHoursStart: "22:00",
    quietHoursEnd: "07:30",
  });
  assert.equal(isHabitNotificationQuietTime("23:10", settings), true);
  assert.equal(isHabitNotificationQuietTime("06:45", settings), true);
  assert.equal(isHabitNotificationQuietTime("08:00", settings), false);

  const plan = buildHabitNotificationPlan({
    date: "2026-09-18",
    now: new Date(2026, 8, 18, 8, 0),
    language: "ru",
    settings,
    habits: [
      { id: "water", title: "Вода", emoji: "💧", priority: 8, reminderTime: "09:00" },
      { id: "reading", title: "Чтение", emoji: "📚", priority: 6, reminderTime: "09:15" },
      { id: "late", title: "Поздняя практика", emoji: "🌙", priority: 3, reminderTime: "23:00" },
    ],
    dailyGoal: { scheduled: 3, completed: 0, target: 2, currentStreak: 7 },
    xpToNextRank: 80,
  });
  assert.equal(plan.length, 3);
  assert.equal(plan[0].kind, "habit");
  assert.match(plan[0].body, /Вода/);
  assert.equal(new Date(plan[1].scheduledAt).getMinutes(), 15);
  assert.equal(plan[2].kind, "daily-goal");
  assert.doesNotMatch(plan.map((candidate) => candidate.scheduledAt).join(" "), /23:00/);
  assert.ok(plan.every((candidate) => !candidate.id.includes("water") && !candidate.id.includes("reading")), "telemetry identifiers must not contain habit content");

  const goalWithoutIndividualReminder = buildHabitNotificationPlan({
    date: "2026-09-18",
    now: new Date(2026, 8, 18, 8, 0),
    language: "ru",
    settings,
    habits: [],
    dailyGoal: { scheduled: 3, completed: 0, target: 2, currentStreak: 7 },
  });
  assert.equal(goalWithoutIndividualReminder.length, 1, "the daily goal remains achievable when scheduled habits have no individual reminder");
  assert.equal(goalWithoutIndividualReminder[0].kind, "daily-goal");

  const suggestion = suggestHabitReminderTime([
    { completed: true, updatedAt: "2026-09-14T21:10:00" },
    { completed: true, updatedAt: "2026-09-15T21:20:00" },
    { completed: true, updatedAt: "2026-09-16T21:30:00" },
    { completed: true, updatedAt: "2026-09-17T21:40:00" },
  ], "18:00");
  assert.equal(suggestion?.time, "21:30");
  assert.equal(suggestion?.sampleSize, 4);
});

test("notification styles vary without labels and personal timing can cross midnight", () => {
  for (const language of ["ru", "en"]) {
    for (const tone of ["calm", "heroic", "ironic"]) {
      const samples = Array.from({ length: 100 }, (_, index) =>
        habitNotificationMessage(tone, "habit", `2026-09-${index}:reading`, language, "«Reading»"));
      assert.ok(new Set(samples).size >= 8);
      assert.ok(samples.every((message) => message.includes("Reading")));
      assert.ok(samples.every((message) => !/^(Спокойное напоминание|Героический зов|Calm reminder|Heroic call):/i.test(message)));
    }
  }
  const habit = { preferredTime: "00:10", reminder: { timing: "habit", time: "12:00" } };
  assert.equal(habitReminderTime(habit), "00:10");
  assert.equal(habitReminderTime({ ...habit, reminder: { ...habit.reminder, timing: "custom" } }), "12:00");
  const at = habitReminderDateTime("2026-09-29", "00:10", 20);
  assert.equal(at.getDate(), 28);
  assert.equal(at.getHours(), 23);
  assert.equal(at.getMinutes(), 50);
  const settings = { ...DEFAULT_HABIT_NOTIFICATION_SETTINGS, enabled: true, dailyGoalTime: "20:30" };
  const input = { date: "2026-09-28", now: new Date(2026, 8, 28, 8, 0), language: "ru", settings,
    dailyGoal: { scheduled: 1, completed: 0, target: 1, currentStreak: 0 },
    habits: [{ id: "read", title: "Чтение", emoji: "📚", priority: 5, reminderTime: "20:30" }] };
  assert.deepEqual(buildHabitNotificationPlan(input).map(({ kind }) => kind), ["habit", "daily-goal"]);
  const night = { ...input, settings: { ...settings, motivational: false },
    habits: [{ ...input.habits[0], date: "2026-09-29", reminderTime: "00:10", minutesBefore: 20 }] };
  assert.equal(buildHabitNotificationPlan(night).length, 0);
  const allowed = buildHabitNotificationPlan({ ...night, habits: [{ ...night.habits[0], allowDuringQuietHours: true }] });
  assert.equal(allowed.length, 1);
  assert.equal(new Date(allowed[0].scheduledAt).getTime(), at.getTime());
});

test("Hestia Sparks use idempotent ledgers and protect only the global streak", () => {
  assert.equal(HESTIA_SPARK_COST, 120);
  assert.equal(HESTIA_SPARK_MAX, 2);
  const insufficient = purchaseHestiaSpark({
    rewardTransactions: [],
    streakFreezeTransactions: [],
    laurelsBalance: HESTIA_SPARK_COST - 1,
    purchaseId: "insufficient",
  });
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.reason, "insufficient-laurels");
  const funds = [createRewardTransaction({
    amount: 300,
    reason: "weekly-quest",
    sourceId: "quest-funding",
    idempotencyKey: "weekly-quest:self:quest-funding",
    createdAt: "2026-09-18T08:00:00.000Z",
  })];
  const first = purchaseHestiaSpark({
    rewardTransactions: funds,
    streakFreezeTransactions: [],
    laurelsBalance: 300,
    purchaseId: "spark-one",
    createdAt: "2026-09-18T09:00:00.000Z",
  });
  assert.equal(first.ok, true);
  assert.equal(first.reason, "purchased");
  assert.equal(calculateLaurelsBalance(first.rewardTransactions), 180);
  assert.equal(calculateStreakFreezeCount(first.streakFreezeTransactions), 1);

  const retry = purchaseHestiaSpark({
    rewardTransactions: first.rewardTransactions,
    streakFreezeTransactions: first.streakFreezeTransactions,
    laurelsBalance: 180,
    purchaseId: "spark-one",
    createdAt: "2026-09-18T09:05:00.000Z",
  });
  assert.equal(retry.reason, "already-purchased");
  assert.deepEqual(retry.rewardTransactions, first.rewardTransactions);
  assert.deepEqual(retry.streakFreezeTransactions, first.streakFreezeTransactions);

  const second = purchaseHestiaSpark({
    rewardTransactions: retry.rewardTransactions,
    streakFreezeTransactions: retry.streakFreezeTransactions,
    laurelsBalance: 180,
    purchaseId: "spark-two",
    createdAt: "2026-09-18T10:00:00.000Z",
  });
  assert.equal(calculateLaurelsBalance(second.rewardTransactions), 60);
  assert.equal(calculateStreakFreezeCount(second.streakFreezeTransactions), 2);
  const full = purchaseHestiaSpark({
    rewardTransactions: second.rewardTransactions,
    streakFreezeTransactions: second.streakFreezeTransactions,
    laurelsBalance: 60,
    purchaseId: "spark-three",
  });
  assert.equal(full.ok, false);
  assert.equal(full.reason, "inventory-full");

  const record = (date, completedCount, today = "2026-09-20") => buildDailyGoalRecord({
    date,
    mode: "rhythm",
    timezone: "Europe/Moscow",
    scheduledCount: 2,
    completedCount,
    today,
    updatedAt: `${date}T20:00:00.000Z`,
  });
  const records = [record("2026-09-18", 2), record("2026-09-19", 0)];
  const protectedState = applyAutomaticStreakProtection({
    records,
    transactions: first.streakFreezeTransactions,
    protectableDates: new Set(["2026-09-19"]),
    today: "2026-09-20",
    timestamp: "2026-09-20T00:00:00.000Z",
  });
  assert.equal(protectedState.records[1].status, "protected");
  assert.equal(protectedState.records[1].completedCount, 0, "a Spark must not create a fake completion");
  assert.equal(calculateStreakFreezeCount(protectedState.transactions), 0);
  assert.equal(calculateGlobalStreak(protectedState.records, "2026-09-20").currentStreak, 1);
  assert.equal(reconcileDailyGoalRewards(protectedState.records, [], "2026-09-20").some((item) => item.sourceId === "2026-09-19"), false, "a protected miss grants no Laurels");

  const repeatedProtection = applyAutomaticStreakProtection({
    records: protectedState.records,
    transactions: protectedState.transactions,
    protectableDates: new Set(["2026-09-19"]),
    today: "2026-09-20",
  });
  assert.equal(repeatedProtection.transactions.filter((item) => item.reason === "automatic-use").length, 1, "replay cannot consume the same Spark twice");

  const neutralDay = buildDailyGoalRecord({ date: "2026-09-19", mode: "rhythm", timezone: "Europe/Moscow", scheduledCount: 0, completedCount: 0, today: "2026-09-20" });
  const neutralState = applyAutomaticStreakProtection({
    records: [record("2026-09-18", 2), neutralDay],
    transactions: first.streakFreezeTransactions,
    protectableDates: new Set(["2026-09-19"]),
    today: "2026-09-20",
  });
  assert.equal(calculateStreakFreezeCount(neutralState.transactions), 1, "neutral days cannot consume a Spark");
});

test("Comeback rewards three successful days without restoring the broken streak", () => {
  assert.equal(COMEBACK_REWARD_LAURELS, 15);
  const record = (date, completedCount) => buildDailyGoalRecord({
    date,
    mode: "rhythm",
    timezone: "Europe/Moscow",
    scheduledCount: 2,
    completedCount,
    today: "2026-09-24",
    updatedAt: `${date}T20:00:00.000Z`,
  });
  const partial = [
    record("2026-09-18", 2),
    record("2026-09-19", 0),
    record("2026-09-20", 2),
    record("2026-09-21", 2),
  ];
  assert.deepEqual(calculateComebackSummary(partial, "2026-09-24"), {
    active: true,
    triggerDate: "2026-09-19",
    progress: 2,
    target: 3,
    lastCompletedDate: null,
  });
  const completed = [...partial, record("2026-09-22", 2)];
  const summary = calculateComebackSummary(completed, "2026-09-24");
  assert.equal(summary.active, false);
  assert.equal(summary.lastCompletedDate, "2026-09-22");
  assert.equal(calculateGlobalStreak(completed, "2026-09-24").currentStreak, 3, "Comeback rebuilds from zero instead of restoring the previous streak");

  const rewards = reconcileComebackRewards(completed, [], "2026-09-24", "2026-09-24T12:00:00.000Z");
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].amount, COMEBACK_REWARD_LAURELS);
  assert.equal(rewards[0].reason, "comeback");
  assert.deepEqual(reconcileComebackRewards(completed, rewards, "2026-09-24"), rewards, "Comeback reward must be idempotent");

  const protectedMiss = { ...record("2026-09-19", 0), status: "protected" };
  const noComeback = calculateComebackSummary([record("2026-09-18", 2), protectedMiss, record("2026-09-20", 2)], "2026-09-24");
  assert.equal(noComeback.active, false);
  assert.equal(noComeback.lastCompletedDate, null, "a protected day must not start Comeback");
});

test("Laurels use an idempotent ledger for daily goals and Perfect Days", () => {
  assert.equal(DAILY_GOAL_LAURELS, 5);
  assert.equal(PERFECT_DAY_LAURELS, 3);
  const record = (date, completedCount, today = "2026-09-20") => buildDailyGoalRecord({
    date,
    mode: "rhythm",
    timezone: "Europe/Moscow",
    scheduledCount: 3,
    completedCount,
    today,
    updatedAt: `${date}T12:00:00.000Z`,
  });
  const records = [
    record("2026-09-15", 0),
    buildDailyGoalRecord({ date: "2026-09-16", mode: "rhythm", timezone: "Europe/Moscow", scheduledCount: 0, completedCount: 0, today: "2026-09-20" }),
    buildDailyGoalRecord({ date: "2026-09-17", mode: "rhythm", timezone: "Europe/Moscow", scheduledCount: 3, completedCount: 0, today: "2026-09-20", isRestDay: true }),
    record("2026-09-18", 2),
    record("2026-09-19", 3),
    record("2026-09-20", 0),
    record("2026-09-21", 3),
  ];

  const firstPass = reconcileDailyGoalRewards(records, [], "2026-09-20");
  assert.deepEqual(firstPass.map((transaction) => transaction.amount), [5, 5, 3]);
  assert.deepEqual(firstPass.map((transaction) => transaction.reason), ["daily-goal", "daily-goal", "perfect-day"]);
  assert.equal(calculateLaurelsBalance(firstPass), 13);
  assert.ok(firstPass.every((transaction) => transaction.userId === "self" && transaction.currency === "laurels"));

  const repeatedPass = reconcileDailyGoalRewards(records, firstPass, "2026-09-20");
  assert.deepEqual(repeatedPass, firstPass, "reload and repeated synchronization must not duplicate rewards");
  assert.equal(repeatedPass.filter((transaction) => transaction.idempotencyKey === "daily-goal:self:2026-09-19").length, 1);
  assert.equal(repeatedPass.some((transaction) => transaction.sourceId === "2026-09-21"), false, "future Perfect Days must not be rewarded early");
  assert.equal(repeatedPass.some((transaction) => ["2026-09-15", "2026-09-16", "2026-09-17"].includes(transaction.sourceId)), false, "missed, neutral and rest days must not earn Laurels");

  const duplicate = { ...firstPass[0], id: "offline-copy", createdAt: "2026-09-18T13:00:00.000Z" };
  assert.equal(normalizeRewardTransactions([...firstPass, duplicate]).length, firstPass.length, "offline copies use the same idempotency key");

  const quest = createRewardTransaction({ amount: 200, reason: "weekly-quest", sourceId: "quest-1", idempotencyKey: "weekly-quest:self:quest-1", createdAt: "2026-09-19T10:00:00.000Z" });
  const purchase = createRewardTransaction({ amount: -120, reason: "hestia-spark", sourceId: "spark-1", idempotencyKey: "hestia-spark:self:spark-1", createdAt: "2026-09-19T10:01:00.000Z" });
  assert.equal(calculateLaurelsBalance([...firstPass, quest, purchase]), 93, "spendable balance must be derived from the complete ledger");

  const deletedReset = resetLaurelsBalance([...firstPass, quest, purchase], "habit-deleted-reset", "habit-1", "habit-deleted:self:habit-1", "2026-09-20T15:00:00.000Z");
  assert.equal(calculateLaurelsBalance(deletedReset), 0, "deleting a habit resets the full spendable balance");
  assert.equal(deletedReset.at(-1).amount, -93);
  assert.equal(deletedReset.at(-1).reason, "habit-deleted-reset");
  assert.deepEqual(resetLaurelsBalance(deletedReset, "habit-deleted-reset", "habit-1", "habit-deleted:self:habit-1"), deletedReset, "a reset event is idempotent");
  const staleOfflineReward = createRewardTransaction({ amount: 40, reason: "weekly-quest", sourceId: "stale-quest", idempotencyKey: "weekly-quest:self:stale-quest", createdAt: "2026-09-20T14:59:00.000Z" });
  assert.equal(calculateLaurelsBalance([...deletedReset, staleOfflineReward]), 0, "a stale pre-reset reward cannot resurrect Laurels after synchronization");
  const legacyRecordWithoutTimestamp = { ...record("2026-09-14", 3), updatedAt: "" };
  const replayedLegacyReward = reconcileDailyGoalRewards([legacyRecordWithoutTimestamp], deletedReset, "2026-09-20");
  assert.equal(calculateLaurelsBalance(replayedLegacyReward), 0, "reconciling an old goal without a timestamp cannot cross the deletion reset barrier");

  const corruptedMissedHabitReset = {
    id: "reward:habit-missed:self:habit-2:2026-09-20",
    userId: "self",
    currency: "laurels",
    amount: -93,
    reason: "habit-missed-reset",
    sourceId: "habit-2:2026-09-20",
    idempotencyKey: "habit-missed:self:habit-2:2026-09-20",
    createdAt: "2026-09-21T00:00:00.000Z",
  };
  const repairedLedger = normalizeRewardTransactions([...firstPass, quest, purchase, corruptedMissedHabitReset]);
  assert.equal(repairedLedger.some((transaction) => transaction.reason === "habit-missed-reset"), false, "legacy per-habit resets are removed during normalization");
  assert.equal(calculateLaurelsBalance(repairedLedger), 93, "earned Laurels are restored after removing an erroneous missed-habit reset");
});

test("habit deletion retains Laurels only after 50 completed days", () => {
  const rewardTransactions = [
    createRewardTransaction({ amount: 5, reason: "daily-goal", sourceId: "2026-09-18", idempotencyKey: "daily-goal:self:2026-09-18", createdAt: "2026-09-18T20:00:00.000Z" }),
    createRewardTransaction({ amount: 3, reason: "perfect-day", sourceId: "2026-09-18", idempotencyKey: "perfect-day:self:2026-09-18", createdAt: "2026-09-18T20:00:01.000Z" }),
  ];
  const completions = (count, habitId) => Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    return {
      habitId,
      date,
      completed: true,
    };
  });

  const earlyCompletions = completions(HABIT_LAUREL_RETENTION_COMPLETIONS - 1, "habit-early");
  assert.equal(habitCompletionCount(earlyCompletions, "habit-early"), 49);
  const earlyDeletion = applyHabitDeletionLaurelPolicy(rewardTransactions, earlyCompletions, "habit-early", "2026-09-20T12:00:00.000Z");
  assert.equal(earlyDeletion.retained, false);
  assert.equal(calculateLaurelsBalance(earlyDeletion.transactions), 0);
  assert.equal(earlyDeletion.transactions.at(-1).reason, "habit-deleted-reset");

  const masteredCompletions = completions(HABIT_LAUREL_RETENTION_COMPLETIONS, "habit-mastered");
  const masteredDeletion = applyHabitDeletionLaurelPolicy(rewardTransactions, masteredCompletions, "habit-mastered", "2026-09-20T12:00:00.000Z");
  assert.equal(masteredDeletion.retained, true);
  assert.equal(calculateLaurelsBalance(masteredDeletion.transactions), 8);
  assert.equal(masteredDeletion.transactions.at(-1).reason, "habit-mastery-retained");

  const legacyOrphan = reconcileOrphanedHabitLaurels(0, rewardTransactions, "2026-09-20T12:00:00.000Z");
  assert.equal(calculateLaurelsBalance(legacyOrphan), 0, "an old empty workspace with unexplained Laurels self-heals once");
  assert.equal(legacyOrphan.at(-1).reason, "habit-deleted-reset");
  assert.deepEqual(reconcileOrphanedHabitLaurels(0, legacyOrphan, "2026-09-21T12:00:00.000Z"), legacyOrphan, "legacy repair is idempotent");
});

test("tracker scoring and time math preserve the specified invariants", () => {
  assert.equal(scoreHabitFormula("binary", true, null), 10);
  assert.equal(scoreHabitFormula("binary", false, null), 0);
  assert.equal(scoreHabitFormula("quality-ten", true, 1), 1);
  assert.equal(scoreHabitFormula("quality-ten", true, 5), 5);
  assert.equal(scoreHabitFormula("quality-ten", true, 10), 10);
  assert.equal(scoreHabitFormula("quality-bipolar", true, -5), 0);
  assert.equal(scoreHabitFormula("quality-bipolar", true, 0), 10);
  assert.equal(scoreHabitFormula("quality-bipolar", true, 5), 20);
  assert.equal(scoreHabitFormula("quality-bipolar", true, 999), 20);
  assert.equal(scoreHabitFormula("none", true, 10), 0);

  assert.equal(calculateSleepDuration("2026-09-14", "21:00", "23:00", "Europe/Moscow"), 120);
  assert.equal(calculateSleepDuration("2026-09-14", "23:30", "07:30", "Europe/Moscow"), 480);
  assert.equal(calculateSleepDuration("2026-03-07", "23:30", "03:30", "America/New_York"), 180);
  assert.equal(scoreSleepRules(true, [
    { field: "bedtime", operator: "on-or-before", threshold: "23:00", points: 10 },
    { field: "wake", operator: "after", threshold: "08:00", points: -5 },
  ], "22:45", "08:30"), 5);
  assert.equal(scoreSleepRules(false, [{ field: "bedtime", operator: "after", threshold: "23:00", points: -10 }], "23:30", "07:00"), 0);

  assert.notEqual(moodValueColor(-5), moodValueColor(0));
  assert.notEqual(moodValueColor(0), moodValueColor(5));
  assert.notEqual(moodValueColor(5), moodValueColor(6));
  assert.equal(scoreAbstinenceDay(10, 0, true, false), 10);
  assert.equal(scoreAbstinenceDay(10, 0, false, true), 0);
  assert.equal(scoreAbstinenceDay(10, 7, false, true), -7);
  const entries = [
    { trackerId: "a", date: "2026-09-14", cleanDay: true, relapse: false },
    { trackerId: "a", date: "2026-09-15", cleanDay: true, relapse: false },
    { trackerId: "a", date: "2026-09-16", cleanDay: false, relapse: true },
  ];
  assert.equal(currentAbstinenceStreak(entries, "a", "2026-09-15"), 2);
  assert.equal(currentAbstinenceStreak(entries, "a", "2026-09-16"), 0);
  assert.equal(nonNegativeTrackerTotal([[{ score: 10 }], [{ score: -50 }], [{ score: 10 }]]), 0);
});

test("ships the complete interactive bilingual Theokyklos", async () => {
  const [calendar, component, details, assets, styles, i18n] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TheokyklosView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TheokyklosDetailsDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/theokyklos-assets.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/i18n.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(THEOKYKLOS_SEGMENTS.length, 14);
  assert.equal(THEOKYKLOS_DIRECTION_IDS.length, 8);
  assert.deepEqual(new Set(THEOKYKLOS_SEGMENTS.map((segment) => segment.id)), new Set([
    "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest",
    "zenith", "nadir", "hearth", "center", "entrance", "exit",
  ]));
  assert.ok(THEOKYKLOS_SEGMENTS.every((segment) => segment.words.length === 4));
  const englishCopy = THEOKYKLOS_SEGMENTS.flatMap((segment) => [
    segment.short.en,
    segment.title.en,
    segment.patrons.en,
    segment.essence.en,
    segment.description.en,
    ...segment.words.flatMap((word) => [word.pronunciation.en, word.meaning.en]),
  ]).join("\n");
  assert.doesNotMatch(englishCopy, /[А-Яа-яЁё]/u);
  assert.match(calendar, /id: "stoicheion", label: "Оракул", symbol: "ϟ"/);
  assert.match(calendar, /<TheokyklosView/);
  assert.match(component, /theokyklos-mandala/);
  assert.match(component, /Круг божественных сил/);
  assert.match(details, /theokyklos-sacred-practices/);
  assert.match(details, /createHabitFromSacredPractice/);
  assert.match(component, /Circle of Divine Powers/);
  assert.match(component, /const entrancePoint = \{ x: 816, y: 420 \}/);
  assert.match(component, /const exitPoint = \{ x: 84, y: 420 \}/);
  assert.match(component, /entrance on the eastern axis and the exit on the western axis/);
  assert.match(component, /вход расположен на восточной оси, а выход — на западной/);
  assert.match(component, /language === "en" \? "RING" : "КОЛЬЦО"/);
  assert.match(component, /language === "en" \? "HESTIA" : "ГЕСТИЯ"/);
  assert.doesNotMatch(component, /theokyklos-counts/);
  assert.doesNotMatch(component, /theokyklos-ritual-path/);
  assert.match(details, /role="dialog" aria-modal="true"/);
  assert.match(details, /Close segment description/);
  assert.match(details, /useDialogAccessibility/);
  assert.match(component, /"aria-pressed": selectedId === segment\.id/);
  assert.match(details, /segment\.words\.map/);
  assert.match(details, /Священные слова/);
  assert.match(details, /Заклинания Божеств/);
  assert.match(details, /THEOKYKLOS_DETAIL_ART\[segment\.id\]/);
  assert.match(details, /width="1680"[\s\S]*height="945"/);
  assert.match(component, /THEOKYKLOS_SYMBOL_ART\[segment\.id\]/);
  assert.match(component, /<(?:image|TheokyklosSymbolImage) className="theokyklos-mandala-icon/);
  assert.match(details, /<img src=\{THEOKYKLOS_SYMBOL_ART\[segment\.id\]\}/);
  assert.doesNotMatch(component, /theokyklos-segment-index/);
  assert.doesNotMatch(component, /theokyklos-threshold-row/);
  assert.doesNotMatch(component, />\{segment\.symbol\}</);
  const hearthStart = component.indexOf('className={`theokyklos-svg-segment hearth-segment');
  const centerStart = component.indexOf('className={`theokyklos-svg-segment center-segment');
  assert.ok(hearthStart > -1 && centerStart > hearthStart);
  assert.doesNotMatch(component.slice(hearthStart, centerStart), /THEOKYKLOS_SYMBOL_ART\.hearth/);
  assert.match(details, /theokyklos-details-symbol[\s\S]*THEOKYKLOS_SYMBOL_ART\[segment\.id\]/);
  for (const segment of THEOKYKLOS_SEGMENTS) {
    const detailAsset = assets.match(new RegExp(`/theokyklos-art/${segment.id}(?:-[^"]+)?\\.webp`))?.[0];
    const symbolAsset = assets.match(new RegExp(`/theokyklos-symbols/${segment.id}(?:-[^"]+)?\\.png`))?.[0];
    assert.ok(detailAsset, `missing Theokyklos detail artwork mapping for ${segment.id}`);
    assert.ok(symbolAsset, `missing Theokyklos PNG symbol mapping for ${segment.id}`);
    await access(new URL(`../public${detailAsset}`, import.meta.url));
    await access(new URL(`../public${symbolAsset}`, import.meta.url));
  }
  assert.match(styles, /\.theokyklos-view/);
  assert.match(styles, /\.theokyklos-segment-shape/);
  assert.match(styles, /@keyframes theokyklos-rays/);
  assert.match(styles, /\.modal-backdrop\.theokyklos-details-backdrop/);
  assert.match(styles, /\.theokyklos-details-art img \{[^}]*object-fit: cover/);
  assert.doesNotMatch(styles, /\.theokyklos-segment-index/);
  assert.match(styles, /\.theokyklos-segment-direction \{[^}]*font-size: 16px/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.theokyklos-segment-direction \{ font-size: 24px; \}/);
  assert.match(styles, /min-height: calc\(100dvh - 34px\)/);
  assert.match(styles, /height: calc\(100dvh - 92px\)/);
  assert.match(i18n, /"Теокиклос": "Theokyklos"/);
});

test("covers every Theokyklos sector with sacred habits while keeping Stoicheion strictly nine-to-nine", async () => {
  const [calendar, stoicheion, details, tracker, sectorSigil, assets, habits, styles] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StoicheionView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TheokyklosDetailsDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/SacredSectorSigil.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/theokyklos-assets.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/habits.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.equal(SACRED_PRACTICE_SECTOR_IDS.length, 14);
  assert.deepEqual(new Set(SACRED_PRACTICE_SECTOR_IDS), new Set([
    "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "zenith", "nadir", "hearth", "center", "entrance", "exit",
  ]));
  assert.equal(STOICHEION_PRACTICE_SECTOR_IDS.length, 9);
  assert.deepEqual(new Set(STOICHEION_PRACTICE_SECTOR_IDS), new Set([
    "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "center",
  ]));
  assert.equal(STOICHEION_PRACTICE_SECTOR_IDS.some((sectorId) => ["zenith", "nadir", "hearth", "entrance", "exit"].includes(sectorId)), false);
  assert.deepEqual(SACRED_COMPASS_SECTOR_IDS, [
    "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "center",
  ]);
  assert.deepEqual(SACRED_AXIS_SECTOR_IDS, ["zenith", "hearth", "nadir"]);
  assert.deepEqual(SACRED_THRESHOLD_SECTOR_IDS, ["entrance", "exit"]);
  assert.deepEqual(
    new Set([...SACRED_COMPASS_SECTOR_IDS, ...SACRED_AXIS_SECTOR_IDS, ...SACRED_THRESHOLD_SECTOR_IDS]),
    new Set(SACRED_PRACTICE_SECTOR_IDS),
  );
  assert.deepEqual(SACRED_COMPASS_SECTOR_IDS.map((sectorId) => SACRED_SECTOR_NAMES[sectorId].ru), [
    "Север", "Северо-восток", "Восток", "Юго-восток", "Юг", "Юго-запад", "Запад", "Северо-запад", "Центр",
  ]);
  assert.equal(SACRED_PRACTICES.length, 28);
  assert.equal(new Set(SACRED_PRACTICES.map((practice) => practice.id)).size, SACRED_PRACTICES.length);
  for (const sectorId of SACRED_PRACTICE_SECTOR_IDS) {
    assert.equal(sacredPracticesForSector(sectorId).length, 2);
  }
  for (const sectorId of STOICHEION_PRACTICE_SECTOR_IDS) {
    assert.ok(sacredSectorGuidance(sectorId).upright.ru);
    assert.ok(sacredSectorGuidance(sectorId).reversed.ru);
  }
  const englishCopy = SACRED_PRACTICES.flatMap((practice) => [practice.title.en, practice.description.en, practice.myth.en]).join("\n");
  assert.doesNotMatch(englishCopy, /[А-Яа-яЁё]/u);

  assert.match(stoicheion, /position: SpreadPosition \| null/);
  assert.match(stoicheion, /id: StoicheionPracticeSectorId/);
  const spreadBlock = stoicheion.match(/const SPREAD_POSITIONS:[\s\S]*?\] as const;/)?.[0] ?? "";
  const spreadSectorIds = [...spreadBlock.matchAll(/\bid: "([a-z]+)"/g)].map((match) => match[1]);
  assert.equal(spreadSectorIds.length, 9);
  assert.deepEqual(new Set(spreadSectorIds), new Set(STOICHEION_PRACTICE_SECTOR_IDS));
  assert.match(stoicheion, /Практика сектора расклада/);
  assert.match(stoicheion, /Открыть сектор Теокиклоса/);
  assert.match(calendar, /openTheokyklosSector/);
  assert.match(calendar, /initialSectorId=\{requestedTheokyklosSector\}/);
  assert.match(details, /Сакральные привычки/);
  assert.match(details, /updateHabitCompletion/);
  assert.match(tracker, /sacred-habit-library/);
  assert.ok(tracker.indexOf("<SacredHabitLibrary") > tracker.lastIndexOf('label={isEnglish ? "My habit statistics" : "Статистика моих привычек"}'));
  assert.match(tracker, /src="\/habit-reward-art\/hestia-spark\.png"/);
  assert.match(tracker, /src="\/habit-reward-art\/comeback\.png"/);
  await access(new URL("../public/habit-reward-art/hestia-spark.png", import.meta.url));
  await access(new URL("../public/habit-reward-art/comeback.png", import.meta.url));
  assert.doesNotMatch(tracker, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(tracker, /className="sacred-sector-navigation open" id="sacred-sector-picker"/);
  assert.match(tracker, /className="sacred-sector-modal" role="dialog" aria-modal="true"/);
  assert.match(tracker, /Выберите сакральную привычку/);
  assert.match(tracker, /Открыть описание/);
  assert.doesNotMatch(tracker, /Открыть в Теокиклосе/);
  assert.match(tracker, /TheokyklosDetailsDialog segment=\{describedSector\}/);
  assert.match(tracker, /className="secondary-button"[\s\S]*ExperimentalIcon name="eye"/);
  assert.match(tracker, /DialogCloseButton[\s\S]*sacred-sector-header-close/);
  assert.match(tracker, /Открыть полный набор эмодзи/);
  assert.match(tracker, /Без строгого времени/);
  assert.match(tracker, /Свой цвет/);
  assert.match(tracker, /Начать практику/);
  assert.match(tracker, /sacred-compass-grid/);
  assert.match(tracker, /SacredSectorSigil/);
  assert.match(tracker, /SACRED_SECTOR_NAMES/);
  assert.doesNotMatch(tracker, /item\.short\[language\]/);
  assert.match(sectorSigil, /<img src=\{THEOKYKLOS_SYMBOL_ART\[sectorId\]\}/);
  assert.doesNotMatch(sectorSigil, /<svg/);
  assert.match(sectorSigil, /onPointerMove=\{handlePointerMove\}/);
  assert.match(sectorSigil, /data-sacred-sector-sigil=\{sectorId\}/);
  const symbolBlock = assets.match(/THEOKYKLOS_SYMBOL_ART:[\s\S]*?\r?\n\};/)?.[0] ?? "";
  for (const sectorId of SACRED_PRACTICE_SECTOR_IDS) assert.match(symbolBlock, new RegExp(`\\r?\\n  ${sectorId}: "/theokyklos-symbols/`));
  assert.match(habits, /sacredPracticeId: string \| null/);
  assert.match(habits, /createHabitFromSacredPractice/);
  assert.match(styles, /\.stoicheion-sector-practice/);
  assert.match(styles, /\.theokyklos-sacred-practices/);
  assert.match(styles, /\.sacred-habit-library/);
  assert.match(styles, /grid-template-areas:"northwest north northeast" "west center east" "southwest south southeast"/);
  assert.match(styles, /@keyframes sacred-sector-orbit/);
  assert.match(styles, /\.sacred-sector-sigil\.awakened/);
});

test("preserves native Android identity and install compatibility in a source-only checkout", async () => {
  const [installHook, androidBrowserPolicy, androidDownload, calendar, welcome, styles, androidBuild, androidManifest, androidLauncher, androidBaseStyles, androidApi27Styles, assetLinks, htaccess, serviceWorker, sourceChecks] = await Promise.all([
    readFile(new URL("../app/use-pwa-install.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/android-install.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/AndroidDownload.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/WelcomeScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../android/app/build.gradle.kts", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/ru/genesis/calendar/BrowserLauncherActivity.java", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/res/values/styles.xml", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/res/values-v27/styles.xml", import.meta.url), "utf8"),
    readFile(new URL("../public/.well-known/assetlinks.json", import.meta.url), "utf8"),
    readFile(new URL("../public/.htaccess", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/checks.yml", import.meta.url), "utf8"),
  ]);
  const association = JSON.parse(assetLinks)[0];

  assert.match(androidBrowserPolicy, /\/android\/i/);
  assert.match(androidBrowserPolicy, /\/mobile\/i/);
  assert.match(installHook, /window\.location\.hostname[\s\S]*device[\s\S]*android-phone/);
  assert.match(installHook, /isAndroidPhone && !isStandalone/);
  assert.doesNotMatch(installHook, /downloads\/GENESIS-Android-1\.2\.2\.apk/);
  assert.match(installHook, /\/api\/android\/download/);
  assert.doesNotMatch(installHook, /GENESIS-Android-Native-2\.2\.7\.apk/);
  assert.doesNotMatch(calendar, /android-apk-icon-button/);
  assert.match(calendar, /nativeAndroidApkUrl=\{nativeAndroidApkUrl\}/);
  assert.match(calendar, /<AndroidDownload[^>]*toolbar/);
  assert.match(welcome, /<AndroidDownload/);
  assert.match(androidDownload, /android-native-icon-button/);
  assert.match(androidDownload, /android-download-button/);
  assert.match(androidDownload, /android-install-copy\.json/);
  assert.match(androidDownload, /android-update\.json/);
  assert.doesNotMatch(welcome + calendar, /remove the old TWA|сначала удалите|перед установкой удалите/i);
  assert.doesNotMatch(welcome, /download="GENESIS-Android-Native-/);
  assert.doesNotMatch(calendar, /download="GENESIS-Android-Native-/);
  assert.match(styles, /\.android-download-button/);
  assert.match(styles, /\.ux-android-robot/);
  // Distribution packages remain on the existing service; this repository contains source.
  const nativeVersionCode = Number(androidBuild.match(/versionCode = (\d+)/)?.[1]);
  assert.ok(nativeVersionCode >= 57);
  const nativeVersionName = androidBuild.match(/versionName = "([\d.]+(?:-beta\.\d+)?)"/)?.[1];
  assert.ok(nativeVersionName, "Android release must declare a version name");
  assert.match(sourceChecks, /:app:testDebugUnitTest :app:assembleDebug/);
  assert.doesNotMatch(sourceChecks, /GENESIS_ANDROID_RELEASE_KEYSTORE_B64|assembleRelease|bundlePlay|scp |ssh /);
  assert.match(androidBuild, /releaseSigningReady/);
  assert.match(androidBuild, /applicationIdSuffix = debugApplicationSuffix/);
  assert.match(androidBuild, /gradleProperty\("genesisDebugApplicationIdSuffix"\)\.orElse\("\.debug"\)/);
  assert.match(androidBuild, /androidx\.browser:browser:1\.10\.0/);
  assert.match(androidBuild, /isMinifyEnabled = true/);
  const qaRelease = androidBuild.match(/create\("qaRelease"\)\s*\{([^{}]*)\}/);
  assert.ok(qaRelease, "An optimized local QA APK must be isolated from production");
  assert.match(qaRelease[1], /initWith\(getByName\("release"\)\)/);
  assert.match(qaRelease[1], /applicationIdSuffix\s*=\s*"\.qa1103\.release"/);
  assert.match(qaRelease[1], /signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)/);
  assert.doesNotMatch(qaRelease[1], /isMinifyEnabled\s*=\s*false|isDebuggable\s*=\s*true/);
  // Only the isolated QA build may use a debug certificate. Keep the production
  // release and its Play derivative behind the existing real-signing guard.
  const productionRelease = androidBuild.match(/^\s{8}release\s*\{([\s\S]*?)^\s{8}\}/m)?.[1];
  assert.ok(productionRelease);
  assert.match(productionRelease, /if\s*\(releaseSigningReady\)\s*signingConfig\s*=\s*signingConfigs\.getByName\("genesisRelease"\)/);
  assert.doesNotMatch(productionRelease, /initWith\(/);
  const playRelease = androidBuild.match(/create\("play"\)\s*\{([^{}]*)\}/)?.[1];
  assert.ok(playRelease);
  assert.match(playRelease, /initWith\(getByName\("release"\)\)/);
  assert.doesNotMatch(androidBuild.replace(qaRelease[0], ""), /signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)/);
  assert.match(androidManifest, /android\.permission\.INTERNET/);
  assert.match(androidManifest, /\.MainActivity/);
  assert.doesNotMatch(androidManifest, /\.BrowserLauncherActivity/);
  const nativeLauncher = await readFile(new URL("../android/app/src/main/java/ru/genesis/calendar/MainActivity.kt", import.meta.url), "utf8");
  assert.match(nativeLauncher, /setContent/);
  assert.match(nativeLauncher, /GenesisApp/);
  assert.doesNotMatch(nativeLauncher, /WebView|customTab\.launchUrl/);
  assert.match(androidManifest, /android\.support\.customtabs\.action\.CustomTabsService/);
  assert.doesNotMatch(androidManifest, /WebViewFallbackActivity|FALLBACK_STRATEGY/);
  assert.match(androidLauncher, /extends Activity/);
  assert.match(androidLauncher, /CustomTabsClient\.getPackageName/);
  assert.match(androidLauncher, /customTab\.launchUrl/);
  assert.match(androidLauncher, /Intent\.ACTION_VIEW/);
  assert.match(androidLauncher, /queryIntentActivities/);
  assert.match(androidLauncher, /getPackageName\(\)\.equals\(packageName\)/);
  assert.match(androidLauncher, /showLaunchError/);
  assert.doesNotMatch(androidLauncher, /android\.webkit\.WebView|extends\s+LauncherActivity/);
  assert.doesNotMatch(androidBaseStyles, /windowLightNavigationBar/);
  assert.match(androidApi27Styles, /windowLightNavigationBar/);
  assert.deepEqual(association.relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(association.target.package_name, "ru.genesis.calendar");
  assert.match(association.target.sha256_cert_fingerprints[0], /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.match(htaccess, /application\/vnd\.android\.package-archive/);
  assert.match(htaccess, /ForceType application\/vnd\.android\.package-archive/);
  assert.match(htaccess, /Content-Disposition "attachment; filename=GENESIS-Android-1\.2\.2\.apk"/);
  assert.match(htaccess, /Content-Disposition "attachment; filename=GENESIS-Android-Native-2\.0\.0\.apk"/);
  assert.match(htaccess, /Cache-Control "public, max-age=300, must-revalidate"/);
  assert.match(serviceWorker, /url\.pathname\.includes\("\/downloads\/"\)/);
});

test("turns Russian and English voice commands into local task plans", () => {
  const context = {
    language: "ru",
    calendarMode: "sacred",
    today: "2026-09-11",
    timeZone: "Europe/Moscow",
    categories: [],
    projects: [{ title: "Работа", parent: "", category: "" }],
    taskLists: [{ title: "Входящие", accountEmail: "" }],
    accounts: [],
  };
  const russian = createLocalVoicePlan("создай задачу отправить отчёт 15 сентября в 9 утра в проекте Работа приоритет 8 #офис", context);
  assert.deepEqual(russian.tasks[0], {
    title: "отправить отчёт",
    description: "",
    startDate: "2026-09-15",
    dueDate: "2026-09-15",
    time: "09:00",
    project: "Работа",
    taskList: "",
    tags: ["офис"],
    priority: 8,
    reminderMinutes: 0,
  });

  const english = createLocalVoicePlan("create a task call Alex tomorrow at 6:30 pm #calls", { ...context, language: "en" });
  assert.equal(english.tasks[0].title, "call Alex");
  assert.equal(english.tasks[0].startDate, "2026-09-12");
  assert.equal(english.tasks[0].time, "18:30");
  assert.deepEqual(english.tasks[0].tags, ["calls"]);

  const several = createLocalVoicePlan("купить молоко сегодня; забрать посылку послезавтра в 20:00", context);
  assert.equal(several.tasks.length, 2);
  assert.equal(several.tasks[1].startDate, "2026-09-13");

  const naturalProjectPlacement = createLocalVoicePlan(
    "задачу сверить смету завтра разместить в проекте Работа",
    context,
  );
  assert.equal(naturalProjectPlacement.tasks[0].title, "сверить смету");
  assert.equal(naturalProjectPlacement.tasks[0].project, "Работа");

  const projectFirst = createLocalVoicePlan(
    "для проекта под названием Работа добавь задачу подготовить презентацию 15 сентября",
    context,
  );
  assert.equal(projectFirst.tasks[0].title, "подготовить презентацию");
  assert.equal(projectFirst.tasks[0].project, "Работа");

  const noisySpeech = createLocalVoicePlan(
    "ну пожалуйста создай мне новую задачу: позвонить врачу завтра в 18 часов",
    context,
  );
  assert.equal(noisySpeech.tasks[0].title, "позвонить врачу");
  assert.equal(noisySpeech.tasks[0].time, "18:00");
  for (const phrase of [
    "создай задачу под названием Задача номер 1",
    "добавь задачу с названием «Задача номер 1»",
    "создай задачу, назови её Задача номер 1",
    "запланируй задачу по имени Задача номер 1",
    "Задача номер 1",
  ]) {
    assert.equal(createLocalVoicePlan(phrase, context).tasks[0].title, "Задача номер 1", phrase);
  }
  for (const phrase of [
    "create a task named Task number 1",
    "add a task called Task number 1",
    "make a task with the title Task number 1",
    "Task number 1",
  ]) {
    assert.equal(createLocalVoicePlan(phrase, { ...context, language: "en" }).tasks[0].title,
      "Task number 1", phrase);
  }
  assert.throws(
    () => createLocalVoicePlan("создай задачу", context),
    /название задачи/,
  );
});

test("normalizes multiple relative and absolute task reminders", () => {
  assert.deepEqual(normalizeTaskReminders(undefined, 30), [{ kind: "relative", minutes: 30 }]);

  const reminders = normalizeTaskReminders([
    { kind: "relative", minutes: 10 },
    { kind: "relative", minutes: 10 },
    { kind: "relative", minutes: 60 },
    { kind: "relative", minutes: 1_440 },
    { kind: "relative", minutes: 10_080 },
    { kind: "absolute", at: "2026-10-28T06:00:00.000Z" },
    { kind: "relative", minutes: 30 },
  ]);
  assert.equal(reminders.length, MAX_TASK_REMINDERS);
  assert.deepEqual(reminders.slice(0, 2), [
    { kind: "relative", minutes: 10 },
    { kind: "relative", minutes: 60 },
  ]);

  const absolute = { kind: "absolute", at: new Date("2026-10-28T09:00:00").toISOString() };
  assert.equal(reminderMinutesBeforeTask(absolute, "2026-10-28", "10:00"), 60);
});

test("formats canonical task times as 24-hour or AM/PM values", () => {
  assert.equal(formatTimeValue("00:05", "24h"), "00:05");
  assert.equal(formatTimeValue("00:05", "12h"), "12:05 AM");
  assert.equal(formatTimeValue("12:30", "12h"), "12:30 PM");
  assert.equal(formatTimeValue("23:59", "12h"), "11:59 PM");
  assert.deepEqual(twelveHourParts(15), { hour: 3, period: "PM" });
  assert.equal(hourFromTwelveHour(12, "AM"), 0);
  assert.equal(hourFromTwelveHour(12, "PM"), 12);
  assert.equal(formatClockTime(new Date(2026, 0, 1, 13, 7, 9), "12h"), "01:07:09 PM");
});

test("resolves the elemental period and divine watch from device time", () => {
  const at = (hour, minute = 0, second = 0) => getDayRhythmMoment(new Date(2026, 0, 1, hour, minute, second));

  assert.equal(DAY_RHYTHM_PERIODS.length, 4);
  assert.equal(DAY_RHYTHM_PERIODS.flatMap((period) => period.watches).length, 12);
  assert.deepEqual([at(0).period.id, at(0).watch.deity], ["earth", "Гестия"]);
  assert.equal(at(2).watch.deity, "Гера");
  assert.equal(at(4).watch.deity, "Посейдон");
  assert.deepEqual([at(6).period.id, at(6).watch.deity], ["air", "Арес"]);
  assert.equal(at(10, 59).watch.deity, "Гермес");
  assert.deepEqual([at(12).period.id, at(12).watch.deity], ["fire", "Артемида"]);
  assert.equal(at(16).watch.deity, "Деметра");
  assert.deepEqual([at(18).period.id, at(18).watch.deity], ["water", "Гефест"]);
  assert.deepEqual([at(20).watch.deity, at(20).watch.symbol], ["Афина", "⚴"]);
  assert.equal(at(20, 30, 15).remainingSeconds, 5_385);
  assert.equal(at(23, 59).watch.deity, "Зевс");
  assert.equal(formatDayRhythmRange(18, 24, "24h"), "18:00–00:00");
  assert.equal(formatDayRhythmRange(18, 24, "12h"), "06:00 PM–12:00 AM");
  assert.equal(formatDayRhythmRange(0, 6, "12h"), "12:00 AM–06:00 AM");
});

test("habit dates follow the selected calendar while canonical day keys stay stable", async () => {
  const [calendarData, tracker, insightsPanel, insights, habits, recurrenceBuilder, calendarDatePicker] = await Promise.all([
    readFile(new URL("../app/calendar-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitInsightsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/habit-insights.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/habits.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/RecurrenceBuilder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/CalendarDatePicker.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(calendarData, /export function formatCalendarDateValue/);
  assert.match(calendarData, /export function calendarYearRange/);
  assert.match(calendarData, /export function calendarMonthRange/);
  assert.match(calendarData, /export function calendarQuarterRange/);
  assert.match(calendarData, /export function calendarMonthKey/);
  assert.match(calendarData, /export function formatCalendarMonthValue/);
  assert.match(tracker, /reportCalendarStarts\(date, calendarMode, reportContext\)/);
  assert.match(tracker, /formatCalendarDateValue\(habit\.createdDate, calendarMode, true\)/);
  assert.match(tracker, /formatCalendarDateValue\(latestProtectedDate, calendarMode, true\)/);
  assert.match(tracker, /formatCalendarDateValue\(comeback\.lastCompletedDate, calendarMode, true\)/);
  assert.match(tracker, /<CalendarDatePicker mode=\{calendarMode\}/);
  assert.doesNotMatch(tracker, /type="date"/);
  assert.doesNotMatch(tracker, /created \$\{habit\.createdDate\}/);
  assert.match(insightsPanel, /calendarYearRange\(date, calendarMode, reportContext\)/);
  assert.match(insightsPanel, /calendarMonthKey\(value, calendarMode, reportContext\)/);
  assert.match(insightsPanel, /formatCalendarDateValue\(cell\.date, calendarMode, true, reportContext\)/);
  assert.match(insights, /monthPresentation/);
  assert.match(insights, /range\?: \{ start: string; end: string \}/);
  assert.match(habits, /calendarStarts\?: \{ month: string; quarter: string; year: string \}/);
  assert.match(recurrenceBuilder, /formatCalendarDateValue\(rangeStart, displayCalendarMode, true, value.calendarContext\)/);
  assert.doesNotMatch(recurrenceBuilder, /<strong>\{rangeStart\}<\/strong>/);
  assert.match(recurrenceBuilder, /showGregorianReference=\{destination !== "tracker"\}/);
  assert.match(calendarDatePicker, /showGregorianReference = true/);
  assert.match(calendarDatePicker, /showGregorianReference \? <small>/);
});

test("Path of the Hero uses a full-size accessible glowing action button", async () => {
  const [tracker, styles] = await Promise.all([
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(tracker, /className="hero-path-open"/);
  assert.match(tracker, /className="hero-path-open-sigil"/);
  assert.doesNotMatch(tracker, /Путь Героя"\} →/);
  assert.match(styles, /\.habits-hero-actions button \{[^}]*min-width:210px;[^}]*min-height:44px;/);
  assert.match(styles, /@keyframes hero-path-button-glow/);
  assert.match(styles, /@keyframes hero-path-button-shimmer/);
  assert.match(styles, /\.hero-path-open \{[\s\S]*color:#e2c37b;[\s\S]*background:linear-gradient\(135deg,var\(--palette-recessed, #071f20\) 0%,var\(--palette-surface, #0d3532\) 52%,var\(--palette-recessed, #092725\) 100%\)/);
  assert.match(styles, /\.hero-path-open-sigil svg \{[^}]*stroke:#e2c37b;/);
  assert.match(styles, /\.hero-path-open:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:[\s\S]*\.hero-path-open/);
});

test("QA-03 keeps every mobile navigation item readable without horizontal scrolling", async () => {
  const [calendar, styles] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(calendar, /--mobile-nav-count/);
  assert.match(styles, /@media \(max-width:520px\) \{[\s\S]*\.genesis-app \{ padding-bottom:calc\(118px \+ env\(safe-area-inset-bottom\)\); \}/);
  assert.match(styles, /@media \(max-width:520px\) \{[\s\S]*\.mobile-nav \{[^}]*display:flex;[^}]*flex-wrap:wrap;[^}]*overflow:hidden;/);
  assert.match(styles, /@media \(max-width:520px\) \{[\s\S]*\.mobile-nav button \{[^}]*min-width:44px;[^}]*min-height:48px;[^}]*flex:1 1 calc\(20% - 2px\);/);
  assert.match(styles, /@media \(max-width:520px\) \{[\s\S]*\.mobile-nav button > small \{[^}]*font-size:8px;/);
});

test("mobile Gregorian calendar fits all seven weekdays without horizontal scrolling", async () => {
  const [calendar, styles] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const tabletRules = styles.indexOf("@media (max-width: 1100px)");
  const mobileRulesStart = styles.indexOf("@media (max-width: 760px)", tabletRules);
  const mobileRulesEnd = styles.indexOf("/* Live elemental rhythm of the day. */", mobileRulesStart);
  const mobileRules = styles.slice(mobileRulesStart, mobileRulesEnd);

  assert.ok(tabletRules > -1 && mobileRulesStart > tabletRules && mobileRulesEnd > mobileRulesStart);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \{[^}]*overflow-x:hidden;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.calendar-mode-days \{[\s\S]*min-width:0;[\s\S]*grid-template-columns:repeat\(7,minmax\(0,1fr\)\);/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.calendar-mode-day,[\s\S]*min-height:112px;[\s\S]*overflow:hidden;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.profane-weekday-patron \{[\s\S]*display:grid;[\s\S]*text-align:center;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.profane-weekday-deity \{[\s\S]*display:-webkit-box;[\s\S]*-webkit-line-clamp:2;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.profane-weekday-name,[\s\S]*\.profane-weekday-guidance[\s\S]*display:none;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.calendar-mode-day\.adjacent-month \.adjacent-month-label,[\s\S]*display:none;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.calendar-mode-primary > small \{[^}]*display:none;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.calendar-cross-date\.lunar-date \{[\s\S]*position:absolute;[\s\S]*width:17px;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.calendar-solar-mark \{[\s\S]*display:inline-flex;[\s\S]*width:17px;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.calendar-day-task-control \{[\s\S]*display:flex;/);
  assert.match(mobileRules, /\.calendar-mode-calendar\.mode-profane \.calendar-day-task-count \{[\s\S]*min-width:14px;/);
  assert.doesNotMatch(calendar, /className="profane-weekday-deity"/);
  assert.doesNotMatch(calendar, /className="profane-weekday-guidance"/);
  assert.match(calendar, /className="calendar-lunar-day-label"/);
  assert.match(await readFile(new URL("../app/CalendarTaskCounts.tsx", import.meta.url), "utf8"), /className="calendar-day-task-count"/);
  assert.match(calendar, /onClick=\{\(\) => openCalendarDate\(date, "calendar"\)\}/);
});

test("ships account-owned Standart colour schemes while preserving authored controls and assets", async () => {
  const [calendar, account, cloud, controller, datePicker, timePicker, styles, layout, webEntry, repository, migration] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/theme-controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/CalendarDatePicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TimeClockPicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/experimental-theme.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/src/repository.php", import.meta.url), "utf8"),
    readFile(new URL("../server/migrations/012_account_theme.sql", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(account, /Тема Experimental/);
  assert.doesNotMatch(account, /Текущая тема|CURRENT_THEME_LABEL/);
  assert.match(account, /role="switch"/);
  assert.match(account, /COLOR_MODE_NAMES\[user.language\]\.light/);
  assert.match(account, /COLOR_MODE_NAMES\[user.language\]\.group/);
  assert.match(calendar, /aria-haspopup="dialog"/);
  assert.match(calendar, /setAccountOpen\(true\)/);
  assert.doesNotMatch(calendar, />\s*Личная страница\s*</);
  assert.match(calendar, /createGenesisThemeController/);
  assert.match(calendar, /themeState=\{themeState\}/);
  assert.match(calendar, /onThemeChange=\{changeGenesisTheme\}/);
  assert.doesNotMatch(calendar, /Experimental может работать нестабильно|confirmExperimentalTheme/);
  assert.match(calendar, /normalizeWebTheme\(currentUser.theme\)/);
  assert.doesNotMatch(calendar, /key=\{themeState|key=\{.*theme/);
  assert.match(cloud, /expectedThemeRevision/);
  assert.match(repository, /theme_revision = :theme_revision/);
  assert.match(cloud, /"\/account\/preferences"/);
  assert.match(repository, /theme_revision = :expected_theme_revision/);
  assert.match(repository, /\$statement->rowCount\(\) !== 1/);
  assert.match(repository, /\['standart', 'standart-dark', 'experimental', 'experimental-dark'\]/);
  assert.match(migration, /DEFAULT 'standart'/);
  assert.match(controller, /ThemeConflictError/);
  assert.match(controller, /root\.setAttribute\(GENESIS_THEME_ATTRIBUTE/);
  assert.match(layout, /import "\.\/experimental-theme\.css"/);
  assert.match(webEntry, /import "\.\.\/app\/experimental-theme\.css"/);
  assert.match(styles, /html\[data-genesis-theme\^="standart"\]/);
  assert.match(styles, /\[hidden\], \[hidden\] \*/);
  assert.doesNotMatch(styles, /(^|\n)\s*(button|input|img|svg|\.card)\s*[{,]/m);
  assert.doesNotMatch(styles, /all\s*:/);
  assert.match(datePicker, /data-genesis-preserve="gregorian-date-picker"/);
  assert.match(datePicker, /data-genesis-preserve=\{`\$\{mode\}-date-picker`\}/);
  assert.match(timePicker, /data-genesis-preserve=\{`custom-time-picker-\$\{timeFormat\}`\}/);
  assert.match(calendar, /data-genesis-preserve="task-priority"/);
  assert.match(calendar, /data-genesis-preserve="today-hero-art"/);
});

test("keeps every internal GENESIS URL free of the transient QA marker", async () => {
  const [cleaner, calendar, cloud, layout, webEntry] = await Promise.all([
    readFile(new URL("../app/AppUrlCleaner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/main.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(cleaner, /cleanGenesisAppUrl\(window\.location\.href\)/);
  assert.match(calendar, /cleanGenesisAppUrl\(nextUrl\)/);
  assert.match(cloud, /const returnTo = cleanGenesisAppUrl\(window\.location\.href\)/);
  assert.match(layout, /<AppUrlCleaner \/>/);
  assert.match(webEntry, /<AppUrlCleaner \/>/);
});

test("Experimental applies one design system across ordinary views and adds safe workspace tabs", async () => {
  const [calendar, habits, account, admin, assistant, voice, styles] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/GeminiAssistant.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LocalVoiceAssistant.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/experimental-theme.css", import.meta.url), "utf8"),
  ]);

  assert.match(calendar, /<TodayBlocks\b[^>]*order=\{todayOrder\}[^>]*>/);
  assert.match(await readFile(new URL("../app/TodayBlocks.tsx", import.meta.url), "utf8"), /className="today-view" data-exp-layout="view"/);
  assert.match(calendar, /className="projects-view" data-exp-layout="view"/);
  assert.match(calendar, /task-composer-modal/);
  assert.match(calendar, /task-composer-tabs.*role="tablist"/);
  assert.match(calendar, /taskComposerDialogRef/);
  assert.match(calendar, /tabIndex=\{composerTab === tab \? 0 : -1\}/);
  assert.match(calendar, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(calendar, /role="tabpanel"/);
  assert.match(calendar, /renderTaskCreateForm\("composer"\)/);
  assert.match(calendar, /Array\.isArray\(task\.tags\)/);
  assert.match(calendar, /<ViewErrorBoundary resetKey=\{view\}>/);
  assert.match(habits, /data-exp-layout="view"/);
  assert.match(habits, /className=\{webHeaderEnabled \? "header-section-switch habit-header-tabs" : "experimental-habit-tabs"\} role="tablist"/);
  assert.match(habits, /experimental-habit-tab-\$\{activeHabitTab\}/);
  assert.match(habits, /experimental-habit-section-today/);
  assert.match(habits, /experimental-habit-section-library/);
  assert.match(habits, /experimental-habit-section-modules/);
  assert.match(habits, /experimental-habit-section-progress/);
  assert.match(habits, /<SleepEditor .* allowCalendarModeChange onSave=/);
  assert.match(habits, /<AddictionEditor .* allowCalendarModeChange onSave=/);
  for (const component of ["HabitTemplateSetup", "HabitEditor"]) {
    const props = habits.match(new RegExp(`<${component}\\b[^\\n]+`))?.[0];
    assert.ok(props, `${component} is rendered`);
    assert.match(props, /\ballowCalendarModeChange\b/);
    assert.match(props, /\bonSave=/);
  }
  assert.match(account, /data-exp-layout="view" data-exp-ui="dialog"/);
  assert.match(admin, /className="admin-view" data-exp-layout="view"/);
  assert.match(assistant, /data-exp-ui="dialog"/);
  assert.match(voice, /data-exp-ui="dialog"/);
  assert.match(styles, /--font-ui: Inter/);
  assert.match(styles, /--font-heading: var\(--font-ui\)/);
  assert.match(styles, /--ui-control-height: 44px/);
  assert.match(styles, /\.experimental-workspace-tabs/);
  assert.match(styles, /\.experimental-habit-tabs/);
  assert.match(styles, /\.project-tree-workspace/);
  assert.match(styles, /\.shared-projects-shell/);
  assert.match(styles, /\.account-security-grid > article/);
  assert.match(styles, /\[data-exp-ui="dialog"\]/);
  assert.match(`${styles}\n${await readFile(new URL("../app/web-standart.css", import.meta.url), "utf8")}`, /prefers-reduced-motion/);
  assert.doesNotMatch(styles, /gx-today-panel-enter|experimental-google-connect/);
  assert.doesNotMatch(styles, /html\[data-genesis-theme="standart"\][^\n{]*(?:img|picture|svg)\s*\{/);
  assert.doesNotMatch(calendar, /experimental-theme-toggle|requestedExperimentalTheme/);
  assert.match(calendar, /setTheme\(normalizeWebTheme\(theme\)\)/);
  assert.match(calendar, /experimentalThemeActive=\{false\}/);
  assert.match(account, /withThemeColorMode\(themeState.theme, (?:false|true)\)/);

});

test("mood tracker exposes twelve choices in one responsive desktop row", async () => {
  const [mood, styles, analytics, habits] = await Promise.all([
    readFile(new URL("../app/mood-tracker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/tracker-analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/habits.ts", import.meta.url), "utf8"),
  ]);

  assert.equal((mood.match(/labelEn: "/g) ?? []).length, 12);
  assert.match(mood, /value: 6, label: "Восторг", labelEn: "Delighted"/);
  assert.match(mood, /Math\.min\(6, Math\.round\(value\)\)/);
  assert.match(mood, /Math\.min\(6, Math\.round\(rawMoodValue\)\)/);
  assert.match(styles, /\.mood-options \{[^}]*grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/);
  assert.match(styles, /max-width: 760px[\s\S]*\.mood-options[^}]*repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /max-width: 430px[\s\S]*\.mood-options[^}]*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(analytics, /moodDistribution: Array\.from\(\{ length: 12 \}/);
  assert.match(habits, /moodDistribution: Array\.from\(\{ length: 12 \}/);
});

test("QA-01 precaches the complete cold-install shell before activating the worker", async () => {
  const [serviceWorker, viteConfig, packageSource, verifier, htaccess, installHook, tracker, styles, webEntry, cloud, calendar] = await Promise.all([
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../vite.web.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verify-offline-precache.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/.htaccess", import.meta.url), "utf8"),
    readFile(new URL("../app/use-pwa-install.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.match(viteConfig, /genesis-offline-precache-manifest/);
  assert.match(viteConfig, /precache-manifest\.js/);
  assert.match(viteConfig, /createHash\("sha256"\)/);
  assert.match(viteConfig, /PRECACHE_STATIC_REVISION = "lunar-cool-calendar-art-v8"/);
  assert.match(packageJson.scripts["build:web"], /^vite build --config vite\.web\.config\.ts && .*node scripts\/verify-offline-precache\.mjs$/);
  assert.match(verifier, /missingAssets/);
  assert.match(verifier, /REQUIRED_VISUAL_ASSETS/);
  assert.match(verifier, /mandatory entry assets/);
  assert.match(serviceWorker, /importScripts\(new URL\("\.\/precache-manifest\.js", SCOPE\)\.href\)/);
  assert.match(serviceWorker, /REQUIRED_SHELL/);
  assert.match(serviceWorker, /ACHIEVEMENT_ART/);
  assert.match(serviceWorker, /HABIT_REWARD_ART/);
  assert.match(serviceWorker, /HERO_RANK_BANNER_ART/);
  assert.match(serviceWorker, /\.\/habit-ranks\/heroic-ranks\.webp/);
  assert.match(serviceWorker, /CALENDAR_ART/);
  assert.match(serviceWorker, /\.\/calendar-art\/saturn-cronus\.webp/);
  assert.match(verifier, /calendar-art\/saturn-cronus\.webp/);
  assert.match(serviceWorker, /THEOKYKLOS_ART/);
  assert.match(serviceWorker, /THEOKYKLOS_SYMBOL_ART/);
  assert.match(serviceWorker, /await cache\.addAll\(/);
  assert.doesNotMatch(serviceWorker, /skipWaiting\(/);
  assert.match(serviceWorker, /cache\.match\(request\)/);
  assert.match(serviceWorker, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE/);
  assert.match(installHook, /updateViaCache: "none"/);
  assert.doesNotMatch(webEntry, /controllerchange|window\.location\.reload\(\)/);
  assert.match(webEntry, /registration\.update\(\)/);
  assert.match(htaccess, /\^\(\?:sw\|relocated-sw\|precache-manifest\)\\\.js\$/);
  assert.match(htaccess, /\^\(\?:index\\\.html\|legacy-home\\\.php\|legacy-relocation-notice\\\.\(\?:css\|js\)\|deploy-meta\\\.json\)\$/);
  assert.ok(htaccess.includes('<FilesMatch "^android-update\\.json$">'));
  assert.match(htaccess, /no-cache, no-store, must-revalidate/);
  assert.match(cloud, /const API_TIMEOUT_MS = 20_000/);
  assert.match(cloud, /if \(polling\) return;/);
  assert.match(cloud, /tasksToUpload\.slice\(index, index \+ batchSize\)/);
  assert.match(calendar, /setSyncStatus\(navigator\.onLine \? "error" : "offline"\);[\s\S]*}, 45_000\)/);

  assert.doesNotMatch(tracker, /sacred-library-toggle/);
  assert.doesNotMatch(tracker, /<DisclosureChevron open=\{expanded\}/);
  assert.match(tracker, /<div hidden=\{collapsed\} className="sacred-sector-navigation open" id="sacred-sector-picker"/);
  assert.doesNotMatch(styles, /\.sacred-library-toggle/);
});

test("QA-02 keeps habit sections fixed and modal dialogs a shared focus contract", async () => {
  const [tracker, styles, dialogHook, calendar, account, admin, heroPath, theokyklosDetails, stoicheion, recovery] = await Promise.all([
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/use-dialog-accessibility.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HeroPathPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TheokyklosDetailsDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StoicheionView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/WorkspaceRecoveryDialog.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(tracker, /function HabitSectionBlock/);
  for (const label of ["Трекеры дня", "Защита серии и возвращение", "Испытания", "Награды за серию", "Стартовые привычки", "Обычные привычки", "Сон и воздержание", "Достижения", "Статистика моих привычек", "Сакральные привычки"]) {
    assert.match(tracker, new RegExp(label));
  }
  assert.match(styles, /\.habits-view \{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap;/);
  assert.match(styles, /\.habit-collapsible-block \{[^}]*flex:1 1 360px;/);
  assert.match(styles, /\.habit-collapsible-block\.open \{ flex-basis:100%; \}/);
  assert.match(styles, /max-width: 760px[\s\S]*\.habit-collapsible-block \{ flex-basis:100%;/);
  assert.match(tracker, /position: Math\.max\(0, HABIT_SECTION_IDS\.indexOf\(sectionId\)\)/);
  assert.doesNotMatch(tracker, /habit-section-drag-handle|application\/x-genesis-habit-section|onDragEnter=\{handleDragEnter\}/);
  assert.doesNotMatch(tracker, /Сворачивайте разделы и перетаскивайте свёрнутые блоки/);

  assert.match(dialogHook, /FOCUSABLE_SELECTOR/);
  assert.match(dialogHook, /data-dialog-initial-focus/);
  assert.match(dialogHook, /activeDialogStack\.at\(-1\) !== dialog/);
  assert.match(dialogHook, /activeDialogStack\.splice\(stackIndex, 1\)/);
  assert.match(dialogHook, /event\.key === "Escape"/);
  assert.match(dialogHook, /event\.key !== "Tab"/);
  assert.match(dialogHook, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.match(dialogHook, /trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(calendar, /dayDetailsDialogRef = useDialogAccessibility/);
  assert.match(tracker, /role="dialog" aria-modal="true" aria-labelledby="habit-editor-title" tabIndex=\{-1\}/);
  assert.match(account, /habitResetDialogRef = useDialogAccessibility/);
  assert.match(admin, /deleteDialogRef = useDialogAccessibility/);
  assert.match(heroPath, /dialogRef = useDialogAccessibility/);
  assert.match(theokyklosDetails, /detailsDialogRef = useDialogAccessibility/);
  assert.match(stoicheion, /motionDialogRef = useDialogAccessibility/);
  assert.match(recovery, /data-dialog-initial-focus/);
});

test("QA-04 splits heavy views and keeps regularity on an exact thirty-day window", async () => {
  const [calendar, tracker, viteConfig, bundleVerifier, webEntry] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/HabitTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vite.web.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verify-offline-precache.mjs", import.meta.url), "utf8"),
    readFile(new URL("../web/main.tsx", import.meta.url), "utf8"),
  ]);

  for (const moduleName of ["AccountPanel", "AdminPanel", "GeminiAssistant", "HabitTracker", "LocalVoiceAssistant", "StoicheionView", "TheokyklosView"]) {
    assert.match(calendar, new RegExp(`lazy\\(\\(\\) => import\\(\\"\\./${moduleName}\\"\\)`));
  }
  assert.match(calendar, /<Suspense fallback=\{/);
  assert.match(calendar, /DeferredViewFallback/);
  assert.match(calendar, /DeferredDialogFallback/);
  assert.match(calendar, /DeferredHabitFallback/);
  assert.doesNotMatch(calendar, /import \{ (?:AccountPanel|AdminPanel|GeminiAssistant|HabitDailyPanel|HabitTrackerPage|LocalVoiceAssistant|StoicheionView|TheokyklosView) \} from/);

  assert.match(viteConfig, /codeSplitting/);
  for (const chunkName of ["react-vendor", "astronomy-engine", "sync-engine", "tracker-engine", "calendar-engine"]) {
    assert.match(viteConfig, new RegExp(`name: \\"${chunkName}\\"`));
  }
  assert.match(viteConfig, /maxSize: 300_000/);
  assert.match(bundleVerifier, /MAX_PRODUCTION_JS_CHUNK_BYTES = 350_000/);
  assert.match(bundleVerifier, /Production JavaScript chunk budget exceeded/);
  assert.match(calendar, /<ViewErrorBoundary resetKey=\{view\}>/);
  assert.doesNotMatch(webEntry, /vite:preloadError/);

  assert.match(tracker, /Last 30 days/);
  assert.match(tracker, /addHabitDays\(date, -29\)/);
  assert.doesNotMatch(tracker, /Last 35 days|addHabitDays\(date, -34\)/);
});

test("source CI checks isolated PHP contracts before browser checks and cannot deploy", async () => {
  const workflow = await readFile(new URL("../.github/workflows/checks.yml", import.meta.url), "utf8");
  const backend = await readFile(new URL("../scripts/qa/backend-run.mjs", import.meta.url), "utf8");
  assert(workflow.indexOf("backend-run.mjs") < workflow.indexOf("web-run.mjs"));
  assert.match(backend, /disable_functions=curl_exec,mail/);
  assert.match(backend, /freshDatabase: true/);
  assert.match(backend, /QA_COMPLETED_SUITE/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets\.|scp |ssh |self-hosted|upload-artifact/);
});

test("QA-06 documents the trusted-device boundary without zero-knowledge claims", async () => {
  const [privacy, account, legal, admin, translationsRaw] = await Promise.all([
    readFile(new URL("../docs/PRIVACY-ARCHITECTURE.md", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    Promise.all([readFile(new URL("../app/LegalPage.tsx", import.meta.url), "utf8"), readFile(new URL("../app/legal-content.ts", import.meta.url), "utf8")]).then((parts) => parts.join("\n")),
    readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/translations.en.json", import.meta.url), "utf8"),
  ]);
  const translations = JSON.parse(translationsRaw);
  const accountEncryptionCopy = "AES-GCM в браузере; ключ хранится на сервере отдельно и зашифрован для автоматического входа.";

  assert.match(privacy, /не zero-knowledge E2EE/);
  assert.match(privacy, /рабочую копию, очередь синхронизации и ключевой материал/);
  assert.match(privacy, /`localStorage`/);
  assert.match(privacy, /вредоносного расширения или XSS-кода/);
  assert.match(privacy, /автоматического доступа после Google-входа/);
  assert.match(account, new RegExp(accountEncryptionCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(account, /сервер не получает ключ/);
  assert.match(legal, /локальную рабочую копию, очередь синхронизации и ключевой материал/);
  assert.match(legal, /Профиль браузера и вошедшее в аккаунт устройство считаются доверенными/);
  assert.doesNotMatch(admin, /E2EE/);
  assert.equal(
    translations[accountEncryptionCopy],
    "AES-GCM in the browser; the key is stored separately and encrypted on the server for automatic sign-in.",
  );
  assert.doesNotMatch(translationsRaw, /server never receives the key/);
});

test("keeps the requested calendar and privacy features wired", async () => {
  const [calendarData, calendar, calendarDatePicker, accountPanel, cloudSync, recurrenceBuilder, taskRecurrence, moonPhase, solarTimes, stoicheion, stoicheionData, welcome, styles, api, google, repository, multiAccountMigration, i18n, languageMigration, taskCalendarMigration, englishManifest, geminiAssistant, localVoiceAssistant, localVoicePlan, geminiServer, publicHtaccess, serverConfigExample, cronusSickle, reminderPicker, taskReminders, serviceWorker] = await Promise.all([
    readFile(new URL("../app/calendar-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/CalendarDatePicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/RecurrenceBuilder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/task-recurrence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/MoonPhaseIcon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/solar-times.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/StoicheionView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/stoicheion-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/WelcomeScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../server/public/api/index.php", import.meta.url), "utf8"),
    readFile(new URL("../server/src/google.php", import.meta.url), "utf8"),
    readFile(new URL("../server/src/repository.php", import.meta.url), "utf8"),
    readFile(new URL("../server/migrations/006_calendar_multi_account.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/i18n.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/migrations/007_user_language.sql", import.meta.url), "utf8"),
    readFile(new URL("../server/migrations/008_task_calendar_mode.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.en.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../app/GeminiAssistant.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LocalVoiceAssistant.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/local-voice-plan.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/src/gemini.php", import.meta.url), "utf8"),
    readFile(new URL("../public/.htaccess", import.meta.url), "utf8"),
    readFile(new URL("../server/config.example.php", import.meta.url), "utf8"),
    readFile(new URL("../app/CronusSickleIcon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TaskReminderPicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/task-reminders.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const [timeClockPicker, timeFormatSource, timeFormatMigration] = await Promise.all([
    readFile(new URL("../app/TimeClockPicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/time-format.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/migrations/009_user_time_format.sql", import.meta.url), "utf8"),
  ]);
  const [trackerCore, taskDescription] = await Promise.all([
    readFile(new URL("../app/tracker-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/task-description.ts", import.meta.url), "utf8"),
  ]);

  assert.match(calendarData, /getSolarEvents/);
  assert.match(calendarData, /const seasons = Seasons\(sacredYear\)/);
  assert.match(calendarData, /formatSolarEventTime/);
  assert.match(calendarData, /summer-solstice/);
  assert.match(calendarData, /calendarDateNote/);
  assert.match(calendarData, /normalizeCalendarDateNote/);
  assert.match(calendarData, /if \(!normalized \|\| mode === "profane"/);
  assert.match(calendarData, /return "";/);
  assert.match(calendarData, /formatCalendarDate/);
  assert.match(calendarData, /getLunarYearForDate/);
  assert.match(calendarData, /from "\.\/calendar-astronomy"/);
  assert.match(calendarData, /LUNAR_MONTHS/);
  assert.match(calendarData, /Генезион/);
  assert.match(calendarData, /Апорион/);
  assert.match(calendarData, /Декада Роста/);
  assert.match(calendarData, /Декада Полноты/);
  assert.match(calendarData, /Декада Исхода/);
  assert.match(calendarData, /PYATA_DETAILS/);
  assert.match(calendarData, /Пята Инициации/);
  assert.match(calendarData, /Пята Столкновения/);
  assert.match(calendarData, /Пята Перехода/);
  assert.match(calendarData, /isThreshold: lunar.day === lunar.monthLength/);
  assert.match(calendarDatePicker, /Сакральный календарь/);
  assert.match(calendarDatePicker, /Лунный календарь/);
  assert.match(calendarDatePicker, /Пята \{day\.pyata/);
  assert.match(calendarDatePicker, /formatCompactGregorian\(date\)/);
  assert.match(calendarDatePicker, /<time dateTime=\{dateValue\}>/);
  assert.match(styles, /\.sacred-picker-days button > time/);
  assert.match(calendar, /openPyataDescription/);
  assert.match(calendar, /aria-expanded=\{pyataDescriptionOpen\}/);
  assert.match(calendar, /className="pyata-row-description"/);
  assert.match(calendar, /Ритм пяты · действует в каждом месяце/);
  assert.match(calendar, /monthIndex === 12 \? \(/);
  assert.match(calendar, /className="apeiron-guide-card"/);
  assert.match(calendar, /Апейрон: 13-й месяц и лайф-менеджмент/);
  assert.match(calendar, /className="apeiron-protogenoi"/);
  assert.match(calendar, /Закон Анабасиса/);
  assert.match(styles, /\.pyata-row-description/);
  assert.match(styles, /\.pyata-row-disclosure svg/);
  assert.match(styles, /\.apeiron-guide-card/);
  assert.match(styles, /\.apeiron-protogenoi/);
  assert.match(styles, /\.apeiron-element-ascent/);
  assert.match(accountPanel, /calendar-mode-segment/);
  assert.match(accountPanel, /Основной календарь/);
  assert.match(accountPanel, /label: "Григорианский"/);
  assert.doesNotMatch(accountPanel + recurrenceBuilder + taskRecurrence, /Профанск|профанск/u);
  assert.match(recurrenceBuilder, /destination === "tracker"[\s\S]*normalizeRecurrenceConfig\(rawValue\)/);
  assert.match(recurrenceBuilder, /calendarModeForRecurrence\(value\.mode\)/);
  assert.match(taskRecurrence, /export function calendarModeForRecurrence/);
  assert.match(accountPanel, /Полное отображение и система дат/);
  assert.match(accountPanel, /taskCalendarMode/);
  assert.match(accountPanel, /Календарь постановки задач/);
  assert.match(accountPanel, /систему постановки задач можно выбрать отдельно для любого режима/);
  assert.doesNotMatch(accountPanel, /\(user\.calendarMode \?\? "sacred"\) === "sacred" \? \(/);
  assert.match(calendar, /visibleCalendarMode\(cloudUser\?\.taskCalendarMode \?\? "sacred", storedVisibility\)/);
  assert.doesNotMatch(calendar, /activeCalendarMode === "sacred"\s*\? cloudUser\?\.taskCalendarMode/);
  assert.match(cloudSync, /taskCalendarMode: CalendarMode/);
  assert.match(repository, /'taskCalendarMode' => \$taskCalendarMode/);
  assert.match(taskCalendarMigration, /ADD COLUMN task_calendar_mode/);
  assert.match(accountPanel, /Google Calendar и Tasks: подключения/);
  assert.match(accountPanel, /По выбору при создании/);
  assert.match(accountPanel, /Дополнительные подключения · Standart и выше/);
  assert.match(accountPanel, /Что даёт подключение/);
  assert.match(accountPanel, /Вход через любой связанный Google-аккаунт/);
  assert.match(accountPanel, /выбор одного или нескольких аккаунтов/);
  assert.match(accountPanel, /задачи от случайного объединения/);
  assert.doesNotMatch(accountPanel, /Закрытая функция администратора/);
  assert.doesNotMatch(accountPanel, /user\.multiAccountEnabled \? \(/);
  assert.match(accountPanel, /language-preference/);
  assert.match(accountPanel, /LANGUAGES\.map/);
  assert.match(i18n, /🇷🇺/);
  assert.match(i18n, /🇬🇷/);
  assert.match(i18n, /🇵🇹/);
  assert.match(accountPanel, /time-format-preference/);
  assert.match(accountPanel, /user\.timeFormat \?\? "24h"/);
  assert.match(cloudSync, /timeFormat: TimeFormat/);
  assert.match(repository, /'timeFormat' => \$timeFormat/);
  assert.match(timeFormatMigration, /ADD COLUMN time_format TEXT NOT NULL DEFAULT '24h'/);
  assert.match(calendar, /<DeviceClock timeFormat=\{activeTimeFormat\}/);
  assert.match(calendar, /timeFormat=\{activeTimeFormat\}/);
  assert.match(timeClockPicker, /time-clock-period/);
  assert.match(timeClockPicker, /hourFromTwelveHour/);
  assert.match(timeFormatSource, /12:05 AM|formatTimeValue/);
  assert.match(styles, /\.time-clock-period/);
  assert.match(welcome, /welcome-language-picker/);
  assert.match(welcome, /Task and project/);
  assert.match(welcome, /How GENESIS uses Google Calendar and Google Tasks/);
  assert.match(welcome, /Secure Google sign-in/);
  assert.match(cloudSync, /language: Language/);
  assert.match(repository, /'language' => \$language/);
  assert.match(languageMigration, /ADD COLUMN language/);
  assert.match(i18n, /useDocumentLanguage/);
  assert.match(i18n, /MutationObserver/);
  assert.match(i18n, /"data-tooltip"/);
  assert.match(i18n, /localizeCategoryName/);
  assert.match(englishManifest, /"lang": "en-US"/);
  assert.match(calendar, /GeminiAssistant/);
  assert.match(calendar, /LocalVoiceAssistant/);
  assert.match(calendar, /applyAssistantPlan/);
  assert.match(calendar, /voice-open-button/);
  assert.match(calendar, /voice-microphone-icon/);
  assert.match(calendar, /voice-microphone-capsule/);
  assert.match(calendar, /voice-microphone-capture/);
  assert.match(calendar, /voiceLaunchAnimating/);
  assert.doesNotMatch(calendar, /<span aria-hidden="true">●<\/span>/);
  assert.match(styles, /@keyframes voiceButtonBreathe/);
  assert.match(styles, /@keyframes voiceSignalPulse/);
  assert.match(styles, /@keyframes voiceMicBreathe/);
  assert.doesNotMatch(calendar, /voice-microphone-spark/);
  assert.doesNotMatch(localVoiceAssistant, /voice-microphone-spark/);
  assert.match(styles, /@keyframes voiceButtonActivate/);
  assert.match(styles, /\.voice-open-button\.is-activating/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.voice-microphone-icon/);
  assert.doesNotMatch(calendar, /gemini-open-button/);
  assert.match(calendar, /assistantStatus\.audioAvailable/);
  assert.match(calendar, /loadAssistantStatus/);
  assert.match(localVoiceAssistant, /SpeechRecognition/);
  assert.match(localVoiceAssistant, /processLocally/);
  assert.match(localVoiceAssistant, /GENESIS не отправляет и не хранит аудиозапись/);
  assert.match(localVoiceAssistant, /requestAssistantPlan/);
  assert.match(localVoiceAssistant, /neuralAvailable/);
  assert.match(localVoiceAssistant, /План подготовлен локально на устройстве/);
  assert.match(localVoiceAssistant, /neuralProviderName/);
  assert.match(localVoiceAssistant, /voice-microphone-icon/);
  assert.doesNotMatch(localVoiceAssistant, /className="gemini-mark voice-mark" aria-hidden="true">●/);
  assert.match(localVoicePlan, /createLocalVoicePlan/);
  assert.match(geminiAssistant, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(geminiAssistant, /MAX_RECORDING_MS = 60_000/);
  assert.match(geminiAssistant, /MAX_AUDIO_BYTES = 4 \* 1024 \* 1024/);
  assert.match(geminiAssistant, /providerName/);
  assert.match(geminiAssistant, /запрашивает её удаление из файлового хранилища GigaChat/);
  assert.match(cloudSync, /requestAssistantPlan/);
  assert.match(api, /assistant\/plan/);
  assert.match(api, /genesisRequireUserId\(\)/);
  assert.match(api, /genesisRequireCsrf\(\)/);
  assert.match(api, /microphone=\(self\)/);
  assert.match(publicHtaccess, /microphone=\(self\)/);
  assert.match(publicHtaccess, /on-device-speech-recognition=\(self\)/);
  assert.match(geminiServer, /generativelanguage\.googleapis\.com\/v1beta\/interactions/);
  assert.match(geminiServer, /GENESIS_GEMINI_DEFAULT_ENDPOINT/);
  assert.match(geminiServer, /genesisGeminiEndpoint/);
  assert.match(geminiServer, /GEMINI_REGION_UNAVAILABLE/);
  assert.match(geminiServer, /GEMINI_KEY_INVALID/);
  assert.match(geminiAssistant, /GEMINI_REGION_UNAVAILABLE/);
  assert.match(geminiServer, /'store' => false/);
  assert.match(geminiServer, /'mime_type' => 'application\/json'/);
  assert.match(geminiServer, /GENESIS_GEMINI_MAX_AUDIO_BYTES = 4 \* 1024 \* 1024/);
  assert.match(geminiServer, /genesisGeminiRateLimit/);
  assert.match(geminiServer, /noisy automatic speech transcript/);
  assert.match(geminiServer, /set that task's project field/);
  assert.match(geminiServer, /x-goog-api-key/);
  assert.match(geminiServer, /https:\/\/api\.giga\.chat\/v1/);
  assert.match(geminiServer, /https:\/\/ngw\.devices\.sberbank\.ru:9443\/api\/v2\/oauth/);
  assert.match(geminiServer, /GIGACHAT_API_PERS/);
  assert.match(geminiServer, /'type' => 'json_schema'/);
  assert.match(geminiServer, /'purpose' => 'general'/);
  assert.match(geminiServer, /genesisGigaChatDeleteFile/);
  assert.match(geminiServer, /Remove interface phrases such as "create a task", "создай задачу"/);
  assert.match(geminiServer, /function genesisAssistantTaskTitle/);
  assert.match(geminiServer, /genesisCreateAssistantPlan/);
  assert.doesNotMatch(calendar + cloudSync + geminiAssistant, /gemini_api_key|GEMINI_API_KEY|gigachat_authorization_key|GIGACHAT_AUTHORIZATION_KEY/);
  assert.match(geminiServer, /genesisGeminiEnabled\(\) && genesisGeminiApiKey\(\) !== ''/);
  assert.match(geminiServer, /genesisGigaChatEnabled\(\) && genesisGigaChatAuthorizationKey\(\) !== ''/);
  assert.match(serverConfigExample, /'gigachat_enabled' => false/);
  assert.match(serverConfigExample, /'gigachat_authorization_key' => ''/);
  assert.match(serverConfigExample, /'gigachat_api_endpoint'/);
  assert.match(serverConfigExample, /'gemini_enabled' => false/);
  assert.match(serverConfigExample, /'gemini_api_key' => ''/);
  assert.match(serverConfigExample, /'gemini_api_endpoint'/);
  assert.match(calendar, /task-description-viewer/);
  assert.match(calendar, /task-sync-account-picker/);
  assert.match(calendar, /const TASK_PRIORITY_LEVELS/);
  assert.match(calendar, /function TaskPriorityControl/);
  assert.equal((calendar.match(/<TaskPriorityControl/g) ?? []).length, 2);
  assert.match(calendar, /type="range"/);
  assert.match(calendar, /event\.key === "ArrowRight"/);
  assert.match(calendar, /Горит · самый важный/);
  assert.doesNotMatch(calendar, /<span>Приоритет<\/span>\s*<select/);
  assert.match(styles, /\.task-priority-steps\s*\{[\s\S]*grid-template-columns: repeat\(10, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.task-priority-steps i\.current/);
  assert.match(styles, /\.task-priority-control:focus-within/);
  assert.doesNotMatch(calendar, /renderTaskCalendarByMode/);
  assert.match(calendar, /renderAlternativeCalendar/);
  assert.match(calendar, /renderAlternativeYear/);
  assert.match(calendar, /activeCalendarMode === "profane"/);
  assert.match(calendar, /activeCalendarMode === "lunar"/);
  assert.doesNotMatch(calendar, /Новолуние открывает месяц|lunar-month-rule/);
  assert.doesNotMatch(styles, /\.lunar-month-rule/);
  assert.match(calendar, /Григорианский год \$\{profaneYearLabel\}/);
  assert.match(calendar, /gregorianYearStart === "march"/);
  assert.match(calendar, /mode === "lunar" \? <p data-no-translate>\{yearDescription\}<\/p> : null/);
  assert.match(calendar, /lunarYearStartText\(formatGregorian\(lunarYear\.startDate/);
  assert.match(i18n, /первого точного новолуния после весеннего равноденствия/);
  assert.match(calendar, /"Лунный год"/);
  assert.doesNotMatch(calendar, /Магический женский год Луны/);
  assert.match(calendar, /lunarYearOverviewCopy\[language\]\.context/);
  const lunarOverview = JSON.parse(await readFile(new URL('../app/lunar-year-overview-copy.json', import.meta.url), 'utf8'));
  assert.match(lunarOverview.ru.context, /символическая система Ордена Авроры/);
  assert.match(lunarOverview.ru.context, /первое новолуние после весеннего равноденствия/);
  assert.doesNotMatch(calendar, /calendar-source-links|Гомеров гимн XXXII к Селене/);
  assert.match(calendar, /mode === "profane" && date\.getDay\(\) === 6/);
  assert.match(calendar, /PROFANE_WEEKDAY_PATRONS/);
  assert.match(calendar, /День Луны — Селены, Гекаты и Артемиды/);
  assert.match(calendar, /День Гермеса/);
  assert.match(calendar, /patronage: "День Кроноса, Аида и Посейдона"/);
  assert.doesNotMatch(calendar, /patronage: "День Кроноса"/);
  assert.match(i18n, /"День Кроноса, Аида и Посейдона": "Day of Cronus, Hades, and Poseidon"/);
  assert.match(calendar, /guidanceTitle: "День Света и Прозрения"/);
  assert.match(calendar, /guidanceTitle: "День путешествий и переговоров"/);
  assert.match(calendar, /guidanceTitle: "День Власти и Суверенитета"/);
  assert.match(calendar, /guidanceTitle: "День любви и очага"/);
  assert.match(calendar, /guidanceTitle: "День Памяти, Времени и Денег"/);
  assert.match(calendar, /synthema: "Φάος\. Λύκειος\."/);
  assert.match(calendar, /synthema: "Βάθος\. Αἰώνια\."/);
  assert.match(calendar, /profane-day-guidance/);
  assert.match(calendar, /ukrainianSynthemaNames\[patron\.synthema\]/);
  assert.match(calendar, /SYNTHEMA_SELF_NAMES\[patron\.synthema\]/);
  assert.match(i18n, /"День Света и Прозрения": "Day of Light and Insight"/);
  assert.match(i18n, /"День Памяти, Времени и Денег": "Day of Memory, Time, and Money"/);
  assert.match(styles, /\.profane-day-guidance/);
  assert.match(calendar, /Части тела:/);
  assert.match(calendar, /Сердце, позвоночник и правый глаз/);
  assert.match(calendar, /Кости, зубы, суставы, селезёнка/);
  assert.match(calendar, /hero-day-title-primary/);
  assert.match(calendar, /hero-day-title-translation/);
  assert.match(calendar, /dayTitleTranslationSize/);
  assert.match(calendar, /Григорианский календарь/);
  assert.match(calendar, /покровителем этого летоисчисления выступает Кронос/);
  assert.match(calendar, /сакральный день обязательного покоя/);
  assert.match(calendar, /посвящать день Богу\./);
  assert.doesNotMatch(calendar + i18n, /сходство не означает поклонения Сатурну или Кроносу|resemblance does not mean worship of Saturn or Cronus/i);
  assert.match(calendar, /В 153 году до н\. э\.[\s\S]*войну в Испании/);
  assert.match(calendar, /папа Григорий XIII[\s\S]*церковному расчёту Пасхи/);
  assert.match(calendar, /вавилонско-иудейское[\s\S]*христианско-церковное наследие/);
  assert.doesNotMatch(calendar, /профанск/iu);
  assert.match(calendar, /const leadingDays = mode === "profane" \? gregorianWeekdayOffset\(firstDate, activeWeekStart\) : 0/);
  assert.match(calendar, /const trailingDays = mode === "profane" \? \(7 - \(\(leadingDays \+ dates\.length\) % 7\)\) % 7 : 0/);
  assert.match(calendar, /previousMonthDates\.map/);
  assert.match(calendar, /nextMonthDates\.map/);
  assert.match(calendar, /isAdjacentMonth \? null : \(/);
  assert.match(calendar, /gregorianWeekdayOffset\(month\.dates\[0\], activeWeekStart\)/);
  assert.match(calendar, /activeWeekStart === "monday" \? 8 : 7/);
  assert.match(accountPanel, /changeWeekStart/);
  assert.match(accountPanel, /visibleCalendarMode\(user\.calendarMode \?\? "sacred", visibility\) === "profane"/);
  assert.match(cloudSync, /weekStart\?: "sunday" \| "monday"/);
  assert.match(repository, /week_start = :week_start/);
  assert.match(calendar, /<CalendarModeIcon mode=\{mode\} size=\{35\}/);
  assert.match(calendar, /<CalendarModeIcon mode="profane" size=\{27\}/);
  assert.match(calendar, /profane-weekday-patron/);
  assert.match(cronusSickle, /cronus-sickle-blade/);
  assert.match(cronusSickle, /cronus-sickle-handle/);
  assert.match(cronusSickle, /viewBox="0 0 64 116"/);
  assert.match(cronusSickle, /fill="currentColor"/);
  assert.match(styles, /\.cronus-sickle-icon/);
  assert.match(styles, /\.profane-weekday-patron/);
  assert.doesNotMatch(calendar, /symbol: "□"/);
  assert.match(calendar, /mini-day-moon-phase/);
  assert.match(calendar, /lunar-year-has-intercalary/);
  assert.match(calendar, /lunar-year-full-width/);
  assert.match(calendar, /lunar-decades/);
  assert.match(calendar, /lunar-month-art-v1\/month-/);
  assert.match(styles, /\.calendar-mode-year-month::before\s*\{[\s\S]*background-image: none;[\s\S]*opacity: 0/);
  const alternativeCalendar = calendar.slice(calendar.indexOf("const renderAlternativeCalendar"), calendar.indexOf("const renderCalendar"));
  assert.match(alternativeCalendar, /calendar-month-art/);
  assert.match(alternativeCalendar, /lunarMonthArtUrl/);
  assert.match(alternativeCalendar, /renderModeCalendarDay/);
  assert.match(calendar, /popoverKey=\{`year-personal-\$\{dateValue\}`\}/);
  assert.match(calendar, /popoverKey=\{`year-shared-\$\{dateValue\}`\}/);
  assert.doesNotMatch(calendar, /calendarRailItems/);
  assert.match(calendar, /const isSaturday = gregorian\.getDay\(\) === 6/);
  assert.match(calendar, /weekday: "long"/);
  assert.match(calendar, /weekday: "short"/);
  assert.match(calendar, /calendar-weekday-full/);
  assert.match(calendar, /calendar-weekday-short/);
  assert.match(calendar, /isSaturday \? " saturday"/);
  assert.match(styles, /\.year-grid \.mini-day\.today/);
  assert.match(styles, /background: var\(--month-accent\)/);
  assert.doesNotMatch(styles, /inset 0 0 0 999px rgba\(20, 31, 29/);
  assert.match(cloudSync, /connectAdditionalGoogleAccount/);
  assert.match(api, /purpose === 'link'/);
  const googleLinkStartRoute = api.slice(api.indexOf("$path === 'auth/google/start'"), api.indexOf("$path === 'auth/google/callback'"));
  assert.doesNotMatch(googleLinkStartRoute, /genesisRequireAdmin/);
  assert.match(google, /genesisListAllGoogleTasks/);
  assert.match(google, /genesisResolveTaskTargetAccounts/);
  assert.match(google, /\$calendarMode === 'profane'/);
  assert.doesNotMatch(google, /Календарная дата:\\n/);
  assert.match(repository, /GENESIS_ADMIN_EMAIL = 'nikitalexanderson@gmail.com'/);
  assert.doesNotMatch(repository, /Подключение нескольких аккаунтов пока доступно только администратору/);
  assert.match(multiAccountMigration, /CREATE TABLE IF NOT EXISTS linked_google_accounts/);
  assert.match(calendar, /solar-year-strip/);
  assert.match(calendar, /deleteCategory/);
  assert.match(calendar, /saveCategoryEdit/);
  assert.doesNotMatch(welcome, /Ваши задачи — только в Google и на вашем устройстве/);
  assert.doesNotMatch(welcome, /Артемида · полнолуние|Геката · новолуние/);
  assert.doesNotMatch(welcome, /admin-access/);
  assert.match(calendar, /month-art-v4\/month-/);
  assert.match(calendar, /day-art-v1\/month-/);
  assert.match(calendar, /dayArtUrl\(todayInfo\.monthIndex, todayInfo\.day\)/);
  assert.match(calendar, /weekdayArtUrl\(today\.getDay\(\)\)/);
  assert.match(calendar, /weekday-5-friday-aphrodite-hestia-dionysus\.webp/);
  assert.match(calendar, /activeCalendarMode === "lunar"[\s\S]*genesis-hero\.png/);
  assert.match(calendar, /hero-card mode-\$\{activeCalendarMode\}/);
  assert.match(calendar, /Ритм Луны сегодня/);
  assert.match(calendar, /Дата в гражданском календаре/);
  assert.match(calendar, /lunar\.day} \{isEnglish \? "lunar day" : "лунный день"\}/);
  assert.match(calendar, /weekdayPatron\.patronage/);
  assert.match(styles, /var\(--genesis-hero-image, none\),[\s\S]*var\(--genesis-hero-fallback, none\)/);
  assert.match(styles, /\.hero-card\.mode-profane\s*\{[\s\S]*var\(--genesis-hero-image, none\)/);
  assert.match(styles, /\.hero-card\.mode-profane\.weekday-0/);
  assert.match(styles, /\.hero-card\.mode-profane\.weekday-6/);
  assert.match(styles, /\.profane-hero-description/);
  assert.match(styles, /\.all-tasks-create\[open\]\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(serviceWorker, /CACHE_PREFIX = "genesis-shell-"/);
  assert.match(serviceWorker, /__GENESIS_PRECACHE_VERSION/);
  assert.match(serviceWorker, /__GENESIS_PRECACHE/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(serviceWorker, /GENESIS_NOTIFICATION_OPENED/);
  assert.match(serviceWorker, /weekday-0-sunday-apollo\.webp/);
  assert.match(serviceWorker, /weekday-6-saturday-cronus\.webp/);
  assert.match(calendar, /calendar-month-art/);
  assert.match(calendar, /mini-pyata/);
  assert.match(calendar, /Math\.ceil\(availableDays \/ 5\)/);
  assert.match(calendar, /чётная/);
  assert.match(calendar, /\["I", "II", "III", "IIII", "V"\]/);
  assert.match(calendar, /onPointerMove/);
  assert.match(calendar, /StoicheionView/);
  assert.match(calendar, /Стойхейон/);
  assert.match(calendar, /CalendarPersonalTaskControl/);
  const calendarControls = await readFile(new URL("../app/CalendarSharedTaskControl.tsx", import.meta.url), "utf8");
  assert.match(calendarControls, /CalendarDayTaskCounts/);
  assert.doesNotMatch(calendar, /calendar-day-task-preview/);
  assert.match(calendarControls, /calendar-day-task-control/);
  assert.match(calendarControls, /calendar-task-popover/);
  assert.match(calendarControls, /event\.pointerType === "mouse"/);
  assert.match(calendarControls, /expanded=\{expanded\}/);
  assert.match(await readFile(new URL("../app/CalendarTaskCounts.tsx", import.meta.url), "utf8"), /aria-expanded=\{expanded\}/);
  assert.match(calendar, /selectedDayTasks/);
  assert.match(calendar, /day-details-tasks/);
  assert.match(calendar, /day-details-celestial/);
  assert.match(calendar, /day-details-create-task-button/);
  assert.match(calendar, /className="day-details-hero"/);
  assert.doesNotMatch(calendar, /selected-day-card day-details-modal/);
  assert.match(calendar, /beginSelectedDayTask/);
  assert.match(calendar, /setTaskDueDate\(selectedDateValue\)/);
  assert.match(calendar, /renderTaskCreateForm\("day-details"\)/);
  assert.match(calendar, /day-task-create-modal/);
  assert.match(calendar, /Новая задача на выбранный день/);
  assert.match(calendar, /Луна и Солнце/);
  assert.match(calendar, /Фаза Луны, рассвет и закат/);
  assert.match(calendar, /Редактирование задачи/);
  assert.match(calendar, /Редактирование проекта/);
  assert.match(calendar, /Поиск задач и проектов по названию или #тегу/);
  assert.match(calendar, /newTaskDueDate/);
  assert.match(calendar, /renderTaskCreateForm\("composer"\)/);
  assert.match(calendar, /openTaskComposer\("today"\)/);
  assert.doesNotMatch(calendar, /renderTaskCreateForm\("planner"\)/);
  assert.doesNotMatch(calendar, /<aside className="planner-panel"/);
  assert.match(calendar, /id: "projects", label: "Дела"/);
  assert.match(calendar, /<InboxToolbar/);
  assert.match(await readFile(new URL("../app/InboxToolbar.tsx", import.meta.url), "utf8"), /workspace-inbox-header/);
  assert.match(calendar, /data-project-drop-id=\{project\.id\}/);
  assert.match(calendar, /data-project-drop-id=\{TASK_INBOX_PROJECT_ID\}/);
  assert.match(calendar, /Задача «\$\{item\.title\}» возвращена в хаос-бокс/);
  assert.match(calendar, /projectDragProps/);
  assert.match(calendar, /beginProjectTouchDrag/);
  assert.match(calendar, /Math\.hypot\([\s\S]*> 8\)[\s\S]*projectTouchDragRef\.current = null;[\s\S]*return;/);
  assert.match(calendar, /className="inbox-list-item project-draggable-item"[\s\S]*projectDragProps\(item\)/);
  assert.match(calendar, /renderTaskRows\(inboxTasks/);
  assert.match(calendar, /deleteTask\(task\.id\)[\s\S]*Удалить задачу/);
  assert.match(calendar, /renderTaskRows\(projectTasks/);
  assert.match(calendar, /project-assigned-items/);
  assert.doesNotMatch(calendar, /matchingTaggedTasks/);
  assert.match(calendar, /Дополнительная информация/);
  assert.match(calendar, /<span>Срок выполнения<\/span>/);
  assert.match(calendar, /newTaskEndDate/);
  assert.match(calendar, /taskRangeLabel/);
  assert.match(cloudSync, /endDate: string/);
  assert.match(moonPhase, /MOON_PHASE_STEPS = 30/);
  assert.match(moonPhase, /moon-phase-light/);
  assert.match(calendar, /MoonPhaseIcon/);
  assert.match(calendar, /Создано в GENESIS/);
  assert.match(calendar, /Создано в Google Calendar/);
  assert.doesNotMatch(calendar, /disabled=\{isPast\}/);
  assert.match(calendar, /task-list-workspace/);
  assert.match(calendar, /task-list-board/);
  assert.match(calendar, /Несколько новых задач/);
  assert.match(calendar, /CREATE_NEW_TASK_LIST_ID/);
  assert.match(calendar, /moveTaskToTaskList/);
  assert.match(calendar, /linkTaskListToProject/);
  assert.match(calendar, /saveTaskListEdit/);
  assert.match(calendar, /deleteTaskList/);
  assert.match(calendar, /taskListsForWorkspace/);
  assert.match(calendar, /Основной список Google · удалить нельзя/);
  assert.match(calendar, /Пока он пуст и не привязан к проекту, GENESIS скрывает его автоматически/);
  assert.match(calendar, /Переименовать список/);
  assert.match(calendar, /Удалить список «\$\{taskList\.title\}»/);
  assert.match(calendar, /Список задач — это группа смежных задач/);
  assert.match(calendar, /renderTaskListCreateForm\("composer"\)/);
  assert.match(calendar, /composerTab === "lists" \? renderTaskListCreateForm\("composer"\) : renderTaskCreateForm\("composer"\)/);
  assert.doesNotMatch(calendar, /renderTaskListCreateForm\("projects"\)/);
  assert.match(calendar, /DeviceClock/);
  assert.match(calendar, /sacredFeaturesEnabled\?<DeviceClock timeFormat=\{activeTimeFormat\}\/>:/);
  assert.match(calendar, /<SolarWeatherSummary ownerId=\{cloudUser\?\.uid\?\?null\} now=\{today\}/);
  assert.match(calendar, /<DayRhythmPanel timeFormat=\{activeTimeFormat\} \/>/);
  assert.match(calendar, /useSyncExternalStore\(subscribeDeviceClock, getDeviceClockSnapshot, getServerDeviceClockSnapshot\)/);
  assert.match(calendar, /1000 - \(Date\.now\(\) % 1000\)/);
  assert.match(calendar, /if \(!clock\) return \(/);
  assert.match(calendar, /const liveNow = clock\.now/);
  assert.doesNotMatch(calendar, /const currentTime = formatClockTime\(liveNow, timeFormat\)/);
  assert.doesNotMatch(calendar, /<time dateTime=\{liveNow\.toISOString\(\)\}>/);
  assert.match(calendar, /moment\.remainingSeconds % 60/);
  assert.match(calendar, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(calendar, /aria-expanded=\{expanded\}/);
  assert.match(calendar, /aria-controls="day-rhythm-details"/);
  assert.match(calendar, /id="day-rhythm-details" hidden=\{!expanded\}/);
  assert.match(calendar, /Развернуть ритм суток/);
  assert.match(calendar, /Expand daily rhythm/);
  assert.match(calendar, /<svg className="day-rhythm-toggle-icon"[\s\S]*?<path d="m6\.5 9 5\.5 5\.5L17\.5 9" \/>/);
  assert.doesNotMatch(calendar, /<i aria-hidden="true">⌄<\/i>/);
  assert.match(calendar, /Двенадцать двухчасовых периодов суток/);
  assert.match(calendar, /Вернуться к текущему/);
  assert.match(styles, /\.day-rhythm-panel\s*\{/);
  assert.match(styles, /\.day-rhythm-panel\.is-collapsed\s*\{/);
  assert.match(styles, /\.day-rhythm-toggle\s*\{/);
  assert.match(styles, /\.day-rhythm-toggle-icon\s*\{/);
  assert.match(styles, /\.day-rhythm-details\s*\{/);
  assert.match(styles, /\.day-rhythm-dayline\s*\{[\s\S]*repeat\(12/);
  assert.match(styles, /\.today-workspace \.day-rhythm-panel \{ order: 2; \}/);
  assert.match(calendar, /Сегодня \{isNewMoonDay \? "новолуние" : "полнолуние"\}/);
  assert.match(calendar, /SOLAR_EVENT_COPY/);
  assert.match(calendar, /genesisTelegramLabel\(language\)/);
  assert.match(calendar, /href=\{GENESIS_TELEGRAM\}/);
  assert.match(await readFile(new URL('../app/site-links.ts', import.meta.url), 'utf8'), /https:\/\/t\.me\/genesiscalendar/);
  assert.match(calendar, /<DonationLink language=\{language\} authenticated=\{Boolean\(cloudUser\)\}/);
  const donationLink = await readFile(new URL("../app/DonationLink.tsx", import.meta.url), "utf8");
  assert.match(donationLink, /href=\{SUPPORT_TIPS_URL\}/);
  assert.match(donationLink, /if\(!authenticated\)\{onOpen\?\.\(\);return;\}/);
  assert.match(donationLink, /createCloudTipsCheckout\(\)/);
  assert.match(await readFile(new URL("../app/public-service.ts", import.meta.url), "utf8"), /https:\/\/pay\.cloudtips\.ru\/p\/4d58d20a/);
  assert.match(calendar, /Солнечный календарь/);
  assert.doesNotMatch(calendar, /Солнечный круг, услышанный через Луну/);
  assert.match(calendar, /<em>\{weekday\}<\/em>/);
  assert.match(calendar, /label: "Календарь"/);
  assert.doesNotMatch(calendar, /Ближайшие дни/);
  assert.match(calendar, /dayDetailsOpen/);
  assert.match(calendar, /setDayDetailsOpen\(origin !== "year"\)/);
  assert.match(calendar, /if \(origin === "year"\) navigateTo\("calendar"\)/);
  assert.match(calendar, /Открыть месяц «\{selectedDisplayMonthName\}»/);
  assert.match(calendar, /const openMonth = \(\) => \{[\s\S]*setDayDetailsOpen\(false\);[\s\S]*navigateTo\("calendar"\);/);
  assert.match(calendar, /day-details-modal/);
  assert.match(calendar, /onPointerDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) setDayDetailsOpen\(false\)/);
  assert.match(calendar, /window\.history\.pushState/);
  assert.match(calendar, /CalendarYearTaskCounts/);
  assert.doesNotMatch(calendar, /mini-day-task-dot/);
  assert.match(calendar, /const isYearSaturday = getGregorianDate\([\s\S]*\.getDay\(\) === 6/);
  assert.match(calendar, /isYearSaturday \? " saturday"/);
  assert.match(styles, /Hierarchy uses four clear contrast levels/);
  assert.match(styles, /\.project-tree-panel > \.section-heading h2/);
  assert.match(calendar, /data-nav-id=\{item\.id\}/);
  assert.match(calendar, /task-form-section task-form-schedule/);
  assert.match(calendar, /task-form-section task-form-destination/);
  assert.match(calendar, /task-form-section task-form-settings/);
  assert.match(calendar, /<RecurrenceBuilder/);
  assert.match(calendar, /buildTaskSeries/);
  assert.match(calendar, /saveTaskSeries/);
  assert.match(calendar, /recurrenceDatesForTask/);
  assert.match(calendar, /tasksByDate/);
  assert.match(calendar, /одним событием в Google Calendar/);
  assert.doesNotMatch(calendar, /setTaskRecurrence\(/);
  assert.doesNotMatch(calendar, /<option value="daily">Каждый день<\/option>/);
  assert.match(recurrenceBuilder, /type="checkbox"/);
  assert.match(recurrenceBuilder, /С какого/);
  assert.match(recurrenceBuilder, /По какое/);
  assert.match(recurrenceBuilder, /По пятам/);
  assert.match(recurrenceBuilder, /По дням месяца/);
  assert.match(recurrenceBuilder, /В какие лунные месяцы/);
  assert.match(recurrenceBuilder, /Нечётные/);
  assert.match(recurrenceBuilder, /Чётные/);
  assert.match(recurrenceBuilder, /Будни/);
  assert.match(recurrenceBuilder, /Выходные/);
  assert.match(recurrenceBuilder, /Google Tasks/);
  assert.match(recurrenceBuilder, /Google Tasks не поддерживает серии/);
  assert.match(recurrenceBuilder, /одно повторяющееся событие/);
  assert.match(recurrenceBuilder, /aria-pressed=\{selected\}/);
  assert.match(recurrenceBuilder, /<RecordCalendarChoice/);
  assert.match(recurrenceBuilder, /allowCalendarModeChange = false/);
  const recordCalendarChoice = await readFile(new URL("../app/RecordCalendarChoice.tsx", import.meta.url), "utf8");
  assert.match(recordCalendarChoice, /role="group"/);
  assert.match(recurrenceBuilder, /convertTrackerRecurrenceCalendar\(value, nextMode, rangeStart\)/);
  assert.match(recordCalendarChoice, /aria-pressed=\{value === mode\}/);
  assert.match(recordCalendarChoice, /<CalendarModeIcon mode=\{mode\}/);
  assert.doesNotMatch(recurrenceBuilder, /value\.mode === "classic" \? "□"/);
  assert.doesNotMatch(recurrenceBuilder, /recurrence-mode-toggle/);
  assert.doesNotMatch(recurrenceBuilder, /const setMode/);
  assert.match(taskRecurrence, /buildRecurrenceDates/);
  assert.match(taskRecurrence, /recurrenceDatesForTask/);
  assert.match(taskRecurrence, /recurrenceExcludedDates/);
  assert.match(taskRecurrence, /alignRecurrenceConfigWithCalendar/);
  assert.match(taskRecurrence, /convertTrackerRecurrenceCalendar/);
  assert.match(taskRecurrence, /calendarMode === "profane"\) return "classic"/);
  assert.match(taskRecurrence, /calendarMode === "lunar"\) return "lunar"/);
  assert.match(taskRecurrence, /Сакральный календарь/);
  assert.match(taskRecurrence, /Григорианский календарь/);
  assert.match(taskRecurrence, /Лунный календарь/);
  assert.match(taskRecurrence, /getSacredDate/);
  assert.match(taskRecurrence, /getMoon/);
  assert.match(taskRecurrence, /lunarMonthOptions/);
  assert.match(taskRecurrence, /selectedPyatas/);
  assert.match(taskRecurrence, /MAX_RECURRENCE_OCCURRENCES/);
  assert.match(taskRecurrence, /cursor <= end/);
  assert.match(taskRecurrence, /selectedDays\.has/);
  assert.match(calendar, /task-series-scope/);
  assert.match(calendar, /Только этот день/);
  assert.match(calendar, /Вся серия/);
  assert.match(calendar, /taskSeriesAfterExcludingOccurrence/);
  assert.match(trackerCore, /normalizeRecurrenceConfig\(\{ \.\.\.fallback, \.\.\.value\.recurrence,[\s\S]*calendarContext: value\.recurrence\.calendarContext \?\? calendarContext\(\{ version: 1/);
  assert.doesNotMatch(trackerCore, /alignRecurrenceConfigWithCalendar\(\{ \.\.\.fallback, \.\.\.value\.recurrence \}/);
  assert.match(taskDescription, /GENESIS-DATA/);
  assert.match(calendar, /calendar-sun-times/);
  assert.doesNotMatch(calendar, /navigator\.geolocation/);
  assert.doesNotMatch(calendar, /requestDeviceLocation/);
  assert.match(calendar, /getAutomaticSolarLocation/);
  assert.match(calendar, /TodaySolarTimes today=\{today\} location=\{deviceLocation\} deviceTimeZone=\{deviceTimeZone\}/);
  assert.doesNotMatch(calendar, /Рассвет и закат временно недоступны/);
  assert.doesNotMatch(calendar, /Не удалось связаться с сервисом определения региона/);
  assert.match(solarTimes, /getSunriseSunset/);
  assert.match(solarTimes, /https:\/\/get\.geojs\.io\/v1\/ip\/geo\.json/);
  assert.match(solarTimes, /geocoding-api\.open-meteo\.com\/v1\/search/);
  assert.match(solarTimes, /getAutomaticSolarLocation/);
  assert.match(solarTimes, /getTimezoneFallbackLocation/);
  assert.match(solarTimes, /TIMEZONE_REFERENCE_LOCATIONS/);
  assert.match(solarTimes, /return await getIpLocation\(signal\)/);
  assert.match(solarTimes, /LOCATION_REQUEST_TIMEOUT_MS/);
  assert.match(solarTimes, /SUNRISE_ALTITUDE/);
  assert.match(solarTimes, /formatDeviceSolarTime/);
  assert.match(stoicheionData, /STOICHEION_SOURCE_COUNT = 24/);
  assert.match(stoicheionData, /STOICHEION_TOTAL_COUNT = 24/);
  assert.match(stoicheionData, /id: "alpha"/);
  assert.match(stoicheionData, /id: "chi"/);
  assert.match(stoicheionData, /id: "omega"/);
  assert.match(stoicheionData, /Метафизика перекрестка миров и Огненной Души/);
  assert.doesNotMatch(stoicheionData, /source: "editorial-placeholder"/);
  assert.match(stoicheion, /buildStoicheionSpread/);
  assert.match(stoicheion, /pythmenFromTotal/);
  assert.match(stoicheion, /Космический круг и девять ликов силы/);
  assert.match(stoicheion, /stoicheion-spread-grid/);
  assert.match(stoicheion, /icon="reroll"/);
  assert.equal(JSON.parse(await readFile(new URL("../app/stoicheion-restoration-web-ui.json", import.meta.url), "utf8")).ru.reroll, "Перебросить");
  assert.match(stoicheion, /beginMotion\("daily", true, event\.timeStamp\)/);
  assert.match(stoicheion, /MOTION_TRAVEL_REQUIRED = 4480/);
  assert.match(stoicheion, /loadStoicheionDraws/);
  assert.match(stoicheion, /spreadCanReroll/);
  assert.match(stoicheion, /трёхминутное окно/i);
  assert.match(stoicheion, /moveThroughField/);
  assert.match(stoicheion, /isStoicheionCardReversed/);
  assert.match(stoicheion, /buildStoicheionSpreadReading/);
  assert.match(stoicheion, /Перевёрнутое положение/);
  assert.match(stoicheion, /PREVIEW_POSITIONS/);
  assert.match(stoicheion, /stoicheion-compass-rose/);
  assert.match(JSON.parse(await readFile(new URL("../app/stoicheion-timeline.json", import.meta.url), "utf8")).ru.motionGeneralHint, /Водите мышью по экрану или проведите пальцем/);
  assert.doesNotMatch(stoicheion, />ΣΤ</);
  assert.doesNotMatch(stoicheion, /STOICHEION_SOURCE_COUNT/);
  assert.doesNotMatch(stoicheion, /STOICHEION_TOTAL_COUNT/);
  assert.doesNotMatch(calendar, /Открыть →/);
  assert.match(styles, /\.calendar-month-art/);
  assert.match(styles, /\.year-month::before/);
  assert.match(styles, /\.year-open-button/);
  assert.match(styles, /\.mini-pyata-days/);
  assert.match(calendar, /sacredYearDetailsOpen/);
  assert.match(calendar, /className="year-details-button"/);
  const yearDetails = await readFile(new URL("../app/SacredYearDetailsDialog.tsx", import.meta.url), "utf8");
  assert.match(yearDetails, /Почему наш год устроен именно так/);
  assert.match(yearDetails, /Пентада: 5 стихий и геометрия восхождения/);
  assert.match(yearDetails, /Гексада: 6 Пят и Куб Событий/);
  assert.match(yearDetails, /aria-modal="true" aria-labelledby="sacred-year-details-title"/);
  assert.match(styles, /\.year-details-button/);
  assert.match(styles, /\.sacred-year-details-modal/);
  assert.match(styles, /\.sacred-year-source-grid/);
  assert.match(styles, /grid-auto-rows: max-content/);
  assert.match(styles, /\.project-row\.drop-target/);
  assert.match(styles, /\.project-tree-workspace/);
  assert.match(styles, /\.inbox-card\.drop-target/);
  assert.match(styles, /\.project-drag-preview/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.project-draggable-item\s*\{\s*cursor: auto;\s*touch-action: pan-y;/);
  assert.match(styles, /\.inbox-card-items > article\.inbox-task-item/);
  assert.match(styles, /\.inbox-card-items \.inbox-task-delete/);
  assert.match(styles, /\.day-details-modal/);
  assert.match(styles, /\.day-details-hero[\s\S]*grid-template-columns: 72px minmax\(0, 1fr\)/);
  assert.match(styles, /\.day-details-modal \.habit-daily-panel\.compact \{ width:100%; min-width:0;/);
  assert.match(styles, /\.day-details-create-task-button/);
  assert.match(styles, /\.day-task-create-modal > \.task-form/);
  assert.match(styles, /\.day-task-create-backdrop\s*\{[\s\S]*z-index: 675/);
  assert.match(i18n, /"Новая задача на выбранный день": "New task for the selected day"/);
  assert.match(styles, /\.today-create-options:has\(> details\[open\]\)/);
  assert.match(styles, /\.task-form-section/);
  assert.match(styles, /\.recurrence-builder/);
  assert.match(styles, /\.recurrence-inherited-mode/);
  assert.doesNotMatch(styles, /\.recurrence-mode-toggle/);
  assert.match(styles, /\.month-calendar \.calendar-day\.saturday/);
  assert.match(calendar, /weekday-\$\{weekdayIndex\}/);
  assert.match(styles, /\.calendar-day\.mode-profane\.weekday-0/);
  assert.match(styles, /\.calendar-day\.mode-profane\.weekday-5/);
  assert.match(styles, /--weekday-card-tint: rgba\(54, 101, 151, \.09\)/);
  assert.match(styles, /--weekday-selected-bg: #24583d/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-profane\s*\{[\s\S]*linear-gradient\(145deg, #061619, #0a2528 56%, #07171b\)/);
  assert.match(calendar, /adjacent-month-label/);
  assert.match(calendar, /const adjacentMonthName = isAdjacentMonth/);
  assert.match(calendar, /return position === "previous" \? 0\.24 \+ \(progress \* 0\.3\) : 0\.54 - \(progress \* 0\.3\)/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-profane \.calendar-mode-day\.adjacent-month\s*\{[\s\S]*opacity: var\(--adjacent-month-opacity, \.4\);[\s\S]*pointer-events: none/);
  assert.match(styles, /\.calendar-mode-day\.adjacent-month \.adjacent-month-label\s*\{[\s\S]*bottom: 43px;[\s\S]*text-transform: uppercase/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-profane \.calendar-mode-day\.adjacent-month:hover\s*\{[\s\S]*transform: none/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-profane \.calendar-day\.mode-profane\[class\*="weekday-"\]\.selected/);
  assert.match(styles, /var\(--weekday-selected-muted\)/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-profane \.calendar-day\.mode-profane\.solar-day:not\(\.selected, \.today\)\s*\{[\s\S]*linear-gradient\(145deg, #fae9ae 0%, #dfc16b 54%, #c59b43 100%\)/);
  assert.match(styles, /\.calendar-day\.mode-profane\.solar-day:not\(\.selected, \.today\):hover\s*\{[\s\S]*background: var\(--white\);[\s\S]*var\(--weekday-card-tint-hover\)/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-lunar \.calendar-day\.mode-lunar\.solar-day:not\(\.selected, \.today\)\s*\{[\s\S]*linear-gradient\(145deg, #fae9ae 0%, #dfc16b 54%, #c59b43 100%\)/);
  assert.match(styles, /\.calendar-day\.mode-lunar\.solar-day:not\(\.selected, \.today\) \.calendar-solar-mark\s*\{[\s\S]*background: rgba\(255, 249, 207, \.42\);[\s\S]*border-radius: 999px/);
  assert.match(styles, /\.calendar-day\.mode-lunar\.solar-day:not\(\.selected, \.today\) \.calendar-solar-mark em\s*\{[\s\S]*display: inline;[\s\S]*font-weight: 950/);
  assert.match(styles, /\.calendar-day\.mode-lunar\.solar-day:not\(\.selected, \.today\):hover\s*\{[\s\S]*linear-gradient\(145deg, #fff4c7 0%, #e8cc79 54%, #d1aa51 100%\)/);
  assert.match(styles, /\.month-calendar \.calendar-day\.today\.solar-day \.calendar-solar-mark\s*\{[\s\S]*color: #7f5708;[\s\S]*text-shadow:/);
  assert.match(styles, /\.calendar-day\.mode-profane\.selected\.today,[\s\S]*border-color: #a54133;[\s\S]*rgba\(165, 65, 51, \.94\)/);
  assert.match(styles, /\.hero-day-title-translation\s*\{[\s\S]*white-space: nowrap/);
  assert.match(calendar, /profane-year-full-width/);
  assert.match(styles, /\.calendar-mode-description\.profane-year-full-width,[\s\S]*grid-column: 1 \/ -1/);
  assert.match(calendar, /className="profane-saturn-art"[\s\S]*calendar-art\/saturn-cronus\.webp/);
  assert.match(calendar, /Кронос с косой и золотой сигиллой Сатурна/);
  assert.match(styles, /\.profane-saturn-art\s*\{[\s\S]*position: absolute;[\s\S]*pointer-events: none/);
  assert.match(styles, /@media \(max-width: 1000px\)[\s\S]*\.profane-saturn-art \{ display: none; \}/);
  await access(new URL("../public/calendar-art/saturn-cronus.webp", import.meta.url));
  await access(new URL("../assets/calendar-art/source/saturn-cronus.png", import.meta.url));
  assert.match(styles, /\.year-grid \.mini-day\.saturday\s*\{[\s\S]*rgba\(22, 37, 35, \.09\)/);
  assert.match(styles, /\.mini-day-task-count\s*\{[\s\S]*width: 16px;[\s\S]*height: 16px;[\s\S]*background: var\(--terracotta\)/);
  assert.doesNotMatch(styles, /\.mini-day\.has-task\s*\{[\s\S]{0,160}background: var\(--terracotta\)/);
  assert.match(styles, /\.year-grid \.mini-day\.today\s*\{[\s\S]*border-color: #8f3026;[\s\S]*rgba\(181, 65, 47, \.9\)/);
  assert.match(styles, /\.month-calendar \.calendar-day\.saturday \.calendar-weekday\s*\{[\s\S]*font-weight: 950/);
  assert.match(styles, /\.month-calendar \.calendar-day\.selected \.calendar-weekday\s*\{[\s\S]*color: #fffaf0;[\s\S]*font-weight: 950/);
  assert.match(styles, /\.month-calendar \.calendar-day\.today,[\s\S]*background: var\(--white\);[\s\S]*border-color: #a54133;[\s\S]*rgba\(165, 65, 51, \.88\)/);
  assert.match(styles, /\.month-calendar \.calendar-day\.today \.calendar-weekday\s*\{[\s\S]*color: #102a27;[\s\S]*font-weight: 950/);
  assert.match(styles, /@media \(min-width: 761px\)[\s\S]*\.hero-card > \.device-clock\s*\{[\s\S]*top: 124px;[\s\S]*right: 40px;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.calendar-weekday-full\s*\{[\s\S]*display: none/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.calendar-weekday-short\s*\{[\s\S]*display: inline/);
  assert.doesNotMatch(styles, /\.calendar-day\.saturday\s*\{[\s\S]{0,180}#111817/);
  assert.match(styles, /\.recurrence-day-grid\.dense/);
  assert.match(styles, /\.recurrence-range/);
  assert.match(styles, /\.recurrence-month-grid/);
  assert.match(styles, /\.recurrence-preset-row/);
  assert.match(styles, /\.recurrence-summary\.warning/);
  assert.match(styles, /\.calendar-sun-times/);
  assert.match(styles, /--paper: #e1d9c8/);
  assert.match(styles, /\.calendar-solar-control > div/);
  assert.match(styles, /\.stoicheion-view/);
  assert.doesNotMatch(calendar, /month-rail|calendarRailItems|calendarRailTitle/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-lunar \.calendar-mode-days/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.calendar-mode-calendar\.mode-lunar \.calendar-mode-days\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-lunar \.calendar-mode-primary > small\s*\{[\s\S]*overflow-wrap: normal;[\s\S]*white-space: normal/);
  assert.match(styles, /\.calendar-mode-calendar\.mode-lunar \.calendar-cross-date\s*\{[\s\S]*overflow-wrap: normal;[\s\S]*white-space: normal/);
  assert.match(styles, /\.civil-mini-calendar\.mode-lunar/);
  assert.match(styles, /\.civil-mini-calendar\.mode-lunar \.mini-day-moon-phase/);
  assert.match(styles, /\.calendar-mode-description\.lunar-year-full-width\s*\{[\s\S]*grid-column: 1 \/ -1/);
  assert.match(styles, /\.calendar-mode-description\.lunar-year-has-intercalary\s*\{[\s\S]*grid-column: span 2/);
  assert.doesNotMatch(styles, /\.calendar-source-links/);
  assert.doesNotMatch(styles, /\.mobile-nav button\[data-nav-id="admin"\]\s*\{/);
  assert.match(styles, /grid-auto-flow: column/);
  assert.match(styles, /mask-image: linear-gradient\(to right/);
  assert.match(styles, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@keyframes shieldPulse/);
  assert.match(styles, /\.proof-private i::before/);
  assert.match(styles, /overflow-x: hidden/);
  assert.match(styles, /overscroll-behavior-x: none/);
  assert.match(calendar, /ux-install-icon/);
  assert.match(accountPanel, /ux-calendar-icon/);
  assert.match(calendar, /onExportCalendar=\{exportCalendar\}/);
  assert.doesNotMatch(calendar, />↓</);
  assert.doesNotMatch(calendar, />↥</);
  assert.doesNotMatch(styles, /background-size: 100% 100%, 1300% 100%/);
  assert.doesNotMatch(styles, /repeat\(5, minmax\(78px, 1fr\)\)/);
  assert.doesNotMatch(api, /admin-access/);
  assert.match(repository, /nikitalexanderson@gmail\.com/);
  assert.match(repository, /genesisRequireAdmin/);
  assert.match(google, /https:\/\/www\.googleapis\.com\/auth\/tasks/);
  assert.match(google, /genesisSyncNativeGoogleTask/);
  assert.match(google, /genesisCreateGoogleTaskList/);
  assert.match(google, /genesisDefaultGoogleTaskListId/);
  assert.match(google, /'isDefault' =>/);
  assert.match(google, /genesisUpdateGoogleTaskList/);
  assert.match(google, /genesisDeleteGoogleTaskList/);
  assert.match(google, /genesisSource/);
  assert.match(google, /'google-calendar'/);
  assert.match(google, /genesisCleanTaskDescription/);
  assert.match(google, /GoogleCalendarMetadataCleanup/);
  assert.match(google, /GoogleTasksMetadataCleanup/);
  assert.match(google, /'description' => \$description/);
  assert.match(google, /return genesisEntryDescription\(\$task, genesisCleanTaskDescription\(\$task\['description'\] \?\? ''\)\);/);
  assert.match(google, /genesisGoogleTasksApi\(\s*'PATCH'/);
  assert.match(google, /genesisClientTimeZone/);
  assert.match(google, /genesisEndDate/);
  assert.match(google, /genesisCycleMode/);
  assert.match(google, /genesisCyclePattern/);
  assert.match(google, /genesisCycleDays/);
  assert.match(google, /genesisCycleStart/);
  assert.match(google, /genesisCycleEnd/);
  assert.match(google, /genesisCycleMonths/);
  assert.match(google, /genesisCyclePyatas/);
  assert.match(google, /genesisSeriesId/);
  assert.match(google, /genesisGoogleRecurrenceLines/);
  assert.match(google, /RDATE;VALUE=DATE/);
  assert.match(google, /'singleEvents' => 'false'/);
  assert.match(google, /'due' => \$endDate/);
  assert.match(cloudSync, /googleTaskListId/);
  assert.match(cloudSync, /recurrenceMode: RecurrenceMode/);
  assert.match(cloudSync, /recurrencePattern: RecurrencePattern/);
  assert.match(cloudSync, /recurrenceDays: number\[\]/);
  assert.match(cloudSync, /recurrenceStartDate: string \| null/);
  assert.match(cloudSync, /recurrenceEndDate: string \| null/);
  assert.match(cloudSync, /recurrenceMonths: number\[\]/);
  assert.match(cloudSync, /recurrencePyatas: number\[\]/);
  assert.match(cloudSync, /recurrenceSeriesId: string \| null/);
  assert.match(cloudSync, /recurrenceDates: recurrenceDatesForTask\(task\)/);
  assert.match(cloudSync, /taskListLinks/);
  assert.match(cloudSync, /googleEventId: task\.googleEventId/);
  assert.match(api, /\$path === 'task-lists'/);
  assert.match(api, /\$segments\[0\] === 'task-lists'/);
  assert.match(cloudSync, /updateGoogleTaskList/);
  assert.match(cloudSync, /removeGoogleTaskList/);
  assert.match(cloudSync, /X-Genesis-Time-Zone/);
  assert.match(cloudSync, /reminders: TaskReminder\[\]/);
  assert.match(taskReminders, /MAX_TASK_REMINDERS = 5/);
  assert.match(taskReminders, /normalizeTaskReminders/);
  assert.match(reminderPicker, /Пользовательский\.\.\./);
  assert.match(reminderPicker, /Пользовательское напоминание/);
  assert.match(reminderPicker, /Относительное время/);
  assert.match(reminderPicker, /Дата и время/);
  assert.match(reminderPicker, /reminder-chips/);
  assert.match(reminderPicker, /<svg className="reminder-disclosure-icon"[\s\S]*?<path d="m6\.5 9 5\.5 5\.5L17\.5 9" \/>/);
  assert.doesNotMatch(reminderPicker, /<span aria-hidden="true">⌄<\/span>/);
  assert.match(styles, /\.reminder-disclosure-icon\s*\{/);
  assert.match(styles, /\.reminder-add-button\[aria-expanded="true"\] \.reminder-disclosure-icon/);
  assert.match(calendar, /TaskReminderPicker/);
  assert.match(google, /genesisReminders/);
  assert.match(google, /genesisTaskReminderOverrides/);
  assert.match(repository, /genesisSaveStoicheionDraw/);
  assert.match(accountPanel, /role="switch"/);
  assert.match(accountPanel, /Запретить себе гадания/);
  assert.match(cloudSync, /updateAccountPreferences/);
  assert.match(calendar, /divinationDisabled=\{Boolean\(cloudUser\?\.stoicheionDivinationDisabled\)\}/);
  assert.match(stoicheion, /Гадания по картам выключены/);
  assert.match(stoicheion, /все буквенные карты и их значения остаются доступны/);
  assert.match(api, /\$method === 'PUT' && \$path === 'account\/preferences'/);
  assert.match(repository, /stoicheion_divination_disabled/);
  assert.match(repository, /Гадания по картам отключены в личном кабинете/);
  assert.match(calendar, /TimeClockPicker/);
  assert.doesNotMatch(calendar, /<datalist/);

  await access(new URL("../public/month-frieze-v1.webp", import.meta.url));
  await access(new URL("../public/month-frieze-v2.png", import.meta.url));
  await Promise.all(Array.from({ length: 13 }, (_, index) =>
    access(new URL(`../public/month-art-v4/month-${String(index + 1).padStart(2, "0")}.webp`, import.meta.url)),
  ));
  const dailyArtStats = await Promise.all(Array.from({ length: 366 }, (_, index) => {
    const month = index < 360 ? Math.floor(index / 30) + 1 : 13;
    const day = index < 360 ? (index % 30) + 1 : index - 359;
    return stat(new URL(`../public/day-art-v1/month-${String(month).padStart(2, "0")}/day-${String(day).padStart(2, "0")}.webp`, import.meta.url));
  }));
  assert.equal(dailyArtStats.length, 366);
  assert.ok(dailyArtStats.every((entry) => entry.size > 200_000));
  await access(new URL("../server/migrations/004_stoicheion_draws.sql", import.meta.url));
  await access(new URL("../server/migrations/005_stoicheion_divination_preference.sql", import.meta.url));
  await access(new URL("../server/migrations/007_user_language.sql", import.meta.url));
  await access(new URL("../server/migrations/008_task_calendar_mode.sql", import.meta.url));
});

test("ships complete English sacred-day and Stoicheion datasets", async () => {
  const [dayTranslationsRaw, stoicheionTranslationsRaw, calendarData, calendarDatePicker, stoicheionData, stoicheionView] = await Promise.all([
    readFile(new URL("../app/calendar-days.en.json", import.meta.url), "utf8"),
    readFile(new URL("../app/stoicheion.en.json", import.meta.url), "utf8"),
    readFile(new URL("../app/calendar-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/CalendarDatePicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/stoicheion-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/StoicheionView.tsx", import.meta.url), "utf8"),
  ]);
  const dayTranslations = JSON.parse(dayTranslationsRaw);
  const stoicheionTranslations = JSON.parse(stoicheionTranslationsRaw);
  const greekNames = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon", "Phi", "Chi", "Psi", "Omega"];

  assert.equal(dayTranslations.length, 366);
  assert.equal(dayTranslations[150].name, "Karpos Khtonios (Karpos Earthly)");
  assert.ok(dayTranslations.every((day) => day.name && day.description));
  assert.doesNotMatch(dayTranslationsRaw, /[А-Яа-яЁё]/);
  assert.deepEqual(Object.values(stoicheionTranslations).map((letter) => letter.name), greekNames);
  assert.doesNotMatch(stoicheionTranslationsRaw, /[А-Яа-яЁё]/);
  assert.match(stoicheionTranslations.alpha.content, /AKRAMMAKHAMARI/);
  assert.match(stoicheionTranslations.gamma.content, /GENIOMOUTIG/);
  assert.match(stoicheionTranslations.chi.content, /KHENNEOFEOCH/);
  assert.match(stoicheionTranslations.psi.content, /ΨΥΧΟΜΠΟΙΑΨ/);
  assert.match(stoicheionTranslations.omega.content, /ΩΡΙΩΝ/);
  assert.match(calendarData, /calendar-days\.en\.json/);
  assert.match(calendarDatePicker, /getSacredDay\(sacredMonth, day\.day\)/);
  assert.match(stoicheionData, /getStoicheionLetters/);
  assert.match(stoicheionView, /getStoicheionLetters\(language\)/);
  assert.match(stoicheionView, /translateText\('Парадное положение',language\)/);
  const orientationCopy = { ...JSON.parse(await readFile(new URL("../app/curated-translations.en.json", import.meta.url), "utf8")), ...JSON.parse(await readFile(new URL("../app/translations.en.json", import.meta.url), "utf8")), ...JSON.parse(await readFile(new URL("../app/ui-translations/en.json", import.meta.url), "utf8")) };
  assert.equal(orientationCopy["Парадное положение"], "Upright position");
});

test("uses Quinta terminology throughout the English interface", async () => {
  const [i18n, translationsRaw] = await Promise.all([
    readFile(new URL("../app/i18n.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/translations.en.json", import.meta.url), "utf8"),
  ]);
  const translations = JSON.parse(translationsRaw);
  const displayedEnglish = Object.values(translations).join("\n");

  assert.match(i18n, /"Пята": "Quinta"/);
  assert.match(i18n, /"Пяты": "Quintas"/);
  assert.equal(translations["Пята"], "Quinta");
  assert.equal(translations["Пяты месяца"], "Quintas of the month");
  assert.equal(translations["I пята"], "Quinta I");
  assert.equal(translations["Пята Инициации"], "Quinta of Initiation");
  assert.equal(translations["Пята Столкновения"], "Quinta of Confrontation");
  assert.equal(translations["Пята Перехода"], "Quinta of Transition");
  assert.equal(translations["Ритм пяты · действует в каждом месяце"], "Quinta rhythm · applies to every month");
  assert.equal(translations["Подробнее"], "Learn more");
  assert.equal(translations["Пентада: 5 стихий и геометрия восхождения"], "Pentad: Five Elements and the Geometry of Ascent");
  assert.equal(translations["Гексада: 6 Пят и Куб Событий"], "Hexad: Six Quintas and the Cube of Events");
  assert.equal(translations["Апейрон: 13-й месяц и лайф-менеджмент по нашему календарю"], "Apeiron: The Thirteenth Month and Life Management in Our Calendar");
  assert.equal(translations["Закон Анабасиса"], "The Law of Anabasis");
  assert.match(translations["Эти 6 дней стоят вне времени. Это пространство Протогеносов — Первозданных Богов, существовавших до начала мира. Здесь нет стихий Пяты, здесь правит Чистый Хаос."], /Pure Chaos reigns/);
  assert.doesNotMatch(displayedEnglish, /\bpyatas?\b/i);
});

test("ships the complete illustrated Stoicheion deck with exact Greek typography", async () => {
  const ids = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho",
    "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
  ];

  await Promise.all(ids.map((id) => access(new URL(`../public/stoicheion-cards/${id}.webp`, import.meta.url))));
  await access(new URL("../public/stoicheion-cards/frame-greek-key.svg", import.meta.url));

  const [view, face, cardArt, frame] = await Promise.all([
    readFile(new URL("../app/StoicheionView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StoicheionCardFace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/stoicheion-card-art.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/stoicheion-cards/frame-greek-key.svg", import.meta.url), "utf8"),
  ]);
  const authoredCardArt = cardArt.split("const FALLBACK_ART")[0];
  const invocations = [...authoredCardArt.matchAll(/invocation: "([^"]+)"/g)].map((match) => match[1]);

  assert.equal(invocations.length, 24);
  invocations.forEach((invocation) => assert.match(invocation, /^[\p{Script=Greek}\p{Mark}]+$/u));
  ids.forEach((id) => assert.match(cardArt, new RegExp(`\\b${id}: \\{`)));
  assert.match(face, /\/stoicheion-cards\/\$\{letter\.id\}\.webp/);
  assert.match(face, /\/stoicheion-cards\/frame-greek-key\.svg/);
  assert.doesNotMatch(face, /\/stoicheion-cards\/frame(?:-linked-key)?\.svg/);
  assert.match(view, /StoicheionCardFace/);
  assert.doesNotMatch(view, /Пока изображения карт готовятся/);
  assert.match(frame, /pattern id="greek-key-top"/);
  assert.match(frame, /pattern id="greek-key-left"/);
  assert.match(frame, /M0 0V35H40 M10 0V15H30V35 M40 5H20V25H0/);
  assert.match(frame, /<rect x="32" y="32" width="20" height="20"\/>/);
  assert.doesNotMatch(frame, /linked-key|meander-|M60 76|M256 62/);
  assert.match(face, /<i lang=\{language\}>\{invocation\}<\/i>/);
});

test("keeps Google OAuth consent, account binding, and token handling hardened", async () => {
  const [calendar, welcome, accountPanel, cloudSync, legal, api, bootstrap, google, repository, viteConfig, htaccess] = await Promise.all([
    readFile(new URL("../app/GenesisCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/WelcomeScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-sync.ts", import.meta.url), "utf8"),
    Promise.all([readFile(new URL("../app/LegalPage.tsx", import.meta.url), "utf8"), readFile(new URL("../app/legal-content.ts", import.meta.url), "utf8"), readFile(new URL("../app/weather-legal-copy.json", import.meta.url), "utf8")]).then((parts) => parts.join("\n")),
    readFile(new URL("../server/public/api/index.php", import.meta.url), "utf8"),
    readFile(new URL("../server/src/bootstrap.php", import.meta.url), "utf8"),
    readFile(new URL("../server/src/google.php", import.meta.url), "utf8"),
    readFile(new URL("../server/src/repository.php", import.meta.url), "utf8"),
    readFile(new URL("../vite.web.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/.htaccess", import.meta.url), "utf8"),
  ]);

  assert.match(welcome, /google-signin-light-pill\.svg/);
  assert.match(calendar, /google-signin-light-square\.svg/);
  assert.match(cloudSync, /purpose=login/);
  assert.match(cloudSync, /purpose=services/);
  assert.match(cloudSync, /consumeGoogleAuthError/);
  assert.match(google, /GENESIS_GOOGLE_IDENTITY_SCOPES/);
  assert.match(google, /GENESIS_GOOGLE_SERVICE_SCOPES/);
  assert.match(google, /calendar\.app\.created/);
  assert.match(google, /https:\/\/www\.googleapis\.com\/auth\/tasks/);
  assert.match(google, /code_challenge_method/);
  assert.match(google, /genesisRevokeGoogleToken/);
  assert.match(google, /oauth2\.googleapis\.com\/revoke/);
  assert.match(api, /issued_at/);
  assert.match(api, /time\(\) - 600/);
  assert.match(api, /hash_equals/);
  assert.match(api, /unset\(\$_SESSION\['oauth_request'\]\)/);
  assert.match(api, /genesisSafeReturnTo/);
  assert.match(api, /account_mismatch/);
  assert.match(api, /missing_permissions/);
  assert.match(bootstrap, /session\.use_strict_mode/);
  assert.match(bootstrap, /session\.use_only_cookies/);
  assert.match(bootstrap, /display_errors/);
  assert.doesNotMatch(bootstrap, /getTraceAsString/);
  assert.match(repository, /email_verified/);
  assert.match(repository, /WHERE google_sub = :sub LIMIT 1/);
  assert.doesNotMatch(repository, /WHERE google_sub = :google_sub OR email = :email/);
  assert.match(repository, /genesisRevokeGoogleToken\(\$user\)/);
  assert.match(repository, /function genesisDisconnectGoogleServices/);
  assert.match(api, /account\/google-services\/disconnect/);
  assert.match(cloudSync, /disconnectGoogleServices/);
  assert.match(cloudSync, /if \(!remote\.user\.calendarConnected\) return/);
  assert.match(calendar, /if \(workspace\.user\.calendarConnected\)/);
  assert.match(calendar, /if \(!cloudUser \|\| !cloudUser\.calendarConnected\) return/);
  assert.doesNotMatch(api, /auth\/vk\/|genesisVkConfigured/);
  assert.match(accountPanel, /Отключить Calendar и Tasks/);
  assert.match(legal, /Google Tasks/);
  assert.match(legal, /Limited Use/);
  assert.match(legal, /developers\.google\.com\/terms\/api-services-user-data-policy/);
  assert.match(legal, /Голосовые команды и нейросетевой разбор/);
  assert.match(legal, /GigaChat или Google Gemini/);
  assert.match(legal, /сразу после разбора отправляет запрос на её удаление/);
  assert.match(viteConfig, /sourcemap: false/);
  assert.match(htaccess, /connect-src 'self' https:\/\/get\.geojs\.io https:\/\/geocoding-api\.open-meteo\.com/);
  assert.match(legal, /GeoJS/);
  assert.match(legal, /Open-Meteo/);

  await access(new URL("../public/google-signin-light-pill.svg", import.meta.url));
  await access(new URL("../public/google-signin-light-square.svg", import.meta.url));
  await access(new URL("../public/.well-known/security.txt", import.meta.url));
  await access(new URL("../public/robots.txt", import.meta.url));
  await access(new URL("../public/sitemap.xml", import.meta.url));
  await access(new URL("../docs/GOOGLE-OAUTH-PUBLISHING.md", import.meta.url));
});

test("encrypted-only workspace updates preserve the last complete metrics census", async () => {
  const api = await readFile(new URL("../server/public/api/index.php", import.meta.url), "utf8");
  assert.match(api, /if \(array_key_exists\('metrics', \$payload\)\) \{\s*genesisSaveMetrics\(\$userId, \$payload\);\s*\}/);
});
