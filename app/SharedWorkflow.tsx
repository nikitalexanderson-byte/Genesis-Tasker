"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { GenesisApiError } from './cloud-sync';
import { translateText, type Language } from './i18n';
import { planningAccessLost, planningText } from './shared-planning';
import { loadWorkflow, saveWorkflow, workflowDraft, workflowHistory, workflowRoles, workflowStatusesKey, type WorkflowCommand, type WorkflowRole, type WorkflowVersion } from './shared-workflows';
import { workflowError, workflowText } from './workflow-copy';
import {useSharedWorkDrafts} from './use-shared-work-drafts';
import {SharedWorkflowDrafts} from './SharedWorkflowDrafts';
import {validateWorkflowDeviceDraft,workflowDeviceSnapshot,type WorkflowDeviceDraft,type WorkflowDeviceSnapshot,type WorkflowEditorDraft} from './workflow-device-drafts';
import {workflowDraftText} from './workflow-draft-copy';
import type {WorkDraft} from './shared-work-draft-journal';
import './shared-workflows.css';
import {DraftNumberInput,NumberDraftProvider,type NumberDrafts} from './DraftNumberInput';
import {IconActionButton} from './IconActionButton';

type State=WorkflowDeviceSnapshot&{observedAt:string};
type Draft=WorkflowEditorDraft;
const roleLabels:Record<WorkflowRole,string>={owner:'Владелец',manager:'Менеджер',member:'Участник',commenter:'Комментатор',viewer:'Читатель'};

