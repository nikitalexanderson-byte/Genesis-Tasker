"use client";
import release319Copy from "./release-319-copy.json";
import { GENESIS_TELEGRAM, genesisTelegramLabel } from './site-links';
import { PaletteArtFilter } from "./PaletteArtFilter";
import { featureAllowed, featureLimit, featureQuotaAllows, requireQuotaGrowth, requireFeature } from './feature-access';
import {FeatureAccessContext} from './FeatureAccessContext';
import {allowDataTransfer, requireDataTransfer} from './data-transfer-access';
import {UpgradeAccessUI,UpgradeButton,isFreeBillingUser} from './UpgradeUI';
import {requestUpgrade} from './upgrade-events';
import { usePhysisAccess } from "./physis/access";
import { PhysisAccessNotice } from "./physis/AccessNotice";
const PhysisPage = lazy(() => import("./physis/PhysisPage").then(module => ({ default: module.PhysisPage })));
const TodayAdvice = lazy(() => import("./TodayAdvice").then(module => ({ default: module.TodayAdvice })));
const DreamJournalToday = lazy(() => import('./DreamJournal').then(module => ({default:module.DreamJournalToday})));
const SolarLandscapeHero = lazy(() => import('./SolarLandscapeHero'));
const SolarWeatherSummary = lazy(() => import('./SolarLandscapeHero').then(module=>({default:module.SolarWeatherSummary})));
import './solar-landscape-hero.css';
import './workspace-header-refinements.css';
import './web-color-refinements.css';
import './web-secondary-palettes.css';
import { todayYearProgress } from './today-year-progress';
import { DialogCloseButton } from "./DialogCloseButton";
import { useMobileLayout, useCompactHeader } from "./use-mobile-layout";
import { useHeaderControlSize } from "./use-header-control-size";
import { HeaderSectionSwitch } from "./HeaderSectionSwitch";
import { effectiveBillingPlan } from "./billing";
import {orderPersonalTasks,taskListOrders,unreadPersonalCommentIds,type TaskListOrder} from "./task-list-order";
import {usePersonalTaskDisplay} from "./use-personal-task-display";
import {MindmapLaunchButton} from "./MindmapLaunchButton";
import { DiaryProvider } from "./DiaryProvider";
import { DiaryLaunchButton } from "./DiaryLaunchButton";
import diaryCopy from "./diary-copy.json";
const DiaryPage = lazy(() => import("./DiaryPage"));
import "./task-list-entry.css";
import { CalendarCellTasks } from "./CalendarCellTasks";
import { useCalendarTaskPreviews } from "./use-calendar-task-previews";
import "./calendar-cell-tasks.css";
const CalendarDayTasksDialog = lazy(() => import("./CalendarDayTasksDialog"));
const SacredYearDetailsDialog = lazy(() => import("./SacredYearDetailsDialog"));
const LunarYearDetailsDialog = lazy(() => import("./LunarYearDetailsDialog"));
const SolarCalendarExplorer = lazy(() => import("./SolarCalendarExplorer"));

import { calendarContext } from "./calendar-context";
import { mergeInitialWorkspaceCollection } from './workspace-import-policy';
import { useSharedTaskPage } from "./use-shared-task-page";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import { DeferredViewFallback, DeferredDialogFallback, DeferredHabitFallback, ViewErrorBoundary, lazyWithRecovery as lazy } from "./DeferredViews";
import { readProtectedWorkspace, writeProtectedWorkspace, assertWorkspaceWritable } from "./workspace-storage";
import { habitTimerDeviceOwner, preserveHabitTimerRecords, withHabitTimerLock } from "./habit-timer-storage";
import { applyHabitTimerCommand, finishDisabledHabitTimers, type HabitTimerCommand } from "./habit-timer-workspace";
import type { HabitReminderTarget, HabitReminderInput } from "./habit-reminder-plan";
import type { HabitHistoryCommand } from "./habit-history-workspace";
import type { HabitRestoreRequest } from "./habit-backup-restore";
import type { HabitDayDecisionCommand } from "./habit-day-decision";
import { applyHabitLifecycleCommand, habitLifecycleState, type HabitLifecycleCommand } from "./habit-lifecycle";
import { applyHabitLifecycleToWorkspace, observeChangedHabitAvailability } from "./habits";
import { useHabitAutoDeletion } from "./use-habit-auto-deletion";
import { habitTimerEpoch } from "./habit-timer";
import { habitReminderTime } from "./habit-reminder-time";
const HabitReminderBridge = lazy(() => import("./HabitReminderBridge"));
const PersonalEntityPreview=lazy(()=>import("./PersonalEntityPreview"));
const WorkspaceConflictReview=lazy(()=>import("./WorkspaceConflictReview"));
import type { MindmapTaskRequest } from "./Mindmaps";
import { captureAccountSessionGuard, createCloudTaskOnce } from "./cloud-sync";
import { EmailVerificationNotice } from "./EmailVerificationNotice";
const SupportNotice=lazy(()=>import("./SupportNotice"));
const PlanGuidanceHost=lazy(()=>import("./PlanGuidanceHost"));
import ukrainianSynthemaNames from "./weekday-synthema.uk.json";
/* eslint-disable @next/next/no-img-element -- Google requires the official, unmodified sign-in asset. */

import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
  type MouseEvent,
  type TouchEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CalendarYearTaskCounts } from "./CalendarTaskCounts";
import { EntryTypeChoice, entryTypeLabel, entryTypeTitlePlaceholder, type EntryType } from "./EntryTypeChoice";
import { RecordCalendarChoice } from "./RecordCalendarChoice";
import { IconActionButton } from "./IconActionButton";
import { ThemeModeToggle } from "./ThemeModeToggle";
import { SERVICE_IDENTITY } from "./public-service";
import { DonationLink } from "./DonationLink";
import { normalizeWebTheme } from "./web-theme";
import { effectiveDarkPalette } from "./dark-palettes";
import { TodayAdBlock } from "./TodayAdBlock";
import { ActionNotice, useActionNotice } from "./ActionNotice";
import type { SharedInvitationDestination } from "./SharedInvitationNotices";
import { ProjectCompletionDialog } from "./ProjectCompletionDialog";
import { uiVisibility, viewIsVisible, visibleCalendarMode, visibleCalendarModes } from "./ui-visibility";
import {TodayBlocks, TodayBlock} from './TodayBlocks';
const TodayBlockOrderButton = lazy(() => import('./TodayBlockOrderDialog').then(module => ({default: module.TodayBlockOrderButton})));
const TodayBlockOrderDialog = lazy(() => import('./TodayBlockOrderDialog').then(module => ({default: module.TodayBlockOrderDialog})));
import {availableTodayBlockStorage, effectiveTodayBlockOrder, readTodayBlockOrder, readTodayHalfBlocks, storeTodayBlockOrder, storeTodayHalfBlocks, type TodayBlockId} from './today-block-order';
import {DisplayCalendarChoice} from './DisplayCalendarChoice';
import { SacredFeaturesContext } from "./sacred-features";
import { useSidebarCollapse } from "./use-sidebar-collapse";
import { useAccountLayout } from "./use-account-layout";
import { InboxToolbar, InboxRestore, InboxResizeBoundary } from "./InboxToolbar";
import { PersonalCategoryPanel } from "./PersonalCategoryPanel";
import { ProjectsHeroMark } from "./ProjectsHeroMark";
import { matchesAffair } from "./affairs-search";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { NavigationIcon } from "./NavigationIcon";
import { WorkspaceHeader } from "./WorkspaceHeader";
import "./account-discovery.css";
const SharedAffairsHint = lazy(() => import("./SharedAffairsHint"));
const CalendarExploreNotice = lazy(() => import("./CalendarExploreNotice"));
const IosInstallPrompt = lazy(() => import("./IosInstallPrompt"));
import { SharedUpdatesProvider } from "./SharedUpdatesProvider";
import type { SharedTaskDestination } from "./SharedUpdates";
import { saveAffairsArea, storedAffairsArea, savedSharedPlace, sharedPlaceUrl } from "./shared-navigation";
import { formatTaskCount, formatTaskListCount } from "./task-count-i18n";
import {
  type GeminiPlan,
  type GoogleTaskList,
  type GenesisCategory,
  type GenesisProject,
  type GenesisTask as Task,
  type GenesisUser,
  type SharedCalendarTask,
  type TaskListProjectLink,
  type TaskOrigin,
  GENESIS_LEGACY_WORKSPACE_STORAGE_KEY,
  GENESIS_USER_WORKSPACE_STORAGE_PREFIX,
  connectAdditionalGoogleAccount,
  connectGoogleServices,
  consumeGoogleAuthError,
  createGoogleTaskList,
  removeGoogleTaskList,
  isGoogleSyncConfigured,
  loadAssistantStatus,
  loadGenesisSession,
  LOCAL_SESSION_ENDED_EVENT,
  canRestoreOfflineSession,
  type AssistantProvider,
  loadGenesisWorkspace,
  listSharedCalendarTasks, sharedCalendarProjection,
  mergeLocalWorkspace,
  metricsFor,
  observeCloudTasks,
  observeCloudWorkspace,
  observeEncryptedWorkspaceUpdates,
  observeGenesisUser,
  registerWorkspaceRecoveryRequestHandler,
  recordFeatureUsage,
  removeCloudTask,
  isCloudTaskDeleted,
  removeCloudTaskForTransfer,
  saveCloudTask,
  saveMetrics,
  saveWorkspaceStructure,
  restoreOfflineWorkspaceSession,
  signInWithGoogle,
  signOutFromGoogle,
  updateAccountPreferences,
  updateGoogleTaskList,
  type WorkspaceRecoveryRequest,
} from "./cloud-sync";
import { currentLegalPage } from "./legal-route";
const LegalPage = lazy(() => import('./LegalPage').then(module => ({default: module.LegalPage})));
import { TimeClockPicker, TimeClockFormatContext } from "./TimeClockPicker";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { RecordDateTimeRow } from "./RecordDateTimeRow";
import { TaskReminderPicker } from "./TaskReminderPicker";
import { CalendarModeIcon } from "./CalendarModeIcon";
import { CalendarModeCycleButton } from "./CalendarModeCycleButton";
import lunarYearOverviewCopy from './lunar-year-overview-copy.json';
import { MoonPhaseIcon } from "./MoonPhaseIcon";
import { SingleLineTitle } from "./SingleLineTitle";
import { lunarPatronArt, lunarPatronForDay, lunarTriadCopy } from "./lunar-triad";
import { WeekdaySymbol } from "./WeekdaySymbol";
import { RecurrenceBuilder } from "./RecurrenceBuilder";
import { YandexCalendarConnectDialog } from "./YandexCalendarConnectDialog";
import { HabitCompletionFeedback } from "./HabitCompletionFeedback";
import { habitDisplayText } from "./habit-display-text";
import { WorkspaceRecoveryDialog } from "./WorkspaceRecoveryDialog";
import { useMoonReminders } from "./MoonReminderSettings";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import {
  ACHIEVEMENTS,
  addHabitDays,
  dailyGoalForDate,
  EMPTY_HABIT_WORKSPACE,
  heroicRankForProgress,
  isHabitScheduledForDate,
  normalizeHabitWorkspace,
  refreshDailyGoalProgress,
  type Habit,
  type HabitWorkspace,
} from "./habits";
import { deliverHabitFeedback, type HabitFeedbackEvent } from "./habit-feedback";
import {
  habitNotificationPermission,
  observeHabitNotificationClicks,
  recordHabitNotificationsDisabled,
  requestHabitNotificationPermission,
  type HabitNotificationPermission,
} from "./habit-notifications";

import { resetHabitWorkspace } from "./habit-reset";
import { isTaskOverdue } from "./task-overdue";
import { changedTrackerDates, ensureTrackerAnalytics, refreshTrackerAnalytics } from "./tracker-analytics";
import { clearTrackerAnalyticsCache, loadTrackerAnalyticsCache, saveTrackerAnalyticsCache } from "./tracker-cache";
import { privateDeviceAccessBlocked } from "./local-sign-out";
import { registerBackupSource } from './backup-sources';
import type { SacredPracticeSectorId } from "./sacred-practices";
import {
  MONTHS,
  LUNAR_DECADES,
  PYATA_DETAILS,
  PYATA_MEANINGS,
  type CalendarMode,
  calendarDateNote,
  dateKey,
  formatGregorian,
  formatSolarEventTime,
  formatCalendarDate,
  getDayElement,
  getGregorianDate,
  getLunarDate,
  getLunarMonthDefinition,
  getLunarMonthDates,
  getLunarMonthStart,
  getLunarYear,
  getLunarYearForDate,
  getMoon,
  getPythagorean,
  getSacredDate,
  getSacredDay,
  getSolarEvent,
  getSolarEvents,
  lunarMonthIndex,
  normalizeCalendarDateNote,
} from "./calendar-data";
import { gregorianMonthNumber, gregorianWeekdayOffset } from "./calendar-layout";
import { gregorianMonthArt, gregorianMonthPanoramaArt } from "./gregorian-season-art";
import "./gregorian-season-art.css";
import {
  type AutomaticSolarLocation,
  type DeviceLocation,
  formatDeviceSolarTime,
  getAutomaticSolarLocation,
  getSunriseSunset,
  getTimezoneFallbackLocation,
} from "./solar-times";
import { readSolarPlace, readSolarTimesVisible, SOLAR_PLACE_CHANGED } from "./solar-place";
import { usePwaInstall } from "./use-pwa-install";
import { AndroidDownload } from "./AndroidDownload";
import {
  LANGUAGE_LOGIN_PENDING_KEY,
  browserLanguage,
  getRuntimeLanguage,
  isLanguage,
  lunarYearStartText,
  localizeCategoryName,
  normalizeLanguage,
  runtimeLocale,
  storeLanguage,
  translateText,
  type Language,
  useDocumentLanguage,
} from "./i18n";
import {
  buildRecurrenceDates,
  alignRecurrenceConfigWithCalendar,
  DEFAULT_RECURRENCE_CONFIG,
  MAX_RECURRENCE_OCCURRENCES,
  recurrenceConfigFromTask,
  isRecurrencePattern,
  recurrenceDatesForTask,
  type RecurrenceConfig,
  type RecurrenceMode,
  type RecurrencePattern,
} from "./task-recurrence";
import { legacyReminderMinutes, normalizeTaskReminders, type TaskReminder } from "./task-reminders";
import { formatClockTime, formatTimeValue, normalizeTimeFormat, type TimeFormat } from "./time-format";
import { TodaySolarTimes } from "./TodaySolarTimes";
import { CalendarMonthHeading } from "./CalendarMonthHeading";
import { nextOccurrenceDate, shiftRangeEndDate, buildTaskSeries, taskForOccurrence, standaloneTaskFromOccurrence, taskSeriesAfterExcludingOccurrence, taskWithSharedSeriesFields, taskRangeLabel } from "./personal-task-schedule";
import { cleanTaskDescription } from "./task-description";
import { cleanGenesisAppUrl } from "./app-url";
import {
  GENESIS_THEME,
  createGenesisThemeController,
  type GenesisTheme,
  type GenesisThemeController,
  type ThemeControllerState,
} from "./theme-controller";
import {
  DAY_RHYTHM_PERIODS,
  formatDayRhythmRange,
  getDayRhythmMoment,
  type DayRhythmPeriodId,
} from "./day-rhythm";

const AccountPanel = lazy(() => import("./AccountPanel").then((module) => ({ default: module.AccountPanel })));
const Mindmaps = lazy(() => import("./Mindmaps"));
const GoogleConnectNotice = lazy(() => import("./GoogleConnectNotice"));
const personalMindmapsEnabled = process.env.NEXT_PUBLIC_GENESIS_MINDMAPS === "true";
const CalendarPersonalTaskControl = lazy(() => import("./CalendarSharedTaskControl").then(module => ({default:module.CalendarPersonalTaskControl})));
const CalendarSharedTaskControl = lazy(() => import("./CalendarSharedTaskControl").then(module => ({default:module.CalendarSharedTaskControl})));
const SharedTaskCreate = lazy(() => import("./SharedTaskCreate").then((module) => ({ default: module.SharedTaskCreate })));
const NotificationDock = lazy(() => import("./NotificationDock"));
const SharedProjects = lazy(() => import("./SharedProjects").then((module) => ({ default: module.SharedProjects })));
const SharedTaskLists = lazy(() => import("./SharedTaskLists").then((module) => ({ default: module.SharedTaskLists })));
const PersonalTaskTransfer = lazy(() => import("./PersonalTaskTransfer").then((module) => ({ default: module.PersonalTaskTransfer })));
const PersonalProjectTransfer = lazy(() => import("./PersonalProjectTransfer").then((module) => ({ default: module.PersonalProjectTransfer })));
const WelcomeScreen = lazy(() => import("./WelcomeScreen").then((module) => ({ default: module.WelcomeScreen })));
const AdminPanel = lazy(() => import("./AdminPanel").then((module) => ({ default: module.AdminPanel })));
const PartnerPage = lazy(() => import('./PartnerPage').then(module => ({ default: module.PartnerPage })));
const GeminiAssistant = lazy(() => import("./GeminiAssistant").then((module) => ({ default: module.GeminiAssistant })));
const HabitDailyPanel = lazy(() => import("./HabitTracker").then((module) => ({ default: module.HabitDailyPanel })));
const HabitTrackerPage = lazy(() => import("./HabitTracker").then((module) => ({ default: module.HabitTrackerPage })));
const LocalVoiceAssistant = lazy(() => import("./LocalVoiceAssistant").then((module) => ({ default: module.LocalVoiceAssistant })));
const StoicheionView = lazy(() => import("./StoicheionView").then((module) => ({ default: module.StoicheionView })));
const TheokyklosView = lazy(() => import("./TheokyklosView").then((module) => ({ default: module.TheokyklosView })));

const WEB_THEME_AVAILABLE = true;


type ViewName = "today" | "calendar" | "projects" | "year" | "all-tasks" | "habits" | "stoicheion" | "theokyklos" | "admin" | "physis" | "partners";

const WebVoiceControl = lazy(() => import("./WebVoiceControl").then((module) => ({ default: module.WebVoiceControl })));

type StoredState = {
  tasks: Task[];
  projects: GenesisProject[];
  categories: GenesisCategory[];
  taskLists: GoogleTaskList[];
  taskListLinks: TaskListProjectLink[];
} & HabitWorkspace;

function reconcileGoogleTaskMetadata(remoteTasks: Task[], localTasks: Task[]) {
  const exact = new Map<string, Task>();
  const simple = new Map<string, Task | null>();
  localTasks.forEach((task) => {
    if (!task.googleTaskId || !task.googleTaskListId) return;
    exact.set(`${task.googleAccountId ?? ""}\0${task.googleTaskListId}\0${task.googleTaskId}`, task);
    const simpleKey = `${task.googleTaskListId}\0${task.googleTaskId}`;
    simple.set(simpleKey, simple.has(simpleKey) ? null : task);
  });
  return remoteTasks.map((remote) => {
    if (!remote.googleTaskId || !remote.googleTaskListId) return remote;
    const local = exact.get(`${remote.googleAccountId ?? ""}\0${remote.googleTaskListId}\0${remote.googleTaskId}`)
      ?? simple.get(`${remote.googleTaskListId}\0${remote.googleTaskId}`);
    if (!local) return remote;
    return {
      ...remote,
      id: local.id,
      project: local.project,
      projectId: local.projectId,
      categoryId: local.categoryId,
      tags: [...local.tags],
      dependsOnIds: [...local.dependsOnIds],
      priority: local.priority,
      time: local.time,
      recurrence: local.recurrence,
      recurrenceInterval: local.recurrenceInterval,
      recurrenceMode: local.recurrenceMode,
      recurrencePattern: local.recurrencePattern,
      recurrenceDays: [...local.recurrenceDays],
      recurrenceStartDate: local.recurrenceStartDate,
      recurrenceEndDate: local.recurrenceEndDate,
      recurrenceMonths: [...local.recurrenceMonths],
      recurrencePyatas: [...local.recurrencePyatas],
      recurrenceContext: local.recurrenceContext, recurrenceInvalidDayPolicy: local.recurrenceInvalidDayPolicy,
      recurrenceExcludedDates: [...local.recurrenceExcludedDates],
      recurrenceSeriesId: local.recurrenceSeriesId,
      recurrenceOriginalDate: local.recurrenceOriginalDate ?? remote.recurrenceOriginalDate,
      calendarMode: local.calendarMode,
      calendarNote: local.calendarNote,
      createdIn: local.createdIn,
      googleLinks: { ...local.googleLinks, ...remote.googleLinks },
      syncAccountIds: Array.from(new Set([...local.syncAccountIds, ...remote.syncAccountIds])),
    };
  });
}

type SyncStatus =
  | "loading"
  | "local"
  | "setup"
  | "syncing"
  | "synced"
  | "offline"
  | "error";

type ProjectDragItem = {
  kind: "task" | "task-list";
  id: string;
  title: string;
};

type ProjectTouchDrag = {
  item: ProjectDragItem;
  startX: number;
  startY: number;
  active: boolean;
  timer: number;
};

const PROJECT_DRAG_SCROLL_EDGE = 112;
const PROJECT_DRAG_SCROLL_MIN_SPEED = 180;
const PROJECT_DRAG_SCROLL_MAX_SPEED = 960;

type TaskListDraft = {
  id: string;
  title: string;
  dueDate: string;
};

type AlternativeYearMonth = {
  id: string;
  title: string;
  subtitle: string;
  ordinal: string;
  symbol: string;
  dates: Date[];
  accentMonth: (typeof MONTHS)[number];
  artUrl?: string;
  color?: string;
};

type DayDetailsOrigin = "calendar" | "year";
type SolarLocationStatus = "loading" | "ready";
type TaskSeriesScope = "occurrence" | "series";
type PendingTaskDeletion = { taskId: string; occurrenceDate: string };

const LAST_USER_KEY = "genesis-last-user-v2";

const NAVIGATION: Array<{ id: ViewName; label: string; symbol: string }> = [
  { id: "today", label: "Сегодня", symbol: "☉" },
  { id: "projects", label: "Дела", symbol: "◇" },
  { id: "habits", label: "Привычки", symbol: "✦" },
  { id: "calendar", label: "Календарь", symbol: "◫" },
  { id: "stoicheion", label: "Оракул", symbol: "ϟ" },
];

const CALENDAR_MODE_META: Record<CalendarMode, { label: string }> = {
  sacred: { label: "Сакральный календарь" },
  lunar: { label: "Лунный календарь" },
  profane: { label: "Григорианский календарь" },
};

const PROFANE_WEEKDAY_PATRONS = [
  {
    weekday: "Воскресенье",
    symbol: "☉",
    patronage: "День Аполлона",
    guidancePatrons: "Аполлон",
    guidanceTitle: "День Света и Прозрения",
    guidance: "Начало цикла. Чистое видение цели и стратегии на неделю.",
    synthema: "Φάος. Λύκειος.",
    pronunciation: "Фа-ос. Лю-кей-ос",
    alternatePronunciation: "",
    meaning: "Свет и Светозарный.",
    deity: "Аполлон (или Гелиос) — бог света, истины, искусств, порядка и самого источника жизни.",
    bodyParts: "Сердце, позвоночник и правый глаз. Солнце — центральный «мотор» макрокосма, а в человеке эту роль играет сердце; позвоночник выражает внутренний стержень и прямую осанку, дарованную божественным светом.",
  },
  {
    weekday: "Понедельник",
    symbol: "☽",
    patronage: "День Луны — Селены, Гекаты и Артемиды",
    guidancePatrons: "Артемида и Геката",
    guidanceTitle: "День Границы и Перекрёстка",
    guidance: "Защита пространства и инстинктивная мудрость выбора пути.",
    synthema: "Ἁγνή. Τρίοδος.",
    pronunciation: "Аг-не. Три-о-дос",
    alternatePronunciation: "Или — Э-ка-тэ.",
    meaning: "Чистая и Богиня Трёх Дорог.",
    deity: "Селена, Геката и Артемида — богини ночного светила, интуиции, циклов и скрытой природы вещей.",
    bodyParts: "Желудок, грудь, матка, левый глаз и все жидкости организма — лимфа и слизь. В античной традиции Луна отвечает за питание, усвоение и материнскую заботу о теле.",
  },
  {
    weekday: "Вторник",
    symbol: "♂",
    patronage: "День Ареса",
    guidancePatrons: "Арес",
    guidanceTitle: "День Натиска и Воли",
    guidance: "День активной реализации, жёсткого тайм-менеджмента, мощных тренировок и битвы.",
    synthema: "Ὁρμή. Κραταιά.",
    pronunciation: "Ор-ме. Кра-тай-а",
    alternatePronunciation: "",
    meaning: "Стремительный натиск и Несокрушимая мощь.",
    deity: "Арес — бог яростной, неукротимой войны, физической силы и первобытного драйва.",
    bodyParts: "Голова, лицо, кровеносная система и мышцы. Арес управляет жаром тела, кровью как носителем жизненной энергии и мускулатурой, которая позволяет действовать и сражаться.",
  },
  {
    weekday: "Среда",
    symbol: "☿",
    patronage: "День Гермеса",
    guidancePatrons: "Гермес",
    guidanceTitle: "День путешествий и переговоров",
    guidance: "Работа с коммуникациями, деловые встречи, переговоры и торги.",
    synthema: "Λόγος. Ἔννοια.",
    pronunciation: "Ло-гос. Эн-ной-а",
    alternatePronunciation: "",
    meaning: "Слово и Чёткий замысел.",
    deity: "Гермес — вестник богов, покровитель торговли, интеллекта, речи и связи между мирами.",
    bodyParts: "Руки, плечи, лёгкие, язык и нервная система. Гермес отвечает за коммуникацию, дыхание и обмен с внешним миром, мелкую моторику и передачу сигналов по телу.",
  },
  {
    weekday: "Четверг",
    symbol: "♃",
    patronage: "День Зевса и Геры",
    guidancePatrons: "Зевс и Гера",
    guidanceTitle: "День Власти и Суверенитета",
    guidance: "День расширения влияния и утверждения своего авторитета. Также — переговоры.",
    synthema: "Τάξις. Βασιλεία.",
    pronunciation: "Так-сис. Ба-си-лей-а",
    alternatePronunciation: "",
    meaning: "Порядок и Абсолютное царствование.",
    deity: "Зевс — царь богов, громовержец, символ закона, расширения, изобилия и высшей власти; Гера хранит царственный союз, порядок и достоинство.",
    bodyParts: "Печень, бёдра и тазобедренные суставы. В древности печень считалась вместилищем высших эмоций и источником кровотворения, а мощные бёдра — символом опоры и физической силы.",
  },
  {
    weekday: "Пятница",
    symbol: "♀",
    patronage: "День Афродиты, Гестии и Диониса",
    guidancePatrons: "Гестия, Афродита и Дионис",
    guidanceTitle: "День любви и очага",
    guidance: "День семьи, эстетики и выхода за пределы ума. Для одних Гестия и Афродита — близость и любовь. Для других — Дионис, экстаз, страсть и опьянение.",
    synthema: "Ἕδρα. Μυστήριον.",
    pronunciation: "Э-дра. Мюс-те-ри-он",
    alternatePronunciation: "",
    meaning: "Основание и Сакральная тайна.",
    deity: "Афродита — богиня любви, красоты, гармонии и влечения. День также открывает путь Гестии, хранительницы очага, или Диониса — силы трансгрессии, растворения и экстаза; каждый выбирает любовь, семейный круг или дионисийское веселье.",
    bodyParts: "Горло, почки, кожа и женские репродуктивные органы. Афродита отвечает за фильтрацию и баланс, внешнюю привлекательность и осязание, а также за голос, который очаровывает.",
  },
  {
    weekday: "Суббота",
    symbol: "♄",
    patronage: "День Кроноса, Аида и Посейдона",
    guidancePatrons: "Аид, Посейдон и Кронос",
    guidanceTitle: "День Памяти, Времени и Денег",
    guidance: "День тишины, покоя и связи с предками. Работа с энергией Сатурна — временем и материальными ресурсами.",
    synthema: "Βάθος. Αἰώνια.",
    pronunciation: "Ба-тос. Ай-о-ни-а",
    alternatePronunciation: "",
    meaning: "Бездна и Вечная.",
    deity: "Кронос, титан и отец Зевса, — владыка времени, ограничений, структуры и неизбежной судьбы.",
    bodyParts: "Кости, зубы, суставы, селезёнка и кожа как граница. Кронос управляет самым твёрдым, долговременным и кристаллизованным в организме — внутренним каркасом, на котором держится всё остальное.",
  },
] as const;

const SYNTHEMA_SELF_NAMES: Record<string, string> = {
  "Φάος. Λύκειος.": "Phaos. Lykeios.",
  "Ἁγνή. Τρίοδος.": "Hagne. Triodos.",
  "Ὁρμή. Κραταιά.": "Horme. Krataia.",
  "Λόγος. Ἔννοια.": "Logos. Ennoia.",
  "Τάξις. Βασιλεία.": "Taxis. Basileia.",
  "Ἕδρα. Μυστήριον.": "Hedra. Mysterion.",
  "Βάθος. Αἰώνια.": "Bathos. Aionia.",
};

function localizeWeekdayPatron(patron: (typeof PROFANE_WEEKDAY_PATRONS)[number], language: Language) {
  const synthema = language === "el" ? patron.synthema
    : language === "uk" ? ukrainianSynthemaNames[patron.synthema]
    : SYNTHEMA_SELF_NAMES[patron.synthema];
  return {
    weekday: translateText(patron.weekday, language),
    symbol: patron.symbol,
    patronage: translateText(patron.patronage, language),
    guidancePatrons: translateText(patron.guidancePatrons, language),
    guidanceTitle: translateText(patron.guidanceTitle, language),
    guidance: translateText(patron.guidance, language),
    synthema,
    pronunciation: translateText(patron.pronunciation, language),
    alternatePronunciation: translateText(patron.alternatePronunciation, language),
    meaning: translateText(patron.meaning, language),
    deity: translateText(patron.deity, language),
    bodyParts: translateText(patron.bodyParts, language),
  };
}

const WEEKDAY_ART_FILES = [
  "weekday-0-sunday-apollo.webp",
  "weekday-1-monday-lunar-goddesses.webp",
  "weekday-2-tuesday-ares.webp",
  "weekday-3-wednesday-hermes.webp",
  "weekday-4-thursday-zeus-hera.webp",
  "weekday-5-friday-aphrodite-hestia-dionysus.webp",
  "weekday-6-saturday-cronus.webp",
] as const;

const TASK_INBOX_PROJECT_ID = "__genesis_inbox__";
const CREATE_NEW_TASK_LIST_ID = "__create_new_task_list__";
const TASK_LIST_EXPLANATION = "Список задач — это группа смежных задач, которую можно помещать в проекты и/или подпроекты.";

const SOLAR_EVENT_COPY: Record<NonNullable<ReturnType<typeof getSolarEvent>>["id"], { force: string; greekPractice: string }> = {
  "spring-equinox": {
    force: "Сила равновесия света и тьмы помогает выровнять внутренний ритм, обновить намерения и выбрать направление нового цикла.",
    greekPractice: "У древних греков не было единого для всех полисов праздника равноденствия. Солнечные точки отмечали в сезонных календарях-парапегмах для земледелия, мореплавания и общественных дел, а весеннее обновление сопровождали обрядами, дарами богам и общими празднествами.",
  },
  "summer-solstice": {
    force: "Это вершина годового света — время ясности, полноты действия и направления накопленной силы к главной цели.",
    greekPractice: "Летнее солнцестояние служило важной календарной опорой. В Афинах первый лунный месяц после него открывал новый гражданский год; летний праздничный круг включал Панафинеи с процессией, подношениями, музыкой и состязаниями в честь Афины.",
  },
  "autumn-equinox": {
    force: "Сила второго равновесия помогает собрать плоды сделанного, отпустить лишнее и спокойно войти во внутреннюю половину года.",
    greekPractice: "Осенний сезон в греческом мире связывали со сбором урожая и мистериями Деметры и Персефоны. В Аттике совершали процессии, подношения и ночные обряды, осмысляя нисхождение, сохранение зерна и возвращение жизни.",
  },
  "winter-solstice": {
    force: "В самой длинной ночи начинается возвращение света — это сила тишины, сохранения семени и первого шага к возрождению.",
    greekPractice: "Зимнюю часть года древние греки отмечали местными праздниками света, плодородия и Диониса. В Элевсине проходили зимние Галоа в честь Деметры и Диониса, с дарами, общими трапезами и обрядами надежды на будущий рост.",
  },
};

const VIEW_NAMES = new Set<ViewName>(["today", "calendar", "projects", "year", "all-tasks", "habits", "stoicheion", "theokyklos", "admin", "physis", "partners"]);
const HABIT_REMINDER_LOOKAHEAD_DAYS = 20_000;

function nextHabitReminderDate(habit: Habit, fromDate: string, calendarMode: CalendarMode) {
  for (let offset = 0; offset < HABIT_REMINDER_LOOKAHEAD_DAYS; offset += 1) {
    const value = offset === 0 ? fromDate : addHabitDays(fromDate, offset);
    if (habit.schedule.endDate && value > habit.schedule.endDate) return null;
    if (isHabitScheduledForDate(habit, value, calendarMode)) return value;
  }
  return null;
}

function viewFromHash(): ViewName {
  if (typeof window === "undefined") return "today";
  const candidate = window.location.hash.replace(/^#\/?/, "").split(/[?&]/, 1)[0] as ViewName | "admin/actions" | "admin/ads" | "admin/forecasts" | "admin/partners";
  if (candidate === "admin/actions" || candidate === "admin/ads" || candidate === "admin/forecasts" || candidate === 'admin/partners') return "admin";
  if (candidate === "all-tasks" || (candidate as string) === "tasks") return "projects";
  return VIEW_NAMES.has(candidate) ? candidate : "today";
}

function readStoredState(key: string): StoredState {
  return readProtectedWorkspace(localStorage, key, (source) => {
    const parsed = source as Partial<StoredState>;
    const storedTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const storedProjects = Array.isArray(parsed.projects) ? parsed.projects : [];
    return {
      tasks: storedTasks.map((task) => {
        const legacy = task as Partial<Task>;
        const legacyYear = legacy.sacredYear ?? new Date().getFullYear();
        const legacyMonth = legacy.monthIndex ?? 0;
        const legacyDay = legacy.day ?? 1;
        // Old records without a canonical date used JS overflow (including Apeiron day 6).
        // Preserve exactly that migration; strict v2 entry must not rewrite their history.
        const legacyDate = new Date(legacyYear, 2, 20);
        legacyDate.setDate(legacyDate.getDate() + (legacyMonth < 12 ? legacyMonth * 30 : 360) + legacyDay - 1);
        const dueDate = typeof legacy.dueDate === "string" ? legacy.dueDate : inputDate(legacyDate);
        const recurrenceMode: RecurrenceMode = ["none", "genesis", "classic", "lunar"].includes(legacy.recurrenceMode ?? "")
          ? legacy.recurrenceMode as RecurrenceMode
          : legacy.recurrence && legacy.recurrence !== "none" ? "classic" : "none";
        const recurrencePattern: RecurrencePattern = isRecurrencePattern(legacy.recurrencePattern)
          ? legacy.recurrencePattern
          : recurrenceMode === "classic"
            ? legacy.recurrence === "daily" || legacy.recurrence === "monthly" || legacy.recurrence === "yearly" ? legacy.recurrence : "weekdays"
            : recurrenceMode === "lunar" ? "lunar-days" : recurrenceMode === "genesis" ? "pyata-days" : "none";
        const calendarMode: CalendarMode = ["profane", "sacred", "lunar"].includes(legacy.calendarMode ?? "")
          ? legacy.calendarMode as CalendarMode
          : "profane";
        const reminders = normalizeTaskReminders(legacy.reminders, legacy.reminderMinutes);
        return {
          // Keep saved extension fields (end time, calendar context, provider metadata).
          // Known fields below still pass through the existing legacy normalization.
          ...legacy,
          id: legacy.id ?? uid(),
          comments: Array.isArray(legacy.comments)?legacy.comments:[],createdAt:legacy.createdAt,createdByName:legacy.createdByName,
          sacredYear: legacyYear,
          monthIndex: legacyMonth,
          day: legacyDay,
          dueDate,
          endDate: legacy.endDate || dueDate,
          title: legacy.title ?? "Без названия",
          entryType: legacy.entryType ?? "task",
          description: cleanTaskDescription(legacy.description),
          time: legacy.time ?? "",
          project: legacy.project ?? "",
          projectId: legacy.projectId ?? null,
          categoryId: legacy.categoryId ?? null,
          tags: legacy.tags ?? [],
          dependsOnIds: legacy.dependsOnIds ?? [],
          priority: legacy.priority ?? 5,
          done: legacy.done ?? false,
          completedAt: legacy.completedAt ?? (legacy.done ? new Date().toISOString() : null),
          reminders,
          reminderMinutes: legacyReminderMinutes(reminders),
          recurrence: legacy.recurrence ?? "none",
          recurrenceInterval: legacy.recurrenceInterval ?? 1,
          recurrenceMode,
          recurrencePattern,
          recurrenceDays: Array.isArray(legacy.recurrenceDays) ? legacy.recurrenceDays.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 30) : [],
          recurrenceStartDate: typeof legacy.recurrenceStartDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(legacy.recurrenceStartDate) ? legacy.recurrenceStartDate : null,
          recurrenceEndDate: typeof legacy.recurrenceEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(legacy.recurrenceEndDate) ? legacy.recurrenceEndDate : null,
          recurrenceMonths: Array.isArray(legacy.recurrenceMonths) ? legacy.recurrenceMonths.map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 72) : [],
          recurrencePyatas: Array.isArray(legacy.recurrencePyatas) ? legacy.recurrencePyatas.map(Number).filter((pyata) => Number.isInteger(pyata) && pyata >= 1 && pyata <= 6) : [],
          recurrenceExcludedDates: Array.isArray(legacy.recurrenceExcludedDates) ? legacy.recurrenceExcludedDates.filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) : [],
          recurrenceSeriesId: typeof legacy.recurrenceSeriesId === "string" && legacy.recurrenceSeriesId ? legacy.recurrenceSeriesId : null,
          recurrenceOriginalDate: legacy.recurrenceOriginalDate ?? null,
          calendarMode,
          calendarNote: normalizeCalendarDateNote(legacy.calendarNote ?? "", calendarMode),
          syncToGoogle: legacy.syncToGoogle ?? true,
          syncAccountIds: Array.isArray(legacy.syncAccountIds) ? legacy.syncAccountIds : [],
          googleLinks: legacy.googleLinks ?? {},
          googleAccountId: legacy.googleAccountId ?? null,
          googleAccountEmail: legacy.googleAccountEmail ?? "",
          createdIn: legacy.createdIn ?? (legacy.googleTaskId
            ? "google-tasks"
            : legacy.id?.startsWith("google-event-")
              ? "google-calendar"
              : "genesis"),
          googleEventId: legacy.googleEventId ?? null,
          googleTaskId: legacy.googleTaskId ?? null,
          googleTaskListId: legacy.googleTaskListId ?? null,
          googleTaskListTitle: legacy.googleTaskListTitle ?? "",
          googleReadOnly: legacy.googleReadOnly ?? false,
          updatedAt: typeof legacy.updatedAt === "number" ? legacy.updatedAt : timestamp(),
        };
      }),
      projects: storedProjects.map((project, index) => typeof project === "string" ? {
        id: `legacy-${index}`,
        parentId: null,
        categoryId: null,
        title: project,
        description: "",
        tags: [],
        status: "active" as const,
        position: index,
      } : project),
      categories: Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_CATEGORIES,
      taskLists: Array.isArray(parsed.taskLists) ? parsed.taskLists : [],
      taskListLinks: Array.isArray(parsed.taskListLinks) ? parsed.taskListLinks : [],
      ...normalizeHabitWorkspace(parsed),
    };
  }, () => ({ tasks: [], projects: [], categories: DEFAULT_CATEGORIES, taskLists: [], taskListLinks: [], ...normalizeHabitWorkspace(null) }));
}

const DEFAULT_CATEGORIES: GenesisCategory[] = [
  { id: "personal", name: "Личное", color: "#a5543f", position: 0 },
  { id: "work", name: "Работа", color: "#2d6c68", position: 1 },
  { id: "health", name: "Тело и здоровье", color: "#b18b48", position: 2 },
];

const APP_BASE = (process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim() || "").replace(/\/$/, "");

function DependencyPicker({ tasks, excludeId, value, onChange, disabled = false }: {
  tasks: Task[];
  excludeId?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks
      .filter((task) => !task.done && task.id !== excludeId)
      .forEach((task) => {
        const key = task.project.trim() || "Без проекта";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(task);
      });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks, excludeId]);

  const toggle = (taskId: string) => {
    if (disabled) return;
    onChange(value.includes(taskId) ? value.filter((id) => id !== taskId) : [...value, taskId]);
  };

  if (!groups.length) {
    return <p className="dependency-picker-empty">Нет доступных задач</p>;
  }

  return (
    <div className="dependency-picker" role="group" aria-label="Зависит от">
      {groups.map(([project, items]) => (
        <div className="dependency-picker-group" key={project}>
          <span className="dependency-picker-group-title">{project}</span>
          {items.map((task) => (
            <label key={task.id} className="dependency-picker-item">
              <input
                type="checkbox"
                checked={value.includes(task.id)}
                disabled={disabled}
                onChange={() => toggle(task.id)}
              />
              <span data-no-translate>{task.title}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function apeironLength(sacredYear: number) {
  return getSacredDate(getGregorianDate(sacredYear, 0, 1)).apeironDays;
}

function taskDateKey(sacredYear: number, monthIndex: number, day: number) {
  return `${sacredYear}:${dateKey(monthIndex, day)}`;
}

function uid() {
  return `${timestamp()}-${Math.random().toString(36).slice(2, 8)}`;
}

function timestamp() {
  return Date.now();
}

function flattenProjects(
  projects: GenesisProject[],
  parentId: string | null = null,
  depth = 0,
): Array<{ project: GenesisProject; depth: number }> {
  return projects
    .filter((project) => project.parentId === parentId)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
    .flatMap((project) => [
      { project, depth },
      ...flattenProjects(projects, project.id, depth + 1),
    ]);
}

function projectIsDescendant(projects: GenesisProject[], candidateId: string, ancestorId: string) {
  let current = projects.find((project) => project.id === candidateId);
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    visited.add(current.id);
    current = projects.find((project) => project.id === current?.parentId);
  }
  return false;
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsDate(date: Date, time: string) {
  const [hours = "00", minutes = "00"] = time.split(":");
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${hours}${minutes}00`;
}

function inputDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function profaneMonthDates(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, index) => new Date(year, month, index + 1, 12));
}

function profaneMonthName(date: Date, short = false) {
  return new Intl.DateTimeFormat(runtimeLocale(), { month: short ? "short" : "long" })
    .format(date)
    .replace(/\.$/u, "");
}

function formatDateRange(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat(runtimeLocale(), { day: "numeric", month: "short", year: "numeric" });
  return formatter.formatRange(start, end);
}

function datesTaskCount(tasksByDate: Map<string, Task[]>, dates: Date[]) {
  return dates.reduce((count, date) => count + (tasksByDate.get(inputDate(date))?.length ?? 0), 0);
}

function romanDay(monthIndex: number, day: number) {
  return monthIndex === 12 ? String(day) : ["I", "II", "III", "IIII", "V"][(day - 1) % 5];
}

function englishOrdinal(value: number) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

function monthArtUrl(monthIndex: number) {
  return `${APP_BASE}/month-art-v4/month-${String(monthIndex + 1).padStart(2, "0")}.webp`;
}

function lunarMonthArtUrl(monthIndex: number) {
  return `${APP_BASE}/lunar-month-art-v1/month-${String(monthIndex + 1).padStart(2, "0")}.webp`;
}

function lunarMonthColor(monthIndex: number) {
  return ["#6f8da9", "#6b9294", "#8093b3", "#9587b0", "#7c9f9a", "#788da4", "#608e99", "#8c7eb0", "#6f9cb5", "#8993ac", "#8394a0", "#7b85aa", "#9489aa"][monthIndex] ?? "#6f8da9";
}

function dayArtUrl(monthIndex: number, day: number) {
  const monthPart = String(monthIndex + 1).padStart(2, "0");
  const dayPart = String(day).padStart(2, "0");
  return `${APP_BASE}/day-art-v1/month-${monthPart}/day-${dayPart}.webp`;
}

function weekdayArtUrl(weekday: number) {
  const filename = WEEKDAY_ART_FILES[weekday] ?? WEEKDAY_ART_FILES[0];
  return `${APP_BASE}/weekday-art/${filename}`;
}

function namedAction(action: string, name: string, language: Language) {
  return `${translateText(action, language)} «${name}»`;
}

function taskOriginMeta(origin: TaskOrigin) {
  if (origin === "google-calendar") return { label: "Создано в Google Calendar", className: "calendar" };
  if (origin === "google-tasks") return { label: "Создано в Google Tasks", className: "tasks" };
  return { label: "Создано в GENESIS", className: "local" };
}

const TASK_PRIORITY_LEVELS = [
  { label: "Можно позже", color: "#4f9f68" },
  { label: "Низкий", color: "#68ad63" },
  { label: "Ниже среднего", color: "#87b75b" },
  { label: "Умеренный", color: "#aebe50" },
  { label: "Средний", color: "#c7b943" },
  { label: "Заметный", color: "#d8aa3b" },
  { label: "Высокий", color: "#e28f38" },
  { label: "Очень высокий", color: "#dc6f34" },
  { label: "Срочный", color: "#d64f32" },
  { label: "Горит", color: "#c8332f" },
] as const;

function TaskPriorityControl({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const normalizedValue = Math.min(TASK_PRIORITY_LEVELS.length, Math.max(1, Number(value) || 5));
  const selectedLevel = TASK_PRIORITY_LEVELS[normalizedValue - 1];

  return (
    <div
      className="task-priority-control"
      data-genesis-preserve="task-priority"
      style={{ "--task-priority-color": selectedLevel.color } as CSSProperties}
    >
      <div className="task-priority-current" aria-live="polite">
        <span>Выбранный приоритет</span>
        <strong>{selectedLevel.label}</strong>
        <em>{normalizedValue} из 10</em>
      </div>
      <div className="task-priority-slider">
        <div className="task-priority-steps" aria-hidden="true">
          {TASK_PRIORITY_LEVELS.map((level, index) => {
            const step = index + 1;
            const className = [step <= normalizedValue ? "active" : "", step === normalizedValue ? "current" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <i
                className={className}
                key={level.label}
                style={{
                  "--priority-step": step,
                  "--priority-step-color": level.color,
                } as CSSProperties}
              />
            );
          })}
        </div>
        <input
          id={id}
          type="range"
          min={1}
          max={TASK_PRIORITY_LEVELS.length}
          step={1}
          value={normalizedValue}
          aria-label="Приоритет задачи"
          aria-valuetext={`${selectedLevel.label}, ${normalizedValue} из 10`}
          onInput={(event) => onChange(Number(event.currentTarget.value))}
          onKeyDown={(event) => {
            const nextValue = event.key === "Home"
              ? 1
              : event.key === "End"
                ? TASK_PRIORITY_LEVELS.length
                : event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? Math.min(TASK_PRIORITY_LEVELS.length, normalizedValue + 1)
                  : event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? Math.max(1, normalizedValue - 1)
                    : null;
            if (nextValue === null) return;
            event.preventDefault();
            onChange(nextValue);
          }}
        />
      </div>
      <div className="task-priority-scale" aria-hidden="true">
        <span>Менее важный</span>
        <span>Средний</span>
        <strong>Горит · самый важный</strong>
      </div>
    </div>
  );
}

type DeviceClockSnapshot = { now: Date; timezone: string };

let deviceClockSnapshot: DeviceClockSnapshot | null = null;
let deviceClockTimeout: number | null = null;
const deviceClockSubscribers = new Set<() => void>();

function updateDeviceClockSnapshot() {
  deviceClockSnapshot = {
    now: new Date(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
  deviceClockSubscribers.forEach((subscriber) => subscriber());
}

function scheduleDeviceClockTick() {
  const delay = Math.max(16, 1000 - (Date.now() % 1000));
  deviceClockTimeout = window.setTimeout(() => {
    updateDeviceClockSnapshot();
    scheduleDeviceClockTick();
  }, delay);
}

function subscribeDeviceClock(subscriber: () => void) {
  deviceClockSubscribers.add(subscriber);
  if (deviceClockSubscribers.size === 1) {
    updateDeviceClockSnapshot();
    scheduleDeviceClockTick();
    window.addEventListener("focus", updateDeviceClockSnapshot);
    document.addEventListener("visibilitychange", updateDeviceClockSnapshot);
  }

  return () => {
    deviceClockSubscribers.delete(subscriber);
    if (deviceClockSubscribers.size === 0) {
      if (deviceClockTimeout !== null) window.clearTimeout(deviceClockTimeout);
      deviceClockTimeout = null;
      window.removeEventListener("focus", updateDeviceClockSnapshot);
      document.removeEventListener("visibilitychange", updateDeviceClockSnapshot);
    }
  };
}

function getDeviceClockSnapshot() {
  return deviceClockSnapshot;
}

function getServerDeviceClockSnapshot() {
  return null;
}

function useDeviceClock() {
  return useSyncExternalStore(subscribeDeviceClock, getDeviceClockSnapshot, getServerDeviceClockSnapshot);
}

function DeviceClock({ timeFormat }: { timeFormat: TimeFormat }) {
  const clock = useDeviceClock();

  return (
    <time className="device-clock" dateTime={clock?.now.toISOString()} aria-label={clock ? `Время устройства: ${formatClockTime(clock.now, timeFormat)}` : "Время устройства синхронизируется"}>
      <strong>{clock ? formatClockTime(clock.now, timeFormat) : "--:--:--"}</strong>
      <small className="device-clock-zone" data-no-translate>{clock ? clock.timezone : "—"}</small>
      <small className="device-clock-label">{clock ? "время устройства" : "синхронизация времени"}</small>
    </time>
  );
}

function DayRhythmPanel({ timeFormat }: { timeFormat: TimeFormat }) {
  const clock = useDeviceClock();
  const [expanded, setExpanded] = useState(false);
  const [exploredPeriodId, setExploredPeriodId] = useState<DayRhythmPeriodId | null>(null);
  if (!clock) return (
    <section className="day-rhythm-panel is-collapsed" aria-labelledby="day-rhythm-title">
      <header className="day-rhythm-heading"><h2 id="day-rhythm-title">Ритм суток · время устройства</h2></header>
    </section>
  );
  const liveNow = clock.now;
  const moment = getDayRhythmMoment(liveNow);
  const exploredPeriod = DAY_RHYTHM_PERIODS.find((period) => period.id === exploredPeriodId) ?? moment.period;
  const isEnglish = getRuntimeLanguage() === "en";
  const toggleLabel = expanded
    ? (isEnglish ? "Collapse daily rhythm" : "Свернуть ритм суток")
    : (isEnglish ? "Expand daily rhythm" : "Развернуть ритм суток");
  const remainingTime = `${String(Math.floor(moment.remainingSeconds / 60)).padStart(2, "0")}:${String(moment.remainingSeconds % 60).padStart(2, "0")}`;

  return (
    <section
      className={`day-rhythm-panel rhythm-${moment.period.id} ${expanded ? "is-expanded" : "is-collapsed"}`}
      aria-labelledby="day-rhythm-title"
      style={{ "--day-rhythm-progress": `${moment.progress}%` } as CSSProperties}
    >
      <header className="day-rhythm-heading">
        <div>
          <span className="eyebrow">Ритм суток · время устройства</span>
          <h2 id="day-rhythm-title">Сейчас — {moment.period.name} · Стихия {moment.period.element}</h2>
          {!expanded ? (
            <p className="day-rhythm-summary">
              <span aria-hidden="true">{moment.watch.symbol}</span>
              {formatDayRhythmRange(moment.watch.startHour, moment.watch.endHour, timeFormat)} · {moment.watch.deity} · «{moment.watch.title}»
            </p>
          ) : null}
        </div>
        <div className="day-rhythm-heading-actions">
          <button
            type="button"
            className="day-rhythm-toggle"
            aria-expanded={expanded}
            aria-controls="day-rhythm-details"
            onClick={() => setExpanded((value) => !value)}
          >
            <span>{toggleLabel}</span>
            <svg className="day-rhythm-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m6.5 9 5.5 5.5L17.5 9" />
            </svg>
          </button>
        </div>
      </header>

      <div className="day-rhythm-details" id="day-rhythm-details" hidden={!expanded}>
        <article className="day-rhythm-current" aria-live="polite">
          <span className="day-rhythm-current-symbol" aria-hidden="true">
            <b>{moment.watch.symbol}</b>
            <i>{moment.period.alchemySymbol}</i>
          </span>
          <div className="day-rhythm-current-copy">
            <span>{formatDayRhythmRange(moment.watch.startHour, moment.watch.endHour, timeFormat)} · {moment.period.symbol} {moment.period.name}</span>
            <h3>{moment.watch.deity} · «{moment.watch.title}»</h3>
            <p>{moment.watch.description}</p>
          </div>
          <div className="day-rhythm-progress" aria-label={`Текущий двухчасовой период: ${Math.round(moment.progress)}%`}>
            <span><i /></span>
            <small>{isEnglish ? "Until the next watch" : "До смены часа"} · {remainingTime}</small>
          </div>
        </article>

        <div className="day-rhythm-dayline" aria-label="Двенадцать двухчасовых периодов суток">
          {DAY_RHYTHM_PERIODS.flatMap((period) => period.watches.map((watch) => {
            const isCurrent = watch.id === moment.watch.id;
            return (
              <span
                className={`day-rhythm-tick tone-${period.id}${isCurrent ? " current" : ""}`}
                aria-label={`${formatDayRhythmRange(watch.startHour, watch.endHour, timeFormat)} — ${watch.deity}, ${watch.title}${isCurrent ? (getRuntimeLanguage() === "en" ? ", now" : ", сейчас") : ""}`}
                title={`${watch.deity} · ${watch.title}`}
                key={watch.id}
              >
                <b aria-hidden="true">{watch.symbol}</b>
                <small>{formatTimeValue(`${String(watch.startHour % 24).padStart(2, "0")}:00`, timeFormat)}</small>
              </span>
            );
          }))}
        </div>

        <nav className="day-rhythm-periods" aria-label="Периоды суток">
          {DAY_RHYTHM_PERIODS.map((period) => {
            const isCurrent = period.id === moment.period.id;
            const isSelected = period.id === exploredPeriod.id;
            return (
              <button
                type="button"
                className={`tone-${period.id}${isCurrent ? " current" : ""}${isSelected ? " selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => setExploredPeriodId(period.id)}
                key={period.id}
              >
                <span aria-hidden="true">{period.symbol}</span>
                <div>
                  <strong>{period.name}</strong>
                  <small>{formatDayRhythmRange(period.startHour, period.endHour, timeFormat)}</small>
                </div>
                <em>Стихия {period.element}</em>
                {isCurrent ? <i>Сейчас</i> : null}
              </button>
            );
          })}
        </nav>

        <article className={`day-rhythm-explorer tone-${exploredPeriod.id}`}>
          <header>
            <span className="day-rhythm-period-symbol" aria-hidden="true">{exploredPeriod.alchemySymbol}</span>
            <div>
              <span>{exploredPeriod.symbol} {exploredPeriod.name} · Стихия {exploredPeriod.element}</span>
              <h3>{exploredPeriod.source}</h3>
              <p>{exploredPeriod.description}</p>
            </div>
            {exploredPeriod.id !== moment.period.id ? (
              <button type="button" onClick={() => setExploredPeriodId(null)}>Вернуться к текущему</button>
            ) : null}
          </header>
          <div className="day-rhythm-watches">
            {exploredPeriod.watches.map((watch) => {
              const isCurrent = watch.id === moment.watch.id;
              return (
                <section className={isCurrent ? "current" : ""} key={watch.id}>
                  <span aria-hidden="true">{watch.symbol}</span>
                  <div>
                    <time>{formatDayRhythmRange(watch.startHour, watch.endHour, timeFormat)}</time>
                    <h4>{watch.deity} · «{watch.title}»</h4>
                    <p>{watch.description}</p>
                  </div>
                  {isCurrent ? <strong>Сейчас</strong> : null}
                </section>
              );
            })}
          </div>
        </article>
      </div>
    </section>
  );
}

export function GenesisCalendar() {
  const mobileLayout = useMobileLayout();
  const compactHeader = useCompactHeader();
  const compactHeaderRef = useHeaderControlSize(compactHeader);
  const [habitHeaderTarget, setHabitHeaderTarget] = useState<HTMLDivElement | null>(null);
  const webHabitHeader = typeof document !== "undefined" && document.documentElement.dataset.genesisWeb === "true";
  const initial = useMemo(() => getSacredDate(new Date()), []);
  const [language, setLanguage] = useState<Language>(browserLanguage);
  const [today, setToday] = useState(() => new Date());
  const [view, setView] = useState<ViewName>("today");
  const [requestedTheokyklosSector, setRequestedTheokyklosSector] = useState<SacredPracticeSectorId | null>(null);
  const clearRequestedTheokyklosSector = useCallback(() => setRequestedTheokyklosSector(null), []);
  const [requestedStoicheionCard, setRequestedStoicheionCard] = useState<string | null>(null);
  const [requestedStoicheionDraw, setRequestedStoicheionDraw] = useState<"daily" | "spread" | null>(null);
  const [sacredYear, setSacredYear] = useState(initial.sacredYear);
  const [monthIndex, setMonthIndex] = useState(initial.monthIndex);
  const [selectedDay, setSelectedDay] = useState(initial.day);
  const [dayDetailsOpen, setDayDetailsOpen] = useState(false);
  const [dayTaskCreatorOpen, setDayTaskCreatorOpen] = useState(false);
  const [dayDetailsOrigin, setDayDetailsOrigin] = useState<DayDetailsOrigin>("calendar");
  const [openDayTaskPopover, setOpenDayTaskPopover] = useState("");
  const [openPyataDescription, setOpenPyataDescription] = useState("");
  const [sacredYearDetailsOpen, setSacredYearDetailsOpen] = useState(false);
  const [lunarYearDetailsOpen, setLunarYearDetailsOpen] = useState(false);
  const [solarExplorerOpen, setSolarExplorerOpen] = useState(false);
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocation | null>(null);
  const [solarLocationSource, setSolarLocationSource] = useState<AutomaticSolarLocation["source"] | null>(null);
  const [solarLocationStatus, setSolarLocationStatus] = useState<SolarLocationStatus>("loading");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<GenesisProject[]>([]);
  const [categories, setCategories] = useState<GenesisCategory[]>(DEFAULT_CATEGORIES);
  const [taskLists, setTaskLists] = useState<GoogleTaskList[]>([]);
  const [taskListLinks, setTaskListLinks] = useState<TaskListProjectLink[]>([]);
  const [habitWorkspace, setHabitWorkspace] = useState<HabitWorkspace>(() => normalizeHabitWorkspace(EMPTY_HABIT_WORKSPACE));
  const [habitFeedback, setHabitFeedback] = useState<HabitFeedbackEvent | null>(null);
  const [habitNotificationPermissionState, setHabitNotificationPermissionState] = useState<HabitNotificationPermission>("unsupported");
  const [hydrated, setHydrated] = useState(false);
  const [authResolved, setAuthResolved] = useState(!isGoogleSyncConfigured);
  const [cloudUser, setCloudUser] = useState<GenesisUser | null>(null);
  const voiceLanguageEnabled = hydrated && featureAllowed(cloudUser?.featureAccess,'assistant') && (language === "ru" || language === "en");
  const physisAccess = usePhysisAccess(cloudUser?.uid ?? "");
  const physisAvailable = physisAccess.available && cloudUser?.featureAccess?.lifetimePremium === true;
  const [physisSettingsRequest, setPhysisSettingsRequest] = useState(0);
  const personalTaskDisplay=usePersonalTaskDisplay(cloudUser?.uid??"local");
  const [sharedCalendarCounts, setSharedCalendarCounts] = useState<Record<string,number>>({});
  const [calendarTaskListDate, setCalendarTaskListDate] = useState("");
  const [calendarCompletionBusy, setCalendarCompletionBusy] = useState("");
  const [locatedPersonalTaskId, setLocatedPersonalTaskId] = useState("");
  const [springYearSuggestionDismissed, setSpringYearSuggestionDismissed] = useState(false);
  const [springYearSuggestionBusy, setSpringYearSuggestionBusy] = useState(false);
  const [springYearSuggestionError, setSpringYearSuggestionError] = useState(false);
  const [themeState, setThemeState] = useState<ThemeControllerState>({
    accountId: null,
    theme: GENESIS_THEME.STANDART,
    savedTheme: GENESIS_THEME.STANDART,
    status: "signed-out",
    pending: false,
    available: WEB_THEME_AVAILABLE,
    error: null,
  });
  const [accountOpen, setAccountOpen] = useState(false);
  const [iosInstallOpen, setIosInstallOpen] = useState(false);
  const [accountGuideUserId, setAccountGuideUserId] = useState<string | null>(null);
  const [accountSolarPlaceUserId, setAccountSolarPlaceUserId] = useState<string | null>(null);
  const acknowledgeCalendarExploration = useCallback((userId: string) => {
    setCloudUser(current => current?.uid === userId ? { ...current, calendarExplorationPending: false } : current);
  }, []);
  const [projectsArea, setProjectsAreaState] = useState<"personal" | "shared">("personal");
  const setProjectsArea = (area: "personal" | "shared") => {
    setProjectsAreaState(area);
    if (cloudUser?.uid) saveAffairsArea(cloudUser.uid, area);
    if (window.location.hash !== "#projects") return;
    let url = new URL(window.location.href);
    if (area === "shared") url = sharedPlaceUrl(url, savedSharedPlace(cloudUser?.uid || ""));
    else { url.searchParams.set("affairs", "personal"); for (const key of ["space", "project", "task", "projectView"]) url.searchParams.delete(key); }
    if (url.href !== window.location.href) window.history.pushState({ ...window.history.state, genesisView: "projects" }, "", url.pathname + url.search + url.hash);
  };
  useEffect(() => {
    if (!cloudUser?.uid) return;
    const restore = () => {
      const parameter = new URL(window.location.href).searchParams.get("affairs");
      const area = parameter === "personal" || parameter === "shared" ? parameter : storedAffairsArea(cloudUser.uid);
      setProjectsAreaState(area); saveAffairsArea(cloudUser.uid, area);
    };
    const timer = window.setTimeout(restore, 0); window.addEventListener("popstate", restore);
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate", restore); };
  }, [cloudUser?.uid]);
  const [invitationDestination, setInvitationDestination] = useState<(SharedInvitationDestination & {userId:string; request:number}) | null>(null);
  useEffect(() => {
    document.documentElement.dataset.genesisMenuLabels = "text";
    try {
      window.localStorage.setItem("genesis-menu-labels", "text");
      window.localStorage.setItem("genesis-settings-menu-labels", "text");
    } catch { /* Labels stay visible when browser storage is unavailable. */ }
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("account_link") !== "1") return;
    const frame = window.requestAnimationFrame(() => setAccountOpen(true));
    url.searchParams.delete("account_link");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const [accountIdentityExpanded, setAccountIdentityExpanded] = useState(false);
  const [yandexConnectPromptUserId, setYandexConnectPromptUserId] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [taskComposer, setTaskComposer] = useState<"today" | "projects" | null>(null);
  const [composerTab, setComposerTab] = useState<EntryType | "lists">("task");
  const [newEntryType, setNewEntryType] = useState<EntryType>("task");
  const [completedProjectsOpen, setCompletedProjectsOpen] = useState(false);
  const [mindmapsOpen, setMindmapsOpen] = useState(() => personalMindmapsEnabled && typeof window !== "undefined" && new URL(window.location.href).searchParams.has("mindmap"));
  const [diaryOpen, setDiaryOpen] = useState(() => typeof window !== "undefined" && new URL(window.location.href).searchParams.has("diary"));
  useEffect(() => {
    const restore = () => setDiaryOpen(new URL(window.location.href).searchParams.has("diary"));
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  const [mindmapsProjectId, setMindmapsProjectId] = useState<string | null>(null);
  const [mindmapConversion, setMindmapConversion] = useState<MindmapTaskRequest | null>(null);
  const mindmapConversionBusy = useRef(false);
  const mindmapsReturnScroll = useRef(0);
  const [completingProjectIds, setCompletingProjectIds] = useState<string[]>([]);
  const [projectToComplete, setProjectToComplete] = useState<GenesisProject | null>(null);
  const { notice, announce } = useActionNotice();
  useEffect(() => {
    if (!completingProjectIds.length) return;
    const timer = window.setTimeout(() => setCompletingProjectIds([]), 650);
    return () => window.clearTimeout(timer);
  }, [completingProjectIds]);
  const [voiceAssistantOpen, setVoiceAssistantOpen] = useState(false);
  const [voiceControlActive, setVoiceControlActive] = useState(false);
  const [voiceHabitRequest, setVoiceHabitRequest] = useState<{ token: number; kind: "create" | "edit" | "delete" | "section" | "sacred-practice"; id?: string; section?: string } | null>(null);
  const [habitReminderFocus, setHabitReminderFocus] = useState<(HabitReminderTarget & {token:number}) | null>(null);
  const [habitHistoryRequest,setHabitHistoryRequest]=useState<{date:string;habitId?:string;token:number}|null>(null);
  const [voiceLaunchAnimating, setVoiceLaunchAnimating] = useState(false);
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<{ available: boolean; provider: AssistantProvider; audioAvailable: boolean }>({
    available: false,
    provider: "local",
    audioAvailable: false,
  });
  const [legalPage] = useState<ReturnType<typeof currentLegalPage>>(() => currentLegalPage());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [syncError, setSyncError] = useState("");
  const [workspaceRecoveryKey, setWorkspaceRecoveryKey] = useState<string | null>(null);
  const [notificationHeaderTarget, setNotificationHeaderTarget] = useState<HTMLDivElement | null>(null);
  const loadLocalWorkspace = (key: string) => {
    try { return readStoredState(key); }
    catch { setWorkspaceRecoveryKey(key); return null; }
  };
  const [authError, setAuthError] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskFormCalendar, setTaskFormCalendar] = useState<CalendarMode | null>(null);
  const [taskScope, setTaskScope] = useState<"personal" | "shared">("personal");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskUndated, setTaskUndated] = useState(false);
  const [taskEndDate, setTaskEndDate] = useState("");
  const [taskTime, setTaskTime] = useState("");
  const [taskProject, setTaskProject] = useState("");
  const [taskTaskListId, setTaskTaskListId] = useState("");
  const [taskNewListTitle, setTaskNewListTitle] = useState("");
  const [taskNewListAccountId, setTaskNewListAccountId] = useState("");
  const [taskTags, setTaskTags] = useState("");
  const [taskReminders, setTaskReminders] = useState<TaskReminder[]>([{ kind: "relative", minutes: 30 }]);
  const [yandexEntryType, setYandexEntryType] = useState<"task" | "meeting">("task");
  const [yandexEndTime, setYandexEndTime] = useState("");
  const [yandexLocation, setYandexLocation] = useState("");
  const [yandexTelemostUrl, setYandexTelemostUrl] = useState("");
  const [yandexAttendees, setYandexAttendees] = useState("");
  const [yandexOptionalAttendees, setYandexOptionalAttendees] = useState("");
  const [yandexBusy, setYandexBusy] = useState(true);
  const [yandexVisibility, setYandexVisibility] = useState<"private" | "public">("private");
  const [yandexReminders, setYandexReminders] = useState<number[]>([]);
  const [taskRecurrenceConfig, setTaskRecurrenceConfig] = useState<RecurrenceConfig>(DEFAULT_RECURRENCE_CONFIG);
  const [taskDependsOn, setTaskDependsOn] = useState<string[]>([]);
  const [taskPriority, setTaskPriority] = useState("5");
  const [taskSyncAccountIds, setTaskSyncAccountIds] = useState<string[] | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectParent, setNewProjectParent] = useState("");
  const [newProjectCategory, setNewProjectCategory] = useState(DEFAULT_CATEGORIES[0].id);
  const [newProjectTags, setNewProjectTags] = useState("");
  const [newCategoryTitle, setNewCategoryTitle] = useState("");
  const [newTaskListTitle, setNewTaskListTitle] = useState("");
  const [taskListScope, setTaskListScope] = useState<"personal" | "shared">("personal");
  const [newTaskListProject, setNewTaskListProject] = useState("");
  const [newTaskListAccountId, setNewTaskListAccountId] = useState("");
  const [newTaskListDrafts, setNewTaskListDrafts] = useState<TaskListDraft[]>([
    { id: "initial-task-list-draft", title: "", dueDate: "" },
  ]);
  const [taskListBatchTitles, setTaskListBatchTitles] = useState<Record<string, string>>({});
  const [taskListBatchDates, setTaskListBatchDates] = useState<Record<string, string>>({});
  const [taskListDropTargetId, setTaskListDropTargetId] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryTitle, setEditingCategoryTitle] = useState("");
  const [editingCategoryColor, setEditingCategoryColor] = useState("#2d6c68");
  const [tagSearch, setTagSearch] = useState("");
  const [editingProject, setEditingProject] = useState<GenesisProject | null>(null);
  const [editingProjectTags, setEditingProjectTags] = useState("");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [transferTask, setTransferTask] = useState<Task | null>(null);
  const [transferProject, setTransferProject] = useState<GenesisProject | null>(null);
  const [editingTaskTags, setEditingTaskTags] = useState("");
  const [editingTaskScope, setEditingTaskScope] = useState<TaskSeriesScope>("occurrence");
  const [editingOccurrenceDate, setEditingOccurrenceDate] = useState("");
  const [pendingTaskDeletion, setPendingTaskDeletion] = useState<PendingTaskDeletion | null>(null);
  const [personalPreview,setPersonalPreview]=useState<{kind:"task"|"project"|"task-list";id:string;date?:string}|null>(null);
  const [personalListReturn,setPersonalListReturn]=useState<{id:string;userId:string}|null>(null);
  const [editingTaskList, setEditingTaskList] = useState<GoogleTaskList | null>(null);
  const [workspaceRecoveryRequest, setWorkspaceRecoveryRequest] = useState<WorkspaceRecoveryRequest | null>(null);
  const [projectDragItem, setProjectDragItem] = useState<ProjectDragItem | null>(null);
  const [projectDropTargetId, setProjectDropTargetId] = useState("");
  const [projectTouchPoint, setProjectTouchPoint] = useState<{ x: number; y: number } | null>(null);
  const [projectMoveAnnouncement, setProjectMoveAnnouncement] = useState("");
  const tasksRef = useRef<Task[]>([]);
  const taskListsRef = useRef<GoogleTaskList[]>([]);
  const projectsRef = useRef<GenesisProject[]>([]);
  const categoriesRef = useRef<GenesisCategory[]>(DEFAULT_CATEGORIES);
  const taskListLinksRef = useRef<TaskListProjectLink[]>([]);
  const habitWorkspaceRef = useRef<HabitWorkspace>(normalizeHabitWorkspace(EMPTY_HABIT_WORKSPACE));
  useEffect(() => {
    if (!cloudUser?.uid) return;
    return registerBackupSource('workspace', { owner:cloudUser.uid, capture:() => ({tasks:tasksRef.current,projects:projectsRef.current,
      categories:categoriesRef.current,taskLists:taskListsRef.current,taskListLinks:taskListLinksRef.current,...habitWorkspaceRef.current}) });
  }, [cloudUser?.uid]);
  const cloudUserRef = useRef<GenesisUser | null>(null);
  const displayCalendarSaveRef = useRef<Promise<void>>(Promise.resolve());
  const displayCalendarRevisionRef = useRef(0);
  const themeControllerRef = useRef<GenesisThemeController | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const projectTouchDragRef = useRef<ProjectTouchDrag | null>(null);
  const projectDragSourceRef = useRef<HTMLElement | null>(null);
  const projectDragPointRef = useRef<{ x: number; y: number } | null>(null);
  const projectAutoScrollFrameRef = useRef<number | null>(null);
  const projectAutoScrollLastFrameRef = useRef<number | null>(null);
  const habitSaveTimerRef = useRef<number | null>(null);
  const habitFeedbackTimerRef = useRef<number | null>(null);
  const workspaceRecoveryResolverRef = useRef<((accepted: boolean) => void) | null>(null);
  const projectPointerDragRef = useRef<{
    item: ProjectDragItem;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressProjectItemClickRef = useRef(false);
  const { nativeAndroidApkUrl, canInstall, install, isStandalone, isIos } = usePwaInstall();
  const dayDetailsDialogRef = useDialogAccessibility<HTMLElement>(() => setDayDetailsOpen(false), dayDetailsOpen);
  const mindmapTaskPanel = useRef(false);
  useEffect(() => {
    const open = mindmapsOpen && Boolean(taskComposer || editingTask);
    // Retained map state cannot acquire dialogs opened in another section.
    if (open && !mindmapTaskPanel.current && view === "projects" && !diaryOpen) {
      // Replace the just-closed node panel: it is the same navigation depth.
      if (history.state?.genesisMindmapTaskPanel) { /* Adopt the map inspector's navigation entry. */ }
      else if (history.state?.mindmapPanel) history.replaceState({ genesisMindmapTaskPanel: true }, "", location.href);
      else history.pushState({ genesisMindmapTaskPanel: true }, "", location.href);
      mindmapTaskPanel.current = true;
    } else if (!open && mindmapTaskPanel.current) {
      mindmapTaskPanel.current = false;
      if (history.state?.genesisMindmapTaskPanel) history.back();
    }
    const close = () => {
      if (mindmapTaskPanel.current && !history.state?.genesisMindmapTaskPanel) {
        mindmapTaskPanel.current = false; setTaskComposer(null); setEditingTask(null);
      }
    };
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [view, diaryOpen, mindmapsOpen, taskComposer, editingTask]);
  const taskComposerDialogRef = useDialogAccessibility<HTMLElement>(() => setTaskComposer(null), Boolean(taskComposer));
  const dayTaskCreatorDialogRef = useDialogAccessibility<HTMLElement>(() => { setDayTaskCreatorOpen(false); setDayDetailsOpen(true); }, dayTaskCreatorOpen);
  const taskEditorDialogRef = useDialogAccessibility<HTMLFormElement>(() => setEditingTask(null), Boolean(editingTask));
  const taskDeleteDialogRef = useDialogAccessibility<HTMLElement>(() => setPendingTaskDeletion(null), Boolean(pendingTaskDeletion));
  const taskListEditorDialogRef = useDialogAccessibility<HTMLFormElement>(() => setEditingTaskList(null), Boolean(editingTaskList));
  const projectEditorDialogRef = useDialogAccessibility<HTMLFormElement>(() => setEditingProject(null), Boolean(editingProject));
  const themeAccountId = cloudUser?.uid ?? null;
  useMoonReminders(themeAccountId, language === "en");
  useDocumentLanguage(language);

  useEffect(() => {
    cloudUserRef.current = cloudUser;
  }, [cloudUser]);

  useEffect(() => {
    const closePrivateWorkspace = () => {
      cloudUserRef.current = null;
      tasksRef.current = [];
      projectsRef.current = [];
      categoriesRef.current = [];
      taskListsRef.current = [];
      taskListLinksRef.current = [];
      habitWorkspaceRef.current = normalizeHabitWorkspace(null);
      setCloudUser(null);
      setTasks([]);
      setProjects([]);
      setCategories([]);
      setTaskLists([]);
      setTaskListLinks([]);
      setHabitWorkspace(normalizeHabitWorkspace(null));
      setAuthResolved(true);
      setSyncStatus("local");
    };
    window.addEventListener(LOCAL_SESSION_ENDED_EVENT, closePrivateWorkspace);
    return () => window.removeEventListener(LOCAL_SESSION_ENDED_EVENT, closePrivateWorkspace);
  }, []);

  useEffect(() => {
    const controller = createGenesisThemeController({
      root: document.documentElement,
      enabled: WEB_THEME_AVAILABLE,
      adapter: {
        async read({ accountId, signal, fresh }) {
          if (signal.aborted) throw new DOMException("Theme read aborted", "AbortError");
          const user = fresh ? await loadGenesisSession(signal) : cloudUserRef.current;
          if (!user || user.uid !== accountId) throw new Error("Theme account session changed");
          if (fresh) {
            setCloudUser(user);
            if (!privateDeviceAccessBlocked()) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
          }
          return {
            theme: normalizeWebTheme(user.theme),
            revision: Math.max(0, Number(user.themeRevision ?? 0)),
          };
        },
        async write({ accountId, theme, expectedRevision, signal }) {
          const result = await updateAccountPreferences({
            theme,
            expectedThemeRevision: Math.max(0, Number(expectedRevision ?? 0)),
          }, signal);
          if (signal.aborted) throw new DOMException("Theme write aborted", "AbortError");
          if (cloudUserRef.current?.uid === accountId) {
            setCloudUser(result.user);
            if (!privateDeviceAccessBlocked()) localStorage.setItem(LAST_USER_KEY, JSON.stringify(result.user));
          }
          return {
            theme: normalizeWebTheme(result.user.theme),
            revision: Math.max(0, Number(result.user.themeRevision ?? 0)),
          };
        },
      },
    });
    themeControllerRef.current = controller;
    const unsubscribe = controller.subscribe(setThemeState);
    return () => {
      unsubscribe();
      controller.destroy();
      themeControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = themeControllerRef.current;
    if (!controller) return;
    const currentUser = cloudUserRef.current;
    if (!themeAccountId || !currentUser || currentUser.uid !== themeAccountId) {
      void controller.bindAccount(null);
      return;
    }
    void controller.bindAccount(themeAccountId, {
      verifiedInitialPreference: {
        accountId: themeAccountId,
        theme: normalizeWebTheme(currentUser.theme),
      },
    });
  }, [themeAccountId]);

  const darkPalette = effectiveDarkPalette(cloudUser?.darkPalette, cloudUser?.featureAccess);
  useEffect(() => {
    document.documentElement.setAttribute("data-genesis-palette", darkPalette);
    return () => document.documentElement.removeAttribute("data-genesis-palette");
  }, [darkPalette]);

  const changeGenesisTheme = useCallback((theme: GenesisTheme) => {
    themeControllerRef.current?.setTheme(normalizeWebTheme(theme));
  }, []);

  // The former Experimental composition is now the only STANDART interface.
  const experimentalThemeActive = true;
  const [experimentalProjectFormOpen, setExperimentalProjectFormOpen] = useState(false);
  const [expandedExperimentalProjects, setExpandedExperimentalProjects] = useState<string[]>([]);
  useEffect(() => {
    if (!projectDragItem || !projectDropTargetId || projectDropTargetId === TASK_INBOX_PROJECT_ID) return;
    const timer = window.setTimeout(() => {
      setExpandedExperimentalProjects((ids) => ids.includes(projectDropTargetId) ? ids : [...ids, projectDropTargetId]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [projectDragItem, projectDropTargetId]);
  const newProjectDialogRef = useDialogAccessibility<HTMLFormElement>(() => setExperimentalProjectFormOpen(false), experimentalProjectFormOpen);

  useEffect(() => {
    const retryThemeSave = () => themeControllerRef.current?.retry();
    window.addEventListener("online", retryThemeSave);
    return () => window.removeEventListener("online", retryThemeSave);
  }, []);

  useEffect(() => {
    if (themeState.status !== "error" || themeState.theme === themeState.savedTheme) return undefined;
    const timer = window.setInterval(() => themeControllerRef.current?.retry(), 30_000);
    return () => window.clearInterval(timer);
  }, [themeState.savedTheme, themeState.status, themeState.theme]);

  useEffect(() => {
    if (syncStatus !== "syncing") return undefined;
    const timer = window.setTimeout(() => {
      setSyncError((current) => current || "Google-синхронизация занимает слишком много времени. Локальные данные доступны, повторная попытка выполнится автоматически.");
      setSyncStatus(navigator.onLine ? "error" : "offline");
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [syncStatus]);

  const finishWorkspaceRecovery = useCallback((accepted: boolean) => {
    const resolve = workspaceRecoveryResolverRef.current;
    workspaceRecoveryResolverRef.current = null;
    setWorkspaceRecoveryRequest(null);
    resolve?.(accepted);
  }, []);
  const confirmWorkspaceRecovery = useCallback(() => finishWorkspaceRecovery(true), [finishWorkspaceRecovery]);
  const cancelWorkspaceRecovery = useCallback(() => finishWorkspaceRecovery(false), [finishWorkspaceRecovery]);

  useEffect(() => registerWorkspaceRecoveryRequestHandler((request) => new Promise<boolean>((resolve) => {
    workspaceRecoveryResolverRef.current?.(false);
    workspaceRecoveryResolverRef.current = resolve;
    setWorkspaceRecoveryRequest(request);
  })), []);

  useEffect(() => () => {
    workspaceRecoveryResolverRef.current?.(false);
    workspaceRecoveryResolverRef.current = null;
    if (habitFeedbackTimerRef.current !== null) window.clearTimeout(habitFeedbackTimerRef.current);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setAuthError(consumeGoogleAuthError()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (voiceLanguageEnabled) return;
    const timer = window.setTimeout(() => {
      setVoiceLaunchAnimating(false);
      setVoiceAssistantOpen(false);
      setGeminiOpen(false);
      setVoiceControlActive(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [voiceLanguageEnabled]);

  useEffect(() => {
    if (!voiceLaunchAnimating) return;
    const timer = window.setTimeout(() => {
      setVoiceLaunchAnimating(false);
      if (assistantStatus.audioAvailable) setGeminiOpen(true);
      else setVoiceAssistantOpen(true);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [assistantStatus.audioAvailable, voiceLaunchAnimating]);

  const openVoiceAssistant = () => {
    if (!voiceLanguageEnabled) return;
    setVoiceControlActive(false);
    if (voiceLaunchAnimating) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (assistantStatus.audioAvailable) setGeminiOpen(true);
      else setVoiceAssistantOpen(true);
      return;
    }
    setVoiceLaunchAnimating(true);
  };

  const deviceTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const solarTimeZone = deviceLocation?.timeZone ?? deviceTimeZone;
  const seasonLocation = deviceLocation ?? getTimezoneFallbackLocation(deviceTimeZone);
  const displaySolarTime = (date: Date) =>
    `${solarLocationSource === "selected-city" ? "" : "≈"}${formatDeviceSolarTime(date, solarTimeZone)}`;

  useEffect(() => {
    const controller = new AbortController();

    const synchronizeSolarLocation = async () => {
      document.documentElement.dataset.genesisSolarTimes = readSolarTimesVisible() ? "visible" : "hidden";
      const saved = readSolarPlace();
      if (saved) {
        setDeviceLocation(saved);
        setSolarLocationSource("selected-city");
        setSolarLocationStatus("ready");
        return;
      }
      const location = await getAutomaticSolarLocation(deviceTimeZone, controller.signal);
      if (controller.signal.aborted || readSolarPlace()) return;
      setDeviceLocation(location);
      setSolarLocationSource(location.source);
      setSolarLocationStatus("ready");
    };

    void synchronizeSolarLocation();
    window.addEventListener(SOLAR_PLACE_CHANGED, synchronizeSolarLocation);
    return () => {
      controller.abort();
      window.removeEventListener(SOLAR_PLACE_CHANGED, synchronizeSolarLocation);
    };
  }, [deviceTimeZone]);

  useEffect(() => {
    const preventDragScroll = (event: Event) => {
      if (projectTouchDragRef.current?.active && event.cancelable) event.preventDefault();
    };
    document.addEventListener("touchmove", preventDragScroll, { passive: false, capture: true });
    return () => {
      document.removeEventListener("touchmove", preventDragScroll, true);
      const drag = projectTouchDragRef.current;
      if (drag) window.clearTimeout(drag.timer);
      if (projectAutoScrollFrameRef.current !== null) window.cancelAnimationFrame(projectAutoScrollFrameRef.current);
      projectDragPointRef.current = null;
      projectAutoScrollLastFrameRef.current = null;
      document.documentElement.classList.remove("project-drag-active");
    };
  }, []);

  useEffect(() => {
    const updateDeviceDate = () => setToday(new Date());
    const interval = window.setInterval(updateDeviceDate, 60_000);
    window.addEventListener("focus", updateDeviceDate);
    document.addEventListener("visibilitychange", updateDeviceDate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateDeviceDate);
      document.removeEventListener("visibilitychange", updateDeviceDate);
    };
  }, []);

  const todayInfo = useMemo(() => getSacredDate(today), [today]);
  const storedVisibility = useMemo(() => uiVisibility(cloudUser?.uiVisibility), [cloudUser?.uiVisibility]);
  const sacredFeaturesEnabled = storedVisibility.sacredFeaturesEnabled;
  const visibility = { ...storedVisibility, enabledCalendars: visibleCalendarModes(storedVisibility),
    hiddenMenuItems: sacredFeaturesEnabled ? storedVisibility.hiddenMenuItems : [...storedVisibility.hiddenMenuItems,"sacred"] };
  const activeCalendarMode = useMemo(() => visibleCalendarMode(cloudUser?.calendarMode ?? "sacred", storedVisibility), [cloudUser?.calendarMode, storedVisibility]);
  const activeTaskCalendarMode = useMemo(() => visibleCalendarMode(cloudUser?.taskCalendarMode ?? "sacred", storedVisibility), [cloudUser?.taskCalendarMode, storedVisibility]);
  const taskFormCalendarMode = visibleCalendarMode(taskFormCalendar ?? activeTaskCalendarMode, storedVisibility);
  const editTaskCalendarMode = editingTask?.calendarMode ?? activeTaskCalendarMode;
  const applyLayoutUser = useCallback((user: GenesisUser) => {
    setCloudUser(current => current?.uid === user.uid ? user : current);
    try {
      const cached = JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null") as GenesisUser | null;
      if (cached?.uid === user.uid && !privateDeviceAccessBlocked()) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    } catch { /* Server preferences remain saved when device storage is unavailable. */ }
  }, []);
  const { layout: accountLayout, save: saveLayout, error: layoutError } = useAccountLayout(cloudUser, applyLayoutUser);
  const todayOrderOwner = cloudUser?.uid ?? 'guest';
  const [todayOrderEditor, setTodayOrderEditor] = useState({owner: todayOrderOwner, view, open: false});
  if (todayOrderEditor.owner !== todayOrderOwner || todayOrderEditor.view !== view) {
    setTodayOrderEditor({owner: todayOrderOwner, view, open: false});
  }
  const [guestTodayOrder, setGuestTodayOrder] = useState<TodayBlockId[]>(() => readTodayBlockOrder(availableTodayBlockStorage(typeof window === 'undefined' ? null : window), 'guest'));
  const todayOrder = effectiveTodayBlockOrder(cloudUser ? accountLayout.todayBlockOrder : guestTodayOrder);
  const [guestTodayHalves, setGuestTodayHalves] = useState<TodayBlockId[]>(() => readTodayHalfBlocks(availableTodayBlockStorage(typeof window === 'undefined' ? null : window), 'guest'));
  const todayHalves = cloudUser ? accountLayout.todayHalfBlocks : guestTodayHalves;
  const [guestTodayHidden, setGuestTodayHidden] = useState<TodayBlockId[]>(() => {
    try { const value = JSON.parse(availableTodayBlockStorage(typeof window === 'undefined' ? null : window)?.getItem('genesis-today-hidden:v1:guest') ?? '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
  });
  const todayHidden = cloudUser ? [...storedVisibility.hiddenTodayBlocks, ...accountLayout.webHiddenTodayBlocks] : guestTodayHidden;
  const saveTodayOrder = async (order: TodayBlockId[], failureMessage: string, halfBlocks: TodayBlockId[], hidden: TodayBlockId[]) => {
    if (cloudUser) {
      const guard = captureAccountSessionGuard();
      const current = uiVisibility(cloudUserRef.current?.uiVisibility);
      const common = ['rhythm', 'tasks', 'habits', 'details'];
      const hiddenTodayBlocks = [...current.hiddenTodayBlocks.filter(id => !common.includes(id)), ...hidden.filter(id => common.includes(id))];
      const webHiddenTodayBlocks = hidden.filter(id => ['advice', 'dream', 'ads', 'events'].includes(id));
      guard();
      const result = await updateAccountPreferences({
        uiVisibility: { sacredFeaturesEnabled: current.sacredFeaturesEnabled, dreamJournalEnabled: current.dreamJournalEnabled,
          hiddenMenuItems: current.hiddenMenuItems, hiddenSubmenus: current.hiddenSubmenus, hiddenTodayBlocks,
          enabledCalendars: current.enabledCalendars, sidebarAutoCollapseSeconds: current.sidebarAutoCollapseSeconds },
        uiLayout: { todayBlockOrder: order, todayHalfBlocks: halfBlocks, webHiddenTodayBlocks },
      });
      guard();
      const saved = uiVisibility(result.user.uiVisibility);
      if (hiddenTodayBlocks.some(id => !saved.hiddenTodayBlocks.includes(id)) || saved.hiddenTodayBlocks.some(id => !hiddenTodayBlocks.includes(id))
        || webHiddenTodayBlocks.some(id => !saved.webHiddenTodayBlocks.includes(id)) || saved.webHiddenTodayBlocks.some(id => !webHiddenTodayBlocks.includes(id))
        || JSON.stringify(saved.todayBlockOrder) !== JSON.stringify(order) || JSON.stringify(saved.todayHalfBlocks) !== JSON.stringify(halfBlocks)) throw new Error(failureMessage);
      applyLayoutUser(result.user);
    }
    else {
      const storage = availableTodayBlockStorage(window);
      const savedOrder = storeTodayBlockOrder(storage, 'guest', order), savedHalves = storeTodayHalfBlocks(storage, 'guest', halfBlocks);
      try { if (!storage) throw new Error(failureMessage); storage.setItem('genesis-today-hidden:v1:guest', JSON.stringify(hidden)); }
      catch { throw new Error(failureMessage); }
      if (!savedOrder || !savedHalves) throw new Error(failureMessage);
      setGuestTodayOrder([...order]); setGuestTodayHalves([...halfBlocks]); setGuestTodayHidden([...hidden]);
    }
  };
  const saveSidebarWidth = useCallback((sidebarWidth: number) => saveLayout({ sidebarWidth }), [saveLayout]);
  const { width: sidebarWidth, collapsed: sidebarCollapsed, resizing: sidebarResizing, sidebarRef, resizeProps,
    autoHide: sidebarAutoHide, hidden: sidebarHidden, revealRef: sidebarRevealRef, revealProps: sidebarRevealProps } = useSidebarCollapse(accountLayout.sidebarWidth, visibility.sidebarAutoCollapseSeconds, saveSidebarWidth);
  const personalProjectsVisible = !visibility.hiddenSubmenus.includes("projects.personal");
  const invitedWorkspaceOpen = Boolean(invitationDestination && cloudUser && view==="projects" && projectsArea==="shared" && invitationDestination.userId===cloudUser.uid);
  // Existing shared data remains readable after expiry; creating/changing it still needs paid access.
  const sharedProjectsReadable = Boolean(cloudUser?.sharedProjectsEnabled);
  const sharedProjectsAvailable = featureAllowed(cloudUser?.featureAccess,'shared-projects') && sharedProjectsReadable;
  const sharedProjectsVisible = sharedProjectsReadable && (!visibility.hiddenSubmenus.includes("projects.shared") || invitedWorkspaceOpen);
  const activeProjectsArea = projectsArea === "shared" && sharedProjectsVisible ? "shared"
    : projectsArea === "personal" && personalProjectsVisible ? "personal"
      : personalProjectsVisible ? "personal" : "shared";
  const activeTimeFormat = normalizeTimeFormat(cloudUser?.timeFormat);
  useEffect(() => {
    if (!cloudUser?.uid) return;
    const features = view === "today" ? ["menu.today"]
      : view === "projects" ? ["menu.projects", `submenu.projects.${activeProjectsArea}`]
          : view === "calendar" || view === "year"
            ? ["menu.calendar", `submenu.calendar.${view === "year" ? "year" : "month"}`,
              `calendar.${activeCalendarMode}`]
            : view === "habits" ? ["menu.habits", "submenu.habits.habits"]
              : view === "stoicheion" || view === "theokyklos"
                ? ["menu.sacred", `submenu.sacred.${view}`] : [];
    if (features.length) void recordFeatureUsage(features).catch(() => undefined);
  }, [cloudUser?.uid, view, activeProjectsArea, activeCalendarMode]);
  const activeWeekStart = cloudUser?.weekStart === "monday" ? "monday" : "sunday";
  const gregorianYearStartsInMarch = cloudUser?.gregorianYearStart === "march";
  const googleAccounts = cloudUser?.googleAccounts ?? [];
  const taskRoutingAccounts = cloudUser?.authProvider === "google"
    ? googleAccounts : cloudUser?.linkedAccounts ?? [];
  const defaultSyncAccountIds = cloudUser?.syncRouting?.defaultAccountIds?.length
    ? cloudUser.syncRouting.defaultAccountIds
    : cloudUser ? [cloudUser.uid] : [];
  const effectiveTaskSyncAccountIds = taskSyncAccountIds ?? defaultSyncAccountIds;
  const syncAccountIdsForTask = (categoryId: string | null, taskList?: GoogleTaskList) => {
    if (taskList?.accountId) return [taskList.accountId];
    if (cloudUser?.syncRouting?.mode === "category" && categoryId) {
      const mapped = cloudUser.syncRouting.categoryAccountIds[categoryId] ?? [];
      if (mapped.length) return mapped;
    }
    return cloudUser?.syncRouting?.mode === "choose" ? effectiveTaskSyncAccountIds : defaultSyncAccountIds;
  };
  const selectedDate = useMemo(
    () => getGregorianDate(sacredYear, monthIndex, selectedDay),
    [sacredYear, monthIndex, selectedDay],
  );
  const selectedLunarYear = useMemo(() => getLunarYearForDate(selectedDate), [selectedDate]);
  const selectedLunarMonthIndex = lunarMonthIndex(selectedDate);
  const selectedLunarMonthOrdinal = selectedLunarMonthIndex - selectedLunarYear.startMonthIndex + 1;
  const todayDateValue = inputDate(today);
  const overdueDeadline = (task: Task, occurrence?: string) => {
    if (occurrence) return occurrence;
    const repeating = !task.googleTaskListId && !task.recurrenceSeriesId &&
      ((task.recurrenceMode && task.recurrenceMode !== "none") || (task.recurrence && task.recurrence !== "none"));
    return repeating ? recurrenceDatesForTask(task).at(-1) ?? "" : task.endDate || task.dueDate;
  };
  const renderOverdueBadge = (task: Task, occurrence?: string) => isTaskOverdue(task, today, overdueDeadline(task, occurrence))
    ? <span className="task-overdue-badge" data-no-translate>{translateText("Просрочено")}</span> : null;
  const selectedDateValue = inputDate(selectedDate);
  const selectedGregorianYear = selectedDate.getFullYear();
  const monthPreviewFrom = inputDate(new Date(selectedGregorianYear, selectedDate.getMonth(), 1, 12));
  const monthPreviewTo = inputDate(new Date(selectedGregorianYear, selectedDate.getMonth() + 1, 0, 12));
  const sharedMonthPreview = useCalendarTaskPreviews(cloudUser?.uid, monthPreviewFrom, monthPreviewTo,
    sharedProjectsReadable && view === "calendar" && activeCalendarMode === "profane" && !sacredFeaturesEnabled);
  const sharedMonthTasksByDate = useMemo(() => {
    const dates = new Map<string, SharedCalendarTask[]>();
    for (const task of sharedMonthPreview?.tasks ?? []) dates.set(task.dueDate, [...(dates.get(task.dueDate) ?? []), task]);
    return dates;
  }, [sharedMonthPreview]);
  useEffect(() => {
    if (!sharedProjectsReadable) {
      const timer = window.setTimeout(() => setSharedCalendarCounts({}), 0);
      return () => window.clearTimeout(timer);
    }
    let live = true;
    const controller = new AbortController();
    const year = selectedGregorianYear;
    const from = `${year - 1}-01-01`;
    const to = `${year + 1}-12-31`;
    const refresh = () => { void listSharedCalendarTasks(from, to, null, controller.signal).then((result) => {
      if (live) setSharedCalendarCounts(result.dateCounts);
    }).catch(() => { if(live) setSharedCalendarCounts({}); }); };
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30000);
    window.addEventListener("genesis:shared-updates", refresh);
    return () => { live = false; controller.abort(); window.clearInterval(timer); window.removeEventListener("genesis:shared-updates", refresh); };
  }, [cloudUser?.uid, sharedProjectsReadable, selectedGregorianYear]);
  const sharedDayPage = useSharedTaskPage(sharedProjectsReadable && dayDetailsOpen ? {dueFrom:selectedDateValue,dueTo:selectedDateValue,completion:"open"} : null);
  const sharedDayTasks = sharedDayPage.page?.tasks.map(sharedCalendarProjection) ?? [];
  const sharedTodayPage = useSharedTaskPage(sharedProjectsReadable && view === "today"
    ? {dueFrom:todayDateValue,dueTo:todayDateValue,completion:"any"} : null, "position", undefined, cloudUser?.uid);
  const sharedTodayTasks = sharedTodayPage.page?.tasks.map(sharedCalendarProjection) ?? [];
  const hasSharedTodayTasks = (sharedTodayPage.page?.total ?? 0) > 0;
  const newTaskDueDate = taskUndated ? "" : taskDueDate || (view === "today" || view === "all-tasks" ? todayDateValue : selectedDateValue);
  const newTaskEndDate = taskUndated ? "" : taskEndDate || newTaskDueDate;
  const selectedMonth = MONTHS[monthIndex];
  const selectedSacredDay = getSacredDay(monthIndex, selectedDay);
  const selectedMoon = getMoon(selectedDate);
  const selectedLunarDate = getLunarDate(selectedDate);
  const selectedWeekdayPatron = localizeWeekdayPatron(PROFANE_WEEKDAY_PATRONS[selectedDate.getDay()], language);
  const selectedElement = getDayElement(monthIndex, selectedDay);
  const selectedPythagorean = getPythagorean(monthIndex, selectedDay);
  const selectedSolarEvent = sacredFeaturesEnabled ? getSolarEvent(sacredYear, monthIndex, selectedDay) : null;
  const selectedDisplayMonthName = activeCalendarMode === "sacred"
    ? selectedMonth.name
    : activeCalendarMode === "profane"
      ? profaneMonthName(selectedDate)
      : getLunarMonthDefinition(selectedLunarMonthOrdinal).name;
  const tasksByDate = useMemo(() => {
    const occurrences = new Map<string, Task[]>();
    tasks.forEach((task) => {
      recurrenceDatesForTask(task).forEach((dateValue) => {
        const current = occurrences.get(dateValue);
        if (current) current.push(task);
        else occurrences.set(dateValue, [task]);
      });
    });
    return occurrences;
  }, [tasks]);
  const calendarTasksByDate = useMemo(() => new Map([...tasksByDate].map(([date, dayTasks]) =>
    [date, dayTasks.filter(task => !task.done)])), [tasksByDate]);
  const selectedDayTasks = [...(calendarTasksByDate.get(selectedDateValue) ?? [])]
    .sort((a, b) => a.time.localeCompare(b.time));
  const todayTasks = [...(tasksByDate.get(todayDateValue) ?? [])]
    .sort((left, right) => Number(left.done) - Number(right.done)
      || (left.time || "24:00").localeCompare(right.time || "24:00")
      || right.priority - left.priority);
  useEffect(() => {
    const permissionTimer = window.setTimeout(() => setHabitNotificationPermissionState(habitNotificationPermission()), 0);
    const stopObserving = observeHabitNotificationClicks();
    return () => {
      window.clearTimeout(permissionTimer);
      stopObserving();
    };
  }, []);

  useEffect(() => {
    if (!cloudUser?.uid || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    let active = true;
    let stop: (() => void) | undefined;
    void import("./web-task-notifications").then(({ scheduleWebTaskReminders }) => {
      if (active) stop = scheduleWebTaskReminders(tasks, cloudUser.uid, APP_BASE);
    });
    return () => { active = false; stop?.(); };
  }, [tasks, cloudUser?.uid, habitNotificationPermissionState]);
  const selectedSunriseSunset = deviceLocation ? getSunriseSunset(selectedDate, deviceLocation) : null;
  const selectedSunrise = selectedSunriseSunset
    ? displaySolarTime(selectedSunriseSunset.sunrise)
    : solarLocationStatus === "ready" ? "нет" : "…";
  const selectedSunset = selectedSunriseSunset
    ? displaySolarTime(selectedSunriseSunset.sunset)
    : solarLocationStatus === "ready" ? "нет" : "…";
  const solarEvents = useMemo(() => getSolarEvents(sacredYear), [sacredYear]);
  const todayKey = taskDateKey(
    todayInfo.sacredYear,
    todayInfo.monthIndex,
    todayInfo.day,
  );
  const linkedProjectId = (taskListId: string | null) => (
    taskListId ? taskListLinks.find((link) => link.taskListId === taskListId)?.projectId ?? null : null
  );
  const taskListsForWorkspace = taskLists.filter((taskList) => (
    !taskList.isDefault && (taskList.accountId == null || taskList.title !== "Привычки GENESIS")
  ));
  const resolvedTaskProjectId = (task: Task) => (
    task.projectId === TASK_INBOX_PROJECT_ID ? null : task.projectId ?? linkedProjectId(task.googleTaskListId)
  );
  const resolvedTaskProject = (task: Task) => {
    const projectId = resolvedTaskProjectId(task);
    return projects.find((project) => project.id === projectId) ?? null;
  };
  const resolvedTaskProjectTitle = (task: Task) => resolvedTaskProject(task)?.title ?? task.project;

  const selectCalendarDate = (date: Date) => {
    if (date.getFullYear() < 1900 || date.getFullYear() > 2100) return;
    const sacred = getSacredDate(date);
    setSacredYear(sacred.sacredYear);
    setMonthIndex(sacred.monthIndex);
    setSelectedDay(sacred.day);
    setOpenDayTaskPopover("");
  };

  const openCalendarDate = (date: Date, origin: DayDetailsOrigin) => {
    selectCalendarDate(date);
    setDayDetailsOrigin(origin === "year" ? "calendar" : origin);
    setDayDetailsOpen(origin !== "year");
    if (origin === "year") navigateTo("calendar");
  };

  const beginSelectedDayTask = () => {
    setTaskTitle("");
    setTaskDescription("");
    setTaskDueDate(selectedDateValue);
    setTaskEndDate(selectedDateValue);
    setTaskTime("");
    setTaskProject(""); setTaskTaskListId(""); setTaskUndated(false);
    setTaskTags("");
    setTaskDependsOn([]);
    setTaskPriority("5");
    setTaskSyncAccountIds(null);
    setTaskRecurrenceConfig(alignRecurrenceConfigWithCalendar(DEFAULT_RECURRENCE_CONFIG, activeTaskCalendarMode, selectedDateValue));
    setDayDetailsOpen(false);
    setTaskFormCalendar(activeTaskCalendarMode);
    setDayTaskCreatorOpen(true);
  };

  const closeSelectedDayTaskCreator = () => {
    setDayTaskCreatorOpen(false);
    setDayDetailsOpen(true);
  };

  const navigateTo = (nextView: ViewName, replace = false, sharedDestination?: SharedTaskDestination, revealInvitedWorkspace = false) => {
    if (nextView === "all-tasks") nextView = "projects";
    if (!viewIsVisible(nextView, visibility) && !revealInvitedWorkspace) nextView = "today";
    setOpenDayTaskPopover("");
    setAccountMenuOpen(false);
    if (nextView !== "theokyklos") setRequestedTheokyklosSector(null);
    setView(nextView);
    let nextUrl = new URL(window.location.href);
    if (nextView === "projects") {
      if (sharedDestination || (cloudUser?.uid ? storedAffairsArea(cloudUser.uid) : projectsArea) === "shared") {
        const place = sharedDestination ? { ...sharedDestination, taskId: sharedDestination.taskId || "", view: null }
          : nextUrl.hash === "#projects" && nextUrl.searchParams.get("affairs") === "shared" ? null : savedSharedPlace(cloudUser?.uid || "");
        if (place) nextUrl = sharedPlaceUrl(nextUrl, place);
        else nextUrl.searchParams.set("affairs", "shared");
      } else nextUrl.searchParams.set("affairs", "personal");
    } else {
      setDiaryOpen(false);
      for (const key of ["affairs", "space", "project", "task", "projectView", "taskAction", "comment", "diary"]) nextUrl.searchParams.delete(key);
    }
    nextUrl.hash = nextView;
    const cleanUrl = cleanGenesisAppUrl(nextUrl);
    const state = { ...(window.history.state ?? {}), genesisView: nextView };
    if (replace || view === nextView && !sharedDestination) {
      window.history.replaceState(state, "", cleanUrl);
    } else {
      window.history.pushState(state, "", cleanUrl);
    }
    window.dispatchEvent(new Event("genesis:route"));
    if (sharedDestination) window.dispatchEvent(new Event("genesis:shared-route"));
    window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.querySelector<HTMLElement>(".app-stage")?.scrollTo(0, 0);
      document.querySelector<HTMLElement>(".workspace")?.scrollTo(0, 0);
    });
  };

  const openTheokyklosSector = (sectorId: SacredPracticeSectorId) => {
    setRequestedTheokyklosSector(sectorId);
    navigateTo("theokyklos");
  };

  const openSharedCalendarTask = (task: SharedCalendarTask) => {
    setDayDetailsOpen(false);
    setProjectsArea("shared");
    navigateTo("projects", false, { spaceId: task.spaceId, projectId: task.projectId, taskId: task.id, taskAction: "locate" });
  };
  const openSharedCalendarTaskDetails = (task: SharedCalendarTask) => {
    setCalendarTaskListDate(""); setDayDetailsOpen(false); setProjectsArea("shared");
    navigateTo("projects", false, {spaceId:task.spaceId, projectId:task.projectId, taskId:task.id});
  };
  const openPersonalCalendarTaskDetails = (task: Task, date: string) => {
    setCalendarTaskListDate(""); setPersonalPreview({kind:"task", id:task.id, date});
  };
  const openPersonalCalendarTask = (task: Task) => {
    setDayDetailsOpen(false); setProjectsArea("personal"); setTagSearch("");
    const project = resolvedTaskProject(task);
    const ancestors: string[] = []; let parent = project; let completed = false;
    while(parent && !ancestors.includes(parent.id)){ancestors.push(parent.id);completed ||= parent.status !== "active"; parent = projects.find(item => item.id === parent?.parentId) ?? null;}
    setCompletedProjectsOpen(completed);
    if (project) { setTaskProject(project.id); setExpandedExperimentalProjects(ids => [...new Set([...ids, ...ancestors])]); }
    setLocatedPersonalTaskId(task.id); navigateTo("projects");
  };
  useEffect(() => {
    if (!locatedPersonalTaskId || view !== "projects" || activeProjectsArea !== "personal") return;
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>("[data-personal-task-id]")).find(item => item.dataset.personalTaskId === locatedPersonalTaskId);
      row?.scrollIntoView({ block: "center", behavior: "auto" }); row?.querySelector<HTMLButtonElement>(".task-check")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [locatedPersonalTaskId, view, activeProjectsArea]);
  const completeSharedCalendarTask = async (task: SharedCalendarTask) => {
    if (calendarCompletionBusy) return;
    setCalendarCompletionBusy(task.id);
    try {
      const {completeCalendarSharedTask} = await import("./calendar-shared-completion");
      if (!await completeCalendarSharedTask(task, cloudUser?.uid, language === "en")) announce(language === "en" ? "Your confirmation is saved. Waiting for the other participants." : "Ваше подтверждение сохранено. Ожидаем остальных участников.");
      window.dispatchEvent(new Event("genesis:shared-updates"));
    } catch (error) { announce(error instanceof Error ? error.message : String(error)); }
    finally { setCalendarCompletionBusy(""); }
  };

  useEffect(() => {
    const initialView = viewFromHash();
    const initialFrame = window.requestAnimationFrame(() => setView(initialView));
    const initialUrl = new URL(window.location.href);
    if (initialView !== "admin") initialUrl.hash = initialView;
    window.history.replaceState(
      { ...(window.history.state ?? {}), genesisView: initialView },
      "",
      cleanGenesisAppUrl(initialUrl),
    );
    const handlePopState = () => {
      setAccountMenuOpen(false);
      setAccountOpen(false);
      setView(viewFromHash());
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);
  useEffect(() => {
    if (!cloudUser || viewIsVisible(view, uiVisibility(cloudUser.uiVisibility)) || invitedWorkspaceOpen) return;
    const frame = window.requestAnimationFrame(() => {
      setView("today");
      const url = new URL(window.location.href);
      url.hash = "today";
      window.history.replaceState({ ...(window.history.state ?? {}), genesisView: "today" }, "", cleanGenesisAppUrl(url));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cloudUser, view, invitedWorkspaceOpen]);

  useEffect(() => {
    if (!accountMenuOpen && !accountIdentityExpanded) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
        setAccountIdentityExpanded(false);
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
        setAccountIdentityExpanded(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [accountMenuOpen, accountIdentityExpanded]);

  useEffect(() => {
    if (!dayDetailsOpen && !dayTaskCreatorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [dayDetailsOpen, dayTaskCreatorOpen]);

  useEffect(() => {
    if (!sacredYearDetailsOpen && !lunarYearDetailsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sacredYearDetailsOpen, lunarYearDetailsOpen]);

  useEffect(() => {
    if (!openDayTaskPopover) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".calendar-day-task-control, .calendar-stable-task-popover")) {
        setOpenDayTaskPopover("");
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenDayTaskPopover("");
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [openDayTaskPopover]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
    const initialState = isGoogleSyncConfigured
      ? { tasks: [], projects: [], categories: DEFAULT_CATEGORIES, taskLists: [], taskListLinks: [], ...normalizeHabitWorkspace(null) }
      : loadLocalWorkspace(GENESIS_LEGACY_WORKSPACE_STORAGE_KEY);
    if (!initialState) return;

      tasksRef.current = initialState.tasks;
      projectsRef.current = initialState.projects;
      categoriesRef.current = initialState.categories;
      setTasks(initialState.tasks);
      setProjects(initialState.projects);
      setCategories(initialState.categories);
      setTaskLists(initialState.taskLists);
      setTaskListLinks(initialState.taskListLinks);
      setHabitWorkspace(normalizeHabitWorkspace(initialState));
      try { setSpringYearSuggestionDismissed(localStorage.getItem("genesis.spring-year-suggestion-dismissed") === "1"); }
      catch { /* The dismiss button still works for this session. */ }
      setNewProjectCategory(initialState.categories[0]?.id ?? "");
      setHydrated(true);
      setSyncStatus(isGoogleSyncConfigured ? "loading" : "setup");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated || workspaceRecoveryKey || privateDeviceAccessBlocked() || (isGoogleSyncConfigured && !cloudUser)) return;
    tasksRef.current = tasks;
    taskListsRef.current = taskLists;
    projectsRef.current = projects;
    categoriesRef.current = categories;
    taskListLinksRef.current = taskListLinks;
    habitWorkspaceRef.current = habitWorkspace;
    const key = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    try { writeProtectedWorkspace(localStorage, key, { tasks, projects, categories, taskLists, taskListLinks, ...habitWorkspace }); }
    catch {
      const timer = window.setTimeout(() => {
        setSyncError("Не удалось сохранить запись. Проверьте значение и повторите."); setSyncStatus("error");
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [hydrated, cloudUser, tasks, projects, categories, taskLists, taskListLinks, habitWorkspace, workspaceRecoveryKey]);

  useEffect(() => {
    if (!hydrated || workspaceRecoveryKey || privateDeviceAccessBlocked()) return;
    const key = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    const receive = (event: StorageEvent) => {
      if (event.key !== key || !event.newValue || privateDeviceAccessBlocked()) return;
      try {
        const saved = normalizeHabitWorkspace(JSON.parse(event.newValue), activeTaskCalendarMode);
        const current = habitWorkspaceRef.current;
        if (habitTimerEpoch(saved.habitTimerEpoch) < habitTimerEpoch(current.habitTimerEpoch)) return;
        const merged = habitTimerEpoch(saved.habitTimerEpoch) > habitTimerEpoch(current.habitTimerEpoch) ? saved
          : normalizeHabitWorkspace(preserveHabitTimerRecords(current, saved), activeTaskCalendarMode);
        if (JSON.stringify([current.habitTimers, current.habitMeasurements, current.habitCompletions, current.rewardTransactions, current.habitTimerEpoch])
          === JSON.stringify([merged.habitTimers, merged.habitMeasurements, merged.habitCompletions, merged.rewardTransactions, merged.habitTimerEpoch])) return;
        habitWorkspaceRef.current = merged; setHabitWorkspace(merged);
      } catch { setSyncStatus("error"); setSyncError("Не удалось сохранить запись. Проверьте значение и повторите."); }
    };
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, [hydrated, cloudUser, workspaceRecoveryKey, activeTaskCalendarMode]);

  useEffect(() => {
    if (!hydrated || !authResolved || !cloudUser || cloudUser.authProvider !== "yandex" || cloudUser.calendarConnected || !navigator.onLine) return;
    const key = `genesis.yandex-calendar-offer.v1.${cloudUser.uid}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch { /* The offer can still appear once in this session. */ }
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(key, "1"); } catch { /* Storage may be unavailable. */ }
      setYandexConnectPromptUserId(cloudUser.uid);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, authResolved, cloudUser]);

  useEffect(() => {
    if (!hydrated || privateDeviceAccessBlocked() || (isGoogleSyncConfigured && !cloudUser)) return;
    const cacheKey = cloudUser?.uid ?? "local";
    if (habitWorkspace.analyticsSnapshots.length) {
      void saveTrackerAnalyticsCache(cacheKey, habitWorkspace.analyticsSnapshots);
      return;
    }
    let active = true;
    void loadTrackerAnalyticsCache(cacheKey).then((snapshots) => {
      if (!active || privateDeviceAccessBlocked() || !snapshots.length) return;
      setHabitWorkspace((current) => current.analyticsSnapshots.length ? current : { ...current, analyticsSnapshots: snapshots });
    });
    return () => { active = false; };
  }, [hydrated, cloudUser, habitWorkspace.analyticsSnapshots]);

  useEffect(() => {
    if (!hydrated || !isGoogleSyncConfigured) return;

    let active = true;
    let stopTasks: (() => void) | undefined;
    let stopWorkspace: (() => void) | undefined;
    let loadedUserId = "";
    let loadedCalendarConnected = false;
    const startCloudTasks = (user: GenesisUser) => {
      stopTasks?.();
      stopTasks = observeCloudTasks(
        user.uid,
        (cloudTasks, cloudTaskLists, fromCache, warning) => {
          if (!active) return;
          const reconciledTasks = reconcileGoogleTaskMetadata(cloudTasks, tasksRef.current);
          const visibleTasks = warning
            ? Array.from(new Map([...tasksRef.current, ...reconciledTasks].map((task) => [task.id, task])).values()).filter((task) => !isCloudTaskDeleted(task.id))
            : reconciledTasks;
          tasksRef.current = visibleTasks;
          setTasks(visibleTasks);
          if (user.authProvider === "google") setTaskLists(old=>cloudTaskLists.map(list=>({...list,comments:old.find(saved=>saved.id===list.id)?.comments})));
          setSyncError(warning ?? "");
          setSyncStatus(warning ? "error" : fromCache ? "offline" : "synced");
        },
        (error) => {
          if (!active) return;
          setSyncError(error.message);
          setSyncStatus("error");
        },
      );
    };
    const stopUser = observeGenesisUser((user) => {
      if (privateDeviceAccessBlocked()) user = null;
      setAuthResolved(true);
      setSyncError("");

      if (!user) {
        setCloudUser(null);
        stopTasks?.();
        stopTasks = undefined;
        stopWorkspace?.();
        stopWorkspace = undefined;
        loadedUserId = "";
        loadedCalendarConnected = false;
        setSyncStatus("local");
        return;
      }
      const serverLanguage = normalizeLanguage(user.language);
      const pendingLanguageValue = localStorage.getItem(LANGUAGE_LOGIN_PENDING_KEY);
      const pendingLanguage = isLanguage(pendingLanguageValue) ? pendingLanguageValue : null;
      const effectiveLanguage = pendingLanguage ?? serverLanguage;
      const effectiveUser = { ...user, language: effectiveLanguage };
      setLanguage(effectiveLanguage);
      storeLanguage(effectiveLanguage);
      setCloudUser(effectiveUser);
      if (!privateDeviceAccessBlocked()) localStorage.setItem(LAST_USER_KEY, JSON.stringify(effectiveUser));
      if (pendingLanguage) {
        localStorage.removeItem(LANGUAGE_LOGIN_PENDING_KEY);
        if (pendingLanguage !== serverLanguage) {
          void updateAccountPreferences({ language: pendingLanguage })
            .then((result) => {
              if (!active) return;
              setCloudUser(result.user);
              if (!privateDeviceAccessBlocked()) localStorage.setItem(LAST_USER_KEY, JSON.stringify(result.user));
            })
            .catch((error: Error) => {
              if (!active) return;
              setSyncError(error.message);
            });
        }
      }
      if (loadedUserId === user.uid) {
        if (!loadedCalendarConnected && (user.calendarConnected)) {
          loadedCalendarConnected = true;
          setSyncStatus("syncing");
          void mergeLocalWorkspace(user.uid, {
            tasks: tasksRef.current, projects: projectsRef.current,
            categories: categoriesRef.current, taskListLinks: taskListLinksRef.current,
            taskLists: taskListsRef.current, ...habitWorkspaceRef.current,
          }).then(() => {
            if (active && loadedUserId === user.uid) startCloudTasks(user);
          }).catch((error: Error) => {
            if (!active) return;
            setSyncError(error.message);
            setSyncStatus(navigator.onLine ? "error" : "offline");
          });
        } else if (loadedCalendarConnected && !user.calendarConnected) {
          loadedCalendarConnected = false;
          stopTasks?.();
          stopTasks = undefined;
        }
        return;
      }
      stopTasks?.();
      stopTasks = undefined;
      stopWorkspace?.();
      stopWorkspace = undefined;
      loadedUserId = user.uid;
      loadedCalendarConnected = user.calendarConnected;

      const userKey = `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${user.uid}`;
      const local = loadLocalWorkspace(localStorage.getItem(userKey) ? userKey : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY);
      if (!local) return;
      tasksRef.current = local.tasks;
      projectsRef.current = local.projects;
      categoriesRef.current = local.categories;
      setTasks(local.tasks);
      setProjects(local.projects);
      setCategories(local.categories);
      setTaskLists(local.taskLists);
      taskListsRef.current = local.taskLists;
      setTaskListLinks(local.taskListLinks);
      setHabitWorkspace(ensureTrackerAnalytics(normalizeHabitWorkspace(local, user.taskCalendarMode ?? "sacred"), user.taskCalendarMode ?? "sacred"));
      setNewProjectCategory(local.categories[0]?.id ?? "");

      setSyncStatus("syncing");
      void mergeLocalWorkspace(user.uid, {
        tasks: local.tasks,
        projects: local.projects,
        categories: local.categories,
        taskListLinks: local.taskListLinks,
        taskLists: local.taskLists,
        ...normalizeHabitWorkspace(local, user.taskCalendarMode ?? "sacred"),
      })
        .then(async () => {
          if (!active || loadedUserId !== user.uid) return;
          const workspace = await loadGenesisWorkspace();
          if (!active || loadedUserId !== user.uid) return;
          const nextProjects = workspace.hasRemoteStructure ? workspace.projects : local.projects;
          const nextCategories = workspace.hasRemoteStructure ? workspace.categories : local.categories;
          const nextTaskListLinks = workspace.hasRemoteStructure ? workspace.taskListLinks : local.taskListLinks;
          const currentTasks=tasksRef.current;
          const reconciledWorkspaceTasks = mergeInitialWorkspaceCollection(local.tasks,currentTasks,reconcileGoogleTaskMetadata(workspace.tasks,currentTasks));
          const nextTasksById = new Map(reconciledWorkspaceTasks.map((task) => [task.id, task]));
          currentTasks.forEach((task) => {
            if (isCloudTaskDeleted(task.id)) return;
            const remoteTask = nextTasksById.get(task.id);
            if (!remoteTask && workspace.user.calendarConnected && (task.googleEventId || task.googleTaskId || Object.keys(task.googleLinks ?? {}).length)) return;
            if (!remoteTask || (!task.googleTaskId && task.updatedAt > remoteTask.updatedAt)) {
              nextTasksById.set(task.id, task);
            }
          });
          const nextTasks = Array.from(nextTasksById.values()).filter(task=>!isCloudTaskDeleted(task.id));
          tasksRef.current = nextTasks;
          projectsRef.current = nextProjects;
          categoriesRef.current = nextCategories;
          setTasks(nextTasks);
          setProjects(nextProjects);
          setCategories(nextCategories);
          const nextTaskLists=mergeInitialWorkspaceCollection(local.taskLists,taskListsRef.current,workspace.taskLists);
          setTaskLists(nextTaskLists);
          taskListsRef.current = nextTaskLists;
          setTaskListLinks(nextTaskListLinks);
          setHabitWorkspace(ensureTrackerAnalytics(
            normalizeHabitWorkspace(workspace.hasRemoteStructure ? workspace : local, workspace.user.taskCalendarMode ?? "sacred"),
            workspace.user.taskCalendarMode ?? "sacred",
          ));
          setNewProjectCategory(nextCategories[0]?.id ?? "");
          setSyncError(workspace.syncWarning ?? "");
          setSyncStatus(workspace.user.calendarConnected ? (workspace.syncWarning ? "offline" : "synced") : "local");
          stopWorkspace = observeCloudWorkspace((error) => {
            if (!active) return;
            setSyncError(error.message);
            setSyncStatus(navigator.onLine ? "error" : "offline");
          });
          if (workspace.user.calendarConnected) startCloudTasks(user);
        })
        .catch((error: Error) => {
          if (!active) return;
          setSyncError(error.message);
          setSyncStatus(navigator.onLine ? "error" : "offline");
        });
    }, (error) => {
      if (!active) return;
      setSyncError(error.message);
      try {
        if (privateDeviceAccessBlocked() || !canRestoreOfflineSession(error)) {
          setCloudUser(null);
          setAuthResolved(true);
          setSyncStatus("error");
          return;
        }
        // A failed background check must not replace the live workspace with an older cache.
        if(cloudUserRef.current?.uid){setAuthResolved(true);setSyncStatus(navigator.onLine ? "error" : "offline");return;}
        const cached = JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null") as GenesisUser | null;
        if (cached?.uid) {
          restoreOfflineWorkspaceSession(cached.uid,
            cached.authProvider === "yandex" ? "yandex" : "google");
          const cachedLanguage = normalizeLanguage(cached.language);
          const local = loadLocalWorkspace(`${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cached.uid}`);
          if (!local) return;
          tasksRef.current = local.tasks;
          projectsRef.current = local.projects;
          categoriesRef.current = local.categories;
          setTasks(local.tasks);
          setProjects(local.projects);
          setCategories(local.categories);
          setTaskLists(local.taskLists);
          setTaskListLinks(local.taskListLinks);
          setHabitWorkspace(ensureTrackerAnalytics(normalizeHabitWorkspace(local, cached.taskCalendarMode ?? "sacred"), cached.taskCalendarMode ?? "sacred"));
          setNewProjectCategory(local.categories[0]?.id ?? "");
          setLanguage(cachedLanguage);
          storeLanguage(cachedLanguage);
          setCloudUser({ ...cached, language: cachedLanguage });
          setAuthResolved(true);
          setSyncStatus("offline");
          return;
        }
        setAuthResolved(true);
        setSyncStatus("error");
      } catch {
        setAuthResolved(true);
        setSyncStatus("error");
      }
    });

    return () => {
      active = false;
      stopTasks?.();
      stopWorkspace?.();
      stopUser();
    };
  }, [hydrated]);

  useEffect(() => {
    if (!cloudUser) return undefined;
    return observeEncryptedWorkspaceUpdates((workspace, userId) => {
      if (userId !== cloudUser.uid) return;
      projectsRef.current = workspace.projects;
      categoriesRef.current = workspace.categories;
      setProjects(workspace.projects);
      setCategories(workspace.categories);
      setTaskListLinks(workspace.taskListLinks);
      if (cloudUser.authProvider !== "google") {
        setTaskLists(workspace.taskLists);
        taskListsRef.current = workspace.taskLists;
      }
      const nextHabitWorkspace = ensureTrackerAnalytics(
        normalizeHabitWorkspace(workspace, activeTaskCalendarMode),
        activeTaskCalendarMode,
      );
      taskListLinksRef.current = workspace.taskListLinks;
      habitWorkspaceRef.current = nextHabitWorkspace;
      setHabitWorkspace(nextHabitWorkspace);
      setNewProjectCategory(workspace.categories[0]?.id ?? "");
      setSyncError("");
      setSyncStatus("synced");
    });
  }, [cloudUser, activeTaskCalendarMode]);

  const saveTask = (task: Task) => {
    if (!cloudUser || !cloudUser.calendarConnected) return;
    setSyncStatus("syncing");
    void saveCloudTask(cloudUser.uid, task)
      .then((saved) => {
        setTasks((current) => current.map((item) => item.id === saved.id ? { ...item, ...saved } : item));
        setSyncStatus("synced");
      })
      .catch((error: Error) => {
        setSyncError(error.message);
        setSyncStatus(navigator.onLine ? "error" : "offline");
      });
  };

  const saveTaskSeries = (series: Task[]) => {
    if (!cloudUser || !cloudUser.calendarConnected || !series.length) return;
    setSyncStatus("syncing");
    void (async () => {
      const savedTasks: Task[] = [];
      const batchSize = 8;
      for (let index = 0; index < series.length; index += batchSize) {
        const batch = series.slice(index, index + batchSize);
        savedTasks.push(...await Promise.all(batch.map((task) => saveCloudTask(cloudUser.uid, task))));
      }
      const savedById = new Map(savedTasks.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => savedById.has(task.id) ? { ...task, ...savedById.get(task.id)! } : task));
      setSyncStatus("synced");
    })().catch((error: Error) => {
      setSyncError(error.message);
      setSyncStatus(navigator.onLine ? "error" : "offline");
    });
  };

  const handleGoogleSignIn = async () => {
    setAuthError("");
    setSyncError("");
    setSyncStatus("syncing");
    storeLanguage(language);
    localStorage.setItem(LANGUAGE_LOGIN_PENDING_KEY, language);
    try {
      await signInWithGoogle();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Не удалось войти");
      setSyncStatus("error");
    }
  };

  const selectLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    storeLanguage(nextLanguage);
  };

  const handleGoogleConnect = async () => {
    setAuthError("");
    setSyncError("");
    setSyncStatus("syncing");
    try {
      await connectGoogleServices();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Не удалось подключить Google Calendar и Tasks");
      setSyncStatus("error");
    }
  };

  const handleGoogleSignOut = async () => {
    setAccountMenuOpen(false);
    try {
      if (!window.confirm(translateText("Выход удалит данные аккаунтов и ключи из браузера, включая несинхронизированные изменения. Данные в облаке сохранятся. Сохраните черновики и код восстановления перед выходом. Выйти?", language))) return;
      await signOutFromGoogle();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Не удалось выйти");
      setSyncStatus("error");
    }
  };

  useEffect(() => {
    if (!hydrated || !cloudUser || !navigator.onLine) return;
    const timer = window.setTimeout(() => {
      void saveMetrics(metricsFor(tasks, projects, habitWorkspace.habits.length)).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [hydrated, cloudUser, tasks, projects, habitWorkspace.habits.length]);

  useEffect(() => {
    if (!cloudUser || !isGoogleSyncConfigured) return;
    let active = true;
    void loadAssistantStatus()
      .then((status) => {
        if (active) setAssistantStatus({ available: status.available, provider: status.provider, audioAvailable: status.audioAvailable });
      })
      .catch(() => {
        if (active) setAssistantStatus({ available: false, provider: "local", audioAvailable: false });
      });
    return () => {
      active = false;
    };
  }, [cloudUser]);

  const selectToday = () => {
    setSacredYear(todayInfo.sacredYear);
    setMonthIndex(todayInfo.monthIndex);
    setSelectedDay(todayInfo.day);
    navigateTo("today");
  };

  const activateNavigation = (nextView: ViewName) => {
    if (nextView === "today") {
      selectToday();
      return;
    }
    if (nextView === "projects") {
      const lastArea = cloudUser?.uid ? storedAffairsArea(cloudUser.uid) : projectsArea;
      setProjectsArea(lastArea === "shared" && sharedProjectsVisible || !personalProjectsVisible ? "shared" : "personal");
    }
    if (nextView === "calendar" && (!viewIsVisible("calendar", visibility) || view === "year" && viewIsVisible("year", visibility))) nextView = "year";
    if (nextView === "stoicheion" && !viewIsVisible("stoicheion", visibility)) nextView = "theokyklos";
    navigateTo(nextView);
  };

  const selectMonth = (nextIndex: number) => {
    let nextYear = sacredYear;
    let normalized = nextIndex;
    if (normalized < 0) {
      nextYear -= 1;
      normalized = 12;
    } else if (normalized > 12) {
      nextYear += 1;
      normalized = 0;
    }
    if (nextYear < 1899 || nextYear > 2100) return;
    setSacredYear(nextYear);
    setMonthIndex(normalized);
    setSelectedDay(1);
    setOpenDayTaskPopover("");
  };

  const changeSacredYear = (nextYear: number) => {
    if (nextYear < 1899 || nextYear > 2100) return;
    setSacredYear(nextYear);
    setOpenDayTaskPopover("");
    if (monthIndex === 12) {
      setSelectedDay((day) => Math.min(day, apeironLength(nextYear)));
    }
  };

  const taskForList = (title: string, dueDateValue: string, taskList: GoogleTaskList, projectId = "", calendarMode = activeTaskCalendarMode): Task => {
    const dueDate = new Date(`${dueDateValue}T12:00:00`);
    const sacred = getSacredDate(dueDate);
    const selectedProject = projects.find((project) => project.id === projectId);
    return {
      id: uid(),createdAt:new Date().toISOString(),createdByName:cloudUser?.displayName??undefined,
      sacredYear: sacred.sacredYear,
      monthIndex: sacred.monthIndex,
      day: sacred.day,
      dueDate: dueDateValue,
      endDate: dueDateValue,
      title: title.trim(),
      description: "",
      time: "",
      project: selectedProject?.title ?? "",
      projectId: selectedProject?.id ?? null,
      categoryId: selectedProject?.categoryId ?? null,
      tags: [],
      dependsOnIds: [],
      priority: 5,
      done: false,
      completedAt: null,
      reminders: [],
      reminderMinutes: null,
      recurrence: "none",
      recurrenceInterval: 1,
      recurrenceMode: "none",
      recurrencePattern: "none",
      recurrenceDays: [],
      recurrenceStartDate: null,
      recurrenceEndDate: null,
      recurrenceMonths: [],
      recurrencePyatas: [],
      recurrenceExcludedDates: [],
      recurrenceSeriesId: null,
      calendarMode,
      calendarNote: calendarDateNote(dueDate, calendarMode),
      syncToGoogle: cloudUser?.authProvider === "google",
      syncAccountIds: taskList.accountId ? [taskList.accountId] : defaultSyncAccountIds,
      googleLinks: {},
      googleAccountId: taskList.accountId ?? null,
      googleAccountEmail: taskList.accountEmail ?? "",
      createdIn: "genesis",
      googleEventId: null,
      googleTaskId: null,
      googleTaskListId: taskList.id,
      googleTaskListTitle: taskList.title,
      googleReadOnly: false,
      updatedAt: timestamp(),
    };
  };

  const createHabitGoogleReminder = async (habit: Habit) => {
    const searchStart = habit.schedule.startDate < todayDateValue ? todayDateValue : habit.schedule.startDate;
    const nextDate = nextHabitReminderDate(habit, searchStart, activeTaskCalendarMode);
    if (!nextDate) {
      throw new Error(language === "en" ? "No upcoming date was found for this habit." : "Для этой привычки не нашлось ближайшей даты.");
    }
    if (!cloudUser) throw new Error(language === "en" ? "Sign in to use Google reminders." : "Войдите в аккаунт, чтобы использовать Google-напоминания.");

    const title = `${language === "en" ? "Habit" : "Привычка"}: ${habit.title}`;
    const description = [
      habit.description,
      language === "en"
        ? "GENESIS is the source of truth for this recurrence."
        : "GENESIS является источником истины для этого повторения.",
      `${language === "en" ? "Reminder time" : "Время напоминания"}: ${habitReminderTime(habit)}`,
    ].filter(Boolean).join("\n\n");
    let googleTaskId: string | null = null;
    let googleEventId: string | null = null;
    setSyncStatus("syncing");

    if (habit.reminder.syncToGoogleTasks) {
      if (!cloudUser.googleTasksImportReady) {
        throw new Error(language === "en" ? "Connect Google Tasks in your account first." : "Сначала подключите Google Tasks в личном кабинете.");
      }
      let taskList = taskLists.find((item) => item.title === "Привычки GENESIS") ?? taskLists.find((item) => item.isDefault) ?? taskLists[0];
      if (!taskList) {
        const created = await createGoogleTaskList("Привычки GENESIS", defaultSyncAccountIds[0]);
        taskList = created.taskList;
        setTaskLists((current) => [...current.filter((item) => item.id !== created.taskList.id), created.taskList]);
      }
      const existingTask = habit.reminder.googleTaskId ? tasks.find((item) => item.id === habit.reminder.googleTaskId) : undefined;
      const reminderTask: Task = {
        ...(existingTask ?? taskForList(title, nextDate, taskList)),
        dueDate: nextDate,
        endDate: nextDate,
        title,
        description,
        tags: ["habit"],
        time: "",
        recurrence: "none",
        recurrenceMode: "none",
        recurrencePattern: "none",
        recurrenceSeriesId: null,
        updatedAt: timestamp(),
      };
      setTasks((current) => [...current.filter((item) => item.id !== reminderTask.id), reminderTask]);
      const saved = await saveCloudTask(cloudUser.uid, reminderTask);
      setTasks((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      googleTaskId = saved.id;
    }

    if (habit.reminder.showInGoogleCalendar) {
      const calendarTarget: GoogleTaskList = { id: "", title: "", updatedAt: null };
      const existingEvent = habit.reminder.googleEventId ? tasks.find((item) => item.id === habit.reminder.googleEventId) : undefined;
      const recurrence = habit.schedule.recurrence;
      const reminderEvent: Task = {
        ...(existingEvent ?? taskForList(title, nextDate, calendarTarget)),
        dueDate: nextDate,
        endDate: habit.schedule.endDate ?? (recurrence.rangeEnd || nextDate),
        title,
        description,
        time: habitReminderTime(habit),
        reminders: habit.reminder.enabled ? [{ kind: "relative", minutes: habit.reminder.minutesBefore ?? 0 }] : [],
        tags: ["habit"],
        recurrence: recurrence.mode !== "classic"
          ? "none"
          : recurrence.pattern === "daily"
            ? "daily"
            : recurrence.pattern === "weekdays"
              ? "weekly"
              : recurrence.pattern === "monthly"
                ? "monthly"
                : recurrence.pattern === "yearly" ? "yearly" : "none",
        recurrenceInterval: recurrence.interval,
        recurrenceMode: recurrence.enabled ? recurrence.mode : "none",
        recurrencePattern: recurrence.enabled ? recurrence.pattern : "none",
        recurrenceDays: recurrence.days,
        recurrenceStartDate: nextDate,
        recurrenceEndDate: habit.schedule.endDate ?? (recurrence.rangeEnd || null),
        recurrenceMonths: recurrence.months,
        recurrencePyatas: recurrence.pyatas,
        recurrenceContext: recurrence.calendarContext, recurrenceInvalidDayPolicy: recurrence.invalidDayPolicy,
        recurrenceExcludedDates: [],
        recurrenceSeriesId: null,
        calendarMode: activeTaskCalendarMode,
        calendarNote: calendarDateNote(new Date(`${nextDate}T12:00:00`), activeTaskCalendarMode),
        syncAccountIds: defaultSyncAccountIds,
        googleAccountId: null,
        googleAccountEmail: "",
        googleTaskListId: null,
        googleTaskListTitle: "",
        updatedAt: timestamp(),
      };
      setTasks((current) => [...current.filter((item) => item.id !== reminderEvent.id), reminderEvent]);
      const saved = await saveCloudTask(cloudUser.uid, reminderEvent);
      setTasks((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      googleEventId = saved.id;
    }
    setSyncStatus("synced");
    return { googleTaskId, googleEventId };
  };

  const advanceHabitGoogleReminder = async (habit: Habit, completedDate: string) => {
    if (!cloudUser || !habit.reminder.googleTaskId) return;
    const reminderTask = tasks.find((task) => task.id === habit.reminder.googleTaskId);
    if (!reminderTask) return;
    if (reminderTask.dueDate > completedDate) return;
    const searchStart = completedDate < todayDateValue ? todayDateValue : addHabitDays(completedDate, 1);
    const nextDate = nextHabitReminderDate(habit, searchStart, activeTaskCalendarMode);
    const nextTask = nextDate
      ? {
          ...reminderTask,
          dueDate: nextDate,
          endDate: nextDate,
          done: false,
          completedAt: null,
          updatedAt: timestamp(),
        }
      : {
          ...reminderTask,
          done: true,
          completedAt: new Date().toISOString(),
          updatedAt: timestamp(),
        };
    setTasks((current) => current.map((task) => task.id === nextTask.id ? nextTask : task));
    const saved = await saveCloudTask(cloudUser.uid, nextTask);
    setTasks((current) => current.map((task) => task.id === saved.id ? { ...task, ...saved } : task));
  };

  const appendTasksToList = (titles: string[], dueDateValue: string, taskList: GoogleTaskList, projectId = "") => {
    const nextTasks = titles
      .map((title) => title.trim())
      .filter(Boolean)
      .map((title) => taskForList(title, dueDateValue, taskList, projectId));
    if (!nextTasks.length) return;
    setTasks((current) => [...current, ...nextTasks]);
    nextTasks.forEach(saveTask);
  };

  const addTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mindmapConversionBusy.current) return;
    if (mindmapConversion && taskRecurrenceConfig.enabled) {
      setSyncError("Из мысли создаётся одна задача. Отключите повторение; существующий экземпляр серии можно добавить через «Добавить из дел».");
      return;
    }
    if (mindmapConversion && taskTaskListId === CREATE_NEW_TASK_LIST_ID) {
      setSyncError("Выберите существующий список задач для этой мысли."); return;
    }
    if (taskUndated && (newEntryType !== "task" || taskRecurrenceConfig.enabled || (cloudUser?.calendarConnected && !taskTaskListId))) {
      setSyncError("Для задачи без даты выберите список Google Tasks и отключите повторение."); return;
    }
    const title = taskTitle.trim();
    if (!title) return;
    if (newTaskDueDate && newTaskDueDate < todayDateValue) {
      setSyncError("Срок новой задачи не может быть в прошлом.");
      setSyncStatus("error");
      return;
    }
    if (newTaskEndDate < newTaskDueDate) {
      setSyncError("Срок выполнения не может быть раньше даты начала.");
      setSyncStatus("error");
      return;
    }
    if (newEntryType === "meeting" && taskTime && yandexEndTime && `${newTaskEndDate}T${yandexEndTime}` <= `${newTaskDueDate}T${taskTime}`) {
      setSyncError("Окончание встречи должно быть позже её начала."); setSyncStatus("error"); return;
    }
    if (cloudUser?.authProvider === "yandex" && yandexEntryType === "meeting") {
      if (taskTime && (!yandexEndTime || `${newTaskEndDate}T${yandexEndTime}` <= `${newTaskDueDate}T${taskTime}`)) {
        setSyncError("Окончание встречи должно быть позже её начала.");
        setSyncStatus("error");
        return;
      }
      if ([yandexAttendees, yandexOptionalAttendees].flatMap((value) => value.split(/[,;\n]/))
        .map((value) => value.trim()).filter(Boolean).some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
        setSyncError("Проверьте адреса участников встречи.");
        setSyncStatus("error");
        return;
      }
      if (yandexTelemostUrl && !/^https:\/\/telemost\.yandex\.[a-z.]+\/[A-Za-z0-9/_?=&%-]+$/.test(yandexTelemostUrl.trim())) {
        setSyncError("Укажите корректную ссылку Яндекс Телемоста.");
        setSyncStatus("error");
        return;
      }
    }
    const recurrenceDates = taskRecurrenceConfig.enabled
      ? buildRecurrenceDates(newTaskDueDate, taskRecurrenceConfig)
      : [newTaskDueDate];
    if (taskRecurrenceConfig.enabled && recurrenceDates.length === 0) {
      setSyncError("В выбранном периоде нет дат, подходящих под правило повторения.");
      setSyncStatus("error");
      return;
    }
    if (recurrenceDates.length > MAX_RECURRENCE_OCCURRENCES) {
      setSyncError(language === "en"
        ? `A series can contain no more than ${MAX_RECURRENCE_OCCURRENCES} recurrences. Shorten the period or choose fewer dates.`
        : `Серия может содержать не более ${MAX_RECURRENCE_OCCURRENCES} повторений. Сократите период или выберите меньше дат.`);
      setSyncStatus("error");
      return;
    }

    const dueDate = new Date(`${newTaskDueDate}T12:00:00`);
    if (!taskUndated && Number.isNaN(dueDate.getTime())) return;
    const sacred = taskUndated ? { sacredYear: 0, monthIndex: 0, day: 0 } : getSacredDate(dueDate);

    const tags = taskTags
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean)
      .slice(0, 6);
    const selectedProject = projects.find((item) => item.id === taskProject);
    let selectedTaskList = taskLists.find((item) => item.id === taskTaskListId);
    if (taskTaskListId === CREATE_NEW_TASK_LIST_ID) {
      const listTitle = taskNewListTitle.trim();
      if (!cloudUser || !listTitle) {
        setSyncError("Укажите название нового списка задач.");
        setSyncStatus("error");
        return;
      }
      setSyncStatus("syncing");
      try {
        const result = await createGoogleTaskList(listTitle, taskNewListAccountId || effectiveTaskSyncAccountIds[0] || defaultSyncAccountIds[0]);
        selectedTaskList = result.taskList;
        setTaskLists((current) => [...current.filter((item) => item.id !== result.taskList.id), result.taskList]);
        const nextLinks = [
          ...taskListLinks.filter((link) => link.taskListId !== result.taskList.id),
          { taskListId: result.taskList.id, projectId: selectedProject?.id ?? null },
        ];
        setTaskListLinks(nextLinks);
        persistStructure(projects, categories, nextLinks,
          [...taskLists.filter((item) => item.id !== result.taskList.id), result.taskList]);
        setTaskTaskListId(result.taskList.id);
        setTaskNewListTitle("");
        setTaskNewListAccountId("");
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "Не удалось создать список Google Tasks");
        setSyncStatus(navigator.onLine ? "error" : "offline");
        return;
      }
    }

    const task: Task = {
      id: mindmapConversion?.taskId ?? uid(),createdAt:new Date().toISOString(),createdByName:cloudUser?.displayName??undefined,
      sacredYear: sacred.sacredYear,
      monthIndex: sacred.monthIndex,
      day: sacred.day,
      dueDate: newTaskDueDate,
      endDate: newTaskEndDate,
      title,
      description: taskDescription.trim(),
      time: taskTime,
      project: selectedProject?.title ?? "",
      projectId: selectedProject?.id ?? null,
      categoryId: selectedProject?.categoryId ?? null,
      tags,
      dependsOnIds: taskDependsOn,
      priority: Math.min(10, Math.max(1, Number(taskPriority) || 5)),
      done: false,
      completedAt: null,
      reminders: taskReminders,
      reminderMinutes: legacyReminderMinutes(taskReminders),
      recurrence: "none",
      recurrenceInterval: taskRecurrenceConfig.enabled ? taskRecurrenceConfig.interval : 1,
      recurrenceMode: taskRecurrenceConfig.enabled ? taskRecurrenceConfig.mode : "none",
      recurrencePattern: taskRecurrenceConfig.enabled ? taskRecurrenceConfig.pattern : "none",
      recurrenceDays: taskRecurrenceConfig.enabled ? [...taskRecurrenceConfig.days] : [],
      recurrenceStartDate: taskRecurrenceConfig.enabled ? taskRecurrenceConfig.rangeStart || newTaskDueDate : null,
      recurrenceEndDate: taskRecurrenceConfig.enabled ? taskRecurrenceConfig.rangeEnd || null : null,
      recurrenceMonths: taskRecurrenceConfig.enabled ? [...taskRecurrenceConfig.months] : [],
      recurrencePyatas: taskRecurrenceConfig.enabled ? [...taskRecurrenceConfig.pyatas] : [],
      recurrenceContext: taskRecurrenceConfig.calendarContext, recurrenceInvalidDayPolicy: taskRecurrenceConfig.invalidDayPolicy,
      recurrenceExcludedDates: [],
      recurrenceSeriesId: null,
      calendarMode: taskFormCalendarMode,
      calendarNote: taskUndated ? "" : calendarDateNote(dueDate, taskFormCalendarMode),
      syncToGoogle: cloudUser?.authProvider === "google",
      syncAccountIds: syncAccountIdsForTask(selectedProject?.categoryId ?? null, selectedTaskList),
      googleLinks: {},
      googleAccountId: selectedTaskList?.accountId ?? null,
      googleAccountEmail: selectedTaskList?.accountEmail ?? "",
      createdIn: "genesis",
      entryType: newEntryType, endTime: newEntryType === "meeting" ? yandexEndTime : "",
      googleEventId: null,
      googleTaskId: null,
      googleTaskListId: selectedTaskList?.id ?? null,
      googleTaskListTitle: selectedTaskList?.title ?? "",
      googleReadOnly: false,
      ...(cloudUser?.authProvider === "yandex" ? {
        yandexEntryType, yandexEndTime, yandexLocation: yandexLocation.trim(),
        yandexTelemostUrl: yandexTelemostUrl.trim(),
        yandexAttendees: yandexAttendees.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean),
        yandexOptionalAttendees: yandexOptionalAttendees.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean),
        yandexBusy, yandexVisibility, yandexReminders,
      } : {}),
      updatedAt: timestamp(),
    };

    if (mindmapConversion && cloudUser) {
      mindmapConversionBusy.current = true;
      const guard = captureAccountSessionGuard();
      try {
        // The operation is durable before the task enters the ordinary domain.
        const operation = { mapId: mindmapConversion.mapId, nodeId: mindmapConversion.nodeId, taskId: mindmapConversion.taskId, task };
        await mindmapConversion.repository.journal(operation);
        guard();
        const existing = tasksRef.current.find(item => item.id === task.id);
        const saved = existing ?? (cloudUser.calendarConnected ? await createCloudTaskOnce(cloudUser.uid, task) : task);
        guard();
        const localKey = `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}`;
        const local = readStoredState(localKey);
        writeProtectedWorkspace(localStorage, localKey, { ...local, tasks: [...local.tasks.filter(item => item.id !== saved.id), saved] });
        tasksRef.current = [...tasksRef.current.filter(item => item.id !== saved.id), saved];
        setTasks(current => [...current.filter(item => item.id !== saved.id), saved]);
        setMindmapConversion(null);
      } catch (error) {
        try { guard(); } catch { return; }
        setSyncError(error instanceof Error && error.message === "TASK_CREATION_UNCONFIRMED"
          ? "Ответ от внешнего календаря не подтверждён. Задача повторно не создаётся. Обновите синхронизацию и повторите: GENESIS восстановит ссылку по ID."
          : error instanceof Error ? error.message : "Не удалось создать задачу. Черновик операции сохранён.");
        setSyncStatus("error"); return;
      } finally { mindmapConversionBusy.current = false; }
    } else {
    const taskSeries = buildTaskSeries(task, taskRecurrenceConfig);
    setTasks((current) => [...current, ...taskSeries]);
    if (taskSeries.length === 1) saveTask(taskSeries[0]);
    else saveTaskSeries(taskSeries);
    }

    setTaskComposer(null);
    setTaskTitle("");
    setTaskDescription("");
    setTaskDueDate("");
    setTaskEndDate("");
    setTaskTime("");
    setTaskTags("");
    setTaskReminders([{ kind: "relative", minutes: 30 }]);
    setYandexEntryType("task");
    setYandexEndTime("");
    setYandexLocation("");
    setYandexTelemostUrl("");
    setYandexAttendees("");
    setYandexOptionalAttendees("");
    setYandexBusy(true);
    setYandexVisibility("private");
    setYandexReminders([]);
    setTaskDependsOn([]);
    setTaskPriority("5");
    setTaskSyncAccountIds(null);
    setTaskRecurrenceConfig(alignRecurrenceConfigWithCalendar(DEFAULT_RECURRENCE_CONFIG, activeTaskCalendarMode, todayDateValue));
    if (dayTaskCreatorOpen) {
      setDayTaskCreatorOpen(false);
      setDayDetailsOpen(true);
    }
  };

  const seriesMembersForTask = (task: Task, source = tasks) => {
    if (task.recurrenceSeriesId) {
      const root = source.find((candidate) => candidate.id === task.recurrenceSeriesId);
      return root
        ? [root, ...source.filter((candidate) => candidate.recurrenceSeriesId === root.id)]
        : source.filter((candidate) => candidate.recurrenceSeriesId === task.recurrenceSeriesId);
    }
    return [task, ...source.filter((candidate) => candidate.recurrenceSeriesId === task.id)];
  };

  const taskHasSeries = (task: Task) => recurrenceConfigFromTask(task).enabled || seriesMembersForTask(task).length > 1;

  const openTaskEditor = (task: Task, occurrenceDate = task.dueDate) => {
    const isSeries = taskHasSeries(task);
    const draft = isSeries ? taskForOccurrence(task, occurrenceDate) : { ...task };
    setEditingTask({ ...draft, description: cleanTaskDescription(draft.description), tags: [...draft.tags], dependsOnIds: [...draft.dependsOnIds], reminders: [...draft.reminders] });
    setEditingTaskTags(task.tags.join(", "));
    setEditingOccurrenceDate(occurrenceDate);
    setEditingTaskScope(isSeries ? "occurrence" : "series");
  };

  const changeEditingTaskScope = (scope: TaskSeriesScope) => {
    if (!editingTask) return;
    const original = tasks.find((task) => task.id === editingTask.id);
    if (!original) return;
    const parentSeries = original.recurrenceSeriesId
      ? tasks.find((task) => task.id === original.recurrenceSeriesId && recurrenceConfigFromTask(task).enabled)
      : null;
    setEditingTaskScope(scope);
    setEditingTask((current) => {
      if (!current) return current;
      const temporal = scope === "occurrence"
        ? taskForOccurrence(original, editingOccurrenceDate || original.dueDate)
        : parentSeries ?? original;
      return {
        ...current,
        sacredYear: temporal.sacredYear,
        monthIndex: temporal.monthIndex,
        day: temporal.day,
        dueDate: temporal.dueDate,
        endDate: temporal.endDate,
        calendarNote: temporal.calendarNote,
        recurrence: temporal.recurrence,
        recurrenceInterval: temporal.recurrenceInterval,
        recurrenceMode: temporal.recurrenceMode,
        recurrencePattern: temporal.recurrencePattern,
        recurrenceDays: [...temporal.recurrenceDays],
        recurrenceStartDate: temporal.recurrenceStartDate,
        recurrenceEndDate: temporal.recurrenceEndDate,
        recurrenceMonths: [...temporal.recurrenceMonths],
        recurrencePyatas: [...temporal.recurrencePyatas],
        recurrenceContext: temporal.recurrenceContext, recurrenceInvalidDayPolicy: temporal.recurrenceInvalidDayPolicy,
        recurrenceExcludedDates: [...temporal.recurrenceExcludedDates],
      };
    });
  };

  const persistTaskChange = (original: Task, nextTask: Task) => {
    setTasks((current) => current.map((task) => task.id === nextTask.id ? nextTask : task));
    const destinationChanged = original.googleTaskListId !== nextTask.googleTaskListId;
    const hasRemoteSource = Boolean(original.googleTaskId || original.googleEventId || Object.keys(original.googleLinks ?? {}).length);
    if (!cloudUser?.calendarConnected || !destinationChanged || !hasRemoteSource) {
      saveTask(nextTask);
      return;
    }

    const recreatedTask: Task = {
      ...nextTask,
      googleEventId: null,
      googleTaskId: null,
      googleLinks: {},
      updatedAt: timestamp(),
    };
    setSyncStatus("syncing");
    void removeCloudTask(cloudUser.uid, original)
      .then(() => saveCloudTask(cloudUser.uid, recreatedTask))
      .then((saved) => {
        setTasks((current) => current.map((task) => task.id === saved.id ? { ...task, ...saved } : task));
        setSyncStatus("synced");
      })
      .catch((error: Error) => {
        setSyncError(error.message);
        setSyncStatus(navigator.onLine ? "error" : "offline");
      });
  };

  const saveTaskEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingTask) return;
    const original = tasks.find((task) => task.id === editingTask.id);
    const recurrenceConfig = recurrenceConfigFromTask(editingTask);
    const taskDraft = editingTask;
    const title = taskDraft.title.trim();
    if (!original || !title) return;
    if (!taskDraft.dueDate && (recurrenceConfig.enabled || (taskDraft.entryType ?? "task") !== "task" || (cloudUser?.calendarConnected && !taskDraft.googleTaskListId))) {
      setSyncError("Для задачи без даты выберите список Google Tasks и отключите повторение."); return;
    }
    if (taskDraft.dueDate && taskDraft.dueDate < todayDateValue && taskDraft.dueDate !== original.dueDate) {
      setSyncError("Нельзя переносить задачу на дату в прошлом.");
      setSyncStatus("error");
      return;
    }
    if ((taskDraft.endDate || taskDraft.dueDate) < taskDraft.dueDate) {
      setSyncError("Срок выполнения не может быть раньше даты начала.");
      setSyncStatus("error");
      return;
    }
    if (cloudUser?.authProvider === "yandex" && taskDraft.yandexEntryType === "meeting") {
      if (taskDraft.time && (!taskDraft.yandexEndTime ||
        `${taskDraft.endDate || taskDraft.dueDate}T${taskDraft.yandexEndTime}` <= `${taskDraft.dueDate}T${taskDraft.time}`)) {
        setSyncError("Окончание встречи должно быть позже её начала.");
        setSyncStatus("error");
        return;
      }
      if ([...(taskDraft.yandexAttendees ?? []), ...(taskDraft.yandexOptionalAttendees ?? [])]
        .some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
        setSyncError("Проверьте адреса участников встречи.");
        setSyncStatus("error");
        return;
      }
      if (taskDraft.yandexTelemostUrl &&
        !/^https:\/\/telemost\.yandex\.[a-z.]+\/[A-Za-z0-9/_?=&%-]+$/.test(taskDraft.yandexTelemostUrl.trim())) {
        setSyncError("Укажите корректную ссылку Яндекс Телемоста.");
        setSyncStatus("error");
        return;
      }
    }
    const dueDate = new Date(`${taskDraft.dueDate}T12:00:00`);
    if (taskDraft.dueDate && Number.isNaN(dueDate.getTime())) return;
    const sacred = taskDraft.dueDate ? getSacredDate(dueDate) : { sacredYear: 0, monthIndex: 0, day: 0 };
    const selectedProject = projects.find((project) => project.id === taskDraft.projectId);
    const selectedTaskList = taskLists.find((taskList) => taskList.id === taskDraft.googleTaskListId);
    const keepInInbox = taskDraft.projectId === TASK_INBOX_PROJECT_ID;
    const nextTask: Task = {
      ...taskDraft,
      title,
      description: cleanTaskDescription(taskDraft.description),
      sacredYear: sacred.sacredYear,
      monthIndex: sacred.monthIndex,
      day: sacred.day,
      project: selectedProject?.title ?? "",
      projectId: keepInInbox ? TASK_INBOX_PROJECT_ID : selectedProject?.id ?? null,
      categoryId: selectedProject?.categoryId ?? null,
      calendarMode: taskDraft.calendarMode ?? activeTaskCalendarMode,
      calendarNote: taskDraft.dueDate ? calendarDateNote(dueDate, taskDraft.calendarMode ?? activeTaskCalendarMode) : "",
      tags: editingTaskTags.split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean).slice(0, 10),
      googleTaskListId: selectedTaskList?.id ?? taskDraft.googleTaskListId,
      googleTaskListTitle: selectedTaskList?.title ?? taskDraft.googleTaskListTitle,
      googleAccountId: selectedTaskList?.accountId ?? taskDraft.googleAccountId,
      googleAccountEmail: selectedTaskList?.accountEmail ?? taskDraft.googleAccountEmail,
      syncAccountIds: selectedTaskList?.accountId ? [selectedTaskList.accountId] : taskDraft.syncAccountIds,
      updatedAt: timestamp(),
    };

    const seriesMembers = seriesMembersForTask(original);
    const parentSeries = original.recurrenceSeriesId
      ? tasks.find((task) => task.id === original.recurrenceSeriesId && recurrenceConfigFromTask(task).enabled)
      : null;
    const originalIsUnifiedSeries = !original.recurrenceSeriesId && recurrenceConfigFromTask(original).enabled;
    if (taskHasSeries(original) && editingTaskScope === "occurrence" && originalIsUnifiedSeries) {
      const occurrenceDate = editingOccurrenceDate || original.dueDate;
      const remainingSeries = taskSeriesAfterExcludingOccurrence(original, occurrenceDate);
      const occurrenceTask = standaloneTaskFromOccurrence({
        ...nextTask,
        id: uid(),
        recurrenceOriginalDate: occurrenceDate,
        googleEventId: null,
        googleTaskId: null,
        googleTaskListId: null,
        googleTaskListTitle: "",
        googleLinks: {},
        updatedAt: timestamp(),
      }, original.id);
      setTasks((current) => [
        ...current.filter((task) => task.id !== original.id),
        ...(remainingSeries ? [remainingSeries] : []),
        occurrenceTask,
      ]);
      if (remainingSeries) saveTask(remainingSeries);
      else if (cloudUser && cloudUser.calendarConnected) void removeCloudTask(cloudUser.uid, original);
      saveTask(occurrenceTask);
      setEditingTask(null);
      return;
    }

    if (editingTaskScope === "series" && !original.recurrenceSeriesId && (seriesMembers.length > 1 || originalIsUnifiedSeries)) {
      const updatedRoot = buildTaskSeries(nextTask, recurrenceConfig)[0] ?? nextTask;
      const updatedExceptions = seriesMembers
        .filter((task) => task.id !== original.id)
        .map((task) => taskWithSharedSeriesFields(task, nextTask));
      const updates = new Map([updatedRoot, ...updatedExceptions].map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => updates.get(task.id) ?? task));
      saveTask(updatedRoot);
      updatedExceptions.forEach(saveTask);
      setEditingTask(null);
      return;
    }

    if (editingTaskScope === "series" && parentSeries) {
      const rootDraft: Task = {
        ...nextTask,
        id: parentSeries.id,
        recurrenceSeriesId: null,
        googleEventId: parentSeries.googleEventId,
        googleTaskId: null,
        googleLinks: parentSeries.googleLinks,
      };
      const updatedRoot = buildTaskSeries(rootDraft, recurrenceConfig)[0] ?? rootDraft;
      const updatedExceptions = seriesMembers
        .filter((task) => task.id !== parentSeries.id)
        .map((task) => taskWithSharedSeriesFields(task, nextTask));
      const updates = new Map([updatedRoot, ...updatedExceptions].map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => updates.get(task.id) ?? task));
      saveTask(updatedRoot);
      updatedExceptions.forEach(saveTask);
      setEditingTask(null);
      return;
    }

    const isLegacyExpandedSeries = Boolean(original.recurrenceSeriesId)
      && !tasks.some((task) => task.id === original.recurrenceSeriesId && recurrenceConfigFromTask(task).enabled);
    if (editingTaskScope === "series" && isLegacyExpandedSeries && seriesMembers.length > 1) {
      const firstMember = [...seriesMembers].sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
      const seriesStart = nextTask.recurrenceStartDate || firstMember.dueDate;
      const consolidatedDraft: Task = {
        ...nextTask,
        id: firstMember.id,
        dueDate: seriesStart,
        endDate: shiftRangeEndDate(nextTask.dueDate, nextTask.endDate, seriesStart),
        recurrenceSeriesId: null,
        googleEventId: null,
        googleTaskId: null,
        googleTaskListId: null,
        googleTaskListTitle: "",
        googleLinks: {},
      };
      const consolidated = buildTaskSeries(consolidatedDraft, recurrenceConfig)[0] ?? consolidatedDraft;
      const memberIds = new Set(seriesMembers.map((task) => task.id));
      setTasks((current) => [...current.filter((task) => !memberIds.has(task.id)), consolidated]);
      if (cloudUser && cloudUser.calendarConnected) {
        setSyncStatus("syncing");
        void (async () => {
          await Promise.all(seriesMembers.map((task) => removeCloudTask(cloudUser.uid, task)));
          const saved = await saveCloudTask(cloudUser.uid, consolidated);
          setTasks((current) => current.map((task) => task.id === saved.id ? { ...task, ...saved } : task));
          setSyncStatus("synced");
        })().catch((error: Error) => {
          setSyncError(error.message);
          setSyncStatus(navigator.onLine ? "error" : "offline");
        });
      }
      setEditingTask(null);
      return;
    }

    const taskToPersist = editingTaskScope === "series" && recurrenceConfig.enabled
      ? buildTaskSeries(nextTask, recurrenceConfig)[0] ?? nextTask
      : nextTask;
    persistTaskChange(original, taskToPersist);
    setEditingTask(null);
  };

  const moveTaskToTaskList = (task: Task, taskListId: string) => {
    if (task.googleTaskListId === taskListId) return;
    const taskList = taskLists.find((item) => item.id === taskListId);
    if (!taskList) return;
    const nextTask: Task = {
      ...task,
      time: "",
      reminders: [],
      reminderMinutes: null,
      recurrence: "none",
      recurrenceInterval: 1,
      recurrenceMode: "none",
      recurrencePattern: "none",
      recurrenceDays: [],
      recurrenceStartDate: null,
      recurrenceEndDate: null,
      recurrenceMonths: [],
      recurrencePyatas: [],
      recurrenceExcludedDates: [],
      recurrenceSeriesId: null,
      googleTaskListId: taskList.id,
      googleTaskListTitle: taskList.title,
      googleAccountId: taskList.accountId ?? null,
      googleAccountEmail: taskList.accountEmail ?? "",
      syncAccountIds: taskList.accountId ? [taskList.accountId] : task.syncAccountIds,
      updatedAt: timestamp(),
    };
    persistTaskChange(task, nextTask);
    setProjectMoveAnnouncement(`Задача «${task.title}» перемещена в список «${taskList.title}».`);
  };

  const toggleTask = (id: string) => {
    const currentTask = tasks.find((task) => task.id === id);
    if (!currentTask) return;
    const unfinishedDependencies = currentTask.dependsOnIds.filter((dependencyId) => tasks.some((task) => task.id === dependencyId && !task.done));
    if (!currentTask.done && unfinishedDependencies.length) {
      setSyncError(`Сначала завершите связанные задачи: ${unfinishedDependencies.length}`);
      setSyncStatus("error");
      return;
    }
    const nextTask = {
      ...currentTask,
      done: !currentTask.done,
      completedAt: currentTask.done ? null : new Date().toISOString(),
      updatedAt: timestamp(),
    };
    const nextDate = !currentTask.done
      ? nextOccurrenceDate(currentTask.dueDate, currentTask.recurrence, currentTask.recurrenceInterval)
      : null;
    const nextDateValue = nextDate ? inputDate(nextDate) : "";
    const alreadyQueued = nextDateValue !== "" && tasks.some((task) => (
      task.id !== currentTask.id &&
      task.dueDate === nextDateValue &&
      task.title === currentTask.title &&
      task.projectId === currentTask.projectId &&
      !task.done
    ));
    const nextOccurrence = nextDate && !alreadyQueued
      ? (() => {
          const sacred = getSacredDate(nextDate);
          return {
            ...currentTask,
            id: uid(),
            sacredYear: sacred.sacredYear,
            monthIndex: sacred.monthIndex,
            day: sacred.day,
            dueDate: nextDateValue,
            endDate: shiftRangeEndDate(currentTask.dueDate, currentTask.endDate, nextDateValue),
            calendarNote: calendarDateNote(nextDate, currentTask.calendarMode),
            done: false,
            completedAt: null,
            googleEventId: null,
            googleTaskId: null,
            googleLinks: {},
            updatedAt: timestamp(),
          };
        })()
      : null;
    setTasks((current) =>
      [
        ...current.map((task) => (task.id === id ? nextTask : task)),
        ...(nextOccurrence ? [nextOccurrence] : []),
      ],
    );
    saveTask(nextTask);
    if (nextOccurrence) saveTask(nextOccurrence);
  };

  const removeTasks = (tasksToDelete: Task[]) => {
    const ids = new Set(tasksToDelete.map((task) => task.id));
    tasksRef.current = tasksRef.current.filter((task) => !ids.has(task.id));
    setTasks((current) => current.filter((task) => !ids.has(task.id)));
    if (cloudUser && cloudUser.calendarConnected && tasksToDelete.length) {
      setSyncStatus("syncing");
      void Promise.all(tasksToDelete.map((task) => removeCloudTask(cloudUser.uid, task)))
        .then(() => setSyncStatus("synced"))
        .catch((error: Error) => {
          setSyncError(error.message);
          setSyncStatus(navigator.onLine ? "error" : "offline");
        });
    }
  };

  const deleteTask = (id: string, occurrenceDate?: string) => {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    if (taskHasSeries(task)) {
      setPendingTaskDeletion({ taskId: id, occurrenceDate: occurrenceDate || task.dueDate });
      return;
    }
    removeTasks([task]);
  };

  const deletePendingTaskOccurrence = () => {
    if (!pendingTaskDeletion) return;
    const task = tasks.find((candidate) => candidate.id === pendingTaskDeletion.taskId);
    if (!task) return setPendingTaskDeletion(null);
    const isUnifiedRoot = !task.recurrenceSeriesId && recurrenceConfigFromTask(task).enabled;
    if (!isUnifiedRoot) {
      removeTasks([task]);
      setPendingTaskDeletion(null);
      return;
    }
    const nextSeries = taskSeriesAfterExcludingOccurrence(task, pendingTaskDeletion.occurrenceDate);
    if (!nextSeries) removeTasks([task]);
    else {
      setTasks((current) => current.map((candidate) => candidate.id === task.id ? nextSeries : candidate));
      saveTask(nextSeries);
    }
    setPendingTaskDeletion(null);
  };

  const deletePendingTaskSeries = () => {
    if (!pendingTaskDeletion) return;
    const task = tasks.find((candidate) => candidate.id === pendingTaskDeletion.taskId);
    if (task) removeTasks(seriesMembersForTask(task));
    setPendingTaskDeletion(null);
  };

  const updateHabitWorkspace = (nextWorkspace: HabitWorkspace, persistBeforeClosing = false, historyCorrection = false) => {
    requireQuotaGrowth(cloudUser?.featureAccess,'habits',habitWorkspaceRef.current.habits.filter(h=>habitLifecycleState(h).status!=='deleted').length,nextWorkspace.habits.filter(h=>habitLifecycleState(h).status!=='deleted').length);
    const localKey = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    assertWorkspaceWritable(localStorage, localKey);
    // Existing pause controls also record transitions; ordinary editors cannot bypass the journal.
    const timestamp = new Date().toISOString();
    let withLifecycle = nextWorkspace;
    withLifecycle = { ...withLifecycle, habits: withLifecycle.habits.map(habit => {
      if (habitWorkspaceRef.current.habits.some(previous => previous.id === habit.id) || habit.lifecycleHistory?.length) return habit;
      return applyHabitLifecycleCommand(habit, { id: `habit-created:${habit.id}`, habitId: habit.id,
        action: "observe", at: timestamp, heads: [] });
    }) };
    for (const habit of nextWorkspace.habits) {
      const previous = habitWorkspaceRef.current.habits.find(row => row.id === habit.id);
      if (!previous || previous.active === habit.active || JSON.stringify(previous.lifecycleHistory ?? []) !== JSON.stringify(habit.lifecycleHistory ?? [])) continue;
      withLifecycle = applyHabitLifecycleToWorkspace({ ...withLifecycle,
        habits: withLifecycle.habits.map(row => row.id === habit.id ? { ...row, active: previous.active } : row) },
        { id: `habit-state:${crypto.randomUUID()}`, habitId: habit.id,
        action: habit.active ? "resume" : "pause", at: timestamp, heads: habitLifecycleState(previous).heads.map(row => row.id) });
    }
    withLifecycle = observeChangedHabitAvailability(habitWorkspaceRef.current, withLifecycle, timestamp);
    const normalizedBase = finishDisabledHabitTimers(normalizeHabitWorkspace(preserveHabitTimerRecords(withLifecycle, habitWorkspaceRef.current), activeTaskCalendarMode), habitTimerDeviceOwner(localStorage), timestamp);
    const lifecycleChanged = normalizedBase.habits.some(habit => {
      const previous = habitWorkspaceRef.current.habits.find(row => row.id === habit.id);
      return previous && JSON.stringify((previous.lifecycleHistory ?? []).filter(row => row.action !== "observe"))
        !== JSON.stringify((habit.lifecycleHistory ?? []).filter(row => row.action !== "observe"));
    });
    const changedDates = changedTrackerDates(habitWorkspace, normalizedBase);
    const trackerDefinitionsChanged = JSON.stringify([
      habitWorkspace.habits,
      habitWorkspace.sleepPlans,
      habitWorkspace.addictionTrackers,
    ]) !== JSON.stringify([
      normalizedBase.habits,
      normalizedBase.sleepPlans,
      normalizedBase.addictionTrackers,
    ]);
    if (trackerDefinitionsChanged) {
      changedDates.add(todayDateValue);
      normalizedBase.habitCompletions.forEach((entry) => changedDates.add(entry.date));
      normalizedBase.sleepEntries.forEach((entry) => changedDates.add(entry.date));
      normalizedBase.addictionEntries.forEach((entry) => changedDates.add(entry.date));
    }
    const previousRestDays = new Set(habitWorkspace.habitSettings.plannedRestDays);
    const nextRestDays = new Set(normalizedBase.habitSettings.plannedRestDays);
    previousRestDays.forEach((date) => { if (!nextRestDays.has(date)) changedDates.add(date); });
    nextRestDays.forEach((date) => { if (!previousRestDays.has(date)) changedDates.add(date); });
    const dailyGoalWorkspace = refreshDailyGoalProgress(normalizedBase, changedDates, activeTaskCalendarMode, todayDateValue);
    let normalized = ensureTrackerAnalytics(
      refreshTrackerAnalytics(dailyGoalWorkspace, changedDates, activeTaskCalendarMode),
      activeTaskCalendarMode,
    );
    if (lifecycleChanged || historyCorrection) normalized = { ...normalized, rewardTransactions: normalizedBase.rewardTransactions,
      streakFreezeTransactions: normalizedBase.streakFreezeTransactions, achievementUnlocks: normalizedBase.achievementUnlocks,
      quests: normalizedBase.quests, userProgress: { ...normalized.userProgress,
        lifetimeXp: normalizedBase.userProgress.lifetimeXp, laurelsBalance: normalizedBase.userProgress.laurelsBalance,
        streakFreezeCount: normalizedBase.userProgress.streakFreezeCount } };
    const newlyCompletedEntries = historyCorrection ? [] : normalized.habitCompletions.filter((entry) => (
      entry.completed
      && !habitWorkspace.habitCompletions.some((current) => current.id === entry.id && current.completed)
    ));
    const stoppedHabits = normalized.habits.filter(habit => !habit.active
      && habitWorkspaceRef.current.habits.find(previous => previous.id === habit.id)?.active);
    const latestCompletion = newlyCompletedEntries[newlyCompletedEntries.length - 1];
    const showSavedFeedback = () => {
    if (latestCompletion) {
      const habit = normalized.habits.find((item) => item.id === latestCompletion.habitId);
      if (habit) {
        const previousGoal = dailyGoalForDate(habitWorkspace, latestCompletion.date, activeTaskCalendarMode, todayDateValue);
        const nextGoal = dailyGoalForDate(normalized, latestCompletion.date, activeTaskCalendarMode, todayDateValue);
        const rankChanged = Boolean(normalized.userProgress.currentRankId && normalized.userProgress.currentRankId !== habitWorkspace.userProgress.currentRankId);
        const rank = heroicRankForProgress(normalized.userProgress);
        const previousRewardIds = new Set(habitWorkspace.rewardTransactions.map((transaction) => transaction.id));
        const laurels = normalized.rewardTransactions
          .filter((transaction) => !previousRewardIds.has(transaction.id) && transaction.amount > 0)
          .reduce((total, transaction) => total + transaction.amount, 0);
        const previousAchievementIds = new Set(habitWorkspace.achievementUnlocks.map((unlock) => unlock.id));
        const achievementUnlock = normalized.achievementUnlocks.find((unlock) => !previousAchievementIds.has(unlock.id));
        const achievement = normalized.habitSettings.feedback.achievementPopups
          ? ACHIEVEMENTS.find((definition) => definition.id === achievementUnlock?.achievementId)
          : undefined;
        const questCompleted = normalized.habitSettings.feedback.questsEnabled && normalized.quests.some(quest => quest.completedAt && !habitWorkspace.quests.some(previous => previous.id === quest.id && previous.completedAt));
        const kind = rankChanged
          ? "rank-up"
          : questCompleted ? "quest"
          : achievement ? "achievement"
          : nextGoal.status === "perfect" && previousGoal.status !== "perfect"
            ? "perfect-day"
            : ["qualified", "perfect"].includes(nextGoal.status) && !["qualified", "perfect"].includes(previousGoal.status)
              ? "daily-goal"
              : "completion";
        const feedback: HabitFeedbackEvent = {
          id: `${latestCompletion.id}:${latestCompletion.updatedAt}`,
          habitId: habit.id,
          habitTitle: habitDisplayText(habit, language).title,
          habitEmoji: habit.emoji,
          kind,
          xp: Math.max(0, latestCompletion.xpAwarded),
          laurels,
          rankTitle: rank.title,
          rankTitleEn: rank.titleEn,
          achievementTitle: achievement?.title ?? "",
          achievementTitleEn: achievement?.titleEn ?? "",
        };
        setHabitFeedback(feedback);
        deliverHabitFeedback(kind, normalized.habitSettings.feedback);
        if (habitFeedbackTimerRef.current !== null) window.clearTimeout(habitFeedbackTimerRef.current);
        habitFeedbackTimerRef.current = window.setTimeout(() => setHabitFeedback(null), 2600);
      }
    }
    };
    const commit = () => { habitWorkspaceRef.current = normalized;
    setHabitWorkspace(normalized);
    showSavedFeedback();
    if (!cloudUser) return;
    for (const habit of stoppedHabits) {
      const reminderIds = new Set([habit.reminder.googleTaskId, habit.reminder.googleEventId].filter(Boolean));
      const reminders = tasksRef.current.filter(task => reminderIds.has(task.id));
      if (!reminders.length) continue;
      // Existing task mutations are durable offline; a stopped habit must not leave a recurring Google reminder.
      setTasks(current => current.filter(task => !reminderIds.has(task.id)));
      reminders.forEach(task => { void removeCloudTask(cloudUser.uid, task).catch((error: Error) => {
        setSyncError(error.message); setSyncStatus(navigator.onLine ? "error" : "offline");
      }); });
    }
    newlyCompletedEntries.forEach((entry) => {
      const habit = normalized.habits.find((item) => item.id === entry.habitId);
      if (!habit?.reminder.syncToGoogleTasks || !habit.reminder.googleTaskId) return;
      void advanceHabitGoogleReminder(habit, entry.date).catch((error: Error) => {
        setSyncError(error.message);
        setSyncStatus(navigator.onLine ? "error" : "offline");
      });
    });
    };
    if (habitSaveTimerRef.current !== null) window.clearTimeout(habitSaveTimerRef.current);
    if (persistBeforeClosing && !cloudUser) {
      writeProtectedWorkspace(localStorage, localKey, { tasks: tasksRef.current, projects: projectsRef.current,
        categories: categoriesRef.current, taskLists: taskListsRef.current, taskListLinks: taskListLinksRef.current, ...normalized });
      commit(); return;
    }
    if (persistBeforeClosing && cloudUser) {
      const guard = captureAccountSessionGuard(); setSyncStatus("syncing");
      return new Promise<void>((resolve, reject) => {
        let queued = false;
        void saveWorkspaceStructure(projectsRef.current, categoriesRef.current, taskListLinksRef.current,
          metricsFor(tasksRef.current, projectsRef.current, normalized.habits.length), normalized,
          cloudUser.authProvider !== "google" ? taskLists : undefined,
          () => { guard(); commit(); queued = true; resolve(); })
          .then(() => { guard(); setSyncStatus("synced"); })
          .catch((error: Error) => {
            try { guard(); setSyncError(error.message); setSyncStatus(navigator.onLine ? "error" : "offline"); } catch { /* The former account no longer owns this UI. */ }
            if (!queued) reject(error);
          });
      });
    }
    commit();
    if (!cloudUser) return;
    habitSaveTimerRef.current = window.setTimeout(() => {
      setSyncStatus("syncing");
      void saveWorkspaceStructure(
        projectsRef.current,
        categoriesRef.current,
        taskListLinksRef.current,
        metricsFor(tasksRef.current, projectsRef.current, normalized.habits.length),
        normalized,
        cloudUser.authProvider !== "google" ? taskLists : undefined,
      )
        .then(() => setSyncStatus("synced"))
        .catch((error: Error) => {
          setSyncError(error.message);
          setSyncStatus(navigator.onLine ? "error" : "offline");
        });
    }, 650);
  };

  useHabitAutoDeletion(habitWorkspace, today,
    hydrated && !workspaceRecoveryKey && !privateDeviceAccessBlocked() && (!isGoogleSyncConfigured || Boolean(cloudUser)),
    next => updateHabitWorkspace(next, true), message => setSyncError(message));

  const runHabitTimerCommand = async (command: HabitTimerCommand) => {
    if (command.action === 'start' || command.action === 'resume') requireFeature(cloudUser?.featureAccess,'habit-timer');
    const key = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    const guard = cloudUser ? captureAccountSessionGuard() : () => {
      if (privateDeviceAccessBlocked()) throw new Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED");
    };
    await withHabitTimerLock(key, async () => {
      guard();
      if (habitTimerDeviceOwner(localStorage) !== command.owner) throw new RangeError("HABIT_TIMER_OTHER_DEVICE");
      const saved = readProtectedWorkspace(localStorage, key,
        raw => normalizeHabitWorkspace(raw as Parameters<typeof normalizeHabitWorkspace>[0], activeTaskCalendarMode),
        () => habitWorkspaceRef.current);
      const live = habitWorkspaceRef.current;
      const base = habitTimerEpoch(saved.habitTimerEpoch) < habitTimerEpoch(live.habitTimerEpoch) ? live : preserveHabitTimerRecords(saved, live);
      const next = applyHabitTimerCommand(base, command);
      await updateHabitWorkspace(next, true);
      guard();
      writeProtectedWorkspace(localStorage, key, { tasks: tasksRef.current, projects: projectsRef.current,
        categories: categoriesRef.current, taskLists: taskListsRef.current, taskListLinks: taskListLinksRef.current,
        ...habitWorkspaceRef.current });
    });
  };

  const applyHabitReminder = async (target: HabitReminderTarget, input?:HabitReminderInput) => {
    const key = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    const guard = captureAccountSessionGuard();
    await withHabitTimerLock(key, async () => {
      guard();
      const { completeHabitReminder, applyHabitReminderInput } = await import("./habit-reminder-plan");
      const stored = readProtectedWorkspace(localStorage, key, raw => normalizeHabitWorkspace(raw as Parameters<typeof normalizeHabitWorkspace>[0]), () => habitWorkspaceRef.current);
      const live = habitWorkspaceRef.current;
      // A freshly saved local tab wins; newer unsaved definitions still prevent stale quick actions.
      const savedHabit=stored.habits.find(item=>item.id===target.habitId),liveHabit=live.habits.find(item=>item.id===target.habitId);
      const savedCompletion=stored.habitCompletions.find(item=>item.habitId===target.habitId&&item.date===target.date);
      const liveCompletion=live.habitCompletions.find(item=>item.habitId===target.habitId&&item.date===target.date);
      const base = !savedHabit || savedHabit && liveHabit && savedHabit.updatedAt > liveHabit.updatedAt
        || savedCompletion && (!liveCompletion || savedCompletion.updatedAt>liveCompletion.updatedAt) ? stored : live;
      if (stored.habitCompletions.some(item=>item.habitId===target.habitId&&item.date===target.date&&item.completed)) return;
      const next = input ? applyHabitReminderInput(base,target,input,new Date()) : completeHabitReminder(base, target, new Date());
      if(next===base)return;
      await updateHabitWorkspace(next, true);guard();
      writeProtectedWorkspace(localStorage, key, {tasks:tasksRef.current,projects:projectsRef.current,categories:categoriesRef.current,
        taskLists:taskListsRef.current,taskListLinks:taskListLinksRef.current,...habitWorkspaceRef.current});
    });
  };

  const runHabitHistoryCommand = async (command:HabitHistoryCommand) => {
    const key=cloudUser?`${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}`:GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    const guard=cloudUser?captureAccountSessionGuard():()=>{if(privateDeviceAccessBlocked())throw Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED");};
    await withHabitTimerLock(key,async()=>{
      guard();const {applyHabitHistoryCommand}=await import("./habit-history-workspace");
      const stored=readProtectedWorkspace(localStorage,key,raw=>normalizeHabitWorkspace(raw as Parameters<typeof normalizeHabitWorkspace>[0]),()=>habitWorkspaceRef.current);
      const base=normalizeHabitWorkspace(preserveHabitTimerRecords(stored,habitWorkspaceRef.current),activeTaskCalendarMode);
      const next=applyHabitHistoryCommand(base,command,activeTaskCalendarMode);
      await updateHabitWorkspace(next,true,true);guard();
      writeProtectedWorkspace(localStorage,key,{tasks:tasksRef.current,projects:projectsRef.current,categories:categoriesRef.current,
        taskLists:taskListsRef.current,taskListLinks:taskListLinksRef.current,...habitWorkspaceRef.current});
    });
  };

  const runHabitLifecycleCommand = async (command: HabitLifecycleCommand) => {
    const key = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    const guard = cloudUser ? captureAccountSessionGuard() : () => { if (privateDeviceAccessBlocked()) throw Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED"); };
    await withHabitTimerLock(key, async () => {
      guard();
      const { applyHabitLifecycleToWorkspace } = await import("./habits");
      const stored = readProtectedWorkspace(localStorage, key, raw => normalizeHabitWorkspace(raw as Parameters<typeof normalizeHabitWorkspace>[0]), () => habitWorkspaceRef.current);
      const base = normalizeHabitWorkspace(preserveHabitTimerRecords(stored, habitWorkspaceRef.current), activeTaskCalendarMode);
      const next = applyHabitLifecycleToWorkspace(base, command);
      await updateHabitWorkspace(next, true, true); guard();
      writeProtectedWorkspace(localStorage, key, { tasks: tasksRef.current, projects: projectsRef.current,
        categories: categoriesRef.current, taskLists: taskListsRef.current, taskListLinks: taskListLinksRef.current, ...habitWorkspaceRef.current });
    });
  };

  const runHabitDayDecision = async (command: HabitDayDecisionCommand, scope: string) => {
    const account = cloudUser?.uid ?? "local";
    const guard = cloudUser ? captureAccountSessionGuard() : () => { if (privateDeviceAccessBlocked()) throw Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED"); };
    const check = () => { guard(); if ((cloudUserRef.current?.uid ?? "local") !== scope || scope !== account) throw Error("HABIT_HISTORY_DATE_UNAVAILABLE"); };
    const key = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    await withHabitTimerLock(key, async () => {
      check();
      const { applyHabitDayDecision } = await import("./habit-day-decision");
      const stored = readProtectedWorkspace(localStorage, key, raw => normalizeHabitWorkspace(raw as Parameters<typeof normalizeHabitWorkspace>[0]), () => habitWorkspaceRef.current);
      const base = normalizeHabitWorkspace(preserveHabitTimerRecords(stored, habitWorkspaceRef.current), activeTaskCalendarMode);
      const next = applyHabitDayDecision(base, command);
      check();
      if (next === base) return;
      await updateHabitWorkspace(next, true, true);
      check();
      writeProtectedWorkspace(localStorage, key, { tasks: tasksRef.current, projects: projectsRef.current,
        categories: categoriesRef.current, taskLists: taskListsRef.current, taskListLinks: taskListLinksRef.current, ...habitWorkspaceRef.current });
    });
  };

  const runHabitRestorePreview = async (text: string, scope: string) => {
    requireDataTransfer(cloudUserRef.current?.featureAccess);
    const account = cloudUser?.uid ?? "local";
    const guard = cloudUser ? captureAccountSessionGuard() : () => { if (privateDeviceAccessBlocked()) throw Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED"); };
    const check = () => { guard(); requireDataTransfer(cloudUserRef.current?.featureAccess); if ((cloudUserRef.current?.uid ?? "local") !== scope || scope !== account) throw Error("HABIT_RESTORE_STALE"); };
    const key = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    return withHabitTimerLock(key, async () => {
      check();
      const { previewHabitRestore } = await import("./habit-backup-restore");
      const stored = readProtectedWorkspace(localStorage, key, raw => normalizeHabitWorkspace(raw as Parameters<typeof normalizeHabitWorkspace>[0]), () => habitWorkspaceRef.current);
      const base = normalizeHabitWorkspace(preserveHabitTimerRecords(stored, habitWorkspaceRef.current), activeTaskCalendarMode);
      const preview = await previewHabitRestore(base, text);
      check();
      return preview;
    });
  };

  const runHabitRestore = async (request: HabitRestoreRequest, scope: string) => {
    requireDataTransfer(cloudUserRef.current?.featureAccess);
    const account = cloudUser?.uid ?? "local";
    const guard = cloudUser ? captureAccountSessionGuard() : () => { if (privateDeviceAccessBlocked()) throw Error("LOCAL_WORKSPACE_RECOVERY_REQUIRED"); };
    const check = () => { guard(); requireDataTransfer(cloudUserRef.current?.featureAccess); if ((cloudUserRef.current?.uid ?? "local") !== scope || scope !== account) throw Error("HABIT_RESTORE_STALE"); };
    const key = cloudUser ? `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}` : GENESIS_LEGACY_WORKSPACE_STORAGE_KEY;
    await withHabitTimerLock(key, async () => {
      check();
      const { applyHabitRestore } = await import("./habit-backup-restore");
      const stored = readProtectedWorkspace(localStorage, key, raw => normalizeHabitWorkspace(raw as Parameters<typeof normalizeHabitWorkspace>[0]), () => habitWorkspaceRef.current);
      const base = normalizeHabitWorkspace(preserveHabitTimerRecords(stored, habitWorkspaceRef.current), activeTaskCalendarMode);
      const next = await applyHabitRestore(base, request);
      check();
      if (next === base) return;
      await updateHabitWorkspace(next, true, true);
      check();
      writeProtectedWorkspace(localStorage, key, { tasks: tasksRef.current, projects: projectsRef.current,
        categories: categoriesRef.current, taskLists: taskListsRef.current, taskListLinks: taskListLinksRef.current, ...habitWorkspaceRef.current });
    });
  };

  const resetAllHabitTracking = async () => {
    if (!cloudUser) throw new Error(language === "en" ? "Sign in to reset habit data." : "Войдите в аккаунт, чтобы обнулить данные привычек.");
    const clearedWorkspace = resetHabitWorkspace(habitWorkspace);
    const reminderIds = new Set(habitWorkspace.habits.flatMap((habit) => (
      [habit.reminder.googleTaskId, habit.reminder.googleEventId].filter((id): id is string => Boolean(id))
    )));
    const reminderTasks = tasks.filter((task) => reminderIds.has(task.id));
    const remainingTasks = tasks.filter((task) => !reminderIds.has(task.id));
    setSyncStatus("syncing");
    setSyncError("");
    try {
      if (habitSaveTimerRef.current !== null) {
        window.clearTimeout(habitSaveTimerRef.current);
        habitSaveTimerRef.current = null;
      }
      const analyticsCacheCleared = await clearTrackerAnalyticsCache(cloudUser.uid);
      if (!analyticsCacheCleared) {
        throw new Error(language === "en"
          ? "The local statistics cache could not be cleared. Nothing was reset."
          : "Не удалось очистить локальный кэш статистики. Данные привычек не были обнулены.");
      }
      await Promise.all(reminderTasks.map((task) => removeCloudTask(cloudUser.uid, task)));
      await saveWorkspaceStructure(
        projectsRef.current,
        categoriesRef.current,
        taskListLinksRef.current,
        metricsFor(remainingTasks, projectsRef.current, 0),
        clearedWorkspace,
        cloudUser.authProvider !== "google" ? taskLists : undefined,
      );
      tasksRef.current = remainingTasks;
      habitWorkspaceRef.current = clearedWorkspace;
      writeProtectedWorkspace(localStorage, `${GENESIS_USER_WORKSPACE_STORAGE_PREFIX}${cloudUser.uid}`,
        { tasks: remainingTasks, projects: projectsRef.current, categories: categoriesRef.current,
          taskLists: taskListsRef.current, taskListLinks: taskListLinksRef.current, ...clearedWorkspace });
      setTasks(remainingTasks);
      setHabitWorkspace(clearedWorkspace);
      setSyncStatus("synced");
    } catch (error) {
      const resetError = error instanceof Error
        ? error
        : new Error(language === "en" ? "Habit data could not be reset." : "Не удалось обнулить данные привычек.");
      setSyncError(resetError.message);
      setSyncStatus(navigator.onLine ? "error" : "offline");
      throw resetError;
    }
  };

  useEffect(() => () => {
    if (habitSaveTimerRef.current !== null) window.clearTimeout(habitSaveTimerRef.current);
  }, []);

  const persistStructure = (
    nextProjects: GenesisProject[],
    nextCategories: GenesisCategory[],
    nextTaskListLinks: TaskListProjectLink[] = taskListLinks,
    nextTaskLists: GoogleTaskList[] = taskLists,
  ) => {
    if (!cloudUser) return Promise.resolve();
    setSyncStatus("syncing");
    return saveWorkspaceStructure(nextProjects, nextCategories, nextTaskListLinks,
      metricsFor(tasks, nextProjects, habitWorkspace.habits.length), habitWorkspace,
      cloudUser.authProvider !== "google" ? nextTaskLists : undefined)
      .then(() => setSyncStatus("synced"))
      .catch((error: Error) => {
        setSyncError(error.message);
        setSyncStatus(navigator.onLine ? "error" : "offline");
      });
  };

  const addGoogleTaskList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTaskListTitle.trim();
    if (!title || !cloudUser) return;
    setSyncStatus("syncing");
    try {
      const { taskList } = await createGoogleTaskList(title, newTaskListAccountId || defaultSyncAccountIds[0]);
      setTaskLists((current) => [...current.filter((item) => item.id !== taskList.id), taskList]);
      const nextLinks = [
        ...taskListLinks.filter((link) => link.taskListId !== taskList.id),
        { taskListId: taskList.id, projectId: newTaskListProject || null },
      ];
      setTaskListLinks(nextLinks);
      persistStructure(projects, categories, nextLinks,
        [...taskLists.filter((item) => item.id !== taskList.id), taskList]);
      const draftedTasks = newTaskListDrafts
        .filter((draft) => draft.title.trim())
        .map((draft) => taskForList(draft.title, draft.dueDate || todayDateValue, taskList, newTaskListProject, taskFormCalendarMode));
      if (draftedTasks.length) {
        setTasks((current) => [...current, ...draftedTasks]);
        draftedTasks.forEach(saveTask);
      }
      setTaskComposer(null);
      setNewTaskListTitle("");
      setNewTaskListAccountId("");
      setNewTaskListDrafts([{ id: uid(), title: "", dueDate: "" }]);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Не удалось создать список Google Tasks");
      setSyncStatus(navigator.onLine ? "error" : "offline");
    }
  };

  const addTasksToExistingList = (event: FormEvent<HTMLFormElement>, taskList: GoogleTaskList) => {
    event.preventDefault();
    const titles = (taskListBatchTitles[taskList.id] ?? "").split(/\r?\n/);
    const projectId = taskListLinks.find((link) => link.taskListId === taskList.id)?.projectId ?? "";
    appendTasksToList(titles, taskListBatchDates[taskList.id] || todayDateValue, taskList, projectId ?? "");
    setTaskListBatchTitles((current) => ({ ...current, [taskList.id]: "" }));
  };

  const saveTaskListEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingTaskList) return;
    const title = editingTaskList.title.trim();
    if (!title) return;
    setSyncStatus("syncing");
    try {
      const { taskList } = await updateGoogleTaskList(editingTaskList.id, title, editingTaskList.accountId);
      setTaskLists((current) => current.map((item) => item.id === taskList.id
        ? { ...item, ...taskList, isDefault: item.isDefault || taskList.isDefault }
        : item));
      setTasks((current) => current.map((task) => task.googleTaskListId === taskList.id
        ? { ...task, googleTaskListTitle: taskList.title }
        : task));
      setEditingTaskList(null);
      if (cloudUser?.authProvider !== "google") {
        await persistStructure(projects, categories, taskListLinks,
          taskLists.map((item) => item.id === taskList.id ? { ...item, ...taskList } : item));
      }
      setSyncStatus("synced");
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Не удалось переименовать список Google Tasks");
      setSyncStatus(navigator.onLine ? "error" : "offline");
    }
  };

  const deleteTaskList = async (taskList: GoogleTaskList) => {
    if (taskList.isDefault) {
      setSyncError("Основной список Google Tasks нельзя удалить. Пока он пуст и не привязан к проекту, GENESIS скрывает его автоматически.");
      return false;
    }
    const listTaskCount = tasks.filter((task) => task.googleTaskListId === taskList.id).length;
    const taskCountLabel = listTaskCount === 1 ? "1 задачей" : `${listTaskCount} задачами`;
    if (!window.confirm(translateText(cloudUser?.authProvider !== "google"
      ? `Удалить список «${taskList.title}» вместе с ${taskCountLabel}? Это действие нельзя отменить.`
      : `Удалить список «${taskList.title}» вместе с ${taskCountLabel}? Он будет удалён из Google Tasks. Это действие нельзя отменить.`, undefined, true))) return false;
    setSyncStatus("syncing");
    try {
      await removeGoogleTaskList(taskList.id, taskList.accountId);
      const nextTasks = tasks.filter((task) => task.googleTaskListId !== taskList.id);
      const nextLinks = taskListLinks.filter((link) => link.taskListId !== taskList.id);
      setTasks(nextTasks);
      setTaskLists((current) => current.filter((item) => item.id !== taskList.id));
      setTaskListLinks(nextLinks);
      setTaskTaskListId((current) => current === taskList.id ? "" : current);
      setTaskListBatchTitles((current) => {
        const next = { ...current };
        delete next[taskList.id];
        return next;
      });
      setTaskListBatchDates((current) => {
        const next = { ...current };
        delete next[taskList.id];
        return next;
      });
      if (editingTask?.googleTaskListId === taskList.id) setEditingTask(null);
      if (editingTaskList?.id === taskList.id) setEditingTaskList(null);
      persistStructure(projects, categories, nextLinks,
        taskLists.filter((item) => item.id !== taskList.id));
      return true;
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Не удалось удалить список Google Tasks");
      setSyncStatus(navigator.onLine ? "error" : "offline");
      return false;
    }
  };

  const updateNewTaskListDraft = (id: string, patch: Partial<Omit<TaskListDraft, "id">>) => {
    setNewTaskListDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  };

  const linkTaskListToProject = (taskListId: string, projectId: string) => {
    const nextLinks = [
      ...taskListLinks.filter((link) => link.taskListId !== taskListId),
      { taskListId, projectId: projectId || null },
    ];
    setTaskListLinks(nextLinks);
    persistStructure(projects, categories, nextLinks);
  };

  const projectDropTargetAt = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-project-drop-id]");
    return element?.dataset.projectDropId ?? "";
  };

  const stopProjectAutoScroll = () => {
    if (projectAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(projectAutoScrollFrameRef.current);
      projectAutoScrollFrameRef.current = null;
    }
    projectDragPointRef.current = null;
    projectAutoScrollLastFrameRef.current = null;
  };

  const projectAutoScrollStep = (timestamp: number) => {
    projectAutoScrollFrameRef.current = null;
    const point = projectDragPointRef.current;
    const dragActive = Boolean(projectPointerDragRef.current?.active || projectTouchDragRef.current?.active);
    const scrollingElement = document.scrollingElement;
    if (!point || !dragActive || !scrollingElement) {
      projectAutoScrollLastFrameRef.current = null;
      return;
    }

    const previousTimestamp = projectAutoScrollLastFrameRef.current ?? timestamp - (1000 / 60);
    const elapsedSeconds = Math.min(40, Math.max(1, timestamp - previousTimestamp)) / 1000;
    const containers: Element[] = [];
    let element = document.elementFromPoint(point.x, point.y);
    while (element && element !== scrollingElement) {
      if (element.scrollHeight > element.clientHeight && /auto|scroll/.test(window.getComputedStyle(element).overflowY)) containers.push(element);
      element = element.parentElement;
    }
    element = projectDragSourceRef.current;
    while (element && element !== scrollingElement) {
      if (!containers.includes(element) && element.scrollHeight > element.clientHeight && /auto|scroll/.test(window.getComputedStyle(element).overflowY)) containers.push(element);
      element = element.parentElement;
    }
    containers.push(scrollingElement);
    const moved = containers.some((container) => {
      const viewport = container === scrollingElement;
      const bounds = container.getBoundingClientRect();
      if (!viewport && (point.x < bounds.left || point.x > bounds.right)) return false;
      const top = viewport ? 0 : Math.max(0, bounds.top);
      const bottom = viewport ? window.innerHeight : Math.min(window.innerHeight, bounds.bottom);
      const edge = Math.min(PROJECT_DRAG_SCROLL_EDGE, (bottom - top) / 3);
      if (edge <= 0) return false;
      const direction = point.y < top + edge ? -1 : point.y > bottom - edge ? 1 : 0;
      if (!direction) return false;
      const depth = direction < 0 ? top + edge - point.y : point.y - (bottom - edge);
      const speed = PROJECT_DRAG_SCROLL_MIN_SPEED + Math.min(1, depth / edge) * (PROJECT_DRAG_SCROLL_MAX_SPEED - PROJECT_DRAG_SCROLL_MIN_SPEED);
      const next = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + direction * speed * elapsedSeconds));
      if (Math.abs(next - container.scrollTop) < .5) return false;
      if (viewport) window.scrollTo({ top: next, left: window.scrollX, behavior: "instant" });
      else container.scrollTo({ top: next, behavior: "instant" });
      return true;
    });
    if (!moved) {
      projectAutoScrollLastFrameRef.current = null;
      return;
    }

    projectAutoScrollLastFrameRef.current = timestamp;
    setProjectDropTargetId(projectDropTargetAt(point.x, point.y));
    projectAutoScrollFrameRef.current = window.requestAnimationFrame(projectAutoScrollStep);
  };

  const updateProjectDragPoint = (clientX: number, clientY: number) => {
    const point = { x: clientX, y: clientY };
    projectDragPointRef.current = point;
    setProjectTouchPoint(point);
    setProjectDropTargetId(projectDropTargetAt(clientX, clientY));
    if (projectAutoScrollFrameRef.current === null) {
      projectAutoScrollFrameRef.current = window.requestAnimationFrame(projectAutoScrollStep);
    }
  };

  const resetProjectDrag = () => {
    stopProjectAutoScroll();
    document.documentElement.classList.remove("project-drag-active");
    setProjectDragItem(null);
    setProjectTouchPoint(null);
    setProjectDropTargetId("");
  };

  const moveProjectItemToProject = (item: ProjectDragItem, projectId: string) => {
    const moveToInbox = projectId === TASK_INBOX_PROJECT_ID;
    const project = moveToInbox ? null : projects.find((candidate) => candidate.id === projectId);
    if (!moveToInbox && !project) return;

    if (item.kind === "task") {
      const task = tasks.find((candidate) => candidate.id === item.id);
      if (!task || (moveToInbox ? task.projectId === TASK_INBOX_PROJECT_ID : resolvedTaskProjectId(task) === project?.id)) return;
      const nextTask: Task = {
        ...task,
        project: project?.title ?? "",
        projectId: project?.id ?? TASK_INBOX_PROJECT_ID,
        categoryId: project?.categoryId ?? null,
        updatedAt: timestamp(),
      };
      setTasks((current) => current.map((candidate) => candidate.id === nextTask.id ? nextTask : candidate));
      saveTask(nextTask);
      setProjectMoveAnnouncement(moveToInbox
        ? `Задача «${item.title}» возвращена в хаос-бокс.`
        : `Задача «${item.title}» перемещена в проект «${project?.title}».`);
      return;
    }

    const currentProjectId = taskListLinks.find((link) => link.taskListId === item.id)?.projectId ?? null;
    if (currentProjectId === (project?.id ?? null)) return;
    linkTaskListToProject(item.id, project?.id ?? "");
    setProjectMoveAnnouncement(moveToInbox
      ? `Список «${item.title}» возвращён в хаос-бокс.`
      : `Список «${item.title}» перемещён в проект «${project?.title}».`);
  };

  const beginProjectPointerDrag = (event: PointerEvent<HTMLElement>, item: ProjectDragItem) => {
    if (event.pointerType === "touch" || event.button !== 0 || projectDragControl(event.target)) return;
    projectDragSourceRef.current = event.currentTarget;
    // Keep a simple click targeted at the task/list opener while retaining drag capture.
    const captureTarget = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-affair-drag-surface]") ?? event.currentTarget : event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    projectPointerDragRef.current = {
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const moveProjectPointerDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = projectPointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
      drag.active = true;
      document.documentElement.classList.add("project-drag-active");
      setProjectDragItem(drag.item);
    }
    if (!drag.active) return;
    event.preventDefault();
    updateProjectDragPoint(event.clientX, event.clientY);
  };

  const finishProjectPointerDrag = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const drag = projectPointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    projectPointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.active) return;
    event.preventDefault();
    const projectId = cancelled ? "" : projectDropTargetAt(event.clientX, event.clientY);
    if (projectId) moveProjectItemToProject(drag.item, projectId);
    suppressProjectItemClickRef.current = true;
    window.setTimeout(() => {
      suppressProjectItemClickRef.current = false;
    }, 350);
    resetProjectDrag();
  };

  const beginProjectTouchDrag = (event: TouchEvent<HTMLElement>, item: ProjectDragItem) => {
    if (event.touches.length !== 1) {
      const previous = projectTouchDragRef.current;
      if (previous) window.clearTimeout(previous.timer);
      projectTouchDragRef.current = null;
      resetProjectDrag();
      return;
    }
    if (projectDragControl(event.target)) return;
    projectDragSourceRef.current = event.currentTarget;
    const touch = event.touches[0];
    const previous = projectTouchDragRef.current;
    if (previous) window.clearTimeout(previous.timer);
    const drag = {
      item,
      startX: touch.clientX,
      startY: touch.clientY,
      active: false,
      timer: 0,
    };
    drag.timer = window.setTimeout(() => {
      if (projectTouchDragRef.current !== drag) return;
      drag.active = true;
      document.documentElement.classList.add("project-drag-active");
      setProjectDragItem(drag.item);
      updateProjectDragPoint(drag.startX, drag.startY);
    }, 450);
    projectTouchDragRef.current = drag;
  };

  const moveProjectTouchDrag = (event: TouchEvent<HTMLElement>) => {
    const drag = projectTouchDragRef.current;
    const touch = event.touches[0];
    if (!drag || !touch) return;
    if (!drag.active && Math.hypot(touch.clientX - drag.startX, touch.clientY - drag.startY) > 8) {
      window.clearTimeout(drag.timer);
      projectTouchDragRef.current = null;
      return;
    }
    if (!drag.active) return;
    updateProjectDragPoint(touch.clientX, touch.clientY);
  };

  const finishProjectTouchDrag = (event: TouchEvent<HTMLElement>, cancelled = false) => {
    const drag = projectTouchDragRef.current;
    if (!drag) return;
    window.clearTimeout(drag.timer);
    projectTouchDragRef.current = null;
    if (!drag.active) return;
    const touch = event.changedTouches[0];
    const projectId = cancelled || !touch ? "" : projectDropTargetAt(touch.clientX, touch.clientY);
    if (projectId) moveProjectItemToProject(drag.item, projectId);
    suppressProjectItemClickRef.current = true;
    window.setTimeout(() => {
      suppressProjectItemClickRef.current = false;
    }, 350);
    resetProjectDrag();
  };

  const projectDragControl = (target: EventTarget) => {
    if (!(target instanceof Element)) return false;
    const control=target.closest("button,input,select,textarea,a,summary,label,[contenteditable=true]");
    return Boolean(control&&!control.hasAttribute("data-affair-drag-surface"));
  };

  const projectDragProps = (item: ProjectDragItem) => ({
    "data-project-item-id": item.id,
    "data-project-dragging": projectDragItem?.id === item.id && projectDragItem.kind === item.kind,
    onPointerDown: (event: PointerEvent<HTMLElement>) => beginProjectPointerDrag(event, item),
    onPointerMove: moveProjectPointerDrag,
    onPointerUp: (event: PointerEvent<HTMLElement>) => finishProjectPointerDrag(event),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finishProjectPointerDrag(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finishProjectPointerDrag(event, true),
    onDragStart: (event: React.DragEvent<HTMLElement>) => { if (projectPointerDragRef.current) event.preventDefault(); },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (suppressProjectItemClickRef.current) { event.preventDefault(); event.stopPropagation(); }
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (projectTouchDragRef.current) event.preventDefault();
    },
    onTouchStart: (event: TouchEvent<HTMLElement>) => beginProjectTouchDrag(event, item),
    onTouchMove: moveProjectTouchDrag,
    onTouchEnd: (event: TouchEvent<HTMLElement>) => finishProjectTouchDrag(event),
    onTouchCancel: (event: TouchEvent<HTMLElement>) => finishProjectTouchDrag(event, true),
  });

  const addProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!featureQuotaAllows(cloudUser?.featureAccess,'personal-projects',projects.length)) {
      requestUpgrade({resource:'personal-projects',limit:featureLimit(cloudUser?.featureAccess,'personal-projects'),used:projects.length,reason:'quota'});
      setSyncError(language==='en' ? `Your plan allows ${featureLimit(cloudUser?.featureAccess,'personal-projects')} personal projects. Existing projects remain available.` : translateText('Достигнут лимит тарифа. Существующие данные сохраняются. Изменить тариф можно в настройках аккаунта.',language));
      return;
    }
    const title = newProjectTitle.trim();
    if (!title) return;
    const tags = newProjectTags
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean)
      .slice(0, 10);
    const project: GenesisProject = {
      id: uid(),createdAt:new Date().toISOString(),createdByName:cloudUser?.displayName??undefined,
      parentId: newProjectParent || null,
      categoryId: newProjectCategory || null,
      title,
      description: newProjectDescription.trim(),
      tags,
      status: "active",
      position: projects.length,
    };
    const nextProjects = [...projects, project];
    setProjects(nextProjects);
    persistStructure(nextProjects, categories);
    setNewProjectTitle("");
    setNewProjectDescription("");
    setExperimentalProjectFormOpen(false);
    setNewProjectTags("");
  };

  const applyAssistantPlan = async (plan: GeminiPlan): Promise<string> => {
    const nameKey = (value: string) => value.trim().toLocaleLowerCase(runtimeLocale());
    const isValidDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T12:00:00`);
      return !Number.isNaN(parsed.getTime()) && inputDate(parsed) === value;
    };

    const preparedTasks = plan.tasks.map((task) => {
      const startDate = task.startDate || todayDateValue;
      const dueDate = task.dueDate || startDate;
      if (!isValidDate(startDate) || !isValidDate(dueDate)) {
        throw new Error(language === "en" ? `The assistant returned an invalid date for “${task.title}”.` : `Помощник указал некорректную дату для задачи «${task.title}».`);
      }
      if (startDate < todayDateValue) {
        throw new Error(language === "en" ? `The start date for “${task.title}” is in the past.` : `Дата начала задачи «${task.title}» находится в прошлом.`);
      }
      if (dueDate < startDate) {
        throw new Error(language === "en" ? `The deadline for “${task.title}” is before its start date.` : `Срок задачи «${task.title}» раньше даты начала.`);
      }
      return { ...task, startDate, dueDate };
    });

    const categoryByName = new Map(categories.flatMap((category) => [
      [nameKey(category.name), category] as const,
      [nameKey(localizeCategoryName(category, language)), category] as const,
    ]));
    const existingProjectByName = new Map(projects.map((project) => [nameKey(project.title), project]));
    const newProjectPlanByName = new Map(plan.projects.map((project) => [nameKey(project.title), project]));
    for (const projectPlan of plan.projects) {
      if (projectPlan.category && !categoryByName.has(nameKey(projectPlan.category))) {
        throw new Error(language === "en" ? `Category “${projectPlan.category}” was not found.` : `Категория «${projectPlan.category}» не найдена.`);
      }
      if (projectPlan.parentProject
        && !existingProjectByName.has(nameKey(projectPlan.parentProject))
        && !newProjectPlanByName.has(nameKey(projectPlan.parentProject))) {
        throw new Error(language === "en" ? `Parent project “${projectPlan.parentProject}” was not found.` : `Родительский проект «${projectPlan.parentProject}» не найден.`);
      }
    }
    for (const projectPlan of plan.projects) {
      const path = new Set<string>();
      let cursor = nameKey(projectPlan.title);
      while (cursor && newProjectPlanByName.has(cursor)) {
        if (path.has(cursor)) {
          throw new Error(language === "en" ? "The assistant proposed a circular project hierarchy." : "Помощник предложил циклическую иерархию проектов.");
        }
        path.add(cursor);
        cursor = nameKey(newProjectPlanByName.get(cursor)?.parentProject ?? "");
      }
    }
    const provisionalProjects: GenesisProject[] = [];
    for (const projectPlan of plan.projects) {
      const key = nameKey(projectPlan.title);
      if (!key || existingProjectByName.has(key) || provisionalProjects.some((project) => nameKey(project.title) === key)) continue;
      provisionalProjects.push({
        id: uid(),
        parentId: null,
        categoryId: categoryByName.get(nameKey(projectPlan.category))?.id ?? null,
        title: projectPlan.title.trim(),
        description: projectPlan.description.trim(),
        tags: projectPlan.tags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean).slice(0, 10),
        status: "active",
        position: projects.length + provisionalProjects.length,
      });
    }
    const allProjectByName = new Map([...projects, ...provisionalProjects].map((project) => [nameKey(project.title), project]));
    const createdProjects = provisionalProjects.map((project) => {
      const source = newProjectPlanByName.get(nameKey(project.title));
      const parent = source?.parentProject ? allProjectByName.get(nameKey(source.parentProject)) : null;
      return { ...project, parentId: parent && parent.id !== project.id ? parent.id : null };
    });
    const nextProjects = [...projects, ...createdProjects];
    const projectByName = new Map(nextProjects.map((project) => [nameKey(project.title), project]));

    for (const task of preparedTasks) {
      if (task.project && !projectByName.has(nameKey(task.project))) {
        throw new Error(language === "en" ? `Project “${task.project}” was not found.` : `Проект «${task.project}» не найден.`);
      }
    }

    const plannedListByName = new Map(plan.taskLists.map((taskList) => [nameKey(taskList.title), taskList]));
    const knownListNames = new Set([...taskLists.map((taskList) => nameKey(taskList.title)), ...plannedListByName.keys()]);
    for (const task of preparedTasks) {
      if (task.taskList && !knownListNames.has(nameKey(task.taskList))) {
        throw new Error(language === "en" ? `Google Tasks list “${task.taskList}” was not found.` : `Список Google Tasks «${task.taskList}» не найден.`);
      }
    }
    for (const taskList of plan.taskLists) {
      if (taskList.project && !projectByName.has(nameKey(taskList.project))) {
        throw new Error(language === "en" ? `Project “${taskList.project}” was not found.` : `Проект «${taskList.project}» не найден.`);
      }
      if (taskList.accountEmail && !googleAccounts.some((account) => nameKey(account.email) === nameKey(taskList.accountEmail))) {
        throw new Error(language === "en" ? `Google account “${taskList.accountEmail}” is not connected.` : `Google-аккаунт «${taskList.accountEmail}» не подключён.`);
      }
    }
    const needsNewTaskLists = plan.taskLists.some((planned) => !taskLists.some((existing) => nameKey(existing.title) === nameKey(planned.title)));
    if (needsNewTaskLists && !cloudUser?.calendarConnected) {
      throw new Error(cloudUser?.authProvider === "yandex"
        ? "Подключите Яндекс.Календарь перед созданием списка задач."
        : language === "en" ? "Connect Google Calendar and Tasks before creating a task list." : "Подключите Google Calendar и Tasks перед созданием списка задач.");
    }

    setSyncStatus("syncing");
    let nextTaskLists = [...taskLists];
    let nextTaskListLinks = [...taskListLinks];
    let createdTaskListCount = 0;
    for (const taskListPlan of plan.taskLists) {
      let taskList = nextTaskLists.find((item) => nameKey(item.title) === nameKey(taskListPlan.title));
      if (!taskList) {
        const accountId = googleAccounts.find((account) => nameKey(account.email) === nameKey(taskListPlan.accountEmail))?.id
          || defaultSyncAccountIds[0];
        const result = await createGoogleTaskList(taskListPlan.title.trim(), accountId);
        taskList = result.taskList;
        nextTaskLists = [...nextTaskLists.filter((item) => item.id !== taskList?.id), taskList];
        createdTaskListCount += 1;
      }
      const currentProjectId = nextTaskListLinks.find((link) => link.taskListId === taskList.id)?.projectId ?? null;
      const projectId = taskListPlan.project ? projectByName.get(nameKey(taskListPlan.project))?.id ?? null : currentProjectId;
      nextTaskListLinks = [
        ...nextTaskListLinks.filter((link) => link.taskListId !== taskList.id),
        { taskListId: taskList.id, projectId },
      ];
    }

    const taskListByName = new Map(nextTaskLists.map((taskList) => [nameKey(taskList.title), taskList]));
    const createdTasks: Task[] = preparedTasks.map((taskPlan) => {
      const start = new Date(`${taskPlan.startDate}T12:00:00`);
      const sacred = getSacredDate(start);
      const project = taskPlan.project ? projectByName.get(nameKey(taskPlan.project)) ?? null : null;
      const taskList = taskPlan.taskList ? taskListByName.get(nameKey(taskPlan.taskList)) : undefined;
      return {
        id: uid(),
        sacredYear: sacred.sacredYear,
        monthIndex: sacred.monthIndex,
        day: sacred.day,
        dueDate: taskPlan.startDate,
        endDate: taskPlan.dueDate,
        title: taskPlan.title.trim(),
        description: taskPlan.description.trim(),
        time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(taskPlan.time) ? taskPlan.time : "",
        project: project?.title ?? "",
        projectId: project?.id ?? null,
        categoryId: project?.categoryId ?? null,
        tags: taskPlan.tags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean).slice(0, 6),
        dependsOnIds: [],
        priority: Math.min(10, Math.max(1, Number(taskPlan.priority) || 5)),
        done: false,
        completedAt: null,
        reminders: taskPlan.reminderMinutes > 0 ? [{ kind: "relative" as const, minutes: Math.min(40_320, taskPlan.reminderMinutes) }] : [],
        reminderMinutes: taskPlan.reminderMinutes > 0 ? Math.min(40_320, taskPlan.reminderMinutes) : null,
        recurrence: "none",
        recurrenceInterval: 1,
        recurrenceMode: "none",
        recurrencePattern: "none",
        recurrenceDays: [],
        recurrenceStartDate: null,
        recurrenceEndDate: null,
        recurrenceMonths: [],
        recurrencePyatas: [],
        recurrenceExcludedDates: [],
        recurrenceSeriesId: null,
        calendarMode: activeTaskCalendarMode,
        calendarNote: calendarDateNote(start, activeTaskCalendarMode),
        syncToGoogle: cloudUser?.authProvider === "google",
        syncAccountIds: syncAccountIdsForTask(project?.categoryId ?? null, taskList),
        googleLinks: {},
        googleAccountId: taskList?.accountId ?? null,
        googleAccountEmail: taskList?.accountEmail ?? "",
        createdIn: "genesis",
        googleEventId: null,
        googleTaskId: null,
        googleTaskListId: taskList?.id ?? null,
        googleTaskListTitle: taskList?.title ?? "",
        googleReadOnly: false,
        updatedAt: timestamp(),
      };
    });

    requireQuotaGrowth(cloudUser?.featureAccess,'personal-projects',projects.length,nextProjects.length);
    setProjects(nextProjects);
    setTaskLists(nextTaskLists);
    setTaskListLinks(nextTaskListLinks);
    if (createdTasks.length) {
      setTasks((current) => [...current, ...createdTasks]);
      if (createdTasks.length === 1) saveTask(createdTasks[0]);
      else saveTaskSeries(createdTasks);
    }
    if (createdProjects.length || plan.taskLists.length) {
      persistStructure(nextProjects, categories, nextTaskListLinks);
    } else if (!createdTasks.length) {
      setSyncStatus("synced");
    }

    if (createdTasks.length) navigateTo("all-tasks");
    else if (createdProjects.length || plan.taskLists.length) navigateTo("projects");

    return language === "en"
      ? `Created: ${createdProjects.length} projects, ${createdTaskListCount} task lists, ${createdTasks.length} tasks.`
      : `Создано: проектов — ${createdProjects.length}, списков — ${createdTaskListCount}, задач — ${createdTasks.length}.`;
  };

  const executeWebVoiceCommand = async (command: string): Promise<string> => {
    const { runWebVoiceCommand } = await import("./web-voice-executor");
    return runWebVoiceCommand(command, {
      language, calendarMode: activeTaskCalendarMode, currentView: view === "physis" || view === 'partners' ? "today" : view,
      today: todayDateValue, timeZone: deviceTimeZone,
      persistentWorkspace: Boolean(cloudUser) || !isGoogleSyncConfigured,
      divinationDisabled: Boolean(cloudUser?.stoicheionDivinationDisabled),
      categories, projects, taskLists, accounts: googleAccounts.map((account) => ({ email: account.email })),
      tasks, workspace: habitWorkspace,
    }, {
      navigate: navigateTo,
      requestHabit: (request) => setVoiceHabitRequest((current) => ({ ...request, token: (current?.token ?? 0) + 1 })),
      applyPlan: applyAssistantPlan,
      updateWorkspace: updateHabitWorkspace,
      openTask: openTaskEditor,
      confirmTaskDelete: (task) => setPendingTaskDeletion({ taskId: task.id, occurrenceDate: task.dueDate }),
      openList: list=>setPersonalPreview({kind:'task-list',id:list.id}),
      deleteList: deleteTaskList,
      openProject: openProjectEditor,
      deleteProject: (project) => deleteProject(project.id),
      createCategory,
      openCategory: beginCategoryEdit,
      deleteCategory: (category) => deleteCategory(category.id),
      toggleTask,
      changeTask: persistTaskChange,
      changeDisplayCalendar: async (mode) => {
        if (!cloudUser) throw new Error(language === "en" ? "Sign in to change calendar settings." : "Войдите, чтобы изменить календарь.");
        if (cloudUser.calendarMode === mode) return;
        const result = await updateAccountPreferences({ calendarMode: mode });
        setCloudUser(result.user);
      },
      stepCalendar: (unit, step) => {
        if (activeCalendarMode === "sacred") {
          if (unit === "year") changeSacredYear(sacredYear + step);
          else selectMonth(monthIndex + step);
        } else if (activeCalendarMode === "profane") {
          selectCalendarDate(new Date(selectedDate.getFullYear() + (unit === "year" ? step : 0),
            selectedDate.getMonth() + (unit === "month" ? step : 0), 1, 12));
        } else if (unit === "month") {
          selectCalendarDate(getLunarMonthStart(selectedLunarMonthIndex + step));
        } else {
          const target = getLunarYear(selectedLunarYear.sacredYear + step);
          selectCalendarDate(getLunarMonthStart(target.startMonthIndex +
            Math.min(selectedLunarMonthOrdinal - 1, target.monthCount - 1)));
        }
      },
      chooseCalendarMonth: (ordinal) => {
        if (activeCalendarMode === "sacred") {
          if (ordinal < 1 || ordinal > 13) return false;
          selectCalendarDate(getGregorianDate(sacredYear, ordinal - 1, 1));
        } else if (activeCalendarMode === "profane") {
          if (ordinal < 1 || ordinal > 12) return false;
          selectCalendarDate(new Date(selectedDate.getFullYear(), ordinal - 1, 1, 12));
        } else {
          if (ordinal < 1 || ordinal > selectedLunarYear.monthCount) return false;
          selectCalendarDate(getLunarMonthStart(selectedLunarYear.startMonthIndex + ordinal - 1));
        }
        return true;
      },
      chooseCalendarDate: selectCalendarDate,
      scrollPage: (direction) => {
        const scrollable = [document.querySelector<HTMLElement>(".app-stage"),
          document.querySelector<HTMLElement>(".workspace"), document.scrollingElement]
          .find((element) => element && element.scrollHeight > element.clientHeight + 8);
        if (!scrollable) return false;
        const top = direction === "top" ? 0 : direction === "bottom" ? scrollable.scrollHeight
          : scrollable.scrollTop + (direction === "down" ? 1 : -1) * Math.max(320, scrollable.clientHeight * 0.8);
        scrollable.scrollTo({ top, behavior: "smooth" });
        return true;
      },
      openTheokyklosSector,
      openStoicheionCard: setRequestedStoicheionCard,
      requestStoicheionDraw: setRequestedStoicheionDraw,
    });
  };
  const openProjectEditor = (project: GenesisProject) => {
    setEditingProject({ ...project, tags: [...project.tags] });
    setEditingProjectTags(project.tags.join(", "));
  };

  const saveProjectEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProject) return;
    const currentProject = projects.find((project) => project.id === editingProject.id);
    const title = editingProject.title.trim();
    if (!currentProject || !title) return;
    const parentId = editingProject.parentId === editingProject.id ? null : editingProject.parentId;
    const nextProject: GenesisProject = {
      ...editingProject,
      title,
      description: editingProject.description.trim(),
      parentId,
      tags: editingProjectTags.split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean).slice(0, 10),
    };
    const nextProjects = projects.map((project) => project.id === nextProject.id ? nextProject : project);
    const renamedTasks = currentProject.title === title ? [] : tasks
      .filter((task) => task.projectId === nextProject.id)
      .map((task) => ({ ...task, project: title, updatedAt: timestamp() }));
    if (renamedTasks.length) {
      const renamedById = new Map(renamedTasks.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => renamedById.get(task.id) ?? task));
      renamedTasks.forEach(saveTask);
    }
    setProjects(nextProjects);
    persistStructure(nextProjects, categories);
    setEditingProject(null);
  };

  const createCategory = (title: string) => {
    const name = title.trim();
    if (!name) return;
    const palette = ["#2d6c68", "#a5543f", "#b18b48", "#665c88", "#54718a"];
    const category: GenesisCategory = {
      id: uid(),
      name,
      color: palette[categories.length % palette.length],
      position: categories.length,
    };
    const nextCategories = [...categories, category];
    setCategories(nextCategories);
    persistStructure(projects, nextCategories);
    setNewCategoryTitle("");
  };

  const addCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createCategory(newCategoryTitle);
  };

  const beginCategoryEdit = (category: GenesisCategory) => {
    setEditingCategoryId(category.id);
    setEditingCategoryTitle(localizeCategoryName(category, language));
    setEditingCategoryColor(category.color);
  };

  const saveCategoryEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = editingCategoryTitle.trim();
    if (!editingCategoryId || !name) return;
    const nextCategories = categories.map((category) => category.id === editingCategoryId
      ? { ...category, name, color: editingCategoryColor }
      : category);
    setCategories(nextCategories);
    persistStructure(projects, nextCategories);
    setEditingCategoryId("");
  };

  const deleteCategory = (id: string): boolean => {
    const category = categories.find((item) => item.id === id);
    if (!category || !window.confirm(translateText(`Удалить категорию «${category.name}»? Проекты и задачи останутся, но будут перенесены в раздел «Без категории».`, undefined, true))) return false;
    const nextCategories = categories.filter((item) => item.id !== id);
    const nextProjects = projects.map((project) => project.categoryId === id ? { ...project, categoryId: null } : project);
    const changedTasks = tasks.filter((task) => task.categoryId === id).map((task) => ({
      ...task,
      categoryId: null,
      updatedAt: timestamp(),
    }));
    if (changedTasks.length) {
      const changedById = new Map(changedTasks.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => changedById.get(task.id) ?? task));
      changedTasks.forEach(saveTask);
    }
    setCategories(nextCategories);
    setProjects(nextProjects);
    setNewProjectCategory((current) => current === id ? (nextCategories[0]?.id ?? "") : current);
    if (editingCategoryId === id) setEditingCategoryId("");
    persistStructure(nextProjects, nextCategories);
    return true;
  };

  const deleteProject = async (id: string): Promise<boolean> => {
    const project = projects.find((item) => item.id === id);
    if (!project || !window.confirm(translateText(`Удалить проект «${project.title}» и все его подпроекты? Задачи останутся, но перейдут в раздел без проекта.`, undefined, true))) return false;
    const removed = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      projects.forEach((item) => {
        if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) {
          removed.add(item.id);
          changed = true;
        }
      });
    }
    const nextProjects = projects.filter((item) => !removed.has(item.id));
    const nextTaskListLinks = taskListLinks.map((link) => (
      link.projectId && removed.has(link.projectId) ? { ...link, projectId: null } : link
    ));
    const changedTasks = tasks.filter((task) => task.projectId && removed.has(task.projectId)).map((task) => ({
      ...task,
      project: "",
      projectId: null,
      categoryId: null,
      updatedAt: timestamp(),
    }));
    if (changedTasks.length) {
      const changedById = new Map(changedTasks.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => changedById.get(task.id) ?? task));
      changedTasks.forEach(saveTask);
    }
    projectsRef.current = nextProjects;
    taskListLinksRef.current = nextTaskListLinks;
    setProjects(nextProjects);
    setTaskProject((current) => removed.has(current) ? "" : current);
    setNewTaskListProject((current) => removed.has(current) ? "" : current);
    setTaskListLinks(nextTaskListLinks);
    await persistStructure(nextProjects, categories, nextTaskListLinks);
    return true;
  };

  const finishProjectTransfer = async (projectIds: string[], taskIds: string[]) => {
    if (!cloudUser) throw new Error(language === "en" ? "Sign in to move the project." : "Войдите в аккаунт для переноса проекта.");
    const removedProjects = new Set(projectIds);
    const removedTasks = new Set(taskIds);
    const toRemove = tasks.filter((task) => removedTasks.has(task.id));
    for (const task of toRemove) await removeCloudTaskForTransfer(task);
    const nextTasks = tasks.filter((task) => !removedTasks.has(task.id));
    const nextProjects = projects.filter((project) => !removedProjects.has(project.id));
    const nextLinks = taskListLinks.filter((link) => !link.projectId || !removedProjects.has(link.projectId));
    await saveWorkspaceStructure(nextProjects, categories, nextLinks,
      metricsFor(nextTasks, nextProjects, habitWorkspace.habits.length), habitWorkspace,
      cloudUser.authProvider !== "google" ? taskLists : undefined);
    tasksRef.current = nextTasks;
    projectsRef.current = nextProjects;
    taskListLinksRef.current = nextLinks;
    setTasks(nextTasks);
    setProjects(nextProjects);
    setTaskListLinks(nextLinks);
    setTaskProject((current) => removedProjects.has(current) ? "" : current);
    setSyncStatus("synced");
  };

  const exportCalendar = () => {
    if (!allowDataTransfer(cloudUserRef.current?.featureAccess)) return;
    if (!tasks.length) return;
    const events = tasks.filter(task => task.dueDate).map((task) => {
      const startDate = new Date(`${task.dueDate}T12:00:00`);
      const rangeEndDate = new Date(`${task.endDate || task.dueDate}T12:00:00`);
      const timed = Boolean(task.time);
      const start = timed
        ? `DTSTART:${icsDate(startDate, task.time)}`
        : `DTSTART;VALUE=DATE:${task.dueDate.replaceAll("-", "")}`;
      let end: string;
      if (timed) {
        const [hours = 0, minutes = 0] = task.time.split(":").map(Number);
        startDate.setHours(hours, minutes, 0, 0);
        rangeEndDate.setHours(hours, minutes, 0, 0);
        if (rangeEndDate <= startDate) rangeEndDate.setHours(rangeEndDate.getHours() + 1);
        const endTime = `${String(rangeEndDate.getHours()).padStart(2, "0")}:${String(rangeEndDate.getMinutes()).padStart(2, "0")}`;
        end = `DTEND:${icsDate(rangeEndDate, endTime)}`;
      } else {
        rangeEndDate.setDate(rangeEndDate.getDate() + 1);
        end = `DTEND;VALUE=DATE:${inputDate(rangeEndDate).replaceAll("-", "")}`;
      }
      return [
        "BEGIN:VEVENT",
        `UID:${task.id}@genesis-calendar`,
        start,
        end,
        `SUMMARY:${escapeIcs(task.title)}`,
        `DESCRIPTION:${escapeIcs([resolvedTaskProjectTitle(task), ...task.tags.map((tag) => `#${tag}`)].filter(Boolean).join(" · "))}`,
        "END:VEVENT",
      ].join("\r\n");
    });
    const content = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//GENESIS//Sacred Calendar//RU",
      "CALSCALE:GREGORIAN",
      ...events,
      "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/calendar;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "genesis-calendar.ics";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openTodayInCalendar = () => {
    selectCalendarDate(today);
    setDayDetailsOrigin("calendar");
    setDayDetailsOpen(true);
    navigateTo("calendar");
  };

  const openTaskComposer = (context: "today" | "projects") => {
    setMindmapConversion(null);
    setTaskUndated(false);
    setNewEntryType("task"); setYandexEntryType("task"); setYandexEndTime("");
    setTaskFormCalendar(activeTaskCalendarMode);
    setTaskRecurrenceConfig(alignRecurrenceConfigWithCalendar(taskRecurrenceConfig, activeTaskCalendarMode, todayDateValue));
    setTaskScope("personal"); setTaskListScope("personal"); setComposerTab("task");
    setTaskDueDate(todayDateValue); setTaskEndDate(todayDateValue);
    setTaskProject(""); setTaskTaskListId(""); setNewTaskListProject("");
    setTaskComposer(context);
  };
  const openTaskComposerForList = (list: GoogleTaskList) => {
    setPersonalListReturn({id:list.id,userId:cloudUser?.uid??'local'});
    setPersonalPreview(null);
    openTaskComposer('projects');
    setTaskTitle('');setTaskDescription('');setTaskTags('');setTaskDependsOn([]);setTaskPriority('5');setTaskSyncAccountIds(null);
    setTaskTaskListId(list.id);setTaskProject(linkedProjectId(list.id)??'');
    setTaskTime('');setTaskReminders([]);
    setTaskRecurrenceConfig(alignRecurrenceConfigWithCalendar(DEFAULT_RECURRENCE_CONFIG,activeTaskCalendarMode,todayDateValue));
  };
  const chooseTaskScope = (scope: "personal" | "shared") => {
    setTaskScope(scope); setTaskListScope(scope);
    if (scope === "shared" && newEntryType === "birthday") { setNewEntryType("task"); setComposerTab("task"); }
  };

  const toggleProject = (id: string) => {
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      projects.forEach((item) => {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; }
      });
    }
    const nextProjects = projects.map((item) => ids.has(item.id)
      ? { ...item, status: project.status === "active" ? "completed" as const : "active" as const, updatedAt: timestamp() } : item);
    setProjects(nextProjects); persistStructure(nextProjects, categories, taskListLinks);
    if (project.status === "active") {
      setCompletingProjectIds((current) => [...new Set([...current, ...ids])]);
      announce(language === "en" ? "Project completed" : "Проект завершён");
    } else announce(language === "en" ? "Project restored" : "Проект восстановлен");
  };

  const renderTaskListCreateForm = (context: "today" | "all-tasks" | "projects" | "composer") => (
    <div className="task-list-create-block">
      <p>{sharedProjectsAvailable && taskListScope === "shared"
        ? language === "en" ? "Team lists are stored in GENESIS and belong to a shared project."
          : "Общие списки хранятся в GENESIS и принадлежат выбранному общему проекту."
        : TASK_LIST_EXPLANATION}</p>
      {sharedProjectsAvailable && context !== "composer" && context !== "projects" ? <div className="task-scope-switch" role="group"
        aria-label={language === "en" ? "Task list access" : "Доступ к списку задач"}>
        <button type="button" aria-pressed={taskListScope === "personal"} onClick={() => setTaskListScope("personal")}>
          {language === "en" ? "Personal list" : "Личный список"}</button>
        <button type="button" aria-pressed={taskListScope === "shared"} onClick={() => setTaskListScope("shared")}>
          {language === "en" ? "Shared list" : "Общий список"}</button>
      </div> : null}
      {sharedProjectsAvailable && taskListScope === "shared" ? <Suspense fallback={
        <p role="status">{language === "en" ? "Loading team task lists…" : "Загружаем общие списки задач…"}</p>}>
        <SharedTaskLists language={language} enabledCalendars={visibility.enabledCalendars} embeddedCreate={context === "composer"}
          onCreated={() => setTaskComposer(null)}
          onOpenProject={() => { setProjectsArea("shared"); navigateTo("projects"); }} />
      </Suspense> : cloudUser?.googleTasksImportReady ? (
        <>
          {context !== "composer" && taskListsForWorkspace.length ? (
            <section className="task-list-workspace" aria-label="Существующие списки задач">
              <header>
                <div>
                  <span className="eyebrow">Рабочий стол</span>
                  <h3>Существующие списки</h3>
                </div>
                <small>Перетаскивайте задачи между колонками или выбирайте список в меню задачи.</small>
                <label className="task-order-choice"><span>{translateText("Сортировка задач",language)}</span><select value={personalTaskDisplay.sort} onChange={event=>personalTaskDisplay.setSort(event.target.value as TaskListOrder)}>{taskListOrders.map(order=><option key={order.value} value={order.value}>{translateText(order.ru,language)}</option>)}</select></label>
              </header>
              <div className="task-list-board">
                {taskListsForWorkspace.map((taskList) => {
                  const projectId = taskListLinks.find((link) => link.taskListId === taskList.id)?.projectId ?? "";
                  const listTasks = orderPersonalTasks(tasks.filter((task) => task.googleTaskListId === taskList.id),personalTaskDisplay.sort);
                  return (
                    <section
                      className={`task-list-column${taskListDropTargetId === taskList.id ? " drop-target" : ""}`}
                      key={taskList.id}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setTaskListDropTargetId(taskList.id);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTaskListDropTargetId("");
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const taskId = event.dataTransfer.getData("text/genesis-task-id");
                        const task = tasks.find((item) => item.id === taskId);
                        if (task) moveTaskToTaskList(task, taskList.id);
                        setTaskListDropTargetId("");
                      }}
                    >
                      <header>
                        <div className="task-list-column-heading">
                          <span><button type="button" className="task-preview-open task-list-entry-title" onClick={()=>setPersonalPreview({kind:"task-list",id:taskList.id})} data-no-translate>{taskList.title}</button><small className="task-list-entry-meta">{listTasks.length} задач{taskList.accountEmail ? ` · ${taskList.accountEmail}` : ""}</small></span>
                          <span className="task-list-column-actions">
                            <button type="button" onClick={() => setPersonalPreview({kind:'task-list',id:taskList.id})} aria-label={`Редактировать список «${taskList.title}»`}>{experimentalThemeActive ? <ExperimentalIcon name="edit" /> : "✎"}</button>
                            {!taskList.isDefault ? (
                              <button type="button" className="danger" onClick={() => void deleteTaskList(taskList)} aria-label={`Удалить список «${taskList.title}»`}>{experimentalThemeActive ? <ExperimentalIcon name="close" /> : "×"}</button>
                            ) : null}
                          </span>
                        </div>
                        {taskList.isDefault ? <span className="task-list-default-badge">Основной список Google · удалить нельзя</span> : null}
                        <label>
                          <span>Проект списка</span>
                          <select value={projectId} onChange={(event) => linkTaskListToProject(taskList.id, event.target.value)}>
                            <option value="">Без проекта</option>
                            {flattenProjects(projects).map(({ project, depth }) => (
                              <option value={project.id} key={project.id}>{"— ".repeat(depth)}{project.title}</option>
                            ))}
                          </select>
                        </label>
                      </header>
                      <div className="task-list-column-items">
                        {listTasks.map((task) => {
                          const unread=unreadPersonalCommentIds(task.comments??[],cloudUser?.uid??"local",personalTaskDisplay.reads[task.id]??[]).length;
                          return (
                          <article
                            className={`${task.done ? "done" : ""}${unread ? " has-unread-comments" : ""}`}
                            key={task.id}
                          >
                            <button
                              type="button"
                              className="task-list-board-drag"
                              draggable
                              aria-label={namedAction("Перетащить задачу", task.title, language)}
                              onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/genesis-task-id", task.id);
                              }}
                              onDragEnd={() => setTaskListDropTargetId("")}
                            >⋮⋮</button>
                            <button type="button" className="task-check" aria-pressed={task.done} onClick={() => toggleTask(task.id)} aria-label={namedAction(task.done ? "Вернуть задачу" : "Завершить задачу", task.title, language)}>{task.done ? <ExperimentalIcon name="check"/> : null}</button>
                            <button type="button" className="task-list-item-open" onClick={() => setPersonalPreview({kind:"task",id:task.id})}>
                              <strong data-no-translate>{task.title}</strong>
                              {unread?<span className="unread-comment-badge">{translateText("Новые комментарии",language)}: {unread}</span>:null}
                              {renderOverdueBadge(task)}
                              <small>{taskRangeLabel(task, activeCalendarMode, activeTimeFormat)}</small>
                            </button>
                            <label className="task-list-move-select">
                              <span className="sr-only">Переместить задачу «{task.title}»</span>
                              <select value={task.googleTaskListId ?? ""} onChange={(event) => moveTaskToTaskList(task, event.target.value)} aria-label={`Список для задачи «${task.title}»`}>
                                {taskLists.map((destination) => <option value={destination.id} key={destination.id}>{destination.title}</option>)}
                              </select>
                            </label>
                            <button type="button" className="task-list-item-delete" onClick={() => deleteTask(task.id)} aria-label={`Удалить задачу «${task.title}»`}>{experimentalThemeActive ? <ExperimentalIcon name="close" /> : "×"}</button>
                          </article>
                        );})}
                        {!listTasks.length ? <p>Перетащите сюда задачу или добавьте несколько ниже.</p> : null}
                      </div>
                      <form className="task-list-batch-form" onSubmit={(event) => addTasksToExistingList(event, taskList)}>
                        <label htmlFor={`${context}-${taskList.id}-batch-tasks`}>Несколько новых задач</label>
                        <textarea
                          id={`${context}-${taskList.id}-batch-tasks`}
                          rows={3}
                          value={taskListBatchTitles[taskList.id] ?? ""}
                          onChange={(event) => setTaskListBatchTitles((current) => ({ ...current, [taskList.id]: event.target.value }))}
                          placeholder={"Каждая задача с новой строки\nНапример: собрать материалы"}
                        />
                        <div>
                          <CalendarDatePicker
                            mode={taskFormCalendarMode}
                            min={todayDateValue}
                            value={taskListBatchDates[taskList.id] || todayDateValue}
                            onChange={(nextDate) => setTaskListBatchDates((current) => ({ ...current, [taskList.id]: nextDate }))}
                            ariaLabel={`Срок новых задач в списке «${taskList.title}»`}
                          />
                          <button type="submit" className="primary-button" disabled={!taskListBatchTitles[taskList.id]?.trim()}>Добавить все</button>
                        </div>
                      </form>
                    </section>
                  );
                })}
              </div>
            </section>
          ) : null}
          <form className="task-list-new-form" onSubmit={addGoogleTaskList} aria-label="Создание списка задач">
        <RecordCalendarChoice value={taskFormCalendarMode} onChange={setTaskFormCalendar} language={language} />
            <label htmlFor={`${context}-new-task-list-title`}>Название списка</label>
            <input
              id={`${context}-new-task-list-title`}
              value={newTaskListTitle}
              onChange={(event) => setNewTaskListTitle(event.target.value)}
              placeholder="Например, подготовка запуска"
            />
            {googleAccounts.length > 1 ? (
              <label htmlFor={`${context}-new-task-list-account`}>Google-аккаунт</label>
            ) : null}
            {googleAccounts.length > 1 ? (
              <select id={`${context}-new-task-list-account`} value={newTaskListAccountId || defaultSyncAccountIds[0] || ""} onChange={(event) => setNewTaskListAccountId(event.target.value)}>
                {googleAccounts.map((account) => <option value={account.id} key={account.id}>{account.email}{account.isPrimary ? " · основной" : ""}</option>)}
              </select>
            ) : null}
            <label htmlFor={`${context}-new-task-list-project`}>Проект или подпроект</label>
            <select id={`${context}-new-task-list-project`} value={newTaskListProject} onChange={(event) => setNewTaskListProject(event.target.value)}>
              <option value="">Без проекта — в хаос-бокс</option>
              {flattenProjects(projects).map(({ project, depth }) => (
                <option value={project.id} key={project.id}>{"— ".repeat(depth)}{project.title}</option>
              ))}
            </select>
            <fieldset className="task-list-drafts">
              <legend>Задачи внутри нового списка</legend>
              <p>Можно создать пустой список или сразу подготовить несколько задач.</p>
              {newTaskListDrafts.map((draft, index) => (
                <div className="task-list-draft-row" key={draft.id}>
                  <input value={draft.title} onChange={(event) => updateNewTaskListDraft(draft.id, { title: event.target.value })} placeholder={`Задача ${index + 1}`} aria-label={`Название задачи ${index + 1}`} />
                  <CalendarDatePicker mode={taskFormCalendarMode} min={todayDateValue} value={draft.dueDate || todayDateValue} onChange={(nextDate) => updateNewTaskListDraft(draft.id, { dueDate: nextDate })} ariaLabel={`Срок задачи ${index + 1}`} />
                  <button type="button" onClick={() => setNewTaskListDrafts((current) => current.length === 1 ? [{ ...current[0], title: "", dueDate: "" }] : current.filter((item) => item.id !== draft.id))} aria-label={`Удалить задачу ${index + 1}`}>{experimentalThemeActive ? <ExperimentalIcon name="close" /> : "×"}</button>
                </div>
              ))}
              <button type="button" className="text-button task-list-add-draft" onClick={() => setNewTaskListDrafts((current) => [...current, { id: uid(), title: "", dueDate: "" }])}>＋ Ещё задача</button>
            </fieldset>
            <button type="submit" className="primary-button" disabled={!newTaskListTitle.trim()}>Создать список</button>
          </form>
        </>
      ) : (
        <button type="button" className="primary-button" onClick={() => void handleGoogleConnect()}>Подключить Google Tasks</button>
      )}
    </div>
  );

  const renderTaskCreateForm = (context: "today" | "all-tasks" | "day-details" | "composer") => {
    const scopeSwitcher = sharedProjectsAvailable && context !== "composer" ? <div className="task-scope-switch" role="group"
      aria-label={language === "en" ? "Task access" : "Доступ к задаче"}>
      <button type="button" aria-pressed={taskScope === "personal"} onClick={() => chooseTaskScope("personal")}>
        {language === "en" ? "Personal task" : "Личная задача"}</button>
      <button type="button" aria-pressed={taskScope === "shared"} onClick={() => chooseTaskScope("shared")}>
        {language === "en" ? "Shared task" : "Общая задача"}</button>
    </div> : null;
    if (sharedProjectsAvailable && taskScope === "shared") return <>
      {scopeSwitcher}<Suspense fallback={<DeferredViewFallback label={language === "en" ? "Opening shared task form…" : "Открываем форму общей задачи…"} />}><SharedTaskCreate language={language} enabledCalendars={visibility.enabledCalendars} timeFormat={activeTimeFormat} initialEntryType={newEntryType === "birthday" ? "task" : newEntryType} onEntryTypeChange={value => { setNewEntryType(value); setComposerTab(value); }} onCreated={() => setTaskComposer(null)} /></Suspense>
    </>;
    const selectedTaskList = taskLists.find((taskList) => taskList.id === taskTaskListId);
    const createsTaskList = taskTaskListId === CREATE_NEW_TASK_LIST_ID;
    const dueDateIsPast = Boolean(newTaskDueDate && newTaskDueDate < todayDateValue);
    const rangeIsInvalid = newTaskEndDate < newTaskDueDate;
    const recurrenceOccurrenceCount = taskRecurrenceConfig.enabled
      ? buildRecurrenceDates(newTaskDueDate, taskRecurrenceConfig).length
      : 1;
    const recurrenceIsInvalid = recurrenceOccurrenceCount === 0 || recurrenceOccurrenceCount > MAX_RECURRENCE_OCCURRENCES;
    const syncAccountsInvalid = Boolean(cloudUser?.multiAccountEnabled && cloudUser.syncRouting.mode === "choose" && !selectedTaskList && !createsTaskList && effectiveTaskSyncAccountIds.length === 0);
    return (<>
      {scopeSwitcher}
      <form className="task-form" data-exp-ui="form" onSubmit={addTask} aria-label="Создание задачи">
        {personalListReturn&&selectedTaskList?<p className="task-list-composer-context"><span>{translateText('Список',language)}: </span><strong data-no-translate>{selectedTaskList.title}</strong></p>:null}
        {context !== "composer" ? <EntryTypeChoice value={newEntryType} english={language === "en"} onChange={value => { setNewEntryType(value); setTaskUndated(false); if(taskComposer)setComposerTab(value); setYandexEntryType(value === "meeting" ? "meeting" : "task"); }} /> : null}
        {cloudUser?.authProvider === "yandex" ? <label>
          <span>Тип записи в Яндекс.Календаре</span>
          <select value={yandexEntryType} onChange={(event) => setYandexEntryType(event.target.value as "task" | "meeting")}>
            <option value="task">Задача</option><option value="meeting">Встреча</option>
          </select>
        </label> : null}
        {dueDateIsPast ? (
          <p className="past-date-notice" role="status">Выберите сегодняшний или будущий срок для новой задачи.</p>
        ) : null}
        <label>
          <span>{newEntryType === "task" ? "Новая задача" : entryTypeLabel(newEntryType, language === "en")}</span>
          <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder={entryTypeTitlePlaceholder(newEntryType) || "Что важно совершить?"} />
        </label>
        <label>
          <span>Дополнительная информация</span>
          <textarea rows={2} value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} placeholder="Подробности, ожидаемый результат и заметки" />
        </label>
          {personalMindmapsEnabled && newEntryType === "task" && cloudUser?.authProvider !== "yandex" ? <label className="record-undated-choice">
            <input type="checkbox" checked={taskUndated} onChange={event => {
              setTaskUndated(event.target.checked);
              if (event.target.checked) { setTaskTime(""); setTaskReminders([]); setTaskRecurrenceConfig({ ...DEFAULT_RECURRENCE_CONFIG, enabled: false }); }
            }} /><span>Без даты</span>
          </label> : null}
          {taskUndated ? <p role="status"><span>Задача без даты сохранится в личных делах.</span>{" "}{mindmapConversion ? <><span>На карте останется ссылка на эту задачу.</span>{" "}</> : null}<span>{cloudUser?.calendarConnected ? "Для синхронизации выберите список Google Tasks в подробностях." : "Google-синхронизация не подключена: задача сохранится на этом устройстве."}</span></p> : null}
        {!taskUndated ? <RecordDateTimeRow className="task-form-section task-form-schedule"
          dateId={`${context}-task-start-date`} timeId={`${context}-new-task-time-hour`} mode={taskFormCalendarMode} min={todayDateValue} date={newTaskDueDate}
          onDateChange={nextDate => { setTaskDueDate(nextDate); setTaskEndDate(current => !current || current < nextDate ? nextDate : current); }} required
          time={taskTime} timeFormat={activeTimeFormat} timeDisabled={Boolean(taskTaskListId) && cloudUser?.authProvider === "google"} onTimeChange={setTaskTime}/> : null}
        <details className="task-advanced-fields" open={taskUndated || undefined} onInvalidCapture={event => { event.currentTarget.open = true; }}><summary>{language === "en" ? "Details and settings" : "Подробности и настройки"}</summary>
          <label>
            <span>Проект или подпроект</span>
            <select value={taskProject} onChange={(event) => setTaskProject(event.target.value)}>
              <option value="">{language === "en" ? "Inbox" : "Хаос-бокс"}</option>
              {flattenProjects(projects).map(({ project, depth }) => (
                <option value={project.id} key={project.id}>{"— ".repeat(depth)}{project.title}</option>
              ))}
            </select>
          </label>
        <RecordCalendarChoice value={taskFormCalendarMode} language={language} onChange={(mode) => {
          setTaskFormCalendar(mode);
          setTaskRecurrenceConfig((current) => alignRecurrenceConfigWithCalendar(current, mode, newTaskDueDate));
        }} />
        {!taskUndated ? <div className="task-form-section">
          <label htmlFor={`${context}-task-end-date`}>
            <span>Срок выполнения</span>
            <CalendarDatePicker id={`${context}-task-end-date`} mode={taskFormCalendarMode} min={newTaskDueDate} value={newTaskEndDate} onChange={setTaskEndDate} required />
          </label>
          {newEntryType === "meeting" && cloudUser?.authProvider !== "yandex" ? <label htmlFor={`${context}-meeting-end-time`}><span>{language === "en" ? "End time" : "Время окончания"}</span><TimeClockPicker id={`${context}-meeting-end-time`} ariaLabel={language === "en" ? "End time" : "Время окончания"} value={yandexEndTime} timeFormat={activeTimeFormat} onChange={setYandexEndTime} /></label> : null}
          {cloudUser?.authProvider === "yandex" ? <label className="yandex-all-day"><input type="checkbox" checked={!taskTime}
            onChange={(event) => {
              setTaskTime(event.target.checked ? "" : "09:00");
              setYandexEndTime(event.target.checked ? "" : "09:30");
            }} /><span>Весь день</span></label> : null}
        </div> : null}
        {cloudUser?.authProvider === "yandex" ? <div className="task-form-section yandex-task-fields" aria-label="Поля Яндекс.Календаря">
          {yandexEntryType === "meeting" ? <>
            <label htmlFor="new-yandex-end-time"><span>Время окончания встречи · время устройства</span>
              <TimeClockPicker id="new-yandex-end-time" value={yandexEndTime} onChange={setYandexEndTime} disabled={!taskTime} ariaLabel="Время окончания"/></label>
            <label><span>Участники · адреса через запятую</span>
              <input type="text" value={yandexAttendees} onChange={(event) => setYandexAttendees(event.target.value)} autoComplete="off" /></label>
            <label><span>Необязательные участники</span>
              <input type="text" value={yandexOptionalAttendees} onChange={(event) => setYandexOptionalAttendees(event.target.value)} autoComplete="off" /></label>
            <label><span>Место</span><input value={yandexLocation} onChange={(event) => setYandexLocation(event.target.value)} /></label>
            <label><span>Ссылка на Телемост</span><input type="url" value={yandexTelemostUrl} onChange={(event) => setYandexTelemostUrl(event.target.value)} placeholder="https://telemost.yandex.ru/..." /></label>
          </> : null}
          <label><span>Занятость</span><select value={yandexBusy ? "busy" : "free"} onChange={(event) => setYandexBusy(event.target.value === "busy")}>
            <option value="busy">Занят</option><option value="free">Свободен</option></select></label>
          <label><span>Видимость в Яндекс.Календаре</span><select value={yandexVisibility} onChange={(event) => setYandexVisibility(event.target.value as "private" | "public")}>
            <option value="private">Только участники</option><option value="public">Все</option></select></label>
          <fieldset><legend>Напоминания Яндекс.Календаря</legend>
            {[0, 10, 30, 60, 1440].map((minutes) => <label key={minutes}>
              <input type="checkbox" checked={yandexReminders.includes(minutes)} onChange={(event) => setYandexReminders((current) =>
                event.target.checked ? [...current, minutes].slice(0, 5) : current.filter((item) => item !== minutes))} />
              <span>{minutes === 0 ? "В момент события" : minutes === 10 ? "За 10 минут" : minutes === 30 ? "За 30 минут" : minutes === 60 ? "За час" : "За день"}</span>
            </label>)}
          </fieldset>
          <small>Даты сакрального и лунного календарей преобразуются в григорианские по часовому поясу устройства перед отправкой в Яндекс.</small>
        </div> : null}
        <div className="task-form-section task-form-destination" aria-label="Контекст задачи">

          <label>
            <span>Куда добавить задачу</span>
            <select value={taskTaskListId} onChange={(event) => {
              const nextTaskListId = event.target.value;
              setTaskTaskListId(nextTaskListId);
              if (nextTaskListId !== CREATE_NEW_TASK_LIST_ID) setTaskNewListTitle("");
              if (nextTaskListId && cloudUser?.authProvider === "google") {
                setTaskTime("");
                setTaskReminders([]);
              }
            }}>
              <option value="" disabled={taskUndated && Boolean(cloudUser?.calendarConnected)}>{!cloudUser?.calendarConnected ? "На этом устройстве" : cloudUser.authProvider === "yandex" ? "Яндекс.Календарь" : "Google Calendar"}</option>
              {taskLists.filter((taskList) => (personalMindmapsEnabled && taskList.isDefault) || (!taskList.isDefault && (taskList.accountId == null || !["мои задачи", "my tasks", "привычки genesis"].includes(taskList.title.trim().toLocaleLowerCase())))).map((taskList) => <option value={taskList.id} key={`${taskList.accountId ?? "primary"}-${taskList.id}`}>{cloudUser?.authProvider !== "google" ? "Список GENESIS" : "Google Tasks"} · {taskList.title}{taskList.accountEmail ? ` · ${taskList.accountEmail}` : ""}</option>)}
              {!mindmapConversion ? <option value={CREATE_NEW_TASK_LIST_ID}>＋ Начать новый список задач</option> : null}
            </select>
          </label>
        </div>
        {createsTaskList ? (
          <div className="task-form-new-list">
            <label>
              <span>Название нового списка</span>
              <input value={taskNewListTitle} onChange={(event) => setTaskNewListTitle(event.target.value)} placeholder="Например, подготовка события" required />
            </label>
            {googleAccounts.length > 1 ? (
              <label>
                <span>Google-аккаунт списка</span>
                <select value={taskNewListAccountId || effectiveTaskSyncAccountIds[0] || defaultSyncAccountIds[0] || ""} onChange={(event) => setTaskNewListAccountId(event.target.value)}>
                  {googleAccounts.map((account) => <option value={account.id} key={account.id}>{account.email}{account.isPrimary ? " · основной" : ""}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        {!taskUndated ? <RecurrenceBuilder
          value={taskRecurrenceConfig}
          onChange={setTaskRecurrenceConfig}
          startDate={newTaskDueDate}
          destination={taskTaskListId && cloudUser?.authProvider === "google" ? "tasks" : "calendar"}
          calendarMode={taskFormCalendarMode}
        /> : null}
        <div className="task-form-section task-form-settings" aria-label="Настройки задачи">
          {cloudUser?.authProvider === "yandex" ? <strong>Дополнительные напоминания GENESIS</strong> : null}
          <TaskReminderPicker
            value={taskReminders}
            onChange={setTaskReminders}
            taskDate={newTaskDueDate}
            taskTime={taskTime}
            calendarMode={taskFormCalendarMode}
            timeFormat={activeTimeFormat}
            disabled={taskUndated || (Boolean(taskTaskListId) && cloudUser?.authProvider === "google")}
          />
          <div className="task-form-field task-form-priority">
            <span>Приоритет</span>
            <TaskPriorityControl
              id="create-task-priority"
              value={Number(taskPriority)}
              onChange={(value) => setTaskPriority(String(value))}
            />
          </div>
          <label>
            <span>Теги</span>
            <input value={taskTags} onChange={(event) => setTaskTags(event.target.value)} placeholder="ритуал, работа, дом" />
          </label>
        </div>
        {tasks.length ? (
          <div className="task-form-field task-form-row-full">
            <span>Зависит от</span>
            <DependencyPicker tasks={tasks} value={taskDependsOn} onChange={setTaskDependsOn} />
          </div>
        ) : null}
        {cloudUser?.multiAccountEnabled && cloudUser.syncRouting.mode === "choose" && !selectedTaskList && !createsTaskList && taskRoutingAccounts.length > 1 ? (
          <fieldset className="task-sync-account-picker">
            <legend>Синхронизировать эту задачу</legend>
            {taskRoutingAccounts.map((account) => (
              <label key={account.id}>
                <input
                  type="checkbox"
                  checked={effectiveTaskSyncAccountIds.includes(account.id)}
                  onChange={(event) => setTaskSyncAccountIds((current) => {
                    const base = current ?? defaultSyncAccountIds;
                    return event.target.checked
                      ? Array.from(new Set([...base, account.id]))
                      : base.filter((id) => id !== account.id);
                  })}
                />
                <span>{account.email}{account.isPrimary ? " · основной" : ""}</span>
              </label>
            ))}
            <small>Можно выбрать один или несколько аккаунтов.</small>
          </fieldset>
        ) : null}
        <div className="sync-checkbox sync-always-on">
          <span aria-hidden="true">✓</span>
          <span>{!cloudUser?.calendarConnected ? "Задача сохранится на этом устройстве."
            : taskUndated ? "Задача без даты будет синхронизирована с выбранным списком Google Tasks."
            : cloudUser?.authProvider === "yandex"
            ? translateText("Запись будет синхронизирована с Яндекс.Календарём по времени устройства.", language)
            : createsTaskList
            ? taskRecurrenceConfig.enabled
              ? `Сначала будет создан список «${taskNewListTitle.trim() || "без названия"}», затем в нём появится серия из ${recurrenceOccurrenceCount} задач`
              : `Сначала будет создан список «${taskNewListTitle.trim() || "без названия"}», затем задача появится внутри него`
            : selectedTaskList
            ? taskRecurrenceConfig.enabled
              ? `${recurrenceOccurrenceCount} задач по выбранным датам попадут в список «${selectedTaskList.title}» Google Tasks`
              : `Срок завершения попадёт в список «${selectedTaskList.title}» Google Tasks, начало сохранится в данных GENESIS`
            : taskRecurrenceConfig.enabled
            ? language === "en"
              ? `${taskRecurrenceConfig.mode === "classic" ? "Gregorian" : taskRecurrenceConfig.mode === "lunar" ? "Lunar" : "Sacred"} series of ${recurrenceOccurrenceCount} recurrences will be saved as one task in GENESIS and one event in Google Calendar`
              : `${taskRecurrenceConfig.mode === "classic" ? "Григорианская" : taskRecurrenceConfig.mode === "lunar" ? "Лунная" : "Сакральная"} серия из ${recurrenceOccurrenceCount} повторений будет сохранена одной задачей в GENESIS и одним событием в Google Calendar`
            : "Задача будет синхронизирована с Google Calendar в часовом поясе этого устройства"}</span>
        </div>
        </details>
        <button type="submit" className="add-task-button" disabled={!taskTitle.trim() || (!taskUndated && (!newTaskDueDate || !newTaskEndDate)) || (taskUndated && Boolean(cloudUser?.calendarConnected) && !taskTaskListId) || dueDateIsPast || rangeIsInvalid || recurrenceIsInvalid || syncAccountsInvalid || (createsTaskList && !taskNewListTitle.trim())}>
          <span aria-hidden="true">{experimentalThemeActive ? <ExperimentalIcon name="plus" /> : "＋"}</span> Добавить задачу
        </button>
      </form>
      </>
    );
  };

  const changeDisplayCalendar = async (mode: CalendarMode) => {
    const user = cloudUserRef.current;
    if (!user || !visibility.enabledCalendars.includes(mode)) return;
    const revision = ++displayCalendarRevisionRef.current;
    const updatedUser = { ...user, calendarMode: mode };
    cloudUserRef.current = updatedUser;
    setCloudUser(updatedUser);
    try { if (!privateDeviceAccessBlocked()) localStorage.setItem(LAST_USER_KEY, JSON.stringify(updatedUser)); }
    catch { /* The visible choice still works when browser storage is unavailable. */ }
    const save = async () => {
      if (revision !== displayCalendarRevisionRef.current || cloudUserRef.current?.uid !== user.uid) return;
      try {
        await updateAccountPreferences({ calendarMode: mode });
      } catch (error) {
        if (revision === displayCalendarRevisionRef.current && cloudUserRef.current?.uid === user.uid) {
          setSyncError(error instanceof Error ? error.message : "Не удалось сохранить выбранный календарь. Выбор применён на этом устройстве.");
        }
      }
    };
    displayCalendarSaveRef.current = displayCalendarSaveRef.current.then(save, save);
    await displayCalendarSaveRef.current;
  };

  const renderDisplayCalendarChoice = (label: string, className = "") => (
    <DisplayCalendarChoice key={cloudUser?.uid ?? 'guest'} label={label} className={className} enabledCalendars={visibility.enabledCalendars}
      order={accountLayout.displayCalendarOrder} onReorder={order => saveLayout({displayCalendarOrder: order})}
      mode={activeCalendarMode} language={language} onChange={changeDisplayCalendar} />
  );

  const renderToday = () => {
    const showToday = (block: string) => !(webHabitHeader ? todayHidden : visibility.hiddenTodayBlocks).includes(block);
    const isEnglish = language === "en";
    const info = todayInfo;
    const month = MONTHS[info.monthIndex];
    const day = getSacredDay(info.monthIndex, info.day);
    const gregorian = getGregorianDate(info.sacredYear, info.monthIndex, info.day);
    const moon = getMoon(gregorian);
    const lunar = getLunarDate(gregorian);
    const weekdayPatron = localizeWeekdayPatron(PROFANE_WEEKDAY_PATRONS[gregorian.getDay()], language);
    const gregorianWeekdayRaw = new Intl.DateTimeFormat(runtimeLocale(), { weekday: "long" }).format(gregorian);
    const gregorianWeekday = `${gregorianWeekdayRaw.charAt(0).toLocaleUpperCase(runtimeLocale())}${gregorianWeekdayRaw.slice(1)}`;
    const gregorianMonth = profaneMonthName(gregorian);
    const gregorianDateTitle = new Intl.DateTimeFormat(runtimeLocale(), {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(gregorian);
    const gregorianMonthLength = new Date(gregorian.getFullYear(), gregorian.getMonth() + 1, 0).getDate();
    const gregorianYearLength = new Date(gregorian.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365;
    const gregorianDayOfYear = Math.floor((Date.UTC(gregorian.getFullYear(), gregorian.getMonth(), gregorian.getDate()) - Date.UTC(gregorian.getFullYear(), 0, 0)) / 86_400_000);
    const gregorianWeek = (() => {
      const normalized = new Date(Date.UTC(gregorian.getFullYear(), gregorian.getMonth(), gregorian.getDate()));
      normalized.setUTCDate(normalized.getUTCDate() + 4 - (normalized.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
      return Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    })();
    const element = getDayElement(info.monthIndex, info.day);
    const pythagorean = getPythagorean(info.monthIndex, info.day);
    const solarEvent = sacredFeaturesEnabled ? getSolarEvent(info.sacredYear, info.monthIndex, info.day) : null;
    const solarCopy = solarEvent ? SOLAR_EVENT_COPY[solarEvent.id] : null;
    const isNewMoonDay = moon.event.toLocaleLowerCase().includes("новолуние");
    const dayTitleMatch = day.name.match(/^(.*?)\s*(\([^()]+\))$/u);
    const sacredTitlePrimary = dayTitleMatch?.[1] ?? day.name;
    const sacredTitleTranslation = dayTitleMatch?.[2] ?? "";
    const heroTitlePrimary = activeCalendarMode === "lunar"
      ? `${lunar.day} ${isEnglish ? "lunar day" : "лунный день"}`
      : activeCalendarMode === "profane"
        ? gregorianWeekday
        : sacredTitlePrimary;
    const heroTitleTranslation = activeCalendarMode === "lunar"
      ? (lunar.isThreshold ? (isEnglish ? "Lunar month threshold" : "Рубеж лунного месяца") : lunar.decade.name)
      : activeCalendarMode === "profane"
        ? gregorianDateTitle
        : sacredTitleTranslation;
    const dayTitleTranslationSize = heroTitleTranslation
      ? `clamp(16px, ${Math.min(8.2, 164 / heroTitleTranslation.length)}cqw, 44px)`
      : undefined;
    const heroEyebrow = activeCalendarMode === "lunar"
      ? (isEnglish ? `Lunar calendar · month ${lunar.month.roman}` : `Лунный календарь · ${lunar.month.roman} месяц`)
      : activeCalendarMode === "profane"
        ? (isEnglish ? `Gregorian calendar · ${gregorian.getFullYear()}` : `Григорианский календарь · ${gregorian.getFullYear()} год`)
        : `${month.season} · ${month.roman} месяц`;
    const heroMonth = activeCalendarMode === "lunar" ? lunar.month.name : activeCalendarMode === "profane" ? gregorianMonth : month.name;
    const heroDescription = activeCalendarMode === "lunar"
      ? (isEnglish
          ? `${moon.direction}. ${moon.phase}, ${moon.illumination}% illuminated. ${lunar.month.description}`
          : `${moon.direction}. ${moon.phase}, освещённость ${moon.illumination}%. ${lunar.month.description}`)
      : day.description;

    const heroHeading = <h1 id="today-title">
      {activeCalendarMode === "sacred" ? <SingleLineTitle className="hero-day-title-primary" text={heroTitlePrimary}/> : <span className="hero-day-title-primary">{heroTitlePrimary}</span>}
      {heroTitleTranslation ? <span className="hero-day-title-translation" style={{ fontSize: dayTitleTranslationSize }}>{heroTitleTranslation}</span> : null}
    </h1>;
    const heroSolarTimes = <TodaySolarTimes today={today} location={deviceLocation} deviceTimeZone={deviceTimeZone} approximate={solarLocationSource !== "selected-city"}
      ready={solarLocationStatus === "ready"} language={language} timeFormat={activeTimeFormat} compact={!sacredFeaturesEnabled}/>;
    const heroActions = <div className="hero-actions">
      <button className="primary-button" type="button" onClick={openTodayInCalendar} aria-label={translateText("Открыть день в календаре", language)}>
        Сегодня <span aria-hidden="true">↗</span>
      </button>
      {sacredFeaturesEnabled ? <span className="hero-date">{activeCalendarMode === "profane" ? formatCalendarDate(gregorian, "sacred") : formatGregorian(gregorian, true)}</span> : null}
    </div>;
    return (
      <TodayBlocks order={todayOrder} halfBlocks={todayHalves}>
        <TodayBlock id="hero">
        <section className={`hero-card mode-${activeCalendarMode}${activeCalendarMode === "profane" ? ` weekday-${gregorian.getDay()}` : ""}`} style={activeCalendarMode === "lunar" ? {"--lunar-day-art":`url("${APP_BASE}/${lunarPatronArt(moon.day)}")`, "--genesis-hero-image":`url("${APP_BASE}/${lunarPatronArt(moon.day)}")`, "--genesis-hero-fallback":"none"} as CSSProperties : undefined} data-lunar-patron={activeCalendarMode === "lunar" ? lunarPatronForDay(moon.day) : undefined} aria-labelledby="today-title" data-genesis-preserve="today-hero-art">
          {!sacredFeaturesEnabled?<Suspense fallback={null}><SolarLandscapeHero now={today} location={deviceLocation} deviceTimeZone={deviceTimeZone} source={solarLocationSource} basePath={APP_BASE} ownerId={cloudUser?.uid??null}/></Suspense>:null}
          <span className="hero-palette-art" aria-hidden="true" />
          <div className="hero-copy">
            {sacredFeaturesEnabled ? <div className="eyebrow-row">
              <span className="eyebrow">{heroEyebrow}</span>
              {sacredFeaturesEnabled && activeCalendarMode === "lunar" ? (
                <span className="event-badge lunar-event-badge"><MoonPhaseIcon phaseStep={moon.phaseStep} size={14} /> {moon.event || moon.epithet}</span>
              ) : sacredFeaturesEnabled && solarEvent ? <span className="event-badge solar-event-badge"><b aria-hidden="true">{solarEvent.symbol}</b> {solarEvent.name}</span> : null}
            </div> : null}
            {sacredFeaturesEnabled && activeCalendarMode !== "profane" ? <p className="hero-month">{heroMonth}</p> : null}
            {sacredFeaturesEnabled ? heroHeading : <div className="civil-summary-group"><div className="civil-date-heading">{heroHeading}<p className="today-year-progress" data-no-translate>{todayYearProgress(gregorianDayOfYear, gregorianYearLength, language)}</p><DeviceClock timeFormat={activeTimeFormat}/></div>{heroSolarTimes}</div>}
            {activeCalendarMode === "profane" ? sacredFeaturesEnabled ? (
              <div className="hero-description profane-hero-description">
                <strong>{weekdayPatron.patronage}</strong>
                <span>{weekdayPatron.deity}</span>
                <span><b>{isEnglish ? "Body parts:" : "Части тела:"}</b> {weekdayPatron.bodyParts}</span>
              </div>
            ) : null : <p className="hero-description">{heroDescription}</p>}
            {sacredFeaturesEnabled ? <>{heroSolarTimes}{heroActions}</> : null}
          </div>
          <div className="hero-day-clock">
          {sacredFeaturesEnabled && activeCalendarMode !== "profane" ? <div className="hero-number" aria-hidden="true">
            {activeCalendarMode === "lunar" ? (
              <MoonPhaseIcon phaseStep={moon.phaseStep} size={96} className="hero-mode-moon" />
            ) : (
              <span>{romanDay(info.monthIndex, info.day)}</span>
            )}
            <small>{activeCalendarMode === "lunar" ? lunarTriadCopy(language)[lunarPatronForDay(moon.day)].name : info.monthIndex === 12 ? "вне времени" : `${day.pyata} пята`}</small>
          </div> : null}
          {sacredFeaturesEnabled?<DeviceClock timeFormat={activeTimeFormat}/>:<div className="hero-civil-clock-weather" data-time-format={activeTimeFormat}><div className="solar-weather-slot"><Suspense fallback={null}><SolarWeatherSummary ownerId={cloudUser?.uid??null} now={today} location={deviceLocation} source={solarLocationSource} language={language} deviceTimeZone={deviceTimeZone} timeFormat={activeTimeFormat} onChooseCity={() => { setAccountGuideUserId(null); setAccountSolarPlaceUserId(cloudUser?.uid ?? null); setAccountMenuOpen(false); setAccountOpen(true); }}/></Suspense></div>{heroActions}</div>}
          </div>
        </section>

        {!experimentalThemeActive ? renderDisplayCalendarChoice(isEnglish ? "Today's calendar" : "Календарь сегодня", "today-calendar-choice") : null}
        </TodayBlock>
        <TodayBlock id="advice">{cloudUser && (!webHabitHeader || showToday("advice")) ? <Suspense fallback={null}><TodayAdvice key={cloudUser.uid} user={cloudUser} habits={habitWorkspace.habits} tasks={tasks} day={todayDateValue} ready={hydrated && syncStatus !== "syncing"} onOpenDiary={() => { setProjectsArea("personal"); setMindmapsOpen(false); setDiaryOpen(true); navigateTo("projects"); const url = new URL(location.href); url.searchParams.set("diary", "1"); history.replaceState(history.state, "", url); }} /></Suspense> : null}</TodayBlock>

        <TodayBlock id="dream">{cloudUser && (!webHabitHeader || showToday("dream")) ? <Suspense fallback={null}><DreamJournalToday user={cloudUser} date={todayDateValue} language={language} plans={habitWorkspace.sleepPlans} entries={habitWorkspace.sleepEntries}/></Suspense> : null}</TodayBlock>
        <TodayBlock id="ads">{cloudUser && (!webHabitHeader || showToday("ads")) ? <TodayAdBlock key={`${cloudUser.uid}:${language}`} language={language} userId={cloudUser.uid} /> : null}</TodayBlock>

        <TodayBlock id="rhythm">{sacredFeaturesEnabled && showToday("rhythm") ? <DayRhythmPanel timeFormat={activeTimeFormat} /> : null}</TodayBlock>

        <TodayBlock id="tasks">{(webHabitHeader ? showToday("tasks") : showToday("tasks") || showToday("quickCreate")) ? <section className="today-tasks-panel" aria-labelledby="today-tasks-title" data-exp-ui="panel">
          <header>
            <div>
              <span className="eyebrow">{isEnglish ? "The shape of today" : "План сегодняшнего дня"}</span>
              <h2 id="today-tasks-title">{isEnglish ? "Today's tasks" : "Задачи на сегодня"} — <span className="today-tasks-title-count">{todayTasks.filter((task) => task.done).length}/{todayTasks.length}</span></h2>
            </div>
            <div>
              {showToday("quickCreate") ? <button type="button" className="primary-button" onClick={() => openTaskComposer("today")}>{experimentalThemeActive ? <ExperimentalIcon name="plus" /> : null}{isEnglish ? "Create task" : "Создать задачу"}</button> : null}
              <button type="button" className="secondary-button" onClick={() => navigateTo("projects")}>{isEnglish ? "Go to affairs" : "Перейти к делам"}</button>
            </div>
          </header>
          <section className="today-task-group" aria-labelledby="today-personal-tasks-title">
          <h3 id="today-personal-tasks-title" className="today-task-scope-title">{isEnglish ? "Personal" : "Личные"}</h3>
          {todayTasks.length ? (
            <div className="today-task-list" aria-live="polite">
              {todayTasks.map((task) => (
                <article className={task.done ? "done" : ""} key={task.id}>
                  <button type="button" className="task-check" aria-pressed={task.done} onClick={() => toggleTask(task.id)} aria-label={namedAction(task.done ? "Вернуть задачу" : "Завершить задачу", task.title, language)}>
                    {task.done ? <ExperimentalIcon name="check"/> : null}
                  </button>
                  <button type="button" className="today-task-open" onClick={() => setPersonalPreview({kind:"task",id:task.id,date:todayDateValue})}>
                    <strong data-no-translate>{task.title}</strong>
                    {renderOverdueBadge(task, todayDateValue)}
                    <span>
                      <time>{task.time ? formatTimeValue(task.time, activeTimeFormat) : (isEnglish ? "All day" : "Весь день")}</time>
                      <em>{resolvedTaskProjectTitle(task) || (isEnglish ? "No project" : "Без проекта")}</em>
                      <i>{isEnglish ? `Priority ${task.priority}` : `Приоритет ${task.priority}`}</i>
                    </span>
                  </button>
                  <button type="button" className="icon-button" onClick={() => openTaskEditor(task, todayDateValue)} aria-label={namedAction("Редактировать задачу", task.title, language)}>{experimentalThemeActive ? <ExperimentalIcon name="edit" /> : "↗"}</button>
                </article>
              ))}
            </div>
          ) : (
            <div className="today-tasks-empty" role="status">
              <span aria-hidden="true">✓</span>
              <div><strong>{hasSharedTodayTasks ? `${isEnglish ? "Personal" : "Личные"}: 0` : isEnglish ? "No tasks for today" : "На сегодня задач нет"}</strong><p>{isEnglish ? "You can leave the day open or create a task above." : "Можно оставить день свободным или создать задачу выше."}</p></div>
            </div>
          )}
          </section>
          {hasSharedTodayTasks ? <section className="today-task-group today-shared-tasks" aria-labelledby="today-shared-tasks-title">
            <h3 id="today-shared-tasks-title" className="today-task-scope-title">{isEnglish ? "Shared" : "Общие"} · {sharedTodayPage.page?.total}</h3>
            <div className="today-task-list" aria-live="polite">
              {sharedTodayTasks.map(task => <article className={task.completedAt ? "done" : ""} key={task.id}>
                <button type="button" className="task-check" aria-pressed={Boolean(task.completedAt)}
                  disabled={calendarCompletionBusy === task.id}
                  aria-label={namedAction(task.completedAt ? "Вернуть задачу" : "Завершить задачу", task.title, language)}
                  onClick={() => void completeSharedCalendarTask(task)}>{task.completedAt ? <ExperimentalIcon name="check" /> : null}</button>
                <button type="button" className="today-task-open" onClick={() => openSharedCalendarTaskDetails(task)}>
                  <strong data-no-translate>{task.title}</strong><span><em>{task.projectTitle}</em></span>
                </button>
              </article>)}
            </div>
            <SharedTaskPageControls page={sharedTodayPage.page} loaded={sharedTodayTasks.length} busy={sharedTodayPage.busy}
              onMore={() => void sharedTodayPage.more()} onRefresh={() => void sharedTodayPage.refresh()} error={sharedTodayPage.error} />
          </section> : sharedTodayPage.error ? <div role="status"><p>{translateText("Не удалось загрузить данные", language)}</p>
            <button type="button" className="secondary-button" onClick={() => void sharedTodayPage.refresh()}>{isEnglish ? "Retry" : "Повторить"}</button></div> : null}
        </section> : null}</TodayBlock>

        <TodayBlock id="habits">{habitWorkspace.habitSettings.enabled && showToday("habits") ? (
          <Suspense fallback={<DeferredHabitFallback label={language === "en" ? "Opening daily trackers…" : "Открываем трекеры дня…"} />}>
            <HabitDailyPanel
              workspace={habitWorkspace}
              date={todayDateValue}
              language={language}
              timeFormat={activeTimeFormat}
              calendarMode={activeTaskCalendarMode}
              experimentalThemeActive={false}
              onChange={updateHabitWorkspace}
              onSave={(next) => updateHabitWorkspace(next, true) ?? Promise.resolve()}
              onTimerCommand={runHabitTimerCommand}
              onOpenHabits={() => navigateTo("habits")}
              onCreateHabit={() => { setVoiceHabitRequest({ token: Date.now(), kind: "create" }); navigateTo("habits"); }}
            />
          </Suspense>
        ) : null}</TodayBlock>

        <TodayBlock id="events">{sacredFeaturesEnabled && (!webHabitHeader || showToday("events")) && (moon.event || solarEvent) ? (
          <section className="today-event-notices" aria-label="Особая сила сегодняшнего дня" aria-live="polite">
            {moon.event ? (
              <article className="today-event-notice moon-practice-notice">
                <span aria-hidden="true"><MoonPhaseIcon phaseStep={moon.phaseStep} size={34} /></span>
                <div>
                  <span className="eyebrow">{isNewMoonDay ? "Новолуние" : "Полнолуние"}</span>
                  <h2>Сегодня {isNewMoonDay ? "новолуние" : "полнолуние"}</h2>
                  <p>Это время хорошо подходит для аскезы, включая голодание на воде, если у вас нет к этому противопоказаний. При сомнениях заранее посоветуйтесь с врачом.</p>
                </div>
              </article>
            ) : null}
            {solarEvent && solarCopy ? (
              <article className="today-event-notice solar-practice-notice">
                <span className="solar-notice-symbol" aria-hidden="true">{solarEvent.symbol}</span>
                <div>
                  <span className="eyebrow">Солнечная точка года</span>
                  <h2>Сегодня {translateText(solarEvent.name).toLocaleLowerCase(runtimeLocale())}</h2>
                  <time className="solar-notice-time">{formatSolarEventTime(solarEvent.date)}</time>
                  <p><strong>Сила дня.</strong> {solarCopy.force}</p>
                  <p><strong>Древняя Греция.</strong> {solarCopy.greekPractice}</p>
                </div>
              </article>
            ) : null}
          </section>
        ) : null}</TodayBlock>

        <TodayBlock id="details">{sacredFeaturesEnabled ? <div className={`today-lower-grid mode-${activeCalendarMode}`} hidden={!showToday("details")}>
          <section className={`meaning-panel today-mode-panel mode-${activeCalendarMode}`} aria-labelledby="rhythm-title">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">{activeCalendarMode === "lunar" ? "Лунный день" : activeCalendarMode === "profane" ? "Григорианский день" : "Смысл дня"}</span>
                 <h2 id="rhythm-title">{activeCalendarMode === "lunar"
                   ? (isEnglish ? "Today's lunar rhythm" : "Ритм Луны сегодня")
                   : activeCalendarMode === "profane"
                     ? (isEnglish ? "Date in the civil calendar" : "Дата в гражданском календаре")
                     : "Три ритма в одной точке"}</h2>
              </div>
              <span className="ornament" aria-hidden="true">{activeCalendarMode === "lunar" ? "☾" : activeCalendarMode === "profane" ? <CalendarModeIcon mode="profane" size={24} /> : <svg className="three-rhythms-icon" viewBox="0 0 44 44" fill="none"><path d="M22 22V7.04M22 22l12.96 7.48M22 22 9.04 29.48" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="22" cy="7.04" r="3.3" fill="currentColor"/><circle cx="34.96" cy="29.48" r="3.3" fill="currentColor"/><circle cx="9.04" cy="29.48" r="3.3" fill="currentColor"/></svg>}</span>
            </div>
            <div className="meaning-grid">
              {activeCalendarMode === "lunar" ? (
                <>
                  <article className="meaning-card">
                    <span className="meaning-symbol meaning-moon-symbol" aria-hidden="true"><MoonPhaseIcon phaseStep={moon.phaseStep} size={34} /></span>
                    <span className="meaning-label">{lunar.day} {isEnglish ? "lunar day" : "лунный день"}</span>
                    <strong>{moon.epithet}</strong>
                    <p>{moon.phase} · {moon.direction} · {isEnglish ? `${moon.illumination}% illuminated` : `освещённость ${moon.illumination}%`}</p>
                    {moon.event ? <span className="moon-event">{moon.event}</span> : null}
                  </article>
                  <article className="meaning-card">
                    <span className="meaning-symbol" aria-hidden="true">{lunar.month.roman}</span>
                    <span className="meaning-label">Лунный месяц</span>
                    <strong>{lunar.month.name}</strong>
                    <p>{lunar.month.title}</p>
                  </article>
                  <article className="meaning-card">
                    <span className="meaning-symbol" aria-hidden="true">{lunar.isThreshold ? "○" : "≈"}</span>
                    <span className="meaning-label">{isEnglish ? "Month rhythm" : "Ритм месяца"}</span>
                    <strong>{lunar.isThreshold ? "Рубеж" : lunar.decade.name}</strong>
                    <p>{lunar.decade.range} · {lunar.monthLength} {isEnglish ? "days in the month" : "дней в месяце"}</p>
                  </article>
                </>
              ) : activeCalendarMode === "profane" ? (
                <>
                  <article className="meaning-card">
                    <span className="meaning-symbol" aria-hidden="true"><CalendarModeIcon mode="profane" size={34} /></span>
                    <span className="meaning-label">{isEnglish ? "Day of the week" : "День недели"}</span>
                    <strong>{weekdayPatron.weekday}</strong>
                    {sacredFeaturesEnabled ? <p>{weekdayPatron.patronage}</p> : null}
                  </article>
                  <article className="meaning-card">
                    <span className="meaning-symbol" aria-hidden="true">{gregorian.getDate()}</span>
                    <span className="meaning-label">{isEnglish ? "Date" : "Дата"}</span>
                    <strong>{gregorianMonth} {gregorian.getFullYear()}</strong>
                    <p>{gregorianMonthLength} {isEnglish ? "days in this month" : "дней в этом месяце"}</p>
                  </article>
                  <article className="meaning-card">
                    <span className="meaning-symbol" aria-hidden="true">{gregorianWeek}</span>
                    <span className="meaning-label">{isEnglish ? "Week of the year" : "Неделя года"}</span>
                    <strong>{isEnglish ? `${englishOrdinal(gregorianDayOfYear)} day` : `${gregorianDayOfYear}-й день`}</strong>
                    <p>{isEnglish ? `${gregorianDayOfYear} of ${gregorianYearLength} days in the year` : `${gregorianDayOfYear} из ${gregorianYearLength} дней года`}</p>
                  </article>
                </>
              ) : (
                <>
                  <article className="meaning-card">
                    <span className="meaning-symbol" aria-hidden="true">{month.symbol}</span>
                    <span className="meaning-label">Пята {day.pyata || "Ω"}</span>
                    <strong>{day.pyataTitle || "Чистый эфир"}</strong>
                    <p>{info.monthIndex === 12 ? "Законы обычного цикла приостановлены" : PYATA_MEANINGS[day.pyata - 1]}</p>
                  </article>
                  <article className="meaning-card">
                    <span className="meaning-symbol alchemical" aria-hidden="true">{element.symbol}</span>
                    <span className="meaning-label">Стихия</span>
                    <strong>{element.name}</strong>
                    <p>{element.meaning}</p>
                  </article>
                  <article className="meaning-card">
                    <span className="meaning-symbol" aria-hidden="true">{pythagorean?.roman ?? "∞"}</span>
                    <span className="meaning-label">Пифагорейский смысл</span>
                    <strong>{pythagorean?.name ?? "Апейрон"}</strong>
                    <p>{pythagorean?.meaning ?? "Безграничное · Пространство первообразов"}</p>
                  </article>
                </>
              )}
            </div>
          </section>

        </div> : null}</TodayBlock>

      </TodayBlocks>
    );
  };

  const renderModeCalendarDay = (
    date: Date,
    mode: Exclude<CalendarMode, "sacred">,
    layoutIndex: number,
    adjacentMonth: "previous" | "next" | null = null,
    adjacentOpacity = 1,
  ) => {
    const isAdjacentMonth = adjacentMonth !== null;
    const dateValue = inputDate(date);
    const sacred = getSacredDate(date);
    const sacredDay = getSacredDay(sacred.monthIndex, sacred.day);
    const moon = getMoon(date);
    const lunar = getLunarDate(date);
    const solarEvent = sacredFeaturesEnabled ? getSolarEvent(sacred.sacredYear, sacred.monthIndex, sacred.day) : null;
    const cellTasks = isAdjacentMonth ? [] : [...(calendarTasksByDate.get(dateValue) ?? [])]
      .sort((a, b) => a.time.localeCompare(b.time));
    const taskCount = cellTasks.length;
    const sharedCount = isAdjacentMonth ? 0 : (sharedCalendarCounts[dateValue] ?? 0);
    const isToday = !isAdjacentMonth && dateValue === todayDateValue;
    const isSelected = !isAdjacentMonth && dateValue === selectedDateValue;
    const weekdayIndex = date.getDay();
    const isSaturday = weekdayIndex === 6;
    const sunriseSunset = deviceLocation ? getSunriseSunset(date, deviceLocation) : null;
    const solarTimePlaceholder = solarLocationStatus === "ready" ? "нет" : "…";
    const sunrise = sunriseSunset ? displaySolarTime(sunriseSunset.sunrise) : solarTimePlaceholder;
    const sunset = sunriseSunset ? displaySolarTime(sunriseSunset.sunset) : solarTimePlaceholder;
    const popoverOpen = !isAdjacentMonth && openDayTaskPopover === dateValue;
    const sharedPopoverKey = `shared-${dateValue}`;
    const sharedPopoverOpen = !isAdjacentMonth && openDayTaskPopover === sharedPopoverKey;
    const columnCount = mode === "profane" ? 7 : 6;
    const column = layoutIndex % columnCount;
    const popoverAlignment = column < 2 ? "align-left" : column >= columnCount - 2 ? "align-right" : "align-center";
    const weekday = new Intl.DateTimeFormat(runtimeLocale(), { weekday: "short" }).format(date).replace(/\.$/u, "");
    const weekdayPatron = localizeWeekdayPatron(PROFANE_WEEKDAY_PATRONS[date.getDay()], language);
    const profaneDate = new Intl.DateTimeFormat(runtimeLocale(), { day: "numeric", month: "short" }).format(date);
    const adjacentMonthName = isAdjacentMonth
      ? new Intl.DateTimeFormat(runtimeLocale(), { month: "long" }).format(date)
      : "";
    const adjacentMonthDescriptor = adjacentMonth === "previous" ? "Предыдущий месяц" : "Следующий месяц";
    const localizedAdjacentMonth = translateText(adjacentMonthDescriptor, language);

    return (
      <article
        className={`calendar-day calendar-mode-day mode-${mode}${mode === "profane" ? ` weekday-${weekdayIndex}` : ""}${isSelected ? " selected" : ""}${isToday ? " today" : ""}${isSaturday ? " saturday" : ""}${solarEvent ? " solar-day" : ""}${taskCount ? " has-tasks" : ""}${popoverOpen || sharedPopoverOpen ? " popover-open" : ""}${isAdjacentMonth ? ` adjacent-month ${adjacentMonth}-month` : ""}`}
        style={isAdjacentMonth ? { "--adjacent-month-opacity": adjacentOpacity } as CSSProperties : undefined}
        aria-label={isAdjacentMonth
          ? `${formatGregorian(date, true)} — ${localizedAdjacentMonth.toLocaleLowerCase(runtimeLocale())}, ${translateText("Только для просмотра", language).toLocaleLowerCase(runtimeLocale())}`
          : undefined}
        key={`${adjacentMonth ?? "current"}-${dateValue}`}
        data-calendar-date={dateValue}
        data-weekend={mode === "profane" ? weekdayIndex === 6 ? "saturday" : weekdayIndex === 0 ? "sunday" : undefined : undefined}
      >
        {isAdjacentMonth ? null : (
          <button
            type="button"
            className="calendar-day-open"
            onClick={() => openCalendarDate(date, "calendar")}
            aria-pressed={isSelected}
            aria-label={`${formatCalendarDate(date, mode, true)}${sacredFeaturesEnabled ? `${mode === "profane" ? ` — ${weekdayPatron.weekday}, ${weekdayPatron.guidanceTitle}, ${weekdayPatron.patronage}` : ""} — ${sacredDay.name} — ${moon.day} ${translateText("лунный день", language)}` : ""}${solarEvent ? ` — ${solarEvent.name}, ${formatSolarEventTime(solarEvent.date)}` : ""}${taskCount ? ` — ${formatTaskCount(taskCount, language)}` : ""}`}
          />
        )}
        {isAdjacentMonth ? (
          <span className="adjacent-month-label" aria-hidden="true">
            <small>{adjacentMonthDescriptor}</small>
            <strong>{adjacentMonthName}</strong>
          </span>
        ) : null}
        <span className="calendar-mode-primary">
          {mode === "lunar" ? <MoonPhaseIcon phaseStep={moon.phaseStep} size={26} /> : null}
          <strong>{mode === "lunar" ? moon.day : date.getDate()}</strong>
          <small>{mode === "lunar" && lunar.isThreshold ? "Рубеж" : mode === "lunar" ? moon.phase : weekday}</small>
        </span>
        {mode === "profane" && sacredFeaturesEnabled ? (
          <span className="profane-weekday-patron">
            <strong><WeekdaySymbol weekday={date.getDay()} /><span className="profane-weekday-name">{weekdayPatron.weekday}</span></strong>
          </span>
        ) : null}
        <span className="calendar-cross-date profane-date">
          <CalendarModeIcon mode="profane" size={12} />{mode === "profane" ? `${profaneDate} · ${date.getFullYear()}` : profaneDate}
        </span>
        {sacredFeaturesEnabled ? <span className="calendar-cross-date sacred-date" title={sacredDay.name}>
          <b aria-hidden="true">✦</b>{formatCalendarDate(date, "sacred")}
        </span> : null}
        {sacredFeaturesEnabled ? mode === "profane" ? (
          <span className="calendar-cross-date lunar-date" title={moon.phase}>
            <MoonPhaseIcon phaseStep={moon.phaseStep} size={15} />
            <span className="calendar-lunar-day-label">{moon.day} {translateText("лунный день", language)}</span>
          </span>
        ) : (
          <span className="calendar-cross-date lunar-date"><b aria-hidden="true">☾</b>{moon.epithet} · {moon.illumination}%</span>
        ) : null}
        <span
          className="calendar-sun-times"
          aria-label={`${translateText("Рассвет", language)} ${sunrise}, ${translateText("закат", language)} ${sunset}`}
          title={sunriseSunset ? "Рассвет и закат по времени устройства" : "Синхронизируем время рассвета и заката"}
        >
          <span><i aria-hidden="true">↗</i>{sunrise}</span>
          <span><i aria-hidden="true">↘</i>{sunset}</span>
        </span>
        {!sacredFeaturesEnabled && mode === "profane" && !isAdjacentMonth ? <CalendarCellTasks personal={cellTasks}
          shared={sharedMonthTasksByDate.get(dateValue) ?? []} sharedTotal={sharedMonthPreview ? sharedMonthPreview.dateCounts[dateValue] ?? 0 : sharedCount}
          dateLabel={formatGregorian(date, true)} language={language} onPersonal={task => openPersonalCalendarTaskDetails(task, dateValue)}
          onShared={openSharedCalendarTaskDetails} onMore={() => { setOpenDayTaskPopover(""); setCalendarTaskListDate(dateValue); }} /> : null}
        <Suspense fallback={null}><CalendarSharedTaskControl tasks={[]} total={sharedCount} date={dateValue} dateLabel={formatGregorian(date, true)} language={language}
          popoverKey={sharedPopoverKey} alignment={popoverAlignment} openKey={openDayTaskPopover}
          onOpenKey={setOpenDayTaskPopover} onOpenTask={openSharedCalendarTask} onCompleteTask={completeSharedCalendarTask} busyTaskId={calendarCompletionBusy} />
        <CalendarPersonalTaskControl tasks={cellTasks.filter(task => !task.done)} dateLabel={formatGregorian(date, true)} language={language}
          popoverKey={dateValue} alignment={popoverAlignment} openKey={openDayTaskPopover} onOpenKey={setOpenDayTaskPopover}
          onOpenTask={openPersonalCalendarTask} onCompleteTask={task => toggleTask(task.id)} formatTime={time => formatTimeValue(time, activeTimeFormat)} /></Suspense>
        {solarEvent ? <span className="calendar-solar-mark" title={`${solarEvent.name} · ${formatSolarEventTime(solarEvent.date)}`}><b aria-hidden="true">{solarEvent.symbol}</b><em>{solarEvent.shortName}</em><time>{formatSolarEventTime(solarEvent.date)}</time></span> : null}
      </article>
    );
  };

  const renderSacredCalendar = () => {
    const dayCount = monthIndex === 12 ? apeironLength(sacredYear) : 30;
    const days = Array.from({ length: dayCount }, (_, index) => index + 1);
    const rows = Array.from({ length: Math.ceil(dayCount / 5) }, (_, row) =>
      days.slice(row * 5, row * 5 + 5),
    );

    return (
      <div
        className="calendar-view"
        data-genesis-preserve="calendar-grid-and-month-art"
        style={{
          "--month-accent": selectedMonth.color,
          "--month-art": `url("${monthArtUrl(monthIndex)}")`,
        } as CSSProperties}
      >
        <header className="calendar-header">
          <span className="calendar-month-art" aria-hidden="true" />
          <div>
            <span className="eyebrow">{selectedMonth.season} · {selectedMonth.roman} месяц</span>
            <CalendarMonthHeading title={selectedMonth.name} icon={<CalendarModeIcon mode="sacred" size={28}/>}
              previousLabel="Предыдущий месяц" nextLabel="Следующий месяц" onPrevious={() => selectMonth(monthIndex - 1)} onNext={() => selectMonth(monthIndex + 1)}/>
            <p className="calendar-title">{selectedMonth.title}</p>
            <p>{selectedMonth.description}</p>

          </div>
          <div className="month-switcher" aria-label="Переключение месяцев">
            <button type="button" onClick={() => selectMonth(monthIndex - 1)} aria-label="Предыдущий месяц">←</button>
            <span aria-hidden="true">{selectedMonth.symbol}</span>
            <button type="button" onClick={() => selectMonth(monthIndex + 1)} aria-label="Следующий месяц">→</button>
          </div>
        </header>

        <section className="month-calendar" aria-label={`Календарь месяца ${selectedMonth.name}`}>
          {rows.map((row, rowIndex) => {
            const firstDay = getSacredDay(monthIndex, row[0]);
            const pyataDescriptionId = `pyata-description-${monthIndex}-${rowIndex + 1}`;
            const pyataDescriptionKey = `${monthIndex}-${rowIndex + 1}`;
            const pyataDescriptionOpen = openPyataDescription === pyataDescriptionKey;
            const pyataDetail = PYATA_DETAILS[rowIndex];
            return (
              <div className="pyata-row" key={`${monthIndex}-${rowIndex}`}>
                {monthIndex === 12 ? (
                  <div className="pyata-row-label">
                    <span className="pyata-row-kicker">Пята Ω</span>
                    <strong>Вне времени</strong>
                    <small>Чистый эфир</small>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`pyata-row-label pyata-row-toggle${pyataDescriptionOpen ? " is-open" : ""}`}
                    aria-expanded={pyataDescriptionOpen}
                    aria-controls={pyataDescriptionId}
                    aria-label={language === "en" ? `Quinta ${rowIndex + 1}: open description` : `Пята ${rowIndex + 1}: открыть описание`}
                    onClick={() => setOpenPyataDescription((current) => current === pyataDescriptionKey ? "" : pyataDescriptionKey)}
                  >
                    <span className="pyata-row-kicker">Пята {rowIndex + 1}</span>
                    <strong>{firstDay.pyataTitle}</strong>
                    <small>{PYATA_MEANINGS[rowIndex]}</small>
                    <span className="pyata-row-disclosure">
                      <span>{pyataDescriptionOpen ? "Скрыть описание" : "Открыть описание"}</span>
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="m6.5 9 5.5 5.5L17.5 9" />
                      </svg>
                    </span>
                  </button>
                )}
                <div className="pyata-days">
                  {row.map((dayNumber, dayColumn) => {
                    const gregorian = getGregorianDate(sacredYear, monthIndex, dayNumber);
                    const moon = getMoon(gregorian);
                    const sacredDay = getSacredDay(monthIndex, dayNumber);
                    const key = taskDateKey(sacredYear, monthIndex, dayNumber);
                    const gregorianDateValue = inputDate(gregorian);
                    const cellTasks = [...(calendarTasksByDate.get(gregorianDateValue) ?? [])]
                      .sort((a, b) => a.time.localeCompare(b.time));
                    const taskCount = cellTasks.length;
                    const sharedCount = sharedCalendarCounts[gregorianDateValue] ?? 0;
                    const isToday = key === todayKey;
                    const isSelected = dayNumber === selectedDay;
                    const isSaturday = gregorian.getDay() === 6;
                    const profaneWeekday = new Intl.DateTimeFormat(runtimeLocale(), { weekday: "long" }).format(gregorian);
                    const profaneWeekdayShort = new Intl.DateTimeFormat(runtimeLocale(), { weekday: "short" }).format(gregorian).replace(/\.$/, "");
                    const profaneDate = new Intl.DateTimeFormat(runtimeLocale(), { day: "2-digit", month: "short" }).format(gregorian);
                    const solarEvent = sacredFeaturesEnabled ? getSolarEvent(sacredYear, monthIndex, dayNumber) : null;
                    const sunriseSunset = deviceLocation ? getSunriseSunset(gregorian, deviceLocation) : null;
                    const solarTimePlaceholder = solarLocationStatus === "ready" ? "нет" : "…";
                    const sunrise = sunriseSunset ? displaySolarTime(sunriseSunset.sunrise) : solarTimePlaceholder;
                    const sunset = sunriseSunset ? displaySolarTime(sunriseSunset.sunset) : solarTimePlaceholder;
                    const popoverOpen = openDayTaskPopover === key;
                    const sharedPopoverKey = `shared-${key}`;
                    const sharedPopoverOpen = openDayTaskPopover === sharedPopoverKey;
                    const popoverAlignment = dayColumn < 2 ? "align-left" : dayColumn > 2 ? "align-right" : "align-center";
                    return (
                      <article
                        key={dayNumber}
                        className={`calendar-day${isSelected ? " selected" : ""}${isToday ? " today" : ""}${isSaturday ? " saturday" : ""}${solarEvent ? " solar-day" : ""}${taskCount ? " has-tasks" : ""}${popoverOpen || sharedPopoverOpen ? " popover-open" : ""}`}
                      >
                        <button
                          type="button"
                          className="calendar-day-open"
                          onClick={() => {
                            setOpenDayTaskPopover("");
                            setSelectedDay(dayNumber);
                            setDayDetailsOrigin("calendar");
                            setDayDetailsOpen(true);
                          }}
                          aria-pressed={isSelected}
                          aria-label={`${formatGregorian(gregorian, true)} — ${sacredDay.name}${solarEvent ? ` — ${solarEvent.name}, ${formatSolarEventTime(solarEvent.date)}` : ""}${taskCount ? ` — ${formatTaskCount(taskCount, language)}` : ""}`}
                        />
                        <span className="calendar-gregorian">
                          <b className="calendar-weekday">
                            <span className="calendar-weekday-full">{profaneWeekday}</span>
                            <span className="calendar-weekday-short">{profaneWeekdayShort}</span>
                          </b>
                          <span>{profaneDate}</span>
                        </span>
                        <strong>{romanDay(monthIndex, dayNumber)}</strong>
                        <span className="calendar-moon" title={`${moon.epithet}: ${moon.phase}`}><MoonPhaseIcon phaseStep={moon.phaseStep} size={16} /> {moon.day}</span>
                        <span
                          className="calendar-sun-times"
                          aria-label={`Рассвет ${sunrise}, закат ${sunset}`}
                          title={sunriseSunset
                            ? "Рассвет и закат по времени устройства"
                            : solarLocationStatus === "ready"
                            ? "В этот день солнце не пересекает линию горизонта"
                            : "Синхронизируем время рассвета и заката"}
                        >
                          <span><i aria-hidden="true">↗</i>{sunrise}</span>
                          <span><i aria-hidden="true">↘</i>{sunset}</span>
                        </span>
                        <small>{sacredDay.name.split("(")[0].trim()}</small>
                        <Suspense fallback={null}><CalendarSharedTaskControl tasks={[]} total={sharedCount} date={gregorianDateValue} dateLabel={formatGregorian(gregorian, true)} language={language}
                          popoverKey={sharedPopoverKey} alignment={popoverAlignment} openKey={openDayTaskPopover}
                          onOpenKey={setOpenDayTaskPopover} onOpenTask={openSharedCalendarTask} onCompleteTask={completeSharedCalendarTask} busyTaskId={calendarCompletionBusy} />
                        <CalendarPersonalTaskControl tasks={cellTasks.filter(task => !task.done)} dateLabel={formatGregorian(gregorian, true)} language={language}
                          popoverKey={key} alignment={popoverAlignment} openKey={openDayTaskPopover} onOpenKey={setOpenDayTaskPopover}
                          onOpenTask={openPersonalCalendarTask} onCompleteTask={task => toggleTask(task.id)} formatTime={time => formatTimeValue(time, activeTimeFormat)} /></Suspense>
                        {solarEvent ? <span className="calendar-solar-mark" title={`${solarEvent.name} · ${formatSolarEventTime(solarEvent.date)}`}><b aria-hidden="true">{solarEvent.symbol}</b><em>{solarEvent.shortName}</em><time>{formatSolarEventTime(solarEvent.date)}</time></span> : null}
                      </article>
                    );
                  })}
                </div>
                {monthIndex !== 12 && pyataDetail && pyataDescriptionOpen ? (
                  <div
                    className="pyata-row-description"
                    id={pyataDescriptionId}
                    role="region"
                    aria-live="polite"
                  >
                    <span className="pyata-description-number" aria-hidden="true">{rowIndex + 1}</span>
                    <div>
                      <span className="eyebrow">Ритм пяты · действует в каждом месяце</span>
                      <h3>{pyataDetail.title}</h3>
                      <strong>{pyataDetail.archetype}</strong>
                      <p>{pyataDetail.description}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        {monthIndex === 12 ? (
          <section className="apeiron-guide-card" aria-labelledby="apeiron-guide-title">
            <header className="apeiron-guide-header">
              <span className="apeiron-guide-sigil" aria-hidden="true">Ω</span>
              <div>
                <span className="eyebrow">13-й месяц · 5–6 дней вне обычного счёта</span>
                <h2 id="apeiron-guide-title">Апейрон: 13-й месяц и лайф-менеджмент по нашему календарю</h2>
                <p>Солнечный год длится 365 или 366 дней. Если в году 12 месяцев по 30 дней, то куда деваются остальные 5–6 дней? В древних сакральных традициях эти «лишние» дни никогда не смешивали с обычным временем. Они образуют 13-й, тайный месяц нашего календаря — Апейрон.</p>
              </div>
            </header>

            <article className="apeiron-guide-section apeiron-outside-time">
              <span className="apeiron-guide-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32" focusable="false">
                  <path d="M9 4h14M9 28h14M11 5c0 5 1.5 7.2 5 10.2C19.5 12.2 21 10 21 5M11 27c0-5 1.5-7.2 5-10.2 3.5 3 5 5.2 5 10.2" />
                </svg>
              </span>
              <div>
                <h3>Апейрон: Время вне времени (14.03–19.03)</h3>
                <p>Слово «Апейрон» означает «Безграничное». Это 5–6 дней Святок перед весенним равноденствием. В эти дни законы 12 месяцев перестают действовать. Нет ни Пят, ни строгой иерархии стихий.</p>
                <p>Если 360 дней года — это Порядок (Космос), то Апейрон — это изначальный Хаос. В теологии это время Протогеносов (Первобогов), которые существовали до появления формы:</p>
              </div>
            </article>

            <div className="apeiron-protogenoi" aria-label="Протогеносы Апейрона">
              <article><span aria-hidden="true">Χ</span><div><strong>Хаос</strong><p>Нулевая точка, чистый, непредсказуемый потенциал.</p></div></article>
              <article><span aria-hidden="true">Ν</span><div><strong>Нюкс · Ночь</strong><p>Темнота, в которой в скрытом виде хранятся семена нового года.</p></div></article>
              <article><span aria-hidden="true">Ε</span><div><strong>Эребос · Мрак</strong><p>Плотная пустота растворения старых эго-конструкций.</p></div></article>
              <article><span aria-hidden="true">Τ</span><div><strong>Тартарос · Бездна</strong><p>Касание самого дна бессознательного, фундамента психики.</p></div></article>
              <article><span aria-hidden="true">Ἔ</span><div><strong>Эрос · Влечение</strong><p>Первичная гравитация, которая начинает стягивать элементы для новой жизни.</p></div></article>
              <article className="phanes"><span aria-hidden="true">Φ</span><div><strong>Фанес · Сияние</strong><p>Шестой, високосный день. Вспышка света за секунду до старта нового цикла.</p></div></article>
            </div>

            <div className="apeiron-practice-grid">
              <article className="apeiron-practice-card">
                <span className="apeiron-guide-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" focusable="false">
                    <path d="M16 10a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0-6v3m0 18v3M4 16h3m18 0h3M7.5 7.5l2.1 2.1m12.8 12.8 2.1 2.1m0-17-2.1 2.1M9.6 22.4l-2.1 2.1" />
                  </svg>
                </span>
                <div>
                  <h3>Практика лайф-менеджмента в Апейрон</h3>
                  <p>В эти дни категорически нельзя ставить цели по метрикам Земли или Воды. Это период «Титаномахии» — крушения старых систем. Задача 13-го месяца — полная перезагрузка, информационный детокс и добровольный отказ от контроля, чтобы в месяц Арейос (20 марта) войти с абсолютно чистым листом.</p>
                  <p>Есть два типа аскезы в Святки: полное ограничение себя от общества либо максимально трансгрессивные практики на грани.</p>
                </div>
              </article>

              <article className="apeiron-practice-card anabasis">
                <span className="apeiron-guide-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" focusable="false">
                    <path d="M16 28c6 0 10-4 10-10 0-5-3-8-7-13 0 6-3 8-5 10-1-3-3-5-5-7 0 6-3 8-3 12 0 5 4 8 10 8Z" />
                    <path d="M16 26c3 0 5-2 5-5 0-2-1-4-3-6 0 3-1 4-3 6-1-2-2-3-3-4 0 3-1 4-1 6 0 2 2 3 5 3Z" />
                  </svg>
                </span>
                <div>
                  <h3>Закон Анабасиса</h3>
                  <p>И последнее важнейшее правило календаря — принцип Восхождения (Анабасиса). Стихии в Пяте идут строго от Земли к Эфиру, а не наоборот. Это защита от выгорания.</p>
                  <p>Нельзя зажечь Огонь воли, если ты не подготовил Воздух (план, коммуникацию) и не увлажнил почву Водой (эмоциональный ресурс). Каждая Пята заставляет нас стартовать с плотной, скучной Земли (рутины), чтобы к пятому дню заслуженно выйти в Эфир (чистое творчество и синтез).</p>
                </div>
              </article>
            </div>

            <div className="apeiron-element-ascent" aria-label="Путь Анабасиса от Земли к Эфиру">
              <span><b aria-hidden="true">🜃</b><strong>Земля</strong><small>рутина</small></span>
              <i aria-hidden="true">→</i>
              <span><b aria-hidden="true">🜄</b><strong>Вода</strong><small>ресурс</small></span>
              <i aria-hidden="true">→</i>
              <span><b aria-hidden="true">🜁</b><strong>Воздух</strong><small>план</small></span>
              <i aria-hidden="true">→</i>
              <span><b aria-hidden="true">🜂</b><strong>Огонь</strong><small>воля</small></span>
              <i aria-hidden="true">→</i>
              <span><b aria-hidden="true">✦</b><strong>Эфир</strong><small>синтез</small></span>
            </div>
          </section>
        ) : null}

      </div>
    );
  };

  const renderAlternativeCalendar = (mode: Exclude<CalendarMode, "sacred">) => {
    const lunarDates = mode === "lunar" ? getLunarMonthDates(selectedLunarMonthIndex) : [];
    const dates = mode === "profane" ? profaneMonthDates(selectedDate) : lunarDates;
    const firstDate = dates[0] ?? selectedDate;
    const lastDate = dates.at(-1) ?? selectedDate;
    const lunarOrdinal = selectedLunarMonthIndex - selectedLunarYear.startMonthIndex + 1;
    const lunarDefinition = getLunarMonthDefinition(lunarOrdinal);
    const monthTitle = mode === "profane" ? profaneMonthName(selectedDate) : lunarDefinition.name;
    const monthEyebrow = mode === "profane"
      ? (language === "en" ? `Gregorian calendar · ${selectedDate.getFullYear()}` : `Григорианский календарь · ${selectedDate.getFullYear()} год`)
      : (language === "en"
          ? `Lunar year ${selectedLunarYear.sacredYear}–${selectedLunarYear.sacredYear + 1} · month ${lunarDefinition.roman} of ${selectedLunarYear.monthCount}`
          : `Лунный год ${selectedLunarYear.sacredYear}–${selectedLunarYear.sacredYear + 1} · ${lunarDefinition.roman} месяц из ${selectedLunarYear.monthCount}`);
    const monthSubtitle = mode === "profane"
      ? sacredFeaturesEnabled ? `${profaneMonthName(selectedDate)} · ${dates.length} дней` : `${dates.length} дней`
      : `${lunarDefinition.title} · ${formatDateRange(firstDate, lastDate)}`;
    const monthDescription = mode === "profane"
      ? activeWeekStart === "monday"
        ? "Григорианский календарный месяц с неделями с понедельника по воскресенье. В каждом дне дополнительно показаны покровители дня, сакральная дата, лунные сутки, рассвет и закат."
        : "Григорианский календарный месяц с неделями с воскресенья по субботу. В каждом дне дополнительно показаны покровители дня, сакральная дата, лунные сутки, рассвет и закат."
      : lunarDefinition.description;
    const leadingDays = mode === "profane" ? gregorianWeekdayOffset(firstDate, activeWeekStart) : 0;
    const trailingDays = mode === "profane" ? (7 - ((leadingDays + dates.length) % 7)) % 7 : 0;
    const previousMonthDates = mode === "profane"
      ? Array.from({ length: leadingDays }, (_, index) => new Date(
          firstDate.getFullYear(),
          firstDate.getMonth(),
          1 - leadingDays + index,
          12,
        ))
      : [];
    const nextMonthDates = mode === "profane"
      ? Array.from({ length: trailingDays }, (_, index) => new Date(
          lastDate.getFullYear(),
          lastDate.getMonth(),
          lastDate.getDate() + index + 1,
          12,
        ))
      : [];
    const adjacentMonthOpacity = (position: "previous" | "next", index: number, count: number) => {
      if (count <= 1) return 0.54;
      const progress = index / (count - 1);
      return position === "previous" ? 0.24 + (progress * 0.3) : 0.54 - (progress * 0.3);
    };
    const weekdayLabels = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(2024, 0, (activeWeekStart === "monday" ? 8 : 7) + index, 12);
      return new Intl.DateTimeFormat(runtimeLocale(), { weekday: "short" }).format(day).replace(/\.$/u, "");
    });
    const moveMonth = (delta: number) => {
      if (mode === "profane") {
        selectCalendarDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + delta, 1, 12));
        return;
      }
      selectCalendarDate(getLunarMonthStart(selectedLunarMonthIndex + delta));
    };

    return (
      <div
        className={`calendar-view calendar-mode-view mode-${mode}`}
        style={{
          "--month-accent": mode === "lunar" ? lunarMonthColor(lunarDefinition.index) : "var(--ui-accent)",
          "--month-art": `url("${mode === "lunar" ? lunarMonthArtUrl(lunarDefinition.index) : `${APP_BASE}/${gregorianMonthArt(selectedDate.getMonth(), seasonLocation)}`}")`,
          "--month-panorama": mode === "profane" ? `url("${APP_BASE}/${gregorianMonthPanoramaArt(selectedDate.getMonth(), seasonLocation)}")` : undefined,
        } as CSSProperties}
      >
        <header className="calendar-header calendar-mode-header">
          <span className={mode === "lunar" ? "calendar-month-art" : "gregorian-season-art"} aria-hidden="true" />
          <div>
            {sacredFeaturesEnabled ? <span className="eyebrow">{monthEyebrow}</span> : null}
            <CalendarMonthHeading title={monthTitle} icon={sacredFeaturesEnabled ? <CalendarModeIcon mode={mode} size={28}/> : null}
              previousLabel={mode === "profane" ? "Предыдущий календарный месяц" : "Предыдущий лунный месяц"}
              nextLabel={mode === "profane" ? "Следующий календарный месяц" : "Следующий лунный месяц"} onPrevious={() => moveMonth(-1)} onNext={() => moveMonth(1)}/>
            <p className="calendar-title">{monthSubtitle}</p>
            {sacredFeaturesEnabled ? <p>{monthDescription}</p> : null}

          </div>
          <div className="month-switcher" aria-label={mode === "profane" ? "Переключение календарных месяцев" : "Переключение лунных месяцев"}>
            <button type="button" onClick={() => moveMonth(-1)} aria-label={mode === "profane" ? "Предыдущий календарный месяц" : "Предыдущий лунный месяц"}>←</button>
            <span aria-hidden="true">{sacredFeaturesEnabled ? <CalendarModeIcon mode={mode} size={35} /> : gregorianMonthNumber(firstDate, gregorianYearStartsInMarch ? "march" : "january")}</span>
            <button type="button" onClick={() => moveMonth(1)} aria-label={mode === "profane" ? "Следующий календарный месяц" : "Следующий лунный месяц"}>→</button>
          </div>
        </header>

        <section className={`month-calendar calendar-mode-calendar mode-${mode}`} aria-label={`${CALENDAR_MODE_META[mode].label}: ${monthTitle}`}>
          {mode === "profane" ? (
            <div className="calendar-mode-weekdays" aria-hidden="true">
              {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
            </div>
          ) : null}
          {mode === "profane" ? (
            <div className="calendar-mode-days">
              {previousMonthDates.map((date, index) => renderModeCalendarDay(
                date,
                mode,
                index,
                "previous",
                adjacentMonthOpacity("previous", index, previousMonthDates.length),
              ))}
              {dates.map((date, index) => renderModeCalendarDay(date, mode, leadingDays + index))}
              {nextMonthDates.map((date, index) => renderModeCalendarDay(
                date,
                mode,
                leadingDays + dates.length + index,
                "next",
                adjacentMonthOpacity("next", index, nextMonthDates.length),
              ))}
            </div>
          ) : (
            <div className="lunar-decades">
              {LUNAR_DECADES.map((decade) => {
                const decadeDates = dates.filter((date) => getLunarDate(date).decade.id === decade.id);
                return (
                  <section className={`lunar-decade decade-${decade.id}`} aria-labelledby={`lunar-decade-${decade.id}`} key={decade.id}>
                    <header>
                      <span aria-hidden="true">{decade.id === "growth" ? "☽" : decade.id === "fullness" ? "○" : "☾"}</span>
                      <div><strong id={`lunar-decade-${decade.id}`}>{decade.name}</strong><small>{decade.range}</small></div>
                    </header>
                    <div className="calendar-mode-days">
                      {decadeDates.map((date, index) => renderModeCalendarDay(date, mode, index))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderCalendar = () => activeCalendarMode === "sacred" ? renderSacredCalendar() : renderAlternativeCalendar(activeCalendarMode);

  const renderProjectCreateForm = (projectRows = flattenProjects(projects).filter(({ project }) => project.status === "active")) => (
    <form id="personal-project-create" className="project-form editor-modal personal-project-create-modal" onSubmit={addProject}
      ref={newProjectDialogRef}
      role="dialog" aria-modal="true"
      aria-label={language === "en" ? "New project" : "Новый проект"}>
              <header className="dialog-heading"><h2>{language === "en" ? "New project" : "Новый проект"}</h2><DialogCloseButton type="button" className="modal-close" aria-label={language === "en" ? "Close" : "Закрыть"} onClick={() => setExperimentalProjectFormOpen(false)} /></header>
              <label>
                <span>Новый проект или подпроект</span>
                <input data-dialog-initial-focus value={newProjectTitle} onChange={(event) => setNewProjectTitle(event.target.value)} placeholder="Название результата" />
              </label>
              <label>
                <span>Описание проекта</span>
                <textarea value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} placeholder="Цель, ожидаемый результат и важные детали" rows={3} />
              </label>
              <div className="project-form-grid">
                <label>
                  <span>Категория</span>
                  <select value={newProjectCategory} onChange={(event) => setNewProjectCategory(event.target.value)}>
                    <option value="">Без категории</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{localizeCategoryName(category, language)}</option>)}
                  </select>
                </label>
                <label>
                  <span>Родительский проект</span>
                  <select value={newProjectParent} onChange={(event) => setNewProjectParent(event.target.value)}>
                    <option value="">Нет — верхний уровень</option>
                    {projectRows.map(({ project, depth }) => <option key={project.id} value={project.id}>{"— ".repeat(depth)}{project.title}</option>)}
                  </select>
                </label>
              </div>
              <label>
                <span>Теги проекта</span>
                <input value={newProjectTags} onChange={(event) => setNewProjectTags(event.target.value)} placeholder="стратегия, дом, развитие" />
              </label>
              <button type="submit" className="add-task-button" disabled={!newProjectTitle.trim()}><span aria-hidden="true">{experimentalThemeActive ? <ExperimentalIcon name="plus" /> : "＋"}</span> Создать проект</button>
                </form>
  );

  const renderProjects = () => {
    if (diaryOpen && cloudUser) return <Suspense fallback={<DeferredViewFallback label={language === 'en' ? diaryCopy.en.loading : diaryCopy.ru.loading} />}><DiaryPage language={language} onClose={() => { setDiaryOpen(false); const url = new URL(location.href); url.searchParams.delete("diary"); history.replaceState(history.state, "", url); }} /></Suspense>;
    if (personalMindmapsEnabled && mindmapsOpen && cloudUser) return <Suspense fallback={<DeferredViewFallback label="Открываем майндмепы…" />}>
      <Mindmaps key={cloudUser.uid} userId={cloudUser.uid} tasks={tasks} projects={projects} projectId={mindmapsProjectId} projectForTask={resolvedTaskProjectId}
        onClose={() => { setMindmapsOpen(false); setMindmapsProjectId(null); const url = new URL(location.href); url.searchParams.delete("mindmap"); history.replaceState({}, "", url); requestAnimationFrame(() => window.scrollTo(0, mindmapsReturnScroll.current)); }}
        onCreateTask={request => {
          openTaskComposer("projects"); const draft = request.task;
          setTaskTitle(draft?.title ?? request.title); setTaskDescription(draft?.description ?? "");
          setTaskProject(draft?.projectId ?? request.projectId ?? ""); setTaskTaskListId(draft?.googleTaskListId ?? "");
          setTaskUndated(Boolean(draft && !draft.dueDate)); setTaskDueDate(draft?.dueDate ?? todayDateValue); setTaskEndDate(draft?.endDate ?? todayDateValue);
          setTaskTime(draft?.time ?? ""); setTaskReminders(draft?.reminders ?? []); setTaskPriority(String(draft?.priority ?? 5));
          setTaskTags(draft?.tags.join(", ") ?? ""); setTaskDependsOn(draft?.dependsOnIds ?? []); setTaskSyncAccountIds(draft?.syncAccountIds ?? null);
          if (draft) setTaskFormCalendar(draft.calendarMode);
          setTaskRecurrenceConfig({ ...DEFAULT_RECURRENCE_CONFIG, enabled: false }); setMindmapConversion(request);
        }}
        onEditTask={(task,date)=>setPersonalPreview({kind:"task",id:task.id,date})}
        onToggleTask={(task, date) => {
          if (task.googleReadOnly) return;
          if (!date || task.recurrenceMode === "none") { toggleTask(task.id); return; }
          const unfinished = task.dependsOnIds.some(id => tasks.some(t => t.id === id && !t.done));
          if (unfinished && !task.done) { setSyncError("Сначала завершите зависимости задачи."); return; }
          const remaining = taskSeriesAfterExcludingOccurrence(task, date);
          const occurrence = standaloneTaskFromOccurrence({ ...taskForOccurrence(task,date), id: uid(), recurrenceOriginalDate: date,
            done: !task.done, completedAt: task.done ? null : new Date().toISOString(), googleEventId:null, googleTaskId:null, googleLinks:{}, updatedAt:timestamp() },task.id);
          setTasks(current => [...current.filter(t => t.id !== task.id && t.id !== occurrence.id), ...(remaining ? [remaining] : []), occurrence]);
          if (remaining) saveTask(remaining); else if (cloudUser.calendarConnected) void removeCloudTask(cloudUser.uid,task);
          saveTask(occurrence);
        }}
        onCalendar={(task,date) => { const value = date || task.dueDate; if (value) {
          setMindmapsOpen(false); const url = new URL(location.href); url.searchParams.delete("mindmap"); history.replaceState({}, "", url);
          openCalendarDate(new Date(`${value}T12:00:00`), "year");
        } }}
        onProject={id => {
          setMindmapsOpen(false); const url = new URL(location.href); url.searchParams.delete("mindmap"); history.replaceState({}, "", url);
          setExpandedExperimentalProjects(ids => ids.includes(id) ? ids : [...ids,id]);
        }} />
    </Suspense>;
    const searchTerms = tagSearch
      .toLocaleLowerCase(runtimeLocale())
      .split(/[\s,;#]+/)
      .map((term) => term.trim())
      .filter(Boolean);
    const isCompletedProject = (project: GenesisProject) => {
      const visited = new Set<string>(); let current: GenesisProject | undefined = project;
      while (current && !visited.has(current.id)) {
        if (current.status !== "active") return true;
        visited.add(current.id); current = projects.find((item) => item.id === current?.parentId);
      }
      return false;
    };
    const completedCount = projects.filter(isCompletedProject).length;
    const completedView = completedProjectsOpen && completedCount > 0;
    const visibleProjects = projects.filter((project) => isCompletedProject(project) === completedView
      || !completedView && completingProjectIds.includes(project.id));

    const matchingTaggedProjects = visibleProjects.filter((project) => searchTerms.length > 0 && matchesAffair(project, tagSearch));
    const matchingProjectIds = new Set(matchingTaggedProjects.map((project) => project.id));
    if (searchTerms.length) {
      let changed = true;
      while (changed) {
        changed = false;
        projects.forEach((project) => {
          if (matchingProjectIds.has(project.id) && project.parentId && !matchingProjectIds.has(project.parentId)) {
            matchingProjectIds.add(project.parentId);
            changed = true;
          }
        });
      }
    }
    const projectRows = flattenProjects(projects).filter(({ project }) => visibleProjects.includes(project) && (!searchTerms.length || matchingProjectIds.has(project.id)));
    const inboxTasks = tasks.filter((task) => !resolvedTaskProject(task));
    const matchingTasks = tasks.filter((task) => { const project = resolvedTaskProject(task); return (!project || isCompletedProject(project) === completedView) && matchesAffair(task, tagSearch); });
    const inboxTaskLists = taskListsForWorkspace.filter((taskList) => !linkedProjectId(taskList.id));
    const rootProjects = projects.filter((project) => !project.parentId).length;

    return (
      <div className="projects-view" data-exp-layout="view">
        <WorkspaceHeader title={language === "en" ? "Affairs · personal" : "Дела · личные"} overviewLabel={language === "en" ? "Overview" : "Обзор"}
          description="Разделяйте большие замыслы на подпроекты и конкретные действия. Связи, повторения и сроки остаются видимыми в плане дня."
          mark={<ProjectsHeroMark />}>
          <div className="projects-summary" aria-label="Сводка проектов">
            <span><strong>{projects.length}</strong> {language === "en" ? "projects" : "проектов"}</span>
            <span><strong>{rootProjects}</strong> основных</span>
            <span><strong>{projects.length - rootProjects}</strong> {language === "en" ? "subprojects" : "подпроектов"}</span>
          </div>
        </WorkspaceHeader>
        {featureAllowed(cloudUser?.featureAccess,'shared-projects') && cloudUser?.sharedProjectsEligible && !sharedProjectsVisible ? <Suspense fallback={null}><SharedAffairsHint language={language} onGuide={() => {
          setAccountGuideUserId(cloudUser.uid);
          setAccountMenuOpen(false);
          setAccountOpen(true);
        }} /></Suspense> : null}
        <div className="project-toolbar" data-has-completed={completedCount > 0}>
        {completedCount > 0 ? <div className="affairs-actions">
          <div className="project-completion-tabs" role="group" aria-label={language === "en" ? "Project status" : "Статус проектов"}>
            <button type="button" aria-pressed={!completedView} onClick={() => setCompletedProjectsOpen(false)}>{language === "en" ? "Current" : "Текущие"} · {projects.length - completedCount}</button>
            <button type="button" aria-pressed={completedView} onClick={() => setCompletedProjectsOpen(true)}>{language === "en" ? "Completed" : "Завершённые"} · {completedCount}</button>
          </div>
        </div> : null}

        <div className="personal-search-actions">
        <div className="personal-notebook-launches">
        {personalMindmapsEnabled ? <MindmapLaunchButton label={translateText("Майндмепы",language)} className="personal-mindmaps-entry" onClick={() => { mindmapsReturnScroll.current = window.scrollY; setMindmapsProjectId(null); setMindmapsOpen(true); }} /> : null}
        {cloudUser ? <DiaryLaunchButton label={language === 'en' ? diaryCopy.en.title : diaryCopy.ru.title} onClick={() => { setMindmapsOpen(false); setDiaryOpen(true); const url = new URL(location.href); url.searchParams.set("diary", "1"); history.pushState(history.state, "", url); }} /> : null}
        </div>
        <label className="task-order-choice"><select aria-label={language==="en"?"Sort tasks":"Сортировка задач"} value={personalTaskDisplay.sort} onChange={event=>personalTaskDisplay.setSort(event.target.value as TaskListOrder)}>{taskListOrders.map(order=><option key={order.value} value={order.value}>{language==="en"?order.en:order.ru}</option>)}</select></label>
        <label className="tag-search personal-affairs-search">
          <span aria-hidden="true">{experimentalThemeActive ? <ExperimentalIcon name="search" /> : "⌕"}</span>
          <input aria-label="Поиск задач и проектов по названию или #тегу" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="Поиск задач и проектов по названию или #тегу" />
          {tagSearch ? <button type="button" onClick={() => setTagSearch("")} aria-label="Очистить поиск">{experimentalThemeActive ? <ExperimentalIcon name="close" /> : "×"}</button> : null}
        </label>
        </div>
        </div>

        {searchTerms.length ? (
          <section className="tag-search-results" aria-live="polite" aria-label="Результаты поиска дел">
            <header>
              <strong>Результаты поиска</strong>
              <span>{matchingTaggedProjects.length} проектов · {matchingTasks.length} задач</span>
            </header>
            <div>
              {matchingTaggedProjects.map((project) => (
                <button type="button" key={`project-${project.id}`} onClick={() => setPersonalPreview({kind:"project",id:project.id})}>
                  <span>Проект</span><strong data-no-translate>{project.title}</strong><small data-no-translate>{project.tags.map((tag) => `#${tag}`).join(" ")}</small>
                </button>
              ))}
              {!matchingTaggedProjects.length && !matchingTasks.length ? <p>Совпадений нет. Попробуйте другое название или тег.</p> : null}
            </div>
            {renderTaskRows(matchingTasks)}
          </section>
        ) : null}

        <div className="projects-layout" hidden={searchTerms.length > 0}>
          <section className="project-tree-panel" aria-labelledby={experimentalThemeActive ? "experimental-project-tree-title" : "project-tree-title"} data-exp-ui="panel">
            {!completedView && accountLayout.personalInboxHidden ? <InboxRestore english={language === "en"} onRestore={() => saveLayout({ personalInboxHidden: false })} /> : null}
            <div className={`project-tree-workspace${completedView ? " is-completed-view" : ""}`} data-inbox-workspace data-inbox-position={accountLayout.personalInboxPosition} data-inbox-hidden={accountLayout.personalInboxHidden || completedView}>
              {!completedView ? <section
                className={`inbox-card${projectDropTargetId === TASK_INBOX_PROJECT_ID ? " drop-target" : ""}`}
                hidden={accountLayout.personalInboxHidden}
                data-inbox-compact={accountLayout.personalInboxCompact}
                data-project-drop-id={TASK_INBOX_PROJECT_ID}
                aria-labelledby="project-inbox-title"
              >
                <InboxToolbar title={language === "en" ? "Inbox" : "Хаос-бокс"} scopeLabel={language === "en" ? "personal" : "личный"} titleId="project-inbox-title"
                  count={inboxTasks.length + inboxTaskLists.length} english={language === "en"} position={accountLayout.personalInboxPosition}
                  compact={accountLayout.personalInboxCompact} onCompact={personalInboxCompact => saveLayout({ personalInboxCompact })}
                  onPosition={personalInboxPosition => saveLayout({ personalInboxPosition })} onHide={() => saveLayout({ personalInboxHidden: true })} />
                <p>{projectDragItem ? "Отпустите здесь, чтобы убрать элемент из проекта." : <><span className="project-drag-hint-desktop">Перетащите плашку задачи или списка в проект либо в хаос-бокс.</span><span className="project-drag-hint-touch">Для переноса удерживайте задачу или список, затем перетащите. Для прокрутки проведите пальцем без удержания.</span></>}</p>
                {!inboxTasks.length && !inboxTaskLists.length ? <p>{language === "en" ? "No unsorted tasks yet." : "Задач без проекта пока нет."}</p> : null}
                <div className="inbox-card-items">
                  {inboxTaskLists.map((taskList) => {
                    const item: ProjectDragItem = { kind: "task-list", id: taskList.id, title: taskList.title };
                    const taskCount = tasks.filter((task) => task.googleTaskListId === taskList.id).length;
                    return (
                      <article className="inbox-list-item project-draggable-item" key={taskList.id} aria-label={`Перетащить список «${taskList.title}»`} {...projectDragProps(item)}>
                        <button type="button" className="task-preview-open task-list-entry-open" data-affair-drag-surface onClick={()=>setPersonalPreview({kind:"task-list",id:taskList.id})}><strong className="task-list-entry-title" data-no-translate>{taskList.title}</strong><small className="task-list-entry-meta" data-no-translate>{formatTaskListCount(taskCount, language)}</small></button>
                        <span className="task-list-column-actions">
                          <button type="button" onClick={() => setPersonalPreview({kind:'task-list',id:taskList.id})} aria-label={`Редактировать список «${taskList.title}»`}>{experimentalThemeActive ? <ExperimentalIcon name="edit" /> : "✎"}</button>
                          {!taskList.isDefault ? <button type="button" onClick={() => void deleteTaskList(taskList)} aria-label={`Удалить список «${taskList.title}»`}>{experimentalThemeActive ? <ExperimentalIcon name="close" /> : "×"}</button> : null}
                        </span>
                      </article>
                    );
                  })}
                  {renderTaskRows(inboxTasks)}
                </div>
              </section> : null}

              {!completedView && !accountLayout.personalInboxHidden ? <InboxResizeBoundary position={accountLayout.personalInboxPosition} width={accountLayout.personalInboxWidth} onWidth={personalInboxWidth => saveLayout({ personalInboxWidth })} /> : null}
              <div className="project-tree-main" data-projects-compact={accountLayout.personalInboxCompact}>
                {!experimentalThemeActive ? <div className="section-heading compact-heading">
                  <div><span className="eyebrow">Иерархия</span><h2 id="project-tree-title">Дерево проектов</h2></div>
                  <span className="ornament" aria-hidden="true">◎</span>
                </div> : null}
                <header className="experimental-tree-heading"><div><h2 id={experimentalThemeActive ? "experimental-project-tree-title" : "project-tree-title"}>Дерево проектов</h2><p>{language === "en" ? "Organize projects, tasks and lists" : "Организуйте проекты, задачи и списки"}</p></div>
                  <div className="project-tree-header-actions"><small>{rootProjects} {language === "en" ? "top level" : "верхнего уровня"}</small>
                    <div className="project-tree-create-actions">
                      <button type="button" className="primary-button project-create-task" onClick={() => openTaskComposer("projects")}><ExperimentalIcon name="plus" />{language === "en" ? "Create task" : "Создать задачу"}</button>
                      <button type="button" className="secondary-button project-create-project" aria-expanded={experimentalProjectFormOpen} aria-controls="personal-project-create"
                        onClick={() => { setExperimentalProjectFormOpen(!experimentalProjectFormOpen); setNewProjectParent(""); }}><ExperimentalIcon name="plus" />{language === "en" ? "Create project" : "Создать проект"}</button>
                    </div>
                  </div>
                </header>
                <div className="project-tree">
              {projectRows.length ? projectRows.map(({ project, depth }) => {
                const category = categories.find((item) => item.id === project.categoryId);
                const projectTasks = tasks.filter((task) => resolvedTaskProjectId(task) === project.id);
                const projectTaskLists = taskLists.filter((taskList) => (
                  taskListLinks.some((link) => link.taskListId === taskList.id && link.projectId === project.id)
                ));
                const finished = projectTasks.filter((task) => task.done).length;
                const projectExpanded = expandedExperimentalProjects.includes(project.id);
                const expandProject = () => {
                  setTaskProject(project.id);
                  setExpandedExperimentalProjects(ids => ids.includes(project.id) ? ids.filter(id => id !== project.id) : [...ids, project.id]);
                };
                return (
                  <article
                    className={`project-row${projectDropTargetId === project.id ? " drop-target" : ""}${expandedExperimentalProjects.includes(project.id) ? " is-expanded" : ""}`}
                    key={project.id}
                    data-project-drop-id={project.id}
                    style={{ "--project-depth": depth, "--project-color": category?.color ?? "#8d7750" } as CSSProperties}
                  >
                    <div className="project-open" data-expanded={projectExpanded || undefined}>
                      <button type="button" className="project-expand" aria-expanded={projectExpanded} aria-controls={`personal-project-tasks-${project.id}`}
                        aria-label={`${translateText(projectExpanded ? "Свернуть" : "Развернуть", language)}: ${project.title}`} onClick={expandProject}>
                        <ExperimentalIcon name="chevron" />
                      </button>
                      <div className="project-info">
                        <button type="button" className="project-preview-title" aria-expanded={projectExpanded} aria-controls={`personal-project-tasks-${project.id}`}
                          onClick={event => { if (mobileLayout || event.detail <= 1) expandProject(); }}
                          onDoubleClick={() => { if (!mobileLayout) setPersonalPreview({kind:"project",id:project.id}); }}>
                          <strong data-no-translate>{project.title}</strong>
                        </button>
                        {isCompletedProject(project) ? <span className="project-completed-label">Завершено</span> : null}
                        <small>{category?.name ?? "Без категории"} · {finished}/{projectTasks.length} действий{projectTaskLists.length
                          ? cloudUser?.authProvider === "yandex" ? ` · GENESIS: ${projectTaskLists.length}`
                            : ` · ${projectTaskLists.length} списков Google Tasks` : ""}</small>
                        {!accountLayout.personalInboxCompact && project.description ? <p data-no-translate>{project.description}</p> : null}
                        {!accountLayout.personalInboxCompact && project.tags.length ? <em data-no-translate>{project.tags.map((tag) => `#${tag}`).join("  ")}</em> : null}
                      </div>
                    </div>
                    <button type="button" className={`project-complete-action${completingProjectIds.includes(project.id) ? " is-completing" : ""}`} aria-pressed={project.status !== "active"} disabled={completingProjectIds.includes(project.id)}
                      aria-label={namedAction(project.status !== "active" ? "Вернуть проект" : "Завершить проект", project.title, language)}
                      title={project.status !== "active" ? (language === "en" ? "Restore" : "Вернуть") : "Завершить проект"} onClick={() => project.status === "active" ? setProjectToComplete(project) : toggleProject(project.id)}>
                      {project.status !== "active" && !completingProjectIds.includes(project.id)
                        ? <svg className="project-restore-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1.7 7.3M4 4v6h6"/></svg>
                        : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/></svg>}
                    </button>
                    <div className="project-row-actions">
                    <button type="button" className="project-preview personal-action-hint" data-action-hint={translateText("Открыть проект", language)} aria-label={namedAction("Открыть проект", project.title, language)} aria-haspopup="dialog"
                      onClick={() => setPersonalPreview({kind:"project",id:project.id})}><ExperimentalIcon name="eye" /></button>
                    {experimentalThemeActive ? <button type="button" className="experimental-add-subproject personal-action-hint" data-action-hint={translateText("Новый подпроект", language)} aria-label={`${translateText("Новый подпроект", language)}: ${project.title}`}
                      onClick={() => { setNewProjectParent(project.id); setExperimentalProjectFormOpen(true); }}><ExperimentalIcon name="plus" /></button> : null}
                    <button type="button" className="project-edit personal-action-hint" data-action-hint={translateText("Редактировать проект", language)} onClick={() => openProjectEditor(project)} aria-label={namedAction("Редактировать проект", project.title, language)}>{experimentalThemeActive ? <ExperimentalIcon name="edit" /> : "✎"}</button>
                    {sharedProjectsAvailable ? <button type="button" className="project-transfer personal-action-hint" data-action-hint={translateText("Переместить в общие", language)}
                      onClick={() => setTransferProject(project)}
                      aria-label={`${translateText("Переместить в общие", language)}: ${project.title}`}>
                      {experimentalThemeActive ? <ExperimentalIcon name="open" /> : "↗"}</button> : null}
                    <button type="button" className="project-delete personal-action-hint" data-action-hint={translateText("Удалить проект", language)} onClick={() => void deleteProject(project.id)} aria-label={namedAction("Удалить проект", project.title, language)}>{experimentalThemeActive ? <ExperimentalIcon name="delete" /> : "×"}</button>
                    </div>
                    <div className="project-drop-field" id={`personal-project-tasks-${project.id}`}>
                      <div className="project-drop-heading">
                        <span>Пространство проекта</span>
                        {personalMindmapsEnabled ? <button type="button" onClick={() => { mindmapsReturnScroll.current = window.scrollY; setMindmapsProjectId(project.id); setMindmapsOpen(true); }}>Майндмепы проекта</button> : null}
                        <small>{projectDragItem ? "Отпустите здесь" : <><span className="project-drag-hint-desktop">Перетащите плашку для переноса</span><span className="project-drag-hint-touch">Удерживайте плашку для переноса</span></>}</small>
                      </div>
                      <div className="project-assigned-items">
                        {projectTaskLists.map((taskList) => {
                          const item: ProjectDragItem = { kind: "task-list", id: taskList.id, title: taskList.title };
                          const taskCount = tasks.filter((task) => task.googleTaskListId === taskList.id).length;
                          return (
                            <div className="project-assigned-list project-draggable-item" key={taskList.id} aria-label={`Перетащить список «${taskList.title}»`} {...projectDragProps(item)}>
                              <button type="button" className="task-preview-open task-list-entry-open" data-affair-drag-surface onClick={()=>setPersonalPreview({kind:"task-list",id:taskList.id})}><strong className="task-list-entry-title" data-no-translate>{taskList.title}</strong><small className="task-list-entry-meta" data-no-translate>{formatTaskListCount(taskCount, language)}</small></button>
                              <span className="task-list-column-actions">
                                <button type="button" onClick={() => setPersonalPreview({kind:'task-list',id:taskList.id})} aria-label={`Редактировать список «${taskList.title}»`}>{experimentalThemeActive ? <ExperimentalIcon name="edit" /> : "✎"}</button>
                                {!taskList.isDefault ? <button type="button" onClick={() => void deleteTaskList(taskList)} aria-label={`Удалить список «${taskList.title}»`}>{experimentalThemeActive ? <ExperimentalIcon name="close" /> : "×"}</button> : null}
                              </span>
                            </div>
                          );
                        })}
                        {renderTaskRows(projectTasks)}
                        {!projectTaskLists.length && !projectTasks.length ? (
                          <p>Пока пусто — перенесите сюда элемент из «Несортированного» или «Списков задач».</p>
                        ) : null}
                      </div>
                    </div>
                    <i className="project-progress" style={{ "--project-progress": `${projectTasks.length ? Math.round((finished / projectTasks.length) * 100) : 0}%` } as CSSProperties} />
                  </article>
                );
              }) : (
                <div className="task-empty compact-empty">
                  <span aria-hidden="true">{searchTerms.length ? "⌕" : "◇"}</span>
                  <strong>{searchTerms.length ? "По этим тегам ничего не найдено" : completedView ? "Завершённых проектов пока нет" : "Создайте первый проект"}</strong>
                  <p>{searchTerms.length ? "Попробуйте другой тег или очистите строку поиска." : "Большая цель становится управляемой, когда у неё есть структура."}</p>
                </div>
              )}
                </div>

              </div>
            </div>
          </section>

        </div>

        <PersonalCategoryPanel categories={categories} projects={projects} language={language}
          expanded={accountLayout.personalCategoriesExpanded} onExpanded={personalCategoriesExpanded => saveLayout({ personalCategoriesExpanded })}
          view={accountLayout.personalCategoriesView} onView={personalCategoriesView => saveLayout({ personalCategoriesView })}
          editingId={editingCategoryId} editColor={editingCategoryColor} editTitle={editingCategoryTitle}
          onEditColor={setEditingCategoryColor} onEditTitle={setEditingCategoryTitle} onEdit={beginCategoryEdit} onCancel={() => setEditingCategoryId("")}
          onSave={saveCategoryEdit} onDelete={deleteCategory} newTitle={newCategoryTitle} onNewTitle={setNewCategoryTitle} onCreate={addCategory}
          onOpen={id => { setExpandedExperimentalProjects(ids => [...new Set([...ids, id])]); document.querySelector(`[data-project-drop-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:"center",behavior:"smooth"}); }}/>
        <p className="sr-only" aria-live="polite">{projectMoveAnnouncement}</p>
        {projectTouchPoint && projectDragItem ? (
          <div className="project-drag-preview" style={{ left: projectTouchPoint.x, top: projectTouchPoint.y }}>
            <span>{projectDragItem.kind === "task" ? "Задача" : "Список"}</span>
            <strong>{projectDragItem.title}</strong>
          </div>
        ) : null}
      </div>
    );
  };

  const activePersonalPreview:typeof personalPreview=personalPreview??(
    personalListReturn&&personalListReturn.userId===(cloudUser?.uid??'local')&&!editingTask&&!editingTaskList&&!taskComposer&&!pendingTaskDeletion&&!transferTask
      &&taskLists.some(list=>list.id===personalListReturn.id)?{kind:'task-list',id:personalListReturn.id}:null);
  const previewTask=activePersonalPreview?.kind==='task'?tasks.find(task=>task.id===activePersonalPreview.id):null;
  const previewProject=activePersonalPreview?.kind==='project'?projects.find(project=>project.id===activePersonalPreview.id):null;
  const previewList=activePersonalPreview?.kind==='task-list'?taskLists.find(list=>list.id===activePersonalPreview.id):null;
  const previewListTasks=previewList?orderPersonalTasks(tasks.filter(task=>task.googleTaskListId===previewList.id),personalTaskDisplay.sort):[];
  const previewEntity=previewTask??previewProject??previewList;
  const addPersonalComment=async(body:string)=>{
    if(!activePersonalPreview||!previewEntity)return;
    const comments=[...(previewEntity.comments??[]),{id:uid(),body,authorId:cloudUser?.uid??'local',authorName:cloudUser?.displayName??translateText('Вы',language),createdAt:new Date().toISOString()}].slice(-200);
    if(previewTask){const next={...previewTask,comments,updatedAt:timestamp()};setTasks(old=>old.map(task=>task.id===next.id?next:task));saveTask(next);}
    else if(previewProject){const next=projects.map(project=>project.id===previewProject.id?{...project,comments}:project);setProjects(next);await persistStructure(next,categories);}
    else if(previewList){const next=taskLists.map(list=>list.id===previewList.id?{...list,comments}:list);setTaskLists(next);if(cloudUser)await saveWorkspaceStructure(projects,categories,taskListLinks,metricsFor(tasks,projects,habitWorkspace.habits.length),habitWorkspace,next);}
  };

  const renderTaskRows = (items: Task[]) => <div className="all-tasks-list" aria-live="polite">
    {orderPersonalTasks(items,personalTaskDisplay.sort).map((task) => {
            const unread=unreadPersonalCommentIds(task.comments??[],cloudUser?.uid??"local",personalTaskDisplay.reads[task.id]??[]).length;
            const project = resolvedTaskProject(task);
            const category = categories.find((item) => item.id === project?.categoryId);
            const overdue = isTaskOverdue(task, today, overdueDeadline(task));
            const source = taskOriginMeta(task.createdIn);
            const tags = (Array.isArray(task.tags) ? task.tags : []);
            const syncAccountIds = (Array.isArray(task.syncAccountIds) ? task.syncAccountIds : []);
            const dependencyNames = (Array.isArray(task.dependsOnIds) ? task.dependsOnIds : [])
              .map((dependencyId) => tasks.find((item) => item.id === dependencyId)?.title)
              .filter((title): title is string => Boolean(title));
            return (
              <div className={`all-task-row project-task-card project-draggable-item${unread ? " has-unread-comments" : ""}${task.done ? " done" : ""}${overdue ? " past" : ""}${locatedPersonalTaskId === task.id ? " task-location-highlight" : ""}`} data-personal-task-id={task.id} key={task.id} role="button" tabIndex={0} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==="Enter"||event.key===" ")){event.preventDefault();setPersonalPreview({kind:"task",id:task.id});}}} onClick={event=>{if(!(event.target as Element).closest("button,input,select,textarea,a,summary,label,details"))setPersonalPreview({kind:"task",id:task.id});}} {...projectDragProps({ kind: "task", id: task.id, title: task.title })}>
                <button type="button" className="task-check" aria-pressed={task.done} onClick={() => toggleTask(task.id)} aria-label={namedAction(task.done ? "Вернуть задачу" : "Завершить задачу", task.title, language)}>
                  {task.done ? <ExperimentalIcon name="check"/> : null}
                </button>
                <div className="all-task-body" data-affair-drag-surface>
                  <div className="all-task-title-row">
                    <button type="button" className="task-preview-open" data-affair-drag-surface data-no-translate title={task.title} onClick={()=>setPersonalPreview({kind:"task",id:task.id})}>{task.title}</button>
                    <span className="all-task-priority" title="Приоритет">⚑{task.priority}</span>
                  </div>
                  {unread?<span className="unread-comment-badge">{translateText("Новые комментарии",language)}: {unread}</span>:null}
                  <div className="all-task-meta">
                    {task.entryType && task.entryType !== "task" ? <span className="entry-type-badge">{entryTypeLabel(task.entryType, language === "en")}</span> : null}
                    <span>{taskRangeLabel(task, activeCalendarMode, activeTimeFormat)}</span>
                    <span>{resolvedTaskProjectTitle(task) || "Без проекта"}</span>
                    {task.googleTaskListTitle ? <span>Список: {task.googleTaskListTitle}</span> : null}
                    {syncAccountIds.length > 1 ? <span>{cloudUser?.authProvider === "google" ? "Google-аккаунты" : "Связанные аккаунты"}: {syncAccountIds.length}</span> : task.googleAccountEmail ? <span>{task.googleAccountEmail}</span> : null}
                    {category ? <span className="all-task-category" data-no-translate style={{ "--project-color": category.color } as CSSProperties}>{localizeCategoryName(category, language)}</span> : null}
                    <span className={`all-task-source source-${source.className}`}>{source.label}</span>
                  </div>
                  {tags.length ? <div className="task-tags">{tags.map((tag) => <i key={tag}>#{tag}</i>)}</div> : null}
                  {dependencyNames.length ? <div className="task-dependency">↳ после: {dependencyNames.join(", ")}</div> : null}
                  {task.description || task.calendarNote ? (
                    <details className="task-description-viewer">
                      <summary>Описание задачи</summary>
                      {task.description ? <p data-no-translate>{task.description}</p> : <p className="muted">Описание не добавлено.</p>}
                      {task.calendarNote ? <pre>{task.calendarNote}</pre> : null}
                    </details>
                  ) : null}
                </div>
                <div className="all-task-tools">
                <div className="all-task-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => openTaskEditor(task)}
                    title="Редактировать задачу"
                    aria-label={namedAction("Редактировать задачу", task.title, language)}
                  >{experimentalThemeActive ? <ExperimentalIcon name="edit" /> : "✎"}</button>
                  <button type="button" className="task-delete personal-action-hint" data-action-hint={translateText("Удалить задачу", language)} onClick={() => deleteTask(task.id)} aria-label={namedAction("Удалить задачу", task.title, language)}>{experimentalThemeActive ? <ExperimentalIcon name="delete" /> : "×"}</button>
                </div>
                  <label className="task-project-move"><span>{language === "en" ? "Move to" : "Переместить в"}</span>
                    <select aria-label={namedAction("Переместить задачу", task.title, language)} value={resolvedTaskProjectId(task) ?? ""} onChange={(event) => moveProjectItemToProject({ kind: "task", id: task.id, title: task.title }, event.target.value || TASK_INBOX_PROJECT_ID)}>
                      <option value="">Хаос-бокс</option>
                      {flattenProjects(projects).filter(({ project: item }) => item.status === "active").map(({ project: item, depth }) => <option key={item.id} value={item.id}>{"— ".repeat(depth)}{item.title}</option>)}
                      {project && project.status !== "active" ? <option value={project.id}>{project.title} · Завершено</option> : null}
                    </select></label>
                </div>
                {overdue ? <div className="all-task-overdue">{renderOverdueBadge(task)}</div> : null}
              </div>
            );
    })}
  </div>;

  const renderSacredYear = () => (
    <div className="year-view" data-genesis-preserve="sacred-year-calendar-and-month-art">
      <header className="projects-header year-header">
        <div>
          <span className="eyebrow">360 + {apeironLength(sacredYear)} дней</span>
          <h1>Круг года {sacredYear}–{sacredYear + 1}</h1>
          <p>Двенадцать упорядоченных месяцев и короткий период Апейрона — пространство между завершением и новым началом.</p>
        </div>
        <div className="year-switcher">
          <button type="button" disabled={sacredYear <= 1899} onClick={() => changeSacredYear(sacredYear - 1)} aria-label="Предыдущий год">←</button>
          <strong>{sacredYear}</strong>
          <button type="button" disabled={sacredYear >= 2100} onClick={() => changeSacredYear(sacredYear + 1)} aria-label="Следующий год">→</button>
        </div>
      </header>
      {sacredFeaturesEnabled ? <section className="solar-year-strip" aria-label="Солнцестояния и равноденствия года">
        {solarEvents.map((event) => {
          const weekday = new Intl.DateTimeFormat(runtimeLocale(), { weekday: "long" }).format(event.date);
          const date = new Intl.DateTimeFormat(runtimeLocale(), { day: "numeric", month: "long", year: "numeric" }).format(event.date);
          return (
            <button
              type="button"
              key={event.id}
              onClick={() => {
                openCalendarDate(getGregorianDate(sacredYear, event.monthIndex, event.day), "year");
              }}
            >
              <span className="solar-glyph" aria-hidden="true"><i>{event.symbol}</i></span>
              <span>
                <small>{event.kind === "equinox" ? "Равноденствие" : "Солнцестояние"}</small>
                <em>{weekday}</em>
                <strong>{date}</strong>
                <b>{formatSolarEventTime(event.date)}</b>
              </span>
            </button>
          );
        })}
      </section> : null}
      <section className="year-grid" aria-label="Все месяцы года">
        {MONTHS.map((month) => {
          const availableDays = month.index === 12 ? apeironLength(sacredYear) : 30;
          const pyatas = Array.from(
            { length: Math.ceil(availableDays / 5) },
            (_, pyataIndex) => Array.from(
              { length: Math.min(5, availableDays - pyataIndex * 5) },
              (__, dayIndex) => pyataIndex * 5 + dayIndex + 1,
            ),
          );
          const monthTaskCount = Array.from({ length: availableDays }, (_, index) => (
            calendarTasksByDate.get(inputDate(getGregorianDate(sacredYear, month.index, index + 1)))?.length ?? 0
          )).reduce((total, count) => total + count, 0);
          const isCurrent = sacredYear === todayInfo.sacredYear && month.index === todayInfo.monthIndex;
          const openDay = (day: number) => {
            openCalendarDate(getGregorianDate(sacredYear, month.index, day), "year");
          };
          const openMonth = () => {
            setMonthIndex(month.index);
            setSelectedDay(isCurrent ? todayInfo.day : 1);
            setDayDetailsOrigin("calendar");
            setDayDetailsOpen(false);
            navigateTo("calendar");
          };
          return (
            <article
              className={`year-month${month.index === 12 ? " apeiron" : ""}${isCurrent ? " current" : ""}`}
              key={month.name}
              aria-labelledby={`year-month-${month.index}`}
              style={{
                "--month-accent": month.color,
                "--month-art": `url("${monthArtUrl(month.index)}")`,
              } as CSSProperties}
            >
              <span className="year-month-top"><i>{month.roman}</i><b>{month.symbol}</b></span>
              <strong id={`year-month-${month.index}`}>{month.name}</strong>
              <small>{month.title}</small>
              <div className="mini-pyatas">
                {pyatas.map((days, pyataIndex) => (
                  <div
                    className={`mini-pyata ${(pyataIndex + 1) % 2 === 0 ? "even" : "odd"}`}
                    key={`${month.index}-${pyataIndex}`}
                  >
                    <span className="mini-pyata-label">
                      <b>{pyataIndex + 1}</b>
                      <small title={language === "en" ? ((pyataIndex + 1) % 2 === 0 ? "Even pyata" : "Odd pyata") : ((pyataIndex + 1) % 2 === 0 ? "Чётная пята" : "Нечётная пята")}>{language === "en" ? ((pyataIndex + 1) % 2 === 0 ? "EVEN" : "ODD") : ((pyataIndex + 1) % 2 === 0 ? "ЧЁТ" : "НЕЧ")}</small>
                    </span>
                    <span className="mini-pyata-days">
                      {days.map((dayNumber) => {
                        const key = taskDateKey(sacredYear, month.index, dayNumber);
                        const dayTasks = calendarTasksByDate.get(inputDate(getGregorianDate(sacredYear, month.index, dayNumber))) ?? [];
                        const sharedCount = sharedCalendarCounts[inputDate(getGregorianDate(sacredYear, month.index, dayNumber))] ?? 0;
                        const taskCount = dayTasks.length;
                        const hasTask = taskCount > 0;
                        const todayDot = key === todayKey;
                        const solarDot = Boolean(getSolarEvent(sacredYear, month.index, dayNumber));
                        const isYearSaturday = getGregorianDate(sacredYear, month.index, dayNumber).getDay() === 6;
                        const sacredDay = getSacredDay(month.index, dayNumber);
                        return (
                          <button
                            type="button"
                            className={`mini-day${hasTask ? " has-task" : ""}${todayDot ? " today" : ""}${solarDot ? " solar" : ""}${isYearSaturday ? " saturday" : ""}`}
                            key={dayNumber}
                            onClick={() => openDay(dayNumber)}
                            aria-label={`${translateText(month.name, language)}, ${translateText("день", language)} ${dayNumber}: ${sacredDay.name}${taskCount ? `, ${formatTaskCount(taskCount, language)}` : ""}`}
                            title={`${sacredDay.name} · ${translateText("Открыть день", language)}`}
                          >
                            <span className="mini-day-number">{(["I", "II", "III", "IIII", "V"] as const)[(dayNumber - 1) % 5]}</span>
                            <CalendarYearTaskCounts tasks={dayTasks} />
                            {sharedCount ? <span className="mini-day-shared-count" aria-label={`${sharedCount} ${translateText("общих задач", language)}`}>{sharedCount}</span> : null}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                ))}
              </div>
              <footer className="year-month-footer">
                <span className="year-month-meta">
                  <em>{month.season}</em>
                  {monthTaskCount ? <i data-no-translate>{formatTaskCount(monthTaskCount, language)}</i> : null}
                </span>
                <button
                  type="button"
                  className="year-open-button"
                  onClick={openMonth}
                  onPointerMove={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
                    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
                  }}
                  onPointerLeave={(event) => {
                    event.currentTarget.style.removeProperty("--pointer-x");
                    event.currentTarget.style.removeProperty("--pointer-y");
                  }}
                >
                  <span>Открыть месяц</span>
                  <i aria-hidden="true" />
                </button>
              </footer>
            </article>
          );
        })}
        <article className="year-description-card" aria-labelledby="year-description-title">
          <span className="eyebrow">Ритм GENESIS</span>
          <h2 id="year-description-title">Солнечный календарь</h2>
          <p>Год GENESIS начинается в день весеннего равноденствия и раскрывается через двенадцать месяцев. Каждый месяц несёт собственный образ, цвет, стихию и смысл — не просто отрезок времени, а отдельную ступень годового пути.</p>
          <p>В каждом месяце ровно 30 дней. Вместо привычных недель время собрано в шесть пят: коротких пятидневных ритмов, где нечётные и чётные пяты сменяют друг друга. Годовой ритм задают движение Солнца, равноденствия и солнцестояния.</p>
          <dl>
            <div><dt>12</dt><dd>символических месяцев</dd></div>
            <div><dt>30</dt><dd>дней в каждом месяце</dd></div>
            <div><dt>6</dt><dd>пят вместо недель</dd></div>
            <div><dt>4</dt><dd>солнечных праздника года</dd></div>
          </dl>
          <p>Равноденствия и солнцестояния образуют четыре праздничные опоры. После завершения двенадцатого месяца наступает Апейрон — несколько дней вне обычного счёта, пространство тишины перед новым весенним началом.</p>
          <div className="year-description-actions"><button type="button" className="year-details-button" onClick={() => setSacredYearDetailsOpen(true)}>
            <span aria-hidden="true">✦</span>
            <span><strong>Подробнее</strong><small>Сакральная геометрия времени</small></span>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13M13 7l5 5-5 5" />
            </svg>
          </button>
          <button type="button" className="year-details-button solar-calendar-launch" aria-haspopup="dialog" onClick={() => setSolarExplorerOpen(true)}>
            <CalendarModeIcon mode="sacred" size={24} />
            <span><strong>Круг GENESIS</strong><small>Интерактивная модель календаря</small></span>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h13M13 7l5 5-5 5" /></svg>
          </button>
          </div>
        </article>
      </section>
    </div>
  );

  const renderAlternativeYear = (mode: Exclude<CalendarMode, "sacred">) => {
    const profaneYear = selectedDate.getFullYear() - (gregorianYearStartsInMarch && selectedDate.getMonth() < 2 ? 1 : 0);
    const profaneStartMonth = gregorianYearStartsInMarch ? 2 : 0;
    const profaneYearStart = new Date(profaneYear, profaneStartMonth, 1, 12);
    const profaneYearEnd = new Date(profaneYear + 1, profaneStartMonth, 1, 12);
    const profaneYearLabel = gregorianYearStartsInMarch ? `${profaneYear}–${profaneYear + 1}` : String(profaneYear);
    const lunarYear = selectedLunarYear;
    const yearMonths: AlternativeYearMonth[] = mode === "profane"
      ? Array.from({ length: 12 }, (_, month) => {
          const dates = profaneMonthDates(new Date(profaneYear, profaneStartMonth + month, 1, 12));
          const representative = dates[Math.floor(dates.length / 2)];
          const accentMonth = MONTHS[getSacredDate(representative).monthIndex];
          return {
            id: `profane-${representative.getFullYear()}-${representative.getMonth()}`,
            title: profaneMonthName(representative),
            subtitle: language === "en" ? `${dates.length} days · ${representative.getFullYear()}` : `${dates.length} дней · ${representative.getFullYear()} год`,
            ordinal: String(month + 1).padStart(2, "0"),
            symbol: "",
            dates,
            accentMonth,
            artUrl: `${APP_BASE}/${gregorianMonthArt(representative.getMonth(), seasonLocation)}`,
          };
        })
      : Array.from({ length: lunarYear.monthCount }, (_, offset) => {
          const absoluteIndex = lunarYear.startMonthIndex + offset;
          const dates = getLunarMonthDates(absoluteIndex);
          const representative = dates[Math.floor(dates.length / 2)] ?? getLunarMonthStart(absoluteIndex);
          const accentMonth = MONTHS[getSacredDate(representative).monthIndex];
          const lunarDefinition = getLunarMonthDefinition(offset + 1);
          return {
            id: `lunar-${lunarYear.sacredYear}-${absoluteIndex}`,
            title: lunarDefinition.name,
            subtitle: `${lunarDefinition.title} · ${formatDateRange(dates[0] ?? representative, dates.at(-1) ?? representative)}`,
            ordinal: String(offset + 1).padStart(2, "0"),
            symbol: "☾",
            dates,
            accentMonth,
            artUrl: lunarMonthArtUrl(lunarDefinition.index),
            color: lunarMonthColor(lunarDefinition.index),
          };
        });
    const yearSolarEvents = mode === "profane"
      ? [...getSolarEvents(profaneYear), ...getSolarEvents(profaneYear + 1)]
          .filter((event) => event.date >= profaneYearStart && event.date < profaneYearEnd)
      : [...getSolarEvents(lunarYear.sacredYear), ...getSolarEvents(lunarYear.sacredYear + 1)]
          .filter((event) => event.date >= lunarYear.startDate && event.date < lunarYear.endDate);
    const yearDayCount = mode === "profane"
      ? Math.round((Date.UTC(profaneYear + 1, profaneStartMonth, 1) - Date.UTC(profaneYear, profaneStartMonth, 1)) / 86_400_000)
      : Math.round((Date.UTC(lunarYear.endDate.getFullYear(), lunarYear.endDate.getMonth(), lunarYear.endDate.getDate()) - Date.UTC(lunarYear.startDate.getFullYear(), lunarYear.startDate.getMonth(), lunarYear.startDate.getDate())) / 86_400_000);
    const yearTitle = mode === "profane"
      ? (sacredFeaturesEnabled
          ? (language === "en" ? `Gregorian year ${profaneYearLabel}` : `Григорианский год ${profaneYearLabel}`)
          : (language === "en" ? `Year ${profaneYearLabel}` : `Год ${profaneYearLabel}`))
      : (language === "en" ? `Lunar year ${lunarYear.sacredYear}–${lunarYear.sacredYear + 1}` : `Лунный год ${lunarYear.sacredYear}–${lunarYear.sacredYear + 1}`);
    const yearDescription = mode === "profane"
      ? "Современный григорианский календарь — гражданская система с многослойной историей. Его месяцы и счёт года унаследованы от Рима. Предпосылки семидневной недели восходят к Древнему Вавилону: вавилонская астрология придала особое значение семи видимым небесным светилам. В Рим семидневный ритм пришёл по двум линиям — иудейской субботней и греко-римской планетарной. В античном мире дни недели получили небесных покровителей — Солнце, Луну, Марс, Меркурий, Юпитер, Венеру и Сатурн, — и так ещё в древности сложился сакральный образ каждого дня. Традиция отмечать Новый год 1 января тоже пришла из Рима и не была изобретена одним человеком. Январь связывали с Янусом, богом дверей, переходов и начал. В 153 году до н. э. вступление консулов в должность перенесли на этот день, чтобы они раньше отправились на войну в Испании; поскольку годы называли именами консулов, 1 января стало гражданским началом года, а реформа Юлия Цезаря закрепила эту традицию. В 1582 году папа Григорий XIII ввёл названную его именем реформу, чтобы исправить накопившееся смещение юлианского календаря и вернуть весеннее равноденствие к церковному расчёту Пасхи. Поэтому современный календарь соединяет вавилонско-иудейское, греко-римское, римское гражданское и христианско-церковное наследие. В символической системе GENESIS покровителем этого летоисчисления выступает Кронос — образ времени, меры, предела и неумолимого хода циклов. Суббота здесь понимается как сакральный день обязательного покоя: время прекращать обычный труд, восстанавливать тело и возвращаться к внутренней тишине. Эта практика созвучна иудейскому Шаббату — седьмому дню, когда предписано воздерживаться от работы и посвящать день Богу."
      : lunarYearStartText(formatGregorian(lunarYear.startDate, true), lunarYear.monthCount, language);
    const profaneWeekdayLabels = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(2024, 0, (activeWeekStart === "monday" ? 8 : 7) + index, 12);
      return new Intl.DateTimeFormat(runtimeLocale(), { weekday: "short" }).format(day).replace(/\.$/u, "");
    });
    const changeYear = (delta: number) => {
      if (mode === "profane") {
        const targetYear = selectedDate.getFullYear() + delta;
        const targetDay = Math.min(selectedDate.getDate(), new Date(targetYear, selectedDate.getMonth() + 1, 0).getDate());
        selectCalendarDate(new Date(targetYear, selectedDate.getMonth(), targetDay, 12));
        return;
      }
      const target = getLunarYear(lunarYear.sacredYear + delta);
      const currentOrdinal = selectedLunarMonthIndex - lunarYear.startMonthIndex;
      selectCalendarDate(getLunarMonthStart(target.startMonthIndex + Math.min(currentOrdinal, target.monthCount - 1)));
    };

    return (
      <div className={`year-view calendar-mode-year mode-${mode}`} data-genesis-preserve="alternative-year-calendar-and-art">
        <header className="projects-header year-header">
          <div>
            <span className="eyebrow">{yearDayCount} {language === "en" ? "days" : "дней"} · {yearMonths.length} {language === "en" ? "months" : "месяцев"}</span>
            <h1>{yearTitle}</h1>
            {mode === "lunar" ? <p data-no-translate>{yearDescription}</p> : null}
          </div>
          <div className="year-switcher">
            <button type="button" disabled={selectedDate.getFullYear() <= 1900} onClick={() => changeYear(-1)} aria-label="Предыдущий год">←</button>
            <strong>{mode === "profane" ? profaneYearLabel : `${lunarYear.sacredYear}–${lunarYear.sacredYear + 1}`}</strong>
            <button type="button" disabled={selectedDate.getFullYear() >= 2100} onClick={() => changeYear(1)} aria-label="Следующий год">→</button>
          </div>
        </header>
        {sacredFeaturesEnabled ? <section className="solar-year-strip" aria-label="Солнцестояния и равноденствия года">
          {yearSolarEvents.map((event) => {
            const weekday = new Intl.DateTimeFormat(runtimeLocale(), { weekday: "long" }).format(event.date);
            const date = new Intl.DateTimeFormat(runtimeLocale(), { day: "numeric", month: "long", year: "numeric" }).format(event.date);
            return (
              <button type="button" key={event.id} onClick={() => openCalendarDate(event.date, "year")}>
                <span className="solar-glyph" aria-hidden="true"><i>{event.symbol}</i></span>
                <span><small>{event.kind === "equinox" ? "Равноденствие" : "Солнцестояние"}</small><em>{weekday}</em><strong>{date}</strong><b>{formatSolarEventTime(event.date)}</b></span>
              </button>
            );
          })}
        </section> : null}
        {mode === "profane" && !gregorianYearStartsInMarch && !springYearSuggestionDismissed ? (
          <aside className="spring-year-suggestion" aria-label={translateText("Начните год весной", language)}>
            <div>
              <strong>{translateText("Начните год весной", language)}</strong>
              <p>{translateText("Природа пробуждается в марте. Можно начинать отображаемый григорианский год с этого месяца.", language)}</p>
              {springYearSuggestionError ? <small role="alert">{translateText("Не удалось сохранить выбор. Повторите попытку.", language)}</small> : null}
            </div>
            <button type="button" className="spring-year-action" disabled={springYearSuggestionBusy}
              onClick={() => {
                setSpringYearSuggestionBusy(true);
                setSpringYearSuggestionError(false);
                void updateAccountPreferences({ gregorianYearStart: "march" })
                  .then(({ user }) => setCloudUser(user))
                  .catch(() => setSpringYearSuggestionError(true))
                  .finally(() => setSpringYearSuggestionBusy(false));
              }}>{translateText("Начинать с марта", language)}</button>
            <DialogCloseButton type="button" className="spring-year-dismiss"
              aria-label={translateText("Закрыть предложение", language)}
              onClick={() => {
                setSpringYearSuggestionDismissed(true);
                try { localStorage.setItem("genesis.spring-year-suggestion-dismissed", "1"); }
                catch { /* Session dismissal still works. */ }
              }} />
          </aside>
        ) : null}
        <section className={`year-grid calendar-mode-year-grid mode-${mode}`} aria-label={mode === "profane"
          ? (language === "en" ? "Twelve calendar months" : "Двенадцать календарных месяцев")
          : (language === "en" ? "Lunar months of the year" : "Лунные месяцы года")}>
          {yearMonths.map((month) => {
            const monthTaskCount = datesTaskCount(calendarTasksByDate, month.dates);
            const containsToday = month.dates.some((date) => inputDate(date) === todayDateValue);
            const containsSelectedMonth = month.dates.some((date) => inputDate(date) === selectedDateValue);
            const leadingDays = mode === "profane" && month.dates[0]
              ? gregorianWeekdayOffset(month.dates[0], activeWeekStart)
              : 0;
            const openMonth = () => {
              const todayInMonth = month.dates.find((date) => inputDate(date) === todayDateValue);
              selectCalendarDate(todayInMonth ?? month.dates[0]);
              setDayDetailsOrigin("calendar");
              setDayDetailsOpen(false);
              navigateTo("calendar");
            };
            return (
              <article
                className={`year-month calendar-mode-year-month mode-${mode}${containsToday ? " current" : ""}${containsSelectedMonth ? " selected-period" : ""}`}
                key={month.id}
                aria-labelledby={`year-month-${month.id}`}
                style={{
                  "--month-accent": mode === "profane" ? "var(--ui-accent)" : month.color ?? month.accentMonth.color,
                  "--month-art": month.artUrl ? `url("${month.artUrl}")` : undefined,
                } as CSSProperties}
              >
                <span className="year-month-top">{sacredFeaturesEnabled ? <i>{month.ordinal}</i> : null}<b>{mode === "profane" ? sacredFeaturesEnabled ? <CalendarModeIcon mode="profane" size={27} /> : Number(month.ordinal) : month.symbol}</b></span>
                <strong id={`year-month-${month.id}`}>{month.title}</strong>
                <small>{month.subtitle}</small>
                <div className={`civil-mini-calendar mode-${mode}`}>
                  {mode === "profane" ? profaneWeekdayLabels.map((label, index) => <span className="civil-mini-weekday" key={`${month.id}-weekday-${index}`}>{label}</span>) : null}
                  {Array.from({ length: leadingDays }, (_, index) => <span className="civil-mini-blank" aria-hidden="true" key={`${month.id}-blank-${index}`} />)}
                  {month.dates.map((date) => {
                    const dateValue = inputDate(date);
                    const cellTasks = calendarTasksByDate.get(dateValue) ?? [];
                    const sharedCount = sharedCalendarCounts[dateValue] ?? 0;
                    const dayTasks = cellTasks.length;
                    const moon = getMoon(date);
                    const sacred = getSacredDate(date);
                    const sacredDay = getSacredDay(sacred.monthIndex, sacred.day);
                    const solar = sacredFeaturesEnabled ? getSolarEvent(sacred.sacredYear, sacred.monthIndex, sacred.day) : null;
                    const isSaturday = mode === "profane" && date.getDay() === 6;
                    const weekdayPatron = localizeWeekdayPatron(PROFANE_WEEKDAY_PATRONS[date.getDay()], language);
                    if (mode === "lunar") return (
                      <div className={`mini-day lunar-year-day${dayTasks ? " has-task" : ""}${dateValue === todayDateValue ? " today" : ""}${solar ? " solar" : ""}`} key={dateValue}>
                        <button type="button" className="lunar-year-day-open" onClick={() => openCalendarDate(date, "year")}
                          aria-label={`${formatCalendarDate(date, mode, true)}; ${formatGregorian(date, true)}`} title={formatGregorian(date, true)}>
                          <MoonPhaseIcon phaseStep={moon.phaseStep} size={30} className="mini-day-moon-phase" />
                          <span className="mini-day-number">{moon.day}</span>
                        </button>
                        <Suspense fallback={null}>
                          <CalendarPersonalTaskControl tasks={cellTasks} dateLabel={formatGregorian(date, true)} language={language}
                            popoverKey={`year-personal-${dateValue}`} alignment="align-center" openKey={openDayTaskPopover} onOpenKey={setOpenDayTaskPopover}
                            onOpenTask={openPersonalCalendarTask} onCompleteTask={task => toggleTask(task.id)} formatTime={time => formatTimeValue(time, activeTimeFormat)} />
                          <CalendarSharedTaskControl tasks={[]} total={sharedCount} date={dateValue} dateLabel={formatGregorian(date, true)} language={language}
                            popoverKey={`year-shared-${dateValue}`} alignment="align-center" openKey={openDayTaskPopover} onOpenKey={setOpenDayTaskPopover}
                            onOpenTask={openSharedCalendarTask} onCompleteTask={completeSharedCalendarTask} busyTaskId={calendarCompletionBusy} />
                        </Suspense>
                      </div>
                    );
                    return (
                      <button
                        type="button"
                        className={`mini-day${dayTasks ? " has-task" : ""}${dateValue === todayDateValue ? " today" : ""}${solar ? " solar" : ""}${isSaturday ? " saturday" : ""}`}
                        data-weekday={date.getDay()}
                        data-weekend={mode === "profane" ? date.getDay() === 6 ? "saturday" : date.getDay() === 0 ? "sunday" : undefined : undefined}
                        key={dateValue}
                        onClick={() => openCalendarDate(date, "year")}
                        aria-label={`${formatCalendarDate(date, mode, true)}${sacredFeaturesEnabled ? `${mode === "profane" ? `; ${weekdayPatron.weekday}, ${weekdayPatron.patronage}` : ""}; ${sacredDay.name}; ${moon.day} ${translateText("лунный день", language)}` : ""}${dayTasks ? `; ${formatTaskCount(dayTasks, language)}` : ""}`}
                        title={`${formatGregorian(date, true)}${sacredFeaturesEnabled ? `${mode === "profane" ? ` · ${weekdayPatron.patronage}` : ""} · ${formatCalendarDate(date, "sacred")} · ${moon.day} ${translateText("лунный день", language)}` : ""}`}
                      >
                        <span className="mini-day-number">{date.getDate()}</span>
                        <CalendarYearTaskCounts tasks={cellTasks} />
                        {sharedCount ? <span className="mini-day-shared-count" aria-label={`${sharedCount} ${language === "en" ? "shared tasks" : "общих задач"}`}>{sharedCount}</span> : null}
                      </button>
                    );
                  })}
                </div>
                <footer className="year-month-footer">
                  <span className="year-month-meta"><em>{mode === "profane" ? "Григорианский месяц" : `${month.dates.length} лунных суток`}</em>{monthTaskCount ? <i data-no-translate>{formatTaskCount(monthTaskCount, language)}</i> : null}</span>
                  <button type="button" className="year-open-button" onClick={openMonth}><span>Открыть месяц</span><i aria-hidden="true" /></button>
                </footer>
              </article>
            );
          })}
          <article
            className={`year-description-card calendar-mode-description${mode === "profane" ? " profane-year-full-width" : ` lunar-year-overview ${yearMonths.length === 13 ? "lunar-year-has-intercalary" : "lunar-year-full-width"}`}`}
            aria-labelledby="calendar-mode-year-description"
          >
            {mode === "profane" ? (
              <figure className="profane-saturn-art" data-genesis-preserve="saturn-art">
                <img src="/calendar-art/saturn-cronus.webp" alt="Кронос с косой и золотой сигиллой Сатурна" width="640" height="960" loading="lazy" decoding="async" />
              </figure>
            ) : null}
            {mode === "lunar" ? <figure className="lunar-year-triad-art" aria-hidden="true"><img src={`${APP_BASE}/calendar-art/lunar-goddesses-v1.webp`} alt="" width="1000" height="1000" loading="lazy" decoding="async" /></figure> : null}
            <span className="eyebrow">{CALENDAR_MODE_META[mode].label}</span>
            <h2 id="calendar-mode-year-description">{mode === "profane" ? "Григорианский календарь" : "Лунный год"}</h2>
            <p data-no-translate>{mode === "profane" ? translateText(yearDescription, language) : yearDescription}</p>
            <dl>
              <div><dt>{yearMonths.length}</dt><dd>{language === "en" ? "months" : "месяцев"}</dd></div>
              <div><dt>{yearDayCount}</dt><dd>{language === "en" ? "days in the cycle" : "дней в круге"}</dd></div>
              <div><dt>3</dt><dd>системы дат в каждом дне</dd></div>
              <div><dt>4</dt><dd>солнечные точки</dd></div>
            </dl>
            {mode === "lunar" ? (
              <>
                <p>В системе GENESIS это магический «женский» год: его внутренняя ткань определяется не месяцами и неделями солнечного года, а ростом, полнотой и исходом Луны. Весеннее равноденствие служит только ежегодной точкой настройки; условия для практик рождаются внутри самих лунных месяцев и потому не привязаны к григорианскому делению года.</p>
                <p data-no-translate>{lunarYearOverviewCopy[language].context}</p>
                <div className="year-description-actions"><button type="button" className="year-details-button" onClick={() => setLunarYearDetailsOpen(true)}>
                  <span className="year-details-button-icon" aria-hidden="true"><CalendarModeIcon mode="lunar"/></span>
                  <span><strong data-no-translate>{lunarYearOverviewCopy[language].more}</strong></span>
                </button></div>
              </>
            ) : <p>Клик по дню открывает задачи, сакральное значение, фазу Луны, точное время рассвета и заката для региона устройства.</p>}
          </article>
        </section>
      </div>
    );
  };

  const renderYear = () => activeCalendarMode === "sacred"
    ? renderSacredYear()
    : renderAlternativeYear(activeCalendarMode);

  const syncLabel =
    syncStatus === "loading"
      ? "Загрузка данных"
      : syncStatus === "syncing"
        ? "Синхронизация…"
        : syncStatus === "synced"
          ? cloudUser?.authProvider === "yandex"
            ? (cloudUser.calendarConnected ? "Яндекс.Календарь подключён" : "Сохранено на устройстве")
            : "Синхронизировано с Google"
          : syncStatus === "offline"
            ? "Офлайн · изменения в очереди"
            : syncStatus === "error"
              ? "Ошибка синхронизации"
              : syncStatus === "setup"
                ? cloudUser?.authProvider !== "google" ? "Синхронизация…" : "Google-синхронизация готовится"
                : "Сохранено на устройстве";

  const visibleNavigation = NAVIGATION.filter((item) =>
    (habitWorkspace.habitSettings.enabled || item.id !== "habits") && (item.id === "stoicheion" ? viewIsVisible("stoicheion", visibility) || viewIsVisible("theokyklos", visibility) : item.id === "calendar" ? viewIsVisible("calendar", visibility) || viewIsVisible("year", visibility) : viewIsVisible(item.id, visibility)));
  const physisPosition = visibleNavigation.filter(item => ["today", "projects", "habits"].includes(item.id)).length;
  const physisNavigation = physisAccess.showEntry ? [...visibleNavigation.slice(0, physisPosition), { id: "physis" as const, label: "Фюзис", symbol: "" }, ...visibleNavigation.slice(physisPosition)] : visibleNavigation;
  const navigation = cloudUser?.isAdmin
    ? [...physisNavigation, { id: "admin" as const, label: "Админ", symbol: "Σ" }]
    : physisNavigation;
  const pendingDeletionTask = tasks.find((task) => task.id === pendingTaskDeletion?.taskId);
  const pendingDeletionHasSeries = pendingDeletionTask ? taskHasSeries(pendingDeletionTask) : false;

  const renderHeaderSectionSwitch = () => {
    if (view === "habits" && webHabitHeader && habitWorkspace.habitSettings.enabled) return <div ref={setHabitHeaderTarget} className="habit-header-slot" />;
    if (view === "calendar" || view === "year") return <HeaderSectionSwitch label={translateText("Календарь", language)} panelId="calendar-period-panel"
      sections={[
        ...(viewIsVisible("calendar", visibility) ? [{id: "calendar-month-tab", label: translateText("Месяц", language), icon: "section-month", active: view === "calendar", onSelect: () => navigateTo("calendar")}] : []),
        ...(viewIsVisible("year", visibility) ? [{id: "calendar-year-tab", label: translateText("Год", language), icon: "section-year", active: view === "year", onSelect: () => navigateTo("year")}] : []),
      ]} />;
    if (view === "projects" && sharedProjectsVisible && personalProjectsVisible
      && ["business", "premium4life", "elite_plus"].includes(effectiveBillingPlan(cloudUser?.featureAccess))
      && featureAllowed(cloudUser?.featureAccess, "shared-projects", undefined, true)) return <HeaderSectionSwitch label={translateText("Дела", language)} sections={[
        {id: "projects-personal-section", label: translateText("Личные", language), icon: "lock", active: activeProjectsArea === "personal", onSelect: () => setProjectsArea("personal")},
        {id: "projects-shared-section", label: translateText("Общие", language), icon: "team", active: activeProjectsArea === "shared", onSelect: () => setProjectsArea("shared")},
      ]} />;
    if (sacredFeaturesEnabled && (view === "stoicheion" || view === "theokyklos")) return <HeaderSectionSwitch label={translateText("Оракул", language)} sections={[
      ...(viewIsVisible("stoicheion", visibility) ? [{id: "stoicheion-section", label: translateText("Стойхейон", language), icon: "section-stoicheion", active: view === "stoicheion", onSelect: () => navigateTo("stoicheion")}] : []),
      ...(viewIsVisible("theokyklos", visibility) ? [{id: "theokyklos-section", label: translateText("Теокиклос", language), icon: "section-theokyklos", active: view === "theokyklos", onSelect: () => navigateTo("theokyklos")}] : []),
    ]} />;
    return null;
  };

  const renderTopbarActions = () => (
    <div className="topbar-actions">
            {sacredFeaturesEnabled ? <CalendarModeCycleButton mode={activeCalendarMode} enabledCalendars={visibility.enabledCalendars}
              order={accountLayout.displayCalendarOrder} language={language} onChange={changeDisplayCalendar}/> : null}
            {cloudUser ? <ThemeModeToggle state={themeState} language={language} onChange={changeGenesisTheme} /> : null}
            {cloudUser ? (
              <div className={`account-chip${accountIdentityExpanded ? " is-expanded" : " is-compact"}`} ref={accountMenuRef}>
                <button
                  type="button"
                  className="account-open"
                  data-tooltip={translateText("Личный кабинет и настройки",language)}
                  onClick={() => { setAccountGuideUserId(null); setAccountMenuOpen(false); setAccountOpen(true); }}
                  aria-label={language === "en" ? "Open account settings" : "Открыть личный кабинет и настройки"}
                  aria-haspopup="dialog"
                >
                  <ExperimentalIcon name="account" />
                  {accountIdentityExpanded ? <span>
                    <strong>{cloudUser.displayName || (cloudUser.authProvider === "yandex" ? "Яндекс" : "Google")}</strong>
                    <small>{cloudUser.calendarConnected
                      ? (cloudUser.authProvider === "yandex" ? "Яндекс.Календарь подключён" : "Google Calendar подключён")
                      : "личный кабинет"}</small>
                  </span> : null}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="google-button"
                onClick={() => void handleGoogleSignIn()}
                disabled={!isGoogleSyncConfigured || syncStatus === "syncing"}
                title={!isGoogleSyncConfigured ? "Сервер GENESIS подключается" : "Войти через Google"}
                aria-label="Войти через Google"
              >
                <img src={`${APP_BASE}/google-signin-light-square.svg`} alt="" aria-hidden="true" data-genesis-preserve="google-signin-icon" />
              </button>
            )}
            {nativeAndroidApkUrl ? <AndroidDownload href={nativeAndroidApkUrl} language={language} toolbar /> : null}
            {isIos && !isStandalone ? <button type="button" className="icon-button ux-action-button ios-install-button" data-tooltip={translateText("Установить GENESIS", language)} aria-label="Установить GENESIS" aria-haspopup="dialog" onClick={() => setIosInstallOpen(true)}><span className="ux-install-icon" aria-hidden="true" /></button> : null}
            {!isIos && !nativeAndroidApkUrl && !isStandalone && canInstall ? (
              <button type="button" className="icon-button ux-action-button" data-tooltip={language === "en" ? "Install app" : "Установить приложение"} aria-label="Установить GENESIS" onClick={() => void install()}>
                <span className="ux-install-icon" aria-hidden="true" />
              </button>
            ) : null}
            {voiceLanguageEnabled ? <button type="button" className={`voice-open-button${voiceLaunchAnimating ? " is-activating" : ""}`} onClick={openVoiceAssistant} data-tooltip={language === "en" ? "Open the free GENESIS Voice assistant" : "Открыть бесплатного голосового помощника GENESIS Voice"} aria-label={language === "en" ? "Open the free GENESIS Voice assistant" : "Открыть бесплатного голосового помощника GENESIS Voice"} aria-busy={voiceLaunchAnimating}>
              <svg className="voice-microphone-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                <rect className="voice-microphone-capsule" x="8.7" y="2.8" width="6.6" height="11.2" rx="3.3" />
                <path className="voice-microphone-grille" d="M10.55 6.2h2.9M10.55 8.45h2.9" />
                <path className="voice-microphone-capture" d="M5.9 10.4v.9a6.1 6.1 0 0 0 12.2 0v-.9" />
                <path className="voice-microphone-stand" d="M12 17.4v3.35M8.9 20.75h6.2" />
              </svg>
            </button> : null}

            <div className="notification-header-slot" ref={setNotificationHeaderTarget} />
            {view === 'today' ? <Suspense fallback={<span className="header-control-placeholder" data-header-control-placeholder aria-hidden="true" />}><TodayBlockOrderButton language={language}
              onClick={() => setTodayOrderEditor({owner: todayOrderOwner, view, open: true})}/></Suspense> : null}

          </div>
  );

  if (legalPage) {
    return <Suspense fallback={<DeferredViewFallback label={translateText('Загрузка…', language)} />}><LegalPage page={legalPage} /></Suspense>;
  }

  if (workspaceRecoveryKey) {
    return <main className="welcome-shell"><section className="welcome-card" role="alert">
      <h1>{translateText("Локальные данные требуют восстановления", language)}</h1>
      <p>{translateText("Исходные данные сохранены. Автосохранение остановлено, чтобы не заменить их пустыми. Скачайте копию для восстановления.", language)}</p>
      <button type="button" className="primary-button" onClick={() => {
        const raw = localStorage.getItem(workspaceRecoveryKey);
        if (raw === null) return;
        const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "genesis-recovery.json"; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>{translateText("Скачать исходные данные", language)}</button>
      <button type="button" onClick={() => window.location.reload()}>{translateText("Повторить", language)}</button>
    </section></main>;
  }

  if (isGoogleSyncConfigured && !authResolved && cloudUser) {
    return (
      <main className="auth-loading" role="status" aria-live="polite">
        <span className="auth-sun"><i /></span>
        <strong data-no-translate>Genesis Tasker</strong>
        <p>Открываем личное пространство…</p>
      </main>
    );
  }

  if (isGoogleSyncConfigured && (!cloudUser || privateDeviceAccessBlocked())) {
    return (
      <Suspense fallback={<main className="welcome-shell"><section className="welcome-card">
        <h1 data-no-translate>Genesis Tasker</h1><p>{language === "en" ? "Calendars, tasks and habits in one place." : "Календари, задачи и привычки в одном месте."}</p>
        <p>{SERVICE_IDENTITY[language === "en" ? "en" : "ru"]}</p>
        <a href="/privacy">{language === "en" ? "Privacy policy" : "Политика конфиденциальности"}</a>
      </section></main>}>
      <WelcomeScreen
        nativeAndroidApkUrl={nativeAndroidApkUrl}
        busy={!authResolved || syncStatus === "syncing"}
        error={authResolved ? authError || syncError : ""}
        language={language}
        onLanguageChange={selectLanguage}
        onGoogle={() => void handleGoogleSignIn()}
      />
      </Suspense>
    );
  }

  return (
    <FeatureAccessContext value={cloudUser?.featureAccess}>
    <TimeClockFormatContext.Provider value={activeTimeFormat}>
    <SharedUpdatesProvider key={cloudUser?.uid || "anonymous"} userId={cloudUser?.uid || ""} enabled={sharedProjectsReadable} writeEnabled={sharedProjectsAvailable}>
    <SacredFeaturesContext value={sacredFeaturesEnabled}>
    <DiaryProvider key={cloudUser?.uid || 'anonymous'} userId={cloudUser?.uid || ''} ready={hydrated && syncStatus !== 'syncing'}>
    <main
      className={`genesis-app mode-${activeCalendarMode}${habitWorkspace.habitSettings.feedback.animations ? "" : " habit-animations-off"}`}
      data-exp-layout="app-shell"
      data-sacred-features={sacredFeaturesEnabled}
      data-sidebar-collapsed={sidebarCollapsed}
      data-sidebar-compact={sidebarWidth < 208}
      data-sidebar-resizing={sidebarResizing}
      data-sidebar-auto-hide={sidebarAutoHide}
      data-sidebar-hidden={sidebarHidden}
      style={{
        "--sidebar-current-width": `${sidebarWidth}px`,
        "--genesis-hero-image": !sacredFeaturesEnabled ? "none" : activeCalendarMode === "sacred"
          ? `url("${dayArtUrl(todayInfo.monthIndex, todayInfo.day)}")`
          : activeCalendarMode === "lunar"
            ? `url("${APP_BASE}/genesis-hero.png")`
            : `url("${weekdayArtUrl(today.getDay())}")`,
        "--genesis-hero-fallback": activeCalendarMode === "sacred" ? `url("${APP_BASE}/genesis-hero.png")` : "none",
      } as CSSProperties}
    >
      <PaletteArtFilter />
      {view === 'today' && todayOrderEditor.owner === todayOrderOwner && todayOrderEditor.view === view && todayOrderEditor.open ? <Suspense fallback={null}><TodayBlockOrderDialog key={todayOrderOwner}
        order={todayOrder} halfBlocks={todayHalves} hiddenBlocks={todayHidden} webVisibility={webHabitHeader} language={language} onSave={saveTodayOrder} onClose={() => setTodayOrderEditor({owner: todayOrderOwner, view, open: false})}/></Suspense> : null}
      {experimentalProjectFormOpen ? <div className="modal-backdrop experimental-project-composer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExperimentalProjectFormOpen(false); }}>{renderProjectCreateForm()}</div> : null}
      <ActionNotice message={layoutError || (view === "projects" && activeProjectsArea === "shared" ? "" : notice)}/>
      <UpgradeAccessUI user={cloudUser} onUserChange={user=>{if(cloudUserRef.current?.uid!==user.uid)return;setCloudUser(user);if(!privateDeviceAccessBlocked())localStorage.setItem(LAST_USER_KEY,JSON.stringify(user));}}/>
      {cloudUser?<Suspense fallback={null}><SupportNotice key={cloudUser.uid} user={cloudUser}/></Suspense>:null}
      {cloudUser?<Suspense fallback={null}><PlanGuidanceHost key={cloudUser.uid} user={cloudUser} section={view}/></Suspense>:null}
      {iosInstallOpen ? <Suspense fallback={null}><IosInstallPrompt language={language} onClose={() => setIosInstallOpen(false)} /></Suspense> : null}
      <Suspense fallback={null}><NotificationDock key={cloudUser?.uid ?? "guest"} userId={cloudUser?.uid ?? ""} guidanceUser={cloudUser} language={language} mode={activeCalendarMode} appBase={APP_BASE}
        layout={accountLayout} onLayoutChange={saveLayout} headerTarget={notificationHeaderTarget}
        sharedEnabled={sharedProjectsReadable} invitationsEnabled={featureAllowed(cloudUser?.featureAccess,'shared-projects') && Boolean(cloudUser?.sharedProjectsEligible)} messengerEnabled={featureAllowed(cloudUser?.featureAccess,'messenger')}
        onOpen={place => { setProjectsArea("shared"); navigateTo("projects", false, place); }} onAccepted={destination => {
        const uid=cloudUser?.uid; if(!uid)return;
        setCloudUser(current=>current?.uid===uid ? {...current,sharedProjectsEnabled:true} : current);
        setInvitationDestination(current=>({...destination,userId:uid,request:(current?.request??0)+1}));
        setProjectsArea("shared"); navigateTo("projects",false,destination,true);
      }}/></Suspense>
      {previewEntity&&activePersonalPreview?<Suspense fallback={<DeferredDialogFallback label={translateText("Загрузка…",language)}/>}><PersonalEntityPreview key={activePersonalPreview.kind+activePersonalPreview.id} task={previewTask??undefined} project={previewProject??undefined} list={previewList??undefined}
        listContents={previewList?{tasks:previewListTasks,onCreate:()=>openTaskComposerForList(previewList),schedule:task=>taskRangeLabel(task,activeCalendarMode,activeTimeFormat),onToggle:task=>toggleTask(task.id),
          onOpen:task=>{setPersonalListReturn({id:previewList.id,userId:cloudUser?.uid??'local'});setPersonalPreview({kind:'task',id:task.id});},
          onEditTask:task=>{setPersonalListReturn({id:previewList.id,userId:cloudUser?.uid??'local'});setPersonalPreview(null);openTaskEditor(task);}}:undefined}
        schedule={previewTask?taskRangeLabel(previewTask,activeCalendarMode,activeTimeFormat):""} projectTitle={previewTask?resolvedTaskProjectTitle(previewTask):""} taskCount={previewList?previewListTasks.length:tasks.filter(task=>previewProject&&resolvedTaskProject(task)?.id===previewProject.id).length} language={language} onClose={()=>{setPersonalPreview(null);if(previewList)setPersonalListReturn(null);}} onComment={addPersonalComment} onCommentsRead={ids=>{if(previewTask)personalTaskDisplay.markRead(previewTask.id,ids);}} onEdit={()=>{setPersonalPreview(null);if(previewTask)openTaskEditor(previewTask,activePersonalPreview.date);else if(previewProject)openProjectEditor(previewProject);else if(previewList){setPersonalListReturn({id:previewList.id,userId:cloudUser?.uid??'local'});setEditingTaskList(previewList);}}}/></Suspense>:null}
      {projectToComplete ? <ProjectCompletionDialog title={projectToComplete.title}
        onCancel={() => setProjectToComplete(null)} onConfirm={() => {
          const project = projects.find((item) => item.id === projectToComplete.id);
          setProjectToComplete(null);
          if (project?.status === "active") toggleProject(project.id);
        }} /> : null}
      <a className="skip-link" href="#main-content">К основному содержанию</a>
      <aside id="app-sidebar" ref={sidebarRef} className="app-sidebar" aria-label={translateText("Основная навигация",language)} data-exp-ui="navigation" inert={sidebarHidden} aria-hidden={sidebarHidden || undefined}>
        <button className="brand-mark" type="button" onClick={selectToday} aria-label={`Genesis Tasker · ${translateText("На главную", language)}`}>
          <span
            className="brand-icon"
            data-genesis-preserve="brand-icon"
            style={{ backgroundImage: `url("${APP_BASE}/icons/icon-round-v2.png")` }}
            aria-hidden="true"
          />
          <strong data-no-translate>Genesis Tasker</strong>
          {sacredFeaturesEnabled ? <small data-no-translate>{language === "el" ? "ἡμερολόγιον" : language === "uk" ? "Гемерологіон" : language === "ru" || language === "sr" ? "Гемерологион" : "Hemerologion"}</small>
            : <small className="brand-motto" data-no-translate><span>{translateText("Порядок в делах",language)}</span><span>{translateText("Порядок в разуме",language)}</span></small>}
        </button>
        <nav className="main-nav">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={(view === item.id || item.id === "calendar" && view === "year" || item.id === "stoicheion" && view === "theokyklos") ? "active" : ""}
              onClick={() => activateNavigation(item.id)}
              aria-label={item.label}
              title={sidebarCollapsed ? item.label : undefined}
              aria-current={(view === item.id || item.id === "calendar" && view === "year" || item.id === "stoicheion" && view === "theokyklos") ? "page" : undefined}
              data-exp-ui="nav-button"
            >
              {experimentalThemeActive ? <ExperimentalIcon name={item.id} className="genesis-nav-icon" /> : <NavigationIcon name={item.id} />}
              <small>{item.label}</small>
            </button>
          ))}
        </nav>
        {cloudUser&&isFreeBillingUser(cloudUser)?<div className="sidebar-upgrade"><UpgradeButton language={language} sidebar/></div>:null}
        <div className={`sidebar-foot sync-${syncStatus}`} title={syncError || syncLabel}>
          <span className="sync-dot" aria-hidden="true" />
          <span>
            {cloudUser ? (cloudUser.authProvider === "yandex" ? "Яндекс.Календарь" : "Google-синхронизация") : "Локальное хранение"}
            <br />
            {cloudUser?.email ?? (isStandalone ? "Приложение установлено" : "Веб-приложение")}
          </span>
        </div>
      </aside>
      <button type="button" ref={sidebarRevealRef} className="sidebar-auto-hide-handle" aria-controls="app-sidebar"
        aria-expanded={!sidebarHidden} aria-label={translateText("Показать боковую панель",language)}
        title={translateText("Показать боковую панель",language)} {...sidebarRevealProps}><span aria-hidden="true" /></button>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA adjustable separator supports arrow-key resizing. */}
      <div className="sidebar-resize-boundary" role="separator" tabIndex={0} aria-orientation="vertical"
        aria-controls="app-sidebar" aria-valuemin={56} aria-valuemax={240} aria-valuenow={sidebarWidth}
        aria-label={translateText("Ширина боковой панели",language)} {...resizeProps} />

      <section className="app-stage" data-exp-layout="stage">
        <header ref={compactHeaderRef} className="app-brand-header" data-compact-header={compactHeader || undefined}>
          <button type="button" onClick={selectToday} aria-label={`Genesis Tasker · ${translateText("На главную", language)}`}>
            <img src={`${APP_BASE}/icons/icon-round-v2.png`} alt="" aria-hidden="true" data-genesis-preserve="web-header-logo" />
            <strong data-no-translate>Genesis Tasker</strong>
          </button>
          {compactHeader ? <>{renderHeaderSectionSwitch()}{renderTopbarActions()}</> : null}
        </header>
        <header className="topbar" data-exp-ui="topbar">
          {!compactHeader ? <>{renderHeaderSectionSwitch()}{renderTopbarActions()}</> : null}
        </header>

        <div className={`workspace workspace-full${view === "today" ? " today-workspace" : ""}`} id="main-content" data-exp-layout="content">
          {cloudUser ? <Suspense fallback={null}><HabitReminderBridge key={cloudUser.uid} userId={cloudUser.uid} workspace={habitWorkspace}
            language={language} appBase={APP_BASE} calendarMode={activeCalendarMode} timeFormat={activeTimeFormat} onApply={applyHabitReminder} onOpen={target=>{navigateTo("habits",false);setHabitReminderFocus(previous=>target?{...target,token:(previous?.token??0)+1}:null);}}/></Suspense> : null}
          <div className="content-column" data-exp-layout="stack">
            {cloudUser ? <EmailVerificationNotice key={cloudUser.uid} user={cloudUser} onChange={user => {
              if (cloudUserRef.current?.uid !== user.uid) return;
              setCloudUser(current => current?.uid === user.uid ? { ...current, emailVerification: user.emailVerification } : current);
              if (!privateDeviceAccessBlocked()) try {
                const cached=JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null");
                if(cached?.uid===user.uid)localStorage.setItem(LAST_USER_KEY,JSON.stringify({...cached,emailVerification:user.emailVerification}));
              } catch { /* The live verified state remains available if this cache cannot be written. */ }
            }} /> : null}
            {authError ? <p className="oauth-callback-error" role="alert">{authError}</p> : null}
            {cloudUser && cloudUser.authProvider !== "yandex" && (!cloudUser.calendarConnected || !cloudUser.googleTasksImportReady) ? (

                <Suspense fallback={null}><GoogleConnectNotice key={cloudUser.uid} compact={view === "projects"} busy={syncStatus === "syncing"} onConnect={() => void handleGoogleConnect()} /></Suspense>
            ) : null}
            <ViewErrorBoundary resetKey={view}>
              {view === "today" ? renderToday() : null}
              {physisAvailable && cloudUser ? <div hidden={view !== "physis"}><Suspense fallback={<DeferredViewFallback label="Открываем Фюзис…" />}><PhysisPage key={cloudUser.uid} owner={cloudUser.uid} language={language} calendarMode={activeCalendarMode} inputCalendarMode={activeTaskCalendarMode} timeZone={deviceTimeZone} weekStart={activeWeekStart} settingsRequest={physisSettingsRequest} /></Suspense></div> : view === "physis" ? <PhysisAccessNotice status={physisAccess.status} retry={physisAccess.retry} language={language} /> : null}
              {view === "calendar" || view === "year" ? <>
                {cloudUser && sacredFeaturesEnabled ? <Suspense fallback={null}><CalendarExploreNotice key={cloudUser.uid}
                  userId={cloudUser.uid} pending={cloudUser.calendarExplorationPending === true} language={language}
                  calendars={visibility.enabledCalendars} onSelect={mode => void changeDisplayCalendar(mode)} onAcknowledged={acknowledgeCalendarExploration} /></Suspense> : null}
                {!experimentalThemeActive ? <div className="view-calendar-toolbar">{renderDisplayCalendarChoice(language === "en" ? "Display calendar" : "Календарь отображения")}</div> : null}
                <section id="calendar-period-panel" role="tabpanel" aria-labelledby={view === "year" ? "calendar-year-tab" : "calendar-month-tab"}>
                  {view === "calendar" ? renderCalendar() : renderYear()}
                </section>
              </> : null}
              {view === "projects" && (sharedProjectsVisible || personalProjectsVisible) ? <>
                {!experimentalThemeActive ? <div className="view-calendar-toolbar">{renderDisplayCalendarChoice(language === "en" ? "Project date display" : "Отображение дат в проектах")}</div> : null}
                {!sharedProjectsVisible || activeProjectsArea === "personal" ? renderProjects() : <Suspense fallback={<DeferredViewFallback label={language === "en" ? "Opening shared projects…" : "Открываем общие проекты…"} />}>
                  <SharedProjects key={`${cloudUser?.uid}:${invitationDestination?.userId===cloudUser?.uid ? invitationDestination?.request : "default"}`} userId={cloudUser?.uid ?? ""} language={language} experimentalTheme={experimentalThemeActive}
                    writeEnabled={sharedProjectsAvailable}
                    projectViewOrder={accountLayout.sharedProjectViewOrder} onProjectViewOrder={sharedProjectViewOrder => saveLayout({ sharedProjectViewOrder })}
                    calendarScale={accountLayout.sharedCalendarScale} onCalendarScale={sharedCalendarScale => saveLayout({ sharedCalendarScale })}
                    inboxPosition={accountLayout.sharedInboxPosition} inboxHidden={accountLayout.sharedInboxHidden}
                    inboxWidth={accountLayout.sharedInboxWidth} onInboxWidth={sharedInboxWidth => saveLayout({ sharedInboxWidth })}
                    inboxCompact={accountLayout.sharedInboxCompact} onInboxCompact={sharedInboxCompact => saveLayout({ sharedInboxCompact })}
                    tasksCompact={accountLayout.sharedTasksCompact} onTasksCompact={sharedTasksCompact => saveLayout({ sharedTasksCompact })}
                    categoriesExpanded={accountLayout.sharedCategoriesExpanded} onCategoriesExpanded={sharedCategoriesExpanded => saveLayout({ sharedCategoriesExpanded })}
                    categoriesView={accountLayout.sharedCategoriesView} onCategoriesView={sharedCategoriesView => saveLayout({ sharedCategoriesView })}
                    onInboxPosition={sharedInboxPosition => saveLayout({ sharedInboxPosition })} onInboxHidden={sharedInboxHidden => saveLayout({ sharedInboxHidden })}
                    destination={invitationDestination?.userId===cloudUser?.uid ? invitationDestination ?? undefined : undefined}
                    timeFormat={activeTimeFormat}
                    enabledCalendars={visibility.enabledCalendars} calendarMode={activeCalendarMode}
                    taskCalendarMode={activeTaskCalendarMode} onCalendarModeChange={changeDisplayCalendar} />
                </Suspense>}
              </> : null}
              {view === "habits" && habitWorkspace.habitSettings.enabled ? (
                <Suspense fallback={<DeferredViewFallback label={language === "en" ? "Opening habit tracker…" : "Открываем трекер привычек…"} />}>
                  <HabitTrackerPage
                    webHeaderEnabled={webHabitHeader}
                    webHeaderTarget={habitHeaderTarget}
                    user={cloudUser}
                    reportContext={calendarContext({ gregorianYearStart: cloudUser?.gregorianYearStart ?? "january" })}
                    workspace={habitWorkspace}
                    date={todayDateValue}
                    language={language}
                    timeFormat={activeTimeFormat}
                    calendarMode={activeCalendarMode}
                    googleTasksReady={Boolean(cloudUser?.googleTasksImportReady)}
                    googleCalendarReady={Boolean(cloudUser?.authProvider === "google" && cloudUser.calendarConnected)}
                    experimentalThemeActive={false}
                    hiddenSubmenus={visibility.hiddenSubmenus}
                    sacredFeaturesEnabled={sacredFeaturesEnabled}
                    voiceRequest={voiceHabitRequest}
                    reminderFocus={habitReminderFocus}
                    historyRequest={habitHistoryRequest}
                    onVoiceRequestConsumed={() => setVoiceHabitRequest(null)}
                    onChange={updateHabitWorkspace}
                    onSave={(next) => updateHabitWorkspace(next, true) ?? Promise.resolve()}
                    onTimerCommand={runHabitTimerCommand}
                    onHistoryCommand={runHabitHistoryCommand}
                    onLifecycleCommand={runHabitLifecycleCommand}
                    restoreScope={cloudUser?.uid ?? "local"}
                    onRestoreHabits={runHabitRestore}
                    onPreviewHabitRestore={runHabitRestorePreview}
                    onDayDecision={runHabitDayDecision}
                    onOpenHistory={(date, habitId) => { setHabitReminderFocus(null); setHabitHistoryRequest(previous => ({ date, habitId, token: (previous?.token ?? 0) + 1 })); }}
                    onReminderRequested={createHabitGoogleReminder}
                    onReminderRemoved={async (habit) => {
                      if (!cloudUser) return;
                      const reminderIds = Array.from(new Set([habit.reminder.googleTaskId, habit.reminder.googleEventId].filter((id): id is string => Boolean(id))));
                      const reminderTasks = tasks.filter((task) => reminderIds.includes(task.id));
                      await Promise.all(reminderTasks.map((task) => removeCloudTask(cloudUser.uid, task)));
                      setTasks((current) => current.filter((task) => !reminderIds.includes(task.id)));
                    }}
                  />
                </Suspense>
              ) : null}
              {sacredFeaturesEnabled && view === "stoicheion" ? (
                <Suspense fallback={<DeferredViewFallback label={language === "en" ? "Opening Stoicheion…" : "Открываем Стойхейон…"} />}>
                  <StoicheionView
                    key={cloudUser?.stoicheionDivinationDisabled ? "divination-disabled" : "divination-enabled"}
                    workspace={habitWorkspace}
                    calendarMode={activeTaskCalendarMode}
                    todayDate={todayDateValue}
                    userId={cloudUser?.uid ?? ""}
                    onModelingTask={request => {
                      openTaskComposer("projects");
                      setTaskTitle(request.title); setTaskDescription(request.description);
                      setTaskTaskListId(""); setTaskProject(""); setTaskUndated(!request.dueDate);
                      setTaskDueDate(request.dueDate ?? todayDateValue); setTaskEndDate(request.dueDate ?? todayDateValue);
                      setTaskTime(request.dueTime ?? ""); setTaskReminders(request.kind === "review" ? [{kind:"relative",minutes:30}] : []);
                      setTaskTags(""); setTaskDependsOn([]); setTaskPriority("5"); setTaskSyncAccountIds(null);
                      setTaskRecurrenceConfig({...DEFAULT_RECURRENCE_CONFIG,enabled:false}); navigateTo("projects");
                    }}
                    onWorkspaceChange={(next) => updateHabitWorkspace(next, true)}
                    onOpenHabits={() => navigateTo("habits")}
                    divinationDisabled={Boolean(cloudUser?.stoicheionDivinationDisabled)}
                    onOpenTheokyklosSector={openTheokyklosSector}
                    sacredPracticesEnabled={habitWorkspace.habitSettings.enabled}
                    onChooseSacredPractice={(id) => { setVoiceHabitRequest({ token: Date.now(), kind: "sacred-practice", id }); navigateTo("habits"); }}
                    initialCardId={requestedStoicheionCard}
                    onInitialCardOpened={() => setRequestedStoicheionCard(null)}
                    voiceDrawKind={requestedStoicheionDraw}
                    onVoiceDrawHandled={() => setRequestedStoicheionDraw(null)}
                  />
                </Suspense>
              ) : null}
              {sacredFeaturesEnabled && view === "theokyklos" ? (
                <Suspense fallback={<DeferredViewFallback label={language === "en" ? "Opening Theokyklos…" : "Открываем Теокиклос…"} />}>
                  <TheokyklosView
                    language={language}
                    allowOlympians={featureAllowed(cloudUser?.featureAccess,'theokyklos-olympians')}
                    workspace={habitWorkspace}
                    date={todayDateValue}
                    calendarMode={activeTaskCalendarMode}
                    initialSectorId={requestedTheokyklosSector}
                    onSelectedSectorClosed={clearRequestedTheokyklosSector}
                    onChange={updateHabitWorkspace}
                    onOpenHabits={() => navigateTo("habits")}
                    onOpenStoicheion={() => navigateTo("stoicheion")}
                  />
                </Suspense>
              ) : null}
              {view === "admin" && cloudUser?.isAdmin ? <Suspense fallback={<DeferredViewFallback label={language === "en" ? "Opening administration…" : "Открываем панель администратора…"} />}><AdminPanel partnersEnabled={cloudUser.partnerProgramEnabled} /></Suspense> : null}
              {view === 'partners' && cloudUser?.partnerAccess?.panelEnabled ? <Suspense fallback={<DeferredViewFallback label={language === 'en' ? 'Loading…' : 'Загрузка…'} />}><PartnerPage language={language} onBack={() => navigateTo('today')} /></Suspense> : null}
            </ViewErrorBoundary>
            <footer className="genesis-page-footer" aria-label="Ссылки проекта" data-exp-layout="safe-footer">
              <a href={GENESIS_TELEGRAM} target="_blank" rel="noreferrer" data-no-translate>
                <span aria-hidden="true">✦</span>
                <span><strong>{genesisTelegramLabel(language)}</strong><small>Telegram</small></span>
              </a>
              <DonationLink language={language} authenticated={Boolean(cloudUser)}>
                <span aria-hidden="true">♡</span>
                <span><strong>{release319Copy[language].donation}</strong><small>CloudTips</small></span>
              </DonationLink>
            </footer>
          </div>
        </div>
      </section>

      {habitFeedback ? <HabitCompletionFeedback event={habitFeedback} language={language} showGamification={habitWorkspace.habitSettings.feedback.gamificationWidgets} /> : null}
      <nav className="mobile-nav" aria-label="Мобильная навигация" data-exp-ui="mobile-nav">
        {navigation.map((item) => (
          <button type="button" key={item.id} data-nav-id={item.id} data-exp-ui="nav-button" className={(view === item.id || item.id === "calendar" && view === "year" || item.id === "stoicheion" && view === "theokyklos") ? "active" : ""} onClick={() => activateNavigation(item.id)} aria-label={item.label}>
            {experimentalThemeActive ? <ExperimentalIcon name={item.id} className="genesis-nav-icon" /> : <NavigationIcon name={item.id} />}<small>{item.label}</small>
          </button>
        ))}
      </nav>
      {solarExplorerOpen ? <Suspense fallback={<DeferredDialogFallback label={translateText("Загрузка…",language)}/>}><SolarCalendarExplorer year={sacredYear} language={language}
        onClose={() => setSolarExplorerOpen(false)} onOpenDate={(month,day) => { setSolarExplorerOpen(false); openCalendarDate(getGregorianDate(sacredYear,month,day), "year"); }} /></Suspense> : null}
      {sacredYearDetailsOpen ? <Suspense fallback={<DeferredDialogFallback label={translateText("Загрузка…",language)}/>}><SacredYearDetailsDialog onClose={() => setSacredYearDetailsOpen(false)} /></Suspense> : null}
      {lunarYearDetailsOpen ? <Suspense fallback={<DeferredDialogFallback label={translateText("Загрузка…",language)}/>}><LunarYearDetailsDialog language={language} onClose={() => setLunarYearDetailsOpen(false)} /></Suspense> : null}
      {calendarTaskListDate ? <Suspense fallback={<DeferredDialogFallback label={translateText("Загрузка…",language)}/>}><CalendarDayTasksDialog
        key={calendarTaskListDate} date={calendarTaskListDate} dateLabel={formatGregorian(new Date(`${calendarTaskListDate}T12:00:00`), true)}
        personal={[...(calendarTasksByDate.get(calendarTaskListDate) ?? [])].sort((a,b) => a.time.localeCompare(b.time))}
        sharedEnabled={sharedProjectsReadable} language={language} formatTime={time => formatTimeValue(time, activeTimeFormat)}
        onClose={() => setCalendarTaskListDate("")} onPersonal={task => openPersonalCalendarTaskDetails(task, calendarTaskListDate)} onShared={openSharedCalendarTaskDetails}/></Suspense> : null}
      {dayDetailsOpen ? (
        <div className="modal-backdrop day-details-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setDayDetailsOpen(false); }}>
          <section ref={dayDetailsDialogRef} className={`day-details-modal mode-${activeCalendarMode}${selectedSolarEvent ? " solar-selected-day" : ""}`} role="dialog" aria-modal="true" aria-labelledby="selected-day-title" aria-describedby={sacredFeaturesEnabled ? "selected-day-description" : undefined} tabIndex={-1}>
            <DialogCloseButton type="button" className="modal-close" onClick={() => setDayDetailsOpen(false)} aria-label="Закрыть сведения о дне" />
            <header className="day-details-hero">
            <div className="day-details-introduction">
            <img className="day-details-art" data-genesis-preserve="selected-day-art"
              src={activeCalendarMode === "lunar" ? `${APP_BASE}/${lunarPatronArt(selectedMoon.day)}` : activeCalendarMode === "profane" ? weekdayArtUrl(selectedDate.getDay()) : dayArtUrl(monthIndex, selectedDay)}
              alt={activeCalendarMode === "lunar" ? lunarTriadCopy(language)[lunarPatronForDay(selectedMoon.day)].name : activeCalendarMode === "profane" ? selectedWeekdayPatron.guidancePatrons : selectedSacredDay.name} />
            <div className="day-details-heading">
              <div className="selected-day-symbol" aria-hidden="true">{selectedSolarEvent?.symbol ?? (activeCalendarMode === "lunar" ? "☾" : activeCalendarMode === "profane" ? <WeekdaySymbol weekday={selectedDate.getDay()} /> : selectedElement.symbol)}</div>
              <div className="selected-day-copy">
                <span className="eyebrow">{!sacredFeaturesEnabled ? (language === "en" ? "Day plan" : "План дня") : activeCalendarMode === "profane"
                  ? `${formatCalendarDate(selectedDate, "sacred")} · ${selectedMoon.day} ${language === "en" ? "lunar day" : "лунный день"}`
                  : activeCalendarMode === "lunar"
                    ? `${formatGregorian(selectedDate, true)} · ${formatCalendarDate(selectedDate, "sacred")}`
                    : `${formatGregorian(selectedDate, true)} · ${selectedMoon.epithet}`}</span>
                <h2 id="selected-day-title">{activeCalendarMode === "profane"
                  ? formatGregorian(selectedDate, true)
                  : activeCalendarMode === "lunar"
                    ? `${selectedLunarDate.month.name} · ${selectedMoon.day} ${language === "en" ? "lunar day" : "лунный день"}`
                    : selectedSacredDay.name}</h2>
                {sacredFeaturesEnabled ? <p id="selected-day-description">{activeCalendarMode === "lunar"
                  ? (language === "en"
                      ? `${selectedLunarDate.isThreshold ? "Threshold" : selectedLunarDate.decade.name} · ${selectedMoon.phase} · ${selectedMoon.illumination}% illuminated. ${selectedLunarDate.month.description} Sacred meaning of the day: ${selectedSacredDay.name} — ${selectedSacredDay.description}`
                      : `${selectedLunarDate.isThreshold ? "Рубеж" : selectedLunarDate.decade.name} · ${selectedMoon.phase} · освещённость ${selectedMoon.illumination}%. ${selectedLunarDate.month.description} Сакральный смысл дня: ${selectedSacredDay.name} — ${selectedSacredDay.description}`)
                  : activeCalendarMode === "profane"
                    ? `${selectedWeekdayPatron.patronage}. ${selectedWeekdayPatron.deity} ${language === "en" ? "Body parts:" : "Части тела:"} ${selectedWeekdayPatron.bodyParts}`
                    : selectedSacredDay.description}</p> : null}
                {sacredFeaturesEnabled && selectedSolarEvent ? <strong className="selected-solar-event">{selectedSolarEvent.name} · {formatSolarEventTime(selectedSolarEvent.date)} · День Солнца</strong> : null}
              </div>
            </div>
            </div>
              {sacredFeaturesEnabled ? <dl className="selected-day-facts">
                {selectedSolarEvent ? <div className="solar-fact"><dt>Солнечная точка</dt><dd>{selectedSolarEvent.name} · {formatSolarEventTime(selectedSolarEvent.date)}</dd></div> : null}
                {sacredFeaturesEnabled && activeCalendarMode === "profane" ? <div><dt>{language === "en" ? "Sacralization of the day" : "Сакрализация дня"}</dt><dd>{selectedWeekdayPatron.weekday} · {selectedWeekdayPatron.guidanceTitle}</dd></div> : null}
                <div><dt>Григорианская дата</dt><dd>{formatGregorian(selectedDate, true)}</dd></div>
                {sacredFeaturesEnabled ? <div><dt>Сакральная дата</dt><dd>{formatCalendarDate(selectedDate, "sacred")}</dd></div> : null}
                <div><dt>Лунный месяц</dt><dd>{selectedLunarDate.month.name} · {selectedLunarDate.month.title}</dd></div>
                <div><dt>Лунные сутки</dt><dd>{selectedMoon.day} · {selectedMoon.phase}</dd></div>
                <div><dt>{language === "en" ? "Lunar decade" : "Лунная декада"}</dt><dd>{selectedLunarDate.isThreshold ? "Рубеж" : selectedLunarDate.decade.name}</dd></div>
                {sacredFeaturesEnabled ? <><div><dt>Стихия</dt><dd>{selectedElement.name}</dd></div>
                <div><dt>Пята</dt><dd>{selectedSacredDay.pyataTitle || "Апейрон"}</dd></div>
                <div><dt>Число</dt><dd>{selectedPythagorean?.name || "Безграничное"}</dd></div></> : null}
              </dl> : null}
            </header>
            {activeCalendarMode === "profane" && sacredFeaturesEnabled ? (
              <article className={`profane-day-guidance weekday-${selectedDate.getDay()}`} aria-labelledby="profane-day-guidance-title">
                <header>
                  <span className="profane-day-guidance-symbol" aria-hidden="true"><WeekdaySymbol weekday={selectedDate.getDay()} /></span>
                  <div>
                    <span className="eyebrow">{language === "en" ? "Rhythm of the Gregorian day" : "Ритм григорианского дня"}</span>
                    <h3 id="profane-day-guidance-title">{selectedWeekdayPatron.guidanceTitle}</h3>
                    <small>{selectedWeekdayPatron.guidancePatrons}</small>
                  </div>
                </header>
                <p>{selectedWeekdayPatron.guidance}</p>
                <dl>
                  <div>
                    <dt>{language === "en" ? "Synthema" : "Синтема"}</dt>
                    <dd>
                      <strong lang={language === "el" ? "grc" : language === "uk" ? "uk" : "grc-Latn"}>{selectedWeekdayPatron.synthema}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>{language === "en" ? "Meaning" : "Смысл"}</dt>
                    <dd>{selectedWeekdayPatron.meaning}</dd>
                  </div>
                </dl>
              </article>
            ) : null}
            <div className="day-details-create-task">
              <button type="button" className="day-details-create-task-button" onClick={beginSelectedDayTask}>
                <span aria-hidden="true">{experimentalThemeActive ? <ExperimentalIcon name="plus" /> : "＋"}</span>
                <span><strong>Создать задачу</strong><small>{formatCalendarDate(selectedDate, activeTaskCalendarMode, true)}</small></span>
                <i aria-hidden="true">→</i>
              </button>
            </div>
            {habitWorkspace.habitSettings.enabled ? (
              <Suspense fallback={<DeferredHabitFallback label={language === "en" ? "Opening daily trackers…" : "Открываем трекеры дня…"} />}>
                <HabitDailyPanel
                  workspace={habitWorkspace}
                  date={selectedDateValue}
                  language={language}
                  timeFormat={activeTimeFormat}
                  calendarMode={activeTaskCalendarMode}
                  experimentalThemeActive={false}
                  onChange={updateHabitWorkspace}
                  onSave={(next) => updateHabitWorkspace(next, true) ?? Promise.resolve()}
                  onTimerCommand={runHabitTimerCommand}
                  onOpenHabits={() => {
                    setDayDetailsOpen(false);
                    navigateTo("habits");
                  }}
                  onOpenHistory={date=>{setDayDetailsOpen(false);setHabitReminderFocus(null);setHabitHistoryRequest(previous=>({date,token:(previous?.token??0)+1}));navigateTo("habits");}}
                  onCreateHabit={() => { setDayDetailsOpen(false); setVoiceHabitRequest({ token: Date.now(), kind: "create" }); navigateTo("habits"); }}
                  compact
                />
              </Suspense>
            ) : null}
            {selectedDayTasks.length ? (
              <section className="day-details-tasks" aria-labelledby="day-details-tasks-title">
                <header>
                  <span className="eyebrow">План дня</span>
                  <h3 id="day-details-tasks-title">Задачи · {selectedDayTasks.length}</h3>
                </header>
                <div className="day-details-task-list">
                  {selectedDayTasks.map((task) => {
                    const projectTitle = resolvedTaskProjectTitle(task);
                    return (
                      <article className={task.done ? "done" : ""} key={task.id}>
                        <button
                          type="button"
                          className="task-check"
                          aria-pressed={task.done}
                          onClick={() => toggleTask(task.id)}
                          aria-label={namedAction(task.done ? "Вернуть задачу" : "Завершить задачу", task.title, language)}
                        >
                          {task.done ? <ExperimentalIcon name="check"/> : null}
                        </button>
                        <button type="button" className="day-details-task-open" onClick={() => {
                          setDayDetailsOpen(false);
                          setPersonalPreview({kind:"task",id:task.id,date:selectedDateValue});
                        }}>
                          <span><time>{task.time ? formatTimeValue(task.time, activeTimeFormat) : "Весь день"}</time>{task.priority ? <em>Приоритет {task.priority}</em> : null}</span>
                          <strong data-no-translate>{task.title}</strong>
                          {renderOverdueBadge(task, selectedDateValue)}
                          {task.description || projectTitle || task.googleTaskListTitle ? (
                            <small data-no-translate>{task.description || projectTitle || task.googleTaskListTitle}</small>
                          ) : null}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {(sharedDayPage.page?.total ?? sharedCalendarCounts[selectedDateValue] ?? 0) ? (
              <section className="day-details-tasks day-details-shared-tasks" aria-labelledby="day-details-shared-tasks-title">
                <header><span className="eyebrow">{language === "en" ? "Team plan" : "Командный план"}</span>
                  <h3 id="day-details-shared-tasks-title">{language === "en" ? "Shared tasks" : "Общие задачи"} · {(sharedDayPage.page?.total ?? sharedCalendarCounts[selectedDateValue] ?? 0)}</h3></header>
                <div className="day-details-task-list">
                  {sharedDayTasks.map((task) => <article className={task.completedAt ? "done" : ""} key={task.id}>
                    <button type="button" className="day-details-task-open" onClick={() => openSharedCalendarTask(task)}>
                      <span><time>{task.projectTitle || (language === "en" ? "Space inbox" : "Хаос-бокс пространства")}</time></span>
                      <strong data-no-translate>{task.title}</strong>
                    </button>
                  </article>)}
                <SharedTaskPageControls page={sharedDayPage.page} loaded={sharedDayTasks.length} busy={sharedDayPage.busy} onMore={()=>void sharedDayPage.more()} onRefresh={()=>void sharedDayPage.refresh()} error={sharedDayPage.error}/>
                </div>
              </section>
            ) : null}
            {sacredFeaturesEnabled ? <details className="day-details-celestial" open={activeCalendarMode !== "sacred" ? true : undefined}>
              <summary>
                <span><i aria-hidden="true">☾</i> Луна и Солнце</span>
                <small>Фаза Луны, рассвет и закат</small>
              </summary>
              <div className="day-details-celestial-grid">
                <article className="day-details-moon">
                  <MoonPhaseIcon phaseStep={selectedMoon.phaseStep} size={44} />
                  <div>
                    <span className="eyebrow">{selectedLunarDate.month.name} · {selectedMoon.day} день</span>
                    <strong>{selectedMoon.epithet}</strong>
                    <p>{selectedMoon.phase} · освещённость {selectedMoon.illumination}%</p>
                    <small>{selectedLunarDate.isThreshold ? "Рубеж" : selectedLunarDate.decade.name} · {selectedMoon.direction}{selectedMoon.event ? ` · ${selectedMoon.event}` : ""}</small>
                  </div>
                </article>
                <article className="day-details-sun">
                  <span aria-hidden="true">☀</span>
                  <div>
                    <span className="eyebrow">Солнце · время устройства</span>
                    <dl>
                      <div><dt>Рассвет</dt><dd>{selectedSunrise}</dd></div>
                      <div><dt>Закат</dt><dd>{selectedSunset}</dd></div>
                    </dl>
                    <small>{selectedSunriseSunset
                      ? `${solarTimeZone} · ${solarLocationSource === "selected-city" ? "координаты выбранного города" : "автоматический расчёт для региона устройства"}`
                      : solarLocationStatus === "ready"
                      ? "В этот день солнце не пересекает линию горизонта"
                      : "Синхронизируем данные о Солнце…"}</small>
                  </div>
                </article>
              </div>
            </details> : null}
            {dayDetailsOrigin === "year" ? (
              <div className="day-details-actions">
                <button type="button" className="primary-button" onClick={() => {
                  setDayDetailsOrigin("calendar");
                  setDayDetailsOpen(false);
                  navigateTo("calendar");
                }}>
                  Открыть месяц «{selectedDisplayMonthName}» <span aria-hidden="true">→</span>
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
        {taskComposer ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTaskComposer(null); }}>
          <section ref={taskComposerDialogRef} className="editor-modal task-composer-modal" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby="task-composer-title" tabIndex={-1}>
            <header className="dialog-heading">
            <h2 id="task-composer-title">{language === "en" ? "Create" : "Создать"} · {taskScope === "shared" ? "Общее дело" : "Личное дело"}</h2>
            <DialogCloseButton type="button" className="modal-close" onClick={() => setTaskComposer(null)} aria-label="Закрыть" />
            </header>
            {mindmapConversion ? <p className="mindmap-conversion-notice">Создаётся одна настоящая задача GENESIS. На карте останется ссылка; пояснение карты не переносится. {cloudUser?.calendarConnected ? "Внешняя синхронизация — по выбранным ниже настройкам." : "Google-синхронизация не подключена: задача сохранится на этом устройстве."}</p> : null}
            {taskComposer === "today" && sharedProjectsAvailable ? <div className="task-scope-switch" data-dialog-header-desktop role="group" aria-label="Доступ к делу">
              {(["personal", "shared"] as const).map((scope) => <button type="button" key={scope} aria-pressed={taskScope === scope} onClick={() => chooseTaskScope(scope)}>{scope === "personal" ? "Личное" : "Общее"}</button>)}
            </div> : null}
            <div className="task-composer-tabs" role="tablist" tabIndex={-1} aria-label="Тип дела" onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault(); const tabs = (["task", "lists", "meeting", "birthday", "event"] as const).filter(tab => tab !== "birthday" || taskScope !== "shared");
              const index = tabs.indexOf(composerTab); const tab = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length-1] : tabs[(index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length];
              setComposerTab(tab); setTaskUndated(false); if(tab !== "lists") {setNewEntryType(tab);setYandexEntryType(tab === "meeting" ? "meeting" : "task");} event.currentTarget.querySelector<HTMLButtonElement>(`#composer-tab-${tab}`)?.focus();
            }}>
              {(["task", "lists", "meeting", "birthday", "event"] as const).filter(tab => tab !== "birthday" || taskScope !== "shared").map((tab) => <IconActionButton id={`composer-tab-${tab}`} role="tab" key={tab} icon={tab === "lists" ? "list" : tab} label={translateText(tab === "lists" ? "Списки задач" : entryTypeLabel(tab, language === "en"), language)} showLabel choiceHint aria-selected={composerTab === tab} aria-controls={`composer-panel-${tab}`} tabIndex={composerTab === tab ? 0 : -1} onClick={() => { setComposerTab(tab); setTaskUndated(false); if(tab !== "lists"){setNewEntryType(tab);setYandexEntryType(tab === "meeting" ? "meeting" : "task");} }}/>)}
            </div>
            <div id={`composer-panel-${composerTab}`} role="tabpanel" aria-labelledby={`composer-tab-${composerTab}`}>
              {composerTab === "lists" ? renderTaskListCreateForm("composer") : renderTaskCreateForm("composer")}
            </div>
          </section>
        </div> : null}

      {dayTaskCreatorOpen ? (
        <div className="modal-backdrop day-task-create-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeSelectedDayTaskCreator(); }}>
          <section ref={dayTaskCreatorDialogRef} className="editor-modal day-task-create-modal" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby="day-task-create-title" aria-describedby="day-task-create-description" tabIndex={-1}>
            <DialogCloseButton type="button" className="modal-close" onClick={closeSelectedDayTaskCreator} aria-label="Закрыть создание задачи" />
            <span className="eyebrow">Дата задачи</span>
            <h2 id="day-task-create-title">Новая задача на выбранный день</h2>
            <p className="day-task-create-date" id="day-task-create-description">
              <strong>{formatCalendarDate(selectedDate, activeTaskCalendarMode, true)}</strong>
              <small>{formatGregorian(selectedDate, true)}</small>
              <span>Дата уже выбрана. При необходимости её можно изменить в форме.</span>
            </p>
            {renderTaskCreateForm("day-details")}
          </section>
        </div>
      ) : null}
      {pendingTaskDeletion ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingTaskDeletion(null); }}>
          <section ref={taskDeleteDialogRef} className="editor-modal task-series-delete-modal" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby="task-series-delete-title" tabIndex={-1}>
            <DialogCloseButton type="button" className="modal-close" onClick={() => setPendingTaskDeletion(null)} aria-label="Закрыть" />
            <span className="eyebrow">{pendingDeletionHasSeries ? "Удаление повторяющейся задачи" : "Удалить задачу?"}</span>
            <h2 id="task-series-delete-title">{pendingDeletionHasSeries ? "Что удалить?" : pendingDeletionTask?.title}</h2>
            <p>{pendingDeletionHasSeries ? "Можно убрать только выбранный день или всю серию вместе со всеми её повторениями." : "Задача и её напоминания будут удалены."}</p>
            <div className="task-series-delete-actions">
              <button type="button" className="text-button" onClick={() => setPendingTaskDeletion(null)}>Отмена</button>
              {pendingDeletionHasSeries ? <button type="button" onClick={deletePendingTaskOccurrence}>Только этот день</button> : null}
              <button type="button" className="danger-button" onClick={deletePendingTaskSeries}>{pendingDeletionHasSeries ? "Всю серию" : "Удалить"}</button>
            </div>
          </section>
        </div>
      ) : null}
      {editingTask ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingTask(null); }}>
          <form ref={taskEditorDialogRef} className="editor-modal task-editor" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby="task-editor-title" tabIndex={-1} onSubmit={saveTaskEdit}>
            <DialogCloseButton type="button" className="modal-close" onClick={() => setEditingTask(null)} aria-label="Закрыть" />
            <span className="eyebrow">{cloudUser?.authProvider === "yandex" && editingTask.yandexEntryType === "meeting" ? "Редактирование встречи" : "Редактирование задачи"}</span>
            <h2 id="task-editor-title">{cloudUser?.authProvider === "yandex" ? "Запись Яндекс.Календаря" : "Задача и её контекст"}</h2>
            <EntryTypeChoice value={editingTask.entryType ?? "task"} english={language === "en"} onChange={value => setEditingTask(current => current ? {...current, entryType:value, ...(cloudUser?.authProvider === "yandex" ? {yandexEntryType:value === "meeting" ? "meeting" : "task"} : {})} : current)} />
            <p className="editor-source-note">
              {taskOriginMeta(editingTask.createdIn).label}.
              {!cloudUser?.calendarConnected ? " Задача сохранится на этом устройстве."
                : cloudUser.authProvider === "yandex" ? " Изменения синхронизируются с Яндекс.Календарём."
                : editingTask.googleTaskListTitle ? ` Список Google Tasks: «${editingTask.googleTaskListTitle}».` : " Изменения синхронизируются с Google Calendar."}
            </p>
            {cloudUser?.authProvider === "yandex" ? <label><span>Тип записи</span>
              <select value={editingTask.yandexEntryType ?? "task"} onChange={(event) => setEditingTask((current) => current ? {
                ...current, yandexEntryType: event.target.value as "task" | "meeting",
              } : current)}><option value="task">Задача</option><option value="meeting">Встреча</option></select></label> : null}
            {taskHasSeries(editingTask) ? (
              <fieldset className="task-series-scope">
                <legend>Область изменений</legend>
                <div><input id="task-series-scope-occurrence" type="radio" name="task-series-scope" checked={editingTaskScope === "occurrence"} onChange={() => changeEditingTaskScope("occurrence")} /><label htmlFor="task-series-scope-occurrence"><strong>Только этот день</strong><small>{formatCalendarDate(new Date(`${editingOccurrenceDate || editingTask.dueDate}T12:00:00`), editTaskCalendarMode, true)}</small></label></div>
                <div><input id="task-series-scope-series" type="radio" name="task-series-scope" checked={editingTaskScope === "series"} onChange={() => changeEditingTaskScope("series")} /><label htmlFor="task-series-scope-series"><strong>Вся серия</strong><small>Изменить все повторения одной задачей</small></label></div>
              </fieldset>
            ) : null}
            <label>
              <span>Название</span>
              <input value={editingTask.title} onChange={(event) => setEditingTask((current) => current ? { ...current, title: event.target.value } : current)} placeholder={entryTypeTitlePlaceholder(editingTask.entryType)} required />
            </label>
            <label>
              <span>Описание</span>
              <textarea rows={4} value={editingTask.description} onChange={(event) => setEditingTask((current) => current ? { ...current, description: event.target.value } : current)} placeholder="Подробности, результат и заметки" />
            </label>
            {(personalMindmapsEnabled || !editingTask.dueDate) && (editingTask.entryType ?? "task") === "task" && cloudUser?.authProvider !== "yandex" ? <label className="record-undated-choice">
              <input type="checkbox" checked={!editingTask.dueDate} disabled={Boolean(cloudUser?.calendarConnected && !editingTask.googleTaskListId) || taskHasSeries(editingTask)} onChange={event => setEditingTask(current => current ? {
                ...current, dueDate: event.target.checked ? "" : todayDateValue, endDate: event.target.checked ? "" : todayDateValue,
                time: "", reminders: [], reminderMinutes: null, calendarNote: "",
              } : current)} /><span>Без даты</span>
            </label> : null}
            {editingTask.dueDate ? <RecordDateTimeRow dateId="edit-task-start-date" timeId="edit-task-time-hour" mode={editTaskCalendarMode}
              min={editingTask.dueDate < todayDateValue ? editingTask.dueDate : todayDateValue} date={editingTask.dueDate} required
              onDateChange={nextDate => setEditingTask(current => current ? {
                  ...current,
                  dueDate: nextDate,
                  endDate: current.endDate < nextDate ? nextDate : current.endDate,
                } : current)} time={editingTask.time} timeFormat={activeTimeFormat} timeDisabled={Boolean(editingTask.googleTaskId) && cloudUser?.authProvider === "google"}
              onTimeChange={time => setEditingTask(current => current ? {...current, time} : current)}/> : <p>Без даты</p>}
            <details className="task-advanced-fields" onInvalidCapture={event => { event.currentTarget.open = true; }}>
              <summary>{language === "en" ? "Details and settings" : "Подробности и настройки"}</summary>
              <label>
                <span>Проект</span>
                <select value={editingTask.projectId ?? ""} onChange={(event) => setEditingTask((current) => current ? { ...current, projectId: event.target.value || null } : current)}>
                  <option value="">{editingTask.googleTaskListId && linkedProjectId(editingTask.googleTaskListId)
                    ? (cloudUser?.authProvider === "yandex" ? "По проекту списка GENESIS" : "По проекту списка Google Tasks")
                    : (language === "en" ? "Inbox" : "Хаос-бокс")}</option>
                  <option value={TASK_INBOX_PROJECT_ID}>Хаос-бокс — без проекта</option>
                  {flattenProjects(projects).map(({ project, depth }) => <option key={project.id} value={project.id}>{"— ".repeat(depth)}{project.title}</option>)}
                </select>
              </label>
            <RecordCalendarChoice value={editTaskCalendarMode} language={language} onChange={(mode) => setEditingTask((current) => {
              if (!current) return current;
              const recurrence = alignRecurrenceConfigWithCalendar(recurrenceConfigFromTask(current), mode, current.dueDate);
              return { ...current, calendarMode: mode, recurrenceMode: recurrence.enabled ? recurrence.mode : "none",
                recurrencePattern: recurrence.enabled ? recurrence.pattern : "none", recurrenceDays: recurrence.days,
                recurrenceMonths: recurrence.months, recurrencePyatas: recurrence.pyatas, recurrenceContext: recurrence.calendarContext, recurrenceInvalidDayPolicy: recurrence.invalidDayPolicy };
            })} />
            <div className="editor-grid">
              {editingTask.dueDate ? <label htmlFor="edit-task-end-date">
                <span>Срок выполнения</span>
                <CalendarDatePicker id="edit-task-end-date" mode={editTaskCalendarMode} min={editingTask.dueDate} value={editingTask.endDate || editingTask.dueDate} onChange={(nextDate) => setEditingTask((current) => current ? { ...current, endDate: nextDate } : current)} required />
              </label> : null}
              {editingTask.entryType === "meeting" && cloudUser?.authProvider !== "yandex" ? <label htmlFor="edit-meeting-end-time"><span>{language === "en" ? "End time" : "Время окончания"}</span><TimeClockPicker id="edit-meeting-end-time" ariaLabel={language === "en" ? "End time" : "Время окончания"} value={editingTask.endTime ?? ""} timeFormat={activeTimeFormat} onChange={value => setEditingTask(current => current ? {...current,endTime:value} : current)} /></label> : null}
              {cloudUser?.authProvider === "yandex" ? <label className="yandex-all-day"><input type="checkbox" checked={!editingTask.time}
                onChange={(event) => setEditingTask((current) => current ? {
                  ...current, time: event.target.checked ? "" : "09:00",
                  yandexEndTime: event.target.checked ? "" : "09:30",
                } : current)} /><span>Весь день</span></label> : null}
              {cloudUser?.authProvider === "yandex" ? <div className="task-form-section yandex-task-fields" aria-label="Поля Яндекс.Календаря">
                {editingTask.yandexEntryType === "meeting" ? <>
                  <label htmlFor="edit-yandex-end-time"><span>Время окончания · время устройства</span><TimeClockPicker id="edit-yandex-end-time" value={editingTask.yandexEndTime ?? ""} disabled={!editingTask.time} ariaLabel="Время окончания"
                    onChange={(value) => setEditingTask((current) => current ? { ...current, yandexEndTime: value } : current)} /></label>
                  <label><span>Участники · через запятую</span><input defaultValue={(editingTask.yandexAttendees ?? []).join(", ")}
                    onChange={(event) => setEditingTask((current) => current ? { ...current,
                      yandexAttendees: event.target.value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean) } : current)} /></label>
                  <label><span>Необязательные участники</span><input defaultValue={(editingTask.yandexOptionalAttendees ?? []).join(", ")}
                    onChange={(event) => setEditingTask((current) => current ? { ...current,
                      yandexOptionalAttendees: event.target.value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean) } : current)} /></label>
                  <label><span>Место</span><input value={editingTask.yandexLocation ?? ""}
                    onChange={(event) => setEditingTask((current) => current ? { ...current, yandexLocation: event.target.value } : current)} /></label>
                  <label><span>Ссылка на Телемост</span><input type="url" value={editingTask.yandexTelemostUrl ?? ""}
                    onChange={(event) => setEditingTask((current) => current ? { ...current, yandexTelemostUrl: event.target.value } : current)} /></label>
                </> : null}
                <label><span>Занятость</span><select value={editingTask.yandexBusy ? "busy" : "free"}
                  onChange={(event) => setEditingTask((current) => current ? { ...current, yandexBusy: event.target.value === "busy" } : current)}>
                  <option value="busy">Занят</option><option value="free">Свободен</option></select></label>
                <label><span>Видимость</span><select value={editingTask.yandexVisibility ?? "private"}
                  onChange={(event) => setEditingTask((current) => current ? { ...current, yandexVisibility: event.target.value as "private" | "public" } : current)}>
                  <option value="private">Только участники</option><option value="public">Все</option></select></label>
                <fieldset><legend>Напоминания Яндекс.Календаря</legend>
                  {[0, 10, 30, 60, 1440].map((minutes) => <label key={minutes}><input type="checkbox"
                    checked={(editingTask.yandexReminders ?? []).includes(minutes)}
                    onChange={(event) => setEditingTask((current) => current ? { ...current,
                      yandexReminders: event.target.checked ? [...(current.yandexReminders ?? []), minutes].slice(0, 5)
                        : (current.yandexReminders ?? []).filter((item) => item !== minutes) } : current)} />
                    <span>{minutes === 0 ? "В момент события" : minutes === 10 ? "За 10 минут" : minutes === 30 ? "За 30 минут" : minutes === 60 ? "За час" : "За день"}</span>
                  </label>)}
                </fieldset>
              </div> : null}
              <label>
                <span>Календарь или список задач</span>
                <select value={editingTask.googleTaskListId ?? ""} onChange={(event) => {
                  const nextListId = event.target.value;
                  const destination = taskLists.find((taskList) => taskList.id === nextListId);
                  setEditingTask((current) => current ? {
                    ...current,
                    googleTaskListId: nextListId || null,
                    googleTaskListTitle: destination?.title ?? "",
                    googleAccountId: destination?.accountId ?? null,
                    googleAccountEmail: destination?.accountEmail ?? "",
                    syncAccountIds: destination?.accountId ? [destination.accountId] : current.syncAccountIds,
                    time: nextListId && cloudUser?.authProvider === "google" ? "" : current.time,
                    reminders: nextListId && cloudUser?.authProvider === "google" ? [] : current.reminders,
                    reminderMinutes: nextListId && cloudUser?.authProvider === "google" ? null : current.reminderMinutes,
                    recurrence: nextListId && cloudUser?.authProvider === "google" ? "none" : current.recurrence,
                    recurrenceInterval: nextListId && cloudUser?.authProvider === "google" ? 1 : current.recurrenceInterval,
                    recurrenceMode: nextListId && cloudUser?.authProvider === "google" ? "none" : current.recurrenceMode,
                    recurrencePattern: nextListId && cloudUser?.authProvider === "google" ? "none" : current.recurrencePattern,
                    recurrenceDays: nextListId && cloudUser?.authProvider === "google" ? [] : current.recurrenceDays,
                    recurrenceStartDate: nextListId && cloudUser?.authProvider === "google" ? null : current.recurrenceStartDate,
                    recurrenceEndDate: nextListId && cloudUser?.authProvider === "google" ? null : current.recurrenceEndDate,
                    recurrenceMonths: nextListId && cloudUser?.authProvider === "google" ? [] : current.recurrenceMonths,
                    recurrencePyatas: nextListId && cloudUser?.authProvider === "google" ? [] : current.recurrencePyatas,
                    recurrenceExcludedDates: nextListId && cloudUser?.authProvider === "google" ? [] : current.recurrenceExcludedDates,
                    recurrenceSeriesId: nextListId && cloudUser?.authProvider === "google" ? null : current.recurrenceSeriesId,
                  } : current);
                }}>
                  <option value="">{!cloudUser?.calendarConnected ? "На этом устройстве" : cloudUser.authProvider === "yandex" ? "Яндекс.Календарь" : "Google Calendar"}</option>
                  {taskLists.map((taskList) => <option value={taskList.id} key={`${taskList.accountId ?? "primary"}-${taskList.id}`}>Список · {taskList.title}{taskList.accountEmail ? ` · ${taskList.accountEmail}` : ""}</option>)}
                </select>
              </label>
              {cloudUser?.authProvider === "yandex" ? <strong>Дополнительные напоминания GENESIS</strong> : null}
              <TaskReminderPicker
                value={editingTask.reminders}
                onChange={(reminders) => setEditingTask((current) => current ? {
                  ...current,
                  reminders,
                  reminderMinutes: legacyReminderMinutes(reminders),
                } : current)}
                taskDate={editingTask.dueDate}
                taskTime={editingTask.time}
                calendarMode={editTaskCalendarMode}
                timeFormat={activeTimeFormat}
                disabled={!editingTask.dueDate || Boolean(editingTask.googleTaskId)}
              />
              <div className="task-form-field task-form-priority">
                <span>Приоритет</span>
                <TaskPriorityControl
                  id="edit-task-priority"
                  value={editingTask.priority}
                  onChange={(value) => setEditingTask((current) => current ? { ...current, priority: value } : current)}
                />
              </div>
            </div>
            {editingTask.dueDate && (editingTaskScope === "series" || !taskHasSeries(editingTask)) ? (
              <RecurrenceBuilder
                value={recurrenceConfigFromTask(editingTask)}
                startDate={editingTask.dueDate}
                destination="calendar"
                calendarMode={editTaskCalendarMode}
                onChange={(recurrence) => setEditingTask((current) => current ? {
                  ...current,
                  recurrence: "none",
                  recurrenceInterval: recurrence.interval,
                  recurrenceMode: recurrence.enabled ? recurrence.mode : "none",
                  recurrencePattern: recurrence.enabled ? recurrence.pattern : "none",
                  recurrenceDays: recurrence.enabled ? [...recurrence.days] : [],
                  recurrenceStartDate: recurrence.enabled ? recurrence.rangeStart || current.dueDate : null,
                  recurrenceEndDate: recurrence.enabled ? recurrence.rangeEnd || null : null,
                  recurrenceMonths: recurrence.enabled ? [...recurrence.months] : [],
                  recurrencePyatas: recurrence.enabled ? [...recurrence.pyatas] : [],
                  recurrenceContext: recurrence.calendarContext, recurrenceInvalidDayPolicy: recurrence.invalidDayPolicy,
                  recurrenceExcludedDates: recurrence.enabled ? current.recurrenceExcludedDates : [],
                  googleTaskListId: recurrence.enabled ? null : current.googleTaskListId,
                  googleTaskListTitle: recurrence.enabled ? "" : current.googleTaskListTitle,
                  googleTaskId: recurrence.enabled ? null : current.googleTaskId,
                } : current)}
              />
            ) : null}
            <label>
              <span>Теги через запятую</span>
              <input value={editingTaskTags} onChange={(event) => setEditingTaskTags(event.target.value)} placeholder="работа, дом, ритуал" />
            </label>
            {tasks.length ? (
              <div className="task-form-field task-form-row-full">
                <span>Зависит от</span>
                <DependencyPicker
                  tasks={tasks}
                  excludeId={editingTask.id}
                  value={editingTask.dependsOnIds}
                  onChange={(ids) => setEditingTask((current) => current ? { ...current, dependsOnIds: ids } : current)}
                />
              </div>
            ) : null}
            </details>
            <div className="editor-actions task-editor-actions">
              <button type="button" className="task-editor-action task-editor-action-delete personal-action-hint" aria-label={translateText("Удалить", language)} data-action-hint={translateText("Удалить", language)} onClick={() => { const id = editingTask.id; const occurrence = editingOccurrenceDate || editingTask.dueDate; setEditingTask(null); deleteTask(id, occurrence); }}><ExperimentalIcon name="delete" /><span className="task-editor-action-label">{translateText("Удалить", language)}</span></button>
              {sharedProjectsAvailable && editingTask.entryType !== "birthday" ? <button type="button" className="task-editor-action task-editor-action-transfer personal-action-hint" aria-label={translateText("Переместить в общие", language)} data-action-hint={translateText("Переместить в общие", language)} onClick={() => { setTransferTask(tasks.find((task) => task.id === editingTask.id) ?? editingTask); setEditingTask(null); }}><ExperimentalIcon name="move" /><span className="task-editor-action-label">{translateText("Переместить в общие", language)}</span></button> : null}
              <button type="button" className="task-editor-action task-editor-action-cancel personal-action-hint" aria-label={translateText("Отмена", language)} data-action-hint={translateText("Отмена", language)} onClick={() => setEditingTask(null)}><ExperimentalIcon name="close" /><span className="task-editor-action-label">{translateText("Отмена", language)}</span></button>
              <button type="submit" className="task-editor-action task-editor-action-save personal-action-hint" aria-label={translateText("Сохранить задачу", language)} data-action-hint={translateText("Сохранить задачу", language)} disabled={!editingTask.title.trim()}><ExperimentalIcon name="save" /><span className="task-editor-action-label">{translateText("Сохранить задачу", language)}</span></button>
            </div>
          </form>
        </div>
      ) : null}
      {transferTask && sharedProjectsAvailable && cloudUser ? <Suspense fallback={null}><PersonalTaskTransfer
        task={transferTask} language={language} personalCalendarConnected={cloudUser.calendarConnected}
        onClose={() => setTransferTask(null)}
        onMoved={(taskId) => setTasks((current) => current.filter((task) => task.id !== taskId))}
      /></Suspense> : null}
      {transferProject && sharedProjectsAvailable ? <Suspense fallback={null}><PersonalProjectTransfer
        root={transferProject} projects={projects} categories={categories} language={language}
        tasks={tasks.map((task) => ({ ...task, projectId: resolvedTaskProjectId(task) }))}
        linkedListCount={taskListLinks.filter((link) => link.projectId &&
          (link.projectId === transferProject.id || projectIsDescendant(projects, link.projectId, transferProject.id))).length}
        onClose={() => setTransferProject(null)} onMoved={finishProjectTransfer}
      /></Suspense> : null}
      {editingTaskList ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingTaskList(null); }}>
          <form ref={taskListEditorDialogRef} className="editor-modal task-list-editor" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby="task-list-editor-title" tabIndex={-1} onSubmit={saveTaskListEdit}>
            <DialogCloseButton type="button" className="modal-close" onClick={() => setEditingTaskList(null)} aria-label="Закрыть" />
            <h2 id="task-list-editor-title">Переименовать список</h2>
            <label>
              <span>Название списка</span>
              <input value={editingTaskList.title} onChange={(event) => setEditingTaskList((current) => current ? { ...current, title: event.target.value } : current)} required />
            </label>
            <div className="editor-actions">
              <button type="button" className="text-button" onClick={() => setEditingTaskList(null)}>Отмена</button>
              <button type="submit" className="primary-button" disabled={!editingTaskList.title.trim()}>Сохранить список</button>
            </div>
          </form>
        </div>
      ) : null}
      {editingProject ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingProject(null); }}>
          <form ref={projectEditorDialogRef} className="editor-modal" data-exp-ui="dialog" role="dialog" aria-modal="true" aria-labelledby="project-editor-title" tabIndex={-1} onSubmit={saveProjectEdit}>
            <DialogCloseButton type="button" className="modal-close" onClick={() => setEditingProject(null)} aria-label="Закрыть" />
            <span className="eyebrow">Редактирование проекта</span>
            <h2 id="project-editor-title">Название и описание</h2>
            <label>
              <span>Название проекта</span>
              <input value={editingProject.title} onChange={(event) => setEditingProject((current) => current ? { ...current, title: event.target.value } : current)} required />
            </label>
            <label>
              <span>Описание проекта</span>
              <textarea rows={5} value={editingProject.description} onChange={(event) => setEditingProject((current) => current ? { ...current, description: event.target.value } : current)} placeholder="Цель, критерий завершения и важные детали" />
            </label>
            <div className="editor-grid">
              <label>
                <span>Категория</span>
                <select value={editingProject.categoryId ?? ""} onChange={(event) => setEditingProject((current) => current ? { ...current, categoryId: event.target.value || null } : current)}>
                  <option value="">Без категории</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{localizeCategoryName(category, language)}</option>)}
                </select>
              </label>
              <label>
                <span>Родительский проект</span>
                <select value={editingProject.parentId ?? ""} onChange={(event) => setEditingProject((current) => current ? { ...current, parentId: event.target.value || null } : current)}>
                  <option value="">Нет — верхний уровень</option>
                  {flattenProjects(projects).filter(({ project }) => project.id !== editingProject.id && !projectIsDescendant(projects, project.id, editingProject.id)).map(({ project, depth }) => <option key={project.id} value={project.id}>{"— ".repeat(depth)}{project.title}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span>Теги через запятую</span>
              <input value={editingProjectTags} onChange={(event) => setEditingProjectTags(event.target.value)} placeholder="стратегия, развитие, дом" />
            </label>
            <div className="editor-actions">
              <button type="button" className="text-button" onClick={() => setEditingProject(null)}>Отмена</button>
              <button type="submit" className="primary-button" disabled={!editingProject.title.trim()}>Сохранить проект</button>
            </div>
          </form>
        </div>
      ) : null}
      {workspaceRecoveryRequest ? (
        <WorkspaceRecoveryDialog
          request={workspaceRecoveryRequest}
          language={language}
          onRecovered={confirmWorkspaceRecovery}
          onCancel={cancelWorkspaceRecovery}
        />
      ) : null}
      {cloudUser ? <Suspense fallback={null}><WorkspaceConflictReview language={language} /></Suspense> : null}
      {accountOpen && cloudUser ? (
        <Suspense fallback={<DeferredDialogFallback label={language === "en" ? "Opening account…" : "Открываем личный кабинет…"} />}>
          <AccountPanel
            key={cloudUser.uid}
            user={cloudUser}
            onOpenPhysis={physisAccess.showEntry ? () => { setAccountOpen(false); setPhysisSettingsRequest(value => value + 1); navigateTo("physis"); } : undefined}
            onOpenPartners={cloudUser.partnerAccess?.panelEnabled ? () => { setAccountOpen(false); navigateTo('partners'); } : undefined}
            guideSharedProjects={accountGuideUserId === cloudUser.uid}
            guideSolarPlace={accountSolarPlaceUserId === cloudUser.uid}
            onExportCalendar={exportCalendar}
            calendarExportAvailable={tasks.length > 0}
            onClose={() => { setAccountGuideUserId(null); setAccountSolarPlaceUserId(null); setAccountOpen(false); }}
            onSignOut={handleGoogleSignOut}
            onReconnectGoogle={() => {
              setAccountOpen(false);
              void handleGoogleConnect();
            }}
            onConnectAdditionalGoogle={() => {
              setAccountOpen(false);
              void connectAdditionalGoogleAccount();
            }}
            onLanguageChange={selectLanguage}
            themeState={themeState}
            onThemeChange={changeGenesisTheme}
            categories={categories}
            habitTrackingEnabled={habitWorkspace.habitSettings.enabled}
            habitNotificationSettings={habitWorkspace.habitSettings.notifications}
            habitFeedbackSettings={habitWorkspace.habitSettings.feedback}
            notificationPermission={habitNotificationPermissionState}
            onRequestHabitNotifications={async () => {
              const permission = await requestHabitNotificationPermission();
              setHabitNotificationPermissionState(permission);
              return permission;
            }}
            onHabitNotificationSettingsChange={(notifications) => {
              if (habitWorkspace.habitSettings.notifications.enabled && !notifications.enabled) recordHabitNotificationsDisabled();
              updateHabitWorkspace({ ...habitWorkspace, habitSettings: { ...habitWorkspace.habitSettings, notifications } });
            }}
            onHabitFeedbackSettingsChange={(feedback) => {
              updateHabitWorkspace({ ...habitWorkspace, habitSettings: { ...habitWorkspace.habitSettings, feedback } });
            }}
            hiddenHabitTemplateCount={habitWorkspace.hiddenDefaultTemplates.length}
            onRestoreHabitTemplates={() => updateHabitWorkspace({ ...habitWorkspace, hiddenDefaultTemplates: [] })}
            onResetHabitTracking={resetAllHabitTracking}
            onHabitTrackingChange={(enabled) => {
              updateHabitWorkspace({ ...habitWorkspace, habitSettings: { ...habitWorkspace.habitSettings, enabled } });
              if (!enabled && view === "habits") navigateTo("today");
            }}
            onUserChange={(user) => {
              const nextLanguage = normalizeLanguage(user.language);
              setLanguage(nextLanguage);
              storeLanguage(nextLanguage);
              setCloudUser(user);
              const nextTaskCalendarMode = user.taskCalendarMode ?? "sacred";
              setTaskRecurrenceConfig((current) => alignRecurrenceConfigWithCalendar(current, nextTaskCalendarMode, newTaskDueDate));
              if (!privateDeviceAccessBlocked()) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
            }}
          />
        </Suspense>
      ) : null}
      {cloudUser?.authProvider === "yandex" && !cloudUser.calendarConnected && !workspaceRecoveryRequest && !accountOpen && yandexConnectPromptUserId === cloudUser.uid ? (
        <YandexCalendarConnectDialog
          user={cloudUser}
          onClose={() => setYandexConnectPromptUserId(null)}
        />
      ) : null}
      {voiceLanguageEnabled && voiceAssistantOpen ? (
        <Suspense fallback={<DeferredDialogFallback label={language === "en" ? "Opening voice assistant…" : "Открываем голосового помощника…"} />}><LocalVoiceAssistant
          language={language}
          neuralAvailable={assistantStatus.available}
          neuralProvider={assistantStatus.provider}
          context={{
            language,
            calendarMode: activeTaskCalendarMode,
            today: todayDateValue,
            timeZone: deviceTimeZone,
            categories: categories.map((category) => ({ name: localizeCategoryName(category, language) })),
            projects: projects.map((project) => ({
              title: project.title,
              parent: projects.find((candidate) => candidate.id === project.parentId)?.title ?? "",
              category: categories.find((category) => category.id === project.categoryId)?.name ?? "",
            })),
            taskLists: taskLists.map((taskList) => ({
              title: taskList.title,
              accountEmail: taskList.accountEmail ?? "",
            })),
            accounts: googleAccounts.map((account) => ({ email: account.email })),
          }}
          onApply={applyAssistantPlan}
          onStartControl={() => { setVoiceAssistantOpen(false); setVoiceControlActive(true); }}
          onClose={() => setVoiceAssistantOpen(false)}
        /></Suspense>
      ) : null}
      {voiceLanguageEnabled && geminiOpen && assistantStatus.audioAvailable ? (
        <Suspense fallback={<DeferredDialogFallback label={language === "en" ? "Opening assistant…" : "Открываем помощника…"} />}><GeminiAssistant
          language={language}
          provider={assistantStatus.provider === "gemini" ? "gemini" : "gigachat"}
          context={{
            language,
            calendarMode: activeTaskCalendarMode,
            today: todayDateValue,
            timeZone: deviceTimeZone,
            categories: categories.map((category) => ({ name: localizeCategoryName(category, language) })),
            projects: projects.map((project) => ({
              title: project.title,
              parent: projects.find((candidate) => candidate.id === project.parentId)?.title ?? "",
              category: categories.find((category) => category.id === project.categoryId)?.name ?? "",
            })),
            taskLists: taskLists.map((taskList) => ({
              title: taskList.title,
              accountEmail: taskList.accountEmail ?? "",
            })),
            accounts: googleAccounts.map((account) => ({ email: account.email })),
          }}
          onApply={applyAssistantPlan}
          onStartControl={() => { setGeminiOpen(false); setVoiceControlActive(true); }}
          onClose={() => setGeminiOpen(false)}
        /></Suspense>
      ) : null}
      {voiceLanguageEnabled && voiceControlActive ? <Suspense fallback={null}><WebVoiceControl language={language} onCommand={executeWebVoiceCommand} onStop={() => setVoiceControlActive(false)} /></Suspense> : null}
    </main>
    </DiaryProvider>
    </SacredFeaturesContext>
    </SharedUpdatesProvider>
    </TimeClockFormatContext.Provider>
    </FeatureAccessContext>
  );
}
