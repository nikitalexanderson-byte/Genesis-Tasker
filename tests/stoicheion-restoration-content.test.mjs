import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(readSource(path));
const content = readJson("app/stoicheion-restoration-content.json");
const ui = readJson("app/stoicheion-restoration-ui.json");
const modes = ["deficit", "excess", "conflict"];
const languages = ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];

// Inspect only literal catalogue constants. In particular, loading the React
// view to obtain SPREAD_POSITIONS would execute unrelated UI dependencies.
function literal(node) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return literal(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((property) => {
      assert.ok(ts.isPropertyAssignment(property), "catalogue contains a nonliteral property");
      return [property.name.text, literal(property.initializer)];
    }));
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText() === "Object" && node.expression.name.text === "freeze") {
    return literal(node.arguments[0]);
  }
  throw new Error(`Unsupported catalogue literal: ${ts.SyntaxKind[node.kind]}`);
}

function constant(path, name) {
  const source = ts.createSourceFile(path, readSource(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find((entry) => entry.name.getText(source) === name);
    if (declaration?.initializer) return literal(declaration.initializer);
  }
  throw new Error(`Missing ${name} in ${path}`);
}

const spread = constant("app/StoicheionView.tsx", "SPREAD_POSITIONS");
const sectorIds = constant("app/sacred-practices.ts", "STOICHEION_PRACTICE_SECTOR_IDS");
const practices = new Map(constant("app/sacred-practices.ts", "SACRED_PRACTICES").map((entry) => [entry.id, entry]));
const letterIds = constant("app/stoicheion-data.ts", "STOICHEION_LETTERS").map((entry) => entry.id);
const auxiliaryWords = constant("app/stoicheion-restoration-math.ts", "AUXILIARY_WORDS");
const auxiliaryIds = Object.keys(auxiliaryWords);
const sorted = (values) => [...values].sort();

function hasText(value, label) {
  assert.equal(typeof value, "string", `${label}: text must be a string`);
  assert.ok(value.trim(), `${label}: text must not be empty`);
  assert.doesNotMatch(value, /(?:\bTODO\b|\bTBD\b|ZXQ|⟦\d+⟧|〔\d+〕)/iu, `${label}: unfinished copy`);
}

function bilingual(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label}: localized pair required`);
  assert.deepEqual(sorted(Object.keys(value)), ["en", "ru"], `${label}: exact RU/EN coverage`);
  for (const language of ["ru", "en"]) hasText(value[language], `${label}.${language}`);
  assert.match(value.ru, /\p{Script=Cyrillic}/u, `${label}.ru: Russian copy required`);
  assert.doesNotMatch(value.en, /\p{Script=Cyrillic}/u, `${label}.en: untranslated Russian copy`);
}

test("restoration keeps exactly the existing nine spread fields as its primary meanings", () => {
  assert.equal(content.sectors.length, 9);
  assert.equal(new Set(content.sectors.map((entry) => entry.id)).size, 9);
  assert.deepEqual(sorted(content.sectors.map((entry) => entry.id)), sorted(sectorIds));
  assert.deepEqual(sorted(spread.map((entry) => entry.id)), sorted(sectorIds));
  for (const position of spread) {
    const sector = content.sectors.find((entry) => entry.id === position.id);
    assert.equal(sector.field.ru, position.meaning, `${position.id}: the spread's meaning must remain authoritative`);
  }
});

test("all five auxiliary nodes keep the same Greek keys as the arithmetic model", () => {
  assert.equal(content.auxiliaries.length, 5);
  assert.equal(new Set(content.auxiliaries.map((entry) => entry.id)).size, 5);
  assert.deepEqual(content.auxiliaries.map((entry) => entry.id), auxiliaryIds);
  for (const auxiliary of content.auxiliaries) {
    assert.equal(auxiliary.word, auxiliaryWords[auxiliary.id], auxiliary.id);
    bilingual(auxiliary.title, `${auxiliary.id}.title`);
    bilingual(auxiliary.purpose, `${auxiliary.id}.purpose`);
    assert.equal(practices.get(auxiliary.practiceId)?.sectorId, auxiliary.id, `${auxiliary.id}: existing matching sacred practice`);
  }
});

test("every sector has three complete bilingual practices with valid sacred-habit and support links", () => {
  for (const sector of content.sectors) {
    for (const key of ["title", "field", "ambivalence"]) bilingual(sector[key], `${sector.id}.${key}`);
    assert.deepEqual(sorted(Object.keys(sector.needs)), sorted(modes), sector.id);
    for (const mode of modes) {
      const need = sector.needs[mode];
      for (const key of ["risk", "quality", "intention", "action", "practice"]) {
        bilingual(need[key], `${sector.id}.${mode}.${key}`);
      }
      assert.ok(auxiliaryIds.includes(need.supportId), `${sector.id}.${mode}: known support`);
      assert.equal(practices.get(need.practiceId)?.sectorId, sector.id, `${sector.id}.${mode}: existing matching sector habit`);
    }
  }
});

