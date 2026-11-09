"use client";
import {translateText,type Language} from './i18n';
import type {SharedTask} from './cloud-sync';
import {planningError,planningText,type PlanningCopyKey,type SharedSprint} from './shared-planning';
import {SharedEstimateInputs,SharedEstimateValues} from './SharedTaskEstimates';
import {workflowDraftError,workflowDraftText} from './workflow-draft-copy';
import {WorkDraftError} from './shared-work-draft-journal';
import {IconActionButton} from './IconActionButton';
import type {PlanningTaskEdit} from './planning-task-device-drafts';
import type {usePlanningTaskDrafts} from './use-planning-task-drafts';
type Controller=ReturnType<typeof usePlanningTaskDrafts>;

export function PlanningTaskRow({task,edit,taskId,sprints,language,canEdit,disabled,controller,onOpen}:{task?:SharedTask;edit?:PlanningTaskEdit;taskId:string;sprints:SharedSprint[];language:Language;canEdit:boolean;disabled:boolean;controller:Controller;onOpen:(task:SharedTask)=>void}){
 const g=(text:string)=>translateText(text,language),t=(key:PlanningCopyKey)=>planningText(key,language),fresh=controller.tasks[taskId],current=edit?fresh:task;
 const permissions=controller.planning?.context.permissions,localBlocked=controller.busy||Boolean(controller.pending),stale=Boolean(edit&&fresh&&edit.expectedRevision!==fresh.revision),moved=Boolean(edit&&edit.touched.destination&&(edit.destination==='backlog'?null:edit.destination)!==edit.base.sprintId);
 const catalog=new Map<string,SharedSprint>();for(const sprint of [...(controller.planning?.sprints??[]),...sprints])if(!catalog.has(sprint.id)||catalog.get(sprint.id)!.revision<sprint.revision)catalog.set(sprint.id,sprint);
 const options=[...catalog.values()].sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.id.localeCompare(b.id)),destinationValid=!edit||!moved||edit.destination==='backlog'||options.some(row=>row.id===edit.destination&&row.state!=='completed'),moveDenied=moved&&controller.verified&&permissions?.organizeTasks===false;
 const canSave=Boolean(edit&&fresh&&!fresh.archivedAt&&controller.verified&&controller.planning?.config.enabled&&permissions?.editTasks&&!controller.writeDisabled&&!disabled&&!localBlocked&&!stale&&destinationValid&&!moveDenied);
 const valueTask=current??(edit?edit.base:{storyPoints:null,estimateHours:null});
 return <li className="shared-planning-row" data-planning-task-row={taskId}>
  <div><button className="shared-planning-task-title" type="button" disabled={disabled||localBlocked||!current} onClick={()=>{if(current)onOpen(current);}}><strong>{current?.title??g('Недоступно')}</strong><small>{current?.completedAt?g('Завершено'):g('Задача')}{!current?` · ${taskId.slice(0,8)}`:''}</small></button><SharedEstimateValues task={valueTask} language={language}/></div>
  {!edit&&canEdit&&task?<IconActionButton icon="edit" label={g('Редактировать')} disabled={disabled||localBlocked||!controller.device.ready} onClick={()=>controller.begin(fresh&&fresh.revision>task.revision?{...task,revision:fresh.revision,storyPoints:fresh.storyPoints,estimateHours:fresh.estimateHours,sprintId:fresh.sprintId}:task)}/>:null}
  {edit?<form onSubmit={event=>{event.preventDefault();if(canSave)controller.save(taskId);}} data-planning-task-editor={taskId} data-planning-task-state={JSON.stringify({fresh:Boolean(fresh),archived:Boolean(fresh?.archivedAt),verified:controller.verified,enabled:controller.planning?.config.enabled,edit:permissions?.editTasks,external:disabled,localBlocked,stale,destinationValid,moveDenied})}>
   <SharedEstimateInputs value={edit.draft} language={language} disabled={localBlocked} onChange={next=>{for(const field of ['storyPoints','estimateHours'] as const)if(next[field]!==edit.draft[field])controller.field(taskId,field,next[field]);}}/>
   <label>{t('assignTo')}<select value={edit.destination} disabled={localBlocked} onChange={event=>controller.destination(taskId,event.target.value)}><option value="backlog" disabled={!permissions?.organizeTasks&&edit.base.sprintId!==null}>{t('backlog')}</option>{options.map(sprint=><option key={sprint.id} value={sprint.id} disabled={sprint.id!==edit.base.sprintId&&(!permissions?.organizeTasks||sprint.state==='completed')}>{sprint.title}</option>)}{edit.destination!=='backlog'&&!options.some(row=>row.id===edit.destination)?<option value={edit.destination} disabled>{g('Недоступно')}</option>:null}{edit.base.sprintId&&!options.some(row=>row.id===edit.base.sprintId)&&edit.base.sprintId!==edit.destination?<option value={edit.base.sprintId}>{g('Недоступно')}</option>:null}</select></label>
   {!fresh?<p role="status">{t('taskDraftUnavailable')}</p>:fresh.archivedAt?<p role="status">{t('taskDraftArchived')}</p>:null}
   {moveDenied?<p role="status">{t('movePermissionChanged')}</p>:controller.verified&&!destinationValid?<p role="status">{t('taskDraftDestination')}</p>:null}
   {stale?<p role="status">{t('conflict')}</p>:null}
   {controller.verified&&permissions?.editTasks===false||controller.writeDisabled&&!disabled?<p>{g('Нет доступа')}</p>:null}
   <div className="shared-planning-actions"><button type="submit" className="primary-button" disabled={!canSave}>{g('Сохранить')}</button>{stale?<button type="button" className="secondary-button" disabled={localBlocked||!controller.verified||!fresh||Boolean(fresh.archivedAt)} onClick={()=>controller.rebase(taskId)}>{g('Обновить')}</button>:null}<button type="button" className="secondary-button" disabled={localBlocked} onClick={()=>void controller.cancel(taskId)}>{g('Отмена')}</button></div>
  </form>:null}
 </li>;
}

