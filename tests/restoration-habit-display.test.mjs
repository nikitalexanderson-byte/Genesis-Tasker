import assert from "node:assert/strict";
import test from "node:test";
import { localizedModule } from "./helpers/localized-modules.mjs";
const { restorationHabitDisplay } = localizedModule("app/restoration-habit-display.ts");
const { restorationRecommendation } = localizedModule("app/stoicheion-restoration-commit.ts");
const { RESTORATION_SECTORS } = localizedModule("app/stoicheion-restoration-data.ts");
const { restorationLocal, restorationCopy } = localizedModule("app/stoicheion-restoration-copy.ts");
const { getStoicheionLetters } = localizedModule("app/stoicheion-data.ts");
const { LANGUAGES } = localizedModule("app/i18n.ts");
const source = {
  sourceDate: "2026-10-28", sourceSeed: 123,
  cards: ["mu", "psi", "omega", "theta", "upsilon", "chi", "omicron", "pi", "beta"].map(letterId => ({ letterId, reversed: true })),
  sectorId: "southeast", letterId: "beta", need: "conflict", supportIds: ["hearth"], resourceLetterId: "xi",
};
function saved(language) {
  const recommendation = restorationRecommendation(source, source.sectorId, source, language);
  const intention = restorationLocal(RESTORATION_SECTORS.find(sector => sector.id === source.sectorId).needs[source.need].intention, language);
  return { title: `${restorationCopy(language).title} · ${getStoicheionLetters(language).find(letter => letter.id === source.letterId).name}`,
    description: `${intention}\n\n${recommendation.practiceText}\n\n${recommendation.action}`, stoicheionRestoration: { ...source, ...recommendation, intention } };
}

test("saved restoration recommendations follow the selected language across all authored locales", () => {
  for (const from of LANGUAGES) for (const to of LANGUAGES) {
    const habit = saved(from), before = structuredClone(habit), target = saved(to);
    assert.deepEqual(restorationHabitDisplay(habit, to), { title: target.title, description: target.description }, `${from} → ${to}`);
    assert.deepEqual(habit, before, "Saved snapshot must not be rewritten");
  }
});

test("custom habit title and custom paragraphs survive localization", () => {
  const habit = saved("ru"); habit.title = "Моя личная цель";
  const custom = "Мои собственные действия, не текст каталога.";
  habit.description += `\n\n${custom}`;
  const result = restorationHabitDisplay(habit, "en");
  assert.equal(result.title, habit.title);
  assert.equal(result.description, saved("en").description + `\n\n${custom}`);
});
