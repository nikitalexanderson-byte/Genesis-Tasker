import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { calendarModule } from "./helpers/calendar-modules.mjs";

const guide = JSON.parse(readFileSync(new URL("../app/future-modeling.json", import.meta.url), "utf8"));
const olympians = JSON.parse(readFileSync(new URL("../app/olympian-isopsephy.json", import.meta.url), "utf8"));
const { greekIsopsephy } = calendarModule("app/stoicheion-restoration-math.ts");
const { futureModelingCopy } = calendarModule("app/future-modeling.ts");
const { REGION_LANGUAGES } = calendarModule("app/region-language.ts");

test("the independent Olympian map covers all nine sectors and all thirteen patrons without changing their numbers", () => {
  const expected = {
    northwest: ["hera", "artemis"], north: ["poseidon"], northeast: ["zeus"], west: ["hermes"],
    center: ["kronos", "hestia"], east: ["apollo", "athena"], southwest: ["demeter", "hephaestus"],
    south: ["ares"], southeast: ["aphrodite", "dionysus"],
  };
  assert.deepEqual(Object.fromEntries(guide.sectors.map(sector => [sector.id, sector.deities])), expected);
  const figures = [...olympians.deities, ...olympians.references];
  assert.equal(figures.length, 14);
  assert.equal(new Set(guide.sectors.flatMap(sector => sector.deities)).size, 14);
  assert.deepEqual(new Set(guide.sectors.flatMap(sector => sector.deities)), new Set(figures.map(figure => figure.id)));
  assert.deepEqual(guide.goals.map(goal => goal.deityId), olympians.deities.map(figure => figure.id));
  assert.equal(new Set(guide.goals.map(goal => goal.deityId)).size, 13);
  for (const figure of figures) assert.equal(greekIsopsephy(figure.greek), figure.number, figure.id);
  assert.equal(greekIsopsephy("ΑΚΜΗ"), olympians.deities.find(figure => figure.id === "athena").number);
  assert.equal(olympians.deities.find(figure => figure.id === "aphrodite").number, 993);
});

test("every guide locale has the complete five-step instruction, nine sectors and thirteen goals", () => {
  const en = futureModelingCopy("en");
  const paragraphCounts = guide.locales.en.sections.map(section => section.paragraphs.length);
  for (const language of REGION_LANGUAGES) {
    const copy = futureModelingCopy(language);
    assert.equal(copy.language, language, `${language}: fallback`);
    for (const key of ["title", "subtitle", "intro", "close"]) assert.ok(copy[key]?.trim(), `${language}.${key}`);
    assert.equal(copy.sections.length, 5, language);
    assert.deepEqual(copy.sections.map(section => section.paragraphs.length), paragraphCounts, language);
    assert.equal(new Set(copy.sections.map(section => section.title)).size, 5, language);
    assert.ok(copy.sections.every(section => section.title.trim() && section.paragraphs.every(paragraph => paragraph.trim().length > 30)), language);
    assert.deepEqual(copy.sectors.map(sector => sector.id), guide.sectors.map(sector => sector.id), language);
    assert.ok(copy.sectors.every(sector => sector.title.trim() && sector.meaning.trim()), language);
    assert.deepEqual(copy.goals.map(goal => goal.deityId), guide.goals.map(goal => goal.deityId), language);
    assert.ok(copy.goals.every(goal => goal.goal.trim().length > 15), language);
    const text = [copy.intro, ...copy.sections.flatMap(section => section.paragraphs)].join("\n");
    for (const greek of ["στοιχεῖον", "φύσις", "πνεῦμα", "ὑστέρημα", "ὄργανον", "ΑΚΜΗ", "οὐροβόρος", "σφραγίς", "ἐκφώνησις"]) assert.ok(text.includes(greek), `${language}: ${greek}`);
    assert.match(text, /1 \+ 20 \+ 40 \+ 8 = 69/, language);
    assert.doesNotMatch(text, /1093|\{\{.*?\}\}|\[TODO\]/, language);
    if (language !== "en") {
      assert.notEqual(copy.title, en.title, language);
      copy.sections.forEach((section, index) => assert.notEqual(section.paragraphs[0], en.sections[index].paragraphs[0], language));
      copy.sectors.forEach((sector, index) => assert.notEqual(sector.meaning, en.sectors[index].meaning, language));
      copy.goals.forEach((goal, index) => assert.notEqual(goal.goal, en.goals[index].goal, language));
    }
  }
  assert.equal(futureModelingCopy("unknown").language, "en");
});
