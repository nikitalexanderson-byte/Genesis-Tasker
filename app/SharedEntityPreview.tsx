"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { useEffect, useRef, useState } from 'react';
import { loadSharedProject, sharedCollaborationRequest, type SharedComment, type SharedProjectSnapshot } from './cloud-sync';
import { SharedComments } from './SharedComments';
import { ExperimentalIcon } from './ExperimentalIcon';
import { translateText, type Language } from './i18n';

export default function SharedEntityPreview({id,boardId,language,onClose,onEdit}:{id:string;boardId?:string;language:string;onClose:()=>void;onEdit:(snapshot:SharedProjectSnapshot)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[snapshot,setSnapshot]=useState<SharedProjectSnapshot|null>(null),[comments,setComments]=useState<SharedComment[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const t=(text:string)=>translateText(text,language as Language);
  useEffect(()=>{dialog.current?.showModal();let active=true;void Promise.all([loadSharedProject(id),sharedCollaborationRequest<{comments:SharedComment[]}>(`/projects/${encodeURIComponent(id)}/comments${boardId?`?board=${encodeURIComponent(boardId)}`:""}`)]).then(([data,discussion])=>{if(active){setSnapshot(data);setComments(discussion.comments);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[id,boardId]);
  return <dialog ref={dialog} className="shared-projects-modal shared-task-modal" aria-labelledby="shared-entity-title" onClose={onClose}>
    <header><h2 id="shared-entity-title" data-no-translate>{(boardId?snapshot?.statuses.find(board=>board.id===boardId)?.title:snapshot?.project.title)??t('Загрузка…')}</h2><DialogCloseButton type="button" className="shared-projects-close" aria-label={t('Закрыть')} onClick={()=>dialog.current?.close()} /></header>
    {snapshot?<div className="entity-preview-columns"><section className="entity-information"><h3>{t(boardId||snapshot.project.kind==='task-list'?'Список задач':'Проект')}</h3><p data-no-translate>{boardId?"":snapshot.project.description}</p>
      <dl><dt>{t('Создатель')}</dt><dd data-no-translate>{boardId?'—':snapshot.members.find(member=>member.userId===snapshot.project.createdBy)?.displayName||'—'}</dd><dt>{t('Создано')}</dt><dd>{!boardId&&snapshot.project.createdAt?new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(snapshot.project.createdAt)):'—'}</dd><dt>{t('Обновлено')}</dt><dd>{boardId?'—':new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(snapshot.project.updatedAt))}</dd><dt>{t('Задачи')}</dt><dd>{snapshot.taskPage ? boardId ? snapshot.taskPage.statusCounts[boardId] ?? 0 : snapshot.taskPage.total : snapshot.tasks.filter(task=>!boardId||task.statusId===boardId).length}</dd></dl>
      {!boardId&&snapshot.project.tags?.length?<p data-no-translate>{snapshot.project.tags.map(tag=>`#${tag}`).join(' ')}</p>:null}
      {(snapshot.project.permissions?.manageProjects??['owner','manager'].includes(snapshot.project.role))?<button type="button" className="secondary-button" onClick={()=>{onClose();onEdit(snapshot);}}><ExperimentalIcon name="edit"/>{t('Редактировать')}</button>:null}
    </section><SharedComments comments={comments} members={snapshot.members} english={language==='en'} canComment={snapshot.project.permissions?.comment??['owner','manager','member','commenter'].includes(snapshot.project.role)} busy={busy} onSubmit={async(body,mentionIds)=>{setBusy(true);setError(false);try{const result=await sharedCollaborationRequest<{comments:SharedComment[]}>(`/projects/${encodeURIComponent(id)}/comments`,{method:'POST',body:JSON.stringify({body,mentionIds,...(boardId?{boardId}:{})})});setComments(result.comments);}catch(error){setError(true);throw error;}finally{setBusy(false);}}}/></div>:null}
    {error?<p role="alert">{t('Не удалось загрузить данные. Проверьте подключение и повторите попытку.')}</p>:null}
  </dialog>;
}
