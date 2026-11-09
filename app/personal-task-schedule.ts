import type { GenesisTask as Task, RecurrenceKind } from "./cloud-sync";
import { calendarDateNote, formatCalendarDate, getSacredDate, type CalendarMode } from "./calendar-data";
import { buildRecurrenceDates, recurrenceDatesForTask, resolveRecurrenceConfig, type RecurrenceConfig } from "./task-recurrence";
import { formatTimeValue, type TimeFormat } from "./time-format";
import { getRuntimeLanguage } from "./i18n";

function inputDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function nextOccurrenceDate(dueDate: string, recurrence: RecurrenceKind, interval: number) {
  if (recurrence === "none") return null;
  const next = new Date(`${dueDate}T12:00:00`);
  if (Number.isNaN(next.getTime())) return null;
  const step = Math.max(1, interval);

  if (recurrence === "weekdays") {
    let remaining = step;
    while (remaining > 0) {
      next.setDate(next.getDate() + 1);
      if (next.getDay() !== 0 && next.getDay() !== 6) remaining -= 1;
    }
  } else if (recurrence === "daily") {
    next.setDate(next.getDate() + step);
  } else if (recurrence === "weekly") {
    next.setDate(next.getDate() + step * 7);
  } else if (recurrence === "monthly") {
    next.setMonth(next.getMonth() + step);
  } else {
    next.setFullYear(next.getFullYear() + step);
  }
  return next;
}

export function shiftRangeEndDate(startDate: string, endDate: string, nextStartDate: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate || startDate}T12:00:00`);
  const nextEnd = new Date(`${nextStartDate}T12:00:00`);
  if ([start, end, nextEnd].some((date) => Number.isNaN(date.getTime()))) return nextStartDate;
  const durationDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  nextEnd.setDate(nextEnd.getDate() + durationDays);
  return inputDate(nextEnd);
}

export function buildTaskSeries(task: Task, rawConfig: RecurrenceConfig) {
  const config = resolveRecurrenceConfig(task.dueDate, rawConfig);
  if (!config.enabled) {
    return [{
      ...task,
      recurrence: "none" as const,
      recurrenceInterval: 1,
      recurrenceMode: "none" as const,
      recurrencePattern: "none" as const,
      recurrenceDays: [],
      recurrenceStartDate: null,
      recurrenceEndDate: null,
      recurrenceMonths: [],
      recurrencePyatas: [],
      recurrenceExcludedDates: [],
      recurrenceSeriesId: null,
    }];
  }

  const dates = buildRecurrenceDates(task.dueDate, config);
  const dueDate = dates[0] ?? task.dueDate;
  const date = new Date(`${dueDate}T12:00:00`);
  const sacred = getSacredDate(date);
  return [{
    ...task,
    sacredYear: sacred.sacredYear,
    monthIndex: sacred.monthIndex,
    day: sacred.day,
    dueDate,
    endDate: shiftRangeEndDate(task.dueDate, task.endDate, dueDate),
    recurrence: "none" as const,
    recurrenceInterval: config.interval,
    recurrenceMode: config.mode,
    recurrencePattern: config.pattern,
    recurrenceDays: [...config.days],
    recurrenceStartDate: config.rangeStart || dueDate,
    recurrenceEndDate: config.rangeEnd,
    recurrenceMonths: [...config.months],
    recurrencePyatas: [...config.pyatas],
    recurrenceContext: config.calendarContext,
    recurrenceInvalidDayPolicy: config.invalidDayPolicy,
    recurrenceExcludedDates: [],
    recurrenceSeriesId: null,
    calendarNote: calendarDateNote(date, task.calendarMode),
    // Google Tasks has no recurrence API. A recurring task is therefore
    // stored as one native Google Calendar series instead of N independent tasks.
    googleTaskListId: null,
    googleTaskListTitle: "",
    googleTaskId: null,
    googleEventId: task.googleTaskListId ? null : task.googleEventId,
    googleLinks: task.googleTaskListId ? {} : task.googleLinks,
  }];
}

export function taskForOccurrence(task: Task, occurrenceDate: string) {
  if (occurrenceDate === task.dueDate) return { ...task };
  const date = new Date(`${occurrenceDate}T12:00:00`);
  const sacred = getSacredDate(date);
  return {
    ...task,
    sacredYear: sacred.sacredYear,
    monthIndex: sacred.monthIndex,
    day: sacred.day,
    dueDate: occurrenceDate,
    endDate: shiftRangeEndDate(task.dueDate, task.endDate, occurrenceDate),
    calendarNote: calendarDateNote(date, task.calendarMode),
  };
}

export function standaloneTaskFromOccurrence(task: Task, parentSeriesId: string | null) {
  return {
    ...task,
    recurrence: "none" as const,
    recurrenceInterval: 1,
    recurrenceMode: "none" as const,
    recurrencePattern: "none" as const,
    recurrenceDays: [],
    recurrenceStartDate: null,
    recurrenceEndDate: null,
    recurrenceMonths: [],
    recurrencePyatas: [],
    recurrenceExcludedDates: [],
    recurrenceSeriesId: parentSeriesId,
  };
}

export function taskSeriesAfterExcludingOccurrence(task: Task, occurrenceDate: string) {
  const remainingDates = recurrenceDatesForTask(task).filter((date) => date !== occurrenceDate);
  if (!remainingDates.length) return null;
  const nextTask = {
    ...task,
    recurrenceExcludedDates: Array.from(new Set([...task.recurrenceExcludedDates, occurrenceDate])).sort(),
    updatedAt: Date.now(),
  };
  return occurrenceDate === task.dueDate ? taskForOccurrence(nextTask, remainingDates[0]) : nextTask;
}

export function taskWithSharedSeriesFields(task: Task, source: Task): Task {
  return {
    ...task,
    title: source.title,
    description: source.description,
    time: source.time,
    project: source.project,
    projectId: source.projectId,
    categoryId: source.categoryId,
    tags: [...source.tags],
    dependsOnIds: [...source.dependsOnIds],
    priority: source.priority,
    reminders: [...source.reminders],
    reminderMinutes: source.reminderMinutes,
    updatedAt: Date.now(),
  };
}

export function taskRangeLabel(task: Task, mode: CalendarMode = "sacred", timeFormat: TimeFormat = "24h") {
  if (!task.dueDate) return getRuntimeLanguage() === "en" ? "No date" : "Без даты";
  const recurrenceDates = recurrenceDatesForTask(task);
  const firstDate = recurrenceDates[0] ?? task.dueDate;
  const lastDate = recurrenceDates.at(-1) ?? task.dueDate;
  const start = formatCalendarDate(new Date(`${firstDate}T12:00:00`), mode, true);
  if (recurrenceDates.length > 1) {
    const finish = formatCalendarDate(new Date(`${lastDate}T12:00:00`), mode, true);
    const recurrenceLabel = getRuntimeLanguage() === "en"
      ? `${recurrenceDates.length} recurrences`
      : `${recurrenceDates.length} повторений`;
    return `${start} — ${finish} · ${recurrenceLabel}${task.time ? ` · ${formatTimeValue(task.time, timeFormat)}` : ""}`;
  }
  const endDate = task.endDate || task.dueDate;
  const end = endDate === task.dueDate
    ? ""
    : ` — ${formatCalendarDate(new Date(`${endDate}T12:00:00`), mode, true)}`;
  return `${start}${end}${task.time ? ` · ${formatTimeValue(task.time, timeFormat)}` : ""}`;
}
