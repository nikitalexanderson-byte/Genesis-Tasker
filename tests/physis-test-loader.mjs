import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');

/** Real TS/domain/crypto code; only the injected transport replaces the browser session. */
export function physisModules(cryptoOverride = webcrypto) {
  const cache = new Map();
  const forbiddenStorage = new Proxy({}, { get() { throw new Error('Physis attempted persistent browser storage'); } });
  function load(path) {
    if (!extname(path)) path += '.ts';
    if (path === resolve(root, 'app/cloud-sync.ts')) return {
      captureAccountSessionGuard: () => { throw new Error('Test must explicitly inject its synthetic session'); },
      physisRequest: () => { throw new Error('Test must explicitly inject its transport'); },
    };
    if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
    if (cache.has(path)) return cache.get(path).exports;
    const loaded = { exports: {} }; cache.set(path, loaded);
    const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(source, {
      module: loaded, exports: loaded.exports, process: { env: {} }, Date, Math, Map, Set, Intl, URL,
      Error, TypeError, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, structuredClone,
      crypto: cryptoOverride, btoa: globalThis.btoa, atob: globalThis.atob,
      localStorage: forbiddenStorage, sessionStorage: forbiddenStorage, indexedDB: forbiddenStorage,
      require: id => id.startsWith('.') && existsSync(resolve(dirname(path), id) + (extname(id) ? '' : '.ts'))
        ? load(resolve(dirname(path), id)) : require(id),
    }, { filename: path });
    return loaded.exports;
  }
  return { crypto: load(resolve(root, 'app/physis/crypto.ts')), account: () => load(resolve(root, 'app/physis/account-session.ts')), store: () => load(resolve(root, 'app/physis/store.ts')) };
}

export function settingsRecord(overrides = {}) {
  const now = '2026-10-24T12:00:00.000Z';
  return { id: webcrypto.randomUUID(), kind: 'settings', schemaVersion: 1, createdAt: now, updatedAt: now, source: 'manual',
    data: { calendarMode: 'sacred', inputCalendarMode: 'profane', timeZone: 'Europe/Moscow', weightUnit: 'kg', distanceUnit: 'km',
      energyUnit: 'kcal', glucoseUnit: 'mmol/L', restSeconds: 90, reminders: false, foodRules: [], enabledMetrics: [], overviewBlocks: [] }, ...overrides };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export const clone = value => JSON.parse(JSON.stringify(value));
