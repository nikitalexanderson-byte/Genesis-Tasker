import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { redacted, sanitizeTraceArchive, sanitizeTraceFile } from './trace-sanitize.mjs';

function fixture() {
  const canaries = Array.from({ length: 26 }, () => `qa-canary-${randomBytes(24).toString('hex')}`);
  const [cookie, bearer, csrfHeader, query, form, responseCookie, access, refresh, secret, password, crypto, jwk, encoded, selector, dom, source, text, privateKey, bodyBuffer, uri, headerMap, nested, params, inline, apiKey, rawCryptoKey] = canaries;
  const json = value => strToU8(JSON.stringify(value));
  const lines = values => strToU8(values.map(value => JSON.stringify(value)).join('\n') + '\n');
  const body = { title: 'Обычная задача', accessToken: access, refresh_token: refresh, nested: { secret, password, cryptoKey: crypto, key: { kty: 'oct', k: jwk } }, crypto: { key: rawCryptoKey }, encoded: JSON.stringify({ csrf: nested }) };
  const response = { status: 200, headers: [{ name: 'Set-Cookie', value: `sid=${responseCookie}; Path=/; HttpOnly` }], cookies: [{ name: 'sid', value: responseCookie, path: '/' }], content: { mimeType: 'application/json', _sha1: 'body.json' } };
  const entries = {
    'trace.trace': lines([
      { type: 'context-options', version: 8, browserName: 'chromium' },
      { type: 'before', callId: 'call@1', method: 'fill', params: { selector: 'input[type="password"]', value: selector } },
      { type: 'before', callId: 'call@2', method: 'fetch', params: { headers: { Authorization: `Bearer ${headerMap}`, 'X-API-Key': apiKey }, postDataBuffer: Buffer.from(JSON.stringify({ secret: bodyBuffer })).toString('base64') } },
      { type: 'frame-snapshot', snapshot: { html: ['HTML', {}, ['BODY', {}, ['INPUT', { type: 'password', value: dom }], ['DIV', {}, access, cookie, bearer], ['BUTTON', {}, 'Создать задачу']]], url: 'https://example.invalid/' } },
      { type: 'console', text: `response echoed ${refresh} and ${csrfHeader}` },
      { type: 'after', callId: 'call@1' },
    ]),
    'trace.network': lines([
      { type: 'resource-snapshot', snapshot: { request: { url: `https://example.invalid/api?access_token=${query}&title=task`, headers: [{ name: 'Cookie', value: `sid=${cookie}; language=ru` }, { name: 'Authorization', value: `Bearer ${bearer}` }, { name: 'X-CSRF-Token', value: csrfHeader }], cookies: [{ name: 'sid', value: cookie }], queryString: [{ name: 'access_token', value: query }, { name: 'title', value: 'task' }], postData: { mimeType: 'application/x-www-form-urlencoded', text: `password=${form}&title=task`, params: [{ name: 'api_key', value: params }] } }, response } },
      { type: 'resource-snapshot', snapshot: { request: { url: `https://example.invalid/?refresh_token=${encodeURIComponent(uri + '/+?=')}` }, response: { content: { mimeType: 'application/json', encoding: 'base64', text: Buffer.from(JSON.stringify({ csrf: encoded, title: 'Encoded title' })).toString('base64') } } } },
      { type: 'resource-snapshot', snapshot: { request: { url: 'https://example.invalid/inline', postData: { mimeType: 'application/json', text: JSON.stringify({ password: inline, title: 'Inline title' }) } } } },
    ]),
    'trace.stacks': json({ files: ['synthetic.mjs'], stacks: [[1, [[0, 10, 1]]]] }),
    'resources/body.json': json(body),
    'resources/src@synthetic.txt': strToU8(`const config = {secret: "${source}"};\nconst title = 'Source title';\nconst echo = '${cookie}';`),
    'resources/notes.txt': strToU8(`csrf='${text}'\n-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`),
    'resources/image.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 254]),
    'resources/asset.svg': strToU8('<svg><text>GENESIS</text></svg>'),
  };
  return { canaries, entries, bytes: zipSync(entries) };
}

