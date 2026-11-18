import { personalDocumentAccess } from "./cloud-sync";
import { validateRestorationDocument, type RestorationDocument } from "./stoicheion-restoration-work";

type Sealed = { iv: string; ciphertext: string };
type Envelope = Sealed & { revision: number };
type Access = ReturnType<typeof personalDocumentAccess>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const empty = (): RestorationDocument => ({ version: 1, works: [], removed: [] });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Independent changes merge; two edits to the same practice require an explicit choice. */
export function mergeRestorationDocuments(base: RestorationDocument, local: RestorationDocument, remote: RestorationDocument): RestorationDocument {
  const byId = (doc: RestorationDocument) => new Map(doc.works.map(row => [row.id, row]));
  const before = byId(base), left = byId(local), right = byId(remote);
  const removed = [...new Map([...remote.removed, ...local.removed].map(row => [row.id, row])).values()];
  const deleted = new Set(removed.map(row => row.id));
  const works = [...new Set([...left.keys(), ...right.keys()])].flatMap(id => {
    if (deleted.has(id)) return [];
    const a = left.get(id), b = right.get(id), original = before.get(id);
    if (!same(a, original) && !same(b, original) && !same(a, b)) throw new Error("RESTORATION_REVISION_CONFLICT");
    const row = !same(a, original) ? a : b;
    return row ? [row] : [];
  });
  return validateRestorationDocument({ version: 1, works, removed });
}

/** The ordinary encrypted workspace is untouched, so older web/Android writers stay compatible. */
export class RestorationRepository {
  private access: Access;
  private key: string;
  private revision = 0;
  private base = empty();
  private serial: Promise<unknown> = Promise.resolve();
  conflict = false;
  constructor(userId: string, private storage: Storage, access?: Access) {
    this.access = access ?? personalDocumentAccess(userId);
    this.key = `genesis-stoicheion-workspace-v1:${userId}:pending`;
  }
  private enqueue<T>(work: (access: Access) => Promise<T>): Promise<T> {
    // Acquire only after the previous operation releases its permit. Nested
    // merge/recovery work uses this bound access, never this queue again.
    const operation = this.serial.catch(() => {}).then(() => this.access.withLegacyOperation(async access => {
      access.check(); const result = await work(access); access.check(); return result;
    }));
    this.serial = operation; return operation;
  }
  private async remote(access: Access) {
    const { document } = await access.request<{ document: Envelope | null }>("/stoicheion-workspace", { cache: "no-store" });
    const value = document ? validateRestorationDocument(await access.open(document, "stoicheion-workspace:v1")) : empty();
    access.check(); this.revision = document?.revision ?? 0; this.base = value;
    return structuredClone(value);
  }
  load(): Promise<RestorationDocument> { return this.enqueue(access => this.loadDocument(access)); }
  private async loadDocument(access: Access): Promise<RestorationDocument> {
    const remote = await this.remote(access);
    const raw = this.storage.getItem(this.key);
    if (!raw) return remote;
    const pending = JSON.parse(raw);
    const local = validateRestorationDocument(await access.open(pending.envelope, "stoicheion-workspace:v1"));
    const base = validateRestorationDocument(await access.open(pending.base, "stoicheion-pending-base:v1"));
    try { await this.send(pending.envelope, access); return structuredClone(this.base); }
    catch (error) {
      access.check();
      if (!(error instanceof Error) || !error.message.includes("RESTORATION_REVISION_CONFLICT")) throw error;
      try { return await this.saveDocument(mergeRestorationDocuments(base, local, remote), access); }
      catch (conflict) { this.conflict = true; throw conflict; }
    }
  }
  private async send(envelope: Sealed & { expectedRevision: number }, access: Access) {
    const result = await access.request<{ revision: number }>("/stoicheion-workspace", { method: "PUT", body: JSON.stringify(envelope) });
    access.check();
    if (!Number.isSafeInteger(result?.revision) || result.revision !== envelope.expectedRevision + 1) throw new Error('RESTORATION_INVALID_RESPONSE');
    const value = validateRestorationDocument(await access.open(envelope, "stoicheion-workspace:v1"));
    access.check(); this.revision = result.revision; this.base = value;
    // Another tab can persist newer unsent work while this request is in flight.
    // Acknowledging these bytes must never acknowledge that different envelope.
    const raw = this.storage.getItem(this.key), pending = raw ? JSON.parse(raw) : null;
    if (pending?.envelope?.iv === envelope.iv && pending.envelope.ciphertext === envelope.ciphertext
      && pending.envelope.expectedRevision === envelope.expectedRevision) this.storage.removeItem(this.key);
    this.conflict = false;
  }
  save(input: RestorationDocument): Promise<RestorationDocument> {
    const value = validateRestorationDocument(structuredClone(input));
    return this.enqueue(access => this.saveDocument(value, access));
  }
  private async saveDocument(value: RestorationDocument, access: Access): Promise<RestorationDocument> {
      access.check();
      const envelope = { ...await access.seal(value, "stoicheion-workspace:v1"), expectedRevision: this.revision };
      const base = await access.seal(this.base, "stoicheion-pending-base:v1");
      access.check(); this.storage.setItem(this.key, JSON.stringify({ envelope, base }));
      try { await this.send(envelope, access); }
      catch (error) {
        access.check();
        if (!(error instanceof Error) || !error.message.includes("RESTORATION_REVISION_CONFLICT")) throw error;
        const previous = this.base, remote = await this.remote(access);
        let merged: RestorationDocument;
        try { merged = mergeRestorationDocuments(previous, value, remote); }
        catch (conflict) { this.conflict = true; throw conflict; }
        const retry = { ...await access.seal(merged, "stoicheion-workspace:v1"), expectedRevision: this.revision };
        const retryBase = await access.seal(remote, "stoicheion-pending-base:v1");
        access.check(); this.storage.setItem(this.key, JSON.stringify({ envelope: retry, base: retryBase }));
        await this.send(retry, access);
      }
      return structuredClone(this.base);
  }
  /** Only a deliberate user choice may supersede a concurrent version. */
  keepPending(): Promise<RestorationDocument> { return this.enqueue(access => this.keepDocument(access)); }
  private async keepDocument(access: Access): Promise<RestorationDocument> {
    const raw = this.storage.getItem(this.key);
    if (!raw) return this.loadDocument(access);
    const pending = JSON.parse(raw);
    const value = validateRestorationDocument(await access.open(pending.envelope, "stoicheion-workspace:v1"));
    const remote = await this.remote(access);
    const ids = new Set(value.works.map(row => row.id));
    return this.saveDocument({ ...value, works: [...remote.works.filter(row => !ids.has(row.id)), ...value.works],
      removed: [...new Map([...remote.removed, ...value.removed].map(row => [row.id, row])).values()] }, access);
  }
}
