"use client";
import {type CSSProperties,type FormEvent} from 'react';
import {CategorySection} from './CategorySection';
import {ExperimentalIcon} from './ExperimentalIcon';
import {localizeCategoryName,translateText,type Language} from './i18n';
import {formatProjectCount} from './task-count-i18n';
import type {GenesisCategory as Category} from './cloud-sync';
type Props={categories:Category[];projects:{id:string;title:string;categoryId?:string|null}[];language:Language;expanded:boolean;onExpanded:(value:boolean)=>void;view:'cards'|'list';onView:(value:'cards'|'list')=>void;
 editingId:string;editColor:string;editTitle:string;onEditColor:(value:string)=>void;onEditTitle:(value:string)=>void;onEdit:(category:Category)=>void;onCancel:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void;onDelete:(id:string)=>void;newTitle:string;onNewTitle:(value:string)=>void;onCreate:(event:FormEvent<HTMLFormElement>)=>void;onOpen:(id:string)=>void};
export function PersonalCategoryPanel(p:Props){
  const t=(source:string)=>translateText(source,p.language);
  return <CategorySection expanded={p.expanded} onExpanded={p.onExpanded} view={p.view} onView={p.onView} onCreate={()=>{p.onExpanded(true);requestAnimationFrame(()=>document.getElementById('new-category')?.focus());}}>
    <section className="category-strip" aria-label={t('Категории жизни')}>{p.categories.map(category=>{
      const projects=p.projects.filter(project=>project.categoryId===category.id);
      return <article className={p.editingId===category.id?'editing':''} key={category.id} style={{'--category-color':category.color} as CSSProperties}>
        {p.editingId===category.id?<form className="category-edit-form" onSubmit={p.onSave}><input type="color" value={p.editColor} onChange={event=>p.onEditColor(event.target.value)} aria-label={t('Цвет категории')}/><input value={p.editTitle} onChange={event=>p.onEditTitle(event.target.value)} aria-label={t('Название категории')}/><button type="submit" aria-label={t('Сохранить категорию')}><ExperimentalIcon name="check"/></button><button type="button" onClick={p.onCancel} aria-label={t('Отменить редактирование')}><ExperimentalIcon name="close"/></button></form>:<>
        <i aria-hidden="true"/><strong data-no-translate>{localizeCategoryName(category,p.language)}</strong><span data-no-translate>{formatProjectCount(projects.length,p.language)}</span><div className="category-actions"><button type="button" data-no-translate onClick={()=>p.onEdit(category)} aria-label={`${t('Редактировать категорию')} «${category.name}»`}><ExperimentalIcon name="edit"/></button><button type="button" data-no-translate onClick={()=>p.onDelete(category.id)} aria-label={`${t('Удалить категорию')} «${category.name}»`}><ExperimentalIcon name="delete"/></button></div>
        <div className="personal-category-projects">{projects.map(project=><button type="button" key={project.id} onClick={()=>p.onOpen(project.id)}><ExperimentalIcon name="projects"/><span data-no-translate>{project.title}</span></button>)}</div></>}
      </article>;
    })}<form className="quick-category-form" onSubmit={p.onCreate}><label className="sr-only" htmlFor="new-category">{t('Новая категория')}</label><input id="new-category" value={p.newTitle} onChange={event=>p.onNewTitle(event.target.value)} placeholder={t('＋ категория')}/></form></section>
  </CategorySection>;
}
