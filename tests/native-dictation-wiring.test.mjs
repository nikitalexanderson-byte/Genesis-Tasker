import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = name => readFile(new URL(`../android/app/src/main/java/ru/genesis/calendar/ui/${name}.kt`, import.meta.url), 'utf8');

// Source contracts only. Production Kotlin and fake-recognizer device tests need a separately authorized native build.
test('native recognition requests fast system formatting and separates live hypotheses from provider finals', async () => {
  const speech = await source('VoiceSpeechInput');
  assert.match(speech, /Build\.VERSION\.SDK_INT >= 33[\s\S]*?EXTRA_ENABLE_FORMATTING, RecognizerIntent\.FORMATTING_OPTIMIZE_LATENCY/);
  assert.match(speech, /EXTRA_PARTIAL_RESULTS, true/);
  assert.match(speech, /recognizer\.listener\(listenerFor\(currentGeneration\)\)/);
  assert.match(speech, /if \(recognized\.isNotBlank\(\)\) finalTranscript\?\.invoke\(recognized\)/);
  const partialCommit = speech.split('fun commitPartial() {')[1].split('fun fail(')[0];
  assert.doesNotMatch(partialCommit, /finalTranscript/);
  assert.match(speech, /if \(!utteranceOpen\) finish\(\)/);
  assert.doesNotMatch(speech, /5_000/);
});

test('native external spelling is narrowly bounded to the public free service without GENESIS credentials', async () => {
  const speller = await source('NativeDictationSpeller');
  assert.match(speller, /setOf\("ru", "en", "uk"\)/);
  assert.match(speller, /text\.length <= 4_000/);
  assert.match(speller, /withTimeout\(2_500\)/);
  assert.match(speller, /https:\/\/speller\.yandex\.net\/services\/spellservice\.json\/checkText/);
  assert.match(speller, /instanceFollowRedirects = false/);
  assert.match(speller, /options=6&format=plain/);
  assert.match(speller, /continuation\.invokeOnCancellation/);
  assert.doesNotMatch(speller, /AuthController|AuthSessionClient|LocalCipher|android\.util\.Log|java\.io\.File/);
  assert.doesNotMatch(speller, /setRequestProperty\("(?:Cookie|Authorization|X-CSRF-Token)"/i);
  assert.match(speller, /candidates\.size != 1/);
  assert.match(speller, /plausibleDictationSuggestion/);
});

test('the editor opts out by default and protects original or manually edited text from late replies', async () => {
  const editor = await source('DreamJournal');
  assert.match(editor, /spellingEnabled by remember\(repository,key,language\)\{mutableStateOf\(false\)\}/);
  assert.match(editor, /onPartialTranscript =/);
  assert.match(editor, /onFinalTranscript = \{ heard -> checkFinalPhrase\(heard,generation\)/);
  assert.match(editor, /candidate==null\|\|candidate\.first!=heard\.trim/);
  assert.match(editor, /app\.workspaceScope==editorAccountScope/);
  assert.match(editor, /currentEditorKey==key/);
  assert.match(editor, /spellingPatches\.clear\(\);update\("body"/);
  assert.match(editor, /readOnly=recording/);
  assert.match(editor, /dictationCopy\.getString\("privacy"\)/);
  assert.match(editor, /Uri\.parse\(dictationSpellerCreditUrl\)/);
});

test('native attribution and disclosure are bundled in every existing language', async () => {
  const [gradle, raw] = await Promise.all([
    readFile(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8'),
    readFile(new URL('../app/dictation-copy.json', import.meta.url), 'utf8'),
  ]);
  assert.match(gradle, /app\/dictation-copy\.json/);
  const copy = JSON.parse(raw);
  assert.equal(Object.keys(copy).length, 14);
  for (const locale of Object.values(copy)) for (const key of ['spellcheck', 'privacy', 'credit', 'unavailable']) {
    assert.equal(typeof locale[key], 'string');
    assert.ok(locale[key].trim());
  }
});
