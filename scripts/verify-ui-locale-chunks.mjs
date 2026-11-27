import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The compact transport must reconstruct every source dictionary exactly, including long legal copy.
const assets = resolve('dist-web/public_html/assets');
const files = await readdir(assets);
async function verifyDictionary(chunkName, source) {
  const chunks = files.filter(name => name.startsWith(`${chunkName}-`) && name.endsWith('.js'));
  assert.equal(chunks.length, 1, `Missing or ambiguous transport for ${source}`);
  const expected = JSON.parse(await readFile(source, 'utf8'));
  const exports = await import(pathToFileURL(resolve(assets, chunks[0])).href);
  const actual = Object.values(exports).find(value => value && typeof value === 'object' && Object.hasOwn(value, Object.keys(expected)[0]));
  assert.deepEqual(actual, expected, `Built dictionary differs from ${source}`);
}

for (const language of ['en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja','he','ar','ko','nl']) {
  await verifyDictionary(`locale-ui-${language}`, `app/ui-translations/${language}.json`);
}
for (const language of ['he','ar','ko','nl']) {
  await verifyDictionary(`locale-${language}`, `app/translations.${language}.json`);
}
console.log('All compacted locale dictionaries match their source exactly.');
