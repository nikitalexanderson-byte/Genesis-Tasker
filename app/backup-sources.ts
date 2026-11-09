import type { BackupModuleId } from './backup-format.ts';
type Source = { owner: string; capture: () => unknown };
const sources = new Map<BackupModuleId, Source>();
/** Sources must capture synchronously; capture never initiates network I/O. */
export function registerBackupSource(id: BackupModuleId, source: Source): () => void {
  sources.set(id, source); return () => { if (sources.get(id) === source) sources.delete(id); };
}
export function captureBackupSources(owner: string): Partial<Record<BackupModuleId, unknown>> {
  const result: Partial<Record<BackupModuleId, unknown>> = {};
  for (const [id, source] of sources) if (source.owner === owner) result[id] = structuredClone(source.capture());
  return result;
}
