import type { GeminiAssistantContext, GeminiPlan, GeminiPlanTask } from "./cloud-sync";

const RU_MONTHS: Record<string, number> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

const EN_MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const WEEKDAYS: Record<string, number> = {
  понедельник: 1,
  понедельника: 1,
  вторник: 2,
  вторника: 2,
  среду: 3,
  среды: 3,
  четверг: 4,
  четверга: 4,
  пятницу: 5,
  пятницы: 5,
  субботу: 6,
  субботы: 6,
  воскресенье: 0,
  воскресенья: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

type Extraction<T> = { text: string; value: T };

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
      ? date
      : null;
}

function formatIsoDate(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function removeMatch(text: string, match: RegExpExecArray) {
  return normalizeSpaces(`${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`);
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(year, month, day, 12);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

function futureCalendarDate(today: Date, month: number, day: number, explicitYear?: number) {
  const year = explicitYear ?? today.getFullYear();
  let date = validDate(year, month, day);
  if (!date) return null;
  if (explicitYear === undefined && date < today) date = validDate(year + 1, month, day);
  return date;
}

function extractDate(source: string, todayIso: string): Extraction<string> {
  const today = parseIsoDate(todayIso) ?? new Date();
  today.setHours(12, 0, 0, 0);
  let match = /(?<![\p{L}\p{N}_])(?:на\s+|on\s+)?(послезавтра|day after tomorrow|завтра|tomorrow|сегодня|today)(?![\p{L}\p{N}_])/iu.exec(source);
  if (match) {
    const key = match[1].toLocaleLowerCase();
    const offset = key === "послезавтра" || key === "day after tomorrow" ? 2 : key === "завтра" || key === "tomorrow" ? 1 : 0;
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return { text: removeMatch(source, match), value: formatIsoDate(date) };
  }

  match = /(?<![\p{L}\p{N}_])(?:на\s+|on\s+)?(\d{4}-\d{2}-\d{2})(?![\p{L}\p{N}_])/iu.exec(source);
  if (match) {
    const date = parseIsoDate(match[1]);
    if (date && date >= today) return { text: removeMatch(source, match), value: formatIsoDate(date) };
  }

  match = /(?<![\p{L}\p{N}_])(?:на\s+|on\s+)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?![\p{L}\p{N}_])/iu.exec(source);
  if (match) {
    const yearPart = match[3] ? Number(match[3]) : undefined;
    const year = yearPart === undefined ? undefined : yearPart < 100 ? 2000 + yearPart : yearPart;
    const date = futureCalendarDate(today, Number(match[2]) - 1, Number(match[1]), year);
    if (date && date >= today) return { text: removeMatch(source, match), value: formatIsoDate(date) };
  }

  const monthNames = [...Object.keys(RU_MONTHS), ...Object.keys(EN_MONTHS)].join("|");
  match = new RegExp(`(?<![\\p{L}\\p{N}_])(?:на\\s+|on\\s+)?(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?(?![\\p{L}\\p{N}_])`, "iu").exec(source);
  if (match) {
    const monthName = match[2].toLocaleLowerCase();
    const date = futureCalendarDate(today, RU_MONTHS[monthName] ?? EN_MONTHS[monthName], Number(match[1]), match[3] ? Number(match[3]) : undefined);
    if (date && date >= today) return { text: removeMatch(source, match), value: formatIsoDate(date) };
  }

  match = new RegExp(`(?<![\\p{L}\\p{N}_])(?:on\\s+)?(${Object.keys(EN_MONTHS).join("|")})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?(?![\\p{L}\\p{N}_])`, "iu").exec(source);
  if (match) {
    const date = futureCalendarDate(today, EN_MONTHS[match[1].toLocaleLowerCase()], Number(match[2]), match[3] ? Number(match[3]) : undefined);
    if (date && date >= today) return { text: removeMatch(source, match), value: formatIsoDate(date) };
  }

  match = new RegExp(`(?<![\\p{L}\\p{N}_])(?:(?:в|на|on|next)\\s+)?(${Object.keys(WEEKDAYS).join("|")})(?![\\p{L}\\p{N}_])`, "iu").exec(source);
  if (match) {
    const weekday = WEEKDAYS[match[1].toLocaleLowerCase()];
    const date = new Date(today);
    const delta = (weekday - today.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + delta);
    return { text: removeMatch(source, match), value: formatIsoDate(date) };
  }

  return { text: source, value: todayIso };
}

function extractTime(source: string): Extraction<string> {
  let match = /(?<![\p{L}\p{N}_])(?:в|на|at)?\s*(\d{1,2})[:.](\d{2})\s*(?:час(?:а|ов)?\s*)?(утра|дня|вечера|ночи|am|pm)?(?![\p{L}\p{N}_])/iu.exec(source);
  if (!match) match = /(?<![\p{L}\p{N}_])(?:в|на|at)\s+(\d{1,2})\s*(?:час(?:а|ов)?\s*)?(утра|дня|вечера|ночи|am|pm)?(?![\p{L}\p{N}_])/iu.exec(source);
  if (!match) return { text: source, value: "" };
  let hour = Number(match[1]);
  const minute = match[2] && /^\d{2}$/.test(match[2]) ? Number(match[2]) : 0;
  const period = (match[3] && !/^\d{2}$/.test(match[3]) ? match[3] : match[2] && !/^\d{2}$/.test(match[2]) ? match[2] : "").toLocaleLowerCase();
  if ((period === "вечера" || period === "дня" || period === "pm") && hour < 12) hour += 12;
  if ((period === "утра" || period === "ночи" || period === "am") && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return { text: source, value: "" };
  return {
    text: removeMatch(source, match),
    value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function extractNumber(source: string, expression: RegExp, fallback: number): Extraction<number> {
  const match = expression.exec(source);
  if (!match) return { text: source, value: fallback };
  return { text: removeMatch(source, match), value: Number(match[1]) };
}

function extractKnownName(source: string, marker: RegExp, names: string[]): Extraction<string> {
  const markerMatch = marker.exec(source);
  if (!markerMatch) return { text: source, value: "" };
  const tail = source.slice(markerMatch.index + markerMatch[0].length).trimStart();
  const normalizedTail = tail.replace(/^[«"“]/, "").toLocaleLowerCase();
  const name = [...names]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => {
      const normalized = candidate.toLocaleLowerCase();
      return normalizedTail === normalized
        || normalizedTail.startsWith(`${normalized} `)
        || normalizedTail.startsWith(`${normalized}»`)
        || normalizedTail.startsWith(`${normalized}"`)
        || normalizedTail.startsWith(`${normalized}”`)
        || normalizedTail.startsWith(`${normalized},`);
    });
  if (!name) return { text: source, value: "" };
  const quotedName = `[«"“]?${escapeRegExp(name)}[»"”]?`;
  const fullMatch = new RegExp(`(?:${marker.source})\\s*${quotedName}`, "i").exec(source);
  return fullMatch ? { text: removeMatch(source, fullMatch), value: name } : { text: source, value: "" };
}

function cleanTitle(source: string) {
  let title = normalizeSpaces(source);
  const russianCommandPrefix = /^(?:(?:ну|пожалуйста)\s*[,—–-]?\s*)*(?:(?:мне\s+)?(?:нужно|надо)\s+)?(?:(?:создай|создать|добавь|добавить|запиши|записать|запланируй|запланировать|поставь|поставить)(?:\s+мне)?(?:\s+(?:новую?\s+)?(?:задач[а-яё]*|напоминан[а-яё]*))?|напомни(?:\s+мне)?|задачу)\s*[.:;—–,-]?\s*/iu;
  const englishCommandPrefix = /^(?:please\s+)?(?:(?:create|add|schedule|plan|make)(?:\s+me)?(?:\s+(?:a\s+)?(?:new\s+)?(?:task|reminder))?|remind\s+me(?:\s+to)?)\s*[.:;—–,-]?\s*/i;
  title = normalizeSpaces(title.replace(russianCommandPrefix, "").replace(englishCommandPrefix, ""));
  title = normalizeSpaces(title.replace(/^(?:задач[а-яё]*|напоминан[а-яё]*|task|reminder)\s*[:—–-]\s*/iu, ""));
  title = normalizeSpaces(title.replace(/^(?:(?:под|с)\s+названием|по\s+имени|(?:назови|назвать)(?:\s+(?:е[её]|задачу))?|которую\s+назови|название(?:\s+задачи)?|которая\s+называется|with\s+(?:the\s+)?(?:title|name)|named|called)\s*[:—–,-]?\s*/iu, ""));
  return title
    .replace(/\s+(?:размести(?:ть)?|помести(?:ть)?|привяжи|добавь|добавить|перенеси(?:ть)?|assign|put|place|move)\s*$/i, "")
    .replace(/\s+(?:пожалуйста|please)$/i, "")
    .replace(/^[«"“\s]+|[»"”\s.,!?]+$/g, "")
    .trim();
}

function parseTask(command: string, context: GeminiAssistantContext): GeminiPlanTask {
  let remaining = normalizeSpaces(command);
  const tags = Array.from(remaining.matchAll(/#([\p{L}\p{N}_-]+)/gu), (match) => match[1]).slice(0, 6);
  remaining = normalizeSpaces(remaining.replace(/#[\p{L}\p{N}_-]+/gu, " "));

  const project = extractKnownName(
    remaining,
    /(?:(?:в|во|для|к|ко|по)\s+)?проект(?:е|а|у)?(?:\s+(?:под\s+названием|с\s+названием))?|(?:(?:in|into|for|to)\s+)?project(?:\s+(?:named|called))?/i,
    context.projects.map((item) => item.title),
  );
  remaining = project.text;
  const taskList = extractKnownName(remaining, /(?:в\s+)?списк(?:е|ок)|(?:in\s+)?(?:task\s+)?list/i, context.taskLists.map((item) => item.title));
  remaining = taskList.text;

  const priority = extractNumber(remaining, /(?<![\p{L}\p{N}_])(?:приоритет|priority)\s*(?:p)?\s*(10|[1-9])(?![\p{L}\p{N}_])/iu, 5);
  remaining = priority.text;
  const reminder = extractNumber(remaining, /(?<![\p{L}\p{N}_])(?:напомни\s+)?за\s+(\d{1,4})\s*(?:минут(?:у|ы)?|мин|minutes?|mins?)(?![\p{L}\p{N}_])/iu, 0);
  remaining = reminder.text;
  const date = extractDate(remaining, context.today);
  remaining = date.text;
  const time = extractTime(remaining);
  remaining = time.text;

  const title = cleanTitle(remaining);
  const genericTitle = /^(?:(?:создай|создать|добавь|добавить|поставь|поставить)\s+)?(?:новую?\s+)?(?:задач[а-яё]*|напоминан[а-яё]*)$|^(?:(?:create|add|make)\s+)?(?:a\s+)?(?:new\s+)?(?:task|reminder)$/iu.test(title);
  if (!title || genericTitle) throw new Error(context.language === "en" ? "Say or type a task title." : "Произнесите или напишите название задачи.");
  return {
    title: title.slice(0, 300),
    description: "",
    startDate: date.value,
    dueDate: date.value,
    time: time.value,
    project: project.value,
    taskList: taskList.value,
    tags,
    priority: Math.min(10, Math.max(1, priority.value || 5)),
    reminderMinutes: Math.min(40320, Math.max(0, reminder.value || 0)),
  };
}

export function createLocalVoicePlan(command: string, context: GeminiAssistantContext): GeminiPlan {
  const request = normalizeSpaces(command);
  if (!request) throw new Error(context.language === "en" ? "Say or type a command first." : "Сначала произнесите или напишите команду.");
  const commands = command.split(/\s*;\s*|\r?\n+/).map(normalizeSpaces).filter(Boolean).slice(0, 10);
  const tasks = commands.map((item) => parseTask(item, context));
  return {
    request,
    summary: context.language === "en"
      ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} ready to create`
      : `Готово к созданию задач: ${tasks.length}`,
    projects: [],
    taskLists: [],
    tasks,
  };
}
