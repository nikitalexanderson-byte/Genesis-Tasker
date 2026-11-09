"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { formatCalendarDate, type CalendarMode } from "./calendar-data";
import type { SharedProjectSnapshot, SharedTask } from "./cloud-sync";
import { dateSerial, serialDate, taskSpan, ganttTaskGroups, ganttUnscheduledTasks, ganttUnscheduledSchedule, ganttSchedule, ganttCreationSchedule, ganttResizeSchedule, ganttAxisPosition, ganttAxisPoint, GANTT_CELL_WIDTH, type GanttEdge, type GanttSchedule, type GanttScale, type GanttReturnTarget } from "./shared-gantt";
import { translateText } from "./i18n";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { calendarGanttRange, calendarGanttPeriods, calendarGanttMonths, shiftGanttAnchor, sacredGanttDate, type GanttPeriod } from "./shared-gantt-calendar";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { ganttCopy } from "./gantt-copy";
import { useAffairDrag } from "./use-affair-drag";
import { formatTimeValue, type TimeFormat } from "./time-format";
import { useSharedTaskPage } from "./use-shared-task-page";
import { SharedDependencyDialog } from "./SharedDependencyPicker";
import { SharedTaskPageControls } from "./SharedTaskPageControls";
import { SharedTaskBatches } from "./SharedTaskBatches";
import { IconActionButton } from "./IconActionButton";
import { useMobileLayout } from "./use-mobile-layout";

