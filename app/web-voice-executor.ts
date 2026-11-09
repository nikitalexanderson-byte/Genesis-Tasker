import type { GeminiPlan, GenesisCategory, GenesisProject, GenesisTask, GoogleTaskList } from "./cloud-sync";
import { defaultHabit, updateHabitCompletion, type HabitWorkspace } from "./habits";
import { localizeCategoryName, type Language } from "./i18n";
import { createLocalVoicePlan } from "./local-voice-plan";
import { parseWebVoiceAction } from "./web-voice-actions";
import type { CalendarMode } from "./calendar-data";
import { moodOption, type MoodEntry } from "./mood-tracker";
import { defaultSleepPlan, scoreSleepEntry, sleepDeviationMinutes, sleepDurationMinutes, type SleepEntry } from "./sleep-tracker";
import { markTrackerEntityChanged, newTrackerEntity, trackerTimestamp } from "./tracker-core";
import type { SacredPracticeSectorId } from "./sacred-practices";

type View = "today" | "calendar" | "year" | "all-tasks" | "projects" | "habits" | "theokyklos" | "stoicheion" | "admin";
type Request = { kind: "edit" | "delete" | "section"; id?: string; section?: string };
export type WebVoiceContext = {
  language: Language; calendarMode: CalendarMode; currentView: View;
  today: string; timeZone: string;
  persistentWorkspace: boolean;
  divinationDisabled?: boolean;
  categories: GenesisCategory[]; projects: GenesisProject[]; taskLists: GoogleTaskList[];
  accounts: { email: string }[]; tasks: GenesisTask[]; workspace: HabitWorkspace;
};
export type WebVoiceEffects = {
  navigate: (view: View) => void;
  requestHabit: (request: Request) => void;
  applyPlan: (plan: GeminiPlan) => Promise<string>;
  updateWorkspace: (workspace: HabitWorkspace) => void;
  openTask: (task: GenesisTask) => void;
  confirmTaskDelete: (task: GenesisTask) => void;
  openList: (list: GoogleTaskList) => void;
  deleteList: (list: GoogleTaskList) => Promise<boolean>;
  openProject: (project: GenesisProject) => void;
  deleteProject: (project: GenesisProject) => Promise<boolean>;
  createCategory: (title: string) => void;
  openCategory: (category: GenesisCategory) => void;
  deleteCategory: (category: GenesisCategory) => boolean;
  toggleTask: (id: string) => void;
  changeTask: (original: GenesisTask, changed: GenesisTask) => void;
  changeDisplayCalendar: (mode: CalendarMode) => Promise<void>;
  stepCalendar: (unit: "month" | "year", step: -1 | 1) => void;
  chooseCalendarMonth: (ordinal: number) => boolean;
  chooseCalendarDate: (date: Date) => void;
  scrollPage: (direction: "up" | "down" | "top" | "bottom") => boolean;
  openTheokyklosSector: (sectorId: SacredPracticeSectorId) => void;
  openStoicheionCard: (cardId: string) => void;
  requestStoicheionDraw: (kind: "daily" | "spread") => void;
};

