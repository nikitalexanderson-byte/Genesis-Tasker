import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calendarModule } from './helpers/calendar-modules.mjs';
import { historyProjectionCases } from './fixtures/history-projection-cases.mjs';

const { projectHabitHistory, habitEconomyHistory } = calendarModule('app/habit-history.ts');
const baseline = JSON.parse(readFileSync(new URL('./fixtures/history-projection-baseline.json', import.meta.url), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

for (const input of historyProjectionCases()) test(`history projection preserves pre-refactor data: ${input.name}`, () => {
  const expected = baseline.cases.find(row => row.name === input.name);
  assert(expected, 'Every case needs an independently captured pre-refactor result');
  const original = JSON.stringify(input);
  freeze(input);
  const projected = projectHabitHistory(input.habits, input.events, input.completions, input.measurements);
  const workspace = { habitHistory: input.events, habitCompletions: input.completions, habitMeasurements: input.measurements };
  assert.deepEqual(plain(projected), expected.projection);
  assert.deepEqual(plain(habitEconomyHistory(workspace)), expected.economy);
  assert.equal(JSON.stringify(input), original, 'Projection must not mutate persisted data');
  if (!input.events.length) assert.equal(habitEconomyHistory(workspace), workspace);
});

test('history indexes reflect edits and never retain another workspace with the same entity IDs', () => {
  const input = historyProjectionCases()[0];
  const first = projectHabitHistory(input.habits, input.events, input.completions, input.measurements);
  const event = input.events.find(row => row.habitId === input.habits[1].id && row.date === '2026-01-03');
  event.value.note = 'A different workspace or a later correction';
  const second = projectHabitHistory(input.habits, input.events, input.completions, input.measurements);
  assert.notDeepEqual(second, first);
  assert.equal(second.find(row => row.habitId === event.habitId && row.date === event.date).note, event.value.note);
});
