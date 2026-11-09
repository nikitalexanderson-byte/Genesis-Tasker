import type { SharedProjectSnapshot, SharedStatus, SharedTask } from "./cloud-sync";

/** Open and completed inbox statuses are intentionally absent from the board list. */
export function isSharedInboxTask(task: Pick<SharedTask, "statusId">, statuses: Pick<SharedStatus, "id">[]): boolean {
  return !statuses.some(status => status.id === task.statusId);
}

/** The server removes the moving row before inserting into its destination status. */
export function sharedTaskDropPosition(snapshot: SharedProjectSnapshot, moving: SharedTask, statusId: string,
  hoveredId?: string, after = false, unfiltered = false): number {
  const belongs = (task: SharedTask) => statusId ? task.statusId === statusId
    : isSharedInboxTask(task, snapshot.statuses) && Boolean(task.completedAt) === Boolean(moving.completedAt);
  const rows = snapshot.tasks.filter(belongs).sort((a, b) => a.position - b.position || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
  const sourceIncluded = rows.some(task => task.id === moving.id);
  if (sourceIncluded && hoveredId === moving.id) return moving.position;
  const otherRows = rows.filter(task => task.id !== moving.id);
  const actualStatusId = statusId || `chaos-${moving.completedAt ? "done" : "open"}:${snapshot.project.id}`;
  const total = snapshot.taskPage?.statusCounts[actualStatusId] ?? (snapshot.taskPage?.hasMore ? undefined : rows.length);
  const complete = unfiltered && total === rows.length;
  const index = otherRows.findIndex(task => task.id === hoveredId);
  // The move endpoint clamps an append index to the actual group length, including unloaded rows.
  if (index < 0) return complete ? otherRows.length : Number.MAX_SAFE_INTEGER;
  // Only an unfiltered complete group can compact gaps. Other queries retain server positions.
  const position = complete ? index
    : otherRows[index].position - Number(sourceIncluded && moving.position < otherRows[index].position);
  return Math.max(0, position + Number(after));
}
