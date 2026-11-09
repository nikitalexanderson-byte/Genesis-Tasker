"use client";
import { useRef } from "react";
import { SharedDependencyPicker } from "./SharedDependencyPicker";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { TimeClockPicker } from "./TimeClockPicker";
import { RecordDateTimeRow } from "./RecordDateTimeRow";
import type { CalendarMode } from "./calendar-data";
import type { SharedTask } from "./cloud-sync";
import type { TimeFormat } from "./time-format";
export type SharedPlan = {startDate:string;startTime:string;endTime:string;dependsOnIds:string[]};
export const emptySharedPlan = ():SharedPlan=>({startDate:"",startTime:"",endTime:"",dependsOnIds:[]});
export const taskSharedPlan = (task:SharedTask):SharedPlan=>({startDate:task.startDate||"",startTime:task.startTime||"",endTime:task.endTime||"",dependsOnIds:task.dependsOnIds||[]});
export function SharedTaskSchedule({plan,onChange,dueDate,onDueDate,mode,timeFormat,english,tasks,projectId,taskId,part='details'}:{plan:SharedPlan;onChange:(value:SharedPlan)=>void;dueDate:string;onDueDate:(value:string)=>void;mode:CalendarMode;timeFormat:TimeFormat;english:boolean;tasks:SharedTask[];projectId?:string;taskId?:string;part?:'primary'|'details'}) {
  const suggestedEnd = useRef<string | null>(null);
  const today=new Date();const key=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const invalid = plan.startDate && dueDate && plan.startDate>dueDate || Boolean(plan.startTime)!==Boolean(plan.endTime) || plan.startTime && plan.endTime && (!plan.startDate || !dueDate || plan.startDate===dueDate) && plan.startTime>=plan.endTime;
  const fields = [{title:english ? "Start date" : "Начало",value:plan.startDate,set:(value:string)=>onChange({...plan,startDate:value,...(!value&&!dueDate ? {startTime:"",endTime:""} : {})})},{title:english ? "Due date" : "Окончание",value:dueDate,set:(value:string)=>{onDueDate(value);if(!value&&!plan.startDate)onChange({...plan,startTime:"",endTime:""});}}];
  const renderDate = (field: typeof fields[number]) => <div className="shared-projects-date-field" key={field.title}><span>{field.title}</span><CalendarDatePicker mode={mode} value={field.value} onChange={field.set} ariaLabel={field.title}/><button type="button" onClick={()=>field.set(field.value ? "" : key)}>{field.value ? (english ? "Clear" : "Убрать дату") : (english ? "Set date" : "Задать дату")}</button></div>;
  if(part==='primary')return <div className="shared-task-schedule-primary">
    <RecordDateTimeRow date={plan.startDate||dueDate} onDateChange={plan.startDate?fields[0].set:fields[1].set}
      dateLabel={plan.startDate?fields[0].title:fields[1].title} mode={mode} timeFormat={timeFormat}
      time={plan.startTime} timeDisabled={!plan.startDate&&!dueDate} timeLabel={english?'Start time':'Время начала'}
      onTimeChange={value=>{
        if(!value){suggestedEnd.current=null;onChange({...plan,startTime:'',endTime:''});return;}
        const [hour,minute]=value.split(':').map(Number),end=Math.min(1439,hour*60+minute+60);
        const nextEnd=`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`;
        const followStart=!plan.endTime||plan.endTime===suggestedEnd.current;
        suggestedEnd.current=followStart?nextEnd:null;
        onChange({...plan,startTime:value,endTime:followStart?nextEnd:plan.endTime});
      }}/>
    {invalid?<p role="alert">{english ? "The end must be later than the start." : "Окончание должно быть позже начала."}</p>:null}
  </div>;
  const planning = <>
    <label className="shared-projects-checkbox"><input type="checkbox" checked={Boolean(plan.startTime||plan.endTime)} disabled={!plan.startDate&&!dueDate} onChange={event=>onChange({...plan,startTime:event.target.checked ? "09:00" : "",endTime:event.target.checked ? "10:00" : ""})}/>{english ? "Set hours for the daily timeline" : "Задать часы для таймлайна дня"}</label>
    {plan.startTime||plan.endTime ? <label>{english ? "End time" : "Время окончания"}<TimeClockPicker ariaLabel={english ? "End time" : "Время окончания"} value={plan.endTime} onChange={value=>onChange({...plan,endTime:value})} timeFormat={timeFormat}/></label> : null}
    <SharedDependencyPicker projectId={projectId ?? tasks[0]?.projectId} taskId={taskId} selected={plan.dependsOnIds} onChange={dependsOnIds=>onChange({...plan,dependsOnIds})} fallback={tasks}/></>;
  return <fieldset className="shared-task-schedule"><legend>{english ? "Schedule and dependencies" : "Сроки и зависимости"}</legend>
    <div className="shared-task-date-pair">{fields.map(renderDate)}</div>{planning}
  </fieldset>;
}
