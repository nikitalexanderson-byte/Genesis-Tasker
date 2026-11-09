"use client";
import { DialogCloseButton } from "./DialogCloseButton";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { deleteSharedLabel, saveSharedLabel, type SharedLabel } from "./cloud-sync";

function labelStyle(color: string): CSSProperties {
  const rgb = [1,3,5].map(offset => parseInt(color.slice(offset,offset+2),16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value+.055)/1.055)**2.4);
  const luminance = rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722;
  return {backgroundColor:color,color:luminance > .179 ? "#000" : "#fff"};
}

export function SharedLabelBadges({labels,ids}:{labels:SharedLabel[];ids?:string[]}) {
  const chosen = labels.filter(label => ids?.includes(label.id));
  return chosen.length ? <span className="shared-label-badges">{chosen.map(label => <span key={label.id} className="shared-label-badge" style={labelStyle(label.color)} data-no-translate>{label.title}</span>)}</span> : null;
}

export function SharedLabelPicker({labels,value,onChange,english,onManage,disabled}:{labels:SharedLabel[];value:string[];onChange:(ids:string[])=>void;english:boolean;onManage?:()=>void;disabled?:boolean}) {
  return <details className="shared-label-picker"><summary>{english ? "Workspace labels" : "Метки пространства"}{value.length ? ` · ${value.length}` : ""}</summary>
    <SharedLabelBadges labels={labels} ids={value}/>
    {labels.length ? <fieldset disabled={disabled}><legend>{english ? "Select labels" : "Выбрать метки"}</legend>
      {labels.map(label => <label key={label.id}><input type="checkbox" checked={value.includes(label.id)} onChange={event=>onChange(event.target.checked ? [...value,label.id] : value.filter(id=>id!==label.id))}/>
        <span className="shared-label-badge" style={labelStyle(label.color)} data-no-translate>{label.title}</span></label>)}
    </fieldset> : <p>{english ? "No labels yet." : "Меток пока нет."}</p>}
    {onManage ? <button type="button" className="secondary-button" onClick={onManage}>{english ? "Manage labels" : "Управление метками"}</button> : null}
  </details>;
}

export function SharedLabelsDialog({spaceId,labels,english,onClose,onChanged}:{spaceId:string;labels:SharedLabel[];english:boolean;onClose:()=>void;onChanged:()=>Promise<void>}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [editing,setEditing] = useState<SharedLabel>();
  const [title,setTitle] = useState(""); const [color,setColor] = useState("#2d6c68");
  const [busy,setBusy] = useState(false); const [error,setError] = useState("");
  useEffect(()=>{dialog.current?.showModal();},[]);
  const run = async (action:()=>Promise<unknown>)=>{
    setBusy(true); setError("");
    try {await action(); await onChanged(); setEditing(undefined);setTitle("");}
    catch {setError(english ? "Could not save labels. Refresh the workspace and try again." : "Не удалось сохранить метки. Обновите пространство и повторите попытку.");}
    finally {setBusy(false);}
  };
  return <dialog ref={dialog} className="shared-projects-modal shared-labels-modal" aria-labelledby="shared-labels-title" onClose={onClose}>
    <header><h2 id="shared-labels-title">{english ? "Workspace labels" : "Метки пространства"}</h2><DialogCloseButton type="button" className="shared-projects-close" disabled={busy} aria-label={english ? "Close" : "Закрыть"} onClick={()=>dialog.current?.close()} /></header>
    <p>{english ? "Use several labels to mark types, priorities or departments. Everyone in the workspace shares this set." : "Назначайте несколько меток по типам, приоритетам или отделам. Набор меток общий для участников пространства."}</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className="shared-label-manager-list">{labels.map(label=><div key={label.id}><SharedLabelBadges labels={[label]} ids={[label.id]}/>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>{setEditing(label);setTitle(label.title);setColor(label.color);}}>{english ? "Edit" : "Изменить"}</button>
      <button type="button" className="secondary-button danger-button" disabled={busy} onClick={()=>{if(window.confirm(english ? "Delete this label from all projects and tasks?" : "Удалить эту метку из всех проектов и задач?")) void run(()=>deleteSharedLabel(spaceId,label));}}>{english ? "Delete" : "Удалить"}</button>
    </div>)}</div>
    <form onSubmit={event=>{event.preventDefault();void run(()=>saveSharedLabel(spaceId,title,color,editing));}}>
      <h3>{editing ? (english ? "Edit label" : "Изменить метку") : (english ? "New label" : "Новая метка")}</h3>
      <label>{english ? "Label name" : "Название метки"}<input value={title} maxLength={40} required onChange={event=>setTitle(event.target.value)}/></label>
      <label>{english ? "Color" : "Цвет"}<input type="color" value={color} onChange={event=>setColor(event.target.value)}/></label>
      <SharedLabelBadges labels={[{id:"preview",title:title|| (english ? "Preview" : "Предпросмотр"),color,position:0,revision:1}]} ids={["preview"]}/>
      <button type="submit" className="primary-button" disabled={busy||(!editing&&labels.length>=50)}>{editing ? (english ? "Save" : "Сохранить") : (english ? "Create label" : "Создать метку")}</button>
      {editing ? <button type="button" disabled={busy} onClick={()=>{setEditing(undefined);setTitle("");}}>{english ? "Cancel" : "Отмена"}</button> : null}
    </form>
  </dialog>;
}
