import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Use the same TypeScript loader as the catalogue/habit tests: catalogue data
// has bundler-style imports and JSON translations, beyond Node's strip-types.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "package.json"));
const ts = require("typescript");
const cache = new Map();
function load(path) {
  if (!extname(path)) path += ".ts";
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  if (cache.has(path)) return cache.get(path).exports;
  const loaded = { exports: {} };
  cache.set(path, loaded);
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    module: loaded,
    exports: loaded.exports,
    process: { env: {} },
    require: (id) => id.startsWith(".") ? load(resolve(dirname(path), id)) : require(id),
  }, { filename: path });
  return loaded.exports;
}

const {
  AUXILIARY_WORDS, greekIsopsephy, restorationRoot, restorationTrace, buildRestorationEquation,
} = load(resolve(root, "app/stoicheion-restoration-math.ts"));
const { STOICHEION_LETTERS } = load(resolve(root, "app/stoicheion-data.ts"));
const { STOICHEION_NUMERALS } = load(resolve(root, "app/stoicheion-numerals.ts"));
const supportIds = ["entrance", "zenith", "nadir", "hearth", "exit"];
const supportValues = [412, 571, 282, 110, 1014];
const digitRoot = (n) => {
  while (n > 9) n = [...String(n)].reduce((sum, digit) => sum + Number(digit), 0);
  return n;
};

test("the lightweight immutable numerals preserve all twenty-four authored catalogue values", () => {
  const expected = Array.from(STOICHEION_LETTERS, ({ id, symbol, name, value, pythmen }) => ({ id, symbol, name, value, pythmen }));
  assert.equal(STOICHEION_NUMERALS.length, 24);
  assert.deepEqual(JSON.parse(JSON.stringify(STOICHEION_NUMERALS)), expected);
  assert.ok(Object.isFrozen(STOICHEION_NUMERALS));
  assert.ok(STOICHEION_NUMERALS.every(Object.isFrozen));
});

test("auxiliary keys have independently checked Greek numerical values", () => {
  assert.deepEqual(Object.keys(AUXILIARY_WORDS), supportIds);
  for (const [index, id] of supportIds.entries()) {
    assert.equal(greekIsopsephy(AUXILIARY_WORDS[id]), supportValues[index], id);
  }
  assert.ok(Object.isFrozen(AUXILIARY_WORDS));
});

test("isopsephy normalizes case, polytonic accents and final sigma without Latin lookalikes", () => {
  for (const id of supportIds) {
    const word = AUXILIARY_WORDS[id];
    const expected = greekIsopsephy(word);
    assert.equal(greekIsopsephy(word.normalize("NFD")), expected);
    assert.equal(greekIsopsephy(word.toUpperCase()), expected);
    assert.equal(greekIsopsephy(word.toLowerCase()), expected);
    assert.equal(greekIsopsephy(`  ${word}  `), expected);
  }
  assert.equal(greekIsopsephy("Σσς"), 600);
  assert.equal(greekIsopsephy("αβγδεζηθικλμνξοπρστυφχψω"), 3999);
  assert.equal(greekIsopsephy("ϚϛϜϝ"), 24);
  assert.equal(greekIsopsephy("ϞϟϘϙ"), 360);
  assert.equal(greekIsopsephy("ϠϡͲͳ"), 3600);
  for (const word of ["", "  ", "\u0301", "Alpha", "Αlpha", "Альфа", "α β", "α-β", "α🙂", "Α1"]) {
    assert.throws(() => greekIsopsephy(word), /non-empty Greek word|Unsupported isopsephy character/, word);
  }
  for (const word of [null, undefined, 42, {}]) {
    assert.throws(() => greekIsopsephy(word), /requires a Greek word/);
  }
});

test("positive reduction retains nine and gives a complete immutable reduction trace", () => {
  for (const value of [9, 18, 99, 999, 999999]) assert.equal(restorationRoot(value), 9);
  assert.deepEqual([...restorationTrace(2701)], [2701, 10, 1]);
  assert.deepEqual([...restorationTrace(172)], [172, 10, 1]);
  assert.deepEqual([...restorationTrace(999)], [999, 27, 9]);
  assert.deepEqual([...restorationTrace(9)], [9]);
  assert.ok(Object.isFrozen(restorationTrace(2701)));
  assert.equal(restorationRoot(Number.MAX_SAFE_INTEGER), digitRoot(Number.MAX_SAFE_INTEGER));
  assert.equal(restorationTrace(Number.MAX_SAFE_INTEGER).at(-1), digitRoot(Number.MAX_SAFE_INTEGER));
  for (const value of [0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "9", null]) {
    assert.throws(() => restorationRoot(value), /positive safe integer/);
    assert.throws(() => restorationTrace(value), /positive safe integer/);
  }
});