export function SharedWorkflow({userId,projectId,language,disabled,writeDisabled=false,onChanged,onAccessLost,initiallyExpanded=false}:{userId:string;projectId:string;language:Language;disabled:boolean;writeDisabled?:boolean;onChanged:()=>Promise<void>;onAccessLost:()=>void;initiallyExpanded?:boolean}) {
 const g=(text:string)=>translateText(text,language),t=(key:Parameters<typeof workflowText>[0])=>workflowText(key,language),d=(key:Parameters<typeof workflowDraftText>[0])=>workflowDraftText(key,language);
 const [data,setData]=useState<State|null>(null),[draft,setDraft]=useState<Draft|null>(null),[from,setFrom]=useState(''),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false),[retry,setRetry]=useState(false),[saved,setSaved]=useState(false);
 const [history,setHistory]=useState<{versions:WorkflowVersion[];nextCursor:number|null}|null>(null),[expanded,setExpanded]=useState(initiallyExpanded);
 const [verified,setVerified]=useState(false),[notice,setNotice]=useState<'restored'|'changed'|null>(null);
 const [source,setSource]=useState<WorkDraft<WorkflowDeviceDraft>|null>(null);
 const [numberInputs,setNumberInputs]=useState<NumberDrafts>({}),numberRef=useRef<NumberDrafts>({});
 const live=useRef(true),lock=useRef(false),reads=useRef(0),pending=useRef<WorkflowCommand|null>(null),sent=useRef(false),lost=useRef(onAccessLost),verifiedNow=useRef(false);
 const validate=useCallback((value:unknown)=>validateWorkflowDeviceDraft(value,projectId),[projectId]);
 const {rows:deviceRows,error:deviceError,status:deviceStatus,ready:deviceReady,writerId,stage,clearCurrent,refresh:refreshDevice,remove:removeDevice}=useSharedWorkDrafts(userId,projectId,'workflow',expanded,validate);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{lost.current=onAccessLost;},[onAccessLost]);
 const load=useCallback(async(signal?:AbortSignal)=>{
  const generation=++reads.current;
  const value=await loadWorkflow(projectId,signal);if(live.current&&!signal?.aborted&&generation===reads.current){setData({...workflowDeviceSnapshot(value),observedAt:new Date().toISOString()});verifiedNow.current=navigator.onLine;setVerified(navigator.onLine);setError((current:unknown)=>current instanceof GenesisApiError||current instanceof Error&&['WORKFLOW_DEVICE_PENDING','WORKFLOW_DEVICE_PERSIST'].includes(current.message)?current:null);}return value;
 },[projectId]);
 const fail=useCallback((reason:unknown,invalidate=true)=>{if(!live.current)return;if(invalidate||planningAccessLost(reason)){verifiedNow.current=false;setVerified(false);}setError(reason);if(planningAccessLost(reason)){setData(null);setDraft(null);setHistory(null);pending.current=null;setSource(null);setRetry(false);lost.current();}},[]);
 useEffect(()=>{
  if(!expanded)return;const controller=new AbortController();
  const refresh=()=>{if(!lock.current)void load(controller.signal).catch(reason=>{if(!controller.signal.aborted)fail(reason);});};refresh();
  const timer=window.setInterval(()=>{if(navigator.onLine&&document.visibilityState==='visible')refresh();},15000);
  return()=>{controller.abort();window.clearInterval(timer);};
 },[load,fail,expanded]);
 useEffect(()=>{const connection=()=>{if(!navigator.onLine){verifiedNow.current=false;reads.current++;setVerified(false);}else if(expanded&&!lock.current)void load().catch(fail);};window.addEventListener('online',connection);window.addEventListener('offline',connection);return()=>{window.removeEventListener('online',connection);window.removeEventListener('offline',connection);};},[expanded,load,fail]);
 useEffect(()=>{if(!draft||deviceStatus!=='error'&&!(error instanceof Error&&error.message==='WORKFLOW_DEVICE_PERSIST'))return;const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[draft,deviceStatus,error]);
 const canManage=Boolean(data?.context.project.permissions?.manageProjects);
 const blocked=disabled||writeDisabled||busy||retry||!canManage||!verified||!deviceReady;
 const stale=Boolean(draft&&data&&(draft.config.revision!==data.config.revision||draft.statusesKey!==workflowStatusesKey(data.context.statuses)));
 const fields=[['description',t('description')],['assigneeId',g('Исполнитель')],['dueDate',t('dueDate')],['startDate',t('startDate')],['categoryId',t('category')],['labels',g('Метки')],['storyPoints',planningText('points',language)],['estimateHours',planningText('hours',language)],
  ...(data?.context.customFieldDefinitions??[]).filter(field=>!field.archived).map(field=>['custom:'+field.id,field.title])];
 const deviceDocument=(editor:Draft|null,command:WorkflowCommand|null,context=data,nextFrom=from)=>{
  if(!context)throw new Error('DRAFT_NOT_READY');return validateWorkflowDeviceDraft({version:1,projectId,observedAt:context.observedAt,snapshot:workflowDeviceSnapshot(context),draft:editor,pending:command,fromStatusId:nextFrom,numberInputs:numberRef.current},projectId);
 };
 const editDraft=(next:Draft,nextFrom=from,context=data)=>{setDraft(next);if(error instanceof Error&&error.message==='WORKFLOW_INVALID')setError(null);if(context){try{void stage(deviceDocument(next,pending.current,context,nextFrom)).catch(()=>undefined);}catch{setError(new Error('WORKFLOW_DEVICE_PERSIST'));}}};
 const restore=(record:WorkDraft<WorkflowDeviceDraft>)=>{
  if(lock.current||draft||retry)return;const value=validate(record.value);numberRef.current=value.numberInputs??{};setNumberInputs(numberRef.current);setSource(record);if(!verifiedNow.current)setData({...value.snapshot,observedAt:value.observedAt});setDraft(value.draft);setFrom(value.fromStatusId);pending.current=value.pending;sent.current=Boolean(value.pending);setRetry(Boolean(value.pending));setError(value.pending?new Error('WORKFLOW_DEVICE_PENDING'):null);setSaved(false);setNotice('restored');
 };
 const discard=async()=>{if(lock.current||retry)return;try{await clearCurrent(null);setSource(null);setDraft(null);setError(null);setNotice(null);}catch(reason){setError(reason);}};
 const attempt=async(command:WorkflowCommand)=>{
  // Current ACL/storage failures cannot settle an earlier unconfirmed send.
  if(lock.current||disabled||writeDisabled||!verifiedNow.current||!navigator.onLine)return;const replaying=sent.current;lock.current=true;reads.current++;setBusy(true);setError(null);setSaved(false);let journaled=false,committed=false,original:WorkflowDeviceDraft|null=null;
  try {
   original=deviceDocument(draft,command);await stage(original);journaled=true;sent.current=true;const result=await saveWorkflow(projectId,command);committed=true;const cleared=await clearCurrent(source);pending.current=null;sent.current=false;setSource(null);if(!live.current)return;
   setData(current=>current?{...current,...result}:current);setDraft(null);setRetry(false);setHistory(null);setSaved(true);
   setNotice(cleared.changed?'changed':null);
   await load();await onChanged();
  }catch(reason){if(live.current){const rejected=reason instanceof GenesisApiError&&reason.status>=400&&reason.status<500,uncertain=pending.current!==null&&(replaying||journaled&&!rejected);if(!uncertain){pending.current=null;sent.current=false;if(original&&journaled&&!committed)void stage({...original,pending:null}).catch(()=>undefined);}setRetry(uncertain);fail(reason,!rejected);if(!journaled)setError(new Error('WORKFLOW_DEVICE_PERSIST'));}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 };
 const run=(values:Omit<WorkflowCommand,'requestId'>)=>{if(blocked||pending.current)return;const command={...values,requestId:crypto.randomUUID()};pending.current=command;sent.current=false;void attempt(command);};
 const start=()=>{if(!data||blocked)return;numberRef.current={};setNumberInputs({});setError(null);editDraft({config:workflowDraft(data.config,data.context.statuses),statusesKey:workflowStatusesKey(data.context.statuses)},'');setSaved(false);setNotice(null);setFrom('');};
 const submit=(event:FormEvent)=>{event.preventDefault();if(!draft||stale||!draft.config.transitions.every(edge=>edge.roles.length>0))return;run({enabled:true,expectedRevision:draft.config.revision,statuses:draft.config.statuses,transitions:draft.config.transitions});};
 const rebase=async()=>{if(lock.current||!draft)return;lock.current=true;setBusy(true);try{const fresh=await load();if(live.current)editDraft({config:workflowDraft({...draft.config,revision:fresh.config.revision},fresh.context.statuses),statusesKey:workflowStatusesKey(fresh.context.statuses)},from,{...workflowDeviceSnapshot(fresh),observedAt:new Date().toISOString()});}catch(reason){fail(reason);}finally{lock.current=false;if(live.current)setBusy(false);}};
 const moreHistory=async()=>{if(lock.current||history&&history.nextCursor===null)return;lock.current=true;setBusy(true);try{const next=await workflowHistory(projectId,history?.nextCursor??undefined);if(live.current)setHistory(current=>({versions:[...(current?.versions??[]),...next.versions],nextCursor:next.nextCursor}));}catch(reason){fail(reason);}finally{lock.current=false;if(live.current)setBusy(false);}};
 const retryCommand=async()=>{const command=pending.current;if(!command||lock.current||writeDisabled)return;try{await load();if(pending.current?.requestId===command.requestId)await attempt(command);}catch(reason){fail(reason);}};
 return <details className="shared-workflow" data-workflow-panel open={expanded} onToggle={event=>{if(event.target===event.currentTarget)setExpanded(event.currentTarget.open);}}>
  <summary>{t('heading')}</summary>
  <p>{t('hint')}</p>
  <SharedWorkflowDrafts rows={deviceRows.filter(row=>row.id!==writerId&&row.id!==source?.id)} status={deviceStatus} error={deviceError} blocked={busy||retry} editing={Boolean(draft)} language={language} onRestore={restore} onRemove={record=>{void removeDevice(record).catch(()=>undefined);}} onRefresh={()=>void refreshDevice()}/>
  {data&&!verified?<p role="status">{d('cached')} <time dateTime={data.observedAt}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(data.observedAt))}</time></p>:null}
  {notice?<p role="status">{d(notice)}</p>:null}
  {error?<div role="alert"><p>{error instanceof Error&&error.message==='WORKFLOW_DEVICE_PENDING'?d('pending'):error instanceof Error&&error.message==='WORKFLOW_DEVICE_PERSIST'?d('error'):workflowError(error,language)??g('Не удалось получить ответ. Обновите отчёт или повторите запрос.')}</p>{retry?<button type="button" className="secondary-button" disabled={busy||disabled||writeDisabled} onClick={()=>void retryCommand()}>{g('Повторить')}</button>:<button type="button" className="secondary-button" disabled={busy||disabled} onClick={()=>{setError(null);void load().catch(fail);}}>{g('Обновить')}</button>}</div>:null}
  {saved?<p role="status">{t('saved')}</p>:null}
  {!data?<p role="status">{g('Загрузка…')}</p>:<>
   <p>{t(data.config.enabled?'enabled':'disabled')} · {t('revision')}: {new Intl.NumberFormat(language).format(data.config.revision)}</p>
   {!draft&&canManage?<div className="shared-planning-actions"><IconActionButton icon="settings" label={t('configure')} disabled={blocked} onClick={start}/>{data.config.enabled?<button type="button" className="secondary-button" disabled={blocked} onClick={()=>run({enabled:false,expectedRevision:data.config.revision})}>{t('disable')}</button>:null}</div>:null}
   {!draft&&data.config.enabled?<dl className="shared-workflow-counts">{data.config.statuses.map(rule=><div key={rule.statusId}><dt>{data.context.statuses.find(status=>status.id===rule.statusId)?.title??g('Недоступно')}</dt><dd>{new Intl.NumberFormat(language).format(data.counts[rule.statusId]??0)}{rule.wipLimit!==null?` / ${new Intl.NumberFormat(language).format(rule.wipLimit)}`:''}</dd></div>)}</dl>:null}
   {draft&&writeDisabled&&!disabled?<p role="status">{g('Нет доступа')}</p>:null}
   {draft?<form onSubmit={submit} aria-label={t('heading')}><NumberDraftProvider values={numberInputs} onChange={value=>{numberRef.current=value;setNumberInputs(value);void stage(deviceDocument(draft,null)).catch(()=>undefined);}}>
    <fieldset disabled={blocked}><legend>{g('Настройки')}</legend>
     <div className="shared-workflow-statuses">{draft.config.statuses.map((rule,index)=>{
      const status=data.context.statuses.find(status=>status.id===rule.statusId),options=[...fields,...rule.requiredFields.filter(key=>!fields.some(([id])=>id===key)).map(key=>[key,g('Недоступно')])];
      return <details key={rule.statusId} className="shared-workflow-status" data-workflow-status={rule.statusId} open={index===0?true:undefined}><summary>{status?.title??g('Недоступно')} · {g('Задачи')}: {data.counts[rule.statusId]??0}</summary>
       {!status?.isDone?<label>{t('limit')}<DraftNumberInput draftKey={rule.statusId} integer min={0} max={1000000} optional value={rule.wipLimit} placeholder={t('noLimit')} invalidMessage={workflowError(new Error('WORKFLOW_INVALID'),language)??t('limit')} onValue={limit=>editDraft({...draft,config:{...draft.config,statuses:draft.config.statuses.map(row=>row.statusId===rule.statusId?{...row,wipLimit:limit}:row)}})}/></label>:null}
       <fieldset className="shared-workflow-checks"><legend>{t('required')}</legend>{options.map(([id,label])=><label key={id}><input type="checkbox" checked={rule.requiredFields.includes(id)} onChange={event=>editDraft({...draft,config:{...draft.config,statuses:draft.config.statuses.map(row=>row.statusId===rule.statusId?{...row,requiredFields:event.target.checked?[...row.requiredFields,id]:row.requiredFields.filter(key=>key!==id)}:row)}})}/><span>{label}</span></label>)}</fieldset>
      </details>;
     })}</div>
     <details className="shared-workflow-transitions"><summary>{t('transitions')}</summary><p>{t('accessHint')}</p>
      <label>{g('Статус')}<select value={from} onChange={event=>{setFrom(event.target.value);if(draft)editDraft(draft,event.target.value);}}><option value="">{t('entry')}</option>{data.context.statuses.map(status=><option value={status.id} key={status.id}>{status.title}</option>)}</select></label>
      {data.context.statuses.filter(status=>status.id!==from).map(status=>{
       const source=from||null,edge=draft.config.transitions.find(edge=>edge.fromStatusId===source&&edge.toStatusId===status.id);
       const replace=(roles:WorkflowRole[]|null)=>editDraft({...draft,config:{...draft.config,transitions:[...draft.config.transitions.filter(edge=>edge.fromStatusId!==source||edge.toStatusId!==status.id),...(roles?[{fromStatusId:source,toStatusId:status.id,roles}]:[])]}});
       return <fieldset key={status.id} className="shared-workflow-edge" data-workflow-target={status.id}><legend><label><input type="checkbox" checked={Boolean(edge)} onChange={event=>replace(event.target.checked?[...workflowRoles]:null)}/><span>{status.title}</span></label></legend>
        {edge?<fieldset className="shared-workflow-checks"><legend>{t('roles')}</legend>{workflowRoles.map(role=><label key={role}><input type="checkbox" checked={edge.roles.includes(role)} onChange={event=>replace(event.target.checked?[...edge.roles,role]:edge.roles.filter(value=>value!==role))}/><span>{g(roleLabels[role])}</span></label>)}</fieldset>:null}
       </fieldset>;
      })}
     </details>
     <p>{t('safety')}</p>
     {stale?<div role="status"><p>{t('conflict')}</p><button type="button" className="secondary-button" onClick={()=>void rebase()}>{t('rebase')}</button></div>:null}
     {draft.config.transitions.some(edge=>!edge.roles.length)?<p role="status">{t('invalidError')}</p>:null}
    </fieldset>
    <div className="shared-planning-actions"><button type="submit" className="primary-button" disabled={blocked||stale||draft.config.transitions.some(edge=>!edge.roles.length)}>{data.config.enabled?g('Сохранить'):t('enable')}</button><button type="button" className="secondary-button" disabled={busy||retry} onClick={()=>void discard()}>{t('cancel')}</button></div>
   </NumberDraftProvider></form>:null}
   <details className="shared-workflow-history"><summary>{g('История')}</summary>{history?.versions.map(version=><details key={version.revision}><summary>{t('revision')} {new Intl.NumberFormat(language).format(version.revision)} · {new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(version.createdAt))} · {t(version.enabled?'enabled':'disabled')}</summary>
    <dl className="shared-workflow-counts">{version.statuses.map(rule=><div key={rule.statusId}><dt>{data.context.statuses.find(status=>status.id===rule.statusId)?.title??g('Недоступно')}</dt><dd>{t('limit')}: {rule.wipLimit??'—'} · {t('required')}: {rule.requiredFields.map(id=>fields.find(([key])=>key===id)?.[1]??g('Недоступно')).join(', ')||'—'}</dd></div>)}</dl>
   </details>)}{!history||history.nextCursor!==null?<button type="button" className="secondary-button" disabled={busy||disabled} onClick={()=>void moreHistory()}>{t(history?'more':'load')}</button>:null}</details>
  </>}
 </details>;
}
