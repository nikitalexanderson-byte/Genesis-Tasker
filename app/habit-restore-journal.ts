import { privateDeviceAccessBlocked } from "./local-sign-out.ts";
import type { DraftCipher } from "./shared-work-draft-journal.ts";
import type { HabitRestoreChoice } from "./habit-backup-restore.ts";

const databaseName = "genesis-habit-restore-v1";
let generation = 0;
export type HabitRestoreDeviceDraft = { version: 1; filename: string; text: string; fingerprint: string;
  choices: Record<string, HabitRestoreChoice>; phase: "review" | "applying" };
export type HabitRestoreEnvelope = { scope: string; id: string; at: string; iv: string; ciphertext: string };
type Envelope = HabitRestoreEnvelope;
export class HabitRestoreJournalError extends Error {
  constructor(readonly record: HabitRestoreEnvelope, options?: ErrorOptions) { super("HABIT_RESTORE_DRAFT_INVALID", options); }
}
export type HabitRestoreDraftRecord = { id: string; at: string; value: HabitRestoreDeviceDraft; raw: Envelope };
export type HabitRestoreDraftStore = { list: (scope: string) => Promise<Envelope[]>;
  put: (row: Envelope, previous: Envelope | null) => Promise<void>; remove: (row: Envelope) => Promise<void> };
const fail = (code: string): never => { throw Error(code); };
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
export function validateHabitRestoreDeviceDraft(input: unknown): HabitRestoreDeviceDraft {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("HABIT_RESTORE_DRAFT_INVALID");
  const row = input as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== ["version", "filename", "text", "fingerprint", "choices", "phase"].sort().join()
    || row.version !== 1 || typeof row.filename !== "string" || row.filename.length > 250 || typeof row.text !== "string"
    || new TextEncoder().encode(row.text).length > 64 * 1024 * 1024 || typeof row.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(row.fingerprint)
    || !["review", "applying"].includes(String(row.phase)) || !row.choices || typeof row.choices !== "object" || Array.isArray(row.choices)
    || Object.entries(row.choices).some(([id, choice]) => !id || id.length > 1024 || ["__proto__", "constructor", "prototype"].includes(id) || !["keep", "copy"].includes(choice)))
    return fail("HABIT_RESTORE_DRAFT_INVALID");
  return structuredClone(row) as HabitRestoreDeviceDraft;
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("entries", { keyPath: ["scope", "id"] }).createIndex("scope", "scope"); request.result.createObjectStore("keys"); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(Error("HABIT_RESTORE_STORAGE_UNAVAILABLE"));
    request.onblocked = () => { blocked = true; reject(Error("HABIT_RESTORE_STORAGE_UNAVAILABLE")); };
  });
}
async function transaction<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void, abort: (error: Error) => void) => void): Promise<T> {
  const epoch = generation;
  if (privateDeviceAccessBlocked()) fail("HABIT_RESTORE_STORAGE_UNAVAILABLE");
  const db = await openDatabase();
  if (epoch !== generation || privateDeviceAccessBlocked()) { db.close(); return fail("HABIT_RESTORE_STORAGE_UNAVAILABLE"); }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode); let value: T; let reason: Error | undefined;
    try { run(tx.objectStore(store), result => { value = result; }, error => { reason = error; tx.abort(); }); } catch (error) { tx.abort(); db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = tx.onerror = () => { db.close(); reject(reason ?? tx.error ?? Error("HABIT_RESTORE_STORAGE_UNAVAILABLE")); };
  });
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const habitRestoreIndexedStore: HabitRestoreDraftStore = {
  list: scope => transaction("entries", "readonly", (store, result) => { const read = store.index("scope").getAll(scope); read.onsuccess = () => result(read.result); }),
  put: (row, previous) => transaction("entries", "readwrite", (store, result, abort) => {
    const read = store.get([row.scope, row.id]); read.onsuccess = () => {
      if (!same(read.result ?? null, previous)) { abort(Error("HABIT_RESTORE_DRAFT_CHANGED")); return; }
      const count = store.index("scope").count(row.scope); count.onsuccess = () => {
        if (!read.result && count.result >= 20) { abort(Error("HABIT_RESTORE_DRAFT_LIMIT")); return; }
        try { store.put(row); result(undefined); }
        catch (reason) { abort(reason instanceof Error ? reason : Error("HABIT_RESTORE_STORAGE_UNAVAILABLE")); }
      };
    };
  }),
  remove: row => transaction("entries", "readwrite", (store, result, abort) => {
    const read = store.get([row.scope, row.id]); read.onsuccess = () => {
      if (read.result === undefined) { result(undefined); return; }
      if (!same(read.result, row)) { abort(Error("HABIT_RESTORE_DRAFT_CHANGED")); return; }
      store.delete([row.scope, row.id]); result(undefined);
    };
  }),
};

