import {assertTechnical} from './keys.ts';
import {captureBackupMigrationEditors,type BackupMigrationCapture} from '../backup-migration-memory.ts';

export type WebArchiveInventory={platform:'web';inventoryVersion:1;entries:{key:string;value:string|null}[];
 memorySafety:unknown|null;editors:BackupMigrationCapture[]};
export function archiveWebStorageKeys(ownerId:string){assertTechnical(ownerId);return[
 `genesis-backup-history-v1:${ownerId}`,`genesis-data-generation-v1:${ownerId}`,`genesis-workspace-device-key-v2:${ownerId}`];}
/** Preserve ORIGINAL raw strings, including malformed/unknown nested formats.
 * Reconciliation parses them only AFTER the complete new-root protected capture.
 * This inventory has no restore, HTTP, entitlement, prune or activation port. */
export async function captureWebArchiveInventory(ownerId:string,ports:{storage:Pick<Storage,'getItem'|'key'|'length'>;
 memorySafety:()=>unknown|null;assertCurrent:()=>void}):Promise<WebArchiveInventory>{
 assertTechnical(ownerId);ports.assertCurrent();const storage=ports.storage;
 const entries=()=>{
  const names=new Set(archiveWebStorageKeys(ownerId)),prefixes=[`genesis-backup-safety-v1:${ownerId}:`,`genesis-backup-held-v1:${ownerId}:`];
  for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key&&prefixes.some(prefix=>key.startsWith(prefix)))names.add(key);
   if(names.size>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');}
  return[...names].sort().map(key=>({key,value:storage.getItem(key)}));
 };
 const captured=entries(),memorySafety=structuredClone(ports.memorySafety());
 const editors=await captureBackupMigrationEditors(ownerId,ports.assertCurrent);ports.assertCurrent();
 if(JSON.stringify(captured)!==JSON.stringify(entries())||JSON.stringify(memorySafety)!==JSON.stringify(ports.memorySafety()))throw new Error('E2EE_ARCHIVE_CAPTURE_CHANGED');
 const result:WebArchiveInventory={platform:'web',inventoryVersion:1,entries:captured,memorySafety,editors};
 const bytes=new TextEncoder().encode(JSON.stringify(result));try{if(bytes.length>48*1024*1024)throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}finally{bytes.fill(0);}
 ports.assertCurrent();return result;
}
