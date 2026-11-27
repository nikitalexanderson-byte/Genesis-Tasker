import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { localizedModule } from './helpers/localized-modules.mjs';
import { languageDirection, languageManifest, REGION_LANGUAGES } from '../app/region-language.ts';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const { formatTranslatedText, translateText } = localizedModule('app/i18n.ts');

test('the care form and training catalogue distinguish administration route, measurement unit and equipment', () => {
  const expected = {
    he: ['דרך מתן התרופה', 'יחידת המידה של החומר הפעיל', 'מכרעים לאחור עם שק חול'],
    ar: ['طريق إعطاء الدواء', 'وحدة قياس المادة الفعّالة', 'اندفاع خلفي بكيس الرمل'],
    ko: ['투여 경로', '유효 성분의 측정 단위', '샌드백 리버스 런지'],
    nl: ['Toedieningsweg', 'Meeteenheid van de werkzame stof', 'Achterwaartse lunges met zandzak'],
  };
  const sources = ['Путь введения', 'Единица активного вещества', 'Выпады назад с мешком'];
  for (const [language, labels] of Object.entries(expected)) {
    assert.deepEqual(sources.map(source => translateText(source, language)), labels);
  }
});

test('a confirmed sync and an outstanding local queue have different meanings in each new language', () => {
  const expected = {
    he: ['הסנכרון הושלם.', 'נשמר במכשיר · בהמתנה לסנכרון'],
    ar: ['اكتملت المزامنة.', 'تم الحفظ على الجهاز · بانتظار المزامنة'],
    ko: ['동기화가 완료되었습니다.', '기기에 저장됨 · 동기화 대기 중'],
    nl: ['Gesynchroniseerd.', 'Opgeslagen op het apparaat · wacht op synchronisatie'],
  };
  for (const [language, [confirmed, queued]] of Object.entries(expected)) {
    assert.equal(translateText('Синхронизировано.', language), confirmed);
    assert.equal(translateText('Сохранено на устройстве · ожидает синхронизации', language), queued);
  }
});

test('moving a task preserves user titles even when they look like words or template variables', () => {
  const source = 'Задача «{item}» перемещена в проект «{project}».';
  for (const language of REGION_LANGUAGES) {
    const values = { item: 'Задача {project} $&', project: 'Привет / שלום' };
    const text = formatTranslatedText(source, language, values);
    assert.ok(text.includes(values.item) && text.includes(values.project), language);
    if (language !== 'ru') assert.ok(!text.startsWith('Задача «'), language);
  }
});

test('the install prompt has localized copy and keeps the same app identity and offline entry point', () => {
  const base = json('../public/manifest.en.webmanifest');
  for (const language of ['he', 'ar', 'ko', 'nl']) {
    const manifest = json('../public/' + languageManifest(language));
    assert.equal(manifest.lang, language);
    assert.equal(manifest.dir, languageDirection(language));
    assert.notEqual(manifest.description, base.description);
    for (const field of ['id', 'start_url', 'scope', 'icons']) assert.deepEqual(manifest[field], base[field]);
  }
});
