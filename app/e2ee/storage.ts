import { E2EE_SUITE, openE2eeEnvelope, sealE2eeEnvelope, validateE2eeEnvelope,
  type E2eeContext, type E2eeEnvelope } from './envelope.ts';
import { assertTechnical } from './keys.ts';
import {commitE2eeIndexedDb} from './indexeddb-write.ts';
import {E2EE_PROVIDER_STORAGE_BUDGET} from './storage-capacity.ts';

export type SealedLocalRecord = { serial: number; envelope: E2eeEnvelope };
export type StorageChange = { key: string; expected: number | null; value: SealedLocalRecord | null };
export interface E2eeRecordStorage {
  get(key: string): Promise<SealedLocalRecord | null>;
  list(prefix: string): Promise<string[]>;
  /** All compares and writes form ONE durable transaction. Conflict never clears data. */
  commit(changes: StorageChange[], signal?: AbortSignal,assertCurrent?:()=>void): Promise<void>;
}
export function openE2eeDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=factory.open('genesis-e2ee-v1',2);
    request.onupgradeneeded=()=>{for(const name of ['records','keyMaterial'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
    request.onerror=()=>reject(new Error('E2EE_STORAGE_UNAVAILABLE'));request.onblocked=()=>reject(new Error('E2EE_STORAGE_BLOCKED'));
  });
}

