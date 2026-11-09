import { historyFixture } from '../../scripts/performance/fixtures.mjs';

/** Inputs shared by the frozen pre-refactor oracle and the current implementation. */
export function historyProjectionCases() {
  const mixed = historyFixture(2, 6);
  const original = mixed.completions[0];
  mixed.completions.push({ ...original, id: 'duplicate-completion', note: 'Must not replace the first record', xpAwarded: 20 });
  mixed.completions.unshift({ ...original, id: 'untouched', date: '2027-01-01' });
  mixed.habits.push({ ...mixed.habits[0], createdDate: '2028-01-01' });
  const root = mixed.events.find(row => row.habitId === mixed.habits[1].id && row.date === '2026-01-02');
  mixed.events.push({ ...root, id: 'concurrent-head', replaces: [],
    createdAt: '2026-01-02T12:00:00Z', updatedAt: '2026-01-02T12:00:00Z',
    value: { ...root.value, note: 'Unresolved concurrent change' } });
  for (const [habitId, date] of [['orphan-habit', '2026-01-01'], [mixed.habits[0].id, '2025-12-31']]) {
    mixed.events.push({ ...root, id: `ignored:${habitId}:${date}`, habitId, date, replaces: [] });
    mixed.completions.push({ ...original, id: `retained:${habitId}:${date}`, habitId, date });
  }
  const invalidTimestamp = historyFixture(1, 2);
  invalidTimestamp.measurements[0].createdAt = 'invalid-legacy-timestamp';
  const decisions = historyFixture(1, 2);
  decisions.events = decisions.events.map(row => ({ ...row, source: 'decision' }));
  return [
    { name: 'mixed-order-duplicates-conflicts-orphans', ...mixed },
    { name: 'legacy-invalid-measurement-timestamp', ...invalidTimestamp },
    { name: 'decision-only-economy', ...decisions },
    { name: 'empty-history', ...mixed, events: [] },
    { name: 'no-existing-completions', ...mixed, completions: [] },
  ];
}
