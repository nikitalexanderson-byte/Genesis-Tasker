import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IconActionButton } from '../IconActionButton';
import { DialogCloseButton } from '../DialogCloseButton';
import { useDialogAccessibility } from '../use-dialog-accessibility';
import { catalogCategories, catalogItem, catalogText, type CatalogItem, type CatalogView, type ReferenceCatalog } from './reference-catalog-domain';
import { blankFood, NUTRIENTS, NUTRIENT_KEYS, type NutrientKey } from './nutrition-domain';
import { compositionFromFood, type FoodComposition } from './food-composition-domain';
import './reference-catalogs.css';

const desktopCategoriesQuery=()=>window.matchMedia('(min-width: 901px)');
const subscribeCategoryLayout=(listener:()=>void)=>{const media=desktopCategoriesQuery();media.addEventListener('change',listener);return()=>media.removeEventListener('change',listener);};
const desktopCategoriesSnapshot=()=>desktopCategoriesQuery().matches;
const serverCategoriesSnapshot=()=>false;

export function CatalogKindSwitch({ value, onChange, en }: { value:'supplement'|'medicine';onChange:(value:'supplement'|'medicine')=>void;en:boolean }) {
  return <nav className="shared-projects-switch physis-control-switch physis-equal-switch physis-library-sections" aria-label={en?'Substance type':'Тип вещества'}>{(['supplement','medicine'] as const).map(kind=><button key={kind} type="button" aria-pressed={value===kind} onClick={()=>onChange(kind)}>{kind==='medicine'?(en?'Pharmacology':'Фармакология'):(en?'Supplements':'БАДы')}</button>)}</nav>;
}