/** No CryptoKey, raw key or plaintext value is persisted. No localStorage fallback. */
export class IndexedDbE2eeStorage implements E2eeRecordStorage {
  #database: Promise<IDBDatabase>;
  constructor(factory: IDBFactory = indexedDB) {
    this.#database = openE2eeDatabase(factory);
  }
  /** Provider-wide counts only; all accounts/scopes and protected key bundles
   * are included without opening their contents or granting read authority. */
  async providerCounts():Promise<Readonly<{records:number;keyRecords:number}>> {
    const db=await this.#database;
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(['records','keyMaterial'],'readonly');let records:number|undefined,keyRecords:number|undefined;
      const entries=transaction.objectStore('records').count(),keys=transaction.objectStore('keyMaterial').count();
      entries.onsuccess=()=>{records=entries.result;};keys.onsuccess=()=>{keyRecords=keys.result;};
      transaction.oncomplete=()=>{
        if(typeof records!=='number'||typeof keyRecords!=='number'||!Number.isSafeInteger(records)||!Number.isSafeInteger(keyRecords)||records<0||keyRecords<0){reject(new Error('E2EE_STORAGE_USAGE_UNAVAILABLE'));return;}
        resolve(Object.freeze({records,keyRecords}));
      };
      transaction.onerror=transaction.onabort=()=>reject(new Error('E2EE_STORAGE_USAGE_UNAVAILABLE'));
    });
  }
  async get(key: string) {
    const db = await this.#database;
    return new Promise<SealedLocalRecord|null>((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly'), request = transaction.objectStore('records').get(key);
      let value: SealedLocalRecord|null = null;
      request.onsuccess = () => { value = request.result ?? null; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = transaction.onabort = () => reject(new Error('E2EE_STORAGE_UNAVAILABLE'));
    });
  }
  async list(prefix: string) {
    const db = await this.#database;
    return new Promise<string[]>((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly'); const keys: string[] = [];
      let limit=false;
      const request = transaction.objectStore('records').openKeyCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      request.onsuccess = () => { const cursor = request.result; if (cursor) {
        if (typeof cursor.key !== 'string') { transaction.abort(); return; }
        if (keys.length===E2EE_PROVIDER_STORAGE_BUDGET.maximumRecords) { limit=true;transaction.abort();return; }
        keys.push(cursor.key);cursor.continue();
      } };
      transaction.oncomplete = () => resolve(keys);
      transaction.onerror = transaction.onabort = () => reject(new Error(limit?'E2EE_LOCAL_RECORD_LIMIT':'E2EE_STORAGE_UNAVAILABLE'));
    });
  }
  async commit(changes: StorageChange[], signal?: AbortSignal,assertCurrent?:()=>void) {
    return commitE2eeIndexedDb(this.#database,'records',changes,signal,assertCurrent);
  }
}

export type VaultScope = { ownerId: string; scopeId: string; deviceId: string; generation: number; cryptoEpoch: number;
  securityEpoch: number; keyId: string; signingKey: CryptoKey; roots: ReadonlyMap<string, CryptoKey>;
  trustedSigner: (deviceId: string) => CryptoKey | undefined };
export type LocalWrite = { domain: E2eeContext['domain']; objectId: string; value: Uint8Array; expected: number | null };
export type E2eeDeviceReadVault=Pick<UnlockedE2eeVault,'read'|'listLocal'|'localIdentity'|'assertUnlocked'|'listMigrationOriginalParts'|'listMigrationHistoryCopies'|'listMigrationStateRoles'|'listProductJobHistory'|'listProductControlHistory'|'listMigrationPlanOutputs'>;
export function localRecordKey(scope: Pick<VaultScope,'ownerId'|'scopeId'>, domain: E2eeContext['domain'], objectId: string) {
  assertTechnical(scope.ownerId); assertTechnical(scope.scopeId); assertTechnical(objectId);
  // Length encoding avoids collisions when IDs contain ':', '/' or other technical delimiters.
  return [scope.ownerId, scope.scopeId, domain, objectId].map(part => `${part.length}:${part}`).join('');
}

/** An unlocked, memory-only capability. Lock invalidates pending work before a durable commit. */
export class UnlockedE2eeVault {
  #scope: VaultScope | null;
  #lifecycle = 0;
  #abort = new AbortController();
  readonly storage: E2eeRecordStorage;
  constructor(storage: E2eeRecordStorage, scope: VaultScope) { this.storage = storage; this.#scope = scope; }
  lock() { this.#lifecycle++; this.#scope = null; this.#abort.abort(); }
  assertUnlocked() { this.#open(); }
  /** Technical identity only; no roots, key material or signing capability. */
  localIdentity() {
    const scope=this.#open();
    return Object.freeze({ownerId:scope.ownerId,scopeId:scope.scopeId,deviceId:scope.deviceId});
  }
  /** Bounded technical-key discovery, with no plaintext/authority fallback. */
  async listLocal(domain:E2eeContext['domain'],objectPrefix:string) {
    assertTechnical(objectPrefix);return this.#localIds(domain,id=>id.startsWith(objectPrefix));
  }
  /** Dedicated original-migration locator role. No empty-prefix general read
   * capability is added to listLocal or the original-stage/legacy handles. */
  async listMigrationOriginalParts(){return this.#localIds('local-snapshot',id=>id.includes(':source:')||id.endsWith(':source'));}
  /** Reserved original archive/cancel roles, including malformed remnants. */
  async listMigrationHistoryCopies(){return this.#localIds('local-snapshot',id=>id.endsWith(':archive')||id.includes(':archive:')||id.endsWith(':cancel')||id.includes(':cancel:'));}
  /** Discover all preparation/adoption roles, including malformed remnants.
   * Their names alone never authenticate an owner or make them disposable. */
  async listMigrationStateRoles(){return this.#localIds('local-snapshot',id=>id.includes(':preparation')||id.includes(':adoption'));}
  async listProductJobHistory(){return this.#localIds('local-snapshot',id=>id.includes(':rebase:')||id.includes(':completed:'));}
  async listProductControlHistory(){return this.#localIds('local-snapshot',id=>id.includes(':attempt:'));}
  /** Coordinator role inventory only; orphan plan outputs cannot disappear
   * merely because their journal was lost. This opens no corresponding body. */
  async listMigrationPlanOutputs(){
    return Object.freeze({remote:await this.#localIds('outbox',()=>true),local:await this.#localIds('local-snapshot',id=>id.includes(':private:')||id.endsWith(':private'))});
  }
  async #localIds(domain:E2eeContext['domain'],include:(id:string)=>boolean){
    const scope=this.#open(),lifecycle=this.#lifecycle;
    const prefix=[scope.ownerId,scope.scopeId,domain].map(part=>`${part.length}:${part}`).join('');
    const keys=await this.storage.list(prefix);if(lifecycle!==this.#lifecycle)throw new Error('E2EE_UNLOCK_REQUIRED');
    if(keys.length>E2EE_PROVIDER_STORAGE_BUDGET.maximumRecords||new Set(keys).size!==keys.length)throw new Error('E2EE_LOCAL_RECORD_LIMIT');const ids:string[]=[];
    for(const key of keys){
      if(typeof key!=='string'||!key.startsWith(prefix))throw new Error('E2EE_CORRUPT_LOCAL_RECORD');
      const rest=key.slice(prefix.length),colon=rest.indexOf(':');if(colon<1||!/^[1-9][0-9]{0,2}$/.test(rest.slice(0,colon)))throw new Error('E2EE_CORRUPT_LOCAL_RECORD');
      const id=rest.slice(colon+1);assertTechnical(id);if(Number(rest.slice(0,colon))!==id.length)throw new Error('E2EE_CORRUPT_LOCAL_RECORD');
      if(include(id))ids.push(id);
    }
    return ids;
  }
  #open() { if (!this.#scope) throw new Error('E2EE_UNLOCK_REQUIRED'); return this.#scope; }
  async read(domain: E2eeContext['domain'], objectId: string): Promise<{ serial: number; value: Uint8Array<ArrayBuffer> } | null> {
    const scope = this.#open(), lifecycle = this.#lifecycle;
    const record = await this.storage.get(localRecordKey(scope, domain, objectId));
    if (lifecycle !== this.#lifecycle) throw new Error('E2EE_UNLOCK_REQUIRED');
    if (record === null) return null;
    const envelope = validateE2eeEnvelope(record.envelope), context = envelope.context;
    if (!Number.isSafeInteger(record.serial) || record.serial < 1 || context.revision !== record.serial
      || context.ownerId !== scope.ownerId || context.scopeId !== scope.scopeId || context.domain !== domain || context.objectId !== objectId
      || context.dataGeneration !== scope.generation || context.cryptoEpoch > scope.cryptoEpoch || context.securityEpoch > scope.securityEpoch)
      throw new Error('E2EE_CORRUPT_LOCAL_RECORD');
    const root = scope.roots.get(context.keyId), signer = scope.trustedSigner(context.deviceId);
    if (!root || !signer) throw new Error('E2EE_KEY_UNAVAILABLE');
    const value = await openE2eeEnvelope(root, signer, { ...context, ownerId: scope.ownerId, scopeId: scope.scopeId, domain, objectId }, envelope);
    if (lifecycle !== this.#lifecycle) { value.fill(0); throw new Error('E2EE_UNLOCK_REQUIRED'); }
    return { serial: record.serial, value };
  }
  async write(changes: LocalWrite[],assertCurrent:()=>void=()=>{}): Promise<void> {
    assertCurrent();
    const scope = this.#open(), lifecycle = this.#lifecycle, root = scope.roots.get(scope.keyId);
    const current=()=>{assertCurrent();this.#open();if(lifecycle!==this.#lifecycle)throw new Error('E2EE_UNLOCK_REQUIRED');};
    if (!root) throw new Error('E2EE_KEY_UNAVAILABLE');
    if (changes.some(change => change.expected !== null && (!Number.isSafeInteger(change.expected) || change.expected < 1))) throw new Error('E2EE_INVALID_LOCAL_BATCH');
    // Copy input bytes before the first await so caller mutations cannot change an acknowledged save.
    const captured = changes.map(change => ({ ...change, value: new Uint8Array(change.value) }));
    try {
      const writes = await Promise.all(captured.map(async change => {
        const serial = (change.expected ?? 0) + 1;
        const context: E2eeContext = { cryptoProtocol: 1, suite: E2EE_SUITE, ownerId: scope.ownerId, scopeId: scope.scopeId, domain: change.domain,
          objectId: change.objectId, schemaVersion: 1, dataGeneration: scope.generation, writerProtocol: 9, cryptoEpoch: scope.cryptoEpoch,
          securityEpoch: scope.securityEpoch, revision: serial, keyId: scope.keyId, deviceId: scope.deviceId, operationId: crypto.randomUUID() };
        return { key: localRecordKey(scope, change.domain, change.objectId), expected: change.expected,
          value: { serial, envelope: await sealE2eeEnvelope(root, scope.signingKey, context, change.value) } };
      }));
      current();await this.storage.commit(writes,this.#abort.signal,current);current();
    } finally { captured.forEach(change => change.value.fill(0)); }
  }
}
