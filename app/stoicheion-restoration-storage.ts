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
  private async remote() {
    const { document } = await this.access.request<{ document: Envelope | null }>("/stoicheion-workspace", { cache: "no-store" });
    const value = document ? validateRestorationDocument(await this.access.open(document, "stoicheion-workspace:v1")) : empty();
    this.access.check(); this.revision = document?.revision ?? 0; this.base = value;
    return structuredClone(value);
  }
  async load(): Promise<RestorationDocument> {
    const remote = await this.remote();
    const raw = this.storage.getItem(this.key);
    if (!raw) return remote;
    const pending = JSON.parse(raw);
    const local = validateRestorationDocument(await this.access.open(pending.envelope, "stoicheion-workspace:v1"));
    const base = validateRestorationDocument(await this.access.open(pending.base, "stoicheion-pending-base:v1"));
    try { await this.send(pending.envelope); return structuredClone(this.base); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes("RESTORATION_REVISION_CONFLICT")) throw error;
      try { return await this.save(mergeRestorationDocuments(base, local, remote)); }
      catch (conflict) { this.conflict = true; throw conflict; }
    }
  }
  private async send(envelope: Sealed & { expectedRevision: number }) {
    const result = await this.access.request<{ revision: number }>("/stoicheion-workspace", { method: "PUT", body: JSON.stringify(envelope) });
    this.access.check(); this.revision = result.revision;
    this.base = validateRestorationDocument(await this.access.open(envelope, "stoicheion-workspace:v1"));
    this.storage.removeItem(this.key); this.conflict = false;
  }
  save(input: RestorationDocument): Promise<RestorationDocument> {
    const value = validateRestorationDocument(structuredClone(input));
    const operation = this.serial.catch(() => undefined).then(async () => {
      this.access.check();
      const envelope = { ...await this.access.seal(value, "stoicheion-workspace:v1"), expectedRevision: this.revision };
      const base = await this.access.seal(this.base, "stoicheion-pending-base:v1");
      this.access.check(); this.storage.setItem(this.key, JSON.stringify({ envelope, base }));
      try { await this.send(envelope); }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes("RESTORATION_REVISION_CONFLICT")) throw error;
        const previous = this.base, remote = await this.remote();
        let merged: RestorationDocument;
        try { merged = mergeRestorationDocuments(previous, value, remote); }
        catch (conflict) { this.conflict = true; throw conflict; }
        const retry = { ...await this.access.seal(merged, "stoicheion-workspace:v1"), expectedRevision: this.revision };
        this.storage.setItem(this.key, JSON.stringify({ envelope: retry, base: await this.access.seal(remote, "stoicheion-pending-base:v1") }));
        await this.send(retry);
      }
      return structuredClone(this.base);
    });
    this.serial = operation; return operation;
  }
  /** Only a deliberate user choice may supersede a concurrent version. */
  async keepPending(): Promise<RestorationDocument> {
    const raw = this.storage.getItem(this.key);
    if (!raw) return this.load();
    const pending = JSON.parse(raw);
    const value = validateRestorationDocument(await this.access.open(pending.envelope, "stoicheion-workspace:v1"));
    const remote = await this.remote();
    const ids = new Set(value.works.map(row => row.id));
    return this.save({ ...value, works: [...remote.works.filter(row => !ids.has(row.id)), ...value.works],
      removed: [...new Map([...remote.removed, ...value.removed].map(row => [row.id, row])).values()] });
  }
}
