'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';
import {externalCopyText} from './e2ee/external-copy';
import {googleCopyContent,prepareGoogleCopy,sendGoogleCopy,retainedGoogleCopies,type GoogleCopyContent,type GoogleCopyJob,type GoogleCopyPayload} from './e2ee/google-copy-product';
import {deviceTimeZone} from './calendar-context';
import {translateText,type Language} from './i18n';
import type {GoogleAccount} from './cloud-sync';
import copy from '../contracts/e2ee/google-copy-copy-v1.json';
import './private-google-copy.css';

export function PrivateGoogleCopy({ownerId,language,accounts,source}:{ownerId:string;language:Language;accounts:GoogleAccount[];source:Parameters<typeof googleCopyContent>[0]}){
 const text=copy[language as keyof typeof copy]??copy.en,disclosure=externalCopyText(language),t=(value:string)=>translateText(value,language),generation=useRef(0),running=useRef(false);
 const [provider,setProvider]=useState<GoogleCopyPayload['provider']>('google-tasks'),[accountId,setAccountId]=useState(accounts[0]?.id??''),[job,setJob]=useState<GoogleCopyJob|null>(null),[jobs,setJobs]=useState<GoogleCopyJob[]>([]),[reviewed,setReviewed]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false),[visible,setVisible]=useState(20),[allDay,setAllDay]=useState(false);
 useEffect(()=>{const unsubscribe=subscribePrivateAccount(()=>{generation.current++;setJob(null);setJobs([]);setReviewed('');setMessage('');});return()=>{generation.current++;unsubscribe();};},[ownerId]);
 const draft=useMemo(()=>{try{return googleCopyContent(source,deviceTimeZone());}catch{return null;}},[source]);
 const service=job?.payload.provider??provider,content:GoogleCopyContent|null=job?.payload.copy??(draft&&service==='google-calendar'&&allDay?{...draft,startTime:null,endTime:null}:draft),target=job?.payload.accountId??accountId,signature=JSON.stringify({content,target,service}),available=accounts.some(row=>row.id===target&&(service==='google-tasks'?row.googleTasksImportReady:row.calendarConnected));
 const change=()=>{setJob(null);setReviewed('');setMessage('');setFailed(false);};
 const run=async(load=false)=>{if(running.current||!load&&(!content||reviewed!==signature||!available))return;running.current=true;setBusy(true);setMessage('');setFailed(false);const token=generation.current;
  try{const account=requirePrivateAccount(ownerId);if(load){const rows=await retainedGoogleCopies(account);account.requireOpen();if(token===generation.current)setJobs(rows);return;}
   const staged=job??await prepareGoogleCopy(account,service,target,content!);account.requireOpen();if(token!==generation.current)throw new Error('E2EE_ACCOUNT_CHANGED');setJob(staged);
   const result=await sendGoogleCopy(account,staged,true);account.requireOpen();if(token!==generation.current)return;setJob(result);setReviewed('');setMessage(result.state==='complete'?text.complete:text.uncertain);
  }catch{if(token===generation.current)setFailed(true);}finally{running.current=false;setBusy(false);}
 };
 return <details className="private-google-copy" data-no-translate><summary>{text.title}</summary><fieldset disabled={busy}>
  <label>{text.title}<select value={service} onChange={event=>{change();setProvider(event.target.value as GoogleCopyPayload['provider']);}}><option value="google-tasks">Google Tasks</option><option value="google-calendar">Google Calendar</option></select></label>
  <label>{t('Google-аккаунт')}<select value={target} onChange={event=>{change();setAccountId(event.target.value);}}><option value="">—</option>{accounts.map(row=><option key={row.id} value={row.id}>{row.email}</option>)}</select></label>
  {service==='google-calendar'&&!job?<label className="backup-check"><input type="checkbox" checked={allDay} onChange={event=>{setAllDay(event.target.checked);setReviewed('');}}/>{t('Весь день')}</label>:null}
  {content?<dl><dt>{t('Название')}</dt><dd>{content.title}</dd><dt>{t('Описание')}</dt><dd style={{whiteSpace:'pre-wrap'}}>{content.description||'—'}</dd><dt>{t('Дата')}</dt><dd>{content.dueDate??'—'}</dd><dt>{t('Начало')}</dt><dd>{[content.startDate,content.startTime].filter(Boolean).join(' ')||'—'}</dd><dt>{t('Окончание')}</dt><dd>{content.endTime??'—'}</dd><dt>{t('Часовой пояс')}</dt><dd>{content.timeZone}</dd>{content.completedAt?<><dt>{t('Выполнено')}</dt><dd>{content.completedAt}</dd></>:null}</dl>:null}
  <p>{disclosure.notice.replace('{provider}',service==='google-tasks'?'Google Tasks':'Google Calendar')}</p>
  <label className="backup-check"><input type="checkbox" checked={reviewed===signature} onChange={event=>setReviewed(event.target.checked?signature:'')}/>{disclosure.accept}</label>
  <button type="button" onClick={()=>void run()} disabled={!content||reviewed!==signature||!available||job?.state==='complete'||service==='google-calendar'&&(!content.dueDate||!!content.startTime!==!!content.endTime)}>{text.send}</button>
  <button type="button" onClick={()=>void run(true)}>{text.pending}</button>
  {jobs.slice(0,visible).map(row=><button type="button" key={row.payload.operationId} onClick={()=>{setJob(row);setReviewed('');setMessage('');setFailed(false);}}>{text.review}: {row.payload.copy.title} · {row.payload.provider==='google-tasks'?'Google Tasks':'Google Calendar'}</button>)}
  {jobs.length>visible?<button type="button" onClick={()=>setVisible(value=>value+20)}>{t('Показать ещё')}</button>:null}
 </fieldset>{message?<p role="status">{message}</p>:null}{failed?<p role="alert">{text.error}</p>:null}</details>;
}
