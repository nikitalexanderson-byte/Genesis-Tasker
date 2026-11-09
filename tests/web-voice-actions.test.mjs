import assert from "node:assert/strict";
import test from "node:test";
import { parseWebVoiceAction } from "../app/web-voice-actions.ts";

const tasks = [{ id: "task-1", title: "Позвонить врачу" }, { id: "task-2", title: "Позвонить коллеге" }];
const projects = [{ id: "project-1", title: "Здоровье" }];
const habits = [{ id: "habit-1", title: "Утренняя зарядка" }];
const lists = [{ id: "list-1", title: "Покупки" }, { id: "list-2", title: "Работа" }];
const categories = [{ id: "category-1", title: "Здоровье" }];

test("background voice commands navigate and resolve task, project, and habit targets", () => {
  assert.deepEqual(parseWebVoiceAction("открой сон и настроение", tasks, projects, habits), { kind: "navigate", section: "habits" });
  assert.deepEqual(parseWebVoiceAction("отметь привычку Утренняя зарядка", tasks, projects, habits),
    { kind: "complete-habit", id: "habit-1", title: "Утренняя зарядка" });
  assert.deepEqual(parseWebVoiceAction("перемести задачу Позвонить врачу в проект Здоровье", tasks, projects, habits),
    { kind: "move-task", id: "task-1", title: "Позвонить врачу", projectId: "project-1" });
});

test("background voice commands refuse ambiguous targets and unsupported actions", () => {
  assert.throws(() => parseWebVoiceAction("выполни задачу Позвонить", tasks, projects, habits), /несколько совпадений/);
  assert.equal(parseWebVoiceAction("отправь сообщение", tasks, projects, habits), null);
  assert.equal(parseWebVoiceAction("создай задачу одну; удали другую", tasks, projects, habits), null);
});

test("calendar voice variants keep display mode, period, date and movement distinct", () => {
  const parse = (phrase) => parseWebVoiceAction(phrase, tasks, projects, habits);
  assert.deepEqual(parse("переключи календарь на лунный"), { kind: "calendar-mode", mode: "lunar" });
  assert.deepEqual(parse("Генезис, пожалуйста, переключи календарь на лунный!"), { kind: "calendar-mode", mode: "lunar" });
  assert.deepEqual(parse("покажи григорианский календарь"), { kind: "calendar-mode", mode: "profane" });
  assert.deepEqual(parse("выбери сакральный"), { kind: "calendar-mode", mode: "sacred" });
  assert.deepEqual(parse("открой год"), { kind: "calendar-view", view: "year" });
  assert.deepEqual(parse("покажи месяц"), { kind: "calendar-view", view: "calendar" });
  assert.deepEqual(parse("следующий месяц"), { kind: "calendar-step", unit: "month", step: 1 });
  assert.deepEqual(parse("год назад"), { kind: "calendar-step", unit: "year", step: -1 });
  assert.deepEqual(parse("свайпни влево"), { kind: "calendar-swipe", step: 1 });
  assert.deepEqual(parse("прокрути экран вверх"), { kind: "scroll", direction: "up" });
  assert.deepEqual(parse("покажи 12 октября 2026"), { kind: "calendar-date", year: 2026, month: 10, day: 12 });
  assert.deepEqual(parse("покажи 3 мая 2026"), { kind: "calendar-date", year: 2026, month: 5, day: 3 });
  assert.deepEqual(parse("открой месяц 5"), { kind: "calendar-month", ordinal: 5 });
});

test("task deletion and list editing resolve one named target before acting", () => {
  assert.deepEqual(parseWebVoiceAction("удали задачу Позвонить врачу", tasks, projects, habits, "ru", lists),
    { kind: "delete-task", id: "task-1", title: "Позвонить врачу" });
  assert.deepEqual(parseWebVoiceAction("переименуй список Покупки", tasks, projects, habits, "ru", lists),
    { kind: "edit-list", id: "list-1", title: "Покупки" });
  assert.deepEqual(parseWebVoiceAction("удали список задач Покупки", tasks, projects, habits, "ru", lists),
    { kind: "delete-list", id: "list-1", title: "Покупки" });
  assert.throws(() => parseWebVoiceAction("удали задачу Позвонить", tasks, projects, habits, "ru", lists), /несколько совпадений/);
});

test("project and life category commands resolve names before opening forms or confirmations", () => {
  assert.deepEqual(parseWebVoiceAction("удали проект Здоровье", tasks, projects, habits, "ru", lists, categories),
    { kind: "delete-project", id: "project-1", title: "Здоровье" });
  assert.deepEqual(parseWebVoiceAction("создай категорию жизни Творчество", tasks, projects, habits, "ru", lists, categories),
    { kind: "create-category", title: "Творчество" });
  assert.deepEqual(parseWebVoiceAction("измени категорию Здоровье", tasks, projects, habits, "ru", lists, categories),
    { kind: "edit-category", id: "category-1", title: "Здоровье" });
  assert.deepEqual(parseWebVoiceAction("удали категорию жизни Здоровье", tasks, projects, habits, "ru", lists, categories),
    { kind: "delete-category", id: "category-1", title: "Здоровье" });
});

