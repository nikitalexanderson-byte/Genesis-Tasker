import { DialogCloseButton } from "./DialogCloseButton";
import { useLayoutEffect, useRef, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { sharedCalendarProjection, type SharedCalendarTask, type GenesisTask } from "./cloud-sync";
import { translateText, type Language } from "./i18n";
import { CalendarDayTaskCounts } from "./CalendarTaskCounts";
import { entryTypeLabel, type EntryType } from "./EntryTypeChoice";

import { useSharedTaskPage } from "./use-shared-task-page";
import { SharedTaskPageControls } from "./SharedTaskPageControls";

type PopoverTask = { id: string; title: string; entryType?:EntryType; done?: boolean; completedAt?: string | null };
type ControlProps<T extends PopoverTask> = {
  tasks: readonly T[]; total?: number; footer?: ReactNode; date?: string; dateLabel: string; language: Language; popoverKey: string; alignment: string; openKey: string;
  onOpenKey: Dispatch<SetStateAction<string>>; onOpenTask: (task: T) => void;
  onCompleteTask: (task: T) => void; busyTaskId?: string;
};

export function CalendarSharedTaskControl({ tasks, total, date, dateLabel, language, popoverKey, alignment,
  openKey, onOpenKey, onOpenTask, onCompleteTask, busyTaskId }: ControlProps<SharedCalendarTask>) {
  const result = useSharedTaskPage(date && openKey === popoverKey ? {dueFrom:date,dueTo:date,completion:"open"} : null);
  const visible = result.page?.tasks.map(sharedCalendarProjection) ?? tasks;
  return <CalendarTaskControl tasks={visible} total={result.page?.total ?? total} footer={date ? <SharedTaskPageControls page={result.page} loaded={visible.length} busy={result.busy} onMore={()=>void result.more()} onRefresh={()=>void result.refresh()} error={result.error}/> : null} dateLabel={dateLabel} language={language} popoverKey={popoverKey} alignment={alignment}
    openKey={openKey} onOpenKey={onOpenKey} onOpenTask={onOpenTask} onCompleteTask={onCompleteTask} busyTaskId={busyTaskId} shared
    renderMeta={task => <small data-no-translate>{task.projectTitle || (language === "en" ? "Space inbox" : "Хаос-бокс пространства")}</small>} />;
}

export function CalendarPersonalTaskControl(props: ControlProps<GenesisTask> & { formatTime: (time: string) => string }) {
  return <CalendarTaskControl {...props} renderMeta={task => <time>{task.time ? props.formatTime(task.time) : (props.language === "en" ? "All day" : "Весь день")}</time>} />;
}

function CalendarTaskControl<T extends PopoverTask>({ tasks, total = tasks.length, footer, dateLabel, language, popoverKey, alignment, openKey, onOpenKey, onOpenTask, onCompleteTask, busyTaskId, shared = false, renderMeta }: ControlProps<T> & { shared?: boolean; renderMeta: (task: T) => ReactNode }) {
  const expanded = openKey === popoverKey;
  const controlRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinned = useRef(false);
  const openPopover = () => { clearTimeout(closeTimer.current); onOpenKey(popoverKey); };
  const pinPopover = () => { pinned.current = true; openPopover(); };
  const closePopoverSoon = () => { clearTimeout(closeTimer.current); if(!pinned.current)closeTimer.current = setTimeout(() => onOpenKey(current => current === popoverKey ? "" : current), 400); };
  useLayoutEffect(() => () => clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!expanded) { pinned.current = false; return; }
    const placePopup = () => {
      const anchor = controlRef.current?.getBoundingClientRect();
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const navigation = document.querySelector(".mobile-nav")?.getBoundingClientRect();
      const top = 8;
      const bottom = navigation?.height ? Math.min(window.innerHeight, navigation.top) : window.innerHeight;
      const right = document.documentElement.clientWidth;
      const below = Math.max(0, bottom - anchor.bottom - 8);
      const above = Math.max(0, anchor.top - top - 8);
      const side = Math.max(popup.scrollHeight, popup.offsetHeight) > below && above > below ? "above" : "below";
      popup.dataset.side = side;
      popup.style.maxHeight = `${Math.max(80, side === "above" ? above : below)}px`;
      const bounds = popup.getBoundingClientRect();
      const originalLeft = alignment === "align-right" ? anchor.right - bounds.width : alignment === "align-center" ? anchor.left + (anchor.width - bounds.width) / 2 : anchor.left;
      popup.style.left = `${Math.max(8, Math.min(originalLeft, right - bounds.width - 8))}px`;
      popup.style.top = `${side === "above" ? Math.max(top, anchor.top - bounds.height - 8) : anchor.bottom + 8}px`;
    };
    placePopup();
    const settleTimer = window.setTimeout(placePopup, 180);
    window.addEventListener("resize", placePopup);
    window.addEventListener("scroll", placePopup, true);
    const observer = new ResizeObserver(placePopup);
    if (controlRef.current?.parentElement) observer.observe(controlRef.current.parentElement);
    return () => {
      window.removeEventListener("resize", placePopup);
      window.removeEventListener("scroll", placePopup, true);
      observer.disconnect();
      window.clearTimeout(settleTimer);
    };
  }, [expanded, alignment, tasks.length]);
  if (!total) return null;
  const english = language === "en";
  const title = shared ? (english ? "Shared tasks" : "Общие задачи") : (english ? "Personal tasks" : "Личные задачи");
  const id = `calendar-task-popover-${popoverKey}`;
  return <div ref={controlRef} className={`calendar-day-task-control${shared ? " calendar-shared-task-control" : " calendar-personal-task-control"}`}
    onPointerEnter={event => { if (event.pointerType === "mouse") openPopover(); }}
    onPointerLeave={event => {
      if (event.pointerType === "mouse" && expanded) {
        closePopoverSoon();
      }
    }}
    onFocus={openPopover}
    onBlur={event => {
      if (pinned.current) return;
      if (!(event.relatedTarget instanceof Node) || !(event.currentTarget.contains(event.relatedTarget) || popupRef.current?.contains(event.relatedTarget))) {
        if (expanded) onOpenKey("");
      }
    }}>
    {shared ? <button type="button" className="calendar-shared-task-count" onClick={pinPopover}
      aria-label={`${title}: ${total} · ${dateLabel}`}
      aria-expanded={expanded} aria-controls={id} aria-haspopup="dialog">{total}</button> : <CalendarDayTaskCounts tasks={tasks.map(task => ({ done: Boolean(task.done) }))} dateLabel={dateLabel} language={language} onOpen={pinPopover} expanded={expanded} controls={id} />}
    {expanded && typeof document !== "undefined" ? createPortal(<div ref={popupRef} className={`calendar-task-popover calendar-stable-task-popover ${shared ? "calendar-shared-task-popover" : "calendar-personal-task-popover"}`}
      onPointerEnter={openPopover} onPointerLeave={event => {if(event.pointerType === "mouse")closePopoverSoon();}}
      id={id} role="dialog" aria-label={`${title} · ${dateLabel}`}>
      <header><h2>{title} · {total}<span data-dialog-subtitle>{dateLabel}</span></h2>
        <DialogCloseButton type="button" onClick={() => onOpenKey("")} aria-label={english ? "Close task list" : "Закрыть список задач"} />
      </header>
      <ul>{tasks.map(task => <li className={task.completedAt || task.done ? "done" : ""} key={task.id}>
        <input type="checkbox" className="calendar-popover-task-check" checked={Boolean(task.completedAt || task.done)} disabled={busyTaskId === task.id}
          aria-label={`${translateText("Завершить задачу", language)} «${task.title}»`} onChange={() => onCompleteTask(task)} />
        <button type="button" className="calendar-popover-task-open" onClick={() => { onOpenKey(""); onOpenTask(task); }}>
          <span data-no-translate>{task.title}</span>
          {task.entryType && task.entryType !== "task" ? <small>{entryTypeLabel(task.entryType,english)}</small> : null}
          {renderMeta(task)}
        </button>
      </li>)}</ul>
      {footer}
    </div>, document.querySelector(".genesis-app") ?? document.body) : null}
  </div>;
}