test("all nine targets, all twenty-four cards and all thirty-two support subsets satisfy the equation", () => {
  assert.equal(STOICHEION_LETTERS.length, 24);
  for (let target = 1; target <= 9; target += 1) {
    for (const card of STOICHEION_LETTERS) {
      for (let mask = 0; mask < 32; mask += 1) {
        const selected = supportIds.filter((_, index) => (mask & (1 << index)) !== 0);
        const supportTotal = supportValues.reduce((sum, value, index) => sum + ((mask & (1 << index)) ? value : 0), 0);
        const result = buildRestorationEquation(card.value, target + 9 * 300, selected);
        assert.equal(result.target, target);
        assert.equal(result.supportTotal, supportTotal);
        assert.ok(result.requiredRoot >= 1 && result.requiredRoot <= 9);
        const matching = STOICHEION_LETTERS.filter((candidate) => digitRoot(card.value + candidate.value + supportTotal) === target);
        assert.ok(result.candidates.length > 0);
        assert.deepEqual(Array.from(result.candidates, (candidate) => candidate.id), Array.from(matching, (candidate) => candidate.id));
        for (const candidate of result.candidates) {
          assert.equal(digitRoot(card.value + candidate.value + supportTotal), target);
          assert.equal(candidate.pythmen, result.requiredRoot);
          assert.equal(candidate.pythmen, digitRoot(candidate.value));
        }
      }
    }
  }
});

test("the agreed Beta, Xi and Hearth example restores the original spread root", () => {
  const equation = buildRestorationEquation(2, 2701, ["hearth"]);
  const xi = equation.candidates.find((candidate) => candidate.id === "xi");
  assert.ok(xi);
  assert.equal(xi.symbol, "Ξ");
  assert.equal(xi.value, 60);
  assert.equal(equation.supportTotal, 110);
  assert.equal(equation.requiredRoot, 6);
  assert.equal(2 + xi.value + equation.supportTotal, 172);
  assert.equal(restorationRoot(172), equation.target);
  assert.equal(equation.supports[0].word, "Ἕδρα");
});

test("support selection is canonical and idempotent, with no input or catalogue mutation", () => {
  const original = ["hearth", "entrance", "hearth", "exit", "entrance"];
  const before = JSON.stringify(STOICHEION_LETTERS);
  const equation = buildRestorationEquation(2, 2701, Object.freeze(original));
  const canonical = buildRestorationEquation(2, 2701, ["entrance", "hearth", "exit"]);
  assert.equal(JSON.stringify(equation), JSON.stringify(canonical));
  assert.deepEqual(original, ["hearth", "entrance", "hearth", "exit", "entrance"]);
  assert.deepEqual(Array.from(equation.supports, (support) => support.id), ["entrance", "hearth", "exit"]);
  assert.equal(equation.supportTotal, 412 + 110 + 1014);
  for (const value of [equation, equation.supports, equation.candidates, ...equation.supports, ...equation.candidates]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.throws(() => { equation.target = 2; }, /read only/);
  assert.throws(() => { equation.supports.push({ id: "nadir" }); }, /not extensible/);
  assert.throws(() => { equation.candidates[0].value = 0; }, /read only/);
  assert.equal(JSON.stringify(STOICHEION_LETTERS), before);
});

test("equations fail closed for unknown supports, invalid numbers and precision overflow", () => {
  for (const value of [0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null]) {
    assert.throws(() => buildRestorationEquation(value, 2701, []), /positive safe integer/);
    assert.throws(() => buildRestorationEquation(2, value, []), /positive safe integer/);
  }
  for (const ids of [["unknown"], ["hearth", "unknown"], ["toString"], [null], [undefined], [1]]) {
    assert.throws(() => buildRestorationEquation(2, 2701, ids), /Unknown restoration auxiliary id/);
  }
  for (const ids of [undefined, null, "hearth", new Set(["hearth"])]) {
    assert.throws(() => buildRestorationEquation(2, 2701, ids), /must be an array/);
  }
  assert.throws(() => buildRestorationEquation(Number.MAX_SAFE_INTEGER, 2701, ["hearth"]), /safe integer precision/);
  assert.throws(() => buildRestorationEquation(Number.MAX_SAFE_INTEGER, 2701, []), /safe integer precision/);
});
