import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calendarModule } from './helpers/calendar-modules.mjs';

const { dreamExportAllowed, dreamExportRecords, buildDreamHistoryHtml } = calendarModule('app/dream-export.ts');
const { newDiaryNote } = calendarModule('app/diary-model.ts');
const now = Date.parse('2026-11-10T12:00:00Z');
const access = { schemaVersion: 1, policyRevision: 'synthetic', enforcementEnabled: true,
  declaredPlan: 'premium', effectivePlan: 'premium', lifetimePremium: false,
  validUntil: '2026-12-10T00:00:00Z', evaluatedAt: '2026-11-10T12:00:00Z',
  allowedFeatures: ['data-export'], freeFeatures: [] };
const row = (id, body = 'A river\nA forest') => ({ revision: 1, note: { ...newDiaryNote(body, 'River'), id,
  dream: { day: '2026-11-09', timeZone: 'Europe/Moscow', lucid: true }, reaction: 'favorite',
  createdAt: '2026-11-09T07:00:00Z', updatedAt: '2026-11-09T08:00:00Z' } });

test('dream downloads require current Premium, Business or lifetime Elite access', () => {
  for (const plan of ['premium', 'business']) assert.equal(dreamExportAllowed({ ...access, declaredPlan: plan, effectivePlan: plan }, now), true);
  // Both Elite labels are transported as premium4life with effective Business capabilities.
  for (const elitePlus of [false, true]) assert.equal(dreamExportAllowed({ ...access,
    declaredPlan: 'premium4life', effectivePlan: 'business', lifetimePremium: true, validUntil: null, forecastElitePlus: elitePlus }, now), true);
  for (const value of [undefined, { ...access, effectivePlan: 'free' }, { ...access, effectivePlan: 'standart' },
    { ...access, effectivePlan: 'unknown' }, { ...access, schemaVersion: 2 }, { ...access, validUntil: null },
    { ...access, validUntil: '2026-11-10T12:00:00Z' }, { ...access, validUntil: '2030-02-30T00:00:00Z' },
    { ...access, allowedFeatures: [] }, { ...access, disabledFeatures: ['data-export'] },
    { ...access, enforcementEnabled: false, validUntil: '2026-11-01T00:00:00Z', freeFeatures: ['data-export'] }]) {
    assert.equal(dreamExportAllowed(value, now), false);
  }
});

test('the backup retains full saved dreams, archived dreams and independent drafts without other diary notes', () => {
  const saved = row('saved'), archived = { ...row('archived'), note: { ...row('archived').note, archived: true } };
  const draft = { ...saved, draftKey: 'writer:one', note: { ...saved.note, body: 'New draft', updatedAt: '2026-11-10T07:00:00Z' } };
  const secondDraft = { ...draft, draftKey: 'writer:two', note: { ...draft.note, body: 'Another draft' } };
  const blank = { ...row('blank', ' '), draftKey: 'blank' };
  const ordinary = { note: newDiaryNote('Private diary note'), revision: 1 };
  const input = [saved, archived, draft, secondDraft, blank, ordinary, saved];
  assert.deepEqual(dreamExportRecords(input), [draft, secondDraft, saved, archived]);
  assert.equal(input.length, 7, 'export must not mutate or discard existing records');
  const html = buildDreamHistoryHtml(input, 'en', '2026-11-10T12:00:00Z');
  assert.equal((html.match(/<article>/g) ?? []).length, 4);
  assert.match(html, /Total dreams: 2/);
  for (const text of ['A river\nA forest', 'New draft', 'Another draft', 'Draft', 'Archive', 'Europe/Moscow']) assert.ok(html.includes(text));
  assert.equal(html.includes('Private diary note'), false);
});

test('downloaded HTML preserves arbitrary text safely, without scripts or network dependencies', () => {
  const record = row('escape', '</p><script>alert("x")</script>\nЛес 🌙 & <water>');
  record.note.title = '<img src=x onerror=alert(1)>';
  const html = buildDreamHistoryHtml([record], 'ru', '2026-11-10T12:00:00Z');
  assert.ok(html.includes('&lt;/p&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;\nЛес 🌙 &amp; &lt;water&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.doesNotMatch(html, /<(script|img|iframe|link)\b|<[^>]+\s(?:src|href)=/i);
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /datetime="2026-11-09T07:00:00Z"/);
  assert.match(html, /datetime="2026-11-09T08:00:00Z"/);
});

test('the export includes long untruncated dream text and device-only status', () => {
  const record = { ...row('long', 'Море '.repeat(5999)), localOnly: true };
  const html = buildDreamHistoryHtml([record], 'ru', '2026-11-10T12:00:00Z');
  assert.ok(html.includes(record.note.body));
  assert.ok(html.includes('Сохранено на устройстве'));
  assert.ok(html.includes('Избранные · Осознанный'));
});

test('dream export labels and documents exist in all fourteen supported languages', () => {
  const copy = JSON.parse(readFileSync(new URL('../app/dream-export-copy.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(copy).length, 14);
  for (const [language, text] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(text), Object.keys(copy.ru));
    for (const value of Object.values(text)) {
      assert.ok(value.trim());
      if (!['ru', 'sr', 'uk'].includes(language)) assert.doesNotMatch(value, /[А-Яа-яЁё]/u);
    }
    const html = buildDreamHistoryHtml([row('translated')], language, '2026-11-10T12:00:00Z');
    assert.ok(html.includes(text.timeZone));
    assert.ok(html.includes(text.savedAt));
  }
});