export function SharedPlanningTaskDrafts({controller,visibleIds,sprints,language,disabled,recoveryBlocked,onOpen}:{controller:Controller;visibleIds:string[];sprints:SharedSprint[];language:Language;disabled:boolean;recoveryBlocked:boolean;onOpen:(task:SharedTask)=>void}){
 const t=(key:PlanningCopyKey)=>planningText(key,language),g=(text:string)=>translateText(text,language),d=(key:Parameters<typeof workflowDraftText>[0])=>workflowDraftText(key,language),{device}=controller;
 const rows=device.rows.filter(row=>row.id!==device.writerId&&row.id!==controller.source?.id),damaged=device.error instanceof WorkDraftError?device.error.record:undefined,offPage=controller.edits.filter(edit=>!visibleIds.includes(edit.taskId)),blocked=controller.busy||Boolean(controller.pending),online=typeof navigator==='undefined'||navigator.onLine;
 const download=()=>{if(!damaged)return;const url=URL.createObjectURL(new Blob([damaged.raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`genesis-estimate-draft-recovery-${damaged.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 if(!controller.edits.length&&!rows.length&&!device.error&&!controller.error&&device.status==='idle')return null;
 return <section className="shared-workflow-device shared-planning-task-drafts" aria-label={t('taskDrafts')}>
  {device.status==='saving'||device.status==='saved'?<p role="status" data-planning-task-device-state={device.status}>{d(device.status)}</p>:null}
  {device.error?<div role="alert"><p>{workflowDraftError(device.error,language)}</p><div className="shared-planning-actions"><button type="button" className="secondary-button" disabled={blocked} onClick={()=>void device.refresh()}>{g('Обновить')}</button>{damaged?<><button type="button" className="secondary-button" disabled={blocked} onClick={download}>{d('download')}</button><button type="button" className="secondary-button" disabled={blocked} onClick={()=>void device.remove(damaged).catch(()=>undefined)}>{d('discard')}</button></>:null}</div></div>:null}
  {rows.length?<details open><summary>{t('taskDrafts')} · {new Intl.NumberFormat(language).format(rows.length)}</summary><ul>{rows.map(row=><li key={row.id} data-planning-task-device-draft={row.id}>
   <time dateTime={row.at}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'medium'}).format(new Date(row.at))}</time>
   <div className="shared-planning-actions shared-work-draft-actions"><IconActionButton icon="edit" label={d('restore')} disabled={recoveryBlocked||blocked||Boolean(controller.edits.length)} onClick={()=>controller.restore(row)}/><IconActionButton icon="delete" label={d('discard')} disabled={blocked||Boolean(row.value.pending)} onClick={()=>{if(!row.value.pending)void device.remove(row).catch(()=>undefined);}}/></div>
   <small>{row.value.pending?d('pending'):`${t('estimates')} · ${new Intl.NumberFormat(language).format(row.value.edits.length)}`}</small>
  </li>)}</ul></details>:null}
  {controller.edits.length&&!controller.verified?<p role="status">{online?g('Загрузка…'):t('deviceCached')}</p>:null}
  {controller.edits.length&&!controller.error?<div className="shared-planning-actions"><button type="button" className="secondary-button" disabled={controller.busy||!online} onClick={()=>void controller.refresh()}>{g('Обновить')}</button></div>:null}
  {controller.edits.length&&controller.verified&&(!controller.planning?.context.permissions.editTasks||controller.writeDisabled&&!disabled)?<p role="status">{g('Нет доступа')}</p>:null}
  {controller.edits.length&&controller.verified&&!controller.planning?.config.enabled?<p role="status">{t('disabled')}</p>:null}
  {controller.notice?<p role="status">{controller.notice==='saved'?t('saved'):d(controller.notice)}</p>:null}
  {controller.error?<div role="alert"><p>{controller.error instanceof Error&&controller.error.message==='PLANNING_TASK_DEVICE_PENDING'?d('pending'):controller.error instanceof Error&&controller.error.message==='PLANNING_TASK_DEVICE_PERSIST'?d('error'):controller.error instanceof WorkDraftError?workflowDraftError(controller.error,language):planningError(controller.error,language)}</p><div className="shared-planning-actions">{controller.pending?<button type="button" className="secondary-button" disabled={disabled||controller.writeDisabled||controller.busy||!online} onClick={()=>void controller.retry()}>{g('Повторить')}</button>:null}<button type="button" className="secondary-button" disabled={controller.busy||!online} onClick={()=>void controller.refresh()}>{g('Обновить')}</button></div></div>:null}
  {offPage.length?<><h3>{t('openEdits')} · {new Intl.NumberFormat(language).format(offPage.length)}</h3><ul>{offPage.map(edit=><PlanningTaskRow key={edit.taskId} edit={edit} taskId={edit.taskId} sprints={sprints} language={language} canEdit={Boolean(controller.planning?.context.permissions.editTasks)} disabled={disabled} controller={controller} onOpen={onOpen}/>)}</ul></>:null}
 </section>;
}
