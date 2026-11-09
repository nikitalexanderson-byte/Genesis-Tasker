import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { calendarModule } from "./helpers/calendar-modules.mjs";

// Exercise the real translation dictionaries rather than the date-test helper's identity translator.
const require = createRequire(import.meta.url), ts = require("typescript");
const i18n = calendarModule("app/i18n.ts");
const loaded = { exports: {} };
const js = ts.transpileModule(readFileSync(new URL("../app/habit-display-text.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "module", "exports", js)(id => id === "./i18n" ? i18n
  : calendarModule(`app/${id.slice(2)}.ts`), loaded, loaded.exports);
const { habitDisplayText } = loaded.exports;
const { SACRED_PRACTICES } = calendarModule("app/sacred-practices.ts");
const { STARTER_HABIT_TEMPLATES } = calendarModule("app/habit-templates.ts");
const { catalogText } = calendarModule("app/catalog-i18n.ts");
const { REGION_LANGUAGES } = calendarModule("app/region-language.ts");
const text = (title, description, ids = {}) => ({ title, description, sourceTemplateId: null, sacredPracticeId: null, ...ids });

test("activated sacred defaults display in the selected language regardless of their saved locale", () => {
  for (const practice of SACRED_PRACTICES) for (const savedLanguage of REGION_LANGUAGES) {
    const habit = text(catalogText(practice.title, savedLanguage), catalogText(practice.description, savedLanguage), { sacredPracticeId: practice.id });
    const before = JSON.stringify(habit);
    for (const language of REGION_LANGUAGES) assert.deepEqual(habitDisplayText(habit, language), {
      title: catalogText(practice.title, language), description: catalogText(practice.description, language),
    }, `${practice.id}: ${savedLanguage} -> ${language}`);
    assert.equal(JSON.stringify(habit), before);
  }
});

test("starter template defaults translate without changing their saved values", () => {
  for (const template of STARTER_HABIT_TEMPLATES) for (const savedEnglish of [false, true]) {
    const habit = text(savedEnglish ? template.titleEn : template.title, savedEnglish ? template.descriptionEn : template.description, { sourceTemplateId: template.id });
    const before = JSON.stringify(habit);
    for (const language of REGION_LANGUAGES) {
      const expected = { title: language === "en" ? template.titleEn : i18n.translateText(template.title, language),
        description: language === "en" ? template.descriptionEn : i18n.translateText(template.description, language) };
      assert.deepEqual(habitDisplayText(habit, language), expected, `${template.id}: ${language}`);
      if (!["ru", "sr", "uk"].includes(language)) assert.doesNotMatch(expected.title + expected.description, /[А-Яа-яЁё]/u);
    }
    assert.equal(JSON.stringify(habit), before);
  }
});

test("renamed sacred defaults retain their identity and history without replacing personal text", () => {
  const practice = SACRED_PRACTICES.find(row => row.id === "persephone-new-seed");
  for (const previous of practice.previousTitles) {
    const habit = text(previous, "Моя заметка", { sacredPracticeId: practice.id });
    const before = JSON.stringify(habit);
    for (const language of REGION_LANGUAGES) assert.deepEqual(habitDisplayText(habit, language), {
      title: catalogText(practice.title, language), description: "Моя заметка",
    });
    assert.equal(JSON.stringify(habit), before);
    assert.equal(habitDisplayText({ ...habit, sacredPracticeId: null }, "ru").title, previous);
  }
  assert.equal(habitDisplayText(text("Моё возвращение", "", { sacredPracticeId: practice.id }), "en").title, "Моё возвращение");
});

test("user text stays verbatim even if it coincides with a translated UI or another template", () => {
  const practice = SACRED_PRACTICES[0];
  const custom = text(practice.title.ru, "Моя заметка: План на день");
  assert.deepEqual(habitDisplayText(custom, "en"), { title: custom.title, description: custom.description });
  assert.deepEqual(habitDisplayText({ ...custom, sourceTemplateId: "unknown" }, "en"), { title: custom.title, description: custom.description });
  const changedTitle = text("Мой личный ритуал", practice.description.ru, { sacredPracticeId: practice.id });
  assert.deepEqual(habitDisplayText(changedTitle, "en"), { title: "Мой личный ритуал", description: practice.description.en });
  const changedDescription = text(practice.title.ru, "Моё описание", { sacredPracticeId: practice.id });
  assert.deepEqual(habitDisplayText(changedDescription, "en"), { title: practice.title.en, description: "Моё описание" });
});
