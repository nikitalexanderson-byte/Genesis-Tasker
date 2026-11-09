"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GenesisApiError, applySharedTemplate, previewSharedTemplate } from "./cloud-sync";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { todayCivilDate } from "./calendar-context";
import { formatCalendarDateValue } from "./calendar-data";
import { translateText, type Language } from "./i18n";
import { SharedCustomFieldInputs } from "./SharedCustomFieldInputs";
import { templateOptions, templateFieldDefinition, templateError, templateIssueText, type SharedTemplate, type TemplateApplyOptions, type TemplateIssue, type TemplatePreview, type TemplateReceipt, type TemplateDestinationProject } from "./shared-templates";
import {useSharedEditorDrafts} from './use-shared-editor-drafts';
import {SharedEditorDraftRecovery} from './SharedEditorDraftRecovery';
import {validateTemplateApplySnapshot,type TemplateApplySnapshot} from './template-apply-device-drafts';
import {NumberDraftProvider,type NumberDrafts} from './DraftNumberInput';
import type {WorkDraft} from './shared-work-draft-journal';
import {editorDeviceEdit,type EditorDeviceDraft} from './shared-editor-device-drafts';

export function SharedTemplateIssues({issues,language,record}:{issues:TemplateIssue[];language:Language;record?:SharedTemplate}){
 const [limit,setLimit]=useState(40),t=(s:string)=>translateText(s,language);
 if(!issues.length)return null;
 const grouped=[...new Map(issues.map(issue=>[JSON.stringify(issue),issue])).values()];
 return <><ul className="template-issues">{grouped.slice(0,limit).map((issue,index)=><li key={index}><span>{templateIssueText(issue,language)}</span>
   {issue.title?<strong data-no-translate> {issue.title}</strong>:issue.taskKey&&record?.manifest.tasks.find(task=>task.key===issue.taskKey)?<strong data-no-translate> {record.manifest.tasks.find(task=>task.key===issue.taskKey)?.title}</strong>:null}
   {issue.date?<time dateTime={issue.date}> {issue.date}</time>:null}{issue.count!==undefined?<span> · {new Intl.NumberFormat(language).format(issue.count)}</span>:null}</li>)}</ul>
   {grouped.length>limit?<button type="button" onClick={()=>setLimit(limit+40)}>{t("Показать ещё")}</button>:null}</>;
}

