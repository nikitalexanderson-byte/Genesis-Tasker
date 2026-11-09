"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import {useEffect,useRef,useState} from 'react';
import {ExperimentalIcon} from './ExperimentalIcon';
import {translateText,type Language} from './i18n';
import type {SharedComment,GenesisTask,GenesisProject,GoogleTaskList} from './cloud-sync';
import './shared-projects-layout.css';
import {PersonalTaskListContents,type PersonalListContentActions} from './PersonalTaskListContents';

export type PersonalPreviewData={title:string;description?:string;kind:string;tags?:string[];fields:[string,string][];comments:SharedComment[]};
export default function PersonalEntityPreview({task,project,list,listContents,schedule,projectTitle,taskCount,language,onClose,onEdit,onComment,onCommentsRead}:{task?:GenesisTask;project?:GenesisProject;list?:GoogleTaskList;listContents?:PersonalListContentActions;schedule:string;projectTitle:string;taskCount:number;language:string;onClose:()=>void;onEdit:()=>void;onComment:(body:string)=>Promise<void>;onCommentsRead?:(ids:string[])=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(false),pending=useRef(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const readCallback=useRef(onCommentsRead);
  useEffect(()=>{readCallback.current=onCommentsRead;},[onCommentsRead]);
  const commentsKey=JSON.stringify(task?.comments?.map(comment=>comment.id)??[]);
  useEffect(()=>{
    if(!task?.id)return;
    const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('[data-personal-comment-id]')??[]);
    const shown=new Set<string>();
    const read=(items:HTMLElement[])=>{
      if(document.visibilityState!=="visible")return;
      const ids=items.map(item=>item.dataset.personalCommentId??"").filter(id=>id&&!shown.has(id));
      if(ids.length){ids.forEach(id=>shown.add(id));readCallback.current?.(ids);}
    };
    const observer=new IntersectionObserver(entries=>read(entries.filter(item=>item.isIntersecting).map(item=>item.target as HTMLElement)),{root:dialog.current,threshold:0.3});
    nodes.forEach(node=>observer.observe(node));
    const visible=()=>read(nodes.filter(node=>{const box=node.getBoundingClientRect(),root=dialog.current?.getBoundingClientRect();return root&&box.bottom>root.top&&box.top<root.bottom;}));
    document.addEventListener("visibilitychange",visible);
    return()=>{observer.disconnect();document.removeEventListener("visibilitychange",visible);};
  },[task?.id,commentsKey]);
  const entity=task??project??list;
  if(!entity)return null;
  const date=(value:string|number|undefined|null)=>value?new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';
  const data:PersonalPreviewData={title:entity.title,kind:task?({task:'Задача',meeting:'Встреча',event:'Событие',birthday:'День рождения'}[task.entryType??'task']):project?'Проект':'Список задач',description:task?.description??project?.description,tags:task?.tags??project?.tags,comments:entity.comments??[],fields:task?[['Создатель',task.createdByName??'—'],['Создано',date(task.createdAt)],['Обновлено',date(task.updatedAt)],['Срок',schedule],['Проект',projectTitle]]:project?[['Создатель',project.createdByName??'—'],['Создано',date(project.createdAt)],['Задачи',String(taskCount)]]:[['Задачи',String(taskCount)],['Обновлено',date(list?.updatedAt)]]};
  const t=(text:string)=>translateText(text,language as Language);
  const editButton=<button className="secondary-button" type="button" onClick={onEdit}><ExperimentalIcon name="edit"/>{t(list?'Переименовать список':'Редактировать')}</button>;
  const fields=<dl>{data.fields.filter(([label])=>!list||!listContents||label!=='Задачи').map(([label,value])=><div key={label}><dt>{t(label)}</dt><dd data-no-translate>{value||'—'}</dd></div>)}</dl>;
  return <dialog ref={dialog} aria-labelledby="personal-preview-title" className={`shared-projects-modal entity-preview-modal${list||task?' personal-entity-preview-modal':''}${list?' personal-list-preview-modal':''}`} onClose={onClose}>
    <header><h2 id="personal-preview-title" data-no-translate>{data.title}</h2><DialogCloseButton type="button" className="icon-button" aria-label={t('Закрыть')} onClick={onClose} /></header>
    <div className="entity-preview-columns"><div className="personal-preview-main"><section className={`entity-information${task?' personal-preview-description':''}`}>
      {list||task?<header><h3>{t(data.kind)}</h3>{editButton}</header>:<h3>{t(data.kind)}</h3>}
      {data.description?<p data-no-translate>{data.description}</p>:null}
      {!task?fields:null}
      {data.tags?.length?<p data-no-translate>{data.tags.map(tag=>`#${tag}`).join(' ')}</p>:null}
      {!list&&!task?editButton:null}
    </section>{task?<section className="entity-information personal-preview-details"><h3>{t('Дополнительная информация')}</h3>{fields}</section>:null}
    {list&&listContents?<PersonalTaskListContents {...listContents} language={language as Language}/>:null}</div>
    <section className="shared-task-comments"><h3>{t('Комментарии')} · {data.comments.length}</h3>{data.comments.map(comment=><article key={comment.id} data-personal-comment-id={comment.id}><header><strong data-no-translate>{comment.authorName}</strong><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(comment.createdAt))}</time></header><p data-no-translate>{comment.body}</p></article>)}<form onSubmit={event=>{event.preventDefault();if(pending.current||!body.trim())return;pending.current=true;setBusy(true);setError(false);void onComment(body.trim()).then(()=>setBody('')).catch(()=>setError(true)).finally(()=>{pending.current=false;setBusy(false);});}}><label>{t('Комментарий')}<textarea value={body} maxLength={5000} disabled={busy} onChange={event=>setBody(event.target.value)}/></label><button className="primary-button" disabled={busy||!body.trim()}>{t('Отправить комментарий')}</button></form>{error?<p role="alert">{t('Не удалось сохранить изменения')}</p>:null}</section></div>
  </dialog>;
}
