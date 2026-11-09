"use client";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CalendarDatePicker } from "./CalendarDatePicker";
import {RecordCalendarChoice} from './RecordCalendarChoice';
import { calendarContext, type CalendarContext } from "./calendar-context";
import { type CalendarMode } from "./calendar-data";
import { DialogCloseButton } from "./DialogCloseButton";
import { IconActionButton } from "./IconActionButton";
import { useSacredFeaturesEnabled } from "./sacred-features";
import { SharedBulkActions } from "./SharedBulkActions";
import { useSharedTaskPage } from "./use-shared-task-page";
import { sharedPriorityLabel, sharedTaskDetailsError } from "./shared-task-details";
import { editableSharedViewDefinition, repairSharedViewContext } from "./shared-saved-view-model";
import { translateText as t } from "./i18n";
import { getRuntimeLanguage } from "./i18n";
import { SharedCustomFieldFilter } from "./SharedCustomFieldFilter";
import { customFieldsError, type SharedCustomField } from "./shared-custom-fields";
import {useSavedViewDrafts} from './use-saved-view-drafts';
import {WorkDraftError} from './shared-work-draft-journal';
import {workflowDraftText,workflowDraftError} from './workflow-draft-copy';
import {prepareSavedViewDeviceDraft,savedViewPayload,sendSavedViewDeviceDraft,type SavedViewEditorDraft} from './saved-view-device-drafts';
import { GenesisApiError, GenesisNetworkTimeoutError, deleteSharedSavedView, listSharedSavedViews, loadSharedSavedView, loadSharedViewOptions, saveSharedSavedView, listSharedCustomFields,
  type SharedSavedView, type SharedSavedViewDefinition, type SharedSavedViewPage, type SharedSpace, type SharedTask,
  type SharedTaskCriteria, type SharedTaskFilter, type SharedViewOptionKind, type SharedViewOptionsPage } from "./cloud-sync";
import "./shared-saved-views.css";

type Draft = SavedViewEditorDraft;
const fresh=(mode:CalendarMode,inputMode:CalendarMode):Draft=>({definition:{version:1,title:"",filter:{},sort:"position",relative:"none",calendarMode:mode,calendarContext:calendarContext()},inputCalendar:{mode:inputMode,context:calendarContext()},spaceId:null,visibility:"personal",dirty:false});
const message=(error:unknown,fallback="Не удалось загрузить данные")=>error instanceof TypeError||error instanceof GenesisNetworkTimeoutError?t(fallback):customFieldsError(error)??sharedTaskDetailsError(error)??t(error instanceof Error?error.message:fallback);
const temporaryViewReadFailure=(reason:unknown)=>reason instanceof TypeError||reason instanceof GenesisNetworkTimeoutError||reason instanceof GenesisApiError&&(reason.status===408||reason.status===429||reason.status>=500);
const viewReadMessage=(reason:unknown)=>reason instanceof GenesisApiError&&(reason.status===408||reason.status>=500)?t("Не удалось загрузить данные"):message(reason);
const strings=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];
const subscribeOnline=(callback:()=>void)=>{window.addEventListener("online",callback);window.addEventListener("offline",callback);return()=>{window.removeEventListener("online",callback);window.removeEventListener("offline",callback);};};
const onlineSnapshot=()=>navigator.onLine;
const serverOnline=()=>true;
function payload(draft:Draft):SharedSavedViewDefinition {
  const value=savedViewPayload(draft);return {...value,title:value.title||t('Представление')};
}

