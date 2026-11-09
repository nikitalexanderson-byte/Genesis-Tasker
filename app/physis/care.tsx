import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDatePicker } from '../CalendarDatePicker';
import { IconActionButton } from '../IconActionButton';
import { DialogCloseButton } from '../DialogCloseButton';
import { useDialogAccessibility } from '../use-dialog-accessibility';
import { ExperimentalIcon } from '../ExperimentalIcon';
import { TimeClockPicker } from '../TimeClockPicker';
import { addCivilDays, momentCivilDate, resolveCalendarWallTime, todayCivilDate } from '../calendar-context';
import { formatCalendarDateValue } from '../calendar-data';
import { DOSE_UNITS, DRUG_FORMS, ROUTES, activeAmount, intakeRecordId, regimenEvents, pendingIntakeEvents, postponeIntakeReminder, confirmIntakeState, reviseRegimen, cancelIntake, type Drug, type Intake, type IntakeEvent, type IntakeReminder, type Regimen, type RegimenPeriod } from './care-domain';
import { NUTRIENTS, NUTRIENT_KEYS } from './nutrition-domain';
import { editPhysisRecord, newPhysisRecord, physisRecords, type PhysisFeatureProps, type PhysisRecord } from './types';
import { Field, NumberField, usePhysisAction } from './fields';
import { PhysisExchange } from './exchange';
import { PhysisMomentFields } from './care-time-fields';
import { SupplementReferenceLibrary } from './supplement-reference';
import { catalogCategories, catalogText, mergeCatalog, personalDrugCategories, preparePersonalDrug, referenceForDrug, type CatalogView } from './reference-catalog-domain';
import { CatalogCategoryFilter, CatalogKindSwitch } from './reference-catalog-controls';

