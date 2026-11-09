import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { calendarModule } from './helpers/calendar-modules.mjs';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../app/GenesisCalendar.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('GenesisCalendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['readStoredState', 'inputDate', 'uid', 'timestamp'];
const functions = names.map(name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(node, `Actual storage entry point ${name} is missing`);
  return node.getText(ast);
}).join('\n');
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const reminders = calendarModule('app/task-reminders.ts'), description = calendarModule('app/task-description.ts');
const calendar = calendarModule('app/calendar-data.ts'), protection = calendarModule('app/workspace-storage.ts');
const habits = calendarModule('app/habits.ts'), recurrence = calendarModule('app/task-recurrence.ts');

function reload(document) {
  const key = 'synthetic-local-workspace', original = JSON.stringify(document), values = new Map([[key, original]]);
  const storage = { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) };
  const dependencies = { localStorage: storage, readProtectedWorkspace: protection.readProtectedWorkspace,
    normalizeTaskReminders: reminders.normalizeTaskReminders, legacyReminderMinutes: reminders.legacyReminderMinutes,
    cleanTaskDescription: description.cleanTaskDescription, normalizeCalendarDateNote: calendar.normalizeCalendarDateNote,
    normalizeHabitWorkspace: habits.normalizeHabitWorkspace, isRecurrencePattern: recurrence.isRecurrencePattern, DEFAULT_CATEGORIES: [] };
  const read = new Function(...Object.keys(dependencies), `${compiled}\nreturn readStoredState;`)(...Object.values(dependencies));
  const result = read(key);
  assert.equal(values.get(key), original, 'Reading must not overwrite the persisted document');
  return result;
}
const context = { version: 2, timeZone: 'Pacific/Kiritimati', gregorianYearStart: 'march' };
const base = { id: 'synthetic-meeting', title: 'Synthetic meeting', dueDate: '2026-11-09', endDate: '2026-11-09',
  sacredYear: 2026, monthIndex: 0, day: 1, entryType: 'meeting', time: '18:00', endTime: '19:45', updatedAt: 1794225600000,
  recurrence: 'none', recurrenceMode: 'none', recurrencePattern: 'none', recurrenceContext: context, recurrenceInvalidDayPolicy: 'skip', syncToGoogle: false };
const workspace = tasks => ({ ...JSON.parse(JSON.stringify(habits.EMPTY_HABIT_WORKSPACE)), tasks, projects: [], categories: [], taskLists: [], taskListLinks: [] });

test('local reload preserves a meeting end time, saved calendar contract and provider metadata', () => {
  const task = { ...base, yandexEndTime: '19:45', yandexLocation: 'Synthetic test room', yandexAttendees: ['attendee@example.invalid'] };
  const restored = reload(workspace([task])).tasks[0];
  for (const key of ['id', 'entryType', 'time', 'endTime', 'recurrenceContext', 'recurrenceInvalidDayPolicy', 'yandexEndTime', 'yandexLocation', 'yandexAttendees'])
    assert.deepEqual(restored[key], task[key], key);
});

test('every advanced lunar repeat survives reload with the same generated occurrence dates', () => {
  for (const pattern of ['lunar-decades', 'lunar-decade-days', 'lunar-phases', 'lunar-yearly']) {
    const task = { ...base, id: `synthetic-${pattern}`, entryType: 'task', recurrenceMode: 'lunar', recurrencePattern: pattern,
      recurrenceDays: [1], recurrenceStartDate: '2026-11-09', recurrenceEndDate: '2027-11-09', recurrenceInterval: 1 };
    const restored = reload(workspace([task])).tasks[0];
    assert.equal(restored.recurrencePattern, pattern);
    assert.deepEqual(restored.recurrenceContext, context);
    assert.deepEqual(recurrence.recurrenceDatesForTask(restored), recurrence.recurrenceDatesForTask(task), pattern);
  }
});

test('legacy dates and invalid recurrence values retain their established guarded fallback', () => {
  const legacy = { ...base, recurrence: 'daily', recurrenceMode: 'unknown', recurrencePattern: 'unknown' };
  const restored = reload(workspace([legacy])).tasks[0];
  assert.equal(restored.recurrenceMode, 'classic');
  assert.equal(restored.recurrencePattern, 'daily');
  const missingDate = { ...base }; delete missingDate.dueDate;
  assert.match(reload(workspace([missingDate])).tasks[0].dueDate, /^\d{4}-\d{2}-\d{2}$/);
});
