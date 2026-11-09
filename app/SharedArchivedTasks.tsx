"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { useState } from "react";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { useSharedTaskPage } from "./use-shared-task-page";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import { setSharedTaskArchived, type SharedProject, type SharedTask } from "./cloud-sync";
import { sharedPriorityLabel, sharedTaskDetailsError } from "./shared-task-details";
import { translateText as t } from "./i18n";
import {IconActionButton} from './IconActionButton';
import {workflowText} from './workflow-copy';
import "./shared-review.css";

export function SharedArchivedTasks({spaceId,projects,onClose,onChanged,onTrash,onOpen,onWorkflow}: {spaceId:string;projects:SharedProject[];onClose:()=>void;onChanged:()=>Promise<void>;onTrash:(task:SharedTask)=>void;onOpen:(task:SharedTask)=>void;onWorkflow:(project:SharedProject)=>void}) {
  const [search,setSearch]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const ref=useDialogAccessibility<HTMLDivElement>(onClose);
  const result=useSharedTaskPage({spaceId,archived:true,q:search},"updatedAt");
  return <div className="modal-backdrop"><div className="editor-modal shared-trash-dialog shared-archive-dialog" role="dialog" aria-modal="true" aria-label={t("Архив задач")} ref={ref} tabIndex={-1}>
    <header><h2>{t("Архив задач")}</h2><DialogCloseButton type="button" aria-label={t("Закрыть")} onClick={onClose} /></header>
    <p>{t("Архив скрывает задачу и её подзадачи из активных списков. Завершение и сроки не меняются.")}</p>
    <div className="shared-archive-toolbar">
      <label>{t("Поиск задач")}<input type="search" value={search} onChange={event=>setSearch(event.target.value)} maxLength={200}/></label>
      <IconActionButton icon="map-refresh" label={t("Обновить")} disabled={result.busy||busy} onClick={()=>void result.refresh()}/>
    </div>
    {result.page?.tasks.map(task=><article className="shared-trash-item" key={task.id}>
      <details><summary><strong data-no-translate>{task.title}</strong> · {sharedPriorityLabel(task.priority ?? 0)}</summary>
        <p data-no-translate>{task.projectTitle}</p><p data-no-translate>{task.description}</p>
        {task.checklists?.map(list=><div key={list.id}><h3 data-no-translate>{list.title}</h3><ul>{list.items.map(item=><li key={item.id}><input type="checkbox" checked={item.done} disabled/><span data-no-translate>{item.title}</span></li>)}</ul></div>)}
      </details>
      <button type="button" onClick={()=>onOpen(task)}>{t("Открыть задачу")}</button>
      {projects.find(project=>project.id===task.projectId)?.permissions?.manageProjects?<IconActionButton icon="settings" label={workflowText('heading')} data-workflow-repair={task.projectId} disabled={busy} onClick={()=>onWorkflow(projects.find(project=>project.id===task.projectId)!)}/>:null}
      {projects.find(project=>project.id===task.projectId)?.canOrganizeTasks ? <div className="shared-detail-actions"><button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await setSharedTaskArchived(task,false);await result.refresh();await onChanged();}catch(error){setError(sharedTaskDetailsError(error) ?? t(error instanceof Error ? error.message : "Не удалось загрузить данные"));}finally{setBusy(false);}}}>{t("Восстановить")}</button>
        <button type="button" disabled={busy} onClick={()=>onTrash(task)}>{t("В корзину")}</button></div> : null}
    </article>)}
    {result.page?.total===0 ? <p>{t("Архив задач пуст.")}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <SharedTaskPageControls page={result.page} loaded={result.page?.tasks.length ?? 0} busy={result.busy||busy} onMore={()=>void result.more()} onRefresh={()=>void result.refresh()} error={result.error}/>
  </div></div>;
}
