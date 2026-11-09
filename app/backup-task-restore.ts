import { backupDigest } from './backup-format';
import { normalizeTask, type GenesisTask } from './cloud-sync';

/** External task identities never become write targets when their content is recovered. */
export async function recoverBackupTasks(tasks: GenesisTask[], owner: string, backupId: string) {
  const ids = new Map<string, string>();
  const provenance = new Map<string, string>();
  for (const task of tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || typeof task.title !== 'string' || ids.has(task.id)) throw new Error('BACKUP_TASK_INVALID');
    const sourceId = task.restoredFrom?.sourceId ?? `${task.createdIn ?? 'genesis'}:${task.googleAccountId ?? owner}:${task.googleTaskListId ?? ''}:${task.googleTaskId ?? task.id}`;
    ids.set(task.id, `restored-${(await backupDigest(`${owner}:${sourceId}`)).slice(0, 32)}`);
    provenance.set(task.id, sourceId);
  }
  const reference = async (id: string) => {
    if (ids.has(id)) return ids.get(id)!;
    // Missing archive members remain unresolved, isolated from a live external series.
    const value = /^restored-(?:ref-)?[a-f0-9]{32}$/.test(id) ? id : `restored-ref-${(await backupDigest(`${owner}:unresolved:${id}`)).slice(0, 32)}`;
    ids.set(id, value);
    return value;
  };
  const recovered: GenesisTask[] = [];
  const targets = new Map<string, string>();
  const comparable = (value: unknown): unknown => Array.isArray(value) ? value.map(comparable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,comparable(item)])) : value;
  for (const task of tasks) {
    const normalized = normalizeTask(task);
    if (!Array.isArray(normalized.dependsOnIds) || normalized.dependsOnIds.some(id => typeof id !== 'string')) throw new Error('BACKUP_TASK_INVALID');
    const value: GenesisTask = { ...normalized, id: ids.get(task.id)!,
      dependsOnIds: await Promise.all(normalized.dependsOnIds.map(reference)),
      recurrenceSeriesId: normalized.recurrenceSeriesId ? await reference(normalized.recurrenceSeriesId) : null,
      createdIn: 'genesis', syncToGoogle: false, syncAccountIds: [], googleLinks: {},
      googleAccountId: null, googleAccountEmail: '', googleEventId: null, googleTaskId: null, googleTaskListId: null, googleTaskListTitle: '', googleReadOnly: false,
      restoredFrom: { ...task.restoredFrom, sourceId: provenance.get(task.id)!, accountId: task.restoredFrom?.accountId ?? task.googleAccountId,
        taskListId: task.restoredFrom?.taskListId ?? task.googleTaskListId, taskId: task.restoredFrom?.taskId ?? task.id, backupId },
    };
    const content: Record<string, unknown>={...value}; delete content.restoredRevision; delete content.restoredFrom; delete content.updatedAt;
    const canonical=JSON.stringify(comparable(content)), previous=targets.get(value.id);
    if(previous!==undefined){if(previous!==canonical)throw new Error('BACKUP_DRAFT_CHOICE_REQUIRED');continue;}
    targets.set(value.id,canonical); recovered.push(value);
  }
  return { tasks: recovered, reference };
}
