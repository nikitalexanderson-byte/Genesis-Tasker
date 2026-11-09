import type { SharedStatus, SharedTask } from "./cloud-sync";

export function boardDisplay(status: SharedStatus) {
  return { titleLines: status.taskTitleLines ?? (status.isDone ? 2 : 0),
    visibleCount: status.visibleTaskCount ?? (status.isDone ? 5 : 0) };
}

export function boardTaskGroups(tasks: SharedTask[], status: SharedStatus) {
  const rows = tasks.filter(task => task.statusId === status.id);
  const { visibleCount } = boardDisplay(status);
  if (!visibleCount || rows.length <= visibleCount) return { recent: rows, older: [] };
  const latest = [...rows].sort((a, b) => {
    const time = (task: SharedTask) => Date.parse((status.isDone ? task.completedAt : null) || task.updatedAt) || 0;
    return time(b) - time(a) || b.position - a.position || a.id.localeCompare(b.id);
  });
  return { recent: latest.slice(0, visibleCount), older: latest.slice(visibleCount) };
}
