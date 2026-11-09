import { useMemo, useRef, useState, type ReactNode } from 'react';
import { NutrientFoodSources } from './vitamin-food-sources';
import { NUTRIENT_TERMS } from './nutrient-terminology';
import { MineralOverview, MineralReference } from './mineral-reference';
import { catalogCategories, catalogName, matchesCatalog, mergeCatalog, newCatalogItem, type CatalogView, type ReferenceCatalog } from './reference-catalog-domain';
import { CatalogCategoryFilter, CatalogConnection, CatalogEditButton, CatalogEditor, CatalogKindSwitch, CatalogReferenceDetails, categoryOptions } from './reference-catalog-controls';
import './reference-catalogs.css';

export function SupplementReferenceLibrary({ language, onAdd, addedIds, adding, addError, addNotice, controls, catalog }: { language: string; onAdd: (entry: CatalogView) => void; addedIds: Set<string>; adding: boolean; addError: string; addNotice: string; controls: ReactNode; catalog?:ReferenceCatalog }) {
  const en=language==='en',at=en?1:0;const [query,setQuery]=useState('');const [categories,setCategories]=useState<string[]>([]);const[mode,setMode]=useState<'any'|'all'>('any');
  const[sort,setSort]=useState('name');const[page,setPage]=useState(1);const[editing,setEditing]=useState<CatalogView|null>(null);
  const[kind,setKind]=useState<'supplement'|'medicine'>('supplement');
  const fallback=useMemo(()=>mergeCatalog([]),[]);const results=useRef<HTMLElement>(null);
  const entries=(catalog?.entries??fallback).filter(entry=>entry.kind===kind&&!entry.hidden);
  const shown=entries.filter(entry=>matchesCatalog(entry,query,categories,mode)).sort((a,b)=>sort==='recent'?b.reviewedAt.localeCompare(a.reviewedAt)||a.nameRu.localeCompare(b.nameRu,'ru'):sort==='reverse'?b.nameRu.localeCompare(a.nameRu,'ru'):a.nameRu.localeCompare(b.nameRu,'ru'));
  const pageSize=24,pages=Math.max(1,Math.ceil(shown.length/pageSize)),current=Math.min(page,pages);
  const reset=()=>setPage(1);const changePage=(value:number)=>{setPage(value);requestAnimationFrame(()=>{results.current?.scrollIntoView({block:'start'});results.current?.focus({preventScroll:true});});};
  return <div className="physis-reference-library">
    <section className="physis-panel"><header className="physis-control-heading"><h2>{en?'Substance library':'Справочник веществ'}</h2>{controls}</header>
      <p>{en?'Browse ingredients by type and areas studied. Categories describe research or traditional uses; they do not establish treatment benefits.':'Ищите вещества по составу и областям изучения. Категории отражают исследования или традиционное применение, а не обещают лечебный эффект.'}</p>
      <div className="physis-catalog-toolbar"><label className="physis-catalog-sort">{en?'Sort':'Сортировка'}<select value={sort} onChange={e=>{setSort(e.target.value);reset();}}><option value="name">{en?'Name: A–Z':'По названию: А–Я'}</option><option value="reverse">{en?'Name: Z–A':'По названию: Я–А'}</option><option value="recent">{en?'Recently checked':'По дате проверки'}</option></select></label><label>{en?'Search substances':'Поиск веществ'}<input type="search" value={query} onChange={e=>{setQuery(e.target.value);reset();}}/></label>
        {catalog?.canEdit&&<button type="button" className="physis-primary" onClick={()=>setEditing({...newCatalogItem(kind),revision:0})}>{en?'Add shared entry':'Добавить в справочник'}</button>}
      </div><CatalogConnection catalog={catalog} en={en}/>
    </section>
    {addError&&<p role="alert" className="physis-warning">{addError}</p>}
    {addNotice&&<p role="status" className="physis-catalog-notice">{addNotice}</p>}
    <div className="physis-catalog-browser">
    <CatalogCategoryFilter sidebar sectionSwitch={<CatalogKindSwitch value={kind} onChange={value=>{setKind(value);setCategories([]);setQuery('');reset();}} en={en}/>} options={categoryOptions(entries)} selected={categories} onChange={value=>{setCategories(value);reset();}} mode={mode} onMode={value=>{setMode(value);reset();}} en={en}/>
    <section className="physis-panel physis-reference-results" ref={results} tabIndex={-1} aria-label={en?'Substance results':'Результаты поиска веществ'}>
      <header className="physis-control-heading"><h3>{categories.length?categories.join(' · '):(en?'All substances':'Все вещества')}</h3><p className="physis-muted" role="status">{en?'Entries':'Карточек'}: {shown.length}</p></header>
      {!shown.length&&<p className="physis-empty">{en?'No matches. Change the search or categories.':'Ничего не найдено. Измените запрос или выбранные категории.'}</p>}
      {categories.some(value=>value.startsWith('Минерал'))&&<MineralOverview ids={shown.map(entry=>entry.legacyId)} en={en}/>}
      {shown.slice((current-1)*pageSize,current*pageSize).map(entry=><article key={entry.id} className="physis-catalog-row">
        <details className="physis-reference-entry"><summary><strong>{catalogName(entry,language)}</strong><span>{catalogCategories(entry).join(' · ')}{entry.status?' · '+entry.status:''}{entry.hidden?(en?' · Hidden':' · Скрыто'):''}{entry.restricted?(en?' · Restrictions apply':' · Требует ограничений'):''}</span></summary>
          <CatalogReferenceDetails entry={entry} en={en}/>
          {NUTRIENT_TERMS.filter(term=>term.id===entry.legacyId).map(term=><section key={term.id} className="physis-reference-foods"><h4>{en?'Food sources':'Где содержится'}</h4><p>{term.food[at]}</p><h4>{en?'Known quantities':'Что известно о количестве'}</h4><p>{term.quantity[at]}</p></section>)}
          <MineralReference id={entry.legacyId} en={en}/><NutrientFoodSources id={entry.legacyId} en={en}/>
        </details><div className="physis-catalog-row-actions">{!entry.hidden&&<button type="button" className="physis-catalog-add" disabled={adding||addedIds.has(entry.id)} aria-label={(addedIds.has(entry.id)?(en?'Already in my products: ':'Уже в моих препаратах: '):(en?'Add to my products: ':'Добавить в мои препараты: '))+catalogName(entry,language)} title={addedIds.has(entry.id)?(en?'In my products':'В моих препаратах'):(en?'Add to my products':'Добавить в мои препараты')} onClick={()=>onAdd(entry)}><span aria-hidden="true">{addedIds.has(entry.id)?'✓':'+'}</span></button>}{catalog?.canEdit&&<CatalogEditButton entry={entry} onEdit={setEditing} en={en}/>}</div>
      </article>)}
      {shown.length>0&&<nav className="physis-food-pagination" aria-label={en?'Substance pages':'Страницы веществ'}><button type="button" disabled={current===1} onClick={()=>changePage(current-1)}>{en?'Previous':'Назад'}</button><p>{en?'Page':'Страница'} {current} {en?'of':'из'} {pages}</p><button type="button" disabled={current===pages} onClick={()=>changePage(current+1)}>{en?'Next':'Далее'}</button></nav>}
    </section>
    </div>
    {editing&&catalog&&<CatalogEditor key={editing.id} initial={editing} catalog={catalog} en={en} onClose={()=>setEditing(null)}/>}
  </div>;
}
