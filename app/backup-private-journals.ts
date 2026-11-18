import {EncryptedPendingJournal} from './encrypted-pending-journal';
import {canonicalHabitBackup} from './habit-backup';
import type {BackupPayload} from './backup-format';

export type BackupJournalCopy={key:string;document:unknown;base:unknown;expectedRevision:number};
export type BackupJournalData={journalVersion:1;pendingCopies:BackupJournalCopy[];cached:{document:unknown;revision:number}|null;document?:unknown;frozenStorage?:unknown};

/** Recover every writer, including superseded immutable request snapshots. A
 * backup remains exportable with conflicting branches; restore must ask for a
 * choice rather than silently selecting the first/last writer's document. */
export function selectBackupJournalDocument(id:'aurora'|'stoicheion',owner:string,data:BackupJournalData):unknown {
  if(data.journalVersion!==1||!Array.isArray(data.pendingCopies)||data.pendingCopies.length>1024)throw new Error('BACKUP_LOCAL_CACHE_INVALID');
  const legacyKey=`genesis-${id}-workspace-v1:${owner}:pending`,rows=new Map<string,string>();
  for(const copy of data.pendingCopies){
    if(!copy||typeof copy.key!=='string'||!(copy.key===legacyKey||copy.key.startsWith(legacyKey+':writer:'))||rows.has(copy.key)
      ||!Number.isSafeInteger(copy.expectedRevision)||copy.expectedRevision<0||copy.expectedRevision>=Number.MAX_SAFE_INTEGER
      ||!copy.document||!copy.base)throw new Error('BACKUP_LOCAL_CACHE_INVALID');
    rows.set(copy.key,JSON.stringify(copy));
  }
  const storage={get length(){return rows.size;},key:(i:number)=>[...rows.keys()][i]??null,getItem:(key:string)=>rows.get(key)??null,
    setItem:()=>{throw new Error('BACKUP_LOCAL_CACHE_INVALID');},removeItem:()=>{throw new Error('BACKUP_LOCAL_CACHE_INVALID');}};
  const heads=new EncryptedPendingJournal(legacyKey).read(storage).map(branch=>JSON.parse(branch.head.raw) as BackupJournalCopy);
  if(heads.length){
    const first=heads[0].document;
    if(heads.some(head=>canonicalHabitBackup(head.document)!==canonicalHabitBackup(first)))throw new Error('BACKUP_DRAFT_CHOICE_REQUIRED');
    return first;
  }
  if(!data.cached||!Number.isSafeInteger(data.cached.revision)||data.cached.revision<1||!data.cached.document)throw new Error('BACKUP_LOCAL_CACHE_INVALID');
  return data.cached.document;
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
