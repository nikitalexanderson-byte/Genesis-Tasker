import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The compact transport must reconstruct every source dictionary exactly, including long legal copy.
const assets = resolve('dist-web/public_html/assets');
const files = await readdir(assets);
for (const language of ['en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']) {
  const chunks = files.filter(name => name.startsWith(`locale-ui-${language}-`) && name.endsWith('.js'));
  assert.equal(chunks.length, 1, `Missing or ambiguous ${language} UI transport`);
  const expected = JSON.parse(await readFile(`app/ui-translations/${language}.json`, 'utf8'));
  const exports = await import(pathToFileURL(resolve(assets, chunks[0])).href);
  const actual = Object.values(exports).find(value => value && typeof value === 'object' && Object.hasOwn(value, Object.keys(expected)[0]));
  assert.deepEqual(actual, expected, `Built ${language} UI text changed in transport`);
}
console.log('All 13 built UI locale dictionaries match their source exactly.');
