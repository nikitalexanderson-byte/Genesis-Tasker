import { captureAccountSessionGuard, physisLegacyAccess } from '../cloud-sync';
import { MAX_PHYSIS_PLAINTEXT_BYTES, openPhysis, sealPhysis, toBase64, type PhysisEnvelope } from './crypto';
import type { PhysisRecord, PhysisStore, SaveState } from './types';
import { validatePhysisRecord } from './validation';
import { registerBackupSource } from '../backup-sources.ts';
import {assertLegacyLocalWriteAllowed} from '../e2ee/web-local-migration-fence.ts';

export type WireRecord = { id: string; revision: number; sequence: number; updatedAt: string; deletedAt: string | null; envelope: PhysisEnvelope | null };
type Acknowledgement = Omit<WireRecord, 'envelope'> & { envelope?: PhysisEnvelope | null };
type Page = { records: WireRecord[]; cursor: number; hasMore: boolean; minCursor: number; snapshot: number; nextPage?: number };
type Change = { id: string; operation: 'create' | 'update' | 'delete'; expectedRevision: number; envelope?: PhysisEnvelope };
type Pending = { requestId: string; records: PhysisRecord[]; deletes: string[]; changes?: Change[] };
type RotationResult = { revision: number; cursor: number; keyVersion: number };
type Rotation = { key: CryptoKey; vaultText: string; expectedRevision: number; payload?: string;
  result?: RotationResult; uncertain?: boolean; inFlight: Promise<RotationResult> | null };
/** This value is for the new-root-protected local migration journal only. It
 * contains old keys and exact retry bodies; it must never enter remote content. */
export type PhysisMigrationStoreMemory = {
  ownerId: string; keyVersion: number; key: string; cursor: number;
  localGeneration: number; reloadGeneration: number;
  records: PhysisRecord[]; pending: Pending[]; confirmed: WireRecord[];
  status: SaveState; error: string; editors: { id: string; mounted: boolean; value: unknown }[];
  rotation: { key: string; vaultText: string; expectedRevision: number; payload: string | null;
    result: RotationResult | null; uncertain: boolean } | null;
};
export type Transport = <T>(path: string, init?: RequestInit) => Promise<T>;
export type PhysisOperation = <T>(operation:(transport:Transport)=>Promise<T>)=>Promise<T>;
export type PhysisEditorModel=Pick<PhysisMemoryStore,'owner'|'subscribe'|'getSnapshot'|'hasPending'|'rotationPending'|'assertCurrent'|'withEditorTask'|'registerMigrationEditor'|'flush'|'reload'|'discardAndReload'|'exportWire'|'captureMigrationMemory'|'destroy'>&{readonly privateStorage?:boolean};
const errorCode = (error: unknown) => error instanceof Error ? error.message : 'PHYSIS_REQUEST_FAILED';
const MAX_BATCH_BYTES = 2 * 1024 * 1024;
const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Account for GCM tag/base64 and the whole JSON envelope before exposing optimistic state. */
function checkBatchSize(records: PhysisRecord[]) {
  const changes: Change[] = [];
  let ciphertextBytes = 0;
  for (const record of records) {
    const bytes = encodedBytes(record);
    if (bytes > MAX_PHYSIS_PLAINTEXT_BYTES) throw new Error('Запись слишком велика. Разделите данные на несколько записей.');
    ciphertextBytes += 4 * Math.ceil((bytes + 16) / 3);
    changes.push({ id: record.id, operation: 'update', expectedRevision: Number.MAX_SAFE_INTEGER,
      envelope: { version: 1, schemaVersion: 1, keyVersion: Number.MAX_SAFE_INTEGER, iv: 'AAAAAAAAAAAAAAAA', ciphertext: '' } });
  }
  if (encodedBytes({ requestId: '00000000-0000-4000-8000-000000000000', changes }) + ciphertextBytes > MAX_BATCH_BYTES)
    throw new Error('Пакет изменений слишком велик. Сохраните его меньшими группами.');
}

function validWire(item: WireRecord): boolean {
  return !!item && typeof item.id === 'string' && Number.isSafeInteger(item.revision) && item.revision > 0 &&
    Number.isSafeInteger(item.sequence) && item.sequence > 0 && typeof item.updatedAt === 'string' &&
    (item.deletedAt === null ? !!item.envelope : typeof item.deletedAt === 'string' && item.envelope === null);
}

