import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {correctDictationSpelling, supportedSpellingLanguage} from "../app/dictation-spelling.ts";

const reply = value => new Response(JSON.stringify(value), {headers: {"Content-Type": "application/json; charset=utf-8"}});
const typo = (text, word, suggestions, code = 1) => ({code, pos: text.indexOf(word), len: word.length, word, s: suggestions});
const failure = text => ({text, available: false});

test("only RU/EN/UK locales, nonempty phrases and the input limit can reach the external service", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => reply([]));
  for (const language of ["ru", "en", "uk", "ru-RU", "en_US", "UK-ua"]) assert.equal(supportedSpellingLanguage(language), true);
  for (const language of ["de", "el", "ja", "fr", "ru-script", "en,ru", "", "rus"]) {
    assert.equal(supportedSpellingLanguage(language), false);
    assert.deepEqual(await correctDictationSpelling("Synthetic phrase", language), failure("Synthetic phrase"));
  }
  assert.deepEqual(await correctDictationSpelling(" ", "ru"), {text: " ", available: true});
  assert.deepEqual(await correctDictationSpelling("a".repeat(4_001), "en"), failure("a".repeat(4_001)));
  assert.equal(fetch.mock.callCount(), 0);
  const boundary = "a".repeat(4_000);
  assert.deepEqual(await correctDictationSpelling(boundary, "en"), {text: boundary, available: true});
  assert.equal(fetch.mock.callCount(), 1);
});

test("the single free HTTPS endpoint receives only the phrase, without account cookies or referrer", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => reply([]));
  await correctDictationSpelling("Synthetic phrase", "uk-UA");
  const [url, request] = fetch.mock.calls[0].arguments;
  assert.equal(url, "https://speller.yandex.net/services/spellservice.json/checkText");
  assert.equal(request.method, "POST");
  assert.equal(request.mode, "cors");
  assert.equal(request.credentials, "omit");
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.equal(request.cache, "no-store");
  assert.equal(request.redirect, "error");
  assert.ok(request.signal instanceof AbortSignal);
  assert.match(request.headers["Content-Type"], /^application\/x-www-form-urlencoded/);
  assert.deepEqual(Object.fromEntries(request.body), {text: "Synthetic phrase", lang: "uk", options: "6", format: "plain"});
});

test("safe fixes preserve emoji, punctuation, line breaks and every character outside source words", async t => {
  const source = "  🌙 карова,\nпрвиет  мир! ";
  t.mock.method(globalThis, "fetch", async () => reply([
    typo(source, "првиет", ["привет"]), typo(source, "карова", ["корова"]),
  ]));
  assert.deepEqual(await correctDictationSpelling(source, "ru"), {text: "  🌙 корова,\nпривет  мир! ", available: true});
});

test("changed-length words use original offsets and preserve English and Ukrainian text", async t => {
  let source = "helo, wrld!";
  t.mock.method(globalThis, "fetch", async () => reply(source === "helo, wrld!"
    ? [typo(source, "helo", ["hello"]), typo(source, "wrld", ["world"])]
    : [typo(source, "привт", ["привіт"])]));
  assert.deepEqual(await correctDictationSpelling(source, "en"), {text: "hello, world!", available: true});
  source = "Синтетична фраза: привт!";
  assert.deepEqual(await correctDictationSpelling(source, "uk"), {text: "Синтетична фраза: привіт!", available: true});
});

test("only one plausible single-word suggestion is used; ambiguity and rewrites remain unchanged", async t => {
  let source = "helo";
  let suggestions = ["hello", "help"];
  t.mock.method(globalThis, "fetch", async () => reply([typo(source, source, suggestions)]));
  assert.deepEqual(await correctDictationSpelling(source, "en"), {text: source, available: true});
  suggestions = ["hello", "<b>hello</b>", "hello world", "destroy"];
  assert.deepEqual(await correctDictationSpelling(source, "en"), {text: "hello", available: true});
  for (const [word, candidates] of [
    ["calendar", ["destroy"]], ["helo", ["hello!", "hello world", "hell0"]],
    ["say helo", ["write something else"]], ["copa", ["сора"]],
  ]) {
    source = word; suggestions = candidates;
    assert.deepEqual(await correctDictationSpelling(source, "en"), {text: source, available: true});
  }
});

test("repeat-word recommendations cannot delete words or change a phrase", async t => {
  const source = "the the river";
  t.mock.method(globalThis, "fetch", async () => reply([typo(source, "the the", ["the"], 2)]));
  assert.deepEqual(await correctDictationSpelling(source, "en"), {text: source, available: true});
});

