"use client";
import { useEffect, useState } from "react";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { IconActionButton } from "./IconActionButton";
import { formatCalendarDate, type CalendarMode } from "./calendar-data";
import { loadSharedTask, type SharedMember, type SharedTask, type SharedProjectSnapshot, type SharedLabel } from "./cloud-sync";
import { SharedLabelBadges } from "./SharedLabels";
import { entryTypeLabel } from "./EntryTypeChoice";
import { formatTimeValue, type TimeFormat } from "./time-format";
import { useSharedTaskPage } from "./use-shared-task-page";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import { runtimeLocale, translateText as t } from "./i18n";
import { sharedPriorityLabel, sharedTaskDetailsError, type SharedChecklist, type SharedChecklistItem, type SharedTaskDetailsDraft } from "./shared-task-details";
import "./shared-task-details.css";

export const taskDetailsDraft = (task: SharedTask): SharedTaskDetailsDraft => ({ priority: task.priority ?? 0, parentTaskId: task.parentTaskId ?? null, checklists: structuredClone(task.checklists ?? []) });
const move = <T,>(items: T[], index: number, delta: number): T[] => { const result = [...items]; [result[index], result[index + delta]] = [result[index + delta], result[index]]; return result; };
const progressLabel = (done: number, total: number) => t("Выполнено: {done} из {total}").replace("{done}", done.toLocaleString(runtimeLocale())).replace("{total}", total.toLocaleString(runtimeLocale()));
const errorText = (error: unknown) => sharedTaskDetailsError(error) ?? (error instanceof Error ? t(error.message) : t("Не удалось загрузить данные"));

export function SharedTaskReadOnlyMetadata({task, snapshot, labels, statusName, mode, timeFormat, onOpen}: {
  task: SharedTask; snapshot: SharedProjectSnapshot; labels: SharedLabel[]; statusName: string; mode: CalendarMode; timeFormat: TimeFormat;
  onOpen: (projectId: string, taskId: string) => void;
}) {
  const dependencies = useSharedTaskPage(task.dependsOnIds?.length ? {projectIds:[task.projectId],ids:task.dependsOnIds,includeArchived:true} : null);
  const dateTime = (date: string | null | undefined, time: string | null | undefined) => [date ? formatCalendarDate(new Date(`${date}T12:00:00`),mode,true) : t("Без даты"), time ? formatTimeValue(time,timeFormat) : ""].filter(Boolean).join(" · ");
  const member = snapshot.members.find(member => member.userId === task.assigneeId);
  const category = snapshot.categories.find(category => category.id === task.categoryId);
  return <dl className="shared-task-readonly-metadata">
    <div><dt>{t("Тип дела")}</dt><dd>{t(entryTypeLabel(task.entryType ?? "task",false))}</dd></div>
    <div><dt>{t("Доска")}</dt><dd data-no-translate>{statusName}</dd></div>
    <div><dt>{t("Исполнитель")}</dt><dd data-no-translate>{member?.displayName ?? t(task.assigneeId ? "Бывший участник" : "Не назначен")}</dd></div>
    <div><dt>{t("Приоритет")}</dt><dd>{sharedPriorityLabel(task.priority ?? 0)}</dd></div>
    <div><dt>{t("Начало")}</dt><dd>{dateTime(task.startDate,task.startTime)}</dd></div>
    <div><dt>{t("Окончание")}</dt><dd>{dateTime(task.dueDate,task.endTime)}</dd></div>
    {category ? <div><dt>{t("Категория")}</dt><dd data-no-translate>{category.title}</dd></div> : null}
    {task.tags?.length ? <div><dt>{t("Теги")}</dt><dd data-no-translate>{task.tags.map(tag=>`#${tag}`).join(" ")}</dd></div> : null}
    {task.labelIds?.length ? <div><dt>{t("Метки пространства")}</dt><dd><SharedLabelBadges labels={labels} ids={task.labelIds}/></dd></div> : null}
    {task.dependsOnIds?.length ? <div><dt>{t("Предшествующие задачи")}</dt><dd>{task.dependsOnIds.map(id=>{
      const dependency=dependencies.page?.tasks.find(row=>row.id===id);
      return dependency ? <button key={id} type="button" onClick={()=>onOpen(dependency.projectId,id)} data-no-translate>{dependency.title}</button> : <span key={id}>{t(dependencies.page ? "Недоступно" : "Загрузка…")}</span>;
    })}{dependencies.error ? <p role="alert">{dependencies.error}</p> : null}</dd></div> : null}
  </dl>;
}

