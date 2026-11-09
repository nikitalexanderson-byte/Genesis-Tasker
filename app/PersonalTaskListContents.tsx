"use client";
import { ExperimentalIcon } from './ExperimentalIcon';
import { translateText, type Language } from './i18n';
import { formatTaskCount } from './task-count-i18n';
import type { GenesisTask } from './cloud-sync';
import './personal-task-list-contents.css';

export type PersonalListContentActions={
 tasks:GenesisTask[];
 onCreate:()=>void;
 onOpen:(task:GenesisTask)=>void;
 onEditTask:(task:GenesisTask)=>void;
 onToggle:(task:GenesisTask)=>void;
 schedule:(task:GenesisTask)=>string;
};

export function PersonalTaskListContents({tasks,onCreate,onOpen,onEditTask,onToggle,schedule,language}:PersonalListContentActions&{language:Language}) {
 const t=(text:string)=>translateText(text,language);
 return <section className="personal-list-contents" aria-label={t('Задачи')}>
  <header><h3>{t('Задачи')} <small data-no-translate>{formatTaskCount(tasks.length,language)}</small></h3>
   <button type="button" className="primary-button" onClick={onCreate}><ExperimentalIcon name="plus"/>{t('Создать задачу')}</button>
  </header>
  {tasks.length?<ul className="personal-list-task-rows">{tasks.map(task=><li key={task.id} className={task.done?'done':undefined} data-list-task-id={task.id}>
   <button type="button" className="task-check" aria-pressed={task.done} aria-label={`${t(task.done?'Вернуть задачу':'Завершить задачу')} «${task.title}»`} onClick={()=>onToggle(task)}>{task.done?<ExperimentalIcon name="check"/>:null}</button>
   <div className="personal-list-task-body"><button type="button" className="task-preview-open" data-no-translate onClick={()=>onOpen(task)}>{task.title}</button><small data-no-translate>{schedule(task)}</small></div>
   <button type="button" className="icon-button" aria-label={`${t('Редактировать задачу')} «${task.title}»`} title={t('Редактировать задачу')} onClick={()=>onEditTask(task)}><ExperimentalIcon name="edit"/></button>
  </li>)}</ul>:<p className="muted">{t('Задач пока нет')}</p>}
 </section>;
}
