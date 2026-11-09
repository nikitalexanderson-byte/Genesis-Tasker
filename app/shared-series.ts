import type { RecurrenceConfig } from "./task-recurrence";
import { translateText as t } from "./i18n";

export type SharedSeriesSettings = {
  timing: "schedule" | "after-completion";
  delayDays: number; limit: number; cloneChildren: boolean; excludedDates: string[];
  recurrence: RecurrenceConfig;
};
export type SharedSeries = {
  id: string; projectId: string; sourceTaskId: string | null; revision: number; paused: boolean;
  settings: SharedSeriesSettings; generatedCount: number; lastError: string | null;
  nextDates: string[]; waitingForCompletion: boolean; templateTaskCount: number; workerCompletedAt: string | null;
  instances: {taskId: string | null; projectId: string | null; date: string; ordinal: number; state: "created" | "skipped"}[];
};
export type SharedSeriesPreview = {taskCount: number; checklistCount: number; preservesExistingInstances: true; copiesDiscussion: false; copiesFiles: false};

export function sharedSeriesError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  if (["SERIES_CONFLICT", "SHARED_TASK_CONFLICT", "SERIES_EXISTS"].includes(code)) return t("Задача или серия изменилась. Обновите данные; черновик сохранён.");
  if (code === "SERIES_TEMPLATE_LIMIT") return t("В одном повторе допускается до 20 задач. Уменьшите дерево подзадач.");
  if (code === "SERIES_COMPLETED_INSTANCE") return t("Завершённый повтор нельзя пропустить. Сначала верните задачу в работу.");
  if (["SHARED_PROJECT_NOT_FOUND", "SHARED_PROJECT_FORBIDDEN", "AUTH_REQUIRED"].includes(code)) return t("Нет доступа к настройке этой серии.");
  if (["SERIES_TEMPLATE_UNAVAILABLE", "INVALID_ASSIGNEE", "INVALID_TASK_APPROVER", "SERIES_SOURCE_UNAVAILABLE"].includes(code)) return t("Проверьте доску, исполнителей и утверждающих участников, затем обновите образец серии.");
  if (["SERIES_INVALID", "INVALID_CALENDAR_TIME_ZONE", "INVALID_CALENDAR_DATE", "SERIES_REFRESH_REQUIRED"].includes(code)) return t("Проверьте даты, часовой пояс, лимит и обновление образца серии.");
  return t("Серия не сохранена. Черновик оставлен на экране; повторите после подключения.");
}
