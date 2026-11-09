"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { useEffect, useState } from "react";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { querySharedTasks, type SharedTask } from "./cloud-sync";
import { useSharedTaskPage } from "./use-shared-task-page";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import { translateText as t } from "./i18n";
import { sharedTaskDetailsError } from "./shared-task-details";

/** Selected references are resolved separately; a search page never replaces the selection. */
export function SharedDependencyPicker({projectId, taskId, selected, onChange, fallback}: {
  projectId?: string; taskId?: string; selected: string[]; onChange: (ids: string[]) => void; fallback: SharedTask[];
}) {
  const [search,setSearch] = useState("");
  const [expanded,setExpanded] = useState(false);
  const [resolved,setResolved] = useState<SharedTask[]>([]);
  const [error,setError] = useState("");
  const selectedKey = JSON.stringify(selected);
  const results = useSharedTaskPage(expanded && projectId ? {projectIds:[projectId],q:search} : null,"title");
  useEffect(()=>{
    if (!expanded || !projectId || selectedKey === "[]") return;
    const controller = new AbortController();
    void querySharedTasks({projectIds:[projectId],ids:JSON.parse(selectedKey)},null,"title",controller.signal)
      .then(result=>{setResolved(result.tasks);setError("");})
      .catch(error=>{if(!controller.signal.aborted)setError(sharedTaskDetailsError(error) ?? t(error instanceof Error ? error.message : "Не удалось загрузить данные"));});
    return ()=>controller.abort();
  },[projectId,selectedKey,expanded]);
  const choices = new Map([...fallback,...resolved,...results.page?.tasks ?? []].map(task=>[task.id,task]));
  const visible = [...new Set([...selected,...(projectId ? results.page?.tasks ?? [] : fallback).map(task=>task.id)])].filter(id=>id!==taskId);
  return <details onToggle={event=>setExpanded(event.currentTarget.open)}><summary>{t("Предшествующие задачи")} · {selected.length}</summary>
    <p>{t("Эти задачи должны быть выполнены первыми. Связи отображаются на диаграмме.")}</p>
    <label>{t("Поиск задач")}<input value={search} onChange={event=>setSearch(event.target.value)} maxLength={200}/></label>
    <div className="shared-dependency-picker">{visible.map(id=><label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={event=>onChange(event.target.checked ? [...selected,id] : selected.filter(value=>value!==id))}/><span data-no-translate>{choices.get(id)?.title ?? t("Недоступно")}</span></label>)}</div>
    {error ? <p role="alert">{error}</p> : null}
    <SharedTaskPageControls page={results.page} loaded={results.page?.tasks.length ?? 0} busy={results.busy} onMore={()=>void results.more()} onRefresh={()=>void results.refresh()} error={results.error}/>
  </details>;
}

export function SharedDependencyDialog({task,onClose,onOpen}:{task:SharedTask;onClose:()=>void;onOpen:(task:SharedTask)=>void}) {
  const ref=useDialogAccessibility<HTMLDivElement>(onClose);
  const result=useSharedTaskPage({projectIds:[task.projectId],ids:task.dependsOnIds ?? []});
  return <div className="modal-backdrop"><div className="editor-modal" role="dialog" aria-modal="true" aria-label={t("Предшествующие задачи")} ref={ref} tabIndex={-1}>
    <header><h2>{t("Предшествующие задачи")}</h2><DialogCloseButton type="button" aria-label={t("Закрыть")} onClick={onClose} /></header>
    <ul>{task.dependsOnIds?.map(id=>{const dependency=result.page?.tasks.find(row=>row.id===id);return <li key={id}>{dependency ? <button type="button" onClick={()=>onOpen(dependency)}><span data-no-translate>{dependency.title}</span></button> : <span>{t("Недоступно")}</span>}</li>;})}</ul>
    <SharedTaskPageControls page={result.page} loaded={result.page?.tasks.length ?? 0} busy={result.busy} onMore={()=>void result.more()} onRefresh={()=>void result.refresh()} error={result.error}/>
  </div></div>;
}
