import { loadSharedProject, loadSharedTask, approveSharedTask, moveSharedTask, type SharedCalendarTask } from "./cloud-sync";

export async function completeCalendarSharedTask(task: SharedCalendarTask, userId: string | undefined, english: boolean) {
  const [context, current] = await Promise.all([loadSharedProject(task.projectId), loadSharedTask(task.projectId, task.id)]);
  if (!current) throw new Error(english ? "Task unavailable." : "Задача недоступна.");
  if (current.approvalRequired) {
    if (!current.approvals?.some(item => item.userId === userId)) throw new Error(english ? "Completion requires confirmation from the selected participants." : "Выполнение должны подтвердить выбранные участники.");
    return Boolean((await approveSharedTask(task.projectId, task.id)).completedAt);
  }
  const status = context.statuses.find(item => item.isDone);
  if (!status) throw new Error(english ? "Add a completion board first." : "Сначала добавьте доску для выполненных задач.");
  const changed = await moveSharedTask(task.projectId, task.id, { destinationProjectId: task.projectId, statusId: status.id, expectedRevision: current.revision, position: context.taskPage?.statusCounts[status.id] ?? context.tasks.filter(item => item.statusId === status.id).length });
  if(changed.pending)throw new Error(english ? "Completion is saved on this device and waiting for the connection." : "Завершение сохранено на устройстве и ожидает подключения к сети.");
  return Boolean(changed.completedAt);
}