/** Independent encrypted records keep concurrent imports and large files out of localStorage. */
export class HabitRestoreJournal {
  readonly id = crypto.randomUUID();
  private epoch = generation;
  private serial: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private current: Envelope | null = null;
  constructor(private scope: string, private cipher: DraftCipher, private store: HabitRestoreDraftStore = habitRestoreIndexedStore) {
    if (!validId(scope)) fail("HABIT_RESTORE_DRAFT_INVALID");
  }
  private check() { if (this.stopped || this.epoch !== generation || privateDeviceAccessBlocked()) fail("HABIT_RESTORE_STORAGE_UNAVAILABLE"); this.cipher.check(); }
  private async read(raw: Envelope): Promise<HabitRestoreDraftRecord> {
    this.check();
    if (raw.scope !== this.scope || !validId(raw.id) || !Number.isFinite(Date.parse(raw.at)) || typeof raw.iv !== "string" || typeof raw.ciphertext !== "string") throw new HabitRestoreJournalError(raw);
    let value: HabitRestoreDeviceDraft;
    try { value = validateHabitRestoreDeviceDraft(await this.cipher.open(raw, `habit-restore:${raw.id}`)); }
    catch (cause) { this.check(); throw new HabitRestoreJournalError(raw, { cause }); }
    this.check(); return { id: raw.id, at: raw.at, value, raw };
  }
  async list(): Promise<HabitRestoreDraftRecord[]> {
    this.check(); const rows = await this.store.list(this.scope); if (rows.length > 20) fail("HABIT_RESTORE_DRAFT_LIMIT");
    const result: HabitRestoreDraftRecord[] = [];
    for (const row of rows) result.push(await this.read(row));
    this.check(); return result.sort((a, b) => b.at.localeCompare(a.at));
  }
  write(input: HabitRestoreDeviceDraft): Promise<HabitRestoreDraftRecord> {
    const snapshot = validateHabitRestoreDeviceDraft(input);
    const work = this.serial.catch(() => undefined).then(async () => {
      this.check(); if (!this.current && (await this.store.list(this.scope)).length >= 20) fail("HABIT_RESTORE_DRAFT_LIMIT");
      const sealed = await this.cipher.seal(snapshot, `habit-restore:${this.id}`); this.check();
      const raw = { scope: this.scope, id: this.id, at: new Date().toISOString(), ...sealed };
      await this.store.put(raw, this.current); this.current = raw; this.check();
      return { id: this.id, at: raw.at, value: snapshot, raw };
    }); this.serial = work; return work;
  }
  async remove(record: HabitRestoreDraftRecord) { await this.serial.catch(() => undefined); this.check(); await this.store.remove(record.raw); if (record.id === this.id) this.current = null; this.check(); }
  async discard(record: HabitRestoreEnvelope) {
    await this.serial.catch(() => undefined); this.check();
    if (record.scope !== this.scope || typeof record.id !== "string") fail("HABIT_RESTORE_DRAFT_INVALID");
    await this.store.remove(record); if (record.id === this.id) this.current = null; this.check();
  }
  dispose() { this.stopped = true; }
}

export async function localHabitRestoreCipher(): Promise<DraftCipher> {
  const epoch = generation; const check = () => { if (epoch !== generation || privateDeviceAccessBlocked()) fail("HABIT_RESTORE_STORAGE_UNAVAILABLE"); };
  check();
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const key = await transaction<CryptoKey>("keys", "readwrite", (store, result) => { const read = store.get("local"); read.onsuccess = () => {
    check(); if (!read.result) store.put(generated, "local"); result(read.result ?? generated);
  }; });
  check();
  const encode = (bytes: Uint8Array) => { let text = ""; for (let index = 0; index < bytes.length; index += 32768) text += String.fromCharCode(...bytes.subarray(index, index + 32768)); return btoa(text); };
  const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const aad = (scope: string) => new TextEncoder().encode(`genesis-habit-restore:local:${scope}`);
  return { check,
    async seal(value, scope) { check(); const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(scope) }, key, new TextEncoder().encode(JSON.stringify(value)));
      check(); return { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }; },
    async open(value, scope) { check(); const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(value.iv), additionalData: aad(scope) }, key, decode(value.ciphertext));
      check(); return JSON.parse(new TextDecoder().decode(bytes)); },
  };
}
export async function clearHabitRestoreJournal(): Promise<void> {
  generation++;
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(["entries", "keys"], "readwrite"); tx.objectStore("entries").clear(); tx.objectStore("keys").clear();
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(Error("HABIT_RESTORE_STORAGE_UNAVAILABLE")); }); }
  finally { db.close(); }
}
