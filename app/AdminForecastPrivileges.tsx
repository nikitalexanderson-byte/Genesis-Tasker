"use client";
import {useRef,useState} from 'react';
import {setAdminForecastPrivilege,type AdminUserStats} from './cloud-sync';
import {modelingServiceCopy} from './modeling-service';
import type {Language} from './i18n';

export function AdminForecastPrivileges({users,language,onSaved,onRefresh}:{users:readonly AdminUserStats[];language:Language;
  onSaved:(value:{userId:string;forecastElitePlus:boolean;forecastPrivilegeRevision:number})=>void;onRefresh:()=>Promise<void>}) {
  const text=modelingServiceCopy(language);const [search,setSearch]=useState('');const [selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');const pending=useRef(false);
  const needle=search.trim().toLocaleLowerCase(language);
  const matches=users.filter(user=>`${user.displayName} ${user.email}`.toLocaleLowerCase(language).includes(needle));
  const candidate=matches.find(user=>user.id===selected&&!user.forecastElitePlus);
  async function save(user:AdminUserStats,enabled:boolean) {
    if(pending.current)return;pending.current=true;setBusy(true);setMessage('');setError('');
    try {const result=await setAdminForecastPrivilege(user.id,enabled,user.forecastPrivilegeRevision??0);onSaved(result);setSelected('');setMessage(text.saved);}
    catch {setError(text.privilegeError);try{await onRefresh();}catch{ /* Keep the last visible list and the retryable error. */ }}finally{pending.current=false;setBusy(false);}
  }
  return <section className="admin-forecast-privileges" aria-labelledby="admin-forecast-title" data-no-translate>
    <h2 id="admin-forecast-title">{text.privilegeTab}</h2><p>{text.privilegeHelp}</p>
    <label><span>{text.searchUser}</span><input type="search" value={search} onChange={event=>{setSearch(event.target.value);setSelected('');}} disabled={busy}/></label>
    <div className="admin-forecast-grant">
      <label><span>{text.chooseUser}</span><select value={selected} onChange={event=>setSelected(event.target.value)} disabled={busy}>
        <option value="">{text.chooseUser}</option>{matches.filter(user=>!user.forecastElitePlus).map(user=><option value={user.id} key={user.id}>{user.displayName} · {user.email}</option>)}
      </select></label>
      <button type="button" className="primary-button" disabled={busy||!candidate} onClick={()=>candidate&&void save(candidate,true)}>{text.grant}</button>
    </div>
    <ul className="admin-forecast-members">{matches.filter(user=>user.forecastElitePlus).map(user=><li key={user.id}>
      <span><strong>{user.displayName||user.email}</strong><small>{user.email}</small><span className="admin-elite-plus">Elite+</span></span>
      <button type="button" className="secondary-button" disabled={busy} aria-label={`${text.revoke}: ${user.email}`} onClick={()=>void save(user,false)}>{text.revoke}</button>
    </li>)}</ul>
    {message?<p role="status">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
  </section>;
}
