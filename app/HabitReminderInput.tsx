
import { habitDisplayText } from "./habit-display-text";
import { useRef, useState } from "react";
import { habitReminderAction, type HabitReminderTarget, type HabitReminderInput } from "./habit-reminder-plan";
import { effectiveHabitMeasurement, formatHabitValue, habitMeasurementProgress, habitRuleForDate, parseHabitValue } from "./habit-measurement";
import { habitIntervalMarks, habitIntervalTimes } from "./habit-interval";
import { translateText, type Language } from "./i18n";
import { formatTimeValue, type TimeFormat } from "./time-format";
import { formatCalendarDateValue, type CalendarMode } from "./calendar-data";
import type { HabitWorkspace } from "./habits";

export function HabitReminderInputPanel({workspace,target,language,calendarMode,timeFormat,onSave}: {
  workspace:HabitWorkspace;target:HabitReminderTarget;language:Language;calendarMode:CalendarMode;timeFormat:TimeFormat;
  onSave:(target:HabitReminderTarget,input:HabitReminderInput)=>Promise<void>;
}) {
  const t=(text:string)=>translateText(text,language);
  const [value,setValue]=useState(""),[note,setNote]=useState(""),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[quality,setQuality]=useState(5);
  const operation=useRef<string|null>(null),saving=useRef(false);
  const habit=workspace.habits.find(item=>item.id===target.habitId);
  if(!habit)return <p>{t("Привычка недоступна. Данные не изменены.")}</p>;
  const rule=habitRuleForDate(habit,target.date),measurement=effectiveHabitMeasurement(rule);
  const progress=measurement?habitMeasurementProgress(habit,target.date,workspace.habitMeasurements):null;
  const entry=workspace.habitCompletions.find(item=>item.habitId===habit.id&&item.date===target.date);
  const times=habit.intervalSchedule?.completionMode==="each"?habitIntervalTimes(habit.intervalSchedule):[];
  const marks=habitIntervalMarks(habit.intervalSchedule,entry);
  const action=habitReminderAction(workspace,target);
  const available=action==="input"||action==="interval";
  const save=async(input:HabitReminderInput)=>{
    if(saving.current)return;saving.current=true;setBusy(true);setError("");
    try{await onSave(target,input);if(input.kind==="measurement"){setValue("");setNote("");operation.current=null;}}
    catch{setError(t("Не удалось сохранить запись. Проверьте значение и повторите."));}
    finally{saving.current=false;setBusy(false);}
  };
  return <div className="habit-reminder-input">
    <h3 data-no-translate>{habitDisplayText(habit, language).title}</h3><p>{formatCalendarDateValue(target.date,calendarMode,true)}</p>
    {!available?<p>{t(action==="completed"?"Результат уже записан.":"Уведомление устарело. Сегодняшние отметки не изменены.")}</p>:<>
      {measurement?<form onSubmit={event=>{event.preventDefault();const amount=parseHabitValue(value);if(!amount)return;
        operation.current??=crypto.randomUUID();void save({kind:"measurement",id:operation.current,value:amount,note});}}>
        <p>{t("Записано сегодня")}: {formatHabitValue(progress?.total??0,language)} {measurement.kind==="duration"?t("мин"):measurement.unit}</p>
        <div className="habit-reminder-frequency"><label><span>{t("Значение")}</span><input inputMode="decimal" value={value} maxLength={16} required disabled={busy}
          onChange={event=>setValue(event.target.value)} aria-invalid={Boolean(value&&!parseHabitValue(value))}/></label>
          <label><span>{t("Заметка")}</span><input value={note} maxLength={2000} disabled={busy} onChange={event=>setNote(event.target.value)}/></label></div>
        <button type="submit" className="primary-button" disabled={busy||!parseHabitValue(value)}>{t("Добавить значение")}</button>
      </form>:times.length?<div className="habit-reminder-buttons">{times.map(time=><button type="button" className="secondary-button" key={time} disabled={busy||marks.includes(time)} aria-pressed={marks.includes(time)}
        onClick={()=>void save({kind:"interval",time})}>{formatTimeValue(time,timeFormat)}</button>)}</div>:null}
      {habit.qualityScale!=="none"?<div className="habit-reminder-quality"><label><span>{t("Качество выполнения")} · {quality}</span>
        <input type="range" min={habit.qualityScale==="ten"?1:-5} max={habit.qualityScale==="ten"?10:5} value={quality} disabled={busy} onChange={event=>setQuality(Number(event.target.value))}/></label>
        <button type="button" className="primary-button" disabled={busy||Boolean(progress&&!progress.completed)||times.some(time=>!marks.includes(time))}
          onClick={()=>void save({kind:"quality",value:quality})}>{t("Выполнено")}</button></div>:null}
    </>}
    {error?<p role="alert">{error}</p>:null}
  </div>;
}
