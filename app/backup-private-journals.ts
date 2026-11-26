import {EncryptedPendingJournal} from './encrypted-pending-journal';
import {canonicalHabitBackup} from './habit-backup';
import type {BackupPayload} from './backup-format';
import {backupDigest} from './backup-format';

export type BackupJournalCopy={key:string;document:unknown;base:unknown;expectedRevision:number};
export type BackupJournalData={journalVersion:1;pendingCopies:BackupJournalCopy[];cached:{document:unknown;revision:number}|null;document?:unknown;frozenStorage?:unknown};
type JournalId='aurora'|'stoicheion';
export type BackupJournalChoice={sourceHash:string;variantHash:string};
export type BackupJournalChoices=Partial<Record<JournalId,BackupJournalChoice>>;
export type BackupJournalConflict={section:JournalId;sourceHash:string;variants:{hash:string;document:unknown;latest:boolean}[]};

/** Recover every writer, including superseded immutable request snapshots. A
 * backup remains exportable with conflicting branches; restore must ask for a
 * choice rather than silently selecting the first/last writer's document. */
function journalHeads(id:JournalId,owner:string,data:BackupJournalData):BackupJournalCopy[] {
  if(data.journalVersion!==1||!Array.isArray(data.pendingCopies)||data.pendingCopies.length>1024
    ||data.cached!==null&&(!data.cached||!Number.isSafeInteger(data.cached.revision)||data.cached.revision<1||!data.cached.document))throw new Error('BACKUP_LOCAL_CACHE_INVALID');
  const legacyKey=`genesis-${id}-workspace-v1:${owner}:pending`,rows=new Map<string,string>();
  for(const copy of data.pendingCopies){
    if(!copy||typeof copy.key!=='string'||!(copy.key===legacyKey||copy.key.startsWith(legacyKey+':writer:'))||rows.has(copy.key)
      ||!Number.isSafeInteger(copy.expectedRevision)||copy.expectedRevision<0||copy.expectedRevision>=Number.MAX_SAFE_INTEGER
      ||!copy.document||!copy.base)throw new Error('BACKUP_LOCAL_CACHE_INVALID');
    rows.set(copy.key,JSON.stringify(copy));
  }
  const storage={get length(){return rows.size;},key:(i:number)=>[...rows.keys()][i]??null,getItem:(key:string)=>rows.get(key)??null,
    setItem:()=>{throw new Error('BACKUP_LOCAL_CACHE_INVALID');},removeItem:()=>{throw new Error('BACKUP_LOCAL_CACHE_INVALID');}};
  return new EncryptedPendingJournal(legacyKey).read(storage).map(branch=>JSON.parse(branch.head.raw) as BackupJournalCopy);
}
export function selectBackupJournalDocument(id:JournalId,owner:string,data:BackupJournalData):unknown {
  const heads=journalHeads(id,owner,data);
  if(heads.length){
    const first=heads[0].document;
    if(heads.some(head=>canonicalHabitBackup(head.document)!==canonicalHabitBackup(first)))throw new Error('BACKUP_DRAFT_CHOICE_REQUIRED');
    return first;
  }
  if(!data.cached||!Number.isSafeInteger(data.cached.revision)||data.cached.revision<1||!data.cached.document)throw new Error('BACKUP_LOCAL_CACHE_INVALID');
  return data.cached.document;
}
async function journalVariants(id:JournalId,owner:string,data:BackupJournalData):Promise<BackupJournalConflict> {
  data=structuredClone(data);
  const heads=journalHeads(id,owner,data),latest=new Set(heads.map(copy=>canonicalHabitBackup(copy.document)));
  const copies=[...heads,...data.pendingCopies.slice().sort((a,b)=>a.key.localeCompare(b.key,'en'))];
  if(data.cached){
    if(!Number.isSafeInteger(data.cached.revision)||data.cached.revision<1||!data.cached.document)throw new Error('BACKUP_LOCAL_CACHE_INVALID');
    copies.push({key:'cache',document:data.cached.document,base:data.cached.document,expectedRevision:data.cached.revision});
  }
  const variants=new Map<string,{hash:string;document:unknown;latest:boolean}>();
  for(const copy of copies){const canonical=canonicalHabitBackup(copy.document);if(!variants.has(canonical))variants.set(canonical,{hash:await backupDigest(canonical),document:copy.document,latest:latest.has(canonical)});}
  const sourceHash=await backupDigest(canonicalHabitBackup({id,owner,pendingCopies:data.pendingCopies.slice().sort((a,b)=>a.key.localeCompare(b.key,'en')),cached:data.cached}));
  return{section:id,sourceHash,variants:[...variants.values()]};
}
/** Choices are supplied separately by this device's UI, never accepted from an
 * archive's suggested `document` or a persisted decision field. Every use is
 * rebound to all exact source copies and the selected document's digest. */
export async function resolveBackupJournalDocument(id:JournalId,owner:string,data:BackupJournalData,choice?:BackupJournalChoice):Promise<unknown> {
  if(!choice)return selectBackupJournalDocument(id,owner,data);
  const group=await journalVariants(id,owner,data);
  if(choice.sourceHash!==group.sourceHash)throw new Error('BACKUP_PREVIEW_CHANGED');
  const variant=group.variants.find(row=>row.hash===choice.variantHash);if(!variant)throw new Error('BACKUP_DRAFT_CHOICE_REQUIRED');
  return structuredClone(variant.document);
}
export async function backupJournalConflicts(payload:BackupPayload):Promise<BackupJournalConflict[]> {
  const groups:BackupJournalConflict[]=[];
  for(const section of payload.sections){
    if(section.id!=='aurora'&&section.id!=='stoicheion'||section.completeness==='unavailable')continue;
    const data=section.data as BackupJournalData|null;if(!data||!('journalVersion' in data))continue;
    try{selectBackupJournalDocument(section.id,payload.ownerId,data);}
    catch(error){if(!(error instanceof Error)||error.message!=='BACKUP_DRAFT_CHOICE_REQUIRED')throw error;groups.push(await journalVariants(section.id,payload.ownerId,data));}
  }
  return groups;
}
export function materializeBackupJournalChoices(payload:BackupPayload):BackupPayload {
  for(const section of payload.sections){
    if(section.id!=='aurora'&&section.id!=='stoicheion')continue;
    const data=section.data as BackupJournalData|null;if(!data||!('journalVersion' in data))continue;
    try{data.document=selectBackupJournalDocument(section.id,payload.ownerId,data);}
    catch(error){if(!(error instanceof Error)||error.message!=='BACKUP_DRAFT_CHOICE_REQUIRED')throw error;data.document=null;}
  }
  return payload;
}
