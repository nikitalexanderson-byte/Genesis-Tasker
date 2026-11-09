"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Mindmaps, { type MindmapTaskRequest } from "./Mindmaps";
import { SharedTaskCreate } from "./SharedTaskCreate";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { loadSharedProject, loadSharedTask, querySharedTasks, approveSharedTask, updateSharedTask, captureAccountSessionGuard,
  type GenesisProject, type GenesisTask, type SharedProject, type SharedProjectSnapshot, type SharedSpace, type SharedTask } from "./cloud-sync";
import { useSharedTaskPage } from "./use-shared-task-page";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import type { CalendarMode } from "./calendar-data";
import type { TimeFormat } from "./time-format";

type Props = {userId:string;space:SharedSpace;projects:SharedProject[];projectId:string;language:string;enabledCalendars:CalendarMode[];timeFormat:TimeFormat;
  afterWorkspace?:ReactNode;
  onClose:()=>void;onTask:(task:SharedTask,snapshot:SharedProjectSnapshot)=>void;onProject:(id:string,calendar?:boolean)=>void};

function mapTask(task:SharedTask, snapshot:SharedProjectSnapshot):GenesisTask {
  return {id:task.id,title:task.title,description:task.description,projectId:task.projectId,project:snapshot.project.title,
    sacredYear:1,monthIndex:0,day:1,dueDate:task.dueDate??"",endDate:"",time:task.startTime??"",endTime:task.endTime??"",
    entryType:task.entryType,categoryId:task.categoryId,tags:task.tags??[],dependsOnIds:task.dependsOnIds??[],priority:task.priority ?? 0,
    done:Boolean(task.completedAt || snapshot.statuses.find(status=>status.id===task.statusId)?.isDone),completedAt:task.completedAt??null,
    reminders:[],reminderMinutes:null,recurrence:"none",recurrenceMode:"none",recurrencePattern:"none",recurrenceInterval:1,
    recurrenceDays:[],recurrenceStartDate:null,recurrenceEndDate:null,recurrenceMonths:[],recurrencePyatas:[],recurrenceExcludedDates:[],recurrenceSeriesId:null,
    calendarMode:"profane",calendarNote:"",syncToGoogle:false,syncAccountIds:[],googleLinks:{},googleAccountId:null,googleAccountEmail:"",
    createdIn:"genesis",googleEventId:null,googleTaskId:null,googleTaskListId:null,googleTaskListTitle:"",
    googleReadOnly:false,updatedAt:Date.parse(task.updatedAt)};
}
function ConversionDialog({request,language,enabledCalendars,timeFormat,space,projectId,onClose,onSaved}:Props & {request:MindmapTaskRequest;onSaved:(task:SharedTask)=>Promise<void>}) {
  const ref=useDialogAccessibility<HTMLDivElement>(onClose);
  return <div className="modal-backdrop"><div className="editor-modal task-composer-modal" role="dialog" aria-modal="true" aria-label="Создать общую задачу" ref={ref} tabIndex={-1}>
    <header><h2>Создать общую задачу</h2><DialogCloseButton type="button" aria-label="Закрыть" onClick={onClose} /></header>
    <SharedTaskCreate language={language} enabledCalendars={enabledCalendars} timeFormat={timeFormat}
      initialSpaceId={space.id} fixedSpaceId={space.id} initialProjectId={request.projectId??projectId}
      initialTitle={request.title} mindmapSource={{mapId:request.mapId,nodeId:request.nodeId}} onSaved={onSaved}/>
  </div></div>;
}
export default function SharedMindmaps(props:Props) {
  const [resolved,setResolved]=useState<SharedTask[]>([]);
  const [referenceIds,setReferenceIds]=useState<string[]>([]);
  const [search,setSearch]=useState({q:"",inboxOnly:false,open:false,completed:false});
  const onTaskSearch=useCallback((q:string,inboxOnly:boolean,open:boolean,completed:boolean)=>setSearch({q,inboxOnly,open,completed}),[]);
  const referenceKey=JSON.stringify(referenceIds);
  const searchFilter={spaceId:props.space.id,q:search.q,...(search.inboxOnly ? {projectIds:props.projects.filter(project=>project.isInbox).map(project=>project.id)} : {})};
  const searchPage=useSharedTaskPage(search.open ? {...searchFilter,completion:"open"} : null,"title");
  const completedPage=useSharedTaskPage(search.open&&search.completed ? {...searchFilter,completion:"completed"} : null,"title");
  const snapshots:SharedProjectSnapshot[]=props.projects.map(project=>({project,statuses:[],categories:[],members:[],tasks:resolved.filter(task=>task.projectId===project.id)}));
  const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [conversion,setConversion]=useState<MindmapTaskRequest|null>(null);
  const live=useRef(true);const guard=useRef(captureAccountSessionGuard());
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const refresh=useCallback(async()=>{
    guard.current();const ids:string[]=JSON.parse(referenceKey), rows:SharedTask[]=[];
    for(let start=0;start<ids.length;start+=100){const page=await querySharedTasks({spaceId:props.space.id,ids:ids.slice(start,start+100)});guard.current();rows.push(...page.tasks);}
    if(live.current){setResolved(rows);setError("");setLoading(false);}
  },[referenceKey,props.space.id,setError,setLoading]);
  useEffect(()=>{let active=true;void refresh().catch(e=>{if(active&&live.current){setError(e instanceof Error?e.message:String(e));setLoading(false);}});return()=>{active=false;};},[refresh]);
  useEffect(()=>{const update=()=>{void refresh().catch(e=>{if(live.current)setError(String(e));});};window.addEventListener("genesis:shared-updates",update);return()=>window.removeEventListener("genesis:shared-updates",update);},[refresh]);
  const projects:GenesisProject[]=snapshots.filter(row=>!row.project.isInbox).map(({project},position)=>({id:project.id,parentId:project.parentId,
    categoryId:project.categoryId??null,title:project.title,description:project.description,tags:project.tags??[],status:"active",position}));
  const allTasks=[...new Map([...resolved,...searchPage.page?.tasks ?? [],...completedPage.page?.tasks ?? []].map(task=>[task.id,task])).values()];
  const mapKnown=(task:SharedTask)=>mapTask(task,snapshots.find(row=>row.project.id===task.projectId)!);
  const tasks=allTasks.filter(task=>snapshots.some(row=>row.project.id===task.projectId)).map(mapKnown);
  const find=async(task:GenesisTask)=>{if(!task.projectId)throw Error("TASK_NOT_FOUND");const [snapshot,source]=await Promise.all([loadSharedProject(task.projectId),loadSharedTask(task.projectId,task.id)]);return {snapshot,source};};
  if(loading)return <section><button type="button" onClick={props.onClose}>К общим делам</button><p role="status">Открываем зашифрованные карты…</p></section>;
  if(error && !snapshots.length)return <section><button type="button" onClick={props.onClose}>К общим делам</button><p role="alert">{error}</p><button type="button" onClick={()=>void refresh().catch(e=>setError(String(e)))}>Обновить</button></section>;
  return <div className="shared-mindmaps-workspace" data-space-id={props.space.id}>
    {error ? <p role="alert">{error}</p> : null}
    <Mindmaps key={props.space.id} userId={props.userId} spaceId={props.space.id} readOnly={!(props.space.permissions?.editTasks??props.space.role!=="guest")}
      afterWorkspace={props.afterWorkspace}
      onResolveTaskIds={setReferenceIds} onTaskSearch={onTaskSearch}
      taskSearch={{tasks:(searchPage.page?.tasks ?? []).filter(task=>snapshots.some(row=>row.project.id===task.projectId)).map(mapKnown),footer:<SharedTaskPageControls page={searchPage.page} loaded={searchPage.page?.tasks.length ?? 0} busy={searchPage.busy} onMore={()=>void searchPage.more()} onRefresh={()=>void searchPage.refresh()} error={searchPage.error}/>,completedTasks:(completedPage.page?.tasks??[]).filter(task=>snapshots.some(row=>row.project.id===task.projectId)).map(mapKnown),completedFooter:<SharedTaskPageControls page={completedPage.page} loaded={completedPage.page?.tasks.length??0} busy={completedPage.busy} onMore={()=>void completedPage.more()} onRefresh={()=>void completedPage.refresh()} error={completedPage.error}/>}}
      tasks={tasks} projects={projects} projectId={null} projectForTask={task=>snapshots.find(row=>row.project.id===task.projectId)?.project.isInbox ? null : task.projectId}
      taskCanEdit={task=>{const project=snapshots.find(row=>row.project.id===task.projectId)?.project;return Boolean(project&&(project.permissions?.editTasks ?? ["owner","manager","member"].includes(project.role)));}}
      onClose={props.onClose} onCreateTask={setConversion}
      onEditTask={task=>{void find(task).then(({snapshot,source})=>props.onTask(source,snapshot)).catch(error=>setError(String(error)));}}
      onToggleTask={task=>{void (async()=>{
        const {snapshot,source}=await find(task);
        if(task.done){const status=snapshot.statuses.find(value=>!value.isDone);if(!status)return;await updateSharedTask(source.projectId,source.id,{statusId:status.id,expectedRevision:source.revision});}
        else if(source.approvalRequired) await approveSharedTask(source.projectId,source.id);
        else {const status=snapshot.statuses.find(value=>value.isDone);if(!status)return;await updateSharedTask(source.projectId,source.id,{statusId:status.id,expectedRevision:source.revision});}
        await refresh();
      })().catch(e=>setError(e instanceof Error?e.message:String(e)));}}
      onCalendar={task=>{if(task.projectId)props.onProject(task.projectId,true);}} onProject={id=>props.onProject(id)}/>
    {conversion ? <ConversionDialog {...props} request={conversion} onClose={()=>setConversion(null)} onSaved={async task=>{
      guard.current();await conversion.repository.journal({mapId:conversion.mapId,nodeId:conversion.nodeId,taskId:task.id});
      guard.current();await refresh();if(live.current)setConversion(null);
    }}/> : null}
  </div>;
}
