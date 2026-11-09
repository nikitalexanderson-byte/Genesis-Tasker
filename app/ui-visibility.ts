import type { CalendarMode } from "./calendar-data";
import { projectViewOrder, type ProjectView } from "./project-view-order.ts";
import { calendarScaleValue, type CalendarScale } from "./calendar-scale.ts";
import { todayBlockOrder, type TodayBlockId } from './today-block-order.ts';

export type InboxPosition = "top" | "right" | "left" | "bottom";
export type AccountLayout = {
  sidebarWidth: number;
  personalInboxPosition: InboxPosition;
  personalInboxHidden: boolean;
  personalInboxCompact: boolean;
  personalInboxWidth: number;
  sharedInboxPosition: InboxPosition;
  sharedInboxHidden: boolean;
  sharedInboxCompact: boolean;
  sharedInboxWidth: number;
  sharedCategoriesExpanded: boolean;
  personalCategoriesExpanded: boolean;
  personalCategoriesView: "cards" | "list";
  sharedCategoriesView: "cards" | "list";
  sharedTasksCompact: boolean;
  notificationDockPinned: boolean;
  notificationDockX: number;
  notificationDockY: number;
  sharedProjectViewOrder: ProjectView[] | null;
  sharedCalendarScale: CalendarScale;
  todayBlockOrder: TodayBlockId[] | null;
};
export const DEFAULT_ACCOUNT_LAYOUT: AccountLayout = {
  sidebarWidth: 240, personalInboxPosition: "right", personalInboxHidden: false, personalInboxCompact: false,
  sharedInboxPosition: "right", sharedInboxHidden: false, sharedInboxCompact: false,
  sharedCategoriesExpanded: false,
  personalCategoriesExpanded: false, personalCategoriesView: "cards", sharedCategoriesView: "list",
  sharedTasksCompact: true,
  personalInboxWidth: 300, sharedInboxWidth: 300,
  notificationDockPinned: false, notificationDockX: -1, notificationDockY: -1,
  sharedProjectViewOrder: null,
  sharedCalendarScale: 1,
  todayBlockOrder: null,
};
export function accountLayout(value?: Partial<AccountLayout> | null): AccountLayout {
  const position = (input?: InboxPosition): InboxPosition => input && ["top", "right", "left", "bottom"].includes(input) ? input : "right";
  return {
    sidebarWidth: Number.isInteger(value?.sidebarWidth) ? Math.max(56, Math.min(240, value!.sidebarWidth!)) : 240,
    personalInboxPosition: position(value?.personalInboxPosition), personalInboxHidden: value?.personalInboxHidden === true,
    personalInboxCompact: value?.personalInboxCompact === true,
    sharedInboxPosition: position(value?.sharedInboxPosition), sharedInboxHidden: value?.sharedInboxHidden === true,
    sharedInboxCompact: value?.sharedInboxCompact === true,
    sharedCategoriesExpanded: value?.sharedCategoriesExpanded === true,
    personalCategoriesExpanded: value?.personalCategoriesExpanded === true,
    personalCategoriesView: value?.personalCategoriesView === "list" ? "list" : "cards",
    sharedCategoriesView: value?.sharedCategoriesView === "cards" ? "cards" : "list",
    sharedTasksCompact: value?.sharedTasksCompact !== false,
    personalInboxWidth: Number.isInteger(value?.personalInboxWidth) ? Math.max(300, Math.min(5000, value!.personalInboxWidth!)) : 300,
    sharedInboxWidth: Number.isInteger(value?.sharedInboxWidth) ? Math.max(300, Math.min(5000, value!.sharedInboxWidth!)) : 300,
    notificationDockPinned: value?.notificationDockPinned === true,
    notificationDockX: Number.isInteger(value?.notificationDockX) ? Math.max(-1, Math.min(10000, value!.notificationDockX!)) : -1,
    notificationDockY: Number.isInteger(value?.notificationDockY) ? Math.max(-1, Math.min(10000, value!.notificationDockY!)) : -1,
    sharedProjectViewOrder: projectViewOrder(value?.sharedProjectViewOrder),
    sharedCalendarScale: calendarScaleValue(value?.sharedCalendarScale),
    todayBlockOrder: todayBlockOrder(value?.todayBlockOrder),
  };
}

export type UiVisibility = AccountLayout & {
  sacredFeaturesEnabled: boolean;
  dreamJournalEnabled: boolean;
  hiddenMenuItems: string[];
  hiddenSubmenus: string[];
  hiddenTodayBlocks: string[];
  enabledCalendars: CalendarMode[];
  sidebarAutoCollapseSeconds: number;
};

export const DEFAULT_UI_VISIBILITY: UiVisibility = {
  ...DEFAULT_ACCOUNT_LAYOUT,
  sacredFeaturesEnabled: true, dreamJournalEnabled:true,
  hiddenMenuItems: [], hiddenSubmenus: [], hiddenTodayBlocks: [],
  enabledCalendars: ["profane", "sacred", "lunar"],
  sidebarAutoCollapseSeconds: 0,
};

export function uiVisibility(value?: Partial<UiVisibility> | null): UiVisibility {
  return {
    ...accountLayout(value),
    sacredFeaturesEnabled: value?.sacredFeaturesEnabled !== false,
    dreamJournalEnabled: value?.dreamJournalEnabled !== false,
    hiddenMenuItems: value?.hiddenMenuItems ?? [],
    hiddenSubmenus: value?.hiddenSubmenus ?? [],
    hiddenTodayBlocks: value?.hiddenTodayBlocks ?? [],
    enabledCalendars: value?.enabledCalendars?.length ? value.enabledCalendars : DEFAULT_UI_VISIBILITY.enabledCalendars,
    sidebarAutoCollapseSeconds: [0, 15, 30, 60, 120, 300].includes(value?.sidebarAutoCollapseSeconds ?? 0)
      ? value?.sidebarAutoCollapseSeconds ?? 0 : 0,
  };
}

/** Hiding the sacred layer never rewrites the account's calendar preferences. */
export function visibleCalendarModes(settings: UiVisibility): CalendarMode[] {
  if (!settings.sacredFeaturesEnabled) return ["profane"];
  const modes = settings.enabledCalendars;
  return modes.length ? modes : ["profane"];
}

export function visibleCalendarMode(mode: CalendarMode, settings: UiVisibility): CalendarMode {
  const modes = visibleCalendarModes(settings);
  return modes.includes(mode) ? mode : modes[0];
}

export function viewIsVisible(view: string, settings: UiVisibility): boolean {
  if (view === "today" || view === "admin") return true;
  if ((view === "stoicheion" || view === "theokyklos") && (!settings.sacredFeaturesEnabled || settings.hiddenMenuItems.includes("sacred"))) return false;
  const parent = view === "all-tasks" ? "tasks" : view === "year" ? "calendar" : view;
  if (settings.hiddenMenuItems.includes(parent)) return false;
  if (view === "calendar" && settings.hiddenSubmenus.includes("calendar.month")) return false;
  if (view === "year" && settings.hiddenSubmenus.includes("calendar.year")) return false;
  return true;
}
