import { REGION_LANGUAGES } from "../app/region-language.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { calendarModule } from "./helpers/calendar-modules.mjs";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const data = read("app/olympian-knowledge.json");
const original = read("app/olympian-isopsephy.json");
const languages = [...REGION_LANGUAGES];
const copies = Object.fromEntries(languages.map(language => [language, read(`app/olympian-knowledge-copy/${language}.json`)]));
const { greekIsopsephy, restorationRoot } = calendarModule("app/stoicheion-restoration-math.ts");
const { THEOKYKLOS_SEGMENTS } = calendarModule("app/theokyklos-data.ts");

test("the research keeps all 13 accepted names and the actual 14 Theokyklos nodes", () => {
  assert.deepEqual(Object.keys(data.deities), original.deities.map(deity => deity.id));
  assert.deepEqual(data.sectors.map(sector => sector.id).sort(), THEOKYKLOS_SEGMENTS.map(sector => sector.id).sort());
  for (const deity of original.deities) {
    const knowledge = data.deities[deity.id];
    assert.ok(data.sectors.some(sector => sector.id === knowledge.sectorId));
    assert.equal(knowledge.words.length, 4);
    assert.equal(knowledge.situations.length, 3);
    for (const id of knowledge.relatedIds) assert.ok(data.deities[id] && id !== deity.id);
    for (const id of knowledge.sourceIds) assert.ok(data.sources.some(source => source.id === id));
  }
  assert.equal(data.deities.hestia.sectorId, "hearth");
  assert.equal(data.deities.dionysus.sectorId, "center");
  assert.equal(data.sectors.find(sector => sector.id === "south").names.map(greekIsopsephy).reduce((a, b) => a + b), 1302);
});

test("equal sums, shared roots and meaningful differences remain distinct", () => {
  assert.equal(greekIsopsephy("ΗΡΑ"), 109);
  assert.equal(greekIsopsephy("ΑΗΡ"), 109);
  assert.equal(greekIsopsephy("ΑΘΗΝΑ"), 69);
  assert.equal(greekIsopsephy("ΑΚΜΗ"), 69);
  assert.equal(greekIsopsephy("ΔΙΟΣ"), 284);
  assert.equal(greekIsopsephy("ΘΕΟΣ"), 284);
  assert.equal(greekIsopsephy("ΑΡΤΕΜΗΣ"), 654);
  assert.equal(greekIsopsephy("ΟΔΟΣ"), 344);
  assert.equal(greekIsopsephy("ΠΟΣΕΙΔΑΩΝ"), 1220);
  assert.equal(greekIsopsephy("ΑΠΟΛΛΩΝΟΣ"), 1331);
  for (const deity of original.deities) for (const word of data.deities[deity.id].words) {
    const value = greekIsopsephy(word.greek);
    const reference = word.reference ? greekIsopsephy(word.reference) : deity.number;
    if (["exact", "caseMatch"].includes(word.relation)) assert.equal(value, reference);
    if (word.relation === "rootMatch") assert.equal(restorationRoot(value), restorationRoot(reference));
  }
});

test("all 18 reading catalogues have every field and preserve Greek calculation inputs", () => {
  const keys = Object.keys(copies.ru).sort();
  const greek = value => value.match(/[\p{Script=Greek}\p{M}]+/gu) ?? [];
  for (const [language, copy] of Object.entries(copies)) {
    assert.deepEqual(Object.keys(copy).sort(), keys, language);
    for (const key of keys) {
      assert.ok(typeof copy[key] === "string" && copy[key].trim(), `${language}/${key}`);
      assert.ok(!copy[key].includes('\n'), `${language}/${key}: one paragraph per field`);
      if (key.startsWith('source.') && key.endsWith('.passage') && /^(?:[IVXLCDM]+[.;]|[0-9])/.test(copies.en[key])) assert.equal(copy[key], copies.en[key], `${language}/${key}: exact citation locator`);
      assert.doesNotMatch(copy[key], /⟦|⟧|〔|〕|авторская система|authorial system|author['’]s system/iu, `${language}/${key}`);
      for (const word of greek(copies.en[key])) assert.ok(copy[key].includes(word), `${language}/${key}: ${word}`);
    }
  }
  assert.equal(copies.ru.system, "Система Ордена Авроры");
  assert.equal(copies.ru.interpretation, "Представление Ордена Авроры");
  assert.equal(copies.ru.calculation, "Расчёты Ордена Авроры");
});

test("every visible reference resolves to a translated label and a primary text URL", () => {
  for (const source of data.sources) {
    assert.equal(new URL(source.url).protocol, "https:");
    for (const copy of Object.values(copies)) for (const field of ["author", "work", "passage"]) assert.ok(copy[source[field]]);
  }
  for (const knowledge of Object.values(data.deities)) for (const copy of Object.values(copies)) {
    for (const key of [knowledge.ancient, knowledge.sacred, knowledge.formula, knowledge.meaning, knowledge.bridge, knowledge.limits]) assert.ok(copy[key]);
    for (const variant of knowledge.variants) { assert.ok(copy[variant.label]); assert.ok(greekIsopsephy(variant.greek) > 0); }
    for (const word of knowledge.words) for (const key of [word.meaning, word.note, word.relation]) assert.ok(copy[key]);
  }
});
