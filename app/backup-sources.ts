import { BACKUP_MODULES, type BackupModuleId } from './backup-format.ts';
import { assertTechnical } from './e2ee/keys.ts';
import { capturePrivateLocalValues } from './e2ee/local-work-values.ts';
type Source = { owner: string; capture: () => unknown; captureMigration?: () => unknown };
const sources = new Map<BackupModuleId, Source>();
const mountedSources = new Map<string, {moduleId: BackupModuleId; source: Source}>();
let mountedRevision = 0;
/** Sources must capture synchronously; capture never initiates network I/O. */
export function registerBackupSource(id: BackupModuleId, source: Source): () => void {
  assertTechnical(source.owner);
  if (!BACKUP_MODULES.includes(id) || mountedSources.size >= 1000) throw new Error('E2EE_SOURCE_TOO_LARGE');
  const registration = crypto.randomUUID();
  sources.set(id, source);mountedSources.set(registration, {moduleId:id, source});mountedRevision++;
  return () => {
    if (mountedSources.delete(registration)) mountedRevision++;
    if (sources.get(id) === source) {
      sources.delete(id);
      for (const row of mountedSources.values()) if (row.moduleId === id) sources.set(id, row.source);
    }
  };
}
/** Migration cannot assume that the last mounted instance is the only editor.
 * Capture every live registration, including another diary/map window. Unknown
 * backup-shaped values stay protected original input until a typed adapter
 * validates them; they cannot be mistaken for an empty/complete category. */
export function captureAllBackupSources(owner:string){
 assertTechnical(owner);
 const revision=mountedRevision,captured:{sourceId:string;moduleId:BackupModuleId;format:'migration'|'backup';value:unknown}[]=[];
 for(const [sourceId,{moduleId,source}]of mountedSources)if(source.owner===owner){
  const capture=source.captureMigration??source.capture;captured.push({sourceId,moduleId,format:source.captureMigration?'migration':'backup',value:structuredClone(capture())});
 }
 if(revision!==mountedRevision)throw new Error('E2EE_SOURCE_CAPTURE_CHANGED');return{ownerId:owner,revision,sources:captured};
}
export function backupSourceRegistrationRevision(){return mountedRevision;}
/** Materialize selected files/bytes and reject unsupported values before JSON
 * persistence. A Map, Date or exotic object must never quietly become {}.
 * Capture the same sources again after asynchronous file reads: a moving form
 * or a newly mounted editor invalidates this attempt, preserving the originals. */
export async function captureMountedBackupMigrationSources(owner:string,assertCurrent:()=>void){
  assertCurrent();const before=captureAllBackupSources(owner);
  const value=await capturePrivateLocalValues(before,assertCurrent);assertCurrent();
  const after=await capturePrivateLocalValues(captureAllBackupSources(owner),assertCurrent);assertCurrent();
  if(before.revision!==mountedRevision||JSON.stringify(value)!==JSON.stringify(after))throw new Error('E2EE_SOURCE_CAPTURE_CHANGED');
  return value;
}
export function captureBackupSources(owner: string): Partial<Record<BackupModuleId, unknown>> {
  const result: Partial<Record<BackupModuleId, unknown>> = {};
  for (const [id, source] of sources) if (source.owner === owner) result[id] = structuredClone(source.capture());
  return result;
}
