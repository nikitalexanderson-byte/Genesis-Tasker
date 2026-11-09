
import { habitDisplayText } from "./habit-display-text";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { addCivilDays, momentCivilDate, type CalendarContext } from "./calendar-context";
import { effectiveHabitMeasurement, formatHabitValue, habitMeasurementProgress, habitRuleForDate, parseHabitValue } from "./habit-measurement";
import { habitHistoryState, type HabitHistoryValue } from "./habit-history";
import { applyHabitHistoryCommand, habitHistoryInitialValue, type HabitHistoryCommand } from "./habit-history-workspace";
import { habitIntervalTimes } from "./habit-interval";
import { habitPeriodProgress } from "./habit-period-progress";
import { formatCalendarDateValue } from "./calendar-data";
import { formatTimeValue, type TimeFormat } from "./time-format";
import { translateText, type Language } from "./i18n";
import type { Habit, HabitWorkspace } from "./habits";
import type { CalendarMode } from "./calendar-data";
import "./habit-history.css";

type Props={workspace:HabitWorkspace;language:Language;calendarMode:CalendarMode;timeFormat:TimeFormat;
  reportContext?:CalendarContext;requestedDate?:string;requestedHabitId?:string;onDirtyChange?:(dirty:boolean)=>void;onCommand:(command:HabitHistoryCommand)=>Promise<void>};
export function HabitHistoryPanel(props:Props){
  const {workspace,language,calendarMode,reportContext}=props,t=(text:string)=>translateText(text,language),id=useId();
  const [habitId,setHabitId]=useState(props.requestedHabitId??workspace.habits[0]?.id??"");
  const dirty=useRef(false);
  const reportDirty=(value:boolean)=>{dirty.current=value;props.onDirtyChange?.(value);};
  const allowChange=()=>!dirty.current||window.confirm(t("Вернуться без сохранения изменений?"));
  const habit=workspace.habits.find(row=>row.id===habitId)??workspace.habits[0];
  const [selected,setSelected]=useState(props.requestedDate??"");
  if(!habit)return null;
  const rule=habitRuleForDate(habit,selected||habit.createdDate),yesterday=addCivilDays(momentCivilDate(new Date(),rule.schedule.timezone),-1);
  const date=selected||yesterday;
  return <details className="habit-history-panel" id="habit-history-editor" open={Boolean(props.requestedDate)}>
    <summary>{t("Исправить историю")}</summary>
    <p>{t("Историческая корректировка меняет статистику и серии. XP и Лавры не начисляются; выданные награды и потраченная защита сохраняются.")}</p>
    <div className="habit-history-fields">
      <label htmlFor={`${id}-habit`}><span>{t("Привычка")}</span><select id={`${id}-habit`} value={habit.id} onChange={event=>{if(allowChange()){setHabitId(event.target.value);setSelected("");}}}>
        {workspace.habits.map(row=><option key={row.id} value={row.id} data-no-translate>{habitDisplayText(row, language).title}</option>)}
      </select></label>
      <div><span id={`${id}-date-label`}>{t("Прошлая дата")}</span><CalendarDatePicker ariaLabel={t("Прошлая дата")} value={date}
        mode={calendarMode} calculationContext={reportContext} min={habit.createdDate} max={yesterday} showGregorianReference={false} onChange={value=>{if(allowChange())setSelected(value);}}/></div>
    </div>
    <HabitHistoryForm key={`${habit.id}:${date}`} {...props} onDirtyChange={reportDirty} habit={habit} date={date}/>
  </details>;
}