/** Memory only. The serialized queue retains the SAME idempotency key and ciphertext on retry. */
export class PhysisMemoryStore {
  private key: CryptoKey | null;
  private listeners = new Set<() => void>();
  private confirmed = new Map<string, WireRecord>();
  private pending: Pending[] = [];
  private busy: Promise<void> | null = null;
  private localGeneration = 0;
  private reloadGeneration = 0;
  private rotation: Rotation | null = null;
  private migrationSerial = 0;
  private activeOperations = 0;
  private activeEditorTasks = 0;
  private migrationEditors = new Map<string, () => unknown>();
  private detachedEditors = new Map<string, unknown>();
  private alive = true;
  private checkSession: () => void;
  private transport: Transport;
  private operation: PhysisOperation;
  private state: PhysisStore;
  private unregisterBackup: () => void;
  cursor = 0;
  constructor(readonly owner: string, key: CryptoKey, readonly keyVersion: number,
    transport?: Transport, sessionCheck?: () => void, operation?: PhysisOperation) {
    this.key = key;
    const access=transport?null:physisLegacyAccess(owner);
    this.transport=transport??access!.request;
    this.checkSession = sessionCheck ?? access?.check ?? captureAccountSessionGuard();
    // Explicitly injected peers keep their own exclusion/session port. Product
    // instances always use the real owner-bound Web Lock and borrowed transport.
    this.operation=operation??access?.withLegacyOperation??(async task=>task(this.transport));
    this.state = { records: [], status: 'saved', error: '', save: record => this.saveMany([record]),
      saveMany: records => this.saveMany(records), remove: id => this.remove(id), reload: () => this.reload() };
    this.unregisterBackup = registerBackupSource('physis', { owner, capture:() => {
      this.check();return {records:this.state.records,pending:this.pending,cursor:this.cursor,keyVersion:this.keyVersion,
        confirmed:[...this.confirmed.values()],rotationPending:this.rotationPending};
    } });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private check() { if (!this.alive || !this.key) throw new Error('PHYSIS_LOCKED'); this.checkSession(); }
  private async run<T>(operation:(transport:Transport)=>Promise<T>,permit?:import('../e2ee/legacy-transport-fence').LegacyOperationPermit):Promise<T> {
    this.check();const admit=permit?physisLegacyAccess(this.owner,permit).withLegacyOperation:this.operation;
    return admit(async transport=>{
      this.check();this.activeOperations++;this.migrationSerial++;
      try { const result=await operation(transport);this.check();return result; }
      finally { this.activeOperations--;this.migrationSerial++; }
    });
  }
  private publish(patch: Partial<PhysisStore>) { this.migrationSerial++; this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private status(status: SaveState, error = '') { this.publish({ status, error }); }
  get hasPending() { return this.pending.length > 0; }
  get rotationPending() { return this.rotation !== null && !this.rotation.result; }
  assertCurrent() { this.check(); }
  /** File decoding, import preparation and form validation can precede a store
   * request. A source capture must refuse until these admitted tasks settle,
   * including tasks whose component has since unmounted. No nested owner lock. */
  async withEditorTask<T>(operation: () => Promise<T>): Promise<T> {
    this.check(); this.activeEditorTasks++; this.migrationSerial++;
    try { const result = await operation(); this.check(); return result; }
    finally { this.activeEditorTasks--; this.migrationSerial++; }
  }
  /** Unmount retains the last form state in memory. A later source capture must
   * include it even when that form is no longer mounted. No browser persistence. */
  registerMigrationEditor(capture: () => unknown): () => void {
    this.check(); const id = crypto.randomUUID();
    this.migrationSerial++; this.migrationEditors.set(id, capture);
    return () => {
      if (!this.migrationEditors.has(id)) return;
      // Capture before unregistering: a failing reader cannot silently drop a draft.
      if (this.alive) this.detachedEditors.set(id, structuredClone(capture()));
      this.migrationEditors.delete(id); this.migrationSerial++;
    };
  }
  /** The owner migration fence drains admitted operations before calling this.
   * No reload/bootstrap, pruning, acknowledgement, rotation or network IO here.
   * Refuse concurrent mutation while WebCrypto exports the retained old keys. */
  async captureMigrationMemory(): Promise<PhysisMigrationStoreMemory> {
    this.check();
    if (this.activeOperations || this.activeEditorTasks || this.busy || this.rotation?.inFlight) throw new Error('E2EE_PHYSIS_OPERATION_PENDING');
    const serial = this.migrationSerial, key = this.key!, rotation = this.rotation;
    const editors = () => [...this.detachedEditors].map(([id, value]) => ({ id, mounted: false, value }))
      .concat([...this.migrationEditors].map(([id, capture]) => ({ id, mounted: true, value: capture() })));
    const memory = structuredClone({ ownerId: this.owner, keyVersion: this.keyVersion, cursor: this.cursor,
      localGeneration: this.localGeneration, reloadGeneration: this.reloadGeneration,
      records: this.state.records, pending: this.pending, confirmed: [...this.confirmed.values()],
      status: this.state.status, error: this.state.error,
      editors: editors(),
      rotation: rotation ? { vaultText: rotation.vaultText, expectedRevision: rotation.expectedRevision,
        payload: rotation.payload ?? null, result: rotation.result ?? null, uncertain: rotation.uncertain ?? false } : null });
    let raw: Uint8Array | undefined, next: Uint8Array | undefined;
    try {
      raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
      if (rotation) next = new Uint8Array(await crypto.subtle.exportKey('raw', rotation.key));
      this.check();
      if (serial !== this.migrationSerial || this.activeOperations || this.activeEditorTasks || this.busy || rotation !== this.rotation || rotation?.inFlight
        || JSON.stringify(memory.editors) !== JSON.stringify(editors()))
        throw new Error('E2EE_PHYSIS_CAPTURE_CHANGED');
      if (raw.length !== 32 || next && next.length !== 32) throw new Error('E2EE_LEGACY_KEY_UNAVAILABLE');
      return { ...memory, key: toBase64(raw), rotation: memory.rotation ? { ...memory.rotation, key: toBase64(next!) } : null };
    } finally { raw?.fill(0); next?.fill(0); }
  }
  private checkEditable() {
    this.check();
    assertLegacyLocalWriteAllowed(this.owner);
    if (this.rotation) throw new Error('Дождитесь подтверждения смены ключа. При сбое повторите её с сохранённым кодом восстановления.');
  }
  private async readWire(transport:Transport): Promise<{ records: WireRecord[]; cursor: number }> {
    this.check(); let page = 0; let snapshot: number | undefined; const all: WireRecord[] = [];
    for (let count = 0; count < 500; count++) {
      const result = await transport<Page>(`/records?page=${page}&limit=100${snapshot === undefined ? '' : `&snapshot=${snapshot}`}`);
      this.check();
      if (!Array.isArray(result.records) || !result.records.every(validWire) || !Number.isSafeInteger(result.snapshot) ||
          !Number.isSafeInteger(result.cursor) || result.cursor < 0 || snapshot !== undefined && snapshot !== result.snapshot) throw new Error('PHYSIS_RESYNC_REQUIRED');
      snapshot = result.snapshot; all.push(...result.records);
      if (!result.hasMore) {
        if (new Set(all.map(record => record.id)).size !== all.length) throw new Error('PHYSIS_INVALID_PAGE');
        return { records: all, cursor: result.cursor };
      }
      const next = result.nextPage ?? result.records.at(-1)?.sequence;
      if (next === undefined || next <= page) throw new Error('PHYSIS_INVALID_PAGE');
      page = next;
    }
    throw new Error('Слишком много записей для этой версии клиента.');
  }
  async reload(permit?:import('../e2ee/legacy-transport-fence').LegacyOperationPermit) {
    return this.run(transport=>this.reloadWith(transport),permit);
  }
  private async reloadWith(transport:Transport) {
    this.check(); if (this.pending.length) throw new Error('Сначала сохраните изменения или явно отмените локальный вариант.');
    const localGeneration = this.localGeneration; const reloadGeneration = ++this.reloadGeneration;
    const { records: wire, cursor } = await this.readWire(transport); const records: PhysisRecord[] = [];
    for (const item of wire) {
      if (item.deletedAt || !item.envelope) continue;
      const decoded = await openPhysis(this.key!, this.owner, item.id, this.keyVersion, item.envelope);
      this.check();
      if (!validatePhysisRecord(decoded) || decoded.id !== item.id) throw new Error('Неподдерживаемая или поврежденная запись. Шифротекст сохранён.');
      records.push(decoded);
    }
    this.check();
    // Saving while an earlier read/decrypt is in flight must preserve the newer local view,
    // even if that save has already reached the server and the pending queue is empty.
    if (localGeneration !== this.localGeneration || reloadGeneration !== this.reloadGeneration)
      throw new Error('Локальные данные изменились во время обновления. Повторите загрузку после сохранения.');
    this.confirmed = new Map(wire.map(item => [item.id, item])); this.cursor = cursor;
    this.publish({ records, status: 'saved', error: '' });
  }
  private async saveMany(records: PhysisRecord[]): Promise<void> {
    this.checkEditable();
    if (!records.length || records.length > 100 || new Set(records.map(r => r.id)).size !== records.length || records.some(r => !validatePhysisRecord(r)))
      return Promise.reject(new Error('Проверьте формат и значения записи.'));
    const copies = structuredClone(records);
    try { checkBatchSize(copies); } catch (error) { return Promise.reject(error); }
    return this.run(async transport=>{
    this.checkEditable();
    this.localGeneration++;
    this.pending.push({ requestId: crypto.randomUUID(), records: copies, deletes: [] });
    const updated = new Map(this.state.records.map(record => [record.id, record]));
    for (const record of copies) updated.set(record.id, record);
    this.publish({ records: [...updated.values()] });
    return this.flushWith(transport);
    });
  }
  private async remove(id: string): Promise<void> {
    return this.run(async transport=>{
    this.checkEditable();
    if (!this.state.records.some(record => record.id === id)) return Promise.reject(new Error('Запись не найдена.'));
    this.localGeneration++; this.pending.push({ requestId: crypto.randomUUID(), records: [], deletes: [id] });
    this.publish({ records: this.state.records.filter(record => record.id !== id) });
    return this.flushWith(transport);
    });
  }
  flush = (): Promise<void> => this.run(transport=>this.flushWith(transport));
  private flushWith(transport:Transport):Promise<void> {
    this.check();
    if (this.state.status === 'conflict') return Promise.reject(new Error(this.state.error));
    if (this.busy) return this.busy;
    this.busy = this.sendQueue(transport).finally(() => { this.busy = null; });
    return this.busy;
  }
  private async sendQueue(transport:Transport) {
    if (!this.pending.length) return;
    this.status('saving');
    try {
      while (this.pending.length) {
        this.check(); const item = this.pending[0];
        if (!item.changes) {
          const changes: Change[] = [];
          for (const record of item.records) {
            const known = this.confirmed.get(record.id);
            if (known?.deletedAt) throw new Error('PHYSIS_CONFLICT');
            changes.push({ id: record.id, operation: known ? 'update' : 'create', expectedRevision: known?.revision ?? 0,
              envelope: await sealPhysis(this.key!, this.owner, record.id, this.keyVersion, record) });
          }
          for (const id of item.deletes) {
            const known = this.confirmed.get(id);
            if (!known || known.deletedAt) throw new Error('PHYSIS_CONFLICT');
            changes.push({ id, operation: 'delete', expectedRevision: known.revision });
          }
          // Never retain a partially encrypted batch after an exception.
          if (encodedBytes({ requestId: item.requestId, changes }) > MAX_BATCH_BYTES) throw new Error('PHYSIS_BATCH_TOO_LARGE');
          item.changes = changes; this.migrationSerial++;
        }
        this.check();
        const response = await transport<{ records: Acknowledgement[]; cursor: number }>('/records', {
          method: 'POST', body: JSON.stringify({ requestId: item.requestId, changes: item.changes }),
        });
        this.check();
        if (!Array.isArray(response.records) || response.records.length !== item.changes.length ||
            new Set(response.records.map(record => record.id)).size !== item.changes.length ||
            !Number.isSafeInteger(response.cursor) || response.records.some(record => {
              const change = item.changes!.find(value => value.id === record.id);
              const envelope = change?.operation === 'delete' ? null : change?.envelope ?? null;
              return !validWire({ ...record, envelope }) || !change || record.revision !== change.expectedRevision + 1 ||
                (change.operation === 'delete' ? record.deletedAt === null : record.deletedAt !== null ||
                  record.envelope !== undefined && (record.envelope?.iv !== change.envelope?.iv || record.envelope?.ciphertext !== change.envelope?.ciphertext));
            })) throw new Error('PHYSIS_INVALID_RESPONSE');
        for (const record of response.records) {
          const change = item.changes.find(value => value.id === record.id)!;
          this.confirmed.set(record.id, { ...record, envelope: change.operation === 'delete' ? null : change.envelope! });
        }
        this.cursor = response.cursor; this.pending.shift(); this.migrationSerial++;
      }
      this.status('saved');
    } catch (error) {
      if (!this.alive) throw error;
      this.checkSession();
      const code = errorCode(error);
      const status = (error as { status?: number })?.status;
      const conflict = status === 409 || /CONFLICT|REVISION|RESYNC|IDEMPOTENCY|EXISTS|DELETED/.test(code);
      const message = conflict ? 'Данные изменились на другом устройстве. Ваш вариант остаётся в памяти; экспортируйте его перед загрузкой серверного.'
        : status === 403 || status === 401 ? 'Доступ завершён. Разблокируйте раздел после повторного входа.'
        : status === 400 || status === 413 ? 'Сервер отклонил запись. Проверьте размер и формат; локальные изменения ещё не сохранены.'
        : 'Не сохранено — нет связи. Не закрывайте вкладку: изменения пока только в её памяти.';
      this.status(conflict ? 'conflict' : status === 400 || status === 413 ? 'error' : 'offline', message);
      throw new Error(message);
    }
  }
  async discardAndReload() {
    return this.run(async transport=>{
    this.checkEditable();
    if (this.busy) throw new Error('Дождитесь завершения текущего запроса.');
    this.localGeneration++; this.pending = []; await this.reloadWith(transport);
    });
  }
  async exportWire() {
    return this.run(async transport=>{
    this.checkEditable(); if (this.pending.length) throw new Error('Дождитесь сохранения перед зашифрованным экспортом.');
    const generation = this.localGeneration; const { records } = await this.readWire(transport);
    for (const record of records) {
      if (record.deletedAt || !record.envelope) continue;
      const decoded = await openPhysis(this.key!, this.owner, record.id, this.keyVersion, record.envelope);
      this.check();
      if (!validatePhysisRecord(decoded) || decoded.id !== record.id) throw new Error('Повреждённая запись: зашифрованный экспорт не создан.');
    }
    if (generation !== this.localGeneration) throw new Error('Данные изменились во время экспорта. Повторите его после сохранения.');
    return records;
    });
  }
  async rotate(newKey: CryptoKey, vault: unknown, expectedVaultRevision: number): Promise<RotationResult> {
    this.check();const vaultText = JSON.stringify(vault);
    return this.run(async transport=>{
    this.check(); if (this.pending.length || this.busy) return Promise.reject(new Error('Сначала сохраните все изменения.'));
    if (this.rotation && (this.rotation.key !== newKey || this.rotation.vaultText !== vaultText || this.rotation.expectedRevision !== expectedVaultRevision))
      return Promise.reject(new Error('Смена ключа ещё не подтверждена. Повторите предыдущую попытку с тем же кодом восстановления.'));
    if (!this.rotation) { this.rotation = { key: newKey, vaultText, expectedRevision: expectedVaultRevision, inFlight: null }; this.migrationSerial++; }
    const candidate = this.rotation;
    if (candidate.result) return Promise.resolve(candidate.result);
    if (candidate.inFlight) return candidate.inFlight;
    candidate.inFlight = this.sendRotation(candidate,transport).finally(() => { candidate.inFlight = null; });
    return candidate.inFlight;
    });
  }
  private async sendRotation(candidate: Rotation,transport:Transport): Promise<RotationResult> {
    try {
      if (!candidate.payload) {
        await this.reloadWith(transport);
        const records = [];
        for (const record of this.state.records) records.push({ id: record.id, expectedRevision: this.confirmed.get(record.id)!.revision,
          envelope: await sealPhysis(candidate.key, this.owner, record.id, this.keyVersion + 1, record) });
        this.check();
        const payload = JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: candidate.expectedRevision,
          expectedCursor: this.cursor, vault: JSON.parse(candidate.vaultText), records });
        if (new TextEncoder().encode(payload).byteLength > 48 * 1024 * 1024) throw new Error('Пакет смены ключа слишком велик.');
        candidate.payload = payload; this.migrationSerial++;
      }
      this.check();
      const result = await transport<RotationResult>('/rotate', { method: 'POST', body: candidate.payload });
      this.check();
      if (result.revision !== candidate.expectedRevision + 1 || result.keyVersion !== this.keyVersion + 1 || !Number.isSafeInteger(result.cursor))
        throw new Error('PHYSIS_INVALID_RESPONSE');
      candidate.result = result; this.migrationSerial++;
      return result;
    } catch (error) {
      this.check();
      // A network/invalid-response failure can mean the server committed; retain exact
      // payload and both keys. Only a definitive rejection or pre-send failure is safe to reset.
      const status = (error as { status?: number })?.status;
      const definitive = status !== undefined && [400, 403, 409, 413, 415].includes(status);
      if (!candidate.payload || definitive && !candidate.uncertain) this.rotation = null;
      else candidate.uncertain = true;
      this.migrationSerial++;
      throw error;
    }
  }
  destroy() {
    this.unregisterBackup();
    this.alive = false; this.key = null; this.pending = []; this.confirmed.clear(); this.rotation = null;
    this.migrationEditors.clear(); this.detachedEditors.clear();
    this.publish({ records: [], error: '', status: 'saved' }); this.listeners.clear();
  }
}
