"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDiary } from "./DiaryProvider";
import { diaryCopy } from "./diary-copy";
import { newDiaryNote, validDreamDay, type DiaryNote } from "./diary-model";
import type { DiaryRecord } from "./diary-storage";
import { GenesisApiError, type GenesisUser } from "./cloud-sync";
import { featureAllowed } from "./feature-access";
import { requestUpgrade } from "./upgrade-events";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { DialogCloseButton } from "./DialogCloseButton";
import { IconActionButton } from "./IconActionButton";
import { ExperimentalIcon } from "./ExperimentalIcon";
import copy from "./dream-journal-copy.json";
import {compactDreamDate} from './dream-journal-date';
import { translateText, type Language } from "./i18n";
import { CalendarDatePicker } from "./CalendarDatePicker";
import type { CalendarMode } from "./calendar-data";
import { uiVisibility, visibleCalendarModes } from "./ui-visibility";
import "./dream-journal.css";
import { dreamMatches, dreamMorningWindow, uniqueDreams } from './dream-journal-model';
import type { SleepEntry, SleepPlan } from './sleep-tracker';
import { DreamDictation, type DreamRecognitionConstructor } from './dream-dictation';
import { appendDictation, dictationLocale, formatDictation } from './dictation-text';
import { correctDictationSpelling, supportedSpellingLanguage } from './dictation-spelling';
import dictationCopy from './dictation-copy.json';
import exportCopy from './dream-export-copy.json';
import { buildDreamHistoryHtml, dreamExportAllowed, dreamExportRecords } from './dream-export';
export function DreamJournalToday({user, date, language, plans, entries}: {user: GenesisUser; date: string; language: Language; plans: readonly SleepPlan[]; entries: readonly SleepEntry[]}) {
  const diary=useDiary(); const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(timer);},[]);
  const mode=diary.dreamSettings.todayMode, morning=dreamMorningWindow(plans,entries,now);
  if(!uiVisibility(user.uiVisibility).dreamJournalEnabled||mode==='off'||mode==='morning'&&!morning.visible)return null;
  return <DreamJournal user={user} date={date} language={language} compact wakeSource={mode==='morning'?morning.source:null}/>;
}
export function DreamJournal({ user, date, language, compact=false, wakeSource=null }: { user: GenesisUser | null; date: string; language: Language; compact?: boolean; wakeSource?: 'actual'|'planned'|null }) {
  const diary = useDiary(), text=copy[language], common=diaryCopy(language);
  const [editing,setEditing]=useState<{record?:DiaryRecord; key:string}|null>(null);
  const [selected,setSelected]=useState(date);
  const [filter,setFilter]=useState('all'), [query,setQuery]=useState(''), [historyOpen,setHistoryOpen]=useState(false);
  const [exportError,setExportError]=useState(false);
  const exportAllowed=Boolean(user&&dreamExportAllowed(user.featureAccess));
  const dreams=uniqueDreams(diary.records), stats=dreams;
  const otherDrafts=diary.records.filter(row=>row.note.dream&&row.draftKey&&!dreams.some(dream=>dream.draftKey===row.draftKey));
  const records=dreams.filter(row=>(filter!=='day'||row.note.dream!.day===selected)&&(filter!=='favorites'||row.note.reaction==='favorite')&&
    (filter!=='lucid'||row.note.dream!.lucid)&&dreamMatches(row.note,query))
    .toSorted((a,b)=>b.note.dream!.day.localeCompare(a.note.dream!.day)||b.note.updatedAt.localeCompare(a.note.updatedAt));
  const open=()=>{ if (!user || !featureAllowed(user.featureAccess,"dream-journal",undefined,true)) { requestUpgrade({feature:"dream-journal",reason:"feature"}); return; } setEditing({key:crypto.randomUUID()}); };
  const download=()=>{
    if(!user||!dreamExportAllowed(user.featureAccess)||diary.loading||diary.error||diary.busy)return;
    setExportError(false);
    try{
      const savedAt=new Date().toISOString();
      const content=buildDreamHistoryHtml(diary.records,language,savedAt);
      const url=URL.createObjectURL(new Blob([content],{type:'text/html;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`GENESIS-dreams-${savedAt.slice(0,10)}.html`;
      try{document.body.append(link);link.click();}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }catch{setExportError(true);}
  };
  if(!uiVisibility(user?.uiVisibility).dreamJournalEnabled)return null;
  return <section className="dream-journal tracker-module-card" aria-label={text.title}>
    <header><h2>{text.title}</h2></header><div className="dream-journal-actions"><button type="button" className="primary-button" onClick={open} disabled={!user || diary.loading}><ExperimentalIcon name="plus"/>{text.record}</button><button type="button" className="secondary-button" onClick={()=>setHistoryOpen(true)}><ExperimentalIcon name="history"/>{text.history}</button></div>
    {compact&&wakeSource?<p className="dream-wake-source">{wakeSource==='actual'?text.actualWake:text.plannedWake}</p>:null}
    {historyOpen?<DreamHistoryDialog title={text.history} closeLabel={common.closeDraft} onClose={()=>setHistoryOpen(false)}
      downloadLabel={exportCopy[language].download} onDownload={exportAllowed?download:undefined}
      downloadDisabled={diary.loading||diary.error||diary.busy||!dreamExportRecords(diary.records).length}>
      {exportError?<p role="alert">{exportCopy[language].error}</p>:null}
      <div className="dream-filters" aria-label={text.title}>{(['all','day','favorites','lucid'] as const).map(value=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)} aria-label={value==='day'?text.dayOnly:text[value]} title={value==='day'?text.dayOnly:text[value]}><ExperimentalIcon name={{all:'history',day:'calendar',favorites:'star',lucid:'moon'}[value]}/></button>)}</div>
      {filter==='day'?<label><span>{text.date}</span><input type="date" value={selected} onChange={event=>setSelected(event.target.value)}/></label>:null}
      <label className="dream-search"><span>{text.search}</span><input type="search" value={query} maxLength={200} onChange={event=>setQuery(event.target.value)}/></label>
      <details className="dream-statistics"><summary>{text.statistics}</summary><dl>{[[text.total,stats.length],[text.days,new Set(stats.map(row=>row.note.dream!.day)).size],[text.favorites,stats.filter(row=>row.note.reaction==='favorite').length],[text.lucid,stats.filter(row=>row.note.dream!.lucid).length]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
    {diary.loading?<p role="status">{common.loading}</p>:null}
    {diary.error?<p role="alert">{common.error}<button type="button" onClick={()=>void diary.refresh()}>{common.retry}</button></p>:null}
    {diary.offline?<p role="status">{common.offline}</p>:null}
    {!diary.syncEnabled?<p>{text.cloud}<button type="button" className="secondary-button" disabled={diary.busy} onClick={()=>void diary.setSyncEnabled(true).catch(()=>undefined)}>{common.retry}</button></p>:null}
    {!diary.loading&&!diary.error&&!records.length?<p>{query||filter!=='all'?text.noMatches:text.empty}</p>:null}
    <div className="dream-journal-entries">{records.map(row=><button type="button" className="dream-journal-entry" key={row.draftKey??row.note.id} onClick={()=>setEditing({record:row,key:row.draftKey??row.note.id})}>
      <strong>{row.note.title||text.title}</strong><small>{row.note.dream!.day}{row.note.reaction==='favorite'?` · ${text.favorites}`:''}{row.note.dream!.lucid?` · ${text.lucid}`:''}</small><span>{row.note.body.slice(0,180)}</span>{row.draftKey||row.localOnly?<small>{common.draft}</small>:null}
    </button>)}</div>
    {otherDrafts.length?<details className="dream-drafts"><summary>{common.drafts} · {otherDrafts.length}</summary><p>{common.draftHint}</p><div className="dream-journal-entries">{otherDrafts.map(row=><button type="button" className="dream-journal-entry" key={row.draftKey} onClick={()=>setEditing({record:row,key:row.draftKey!})}><strong>{row.note.title||text.title}</strong><small>{row.note.dream!.day} · {common.draft}</small><span>{row.note.body.slice(0,180)}</span></button>)}</div></details>:null}
    </DreamHistoryDialog>:null}
    {editing&&user?<DreamEditor key={editing.key} user={user} record={editing.record} date={new Date().toLocaleDateString("en-CA")} dateEditable={!compact||Boolean(editing.record)} language={language} onSaved={day=>{if(!compact)setSelected(day);setEditing(null);}} onClose={()=>setEditing(null)}/>:null}
  </section>;
}
function DreamHistoryDialog({title,closeLabel,onClose,children,downloadLabel,onDownload,downloadDisabled}:{title:string;closeLabel:string;onClose:()=>void;children:React.ReactNode;downloadLabel:string;onDownload?:()=>void;downloadDisabled:boolean}){
 const native=useRef<HTMLDialogElement>(null),focus=useDialogAccessibility<HTMLDialogElement>(onClose);
 useEffect(()=>{native.current?.showModal();},[]);
 return <dialog className="dream-history" data-dialog-header="none" ref={element=>{native.current=element;focus(element);}} aria-labelledby="dream-history-title" onCancel={event=>{event.preventDefault();onClose();}}>
  <header className="dialog-universal-header"><div className="dialog-universal-title"><h2 id="dream-history-title">{title}</h2></div><div className="dialog-universal-actions">
    {onDownload?<IconActionButton icon="download" label={downloadLabel} disabled={downloadDisabled} onClick={onDownload}/>:null}
    <DialogCloseButton aria-label={closeLabel} onClick={onClose}/>
  </div></header>{children}
 </dialog>;
}
function DreamEditor({user,record,date,language,onSaved,onClose,dateEditable=true}:{user:GenesisUser;record?:DiaryRecord;date:string;dateEditable?:boolean;language:Language;onSaved:(day:string)=>void;onClose:()=>void}) {
  const diary=useDiary(), text=copy[language], common=diaryCopy(language);
  const {dreamToday}=diary;
  const voiceAllowed=featureAllowed(user.featureAccess,"dream-voice",undefined,true);
  const [note,setNote]=useState<DiaryNote>(()=>record?.note??{...newDiaryNote(),dream:{day:date,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"}});
  const calendars=visibleCalendarModes(uiVisibility(user.uiVisibility));
  const [dateMode,setDateMode]=useState<CalendarMode>(()=>{
    const preferred=user.taskCalendarMode??"profane";
    return calendars.includes(preferred)?preferred:calendars[0]??"profane";
  });
  const [conflict,setConflict]=useState(false);
  const [today,setToday]=useState(""); const [error,setError]=useState(""); const [checking,setChecking]=useState(true);
  const [listening,setListening]=useState(false); const [voiceAvailable,setVoiceAvailable]=useState(false);
  const [voicePartial,setVoicePartial]=useState('');
  const spellingCopy=dictationCopy[language];
  const [spellingEnabled,setSpellingEnabled]=useState(false),[spellingUnavailable,setSpellingUnavailable]=useState(false);
  const spelling=useRef(false), spellingRequests=useRef(new Set<AbortController>());
  const voiceDocument=useRef<{base:string;expected:string;parts:string[]}|null>(null);
  const noteRef=useRef(note);
  useEffect(()=>{noteRef.current=note;},[note]);
  const voice=useRef<DreamDictation|null>(null); const active=useRef(true); const pending=useRef(false);
  const voiceGeneration=useRef(0), deleting=useRef(false);
  const dateTouched=useRef(false);
  const [deleteConfirm,setDeleteConfirm]=useState(false);
  const native=useRef<HTMLDialogElement|null>(null);
  const stop=useCallback((preserve=true)=>{
    ++voiceGeneration.current;const old=voice.current;voice.current=null;
    const remainder=old?.cancel()??'';voiceDocument.current=null;
    for(const request of spellingRequests.current)request.abort();spellingRequests.current.clear();
    setListening(false);setVoicePartial('');
    const body=preserve?appendDictation(noteRef.current.body,formatDictation(remainder,language),language).slice(0,30000):noteRef.current.body;
    if(body!==noteRef.current.body){noteRef.current={...noteRef.current,body};setNote(current=>({...current,body}));}
    return {...noteRef.current,body};
  },[language]);
  const close=()=>{if(diary.busy||pending.current||deleting.current)return;const closing=stop(); if(!closing.body.trim()){onClose();return;}
    if (record&&!record.draftKey&&JSON.stringify({...record.note,updatedAt:""})===JSON.stringify({...closing,updatedAt:""})){onClose();return;}
    pending.current=true;void diary.keepDraft({...closing,updatedAt:new Date().toISOString()},record).then(onClose)
      .catch(()=>setError(common.draftError)).finally(()=>{pending.current=false;});};
  const focus=useDialogAccessibility<HTMLDialogElement>(close);
  const update=(patch:Partial<DiaryNote>)=>{if(patch.dream)dateTouched.current=true;setNote(current=>({...current,...patch}));setError("");};
  const zone=note.dream!.timeZone;
  useEffect(()=>{
    native.current?.showModal(); active.current=true;
    const speech=window as typeof window&{SpeechRecognition?:DreamRecognitionConstructor;webkitSpeechRecognition?:DreamRecognitionConstructor};
    queueMicrotask(()=>setVoiceAvailable(Boolean(speech.SpeechRecognition??speech.webkitSpeechRecognition)));
    const hidden=()=>{if(document.visibilityState!=="visible")stop();};
    document.addEventListener("visibilitychange",hidden);
    return()=>{active.current=false;stop(false);document.removeEventListener("visibilitychange",hidden);};
  },[stop]);
  useEffect(()=>{if(!voiceAllowed&&(voice.current||listening))stop();},[voiceAllowed,listening,stop]);
  useEffect(()=>{
    let live=true; const controller=new AbortController();
    void dreamToday(zone,controller.signal)
      .then(result=>{if(!live)return;setToday(result);
        if(!record&&(!dateEditable||!dateTouched.current))setNote(current=>({...current,dream:{...current.dream!,day:result}}));})
      .catch(()=>{if(live)setError(common.error);}).finally(()=>{if(live)setChecking(false);});
    return()=>{live=false;controller.abort();};
  },[dreamToday,user.uid,zone,date,record,dateEditable,common.error]);
  const valid=Boolean(today&&validDreamDay(note.dream?.day)&&note.dream!.day<=today&&(note.body.trim()||voicePartial.trim()));
  const save=async()=>{if(!valid||diary.busy||pending.current||deleting.current||!diary.syncEnabled)return;pending.current=true;const saving=stop();setError("");
    try {await diary.save({...saving,updatedAt:new Date().toISOString()},record);onSaved(saving.dream!.day);}
    catch (failure) {const code=failure instanceof GenesisApiError?failure.payload?.error:null;setConflict(code==="DIARY_REVISION_CONFLICT");setError(code==="DREAM_FUTURE_DATE"?text.future:code==="DIARY_REVISION_CONFLICT"?common.conflict:common.error);} finally{pending.current=false;}};
  const dictate=async()=>{
    if(listening){if(voice.current)voice.current.stop();else stop();return;}
    if(!voiceAllowed){requestUpgrade({feature:"dream-voice",reason:"feature"});return;}
    if(pending.current||deleting.current)return;
    stop(false);const generation=++voiceGeneration.current;setListening(true);setError('');setSpellingUnavailable(false);
    try {
      await diary.authorizeDreamVoice(); if(!active.current||deleting.current||generation!==voiceGeneration.current)return;
      const speech=window as typeof window&{SpeechRecognition?:DreamRecognitionConstructor;webkitSpeechRecognition?:DreamRecognitionConstructor};
      const C=speech.SpeechRecognition??speech.webkitSpeechRecognition;if(!C)throw new Error("UNAVAILABLE");
      const session={base:noteRef.current.body,expected:noteRef.current.body,parts:[] as string[]};voiceDocument.current=session;
      const current=()=>active.current&&!deleting.current&&generation===voiceGeneration.current&&voiceDocument.current===session;
      const publish=()=>{
        const previous=session.expected,next=session.parts.reduce((body,part)=>appendDictation(body,part,language),session.base).slice(0,30000);
        session.expected=next;noteRef.current={...noteRef.current,body:next};
        setNote(value=>value.body===previous?{...value,body:next}:value);
      };
      voice.current=new DreamDictation(C,dictationLocale(language),{
        partial:value=>{if(current())setVoicePartial(value);},listening:value=>{if(current())setListening(value);},
        failure:()=>{if(current())setError(text.unavailable);},
        text:(heard,confirmed)=>{
          if(!current())return;const phrase=formatDictation(heard,language);if(!phrase)return;
          const index=session.parts.push(phrase)-1;publish();
          if(!confirmed||!spelling.current||!supportedSpellingLanguage(language))return;
          const controller=new AbortController();spellingRequests.current.add(controller);
          void correctDictationSpelling(heard,language,controller.signal).then(result=>{
            if(!current()||!spelling.current||controller.signal.aborted)return;
            setSpellingUnavailable(!result.available);
            if(result.available){session.parts[index]=formatDictation(result.text,language);publish();}
          }).finally(()=>spellingRequests.current.delete(controller));
        }
      });
      voice.current.start();
    } catch {if(active.current&&!deleting.current&&generation===voiceGeneration.current){setListening(false);setError(text.unavailable);}}
  };
  const erase=async()=>{
    if(diary.busy)return;deleting.current=true;stop(false);setError('');
    try {if(record&&!record.draftKey)await diary.remove(record);else await diary.discardEditorDraft(note.id,record?.draftKey);onClose();}
    catch {deleting.current=false;setDeleteConfirm(false);setError(common.error);}
  };
  return <dialog ref={element=>{native.current=element;focus(element);}} className="dream-editor" aria-labelledby="dream-editor-title" onCancel={event=>{event.preventDefault();close();}}>
    <form onSubmit={event=>{event.preventDefault();void save();}}>
      <header><h2 id="dream-editor-title">{text.record}</h2>
       {dateEditable?<div className="dream-header-date"><CalendarDatePicker value={note.dream!.day} mode={dateMode} max={today||undefined} required ariaLabel={text.date} showGregorianReference={false} triggerText={compactDreamDate(note.dream!.day,dateMode)} onChange={day=>update({dream:{...note.dream!,day}})}/></div>:null}
       <DialogCloseButton type="button" onClick={close} aria-label={common.closeDraft} disabled={diary.busy}/>
      </header>
      {dateEditable&&calendars.length>1?<details className="dream-date-calendar"><summary>{translateText("Календарь ввода",language)}</summary><div className="dream-filters">{calendars.map(mode=><button type="button" key={mode} aria-pressed={dateMode===mode} onClick={()=>setDateMode(mode)}>{translateText(mode==='profane'?'Григорианский':mode==='sacred'?'Сакральный':'Лунный',language)}</button>)}</div></details>:null}
      {checking?<p role="status">{text.check}</p>:null}
      {today&&note.dream!.day>today?<p role="alert">{text.future}</p>:null}
      <label><span>{common.heading}</span><input value={note.title} maxLength={200} disabled={diary.busy} onChange={event=>update({title:event.target.value})}/></label>
      <label><span>{common.body}</span><textarea value={appendDictation(note.body,formatDictation(voicePartial,language,false),language).slice(0,30000)} maxLength={30000} rows={9} required spellCheck autoCorrect="on" autoCapitalize="sentences" lang={dictationLocale(language)} disabled={diary.busy} onChange={event=>{stop(false);update({body:event.target.value});}}/></label>
      <div className="dream-editor-flags"><label className="dream-check"><input type="checkbox" checked={note.reaction==='favorite'} disabled={diary.busy||deleteConfirm} onChange={event=>update({reaction:event.target.checked?'favorite':null})}/><span>{text.favorites}</span></label>
      <label className="dream-check"><input type="checkbox" checked={note.dream!.lucid===true} disabled={diary.busy||deleteConfirm} onChange={event=>update({dream:{...note.dream!,lucid:event.target.checked}})}/><span>{text.lucid}</span></label></div>
      {voiceAllowed?<><button type="button" className="secondary-button" aria-pressed={listening} disabled={diary.busy||!voiceAvailable} onClick={()=>void dictate()}>{listening?text.stop:text.voice}</button><small>{voiceAvailable?text.voicePrivacy:text.unavailable}</small></>:<small>{text.premium}</small>}
      {voiceAllowed&&supportedSpellingLanguage(language)?<div className="dream-spelling-settings"><label className="dream-check"><input type="checkbox" checked={spellingEnabled} disabled={diary.busy} onChange={event=>{const enabled=event.target.checked;spelling.current=enabled;setSpellingEnabled(enabled);setSpellingUnavailable(false);if(!enabled){for(const request of spellingRequests.current)request.abort();spellingRequests.current.clear();}}}/><span>{spellingCopy.spellcheck}</span></label><small>{spellingCopy.privacy} <a href="https://yandex.ru/dev/speller/" target="_blank" rel="noopener noreferrer">{spellingCopy.credit}</a></small>{spellingUnavailable?<small role="status">{spellingCopy.unavailable}</small>:null}</div>:null}
      <p className="dream-editor-privacy">{common.private}</p>
      {!diary.syncEnabled?<p role="alert">{text.cloud}</p>:null}
      {error?<p role="alert">{error}</p>:null}
      {deleteConfirm?<div className="dream-delete-confirm" role="group" aria-label={record&&!record.draftKey?text.deleteDream:text.discard}><p>{record&&!record.draftKey?text.deleteConfirm:text.discardConfirm}</p><button type="button" className="danger" disabled={diary.busy} onClick={()=>void erase()}>{text.deleteAction}</button><button type="button" disabled={diary.busy} onClick={()=>{deleting.current=false;setDeleteConfirm(false);}}>{text.cancel}</button></div>:<button type="button" className="danger" disabled={diary.busy} onClick={()=>{deleting.current=true;stop();setDeleteConfirm(true);}}>{record&&!record.draftKey?text.deleteDream:text.discard}</button>}
      {conflict?<button type="button" className="secondary-button" disabled={diary.busy||!valid||!diary.syncEnabled} onClick={()=>{if(pending.current)return;pending.current=true;const now=new Date().toISOString();
        const copying=stop();void diary.save({...copying,id:crypto.randomUUID(),createdAt:now,updatedAt:now}).then(()=>{if(record?.draftKey)diary.discard(record.draftKey);diary.discardOwn(copying.id);onSaved(copying.dream!.day);})
          .catch(()=>setError(common.error)).finally(()=>{pending.current=false;});}}>{common.copy}</button>:null}
      <footer><button type="button" className="secondary-button" onClick={close} disabled={diary.busy||deleteConfirm}>{common.closeDraft}</button><button type="submit" className="primary-button" disabled={!valid||checking||diary.busy||!diary.syncEnabled||deleteConfirm}>{common.save}</button></footer>
    </form>
  </dialog>;
}
