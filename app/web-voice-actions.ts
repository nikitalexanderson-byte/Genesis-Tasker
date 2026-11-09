import type { MoodValue } from "./mood-tracker";
import type { SacredPracticeSectorId } from "./sacred-practices";

export type WebVoiceAction =
  | { kind: "navigate"; section: "today" | "calendar" | "year" | "all-tasks" | "projects" | "habits" | "theokyklos" | "stoicheion" | "admin" }
  | { kind: "calendar-mode"; mode: "sacred" | "lunar" | "profane" }
  | { kind: "calendar-view"; view: "calendar" | "year" }
  | { kind: "calendar-step"; unit: "month" | "year"; step: -1 | 1 }
  | { kind: "calendar-swipe"; step: -1 | 1 }
  | { kind: "calendar-date"; year: number; month: number; day: number }
  | { kind: "calendar-month"; ordinal: number }
  | { kind: "scroll"; direction: "up" | "down" | "top" | "bottom" }
  | { kind: "theokyklos-sector"; sectorId: SacredPracticeSectorId }
  | { kind: "stoicheion-card"; cardId: string }
  | { kind: "stoicheion-draw"; drawKind: "daily" | "spread" }
  | { kind: "set-mood"; value: MoodValue }
  | { kind: "set-sleep"; bedtime?: string; wakeTime?: string; quality?: number }
  | { kind: "set-sleep-plan"; bedtime?: string; wakeTime?: string; reminderEnabled?: boolean; reminderMinutesBefore?: number }
  | { kind: "rename-task"; id: string; title: string; newTitle: string }
  | { kind: "create-project" | "create-list" | "create-habit" | "create-task" | "create-category"; title: string }
  | { kind: "edit-task" | "delete-task" | "edit-list" | "delete-list" | "edit-project" | "delete-project" | "edit-category" | "delete-category" | "edit-habit" | "delete-habit" | "complete-task" | "uncomplete-task" | "complete-habit" | "uncomplete-habit"; id: string; title: string }
  | { kind: "move-task"; id: string; title: string; projectId: string | null };

type Named = { id: string; title: string };

const MOOD_NAMES: ReadonlyArray<readonly [MoodValue, RegExp]> = [
  [-5, /^(?:крайне тяжело|очень плохо|terrible|very bad)$/iu],
  [-4, /^(?:опустошённость|опустошенность|пусто|drained)$/iu],
  [-3, /^(?:грусть|грустно|печально|sad)$/iu],
  [-2, /^(?:тревога|тревожно|anxious)$/iu],
  [-1, /^(?:усталость|устал|устала|tired)$/iu],
  [0, /^(?:нейтрально|нормально|neutral|okay|fine)$/iu],
  [1, /^(?:спокойствие|спокойно|calm)$/iu],
  [2, /^(?:сосредоточенность|сосредоточен|сосредоточена|focused)$/iu],
  [3, /^(?:уверенность|уверенно|confident)$/iu],
  [4, /^(?:радость|радостно|happy|joyful)$/iu],
  [5, /^(?:воодушевление|воодушевлён|воодушевлен|inspired)$/iu],
  [6, /^(?:восторг|в восторге|delighted|ecstatic)$/iu],
];

const SECTOR_ALIASES: ReadonlyArray<readonly [SacredPracticeSectorId, string[]]> = [
  ["north", ["север", "северный", "north", "northern"]],
  ["northeast", ["северо-восток", "северо-восточный", "northeast", "north east", "north-eastern", "northeastern"]],
  ["east", ["восток", "восточный", "east", "eastern"]],
  ["southeast", ["юго-восток", "юго-восточный", "southeast", "south east", "south-eastern", "southeastern"]],
  ["south", ["юг", "южный", "south", "southern"]],
  ["southwest", ["юго-запад", "юго-западный", "southwest", "south west", "south-western", "southwestern"]],
  ["west", ["запад", "западный", "west", "western"]],
  ["northwest", ["северо-запад", "северо-западный", "northwest", "north west", "north-western", "northwestern"]],
  ["zenith", ["зенит", "zenith"]], ["nadir", ["надир", "nadir"]],
  ["hearth", ["очаг", "hearth"]], ["center", ["центр", "центральный", "center", "centre", "central"]],
  ["entrance", ["вход", "entrance"]], ["exit", ["выход", "exit"]],
];

