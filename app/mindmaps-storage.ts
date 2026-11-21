import { GenesisApiError, personalDocumentAccess, sharedMindmapDocumentAccess,usesPrivateProductStorage, type GenesisTask } from "./cloud-sync";
import {E2eeMindmapRepository} from './e2ee/mindmaps-product';
import {E2eeSharedMindmapRepository} from './e2ee/shared-mindmaps-product';
import { mapId, validateMindmap, type Mindmap, type MapView } from "./mindmaps-model";
import { currentFeatureAccess, requireQuotaGrowth } from './feature-access';

type Sealed = { iv: string; ciphertext: string };
type Envelope = Sealed & { id: string; schemaVersion: number; revision: number; updatedAt: string };
export type MapRecord = { document: Mindmap; revision: number; updatedAt: string; pending?: boolean; draftKey?: string };
type PendingMap = { schemaVersion: 1 | 2; expectedRevision: number; operationId: string } & Sealed;
type Access = ReturnType<typeof sharedMindmapDocumentAccess>;
export type Conversion = { mapId: string; nodeId: string; taskId: string; task?: GenesisTask; applied?: boolean };
export type SaveState = "saving" | "device" | "pending" | "synced" | "conflict" | "error";
export const MINDMAPS_ENABLED = process.env.NEXT_PUBLIC_GENESIS_MINDMAPS === "true";

