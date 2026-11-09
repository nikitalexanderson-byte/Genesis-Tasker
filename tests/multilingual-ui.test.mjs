import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const languages = ["en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
const habitReportCopy = JSON.parse(await readFile(new URL("../app/habit-report-translations.json", import.meta.url), "utf8"));
const dailyAdviceCopy = JSON.parse(await readFile(new URL("../app/daily-advice-copy.json", import.meta.url), "utf8"));
const affairsRaw = JSON.parse(await readFile(new URL("../app/native-affairs-translations.json", import.meta.url), "utf8"));
const englishUi = JSON.parse(await readFile(new URL("../app/ui-translations/en.json", import.meta.url), "utf8"));
const affairs = Object.fromEntries(Object.entries(affairsRaw).map(([language, copy]) => [language, Object.fromEntries(Object.entries(copy).filter(([source]) => source in englishUi))]));
const ui = lang => readFile(new URL(`../app/ui-translations/${lang}.json`, import.meta.url), "utf8").then(JSON.parse);
const read = name => readFile(new URL(`../app/translations.${name}.json`, import.meta.url), "utf8").then(JSON.parse);
const curatedEnglish = JSON.parse(await readFile(new URL("../app/curated-translations.en.json", import.meta.url), "utf8"));
test("all web/Android UI additions have exact copy in every language", async () => {
  const en = { ...await read("en"), ...await ui("en"), ...curatedEnglish };
  for (const lang of languages) {
    const names = ["el", "sr", "uk"].includes(lang) ? [`${lang}.a`, `${lang}.b`] : ["de", "fr", "ja", "es", "it", "pl"].includes(lang) ? [lang, `${lang}.b`] : [lang];
    const catalog = Object.assign({}, affairs[lang], ...await Promise.all(names.map(read)), await ui(lang), lang === "en" ? curatedEnglish : {});
    for (const key of Object.keys(en)) assert.ok(catalog[key]?.trim(), `${lang}: ${key}`);
  }
  const gradle = await readFile(new URL("../android/app/build.gradle.kts", import.meta.url), "utf8");
  for (const extra of ["translations.de.b.json", "translations.fr.b.json"]) assert.ok(gradle.includes(extra), `${extra} must ship offline`);
});

test("runtime translations and PDF keep Unicode, colors, full copy and saved geometry", async () => {
  const base = fileURLToPath(new URL("../app/", import.meta.url)).replaceAll("\\", "/");
  const entry = "virtual:multilingual-test";
  const result = await build({ configFile: false, logLevel: "silent", plugins: [{ name: "multilingual-test", resolveId: id => id === entry ? entry : undefined,
    load: id => id === entry ? `export * from ${JSON.stringify(base + "i18n.ts")}; export * from ${JSON.stringify(base + "mindmaps-pdf.ts")}; export * from ${JSON.stringify(base + "mindmaps-model.ts")}; export * from ${JSON.stringify(base + "legal-content.ts")};` : undefined }],
    build: { ssr: true, write: false, rolldownOptions: { input: entry, external: ["react"], output: { codeSplitting: false } } } });
  const code = result.output.find(item => item.isEntry).code;
  const directory = new URL("../node_modules/.cache/genesis-tests/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const path = new URL(`multilingual-${Date.now()}.mjs`, directory); await writeFile(path, code);
  try {
    const { translateText, setRuntimeLanguage, newMindmap, mindmapPrintHtml, legalPages } = await import(pathToFileURL(fileURLToPath(path)).href);
    assert.ok(legalPages.terms.sections.some(([title, body]) => title === dailyAdviceCopy.ru.privacyTitle && body === dailyAdviceCopy.ru.privacyNotice));
    assert.ok(!legalPages.privacy.sections.some(([title, body]) => title === dailyAdviceCopy.ru.privacyTitle || body === dailyAdviceCopy.ru.privacyNotice));
    assert.ok(legalPages.privacy.sections.some(([title, body]) => title === dailyAdviceCopy.ru.dataTitle && body === dailyAdviceCopy.ru.dataNotice + " " + dailyAdviceCopy.ru.ageData));
    for (const lang of languages) {
      for (const field of ["privacyTitle", "privacyNotice", "dataTitle", "dataNotice"]) assert.equal(translateText(dailyAdviceCopy.ru[field], lang), dailyAdviceCopy[lang][field], `${lang}: advice legal text ${field}`);
      for (const [source, expected] of Object.entries(habitReportCopy[lang])) assert.equal(translateText(source, lang), expected, `${lang}: report ${source}`);
      const names = ["el", "sr", "uk"].includes(lang) ? [`${lang}.a`, `${lang}.b`] : ["de", "fr", "ja", "es", "it", "pl"].includes(lang) ? [lang, `${lang}.b`] : [lang];
      const catalog = Object.assign({}, affairs[lang], ...await Promise.all(names.map(read)), await ui(lang), lang === "en" ? curatedEnglish : {});
      assert.equal(translateText("Майндмепы", lang), catalog["Майндмепы"]);
      assert.equal(translateText("Ширина хаос-бокса", lang), catalog["Ширина хаос-бокса"]);
      assert.equal(translateText("Экспорт PDF", lang), catalog["Экспорт PDF"]);
      for (const label of ["Расположение", "Отображение", "Подробно", "Дела · личные", "Организуйте проекты, задачи и списки"]) {
        assert.equal(translateText(label, lang), catalog[label], `${lang}: ${label}`);
      }
      const multiline = Object.keys(catalog).find(key => key.startsWith("Вход уже выполнен."));
      assert.equal(translateText(multiline.replace(/\s+/g, " "), lang), catalog[multiline]);
      assert.equal(translateText("Связанные задачи: 1 из 24", lang, true), `${catalog["Связанные задачи:"]} 1 ${catalog["из"]} 24`);
      setRuntimeLanguage(lang);
      const map = newMindmap("Полное название · 計画 · Ελληνικά <script>");
      map.nodes[0].style = { fill: "#000000", border: "#abcdef" };map.appearance={lineColor:"#123456"};
      map.nodes[0].note = "Пояснение без обрезки\n日本語 και ελληνικά";
      const html = mindmapPrintHtml(map, node => node.text || "", { mode: "map", collapsed: [], focus: null, zoom: 1, positions: { [map.nodes[0].id]: { x: 888, y: 999 } } });
      assert.match(html, /x="888" y="999"/);assert.match(html, /fill="#000000" stroke="#abcdef"/);
      assert.match(html, /Пояснение без обрезки/);assert.match(html, /viewBox="0 0 1168 1139"/);
      assert.ok(html.includes(catalog["Структура карты"]));assert.doesNotMatch(html, /<script>/);
    }
  } finally { await rm(path); }
});
