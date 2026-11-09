import { translateText } from "./i18n";
import { workflowError } from './workflow-copy';

export type SharedChecklistItem = {
  id: string; title: string; done: boolean; assigneeId: string | null; dueDate: string | null;
  linkedTaskId: string | null; linkedProjectId?: string | null; linkUnavailable?: boolean;
};
export type SharedChecklist = { id: string; title: string; items: SharedChecklistItem[] };
export type SharedTaskDetailsDraft = { priority: number; parentTaskId: string | null; checklists: SharedChecklist[] };
export const sharedPriorityLabel = (value: number) => translateText(["Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет"][value] ?? "Без приоритета");

const errors: Record<string, string> = {
  RESTORE_PARENT_FIRST: "Сначала восстановите родительскую задачу или проект.",
  INVALID_CHECKLIST: "Проверьте названия чек-листов и пунктов. Допустимо до 20 списков и 300 пунктов.",
  INVALID_CHECKLIST_LINK: "Связь пункта изменилась. Обновите задачу; черновик сохранён.",
  TASK_RELATION_CYCLE: "Эта связь создаёт цикл. Выберите другую родительскую задачу.",
  TASK_PARENT_UNAVAILABLE: "Родительская задача недоступна. Выберите задачу из этого проекта.",
  TASK_PARENT_COMPLETED: "Сначала верните родительскую задачу в работу.",
  TASK_CHILDREN_INCOMPLETE: "Сначала завершите подзадачи. Они не закрываются автоматически.",
  TASK_CHECKLIST_INCOMPLETE: "Сначала завершите пункты чек-листов и связанные задачи.",
  TASK_MOVE_RELATIONS: "Перед переносом отсоедините родителя и подзадачи. Связанные задачи остаются в своём проекте.",
  INVALID_TASK_PRIORITY: "Выберите приоритет из списка.",
  INVALID_TASK_FILTER: "Условия выборки недействительны. Исправьте или сбросьте фильтр.",
  INVALID_TASK_PAGE: "Страница выборки устарела. Начните загрузку заново.",
  SHARED_QUERY_CHANGED: "Задачи или права изменились. Обновите выборку перед продолжением.",
  VIEW_INVALID: "Условия представления недействительны. Исправьте их или сбросьте фильтры.",
  VIEW_FILTER_UNAVAILABLE: "Часть условий больше недоступна. Исправьте представление перед открытием.",
  VIEW_CONFLICT: "Представление изменено в другом окне. Черновик сохранён; обновите данные перед сохранением.",
  VIEW_SCOPE_IMMUTABLE: "Чтобы изменить пространство или доступ, сохраните новое представление.",
  VIEW_REQUEST_REQUIRED: "Не удалось сохранить представление. Повторите попытку.",
  VIEW_LIMIT: "Достигнут лимит: 100 личных представлений или 100 общих в пространстве.",
  VIEW_PAGE_INVALID: "Страница представлений устарела. Обновите список.",
  VIEW_LIST_CHANGED: "Представления или права изменились. Обновите список.",
};
export function sharedTaskDetailsError(error: unknown): string | null {
  const workflow=workflowError(error);if(workflow)return workflow;
  return error instanceof Error && errors[error.message] ? translateText(errors[error.message]) : null;
}
