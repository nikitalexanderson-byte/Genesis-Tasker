export type TaskListOrder = "position" | "createdAt" | "createdAtAsc" | "dueDate" | "updatedAt" | "title";
export const taskListOrders: {value: TaskListOrder; ru: string; en: string}[] = [
  {value:"position",ru:"Обычный порядок",en:"Default order"},
  {value:"createdAt",ru:"Новые вверху",en:"Newest first"},
  {value:"createdAtAsc",ru:"Старые вверху",en:"Oldest first"},
  {value:"dueDate",ru:"Ближайший срок",en:"Due date"},
  {value:"updatedAt",ru:"Последние изменения",en:"Recently updated"},
  {value:"title",ru:"По названию",en:"Title"},
];
export function isTaskListOrder(value: unknown): value is TaskListOrder {
  return taskListOrders.some(item=>item.value===value);
}
type SortableTask = { id: string; title: string; createdAt?: string; updatedAt?: string | number; dueDate?: string | null };

function timestamp(value: string | number | undefined) {
  const time = value === undefined ? 0 : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Copies the list; sorting never changes the stored task or board position. */
export function orderPersonalTasks<T extends SortableTask>(tasks: readonly T[], order: TaskListOrder): T[] {
  if (order === "position") return [...tasks];
  if (order === "createdAt" || order === "createdAtAsc" || order === "updatedAt") {
    const direction = order === "createdAtAsc" ? 1 : -1;
    // Parse once per task, rather than twice for every comparison in the sort.
    return tasks.map((task, index) => ({ task, index,
      key: timestamp(order === "updatedAt" ? task.updatedAt : task.createdAt) }))
      .sort((a, b) => direction * (a.key - b.key) || a.index - b.index)
      .map(item => item.task);
  }
  return tasks.map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const delta = order === "dueDate"
        ? (a.task.dueDate || "9999-12-31").localeCompare(b.task.dueDate || "9999-12-31")
        : a.task.title.localeCompare(b.task.title);
      return delta || a.index - b.index;
    })
    .map(item => item.task);
}
export function unreadPersonalCommentIds(comments: readonly {id:string;authorId:string}[], userId:string, read:readonly string[]):string[] {
  const seen=new Set(read);
  return comments.filter(comment=>comment.authorId!==userId&&!seen.has(comment.id)).map(comment=>comment.id);
}
