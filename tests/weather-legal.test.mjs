import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mkdir, writeFile, rm} from "node:fs/promises";
import {fileURLToPath, pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "vite";
import react from "@vitejs/plugin-react";
import test from "node:test";
import {calendarModule} from "./helpers/calendar-modules.mjs";

const languages = ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
const sections = [
  ["solarTitle", "solarBody", "weatherSolarLegalSection"],
  ["androidSolarTitle", "androidSolarBody", "weatherAndroidSolarLegalSection"],
  ["weatherTitle", "weatherBody", "weatherSourcesLegalSection"],
];
const copy = JSON.parse(readFileSync(new URL("../app/weather-legal-copy.json", import.meta.url), "utf8"));
const policy = calendarModule("app/weather-legal.ts");

test("all fourteen locales contain the complete solar and weather disclosures", () => {
  assert.deepEqual(Object.keys(copy).sort(), [...languages].sort());
  for (const language of languages) {
    assert.deepEqual(Object.keys(copy[language]).sort(), sections.flatMap(([title, body]) => [title, body]).sort());
    for (const [title, body] of sections) {
      for (const field of [title, body]) {
        assert.ok(copy[language][field].trim(), `${language}:${field}`);
        if (language !== "ru") assert.notEqual(copy[language][field], copy.ru[field], `${language}:${field}: Russian fallback`);
        if (!["ru", "en"].includes(language)) assert.notEqual(copy[language][field], copy.en[field], `${language}:${field}: English fallback`);
        if (!["ru", "sr", "uk"].includes(language)) assert.doesNotMatch(copy[language][field], /[А-Яа-яЁё]/u, `${language}:${field}: Cyrillic leaked`);
        assert.doesNotMatch(copy[language][field], /<\/?[A-Za-z][^>]*>|client_secret|access_token|refresh_token/iu);
      }
      assert.match(copy[language][body], /IP/u);
      assert.match(copy[language][body], /GENESIS/u);
      assert.match(copy[language][body], /Open-Meteo/u);
    }
    for (const body of ["solarBody", "androidSolarBody"]) assert.match(copy[language][body], /GeoJS/u);
    assert.match(copy[language].weatherBody, /MET Norway/u);
    assert.match(copy[language].weatherBody, /OAuth/u);
    assert.match(copy[language].weatherBody, /CC BY 4\.0/u);
    for (const url of ["https://www.met.no/", "https://creativecommons.org/licenses/by/4.0/", "https://open-meteo.com/en/terms"]) {
      assert.ok(copy[language].weatherBody.includes(url), `${language}: missing provider/license URL`);
    }
  }
  assert.match(copy.ru.solarBody, /Опорные координаты часового пояса для погоды не используются/);
  assert.match(copy.ru.androidSolarBody, /после выбора запрос к GeoJS для солнечного времени не выполняется/);
  assert.match(copy.ru.weatherBody, /округлённые до четырёх знаков после запятой/);
  assert.match(copy.ru.weatherBody, /без связи с аккаунтом и без истории перемещений/);
  assert.match(copy.ru.weatherBody, /Прогноз модели не является фактическим наблюдением/);
  assert.match(copy.ru.weatherBody, /Неизвестные осадки и снежный покров не подставляются по температуре или месяцу/);
  assert.match(copy.ru.weatherBody, /При недоступности источника или координат погодные эффекты отключаются/);
  assert.doesNotMatch(copy.ru.weatherBody, /ещё не принят|не приняты|не согласован/iu);
});

test("static Russian sections and localized lookups use the same complete disclosures", () => {
  for (const [title, body, exported] of sections) assert.deepEqual(policy[exported], [copy.ru[title], copy.ru[body]]);
  for (const language of languages) {
    const localized = policy.localizedWeatherLegalSections(language);
    assert.equal(localized.size, sections.length);
    for (const [title, body] of sections) assert.deepEqual(localized.get(copy.ru[title]), [copy[language][title], copy[language][body]]);
  }
  for (const language of ["unknown", "__proto__", "constructor"]) {
    assert.deepEqual([...policy.localizedWeatherLegalSections(language)], [...policy.localizedWeatherLegalSections("en")]);
  }
});

test("real privacy renders all three complete sections once in every locale without DOM translation", async () => {
  const root = fileURLToPath(new URL("../app/", import.meta.url)).replaceAll("\\", "/");
  const entry = "virtual:weather-legal-contract";
  const bundle = await build({configFile: false, logLevel: "silent", plugins: [react(), {
    name: "weather-legal-contract", resolveId: id => id === entry ? entry : undefined,
    load: id => id === entry ? `export {LegalPage} from ${JSON.stringify(root + "LegalPage.tsx")};export {legalPages} from ${JSON.stringify(root + "legal-content.ts")};export {setRuntimeLanguage} from ${JSON.stringify(root + "i18n.ts")};` : undefined,
  }], build: {ssr: true, write: false, rolldownOptions: {input: entry, external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"], output: {codeSplitting: false}}}});
  const directory = new URL("../node_modules/.cache/genesis-tests/", import.meta.url);
  await mkdir(directory, {recursive: true});
  const file = new URL(`weather-legal-${randomUUID()}.mjs`, directory);
  await writeFile(file, bundle.output.find(item => item.isEntry).code);
  try {
    const {LegalPage, legalPages, setRuntimeLanguage} = await import(pathToFileURL(fileURLToPath(file)).href);
    const sourceSections = legalPages.privacy.sections;
    const solarIndex = sourceSections.findIndex(([title]) => title === copy.ru.solarTitle);
    assert.equal(sourceSections[solarIndex + 1][0], "Регион в приложении Android");
    assert.equal(sourceSections[solarIndex + 2][0], copy.ru.androidSolarTitle);
    assert.equal(sourceSections[solarIndex + 3][0], copy.ru.weatherTitle);
    for (const language of languages) {
      setRuntimeLanguage(language);
      const html = renderToStaticMarkup(createElement(LegalPage, {page: "privacy"}));
      for (const [title, body] of sections) {
        assert.equal(sourceSections.filter(([sourceTitle]) => sourceTitle === copy.ru[title]).length, 1);
        assert.ok(sourceSections.some(([sourceTitle, sourceBody]) => sourceTitle === copy.ru[title] && sourceBody === copy.ru[body]));
        const expected = renderToStaticMarkup(createElement("section", {"data-no-translate": true}, createElement("h2", null, copy[language][title]), createElement("p", null, copy[language][body])));
        assert.equal(html.split(expected).length - 1, 1, `${language}:${title}: complete authored section must render once`);
        if (language !== "ru") assert.ok(!html.includes(copy.ru[body]), `${language}:${body}: Russian source leaked`);
      }
    }
  } finally { await rm(file); }
});
