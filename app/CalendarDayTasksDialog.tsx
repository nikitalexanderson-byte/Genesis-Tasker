"use client";
import { useEffect, useRef } from "react";
import { DialogCloseButton } from "./DialogCloseButton";
import { sharedCalendarProjection, type GenesisTask, type SharedCalendarTask } from "./cloud-sync";
import { translateText, type Language } from "./i18n";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import { useSharedTaskPage } from "./use-shared-task-page";
import "./calendar-cell-tasks.css";

export default function CalendarDayTasksDialog({date, dateLabel, personal, sharedEnabled, language, formatTime, onClose, onPersonal, onShared}: {
  date: string; dateLabel: string; personal: readonly GenesisTask[]; sharedEnabled: boolean; language: Language;
  formatTime: (value: string) => string; onClose: () => void;
  onPersonal: (task: GenesisTask) => void; onShared: (task: SharedCalendarTask) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const shared = useSharedTaskPage(sharedEnabled ? {dueFrom:date,dueTo:date,completion:"open"} : null, "dueDate");
  const t = (text: string) => translateText(text, language);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="calendar-day-tasks-dialog" aria-labelledby="calendar-day-tasks-title" onClose={onClose}>
    <header><h2 id="calendar-day-tasks-title">{t("Все задачи")} <span data-dialog-subtitle>{dateLabel}</span></h2>
      <DialogCloseButton type="button" aria-label={t("Закрыть")} onClick={onClose}/>
    </header>
    <div className="calendar-day-task-columns">
      <section aria-labelledby="calendar-day-personal-title">
        <h3 id="calendar-day-personal-title">{t("Личные задачи")} <span>{personal.length}</span></h3>
        {personal.length ? <ul>{personal.map(task => <li key={task.id}><button type="button" className="calendar-day-task-row" onClick={() => onPersonal(task)}>
          <strong data-no-translate>{task.title}</strong><small>{task.time ? formatTime(task.time) : t("Весь день")}</small>
        </button></li>)}</ul> : <p>{t("На этот день задач нет.")}</p>}
      </section>
      <section aria-labelledby="calendar-day-shared-title" data-shared="true">
        <h3 id="calendar-day-shared-title">{t("Общие задачи")} {shared.page || !sharedEnabled ? <span>{shared.page?.total ?? 0}</span> : null}</h3>
        {shared.page?.tasks.length ? <ul>{shared.page.tasks.map(task => <li key={task.id}><button type="button" className="calendar-day-task-row" onClick={() => onShared(sharedCalendarProjection(task))}>
          <strong data-no-translate>{task.title}</strong><small data-no-translate>{task.projectTitle}</small>
        </button></li>)}</ul> : shared.page || !sharedEnabled ? <p>{t("На этот день задач нет.")}</p> : null}
        {sharedEnabled ? <SharedTaskPageControls page={shared.page} loaded={shared.page?.tasks.length ?? 0} busy={shared.busy}
          onMore={() => void shared.more()} onRefresh={() => void shared.refresh()} error={shared.error}/> : null}
      </section>
    </div>
  </dialog>;
}
