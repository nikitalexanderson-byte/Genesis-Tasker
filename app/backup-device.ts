import { BACKUP_MODULES, backupJson, type BackupPayload, type BackupSection } from './backup-format';
import { captureBackupSources } from './backup-sources';
import { captureBackupSyncState, personalDocumentAccess, backupRequest, openBackupWorkspace } from './cloud-sync';
export const BACKUP_NOTICE_VERSION = 'backup-3.2.2-v1';
const memorySafety = new Map<string, FrozenDevice>();
if (typeof window !== 'undefined') window.addEventListener('genesis-local-session-ended',()=>memorySafety.clear());
export type FrozenDevice = { owner: string; at: string; sources: ReturnType<typeof captureBackupSources>; sync: ReturnType<typeof captureBackupSyncState>; storage: Record<string, unknown> };
/** One JS turn, no awaits, no pull, no queue drain, no modification of any source. */
export function freezeBackupDevice(owner: string, storage: Storage = localStorage): FrozenDevice {
  const sources = captureBackupSources(owner), sync = captureBackupSyncState(owner);
  const prefixes = [`genesis-mindmaps:${owner}:`, `genesis-diary-v1:${owner}:`, `genesis-stoicheion-workspace-v1:${owner}:`, `genesis-aurora-workspace-v1:${owner}:`];
  const frozen: Record<string, unknown> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index); if (!key || !prefixes.some(prefix => key.startsWith(prefix))) continue;
    const raw = storage.getItem(key); if (raw !== null) frozen[key] = backupJson(raw);
  }
  // Fallback for a mounted account panel before the live workspace source registers.
  if (!sources.workspace) {
    const raw = storage.getItem(`genesis-calendar-v2:${owner}`);
    if (raw) sources.workspace = backupJson(raw);
  }
  return structuredClone({ owner, at:new Date().toISOString(), sources, sync, storage:frozen });
}
type Envelope = { id:string; revision?:number; expectedRevision?:number; iv:string; ciphertext:string; schemaVersion?:number };
export async function materializeDeviceBackup(frozen: FrozenDevice): Promise<BackupPayload> {
  const access = personalDocumentAccess(frozen.owner); access.check();
  const sections: BackupSection[] = BACKUP_MODULES.map(id => ({ id, source:'device', capturedAt:frozen.at, count:0, pending:0, revision:null, completeness:'unavailable', notices:[], data:null }));
  const section = (id: BackupSection['id']) => sections.find(row => row.id === id)!;
  const workspace = section('workspace');
  if (frozen.sources.workspace) Object.assign(workspace, { completeness:'partial', count:1, pending:frozen.sync.pending.length, revision:frozen.sync.version,
    data:{ document:frozen.sources.workspace, sync:frozen.sync }, notices:['DEVICE_GOOGLE_CACHE_ONLY','ATTACHMENTS_EMBEDDED_ONLY'] });
  for (const [id,prefix,scope] of [['mindmaps',`genesis-mindmaps:${frozen.owner}:`,'map:'],['diary',`genesis-diary-v1:${frozen.owner}:`,'diary-note:v1:']] as const) {
    const target = section(id); const records: unknown[] = [];
    const cached = frozen.storage[`${prefix}cache`] as Envelope[] | undefined;
    if (cached && !Array.isArray(cached)) throw new Error('BACKUP_LOCAL_CACHE_INVALID');
    for (const envelope of cached ?? []) records.push({ id:envelope.id, revision:envelope.revision ?? 0, schemaVersion:envelope.schemaVersion ?? 1,
      document:await access.open(envelope,scope+envelope.id), pending:false });
    for (const [key,raw] of Object.entries(frozen.storage)) if (key.startsWith(prefix+'draft:') || key.startsWith(prefix+'request:')) {
      const envelope = raw as Envelope, recordId = key.split(':').at(-1)!;
      records.push({ id:recordId, revision:envelope.expectedRevision ?? 0, schemaVersion:envelope.schemaVersion ?? 1,
        document:await access.open(envelope,scope+recordId), pending:true, operationId:key.slice(prefix.length) });
      target.pending++;
    }
    target.count=records.length;target.completeness=cached || records.length ? 'partial' : 'unavailable';
    target.notices=['DEVICE_CACHE_ONLY','HISTORY_MAY_BE_INCOMPLETE'];
    target.data={ records, deletions:frozen.storage[`${prefix}deleted`] ?? [], frozenStorage:Object.fromEntries(Object.entries(frozen.storage).filter(([key])=>key.startsWith(prefix))) };
  }
  for (const [id,prefix,scope] of [['stoicheion',`genesis-stoicheion-workspace-v1:${frozen.owner}:`,'stoicheion-workspace:v1'],['aurora',`genesis-aurora-workspace-v1:${frozen.owner}:`,'aurora-workspace:v1']] as const) {
    const target=section(id);const pending=frozen.storage[prefix+'pending'] as {envelope?:Envelope}|undefined;
    const envelope=pending?.envelope ?? frozen.storage[prefix+'cache'] as Envelope|undefined;
    if(envelope){ target.data={document:await access.open(envelope,scope),frozenStorage:Object.fromEntries(Object.entries(frozen.storage).filter(([key])=>key.startsWith(prefix)))};
      target.count=1;target.pending=pending?1:0;target.revision=envelope.expectedRevision??envelope.revision??0;target.completeness='partial'; }
  }
  const physis=section('physis');
  if(frozen.sources.physis){physis.data=frozen.sources.physis;physis.completeness='partial';const value=frozen.sources.physis as {records?:unknown[];pending?:unknown[]};physis.count=value.records?.length??0;physis.pending=value.pending?.length??0;}
  physis.notices=['PHYSIS_UNLOCK_REQUIRED','PHYSIS_RESTORE_SEPARATE'];
  section('shared-drafts').notices=['SHARED_EXPORT_SEPARATE','SHARED_INDEXEDDB_DRAFTS_NOT_INCLUDED'];
  return {schema:1,backupId:crypto.randomUUID(),source:'device_snapshot',ownerId:frozen.owner,createdAt:frozen.at,client:'web',sections,billingEvidence:null};
}
/** Encrypted internal safety copy is retained even when the entitlement service is unavailable. */
export async function retainBackupSafety(frozen: FrozenDevice, storage: Storage = localStorage) {
  memorySafety.set(frozen.owner,structuredClone(frozen));
  const access=personalDocumentAccess(frozen.owner);
  const prefix=`genesis-backup-safety-v1:${frozen.owner}:`;
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((key):key is string=>Boolean(key?.startsWith(prefix))).sort();
  const envelope=await access.seal(frozen,'backup-device-safety:v1');access.check();
  const key=prefix+frozen.at;
  try { storage.setItem(key,JSON.stringify({createdAt:frozen.at,expiresAt:Date.parse(frozen.at)+14*86400000,envelope})); }
  catch { return {persistent:false}; }
  // Only after a new copy was saved, keep the newest two. Never delete the sole good copy.
  for(const old of keys.slice(0,-1))storage.removeItem(old);
  return {persistent:true};
}
export async function authorizeBackup() { return backupRequest<{ownerId:string;generation:number}>('/authorize',{noticeVersion:BACKUP_NOTICE_VERSION}); }
export type ServerEvidence={payload:string;digest:string;kid:string;signature:string};
/** Server data stays a separate source. This does not refresh or overwrite the device snapshot. */
export async function materializeServerBackup(owner:string,evidence:ServerEvidence,adapter?:{
  access:Pick<ReturnType<typeof personalDocumentAccess>,'check'|'request'|'seal'|'open'>;openWorkspace:typeof openBackupWorkspace;
}):Promise<BackupPayload> {
  const value=backupJson(evidence.payload) as {ownerId:string;backupId:string;createdAt:string;tables:Record<string,Record<string,unknown>[]>};
  if(value.ownerId!==owner)throw new Error('BACKUP_OWNER');
  const access=adapter?.access??personalDocumentAccess(owner),sections:BackupSection[]=[];
  const add=(id:BackupSection['id'],data:unknown,count:number,revision:number|null=null)=>sections.push({id,source:'server',capturedAt:value.createdAt,count,pending:0,revision,completeness:'partial',notices:['SERVER_SYNCED_ONLY','EXTERNAL_DATA_NOT_FETCHED'],data});
  const workspace=value.tables.workspace_blobs[0];
  if(workspace)add('workspace',{document:await (adapter?.openWorkspace??openBackupWorkspace)(owner,workspace as unknown as Envelope),sync:{version:workspace.version,pending:[]}},1,Number(workspace.version));
  for(const [id,table,scope]of [['mindmaps','personal_mindmaps','map:'],['diary','personal_diary_notes','diary-note:v1:']]as const){
    const records=[];for(const row of value.tables[table])records.push({id:row.id,revision:row.revision,schemaVersion:row.schema_version,document:await access.open(row as unknown as Envelope,scope+row.id),pending:false});
    add(id,{records,history:value.tables[table==='personal_mindmaps'?'personal_mindmap_versions':'personal_diary_deletions']},records.length);
  }
  for(const [id,table,scope]of [['stoicheion','stoicheion_workspaces','stoicheion-workspace:v1'],['aurora','aurora_workspaces','aurora-workspace:v1']]as const){
    const row=value.tables[table][0];if(row)add(id,{document:await access.open(row as unknown as Envelope,scope)},1,Number(row.revision));
  }
  // Independently keyed Physis wire data remains recoverable through its existing recovery flow.
  add('physis',{wire:value.tables.physis_records,locked:true},value.tables.physis_records.length);
  return {schema:1,backupId:value.backupId,source:'server_snapshot',ownerId:owner,createdAt:value.createdAt,client:'web',sections,billingEvidence:null,serverEvidence:evidence};
}
