import { personalDocumentAccess, GenesisApiError } from './cloud-sync';
import { currentFeatureAccess, requireQuotaGrowth, requireFeature } from './feature-access';
import { validateDiaryNote, validDreamDay, type DiaryNote } from './diary-model';
import { DEFAULT_DREAM_SETTINGS, parseDreamSettings, type DreamSettings } from './dream-journal-model';

type Sealed = { iv: string; ciphertext: string };
type Envelope = Sealed & { id: string; revision: number; schemaVersion: number; updatedAt: string; localOnly?: boolean; uploadId?: string };
type Deletion = { id: string; revision: number; updatedAt: string; localOnly: boolean };
type Settings = { syncEnabled: boolean; revision: number };
type Pending = Sealed & { expectedRevision: number; schemaVersion: 1 };
export type DiaryRecord = { note: DiaryNote; revision: number; draftKey?: string; pending?: Pending; localOnly?: boolean };
export type DiaryEditorCapture = {note:DiaryNote;revision:number;state?:unknown};
type Access = Pick<ReturnType<typeof personalDocumentAccess>, 'check' | 'request' | 'seal' | 'open' | 'privateId' | 'withLegacyOperation'>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const sameContent = (a: DiaryNote, b: DiaryNote) => JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' });

/** Each tab journals its own encrypted draft before any network write. No plaintext is cached. */
export class DiaryRepository {
  private access: Access;
  private prefix: string;
  private writer = crypto.randomUUID();
  private serial = Promise.resolve();
  private stopped = false;
  private deleted = new Map<string, Deletion>();
  private settings: Settings = { syncEnabled: true, revision: 0 };
  private deviceLocalOnly = false;
  private snapshot = '';
  private migrationEditors = new Map<string,()=>DiaryEditorCapture>();
  registerMigrationEditor(read:()=>DiaryEditorCapture) {
    this.check();const source='diary-editor:'+crypto.randomUUID();this.migrationEditors.set(source,read);
    return()=>{this.migrationEditors.delete(source);};
  }
  captureMigration(records:readonly DiaryRecord[]) {
    this.check();const result={records:structuredClone(records),editors:[...this.migrationEditors].map(([source,read])=>({source,...structuredClone(read())}))};this.check();return result;
  }
  get syncEnabled() { return this.settings.syncEnabled && !this.deviceLocalOnly; }
  get pendingUploads() { return this.cache().filter(row => row.localOnly).length; }
  offline = false;
  dreamSettings: DreamSettings = { ...DEFAULT_DREAM_SETTINGS };
  constructor(private userId: string, private storage: Storage, access?: Access) {
    this.access = access ?? personalDocumentAccess(userId);
    this.prefix = `genesis-diary-v1:${userId}:`;
    const dreamSettings = this.storage.getItem(`${this.prefix}dream-settings`);
    if (dreamSettings) this.dreamSettings = parseDreamSettings(JSON.parse(dreamSettings));
    const saved = this.storage.getItem(`${this.prefix}settings`);
    if (saved) { const value = JSON.parse(saved); this.deviceLocalOnly = value.deviceLocalOnly === true; this.acceptSettings({ settings: value }, false, false); }
    this.acceptDeletions(JSON.parse(this.storage.getItem(`${this.prefix}deleted`) || '[]'));
  }
  dispose() { this.stopped = true;this.migrationEditors.clear(); }
  private check(access = this.access) { if (this.stopped) throw new Error('DIARY_SESSION_CLOSED'); access.check(); }
  private async run<T>(operation:(access:Access)=>Promise<T>) {
    this.check();return this.access.withLegacyOperation(async access=>{this.check(access);const result=await operation(access);this.check(access);return result;});
  }
  private enqueue<T>(operation:(access:Access)=>Promise<T>) {
    const task=this.serial.then(()=>this.run(operation));this.serial=task.then(()=>{},()=>{});return task;
  }
  async adviceId(id: string) {
    return this.run(async access=>{
    for (const row of this.cache()) {
      const note = validateDiaryNote(await access.open(row, this.scope(row.id)));
      if (note.advice?.id === id) return note.id;
    }
    for (let generation = 0; ; generation++) {
      const candidate = await access.privateId(`diary-advice:${id}${generation ? `:recreated:${generation}` : ''}`);
      if (!this.deleted.has(candidate)) return candidate;
    }
    });
  }
  private scope(id: string) { return `diary-note:v1:${id}`; }
  private cache(): Envelope[] { const rows: unknown = JSON.parse(this.storage.getItem(`${this.prefix}cache`) || '[]'); if (!Array.isArray(rows)) throw new Error('DIARY_INVALID_CACHE'); return rows; }
  private draftKeys() { return Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(`${this.prefix}draft:`))); }
  private acceptSettings(response: { settings?: Settings; snapshot?: string; dreamSettings?: DreamSettings }, activate = false, persist = true) {
    if (response.dreamSettings) {
      const row = parseDreamSettings(response.dreamSettings);
      if (row.revision >= this.dreamSettings.revision) {
        this.dreamSettings = row; if(persist)this.storage.setItem(`${this.prefix}dream-settings`, JSON.stringify(row));
      }
    }
    if (response.settings) {
      const row = response.settings;
      if (typeof row.syncEnabled !== 'boolean' || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('DIARY_INVALID_RESPONSE');
      if (row.revision < this.settings.revision) return;
      this.settings = { ...row };
      if (activate) this.deviceLocalOnly = !row.syncEnabled;
      else if (!row.syncEnabled) this.deviceLocalOnly = true;
      if(persist)this.storage.setItem(`${this.prefix}settings`, JSON.stringify({ ...this.settings, deviceLocalOnly: this.deviceLocalOnly }));
    }
    if (response.snapshot != null) { if (!/^[a-f\d]{64}$/.test(response.snapshot)) throw new Error('DIARY_INVALID_RESPONSE'); this.snapshot = response.snapshot; }
  }
  private acceptDeletions(input: unknown) {
    if (!Array.isArray(input)) throw new Error('DIARY_INVALID_RESPONSE');
    const rows: Deletion[] = input.map(row => {
      if (!row || !/^[\w-]{1,100}$/.test(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 2 || !Number.isFinite(Date.parse(row.updatedAt)) || typeof row.localOnly !== 'boolean') throw new Error('DIARY_INVALID_RESPONSE');
      return row;
    });
    for (const row of rows) if (this.deleted.get(row.id)?.localOnly !== false && (!this.deleted.has(row.id) || this.deleted.get(row.id)!.revision <= row.revision)) this.deleted.set(row.id, row);
  }
  private retain(rows: Envelope[]) {
    return rows.filter(row => this.deleted.get(row.id)?.localOnly !== false).map(row => this.deleted.get(row.id)?.localOnly && !row.localOnly ? { ...row, revision: 0, localOnly: true } : row);
  }
  private persistDeletions() {
    this.storage.setItem(`${this.prefix}deleted`, JSON.stringify([...this.deleted.values()]));
    this.storage.setItem(`${this.prefix}cache`, JSON.stringify(this.retain(this.cache())));
    for (const key of this.draftKeys()) {
      const id = key.split(':').at(-1)!;
      if (this.deleted.get(id)?.localOnly === false) this.storage.removeItem(key);
      else if (this.deleted.get(id)?.localOnly) {
        const draft: Pending = JSON.parse(this.storage.getItem(key)!);
        this.storage.setItem(key, JSON.stringify({ ...draft, expectedRevision: 0 }));
      }
    }
  }
  async keepDraft(input: DiaryNote, record?: DiaryRecord) {
    const note = validateDiaryNote(input);
    return this.enqueue(async access=>{
      this.check(access); if (this.deleted.get(note.id)?.localOnly === false) throw new Error('DIARY_NOTE_DELETED');
      const draftKey = record?.draftKey ?? `${this.prefix}draft:${this.writer}:${note.id}`;
      const previous: Pending | null = JSON.parse(this.storage.getItem(draftKey) || 'null');
      const before = previous ? validateDiaryNote(await access.open(previous, this.scope(note.id))) : null;
      const reuse = previous?.expectedRevision === (record?.revision ?? 0) && before && sameContent(before, note);
      const pending: Pending = reuse ? previous! : { ...await access.seal(note, this.scope(note.id)), expectedRevision: record?.revision ?? 0, schemaVersion: 1 };
      this.check(access); this.storage.setItem(draftKey, JSON.stringify(pending)); return { note: reuse ? before! : note, revision: pending.expectedRevision, pending, draftKey };
    });
  }
  async list(): Promise<DiaryRecord[]> {
    return this.run(access=>this.listNow(access));
  }
  private async listNow(access:Access):Promise<DiaryRecord[]> {
    this.check(access); let envelopes: Envelope[];
    if (!this.syncEnabled) {
      try { const response = await access.request<{ settings: Settings; snapshot: string; deleted?: Deletion[] }>('/diary/settings', { cache: 'no-store' }); this.check(access);
        this.acceptSettings(response); this.acceptDeletions(response.deleted ?? []); this.persistDeletions(); this.offline = false; }
      catch (error) { if (error instanceof GenesisApiError) throw error; this.check(access); this.offline = true; }
      if (!this.syncEnabled) return this.openRecords(this.retain(this.cache()),access);
    }
    try {
      const response = await access.request<{ notes: Envelope[]; deleted?: Deletion[]; settings?: Settings; snapshot?: string }>('/diary', { cache: 'no-store' });
      this.check(access); if (!Array.isArray(response.notes)) throw new Error('DIARY_INVALID_RESPONSE');
      this.acceptSettings(response); this.acceptDeletions(response.deleted ?? []); this.persistDeletions();
      const byId = new Map(response.notes.map(row => [row.id, row]));
      // Keep newer acknowledgments, but deletion markers always win over an older GET.
      const cached = this.cache();
      for (const row of cached) if ((byId.get(row.id)?.revision ?? -1) < row.revision) byId.set(row.id, row);
      envelopes = this.retain([...byId.values()]); this.offline = false;
      try { this.storage.setItem(`${this.prefix}cache`, JSON.stringify(envelopes)); } catch { /* Online reading remains available when device storage is full. */ }
    } catch (error) {
      if (error instanceof GenesisApiError || !this.storage.getItem(`${this.prefix}cache`)) throw error;
      this.check(access); envelopes = JSON.parse(this.storage.getItem(`${this.prefix}cache`)!); this.offline = true;
    }
    return this.openRecords(envelopes,access);
  }
  private async openRecords(envelopes: Envelope[],access:Access): Promise<DiaryRecord[]> {
    const records: DiaryRecord[] = [];
    for (const envelope of envelopes) {
      if (envelope.schemaVersion !== 1 || !Number.isInteger(envelope.revision) || envelope.revision < (envelope.localOnly ? 0 : 1)) throw new Error('DIARY_INVALID_RESPONSE');
      const note = validateDiaryNote(await access.open(envelope, this.scope(envelope.id)));
      if (note.id !== envelope.id) throw new Error('DIARY_INVALID_RESPONSE');
      records.push({ note, revision: envelope.revision, localOnly: envelope.localOnly });
    }
    const keys = Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(`${this.prefix}draft:`)));
    for (const draftKey of keys) {
      const pending: Pending = JSON.parse(this.storage.getItem(draftKey)!); const id = draftKey.split(':').at(-1)!;
      const note = validateDiaryNote(await access.open(pending, this.scope(id)));
      if (note.id !== id) throw new Error('DIARY_INVALID_RESPONSE');
      records.push({ note, revision: pending.expectedRevision, pending, draftKey });
    }
    this.check(access); return records.filter(row => this.deleted.get(row.note.id)?.localOnly !== false);
  }
  async save(input: DiaryNote, record?: DiaryRecord): Promise<DiaryRecord & { clearedDraftKey: string }> {
    const note = validateDiaryNote(input);
    if (record && note.id !== record.note.id) throw new Error('DIARY_INVALID_NOTE');
    return this.enqueue(access=>this.saveNow(note, record,access));
  }
  private async saveNow(note: DiaryNote, record: DiaryRecord|undefined,documentAccess:Access): Promise<DiaryRecord & { clearedDraftKey: string }> {
      this.check(documentAccess); const expectedRevision = record?.revision ?? 0;
      const access = currentFeatureAccess(this.userId);
      if (note.dream) requireFeature(access, "dream-journal");
      if (!note.advice && !this.cache().some(row=>row.id===note.id)) {
        let count=0;
        for (const row of this.cache()) if (!validateDiaryNote(await documentAccess.open(row,this.scope(row.id))).advice) count++;
        requireQuotaGrowth(access,'diary',count,count+1);
      }
      if (this.syncEnabled && record?.localOnly) throw new Error('DIARY_LOCAL_UPLOAD_PENDING');
      if (this.deleted.get(note.id)?.localOnly === false) throw new Error('DIARY_NOTE_DELETED');
      const draftKey = record?.draftKey ?? `${this.prefix}draft:${this.writer}:${note.id}`;
      const previous: Pending | null = JSON.parse(this.storage.getItem(draftKey) || 'null');
      const before = previous ? validateDiaryNote(await documentAccess.open(previous, this.scope(note.id))) : null;
      const reuse = previous?.expectedRevision === expectedRevision && before && sameContent(before, note);
      const pending: Pending = reuse ? previous! : { ...await documentAccess.seal(note, this.scope(note.id)), expectedRevision, schemaVersion: 1 };
      this.check(documentAccess); this.storage.setItem(draftKey, JSON.stringify(pending));
      const result = !this.syncEnabled ? { revision: 0, updatedAt: note.updatedAt } :
        await documentAccess.request<{ revision: number; updatedAt: string }>(`/diary/${note.id}`, { method: 'PUT', body: JSON.stringify({ ...pending, ...(note.dream ? {dream:{day:note.dream.day,timeZone:note.dream.timeZone}} : {}), ...(access?.enforcementEnabled && note.advice ? {adviceId:note.advice.id} : {}) }) });
      this.check(documentAccess); if (this.syncEnabled && result.revision !== expectedRevision + 1 || !Number.isFinite(Date.parse(result.updatedAt))) throw new Error('DIARY_INVALID_RESPONSE');
      const cache: Envelope[] = JSON.parse(this.storage.getItem(`${this.prefix}cache`) || '[]');
      this.storage.setItem(`${this.prefix}cache`, JSON.stringify([...cache.filter(row => row.id !== note.id), { ...pending, id: note.id, revision: result.revision, updatedAt: result.updatedAt, localOnly: !this.syncEnabled }]));
      this.storage.removeItem(draftKey); return { note: reuse ? before! : note, revision: result.revision, clearedDraftKey: draftKey, localOnly: !this.syncEnabled };
  }
  async remove(record: DiaryRecord) {
    return this.enqueue(async access=>{
      this.check(access); if (record.draftKey) throw new Error('DIARY_INVALID_NOTE');
      let marker: Deletion;
      if (!this.syncEnabled || record.localOnly) marker = { id: record.note.id, revision: Math.max(2, record.revision + 1), updatedAt: new Date().toISOString(), localOnly: false };
      else {
        const result = await access.request<Deletion & { deleted: boolean }>(`/diary/${record.note.id}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision: record.revision }) });
        this.check(access); if (result.deleted !== true || result.id !== record.note.id || result.revision !== record.revision + 1) throw new Error('DIARY_INVALID_RESPONSE');
        marker = { ...result, localOnly: false };
      }
      this.acceptDeletions([marker]); this.persistDeletions();
    });
  }
  async setSyncEnabled(enabled: boolean) {
    return this.enqueue(async access=>{
      // list() persists all remote ciphertext and local drafts before deletion is allowed.
      await this.listNow(access); this.check(access);
      if (this.syncEnabled !== enabled || !enabled) {
        if (!this.snapshot) throw new Error('DIARY_ONLINE_REQUIRED');
        this.storage.setItem(`${this.prefix}cache`, JSON.stringify(this.cache()));
        const result = await access.request<{ settings: Settings; snapshot: string; deleted: Deletion[] }>('/diary/settings', {
          method: 'PUT', body: JSON.stringify({ syncEnabled: enabled, expectedRevision: this.settings.revision, expectedSnapshot: this.snapshot }) });
        this.check(access); this.acceptDeletions(result.deleted); this.persistDeletions(); this.acceptSettings(result, true);
      }
      if (enabled) await this.uploadLocal(access);
      return this.listNow(access);
    });
  }
  private async uploadLocal(access:Access) {
    for (const row of this.cache().filter(entry => entry.localOnly)) {
      this.check(access);
      const id = row.uploadId ?? crypto.randomUUID();
      const existing = this.cache().find(entry => entry.id === id && !entry.localOnly);
      if (!existing) {
        this.storage.setItem(`${this.prefix}cache`, JSON.stringify(this.cache().map(entry => entry.id === row.id ? { ...entry, uploadId: id } : entry)));
        const original = validateDiaryNote(await access.open(row, this.scope(row.id)));
        const note = { ...original, id };
        await this.saveNow(note, { note, revision: 0, draftKey: `${this.prefix}draft:upload:${id}` },access);
      } else {
        const original = validateDiaryNote(await access.open(row, this.scope(row.id)));
        const acknowledged = validateDiaryNote(await access.open(existing, this.scope(id)));
        if (sameContent({ ...original, id }, acknowledged)) this.storage.removeItem(`${this.prefix}draft:upload:${id}`);
      }
      this.storage.setItem(`${this.prefix}cache`, JSON.stringify(this.cache().filter(entry => entry.id !== row.id)));
    }
  }
  private discardDraftNow(key:string,access:Access) { this.check(access); if (!key.startsWith(`${this.prefix}draft:`)) throw new Error('DIARY_INVALID_DRAFT'); this.storage.removeItem(key); }
  async discardDraft(key: string) { return this.enqueue(async access=>{this.discardDraftNow(key,access);}); }
  async discardOwnDraft(id: string) { const key = `${this.prefix}draft:${this.writer}:${id}`; await this.discardDraft(key); return key; }
  async discardEditorDraft(id: string, draftKey?: string) {
    const keys = [draftKey, `${this.prefix}draft:${this.writer}:${id}`].filter((key): key is string => Boolean(key));
    return this.enqueue(async access=>{for(const key of keys)this.discardDraftNow(key,access);return keys;});
  }
  async setDreamTodayMode(todayMode: DreamSettings['todayMode']) {
    return this.enqueue(async access=>{
      this.check(access);
      const result = await access.request<{dreamSettings: DreamSettings}>('/diary/dream-settings', {
        method: 'PUT', body: JSON.stringify({todayMode, expectedRevision: this.dreamSettings.revision}) });
      this.check(access); this.acceptSettings(result);
    });
  }
  async dreamToday(timeZone: string, signal?: AbortSignal) {
    return this.run(async access=>{
      this.check(access); const result = await access.request<{today:string;timeZone:string}>(`/diary/dream-clock?timeZone=${encodeURIComponent(timeZone)}`, {signal});
      this.check(access); if (!validDreamDay(result.today) || result.timeZone !== timeZone) throw new Error('DREAM_CLOCK_INVALID'); return result.today;
    });
  }
  async authorizeDreamVoice() { return this.run(async access=>{await access.request('/diary/dream-voice');this.check(access);}); }
}