const STOICHEION_CARD_NAMES: ReadonlyArray<readonly [string, string, string]> = [
  ["alpha", "альфа", "alpha"], ["beta", "бета", "beta"], ["gamma", "гамма", "gamma"],
  ["delta", "дельта", "delta"], ["epsilon", "эпсилон", "epsilon"], ["zeta", "дзета", "zeta"],
  ["eta", "эта", "eta"], ["theta", "тэта", "theta"], ["iota", "йота", "iota"],
  ["kappa", "каппа", "kappa"], ["lambda", "лямбда", "lambda"], ["mu", "мю", "mu"],
  ["nu", "ню", "nu"], ["xi", "кси", "xi"], ["omicron", "омикрон", "omicron"],
  ["pi", "пи", "pi"], ["rho", "ро", "rho"], ["sigma", "сигма", "sigma"],
  ["tau", "тау", "tau"], ["upsilon", "ипсилон", "upsilon"], ["phi", "фи", "phi"],
  ["chi", "хи", "chi"], ["psi", "пси", "psi"], ["omega", "омега", "omega"],
];

function voiceStoicheionCard(command: string): string | null {
  const match = command.match(/^(?:открой|покажи|выбери|open|show|select)\s+(?:(?:карту|букву)(?:\s+стойхейона)?|(?:(?:stoicheion\s+)?(?:card|letter)))\s+([а-яёa-z]+)$/iu);
  const name = match?.[1]?.toLocaleLowerCase().replace(/ё/gu, "е");
  return name ? STOICHEION_CARD_NAMES.find(([, ru, en]) => name === ru || name === en)?.[0] ?? null : null;
}

function voiceSector(command: string): SacredPracticeSectorId | null {
  const match = command.match(/^(?:открой|покажи|выбери|перейди\s+(?:в|на|к)|open|show|select|go\s+to)\s+(.+)$/iu);
  if (!match) return null;
  const query = match[1].toLocaleLowerCase().replace(/ё/gu, "е")
    .replace(/\s+(?:в\s+теокиклосе|in\s+(?:the\s+)?theokyklos)$/iu, "")
    .replace(/^(?:сектор\s+(?:теокиклоса\s+)?|theokyklos\s+(?:sector\s+)?|theokyklos\s+sector\s+)/iu, "")
    .replace(/\s+(?:сектор(?:\s+теокиклоса)?|sector(?:\s+(?:of\s+)?(?:the\s+)?theokyklos)?)$/iu, "")
    .trim();
  return SECTOR_ALIASES.find(([, aliases]) => aliases.includes(query))?.[0] ?? null;
}

