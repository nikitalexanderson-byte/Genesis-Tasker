import {useState} from 'react';
import {useDiary} from './DiaryProvider';
import {diaryCopy} from './diary-copy';
import copy from './dream-journal-copy.json';
import type {Language} from './i18n';

export function DreamJournalSettings({language,enabled,onEnabledChange,preferenceBusy=false}:{language:Language;enabled:boolean;onEnabledChange:(enabled:boolean)=>void;preferenceBusy?:boolean}){
 const diary=useDiary(),text=copy[language],common=diaryCopy(language),[error,setError]=useState(false);
 return <section className="account-preferences" data-settings-group="habits" aria-labelledby="dream-settings-title">
  <h3 id="dream-settings-title">{text.title}</h3>
  <label className="account-switch-row"><span>{text.enabledLabel}</span><input type="checkbox" role="switch" checked={enabled} disabled={preferenceBusy} onChange={event=>onEnabledChange(event.target.checked)}/><i aria-hidden="true"/></label>
  <p>{text.enabledHint}</p>
  <fieldset className="dream-settings-options" disabled={!enabled||diary.loading||diary.busy||!diary.syncEnabled}>
   <legend>{text.showToday}</legend>
   {(['off','morning','all-day'] as const).map(value=><label className="dream-check" key={value}>
    <input type="radio" name="dream-today-mode" value={value} checked={diary.dreamSettings.todayMode===value}
     onChange={()=>{setError(false);void diary.setDreamTodayMode(value).catch(()=>setError(true));}}/>
    <span>{value==='off'?text.hidden:value==='morning'?text.morning:text.allDay}</span>
   </label>)}
  </fieldset><p>{text.morningHint}</p>
  {error?<p role="alert">{common.error}</p>:null}
  {!diary.syncEnabled?<p>{text.cloud}</p>:null}
 </section>;
}
