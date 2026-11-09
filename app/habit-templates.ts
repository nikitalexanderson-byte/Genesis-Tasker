export type HabitTemplateId =
  | "daily-plan"
  | "morning-water"
  | "morning-mobility"
  | "walk"
  | "reading"
  | "focus-session"
  | "meditation"
  | "ten-minute-reset"
  | "evening-review"
  | "screen-free-bedtime";

export type HabitTemplate = {
  id: HabitTemplateId;
  icon: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  frequency: string;
  frequencyEn: string;
  schedulePreset: "daily" | "weekdays";
  suggestedTime: string;
  color: string;
};

export const HABIT_COLORS = [
  "#bb8f4a", "#2d7771", "#5271a8", "#8b5f83", "#9b5d4a", "#668b55", "#b06779",
  "#c7a84b", "#348c83", "#3d8fb0", "#3f5e98", "#7258a3", "#a65372", "#c8534f",
  "#cf713d", "#7e6a55", "#5f6f77", "#687271", "#294b4a", "#1f3c5a", "#2a2524",
] as const;

export const STARTER_HABIT_TEMPLATES: readonly HabitTemplate[] = [
  {
    id: "daily-plan",
    icon: "🗓️",
    title: "План на день",
    titleEn: "Plan the day",
    description: "5 минут утром, чтобы определить главные задачи дня.",
    descriptionEn: "Five morning minutes to define the day's main tasks.",
    frequency: "Ежедневно · утром",
    frequencyEn: "Daily · morning",
    schedulePreset: "daily",
    suggestedTime: "08:00",
    color: HABIT_COLORS[0],
  },
  {
    id: "morning-water",
    icon: "💧",
    title: "Стакан воды после пробуждения",
    titleEn: "A glass of water after waking",
    description: "Начать день с простого действия.",
    descriptionEn: "Begin the day with one simple action.",
    frequency: "Ежедневно",
    frequencyEn: "Daily",
    schedulePreset: "daily",
    suggestedTime: "07:30",
    color: HABIT_COLORS[1],
  },
  {
    id: "morning-mobility",
    icon: "🤸",
    title: "Утренняя разминка",
    titleEn: "Morning mobility",
    description: "5–10 минут движения после пробуждения.",
    descriptionEn: "Five to ten minutes of movement after waking.",
    frequency: "Ежедневно",
    frequencyEn: "Daily",
    schedulePreset: "daily",
    suggestedTime: "07:45",
    color: HABIT_COLORS[5],
  },
  {
    id: "walk",
    icon: "🚶",
    title: "Прогулка",
    titleEn: "Walk",
    description: "Минимум 20 минут движения на свежем воздухе.",
    descriptionEn: "At least twenty minutes of movement outdoors.",
    frequency: "Ежедневно",
    frequencyEn: "Daily",
    schedulePreset: "daily",
    suggestedTime: "18:00",
    color: HABIT_COLORS[5],
  },
  {
    id: "reading",
    icon: "📚",
    title: "Чтение",
    titleEn: "Reading",
    description: "20 минут чтения без отвлечений.",
    descriptionEn: "Twenty minutes of distraction-free reading.",
    frequency: "Ежедневно",
    frequencyEn: "Daily",
    schedulePreset: "daily",
    suggestedTime: "20:00",
    color: HABIT_COLORS[2],
  },
  {
    id: "focus-session",
    icon: "🎯",
    title: "Фокус-сессия",
    titleEn: "Focus session",
    description: "Не менее 30 минут сосредоточенной работы над одной важной задачей.",
    descriptionEn: "At least thirty focused minutes on one important task.",
    frequency: "Понедельник–пятница",
    frequencyEn: "Monday–Friday",
    schedulePreset: "weekdays",
    suggestedTime: "10:00",
    color: HABIT_COLORS[3],
  },
  {
    id: "meditation",
    icon: "🧘",
    title: "Медитация / дыхательная практика",
    titleEn: "Meditation / breathing practice",
    description: "5 минут спокойного наблюдения или дыхательной практики.",
    descriptionEn: "Five minutes of quiet observation or breathing practice.",
    frequency: "Ежедневно",
    frequencyEn: "Daily",
    schedulePreset: "daily",
    suggestedTime: "08:15",
    color: HABIT_COLORS[3],
  },
  {
    id: "ten-minute-reset",
    icon: "🧹",
    title: "10 минут порядка",
    titleEn: "Ten-minute reset",
    description: "Небольшая уборка или организация пространства.",
    descriptionEn: "A brief tidy-up or reset of your space.",
    frequency: "Ежедневно",
    frequencyEn: "Daily",
    schedulePreset: "daily",
    suggestedTime: "19:00",
    color: HABIT_COLORS[0],
  },
  {
    id: "evening-review",
    icon: "✍️",
    title: "Вечерний обзор дня",
    titleEn: "Evening review",
    description: "Кратко вспомнить сделанное и определить главное на завтра.",
    descriptionEn: "Briefly review what was done and choose tomorrow's priority.",
    frequency: "Ежедневно · вечером",
    frequencyEn: "Daily · evening",
    schedulePreset: "daily",
    suggestedTime: "21:00",
    color: HABIT_COLORS[6],
  },
  {
    id: "screen-free-bedtime",
    icon: "🌙",
    title: "Без экрана перед сном",
    titleEn: "Screen-free before bed",
    description: "Отложить телефон и другие экраны минимум за 30 минут до сна.",
    descriptionEn: "Put away phones and other screens at least thirty minutes before sleep.",
    frequency: "Ежедневно · вечером",
    frequencyEn: "Daily · evening",
    schedulePreset: "daily",
    suggestedTime: "22:30",
    color: HABIT_COLORS[4],
  },
] as const;

const HABIT_TEMPLATE_IDS = new Set<HabitTemplateId>(STARTER_HABIT_TEMPLATES.map((template) => template.id));

export function isHabitTemplateId(value: unknown): value is HabitTemplateId {
  return typeof value === "string" && HABIT_TEMPLATE_IDS.has(value as HabitTemplateId);
}

export function starterTemplateRecurrencePreset(template: HabitTemplate, calendarMode: "sacred" | "lunar" | "profane") {
  if (calendarMode === "profane") {
    return template.schedulePreset === "weekdays"
      ? { mode: "classic" as const, pattern: "weekdays" as const, days: [1, 2, 3, 4, 5], months: [], pyatas: [] }
      : { mode: "classic" as const, pattern: "daily" as const, days: [], months: [], pyatas: [] };
  }
  if (calendarMode === "sacred") {
    return { mode: "genesis" as const, pattern: "pyata-days" as const, days: [1, 2, 3, 4, 5], months: [], pyatas: [] };
  }
  return { mode: "lunar" as const, pattern: "lunar-days" as const, days: Array.from({ length: 30 }, (_, index) => index + 1), months: [], pyatas: [] };
}