test("all twenty-four authored letters have individual actions and contemplations for every mode", () => {
  assert.equal(letterIds.length, 24);
  assert.deepEqual(sorted(Object.keys(content.letterFoci)), sorted(letterIds));
  let count = 0;
  for (const [id, focus] of Object.entries(content.letterFoci)) {
    for (const key of ["risk", "quality"]) bilingual(focus[key], `${id}.${key}`);
    assert.deepEqual(sorted(Object.keys(focus.needs)), sorted(modes), id);
    for (const mode of modes) {
      for (const key of ["action", "practice"]) bilingual(focus.needs[mode][key], `${id}.${mode}.${key}`);
      count += 1;
    }
  }
  assert.equal(count, 72);
});

test("need modes and individual cards cannot silently fall back to a shared generic practice", () => {
  for (const language of ["ru", "en"]) {
    for (const [kind, entries] of [
      ["sector", content.sectors],
      ["letter", Object.entries(content.letterFoci).map(([id, entry]) => ({ id, ...entry }))],
    ]) {
      for (const key of ["action", "practice"]) {
        const all = entries.flatMap((entry) => modes.map((mode) => entry.needs[mode][key][language].trim()));
        assert.equal(new Set(all).size, entries.length * modes.length, `${language}: ${kind} ${key} must be individualized`);
      }
    }
  }
  // These distinct mechanisms come from the authored catalogue, rather than
  // from the UI's presentation or the numerical candidate-selection code.
  const mechanisms = {
    beta: /(?:поддержк|соглас|сотруднич|обещани)/iu,
    gamma: /(?:начал|середин|заверш|форм|результат)/iu,
    kappa: /(?:срок|момент|врем|правил)/iu,
    xi: /(?:распредел|пропорци|соглаш|потребност|равновес)/iu,
    pi: /(?:вол|решени|ответствен|давлен)/iu,
    omega: /(?:заверш|прошл|этап|вывод|круг)/iu,
  };
  for (const [id, mechanism] of Object.entries(mechanisms)) {
    for (const mode of modes) {
      const need = content.letterFoci[id].needs[mode];
      assert.match(`${need.action.ru} ${need.practice.ru}`, mechanism, `${id}.${mode}: retain the card's own mechanism`);
    }
  }
});

test("myths cite specific primary texts and attribute the interpretation to the Order of Aurora", () => {
  for (const sector of content.sectors) {
    const myth = sector.myth;
    bilingual(myth.title, `${sector.id}.myth.title`);
    bilingual(myth.body, `${sector.id}.myth.body`);
    hasText(myth.source, `${sector.id}.myth.source`);
    assert.match(myth.source, /\d/u, `${sector.id}: citation needs a book, hymn or passage reference`);
    const url = new URL(myth.url);
    assert.equal(url.protocol, "https:", `${sector.id}: secure primary-source link`);
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    const primaryText = (url.hostname === "www.theoi.com" && url.pathname.startsWith("/Text/"))
      || (url.hostname === "www.perseus.tufts.edu" && url.pathname === "/hopper/text" && url.searchParams.has("doc"));
    assert.ok(primaryText, `${sector.id}: use a primary text on Theoi or Perseus`);
    assert.match(myth.body.ru, /Согласно представлениям Ордена Авроры/u, `${sector.id}: attribute the interpretation`);
    assert.match(myth.body.en, /According to the views of the Order of Aurora/u, `${sector.id}: attribute the interpretation`);
  }
});

test("new personal practices avoid forced breathing, painful poses, and medical guarantees", () => {
  const unsafe = /(?:задерж(?:ите|ка)\s+дыхани|до\s+боли|излеч(?:ит|ени)|гарантированн(?:ое|ый)\s+исцел|hold\s+(?:your|the)\s+breath|painful\s+pose|guaranteed\s+(?:healing|cure))/iu;
  for (const [id, focus] of Object.entries(content.letterFoci)) {
    for (const mode of modes) {
      for (const key of ["action", "practice"]) {
        for (const language of ["ru", "en"]) {
          assert.doesNotMatch(focus.needs[mode][key][language], unsafe, `${id}.${mode}.${key}.${language}`);
        }
      }
    }
  }
});

test("restoration UI has complete matching messages in each of the fourteen supported languages", () => {
  assert.deepEqual(sorted(Object.keys(ui)), sorted(languages));
  const keys = Object.keys(ui.ru);
  assert.equal(keys.length, 67);
  for (const language of languages) {
    assert.deepEqual(sorted(Object.keys(ui[language])), sorted(keys), language);
    for (const key of keys) hasText(ui[language][key], `${language}.${key}`);
    assert.equal(ui[language].formula, "ρ(A + B + U) = P", `${language}: mathematical notation stays consistent`);
    assert.match(ui[language].tetractys, /1\s*\+\s*2\s*\+\s*3\s*\+\s*4\s*=\s*10/u, `${language}: preserve the tetractys`);
  }
});
