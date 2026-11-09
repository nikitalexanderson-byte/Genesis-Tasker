import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarModule } from './helpers/calendar-modules.mjs';
const { recommendGoalOptions, GOAL_CANDIDATE_COUNT } = calendarModule('app/aurora/goal-options.ts');
const { cardInsight } = calendarModule('app/aurora/card-insights.ts');
const { createSituation } = calendarModule('app/aurora/context.ts');
const { expectedSourceDraw, snapshotFromSavedDraw } = calendarModule('app/aurora/draw-policy.ts');
const { eligibleSectors, SOURCE_CARD_IDS } = calendarModule('app/aurora/spread.ts');
const { newSession, validateDocument } = calendarModule('app/aurora/session.ts');
const now = '2026-11-05T12:00:00.000Z';
const primary = seed => snapshotFromSavedDraw({ id: `goal-source-${seed}`, seed, day: '2026-11-05', createdAt: now, cards: expectedSourceDraw(seed) });

test('Each letter opens its own authored problem and resource, with the actual source sector', () => {
  const seen = new Set();
  for (const cardId of SOURCE_CARD_IDS) {
    for (const orientation of ['reversed', 'upright']) {
      const insight = cardInsight({ cardId, orientation, sourcePositionId: 'west' });
      assert.ok(insight.lines.length, `${cardId}/${orientation} has no orientation text`);
      assert.equal(insight.reversed, orientation === 'reversed');
      assert.equal(insight.sector, 'Запад');
      assert.match(insight.patrons, /Посейдон/);
      assert.doesNotMatch(insight.patrons, /Гермес/);
      seen.add(insight.lines.join('\n'));
    }
  }
  assert.equal(seen.size, 48);
});

test('Five unique stable choices are ranked from the full catalog without turning cards into user facts', () => {
  assert.ok(GOAL_CANDIDATE_COUNT >= 300);
  const all = new Set();
  for (let seed = 0; seed < 30; seed++) {
    const snapshot = primary(seed), context = createSituation('goal-context', 'Europe/Moscow');
    const before = JSON.stringify({ snapshot, context });
    for (const sector of eligibleSectors(snapshot)) {
      const options = recommendGoalOptions(snapshot, sector, context);
      assert.equal(options.length, 5);
      assert.equal(new Set(options.map(item => item.id)).size, 5);
      assert.equal(new Set(options.map(item => item.title)).size, 5);
      assert.ok(options.every(item => item.goalTags.length && item.title.length >= 5 && item.description.length > 10 && item.value.includes(item.description)));
      assert.deepEqual(options, recommendGoalOptions(snapshot, sector, context));
      for (const item of options) all.add(item.id);
    }
    assert.equal(JSON.stringify({ snapshot, context }), before);
  }
  assert.ok(all.size > 25, 'Different draws and directions must produce different choices');
});

test('A direction must be eligible; observing a draw without reversed cards still offers five support choices', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const snapshot = primary(seed), context = createSituation('c', 'Europe/Moscow'), eligible = eligibleSectors(snapshot);
    if (eligible.length) assert.deepEqual(recommendGoalOptions(snapshot, null, context), []);
    else { assert.equal(recommendGoalOptions(snapshot, null, context).length, 5); return; }
  }
  assert.fail('No observation fixture');
});

test('Selecting a suggestion saves through the existing session schema and preserves prior handwritten work', () => {
  const snapshot = primary(1), session = newSession({ id: 'session', ownerId: 'owner', now, primary: snapshot, timezone: 'Europe/Moscow' });
  const sector = eligibleSectors(snapshot)[0], option = recommendGoalOptions(snapshot, sector, session.context)[0];
  const selected = { ...session, selectedSectorId: sector, goalText: option.value, goalTags: option.goalTags };
  const document = { version: 1, ownerId: 'owner', sessions: [selected], removed: [] };
  assert.doesNotThrow(() => validateDocument(document, 'owner'));
  assert.doesNotThrow(() => validateDocument({ ...document, sessions: [{ ...selected, goalText: 'Сохранённая собственная формулировка' }] }, 'owner'));
});
