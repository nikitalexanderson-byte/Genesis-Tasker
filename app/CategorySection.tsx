"use client";
import { useId,type ReactNode } from 'react';
import { ExperimentalIcon } from './ExperimentalIcon';
import { translateText } from './i18n';
export function CategorySection({expanded,onExpanded,view,onView,onCreate,children}:{expanded:boolean;onExpanded:(value:boolean)=>void;view:'cards'|'list';onView:(value:'cards'|'list')=>void;onCreate?:()=>void;children:ReactNode}){
  const heading=useId();
  return <details className="shared-project-categories unified-categories" data-category-view={view} open={expanded} aria-labelledby={heading}>
    <summary className="shared-categories-header" onClick={event=>{if(event.defaultPrevented)return;event.preventDefault();onExpanded(!expanded);}}><ExperimentalIcon name="chevron"/><h3 id={heading}><ExperimentalIcon name="tag"/>{translateText('Категории')}</h3>
      <div className="category-section-actions"><span className="category-view-switch"><button type="button" className="category-view-toggle" aria-label={translateText(view==='list'?'Карточки':'Список')} title={translateText(view==='list'?'Карточки':'Список')} onClick={event=>{event.preventDefault();onView(view==='list'?'cards':'list');}}><ExperimentalIcon name={view==='list'?'list':'projects'}/></button></span>
      {onCreate?<button type="button" className="secondary-button shared-category-create" aria-label={translateText('Новая категория')} title={translateText('Новая категория')} onClick={event=>{event.preventDefault();onCreate();}}><ExperimentalIcon name="plus"/><span className="category-action-label">{translateText('Новая категория')}</span></button>:null}</div>
    </summary>{children}
  </details>;
}