export function CatalogCategoryFilter({ options, selected, onChange, mode, onMode, en, label, showMode = true, sidebar = false, sectionSwitch }: {
  options: {name:string;count:number}[]; selected:string[]; onChange:(value:string[])=>void;
  mode:'any'|'all';onMode:(mode:'any'|'all')=>void;en:boolean;label?:string;showMode?:boolean;sidebar?:boolean;sectionSwitch?:ReactNode;
}) {
  const [search,setSearch]=useState('');
  const desktop=useSyncExternalStore(subscribeCategoryLayout,desktopCategoriesSnapshot,serverCategoriesSnapshot);
  const title=label??(en?'Categories':'Категории');
  const contents=<><div className={`physis-catalog-filter-content${showMode?'':' physis-catalog-filter-types'}`}>
      {sidebar&&<button type="button" className="physis-catalog-all" aria-pressed={!selected.length} onClick={()=>{onChange([]);setSearch('');}}>{en?'All categories':'Все категории'}</button>}
      <label>{en?'Find a category':'Найти категорию'}<input type="search" value={search} onChange={e=>setSearch(e.target.value)} /></label>
      {showMode&&<label>{en?'Match':'Показывать совпадения'}<select value={mode} onChange={e=>onMode(e.target.value as 'any'|'all')}><option value="any">{en?'Any selected category':'Хотя бы одна категория'}</option><option value="all">{en?'All selected categories':'Все выбранные категории'}</option></select></label>}
      <fieldset><legend>{en?'Select one or more':'Выберите одну или несколько'}</legend><div className="physis-catalog-category-options">{options.filter(option=>catalogText(option.name).includes(catalogText(search))).map(option=><label key={option.name}><input type="checkbox" checked={selected.includes(option.name)} onChange={()=>onChange(selected.includes(option.name)?selected.filter(value=>value!==option.name):[...selected,option.name])}/><span>{option.name}</span><small>{option.count}</small></label>)}</div></fieldset>
      {selected.length>0&&<button type="button" className="physis-catalog-text-action" onClick={()=>onChange([])}>{en?'Clear categories':'Сбросить категории'}</button>}
    </div>
    {selected.length>0&&<p className="physis-catalog-selection">{selected.join(' · ')}</p>}
  </>;
  const filters=<details className="physis-catalog-filters"><summary>{title} · {selected.length ? (en?'selected: ':'выбрано: ')+selected.length : (en?'all':'все')}</summary>{contents}</details>;
  return sidebar ? desktop ? <aside className="physis-panel physis-catalog-sidebar" aria-label={title}><h3>{title}</h3>{sectionSwitch}{contents}</aside> : <div className="physis-catalog-sidebar-mobile">{sectionSwitch}{filters}</div> : filters;
}
export function categoryOptions(entries: Pick<CatalogItem,'family'|'tags'>[]) {
  const counts=new Map<string,number>();for(const entry of entries)for(const category of catalogCategories(entry))counts.set(category,(counts.get(category)??0)+1);
  return [...counts].sort(([a],[b])=>a.localeCompare(b,'ru')).map(([name,count])=>({name,count}));
}
export function CatalogConnection({catalog,en}:{catalog?:ReferenceCatalog;en:boolean}){
  return catalog?.error?<div role="alert" className="physis-warning"><p>{en?'Could not refresh the shared catalog. Check your connection and retry.':catalog.error}</p><button type="button" onClick={()=>void catalog.reload()}>{en?'Retry':'Повторить'}</button></div>:catalog?.loading?<p role="status" className="physis-muted">{en?'Updating catalog…':'Обновляем справочник…'}</p>:null;
}
export function CatalogReferenceDetails({entry,en}:{entry:CatalogItem;en:boolean}){
  return <div className="physis-catalog-details">
    {entry.restricted&&<p className="physis-warning"><strong>{en?'Restrictions apply':'Требует ограничений'}</strong> · {entry.risks|| (en?'Safety is not established.':'Безопасность не установлена.')}</p>}
    <dl>{[[en?'What it is':'Что это',entry.description],[en?'Status':'Статус и регистрация',entry.status],[en?'Mechanism':'Механизм действия',entry.mechanism!==entry.description?entry.mechanism:''],[en?'Areas studied / uses':'Области изучения / применения',entry.uses],[en?'Evidence':'Данные об эффективности',entry.evidence],[en?'Scope and evidence limits':'Область применимости и ограничения',entry.scopeNote],[en?'Risks':'Риски и нежелательные эффекты',entry.risks],[en?'Contraindications':'Противопоказания и особые группы',entry.contraindications],[en?'Interactions':'Взаимодействия',entry.interactions]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      <div><dt>{en?'Sources':'Источники'}</dt><dd>{entry.sources.map((url,index)=><a key={url+index} href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}{entry.sources.filter(link=>new URL(link).hostname===new URL(url).hostname).length>1?' · '+(index+1):''}</a>)}<small>{en?'Source checked':'Проверка источника'}: {entry.reviewedAt} · {entry.verification}</small></dd></div>
      {entry.nameEn&&<div><dt>{en?'Original names':'Оригинальное / ботаническое название'}</dt><dd>{entry.nameEn}</dd></div>}
    </dl>
  </div>;
}
export function CatalogEditButton({entry,onEdit,en}:{entry:CatalogView;onEdit:(entry:CatalogView)=>void;en:boolean}){
  return <IconActionButton icon="edit" label={(en?'Edit shared entry: ':'Изменить общую карточку: ')+entry.nameRu} className="physis-catalog-icon" onClick={()=>onEdit(entry)}/>;
}
export function CatalogEditor({initial,catalog,onClose,en}:{initial:CatalogView;catalog:ReferenceCatalog;onClose:()=>void;en:boolean}){
  const [draft,setDraft]=useState(()=>catalogItem(initial));const [tags,setTags]=useState('');const[sources,setSources]=useState(initial.sources.join('\n'));const[aliases,setAliases]=useState(initial.aliases.join('\n'));
  const [busy,setBusy]=useState(false);const[error,setError]=useState('');const title=useId();const dialog=useDialogAccessibility<HTMLElement>(()=>{if(!busy)onClose();},true);
  const [composition,setComposition]=useState<FoodComposition>(()=>structuredClone(initial.composition??compositionFromFood(blankFood())));
  const [values,setValues]=useState(()=>Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,initial.composition?.trace.includes(key)?'trace':String(initial.composition?.values[key]??'')])));
  const [density,setDensity]=useState(String(initial.composition?.densityGPerMl??''));
  function readComposition(): FoodComposition {
    const parsed: FoodComposition['values']={}, trace:NutrientKey[]=[], estimated:NutrientKey[]=[];
    for(const key of NUTRIENT_KEYS){
      const text=values[key].trim();
      if(/^(trace|следы)$/i.test(text)){trace.push(key);continue;}
      if(!text)continue;
      const amount=Number(text.replace(',','.'));
      if(!Number.isFinite(amount)||amount<0||amount>1e7)throw Error((en?'Invalid value: ':'Некорректное значение: ')+(en?NUTRIENTS[key].en:NUTRIENTS[key].ru));
      parsed[key]=amount;
      if(composition.estimated.includes(key)||amount!==initial.composition?.values[key])estimated.push(key);
    }
    const densityGPerMl=density.trim()?Number(density.replace(',','.')):null;
    if(densityGPerMl!==null&&(!Number.isFinite(densityGPerMl)||densityGPerMl<=0||densityGPerMl>30))throw Error(en?'Check density':'Проверьте плотность');
    return {...composition,densityGPerMl,values:parsed,trace,estimated};
  }
  const change=(patch:Partial<CatalogItem>)=>setDraft(value=>({...value,...patch}));
  const categories=categoryOptions(catalog.entries.filter(entry=>entry.kind===draft.kind)).map(option=>option.name);
  const texts:[keyof Pick<CatalogItem,'description'|'uses'|'evidence'|'risks'|'scopeNote'>,string,string][]=[
    ['description','Описание','Description'],['uses','Области изучения / применения','Areas studied / uses'],['evidence','Данные об эффективности','Evidence'],['risks','Риски и ограничения','Risks and restrictions'],['scopeNote','Уточнение части растения / границы данных','Plant part / evidence scope']];
  return <div className="modal-backdrop physis-settings-backdrop"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title} className="physis-settings-dialog physis-catalog-editor">
    <header className="physis-settings-heading"><h2 id={title}>{en?'Shared catalog entry':'Карточка общего справочника'}</h2><DialogCloseButton disabled={busy} aria-label={en?'Close':'Закрыть'} onClick={onClose}/></header>
    <form className="physis-form physis-settings-content" onSubmit={event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');const pendingTags=tags.split(';').map(value=>value.trim()).filter(Boolean);
      void Promise.resolve().then(()=>catalog.save({...draft,...(draft.kind==='food'?{composition:readComposition()}:{}),tags:[...new Set([...draft.tags,...pendingTags])],sources:sources.split('\n').map(value=>value.trim()).filter(Boolean),aliases:aliases.split('\n').map(value=>value.trim()).filter(Boolean)},initial.revision)).then(onClose).catch(cause=>setError(cause instanceof Error?cause.message:(en?'Could not save':'Не удалось сохранить'))).finally(()=>setBusy(false));}}>
      <p className="physis-muted physis-wide">{en?'Changes apply to the shared catalog for all visitors. Saved personal entries and meal history stay unchanged.':'Изменения будут видны всем пользователям справочника. Личные карточки и история питания сохраняются.'}</p>
      <label>{en?'Russian name':'Русское название'}<input required maxLength={240} value={draft.nameRu} onChange={e=>change({nameRu:e.target.value})}/></label>
      <label>{en?'Original name':'Оригинальное название'}<input maxLength={500} value={draft.nameEn} onChange={e=>change({nameEn:e.target.value})}/></label>
      <label>{en?'Section':'Раздел'}<select value={draft.kind} onChange={e=>change({kind:e.target.value as CatalogItem['kind'],family:e.target.value==='food'?'Другое':e.target.value==='medicine'?'Фармакологические вещества':'Растения и экстракты',tags:[]})}><option value="supplement">{en?'Supplements and ingredients':'БАДы и вещества'}</option><option value="medicine">{en?'Pharmacology':'Фармакология'}</option><option value="food">{en?'Food':'Пищевые продукты'}</option></select></label>
      <label>{en?'Main category':'Основная категория'}<input required maxLength={80} list={title+'-families'} value={draft.family} onChange={e=>change({family:e.target.value})}/><datalist id={title+'-families'}>{categories.map(value=><option key={value} value={value}/>)}</datalist></label>
      {draft.kind==='food'&&<fieldset className="physis-wide"><legend>{en?'Food composition':'Пищевая ценность'}</legend>
        <div className="physis-nutrition-fields">
          <label>{en?'Exact food form (Russian)':'Форма продукта для этого состава'}<input required maxLength={500} value={composition.descriptionRu} onChange={e=>setComposition({...composition,descriptionRu:e.target.value})}/></label>
          <label>{en?'Exact food form (English)':'Форма продукта на английском'}<input maxLength={500} value={composition.descriptionEn} onChange={e=>setComposition({...composition,descriptionEn:e.target.value})}/></label>
          <label>{en?'State':'Состояние'}<select value={composition.state} onChange={e=>setComposition({...composition,state:e.target.value as FoodComposition['state']})}>{(['raw','dry','cooked','reconstituted','unknown'] as const).map((value,i)=><option key={value} value={value}>{(en?['Raw / fresh','Dry','Cooked','Reconstituted / brewed','Other / unspecified']:['Сырой / свежий','Сухой','Приготовленный','Восстановленный / заваренный','Другой / не указан'])[i]}</option>)}</select></label>
          <label>{en?'Nutrition basis':'Базис состава'}<select value={composition.basis} onChange={e=>setComposition({...composition,basis:e.target.value as FoodComposition['basis']})}><option value="100g">100 g</option><option value="100ml">100 ml</option></select></label>
          <label>{en?'Known density (g/ml)':'Известная плотность (г/мл)'}<input inputMode="decimal" value={density} onChange={e=>setDensity(e.target.value)}/></label>
          {NUTRIENT_KEYS.map(key=><label key={key}>{en?NUTRIENTS[key].en:NUTRIENTS[key].ru} ({NUTRIENTS[key].unit})<input inputMode="decimal" value={values[key]} placeholder={en?'Unknown':'Неизвестно'} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}
        </div>
        <p className="physis-muted">{en?'Values use the selected basis and food state. Blank means unknown; 0 means confirmed zero; trace means a trace amount. Changing the basis does not convert the numbers.':'Значения относятся к выбранному базису и состоянию продукта. Пусто — нет данных; 0 — подтверждённый ноль; trace — следовое количество. При смене базиса числа нужно пересчитать самостоятельно.'}</p>
        <label>{en?'Composition source':'Источник пищевой ценности'}<input required maxLength={1000} value={composition.source} onChange={e=>setComposition({...composition,source:e.target.value,provider:'manual'})}/></label>
        <label>{en?'Source version / date':'Версия / дата источника'}<input required maxLength={500} value={composition.version} onChange={e=>setComposition({...composition,version:e.target.value})}/></label>
      </fieldset>}
      <fieldset className="physis-wide"><legend>{en?'Additional categories':'Дополнительные категории'}</legend><div className="physis-catalog-editor-tags">{[...new Set([...draft.tags,...categories.filter(value=>value!==draft.family)])].map(value=><label key={value}><input type="checkbox" checked={draft.tags.includes(value)} onChange={()=>change({tags:draft.tags.includes(value)?draft.tags.filter(tag=>tag!==value):[...draft.tags,value]})}/>{value}</label>)}</div>
        <label>{en?'New categories, separated by semicolons':'Новые категории через точку с запятой'}<input value={tags} maxLength={1000} onChange={e=>setTags(e.target.value)} /></label>
      </fieldset>
      {texts.map(([key,ru,english])=><label className="physis-wide" key={key}>{en?english:ru}<textarea required={key==='description'} rows={3} maxLength={key==='uses'||key==='scopeNote'?5000:10000} value={draft[key]} onChange={e=>change({[key]:e.target.value})}/></label>)}
      {(['status','mechanism','contraindications','interactions'] as const).map((key,index)=><label className="physis-wide" key={key}>{(en?['Status and approval','Mechanism','Contraindications and special populations','Interactions']:['Статус и регистрация','Механизм действия','Противопоказания и особые группы','Взаимодействия'])[index]}<textarea rows={3} maxLength={10000} value={draft[key]??''} onChange={e=>change({[key]:e.target.value})}/></label>)}
      <label className="physis-wide">{en?'Source URLs, one per line':'Ссылки на источники, по одной в строке'}<textarea rows={3} value={sources} onChange={e=>setSources(e.target.value)}/></label>
      <label className="physis-wide">{en?'Search aliases, one per line':'Синонимы для поиска, по одному в строке'}<textarea rows={2} value={aliases} onChange={e=>setAliases(e.target.value)}/></label>
      <label>{en?'Date checked':'Дата проверки'}<input type="date" required value={draft.reviewedAt} onChange={e=>change({reviewedAt:e.target.value})}/></label>
      <label>{en?'Verification note':'Уровень проверки'}<input maxLength={240} value={draft.verification} onChange={e=>change({verification:e.target.value})}/></label>
      <label className="physis-check"><input type="checkbox" checked={draft.restricted} onChange={e=>change({restricted:e.target.checked})}/>{en?'Restrictions apply':'Требует ограничений'}</label>
      {error&&<p className="physis-warning physis-wide" role="alert">{error}</p>}
      <div className="physis-actions physis-wide"><button type="submit" className="physis-primary" disabled={busy}>{busy?(en?'Saving…':'Сохраняем…'):(en?'Save for everyone':'Сохранить для всех')}</button><button type="button" disabled={busy} onClick={onClose}>{en?'Cancel':'Отмена'}</button></div>
    </form>
  </section></div>;
}