export function SharedTemplateApply({userId,contextKey='library',restoreDraft,record,spaceId,projectId,projects,language,onApplied,onDirtyChange,onConfigured,initialOptions}:{userId:string;contextKey?:string;restoreDraft?:WorkDraft<EditorDeviceDraft<TemplateApplySnapshot>>|null;record:SharedTemplate;spaceId:string;projectId:string;projects:TemplateDestinationProject[];language:Language;onApplied:(receipt:TemplateReceipt)=>Promise<void>;onDirtyChange:(dirty:boolean)=>void;onConfigured?:(options:TemplateApplyOptions)=>void;initialOptions?:Partial<TemplateApplyOptions>}){
 const t=(s:string)=>translateText(s,language);
 const [options,setOptions]=useState<TemplateApplyOptions>(()=>({spaceId,projectId:record.kind==='task'?(projects.find(project=>project.id===projectId&&project.canWrite&&!project.archivedAt)?.id??projects.find(project=>project.canWrite&&!project.archivedAt)?.id??null):null,parentProjectId:null,language,anchorDate:todayCivilDate(record.manifest.calendarContext),include:{},...initialOptions}));
 const [preview,setPreview]=useState<TemplatePreview|null>(null),[receipt,setReceipt]=useState<TemplateReceipt|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[pageIndex,setPageIndex]=useState(0),[previewRequest,setPreviewRequest]=useState("");
 const lock=useRef(false),pending=useRef<(TemplateApplyOptions&{operationId:string;fingerprint:string})|null>(null);
 const [numbers,setNumbers]=useState<NumberDrafts>({}),[changed,setChanged]=useState(false),section=useRef<HTMLElement>(null),lastSnapshot=useRef(''),restored=useRef('');
 const recovery=useSharedEditorDrafts(userId,spaceId,projectId,'template-apply',validateTemplateApplySnapshot);
 const snapshot:TemplateApplySnapshot={templateId:record.id,contextKey,title:record.title,options,numbers},snapshotJson=JSON.stringify(snapshot);
 const matchingRecovery={...recovery,rows:recovery.rows.filter(row=>row.value.editor.templateId===record.id&&row.value.editor.contextKey===contextKey)};
 const dirtyCallback=useRef(onDirtyChange);
 useEffect(()=>{dirtyCallback.current=onDirtyChange;},[onDirtyChange]);
 const restoreEditor=useCallback((value:TemplateApplySnapshot)=>{setOptions(value.options);setNumbers(value.numbers);setChanged(true);setPreview(null);setPreviewRequest('');dirtyCallback.current(true);},[]);
 useEffect(()=>{if(!changed||!recovery.device.ready||recovery.locked||lastSnapshot.current===snapshotJson)return;lastSnapshot.current=snapshotJson;recovery.update(JSON.parse(snapshotJson) as TemplateApplySnapshot);},[snapshotJson,changed,recovery]);
 useEffect(()=>{if(!restoreDraft||restored.current===restoreDraft.raw||!recovery.device.ready)return;restored.current=restoreDraft.raw;void recovery.restore(restoreDraft).then(restoreEditor).catch(reason=>setError(templateError(reason,language)));},[restoreDraft,recovery,language,restoreEditor]);
 useEffect(()=>{if(matchingRecovery.rows.length)dirtyCallback.current(true);},[matchingRecovery.rows.length]);
 const request={...options,language},current=JSON.stringify(request),fresh=Boolean(preview&&previewRequest===current&&preview.revision===record.revision);
 const change=(value:TemplateApplyOptions)=>{if(recovery.locked)return;setOptions(value);setChanged(true);pending.current=null;setError("");onDirtyChange(true);};
 const mappedValue=(mapping:Record<string,string|null>|undefined,key:string,fallback:string)=>Object.hasOwn(mapping??{},key)?mapping![key]??"":fallback;
 const run=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError("");try{await work();}catch(reason){setError(templateError(reason,language));if(reason instanceof GenesisApiError&&(reason.status===403||reason.status===404)){setPreview(null);setPreviewRequest("");pending.current=null;}}finally{lock.current=false;setBusy(false);}};
 const date=(value:string|null)=>value?formatCalendarDateValue(value,record.manifest.calendarMode,true,record.manifest.calendarContext):t("Без срока");
 const sourceMembers=[...new Set(record.manifest.tasks.flatMap(task=>[task.assigneeId,...task.approverIds,...task.checklists.flatMap(list=>list.items.map(item=>item.assigneeId))]).filter((value):value is string=>value!==null))];
 const shownTasks=preview?.tasks.slice(pageIndex*20,(pageIndex+1)*20)??[];
 const validInputs=()=>{const invalid=section.current?.querySelector<HTMLInputElement>('input:invalid,select:invalid,textarea:invalid');if(invalid){invalid.reportValidity();return false;}return true;};
 const previewNow=()=>run(async()=>{if(recovery.locked||!validInputs())return;const value=await previewSharedTemplate(record.id,request);setPreview(value);setPreviewRequest(current);pending.current=null;setPageIndex(0);});
 const finishSend=async()=>{const value=await recovery.send(request=>applySharedTemplate(request.id!,request.body as TemplateApplyOptions&{operationId:string;fingerprint:string})) as TemplateReceipt;setReceipt(value);await recovery.finish();setChanged(false);onDirtyChange(false);await onApplied(value);};
 const apply=()=>run(async()=>{
  if(!preview||!fresh||!preview.canApply||receipt||recovery.locked||!validInputs())return;
  if(onConfigured){await recovery.persist(editorDeviceEdit(spaceId,projectId,'template-apply',snapshot));await recovery.finish();setChanged(false);onDirtyChange(false);onConfigured(request);return;}
  const command={...request,operationId:crypto.randomUUID(),fingerprint:preview.fingerprint};
  await recovery.prepare(snapshot,{kind:'template.apply',id:record.id,body:command,expected:{taskCount:preview.tasks.length,projectCount:record.kind==='project'?preview.projects.length:0,taskKeys:preview.tasks.map(task=>task.key),projectKeys:preview.projects.map(project=>project.key)}});await finishSend();
 });
 return <section ref={section} className="template-apply"><h3>{t("Применить шаблон")}</h3><SharedEditorDraftRecovery title={value=>value.title} controller={matchingRecovery} language={language} busy={busy} editing={changed} onRestore={restoreEditor} onRetry={()=>void run(finishSend)} onEdit={restoreEditor} onError={reason=>setError(templateError(reason,language))}/><NumberDraftProvider values={numbers} onChange={value=>{setNumbers(value);setChanged(true);onDirtyChange(true);}}>
  <p>{t("Будут созданы самостоятельные задачи. Файлы, обсуждения, права и подписки не копируются.")}</p>
  <form noValidate onSubmit={event=>{event.preventDefault();void previewNow();}}><fieldset disabled={busy||recovery.locked||Boolean(receipt)}>
   <div className="template-grid"><label>{t("Назначение")}<select value={(record.kind==='task'?options.projectId:options.parentProjectId)??""} onChange={event=>change({...options,...(record.kind==='task'?{projectId:event.target.value||null}:{parentProjectId:event.target.value||null})})}>
    <option value="">{t(record.kind==='task'?"Выберите проект":"Корень пространства")}</option>{projects.filter(project=>project.canWrite&&!project.archivedAt).map(project=><option key={project.id} value={project.id} data-no-translate>{project.title}</option>)}</select></label>
    <div><span className="template-field-label">{t("Базовая дата")}</span><CalendarDatePicker mode={record.manifest.calendarMode} calculationContext={record.manifest.calendarContext} value={options.anchorDate} required ariaLabel={t("Базовая дата")} onChange={anchorDate=>change({...options,anchorDate})}/></div></div>
   <label>{t("Название нового объекта")}<input data-no-translate value={options.title??""} maxLength={160} placeholder={record.kind==='project'?record.manifest.projects[0].title:record.manifest.tasks[0].title} onChange={event=>change({...options,title:event.target.value||undefined})}/></label>
   <fieldset className="template-transfer-options"><legend>{t("Переносимые данные")}</legend>{Object.entries(templateOptions).map(([flag,label])=><label key={flag} className="shared-custom-field-check"><input type="checkbox" checked={options.include?.[flag as keyof typeof templateOptions]!==false} onChange={event=>change({...options,include:{...options.include,[flag]:event.target.checked},fieldValues:undefined})}/>{t(label)}</label>)}</fieldset>
   {preview?<details><summary>{t("Сопоставление данных")}</summary>
    <button type="button" onClick={()=>change({...options,statusMap:undefined,categoryMap:undefined,fieldMap:undefined,optionMap:undefined,memberMap:undefined,fieldValues:undefined})}>{t("Сбросить")}</button>
    {record.kind==='task'?<>
     {record.manifest.projects[0].statuses.filter(status=>record.manifest.tasks.some(task=>task.statusKey===status.key)).map(status=><label key={status.key}><span data-no-translate>{status.title}</span> · {t("Статус")}<select value={options.statusMap?.[status.key]??preview.tasks.find(task=>record.manifest.tasks.find(row=>row.key===task.key)?.statusKey===status.key)?.statusRef??""} onChange={event=>change({...options,statusMap:{...options.statusMap,[status.key]:event.target.value||null}})}><option value="">{t("Автоматически")}</option>{preview.statuses.filter(row=>!row.isDone).map(row=><option key={row.id} value={row.id} data-no-translate>{row.title}</option>)}</select></label>)}
     {record.manifest.projects[0].categories.map(category=><label key={category.key}><span data-no-translate>{category.title}</span> · {t("Категория")}<select value={Object.hasOwn(options.categoryMap??{},category.key)?options.categoryMap![category.key]??'omit':""} onChange={event=>{const categoryMap={...options.categoryMap};if(event.target.value==='')delete categoryMap[category.key];else categoryMap[category.key]=event.target.value==='omit'?null:event.target.value;change({...options,categoryMap});}}><option value="">{t("Автоматически")}</option><option value="omit">{t("Не переносится")}</option>{preview.categories.map(row=><option key={row.id} value={row.id} data-no-translate>{row.title}</option>)}</select></label>)}
     {options.include?.customFields!==false?preview.sourceFields.map(field=><label key={field.key}><span data-no-translate>{field.title}</span> · {t("Пользовательские поля")}<select value={mappedValue(options.fieldMap,field.key,preview.fieldMappings[record.manifest.projects[0].key]?.[field.key]??"")} onChange={event=>change({...options,fieldMap:{...options.fieldMap,[field.key]:event.target.value||null}})}><option value="">{t("Не задано")}</option>{preview.fields.filter(row=>row.type===field.type).map(row=><option key={row.id} value={row.id} data-no-translate>{row.title}</option>)}</select></label>):null}
    </>:<p>{t("Поля создаются только в новых проектах и не меняют правила всего пространства.")}</p>}
    {sourceMembers.map((member,index)=><label key={member}>{t("Участник")} {new Intl.NumberFormat(language).format(index+1)} · <span data-no-translate>{preview.members.find(row=>row.id===member)?.title??t("Недоступный участник")}</span><select value={mappedValue(options.memberMap,member,preview.members.some(row=>row.id===member)?member:"")} onChange={event=>change({...options,memberMap:{...options.memberMap,[member]:event.target.value||null}})}><option value="">{t("Не назначен")}</option>{preview.members.map(row=><option key={row.id} value={row.id} data-no-translate>{row.title}</option>)}</select></label>)}
   </details>:null}
   <button type="submit" className="secondary-button" disabled={record.kind==='task'&&!options.projectId}>{t(preview?"Обновить предпросмотр":"Предпросмотр применения")}</button>
  </fieldset></form>
  {preview?<section className="template-result" aria-label={t("Предварительный результат")}>
   <h4>{t("Предварительный результат")}</h4><p>{t("Проектов: {projects}. Задач: {tasks}.").replace('{projects}',new Intl.NumberFormat(language).format(record.kind==='project'?preview.projects.length:0)).replace('{tasks}',new Intl.NumberFormat(language).format(preview.tasks.length))}</p>
   {!fresh?<p role="status">{t("Предпросмотр устарел. Обновите его перед применением.")}</p>:null}
   {record.kind==='project'?<details><summary>{t("Структура проекта")}</summary><ul>{preview.projects.map(project=><li key={project.key}><strong data-no-translate>{project.title}</strong>{project.parentKey?<span data-no-translate> · {preview.projects.find(row=>row.key===project.parentKey)?.title}</span>:null}<ul>{project.statuses.map(status=><li key={status.key} data-no-translate>{status.title}</li>)}</ul></li>)}</ul></details>:null}
   <details><summary>{t("Участники")}</summary><ul>{preview.members.map(member=><li key={member.id} data-no-translate>{member.title}</li>)}</ul></details>
   {preview.blockers.length?<section role="alert"><h4>{t("Нужно исправить")}</h4><SharedTemplateIssues issues={preview.blockers} record={record} language={language}/></section>:null}
   {preview.notices.length?<details open><summary>{t("Изменения и пропуски")}</summary><SharedTemplateIssues issues={preview.notices} record={record} language={language}/></details>:null}
   <ol className="template-task-preview">{shownTasks.map(task=>{
    const fields=[...preview.fields,...preview.newFields.filter(field=>field.projectKey===task.projectKey).map(field=>templateFieldDefinition(field,field.ref))];
    return <li key={task.key}><strong data-no-translate>{task.title}</strong><p><time dateTime={task.dueDate??undefined}>{date(task.dueDate)}</time>{task.startDate?<span> · {t("Начало")}: {date(task.startDate)}</span>:null}</p>
      <dl><div><dt>{t("Исполнитель")}</dt><dd data-no-translate>{preview.members.find(member=>member.id===task.assigneeId)?.title??t("Не назначен")}</dd></div><div><dt>{t("Чек-листы")}</dt><dd>{new Intl.NumberFormat(language).format(task.checklists.length)}</dd></div><div><dt>{t("Статус")}</dt><dd data-no-translate>{record.kind==='project'?preview.projects.find(project=>project.key===task.projectKey)?.statuses.find(status=>status.key===task.statusRef)?.title:preview.statuses.find(status=>status.id===task.statusRef)?.title}</dd></div>
      {task.parentKey?<div><dt>{t("Родительская задача")}</dt><dd data-no-translate>{preview.tasks.find(row=>row.key===task.parentKey)?.title}</dd></div>:null}</dl>
      {task.description?<details><summary>{t("Описание")}</summary><p data-no-translate>{task.description}</p></details>:null}
      {fields.length?<details open={preview.blockers.some(issue=>issue.taskKey===task.key&&issue.fieldRef!==undefined)}><summary>{t("Значения полей")}</summary><SharedCustomFieldInputs fields={fields} draftScope={`apply-task:${task.key}`} values={{...task.customValues,...options.fieldValues?.[task.key]}} mode={record.manifest.calendarMode} calculationContext={record.manifest.calendarContext} language={language} disabled={busy||recovery.locked||Boolean(receipt)} onChange={values=>change({...options,fieldValues:{...options.fieldValues,[task.key]:values}})}/></details>:null}
    </li>;
   })}</ol>
   {preview.tasks.length>20?<nav className="template-actions" aria-label={t("Страницы задач")}><button type="button" disabled={pageIndex===0} onClick={()=>setPageIndex(pageIndex-1)}>{t("Назад")}</button><span>{new Intl.NumberFormat(language).format(pageIndex+1)} / {new Intl.NumberFormat(language).format(Math.ceil(preview.tasks.length/20))}</span><button type="button" disabled={(pageIndex+1)*20>=preview.tasks.length} onClick={()=>setPageIndex(pageIndex+1)}>{t("Далее")}</button></nav>:null}
   <button type="button" className="primary-button" disabled={busy||recovery.locked||!fresh||!preview.canApply||Boolean(receipt)} onClick={()=>void apply()}>{t(onConfigured?"Сохранить настройки применения":"Создать из шаблона")}</button>
  </section>:null}
  {receipt?<p role="status">{t("Шаблон применён.")} <button type="button" disabled={busy} onClick={()=>void run(()=>onApplied(receipt))}>{t("Открыть созданное")}</button></p>:null}
  </NumberDraftProvider>{busy?<p role="status">{t("Загрузка…")}</p>:null}{error?<p role="alert">{error}</p>:null}
 </section>;
}
