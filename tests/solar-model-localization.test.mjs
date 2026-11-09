import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { localizedModule } from "./helpers/localized-modules.mjs";
const { solarModelTranslator } = localizedModule("app/solar-model-copy.ts");
const { translateText } = localizedModule("app/i18n.ts");
const refinementCopy = JSON.parse(readFileSync("app/ui-refinement-copy.json", "utf8"));
const svg = readFileSync("public/calendar-art/genesis-sacred-calendar-v8.svg", "utf8");
const labels = [...svg.matchAll(/<(?:text|title|desc)\b[^>]*>([^<]+)<\//gu)].map(match => match[1]);
labels.push(...[...svg.matchAll(/class="curved-label"[^>]*aria-label="([^"]+)"/gu)].map(match => match[1]));
const text = [...new Set(labels)].filter(value => value.length > 1 && /[А-Яа-яЁё]/u.test(value));

test("all labels inside the original calendar vector have translations in every non-Cyrillic locale", () => {
  for (const language of ["en", "de", "el", "fr", "es", "it", "pt", "pl", "zh", "tr", "ja"]) {
    const translate = solarModelTranslator(language);
    const missing = text.filter(source => /[А-Яа-яЁё]/u.test(translate(source)));
    assert.deepEqual(missing, [], `${language}: untranslated vector labels`);
  }
});

test("dates, pentads, day titles and root description are localized without changing numeric selection", () => {
  const t = solarModelTranslator("en");
  assert.equal(t("19–21 МАРТА"), "19–21 MARCH");
  assert.equal(t("ПЯТА II  ·  06–10"), "QUINTA II · 06–10");
  assert.match(t("АРЕЙОС · 1 · Арейос Ридзоматос (Арейос Укореняющий)"), /^AREIOS · 1 · /u);
  assert.equal(solarModelTranslator("ru")("АРЕЙОС"), "АРЕЙОС");
});

test("Cyrillic locales use Serbian and Ukrainian labels rather than Russian fallbacks", () => {
  const sr = solarModelTranslator("sr"), uk = solarModelTranslator("uk");
  assert.equal(sr("САКРАЛЬНЫЙ КАЛЕНДАРЬ"), "СВЕТИ КАЛЕНДАР");
  assert.equal(sr("5 ДНЕЙ"), "5 ДАНА");
  assert.equal(sr("ПЯТА II"), "QUINTA II");
  assert.equal(uk("5 ДНЕЙ"), "5 ДНІВ");
  assert.equal(uk("КОНЕЦ ГОДА"), "КІНЕЦЬ РОКУ");
  assert.equal(uk("ПЯТА II"), "QUINTA II");
});

test("calendar controls and vector labels preserve the approved Quinta name in every non-Russian locale", () => {
  const controls = ["Пята", "Выберите пяту",
    "Нажмите на месяц, пяту или день, чтобы приблизить. Перетаскивайте круг; меняйте масштаб колёсиком или двумя пальцами.",
    "Выберите месяц, пяту или день. Масштабируйте двумя пальцами и перемещайте круг.",
    "12 месяцев, 72 пяты и 360 дней. В центре — Апейрон, вне обычного счёта."];
  for (const language of Object.keys(refinementCopy).filter(value => value !== "ru")) {
    assert.equal(translateText("Пята", language), "Quinta", `${language}: late copy must not restore an old term`);
    for (const source of controls) assert.match(translateText(source, language), /Quinta/u, `${language}/${source}`);
    const t = solarModelTranslator(language);
    assert.equal(t("ПЯТА II"), `${"Quinta".toLocaleUpperCase(language)} II`, `${language}: numbered Quinta`);
    assert.equal(t("72 ПЯТЫ"), "72 Quintas".toLocaleUpperCase(language), `${language}: year count`);
    assert.equal(t("6 ПЯТ"), "6 Quintas".toLocaleUpperCase(language), `${language}: month count`);
  }
  for (const source of controls) assert.equal(translateText(source, "ru"), source);
});

test("calendar controls and proposed sleep titles resolve the selected locale, with stable month names", () => {
  for (const language of Object.keys(refinementCopy)) {
    for (const source of ["Весь круг", "Выберите месяц", "Выберите пяту", "Выберите день", "Открыть день в календаре", "Сон и пробуждение"])
      assert.equal(translateText(source, language), refinementCopy[language][source], `${language}/${source}`);
  }
  for (const language of ["en", "de", "fr", "es", "it", "pt", "pl", "zh", "tr", "ja"])
    assert.equal(translateText("ТРИГЕ", language), "TRYGE", `${language}: a proper name must not become the verb 'try'`);
  assert.equal(translateText("АРЕЙОС", "ja"), "AREIOS");
  assert.equal(translateText("КАРПОС", "zh"), "KARPOS");
});