export function ViewChoice({kind,label,filter,value,onChange,online}:{kind:SharedViewOptionKind;label:string;filter:Pick<SharedTaskCriteria,"spaceId"|"projectIds">;value:string[];onChange:(value:string[])=>void;online:boolean}) {
  const key=JSON.stringify([kind,filter]),[state,setState]=useState<{key:string;page:SharedViewOptionsPage}|null>(null),[failure,setFailure]=useState<{key:string;reason:unknown}|null>(null),[pending,setPending]=useState<{key:string;id:number}|null>(null),[retry,setRetry]=useState(0);
  const generation=useRef(0),requestController=useRef<AbortController|null>(null),feedbackId=useId();
  const load=useCallback((cursor:string|null,signal:AbortSignal)=>{
    const [optionKind,scope]=JSON.parse(key) as [SharedViewOptionKind,Pick<SharedTaskCriteria,"spaceId"|"projectIds">];
    return loadSharedViewOptions(optionKind,scope,cursor,signal);
  },[key]);
  useEffect(()=>{const clear=()=>{++generation.current;requestController.current?.abort();requestController.current=null;setState(null);setFailure(null);setPending(null);};window.addEventListener('offline',clear);return()=>window.removeEventListener('offline',clear);},[]);
  useEffect(()=>{
    if(!online)return;
    const controller=new AbortController(),current=++generation.current;requestController.current=controller;
    void load(null,controller.signal).then(page=>{
      if(!controller.signal.aborted&&current===generation.current){setState({key,page});setFailure(null);}
    }).catch(reason=>{if(!controller.signal.aborted&&current===generation.current){setState(null);setFailure({key,reason});}}).finally(()=>{if(requestController.current===controller)requestController.current=null;});
    const invalidate=()=>{++generation.current;requestController.current?.abort();requestController.current=null;};
    return()=>{invalidate();controller.abort();};
  },[key,load,online,retry]);
  const page=online&&state?.key===key?state.page:null,activeFailure=online&&failure?.key===key?failure:null,reason=activeFailure?.reason;
  const error=activeFailure?viewReadMessage(reason):"",busy=online&&pending?.key===key,loading=online&&(!page&&!error||busy);
  const base=kind==="assignees"?[{id:"me",title:t("Назначено мне")},{id:"unassigned",title:t("Без исполнителя")}]:[];
  const options=[...base,...(page?.options??[])],missing=value.filter(id=>!options.some(option=>option.id===id));
  const more=async()=>{
    if(!page?.nextCursor||busy||!online||requestController.current)return;
    const current=generation.current,controller=new AbortController();requestController.current=controller;setPending({key,id:current});setFailure(null);
    try{
      const next=await load(page.nextCursor,controller.signal);
      if(!controller.signal.aborted&&current===generation.current){setState({key,page:{...next,options:[...new Map([...page.options,...next.options].map(option=>[option.id,option])).values()]}});setFailure(null);}
    }catch(reason){if(current===generation.current&&!controller.signal.aborted){
      // Only temporary transport/server failures may keep authorized picker pages.
      if(!temporaryViewReadFailure(reason))setState(null);
      setFailure({key,reason});
    }}
    finally{if(requestController.current===controller)requestController.current=null;setPending(previous=>previous?.id===current?null:previous);}
  };
  const reload=()=>{if(page?.nextCursor)void more();else if(!requestController.current){setFailure(null);setRetry(previous=>previous+1);}};
  return <div className="saved-view-choice" aria-busy={loading}><label>{label}<select multiple size={4} value={value} aria-describedby={error||loading?feedbackId:undefined} onChange={event=>onChange(Array.from(event.target.selectedOptions,option=>option.value))}>
    {missing.map(id=><option key={id} value={id} data-no-translate>{t("Выбрано")} · {id.slice(0,8)}</option>)}{options.map(option=><option key={option.id} value={option.id} data-no-translate>{option.title}</option>)}
  </select></label>{loading?<small id={feedbackId} role="status">{t("Загружаем данные…")}</small>:null}{error?<p id={feedbackId} className="shared-error" role="alert">{error}</p>:null}
    {error?<IconActionButton icon="map-refresh" label={t("Повторить загрузку")} disabled={busy||!online} onClick={reload}/>:page?.hasMore?<IconActionButton icon="chevron-down" label={t("Показать ещё")} disabled={busy||!online} onClick={()=>void more()}/>:null}
  </div>;
}

