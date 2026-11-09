"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { calendarContext, civilDateCarrier } from "./calendar-context";
import type { CalendarMode } from "./calendar-data";
import { DialogCloseButton } from "./DialogCloseButton";
import { IconActionButton } from "./IconActionButton";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import { runtimeLocale, translateText as t } from "./i18n";
import { privateDeviceAccessBlocked } from "./local-sign-out";
import { sharedPriorityLabel, sharedTaskDetailsError } from "./shared-task-details";
import { bulkActionLabels, bulkErrorLabels, bulkItemLabels, bulkPreviewRequest, bulkRecoveryKey, bulkStateLabels, readBulkRecovery,
  type BulkPreviewRequest, type BulkRecovery } from "./shared-bulk-model";
import { commandSharedBulk, listSharedBulkOperations, loadSharedBulkReport, loadSharedBulkScope, loadSharedBulkTask, loadSharedViewOptions, previewSharedBulk,
  type SharedBulkAction, type SharedBulkOperations, type SharedBulkReport, type SharedBulkScope, type SharedBulkSelection, type SharedTask,
  type SharedTaskFilter, type SharedTaskPage, type SharedTaskSort, type SharedViewOptionKind, type SharedViewOptionsPage } from "./cloud-sync";
import "./shared-bulk.css";

const number=(value:number)=>value.toLocaleString(runtimeLocale());
const errorText=(error:unknown)=>t(bulkErrorLabels[error instanceof Error?error.message:""]??"")||sharedTaskDetailsError(error)||t("Не удалось получить ответ. Обновите отчёт или повторите запрос.");
const dateLabel=(value:string)=>new Intl.DateTimeFormat(runtimeLocale(),{dateStyle:"medium"}).format(civilDateCarrier(value));
const stateLabel=(report:Pick<SharedBulkReport,"state">)=>t(bulkStateLabels[report.state]);

/** Bounded option pages retain explicit choices. Display names are user content. */
function BulkChoice({kind,filter,label,value,onChange,multiple=false,online}:{kind:SharedViewOptionKind;filter:{projectIds?:string[]};label:string;value:string[];onChange:(ids:string[])=>void;multiple?:boolean;online:boolean}) {
  const key=JSON.stringify([kind,filter]),[state,setState]=useState<{key:string;page:SharedViewOptionsPage}|null>(null),[failure,setFailure]=useState(""),[busy,setBusy]=useState(false);
  const generation=useRef(0),controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const current=++generation.current;if(!online)return;
    const abort=new AbortController();controller.current=abort;
    void loadSharedViewOptions(kind,filter,null,abort.signal).then(page=>{if(current===generation.current&&!abort.signal.aborted){setState({key,page});setFailure("");setBusy(false);}})
      .catch(error=>{if(current===generation.current&&!abort.signal.aborted){setFailure(errorText(error));setBusy(false);}});
    return()=>{abort.abort();controller.current?.abort();};
  // The serialized key includes the complete option predicate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,online]);
  const page=state?.key===key?state.page:null;
  const more=async()=>{
    if(!page?.nextCursor||busy)return;const current=generation.current,abort=new AbortController();controller.current=abort;setBusy(true);
    try{const next=await loadSharedViewOptions(kind,filter,page.nextCursor,abort.signal);if(current===generation.current&&!abort.signal.aborted)setState({key,page:{...next,options:[...page.options,...next.options]}});}
    catch(error){if(current===generation.current&&!abort.signal.aborted)setFailure(errorText(error));}finally{if(current===generation.current)setBusy(false);}
  };
  return <div className="bulk-choice"><label>{label}<select required={kind!=="assignees"} multiple={multiple} size={multiple?4:undefined} value={multiple?value:value[0]??""} onChange={event=>onChange(Array.from(event.target.selectedOptions,option=>option.value).filter(Boolean))}>
    {!multiple?<option value="">{t(kind==="assignees"?"Без исполнителя":"Выберите")}</option>:null}
    {value.filter(id=>!page?.options.some(option=>option.id===id)).map(id=><option key={id} value={id}>{t("Выбрано")}</option>)}
    {page?.options.map(option=><option key={option.id} value={option.id} data-no-translate>{option.title}</option>)}
  </select></label>{failure?<p role="alert">{failure}</p>:null}{!page&&!failure?<small role="status">{t("Загрузка…")}</small>:null}
    {page?.hasMore?<button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>void more()}>{t("Показать ещё")}</button>:null}
  </div>;
}

