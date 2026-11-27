import type { Language } from "./i18n";

type TaskState = { done: boolean };
const DAY_COUNT_LABELS: Record<Language, { completed: string; pending: string; showFor: string }> = {
  ru: { completed: "Выполнено", pending: "Не выполнено", showFor: "Показать задачи на" },
  en: { completed: "Completed", pending: "Incomplete", showFor: "Show tasks for" },
  he: { completed: "הושלמו", pending: "טרם הושלמו", showFor: "הצגת המשימות לתאריך" },
  ar: { completed: "مكتملة", pending: "غير مكتملة", showFor: "عرض مهام يوم" },
  ko: { completed: "완료", pending: "미완료", showFor: "작업을 표시할 날짜:" },
  nl: { completed: "Voltooid", pending: "Onvoltooid", showFor: "Taken weergeven voor" },
  el: { completed: "Ολοκληρωμένες", pending: "Εκκρεμείς", showFor: "Εμφάνιση εργασιών για" },
  de: { completed: "Erledigt", pending: "Offen", showFor: "Aufgaben anzeigen für" },
  fr: { completed: "Terminées", pending: "En cours", showFor: "Afficher les tâches du" },
  es: { completed: "Completadas", pending: "Pendientes", showFor: "Mostrar tareas del" },
  it: { completed: "Completate", pending: "Da completare", showFor: "Mostra le attività del" },
  pt: { completed: "Concluídas", pending: "Pendentes", showFor: "Mostrar tarefas de" },
  pl: { completed: "Ukończone", pending: "Oczekujące", showFor: "Pokaż zadania na" },
  sr: { completed: "Завршени", pending: "На чекању", showFor: "Прикажи задатке за" },
  uk: { completed: "Завершені", pending: "Незавершені", showFor: "Показати завдання на" },
  zh: { completed: "已完成", pending: "待完成", showFor: "显示以下日期的任务：" },
  tr: { completed: "Tamamlanan", pending: "Bekleyen", showFor: "Şu tarihin görevlerini göster:" },
  ja: { completed: "完了", pending: "未完了", showFor: "この日のタスクを表示：" },
};

function taskCounts(tasks: readonly TaskState[]) {
  const completed = tasks.filter((task) => task.done).length;
  return [
    { status: "pending", count: tasks.length - completed },
    { status: "completed", count: completed },
  ].filter((item) => item.count > 0);
}

export function CalendarDayTaskCounts({ tasks, dateLabel, language, onOpen, expanded, controls }: {
  tasks: readonly TaskState[]; dateLabel: string; language: Language; onOpen: () => void;
  expanded: boolean; controls: string;
}) {
  return taskCounts(tasks).map(({ status, count }) => {
    const labels = DAY_COUNT_LABELS[language];
    const stateLabel = status === "completed" ? labels.completed : labels.pending;
    const label = `${stateLabel}: ${count}. ${labels.showFor} ${dateLabel}`;
    return <button key={status} type="button" className="calendar-day-task-count"
      data-task-status={status} onClick={onOpen} title={label} aria-label={label}
      aria-expanded={expanded} aria-controls={controls} aria-haspopup="dialog">{count}</button>;
  });
}

export function CalendarYearTaskCounts({ tasks }: { tasks: readonly TaskState[] }) {
  const counts = taskCounts(tasks);
  if (!counts.length) return null;
  return <span className="mini-day-task-counts" aria-hidden="true">{counts.map(({ status, count }) => <span key={status} className="mini-day-task-count"
    data-task-status={status} data-mixed={counts.length > 1 || undefined}>{count}</span>)}</span>;
}
