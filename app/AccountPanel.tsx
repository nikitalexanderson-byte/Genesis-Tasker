"use client";

import {DreamJournalSettings} from './DreamJournalSettings';
import { DonationLink } from "./DonationLink";
import release319Copy from "./release-319-copy.json";
import { BillingPanel } from './BillingPanel';
import { BackupPanel } from './BackupPanel';
import { GoogleIdentityPanel } from './AccountSecurityPanels';
import {UpgradeButton,isFreeBillingUser} from './UpgradeUI';
import {BillingTrialStatus} from './BillingTrialStatus';
import { DialogCloseButton } from "./DialogCloseButton";
import { AdvicePrivacyNotice, DailyAdviceSettings } from "./DailyAdviceSettings";
import { SharedNotificationPreferencesDialog } from "./SharedNotificationPreferences";
import habitFeedbackCopy from "./habit-feedback-copy.json";
import { HabitFeedbackSoundSettings } from "./HabitFeedbackSoundSettings";
import { HabitReminderSettings } from "./HabitReminderSettings";
import { sharedNotificationLabel } from "./notification-settings-model";
/* eslint-disable @next/next/no-img-element -- Google profile pictures are remote OAuth assets. */

import { useEffect, useRef, useState } from "react";
import type { CalendarMode } from "./calendar-data";
import type { GenesisCategory, GenesisUser, SharedInvitation, SharedNotification, SyncRouting } from "./cloud-sync";
import { acceptSharedInvitation, deleteGenesisAccount, disconnectGoogleServices, listSharedInvitations, listSharedNotifications, readSharedNotifications, rejectSharedInvitation, removeAdditionalGoogleAccount, updateAccountPreferences, recordFeatureUsage } from "./cloud-sync";
import { LANGUAGES, LANGUAGE_LABELS, localizeCategoryName, runtimeLocale, translateText, type Language } from "./i18n";

import type { TimeFormat } from "./time-format";
import { TimeClockPicker } from "./TimeClockPicker";
import type { HabitNotificationPermission, HabitNotificationSettings } from "./habit-notifications";
import type { HabitFeedbackSettings } from "./habit-feedback";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { MoonReminderSettings } from "./MoonReminderSettings";
import { SolarPlaceSettings } from "./SolarPlaceSettings";
import { WeatherDisplaySettings } from "./WeatherDisplaySettings";
import { SETTINGS_SECTIONS, SettingsSectionIcon, type SettingsSectionId } from "./SettingsSectionIcon";
import { uiVisibility, visibleCalendarMode, visibleCalendarModes, type UiVisibility } from "./ui-visibility";
import {
  type GenesisTheme,
  type ThemeControllerState,
} from "./theme-controller";
import { withThemeColorMode } from "./web-theme";
import { subscriptionName } from "./subscription-name";
import { DARK_PALETTES, effectiveDarkPalette, type DarkPalette } from "./dark-palettes";
import { featureAllowed } from "./feature-access";
import paletteCopy from "./dark-palette-copy.json";

const COLOR_MODE_NAMES: Record<Language, { light: string; dark: string; group: string }> = {
  ru: { light: "Светлая", dark: "Тёмная", group: "Цветовая схема сайта" },
  en: { light: "Light", dark: "Dark", group: "Website color scheme" },
  el: { light: "Φωτεινή", dark: "Σκοτεινή", group: "Χρωματικό θέμα ιστότοπου" },
  de: { light: "Hell", dark: "Dunkel", group: "Farbschema der Website" },
  fr: { light: "Clair", dark: "Sombre", group: "Thème de couleurs du site" },
  es: { light: "Claro", dark: "Oscuro", group: "Tema de color del sitio" },
  it: { light: "Chiaro", dark: "Scuro", group: "Tema colori del sito" },
  pt: { light: "Claro", dark: "Escuro", group: "Tema de cores do site" },
  pl: { light: "Jasny", dark: "Ciemny", group: "Motyw kolorystyczny strony" },
  sr: { light: "Светла", dark: "Тамна", group: "Шема боја сајта" },
  uk: { light: "Світла", dark: "Темна", group: "Колірна схема сайту" },
  zh: { light: "浅色", dark: "深色", group: "网站配色" },
  tr: { light: "Açık", dark: "Koyu", group: "Web sitesi renk teması" },
  ja: { light: "ライト", dark: "ダーク", group: "サイトの配色" },
};
const APP_BASE = (process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim() || "").replace(/\/$/, "");
const FLAG_COUNTRIES: Record<Language, string> = {
  ru: "ru", en: "gb", el: "gr", de: "de", fr: "fr", es: "es", it: "it", pt: "pt",
  pl: "pl", sr: "rs", uk: "ua", zh: "cn", tr: "tr", ja: "jp",
};
const MENU_SETTINGS = [
  ["projects", "Дела", "Affairs"],
  ["calendar", "Календарь", "Calendar"], ["habits", "Привычки", "Habits"],
  ["sacred", "Оракул", "Oracle"],
] as const;
const SUBMENU_SETTINGS = [
  ["projects.personal", "Личные проекты", "Personal projects"], ["projects.shared", "Общие дела", "Shared affairs"],
  ["calendar.month", "Месяц", "Month"], ["calendar.year", "Круг года", "Year Wheel"],
  ["habits.habits", "Привычки", "Habits"], ["habits.sleep", "Сон и настроение", "Sleep and mood"],
] as const;
const TODAY_SETTINGS = [
  ["rhythm", "Ритм дня", "Daily rhythm"], ["quickCreate", "Быстрое создание", "Quick create"],
  ["tasks", "Задачи на сегодня", "Today's tasks"], ["habits", "Привычки дня", "Daily habits"],
  ["details", "Подробности дня", "Day details"],
] as const;

type AccountPanelProps = {
  onOpenPhysis?: () => void;
  user: GenesisUser;
  guideSharedProjects?: boolean;
  guideSolarPlace?: boolean;
  onClose: () => void;
  onSignOut: () => Promise<void>;
  onReconnectGoogle: () => void;
  onConnectAdditionalGoogle: () => void;
  onLanguageChange: (language: Language) => void;
  onUserChange: (user: GenesisUser) => void;
  themeState: ThemeControllerState;
  onThemeChange: (theme: GenesisTheme) => void;
  habitTrackingEnabled: boolean;
  onHabitTrackingChange: (enabled: boolean) => void;
  habitNotificationSettings: HabitNotificationSettings;
  notificationPermission: HabitNotificationPermission;
  onHabitNotificationSettingsChange: (settings: HabitNotificationSettings) => void;
  habitFeedbackSettings: HabitFeedbackSettings;
  onHabitFeedbackSettingsChange: (settings: HabitFeedbackSettings) => void;
  onRequestHabitNotifications: () => Promise<HabitNotificationPermission>;
  hiddenHabitTemplateCount: number;
  onRestoreHabitTemplates: () => void;
  onResetHabitTracking: () => Promise<void>;
  onExportCalendar: () => void;
  calendarExportAvailable: boolean;
  categories: GenesisCategory[];
};

const CALENDAR_MODES: Array<{ id: CalendarMode; label: string; hint: string }> = [
  { id: "sacred", label: "Сакральный", hint: "Месяцы, пяты и дни GENESIS" },
  { id: "lunar", label: "Лунный", hint: "Лунные месяцы и дни" },
  { id: "profane", label: "Григорианский", hint: "Обычные даты, недели и 12 месяцев" },
];

const TIME_FORMATS: Array<{ id: TimeFormat; label: string; example: string }> = [
  { id: "24h", label: "24 часа", example: "13:30" },
  { id: "12h", label: "AM / PM", example: "01:30 PM" },
];

type HabitResetChallenge = {
  left: number;
  right: number;
  operator: "+" | "−" | "×";
  answer: number;
};

function createHabitResetChallenge(): HabitResetChallenge {
  const entropy = new Uint32Array(3);
  window.crypto.getRandomValues(entropy);
  const operator = (["+", "−", "×"] as const)[entropy[0] % 3];
  const first = 2 + (entropy[1] % 11);
  const second = 2 + (entropy[2] % 11);
  if (operator === "−") {
    const left = Math.max(first, second);
    const right = Math.min(first, second);
    return { left, right, operator, answer: left - right };
  }
  return {
    left: first,
    right: second,
    operator,
    answer: operator === "+" ? first + second : first * second,
  };
}