export function SharedSavedViews({userId,spaces,mode,inputMode=mode,opened,onClose,onOpen}:{userId:string;spaces:SharedSpace[];mode:CalendarMode;inputMode?:CalendarMode;opened:boolean;onClose:()=>void;onOpen:(task:SharedTask)=>void}) {
  const writer=useSavedViewDrafts(userId,opened,()=>fresh(mode,inputMode)),draft=writer.draft;
  const [deviceDraftsOpen,setDeviceDraftsOpen]=useState(false);
  const setDraft=(value:Draft|((previous:Draft)=>Draft))=>{setDeviceDraftsOpen(false);if(typeof value==='function')writer.update(value);else writer.write(value);};
  const d=(key:Parameters<typeof workflowDraftText>[0])=>workflowDraftText(key,getRuntimeLanguage());
  const [editor,setEditor]=useState(draft.dirty),[libraryOpen,setLibraryOpen]=useState(true),[list,setList]=useState<SharedSavedViewPage|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[listLoading,setListLoading]=useState(false),[listError,setListError]=useState<{reason:unknown;more:boolean}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const sacredFeaturesEnabled=useSacredFeaturesEnabled();
  const inputCalendar=draft.inputCalendar??{mode:inputMode,context:calendarContext()};
  const dateMode=sacredFeaturesEnabled?inputCalendar.mode:'profane';
  // Keep an unsaved hidden draft intact for re-enabling; display and submit the same visible mode.
  const effectiveDraft = !draft.id && draft.definition && !sacredFeaturesEnabled
    ? {...draft,definition:{...draft.definition,calendarMode:"profane" as const}} : draft;
  useEffect(()=>{const element=dialog.current;if(opened&&!element?.open)element?.showModal();else if(!opened&&element?.open)element.close();},[opened]);
  const [metadata,setMetadata]=useState<SharedSavedView|null>(null),[filter,setFilter]=useState<SharedTaskFilter|null>(null),[optionsVersion,setOptionsVersion]=useState(0);
  const [customFields,setCustomFields]=useState<{spaceId:string;items:SharedCustomField[]}>({spaceId:"",items:[]});
  useEffect(()=>{if(!opened||!draft.spaceId)return;const controller=new AbortController(),spaceId=draft.spaceId;
    void listSharedCustomFields(spaceId,undefined,controller.signal).then(items=>{if(!controller.signal.aborted)setCustomFields({spaceId,items});}).catch(error=>{if(!controller.signal.aborted){setCustomFields({spaceId:'',items:[]});setFilter(null);setError(message(error));}});
    return()=>controller.abort();},[opened,draft.spaceId,optionsVersion]);
  const rolesKey=spaces.map(space=>`${space.id}:${space.role}`).sort().join("|");
  const online=useSyncExternalStore(subscribeOnline,onlineSnapshot,serverOnline),operation=useRef(false),listGeneration=useRef(0),listController=useRef<AbortController|null>(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(signal?.aborted)return;
    const controller=new AbortController(),abort=()=>controller.abort();listController.current?.abort();listController.current=controller;signal?.addEventListener('abort',abort,{once:true});
    const generation=++listGeneration.current;setListLoading(true);setListError(null);
    try{const result=await listSharedSavedViews(null,controller.signal);if(!controller.signal.aborted&&generation===listGeneration.current){setList(result);setListError(null);}}
    catch(reason){if(!controller.signal.aborted&&generation===listGeneration.current){if(!temporaryViewReadFailure(reason)){setList(null);setMetadata(null);setFilter(null);setCustomFields({spaceId:'',items:[]});}setListError({reason,more:false});}}
    finally{signal?.removeEventListener('abort',abort);if(listController.current===controller)listController.current=null;if(generation===listGeneration.current)setListLoading(false);}
  },[]);
  useEffect(()=>{if(!opened||!online)return;const controller=new AbortController();const initial=window.setTimeout(()=>void refresh(controller.signal),0),changed=()=>void refresh(controller.signal),invalidate=()=>{++listGeneration.current;listController.current?.abort();};window.addEventListener("genesis:shared-updates",changed);return()=>{invalidate();controller.abort();window.clearTimeout(initial);window.removeEventListener("genesis:shared-updates",changed);};},[opened,refresh,online]);
  useEffect(()=>{
    if(!opened||!draft.id||!online)return;
    const controller=new AbortController();let generation=0;
    const refreshMetadata=()=>{
      if(document.visibilityState!=="visible")return;
      const current=++generation;
      void loadSharedSavedView(draft.id!,controller.signal).then(view=>{if(!controller.signal.aborted&&generation===current)setMetadata(view);})
        .catch(error=>{if(!controller.signal.aborted&&generation===current){setMetadata(null);setFilter(null);setCustomFields({spaceId:'',items:[]});setError(message(error));}});
    };
    refreshMetadata();window.addEventListener("genesis:shared-updates",refreshMetadata);window.addEventListener("focus",refreshMetadata);
    document.addEventListener("visibilitychange",refreshMetadata);
    return()=>{controller.abort();window.removeEventListener("genesis:shared-updates",refreshMetadata);window.removeEventListener("focus",refreshMetadata);document.removeEventListener("visibilitychange",refreshMetadata);};
  },[opened,draft.id,online,rolesKey]);
  useEffect(()=>{const clear=()=>{++listGeneration.current;listController.current?.abort();listController.current=null;setListLoading(false);setListError(null);setList(null);setMetadata(null);setCustomFields({spaceId:'',items:[]});};window.addEventListener('offline',clear);return()=>window.removeEventListener('offline',clear);},[]);
  const tasks=useSharedTaskPage(opened&&online?filter:null);
  const definition=effectiveDraft.definition;
  const editDraft=(edit:(previous:Draft)=>Draft)=>{if(writer.locked||operation.current||!writer.ready)return;setFilter(null);setDraft(edit);};
  const update=(patch:Partial<SharedSavedViewDefinition>)=>editDraft(previous=>previous.definition?({...previous,dirty:true,definition:{...previous.definition,...patch}}):previous);
  const criteria=(patch:Partial<SharedTaskCriteria>)=>{if(definition)update({filter:{...definition.filter,...patch}});};
  const ids=(name:"projectIds"|"statusIds"|"assigneeIds"|"labelIds",value:string[])=>{if(!definition)return;const next={...definition.filter};if(value.length)next[name]=value;else delete next[name];update({filter:next});};
  const replace=()=>!operation.current&&!writer.locked&&writer.ready&&(!draft.dirty||window.confirm(t("Заменить несохранённые условия представления?")));
  const openView=(view:SharedSavedView)=>{
    if(!replace())return;
    const editable=editableSharedViewDefinition(view.definition),invalid=view.invalid||!editable;
    setMetadata(view);setDraft({definition:editable?view.definition:null,damagedDefinition:editable?undefined:view.definition,id:view.id,revision:view.revision,spaceId:view.spaceId,visibility:view.visibility,dirty:false,inputCalendar:{mode:inputMode,context:calendarContext()}});
    setEditor(Boolean(invalid));setOptionsVersion(previous=>previous+1);setFilter(invalid?null:{savedViewId:view.id});setError(invalid?t("Часть условий больше недоступна. Исправьте представление перед открытием."):"");
    setLibraryOpen(false);
  };
  const preset=(name:string,criteria:SharedTaskCriteria,relative:SharedSavedViewDefinition["relative"]="none")=>{
    if(!replace())return;const next=fresh(mode,inputMode);next.definition={...next.definition!,title:t(name),filter:criteria,relative};
    setDraft(next);setMetadata(null);setEditor(false);setLibraryOpen(false);setOptionsVersion(previous=>previous+1);setFilter({viewDefinition:payload(next)});setError("");
  };
  const runMutation=async(work:()=>Promise<void>)=>{
    if(operation.current)return;operation.current=true;setBusy(true);setError('');
    try{await work();}catch(error){if(mounted.current)setError(writer.current.current?.phase==='pending'?d('pending'):error instanceof WorkDraftError||error instanceof Error&&error.message.startsWith('DRAFT_')?workflowDraftError(error,getRuntimeLanguage()):message(error));}
    finally{operation.current=false;if(mounted.current)setBusy(false);}
  };
  const finishMutation=async()=>{
    const result=await writer.finish();if(!mounted.current)return;
    const view=result.action==='save'?result.receipt as SharedSavedView:null;
    setMetadata(view?.id===result.draft.id?view:null);setFilter(!result.draft.dirty&&result.draft.id?{savedViewId:result.draft.id}:null);
    setEditor(result.draft.dirty);setError('');setOptionsVersion(value=>value+1);await refresh();
  };
  const sendPending=async()=>{
    const record=writer.current.current;if(!record)return;
    if(record.phase==='received'){await finishMutation();return;}
    await sendSavedViewDeviceDraft(record,{persist:writer.persist,send:async command=>{
      const body=JSON.parse(command.bodyJson);
      return command.action==='delete'?deleteSharedSavedView({id:command.id!,revision:body.expectedRevision},body.requestId):saveSharedSavedView(body,command.id??undefined);
    },definitiveRejection:error=>error instanceof GenesisApiError&&[400,403,404,409,422].includes(error.status)&&typeof error.payload?.error==='string'?error.payload.error:null});
    if(mounted.current)await finishMutation();
  };
  const save=async(copy=false)=>{
    if(writer.locked||!writer.ready)return;
    await runMutation(async()=>{
      if(!draft.definition?.title.trim())throw Error('VIEW_INVALID');const definition=payload(effectiveDraft),id=copy?null:draft.id??null,visibility=copy&&!canShare?'personal':draft.visibility;
      if(id){const current=await loadSharedSavedView(id);if(!mounted.current)return;if(!current.canEdit)throw new GenesisApiError(403,{error:'SHARED_FORBIDDEN'},'SHARED_FORBIDDEN');if(current.revision!==draft.revision)throw new GenesisApiError(409,{error:'VIEW_CONFLICT'},'VIEW_CONFLICT');}
      const command={action:'save' as const,id,bodyJson:JSON.stringify({requestId:crypto.randomUUID(),spaceId:draft.spaceId,visibility,definition,...(id?{expectedRevision:draft.revision}:{})})};
      await writer.persist(prepareSavedViewDeviceDraft(draft,command));await sendPending();
    });
  };
  const remove=async()=>{
    if(writer.locked||!writer.ready||!metadata||metadata.id!==draft.id||!window.confirm(t('Удалить представление? Задачи сохранятся.')))return;
    await runMutation(async()=>{const current=await loadSharedSavedView(metadata.id);if(!mounted.current)return;if(!current.canEdit)throw new GenesisApiError(403,{error:'SHARED_FORBIDDEN'},'SHARED_FORBIDDEN');if(current.revision!==draft.revision)throw new GenesisApiError(409,{error:'VIEW_CONFLICT'},'VIEW_CONFLICT');
      await writer.persist(prepareSavedViewDeviceDraft(draft,{action:'delete',id:current.id,bodyJson:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:draft.revision})}));await sendPending();});
  };
  const moreViews=async()=>{
    if(operation.current||!list?.nextCursor||listLoading||!online||listController.current)return;
    const controller=new AbortController();listController.current=controller;
    const generation=listGeneration.current;setListLoading(true);setListError(null);
    try{const next=await listSharedSavedViews(list.nextCursor,controller.signal);if(!controller.signal.aborted&&generation===listGeneration.current){setList({...next,views:[...new Map([...list.views,...next.views].map(view=>[view.id,view])).values()]});setListError(null);}}
    catch(reason){if(!controller.signal.aborted&&generation===listGeneration.current){if(!temporaryViewReadFailure(reason)){setList(null);setMetadata(null);setFilter(null);setCustomFields({spaceId:'',items:[]});}setListError({reason,more:true});}}
    finally{if(listController.current===controller)listController.current=null;if(generation===listGeneration.current)setListLoading(false);}
  };
  const listFailure=online&&listError!==null?viewReadMessage(listError.reason):"";
  let zoneError="";
  if(definition){try{calendarContext(definition.calendarContext);}catch{zoneError=t("Введите действительный часовой пояс IANA, например Europe/Moscow. Черновик сохранён.");}}
  const optionFilter={...(draft.spaceId?{spaceId:draft.spaceId}:{}),...(strings(definition?.filter.projectIds).length?{projectIds:strings(definition?.filter.projectIds)}:{})};
  const canShare=spaces.some(space=>space.id===draft.spaceId&&["owner","admin"].includes(space.role)),canEdit=!draft.id||(metadata?.id===draft.id&&metadata.canEdit);
  const scopeChanged=Boolean(draft.id&&metadata?.id===draft.id&&(metadata.spaceId!==draft.spaceId||metadata.visibility!==draft.visibility));
  const blocked=busy||writer.locked||!writer.ready;
  const damaged=writer.error instanceof WorkDraftError?writer.error.record:undefined;
  const download=(raw:string,name:string)=>{const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`genesis-view-draft-${name}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const repairedContext=!definition?repairSharedViewContext(draft.damagedDefinition,calendarContext()):null;
  const sortOptions=[["position","Порядок на доске"],["createdAt","Новые вверху"],["createdAtAsc","Старые вверху"],["priority","Приоритет"],["dueDate","Срок"],["title","Название"],["updatedAt","Последнее изменение"]]as const;
  return <dialog ref={dialog} className="shared-projects-modal shared-saved-views" aria-labelledby="saved-views-title" aria-describedby="saved-views-help" onCancel={event=>{event.preventDefault();onClose();}} onClose={onClose}>
    <header><h2 id="saved-views-title">{t("Сохранённые представления")}</h2><DialogCloseButton aria-label={t("Закрыть")} onClick={onClose}/></header>
    {opened?<div className="saved-views-content">
      <p id="saved-views-help" className="saved-view-intro">{t("Собирайте задачи из доступных проектов по нужным условиям. Представление сохраняет фильтры, а задачи остаются в своих проектах.")}</p>
      <section className="saved-view-device" aria-label={d('heading')}>
        {writer.status==='saving'||writer.status==='saved'&&draft.dirty?<p role="status" data-view-device-state={writer.status}>{d(writer.status)}</p>:null}
        {writer.error?<div role="alert"><p>{workflowDraftError(writer.error,getRuntimeLanguage())}</p><div className="saved-view-actions"><IconActionButton icon="map-refresh" label={t('Обновить')} disabled={busy} onClick={()=>{writer.retryMigration();void writer.refresh();}}/>{damaged?<IconActionButton icon="export" label={d('download')} onClick={()=>download(damaged.raw,damaged.id)}/>:null}</div></div>:null}
        {writer.rows.length?<details open={deviceDraftsOpen} onToggle={event=>{if(event.target===event.currentTarget)setDeviceDraftsOpen(event.currentTarget.open);}}><summary>{d('heading')} · {new Intl.NumberFormat(getRuntimeLanguage()).format(writer.rows.length)}</summary><ul>{writer.rows.map(row=><li key={row.id} data-view-device-draft={row.id}><div><strong data-no-translate>{row.value.edit.definition?.title||t('Представление')}</strong><time dateTime={row.at}>{new Intl.DateTimeFormat(getRuntimeLanguage(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.at))}</time></div><div className="saved-view-actions"><IconActionButton icon="edit" label={d('restore')} disabled={blocked} onClick={()=>{if(!replace())return;void runMutation(async()=>{await writer.adopt(row);if(mounted.current){setDeviceDraftsOpen(false);setMetadata(null);setFilter(null);setEditor(true);setLibraryOpen(false);}});}}/><IconActionButton icon="delete" label={d('discard')} disabled={busy||['pending','damaged'].includes(row.value.phase)&&row.value.attempts>0} onClick={()=>{if(window.confirm(d('discard')))void runMutation(async()=>{await writer.remove(row);});}}/></div></li>)}</ul></details>:null}
        {writer.record?.phase==='pending'?<div role={busy?'status':'alert'}><p>{busy?t('Загрузка…'):d('pending')}</p><div className="saved-view-actions"><button type="button" className="primary-button" disabled={busy||!online||!writer.ready} onClick={()=>void runMutation(sendPending)}>{t('Повторить')}</button>{writer.record.attempts===0?<button type="button" className="secondary-button" disabled={busy} onClick={()=>void runMutation(writer.resumeEditing)}>{d('edit')}</button>:null}</div></div>:null}
        {writer.record?.phase==='rejected'?<div role="alert"><p>{message(new Error(writer.record.error??'VIEW_INVALID'))}</p><button type="button" className="secondary-button" disabled={busy} onClick={()=>void runMutation(writer.resumeEditing)}>{d('edit')}</button></div>:null}
        {writer.record?.phase==='received'?<div role="status"><p>{t('Готово')}</p><button type="button" className="primary-button" disabled={busy} onClick={()=>void runMutation(finishMutation)}>{t('Продолжить')}</button></div>:null}
        {writer.record?.phase==='damaged'?<div role="alert"><p>{d('invalid')}</p><IconActionButton icon="export" label={d('download')} onClick={()=>download(JSON.stringify(writer.record?.legacy),'legacy')}/></div>:null}
      </section>
      <details className="saved-view-library-panel" open={libraryOpen} onToggle={event=>setLibraryOpen(event.currentTarget.open)}><summary>{t("Выбрать представление")}</summary>
      <div className="saved-view-library"><section aria-labelledby="saved-view-presets-title"><h3 id="saved-view-presets-title">{t("Быстрые подборки")}</h3>
      <p className="saved-view-hint">{t("Быстрые подборки сразу показывают задачи. Их условия можно изменить и сохранить как своё представление.")}</p>
      <div className="saved-view-presets" role="group" aria-label={t("Представления")}>
        <button type="button" className="secondary-button" disabled={blocked||!online} onClick={()=>preset("Назначено мне",{assigneeIds:["me"]})}>{t("Назначено мне")}</button>
        <button type="button" className="secondary-button" disabled={blocked||!online} onClick={()=>preset("Создано мной",{createdBy:"me"})}>{t("Создано мной")}</button>
        <button type="button" className="secondary-button" disabled={blocked||!online} onClick={()=>preset("Просрочено",{},"overdue")}>{t("Просрочено")}</button>
        <button type="button" className="secondary-button" disabled={blocked||!online} onClick={()=>preset("На этой неделе",{},"this-week")}>{t("На этой неделе")}</button>
        <button type="button" className="secondary-button" disabled={blocked||!online} onClick={()=>preset("Без исполнителя",{assigneeIds:["unassigned"]})}>{t("Без исполнителя")}</button>
        <button type="button" className="secondary-button" disabled={blocked||!online} onClick={()=>preset("Ожидает утверждения",{approvalPending:true})}>{t("Ожидает утверждения")}</button>
      </div>
      </section><section aria-labelledby="saved-view-library-title" aria-busy={listLoading&&online}><h3 id="saved-view-library-title">{t("Ваши подборки")}</h3>
      <p className="saved-view-hint">{t("Выберите сохранённую подборку или создайте новую. Задачи останутся в своих проектах.")}</p>
      <p className="saved-view-hint">{t("Личное представление видно только вам. Общим представлением могут пользоваться участники пространства с доступом к выбранным проектам.")}</p>
      {listLoading&&online?<p role="status">{t("Загружаем данные…")}</p>:null}
      {list&&!list.total&&!listLoading?<p>{t("Сохранённых представлений пока нет")}</p>:null}
      {listFailure?<p className="shared-error" role="alert">{listFailure}</p>:null}
      <div className="saved-view-list">{list?.views.map(view=><button type="button" className="secondary-button" disabled={blocked} key={view.id} onClick={()=>openView(view)} aria-pressed={filter?.savedViewId===view.id}><span data-no-translate>{typeof view.definition?.title==="string"?view.definition.title:t("Представление")}</span><small>{t(view.visibility==="shared"?"Общее":"Личное")}{view.invalid?` · ${t("Условия недоступны")}`:""}</small></button>)}</div>
      {list?.hasMore?<IconActionButton icon={listFailure&&listError?.more?"map-refresh":"chevron-down"} label={t(listFailure&&listError?.more?"Повторить загрузку":"Показать ещё")} disabled={busy||listLoading||!online} onClick={()=>void moreViews()}/>:null}
      <div className="saved-view-actions"><IconActionButton icon="plus" showLabel label={t("Новое представление")} disabled={blocked} onClick={()=>{if(replace()){setDraft(fresh(mode,inputMode));setMetadata(null);setEditor(true);setLibraryOpen(false);setFilter(null);setError("");}}}/><IconActionButton icon="undo" label={t("Сбросить")} disabled={busy} onClick={()=>{setFilter(null);setError("");}}/><IconActionButton icon="map-refresh" label={t(listFailure&&(!list||!listError?.more)?"Повторить загрузку":"Обновить")} disabled={busy||listLoading||!online} onClick={()=>{void refresh();setOptionsVersion(previous=>previous+1);}}/></div>
      </section></div>
      </details>
      {error&&!(writer.record?.phase==='pending'&&error===d('pending'))?<p role="alert">{error}</p>:null}{!online?<p role="status">{t("Для сохранения нужно подключение к интернету")}</p>:null}
      {editor||filter||draft.id?<div className="saved-view-current"><strong data-no-translate>{definition?.title||t("Представление")}</strong><IconActionButton icon={editor?"map-up":"edit"} label={t(editor?"Свернуть":"Изменить условия")} disabled={busy} aria-expanded={editor} aria-controls="saved-view-conditions" onClick={()=>setEditor(previous=>!previous)}/></div>:null}
      <div id="saved-view-conditions" hidden={!editor}>
      {editor&&!definition?<div role="alert"><p>{t("Сохранённые условия повреждены. Создайте новое представление или откройте исправленную версию.")}</p>
        {draft.damagedDefinition!==undefined?<IconActionButton icon="export" label={d('download')} onClick={()=>download(JSON.stringify(draft),'input')}/>:null}
        {repairedContext?<button type="button" className="secondary-button" disabled={busy} onClick={()=>editDraft(previous=>({...previous,definition:repairedContext,damagedDefinition:undefined,dirty:true}))}>{t("Восстановить календарь представления")}</button>:null}
        {draft.id&&canEdit?<button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>void remove()}>{t("Удалить")}</button>:null}</div>:null}
      {editor&&definition?<form className="saved-view-editor" onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={blocked}>
        <legend>{t("Условия")}</legend><p className="saved-view-hint">{t("Условия определяют состав списка. Нажмите «Показать задачи», чтобы проверить результат, затем сохраните представление.")}</p>
        <div className="saved-view-fields"><label>{t("Название")}<input required maxLength={160} value={definition.title} onChange={event=>update({title:event.target.value})}/></label>
          <label>{t("Пространство")}<select value={draft.spaceId??""} onChange={event=>editDraft(previous=>({...previous,spaceId:event.target.value||null,visibility:"personal",dirty:true}))}><option value="">{t("Все пространства")}</option>{spaces.map(space=><option key={space.id} value={space.id}>{space.title}</option>)}</select></label>
          <label>{t("Доступ")}<select value={draft.visibility} onChange={event=>editDraft(previous=>({...previous,visibility:event.target.value as Draft["visibility"],dirty:true}))}><option value="personal">{t("Личное")}</option><option value="shared" disabled={!canShare}>{t("Общее")}</option></select></label>
          <label>{t("Поиск")}<input value={typeof definition.filter.q==="string"?definition.filter.q:""} maxLength={200} onChange={event=>criteria({q:event.target.value})}/></label>
        </div>
        <p className="saved-view-hint">{t("Пустой выбор включает все доступные проекты. Условия не выдают доступ к задачам.")}</p>
        {scopeChanged?<p role="status">{t("Чтобы изменить пространство или доступ, сохраните новое представление.")}</p>:null}
        <div className="saved-view-fields"><ViewChoice key={`projects-${optionsVersion}`} kind="projects" label={t("Проекты")} filter={draft.spaceId?{spaceId:draft.spaceId}:{}} value={strings(definition.filter.projectIds)} onChange={value=>ids("projectIds",value)} online={online}/>
          <ViewChoice key={`statuses-${optionsVersion}`} kind="statuses" label={t("Статусы")} filter={optionFilter} value={strings(definition.filter.statusIds)} onChange={value=>ids("statusIds",value)} online={online}/>
          <ViewChoice key={`assignees-${optionsVersion}`} kind="assignees" label={t("Исполнители")} filter={optionFilter} value={strings(definition.filter.assigneeIds)} onChange={value=>ids("assigneeIds",value)} online={online}/>
          <ViewChoice key={`labels-${optionsVersion}`} kind="labels" label={t("Метки")} filter={optionFilter} value={strings(definition.filter.labelIds)} onChange={value=>ids("labelIds",value)} online={online}/>
          <label>{t("Приоритет")}<select multiple size={4} value={(Array.isArray(definition.filter.priority)?definition.filter.priority:[]).map(String)} onChange={event=>{const filter={...definition.filter},selected=Array.from(event.target.selectedOptions,option=>Number(option.value));if(selected.length)filter.priority=selected;else delete filter.priority;update({filter});}}>{[0,1,2,3].map(priority=><option key={priority} value={priority}>{sharedPriorityLabel(priority)}</option>)}</select></label>
          <label>{t("Теги")}<input value={draft.tagsInput??strings(definition.filter.tags).join(", ")} onChange={event=>{const tagsInput=event.target.value,filter={...definition.filter},tags=tagsInput.split(/[,;]+/).map(tag=>tag.trim().replace(/^#/,"")).filter(Boolean);if(tags.length)filter.tags=tags;else delete filter.tags;editDraft(previous=>({...previous,tagsInput,dirty:true,definition:{...definition,filter}}));}}/></label>
          <label className="saved-view-toggle">{t("Создано мной")}<input type="checkbox" checked={definition.filter.createdBy==="me"} onChange={event=>{const filter={...definition.filter};if(event.target.checked)filter.createdBy="me";else delete filter.createdBy;update({filter});}}/></label>
          <label className="saved-view-toggle">{t("Ожидает утверждения")}<input type="checkbox" checked={definition.filter.approvalPending===true} onChange={event=>criteria({approvalPending:event.target.checked})}/></label>
          <label>{t("Выполнение")}<select value={definition.filter.completion??"any"} onChange={event=>criteria({completion:event.target.value as SharedTaskCriteria["completion"]})}><option value="any">{t("Все задачи")}</option><option value="open">{t("Текущие")}</option><option value="completed">{t("Завершённые")}</option></select></label>
          <label>{t("Сортировка")}<select value={definition.sort} onChange={event=>update({sort:event.target.value as SharedSavedViewDefinition["sort"]})}>{sortOptions.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
          {(customFields.spaceId===draft.spaceId?customFields.items:[]).filter(field=>field.type!=="multi").flatMap(field=>(['asc','desc'] as const).map(direction=><option key={`${field.id}:${direction}`} value={`custom:${field.id}:${direction}`} data-no-translate>{field.title} · {t(direction==='asc'?'По возрастанию':'По убыванию')}</option>))}
          {!sortOptions.some(([value])=>value===definition.sort)&&!customFields.items.some(field=>definition.sort.startsWith(`custom:${field.id}:`))?<option value={definition.sort}>{t('Недоступно')}</option>:null}</select></label>
          <label>{t("Период")}<select value={definition.relative} onChange={event=>update({relative:event.target.value as SharedSavedViewDefinition["relative"]})}>{([ ["none","Фиксированный диапазон"],["overdue","Просрочено"],["this-week","На этой неделе"],["this-month","В этом месяце"]]as const).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
          {sacredFeaturesEnabled ? <label>{t("Календарь")}<select value={definition.calendarMode} onChange={event=>update({calendarMode:event.target.value as CalendarMode})}>{([ ["profane","Григорианский"],["sacred","Сакральный"],["lunar","Лунный"]]as const).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label> : null}
          <label>{t("Начало года")}<select value={definition.calendarContext.gregorianYearStart} onChange={event=>update({calendarContext:{...definition.calendarContext,gregorianYearStart:event.target.value as CalendarContext["gregorianYearStart"]}})}><option value="january">{t("Январь")}</option><option value="march">{t("Март")}</option></select></label>
          <label>{t("Часовой пояс")}<input value={definition.calendarContext.timeZone} aria-invalid={Boolean(zoneError)} aria-describedby={zoneError?"saved-view-zone-error":undefined} onChange={event=>update({calendarContext:{...definition.calendarContext,timeZone:event.target.value}})}/></label>
        </div>
        {zoneError?<p id="saved-view-zone-error" role="alert">{zoneError}</p>:null}
        {sacredFeaturesEnabled?<details className="saved-view-input-calendar"><summary>{t('Календарь ввода')}</summary><RecordCalendarChoice value={inputCalendar.mode} onChange={mode=>setDraft(previous=>({...previous,inputCalendar:{...inputCalendar,mode}}))}/></details>:null}
        <SharedCustomFieldFilter fields={customFields.spaceId===draft.spaceId?customFields.items:[]} criteria={definition.filter.customFields??[]} onChange={customFields=>criteria({customFields})} language={getRuntimeLanguage()} mode={dateMode} calculationContext={inputCalendar.context} disabled={blocked}/>
        {definition.relative==="none"&&!zoneError?<div className="saved-view-dates">{([ ["dueFrom","Начало"],["dueTo","Окончание"]]as const).map(([key,label])=><label key={key}>{t(label)}<CalendarDatePicker mode={dateMode} calculationContext={inputCalendar.context} value={definition.filter[key]??""} ariaLabel={t(label)} onChange={value=>{const filter={...definition.filter};if(value)filter[key]=value;else delete filter[key];update({filter});}}/></label>)}</div>:null}
        <div className="saved-view-actions"><button type="button" className="secondary-button" disabled={busy||!online||Boolean(zoneError)} onClick={()=>{setFilter({viewDefinition:payload(effectiveDraft)});setEditor(false);setError("");}}>{t("Показать задачи")}</button>
          <button type="submit" className="primary-button" disabled={busy||!online||!canEdit||scopeChanged||Boolean(zoneError)||Boolean(draft.id&&!draft.dirty)}>{t("Сохранить")}</button>
          {draft.id?<IconActionButton data-dialog-save-alternative="true" icon="copy" label={t("Сохранить как новое")} disabled={busy||!online||Boolean(zoneError)} onClick={()=>void save(true)}/>:null}
          <IconActionButton icon="undo" label={t("Сбросить условия")} onClick={()=>{update({filter:{},relative:"none"});setDraft(previous=>({...previous,tagsInput:undefined}));}}/>
          {draft.id&&canEdit?<IconActionButton icon="delete" label={t("Удалить")} disabled={busy||!online} onClick={()=>void remove()}/>:null}
        </div>
      </fieldset></form>:null}
      </div>
      {filter?<section className="saved-view-results" aria-label={t("Задачи")}><h3>{t("Задачи")}</h3><SharedBulkActions key={userId} userId={userId} filter={filter} page={tasks.page} sort={definition?.sort??"position"} mode={mode} online={online} loading={tasks.busy} queryError={tasks.error} onMore={()=>void tasks.more()} onRefresh={()=>void tasks.refresh()} onOpen={onOpen}/></section>:null}
    </div>:null}
  </dialog>;
}