test("creation phrases use naming words as instructions and preserve the actual title", () => {
  const parse = (phrase) => parseWebVoiceAction(phrase, tasks, projects, habits);
  assert.deepEqual(parse("создай задачу под названием Задача номер 1"), { kind: "create-task", title: "Задача номер 1" });
  assert.deepEqual(parse("create task named Task number 1"), { kind: "create-task", title: "Task number 1" });
  assert.deepEqual(parse("создай проект с названием Проект номер 1"), { kind: "create-project", title: "Проект номер 1" });
  assert.deepEqual(parse("create habit called Morning walk"), { kind: "create-habit", title: "Morning walk" });
});

test("sleep commands separate observations, plan times, and bedtime reminders", () => {
  const parse = (phrase) => parseWebVoiceAction(phrase, tasks, projects, habits);
  assert.deepEqual(parse("запиши сон с 23:30 до 07:00"),
    { kind: "set-sleep", bedtime: "23:30", wakeTime: "07:00" });
  assert.deepEqual(parse("I fell asleep at 11 pm and woke up at 7 am"),
    { kind: "set-sleep", bedtime: "23:00", wakeTime: "07:00" });
  assert.deepEqual(parse("качество сна 8 из 10"), { kind: "set-sleep", quality: 8 });
  assert.deepEqual(parse("set sleep schedule from 10:45 pm to 6:30 am"),
    { kind: "set-sleep-plan", bedtime: "22:45", wakeTime: "06:30" });
  assert.deepEqual(parse("включи напоминание о сне за 30 минут"),
    { kind: "set-sleep-plan", reminderEnabled: true, reminderMinutesBefore: 30 });
  assert.deepEqual(parse("disable sleep reminder"),
    { kind: "set-sleep-plan", reminderEnabled: false, reminderMinutesBefore: undefined });
  assert.equal(parse("качество сна 11"), null);
  assert.equal(parse("запиши сон с 25:00 до 07:00"), null);
});

test("Stoicheion voice commands distinguish a catalog card from a new spread", () => {
  const parse = (phrase) => parseWebVoiceAction(phrase, tasks, projects, habits);
  assert.deepEqual(parse("выбери 9 карт"), { kind: "stoicheion-draw", drawKind: "spread" });
  assert.deepEqual(parse("draw nine-card spread"), { kind: "stoicheion-draw", drawKind: "spread" });
  assert.deepEqual(parse("вытяни карту дня"), { kind: "stoicheion-draw", drawKind: "daily" });
  assert.deepEqual(parse("открой карту альфа"), { kind: "stoicheion-card", cardId: "alpha" });
});

test("mood commands recognize Russian and English values without guessing unknown moods", () => {
  const parse = (phrase) => parseWebVoiceAction(phrase, tasks, projects, habits);
  assert.deepEqual(parse("отметь настроение дня как радость"), { kind: "set-mood", value: 4 });
  assert.deepEqual(parse("сегодня у меня настроение минус три"), { kind: "set-mood", value: -3 });
  assert.deepEqual(parse("запиши настроение плюс четыре"), { kind: "set-mood", value: 4 });
  assert.deepEqual(parse("I feel calm today"), { kind: "set-mood", value: 1 });
  assert.deepEqual(parse("log my mood as drained"), { kind: "set-mood", value: -4 });
  assert.equal(parse("отметь настроение серебристое"), null);
});

test("task renaming requires one exact source title and removes naming instructions", () => {
  const parse = (phrase, records = tasks) => parseWebVoiceAction(phrase, records, projects, habits);
  assert.deepEqual(parse("переименуй задачу Позвонить врачу в Звонок врачу"),
    { kind: "rename-task", id: "task-1", title: "Позвонить врачу", newTitle: "Звонок врачу" });
  assert.deepEqual(parse("rename task Позвонить врачу to named Call the doctor"),
    { kind: "rename-task", id: "task-1", title: "Позвонить врачу", newTitle: "Call the doctor" });
  assert.throws(() => parse("переименуй задачу Позвонить в Звонок"), /точно/);
  assert.throws(() => parse("переименуй задачу Позвонить врачу в Звонок", [...tasks, { id: "task-3", title: "Позвонить врачу" }]), /Несколько/);
});

test("Theokyklos sector commands use exact Russian and English sector names", () => {
  const parse = (phrase) => parseWebVoiceAction(phrase, tasks, projects, habits);
  assert.deepEqual(parse("открой северо-восточный сектор"), { kind: "theokyklos-sector", sectorId: "northeast" });
  assert.deepEqual(parse("покажи сектор Очаг в Теокиклосе"), { kind: "theokyklos-sector", sectorId: "hearth" });
  assert.deepEqual(parse("open theokyklos north west sector"), { kind: "theokyklos-sector", sectorId: "northwest" });
  assert.deepEqual(parse("show entrance sector"), { kind: "theokyklos-sector", sectorId: "entrance" });
  assert.equal(parse("открой неизвестный сектор"), null);
});

test("Stoicheion card commands open a named catalog card without starting a draw", () => {
  const parse = (phrase) => parseWebVoiceAction(phrase, tasks, projects, habits);
  assert.deepEqual(parse("открой карту Стойхейона Альфа"), { kind: "stoicheion-card", cardId: "alpha" });
  assert.deepEqual(parse("выбери букву Омега"), { kind: "stoicheion-card", cardId: "omega" });
  assert.deepEqual(parse("open stoicheion card theta"), { kind: "stoicheion-card", cardId: "theta" });
  assert.equal(parse("открой карту Неизвестная"), null);
});