/** Each tab has its own encrypted draft; a tab can never overwrite another tab's unsent text. */
export class MindmapRepository {
  private product:E2eeMindmapRepository|E2eeSharedMindmapRepository|null;
  private access: Access;
  private prefix: string;
  private tab: string;
  private envelopeVersion: 1 | 2;
  private serial = Promise.resolve();
  private viewSerial = Promise.resolve();
  private revisions = new Map<string, number>();
  private pending = new Map<string, PendingMap>();
  private staged = new Map<string, number>();
  private stopped = false;
  private storage:Storage;
  private migrationEditors=new Map<string,()=>{document:Mindmap|null;revision:number;state?:unknown}>();
  private journalListeners = new Set<() => void>();
  subscribeJournal(listener: () => void) { if(this.product)return this.product.subscribeJournal(listener);this.journalListeners.add(listener); return () => { this.journalListeners.delete(listener); }; }
  constructor(private userId: string, private spaceId?: string,ports?:{storage?:Storage;access?:Access}) {
    this.product=usesPrivateProductStorage(userId)?spaceId?new E2eeSharedMindmapRepository(userId,spaceId):new E2eeMindmapRepository(userId):null;
    this.envelopeVersion = spaceId ? 1 : 2;
    this.storage=ports?.storage??globalThis.localStorage;
    this.access = ports?.access??(spaceId ? sharedMindmapDocumentAccess(userId, spaceId) : personalDocumentAccess(userId));
    this.prefix = spaceId ? `genesis-shared-mindmaps:${userId}:${spaceId}:` : `genesis-mindmaps:${userId}:`;
    // A duplicated browser tab inherits sessionStorage. Use a fresh writer identity.
    this.tab = mapId();
  }
  dispose() { this.stopped = true;this.migrationEditors.clear();this.product?.dispose(); }
  private storageKeys(){return Array.from({length:this.storage.length},(_,index)=>this.storage.key(index)).filter((key):key is string=>key!==null);}
  registerMigrationEditor(capture:()=>{document:Mindmap|null;revision:number;state?:unknown}){
    // Direct links mount before account bootstrap restores the workspace key.
    // Registration grants no data access; captureMigration checks the current
    // unlocked owner before invoking any of these callbacks.
    if(this.stopped)throw new Error("Сессия карт закрыта.");
    const source=mapId();this.migrationEditors.set(source,capture);return()=>{this.migrationEditors.delete(source);};
  }
  captureMigration(records:readonly MapRecord[]){
    this.check();return{records:structuredClone(records),editors:[...this.migrationEditors].map(([source,capture])=>({source:'mounted:'+source,...structuredClone(capture())})),localWork:[]};
  }
  private check(access: Access = this.access) { if (this.stopped) throw new Error("Сессия карт закрыта.");if(this.product){this.product.check();return;}access.check(); }
  private async operation<T>(work: (access: Access) => Promise<T>) {
    this.check();
    return this.access.withLegacyOperation(async access => {
      this.check(access); const result = await work(access); this.check(access); return result;
    });
  }
  private enqueue<T>(work: (access: Access) => Promise<T>): Promise<T> {
    // Never hold an owner permit while waiting for another repository queue.
    const operation = this.serial.catch(() => {}).then(() => this.operation(work));
    this.serial = operation.then(() => {}, () => {}); return operation;
  }
  private draftKey(id: string) { return `${this.prefix}draft:${this.tab}:${id}`; }
  list(): Promise<MapRecord[]> { if(this.product)return this.product.list();return this.enqueue(access => this.load(access)); }
  private async load(access: Access): Promise<MapRecord[]> {
    this.check(access);
    const drafts: MapRecord[] = [];
    for (const key of this.storageKeys().filter(k => k.startsWith(`${this.prefix}draft:`))) {
      const pending: PendingMap = JSON.parse(this.storage.getItem(key)!);
      const id = key.split(":").at(-1)!;
      const document = validateMindmap(await access.open(pending, `map:${id}`)); this.check(access);
      drafts.push({ document, revision: pending.expectedRevision, updatedAt: "", pending: true, draftKey: key });
    }
    let envelopes: Envelope[];
    try {
      envelopes = (await access.request<{ maps: Envelope[] }>("/mindmaps")).maps;
      this.check(access); this.storage.setItem(`${this.prefix}cache`, JSON.stringify(envelopes));
    } catch (error) {
      this.check(access);
      if (error instanceof GenesisApiError || !this.storage.getItem(`${this.prefix}cache`)) {
        if (drafts.length && !(error instanceof GenesisApiError)) return drafts;
        throw error;
      }
      envelopes = JSON.parse(this.storage.getItem(`${this.prefix}cache`)!);
    }
    const records: MapRecord[] = [];
    for (const e of envelopes) {
      if (![1, 2].includes(e.schemaVersion)) throw new Error("Есть карты новой версии. Обновите приложение, чтобы открыть их безопасно.");
      const document = validateMindmap(await access.open(e, `map:${e.id}`)); this.check(access);
      if (document.id !== e.id) throw new Error("Идентификатор карты не совпадает с конвертом.");
      this.revisions.set(e.id, e.revision);
      records.push({ document, revision: e.revision, updatedAt: e.updatedAt });
    }
    this.check(access); return [...drafts, ...records];
  }
  adopt(record: MapRecord) {
    if(this.product){this.product.adopt(record);return;}
    this.check(); this.revisions.set(record.document.id, record.revision);
    if (record.draftKey) {
      const raw = this.storage.getItem(record.draftKey.replace(":draft:", ":request:"));
      if (raw) this.pending.set(record.document.id, JSON.parse(raw));
    }
  }
  /** Await this before starting any task write. The durable journal is separately encrypted. */
  async journal(operation: Conversion) {
    if(this.product)return this.product.journal(operation);
    const snapshot = structuredClone(operation);
    return this.operation(async access => {
      const encrypted = await access.seal(snapshot, `conversion:${snapshot.mapId}:${snapshot.nodeId}`);
      this.check(access); this.storage.setItem(`${this.prefix}conversion:${snapshot.mapId}:${snapshot.nodeId}`, JSON.stringify(encrypted));
      this.journalListeners.forEach(listener => listener());
    });
  }
  async conversions(map: Mindmap) {
    if(this.product)return this.product.conversions(map);
    const prefix = `${this.prefix}conversion:${map.id}:`;
    return this.operation(access => Promise.all(this.storageKeys().filter(k => k.startsWith(prefix)).map(async key =>
      access.open<Conversion>(JSON.parse(this.storage.getItem(key)!), `conversion:${map.id}:${key.split(":").at(-1)}`))));
  }
  saveView(id: string, view: MapView) {
    if(this.product)return this.product.saveView(id,view);
    const snapshot = structuredClone(view);
    // Mode/zoom can be captured before a debounced scroll update. They must not
    // erase its coordinates, and encryption completion order must not reorder writes.
    const write = this.viewSerial.catch(() => {}).then(() => this.operation(async access => {
      const previous = await this.readView(id, access);
      const next = { ...snapshot, viewport: snapshot.viewport ?? previous?.viewport, positions: snapshot.positions ?? previous?.positions };
      const e = await access.seal(next, `view:${id}`);
      this.check(access); this.storage.setItem(`${this.prefix}view:${id}`, JSON.stringify(e));
    }));
    this.viewSerial = write; return write;
  }
  async view(id: string): Promise<MapView | null> {
    if(this.product)return this.product.view(id);
    return this.operation(access => this.readView(id, access));
  }
  private async readView(id: string, access: Access): Promise<MapView | null> {
    this.check(access);
    const raw = this.storage.getItem(`${this.prefix}view:${id}`);
    return raw ? access.open<MapView>(JSON.parse(raw), `view:${id}`) : null;
  }
  remove(record: MapRecord): Promise<void> {
    if(this.product)return this.product.remove(record);
    const id = record.document.id;
    this.staged.set(id, (this.staged.get(id) ?? 0) + 1);
    const views = this.viewSerial;
    const operation = this.serial.catch(() => {}).then(async () => {
      await views.catch(() => {});
      return this.operation(async access => {
      const expectedRevision = Math.max(record.revision, this.revisions.get(id) ?? 0);
      await access.request(`/mindmaps/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision, schemaVersion: this.envelopeVersion }) });
      this.check(access);
      this.pending.delete(id); this.revisions.delete(id);
      for (const key of this.storageKeys()) {
        if (key === `${this.prefix}view:${id}` || key.startsWith(`${this.prefix}conversion:${id}:`)
          || (key.startsWith(`${this.prefix}draft:`) || key.startsWith(`${this.prefix}request:`)) && key.endsWith(`:${id}`)) {
          this.storage.removeItem(key);
        }
      }
      const cached: Envelope[] = JSON.parse(this.storage.getItem(`${this.prefix}cache`) || "[]");
      this.storage.setItem(`${this.prefix}cache`, JSON.stringify(cached.filter(value => value.id !== id)));
      });
    });
    this.serial = operation; return operation;
  }
  save(document: Mindmap, status: (state: SaveState, message?: string) => void): Promise<void> {
    if(this.product)return this.product.save(document,status);
    const snapshot = validateMindmap(structuredClone(document));
    const sequence = (this.staged.get(snapshot.id) ?? 0) + 1;
    this.staged.set(snapshot.id, sequence);
    // A response for an older edit may arrive after the next draft is already
    // on the device. Only that latest edit can publish its save state.
    const report = (state: SaveState, message?: string) => {
      if (this.staged.get(snapshot.id) === sequence) status(state, message);
    };
    report("saving");
    // Encrypt immediately, independently of a slow/failed network request.
    const staged = this.operation(async access => {
      const encrypted = await access.seal(snapshot, `map:${snapshot.id}`);
      this.check(access);
      const request: PendingMap = { ...encrypted, schemaVersion: this.envelopeVersion, expectedRevision: this.revisions.get(snapshot.id) ?? 0, operationId: mapId() };
      if (this.staged.get(snapshot.id) === sequence) {
        this.storage.setItem(this.draftKey(snapshot.id), JSON.stringify(request)); report("device");
      }
      return request;
    }).catch(error => { report("error", "Не удалось сохранить защищённый черновик. Не закрывайте карту; освободите место на устройстве и повторите сохранение."); throw error; });
    // Encryption can fail before an earlier slow upload finishes. Observe that
    // rejection now, retaining it for the public save promise without an unhandled child.
    void staged.catch(() => {});
    const operation = this.serial.catch(() => {}).then(async () => {
      const request = await staged;
      await new Promise(resolve => setTimeout(resolve, 250));
      return this.operation(async access => {
      if (this.staged.get(snapshot.id) !== sequence) return;
      // Do not overwrite an unresolved request: its receipt must be checked first.
      if (this.pending.has(snapshot.id)) await this.send(snapshot.id, (state, message) => {
        // Resolving an uncertain older request does not acknowledge this draft.
        if (state !== "synced") report(state, message);
      }, access);
      request.expectedRevision = this.revisions.get(snapshot.id) ?? 0;
      if (!this.spaceId && request.expectedRevision === 0) {
        // Opening a new draft adopts revision 0 before its first save. Only
        // acknowledged maps occupy the server quota; the draft is the growth.
        const savedCount = [...this.revisions.values()].filter(revision => revision > 0).length;
        requireQuotaGrowth(currentFeatureAccess(this.userId), 'mindmaps', savedCount, savedCount + 1);
      }
      this.storage.setItem(this.draftKey(snapshot.id), JSON.stringify(request));
      this.pending.set(snapshot.id, request);
      this.storage.setItem(this.draftKey(snapshot.id).replace(":draft:", ":request:"), JSON.stringify(request));
      await this.send(snapshot.id, report, access);
      this.check(access);
      if (this.staged.get(snapshot.id) === sequence) this.storage.removeItem(this.draftKey(snapshot.id));
      });
    });
    this.serial = operation; return operation;
  }
  retry(record: MapRecord, status: (state: SaveState, message?: string) => void) {
    if(this.product)return this.product.retry(record,status);
    return this.enqueue(access => this.retryRecord(record, status, access));
  }
  private async retryRecord(record: MapRecord, status: (state: SaveState, message?: string) => void, access: Access) {
    if (record.draftKey) {
      this.check(access); const raw = this.storage.getItem(record.draftKey);
      if (raw) {
        const id = record.document.id;
        const requestKey = record.draftKey.replace(":draft:", ":request:");
        const sent = this.storage.getItem(requestKey);
        if (sent) { this.pending.set(id, JSON.parse(sent)); await this.send(id, status, access); }
        const request: PendingMap = JSON.parse(raw);
        if (!sent || JSON.parse(sent).operationId !== request.operationId) {
          // A newer draft follows the acknowledged write, with a fresh CAS revision.
          if (sent) request.expectedRevision = this.revisions.get(id)!;
          this.pending.set(id, request); this.storage.setItem(requestKey, JSON.stringify(request));
          await this.send(id, status, access);
        }
        this.check(access);
        if (this.storage.getItem(record.draftKey) === raw) this.storage.removeItem(record.draftKey);
        const remaining = this.storage.getItem(requestKey);
        if (remaining && JSON.parse(remaining).operationId === request.operationId) this.storage.removeItem(requestKey);
        return;
      }
    }
    await this.send(record.document.id, status, access);
  }
  private async send(id: string, status: (state: SaveState, message?: string) => void, access: Access) {
    this.check(access); const request = this.pending.get(id); if (!request) return;
    status("pending");
    try {
      const result = await access.request<{ revision: number }>(`/mindmaps/${id}`, { method: "PUT", body: JSON.stringify(request) });
      this.check(access);
      if (!Number.isSafeInteger(result?.revision) || result.revision !== request.expectedRevision + 1) throw new Error('MINDMAP_INVALID_RESPONSE');
      this.revisions.set(id, result.revision); this.pending.delete(id);
      for (const key of this.storageKeys().filter(k => k.startsWith(`${this.prefix}request:`))) {
        const raw = this.storage.getItem(key);
        if (raw && JSON.parse(raw).operationId === request.operationId) this.storage.removeItem(key);
      }
      const cached: Envelope[] = JSON.parse(this.storage.getItem(`${this.prefix}cache`) || "[]");
      const latest: Envelope = { id, schemaVersion: request.schemaVersion, revision: result.revision, ciphertext: request.ciphertext, iv: request.iv, updatedAt: new Date().toISOString() };
      if (!cached.some(e => e.id === id && e.revision > result.revision)) this.storage.setItem(`${this.prefix}cache`, JSON.stringify([...cached.filter(e => e.id !== id), latest]));
      status("synced");
    } catch (error) {
      this.check(access); status(error instanceof GenesisApiError && error.status === 409 ? "conflict" : "error",
        error instanceof Error ? error.message : "Не удалось синхронизировать карту."); throw error;
    }
  }
  async forkDraft(document: Mindmap, status: (state: SaveState, message?: string) => void) {
    if(this.product)return this.product.forkDraft(document,status);
    const copy = validateMindmap({ ...document, id: mapId(), title: `${document.title.slice(0, 1900)} — сохранённый вариант` });
    await this.save(copy, status); return copy;
  }
  async history(id: string): Promise<MapRecord[]> {
    if(this.product)return this.product.history(id);
    return this.operation(async access => {
      const { versions } = await access.request<{ versions: Envelope[] }>(`/mindmaps/${id}/history`);
      return Promise.all(versions.map(async e => ({ document: validateMindmap(await access.open(e, `map:${id}`)), revision: e.revision, updatedAt: e.updatedAt })));
    });
  }
}