export function SharedTaskDetailsEditor({ task, value, onChange, members, mode, disabled, readOnly = false, saved, onConvert, onOpen, onCreateChild }: {
  task: SharedTask; value: SharedTaskDetailsDraft; onChange: (value: SharedTaskDetailsDraft) => void; members: SharedMember[]; mode: CalendarMode;
  disabled: boolean; readOnly?: boolean; saved: boolean; onConvert: (itemId: string) => void; onOpen: (projectId: string, taskId: string) => void; onCreateChild: (title: string) => Promise<void>;
}) {
  const [parentAttempt, setParentAttempt] = useState(0);
  const parentKey = JSON.stringify([task.id, task.projectId, task.revision, task.childCount, task.completedChildCount, value.parentTaskId, parentAttempt]);
  const [parentLookup, setParentLookup] = useState<{ key: string; task: SharedTask | null; error: unknown } | null>(null);
  const currentParent = parentLookup?.key === parentKey ? parentLookup : null;
  const parent = currentParent?.task ?? null;
  const parentError = currentParent?.error ? errorText(currentParent.error) : "";
  const parentLoading = Boolean(value.parentTaskId) && !currentParent;
  const [search, setSearch] = useState("");
  const [findParent, setFindParent] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const childPage = useSharedTaskPage({projectIds:[task.projectId],parentTaskId:task.id,includeArchived:true},"position",task.revision);
  const choicesPage = useSharedTaskPage(findParent ? {projectIds:[task.projectId],q:search,completion:"open"} : null,"title");
  const children=childPage.page, choices=choicesPage.page;
  useEffect(() => {
    let live = true;
    void (value.parentTaskId ? loadSharedTask(task.projectId, value.parentTaskId, true) : Promise.resolve(null))
      .then(parent => {
        if (parent && (parent.id !== value.parentTaskId || parent.projectId !== task.projectId)) throw new Error("Не удалось загрузить данные");
        if (live) setParentLookup({ key: parentKey, task: parent, error: null });
      })
      .catch(error => { if (live) setParentLookup({ key: parentKey, task: null, error }); });
    return () => { live = false; };
  }, [parentKey, task.projectId, value.parentTaskId]);

  const changeLists = (checklists: SharedChecklist[]) => onChange({ ...value, checklists });
  const updateList = (id: string, update: Partial<SharedChecklist>) => changeLists(value.checklists.map(list => list.id === id ? { ...list, ...update } : list));
  const updateItem = (list: SharedChecklist, id: string, update: Partial<SharedChecklistItem>) => updateList(list.id, { items: list.items.map(item => item.id === id ? { ...item, ...update } : item) });
  const itemCount = value.checklists.reduce((total, list) => total + list.items.length, 0);
  const addItem = (list: SharedChecklist) => {
    if (disabled || pending || itemCount >= 300) return;
    const id = crypto.randomUUID();
    updateList(list.id, { items: [...list.items, { id, title: "", done: false, assigneeId: null, dueDate: null, linkedTaskId: null }] });
    window.requestAnimationFrame(() => document.getElementById(`checklist-item-${id}`)?.focus());
  };
  const working = disabled || pending;
  const createChild = async () => {
    if (working || !saved || !childTitle.trim() || task.completedAt) return;
    setError(null); setPending(true);
    try { await onCreateChild(childTitle.trim()); setChildTitle(""); }
    catch (error) { setError(error); }
    finally { setPending(false); }
  };
  return <section className="shared-task-details-editor">
    {!readOnly ? <label>{t("Приоритет")}<select value={value.priority} disabled={working} onChange={event => onChange({ ...value, priority: Number(event.target.value) })}>
      {[0, 1, 2, 3].map(priority => <option key={priority} value={priority}>{sharedPriorityLabel(priority)}</option>)}
    </select></label> : null}
    <details className="task-advanced-fields shared-task-relations">
      <summary>{t("Подзадачи и родитель")} · {progressLabel(task.completedChildCount ?? 0, task.childCount ?? 0)}</summary>
      <p>{t("Родитель завершается после подзадач и чек-листов. Подтверждения участников сохраняются.")}</p>
      {value.parentTaskId ? <div className="shared-parent-reference" aria-busy={parentLoading}>
        <span className="shared-detail-caption">{t("Родительская задача")}</span>
        <div className="shared-detail-actions"><button type="button" className="secondary-button shared-parent-link" disabled={working || !parent || !saved} onClick={() => onOpen(task.projectId, value.parentTaskId!)}>
          <span data-no-translate>{parent?.title ?? t(parentLoading ? "Загрузка…" : "Недоступно")}</span><ExperimentalIcon name="open" />
        </button>
        {parentError ? <IconActionButton icon="map-refresh" label={t("Обновить")} disabled={working} onClick={() => setParentAttempt(attempt => attempt + 1)}/> : null}
        {!readOnly ? <IconActionButton icon="close" label={t("Отсоединить")} disabled={working} onClick={() => onChange({ ...value, parentTaskId: null })}/> : null}</div>
      </div> : null}
      {!readOnly ? <details onToggle={event => setFindParent(event.currentTarget.open)}><summary>{t("Выбрать родительскую задачу")}</summary>
        <label>{t("Поиск задач")}<input value={search} disabled={working} onChange={event => setSearch(event.target.value)} maxLength={200} /></label>
        <div className="shared-relation-results">{choices?.tasks.filter(choice => choice.id !== task.id && choice.id !== value.parentTaskId).map(choice => <button type="button" key={choice.id} disabled={working} onClick={() => onChange({ ...value, parentTaskId: choice.id })}><span data-no-translate>{choice.title}</span></button>)}</div>
        <SharedTaskPageControls page={choices} loaded={choices?.tasks.length ?? 0} busy={choicesPage.busy} onMore={()=>void choicesPage.more()} onRefresh={()=>void choicesPage.refresh()} error={choicesPage.error}/>
      </details> : null}
      <ul className="shared-child-list">{children?.tasks.map(child => <li key={child.id}><button type="button" disabled={working || !saved} onClick={() => onOpen(child.projectId, child.id)}>
        <span>{child.archivedAt ? t("Архив задач") : child.completedAt ? t("Выполнено") : t("В работе")}</span><strong data-no-translate>{child.title}</strong><small><span data-no-translate>{members.find(member => member.userId === child.assigneeId)?.displayName ?? t(child.assigneeId ? "Бывший участник" : "Не назначен")}</span>{" · "}{child.dueDate ? formatCalendarDate(new Date(`${child.dueDate}T12:00:00`), mode) : t("Без срока")}</small>
      </button></li>)}</ul>
      <SharedTaskPageControls page={children} loaded={children?.tasks.length ?? 0} busy={childPage.busy} onMore={()=>void childPage.more()} onRefresh={()=>void childPage.refresh()} error={childPage.error}/>
      {!readOnly ? <div className="shared-child-create" aria-busy={pending}><label>{t("Новая подзадача")}<input value={childTitle} disabled={working} maxLength={160} onChange={event => setChildTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void createChild(); } }} /></label>
        <IconActionButton icon="plus" label={t("Добавить подзадачу")} disabled={working || !saved || !childTitle.trim() || Boolean(task.completedAt)} onClick={() => void createChild()}/></div> : null}
    </details>
    <details className="task-advanced-fields shared-task-checklists" open={value.checklists.length > 0 || undefined}>
      <summary>{t("Чек-листы")} · {progressLabel(value.checklists.flatMap(list => list.items).filter(item => item.done).length, value.checklists.reduce((total, list) => total + list.items.length, 0))}</summary>
      <p>{t("Пункт, превращённый в задачу, следует её статусу. Удаление пункта не удаляет связанную задачу.")}</p>
      {value.checklists.map((list, listIndex) => <fieldset className="shared-checklist" key={list.id} disabled={working}>
        <legend>{t("Чек-лист")} · {progressLabel(list.items.filter(item => item.done).length, list.items.length)}</legend>
        <div className="shared-checklist-heading">{readOnly ? <strong data-no-translate>{list.title}</strong> : <label>{t("Название чек-листа")}<input value={list.title} required maxLength={160} onChange={event => updateList(list.id, { title: event.target.value })} /></label>}
          {!readOnly ? <div className="shared-detail-actions"><IconActionButton icon={<ExperimentalIcon name="chevron" className="shared-detail-up" />} label={t("Переместить выше")} disabled={listIndex === 0} onClick={() => changeLists(move(value.checklists, listIndex, -1))}/>
            <IconActionButton icon={<ExperimentalIcon name="chevron" className="shared-detail-down" />} label={t("Переместить ниже")} disabled={listIndex === value.checklists.length - 1} onClick={() => changeLists(move(value.checklists, listIndex, 1))}/>
            <IconActionButton icon="delete" label={t("Удалить чек-лист")} onClick={() => changeLists(value.checklists.filter(item => item.id !== list.id))}/></div> : null}
        </div>
        <ol className="shared-checklist-items">{list.items.map((item, itemIndex) => <li key={item.id}>
          <div className="shared-checklist-item-main"><label className="shared-checklist-toggle"><input type="checkbox" checked={item.done} disabled={readOnly || Boolean(item.linkedTaskId) || item.linkUnavailable} aria-label={`${t("Выполнено")}: ${item.title}`} onChange={event => updateItem(list, item.id, { done: event.target.checked })} /></label>
            {readOnly ? <span data-no-translate>{item.title}</span> : <input id={`checklist-item-${item.id}`} value={item.title} required maxLength={500} aria-label={t("Название пункта")} onChange={event => updateItem(list, item.id, { title: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (item.title.trim()) addItem(list); } }} />}
          </div>
          <details><summary>{t("Срок, исполнитель и действия")}</summary>
            {readOnly ? <p>{members.find(member => member.userId === item.assigneeId)?.displayName ?? t("Не назначен")}{item.dueDate ? ` · ${formatCalendarDate(new Date(`${item.dueDate}T12:00:00`), mode)}` : ""}</p> : <div className="shared-checklist-item-fields">
              <label>{t("Исполнитель")}<select value={item.assigneeId ?? ""} onChange={event => updateItem(list, item.id, { assigneeId: event.target.value || null })}><option value="">{t("Не назначен")}</option>{item.assigneeId&&!members.some(member=>member.userId===item.assigneeId)?<option value={item.assigneeId}>{t("Бывший участник")}</option>:null}{members.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select></label>
              <div className="shared-projects-date-field"><span>{t("Срок пункта")}</span><CalendarDatePicker value={item.dueDate ?? ""} mode={mode} ariaLabel={t("Срок пункта")} onChange={dueDate => updateItem(list, item.id, { dueDate: dueDate || null })} />{item.dueDate ? <IconActionButton icon="close" label={t("Убрать дату")} onClick={() => updateItem(list, item.id, { dueDate: null })}/> : null}</div>
            </div>}
            <div className="shared-detail-actions shared-checklist-item-actions">
            {!readOnly ? <><IconActionButton icon={<ExperimentalIcon name="chevron" className="shared-detail-up" />} label={t("Переместить выше")} disabled={itemIndex === 0} onClick={() => updateList(list.id, { items: move(list.items, itemIndex, -1) })}/><IconActionButton icon={<ExperimentalIcon name="chevron" className="shared-detail-down" />} label={t("Переместить ниже")} disabled={itemIndex === list.items.length - 1} onClick={() => updateList(list.id, { items: move(list.items, itemIndex, 1) })}/>
              <IconActionButton icon="delete" label={t("Удалить пункт")} onClick={() => updateList(list.id, { items: list.items.filter(current => current.id !== item.id) })}/></> : null}
            {item.linkedTaskId && item.linkedProjectId ? <IconActionButton icon="open" label={t("Открыть связанную задачу")} disabled={!saved} onClick={() => onOpen(item.linkedProjectId!, item.linkedTaskId!)}/>
              : item.linkUnavailable ? <p>{t("Связанная задача недоступна")}</p>
                : !readOnly ? <IconActionButton icon="thought-affair" label={t("Превратить в задачу")} disabled={!saved || Boolean(task.completedAt)} onClick={() => onConvert(item.id)}/> : null}
            </div>
          </details>
        </li>)}</ol>
        {!readOnly ? <IconActionButton icon="plus" label={t("Добавить пункт")} disabled={itemCount >= 300} onClick={() => addItem(list)}/> : null}
      </fieldset>)}
      {!readOnly ? <IconActionButton icon="plus" label={t("Добавить чек-лист")} disabled={working || value.checklists.length >= 20} onClick={() => changeLists([...value.checklists, { id: crypto.randomUUID(), title: t("Чек-лист"), items: [] }])}/> : null}
    </details>
    {!readOnly && !saved ? <p className="shared-detail-help" role="status">{t("Сохраните изменения перед созданием подзадачи или превращением пункта в задачу.")}</p> : null}
    {parentError ? <p role="alert">{parentError}</p> : null}
    {error ? <p role="alert">{errorText(error)}</p> : null}
  </section>;
}
