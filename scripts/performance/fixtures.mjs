import { calendarModule } from '../../tests/helpers/calendar-modules.mjs';

const { defaultHabit } = calendarModule('app/habits.ts');
const { habitRuleForDate } = calendarModule('app/habit-measurement.ts');
const epoch = Date.parse('2026-01-01T00:00:00Z');
const day = 86_400_000;

/** Deterministic, synthetic records: corrections, decisions, measurements and earned credit. */
export function historyFixture(habitCount, dayCount) {
  const habits = [], events = [], completions = [], measurements = [];
  for (let h = 0; h < habitCount; h++) {
    const habit = { ...defaultHabit('2026-01-01', 'profane'), id: `synthetic-habit-${h}`,
      createdAt: new Date(epoch).toISOString(), updatedAt: new Date(epoch).toISOString() };
    habit.schedule.timezone = 'UTC';
    if (h % 4 === 0) habit.measurement = { kind: 'quantity', unit: 'pages', target: 2000, quickAdd: 1000 };
    habits.push(habit);
    for (let d = 0; d < dayCount; d++) {
      const date = new Date(epoch + d * day).toISOString().slice(0, 10);
      const at = new Date(epoch + d * day + 10 * 3_600_000).toISOString();
      const later = new Date(epoch + d * day + 11 * 3_600_000).toISOString();
      const id = `${habit.id}:${date}`, ruleId = habitRuleForDate(habit, date).id;
      const baseline = { id: `completion:${id}`, habitId: habit.id, date, createdAt: at, updatedAt: at,
        version: 1, syncState: 'synced', completed: true, score: 10, xpAwarded: 10,
        qualityValue: null, note: 'Synthetic original', completedTimes: [], qualityConfirmedAt: null };
      const value = { completed: d % 3 !== 0, qualityValue: null, note: 'Synthetic correction',
        completedTimes: [], qualityConfirmedAt: null };
      const event = { id: `event:${id}`, habitId: habit.id, date, ruleId, epoch: '',
        createdAt: at, updatedAt: at, version: 1, syncState: 'local', replaces: [], value,
        baseline: d % 2 ? baseline : null, source: d % 5 ? 'history' : 'decision' };
      events.push(event);
      if (d % 2) {
        completions.push(baseline);
        events.push({ ...event, id: `correction:${id}`, replaces: [event.id],
          createdAt: later, updatedAt: later, value: { ...value, note: 'Synthetic second revision' } });
      }
      if (habit.measurement) measurements.push({ id: `measurement:${id}`, entryId: `measurement:${id}`,
        habitId: habit.id, date, ruleId, createdAt: later, updatedAt: later, version: 1, syncState: 'local',
        replaces: [], value: 2000, note: '', source: 'manual', historical: d % 5 !== 0 });
    }
  }
  return { habits, events, completions, measurements };
}

export function taskFixture(size) {
  let seed = 7;
  return Array.from({ length: size }, (_, i) => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return { id: `task-${i}`, title: `Synthetic task ${seed % 31}`,
      createdAt: i % 17 ? new Date(epoch + (seed % 365) * day).toISOString() : 'legacy-invalid',
      updatedAt: epoch + (seed % 730) * day,
      dueDate: i % 9 ? new Date(epoch + (seed % 365) * day).toISOString().slice(0, 10) : null };
  });
}
