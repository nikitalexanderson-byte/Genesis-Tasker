"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import {useEffect, useId, useRef, useState} from "react";
import {assignSharedMemberPermissions, changeSharedSpaceRole, listSharedMemberCategories, loadSharedSpaceSettings, saveSharedMemberCategory,
  type SharedMemberCategory, type SharedPermissions, type SharedSpace, type SharedSpaceSettings} from "./cloud-sync";
import {defaultSpacePermissions, PermissionChecks} from "./SharedSpaceForm";
import {ExperimentalIcon} from "./ExperimentalIcon";
import {SharedMemberMessageButton} from "./SharedMemberMessageButton";
import {SharedProjectAccessPanel} from "./SharedProjectAccessPanel";
import type {Language} from "./i18n";

export function SharedTeamPermissions({spaceId,userId,english,language,onChanged,onMessage}: {spaceId:string;userId:string;english:boolean;language:Language;onChanged:()=>Promise<void>;onMessage?:()=>void}) {
  const [settings,setSettings]=useState<SharedSpaceSettings|null>(null);
  const [categories,setCategories]=useState<SharedMemberCategory[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [editor,setEditor]=useState<SharedMemberCategory|"new"|null>(null);
  const [title,setTitle]=useState("");
  const [permissions,setPermissions]=useState<SharedPermissions>(()=>defaultSpacePermissions("member"));
  const dialog=useRef<HTMLDialogElement>(null),titleId=useId();
  const refresh=async()=>{const [next,items]=await Promise.all([loadSharedSpaceSettings(spaceId),listSharedMemberCategories(spaceId)]);setSettings(next);setCategories(items);};
  useEffect(()=>{let live=true;void Promise.all([loadSharedSpaceSettings(spaceId),listSharedMemberCategories(spaceId)]).then(([next,items])=>{if(live){setSettings(next);setCategories(items);}}).catch(reason=>{if(live)setError(String(reason));});return()=>{live=false;};},[spaceId]);
  useEffect(()=>{if(editor&&!dialog.current?.open){dialog.current?.showModal();dialog.current?.querySelector<HTMLInputElement>("input")?.focus();}if(!editor&&dialog.current?.open)dialog.current.close();},[editor]);
  const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError("");try{await action();await refresh();await onChanged();}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
  const openEditor=(item:SharedMemberCategory|"new")=>{setTitle(item==="new"?"":item.title);setPermissions(item==="new"?defaultSpacePermissions("member"):item.permissions);setError("");setEditor(item);};
  const owner=settings?.space.role==="owner";
  const roleName=(role:string)=>({owner:english?"Owner":"Владелец",admin:english?"Admin":"Администратор",member:english?"Member":"Участник",guest:english?"Guest":"Гость"})[role as SharedSpace["role"]];
  return <div className="shared-team-permissions">
    {error&&!editor?<p role="alert">{error}</p>:null}
    {!settings?<p role="status">{english?"Loading…":"Загрузка…"}</p>:<>
      <section className="shared-member-category-section"><header><h3>{english?"Participant categories":"Категории участников"}</h3>
        {owner?<button className="secondary-button" disabled={busy} type="button" onClick={()=>openEditor("new")}><ExperimentalIcon name="plus"/>{english?"New category":"Новая категория"}</button>:null}</header>
        {categories.length?<div className="shared-member-category-list">{categories.map(category=><div key={category.id}><strong data-no-translate>{category.title}</strong>
          {owner?<button type="button" className="secondary-button" disabled={busy} onClick={()=>openEditor(category)}>{english?"Edit permissions":"Настроить права"}</button>:null}</div>)}</div>:<p>{english?"Create a category to apply the same permissions to several people.":"Создайте категорию, чтобы назначать одинаковые права нескольким людям."}</p>}
      </section>
      <section className="shared-team-member-list"><h3>{english?"Members and permissions":"Участники и права"}</h3>
        {settings.members.map(member=><article className="shared-team-member" key={member.userId}>
          <header className="shared-team-member-identity"><ExperimentalIcon name="team"/><div><h4 data-no-translate>{member.displayName||member.email}</h4><span>{roleName(member.role)}</span></div>
            <SharedMemberMessageButton actorId={userId} peer={{spaceId,userId:member.userId,displayName:member.displayName||member.email}} language={language} onOpen={onMessage}/>
          </header>
          <label>{english?"Workspace access":"Доступ к пространству"}<select value={member.role} disabled={busy||!owner} onChange={event=>void run(async()=>{await changeSharedSpaceRole(spaceId,member.userId,event.target.value);})}>
            {["owner","admin","member","guest"].map(role=><option key={role} value={role}>{roleName(role)}</option>)}</select></label>
          {member.role!=="owner"?<>
            <label>{english?"Permission source":"Права участника"}<select value={member.categoryId??""} disabled={busy||!owner} onChange={event=>{const value=event.target.value;void run(async()=>{await assignSharedMemberPermissions(spaceId,member.userId,value||null,value?undefined:member.permissions);});}}>
              <option value="">{english?"Manual permissions":"Вручную"}</option>{categories.map(category=><option key={category.id} value={category.id}>{category.title}</option>)}</select></label>
            <PermissionChecks language={english?"en":"ru"} value={member.permissions} disabled={busy||!owner||Boolean(member.categoryId)}
              onChange={next=>void run(async()=>{await assignSharedMemberPermissions(spaceId,member.userId,null,next);})}/>
            {member.categoryId?<p className="shared-permissions-note">{english?"Permissions update automatically with the category.":"Права обновляются автоматически вместе с категорией."}</p>:null}
            {owner&&member.role!=="admin"?<SharedProjectAccessPanel key={`${spaceId}:${member.userId}`} spaceId={spaceId} userId={member.userId} actorId={userId} language={language} disabled={busy} onChanged={async()=>{await refresh();await onChanged();}}/>:null}
          </>:null}
        </article>)}
      </section>
    </>}
    <dialog ref={dialog} className="shared-projects-modal shared-member-category-modal" aria-labelledby={titleId} onCancel={event=>{event.stopPropagation();if(busy)event.preventDefault();}} onClose={event=>{event.stopPropagation();setEditor(null);}}>
      {editor?<><header><h2 id={titleId}>{editor==="new"?(english?"New participant category":"Новая категория участников"):(english?"Category permissions":"Права категории")}</h2>
        <DialogCloseButton type="button" className="shared-projects-close" aria-label={english?"Close":"Закрыть"} disabled={busy} onClick={()=>setEditor(null)} /></header>
        <form onSubmit={event=>{event.preventDefault();const current=editor;if(!current)return;void run(async()=>{await saveSharedMemberCategory(spaceId,{title:title.trim(),permissions,...(current!=="new"?{expectedRevision:current.revision}:{})},current!=="new"?current.id:undefined);setEditor(null);});}}>
          <label>{english?"Category name":"Название категории"}<input value={title} maxLength={80} required disabled={busy} onChange={event=>setTitle(event.target.value)}/></label>
          <PermissionChecks language={english?"en":"ru"} value={permissions} disabled={busy} onChange={setPermissions}/>
          {error?<p role="alert">{error}</p>:null}<button type="submit" className="primary-button" disabled={busy||!title.trim()}>{english?"Save":"Сохранить"}</button>
        </form></>:null}
    </dialog>
  </div>;
}