function voiceMoodValue(raw: string): MoodValue | null {
  const value = raw.trim().replace(/^[«"']+|[»"'.!?]+$/gu, "").replace(/\s+(?:сегодня|today)$/iu, "").trim();
  const digit = value.match(/^(минус|minus|плюс|plus|[-+])?\s*(0|1|2|3|4|5|6|ноль|один|одна|два|две|три|четыре|пять|шесть|zero|one|two|three|four|five|six)$/iu);
  if (digit) {
    const words: Record<string, number> = { ноль: 0, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4,
      пять: 5, шесть: 6, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const magnitude = words[digit[2].toLocaleLowerCase()] ?? Number(digit[2]);
    return (/^(?:минус|minus|-)$/iu.test(digit[1] ?? "") ? -magnitude : magnitude) as MoodValue;
  }
  return MOOD_NAMES.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

function voiceClock(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/iu);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59 || match[3] && (hour < 1 || hour > 12) || !match[3] && hour > 23) return null;
  if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function voiceSleep(command: string): Extract<WebVoiceAction, { kind: "set-sleep" | "set-sleep-plan" }> | null {
  const clock = "(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)";
  const reminder = command.match(/^(включи|отключи|enable|disable|turn on|turn off)\s+(?:напоминание о сне|напоминания о сне|sleep reminders?)(?:\s+(?:за|in)\s+(\d{1,3})\s*(?:минут[а-я]*|minutes?)(?:\s+(?:до сна|before bed))?)?$/iu);
  if (reminder) {
    const lead = reminder[2] ? Number(reminder[2]) : undefined;
    if (lead !== undefined && lead > 180) return null;
    return { kind: "set-sleep-plan", reminderEnabled: /^(?:включи|enable|turn on)$/iu.test(reminder[1]), reminderMinutesBefore: lead };
  }
  const plan = command.match(new RegExp(`^(?:установи|поставь|настрой|set|change)\\s+(?:план сна|расписание сна|время сна|sleep plan|sleep schedule)\\s+(?:с|from)\\s+${clock}\\s+(?:до|to)\\s+${clock}$`, "iu"));
  if (plan) {
    const bedtime = voiceClock(plan[1]); const wakeTime = voiceClock(plan[2]);
    return bedtime && wakeTime ? { kind: "set-sleep-plan", bedtime, wakeTime } : null;
  }
  const span = command.match(new RegExp(`^(?:(?:отметь|запиши|record|log)\\s+)?(?:сон|мой сон|sleep|my sleep)\\s+(?:с|from)\\s+${clock}\\s+(?:до|to)\\s+${clock}$`, "iu"));
  if (span) {
    const bedtime = voiceClock(span[1]); const wakeTime = voiceClock(span[2]);
    return bedtime && wakeTime ? { kind: "set-sleep", bedtime, wakeTime } : null;
  }
  const natural = command.match(new RegExp(`^(?:я\\s+)?(?:уснул[а]?|лег спать|легла спать|i fell asleep|i went to bed)\\s+(?:в|at)\\s+${clock}\\s+(?:(?:и|and)\\s+)?(?:проснулся|проснулась|woke up)\\s+(?:в|at)\\s+${clock}$`, "iu"));
  if (natural) {
    const bedtime = voiceClock(natural[1]); const wakeTime = voiceClock(natural[2]);
    return bedtime && wakeTime ? { kind: "set-sleep", bedtime, wakeTime } : null;
  }
  const quality = command.match(/^(?:(?:отметь|запиши|поставь|set|record|log)\s+)?(?:качество сна|sleep quality)\s+(?:(?:на|как|as|to)\s+)?(\d{1,2})(?:\s+из\s+10)?$/iu);
  if (quality && Number(quality[1]) >= 1 && Number(quality[1]) <= 10) return { kind: "set-sleep", quality: Number(quality[1]) };
  return null;
}

function spokenName(value: string) {
  return value.replace(/^(?:(?:под|с)\s+названием|по\s+имени|назови\s+(?:её|его)|named|called|with\s+the\s+title)\s+/iu, "")
    .trim();
}

function resolveName(name: string, records: Named[], english: boolean): Named {
  const query = name.trim().toLocaleLowerCase();
  const exact = records.filter((item) => item.title.toLocaleLowerCase() === query);
  const matches = exact.length ? exact : records.filter((item) => item.title.toLocaleLowerCase().includes(query));
  if (matches.length !== 1) throw new Error(matches.length
    ? english ? `Multiple matches: ${name}. Be more specific.` : `Найдено несколько совпадений: ${name}. Уточните название.`
    : english ? `Not found: ${name}` : `Не найдено: ${name}`);
  return matches[0];
}

export function parseWebVoiceAction(raw: string, tasks: Named[], projects: Named[], habits: Named[], language = "ru", lists: Named[] = [], categories: Named[] = []): WebVoiceAction | null {
  const english = language === "en";
  const command = raw.trim().replace(/\s+/g, " ")
    .replace(/^(?:генезис|genesis)[,\s]+/iu, "")
    .replace(/^(?:(?:хочу|пожалуйста|please|i want to|можешь|could you)[,\s]+)+/iu, "")
    .replace(/[,\s]+(?:пожалуйста|please)[.!?]*$/iu, "").replace(/[.!?]+$/u, "").trim();
  if (!command || /[;\n]/.test(raw)) return null;
  const named = (pattern: RegExp) => command.match(pattern)?.[1]?.trim().replace(/^[«"\s]+|[»".,!?\s]+$/g, "") || "";
  const mood = command.match(/^(?:(?:(?:отметь|запиши|поставь|укажи|выбери|set|log|record|mark)\s+)?(?:(?:моё|мое|my|сегодняшнее)\s+)?(?:настроение|mood)(?:\s+(?:дня|сегодня|today))?\s+(?:(?:как|на|as|to|is)\s+)?|(?:у\s+меня\s+сегодня\s+настроение|сегодня\s+у\s+меня\s+настроение|today\s+my\s+mood\s+is|i\s+feel|i'm\s+feeling|i\s+am\s+feeling)\s+)(.+)$/iu);
  if (mood) {
    const value = voiceMoodValue(mood[1]);
    if (value !== null) return { kind: "set-mood", value };
  }
  const sleep = voiceSleep(command);
  if (sleep) return sleep;
  const calendarMode = command.match(/^(?:(?:переключи|переключить|поменяй|выбери|установи|включи|покажи|открой|switch(?: to)?|select|use|show|open)\s+)?(?:календарь\s+)?(?:на\s+|в\s+)?(лунн[а-яё]*|сакральн[а-яё]*|григорианск[а-яё]*|профанск[а-яё]*|lunar|sacred|gregorian)(?:\s+календарь)?$/iu);
  if (calendarMode) return { kind: "calendar-mode", mode: /^(?:лун|lunar)/iu.test(calendarMode[1]) ? "lunar"
    : /^(?:сакрал|sacred)/iu.test(calendarMode[1]) ? "sacred" : "profane" };
  const calendarView = command.match(/^(?:открой|покажи|перейди\s+(?:в|на|к)|выбери|open|show|switch\s+to)\s+(?:(?:календарь|calendar)\s*)?(год(?:овой\s+вид)?|месяц|year(?:\s+view)?|month(?:\s+view)?)$/iu);
  if (calendarView) return { kind: "calendar-view", view: /^(?:год|year)/iu.test(calendarView[1]) ? "year" : "calendar" };
  const calendarStep = command.match(/^(?:(следующ[а-яё]*|предыдущ[а-яё]*|прошл[а-яё]*|next|previous|last)\s+(месяц[а-яё]*|год[а-яё]*|month|year)|(месяц[а-яё]*|год[а-яё]*|month|year)\s+(впер[её]д|назад|forward|back))$/iu);
  if (calendarStep) return { kind: "calendar-step", unit: /^(?:год|year)/iu.test(calendarStep[2] || calendarStep[3]) ? "year" : "month",
    step: /^(?:пред|прош|prev|last|назад|back)/iu.test(calendarStep[1] || calendarStep[4]) ? -1 : 1 };
  const swipe = command.match(/^(?:свайп(?:ни|нуть|ай)?|листай|пролистай|swipe)\s+(влево|вправо|left|right)$/iu);
  if (swipe) return { kind: "calendar-swipe", step: /^(?:влево|left)/iu.test(swipe[1]) ? 1 : -1 };
  const scroll = command.match(/^(?:прокрути|пролистай|листай|скролл(?:ь|и)?|scroll)(?:\s+(?:страницу|экран|page))?\s+(вверх|вниз|наверх|в\s+начало|в\s+конец|up|down|top|bottom)$/iu);
  if (scroll) return { kind: "scroll", direction: /^(?:в\s+начало|наверх|top)/iu.test(scroll[1]) ? "top"
    : /^(?:в\s+конец|bottom)/iu.test(scroll[1]) ? "bottom"
      : /^(?:вверх|up)/iu.test(scroll[1]) ? "up" : "down" };
  const sectorId = voiceSector(command);
  if (sectorId) return { kind: "theokyklos-sector", sectorId };
  const cardId = voiceStoicheionCard(command);
  if (cardId) return { kind: "stoicheion-card", cardId };
  if (/^(?:выбери|вытяни|открой|покажи|draw|pick|select|show)\s+(?:карту дня|daily card|card of the day)$/iu.test(command))
    return { kind: "stoicheion-draw", drawKind: "daily" };
  if (/^(?:выбери|вытяни|открой|покажи|сделай|draw|pick|select|show|make)\s+(?:расклад(?: из)? (?:девяти|9) карт|(?:девять|9) карт(?: стойхейона)?|nine cards?|nine-card spread|9-card spread)$/iu.test(command))
    return { kind: "stoicheion-draw", drawKind: "spread" };
  const date = command.match(/^(?:покажи|открой|выбери|перейди\s+на|show|open|select)\s+(?:(?:дату|день|date|day)\s+)?(\d{4})-(\d{1,2})-(\d{1,2})$/iu);
  if (date) return { kind: "calendar-date", year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) };
  const spokenDate = command.match(/^(?:покажи|открой|выбери|перейди\s+на|show|open|select)\s+(?:(?:дату|день|date|day)\s+)?(\d{1,2})\s+([а-яёa-z]+)\s+(\d{4})(?:\s+года)?$/iu);
  if (spokenDate) {
    const months = ["январ", "феврал", "март", "апрел", "май", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
    const englishMonths = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const name = spokenDate[2].toLocaleLowerCase();
    const month = months.findIndex((item) => name.startsWith(item) || item === "май" && name === "мая");
    const englishMonth = englishMonths.findIndex((item) => name === item || name === item.slice(0, 3));
    if (month >= 0 || englishMonth >= 0) return { kind: "calendar-date", year: Number(spokenDate[3]), month: (month >= 0 ? month : englishMonth) + 1, day: Number(spokenDate[1]) };
  }
  const month = command.match(/^(?:покажи|открой|выбери|перейди\s+(?:в|на|к)|show|open|select)\s+(?:(?:месяц|month)\s+)?(\d{1,2})(?:[-\s]?(?:й|ый|ой|го|месяц|month))?$/iu);
  if (month) return { kind: "calendar-month", ordinal: Number(month[1]) };
  const destination = named(/^(?:открой|покажи|перейди в|open|show)\s+(.+)$/i).toLocaleLowerCase();
  const sections: Record<string, Extract<WebVoiceAction, { kind: "navigate" }>["section"]> = {
    "сегодня": "today", today: "today", "календарь": "calendar", calendar: "calendar",
    "задачи": "all-tasks", tasks: "all-tasks", "списки задач": "all-tasks", "task lists": "all-tasks",
    "проекты": "projects", projects: "projects", "привычки": "habits", habits: "habits",
    "сакральные привычки": "habits", "sacred habits": "habits", "путь героя": "habits", "hero path": "habits",
    "сон и настроение": "habits", "sleep and mood": "habits", "теокиклос": "theokyklos", theokyklos: "theokyklos",
    "стойхейон": "stoicheion", stoicheion: "stoicheion", "настройки": "admin", settings: "admin",
  };
  if (destination && sections[destination]) return { kind: "navigate", section: sections[destination] };
  const renameTask = command.match(/^(?:переименуй|переименовать|rename)\s+(?:задачу|задача|task)\s+(.+)$/iu);
  if (renameTask) {
    const matches = tasks.flatMap((task) => {
      const prefix = task.title.toLocaleLowerCase();
      const rest = renameTask[1];
      if (!rest.toLocaleLowerCase().startsWith(prefix)) return [];
      const suffix = rest.slice(task.title.length).match(/^\s+(?:в|на|to|as)\s+(.+)$/iu);
      return suffix ? [{ task, newTitle: spokenName(suffix[1].replace(/^[«"\s]+|[»".!?\s]+$/gu, "")) }] : [];
    }).filter((match) => match.newTitle.length > 0 && match.newTitle.length <= 300);
    if (matches.length !== 1) throw new Error(matches.length
      ? english ? "Multiple tasks have that title. Be more specific." : "Несколько задач имеют такое название. Уточните задачу."
      : english ? "Name an existing task exactly and give its new title." : "Назовите существующую задачу точно и укажите новое название.");
    return { kind: "rename-task", id: matches[0].task.id, title: matches[0].task.title, newTitle: matches[0].newTitle };
  }
  for (const [kind, pattern] of [
    ["create-project", /^(?:создай|создать|добавь|добавить|create|add)\s+(?:новый\s+)?(?:проект|project)\s+(.+)$/i],
    ["create-category", /^(?:создай|создать|добавь|добавить|create|add)\s+(?:новую\s+)?(?:категорию(?: жизни)?|life category|category)\s+(.+)$/i],
    ["create-list", /^(?:создай|создать|добавь|добавить|create|add)\s+(?:новый\s+)?(?:список задач|task list)\s+(.+)$/i],
    ["create-habit", /^(?:создай|создать|добавь|добавить|create|add)\s+(?:новую\s+)?(?:привычку|привычка|habit)\s+(.+)$/i],
    ["create-task", /^(?:создай|создать|добавь|добавить|create|add)\s+(?:новую\s+)?(?:задачу|задача|task)\s+(.+)$/i],
  ] as const) {
    const title = spokenName(named(pattern));
    if (title) return { kind, title };
  }
  const move = command.match(/^(?:перемести|перенеси|move)\s+(?:задачу|задача|task)\s+(.+?)\s+(?:в|into|to)\s+(?:проект|project)\s+(.+)$/i);
  if (move) {
    const task = resolveName(move[1], tasks, english);
    const destinationName = move[2].trim().replace(/[»".,!?]+$/g, "");
    const projectId = /^(?:хаос-бокс|inbox)$/i.test(destinationName) ? null : resolveName(destinationName, projects, english).id;
    return { kind: "move-task", id: task.id, title: task.title, projectId };
  }
  const removeFromProject = named(/^(?:убери|исключи|remove)\s+(?:задачу|задача|task)\s+(.+?)\s+(?:из проекта|from project)$/i);
  if (removeFromProject) {
    const task = resolveName(removeFromProject, tasks, english);
    return { kind: "move-task", id: task.id, title: task.title, projectId: null };
  }
  for (const [kind, pattern, records] of [
    ["edit-task", /^(?:отредактируй|отредактировать|редактировать|изменить|измени|edit)\s+(?:задачу|задача|task)\s+(.+)$/i, tasks],
    ["delete-task", /^(?:удали|удалить|delete|remove)\s+(?:задачу|задача|task)\s+(.+)$/i, tasks],
    ["edit-list", /^(?:отредактируй|отредактировать|редактировать|изменить|измени|edit|переименуй|rename)\s+(?:список задач|список|task list)\s+(.+)$/i, lists],
    ["delete-list", /^(?:удали|удалить|delete|remove)\s+(?:список задач|список|task list)\s+(.+)$/i, lists],
    ["edit-category", /^(?:отредактируй|отредактировать|редактировать|изменить|измени|edit|переименуй|rename)\s+(?:категорию(?: жизни)?|life category|category)\s+(.+)$/i, categories],
    ["delete-category", /^(?:удали|удалить|delete|remove)\s+(?:категорию(?: жизни)?|life category|category)\s+(.+)$/i, categories],
    ["complete-task", /^(?:выполни|заверши|отметь|пометь|complete)\s+(?:задачу|задача|task)\s+(.+)$/i, tasks],
    ["uncomplete-task", /^(?:сними выполнение|отмени выполнение|uncomplete)\s+(?:задачи|задачу|task)\s+(.+)$/i, tasks],
    ["edit-habit", /^(?:отредактируй|отредактировать|редактировать|изменить|измени|edit)\s+(?:привычку|привычка|habit)\s+(.+)$/i, habits],
    ["delete-habit", /^(?:удали|удалить|delete|remove)\s+(?:привычку|привычка|habit)\s+(.+)$/i, habits],
    ["complete-habit", /^(?:выполни|отметь|пометь|complete)\s+(?:привычку|привычка|habit)\s+(.+)$/i, habits],
    ["uncomplete-habit", /^(?:сними отметку|отмени выполнение|uncomplete)\s+(?:привычки|привычку|habit)\s+(.+)$/i, habits],
    ["edit-project", /^(?:отредактируй|отредактировать|редактировать|изменить|измени|edit)\s+(?:проект|project)\s+(.+)$/i, projects],
    ["delete-project", /^(?:удали|удалить|delete|remove)\s+(?:проект|project)\s+(.+)$/i, projects],
  ] as const) {
    const name = named(pattern);
    if (name) {
      const record = resolveName(name, records, english);
      return { kind, id: record.id, title: record.title };
    }
  }
  return null;
}