type ResizeItem = {id:string;title:string;task:SharedTask;edge:GanttEdge;offset:number};
export function SharedGantt({snapshot,english,calendarMode,timeFormat,initialDay,onOpen,onCreate,onSchedule,onReturn,resolveReturn,onReturnTarget,busy,externalDrop,externalDropRow}:{snapshot:SharedProjectSnapshot;english:boolean;calendarMode:CalendarMode;timeFormat:TimeFormat;initialDay?:string;onOpen:(task:SharedTask)=>void;onCreate:(schedule:GanttSchedule)=>void;onSchedule:(task:SharedTask,schedule:GanttSchedule)=>void;onReturn:(task:SharedTask,target:GanttReturnTarget)=>void;resolveReturn:(x:number,y:number,task:SharedTask)=>GanttReturnTarget|null;onReturnTarget:(target:GanttReturnTarget|null)=>void;busy:boolean;externalDrop?:GanttSchedule;externalDropRow?:string}) {
  const root=useRef<HTMLElement>(null);
  const mobile=useMobileLayout();
  const [helpOpen,setHelpOpen]=useState(false);
  const [dependencyTask,setDependencyTask]=useState<SharedTask|null>(null);
  const helpTitle=useId();
  const helpRef=useDialogAccessibility<HTMLDivElement>(()=>setHelpOpen(false),helpOpen);
  const scrollRoot=useRef<HTMLDivElement>(null);
  const [availablePeriods,setAvailablePeriods]=useState(0);
  useEffect(()=>{
    const element=scrollRoot.current;
    if(!element)return;
    const observer=new ResizeObserver(()=>{
      const nameWidth=parseFloat(getComputedStyle(element).getPropertyValue("--gantt-name-width"))||180;
      setAvailablePeriods(Math.ceil(Math.max(0,element.clientWidth-nameWidth)/GANTT_CELL_WIDTH));
    });
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  const grabOffset=useRef(0);
  const canEdit=snapshot.project.permissions?.editTasks ?? ["owner","manager","member"].includes(snapshot.project.role);
  // Creating tasks uses the same editTasks permission as the task composer/API.
  const canCreate=canEdit;
  const createPointer=useRef<{x:number;y:number;moved:boolean}|null>(null);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const [anchor,setAnchor] = useState(initialDay || todayKey);
  const [scale,setScale] = useState<GanttScale>(initialDay ? "day" : "weeks");
  const [fit,setFit] = useState(false);
  const {active:initialTasks}=ganttTaskGroups(snapshot.tasks,snapshot.statuses);
  const range = calendarGanttRange(anchor,scale,initialTasks,calendarMode,fit,availablePeriods,snapshot.taskPage?.bounds);
  const rangePage = useSharedTaskPage({projectIds:[snapshot.project.id],completion:"open",scheduled:scale==="day"?"time":"date",from:serialDate(Math.floor(range.start)),to:serialDate(Math.ceil(range.end)-1)},"position",snapshot.taskPage?.queryVersion);
  const unscheduledPage = useSharedTaskPage({projectIds:[snapshot.project.id],completion:"open",unscheduled:scale==="day"?"time":"date"},"position",snapshot.taskPage?.queryVersion);
  const completedPage = useSharedTaskPage({projectIds:[snapshot.project.id],completion:"completed"},"updatedAt",snapshot.taskPage?.queryVersion);
  const {active:activeTasks}=ganttTaskGroups(rangePage.page?.tasks??[],snapshot.statuses);
  const completedTasks=completedPage.page?.tasks ?? [];
  const renderCompletedTask=(task:SharedTask)=><button type="button" key={task.id} onClick={()=>onOpen(task)}><ExperimentalIcon name="check"/><span data-no-translate>{task.title}</span></button>;
  const ticks = calendarGanttPeriods(range,scale,calendarMode);
  const axisPeriods=ticks.map(period=>({start:Math.max(range.start,period.start),end:Math.min(range.end,period.end)}));
  const width=axisPeriods.length*GANTT_CELL_WIDTH;
  const positionAt=(point:number)=>ganttAxisPosition(axisPeriods,point);
  const pointAt=(position:number)=>ganttAxisPoint(axisPeriods,position);
  const months = scale !== "day" && scale !== "months" ? calendarGanttMonths(range,calendarMode) : [];
  const periodStyle = (period:GanttPeriod) => ({left:positionAt(Math.max(range.start,period.start)),width:positionAt(Math.min(period.end,range.end))-positionAt(Math.max(period.start,range.start))});
  const gridLines = ticks.map(tick=><i className="shared-gantt-grid-line" key={tick.start} style={{left:periodStyle(tick).left}} aria-hidden="true"/>);
  const rows = activeTasks.map(task=>({task,span:taskSpan(task)})).filter(({span})=>span && (scale !== "day" || span.timed) && span.start<range.end && span.end>range.start);
  const unscheduled = ganttUnscheduledTasks(unscheduledPage.page?.tasks??[], scale);
  const axisProps={"data-gantt-axis":true,"data-gantt-start":range.start,"data-gantt-end":range.end,"data-gantt-scale":scale};
  const resize=useAffairDrag<ResizeItem,GanttSchedule>((x,_y,item)=>{
    const track=root.current?.querySelector<HTMLElement>(`[data-gantt-task="${CSS.escape(item.task.id)}"] .shared-gantt-track`);
    if(busy||!canEdit||!track)return null;
    const point=pointAt(x-track.getBoundingClientRect().left+item.offset);
    return ganttResizeSchedule(item.task,Math.max(range.start,Math.min(range.end,point)),scale,item.edge);
  },(item,schedule)=>onSchedule(item.task,schedule));
  const resizeProps=(task:SharedTask,edge:GanttEdge)=>{
    const item:ResizeItem={id:`${task.id}-${edge}`,title:task.title,task,edge,offset:0};
    const bindings=resize.props(item,!busy&&canEdit&&!task.pending);
    const offset=(x:number,element:HTMLElement)=>{
      const track=element.closest('.shared-gantt-track')!,span=taskSpan(task)!;
      const boundary=scale==="day" ? span[edge] : edge==="start" ? Math.floor(span.start) : Math.ceil(span.end);
      item.offset=positionAt(boundary)-(x-track.getBoundingClientRect().left);
    };
    return {...bindings,onPointerDown:(event:React.PointerEvent<HTMLElement>)=>{event.stopPropagation();offset(event.clientX,event.currentTarget);bindings.onPointerDown(event);if(event.pointerType==="mouse"&&event.button===0&&!busy&&canEdit&&!task.pending)event.currentTarget.setPointerCapture(event.pointerId);},onTouchStart:(event:React.TouchEvent<HTMLElement>)=>{event.stopPropagation();if(event.touches[0])offset(event.touches[0].clientX,event.currentTarget);bindings.onTouchStart(event);},onKeyDown:(event:React.KeyboardEvent<HTMLElement>)=>{
      if(!["ArrowLeft","ArrowRight"].includes(event.key)||busy||task.pending)return;
      event.preventDefault();event.stopPropagation();const span=taskSpan(task)!;
      const boundary=scale==="day" ? span[edge] : edge==="start" ? Math.floor(span.start) : Math.ceil(span.end);
      const schedule=ganttResizeSchedule(task,boundary+(event.key==="ArrowLeft" ? -1 : 1)*(scale==="day" ? 1/96 : 1),scale,edge);
      if(schedule)onSchedule(task,schedule);
    }};
  };
  const drag=useAffairDrag<SharedTask,{schedule?:GanttSchedule;row?:string;destination?:GanttReturnTarget}>((x,y,task)=>{
    const target=document.elementFromPoint(x,y)?.closest<HTMLElement>("[data-gantt-axis]");
    if(busy||!canEdit)return null;
    if(!target||!root.current?.contains(target)) {
      const destination=resolveReturn(x,y,task);
      return destination ? {destination} : null;
    }
    const point=pointAt(x-target.getBoundingClientRect().left-grabOffset.current);
    return {schedule:ganttSchedule(task,Math.max(range.start,Math.min(range.end-(scale==="day" ? 1/96 : 1),point)),scale),row:target.closest<HTMLElement>('[data-gantt-task]')?.dataset.ganttTask};
  },(task,target)=>{if(target.destination)onReturn(task,target.destination);else if(target.schedule)onSchedule(task,target.schedule);});
  useEffect(()=>{onReturnTarget(drag.target?.destination ?? null);},[drag.target?.destination,onReturnTarget]);
  useEffect(()=>()=>onReturnTarget(null),[onReturnTarget]);
  const dragProps=(task:SharedTask,bar=false)=>{
    const bindings=drag.props(task,!busy&&canEdit&&!task.pending);
    const offset=(x:number,element:HTMLElement)=>{const span=taskSpan(task);const start=span ? scale==="day" ? span.start : Math.floor(span.start) : range.start;grabOffset.current=bar ? x-element.getBoundingClientRect().left+Math.max(0,-positionAt(start)) : 0;};
    return {...bindings,onPointerDown:(event:React.PointerEvent<HTMLElement>)=>{offset(event.clientX,event.currentTarget);bindings.onPointerDown(event);if(event.pointerType==="mouse"&&event.button===0&&!busy&&canEdit&&!task.pending)event.currentTarget.setPointerCapture(event.pointerId);},onTouchStart:(event:React.TouchEvent<HTMLElement>)=>{if(event.touches[0])offset(event.touches[0].clientX,event.currentTarget);bindings.onTouchStart(event);}};
  };
  const drop=drag.target?.schedule||externalDrop;
  const dropSpan=drop ? taskSpan({...drag.preview?.item,...drop} as SharedTask) : null;
  const dropRow=drag.preview && rows.some(row=>row.task.id===drag.preview!.item.id) ? drag.preview.item.id : drag.target?.row||externalDropRow;
  const spanPosition=(span:NonNullable<ReturnType<typeof taskSpan>>)=>({x:Math.max(0,positionAt(scale==="day" ? span.start : Math.floor(span.start))),end:Math.min(width,positionAt(scale==="day" ? span.end : Math.ceil(span.end)))});
  const positions = new Map(rows.map(({task,span},index)=>{
    const live=resize.preview?.item.task.id===task.id&&resize.target ? taskSpan({...task,...resize.target}) : span;
    return [task.id,{...spanPosition(live!),y:index*56+28}];
  }));
  const dropPreview=dropSpan ? <span className="shared-gantt-drop-preview" style={{left:spanPosition(dropSpan).x,width:Math.max(4,spanPosition(dropSpan).end-spanPosition(dropSpan).x)}}/> : null;
  const activeSchedule=resize.target||drop;
  const formatDate = (key:string)=>formatCalendarDate(new Date(`${key}T12:00:00`),calendarMode);
  const createProps=(tick:GanttPeriod)=>({
    disabled:busy,
    "aria-label":`${english ? "Create task" : "Создать задачу"}: ${scale==="day" ? `${formatDate(todayKey)} ${formatTimeValue(ganttCreationSchedule(tick.start,scale,todayKey).startTime!,timeFormat)}` : formatDate(serialDate(tick.start))}`,
    onPointerDown:(event:React.PointerEvent<HTMLButtonElement>)=>{createPointer.current={x:event.clientX,y:event.clientY,moved:false};},
    onPointerMove:(event:React.PointerEvent<HTMLButtonElement>)=>{const p=createPointer.current;if(p&&Math.hypot(event.clientX-p.x,event.clientY-p.y)>5)p.moved=true;},
    onPointerCancel:()=>{if(createPointer.current)createPointer.current.moved=true;},
    onClick:(event:React.MouseEvent<HTMLButtonElement>)=>{
      if(busy||drag.preview||resize.preview||event.detail>0&&createPointer.current?.moved)return;
      const axis=event.currentTarget.closest<HTMLElement>("[data-gantt-axis]")!;
      const point=event.detail===0 ? tick.start : pointAt(event.clientX-axis.getBoundingClientRect().left);
      onCreate(ganttCreationSchedule(Math.max(range.start,Math.min(range.end-1/96,point)),scale,todayKey));
    },
  });
  const createCells=canCreate ? ticks.map(tick=><button type="button" className="shared-gantt-create-cell" key={tick.start} style={periodStyle(tick)} {...createProps(tick)}/>) : null;
  const shift = (direction:number)=>{setFit(false);setAnchor(shiftGanttAnchor(anchor,scale,calendarMode,direction));};
  const groupedLabel = calendarMode === "sacred" ? ganttCopy("pyatas") : calendarMode === "lunar" ? (english ? "Ten-day periods" : "Декады") : (english ? "Weeks" : "Недели");
  return <section className="shared-gantt" ref={root} data-gantt-periods={JSON.stringify(axisPeriods)} aria-busy={busy} aria-label={english ? "Gantt chart" : "Диаграмма Ганта"}>
    <div className="shared-gantt-tools"><div className="shared-gantt-scale" role="group" aria-label={english ? "Time scale" : "Масштаб времени"}>
      {(["day","days","weeks","months"] as const).map(item=><button type="button" key={item} aria-pressed={scale===item} onClick={()=>{setScale(item);setFit(false);}}>{({day:ganttCopy("time"),days:english ? "Days" : "Дни",weeks:groupedLabel,months:english ? "Months" : "Месяцы"})[item]}</button>)}
    </div><div className="shared-gantt-navigation"><div className="shared-gantt-date-navigation" role="group" aria-label={english ? "Timeline date" : "Дата таймлайна"}><button type="button" onClick={()=>shift(-1)} aria-label={english ? "Previous period" : "Предыдущий период"}>←</button>
      <CalendarDatePicker mode={calendarMode} value={anchor} triggerText={calendarMode==="sacred" ? sacredGanttDate(anchor).replace(/\s*\([^()]*\)$/u,"") : formatCalendarDate(new Date(`${anchor}T12:00:00`),calendarMode)} showGregorianReference referencePlacement="inline" onChange={value=>{setAnchor(value);setFit(false);}} ariaLabel={english ? "Timeline date" : "Дата таймлайна"}/>
      <button type="button" onClick={()=>shift(1)} aria-label={english ? "Next period" : "Следующий период"}>→</button>
      </div><div className="shared-gantt-actions" role="group" aria-label={ganttCopy("actions")} style={{"--gantt-action-count":scale==="day"?2:3} as CSSProperties}>
      {mobile?<>
        <IconActionButton icon="today" label={translateText("Сегодня")} onClick={()=>{setAnchor(todayKey);setFit(false);}}/>
        {scale!=="day"?<IconActionButton icon="fit" label={translateText("По задачам")} aria-pressed={fit} onClick={()=>setFit(value=>!value)}/>:null}
        <IconActionButton icon="help" label={ganttCopy("help")} aria-haspopup="dialog" onClick={()=>setHelpOpen(true)}/>
      </>:<>
      <button type="button" onClick={()=>{setAnchor(todayKey);setFit(false);}}>{english ? "Today" : "Сегодня"}</button>
      {scale!=="day" ? <button type="button" aria-pressed={fit} onClick={()=>setFit(value=>!value)}>{english ? "Fit tasks" : "По задачам"}</button> : null}
      <button type="button" aria-haspopup="dialog" onClick={()=>setHelpOpen(true)}><ExperimentalIcon name="help"/><span data-no-translate>{ganttCopy("help")}</span></button>
      </>}
    </div>
    </div></div>
    <p className="shared-gantt-period">{formatDate(serialDate(range.start))}{scale!=="day" ? ` — ${formatDate(serialDate(range.end-1))}` : ""}</p>
    {helpOpen ? <div className="modal-backdrop shared-gantt-help-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setHelpOpen(false);}}>
      <div ref={helpRef} className="shared-projects-modal shared-gantt-help-dialog" role="dialog" aria-modal="true" aria-labelledby={helpTitle} tabIndex={-1}>
        <header><h2 id={helpTitle} data-no-translate>{ganttCopy("helpTitle")}</h2><DialogCloseButton type="button" className="shared-projects-close" onClick={()=>setHelpOpen(false)} aria-label={english ? "Close" : "Закрыть"} /></header>
        {canCreate ? <section><h3 data-no-translate>{ganttCopy("create")}</h3><p data-no-translate>{translateText("Нажмите на свободное место шкалы, чтобы создать задачу на эту дату. В режиме «Внутри дня» задача создаётся на сегодня с выбранным временем.").replace(/«Внутри дня»/u,`«${ganttCopy("time")}»`)}</p></section> : null}
        <section><h3 data-no-translate>{ganttCopy("schedule")}</h3><p>{english ? "Drag unscheduled tasks onto a period. Move a bar to reschedule it; drag its edges to change its duration. Steps: 15 minutes within a day, one day on other scales. Dates and times are saved in the task; dependent tasks change separately." : "Перетащите неразмеченную задачу на нужный период. Перемещайте плашку для переноса сроков, тяните за её края для изменения длительности. Шаг: 15 минут внутри дня, один день в остальных режимах. Даты и время сохраняются в карточке; зависимые задачи меняются отдельно."}</p></section>
        {canEdit ? <section><h3 data-no-translate>{ganttCopy("return")}</h3><p>Перетащите плашку обратно в нижний список, хаос-бокс или на кнопку «Список» / «Доски», чтобы снять её со шкалы.</p></section> : null}
        <section><h3 data-no-translate>{ganttCopy("edit")}</h3><p data-no-translate>{ganttCopy("editHint")}</p></section>
      </div>
    </div> : null}
    <SharedTaskPageControls page={rangePage.page} loaded={rangePage.page?.tasks.length??0} busy={rangePage.busy} onMore={()=>void rangePage.more()} onRefresh={()=>void rangePage.refresh()} error={rangePage.error}/>
    <div ref={scrollRoot} className="shared-gantt-scroll" role="region" aria-label={english ? "Scrollable timeline" : "Прокручиваемая шкала времени"}>
      <div className="shared-gantt-sheet" style={{"--gantt-width":`${width}px`} as CSSProperties}>
        <div className={`shared-gantt-header${months.length ? " has-months" : ""}`}><strong>{english ? "Task" : "Задача"}</strong><div {...axisProps}>
          {months.map(month=><span className="shared-gantt-month" key={month.start} style={periodStyle(month)} title={month.label}>{month.label}</span>)}
          {ticks.map(tick=>{const label=scale === "day" ? formatTimeValue(`${String(Math.round((tick.start-range.start)*24)).padStart(2,"0")}:00`,timeFormat) : tick.label || formatDate(serialDate(tick.start));const title=scale === "months" ? tick.label : `${formatDate(serialDate(tick.start))} — ${formatDate(serialDate(Math.ceil(tick.end)-1))}`;return canCreate ? <button type="button" className="shared-gantt-tick" key={tick.start} style={periodStyle(tick)} title={title} {...createProps(tick)}>{label}</button> : <span className="shared-gantt-tick" key={tick.start} style={periodStyle(tick)} title={title}>{label}</span>;})}
        </div></div>
        <div className="shared-gantt-rows">
          {rows.map(({task,span})=>{const status=snapshot.statuses.find(item=>item.id===task.statusId);const pos=positions.get(task.id)!;
            return <div className="shared-gantt-row" key={task.id} data-gantt-task={task.id}><div className="shared-gantt-name-cell"><button type="button" className="shared-gantt-name" onClick={()=>onOpen(task)} title={task.title} data-no-translate>{task.title}</button>{task.dependsOnIds?.length ? <button type="button" className="shared-gantt-return" aria-label={`${translateText("Предшествующие задачи")}: ${task.title}`} onClick={()=>setDependencyTask(task)}>{task.dependsOnIds.length}</button> : null}{canEdit ? <button type="button" className="shared-gantt-return" disabled={busy||Boolean(task.pending)} title="Вернуть задачу в список" aria-label={`${translateText("Вернуть задачу в список")}: ${task.title}`} onClick={()=>onReturn(task,{projectId:task.projectId,statusId:"",position:0,unschedule:ganttUnscheduledSchedule(task,scale)})}><ExperimentalIcon name="map-back"/></button> : null}</div>
              <div className="shared-gantt-track" {...axisProps}>{createCells}{gridLines}<div className={`shared-gantt-bar${pos.end-pos.x<24 ? " is-short" : ""}${status?.isDone ? " is-done" : ""}${resize.preview?.item.task.id===task.id ? " is-resizing" : ""}`} style={{left:pos.x,width:Math.max(4,pos.end-pos.x),"--bar-color":status?.color||"#2d6c68"} as CSSProperties}>
                <button type="button" className="shared-gantt-open" data-affair-drag-surface {...dragProps(task,true)} onClick={()=>onOpen(task)}
                  aria-label={`${task.title} · ${formatDate(serialDate(Math.floor(span!.start)))} ${task.startTime||""} — ${formatDate(task.dueDate||task.startDate!)} ${task.endTime||""}${status?.isDone ? english ? " · Completed" : " · Завершена" : ""}`} title={`${task.title} · ${task.startTime||""}–${task.endTime||""}`}><span data-no-translate>{task.title}</span></button>
                {canEdit ? (["start","end"] as const).map(edge=><button type="button" key={edge} className={`shared-gantt-resize is-${edge}`} disabled={busy||Boolean(task.pending)||(edge==="start" ? span!.start<range.start : span!.end>range.end)} data-affair-drag-surface {...resizeProps(task,edge)} aria-label={`${english ? edge==="start" ? "Change start" : "Change end" : edge==="start" ? "Изменить начало" : "Изменить окончание"}: ${task.title}`} title={english ? "Drag to resize; arrow keys for precise adjustment" : "Тяните для изменения длительности; стрелки — для точной настройки"}/>) : null}
              </div>{dropRow===task.id ? dropPreview : null}</div>
            </div>;})}
          <div className="shared-gantt-drop-row shared-gantt-row"><strong>{english ? "Drop task here" : "Перенесите задачу сюда"}</strong><div className="shared-gantt-track" {...axisProps}>{createCells}{gridLines}{!dropRow ? dropPreview : null}</div></div>
          <svg className="shared-gantt-dependencies" width={width} height={rows.length*56} aria-hidden="true">
            {rows.flatMap(({task})=>(task.dependsOnIds||[]).flatMap(id=>{const from=positions.get(id);const to=positions.get(task.id);if(!from||!to)return [];
              const bend=Math.max(from.end+10,to.x+10);return [<g key={`${id}-${task.id}`}><path d={`M ${from.end} ${from.y} H ${bend} V ${to.y-14} H ${to.x} V ${to.y-4}`}/><path d={`M ${to.x-3} ${to.y-8} l 3 4 3 -4`}/></g>];}))}
          </svg>
          {dateSerial(todayKey)>=range.start && dateSerial(todayKey)<range.end ? <div className="shared-gantt-today" style={{left:`calc(var(--gantt-name-width) + ${positionAt(dateSerial(todayKey)+(scale==="day" ? (today.getHours()*60+today.getMinutes())/1440 : 0))}px)`}} aria-hidden="true"/> : null}
        </div>
      </div>
    </div>
    {activeSchedule ? <p className="shared-gantt-drop-label" role="status">{formatDate(activeSchedule.startDate)} {activeSchedule.startTime ? formatTimeValue(activeSchedule.startTime,timeFormat) : ""} — {formatDate(activeSchedule.dueDate)} {activeSchedule.endTime ? formatTimeValue(activeSchedule.endTime,timeFormat) : ""}</p> : null}
    {!rows.length ? <p>{english ? "No scheduled tasks in this period." : "В этом периоде нет задач с заданным временем."}</p> : null}
    {fit && snapshot.taskPage?.bounds?.last && dateSerial(snapshot.taskPage.bounds.last)>=range.end ? <p role="status">{english ? "The fitted range is limited to one year. Use navigation to see later tasks." : "Общий диапазон ограничен годом. Используйте навигацию для более поздних задач."}</p> : null}
    <section className="shared-gantt-unscheduled" data-gantt-unscheduled={scale} data-drop-active={Boolean(drag.target?.destination?.unschedule) && !drag.target?.destination?.view || undefined} aria-label={english ? "Unscheduled tasks" : "Неразмеченные задачи"}>
      <header><h3>{scale==="day" ? (english ? "Without time" : "Без времени") : (english ? "Without dates" : "Без даты")}</h3><span>{unscheduledPage.page?.total ?? 0}</span></header>
      <p>{english ? "Drag a task onto the timeline, then adjust its start and end with the bar edges or in its card." : "Перетащите задачу на нужный период шкалы, затем настройте начало и окончание за края плашки или в карточке."}</p>
      <div>{unscheduled.map(task=><button type="button" key={task.id} onClick={()=>onOpen(task)} data-affair-drag-surface {...dragProps(task)}>
        <span data-no-translate>{task.title}</span>{scale === "day" && (task.startDate || task.dueDate) ? <small>{formatDate(task.startDate || task.dueDate!)}{task.startDate && task.dueDate && task.startDate !== task.dueDate ? ` — ${formatDate(task.dueDate)}` : ""}</small> : null}
      </button>)}</div>
      {!unscheduled.length ? <p>{scale === "day" ? (english ? "All active tasks have a time assigned." : "Всем активным задачам назначено время.") : (english ? "All tasks in this period are scheduled." : "Все задачи этого периода размечены.")}</p> : null}
      <SharedTaskPageControls page={unscheduledPage.page} loaded={unscheduled.length} busy={unscheduledPage.busy} onMore={()=>void unscheduledPage.more()} onRefresh={()=>void unscheduledPage.refresh()} error={unscheduledPage.error}/>
    </section>
    {completedPage.page?.total ? <details className="shared-gantt-completed"><summary><ExperimentalIcon name="chevron" /><span>{english ? "Completed" : "Выполненные"}</span><span>{completedPage.page.total}</span></summary>
      <p>{english ? "Completed tasks are kept here and do not take up space on the timeline. Open a task to return it to an active board." : "Выполненные задачи сохранены здесь и не занимают место на шкале. Откройте задачу, чтобы вернуть её на активную доску."}</p>
      <SharedTaskBatches key={snapshot.project.id} tasks={completedTasks} page={completedPage.page} busy={completedPage.busy} error={completedPage.error}
        onMore={completedPage.more} onRefresh={()=>void completedPage.refresh()} className="shared-gantt-completed-items" renderTask={renderCompletedTask}/>
    </details> : null}
    {dependencyTask ? <SharedDependencyDialog task={dependencyTask} onClose={()=>setDependencyTask(null)} onOpen={task=>{setDependencyTask(null);onOpen(task);}}/> : null}
    {drag.preview && drag.target?.destination ? <div className="shared-projects-drag-preview" aria-hidden="true" style={{left:drag.preview.x+14,top:drag.preview.y+14}}>{drag.preview.item.title}</div> : null}
  </section>;
}