function HabitHistoryForm({workspace,habit,date,language,calendarMode,timeFormat,onCommand,onDirtyChange}:Props&{habit:Habit;date:string}){
  const t=(text:string)=>translateText(text,language),id=useId(),rule=habitRuleForDate(habit,date),definition=effectiveHabitMeasurement(rule);
  const history=habitHistoryState(workspace.habitHistory??[],habit.id,date);
  const progress=definition?habitMeasurementProgress(habit,date,workspace.habitMeasurements):null;
  const [initialValue,setInitialValue]=useState<HabitHistoryValue>(()=>habitHistoryInitialValue(workspace,habit.id,date));
  const [value,setValue]=useState<HabitHistoryValue>(initialValue);
  const [amount,setAmount]=useState(""),[entryId,setEntryId]=useState(""),[remove,setRemove]=useState(false);
  const [preview,setPreview]=useState<{command:HabitHistoryCommand;after:HabitWorkspace}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
  const dirty=JSON.stringify(value)!==JSON.stringify(initialValue)||Boolean(amount||entryId||remove||preview);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);
  const times=habit.intervalSchedule?.completionMode==="each"?habitIntervalTimes(habit.intervalSchedule):[];
  const change=(next:HabitHistoryValue)=>{setValue(next);setPreview(null);setError("");setSaved(false);};
  const entry=progress?.entries.find(row=>row.id===entryId);
  const amountLabel=(amount:number)=>`${formatHabitValue(amount,language)} ${definition?.kind==="duration"?t("мин"):definition?.unit??""}`.trim();
  const selectedResult=preview?.after.habitCompletions.find(row=>row.habitId===habit.id&&row.date===date);
  const periodBefore=preview&&rule.periodGoal?habitPeriodProgress(habit,date,workspace):null;
  const periodAfter=preview&&rule.periodGoal?habitPeriodProgress(habit,date,preview.after):null;
  const proposed=()=>{
    const at=new Date().toISOString();
    const next={...value,completed:definition?Boolean(progress?.completed):times.length?times.every(time=>value.completedTimes.includes(time)):value.completed,
      qualityConfirmedAt:habit.qualityScale!=="none"&&value.qualityValue!==null?at:null};
    if(next.completed || next.completedTimes.length || !remove && amount)delete next.skippedAt;
    const command:HabitHistoryCommand={id:`habit-history-${crypto.randomUUID()}`,at,habitId:habit.id,date,ruleId:rule.id,
      heads:history.heads.map(row=>row.id),value:next};
    if(definition&&(remove||amount||!rule.measurement)){
      const measurement=remove?null:!rule.measurement?1000:parseHabitValue(amount);
      if(!remove&&measurement===null||remove&&!entry)throw Error("INVALID_HABIT_MEASUREMENT_EVENT");
      command.measurement={value:measurement,note:value.note,...(entry?{entryId:entry.id,replaces:entry.heads.map(row=>row.id)}:{})};
    }
    return command;
  };
  const prepare=()=>{
    setError("");setSaved(false);
    try{const command=proposed();setPreview({command,after:applyHabitHistoryCommand(workspace,command,calendarMode)});}
    catch{setError(t("В этот день запись недоступна. Проверьте дату, значение и действующее правило."));}
  };
  const save=async()=>{
    if(!preview||busy)return;setBusy(true);setError("");
    try{await onCommand(preview.command);const next=habitHistoryInitialValue(preview.after,habit.id,date);setInitialValue(next);setValue(next);setPreview(null);setAmount("");setEntryId("");setRemove(false);setSaved(true);}
    catch{setError(t("Не удалось исправить историю. Обновите данные и повторите."));}
    finally{setBusy(false);}
  };
  const formatInstant=(instant:string)=>{
    const at=new Date(instant),parts=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:rule.schedule.timezone}).formatToParts(at);
    const part=(type:string)=>parts.find(row=>row.type===type)?.value??"00";
    return `${new Intl.DateTimeFormat(language,{dateStyle:"medium",timeZone:rule.schedule.timezone}).format(at)} · ${formatTimeValue(`${part("hour")}:${part("minute")}`,timeFormat)}`;
  };
  return <div className="habit-history-form">
    <h3 data-no-translate>{habitDisplayText(habit, language).title}</h3><p>{formatCalendarDateValue(date,calendarMode)} · {rule.schedule.timezone}</p>
    {history.conflict||progress?.conflicts.length?<p role="alert">{t("Одновременные исправления. Выберите правильное значение.")}</p>:null}
    <fieldset disabled={busy}><legend>{t("Учёт выполнения")}</legend>
      <label className="habit-history-check"><input type="checkbox" checked={Boolean(value.skippedAt)} disabled={Boolean(definition&&progress?.completed)} onChange={event=>{const next={...value};if(event.target.checked){next.skippedAt=new Date().toISOString();next.completed=false;next.completedTimes=[];}else delete next.skippedAt;change(next);}}/>{t("Осознанный пропуск")}</label>
      {definition?<div className="habit-history-fields">
        <label htmlFor={`${id}-entry`}><span>{t("Записи")}</span><select id={`${id}-entry`} value={entryId} onChange={event=>{
          const next=progress!.entries.find(row=>row.id===event.target.value);setEntryId(event.target.value);setAmount(next?.current?.value?String(next.current.value/1000):"");setRemove(false);setPreview(null);}}>
          <option value="">{t("Добавить значение")}</option>
          {progress!.entries.map(row=><option key={row.id} value={row.id}>{row.current?.value===null?t("Запись удалена"):formatHabitValue(row.current?.value??0,language)} · {formatInstant(row.revisions[0].createdAt)}</option>)}
        </select></label>
        {rule.measurement?<label htmlFor={`${id}-amount`}><span>{t("Значение")} · {definition.kind==="duration"?t("мин"):definition.unit}</span>
          <input id={`${id}-amount`} inputMode="decimal" value={amount} maxLength={16} disabled={remove} aria-invalid={Boolean(amount&&!parseHabitValue(amount))} onChange={event=>{setAmount(event.target.value);setPreview(null);}}/></label>:null}
        {entry?<label className="habit-history-check"><input type="checkbox" checked={remove} onChange={event=>{setRemove(event.target.checked);setPreview(null);}}/>{t("Удалить запись")}</label>:null}
        {progress!.entries.filter(row=>row.conflict).map(conflict=><div className="habit-history-conflict" key={conflict.id}>
          <time dateTime={conflict.revisions[0].createdAt}>{formatInstant(conflict.revisions[0].createdAt)}</time>
          {conflict.heads.map(head=><button type="button" className="secondary-button" key={head.id}
          onClick={()=>{setEntryId(conflict.id);setAmount(head.value===null?"":String(head.value/1000));setRemove(head.value===null);change({...value,note:head.note});}}>
          {t("Оставить {value}").replace("{value}",head.value===null?t("Запись удалена"):amountLabel(head.value))}
        </button>)}</div>)}
      </div>:times.length?<div className="habit-history-slots">{times.map(time=><label key={time}><input type="checkbox" checked={value.completedTimes.includes(time)} onChange={event=>change({...value,completedTimes:event.target.checked?[...value.completedTimes,time]:value.completedTimes.filter(row=>row!==time)})}/>{formatTimeValue(time,timeFormat)}</label>)}</div>
        :<label className="habit-history-check"><input type="checkbox" checked={value.completed} onChange={event=>change({...value,completed:event.target.checked})}/>{t("Выполнено")}</label>}
      {habit.qualityScale!=="none"?<label htmlFor={`${id}-quality`}><span>{t("Качество")}</span><select id={`${id}-quality`} value={value.qualityValue??""} onChange={event=>change({...value,qualityValue:event.target.value===""?null:Number(event.target.value)})}>
        <option value="">—</option>{Array.from({length:habit.qualityScale==="ten"?10:11},(_,index)=>habit.qualityScale==="ten"?index+1:index-5).map(item=><option key={item} value={item}>{item}</option>)}
      </select></label>:null}
      <label htmlFor={`${id}-note`}><span>{t("Заметка")}</span><input id={`${id}-note`} value={value.note} maxLength={2000} onChange={event=>change({...value,note:event.target.value})}/></label>
    </fieldset>
    {preview?<div className="habit-history-preview" role="status"><h4>{t("Предпросмотр изменений")}</h4>
      <p>{t("Выполнено")}: {String(workspace.habitCompletions.filter(row=>row.date===date&&row.completed).length)} → {String(preview.after.habitCompletions.filter(row=>row.date===date&&row.completed).length)}</p>
      <p>{t("Текущая серия")}: {workspace.userProgress.currentStreak} → {preview.after.userProgress.currentStreak}</p>
      {progress?<p>{t("Значение")}: {amountLabel(progress.total)} → {amountLabel(habitMeasurementProgress(habit,date,preview.after.habitMeasurements).total)}</p>:null}
      {habit.qualityScale!=="none"?<p>{t("Качество")}: {workspace.habitCompletions.find(row=>row.habitId===habit.id&&row.date===date)?.qualityValue??"—"} → {selectedResult?.qualityValue??"—"}</p>:null}
      {periodBefore&&periodAfter?<p>{t("Цель периода")}: {periodBefore.goal.metric==="sum"?amountLabel(periodBefore.qualifiedValue):periodBefore.qualifiedValue} → {periodAfter.goal.metric==="sum"?amountLabel(periodAfter.qualifiedValue):periodAfter.qualifiedValue} / {periodAfter.goal.metric==="sum"?amountLabel(periodAfter.goal.target):periodAfter.goal.target}</p>:null}
      <p>{t("Цели и статистика будут пересчитаны. Квесты и достижения задним числом не выдаются.")}</p>
      <button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>{t("Сохранить")}</button>
    </div>:<button type="button" className="secondary-button" disabled={busy} onClick={prepare}>{t("Предпросмотр изменений")}</button>}
    {error?<p role="alert">{error}</p>:null}{saved?<p role="status">{t("Запись исправлена.")}</p>:null}
    <details className="habit-history-audit"><summary>{t("История исправлений")} · {history.rows.length}</summary>
      {history.rows.length?<ol>{history.rows.map(row=><li key={row.id}><time dateTime={row.createdAt}>{formatInstant(row.createdAt)}</time>
        <span>{t(row.value.completed?"Выполнено":"Отметка снята")}{row.value.qualityValue!==null?` · ${row.value.qualityValue}`:""}</span>
        {workspace.habitMeasurements.filter(event=>event.id===`${row.id}:value`).map(event=><span key={event.id}> · {event.value===null?t("Запись удалена"):amountLabel(event.value)}</span>)}
        {row.value.note?<p data-no-translate>{row.value.note}</p>:null}
        {history.conflict&&history.heads.some(head=>head.id===row.id)?<button type="button" className="secondary-button" disabled={busy} onClick={()=>change(row.value)}>{t("Выбрать")}</button>:null}
      </li>)}</ol>:<p>{t("Записей пока нет")}</p>}
    </details>
    {progress?.entries.length?<details className="habit-history-audit"><summary>{t("Записи")} · {progress.entries.length}</summary>
      <ol>{progress.entries.map(row=><li key={row.id}>{row.revisions.map(revision=><div key={revision.id}>
        <time dateTime={revision.createdAt}>{formatInstant(revision.createdAt)}</time>
        <span>{revision.value===null?t("Запись удалена"):amountLabel(revision.value)}</span>
        {revision.note?<p data-no-translate>{revision.note}</p>:null}
      </div>)}</li>)}</ol>
    </details>:null}
  </div>;
}