export function AccountPanel({ user, onOpenPhysis, guideSharedProjects = false, guideSolarPlace = false, onClose, onSignOut, onReconnectGoogle, onConnectAdditionalGoogle, onLanguageChange, onUserChange, themeState, onThemeChange, habitTrackingEnabled, onHabitTrackingChange, habitNotificationSettings, notificationPermission, onHabitNotificationSettingsChange, habitFeedbackSettings, onHabitFeedbackSettingsChange, onRequestHabitNotifications, hiddenHabitTemplateCount, onRestoreHabitTemplates, onResetHabitTracking, onExportCalendar, calendarExportAvailable, categories }: AccountPanelProps) {
  const [sharedNotificationSettingsOpen,setSharedNotificationSettingsOpen]=useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<UiVisibility | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [invitations, setInvitations] = useState<SharedInvitation[]>([]);
  const [teamNotifications, setTeamNotifications] = useState<SharedNotification[]>([]);
  const [teamReadBusy, setTeamReadBusy] = useState(false);
  const [invitationBusy, setInvitationBusy] = useState("");
  const [invitationMessage, setInvitationMessage] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsSectionId>(guideSolarPlace ? "region" : guideSharedProjects ? "shared" : "appearance");
  const [sharedGuideVisible, setSharedGuideVisible] = useState(guideSharedProjects);
  const sharedProjectsToggleRef = useRef<HTMLInputElement>(null);
  const settingsTouch = useRef<{ x: number; y: number } | null>(null);
  const [habitResetChallenge, setHabitResetChallenge] = useState<HabitResetChallenge | null>(null);
  const [habitResetAnswer, setHabitResetAnswer] = useState("");
  const [habitResetBusy, setHabitResetBusy] = useState(false);
  const [habitResetError, setHabitResetError] = useState("");
  const habitResetInputRef = useRef<HTMLInputElement>(null);
  const [routing, setRouting] = useState<SyncRouting>(() => user.syncRouting ?? {
    mode: "fixed",
    defaultAccountIds: [user.uid],
    categoryAccountIds: {},
  });

  useEffect(() => {
    document.documentElement.dataset.genesisMenuLabels = "text";
    try {
      window.localStorage.setItem("genesis-menu-labels", "text");
      window.localStorage.setItem("genesis-settings-menu-labels", "text");
    } catch { /* Labels stay visible when browser storage is unavailable. */ }
  }, []);
  const selectedSettings = SETTINGS_SECTIONS.find((item) => item.id === settingsTab) ?? SETTINGS_SECTIONS[0];
  useEffect(() => {
    if (user.uid) void recordFeatureUsage(["menu.settings", `submenu.settings.${settingsTab}`])
      .catch(() => undefined);
  }, [user.uid, settingsTab]);
  const onSettingsTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = settingsTouch.current;
    settingsTouch.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 75 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const index = SETTINGS_SECTIONS.findIndex((item) => item.id === settingsTab);
    const next = SETTINGS_SECTIONS[index + (dx < 0 ? 1 : -1)];
    if (next) setSettingsTab(next.id);
  };

  useEffect(() => {
    if (!user.sharedProjectsEligible) { return; }
    let live = true;
    const refresh = () => { void listSharedInvitations().then((rows) => {
      if (live) setInvitations(rows);
    }).catch((error: unknown) => {
      if (live) setInvitationMessage(error instanceof Error ? error.message : String(error));
    }); };
    const refreshTeam = () => { if (!user.sharedProjectsEnabled) return; void listSharedNotifications().then((rows) => {
      if (live) setTeamNotifications(rows);
    }).catch(() => undefined); };
    refresh();
    refreshTeam();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") { refresh(); refreshTeam(); }
    }, 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, [user.sharedProjectsEligible, user.sharedProjectsEnabled]);

  const respondToInvitation = async (id: string, accept: boolean) => {
    setInvitationBusy(id); setInvitationMessage("");
    try {
      if (accept) {
        await acceptSharedInvitation(id);
        const result = await updateAccountPreferences({ sharedProjectsEnabled: true });
        onUserChange(result.user);
      }
      else await rejectSharedInvitation(id);
      setInvitations((rows) => rows.filter((item) => item.id !== id));
      setInvitationMessage(user.language === "en"
        ? (accept ? "Invitation accepted." : "Invitation declined.")
        : (accept ? "Приглашение принято." : "Приглашение отклонено."));
    } catch (error) {
      setInvitationMessage(error instanceof Error ? error.message : String(error));
    } finally { setInvitationBusy(""); }
  };
  const markTeamRead = async (ids: string[]) => {
    setTeamReadBusy(true);
    try {
      await readSharedNotifications(ids);
      setTeamNotifications((rows) => rows.map((item) => ids.includes(item.id) ? { ...item, isRead: 1 } : item));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setTeamReadBusy(false); }
  };
  const visibility = uiVisibility(pendingVisibility ?? user.uiVisibility);
  const updateVisibility = async (next: UiVisibility) => {
    setPendingVisibility(next); setPreferenceBusy(true); setMessage("");
    try {
      const result = await updateAccountPreferences({ uiVisibility: next });
      const saved = uiVisibility(result.user.uiVisibility);
      const fields = ["hiddenMenuItems", "hiddenSubmenus", "hiddenTodayBlocks", "enabledCalendars"] as const;
      const scalarFields = ["sacredFeaturesEnabled", "dreamJournalEnabled", "sidebarAutoCollapseSeconds", "sidebarWidth", "personalInboxPosition", "personalInboxHidden", "personalInboxCompact", "sharedInboxPosition", "sharedInboxHidden", "sharedInboxCompact"] as const;
      if (scalarFields.some(field => next[field] !== saved[field]) || fields.some((field) => next[field].length !== saved[field].length ||
        next[field].some((item) => !(saved[field] as string[]).includes(item)))) {
        throw new Error(user.language === "en"
          ? "The server has not saved this setting yet. Please update GENESIS and try again."
          : "Сервер ещё не сохранил эту настройку. Обновите GENESIS и повторите.");
      }
      onUserChange(result.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setPendingVisibility(null); setPreferenceBusy(false); }
  };
  const toggleVisibilityItem = (field: "hiddenMenuItems" | "hiddenSubmenus" | "hiddenTodayBlocks",
    id: string, visible: boolean) => {
    const next = { ...visibility, [field]: visible
      ? visibility[field].filter((item) => item !== id)
      : [...visibility[field], id] };
    void updateVisibility(next);
  };

  useEffect(() => {
    if (!habitResetChallenge) return;
    const frame = window.requestAnimationFrame(() => habitResetInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [habitResetChallenge]);

  const changeDivinationPreference = async (disabled: boolean) => {
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ stoicheionDivinationDisabled: disabled });
      onUserChange(result.user);
      setMessage(disabled
        ? "Гадания отключены. В Стойхейоне остались только карты и их значения."
        : "Гадания снова доступны в Стойхейоне.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройку гаданий.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const changeSharedProjectsPreference = async (enabled: boolean) => {
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ sharedProjectsEnabled: enabled });
      onUserChange(result.user);
      setMessage(user.language === "en" ? "Shared affairs setting saved." : "Настройка общих дел сохранена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : user.language === "en" ? "Could not save setting." : "Не удалось сохранить настройку.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const changeCalendarMode = async (calendarMode: CalendarMode) => {
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ calendarMode });
      onUserChange(result.user);
      const calendarLabel = CALENDAR_MODES.find((item) => item.id === calendarMode)?.label ?? "";
      setMessage(user.language === "en"
        ? `Primary calendar changed to ${translateText(calendarLabel, "en").toLocaleLowerCase(runtimeLocale())}.`
        : `Основной календарь переключён: ${calendarLabel.toLocaleLowerCase(runtimeLocale())}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось переключить календарь.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const changeTaskCalendarMode = async (taskCalendarMode: CalendarMode) => {
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ taskCalendarMode });
      onUserChange(result.user);
      const calendarLabel = CALENDAR_MODES.find((item) => item.id === taskCalendarMode)?.label ?? "";
      setMessage(user.language === "en"
        ? `Task scheduling calendar changed to ${translateText(calendarLabel, "en").toLocaleLowerCase(runtimeLocale())}.`
        : `Календарь постановки задач переключён: ${calendarLabel.toLocaleLowerCase(runtimeLocale())}.`);
    } catch (error) {
      setMessage(error instanceof Error
        ? translateText(error.message, user.language, true)
        : user.language === "en" ? "Could not change the task scheduling calendar." : "Не удалось переключить календарь постановки задач.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const changeLanguage = async (language: Language) => {
    if (user.language === language) return;
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ language });
      onUserChange(result.user);
      onLanguageChange(language);
      setMessage(language === "ru" ? "Язык переключён на русский." : `Language changed to ${LANGUAGE_LABELS[language].name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось переключить язык.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const changeTimeFormat = async (timeFormat: TimeFormat) => {
    if ((user.timeFormat ?? "24h") === timeFormat) return;
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ timeFormat });
      onUserChange(result.user);
      setMessage(timeFormat === "12h" ? "Включён формат времени AM / PM." : "Включён 24-часовой формат времени.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось переключить формат времени.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const changeWeekStart = async (weekStart: "sunday" | "monday") => {
    if ((user.weekStart ?? "sunday") === weekStart) return;
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ weekStart });
      onUserChange(result.user);
      setMessage(weekStart === "monday"
        ? "Григорианская неделя начинается с понедельника."
        : "Григорианская неделя начинается с воскресенья.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось изменить начало недели.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const changeGregorianYearStart = async (gregorianYearStart: "january" | "march") => {
    if ((user.gregorianYearStart ?? "january") === gregorianYearStart) return;
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ gregorianYearStart });
      onUserChange(result.user);
      setMessage(gregorianYearStart === "march"
        ? "Григорианский год теперь показывается с марта по февраль."
        : "Григорианский год теперь показывается с января по декабрь.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось изменить начало года.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const themeStatusMessage = themeState.status === "saving"
    ? (user.language === "en" ? "Saving the account preference…" : "Сохраняем выбор в аккаунте…")
    : themeState.status === "error"
      ? themeState.error === "conflict"
        ? (user.language === "en" ? "The selected theme is active on this device. Account synchronization will retry automatically." : "Выбранная тема активна на этом устройстве. Синхронизация с аккаунтом повторится автоматически.")
        : (user.language === "en" ? "The selected theme is active on this device but is not synced yet. Saving will retry automatically." : "Выбранная тема активна на этом устройстве, но пока не синхронизирована. Сохранение повторится автоматически.")
      : themeState.status === "unavailable"
        ? (user.language === "en" ? "The account theme could not be loaded. Standart remains active." : "Не удалось загрузить тему аккаунта. Продолжает работать Standart.")
        : themeState.status === "load-error"
          ? (user.language === "en" ? "The account theme could not be loaded. Standart remains active." : "Не удалось загрузить тему аккаунта. Продолжает работать Standart.")
        : themeState.status === "loading"
            ? (user.language === "en" ? "Loading the account preference…" : "Загружаем настройку аккаунта…")
        : "";

  const toggleHabitNotifications = async (enabled: boolean) => {
    if (!enabled) {
      onHabitNotificationSettingsChange({ ...habitNotificationSettings, enabled: false });
      setMessage(user.language === "en" ? "Habit notifications are disabled on this device." : "Уведомления привычек отключены на этом устройстве.");
      return;
    }
    setNotificationBusy(true);
    setMessage("");
    try {
      const permission = await onRequestHabitNotifications();
      if (permission === "granted") {
        onHabitNotificationSettingsChange({ ...habitNotificationSettings, enabled: true });
        setMessage(user.language === "en" ? "Smart habit notifications are enabled." : "Умные уведомления привычек включены.");
      } else if (permission === "unsupported") {
        setMessage(user.language === "en" ? "This browser does not support device notifications." : "Этот браузер не поддерживает уведомления устройства.");
      } else {
        setMessage(user.language === "en" ? "Notification permission was not granted. You can allow it in the browser settings." : "Разрешение на уведомления не выдано. Его можно включить в настройках браузера.");
      }
    } finally {
      setNotificationBusy(false);
    }
  };

  const saveRouting = async () => {
    setPreferenceBusy(true);
    setMessage("");
    try {
      const result = await updateAccountPreferences({ syncRouting: routing });
      onUserChange(result.user);
      setRouting(result.user.syncRouting);
      setMessage("Маршрутизация задач по Google-аккаунтам сохранена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить маршрутизацию.");
    } finally {
      setPreferenceBusy(false);
    }
  };

  const removeAdditionalAccount = async (accountId: string) => {
    if (!window.confirm(translateText("Отключить дополнительный Google-аккаунт от пространства GENESIS? Уже созданные события и задачи останутся в Google.", undefined, true))) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await removeAdditionalGoogleAccount(accountId);
      onUserChange(result.user);
      setRouting((current) => ({
        ...current,
        defaultAccountIds: current.defaultAccountIds.filter((id) => id !== accountId),
        categoryAccountIds: Object.fromEntries(Object.entries(current.categoryAccountIds).map(([categoryId, ids]) => [categoryId, ids.filter((id) => id !== accountId)])),
      }));
      setMessage("Дополнительный Google-аккаунт отключён.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отключить дополнительный аккаунт.");
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    const confirmation = "Безвозвратно удалить аккаунт GENESIS и все относящиеся к нему данные с сервера? Будут удалены профиль, зашифрованное пространство, привычки, статистика, расклады и привязки аккаунтов. Разрешения Google будут отозваны. Уже созданные события и списки задач останутся в вашем Google-аккаунте.";
    if (!window.confirm(translateText(confirmation, undefined, true))) return;
    setBusy(true);
    try {
      await deleteGenesisAccount(user.uid);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось удалить аккаунт.");
      setBusy(false);
    }
  };

  const disconnectServices = async () => {
    if (!window.confirm(translateText("Отключить Google Calendar и Google Tasks? GENESIS отзовёт разрешения Google. Ваши события, списки и задачи останутся в Google.", undefined, true))) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await disconnectGoogleServices();
      onUserChange(result.user);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отключить Google Calendar и Tasks.");
    } finally {
      setBusy(false);
    }
  };

  const openHabitReset = () => {
    setHabitResetChallenge(createHabitResetChallenge());
    setHabitResetAnswer("");
    setHabitResetError("");
  };

  const closeHabitReset = () => {
    if (habitResetBusy) return;
    setHabitResetChallenge(null);
    setHabitResetAnswer("");
    setHabitResetError("");
  };

  const confirmHabitReset = async () => {
    if (!habitResetChallenge || habitResetAnswer.trim() === "" || Number(habitResetAnswer) !== habitResetChallenge.answer) return;
    setHabitResetBusy(true);
    setHabitResetError("");
    try {
      await onResetHabitTracking();
      setHabitResetChallenge(null);
      setHabitResetAnswer("");
      setMessage(user.language === "en"
        ? "All habit tracking data and statistics have been reset."
        : "Все привычки и их статистика обнулены.");
    } catch (error) {
      setHabitResetError(error instanceof Error
        ? error.message
        : user.language === "en" ? "Habit data could not be reset." : "Не удалось обнулить данные привычек.");
    } finally {
      setHabitResetBusy(false);
    }
  };

  const accountDialogRef = useDialogAccessibility<HTMLElement>(onClose);
  const habitResetDialogRef = useDialogAccessibility<HTMLFormElement>(closeHabitReset, Boolean(habitResetChallenge));

  useEffect(() => {
    if (!guideSharedProjects) return;
    const timer = window.setTimeout(() => setSharedGuideVisible(false), 5_000);
    const frame = window.requestAnimationFrame(() => {
      sharedProjectsToggleRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
    });
    return () => { window.clearTimeout(timer); window.cancelAnimationFrame(frame); };
  }, [guideSharedProjects]);

  const sharedGuideActive = sharedGuideVisible && settingsTab === "shared" && user.sharedProjectsEligible && !user.sharedProjectsEnabled;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={accountDialogRef} className="account-panel" data-exp-layout="view" data-exp-ui="dialog"
        data-settings-active={settingsTab} role="dialog" aria-modal="true" aria-labelledby="account-title" tabIndex={-1}
        onTouchStart={(event) => { settingsTouch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
        onTouchEnd={onSettingsTouchEnd}>
        <DialogCloseButton type="button" className="modal-close" onClick={onClose} aria-label="Закрыть" />
        <span className="eyebrow">Личный кабинет</span>
        <small className="account-release-version" data-no-translate>3.2.8</small>
        <h2 id="account-title">{user.displayName || "Аккаунт GENESIS"}</h2>
        <div className="account-profile-details">
          <div className="account-profile-summary">
            <p className="account-email">{user.email}</p>
            <p className="account-plan" data-no-translate>{translateText("Ваш тариф: {plan}", user.language, true).replace("{plan}", subscriptionName(user.subscriptionPlan))}</p>
          </div>
          <div className="account-plan-upgrade"><UpgradeButton language={user.language} compare={!isFreeBillingUser(user)}/></div>
        </div>
        <BillingTrialStatus user={user} compact/>

        <nav className="settings-section-nav"
          aria-label={user.language === "en" ? "Settings sections" : "Разделы настроек"}>
          {SETTINGS_SECTIONS.map((item) => <button key={item.id} type="button"
            data-settings-tab={item.id} aria-current={settingsTab === item.id ? "page" : undefined}
            className={`personal-action-hint${settingsTab === item.id ? " active" : ""}`} onClick={() => setSettingsTab(item.id)}
            data-action-hint={user.language === "en" ? item.en : item.ru}
            title={user.language === "en" ? item.en : item.ru}
            aria-label={user.language === "en" ? item.en : item.ru}>
            <SettingsSectionIcon section={item.id} />
          </button>)}
        </nav>
        <div className="settings-section-hero" data-settings-hero={settingsTab}>
          <span className="settings-section-hero-icon"><SettingsSectionIcon section={settingsTab} /></span>
          <div><h3>{user.language === "en" ? "Settings" : "Настройки"} - {user.language === "en" ? selectedSettings.en : selectedSettings.ru}</h3>
            <p>{user.language === "en" ? selectedSettings.descriptionEn : selectedSettings.descriptionRu}</p></div>
        </div>

        {settingsTab==='account'?<BillingPanel user={user}/>:null}
        {settingsTab==='backups'?<BackupPanel key={`backups:${user.uid}`} user={user}/>:null}
        {settingsTab==='account'&&user.authProvider==='google'?<GoogleIdentityPanel key={`identities:${user.uid}`} user={user}/>:null}
        <div className="account-security-grid" data-settings-group="account">
          <article><span>Google-сервисы</span><strong>{user.calendarConnected && user.googleTasksImportReady ? "Подключены" : "По желанию"}</strong><small>Calendar и Tasks подключаются отдельным согласием после входа.</small></article>
          <article><span>Личные данные</span><strong>Зашифрованы</strong><small>AES-GCM в браузере; ключ хранится на сервере отдельно и зашифрован для автоматического входа.</small></article>
          <article><span>Офлайн-копия</span><strong>На устройстве</strong><small>Доступна без сети после входа на этом устройстве.</small></article>
        </div>

        <section className="account-preferences" data-settings-group="account" aria-labelledby="calendar-export-title" data-exp-ui="panel">
          {onOpenPhysis ? <div className="account-physis-settings"><h3>Фюзис</h3><p>Питание, единицы, давление, сахар, другие показатели и защита личных данных.</p><button type="button" onClick={onOpenPhysis}>Открыть настройки Фюзиса</button></div> : null}
          <h3 id="calendar-export-title">{translateText("Экспорт календаря .ics", user.language)}</h3>
          <p>{translateText("Скачайте задачи и встречи для переноса в другой календарь.", user.language)}</p>
          <button type="button" className="secondary-button" disabled={!calendarExportAvailable} onClick={onExportCalendar}>
            <span className="ux-calendar-icon" aria-hidden="true" />
            {translateText("Экспортировать календарь .ics", user.language)}
          </button>
          {!calendarExportAvailable ? <small>{translateText("Добавьте задачу для экспорта", user.language)}</small> : null}
        </section>

        {user.authProvider === "google" && !user.googleTasksImportReady ? (
          <section className="account-sync-upgrade" aria-label="Синхронизация Google Tasks" data-settings-group="account">
            <div>
              <strong>Подключите Google Calendar и Google Tasks</strong>
              <small>После вашего подтверждения GENESIS создаст отдельный календарь и сможет показывать и изменять списки Google Tasks. Доступ нужен только для функций синхронизации.</small>
            </div>
            <button type="button" onClick={onReconnectGoogle}>Подключить</button>
          </section>
        ) : null}

        <div className="appearance-settings-stack" data-settings-group="appearance">
          <section className="appearance-settings-subsection sacred-features-setting" aria-labelledby="sacred-features-title">
            <label className="account-switch-row" data-exp-ui="row"><span id="sacred-features-title">{translateText("Сакральные функции",user.language)}</span>
              <input type="checkbox" role="switch" aria-label={translateText("Сакральные функции",user.language)} checked={visibility.sacredFeaturesEnabled} disabled={preferenceBusy}
                onChange={event=>void updateVisibility({...visibility,sacredFeaturesEnabled:event.target.checked})}/><i aria-hidden="true"/>
            </label>
            <p>{translateText("Оракул, сакральный календарь и практики. Отключение скрывает эти функции, сохраняя ваши задачи, привычки и настройки.",user.language)}</p>
          </section>
          <div className="appearance-settings-subsection" role="group"
            aria-label={COLOR_MODE_NAMES[user.language].group}>
            <h4>{COLOR_MODE_NAMES[user.language].group}</h4>
            <div className="language-choice experimental-color-choice" role="radiogroup" aria-label={COLOR_MODE_NAMES[user.language].group}>
              <button type="button" role="radio" aria-checked={!themeState.theme.endsWith("-dark")}
                aria-label={COLOR_MODE_NAMES[user.language].light}
                className={!themeState.theme.endsWith("-dark") ? "active" : ""}
                disabled={!themeState.available || themeState.pending || ["signed-out", "loading", "load-error"].includes(themeState.status)} onClick={() => onThemeChange(withThemeColorMode(themeState.theme, false))}>
                <span aria-hidden="true">☀</span><strong data-no-translate>{COLOR_MODE_NAMES[user.language].light}</strong>
              </button>
              <button type="button" role="radio" aria-checked={themeState.theme.endsWith("-dark")}
                aria-label={COLOR_MODE_NAMES[user.language].dark}
                className={themeState.theme.endsWith("-dark") ? "active" : ""}
                disabled={!themeState.available || themeState.pending || ["signed-out", "loading", "load-error"].includes(themeState.status)} onClick={() => onThemeChange(withThemeColorMode(themeState.theme, true))}>
                <span aria-hidden="true">☾</span><strong data-no-translate>{COLOR_MODE_NAMES[user.language].dark}</strong>
              </button>
            </div>
          <label className="dark-palette-setting">
            <span>{paletteCopy[user.language].label}</span>
            <select value={effectiveDarkPalette(user.darkPalette, user.featureAccess)} disabled={preferenceBusy}
              onChange={event => { const darkPalette = event.target.value as DarkPalette; setPreferenceBusy(true); setMessage("");
                void updateAccountPreferences({ darkPalette }).then(result => onUserChange(result.user))
                  .catch(() => setMessage(paletteCopy[user.language].error)).finally(() => setPreferenceBusy(false)); }}>
              {DARK_PALETTES.map(palette => <option key={palette} value={palette}
                disabled={palette !== "green" && !featureAllowed(user.featureAccess, "dark-palettes", undefined, true)}>{paletteCopy[user.language][palette === "blue" && !themeState.theme.endsWith("-dark") ? "blueLight" : palette]}</option>)}
            </select>
            {!featureAllowed(user.featureAccess, "dark-palettes", undefined, true) ? <small>{paletteCopy[user.language].premium}</small> : null}
          </label>
          {themeStatusMessage ? <p className="account-preference-status" role="status" aria-live="polite" data-exp-ui="notice" data-exp-tone={themeState.status === "error" || themeState.status === "load-error" ? "error" : undefined}>
            {translateText(themeStatusMessage, user.language)}
          </p> : null}
          </div>
          <div className="appearance-settings-subsection appearance-menu-subsection" role="group"
            aria-label={user.language === "en" ? "Menu display" : "Отображение меню"}>
            <div className="appearance-menu-controls">
            <h4>{user.language === "en" ? "Menu display" : "Отображение меню"}</h4>
            </div>
            <label className="sidebar-auto-collapse-setting">
              <span>{user.language === "en" ? "Automatically collapse the sidebar" : "Автоматически сворачивать боковую панель"}</span>
              <input type="checkbox" checked={visibility.sidebarAutoCollapseSeconds > 0} disabled={preferenceBusy}
                onChange={event => void updateVisibility({ ...visibility, sidebarAutoCollapseSeconds: event.target.checked ? 15 : 0 })} />
            </label>
            <p className="sidebar-auto-collapse-hint">{translateText("Панель скрывается целиком после ухода указателя. Наведите на полосу у левого края или выберите её с клавиатуры, чтобы открыть меню поверх страницы. Ширина меняется только перетаскиванием границы.",user.language)}</p>
          <details className="appearance-menu-details">
            <summary><span className="appearance-summary-title">{user.language === "en" ? "Menu item display" : "Отображение элементов меню"}</span>
              <span className="appearance-summary-action appearance-summary-closed">{user.language === "en" ? "Customize menu items" : "Настроить элементы"}<SettingsDisclosureChevron /></span>
              <span className="appearance-summary-action appearance-summary-open">{user.language === "en" ? "Collapse" : "Свернуть"}<SettingsDisclosureChevron /></span>
            </summary>
            <p>{user.language === "en" ? "Menu items, submenus, Today and calendars" : "Пункты меню, подменю, экран «Сегодня» и календари"}</p>
          <div className="navigation-preference-grid">
            <fieldset><legend>{user.language === "en" ? "Main menu" : "Главное меню"}</legend>
              {MENU_SETTINGS.filter(([id])=>visibility.sacredFeaturesEnabled||id!=="sacred").map(([id, ru, en]) => <label key={id} className="account-switch-row" data-exp-ui="row">
                <span>{user.language === "en" ? en : ru}</span>
                <input type="checkbox" role="switch" checked={!visibility.hiddenMenuItems.includes(id)} disabled={preferenceBusy}
                  onChange={(event) => toggleVisibilityItem("hiddenMenuItems", id, event.target.checked)} />
                <i aria-hidden="true" />
              </label>)}
            </fieldset>
            <fieldset><legend>{user.language === "en" ? "Submenus" : "Подменю"}</legend>
              {SUBMENU_SETTINGS.filter(([id])=>visibility.sacredFeaturesEnabled||!id.startsWith("sacred.")).map(([id, ru, en]) => {
                const group = id.split(".")[0];
                const visibleSiblings = SUBMENU_SETTINGS.filter(([candidate]) => candidate.startsWith(`${group}.`) && !visibility.hiddenSubmenus.includes(candidate));
                const lastVisible = !visibility.hiddenSubmenus.includes(id) && visibleSiblings.length === 1;
                const personalRequired = id === "projects.personal" && !user.sharedProjectsEnabled;
                return <label key={id} className="account-switch-row" data-exp-ui="row">
                  <span>{user.language === "en" ? en : ru}</span>
                  <input type="checkbox" role="switch" checked={!visibility.hiddenSubmenus.includes(id)}
                    disabled={preferenceBusy || lastVisible || personalRequired}
                    onChange={(event) => toggleVisibilityItem("hiddenSubmenus", id, event.target.checked)} />
                  <i aria-hidden="true" />
                </label>;
              })}
            </fieldset>
            <fieldset><legend>{user.language === "en" ? "Today" : "Экран «Сегодня»"}</legend>
              {TODAY_SETTINGS.map(([id, ru, en]) => <label key={id} className="account-switch-row" data-exp-ui="row">
                <span>{user.language === "en" ? en : ru}</span>
                <input type="checkbox" role="switch" checked={!visibility.hiddenTodayBlocks.includes(id)} disabled={preferenceBusy}
                  onChange={(event) => toggleVisibilityItem("hiddenTodayBlocks", id, event.target.checked)} />
                <i aria-hidden="true" />
              </label>)}
            </fieldset>
            {visibility.sacredFeaturesEnabled ? <fieldset><legend>{user.language === "en" ? "Available calendars" : "Доступные календари"}</legend>
              {(["profane", "sacred", "lunar"] as CalendarMode[]).filter(mode=>visibility.sacredFeaturesEnabled||mode!=="sacred").map((mode) => <label key={mode} className="account-switch-row" data-exp-ui="row">
                <span>{mode === "profane" ? (user.language === "en" ? "Gregorian" : "Григорианский")
                  : mode === "sacred" ? (user.language === "en" ? "Sacred" : "Сакральный")
                    : (user.language === "en" ? "Lunar" : "Лунный")}</span>
                <input type="checkbox" role="switch" checked={visibility.enabledCalendars.includes(mode)}
                  disabled={preferenceBusy || (visibility.enabledCalendars.length === 1 && visibility.enabledCalendars.includes(mode))}
                  onChange={(event) => void updateVisibility({ ...visibility,
                    enabledCalendars: event.target.checked ? [...visibility.enabledCalendars, mode]
                      : visibility.enabledCalendars.filter((item) => item !== mode) })} />
                <i aria-hidden="true" />
              </label>)}
            </fieldset> : null}
          </div>
          </details>
          </div>
          <details className="appearance-menu-details appearance-language-details appearance-settings-subsection">
            <summary><span className="appearance-summary-title">{user.language === "en" ? "Interface language" : "Язык интерфейса"}</span>
              <span className="appearance-summary-action appearance-summary-closed">{user.language === "en" ? "Choose language" : "Выбрать язык"}<SettingsDisclosureChevron /></span>
              <span className="appearance-summary-action appearance-summary-open">{user.language === "en" ? "Collapse" : "Свернуть"}<SettingsDisclosureChevron /></span>
            </summary>
        <section className="account-preferences language-preference appearance-nested-preference" aria-labelledby="language-title" data-exp-ui="panel">
          <div>
            <span className="eyebrow">Язык</span>
            <h3 id="language-title">Интерфейс и справочные тексты</h3>
            <p>Выбор сохраняется в аккаунте и применяется на всех ваших устройствах.</p>
          </div>
          <div className="language-choice" role="radiogroup" aria-label="Язык интерфейса">
            {LANGUAGES.map((code) => (
              <button key={code} type="button" role="radio" aria-checked={user.language === code}
                aria-label={LANGUAGE_LABELS[code].name}
                className={user.language === code ? "active" : ""} disabled={preferenceBusy}
                onClick={() => void changeLanguage(code)} data-no-translate>
                <span className="language-flag" aria-hidden="true">
                  <img src={`${APP_BASE}/language-flags/${FLAG_COUNTRIES[code]}.svg`} alt="" />
                </span>
                <strong>{LANGUAGE_LABELS[code].name}</strong>
              </button>
            ))}
          </div>
        </section>

          </details>
          <div className="appearance-settings-subsection appearance-calendar-settings" role="group"
            aria-label={user.language === "en" ? "Calendars and time" : "Календари и время"}>
            <h4>{user.language === "en" ? "Calendars and time" : "Календари и время"}</h4>
        <section className="account-preferences appearance-nested-preference time-format-preference" aria-labelledby="time-format-title" data-exp-ui="panel">
          <div>
            <span className="eyebrow">Формат времени</span>
            <h3 id="time-format-title">Отображение часов</h3>
            <p>Настройка применяется к часам раздела «Сегодня», выбору времени задач и точным напоминаниям.</p>
          </div>
          <div className="language-choice time-format-choice" role="radiogroup" aria-label="Формат времени">
            {TIME_FORMATS.map((format) => (
              <button
                type="button"
                role="radio"
                aria-checked={(user.timeFormat ?? "24h") === format.id}
                className={(user.timeFormat ?? "24h") === format.id ? "active" : ""}
                disabled={preferenceBusy}
                onClick={() => void changeTimeFormat(format.id)}
                key={format.id}
              >
                <strong>{format.label}</strong>
                <small>{format.example}</small>
              </button>
            ))}
          </div>
        </section>

        {visibility.sacredFeaturesEnabled ? <section className="account-preferences appearance-nested-preference calendar-mode-preference" aria-labelledby="calendar-mode-title" data-exp-ui="panel">
          <div>
            <span className="eyebrow">Основной календарь</span>
            <h3 id="calendar-mode-title">Полное отображение и система дат</h3>
            {visibility.sacredFeaturesEnabled ? <p>Выбор полностью переключает разделы «Месяц» и «Круг года». Сакральный календарь используется по умолчанию; систему постановки задач можно выбрать отдельно для любого режима.</p> : null}
          </div>
          <div className="calendar-mode-segment" role="radiogroup" aria-label="Система дат">
            {CALENDAR_MODES.filter((mode) => visibleCalendarModes(visibility).includes(mode.id)).map((mode) => (
              <button
                type="button"
                role="radio"
                aria-checked={visibleCalendarMode(user.calendarMode ?? "sacred",visibility) === mode.id}
                className={visibleCalendarMode(user.calendarMode ?? "sacred",visibility) === mode.id ? "active" : ""}
                disabled={preferenceBusy}
                onClick={() => void changeCalendarMode(mode.id)}
                key={mode.id}
              >
                <strong>{mode.label}</strong>
                <small>{mode.hint}</small>
              </button>
            ))}
          </div>
        </section> : null}

        {visibleCalendarMode(user.calendarMode ?? "sacred", visibility) === "profane" ? (
          <section className="account-preferences appearance-nested-preference gregorian-year-preference" aria-labelledby="gregorian-year-start-title" data-exp-ui="panel">
            <div>
              <span className="eyebrow">Григорианский календарь</span>
              <h3 id="gregorian-year-start-title">Начало года</h3>
              <p>Выберите порядок месяцев в разделе «Круг года». Даты задач и повторений не меняются.</p>
            </div>
            <div className="language-choice gregorian-year-choice" role="radiogroup" aria-label="Начало григорианского года">
              {(["january", "march"] as const).map((yearStart) => (
                <button type="button" role="radio" key={yearStart}
                  aria-checked={(user.gregorianYearStart ?? "january") === yearStart}
                  className={(user.gregorianYearStart ?? "january") === yearStart ? "active" : ""}
                  disabled={preferenceBusy} onClick={() => void changeGregorianYearStart(yearStart)}>
                  <strong>{yearStart === "march" ? "С марта" : "С января"}</strong>
                  <small>{yearStart === "march" ? "Март — февраль" : "Январь — декабрь"}</small>
                </button>
              ))}
            </div>
            <p>Март был первым месяцем древнеримского года: сентябрь означал «седьмой», октябрь — «восьмой». Январь назван в честь Януса, римского божества начал и переходов.</p>
          </section>
        ) : null}

        {visibleCalendarMode(user.calendarMode ?? "sacred", visibility) === "profane" ? (
          <section className="account-preferences appearance-nested-preference week-start-preference" aria-labelledby="week-start-title" data-exp-ui="panel">
            <div>
              <span className="eyebrow">Григорианский календарь</span>
              <h3 id="week-start-title">Начало недели</h3>
              <p>Выберите, с какого дня строить недели в разделах «Месяц» и «Круг года».</p>
            </div>
            <div className="language-choice week-start-choice" role="radiogroup" aria-label="Начало недели">
              {(["monday", "sunday"] as const).map((weekStart) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={(user.weekStart ?? "sunday") === weekStart}
                  className={(user.weekStart ?? "sunday") === weekStart ? "active" : ""}
                  disabled={preferenceBusy}
                  onClick={() => void changeWeekStart(weekStart)}
                  key={weekStart}
                >
                  <strong>{weekStart === "monday" ? "Понедельник" : "Воскресенье"}</strong>
                  <small>{weekStart === "monday" ? "Пн — Вс" : "Вс — Сб"}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {visibility.sacredFeaturesEnabled ? <section className="account-preferences appearance-nested-preference task-calendar-mode-preference" aria-labelledby="task-calendar-mode-title" data-exp-ui="panel">
          <div>
            <span className="eyebrow">Календарь задач</span>
            <h3 id="task-calendar-mode-title">По какой системе выставлять даты</h3>
            <p>Основной календарь не изменится; выбор дат, повторений и календарные подписи новых задач будут работать по выбранной системе.</p>
          </div>
          <div className="calendar-mode-segment" role="radiogroup" aria-label="Календарь постановки задач">
            {CALENDAR_MODES.filter((mode) => visibleCalendarModes(visibility).includes(mode.id)).map((mode) => (
              <button
                type="button"
                role="radio"
                aria-checked={visibleCalendarMode(user.taskCalendarMode ?? "sacred",visibility) === mode.id}
                className={visibleCalendarMode(user.taskCalendarMode ?? "sacred",visibility) === mode.id ? "active" : ""}
                disabled={preferenceBusy}
                onClick={() => void changeTaskCalendarMode(mode.id)}
                key={mode.id}
              >
                <strong>{mode.label}</strong>
                <small>{mode.hint}</small>
              </button>
            ))}
          </div>
        </section> : null}

          </div>
        </div>

        {visibility.sacredFeaturesEnabled ? <section className="account-preferences" aria-labelledby="account-preferences-title" data-settings-group="appearance">
          <div>
            <span className="eyebrow">Самоограничение</span>
            <h3 id="account-preferences-title">Гадания в Стойхейоне</h3>
          </div>
          <label className="account-switch-row">
            <span>
              <strong>Запретить себе гадания</strong>
              <small>Скрывает карту дня и расклад девяти карт на всех устройствах. Каталог 24 буквенных карт и их значения останутся доступны.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={Boolean(user.stoicheionDivinationDisabled)}
              disabled={preferenceBusy}
              onChange={(event) => void changeDivinationPreference(event.target.checked)}
              aria-label="Запретить себе гадания по картам"
            />
            <i aria-hidden="true" />
          </label>
          <p className="account-preference-status" aria-live="polite">
            {user.stoicheionDivinationDisabled ? "Гадания выключены" : "Гадания доступны"}
          </p>
        </section> : null}

        <DailyAdviceSettings user={user} onUserChange={onUserChange} />

        <WeatherDisplaySettings ownerId={user.uid} language={user.language} />


        <section className="account-preferences" aria-labelledby="account-habits-title" data-settings-group="habits">
          <div>
            <span className="eyebrow">{user.language === "en" ? "Daily practice" : "Ежедневная практика"}</span>
            <h3 id="account-habits-title">{user.language === "en" ? "Habit tracking" : "Трекинг привычек"}</h3>
          </div>
          <label className="account-switch-row">
            <span>
              <strong>{user.language === "en" ? "Enable habit tracker" : "Включить трекер привычек"}</strong>
              <small>{user.language === "en" ? "Shows today's habits, the Habits page, mood and progress. Existing encrypted records remain saved when disabled." : "Показывает привычки дня, страницу «Привычки», настроение и прогресс. При отключении зашифрованные записи сохраняются."}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={habitTrackingEnabled}
              onChange={(event) => onHabitTrackingChange(event.target.checked)}
              aria-label={user.language === "en" ? "Enable habit tracking" : "Включить трекинг привычек"}
            />
            <i aria-hidden="true" />
          </label>
          <p className="account-preference-status" aria-live="polite">
            {habitTrackingEnabled ? (user.language === "en" ? "Habit tracking is enabled" : "Трекинг привычек включён") : (user.language === "en" ? "Habit tracking is hidden" : "Трекинг привычек скрыт")}
          </p>
          <div className="account-template-restore">
            <div>
              <strong>{user.language === "en" ? "Starter habit suggestions" : "Стартовые привычки"}</strong>
              <small>{hiddenHabitTemplateCount
                ? (user.language === "en" ? `${hiddenHabitTemplateCount} suggestion(s) hidden` : `Скрыто предложений: ${hiddenHabitTemplateCount}`)
                : (user.language === "en" ? "All standard suggestions are available" : "Все стандартные предложения доступны")}</small>
            </div>
            <button type="button" className="secondary-button" disabled={!hiddenHabitTemplateCount} onClick={onRestoreHabitTemplates}>{user.language === "en" ? "Restore standard habits" : "Восстановить стандартные привычки"}</button>
          </div>
          <div className="account-habit-reset">
            <div>
              <strong>{user.language === "en" ? "Reset habit tracking" : "Обнуление трекера"}</strong>
              <small>{user.language === "en"
                ? "Permanently deletes habits, sleep, mood, abstinence, statistics, XP and laurels. Account and calendar settings stay unchanged."
                : "Безвозвратно удалит привычки, сон, настроение, воздержание, статистику, XP и лавры. Настройки аккаунта и календаря сохранятся."}</small>
            </div>
            <button type="button" onClick={openHabitReset}>{user.language === "en" ? "Reset all habits" : "Обнулить все привычки"}</button>
          </div>
        </section>

        <DreamJournalSettings language={user.language} enabled={visibility.dreamJournalEnabled} preferenceBusy={preferenceBusy} onEnabledChange={enabled=>void updateVisibility({...visibility,dreamJournalEnabled:enabled})}/>
        <section className="account-preferences habit-notification-preference" aria-labelledby="habit-notification-title" data-settings-group="habits">
          <div>
            <span className="eyebrow">{user.language === "en" ? "On-device motivation" : "Мотивация на устройстве"}</span>
            <h3 id="habit-notification-title">{user.language === "en" ? "Habit notifications" : "Уведомления привычек"}</h3>
            <p>{user.language === "en"
              ? "GENESIS combines nearby reminders, respects quiet hours and reduces motivational messages after repeated ignoring."
              : "GENESIS объединяет близкие напоминания, соблюдает тихие часы и снижает частоту мотивационных сообщений после повторных пропусков."}</p>
          </div>
          <label className="account-switch-row">
            <span>
              <strong>{user.language === "en" ? "Daily goal reminder" : "Напоминание о дневной цели"}</strong>
              <small>{user.language === "en" ? "Permission is requested only after this switch is enabled." : "Разрешение браузера запрашивается только после включения этого переключателя."}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={habitNotificationSettings.enabled && notificationPermission === "granted"}
              disabled={notificationBusy || notificationPermission === "unsupported"}
              onChange={(event) => void toggleHabitNotifications(event.target.checked)}
              aria-label={user.language === "en" ? "Daily goal reminder" : "Напоминание о дневной цели"}
            />
            <i aria-hidden="true" />
          </label>
          <p className="account-preference-status" aria-live="polite">{notificationPermission === "unsupported"
            ? (user.language === "en" ? "Notifications are not supported" : "Уведомления не поддерживаются")
            : notificationPermission === "denied"
              ? (user.language === "en" ? "Permission is blocked in the browser" : "Разрешение заблокировано в браузере")
              : habitNotificationSettings.enabled && notificationPermission === "granted"
                ? `${translateText("Напоминание о дневной цели",user.language)}: ${translateText("Включено",user.language)}`
                : `${translateText("Напоминание о дневной цели",user.language)}: ${translateText("Выключено",user.language)}`}</p>
          <fieldset className="habit-notification-settings" disabled={notificationBusy}>
            <legend>{user.language === "en" ? "Notification behavior" : "Поведение уведомлений"}</legend>
            <div className="habit-notification-tone" role="radiogroup" tabIndex={-1} aria-label={user.language === "en" ? "Notification tone" : "Тон уведомлений"}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
                const current = buttons.indexOf(event.target as HTMLButtonElement);
                if (current < 0 || !buttons.length) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
                  : (current + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
                buttons[next].focus(); buttons[next].click();
              }}>
              {([
                ["calm", user.language === "en" ? "Calm" : "Спокойный"],
                ["heroic", user.language === "en" ? "Heroic" : "Героический"],
                ["ironic", user.language === "en" ? "With irony" : "С иронией"],
              ] as const).map(([tone, label]) => <button type="button" role="radio" aria-checked={habitNotificationSettings.tone === tone} tabIndex={habitNotificationSettings.tone === tone ? 0 : -1} className={habitNotificationSettings.tone === tone ? "active" : ""} onClick={() => onHabitNotificationSettingsChange({ ...habitNotificationSettings, tone })} key={tone}>{label}</button>)}
            </div>
            <div className="habit-notification-times">
              <label><span>{user.language === "en" ? "Daily goal reminder" : "Напоминание о дневной цели"}</span><TimeClockPicker value={habitNotificationSettings.dailyGoalTime} ariaLabel={user.language === "en" ? "Daily goal reminder" : "Напоминание о дневной цели"} onChange={(value) => onHabitNotificationSettingsChange({ ...habitNotificationSettings, dailyGoalTime: value })} /></label>
              <label><span>{user.language === "en" ? "Quiet hours start" : "Начало тихих часов"}</span><TimeClockPicker value={habitNotificationSettings.quietHoursStart} ariaLabel={user.language === "en" ? "Quiet hours start" : "Начало тихих часов"} onChange={(value) => onHabitNotificationSettingsChange({ ...habitNotificationSettings, quietHoursStart: value })} /></label>
              <label><span>{user.language === "en" ? "Quiet hours end" : "Конец тихих часов"}</span><TimeClockPicker value={habitNotificationSettings.quietHoursEnd} ariaLabel={user.language === "en" ? "Quiet hours end" : "Конец тихих часов"} onChange={(value) => onHabitNotificationSettingsChange({ ...habitNotificationSettings, quietHoursEnd: value })} /></label>
            </div>
            <label className="account-switch-row compact">
              <span><strong>{user.language === "en" ? "Daily goal and streak reminders" : "Напоминания о цели и серии"}</strong><small>{user.language === "en" ? "Shown only while the goal is still achievable; they never shame or deduct progress." : "Показываются только пока цель достижима; не стыдят и не отнимают прогресс."}</small></span>
              <input type="checkbox" role="switch" aria-label={user.language === "en" ? "Daily goal and streak reminders" : "Напоминания о цели и серии"} checked={habitNotificationSettings.motivational} onChange={(event) => onHabitNotificationSettingsChange({ ...habitNotificationSettings, motivational: event.target.checked })} />
              <i aria-hidden="true" />
            </label>
          </fieldset>
          <small className="habit-notification-privacy">{user.language === "en"
            ? "Notification analytics contain no habit titles and remain only on this device. Notification settings are stored inside your encrypted workspace."
            : "Аналитика уведомлений не содержит названий привычек и остаётся только на этом устройстве. Настройки уведомлений хранятся внутри зашифрованного пространства."}</small>
          <HabitReminderSettings key={user.uid} userId={user.uid} language={user.language}/>
        </section>

        <section className="account-preferences habit-feedback-preference" aria-labelledby="habit-feedback-title" data-settings-group="habits">
          <div>
            <span className="eyebrow">{user.language === "en" ? "Feedback and accessibility" : "Отклик и доступность"}</span>
            <h3 id="habit-feedback-title">{user.language === "en" ? "Completion feedback" : "Отклик на выполнение"}</h3>
            <p>{user.language === "en"
              ? "Choose how GENESIS confirms a completed habit. System reduced-motion preferences always take priority."
              : "Выберите, как GENESIS подтверждает выполнение привычки. Системное ограничение движения всегда имеет приоритет."}</p>
          </div>
          <fieldset className="habit-feedback-settings" disabled={!habitTrackingEnabled}>
            <legend className="sr-only">{user.language === "en" ? "Habit feedback settings" : "Настройки отклика привычек"}</legend>
            <label className="account-switch-row compact">
              <span><strong>{user.language === "en" ? "Short animations" : "Короткие анимации"}</strong><small>{user.language === "en" ? "Smooth checkbox, card and progress feedback; disabled automatically when reduced motion is requested." : "Плавный отклик галочки, карточки и прогресса; автоматически отключается при системном ограничении движения."}</small></span>
              <input type="checkbox" role="switch" checked={habitFeedbackSettings.animations} onChange={(event) => onHabitFeedbackSettingsChange({ ...habitFeedbackSettings, animations: event.target.checked })} aria-label={user.language === "en" ? "Short completion animations" : "Короткие анимации выполнения"} />
              <i aria-hidden="true" />
            </label>
            <label className="account-switch-row compact">
              <span><strong>{user.language === "en" ? "Completion sound" : "Звук выполнения"}</strong><small>{habitFeedbackCopy[user.language].webSoundHint}</small></span>
              <input type="checkbox" role="switch" checked={habitFeedbackSettings.sound} onChange={(event) => onHabitFeedbackSettingsChange({ ...habitFeedbackSettings, sound: event.target.checked })} aria-label={user.language === "en" ? "Completion sound" : "Звук выполнения"} />
              <i aria-hidden="true" />
            </label>
            <label className="account-switch-row compact">
              <span><strong>{user.language === "en" ? "Haptic feedback" : "Тактильный отклик"}</strong><small>{user.language === "en" ? "A light vibration on supported mobile devices. Off by default." : "Лёгкая вибрация на поддерживаемых мобильных устройствах. По умолчанию выключена."}</small></span>
              <input type="checkbox" role="switch" checked={habitFeedbackSettings.haptics} onChange={(event) => onHabitFeedbackSettingsChange({ ...habitFeedbackSettings, haptics: event.target.checked })} aria-label={user.language === "en" ? "Haptic feedback" : "Тактильный отклик"} />
              <i aria-hidden="true" />
            </label>
            <label className="account-switch-row compact">
              <span><strong>{user.language === "en" ? "Achievement notices" : "Уведомления о достижениях"}</strong><small>{user.language === "en" ? "Include a newly unlocked achievement in the completion notice." : "Показывать новое достижение в уведомлении о выполнении."}</small></span>
              <input type="checkbox" role="switch" checked={habitFeedbackSettings.achievementPopups} onChange={(event) => onHabitFeedbackSettingsChange({ ...habitFeedbackSettings, achievementPopups: event.target.checked })} aria-label={user.language === "en" ? "Achievement notices" : "Уведомления о достижениях"} />
              <i aria-hidden="true" />
            </label>
            <label className="account-switch-row compact">
              <span><strong>{user.language === "en" ? "Trials" : "Испытания"}</strong><small>{user.language === "en" ? "Create and show daily, weekly and epic trials. Existing progress is preserved while disabled." : "Создавать и показывать ежедневные, недельные и эпические испытания. При отключении прежний прогресс сохраняется."}</small></span>
              <input type="checkbox" role="switch" checked={habitFeedbackSettings.questsEnabled} onChange={(event) => onHabitFeedbackSettingsChange({ ...habitFeedbackSettings, questsEnabled: event.target.checked })} aria-label={user.language === "en" ? "Habit trials" : "Испытания привычек"} />
              <i aria-hidden="true" />
            </label>
            <label className="account-switch-row compact">
              <span><strong>{user.language === "en" ? "Gamification widgets" : "Игровые блоки"}</strong><small>{user.language === "en" ? "Show ranks, Laurels, streak rewards and achievements. Habit tracking continues normally when hidden." : "Показывать ранги, Лавры, награды серии и достижения. Без них трекинг продолжает работать как обычно."}</small></span>
              <input type="checkbox" role="switch" checked={habitFeedbackSettings.gamificationWidgets} onChange={(event) => onHabitFeedbackSettingsChange({ ...habitFeedbackSettings, gamificationWidgets: event.target.checked })} aria-label={user.language === "en" ? "Gamification widgets" : "Игровые блоки"} />
              <i aria-hidden="true" />
            </label>
            <HabitFeedbackSoundSettings language={user.language} settings={habitFeedbackSettings} onChange={onHabitFeedbackSettingsChange} />
          </fieldset>
          {!habitTrackingEnabled ? <p className="account-preference-status" role="status">{user.language === "en" ? "Enable habit tracking to change these settings" : "Включите трекинг привычек, чтобы изменить эти настройки"}</p> : null}
        </section>

        <section className="account-preferences shared-projects-preference" aria-labelledby="shared-projects-preference-title" data-exp-ui="panel" data-settings-group="shared">
          <div>
            <span className="eyebrow">GENESIS · {user.language === "en" ? "Together" : "Вместе"}</span>
            <h3 id="shared-projects-preference-title"><SettingsSectionIcon section="shared" />{user.language === "en" ? "Shared affairs" : "Общие дела"}</h3>
            <p>{user.language === "en" ? "Create projects with other GENESIS accounts. Personal data stays private." : "Создавайте проекты с другими аккаунтами GENESIS. Личные данные остаются приватными."}</p>
            <small>{user.sharedProjectsLifetimeAccess
              ? (user.language === "en" ? "Lifetime free access to Shared affairs." : "Пожизненный бесплатный открытый доступ к функциям «Общие дела».")
              : (user.language === "en" ? "Open to all GENESIS accounts during testing." : "Открыто всем аккаунтам GENESIS на время тестирования.")}</small>
          </div>
          <label htmlFor="shared-projects-toggle" aria-label={user.language === "en" ? "Enable shared affairs" : "Включить общие дела"} className={`account-switch-row${sharedGuideActive ? " shared-projects-guide" : ""}`} data-exp-ui="row">
            <span><strong>{user.language === "en" ? "Enable shared affairs" : "Включить общие дела"}</strong></span>
            <input ref={sharedProjectsToggleRef} id="shared-projects-toggle" type="checkbox" role="switch" data-exp-ui="switch" checked={Boolean(user.sharedProjectsEnabled)}
              data-dialog-initial-focus={guideSharedProjects ? "" : undefined}
              disabled={!user.sharedProjectsEligible || preferenceBusy}
              onChange={(event) => { setSharedGuideVisible(false); void changeSharedProjectsPreference(event.target.checked); }} />
            <i aria-hidden="true" />
          </label>
        {user.sharedProjectsEnabled?<div className="notification-preference-buttons"><button type="button" className="secondary-button" onClick={()=>setSharedNotificationSettingsOpen(true)}>{translateText("Настройки уведомлений")}</button><button type="button" className="secondary-button" onClick={()=>{onClose();window.dispatchEvent(new Event("genesis:notification-inbox-open"));}}>{translateText("История уведомлений")}</button></div>:null}
        {user.sharedProjectsEligible ? <div className="shared-settings-subsection" role="group" aria-labelledby="shared-invitations-title">
          <div>
            <h4 id="shared-invitations-title">{user.language === "en" ? "Invitations" : "Приглашения"}</h4>
            {!invitations.length ? <p>{user.language === "en" ? "You have no pending invitations." : "Новых приглашений нет."}</p> : null}
          </div>
          {invitations.map((invitation) => <div key={invitation.id} className="shared-invitation-card" data-exp-ui="row">
            <p>{user.language === "en"
              ? `${invitation.inviterName} invites you to workspace «${invitation.spaceTitle}», project «${invitation.projectTitle}».`
              : `Вас ${invitation.inviterName} приглашает присоединиться к пространству «${invitation.spaceTitle}», проекту «${invitation.projectTitle}».`}</p>
            <div className="shared-invitation-actions">
              <button type="button" disabled={Boolean(invitationBusy)} onClick={() => void respondToInvitation(invitation.id, true)}>
                {user.language === "en" ? "Accept" : "Принять"}</button>
              <button type="button" disabled={Boolean(invitationBusy)} onClick={() => void respondToInvitation(invitation.id, false)}>
                {user.language === "en" ? "Decline" : "Отклонить"}</button>
            </div>
          </div>)}
          {invitationMessage ? <p role="status" className="account-preference-status">{invitationMessage}</p> : null}
        </div> : null}

        {user.sharedProjectsEnabled ? <details className="shared-settings-subsection account-team-activity">
          <summary><h4 id="shared-team-activity-title">{user.language === "en" ? "Team updates" : "События команды"}</h4></summary>
            {!teamNotifications.length ? <p>{user.language === "en" ? "No team updates yet." : "Новых событий команды пока нет."}</p> : null}
          {teamNotifications.some((item) => !item.isRead) ? <button type="button" className="text-button"
            disabled={teamReadBusy} onClick={() => void markTeamRead(teamNotifications.filter((item) => !item.isRead).map((item) => item.id))}>
            {user.language === "en" ? "Mark all as read" : "Отметить всё прочитанным"}
          </button> : null}
          {teamNotifications.slice(0, 12).map((item) => <div key={item.id}
            className={`shared-invitation-card${item.isRead ? "" : " unread"}`} data-exp-ui="row">
            <p><strong data-no-translate>{item.actorName}</strong> · {item.kind ? sharedNotificationLabel(item) : item.action.startsWith("task.")
              ? (user.language === "en" ? "updated a task" : "изменил(а) задачу")
              : item.action === "comment.mentioned" ? (user.language === "en" ? "mentioned you in a comment" : "упомянул(а) вас в комментарии")
              : item.action === "comment.created" ? (user.language === "en" ? "added a comment" : "добавил(а) комментарий")
                : (user.language === "en" ? "updated the project" : "обновил(а) проект")}
              {item.taskTitle ? <> · <span data-no-translate>{item.taskTitle}</span></> : null}
              {" · "}<span data-no-translate>{item.projectTitle}</span></p>
            {!item.isRead ? <button type="button" disabled={teamReadBusy} onClick={() => void markTeamRead([item.id])}>
              {user.language === "en" ? "Read" : "Прочитано"}</button> : null}
          </div>)}
        </details> : null}

        </section>

        {visibility.sacredFeaturesEnabled ? <MoonReminderSettings key={user.uid} accountId={user.uid} english={user.language === "en"} permission={notificationPermission} requestPermission={onRequestHabitNotifications} /> : null}
        <section className="account-preferences settings-reminders-panel" data-settings-group="reminders">
          <div className="account-email-preferences"><h3>{user.language==="en"?"Email notifications":"Уведомления по email"}</h3><p>{user.language==="en"?"Choose emails about messages, comments and tasks, and set their frequency and quiet hours.":"Выберите письма о сообщениях, комментариях и задачах, настройте частоту и тихие часы."}</p><button type="button" className="secondary-button" onClick={()=>setSharedNotificationSettingsOpen(true)}>{user.language==="en"?"Configure email notifications":"Настроить email-уведомления"}</button></div>
          <div className="account-system-reminders"><span className="eyebrow">GENESIS</span><h3>{translateText("Системные напоминания",user.language)}</h3>
            <p>{user.language === "en" ? "Browser notifications depend on your browser permission. Task reminders in Google Calendar and Tasks use the connected Google account." : "Уведомления браузера зависят от его разрешения. Напоминания задач в Google Calendar и Tasks работают через подключённый Google-аккаунт."}</p></div>
          <p>Уведомления задач и привычек используют разные звуки и значки. Звуковые сигналы сайта доступны после взаимодействия со страницей; браузер определяет вид системных уведомлений.</p>
          <p className="account-preference-status">{user.language === "en" ? "Browser permission" : "Разрешение браузера"}: {typeof Notification === "undefined" ? "—" : Notification.permission}</p>
        </section>

        <div data-settings-group="region"><SolarPlaceSettings language={user.language} focusCity={guideSolarPlace} /></div>

        <section className="account-preferences settings-links-panel" data-settings-group="links">
          <DonationLink className="settings-donation-link" language={user.language}>{release319Copy[user.language].donation}</DonationLink>
          <a href="https://t.me/genesisbasilea" target="_blank" rel="noreferrer">{user.language === "en" ? "GENESIS Academy" : "Академия Генезис"}</a>
          <a href="/support">{user.language === "en" ? "Support" : "Поддержка"}</a>
          <a href="/privacy">{user.language === "en" ? "Privacy policy" : "Политика конфиденциальности"}</a>
          <a href="/terms">{user.language === "en" ? "Terms of service" : "Пользовательское соглашение"}</a>
          <AdvicePrivacyNotice language={user.language} />
        </section>

        {user.authProvider === "google" ? <section className="account-preferences multi-account-preference" aria-labelledby="multi-account-title" data-settings-group="account">
            <div className="multi-account-heading">
              <div>
                <span className="eyebrow">Дополнительные подключения · Standart и выше</span>
                <h3 id="multi-account-title">Google Calendar и Tasks: подключения</h3>
                <p>Объедините личный, рабочий и другие Google-аккаунты в одном пространстве GENESIS и сами решайте, в какие Calendar и Google Tasks отправлять новые задачи.</p>
              </div>
              <button type="button" className="primary-button" onClick={onConnectAdditionalGoogle}>＋ Подключить аккаунт</button>
            </div>
            <div className="multi-account-benefits">
              <strong>Что даёт подключение</strong>
              <ul>
                <li><b>Один кабинет.</b> Вход через любой связанный Google-аккаунт открывает те же проекты, категории и настройки GENESIS.</li>
                <li><b>Раздельные календари.</b> GENESIS синхронизирует задачу с выбранным аккаунтом или сразу с несколькими аккаунтами.</li>
                <li><b>Удобная маршрутизация.</b> Можно задать постоянные аккаунты, выбирать их при создании каждой задачи или распределять автоматически по категории проекта.</li>
                <li><b>Безопасное отключение.</b> При удалении связи уже созданные события, списки и задачи остаются в соответствующем Google-аккаунте.</li>
              </ul>
              <small>Подключение проходит через официальный OAuth Google с отдельным разрешением Calendar и Tasks. GENESIS не получает пароль дополнительного аккаунта.</small>
              <small>Если Google-аккаунт уже создал собственное отдельное пространство GENESIS, его нельзя присоединить автоматически: это защищает существующие проекты и задачи от случайного объединения.</small>
            </div>
            <div className="google-account-list">
              {(user.googleAccounts ?? []).map((account, index) => (
                <article key={account.id}>
                  {account.photoURL ? <img src={account.photoURL} alt="" referrerPolicy="no-referrer" data-genesis-preserve="linked-account-avatar" /> : <span className="account-avatar-fallback" aria-hidden="true">{account.email.slice(0, 1).toUpperCase()}</span>}
                  <div><strong>{account.displayName || account.email}</strong><small>{account.email}</small></div>
                  <em>{account.isPrimary ? "Основной" : `Дополнительный ${index}`}</em>
                  {!account.isPrimary ? <button type="button" className="text-button" disabled={busy} onClick={() => void removeAdditionalAccount(account.id)}>Отключить</button> : null}
                </article>
              ))}
            </div>

            {(user.googleAccounts ?? []).length > 1 ? (
              <div className="sync-routing-editor">
                <fieldset className="sync-routing-modes">
                  <legend>Как выбирать аккаунты для новых задач</legend>
                  <label><input type="radio" aria-label="Заранее выбранные" checked={routing.mode === "fixed"} onChange={() => setRouting((current) => ({ ...current, mode: "fixed" }))} /><span><strong>Заранее выбранные</strong><small>Каждая новая задача отправляется в отмеченные ниже аккаунты.</small></span></label>
                  <label><input type="radio" aria-label="По выбору при создании" checked={routing.mode === "choose"} onChange={() => setRouting((current) => ({ ...current, mode: "choose" }))} /><span><strong>По выбору при создании</strong><small>В форме задачи появляется выбор одного или нескольких аккаунтов.</small></span></label>
                  <label><input type="radio" aria-label="По категории проекта" checked={routing.mode === "category"} onChange={() => setRouting((current) => ({ ...current, mode: "category" }))} /><span><strong>По категории проекта</strong><small>Аккаунты выбираются автоматически по правилам категорий; ниже задаются аккаунты по умолчанию.</small></span></label>
                </fieldset>

                <fieldset className="sync-account-checks">
                  <legend>{routing.mode === "fixed" ? "Синхронизировать новые задачи" : "Аккаунты по умолчанию"}</legend>
                  {(user.googleAccounts ?? []).map((account) => (
                    <label key={account.id}>
                      <input
                        type="checkbox"
                        checked={routing.defaultAccountIds.includes(account.id)}
                        onChange={(event) => setRouting((current) => ({
                          ...current,
                          defaultAccountIds: event.target.checked
                            ? Array.from(new Set([...current.defaultAccountIds, account.id]))
                            : current.defaultAccountIds.filter((id) => id !== account.id),
                        }))}
                      />
                      <span>{account.email}{account.isPrimary ? " · основной" : ""}</span>
                    </label>
                  ))}
                </fieldset>

                {routing.mode === "category" ? (
                  <div className="category-routing-grid">
                    <strong>Категории и аккаунты</strong>
                    {categories.map((category) => (
                      <fieldset key={category.id}>
                        <legend><i style={{ backgroundColor: category.color }} /><span data-no-translate>{localizeCategoryName(category, user.language)}</span></legend>
                        {(user.googleAccounts ?? []).map((account) => {
                          const selected = routing.categoryAccountIds[category.id] ?? [];
                          return (
                            <label key={account.id}><input type="checkbox" checked={selected.includes(account.id)} onChange={(event) => setRouting((current) => ({
                              ...current,
                              categoryAccountIds: {
                                ...current.categoryAccountIds,
                                [category.id]: event.target.checked
                                  ? Array.from(new Set([...(current.categoryAccountIds[category.id] ?? []), account.id]))
                                  : (current.categoryAccountIds[category.id] ?? []).filter((id) => id !== account.id),
                              },
                            }))} />{account.email}</label>
                          );
                        })}
                      </fieldset>
                    ))}
                  </div>
                ) : null}
                <button type="button" className="primary-button" disabled={preferenceBusy || routing.defaultAccountIds.length === 0} onClick={() => void saveRouting()}>Сохранить маршрутизацию</button>
              </div>
            ) : null}
          </section> : null}

        <section className="account-preferences account-e2ee" aria-labelledby="account-e2ee-title" data-settings-group="account">
          <div>
            <span className="eyebrow">Encrypted workspace</span>
            <h3 id="account-e2ee-title">{user.language === "en" ? "Encrypted personal data" : "Шифрование личных данных"}</h3>
          </div>
          <p>{(user.language === "en" ? "Projects and tracker data are encrypted before storage. After Google sign-in, an authenticated GENESIS session unlocks them automatically on every device—no recovery code is required." : "Проекты и данные трекеров шифруются перед сохранением. После входа через Google защищённая сессия GENESIS автоматически открывает их на любом устройстве — код восстановления не нужен.")}</p>
        </section>

        <section className="account-oauth-note" aria-label="Безопасность входа" data-settings-group="account">
          <h3>Безопасный вход</h3>
          <>
            <p>Авторизация выполняется только через официальный OAuth Google. GENESIS не получает, не запрашивает и не хранит пароль. Токены доступа шифруются на сервере, а при удалении аккаунта разрешение отзывается у Google.</p>
            <p><a href="/privacy">Подробнее об использовании данных Google</a></p>
            <button type="button" className="text-button" onClick={onReconnectGoogle}>Обновить разрешения Calendar и Tasks</button>
            {user.calendarConnected || user.googleTasksImportReady ? (
              <button type="button" className="text-button" onClick={() => void disconnectServices()} disabled={busy}>Отключить Calendar и Tasks</button>
            ) : null}
          </>
        </section>

        {message ? <p className="account-message" role="status" data-settings-group="account">{message}</p> : null}

        <button type="button" className="secondary-button" data-settings-group="account" onClick={() => void onSignOut()}>{user.language === "en" ? "Sign out" : "Выйти из аккаунта"}</button>
        <div className="account-danger" data-settings-group="account">
          <div><strong>Удаление аккаунта</strong><small>Безвозвратно удалит только ваш профиль и все связанные с ним данные с сервера GENESIS, локальные копии на этом устройстве и отзовёт разрешения Google.</small></div>
          <button type="button" onClick={() => void removeAccount()} disabled={busy}>Удалить</button>
        </div>
      </section>
      {habitResetChallenge ? (
        <div className="habit-reset-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeHabitReset(); }}>
          <form
            ref={habitResetDialogRef}
            className="habit-reset-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="habit-reset-title"
            aria-describedby="habit-reset-description"
            tabIndex={-1}
            onSubmit={(event) => {
              event.preventDefault();
              void confirmHabitReset();
            }}
          >
            <DialogCloseButton type="button" disabled={habitResetBusy} onClick={closeHabitReset} aria-label={translateText("Закрыть")} />
            <span className="habit-reset-mark" aria-hidden="true">!</span>
            <div className="habit-reset-copy">
              <span className="eyebrow">{user.language === "en" ? "Irreversible action" : "Необратимое действие"}</span>
              <h3 id="habit-reset-title">{user.language === "en" ? "Reset all habit data?" : "Обнулить все привычки?"}</h3>
              <p id="habit-reset-description">{user.language === "en"
                ? "Every tracker, record, statistic, rank progress, XP and laurel will be deleted from this encrypted workspace. This cannot be undone."
                : "Все трекеры, записи, статистика, прогресс рангов, XP и лавры будут удалены из зашифрованного пространства. Отменить это действие невозможно."}</p>
            </div>
            <label className="habit-reset-captcha">
              <span>{user.language === "en" ? "Solve to confirm" : "Решите пример для подтверждения"}</span>
              <strong>{habitResetChallenge.left} {habitResetChallenge.operator} {habitResetChallenge.right} = ?</strong>
              <input
                ref={habitResetInputRef}
                type="number"
                inputMode="numeric"
                value={habitResetAnswer}
                disabled={habitResetBusy}
                onChange={(event) => {
                  setHabitResetAnswer(event.target.value);
                  setHabitResetError("");
                }}
                aria-label={user.language === "en" ? "Answer to the arithmetic challenge" : "Ответ на арифметический пример"}
                aria-invalid={habitResetAnswer.trim() !== "" && Number(habitResetAnswer) !== habitResetChallenge.answer}
              />
              <small>{habitResetAnswer.trim() === "" || Number(habitResetAnswer) !== habitResetChallenge.answer
                ? (user.language === "en" ? "The delete button unlocks after the correct answer." : "Кнопка удаления станет доступна после верного ответа.")
                : (user.language === "en" ? "Answer accepted. Check the action once more." : "Ответ верный. Ещё раз проверьте действие.")}</small>
            </label>
            {habitResetError ? <p className="habit-reset-error" role="alert">{habitResetError}</p> : null}
            <div className="habit-reset-actions">
              <button type="button" className="secondary-button" disabled={habitResetBusy} onClick={closeHabitReset}>{user.language === "en" ? "Cancel" : "Отменить"}</button>
              <button
                type="submit"
                className="habit-reset-confirm"
                disabled={habitResetBusy || habitResetAnswer.trim() === "" || Number(habitResetAnswer) !== habitResetChallenge.answer}
              >
                {habitResetBusy
                  ? (user.language === "en" ? "Resetting…" : "Обнуляем…")
                  : (user.language === "en" ? "Confirm reset" : "Подтвердить удаление")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {sharedNotificationSettingsOpen?<SharedNotificationPreferencesDialog userId={user.uid} onClose={()=>setSharedNotificationSettingsOpen(false)}/>:null}
    </div>
  );
}

function SettingsDisclosureChevron() {
  return <svg className="appearance-summary-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" /></svg>;
}
