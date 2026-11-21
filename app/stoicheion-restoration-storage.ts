import { personalDocumentAccess,usesPrivateProductStorage } from "./cloud-sync";
import {E2eeFeatureDocument} from './e2ee/feature-document';
import {exactKeys} from './e2ee/keys';
import { validateRestorationDocument, type RestorationDocument } from "./stoicheion-restoration-work";
import { EncryptedPendingJournal, type EncryptedJournalBranch, type EncryptedJournalStorage } from "./encrypted-pending-journal";

type Sealed = { iv: string; ciphertext: string };
type Envelope = Sealed & { revision: number };
type Access = ReturnType<typeof personalDocumentAccess>;
type Storage = EncryptedJournalStorage;
const empty = (): RestorationDocument => ({ version: 1, works: [], removed: [] });
import { mergeRestorationDocuments } from "./stoicheion-restoration-merge";
export { mergeRestorationDocuments } from "./stoicheion-restoration-merge";

/** The ordinary encrypted workspace is untouched, so older web/Android writers stay compatible. */
export class RestorationRepository {
  private product:E2eeFeatureDocument<RestorationDocument>;
  private ownerId:string;
  private access: Access;
  private journal: EncryptedPendingJournal;
  private conflictBranch: EncryptedJournalBranch | null = null;
  private revision = 0;
  private base = empty();
  private serial: Promise<unknown> = Promise.resolve();
  conflict = false;
  constructor(userId: string, private storage: Storage, access?: Access) {
    this.ownerId=userId;
    this.product=new E2eeFeatureDocument({ownerId:userId,domain:'stoicheion',objectId:'personal-stoicheion-live-v1',validate:validateRestorationDocument,
      seed:async read=>{const value=await read('personal-stoicheion-workspace-v1');exactKeys(value,['protocol','ownerId','document']);
        if(value.protocol!==1||value.ownerId!==userId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return validateRestorationDocument(value.document);}});
    this.access = access ?? personalDocumentAccess(userId);
    this.journal = new EncryptedPendingJournal(`genesis-stoicheion-workspace-v1:${userId}:pending`);
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
    if (document && (!Number.isSafeInteger(document.revision) || document.revision < 1)) throw new Error('RESTORATION_INVALID_RESPONSE');
    const value = document ? validateRestorationDocument(await access.open(document, "stoicheion-workspace:v1")) : empty();
    access.check(); this.revision = document?.revision ?? 0; this.base = value;
    return structuredClone(value);
  }
  load(): Promise<RestorationDocument> { if(usesPrivateProductStorage(this.ownerId))return this.loadPrivate();return this.enqueue(access => this.loadDocument(access)); }
  private async loadPrivate(){const view=await this.product.read();this.base=view.document;this.revision=view.remoteRevision;this.conflict=Boolean(view.conflict);
    if(view.conflict)throw new Error('RESTORATION_REVISION_CONFLICT');return structuredClone(view.document);}
  private async savePrivate(value:RestorationDocument){const view=await this.product.write(value);this.base=view.document;this.conflict=Boolean(view.conflict);
    if(view.conflict)throw new Error('RESTORATION_REVISION_CONFLICT');
    try{const saved=await this.product.flush();this.base=saved.document;this.revision=saved.remoteRevision;return structuredClone(saved.document);}
    catch(error){if(error instanceof Error&&/E2EE_(?:OBJECT_CONFLICT|PRODUCT_CONFLICT_REVIEW_REQUIRED)/.test(error.message)){await this.product.read();this.conflict=true;throw new Error('RESTORATION_REVISION_CONFLICT');}throw error;}}
  private pending(branch: EncryptedJournalBranch): {envelope:Sealed & {expectedRevision:number};base:Sealed} {
    const value = JSON.parse(branch.head.raw);
    if (!Number.isSafeInteger(value?.envelope?.expectedRevision) || value.envelope.expectedRevision < 0
      || value.envelope.expectedRevision >= Number.MAX_SAFE_INTEGER || !value.base) throw new Error('RESTORATION_INVALID_RESPONSE');
    return value;
  }
  private async loadDocument(access: Access): Promise<RestorationDocument> {
    const branches = this.journal.read(this.storage);
    await this.remote(access);
    for (const branch of branches) {
      const pending = this.pending(branch);
      const local = validateRestorationDocument(await access.open(pending.envelope, "stoicheion-workspace:v1"));
      const base = validateRestorationDocument(await access.open(pending.base, "stoicheion-pending-base:v1"));
      try { await this.send(pending.envelope, branch, access); }
      catch (error) {
        access.check();
        if (!(error instanceof Error) || !error.message.includes("RESTORATION_REVISION_CONFLICT")) throw error;
        try { await this.saveDocument(mergeRestorationDocuments(base, local, this.base), access, new EncryptedPendingJournal(this.journal.legacyKey)); this.journal.acknowledge(this.storage, branch); }
        catch (conflict) { this.conflictBranch = branch; this.conflict = true; throw conflict; }
      }
    }
    this.conflictBranch = null; return structuredClone(this.base);
  }
  private async send(envelope: Sealed & { expectedRevision: number }, branch: EncryptedJournalBranch, access: Access) {
    const result = await access.request<{ revision: number }>("/stoicheion-workspace", { method: "PUT", body: JSON.stringify(envelope) });
    access.check();
    if (!Number.isSafeInteger(result?.revision) || result.revision !== envelope.expectedRevision + 1) throw new Error('RESTORATION_INVALID_RESPONSE');
    const value = validateRestorationDocument(await access.open(envelope, "stoicheion-workspace:v1"));
    access.check(); if (result.revision >= this.revision) { this.revision = result.revision; this.base = value; }
    this.journal.acknowledge(this.storage, branch);
    this.conflict = false;
  }
  save(input: RestorationDocument): Promise<RestorationDocument> {
    const value = validateRestorationDocument(structuredClone(input));
    if(usesPrivateProductStorage(this.ownerId))return this.savePrivate(value);
    return this.enqueue(access => this.saveDocument(value, access));
  }
  private async saveDocument(value: RestorationDocument, access: Access, journal = this.journal): Promise<RestorationDocument> {
      access.check();
      const envelope = { ...await access.seal(value, "stoicheion-workspace:v1"), expectedRevision: this.revision };
      const base = await access.seal(this.base, "stoicheion-pending-base:v1");
      access.check(); const branch = journal.stage(this.storage, JSON.stringify({ envelope, base }));
      try { await this.send(envelope, branch, access); }
      catch (error) {
        access.check();
        if (!(error instanceof Error) || !error.message.includes("RESTORATION_REVISION_CONFLICT")) throw error;
        const previous = this.base, remote = await this.remote(access);
        let merged: RestorationDocument;
        try { merged = mergeRestorationDocuments(previous, value, remote); }
        catch (conflict) { this.conflictBranch = branch; this.conflict = true; throw conflict; }
        const retry = { ...await access.seal(merged, "stoicheion-workspace:v1"), expectedRevision: this.revision };
        const retryBase = await access.seal(remote, "stoicheion-pending-base:v1");
        access.check(); const retryBranch = journal.stage(this.storage, JSON.stringify({ envelope: retry, base: retryBase }));
        await this.send(retry, retryBranch, access);
      }
      return structuredClone(this.base);
  }
  /** Called synchronously while the product coordinator holds every writer
   * fence. Capture never drains or acknowledges the persistent journal. */
  captureMigrationState(current:RestorationDocument|null){
    this.access.check();return current===null?null:structuredClone({document:current,base:this.base,revision:this.revision});
  }
  /** Only a deliberate user choice may supersede a concurrent version. */
  keepPending(): Promise<RestorationDocument> { if(usesPrivateProductStorage(this.ownerId))return this.keepPrivate();return this.enqueue(access => this.keepDocument(access)); }
  private async keepPrivate(){const view=await this.product.read();if(!view.conflict)return this.loadPrivate();
    const local=view.document,remote=view.conflict.document,ids=new Set(local.works.map(row=>row.id));
    const value=validateRestorationDocument({...local,works:[...remote.works.filter(row=>!ids.has(row.id)),...local.works],removed:[...new Map([...remote.removed,...local.removed].map(row=>[row.id,row])).values()]});
    await this.product.resolve(value,view.conflict.revision);const saved=await this.product.flush();this.base=saved.document;this.revision=saved.remoteRevision;this.conflict=false;return structuredClone(saved.document);}
  private async keepDocument(access: Access): Promise<RestorationDocument> {
    const branches = this.journal.read(this.storage);
    const branch = branches.find(row => row.head.key === this.conflictBranch?.head.key) ?? branches[0];
    if (!branch) return this.loadDocument(access);
    const pending = this.pending(branch);
    const value = validateRestorationDocument(await access.open(pending.envelope, "stoicheion-workspace:v1"));
    const remote = await this.remote(access);
    const ids = new Set(value.works.map(row => row.id));
    await this.saveDocument({ ...value, works: [...remote.works.filter(row => !ids.has(row.id)), ...value.works],
      removed: [...new Map([...remote.removed, ...value.removed].map(row => [row.id, row])).values()] }, access, new EncryptedPendingJournal(this.journal.legacyKey));
    this.journal.acknowledge(this.storage, branch); this.conflictBranch = null;
    return this.loadDocument(access);
  }
}
