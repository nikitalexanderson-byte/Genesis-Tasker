import { GenesisApiError, personalDocumentAccess, sharedMindmapDocumentAccess, type GenesisTask } from "./cloud-sync";
import { mapId, validateMindmap, type Mindmap, type MapView } from "./mindmaps-model";
import { currentFeatureAccess, requireQuotaGrowth } from './feature-access';

type Sealed = { iv: string; ciphertext: string };
type Envelope = Sealed & { id: string; schemaVersion: number; revision: number; updatedAt: string };
export type MapRecord = { document: Mindmap; revision: number; updatedAt: string; pending?: boolean; draftKey?: string };
type PendingMap = { schemaVersion: 1 | 2; expectedRevision: number; operationId: string } & Sealed;
export type Conversion = { mapId: string; nodeId: string; taskId: string; task?: GenesisTask; applied?: boolean };
export type SaveState = "saving" | "device" | "pending" | "synced" | "conflict" | "error";
export const MINDMAPS_ENABLED = process.env.NEXT_PUBLIC_GENESIS_MINDMAPS === "true";

/** Each tab has its own encrypted draft; a tab can never overwrite another tab's unsent text. */
export class MindmapRepository {
  private access: ReturnType<typeof personalDocumentAccess> | ReturnType<typeof sharedMindmapDocumentAccess>;
  private prefix: string;
  private tab: string;
  private envelopeVersion: 1 | 2;
  private serial = Promise.resolve();
  private viewSerial = Promise.resolve();
  private revisions = new Map<string, number>();
  private pending = new Map<string, PendingMap>();
  private staged = new Map<string, number>();
  private stopped = false;
  private journalListeners = new Set<() => void>();
  subscribeJournal(listener: () => void) { this.journalListeners.add(listener); return () => { this.journalListeners.delete(listener); }; }
  constructor(private userId: string, private spaceId?: string) {
    this.envelopeVersion = spaceId ? 1 : 2;
    this.access = spaceId ? sharedMindmapDocumentAccess(userId, spaceId) : personalDocumentAccess(userId);
    this.prefix = spaceId ? `genesis-shared-mindmaps:${userId}:${spaceId}:` : `genesis-mindmaps:${userId}:`;
    // A duplicated browser tab inherits sessionStorage. Use a fresh writer identity.
    this.tab = mapId();
  }
  dispose() { this.stopped = true; }
  private check() { if (this.stopped) throw new Error("Сессия карт закрыта."); this.access.check(); }
  private draftKey(id: string) { return `${this.prefix}draft:${this.tab}:${id}`; }
  async list(): Promise<MapRecord[]> {
    this.check();
    const drafts: MapRecord[] = [];
    for (const key of Object.keys(localStorage).filter(k => k.startsWith(`${this.prefix}draft:`))) {
      const pending: PendingMap = JSON.parse(localStorage.getItem(key)!);
      const id = key.split(":").at(-1)!;
      const document = validateMindmap(await this.access.open(pending, `map:${id}`));
      drafts.push({ document, revision: pending.expectedRevision, updatedAt: "", pending: true, draftKey: key });
    }
    let envelopes: Envelope[];
    try {
      envelopes = (await this.access.request<{ maps: Envelope[] }>("/mindmaps")).maps;
      this.check(); localStorage.setItem(`${this.prefix}cache`, JSON.stringify(envelopes));
    } catch (error) {
      if (error instanceof GenesisApiError || !localStorage.getItem(`${this.prefix}cache`)) {
        if (drafts.length && !(error instanceof GenesisApiError)) return drafts;
        throw error;
      }
      envelopes = JSON.parse(localStorage.getItem(`${this.prefix}cache`)!);
    }
    const records: MapRecord[] = [];
    for (const e of envelopes) {
      if (![1, 2].includes(e.schemaVersion)) throw new Error("Есть карты новой версии. Обновите приложение, чтобы открыть их безопасно.");
      const document = validateMindmap(await this.access.open(e, `map:${e.id}`));
      if (document.id !== e.id) throw new Error("Идентификатор карты не совпадает с конвертом.");
      this.revisions.set(e.id, e.revision);
      records.push({ document, revision: e.revision, updatedAt: e.updatedAt });
    }
    this.check(); return [...drafts, ...records];
  }
  adopt(record: MapRecord) {
    this.check(); this.revisions.set(record.document.id, record.revision);
    if (record.draftKey) {
      const raw = localStorage.getItem(record.draftKey.replace(":draft:", ":request:"));
      if (raw) this.pending.set(record.document.id, JSON.parse(raw));
    }
  }
  /** Await this before starting any task write. The durable journal is separately encrypted. */
  async journal(operation: Conversion) {
    this.check(); const encrypted = await this.access.seal(operation, `conversion:${operation.mapId}:${operation.nodeId}`);
    this.check(); localStorage.setItem(`${this.prefix}conversion:${operation.mapId}:${operation.nodeId}`, JSON.stringify(encrypted));
    this.journalListeners.forEach(listener => listener());
  }
  async conversions(map: Mindmap) {
    const prefix = `${this.prefix}conversion:${map.id}:`;
    return Promise.all(Object.keys(localStorage).filter(k => k.startsWith(prefix)).map(async key =>
      this.access.open<Conversion>(JSON.parse(localStorage.getItem(key)!), `conversion:${map.id}:${key.split(":").at(-1)}`)));
  }
  saveView(id: string, view: MapView) {
    // Mode/zoom can be captured before a debounced scroll update. They must not
    // erase its coordinates, and encryption completion order must not reorder writes.
    const write = this.viewSerial.catch(() => {}).then(async () => {
      const previous = await this.view(id);
      const next = { ...view, viewport: view.viewport ?? previous?.viewport, positions: view.positions ?? previous?.positions };
      const e = await this.access.seal(next, `view:${id}`);
      this.check(); localStorage.setItem(`${this.prefix}view:${id}`, JSON.stringify(e));
    });
    this.viewSerial = write; return write;
  }
  async view(id: string): Promise<MapView | null> {
    const raw = localStorage.getItem(`${this.prefix}view:${id}`);
    return raw ? this.access.open<MapView>(JSON.parse(raw), `view:${id}`) : null;
  }
  remove(record: MapRecord): Promise<void> {
    const id = record.document.id;
    this.staged.set(id, (this.staged.get(id) ?? 0) + 1);
    const operation = this.serial.catch(() => {}).then(async () => {
      this.check();
      await this.viewSerial.catch(() => {});
      const expectedRevision = Math.max(record.revision, this.revisions.get(id) ?? 0);
      await this.access.request(`/mindmaps/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision, schemaVersion: this.envelopeVersion }) });
      this.check();
      this.pending.delete(id); this.revisions.delete(id);
      for (const key of Object.keys(localStorage)) {
        if (key === `${this.prefix}view:${id}` || key.startsWith(`${this.prefix}conversion:${id}:`)
          || (key.startsWith(`${this.prefix}draft:`) || key.startsWith(`${this.prefix}request:`)) && key.endsWith(`:${id}`)) {
          localStorage.removeItem(key);
        }
      }
      const cached: Envelope[] = JSON.parse(localStorage.getItem(`${this.prefix}cache`) || "[]");
      localStorage.setItem(`${this.prefix}cache`, JSON.stringify(cached.filter(value => value.id !== id)));
    });
    this.serial = operation; return operation;
  }
  save(document: Mindmap, status: (state: SaveState, message?: string) => void): Promise<void> {
    const snapshot = validateMindmap(document);
    const sequence = (this.staged.get(snapshot.id) ?? 0) + 1;
    this.staged.set(snapshot.id, sequence);
    status("saving");
    // Encrypt immediately, independently of a slow/failed network request.
    const staged = this.access.seal(snapshot, `map:${snapshot.id}`).then(encrypted => {
      this.check();
      const request: PendingMap = { ...encrypted, schemaVersion: this.envelopeVersion, expectedRevision: this.revisions.get(snapshot.id) ?? 0, operationId: mapId() };
      if (this.staged.get(snapshot.id) === sequence) {
        localStorage.setItem(this.draftKey(snapshot.id), JSON.stringify(request)); status("device");
      }
      return request;
    }).catch(error => { status("error", "Не удалось сохранить защищённый черновик. Не закрывайте карту; освободите место на устройстве и повторите сохранение."); throw error; });
    const operation = this.serial.catch(() => {}).then(async () => {
      this.check();
      const request = await staged;
      await new Promise(resolve => setTimeout(resolve, 250));
      this.check();
      if (this.staged.get(snapshot.id) !== sequence) return;
      // Do not overwrite an unresolved request: its receipt must be checked first.
      if (this.pending.has(snapshot.id)) await this.send(snapshot.id, status);
      request.expectedRevision = this.revisions.get(snapshot.id) ?? 0;
      if (!this.spaceId && request.expectedRevision === 0) {
        // Opening a new draft adopts revision 0 before its first save. Only
        // acknowledged maps occupy the server quota; the draft is the growth.
        const savedCount = [...this.revisions.values()].filter(revision => revision > 0).length;
        requireQuotaGrowth(currentFeatureAccess(this.userId), 'mindmaps', savedCount, savedCount + 1);
      }
      localStorage.setItem(this.draftKey(snapshot.id), JSON.stringify(request));
      this.pending.set(snapshot.id, request);
      localStorage.setItem(this.draftKey(snapshot.id).replace(":draft:", ":request:"), JSON.stringify(request));
      await this.send(snapshot.id, status);
      if (this.staged.get(snapshot.id) === sequence) localStorage.removeItem(this.draftKey(snapshot.id));
    });
    this.serial = operation; return operation;
  }
  async retry(record: MapRecord, status: (state: SaveState, message?: string) => void) {
    if (record.draftKey) {
      this.check(); const raw = localStorage.getItem(record.draftKey);
      if (raw) {
        const id = record.document.id;
        const requestKey = record.draftKey.replace(":draft:", ":request:");
        const sent = localStorage.getItem(requestKey);
        if (sent) { this.pending.set(id, JSON.parse(sent)); await this.send(id, status); }
        const request: PendingMap = JSON.parse(raw);
        if (!sent || JSON.parse(sent).operationId !== request.operationId) {
          // A newer draft follows the acknowledged write, with a fresh CAS revision.
          if (sent) request.expectedRevision = this.revisions.get(id)!;
          this.pending.set(id, request); localStorage.setItem(requestKey, JSON.stringify(request));
          await this.send(id, status);
        }
        this.check();
        if (localStorage.getItem(record.draftKey) === raw) localStorage.removeItem(record.draftKey);
        localStorage.removeItem(requestKey); return;
      }
    }
    await this.send(record.document.id, status);
  }
  private async send(id: string, status: (state: SaveState, message?: string) => void) {
    this.check(); const request = this.pending.get(id); if (!request) return;
    status("pending");
    try {
      const result = await this.access.request<{ revision: number }>(`/mindmaps/${id}`, { method: "PUT", body: JSON.stringify(request) });
      this.check(); this.revisions.set(id, result.revision); this.pending.delete(id);
      for (const key of Object.keys(localStorage).filter(k => k.startsWith(`${this.prefix}request:`))) {
        const raw = localStorage.getItem(key);
        if (raw && JSON.parse(raw).operationId === request.operationId) localStorage.removeItem(key);
      }
      const cached: Envelope[] = JSON.parse(localStorage.getItem(`${this.prefix}cache`) || "[]");
      const latest: Envelope = { id, schemaVersion: request.schemaVersion, revision: result.revision, ciphertext: request.ciphertext, iv: request.iv, updatedAt: new Date().toISOString() };
      if (!cached.some(e => e.id === id && e.revision > result.revision)) localStorage.setItem(`${this.prefix}cache`, JSON.stringify([...cached.filter(e => e.id !== id), latest]));
      status("synced");
    } catch (error) {
      this.check(); status(error instanceof GenesisApiError && error.status === 409 ? "conflict" : "error",
        error instanceof Error ? error.message : "Не удалось синхронизировать карту."); throw error;
    }
  }
  async forkDraft(document: Mindmap, status: (state: SaveState, message?: string) => void) {
    const copy = validateMindmap({ ...document, id: mapId(), title: `${document.title.slice(0, 1900)} — сохранённый вариант` });
    await this.save(copy, status); return copy;
  }
  async history(id: string): Promise<MapRecord[]> {
    const { versions } = await this.access.request<{ versions: Envelope[] }>(`/mindmaps/${id}/history`);
    return Promise.all(versions.map(async e => ({ document: validateMindmap(await this.access.open(e, `map:${id}`)), revision: e.revision, updatedAt: e.updatedAt })));
  }
}
