"use client";
import {useFeatureAccess} from "./FeatureAccessContext";
import {featureAllowed} from "./feature-access";
import {FeatureAccessUI} from "./FeatureAccessUI";
import type { Habit } from './habits';
import { habitTimerPreferences } from './habit-timer-preferences';
import copy from './habit-timer-preferences-copy.json';
import { translateText, type Language } from './i18n';
import './habit-timer-preferences.css';

export function HabitTimerPreferencesFields({habit,language,disabled=false,onChange}:{habit:Habit;language:Language;disabled?:boolean;onChange:(habit:Habit)=>void}) {
  const allowed=featureAllowed(useFeatureAccess(),"habit-timer");
  const text=copy[language],prefs=habitTimerPreferences(habit),enabled=habit.timerEnabled!==false;
  const update=(patch:Partial<typeof prefs>)=>onChange({...habit,timerPreferences:{...prefs,...patch}});
  return <>{!allowed?<FeatureAccessUI language={language} feature="habit-timer"/>:null}<fieldset className="habit-timer-preferences" disabled={disabled||!allowed}>
    <legend>{text.title}</legend>
    <label className="habit-switch"><span>{text.enabled}</span><input type="checkbox" role="switch" checked={enabled} onChange={event=>onChange({...habit,timerEnabled:event.target.checked})}/><i/></label>
    {enabled?<>
      <fieldset><legend>{text.modes}</legend>
        {(['stopwatch','pomodoro'] as const).map(mode=><label key={mode}><input type="checkbox" checked={prefs.modes.includes(mode)} disabled={prefs.modes.length===1&&prefs.modes[0]===mode}
          onChange={event=>update({modes:(['stopwatch','pomodoro'] as const).filter(item=>item===mode?event.target.checked:prefs.modes.includes(item))})}/>{mode==='stopwatch'?translateText('Секундомер',language):'Pomodoro'}</label>)}
      </fieldset>
      {prefs.modes.includes('pomodoro')?<div className="habit-timer-preference-intervals">
        <label>{translateText('Рабочий интервал, мин',language)}<input type="number" min={1} max={180} required value={prefs.workMinutes||''} onChange={event=>update({workMinutes:Number(event.target.value)})}/></label>
        <label>{translateText('Перерыв, мин',language)}<input type="number" min={0} max={120} required value={prefs.breakMinutes} onChange={event=>update({breakMinutes:Number(event.target.value)})}/></label>
      </div>:null}
      <label><input type="radio" name="habit-timer-progress" checked={prefs.progress==='duration'} onChange={()=>update({progress:'duration'})}/>{text.duration}</label>
      <label><input type="radio" name="habit-timer-progress" checked={prefs.progress==='time-only'} onChange={()=>update({progress:'time-only'})}/>{text.timeOnly}</label>
      <p>{text.hint}</p>
    </>:null}
  </fieldset></>;
}