function BulkActionForm({selection,mode,online,busy,onPreview}:{selection:SharedBulkSelection;mode:CalendarMode;online:boolean;busy:boolean;onPreview:(action:SharedBulkAction)=>void}) {
  const selectionKey=JSON.stringify(selection),[scope,setScope]=useState<{key:string;data:SharedBulkScope}|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  const [kind,setKind]=useState<SharedBulkAction["kind"]>("priority"),[priority,setPriority]=useState(0),[assignees,setAssignees]=useState<string[]>([]),[labels,setLabels]=useState<string[]>([]),[labelMode,setLabelMode]=useState<"add"|"remove">("add");
  const [statuses,setStatuses]=useState<Record<string,string>>({}),[destination,setDestination]=useState<string[]>([]),[destinationStatus,setDestinationStatus]=useState<string[]>([]);
  const [dueMode,setDueMode]=useState<"set"|"shift"|"clear">("set"),[date,setDate]=useState(""),[days,setDays]=useState("1"),[calendar,setCalendar]=useState(mode),[retention,setRetention]=useState(30);
  const generation=useRef(0),moreController=useRef<AbortController|null>(null);
  useEffect(()=>{
    const current=++generation.current;if(!online)return;const controller=new AbortController();
    void loadSharedBulkScope(JSON.parse(selectionKey),null,controller.signal).then(data=>{if(current===generation.current&&!controller.signal.aborted){setScope({key:selectionKey,data});setError("");setLoading(false);}})
      .catch(error=>{if(current===generation.current&&!controller.signal.aborted){setError(errorText(error));setLoading(false);}});
    return()=>{controller.abort();moreController.current?.abort();};
  },[selectionKey,online]);
  const data=scope?.key===selectionKey?scope.data:null;
  const more=async()=>{
    if(!data?.nextCursor||loading)return;const current=generation.current,controller=new AbortController();moreController.current=controller;setLoading(true);
    try{const next=await loadSharedBulkScope(selection,data.nextCursor,controller.signal);if(current===generation.current&&!controller.signal.aborted)setScope({key:selectionKey,data:{...next,projects:[...data.projects,...next.projects]}});}
    catch(error){if(current===generation.current&&!controller.signal.aborted)setError(errorText(error));}finally{if(current===generation.current)setLoading(false);}
  };
  const projectFilter=data&&!data.hasMore?{projectIds:data.projects.map(project=>project.id)}:{};
  const submit=()=>{
    let action:SharedBulkAction;
    switch(kind){
      case "priority":action={kind,priority};break;
      case "assignee":action={kind,assigneeId:assignees[0]??null};break;
      case "status":action={kind,statusIds:Object.fromEntries(data!.projects.map(project=>[project.id,statuses[project.id]]))};break;
      case "labels":action={kind,mode:labelMode,labelIds:labels};break;
      case "due":action=dueMode==="set"?{kind,mode:dueMode,date}:dueMode==="shift"?{kind,mode:dueMode,days:Number(days)}:{kind,mode:dueMode};break;
      case "move":action={kind,projectId:destination[0],statusId:destinationStatus[0]};break;
      case "trash":action={kind,retentionDays:retention};break;
      default:action={kind:"archive"};
    }
    onPreview(action);
  };
  return <form className="bulk-action-form" onSubmit={event=>{event.preventDefault();submit();}}><fieldset disabled={busy||!online}>
    <div className="bulk-fields"><label>{t("Действие")}<select value={kind} onChange={event=>setKind(event.target.value as SharedBulkAction["kind"])}>{Object.entries(bulkActionLabels).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
      {kind==="priority"?<label>{t("Приоритет")}<select value={priority} onChange={event=>setPriority(Number(event.target.value))}>{[0,1,2,3].map(value=><option key={value} value={value}>{sharedPriorityLabel(value)}</option>)}</select></label>:null}
      {kind==="assignee"?<BulkChoice kind="assignees" label={t("Исполнитель")} filter={projectFilter} value={assignees} onChange={setAssignees} online={online}/>:null}
      {kind==="labels"?<><label>{t("Действие с метками")}<select value={labelMode} onChange={event=>setLabelMode(event.target.value as "add"|"remove")}><option value="add">{t("Добавить")}</option><option value="remove">{t("Убрать")}</option></select></label><BulkChoice kind="labels" label={t("Метки")} filter={projectFilter} value={labels} onChange={setLabels} multiple online={online}/></>:null}
      {kind==="move"?<><BulkChoice kind="projects" label={t("Целевой проект")} filter={{}} value={destination} onChange={ids=>{setDestination(ids);setDestinationStatus([]);}} online={online}/>{destination.length?<BulkChoice key={destination[0]} kind="statuses" label={t("Статус в целевом проекте")} filter={{projectIds:destination}} value={destinationStatus} onChange={setDestinationStatus} online={online}/>:null}</>:null}
      {kind==="due"?<><label>{t("Изменение срока")}<select value={dueMode} onChange={event=>setDueMode(event.target.value as typeof dueMode)}><option value="set">{t("Установить дату")}</option><option value="shift">{t("Сдвинуть на дни")}</option><option value="clear">{t("Очистить срок")}</option></select></label>
        {dueMode==="set"?<><label>{t("Календарь ввода")}<select value={calendar} onChange={event=>setCalendar(event.target.value as CalendarMode)}>{([["profane","Григорианский"],["sacred","Сакральный"],["lunar","Лунный"]] as const).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label><label>{t("Новая дата")}<CalendarDatePicker mode={calendar} calculationContext={calendarContext()} value={date} required ariaLabel={t("Новая дата")} onChange={setDate}/></label></>:null}
        {dueMode==="shift"?<label>{t("Сдвиг в днях: минус — раньше, плюс — позже")}<input type="number" required min={-36600} max={36600} step={1} value={days} onChange={event=>setDays(event.target.value)}/></label>:null}</>:null}
      {kind==="trash"?<label>{t("Хранение в корзине")}<select value={retention} onChange={event=>setRetention(Number(event.target.value))}>{[1,7,30].map(value=><option key={value} value={value}>{new Intl.NumberFormat(runtimeLocale(),{style:"unit",unit:"day",unitDisplay:"long"}).format(value)}</option>)}</select></label>:null}
    </div>
    {kind==="status"?<div className="bulk-project-statuses">{data?.projects.map(project=><label key={project.id}><span data-no-translate>{project.title}</span><select required value={statuses[project.id]??""} onChange={event=>setStatuses(previous=>({...previous,[project.id]:event.target.value}))}><option value="">{t("Выберите статус")}</option>{project.statuses.map(status=><option key={status.id} value={status.id} data-no-translate>{status.title}</option>)}</select></label>)}</div>:null}
    {error?<p role="alert">{error}</p>:null}{!data&&!error?<p role="status">{t("Загрузка…")}</p>:null}
    {data?.hasMore?<button type="button" className="secondary-button" disabled={loading} onClick={()=>void more()}>{t("Показать ещё проекты")}</button>:null}
    <p className="bulk-hint">{t("Права, утверждение и изменения проверяются отдельно для каждой задачи.")}</p>
    <button type="submit" className="primary-button" disabled={!data||Boolean(error)||kind==="status"&&(data.hasMore||data.projects.length>1000)||kind==="due"&&(dueMode==="set"&&!date||dueMode==="shift"&&!Number(days))||kind==="move"&&(!destination.length||!destinationStatus.length)||kind==="labels"&&!labels.length}>{t("Предварительный просмотр")}</button>
  </fieldset></form>;
}

function ActionSummary({report}:{report:SharedBulkReport}) {
  const action=report.action,info=report.actionInfo;
  let value="";
  if(action.kind==="priority")value=sharedPriorityLabel(action.priority);
  if(action.kind==="assignee")value=action.assigneeId?info.assigneeName??t("Недоступно"):t("Без исполнителя");
  if(action.kind==="due")value=action.mode==="set"?dateLabel(action.date):action.mode==="clear"?t("Очистить срок"):new Intl.NumberFormat(runtimeLocale(),{style:"unit",unit:"day",unitDisplay:"long",signDisplay:"always"}).format(action.days);
  if(action.kind==="move")value=[info.projectTitle,info.statusTitle].filter(Boolean).join(" · ");
  if(action.kind==="labels")value=`${t(action.mode==="add"?"Добавить":"Убрать")} · ${info.labels?.map(label=>`${label.spaceTitle}: ${label.title}`).join(" · ")??""}`;
  if(action.kind==="trash")value=new Intl.NumberFormat(runtimeLocale(),{style:"unit",unit:"day",unitDisplay:"long"}).format(action.retentionDays);
  return <div className="bulk-action-summary"><strong>{t(bulkActionLabels[action.kind])}</strong>{value?<span data-no-translate>{value}</span>:null}
    {action.kind==="status"?info.statuses?.map(status=><span key={status.projectId} data-no-translate>{status.projectTitle} · {status.statusTitle}</span>):null}
    {info.unavailable?<span>{t("Часть выбранных данных больше недоступна.")}</span>:null}
  </div>;
}

export function SharedBulkActions({userId,filter,page,sort,mode,online,loading,queryError,onMore,onRefresh,onOpen}:{userId:string;filter:SharedTaskFilter|null;page:SharedTaskPage|null;sort:SharedTaskSort;mode:CalendarMode;online:boolean;loading:boolean;queryError:string;onMore:()=>void;onRefresh:()=>void;onOpen:(task:SharedTask)=>void}) {
  const [selecting,setSelecting]=useState(false),[picked,setPicked]=useState<{key:string;all:boolean;ids:string[]}>({key:"",all:false,ids:[]});
  const [recovery,setRecovery]=useState<BulkRecovery>({}),[view,setView]=useState<{id:string;trail:number[]}|null>(null),[result,setResult]=useState<{key:string;report:SharedBulkReport}|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[viewReload,setViewReload]=useState(0);
  const [history,setHistory]=useState<SharedBulkOperations|null>(null),[historyOpen,setHistoryOpen]=useState(false),[historyTrail,setHistoryTrail]=useState<(string|null)[]>([null]),[historyBusy,setHistoryBusy]=useState(false),[historyVersion,setHistoryVersion]=useState(0);
  const alive=useRef(false),mutating=useRef(false),mutationController=useRef<AbortController|null>(null),watchController=useRef<AbortController|null>(null),generation=useRef(0),request=useRef<BulkPreviewRequest|undefined>(undefined);
  const selectionKey=JSON.stringify([filter,page?.queryVersion]),after=view?.trail.at(-1)??0,viewKey=JSON.stringify([view?.id,after]);
  const report=result?.key===viewKey?result.report:null;
  const selection:SharedBulkSelection|null=filter&&page&&picked.key===selectionKey?(picked.all?{mode:"all",filter,sort,queryVersion:page.queryVersion}:picked.ids.length?{mode:"page",items:page.tasks.filter(task=>picked.ids.includes(task.id)).map(task=>({id:task.id,projectId:task.projectId,revision:task.revision}))}:null):null;
  const canAccept=useCallback(()=>alive.current&&!privateDeviceAccessBlocked(),[]);
  const persist=useCallback((next:BulkRecovery)=>{
    if(!canAccept())return;setRecovery(next);request.current=next.pending;
    try{if(Object.keys(next).length)localStorage.setItem(bulkRecoveryKey(userId),JSON.stringify(next));else localStorage.removeItem(bulkRecoveryKey(userId));}catch{/* Server history still recovers confirmed operations. */}
  },[userId,canAccept]);
  useEffect(()=>{
    alive.current=true;const timer=window.setTimeout(()=>{if(!canAccept())return;const saved=readBulkRecovery(localStorage,userId);request.current=saved.pending;setRecovery(saved);if(saved.operationId)setView({id:saved.operationId,trail:[0]});},0);
    return()=>{alive.current=false;window.clearTimeout(timer);watchController.current?.abort();mutationController.current?.abort();};
  },[userId,canAccept]);
  useEffect(()=>{
    if(!view?.id||!online||busy)return;
    const id=view.id,key=viewKey,current=++generation.current,controller=new AbortController();watchController.current=controller;let timer:number|undefined,fetching=false,observedState:string|undefined;
    const poll=async(advance=false)=>{
      if(fetching||controller.signal.aborted)return;
      if(document.visibilityState!=="visible"){timer=window.setTimeout(()=>void poll(),5000);return;}
      fetching=true;window.clearTimeout(timer);
      try{
        const next=advance?await commandSharedBulk(id,"advance",controller.signal,after):await loadSharedBulkReport(id,after,controller.signal);
        if(current!==generation.current||controller.signal.aborted||!canAccept())return;
        setResult({key,report:next});setError("");
        if(next.state!==observedState){observedState=next.state;setHistoryVersion(previous=>previous+1);}
        timer=window.setTimeout(()=>void poll(next.state==="running"),next.state==="running"?(next.retryAt?Math.max(2000,Math.min(60000,new Date(next.retryAt).getTime()-Date.now())):1500):5000);
      }catch(error){if(current===generation.current&&!controller.signal.aborted&&canAccept()){
        setError(errorText(error));
        if(error&&typeof error==="object"&&"status"in error&&[401,403,404].includes(Number(error.status)))setResult(null);
        else timer=window.setTimeout(()=>void poll(),5000);
      }}finally{fetching=false;}
    };
    timer=window.setTimeout(()=>void poll(),0);
    const refresh=()=>{if(document.visibilityState==="visible")void poll();};
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    return()=>{controller.abort();window.clearTimeout(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[view?.id,viewKey,after,online,busy,viewReload,canAccept]);
  const historyCursor=historyTrail.at(-1);
  useEffect(()=>{
    if(!historyOpen||!online)return;const controller=new AbortController();
    const timer=window.setTimeout(()=>{setHistoryBusy(true);void listSharedBulkOperations(historyCursor,controller.signal).then(next=>{if(!controller.signal.aborted&&canAccept()){setHistory(next);setError("");}})
      .catch(error=>{if(!controller.signal.aborted&&canAccept())setError(errorText(error));}).finally(()=>{if(!controller.signal.aborted&&canAccept())setHistoryBusy(false);});},0);
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[historyOpen,historyCursor,historyVersion,online,canAccept]);
  const preview=async(action?:SharedBulkAction)=>{
    if(mutating.current||!online||!canAccept())return;
    const input=action&&selection?bulkPreviewRequest(request.current,selection,action):request.current;if(!input)return;
    mutating.current=true;setBusy(true);watchController.current?.abort();++generation.current;
    const controller=new AbortController();mutationController.current=controller;persist({pending:input});
    try{const next=await previewSharedBulk(input,controller.signal);if(!canAccept()||controller.signal.aborted)return;
      persist({operationId:next.id});const nextView={id:next.id,trail:[0]};setView(nextView);setResult({key:JSON.stringify([next.id,0]),report:next});setError("");setHistoryVersion(previous=>previous+1);
    }catch(error){if(canAccept()&&!controller.signal.aborted)setError(errorText(error));}finally{mutating.current=false;if(canAccept())setBusy(false);}
  };
  const command=async(kind:"confirm"|"cancel"|"resume")=>{
    if(!view||mutating.current||!online||!canAccept())return;mutating.current=true;setBusy(true);watchController.current?.abort();++generation.current;
    const controller=new AbortController();mutationController.current=controller;
    try{const next=await commandSharedBulk(view.id,kind,controller.signal,after);if(!canAccept()||controller.signal.aborted)return;setResult({key:viewKey,report:next});setError("");setHistoryVersion(previous=>previous+1);if(kind!=="confirm")onRefresh();}
    catch(error){if(canAccept()&&!controller.signal.aborted)setError(errorText(error));}finally{mutating.current=false;if(canAccept())setBusy(false);}
  };
  const openTask=async(item:SharedBulkReport["items"][number])=>{
    if(!item.available||!item.projectId||!item.id||mutating.current||!online)return;mutating.current=true;setBusy(true);const controller=new AbortController();mutationController.current=controller;
    try{const task=await loadSharedBulkTask(item.projectId,item.id,controller.signal);if(canAccept()&&!controller.signal.aborted)onOpen(task);}
    catch(error){if(canAccept()&&!controller.signal.aborted)setError(errorText(error));}finally{mutating.current=false;if(canAccept())setBusy(false);}
  };
  const frozen=Boolean(view)||Boolean(recovery.pending)||busy;
  const openOperation=(id:string)=>{watchController.current?.abort();++generation.current;persist({operationId:id});setView({id,trail:[0]});setResult(null);setViewReload(previous=>previous+1);setError("");};
  const closeReport=()=>{watchController.current?.abort();++generation.current;persist({});setView(null);setResult(null);setError("");setPicked({key:selectionKey,all:false,ids:[]});setSelecting(false);};
  return <section className="shared-bulk" aria-label={t("Массовые действия")}>
    <div className="bulk-toolbar">{filter&&page?.total?<IconActionButton icon={selecting?"close":"check"} label={t(selecting?"Отменить выбор":"Выбрать задачи")} disabled={frozen||!online} aria-pressed={selecting} onClick={()=>{setSelecting(value=>!value);setPicked({key:selectionKey,all:false,ids:[]});}}/>:null}
      <IconActionButton icon="history" label={t("История массовых действий")} aria-expanded={historyOpen} disabled={busy} onClick={()=>setHistoryOpen(value=>!value)}/>
    </div>
    {historyOpen?<div className="bulk-history"><h3>{t("История массовых действий")}</h3>{historyBusy?<p role="status">{t("Загрузка…")}</p>:null}
      {history&&!history.operations.length?<p>{t("Массовых действий пока нет")}</p>:null}
      {!historyBusy?history?.operations.map(operation=><button type="button" className="secondary-button" key={operation.id} disabled={busy} onClick={()=>openOperation(operation.id)}><span>{t(operation.action?bulkActionLabels[operation.action.kind]:"Массовые действия")} · {stateLabel(operation)}</span><small>{new Date(operation.createdAt).toLocaleString(runtimeLocale())} · {number(operation.counts.affected)}</small></button>):null}
      <div className="bulk-buttons"><button type="button" className="secondary-button" disabled={historyTrail.length<2||historyBusy||!online} onClick={()=>setHistoryTrail(previous=>previous.slice(0,-1))}>{t("Назад")}</button><button type="button" className="secondary-button" disabled={!history?.nextCursor||historyBusy||!online} onClick={()=>{setHistory(null);setHistoryTrail(previous=>[...previous,history!.nextCursor!]);}}>{t("Далее")}</button><button type="button" className="secondary-button" disabled={historyBusy||!online} onClick={()=>setHistoryVersion(previous=>previous+1)}>{t("Обновить")}</button></div>
    </div>:null}
    {selecting&&!frozen?<div className="bulk-selection"><h3>{t("Массовые действия")}</h3><div className="bulk-buttons">
      <button type="button" className="secondary-button" disabled={!page?.tasks.length||page.tasks.length>1000||!online} onClick={()=>setPicked({key:selectionKey,all:false,ids:page!.tasks.map(task=>task.id)})}>{t("Выбрать показанные задачи")} · {number(page?.tasks.length??0)}</button>
      <button type="button" className="secondary-button" disabled={!page?.total||!online} aria-pressed={picked.key===selectionKey&&picked.all} onClick={()=>setPicked({key:selectionKey,all:true,ids:[]})}>{t("Все результаты фильтра")} · {number(page?.total??0)}</button>
      <button type="button" className="secondary-button" onClick={()=>setPicked({key:selectionKey,all:false,ids:[]})}>{t("Снять выбор")}</button>
    </div>{page&&page.tasks.length>1000?<p>{t("Для выбора более 1000 задач используйте все результаты фильтра.")}</p>:null}
      {picked.key!==selectionKey&&(picked.all||picked.ids.length)?<p role="status">{t("Выдача изменилась. Выберите задачи заново.")}</p>:null}
      {selection?<><p className="bulk-selection-count" role="status">{t(selection.mode==="all"?"Все результаты фильтра":"Выбрано среди показанных")} · <strong>{number(selection.mode==="all"?page!.total:selection.items.length)}</strong></p>
        <BulkActionForm selection={selection} mode={mode} online={online} busy={busy} onPreview={action=>void preview(action)}/></>:null}
    </div>:null}
    {recovery.pending?<div className="bulk-recovery"><p role="status">{t("Ответ о просмотре не получен. Повтор безопасен; задачи ещё не изменены.")}</p><div className="bulk-buttons"><button type="button" className="primary-button" disabled={busy||!online} onClick={()=>void preview()}>{t("Повторить запрос")}</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>persist({})}>{t("Отменить")}</button></div></div>:null}
    {error?<div role="alert"><p>{error}</p>{view?<button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>setViewReload(previous=>previous+1)}>{t("Обновить отчёт")}</button>:null}</div>:null}{!online&&view?<p role="status">{t("Операция сохранена на сервере. Подключитесь к интернету, чтобы получить отчёт.")}</p>:null}
    {view?<section className="bulk-report" aria-label={t("Отчёт о массовом действии")}><header><h3>{t(report?.state==="preview"?"Предварительный просмотр":"Отчёт о массовом действии")}</h3><DialogCloseButton aria-label={t("Закрыть отчёт")} disabled={busy} onClick={closeReport}/></header>
      {!report?<p role="status">{t("Загрузка…")}</p>:<><p className="bulk-state" role="status">{stateLabel(report)}</p><p>{t(report.mode==="all"?"Все результаты фильтра":"Выбрано среди показанных")}</p><ActionSummary report={report}/>
        <dl className="bulk-counts">{([["selected","Выбрано"],["affected","Всего в операции"],["succeeded","Выполнено"],["skipped","Пропущено"],["failed","Ошибки"],["pending","Ожидает"],["cancelled","Отменено"]]as const).map(([key,label])=><div key={key}><dt>{t(label)}</dt><dd>{number(report.counts[key])}</dd></div>)}</dl>
        {report.state==="preview"?<><p>{t("Выборка зафиксирована. Архив и корзина включают подзадачи; их число учтено в отчёте.")}</p><p>{t("Подтверждение доступно до {time}.").replace("{time}",new Date(report.expiresAt).toLocaleTimeString(runtimeLocale()))}</p></>:null}
        {report.retryAt||report.state==="failed"?<p role="status">{t("Обработка прервана. Выполненные изменения сохранены; повтор затронет только остаток.")}</p>:null}
        {report.state==="running"?<p>{t("Операция продолжится в фоне. Отчёт можно открыть в истории.")}</p>:null}
        {report.state==="cancelled"?<p>{t("Оставшиеся задачи отменены. Выполненные изменения сохранены.")}</p>:null}
        <div className="bulk-buttons">
          {report.state==="preview"?<button type="button" className="primary-button" disabled={busy||!online||!report.counts.affected} onClick={()=>void command("confirm")}>{t("Подтвердить действие")}</button>:null}
          {["preview","running"].includes(report.state)?<button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>void command("cancel")}>{t(report.state==="preview"?"Отменить":"Отменить оставшиеся")}</button>:null}
          {report.state==="failed"?<button type="button" className="primary-button" disabled={busy||!online} onClick={()=>void command("resume")}>{t("Продолжить обработку")}</button>:null}
          <button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>setViewReload(previous=>previous+1)}>{t("Обновить отчёт")}</button>
          {!["preview","running"].includes(report.state)?<button type="button" className="secondary-button" disabled={busy} onClick={closeReport}>{t("Новое массовое действие")}</button>:null}
        </div>
        <ol className="bulk-report-items">{report.items.map(item=><li key={item.cursor} className={`bulk-item-${item.state}`}><div>{item.available?<button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>void openTask(item)}><small data-no-translate>{item.projectTitle}</small><strong data-no-translate>{item.title}</strong></button>:<span data-no-translate>{item.title??t("Задача недоступна")}</span>}<span>{t(bulkItemLabels[item.state])}{!item.selected?` · ${t("Подзадача")}`:""}</span></div>
          {item.trashed?<small>{t("В корзине")}</small>:null}{item.code?<p>{t(bulkErrorLabels[item.code]??"")||sharedTaskDetailsError(new Error(item.code))||t("Действие не выполнено. Обновите задачу и проверьте её условия.")}</p>:null}
        </li>)}</ol>
        <div className="bulk-buttons"><button type="button" className="secondary-button" disabled={view.trail.length<2||busy||!online} onClick={()=>setView(previous=>previous?{...previous,trail:previous.trail.slice(0,-1)}:null)}>{t("Назад")}</button><span>{number(view.trail.length)}</span><button type="button" className="secondary-button" disabled={!report.nextCursor||busy||!online} onClick={()=>setView(previous=>previous?{...previous,trail:[...previous.trail,report.nextCursor!]}:null)}>{t("Далее")}</button></div>
      </>}
    </section>:null}
    {filter?<section className="saved-view-results" aria-label={t("Задачи")}><SharedTaskPageControls page={page} loaded={page?.tasks.length??0} busy={loading} onMore={onMore} onRefresh={onRefresh} error={queryError}/>
      <div className="saved-view-task-list bulk-task-list">{page?.tasks.map(task=><div className="bulk-task-row" key={task.id}>{selecting?<label className="bulk-task-check"><input type="checkbox" aria-label={t("Выбрать задачу: {title}").replace("{title}",task.title)} checked={picked.key===selectionKey&&(picked.all||picked.ids.includes(task.id))} disabled={frozen||picked.key===selectionKey&&(picked.all||picked.ids.length>=1000&&!picked.ids.includes(task.id))} onChange={event=>{const checked=event.target.checked;setPicked(previous=>({key:selectionKey,all:false,ids:checked?[...(previous.key===selectionKey?previous.ids:[]),task.id]:(previous.key===selectionKey?previous.ids:[]).filter(id=>id!==task.id)}));}}/></label>:null}
        <button type="button" className="secondary-button" onClick={()=>onOpen(task)}><small data-no-translate>{task.projectTitle}</small><strong data-no-translate>{task.title}</strong><span>{sharedPriorityLabel(task.priority??0)}</span></button></div>)}</div>
      {page?.total===0?<p>{t("Совпадений нет")}</p>:null}
    </section>:null}
  </section>;
}
