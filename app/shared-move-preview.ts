import type { SharedProjectSnapshot, SharedTask } from './cloud-sync';

/** Preview only rows already authorized and loaded by this query; never inject into another query. */
export function sharedMovePreview(snapshot: SharedProjectSnapshot | null, previews: Readonly<Record<string, SharedTask>>): SharedProjectSnapshot | null {
  if (!snapshot || !snapshot.tasks.some(task => previews[task.id])) return snapshot;
  const counts = snapshot.taskPage ? { ...snapshot.taskPage.statusCounts } : null;
  let removed = 0;
  const tasks = snapshot.tasks.flatMap(task => {
    const next = previews[task.id];
    if (!next || (!task.pending && task.revision > next.revision)) return [task];
    if (counts) counts[task.statusId ?? ''] = Math.max(0, (counts[task.statusId ?? ''] ?? 0) - 1);
    if (next.projectId !== snapshot.project.id) { removed++; return []; }
    if (counts) counts[next.statusId ?? ''] = (counts[next.statusId ?? ''] ?? 0) + 1;
    return [next];
  });
  return { ...snapshot, tasks, ...(snapshot.taskPage && counts ? {
    taskPage: { ...snapshot.taskPage, total: Math.max(0, snapshot.taskPage.total - removed), statusCounts: counts },
  } : {}) };
}