test("malformed positions, source words, lengths, overlaps and unknown payloads reject the entire reply", async t => {
  const source = "helo, wrld!";
  const valid = typo(source, "helo", ["hello"]);
  let payload = [];
  t.mock.method(globalThis, "fetch", async () => reply(payload));
  for (const invalid of [
    {pos: 1}, {pos: -1}, {pos: 0.5}, {pos: 40}, {word: "other"}, {len: 3}, {len: 0},
    {s: [5]}, {s: "hello"}, {code: 4}, {code: 900},
  ]) {
    payload = [valid, {...typo(source, "wrld", ["world"]), ...invalid}];
    assert.deepEqual(await correctDictationSpelling(source, "en"), failure(source));
  }
  for (const value of [null, {}, {text: "replacement"}, [valid, valid], [null], new Array(513).fill(valid)]) {
    payload = value;
    assert.deepEqual(await correctDictationSpelling(source, "en"), failure(source));
  }
  payload = [{code: 1, pos: 0, len: 3, word: "hel", s: ["hey"]}];
  assert.deepEqual(await correctDictationSpelling(source, "en"), failure(source), "partial words are not replaceable positions");
});

test("network errors, HTTP failures, malformed JSON and oversized replies preserve the recognized phrase", async t => {
  const source = "Synthetic phrase";
  let response;
  t.mock.method(globalThis, "fetch", async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  for (const value of [new Error("Synthetic offline"), new Response("[]", {status: 503}),
    new Response("not json"), new Response("[]", {headers: {"content-length": "1000000"}}),
    new Response(" ".repeat(65_537)), new Response(new Uint8Array([0xff]))]) {
    response = value;
    assert.deepEqual(await correctDictationSpelling(source, "en"), failure(source));
  }
});

test("a previously aborted lifecycle never sends a dictated phrase", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => reply([]));
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await correctDictationSpelling("Synthetic phrase", "en", controller.signal), failure("Synthetic phrase"));
  assert.equal(fetch.mock.callCount(), 0);
});

test("lifecycle cancellation preserves the original even if fetch ignores abort and resolves later", async t => {
  let resolveResponse, requestSignal;
  t.mock.method(globalThis, "fetch", async (_, request) => {
    requestSignal = request.signal;
    return new Promise(resolve => { resolveResponse = resolve; });
  });
  const controller = new AbortController();
  const result = correctDictationSpelling("helo", "en", controller.signal);
  controller.abort();
  assert.deepEqual(await result, failure("helo"));
  assert.equal(requestSignal.aborted, true);
  resolveResponse(reply([typo("helo", "helo", ["hello"])]));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await result, failure("helo"));
});

test("a stalled provider is bounded to at most 2500ms even if it ignores the request signal", async t => {
  t.mock.timers.enable({apis: ["setTimeout"]});
  let requestSignal;
  t.mock.method(globalThis, "fetch", async (_, request) => {
    requestSignal = request.signal;
    return new Promise(() => {});
  });
  const result = correctDictationSpelling("Synthetic phrase", "en");
  t.mock.timers.tick(2_500);
  assert.deepEqual(await result, failure("Synthetic phrase"));
  assert.equal(requestSignal.aborted, true);
});

test("aborting during response streaming cancels its reader and preserves the original phrase", async t => {
  let streamCancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("[")); },
    cancel() { streamCancelled = true; },
  }));
  t.mock.method(globalThis, "fetch", async () => response);
  const controller = new AbortController();
  const result = correctDictationSpelling("Synthetic phrase", "en", controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await result, failure("Synthetic phrase"));
  assert.equal(streamCancelled, true);
});

test("all fourteen locales disclose the optional phrase-only service, free limits and fallback", () => {
  const copy = JSON.parse(readFileSync(new URL("../app/dictation-copy.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(copy).sort(), ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"].sort());
  for (const [locale, messages] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(messages).sort(), ["spellcheck", "privacy", "credit", "unavailable", "legalTitle", "legalBody"].sort(), locale);
    for (const value of Object.values(messages)) assert.ok(typeof value === "string" && value.trim().length > 0, locale);
    assert.match(messages.privacy, /(?:Yandex\.Speller|Яндекс\.Спеллер)/, locale);
    assert.match(messages.credit, /(?:Yandex\.Speller|Яндекс\.Спеллер)/, locale);
  }
  assert.match(copy.ru.privacy, /только продиктованные фразы/);
  assert.match(copy.ru.privacy, /Бесплатно в пределах лимитов/);
  assert.match(copy.ru.privacy, /Можно выключить/);
});