const routeNames: Record<Drug['route'], string> = { oral: 'Внутрь', intramuscular: 'Внутримышечно', subcutaneous: 'Подкожно', intravenous: 'Внутривенно', topical: 'Наружно', inhalation: 'Ингаляционно', other: 'Другое' };
export const emptyDrug = (): Drug => ({ name: '', brand: '', category: 'supplement', form: 'Капсула', route: 'oral', activeIngredients: '', amountPerUnit: null, activeUnit: 'mg', concentration: null, concentrationUnit: 'mg/ml', packageSize: '', source: '', notes: '', favorite: false, archived: false, nutrients: [] });
function RouteSelect({ value, onChange }: { value: Drug['route']; onChange: (value: Drug['route']) => void }) {
  return <Field label="Путь введения"><select value={value} onChange={event => onChange(event.target.value as Drug['route'])}>{ROUTES.map(route => <option key={route} value={route}>{routeNames[route]}</option>)}</select></Field>;
}
function PersonalDrugDialog({ children, title, onClose, busy, en }: { children:ReactNode;title:string;onClose:()=>void;busy:boolean;en:boolean }) {
  const heading=useId();
  const dialog=useDialogAccessibility<HTMLElement>(()=>{if(!busy)onClose();});
  return createPortal(<div className="modal-backdrop physis-settings-backdrop"><section ref={dialog} className="physis-settings-dialog physis-drug-editor-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1}><header className="physis-settings-heading"><h2 id={heading}>{title}</h2><DialogCloseButton disabled={busy} aria-label={en?'Close':'Закрыть'} onClick={onClose}/></header><div className="physis-settings-content">{children}</div></section></div>,document.querySelector('.physis')??document.body);
}
export function PhysisDrugCatalog(props: PhysisFeatureProps) {
  const { store } = props;
  const en=props.language==='en';
  const [catalogMode, setCatalogMode] = useState<'reference' | 'personal'>('personal');
  const [catalogBranch, setCatalogBranch] = useState('');
  const [categories,setCategories]=useState<string[]>([]);
  const [mode,setMode]=useState<'any'|'all'>('any');
  const [sort,setSort]=useState('name');
  const [page,setPage]=useState(1);
  const [kind, setKind] = useState<Drug['category']>('supplement');
  const [search, setSearch] = useState(''); const [favorites, setFavorites] = useState(false); const [archives, setArchives] = useState(false);
  const [editing, setEditing] = useState<PhysisRecord<Drug> | null>(null); const [draft, setDraft] = useState<Drug | null>(null);
  const [draftRecord, setDraftRecord] = useState<PhysisRecord<Drug> | null>(null);
  const action = usePhysisAction();
  const [addNotice,setAddNotice]=useState('');
  const pendingAdds=useRef(new Map<string,PhysisRecord<Drug>>());
  const results=useRef<HTMLElement>(null);
  const fallback=useMemo(()=>mergeCatalog([]),[]);
  const entries=props.referenceCatalog?.entries??fallback;
  const allRecords = physisRecords<Drug>(store, 'drug');
  const uncategorized=en?'Uncategorized':'Без категории';
  const recordCategories=new Map(allRecords.map(record=>{const values=personalDrugCategories(record.data,entries);return [record.id,values.length?values:[uncategorized]];}));
  const words=catalogText(search.trim()).split(/\s+/).filter(Boolean);
  const matching = allRecords.filter(r => {
    const reference=referenceForDrug(r.data,entries);
    const text=catalogText([r.data.name,r.data.brand,r.data.activeIngredients,reference?.nameRu,reference?.nameEn,...(reference?.aliases??[])].join(' '));
    return r.data.category === kind && r.data.archived === archives && (!favorites || r.data.favorite) && words.every(word=>text.includes(word));
  });
  const records = matching.filter(record=>!categories.length||(mode==='all'?categories.every(value=>recordCategories.get(record.id)!.includes(value)):categories.some(value=>recordCategories.get(record.id)!.includes(value))))
    .sort((a,b)=>sort==='recent'?b.updatedAt.localeCompare(a.updatedAt):sort==='reverse'?b.data.name.localeCompare(a.data.name,props.language):a.data.name.localeCompare(b.data.name,props.language));
  const sharedCategories=entries.filter(entry=>!entry.hidden&&entry.kind===kind).flatMap(catalogCategories);
  const options=[...new Set([...sharedCategories,...allRecords.filter(record=>record.data.category===kind).flatMap(record=>recordCategories.get(record.id)!)])].sort((a,b)=>a.localeCompare(b,'ru'))
    .map(name=>({name,count:matching.filter(record=>recordCategories.get(record.id)!.includes(name)).length}));
  const addedIds=new Set(allRecords.filter(record=>!record.data.archived).map(record=>referenceForDrug(record.data,entries)?.id).filter((id):id is string=>!!id));
  const pages=Math.max(1,Math.ceil(records.length/24)),current=Math.min(page,pages);
  const changePage=(value:number)=>{setPage(value);requestAnimationFrame(()=>{results.current?.scrollIntoView({block:'start'});results.current?.focus({preventScroll:true});});};
  const addFromCatalog=(entry:CatalogView)=>void action.run(async()=>{
    setAddNotice('');
    const prepared=preparePersonalDrug(entry,props.language,allRecords,entries,pendingAdds.current.get(entry.id));
    if(prepared.action!=='existing'){
      pendingAdds.current.set(entry.id,prepared.record);
      await store.save(prepared.record);
      pendingAdds.current.delete(entry.id);
    }
    setAddNotice((prepared.action==='restore'?(en?'Restored from archive: ':'Возвращено из архива: '):prepared.action==='existing'?(en?'Already in my products: ':'Уже в моих препаратах: '):(en?'Added to my products: ':'Добавлено в мои препараты: '))+prepared.record.data.name);
  });
  const change = (patch: Partial<Drug>) => setDraft(value => value ? { ...value, ...patch } : value);
  const modeSwitch = <div className="shared-projects-switch physis-control-switch physis-equal-switch physis-catalog-switch" role="group" aria-label={en?'Catalog view':'Режим справочника'}><button type="button" aria-pressed={catalogMode === 'personal'} onClick={() => setCatalogMode('personal')}>{en?'My products':'Мои препараты'}</button><button type="button" aria-pressed={catalogMode === 'reference'} onClick={() => setCatalogMode('reference')}>{en?'Substance library':'Справочник веществ'}</button></div>;
  const sectionSwitch=<CatalogKindSwitch value={kind} onChange={value=>{setKind(value);setCategories([]);setPage(1);}} en={en}/>;
  return <div className="physis-reference-library">{catalogMode === 'reference' ? <SupplementReferenceLibrary controls={modeSwitch} language={props.language} catalog={props.referenceCatalog} onAdd={addFromCatalog} addedIds={addedIds} adding={action.busy} addError={action.error} addNotice={addNotice}/> : (
    <div className="physis-drug-catalog"><section className="physis-panel"><header className="physis-control-heading physis-catalog-heading"><h2>{en?'My products':'Мои препараты'}</h2><div className="physis-catalog-header-controls">{modeSwitch}</div></header>
    <p className="physis-muted">{en?'Your products, favorites and archive. Compatibility is not checked automatically.':'Ваши препараты, избранное и архив. Совместимость автоматически не проверяется.'}</p>
    <div className="physis-catalog-toolbar"><label className="physis-catalog-sort">{en?'Sort':'Сортировка'}<select value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="name">{en?'Name: A–Z':'По названию: А–Я'}</option><option value="reverse">{en?'Name: Z–A':'По названию: Я–А'}</option><option value="recent">{en?'Recently changed':'По дате изменения'}</option></select></label><label>{en?'Search name, brand or ingredient':'Поиск по названию, бренду или веществу'}<input type="search" value={search} onChange={e => {setSearch(e.target.value);setPage(1);}} /></label><div className="physis-actions physis-catalog-personal-actions"><button type="button" className="physis-primary" onClick={() => { const record = newPhysisRecord('drug', {...emptyDrug(),category:kind}); setEditing(null); setDraftRecord(record); setDraft(record.data); setCatalogBranch(''); }}>{en?'Add product':'Добавить препарат'}</button><IconActionButton icon="star" label={en?'Favorites':'Избранное'} className="physis-catalog-icon physis-catalog-toggle" aria-pressed={favorites} onClick={() => {setFavorites(!favorites);setPage(1);}}/><IconActionButton icon="archive" label={en?'Archive':'Архив'} className="physis-catalog-icon physis-catalog-toggle" aria-pressed={archives} onClick={() => {setArchives(!archives);setPage(1);}}/></div></div>
    </section>
    {action.error && !draft ? <p role="alert" className="physis-warning">{action.error}</p> : null}
    {draft ? <PersonalDrugDialog title={editing ? (en?'Edit product':'Изменить карточку') : (en?'New product':'Новая карточка')} busy={action.busy} en={en} onClose={()=>setDraft(null)}><form className="physis-drug-editor-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { await store.save(editPhysisRecord(editing ?? draftRecord!, { ...draft, catalogPath: draft.catalogPath?.length ? [draft.catalogPath[0], ...catalogBranch.split('/').map(name => name.trim()).filter(Boolean)] : [] })); setDraft(null); }); }}>
      <fieldset className="physis-drug-editor-group" disabled={action.busy}><legend>{en?'Basic information':'Основные сведения'}</legend><div className="physis-drug-editor-fields">
      <Field label="Название"><input data-dialog-initial-focus required maxLength={200} value={draft.name} onChange={e => change({ name: e.target.value })} /></Field>
      <Field label="Бренд"><input maxLength={200} value={draft.brand} onChange={e => change({ brand: e.target.value })} /></Field>
      <Field label="Категория"><select value={draft.category} onChange={e => change({ category: e.target.value as Drug['category'] })}><option value="supplement">БАД</option><option value="medicine">Лекарство</option></select></Field>
      <Field label="Форма"><select value={draft.form} onChange={e => change({ form: e.target.value })}>{[...new Set([draft.form,...DRUG_FORMS])].map(form => <option key={form}>{form}</option>)}</select></Field>
      <RouteSelect value={draft.route} onChange={route => change({ route })} />
      <Field label="Упаковка"><input value={draft.packageSize} onChange={e => change({ packageSize: e.target.value })} /></Field>
      </div></fieldset>
      <fieldset className="physis-drug-editor-group" disabled={action.busy}><legend>{en?'Catalog categories':'Категории справочника'}</legend><div className="physis-drug-editor-fields">
      <Field label="Основная категория"><select value={draft.catalogPath?.[0] ?? ''} onChange={e => { change({ catalogPath: e.target.value ? [e.target.value] : [] }); setCatalogBranch(''); }}><option value="">Без категории</option>{[...new Set([...entries.filter(entry=>entry.kind===draft.category&&!entry.hidden).flatMap(catalogCategories),...allRecords.flatMap(record => record.data.catalogPath??[]),...(draft.catalogPath??[])])].sort((a,b)=>a.localeCompare(b,'ru')).map(name => <option key={name}>{name}</option>)}</select></Field>
      <Field label="Дополнительные категории через / (до четырёх)"><input maxLength={320} value={catalogBranch} disabled={!draft.catalogPath?.length} onChange={e => setCatalogBranch(e.target.value)} placeholder="Например: группа / подгруппа" /></Field>
      </div></fieldset>
      <fieldset className="physis-drug-editor-group" disabled={action.busy}><legend>{en?'Composition and concentration':'Состав и концентрация'}</legend><div className="physis-drug-editor-fields">
      <div className="physis-drug-editor-wide"><Field label="Действующие вещества"><input maxLength={2000} value={draft.activeIngredients} onChange={e => change({ activeIngredients: e.target.value })} /></Field></div>
      <NumberField label="Активное вещество в одной единице формы" value={draft.amountPerUnit} onChange={amountPerUnit => change({ amountPerUnit })} />
      <Field label="Единица активного вещества"><select value={draft.activeUnit} onChange={e => change({ activeUnit: e.target.value as Drug['activeUnit'] })}>{['mg', 'mcg', 'g', 'IU'].map(unit => <option key={unit}>{unit}</option>)}</select></Field>
      <NumberField label="Концентрация раствора (если известна)" value={draft.concentration} onChange={concentration => change({ concentration })} />
      <Field label="Единица концентрации"><select value={draft.concentrationUnit} onChange={e => change({ concentrationUnit: e.target.value as Drug['concentrationUnit'] })}>{['mg/ml', 'mcg/ml', 'g/ml', 'IU/ml'].map(unit => <option key={unit}>{unit}</option>)}</select></Field>
      </div><p className="physis-muted">Без известной концентрации миллилитры не переводятся в массу. МЕ (IU) не переводятся в мг или мкг.</p></fieldset>
      <fieldset className="physis-drug-editor-group" disabled={action.busy}><legend>{en?'Source and notes':'Источник и заметки'}</legend><div className="physis-drug-editor-fields physis-drug-editor-single">
      <Field label="Источник / инструкция"><input value={draft.source} onChange={e => change({ source: e.target.value })} /></Field>
      <Field label="Личные заметки"><textarea rows={3} value={draft.notes} maxLength={10000} onChange={e => change({ notes: e.target.value })} /></Field>
      </div></fieldset>
      <fieldset className="physis-drug-editor-group" disabled={action.busy}><legend>{en?'Elemental nutrients per unit':'Элементарные нутриенты на одну единицу формы'}</legend><p className="physis-muted">Укажите именно элементарное вещество, не массу соли. Пищевой итог учитывает только фактически принятые внутрь единицы формы; инъекции исключены.</p>
        {draft.nutrients.map((n, index) => <div className="physis-drug-editor-nutrient" key={index}><Field label="Нутриент"><select required value={n.nutrient} onChange={e => change({ nutrients: draft.nutrients.map((v, i) => i === index ? { ...v, nutrient: e.target.value } : v) })}><option value="">Выберите нутриент</option>{NUTRIENT_KEYS.filter(key => key !== 'energy').map(key => <option key={key} value={key} disabled={draft.nutrients.some((item, position) => position !== index && item.nutrient === key)}>{NUTRIENTS[key].ru}</option>)}</select></Field><NumberField label="Количество" value={n.value} onChange={value => change({ nutrients: draft.nutrients.map((v, i) => i === index ? { ...v, value: value ?? 0 } : v) })} /><Field label="Единица"><select value={n.unit} onChange={e => change({ nutrients: draft.nutrients.map((v, i) => i === index ? { ...v, unit: e.target.value as 'mg' } : v) })}>{['mg', 'mcg', 'g'].map(u => <option key={u}>{u}</option>)}</select></Field><IconActionButton className="physis-catalog-icon" icon="delete" label={en?'Remove nutrient':'Удалить нутриент'} onClick={() => change({ nutrients: draft.nutrients.filter((_, i) => i !== index) })}/></div>)}
        <button type="button" onClick={() => change({ nutrients: [...draft.nutrients, { nutrient: '', value: 0, unit: 'mg', elemental: true }] })}>Добавить нутриент</button></fieldset>
      {action.error&&<p role="alert" className="physis-warning">{action.error}</p>}
      <div className="physis-actions physis-drug-editor-actions"><button type="submit" className="physis-primary" disabled={action.busy}>{action.busy?(en?'Saving…':'Сохраняем…'):(en?'Save':'Сохранить')}</button><button type="button" disabled={action.busy} onClick={() => setDraft(null)}>{en?'Cancel':'Отмена'}</button></div>
    </form></PersonalDrugDialog> : null}
    <div className="physis-catalog-browser"><CatalogCategoryFilter sidebar sectionSwitch={sectionSwitch} options={options} selected={categories} onChange={value=>{setCategories(value);setPage(1);}} mode={mode} onMode={value=>{setMode(value);setPage(1);}} en={en}/>
    <section className="physis-panel physis-reference-results" ref={results} tabIndex={-1} aria-label={en?'My product results':'Результаты поиска моих препаратов'}>
      <header className="physis-control-heading"><h3>{categories.length?categories.join(' · '):archives?(en?'Archive':'Архив'):(en?'All products':'Все препараты')}</h3><p className="physis-muted" role="status">{en?'Entries':'Карточек'}: {records.length}</p></header>
      {!records.length&&<div className="physis-empty"><p>{en?'No matching products. Add a product from the library or create your own card.':'Подходящих препаратов пока нет. Добавьте препарат из справочника или создайте свою карточку.'}</p><button type="button" onClick={()=>setCatalogMode('reference')}>{en?'Open substance library':'Открыть справочник веществ'}</button></div>}
      {records.slice((current-1)*24,current*24).map(record=><article key={record.id} className="physis-catalog-row">
        <details className="physis-reference-entry"><summary><strong>{record.data.name}</strong><span>{recordCategories.get(record.id)!.join(' · ')}{record.data.favorite?(en?' · Favorite':' · Избранное'):''}</span></summary>
          <p className="physis-muted">{[record.data.brand,record.data.category==='medicine'?(en?'Medicine':'Лекарство'):(en?'Supplement':'БАД'),record.data.form,routeNames[record.data.route]].filter(Boolean).join(' · ')}</p>
          <p>{record.data.activeIngredients}</p>
          {record.data.notes&&<p className="physis-personal-notes">{record.data.notes}</p>}
          <div className="physis-actions"><button disabled={action.busy} aria-pressed={record.data.favorite} onClick={()=>void action.run(()=>store.save(editPhysisRecord(record,{...record.data,favorite:!record.data.favorite})))}>{record.data.favorite?(en?'Favorited':'В избранном'):(en?'Add to favorites':'В избранное')}</button><button disabled={action.busy} onClick={()=>void action.run(()=>store.save(editPhysisRecord(record,{...record.data,archived:!record.data.archived})))}>{record.data.archived?(en?'Restore':'Вернуть из архива'):(en?'Archive':'Архивировать')}</button><button disabled={action.busy} className="physis-danger" onClick={()=>{if(confirm(en?'Delete this card? Intake history will be kept.':'Удалить карточку? История приемов сохранится.'))void action.run(()=>store.remove(record.id));}}>{en?'Delete':'Удалить'}</button></div>
        </details><div className="physis-catalog-row-actions"><IconActionButton className="physis-catalog-icon" icon="edit" label={(en?'Edit my product: ':'Изменить мой препарат: ')+record.data.name} onClick={()=>{setEditing(record);setDraft(structuredClone(record.data));setCatalogBranch((record.data.catalogPath??[]).slice(1).join(' / '));}}/></div>
      </article>)}
      {records.length>0&&<nav className="physis-food-pagination" aria-label={en?'My product pages':'Страницы моих препаратов'}><button type="button" disabled={current===1} onClick={()=>changePage(current-1)}>{en?'Previous':'Назад'}</button><p>{en?'Page':'Страница'} {current} {en?'of':'из'} {pages}</p><button type="button" disabled={current===pages} onClick={()=>changePage(current+1)}>{en?'Next':'Далее'}</button></nav>}
      <PhysisExchange store={store} kind="drug" />
    </section></div></div>
  )}</div>;
}
const initialPeriod = (day: string, timeZone: string): RegimenPeriod => ({ id: crypto.randomUUID(), start: day, end: '', timeZone, mode: 'daily', times: ['09:00'], weekdays: [1, 2, 3, 4, 5], everyDays: 1, everyHours: 24, anchorAt: resolveCalendarWallTime(day, '09:00', timeZone).instant.toISOString(), dose: 1, unit: 'шт', route: 'oral', food: '', notes: '' });
export function PhysisIntakes(props: PhysisFeatureProps & { owner: string; compact?: boolean; onOpenCatalog?: () => void }) {
  const { store, settings, context, owner, compact = false } = props;
  const today = todayCivilDate(context); const [day, setDay] = useState(today);
  const [editing, setEditing] = useState<PhysisRecord<Regimen> | null>(null); const [draft, setDraft] = useState<Regimen | null>(null);
  const [draftRecord, setDraftRecord] = useState<PhysisRecord<Regimen> | null>(null);
  const [effective, setEffective] = useState(today); const [entry, setEntry] = useState<PhysisRecord<Intake> | null>(null); const [formOpen, setFormOpen] = useState(false);
  const action = usePhysisAction(); const drugs = physisRecords<Drug>(store, 'drug').filter(r => !r.data.archived);
  const regimens = physisRecords<Regimen>(store, 'regimen'); const intakes = physisRecords<Intake>(store, 'intake');
  const [now,setNow] = useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  const postpone = (event: IntakeReminder) => action.run(async()=>{const old=intakes.find(r=>r.data.eventId===event.eventId);const data=postponeIntakeReminder(event,old?.data);const record=old ? editPhysisRecord(old,data) : newPhysisRecord('intake',data);if(!old)record.id=await intakeRecordId(owner,event.eventId);await store.save(record);});
  const pending = useMemo(() => pendingIntakeEvents(regimens, intakes, day, day === today), [regimens, intakes, day, today]);
  const updatePeriod = (index: number, patch: Partial<RegimenPeriod>) => setDraft(value => value ? { ...value, periods: value.periods.map((p, i) => i === index ? { ...p, ...patch } : p) } : value);
  const openRegimen = (record?: PhysisRecord<Regimen>) => {
    if (!drugs.length && !record) { action.setError('Сначала добавьте препарат в справочник.'); return; }
    setEditing(record ?? null); setEffective(today);
    const data = record ? structuredClone(record.data) : { name: drugs[0].data.name, drugId: drugs[0].id, drugSnapshot: structuredClone(drugs[0].data), version: 1,
      periods: [{ ...initialPeriod(today, settings.timeZone), route: drugs[0].data.route }], archived: false, previousVersions: [] };
    setDraftRecord(record ?? newPhysisRecord('regimen', data)); setDraft(data);
  };
  const fromEvent = async (event: IntakeReminder) => {
    const old = intakes.find(r => r.data.eventId === event.eventId);
    if (old) {
      const resumed = structuredClone(old);
      if (old.data.status === 'cancelled' || old.data.status === 'postponed') {
        const now = new Date().toISOString();
        resumed.data = { ...resumed.data, status: 'taken', postponedUntil: null, takenAt: now, day: momentCivilDate(new Date(now), event.timeZone), quantity: event.dose };
      }
      setEntry(resumed); setFormOpen(true); return;
    }
    const now = new Date().toISOString();
    const record = newPhysisRecord<Intake>('intake', { eventId: event.eventId, regimenId: event.regimenId, regimenVersion: event.regimenVersion,
      plannedAt: event.plannedAt, takenAt: now, timeZone: event.timeZone, day: momentCivilDate(new Date(now), event.timeZone), quantity: event.dose, unit: event.unit, route: event.route,
      status: 'taken', postponedUntil: null, drugSnapshot: structuredClone(event.drugSnapshot), source: 'manual', note: '', editedAt: null });
    record.id = await intakeRecordId(owner, event.eventId); setEntry(record); setFormOpen(true);
  };
  const manual = (drug: PhysisRecord<Drug>) => {
    const now = new Date().toISOString(); const record = newPhysisRecord<Intake>('intake', { eventId: crypto.randomUUID(), regimenId: null, regimenVersion: null, plannedAt: null,
      takenAt: now, timeZone: settings.timeZone, day: today, quantity: 1, unit: 'шт', route: drug.data.route, status: 'taken', postponedUntil: null,
      drugSnapshot: structuredClone(drug.data), source: 'manual', note: '', editedAt: null }); setEntry(record); setFormOpen(true);
  };
  const changeEntry = (patch: Partial<Intake>) => setEntry(r => r ? editPhysisRecord(r, { ...r.data, ...patch }) : r);
  let preview: IntakeEvent[] = []; let previewError = '';
  try { if (draft) preview = regimenEvents({ id: editing?.id ?? 'preview', kind: 'regimen', schemaVersion: 1, createdAt: '', updatedAt: '', source: 'manual', data: draft }, effective, addCivilDays(effective, 6)).slice(0, 30); }
  catch { previewError = 'Заполните корректные даты, часовой пояс и время периода для предпросмотра.'; }
  return <div className="physis-care-control">
    <header className="physis-panel physis-care-toolbar"><div className="physis-care-heading"><div><h2>{compact ? 'Ближайшие приёмы' : 'Контроль приёма'}</h2><p className="physis-muted">Ваше расписание, отметки и курсы в одном месте.</p></div><button className="physis-primary" disabled={!drugs.length} onClick={() => openRegimen()}>Добавить схему</button></div>
    {!compact ? <nav className="physis-care-date-nav" aria-label="День приёма"><IconActionButton icon={<ExperimentalIcon name="chevron" className="physis-care-previous" />} label="Предыдущий день приема" onClick={() => setDay(addCivilDays(day, -1))} /><CalendarDatePicker value={day} mode={settings.inputCalendarMode} calculationContext={context} onChange={value => { if (value) setDay(value); }} ariaLabel="День приема" /><IconActionButton icon="chevron" label="Следующий день приема" onClick={() => setDay(addCivilDays(day, 1))} /><button onClick={() => setDay(today)}>Сегодня</button></nav> : null}
    <p className="physis-care-date">{formatCalendarDateValue(day, settings.calendarMode, true, context)}</p>
    {drugs.length ? <details className="physis-care-manual"><summary>Записать приём вне расписания</summary><Field label="Препарат для фактической записи"><select value="" onChange={e => { const drug = drugs.find(d => d.id === e.target.value); if (drug) manual(drug); }}><option value="">Выберите препарат</option>{drugs.map(d => <option key={d.id} value={d.id}>{d.data.name}</option>)}</select></Field></details> : <div className="physis-care-onboarding"><h3>Начните с препарата</h3><p>Добавьте карточку в справочник, затем задайте время и количество в своей схеме.</p>{props.onOpenCatalog && <button onClick={props.onOpenCatalog}>Открыть справочник</button>}</div>}
    </header>
    {action.error ? <p role="alert" className="physis-warning">{action.error}</p> : null}
    {draft ? <form className="physis-panel physis-form physis-care-editor" onSubmit={e => { e.preventDefault(); void action.run(async () => { const data = editing ? reviseRegimen(editing.data, draft, effective) : draft; await store.save(editPhysisRecord(editing ?? draftRecord!, data)); setDraft(null); }); }}>
      <h3 className="physis-wide">{editing ? 'Новая версия схемы' : 'Новая схема'}</h3><Field label="Препарат"><select value={draft.drugId} onChange={e => { const d = drugs.find(d => d.id === e.target.value); if (d) setDraft({ ...draft, drugId: d.id, drugSnapshot: structuredClone(d.data), name: d.data.name }); }}>{drugs.map(d => <option value={d.id} key={d.id}>{d.data.name}</option>)}</select></Field>
      <Field label="Название схемы"><input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
      {editing ? <Field label="Применить изменения начиная с"><CalendarDatePicker value={effective} min={today} mode={settings.inputCalendarMode} calculationContext={context} onChange={setEffective} /></Field> : null}
      {draft.periods.map((p, index) => <fieldset className="physis-wide" key={p.id}><legend>Период {index + 1}</legend><div className="physis-form">
        <Field label="Начало"><CalendarDatePicker value={p.start} mode={settings.inputCalendarMode} calculationContext={context} required onChange={start => updatePeriod(index, { start })} /></Field><Field label="Окончание (необязательно)"><CalendarDatePicker value={p.end} mode={settings.inputCalendarMode} calculationContext={context} min={p.start} onChange={end => updatePeriod(index, { end })} /></Field>
        <Field label="Режим"><select value={p.mode} onChange={e => updatePeriod(index, { mode: e.target.value as RegimenPeriod['mode'] })}><option value="daily">Ежедневно в местное время</option><option value="weekdays">Выбранные дни недели</option><option value="every-days">Раз в N дней</option><option value="hours">Интервал в часах</option><option value="prn">По необходимости</option></select></Field>
        <Field label="Часовой пояс IANA"><input value={p.timeZone} onChange={e => updatePeriod(index, { timeZone: e.target.value })} /></Field>
        {p.mode !== 'hours' && p.mode !== 'prn' ? <div className="physis-wide"><h4>Время приёма</h4><div className="physis-actions">{p.times.map((time, timeIndex) => <div className="physis-row" key={timeIndex}><Field label="Время приёма"><TimeClockPicker value={time} ariaLabel={props.language === 'en' ? `Intake time ${timeIndex + 1}` : `Время приёма ${timeIndex + 1}`} onChange={value => updatePeriod(index, { times: p.times.map((item, position) => position === timeIndex ? value : item) })} /></Field><button type="button" disabled={p.times.length <= 1} aria-label={props.language === 'en' ? `Remove intake time ${timeIndex + 1}` : `Удалить время приёма ${timeIndex + 1}`} onClick={() => updatePeriod(index, { times: p.times.filter((_, position) => position !== timeIndex) })}>Удалить время</button></div>)}</div><button type="button" disabled={p.times.length >= 24} onClick={() => { const available = Array.from({ length: 24 }, (_, hour) => `${String((hour + 9) % 24).padStart(2, '0')}:00`).find(time => !p.times.includes(time)); if (available) updatePeriod(index, { times: [...p.times, available] }); }}>Добавить время</button></div> : null}
        {p.mode === 'weekdays' ? <div className="physis-wide physis-actions">{['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'].map((title, weekday) => <button type="button" key={weekday} aria-pressed={p.weekdays.includes(weekday)} onClick={() => updatePeriod(index, { weekdays: p.weekdays.includes(weekday) ? p.weekdays.filter(d => d !== weekday) : [...p.weekdays, weekday] })}>{title}</button>)}</div> : null}
        {p.mode === 'every-days' ? <NumberField label="Каждые N дней" min={1} max={366} value={p.everyDays} onChange={v => updatePeriod(index, { everyDays: v ?? 1 })} /> : null}
        {p.mode === 'hours' ? <><NumberField label="Каждые N часов (абсолютный интервал)" min={0.25} max={8760} value={p.everyHours} onChange={v => updatePeriod(index, { everyHours: v ?? 24 })} /><PhysisMomentFields value={p.anchorAt} fallbackDay={p.start} timeZone={p.timeZone} context={context} calendarMode={settings.inputCalendarMode} dayLabel="Дата первого приёма" timeLabel="Время первого приёма" onChange={anchorAt => updatePeriod(index, { anchorAt })} /></> : null}
        <NumberField label="Разовое количество по вашему назначению" required min={0.000001} value={p.dose} onChange={v => updatePeriod(index, { dose: v ?? 0 })} /><Field label="Единица количества"><select value={p.unit} onChange={e => updatePeriod(index, { unit: e.target.value as RegimenPeriod['unit'] })}>{DOSE_UNITS.map(unit => <option key={unit}>{unit}</option>)}</select></Field><RouteSelect value={p.route} onChange={route => updatePeriod(index, { route })} />
        <Field label="Связь с едой"><input value={p.food} onChange={e => updatePeriod(index, { food: e.target.value })} /></Field><Field label="Заметка / перерыв"><input value={p.notes} onChange={e => updatePeriod(index, { notes: e.target.value })} /></Field>
        <button type="button" onClick={() => setDraft({ ...draft, periods: draft.periods.filter((_, i) => i !== index) })}>Удалить период</button></div></fieldset>)}
      <button type="button" onClick={() => setDraft({ ...draft, periods: [...draft.periods, initialPeriod(effective, settings.timeZone)] })}>Добавить период / после перерыва</button>
      <div className="physis-wide"><h3>Предпросмотр ближайших 7 дней</h3>{preview.length ? <ul>{preview.map(e => <li key={e.eventId}>{new Date(e.plannedAt).toLocaleString('ru', { timeZone: e.timeZone })} · {e.dose} {e.unit} · {routeNames[e.route]}</li>)}</ul> : <p>Автоматических событий нет. Для «по необходимости» записи добавляются вручную.</p>}</div>
      {previewError ? <p className="physis-warning">{previewError}</p> : null}
      <div className="physis-actions"><button className="physis-primary" disabled={action.busy || !draft.periods.length || !!previewError}>Сохранить схему</button><button type="button" onClick={() => setDraft(null)}>Отмена</button></div>
    </form> : null}
    {formOpen && entry ? <form className="physis-panel physis-form physis-care-editor" onSubmit={e => { e.preventDefault(); void action.run(async () => { const existing = intakes.some(i => i.id === entry.id); await store.save(editPhysisRecord(entry, confirmIntakeState({ ...entry.data, editedAt: existing ? new Date().toISOString() : null }))); setFormOpen(false); }); }}>
      <h3 className="physis-wide">{entry.data.drugSnapshot.name} — фактическая запись</h3><Field label="Статус"><select value={entry.data.status} onChange={e => { const status=e.target.value as Intake['status']; const time=new Date().toISOString(); changeEntry({ status, ...(status !== 'postponed' ? {postponedUntil:null} : {}), ...(['taken','partial'].includes(status) && !['taken','partial'].includes(entry.data.status) ? {takenAt:time,day:momentCivilDate(new Date(time),entry.data.timeZone)} : {}) }); }}><option value="taken">Принято</option><option value="partial">Частично</option><option value="skipped">Пропущено</option><option value="postponed">Отложено</option><option value="cancelled">Отметка отменена</option></select></Field>
      <NumberField label="Фактическое количество" value={entry.data.quantity} onChange={quantity => changeEntry({ quantity: quantity ?? 0 })} /><Field label="Единица"><select value={entry.data.unit} onChange={e => changeEntry({ unit: e.target.value as Intake['unit'] })}>{DOSE_UNITS.map(unit => <option key={unit}>{unit}</option>)}</select></Field>
      <RouteSelect value={entry.data.route} onChange={route => changeEntry({ route })} /><PhysisMomentFields value={entry.data.takenAt} fallbackDay={entry.data.day} timeZone={entry.data.timeZone} context={context} calendarMode={settings.inputCalendarMode} dayLabel="Дата приёма" timeLabel="Время приёма" onChange={(takenAt, day) => changeEntry({ takenAt, day })} />
      {entry.data.status === 'postponed' ? <PhysisMomentFields value={entry.data.postponedUntil} fallbackDay={entry.data.day} timeZone={entry.data.timeZone} context={context} calendarMode={settings.inputCalendarMode} dayLabel="Отложить на дату" timeLabel="Отложить до времени" onChange={postponedUntil => changeEntry({ postponedUntil })} /> : null}
      <Field label="Заметка"><textarea value={entry.data.note} onChange={e => changeEntry({ note: e.target.value })} /></Field><p className="physis-muted">{(() => { const amount = activeAmount(entry.data.drugSnapshot, entry.data.quantity, entry.data.unit); return amount ? `Расчетное количество активного вещества: ${amount.value} ${amount.unit}.` : 'Пересчет активного вещества недоступен без совместимых единиц и концентрации.'; })()}</p>
      <div className="physis-actions"><button className="physis-primary" disabled={action.busy}>Сохранить прием</button><button type="button" onClick={() => setFormOpen(false)}>Отмена</button></div>
    </form> : null}
    <div className="physis-care-ledger"><section className="physis-panel physis-care-planned"><div className="physis-care-section-title"><h3>По расписанию</h3><span>{pending.length}</span></div>
    {!pending.length ? <p className="physis-empty">На этот день нет незавершённых приёмов. Новые появятся после добавления схемы.</p> : <ul className="physis-list">{pending.slice(0,compact?5:100).map(event=><li key={event.eventId}><div className="physis-row"><strong>{event.drugSnapshot.name}</strong><span className="physis-status">{Date.parse(event.dueAt)<=now ? 'Не отмечено' : 'Запланировано'}</span></div><p>{event.dose} {event.unit} · {routeNames[event.route]}{event.plannedAt && <> · По плану: {new Date(event.plannedAt).toLocaleString('ru',{timeZone:event.timeZone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</>}</p>{event.postponed && <p className="physis-muted">Напоминание: {new Date(event.dueAt).toLocaleString('ru',{timeZone:event.timeZone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}. Назначение не изменено.</p>}<div className="physis-actions"><button className="physis-primary" disabled={action.busy} onClick={()=>void action.run(()=>fromEvent(event))}>Отметить прием</button><button type="button" disabled={action.busy} onClick={()=>void postpone(event)}>Напомнить через 30 минут</button></div></li>)}</ul>}
    </section>{!compact ? <section className="physis-panel physis-care-actual"><div className="physis-care-section-title"><h3>Факты и исправления</h3><span>{intakes.filter(i => i.data.day === day).length}</span></div>{!intakes.some(i => i.data.day === day) && <p className="physis-empty">Отметок пока нет. Запишите приём по расписанию или выберите препарат для записи вне расписания.</p>}<ul className="physis-list">{intakes.filter(i => i.data.day === day).map(record => <li key={record.id}><strong>{record.data.drugSnapshot.name}</strong><p>{({ taken: 'Принято', partial: 'Частично', skipped: 'Пропущено', postponed: 'Отложено', cancelled: 'Отметка отменена' })[record.data.status]} · {record.data.quantity} {record.data.unit}{['taken','partial'].includes(record.data.status) && <> · Фактически: {new Date(record.data.takenAt).toLocaleTimeString('ru', { timeZone: record.data.timeZone })}</>}{record.data.plannedAt && <> · По плану: {new Date(record.data.plannedAt).toLocaleTimeString('ru',{timeZone:record.data.timeZone})}</>}{record.data.editedAt ? ' · Исправлено' : ''}</p><div className="physis-actions"><button onClick={() => { setEntry(structuredClone(record)); setFormOpen(true); }}>Исправить</button><button onClick={() => { if (confirm('Отменить ошибочную отметку?')) void action.run(() => store.save(editPhysisRecord(record, cancelIntake(record.data)))); }}>Отменить отметку</button></div></li>)}</ul>
      </section> : null}</div>{!compact ? <section className="physis-panel physis-care-regimens"><div className="physis-care-section-title"><h3>Схемы и курсы</h3><span>{regimens.length}</span></div>{!regimens.length && <p className="physis-empty">Схем пока нет. Создайте схему из препарата в справочнике: укажите период, расписание и назначенное количество.</p>}<ul className="physis-list">{regimens.map(record => <li key={record.id}><strong>{record.data.name}</strong><p>Версия {record.data.version} · {record.data.archived ? 'Приостановлено' : 'Действует'} · фактов: {intakes.filter(i => i.data.regimenId === record.id && ['taken', 'partial'].includes(i.data.status)).length}</p><div className="physis-actions"><button onClick={() => openRegimen(record)}>Изменить будущие приемы</button><button onClick={() => void action.run(() => store.save(editPhysisRecord(record, { ...record.data, archived: !record.data.archived })))}>{record.data.archived ? 'Продолжить' : 'Приостановить'}</button></div></li>)}</ul></section> : null}
    <details className="physis-care-help"><summary>О журнале и напоминаниях</summary><p className="physis-muted">План не становится фактом автоматически. Проверка совместимости не выполнена. Напоминания доступны внутри открытого Фюзиса. Доставка при закрытом браузере не подключена. После пропуска доза автоматически не меняется.</p></details>
  </div>;
}