test('sanitized trace removes canaries across headers, cookies, URLs, JSON, encoded bodies, sources and DOM without losing UI records', () => {
  const input = fixture();
  const { bytes, report } = sanitizeTraceArchive(input.bytes);
  const output = unzipSync(bytes);
  assert(Object.keys(output).length === Object.keys(input.entries).length, 'Entry count changed');
  for (const [name, data] of Object.entries(output)) for (const [index, secret] of input.canaries.entries()) {
    for (const variant of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]) assert(!Buffer.from(data).includes(Buffer.from(variant)), `Canary ${index} remained in ${name}`);
  }
  const trace = strFromU8(output['trace.trace']).trim().split('\n').map(line => JSON.parse(line));
  const network = strFromU8(output['trace.network']).trim().split('\n').map(line => JSON.parse(line));
  assert(trace.length === 6 && network.length === 3, 'Trace record counts changed');
  assert(trace[1].params.value === redacted, 'Password input was not masked');
  assert(trace[3].snapshot.html[2][2][1].value === redacted, 'DOM password value was not masked');
  assert(JSON.stringify(trace).includes('Создать задачу'), 'UI labels were lost');
  assert(network[0].snapshot.request.queryString[1].value === 'task', 'Nonsecret query changed');
  assert(network[0].snapshot.request.headers.every(header => header.value === redacted), 'A request header was not masked');
  assert(network[0].snapshot.response.cookies[0].value === redacted, 'Response cookie was not masked');
  const body = JSON.parse(strFromU8(output['resources/body.json']));
  assert(body.title === 'Обычная задача' && body.accessToken === redacted && body.nested.key.k === redacted, 'Resource JSON was not preserved/masked');
  const encoded = JSON.parse(Buffer.from(network[1].snapshot.response.content.text, 'base64'));
  assert(encoded.csrf === redacted && encoded.title === 'Encoded title', 'Encoded response body was not masked');
  const buffer = JSON.parse(Buffer.from(trace[2].params.postDataBuffer, 'base64'));
  assert(buffer.secret === redacted, 'Encoded request buffer was not masked');
  assert(Buffer.from(output['resources/image.png']).equals(Buffer.from(input.entries['resources/image.png'])), 'Image bytes changed');
  assert(strFromU8(output['resources/asset.svg']) === '<svg><text>GENESIS</text></svg>', 'SVG changed');
  assert(report.status === 'PASS' && report.redactions > 20 && report.propagatedRedactions > 3 && report.sourceSha256 !== report.sanitizedSha256, 'Sanitization report is incomplete');
  assert(!JSON.stringify(report).includes('qa-canary-'), 'Report exposed a canary');
});

test('malformed records, missing resource bodies and opaque secret echoes fail without returning unsafe output', () => {
  const { entries } = fixture();
  const bad = { ...entries, 'trace.network': strToU8('{bad JSON') };
  assert.throws(() => sanitizeTraceArchive(zipSync(bad)), /malformed structured content/);
  const missing = { ...entries }; delete missing['resources/body.json'];
  assert.throws(() => sanitizeTraceArchive(zipSync(missing)), /missing referenced resource/);
  const { entries: leaking, canaries } = fixture();
  leaking['resources/unknown.bin'] = Buffer.concat([Buffer.from([0, 255]), Buffer.from(canaries[0])]);
  assert.throws(() => sanitizeTraceArchive(zipSync(leaking)), /residual sensitive value/);
  assert.throws(() => sanitizeTraceArchive(new Uint8Array([1, 2, 3])), /invalid ZIP/);
});

test('file sanitizer preserves the source and old evidence and writes nothing on sanitation failure', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'genesis-trace-selftest-'));
  const input = path.join(directory, 'input.zip'), output = path.join(directory, 'trace.sanitized.zip'), invalid = path.join(directory, 'invalid.zip');
  try {
    const data = fixture().bytes;
    writeFileSync(input, data);
    const report = sanitizeTraceFile(input, output);
    assert(report.status === 'PASS' && existsSync(output), 'Sanitized file missing');
    assert(Buffer.from(data).equals(readFileSync(input)), 'Original archive changed');
    const existing = readFileSync(output);
    assert.throws(() => sanitizeTraceFile(input, output), { code: 'EEXIST' });
    assert(existing.equals(readFileSync(output)), 'Existing evidence overwritten');
    writeFileSync(invalid, new Uint8Array([1, 2, 3]));
    rmSync(output);
    assert.throws(() => sanitizeTraceFile(invalid, output), /invalid ZIP/);
    assert(!existsSync(output), 'Failed sanitizer published an artifact');
  } finally {
    for (const file of [input, output, invalid]) rmSync(file, { force: true });
    rmdirSync(directory);
  }
});

test('public CI never uploads runtime data, traces or application packages', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/checks.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /upload-artifact|upload-pages-artifact|gh release|npm publish|scp |ssh /);
  assert.match(workflow, /contents: read/);
});
