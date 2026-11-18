import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";
import {FixtureLockManager} from './browser-locks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sources = new Map();
const origins=new WeakMap();

export class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Each instance is a separate tab: real cloud-sync code and WebCrypto, no live network or account.
export async function cloudSyncClient({ storage = new MemoryStorage(), sessionStorage = new MemoryStorage(), userId = "cache-qa-user", key, initializeWorkspace = true, authenticated = true, withDataExchange = false, withMindmaps = false, withPersonalRepositories = false, withPrivateMessages = false, withBackups = false, language = "ru", timers = { setTimeout, clearTimeout } } = {}) {
  key ??= Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64");
  const deviceKey = `genesis-workspace-device-key-v2:${userId}`, keyRecord = JSON.stringify({ key, recoveryCode: key });
  if (storage.getItem(deviceKey) !== keyRecord) storage.setItem(deviceKey, keyRecord);
  const pendingCrypto = new Map();
  const crypto = {
    getRandomValues: value => webcrypto.getRandomValues(value),
    randomUUID: () => webcrypto.randomUUID(),
    subtle: new Proxy(webcrypto.subtle, { get(target, property) {
      const original = target[property];
      if (typeof original !== "function") return original;
      return async (...args) => {
        const gate = pendingCrypto.get(property);
        if (gate) { pendingCrypto.delete(property); gate.entered.resolve(); await gate.release.promise; }
        return original.apply(target, args);
      };
    } }),
  };
  const window = new EventTarget();
  const origin=origins.get(storage)??{locks:new FixtureLockManager(),markers:new Map()};origins.set(storage,origin);
  const navigator = { onLine: true, locks:origin.locks };
  Object.assign(window, { localStorage: storage, sessionStorage, crypto, navigator,
    location: Object.assign(new URL("http://127.0.0.1:4193/"), { reload() {} }) });
  const requests = [];
  let fetchResponse = async () => { throw new TypeError("Synthetic offline"); };
  let authenticatingFixture=false;
  const context = createContext({
    window, navigator, localStorage: storage, sessionStorage, crypto,
    process: { env: { NEXT_PUBLIC_GENESIS_API_URL: "http://127.0.0.1:4193/api" } },
    fetch: async (url, init) => {
      if (!url.startsWith("http://127.0.0.1:4193/api/")) throw new Error("Non-fixture API request");
      requests.push({ url, init });
      return fetchResponse(url, init);
    },
    console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Event, EventTarget,
    CustomEvent: class extends Event { constructor(type, options = {}) { super(type, options); this.detail = options.detail; } },
    Error, TypeError, DOMException, AbortController, AbortSignal, URL, URLSearchParams,
    Response, Request, Headers, Blob, FormData, atob, btoa, structuredClone,
    setTimeout: (...args)=>(authenticatingFixture?setTimeout:timers.setTimeout)(...args),
    clearTimeout: handle=>(authenticatingFixture?clearTimeout:timers.clearTimeout)(handle),setInterval, clearInterval, queueMicrotask,
  });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const loaded = { exports: {} };
    modules.set(file, loaded);
    if (!sources.has(file)) sources.set(file, ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
    const evaluate = runInContext(`(function(require,module,exports){${sources.get(file)}\n})`, context, { filename: file });
    evaluate(id => {
      if (id === "./i18n") return { runtimeLocale: () => language === "ru" ? "ru-RU" : language, getRuntimeLanguage: () => language, translateText: value => value };
      if (id.endsWith("?raw")) return readFileSync(resolve(dirname(file), id.slice(0, -4)), "utf8");
      if (id.endsWith(".json")) return JSON.parse(readFileSync(resolve(dirname(file), id), "utf8"));
      return id.startsWith(".") ? load(resolve(dirname(file), /\.[cm]?[jt]sx?$/.test(id) ? id : `${id}.ts`)) : require(id);
    }, loaded, loaded.exports);
    if(file.replaceAll('\\','/').endsWith('/app/e2ee/legacy-transport-fence.ts')) {
      // Replace only the concrete persistent IO port, keeping the real scope
      // policy/LockManager consumer and transition validation. Do not pretend a
      // dummy global indexedDB is a browser: unrelated key stores keep their own
      // existing fixture behavior. Real IDB is checked in browser QA.
      loaded.exports.IndexedDbLegacyTransportMarkers=class {
        static available(){return true;}
        async get(owner){return structuredClone(origin.markers.get(owner)??null);}
        async any(){return origin.markers.size>0;}
        async commit(owner,expected,next){loaded.exports.validateLegacyTransportTransition(owner,origin.markers.get(owner)??null,expected,next);if(next)origin.markers.set(owner,structuredClone(next));else origin.markers.delete(owner);}
        async close(){}
      };
    }
    return loaded.exports;
  }
  const client = load(resolve(root, "app/cloud-sync.ts"));
  if (initializeWorkspace && !client.restoreOfflineWorkspaceSession(userId)) throw new Error("Synthetic workspace could not be restored");
  if(authenticated&&!storage.getItem('genesis-local-sign-out-v1')) {
    // This fixture has always represented an authenticated synthetic backend.
    // Establish that identity through the real metadata-only session reader;
    // a cached device key alone must never authorize private HTTP.
    const offline=fetchResponse;
    fetchResponse=async url=>{if(new URL(url).pathname!=='/api/session')throw new Error('Unexpected fixture authentication request');return new Response(JSON.stringify({user:{uid:userId},csrf:'fixture-csrf',loginId:`fixture-login:${userId}`}),{headers:{'Content-Type':'application/json'}});};
    authenticatingFixture=true;
    try{await client.loadGenesisSession();}finally{authenticatingFixture=false;fetchResponse=offline;requests.length=0;}
  }
  const cacheKey = `genesis-shared-offline-v1:${userId}`;
  const importedKey = await webcrypto.subtle.importKey("raw", Buffer.from(key, "base64"), "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    client, storage, sessionStorage, userId, key, requests, window, navigator, legacyMarkers:origin.markers,
    dataExchange: withDataExchange ? load(resolve(root, "app/shared-data-exchange.ts")) : undefined,
    mindmaps: withMindmaps ? load(resolve(root, "app/mindmaps-storage.ts")) : undefined,
    repositories: withPersonalRepositories ? {restoration:load(resolve(root, 'app/stoicheion-restoration-storage.ts')),aurora:load(resolve(root, 'app/aurora/repository.ts'))} : undefined,
    privateMessages: withPrivateMessages ? load(resolve(root, "app/private-messages-api.ts")) : undefined,
    featureAccess: load(resolve(root, "app/feature-access.ts")),
    backups: withBackups ? {device:load(resolve(root,'app/backup-device.ts')),sources:load(resolve(root,'app/backup-sources.ts')),format:load(resolve(root,'app/backup-format.ts')),tasks:load(resolve(root,'app/backup-task-restore.ts')),restore:load(resolve(root,'app/backup-restore.ts'))} : undefined,
    respond(handler) { fetchResponse = handler; },
    holdCrypto(method) {
      const gate = { entered: deferred(), release: deferred() };
      pendingCrypto.set(method, gate);
      return { entered: gate.entered.promise, release: () => gate.release.resolve(), fail: error => gate.release.reject(error) };
    },
    async seedStore(store) {
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(cacheKey) }, importedKey, new TextEncoder().encode(JSON.stringify(store)));
      storage.setItem(cacheKey, JSON.stringify({ iv: Buffer.from(iv).toString("base64"), ciphertext: Buffer.from(encrypted).toString("base64") }));
    },
    async readStore() {
      const saved = storage.getItem(cacheKey);
      if (!saved) return null;
      const envelope = JSON.parse(saved);
      const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(envelope.iv, "base64"), additionalData: new TextEncoder().encode(cacheKey) }, importedKey, Buffer.from(envelope.ciphertext, "base64"));
      return JSON.parse(new TextDecoder().decode(plain));
    },
  };
}