export async function runWebVoiceCommand(command: string, context: WebVoiceContext, effects: WebVoiceEffects): Promise<string> {
  const { language, calendarMode, currentView, today, timeZone, persistentWorkspace,
    categories, projects, taskLists, accounts, tasks, workspace } = context;
  const { navigate, requestHabit, applyPlan, updateWorkspace, openTask, confirmTaskDelete, openList, deleteList,
    openProject, deleteProject, createCategory, openCategory, deleteCategory, toggleTask, changeTask,
    changeDisplayCalendar, stepCalendar, chooseCalendarMonth, chooseCalendarDate, scrollPage,
    openTheokyklosSector, openStoicheionCard, requestStoicheionDraw } = effects;
  const voiceLists = taskLists.filter((list) => !list.isDefault && list.title !== "Привычки GENESIS");
  const action = parseWebVoiceAction(command, tasks, projects, workspace.habits, language, voiceLists,
    categories.map((category) => ({ id: category.id, title: localizeCategoryName(category, language) })));
  const reply = (ru: string, en: string) => language === "en" ? en : ru;
  if (!action) return reply("Пока не умею это делать. Попробуйте открыть раздел или назвать задачу, проект, список либо привычку.",
    "I cannot do that yet. Try opening a section or naming a task, project, list or habit.");
  if (action.kind === "calendar-mode") {
    await changeDisplayCalendar(action.mode);
    navigate("calendar");
    return reply("Календарь переключён.", "Calendar switched.");
  }
  if (action.kind === "calendar-view") {
    navigate(action.view);
    return reply(action.view === "year" ? "Открыт год." : "Открыт месяц.", action.view === "year" ? "Year opened." : "Month opened.");
  }
  if (action.kind === "calendar-step" || action.kind === "calendar-swipe") {
    if (action.kind === "calendar-swipe" && currentView !== "calendar" && currentView !== "year") {
      return reply("Свайп голосом доступен в календаре. Назовите нужный раздел.", "Voice swipe is available in the calendar. Name a section.");
    }
    const unit = action.kind === "calendar-step" ? action.unit : currentView === "year" ? "year" : "month";
    stepCalendar(unit, action.step);
    navigate(unit === "year" ? "year" : "calendar");
    return reply(unit === "year" ? "Год переключён." : "Месяц переключён.", unit === "year" ? "Year changed." : "Month changed.");
  }
  if (action.kind === "calendar-date") {
    const date = new Date(action.year, action.month - 1, action.day, 12);
    if (date.getFullYear() !== action.year || date.getMonth() !== action.month - 1 || date.getDate() !== action.day || action.year < 1900 || action.year > 2100) {
      return reply("Проверьте дату: такой даты нет или она вне диапазона календаря.", "Check the date: it does not exist or is outside the calendar range.");
    }
    chooseCalendarDate(date);
    navigate("calendar");
    return reply("Дата выбрана в календаре.", "Date selected in the calendar.");
  }
  if (action.kind === "calendar-month") {
    if (!chooseCalendarMonth(action.ordinal)) return reply("В этом году нет такого месяца.", "There is no such month in this year.");
    navigate("calendar");
    return reply("Месяц выбран.", "Month selected.");
  }
  if (action.kind === "scroll") {
    return scrollPage(action.direction) ? reply("Прокручено.", "Scrolled.")
      : reply("На этом экране нечего прокручивать.", "There is nothing to scroll on this screen.");
  }
  if (action.kind === "theokyklos-sector") {
    openTheokyklosSector(action.sectorId);
    return reply("Сектор Теокиклоса открыт.", "Theokyklos sector opened.");
  }
  if (action.kind === "stoicheion-card") {
    openStoicheionCard(action.cardId);
    navigate("stoicheion");
    return reply("Карта Стойхейона открыта.", "Stoicheion card opened.");
  }
  if (action.kind === "navigate") {
    navigate(action.section);
    if (action.section === "habits") {
      const section = /(?:сон и настроение|sleep and mood)/i.test(command) ? "modules"
        : /(?:путь героя|hero path)/i.test(command) ? "progress" : "library";
      requestHabit({ kind: "section", section });
    }
    return reply("Раздел открыт.", "Section opened.");
  }
  if (action.kind === "create-project" || action.kind === "create-list") {
    return applyPlan({
      request: command, summary: command,
      projects: action.kind === "create-project" ? [{ title: action.title, description: "", parentProject: "", category: "", tags: [] }] : [],
      taskLists: action.kind === "create-list" ? [{ title: action.title, project: "", accountEmail: "" }] : [],
      tasks: [],
    });
  }
  if (action.kind === "create-task") {
    return applyPlan(createLocalVoicePlan(command, {
      language, calendarMode, today, timeZone,
      categories: categories.map((category) => ({ name: localizeCategoryName(category, language) })),
      projects: projects.map((project) => ({ title: project.title,
        parent: projects.find((candidate) => candidate.id === project.parentId)?.title ?? "",
        category: categories.find((category) => category.id === project.categoryId)?.name ?? "" })),
      taskLists: taskLists.map((taskList) => ({ title: taskList.title, accountEmail: taskList.accountEmail ?? "" })),
      accounts,
    }));
  }
  if (action.kind === "create-habit") {
    const habit = { ...defaultHabit(today, calendarMode), title: action.title };
    updateWorkspace({ ...workspace, habits: [...workspace.habits, habit] });
    navigate("habits");
    return reply("Привычка создана.", "Habit created.");
  }
  if (action.kind === "set-mood") {
    const current = workspace.moodEntries.find((entry) => entry.date === today);
    const entry = markTrackerEntityChanged<MoodEntry>({
      ...(current ?? { ...newTrackerEntity("mood"), date: today, note: "", tags: [] }),
      recordedAt: trackerTimestamp(), moodValue: action.value, customLabel: "", customEmoji: "",
    });
    updateWorkspace({ ...workspace, moodEntries: [...workspace.moodEntries.filter((item) => item.date !== today), entry] });
    navigate("habits");
    requestHabit({ kind: "section", section: "modules" });
    const option = moodOption(action.value);
    if (!persistentWorkspace) return reply("Настроение выбрано для этой сессии. Войдите, чтобы сохранить.",
      "Mood selected for this session. Sign in to save it.");
    return reply(`Настроение отмечено: ${option.label}.`, `Mood recorded: ${option.labelEn}.`);
  }
  if (action.kind === "stoicheion-draw") {
    if (context.divinationDisabled) return reply("Гадания отключены в настройках Стойхейона.", "Card draws are disabled in Stoicheion settings.");
    requestStoicheionDraw(action.drawKind);
    navigate("stoicheion");
    return reply(action.drawKind === "daily" ? "Открываю карту дня." : "Выбираю девять карт.",
      action.drawKind === "daily" ? "Opening the daily card." : "Drawing nine cards.");
  }
  if (action.kind === "set-sleep" || action.kind === "set-sleep-plan") {
    const plan = workspace.sleepPlans.find((item) => item.active)
      ?? (workspace.sleepPlans.length ? null : defaultSleepPlan(today, calendarMode));
    if (!plan) return reply("План сна на паузе. Включите его в разделе сна.", "Sleep plan is paused. Enable it in Sleep settings.");
    const plans = workspace.sleepPlans.some((item) => item.id === plan.id) ? workspace.sleepPlans : [...workspace.sleepPlans, plan];
    if (action.kind === "set-sleep-plan") {
      const changed = markTrackerEntityChanged({ ...plan,
        targetBedtime: action.bedtime ?? plan.targetBedtime,
        targetWakeTime: action.wakeTime ?? plan.targetWakeTime,
        reminderEnabled: action.reminderEnabled ?? plan.reminderEnabled,
        reminderMinutesBefore: action.reminderMinutesBefore ?? plan.reminderMinutesBefore,
      });
      updateWorkspace({ ...workspace, sleepPlans: plans.map((item) => item.id === plan.id ? changed : item) });
      navigate("habits"); requestHabit({ kind: "section", section: "modules" });
      return persistentWorkspace ? reply("План сна обновлён.", "Sleep plan updated.")
        : reply("План сна изменён в этой сессии. Войдите, чтобы сохранить.", "Sleep plan changed for this session. Sign in to save it.");
    }
    const current = workspace.sleepEntries.find((item) => item.planId === plan.id && item.date === today);
    const bedtime = action.bedtime ?? current?.fellAsleepAt ?? "";
    const wakeTime = action.wakeTime ?? current?.wokeAt ?? "";
    const draft = { date: today, fellAsleepAt: bedtime, wokeAt: wakeTime };
    const entry = markTrackerEntityChanged<SleepEntry>({
      ...(current ?? { ...newTrackerEntity("sleep-entry"), planId: plan.id, date: today, note: "" }),
      ...draft, quality: action.quality ?? current?.quality ?? null,
      durationMinutes: sleepDurationMinutes(today, bedtime, wakeTime, plan.schedule.timezone || timeZone),
      deviationMinutes: sleepDeviationMinutes(plan, draft), score: scoreSleepEntry(plan, draft),
    });
    updateWorkspace({ ...workspace, sleepPlans: plans,
      sleepEntries: [...workspace.sleepEntries.filter((item) => item.planId !== plan.id || item.date !== today), entry] });
    navigate("habits"); requestHabit({ kind: "section", section: "modules" });
    return persistentWorkspace ? reply("Сон записан.", "Sleep recorded.")
      : reply("Сон записан для этой сессии. Войдите, чтобы сохранить.", "Sleep recorded for this session. Sign in to save it.");
  }
  if (action.kind === "create-category") {
    createCategory(action.title);
    navigate("projects");
    return reply("Категория создана.", "Category created.");
  }
  if (action.kind === "rename-task") {
    const task = tasks.find((item) => item.id === action.id);
    if (!task) return reply("Задача больше не найдена.", "Task was not found.");
    changeTask(task, { ...task, title: action.newTitle, updatedAt: Date.now() });
    navigate("all-tasks");
    return reply("Название задачи изменено.", "Task renamed.");
  }
  if (action.kind === "edit-task") {
    const task = tasks.find((item) => item.id === action.id);
    if (!task) return reply("Задача больше не найдена.", "Task was not found.");
    openTask(task);
    return reply("Открыта форма задачи.", "Task editor opened.");
  }
  if (action.kind === "delete-task") {
    const task = tasks.find((item) => item.id === action.id);
    if (!task) return reply("Задача больше не найдена.", "Task was not found.");
    navigate("all-tasks");
    confirmTaskDelete(task);
    return reply("Проверьте подтверждение удаления задачи.", "Confirm task deletion.");
  }
  if (action.kind === "edit-list" || action.kind === "delete-list") {
    const list = taskLists.find((item) => item.id === action.id);
    if (!list) return reply("Список больше не найден.", "Task list was not found.");
    if (action.kind === "edit-list") {
      navigate("all-tasks");
      openList(list);
      return reply("Открыта форма списка задач.", "Task list editor opened.");
    }
    return await deleteList(list)
      ? reply("Список удалён.", "Task list deleted.")
      : reply("Удаление списка отменено или не выполнено.", "Task list deletion was cancelled or failed.");
  }
  if (action.kind === "edit-project") {
    const project = projects.find((item) => item.id === action.id);
    if (!project) return reply("Проект больше не найден.", "Project was not found.");
    navigate("projects");
    openProject(project);
    return reply("Открыта форма проекта.", "Project editor opened.");
  }
  if (action.kind === "delete-project") {
    const project = projects.find((item) => item.id === action.id);
    if (!project) return reply("Проект больше не найден.", "Project was not found.");
    return await deleteProject(project)
      ? reply("Проект удалён.", "Project deleted.")
      : reply("Удаление проекта отменено или не выполнено.", "Project deletion was cancelled or failed.");
  }
  if (action.kind === "edit-category" || action.kind === "delete-category") {
    const category = categories.find((item) => item.id === action.id);
    if (!category) return reply("Категория больше не найдена.", "Category was not found.");
    if (action.kind === "edit-category") {
      navigate("projects");
      openCategory(category);
      return reply("Открыта форма категории.", "Category editor opened.");
    }
    return deleteCategory(category)
      ? reply("Категория удалена.", "Category deleted.")
      : reply("Удаление категории отменено.", "Category deletion was cancelled.");
  }
  if (action.kind === "edit-habit" || action.kind === "delete-habit") {
    navigate("habits");
    requestHabit({ kind: action.kind === "edit-habit" ? "edit" : "delete", id: action.id });
    return reply(action.kind === "edit-habit" ? "Открыта форма привычки." : "Проверьте подтверждение удаления привычки.",
      action.kind === "edit-habit" ? "Habit editor opened." : "Confirm habit deletion.");
  }
  if (action.kind === "complete-task" || action.kind === "uncomplete-task") {
    const task = tasks.find((item) => item.id === action.id);
    if (!task) return reply("Задача больше не найдена.", "Task was not found.");
    const desired = action.kind === "complete-task";
    if (task.done !== desired) {
      if (desired && task.dependsOnIds.some((id) => tasks.some((item) => item.id === id && !item.done))) {
        return reply("Сначала завершите связанные задачи.", "Complete dependent tasks first.");
      }
      toggleTask(task.id);
    }
    navigate("all-tasks");
    return reply(desired ? "Задача выполнена." : "Отметка задачи снята.", desired ? "Task completed." : "Task completion cleared.");
  }
  if (action.kind === "complete-habit" || action.kind === "uncomplete-habit") {
    const habit = workspace.habits.find((item) => item.id === action.id);
    if (!habit) return reply("Привычка больше не найдена.", "Habit was not found.");
    updateWorkspace(updateHabitCompletion(workspace, habit, today, { completed: action.kind === "complete-habit" }));
    navigate("habits");
    return reply(action.kind === "complete-habit" ? "Привычка выполнена." : "Отметка привычки снята.",
      action.kind === "complete-habit" ? "Habit completed." : "Habit completion cleared.");
  }
  if (action.kind === "move-task") {
    const task = tasks.find((item) => item.id === action.id);
    if (!task) return reply("Задача больше не найдена.", "Task was not found.");
    const target = projects.find((item) => item.id === action.projectId);
    changeTask(task, { ...task, projectId: target?.id ?? null, project: target?.title ?? "",
      categoryId: target?.categoryId ?? null, updatedAt: Date.now() });
    navigate("projects");
    return reply("Задача перемещена.", "Task moved.");
  }
  return reply("Пока не умею это делать.", "I cannot do that yet.");
}
