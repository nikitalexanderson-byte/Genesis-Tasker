import type { GenesisTask, SharedCalendarTask } from "./cloud-sync";
import { translateText, type Language } from "./i18n";

export function CalendarCellTasks({personal, shared, sharedTotal, dateLabel, language, onPersonal, onShared, onMore, previewLimit = 3}: {
  personal: readonly GenesisTask[]; shared: readonly SharedCalendarTask[]; sharedTotal: number;
  dateLabel: string; language: Language; previewLimit?: 1 | 3;
  onPersonal: (task: GenesisTask) => void; onShared: (task: SharedCalendarTask) => void; onMore: () => void;
}) {
  const total = personal.length + sharedTotal;
  if (!total) return null;
  const rows = [
    ...personal.map(task => ({task, shared:false as const})),
    ...shared.map(task => ({task, shared:true as const})),
  ].slice(0, previewLimit);
  return <div className="calendar-cell-tasks">
    <ul>{rows.map(row => <li key={`${row.shared ? "shared" : "personal"}-${row.task.id}`}>
      <button type="button" className="calendar-cell-task" data-shared={row.shared}
        title={`${translateText(row.shared ? "Общие задачи" : "Личные задачи", language)} · ${row.task.title}`}
        aria-label={`${translateText(row.shared ? "Общие задачи" : "Личные задачи", language)} · ${row.task.title}`}
        onClick={() => row.shared ? onShared(row.task) : onPersonal(row.task)}>
        <span className="calendar-cell-task-kind" aria-hidden="true" />
        <span data-no-translate>{row.task.title}</span>
      </button>
    </li>)}</ul>
    {total > rows.length ? <button type="button" className="calendar-cell-tasks-more"
      aria-label={`${translateText("Все задачи", language)} · ${dateLabel} · ${total}`}
      title={`${translateText("Все задачи", language)} · ${total}`} aria-haspopup="dialog" onClick={onMore}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
    </button> : null}
  </div>;
}
