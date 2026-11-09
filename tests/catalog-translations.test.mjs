import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const languages = ["en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
const letters = read("app/stoicheion.en.json");
const artwork = read("android/app/src/main/assets/stoicheion-art.json");
const theokyklos = read("android/app/src/main/assets/catalogs/theokyklos.json");

function pairsIn(value, pairs = new Map()) {
  if (Array.isArray(value)) value.forEach((child) => pairsIn(child, pairs));
  else if (value && typeof value === "object") {
    if (typeof value.ru === "string" && typeof value.en === "string") pairs.set(value.ru, value.en);
    Object.values(value).forEach((child) => pairsIn(child, pairs));
  }
  return pairs;
}

const sourcePairs = pairsIn(theokyklos);
const words = theokyklos.segments.flatMap((segment) => segment.words.map((word) => word.greek));
const greekWord = /[\u0370-\u03ff\u1f00-\u1fff]{2,}/u;
const cyrillic = /[\u0400-\u052f]/u;

test("advertisement controls have copy in every supported language", () => {
  const web = readFileSync(new URL("../app/TodayAdBlock.tsx", import.meta.url), "utf8");
  const android = readFileSync(new URL("../android/app/src/main/java/ru/genesis/calendar/ui/TodayAdPanel.kt", import.meta.url), "utf8");
  for (const language of ["ru", ...languages]) {
    assert.match(web, new RegExp(`\\b${language}: \\{ ad:`, "u"));
    assert.match(android, new RegExp(`"${language}" to AdCopy\\(`, "u"));
  }
});

for (const language of languages) {
  test(`${language}: all catalog and year texts exist with the required script`, () => {
    const catalog = read(`app/catalog-translations/${language}.json`);
    const year = read(`app/year-translations/${language}.json`);
    assert.deepEqual(Object.keys(catalog.stoicheion).sort(), Object.keys(letters).sort());
    assert.deepEqual(Object.keys(catalog.stoicheionArt).sort(), Object.keys(artwork).sort());
    assert.deepEqual(Object.keys(catalog.theokyklos).sort(), [...sourcePairs.keys()].sort());
    assert.deepEqual(Object.keys(catalog.theokyklosWords).sort(), [...new Set(words)].sort());
    assert.ok(Object.keys(year).length >= 46);
    assert.match(year.__lunarStartTemplate, /\{date\}/u);
    assert.match(year.__lunarStartTemplate, /\{months\}/u);
    assert.ok(Object.keys(year).some((key) => key.length > 1500), "full civil calendar essay");
    assert.ok(Object.keys(year).some((key) => key.includes("женский") && key.length > 300));
    for (const letter of Object.values(catalog.stoicheion)) {
      for (const field of ["name", "tagline", "content"]) {
        assert.ok(letter[field]?.trim(), `missing Stoicheion ${field}`);
        assert.doesNotMatch(letter[field], /(?:ZXQ|⟦\d+⟧|〔\d+〕)/u);
        if (language !== "el") assert.doesNotMatch(letter[field], greekWord);
        if (!["uk", "sr"].includes(language)) assert.doesNotMatch(letter[field], cyrillic);
      }
    }
    for (const art of Object.values(catalog.stoicheionArt)) {
      assert.ok(art.body && art.bodyGreek && art.invocation);
      if (language === "el") assert.match(art.bodyGreek, greekWord);
      else if (language === "uk") assert.match(art.bodyGreek, cyrillic);
      else assert.doesNotMatch(art.bodyGreek, greekWord);
    }
    for (const value of Object.values(catalog.theokyklos)) {
      assert.ok(value.trim());
      assert.doesNotMatch(value, /(?:ZXQ|⟦\d+⟧|〔\d+〕)/u);
      if (language !== "el") assert.doesNotMatch(value, greekWord);
      if (!["uk", "sr"].includes(language)) assert.doesNotMatch(value, cyrillic);
    }
    for (const value of Object.values(catalog.theokyklosWords)) {
      if (language === "el") assert.match(value, greekWord);
      else if (language === "uk") assert.match(value, cyrillic);
      else if (language === "sr") assert.match(value, /^[\p{Script=Cyrillic} '-]+$/u);
      else assert.match(value, /^[A-Za-z '-]+$/u);
    }
  });
}
