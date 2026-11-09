"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GenesisApiError, listSharedCustomFields, loadSharedCustomFieldHistory, previewSharedCustomField, saveSharedCustomField } from "./cloud-sync";
import { translateText, type Language } from "./i18n";
import { customFieldDraft, customFieldRecoveryText, customFieldsError, customFieldTypes, type CustomFieldDraft, type CustomFieldPreview, type CustomFieldType, type SharedCustomField } from "./shared-custom-fields";
import { IconActionButton } from "./IconActionButton";
import {useSharedWorkDrafts} from './use-shared-work-drafts';
import {WorkDraftError,type WorkDraft} from './shared-work-draft-journal';
import {workflowDraftError,workflowDraftText} from './workflow-draft-copy';
import {customFieldDeviceEdit,customFieldPositionValue,rebaseCustomFieldDeviceDraft,prepareCustomFieldDeviceDraft,sendCustomFieldDeviceDraft,validateCustomFieldDeviceDraft,type CustomFieldDeviceDraft} from './custom-field-device-drafts';
import "./shared-custom-fields.css";

export function SharedCustomFieldManager({userId,spaceId,projectId,language,onChanged,onDirtyChange}:{userId:string;spaceId:string;projectId:string;language:Language;onChanged:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void}){
 const t=(source:string)=>translateText(source,language);
 const d=(key:Parameters<typeof workflowDraftText>[0])=>workflowDraftText(key,language);
 const [fields,setFields]=useState<SharedCustomField[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState("");
 const [document,setDocument]=useState<CustomFieldDeviceDraft|null>(null),[preview,setPreview]=useState<CustomFieldPreview|null>(null),[confirm,setConfirm]=useState(false),[expanded,setExpanded]=useState(false);
 const [source,setSource]=useState<WorkDraft<CustomFieldDeviceDraft>|null>(null);
 const [optionsOpen,setOptionsOpen]=useState(false),[optionPage,setOptionPage]=useState(0),[reviewOptionPage,setReviewOptionPage]=useState(0);
 const [errorCode,setErrorCode]=useState("");
 const [history,setHistory]=useState<{field:SharedCustomField;createdAt:string}[]>([]);
 const [query,setQuery]=useState(""),[archive,setArchive]=useState(false),[limit,setLimit]=useState(5);
 const lock=useRef(false),live=useRef(true),current=useRef<CustomFieldDeviceDraft|null>(null);
 const draft=document?.draft??null,locked=Boolean(document&&document.phase!=='editing');
 const optionStart=Math.min(optionPage*5,Math.max(0,Math.floor(((draft?.options.length??0)-1)/5)*5));
 const reviewStart=Math.min(reviewOptionPage*5,Math.max(0,Math.floor(((preview?.field.options.length??0)-1)/5)*5));
 const number=(value:number)=>new Intl.NumberFormat(language).format(value);
 const validate=useCallback((value:unknown)=>validateCustomFieldDeviceDraft(value,spaceId,projectId),[spaceId,projectId]);
 const {rows,error:deviceError,status:deviceStatus,ready,writerId,stage,clearCurrent,refresh:refreshDevice,remove}=useSharedWorkDrafts(userId,projectId,'custom-fields',expanded,validate);
 const setRecord=(value:CustomFieldDeviceDraft|null)=>{current.current=value;setDocument(value);};
 const persist=async(value:CustomFieldDeviceDraft)=>{if(!live.current)throw Error('DRAFT_CLOSED');await stage(value);if(!live.current)throw Error('DRAFT_CLOSED');setRecord(value);};
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{onDirtyChange(Boolean(draft));return()=>onDirtyChange(false);},[draft,onDirtyChange]);
 useEffect(()=>{if(!draft)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[draft]);
 const run=async(work:()=>Promise<void>)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError("");setErrorCode("");setStatus("");
  try{await work();}catch(reason){if(live.current){setFields([]);setHistory([]);setLoaded(false);setPreview(null);setErrorCode(reason instanceof GenesisApiError?String(reason.payload?.error??reason.message):reason instanceof Error?reason.message:"");setError(current.current?.phase==='pending'?d('pending'):customFieldsError(reason,language)??workflowDraftError(reason,language));}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 };
 const refresh=async()=>{const value=await listSharedCustomFields(spaceId,projectId);if(live.current){setFields(value);setLoaded(true);}};
 const edit=(next:CustomFieldDraft,positionInput=next.position===draft?.position?document?.positionInput:undefined)=>{if(lock.current||locked)return;let value:CustomFieldDeviceDraft;try{value=customFieldDeviceEdit(spaceId,projectId,next,positionInput);}catch{setError(t('Проверьте название, тип и настройки поля.'));return;}setRecord(value);setPreview(null);setConfirm(false);setError("");setErrorCode("");setHistory([]);void stage(value).catch(()=>undefined);};
 const choose=(field:SharedCustomField|null)=>{
  if(locked||!ready)return;
  if(draft&&!window.confirm(t("Отменить несохранённые изменения поля?")))return;
  const next=field?customFieldDraft(field):{id:crypto.randomUUID(),title:"",type:"text" as const,projectId,options:[],position:fields.length,required:false,showCard:true,showList:false,archived:false,expectedRevision:0};
  void run(async()=>{await clearCurrent(source);if(!live.current)return;setSource(null);setOptionPage(0);setReviewOptionPage(0);setOptionsOpen(false);const value=customFieldDeviceEdit(spaceId,projectId,next);await persist(value);setPreview(null);setConfirm(false);setHistory([]);});
 };
 const finish=async()=>{const value=current.current;if(value?.phase!=='received')return;const cleared=await clearCurrent(source);if(!live.current)return;setRecord(null);setSource(null);setPreview(null);setStatus(cleared.changed?d('changed'):t('Поле сохранено.'));await refresh();await onChanged();};
 const send=async()=>{const value=current.current;if(value?.phase!=='pending')return;await sendCustomFieldDeviceDraft(value,{persist,send:command=>saveSharedCustomField(spaceId,command),definitiveRejection:reason=>reason instanceof GenesisApiError&&[400,403,404,409,422].includes(reason.status)&&typeof reason.payload?.error==='string'?reason.payload.error:null});if(live.current)await finish();};
 const apply=()=>run(async()=>{
  const value=current.current;if(!value||value.phase!=='editing'||!preview||preview.replaceType&&!confirm)return;
  const fresh=await previewSharedCustomField(spaceId,value.draft);if(!live.current)return;
  if(fresh.fingerprint!==preview.fingerprint)throw new GenesisApiError(409,{error:'CUSTOM_FIELD_CONFLICT'},'CUSTOM_FIELD_CONFLICT');
  await persist(prepareCustomFieldDeviceDraft(value,fresh,confirm,crypto.randomUUID()));await send();
 });
 const visible=fields.filter(field=>field.archived===archive&&(!query.trim()||field.title.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language))));
 const cancel=()=>{if(!locked&&window.confirm(t("Отменить несохранённые изменения поля?")))void run(async()=>{await clearCurrent(source);if(live.current){setRecord(null);setSource(null);setPreview(null);setHistory([]);}});};
 const restore=(row:WorkDraft<CustomFieldDeviceDraft>)=>{if(document||busy)return;void run(async()=>{const value=validate(row.value);await persist(value);if(!live.current)return;setSource(row);setPreview(null);setConfirm(false);try{await remove(row);if(live.current){setSource(null);setStatus(d('restored'));}}catch(reason){if(reason instanceof Error&&reason.message==='DRAFT_CHANGED'){if(live.current)setStatus(d('changed'));}else throw reason;}});};
 const resumeEditing=()=>void run(async()=>{const value=current.current;if(!value||value.phase!=='rejected'&&!(value.phase==='pending'&&value.attempts===0))return;await persist(customFieldDeviceEdit(spaceId,projectId,value.draft));setPreview(null);setConfirm(false);});
 const rebase=()=>void run(async()=>{
  const value=current.current;if(!value||value.phase==='pending'&&value.attempts>0||value.phase==='received')return;
  const fields=await listSharedCustomFields(spaceId,projectId);if(!live.current)return;
  const latest=fields.find(field=>field.id===value.draft.id);if(!latest)throw new GenesisApiError(404,{error:'CUSTOM_FIELD_UNAVAILABLE'},'CUSTOM_FIELD_UNAVAILABLE');
  await persist(rebaseCustomFieldDeviceDraft(value,latest));if(!live.current)return;setFields(fields);setLoaded(true);setPreview(null);setConfirm(false);setHistory([]);
 });
 const damaged=deviceError instanceof WorkDraftError?deviceError.record:undefined;
 const download=()=>{if(!damaged)return;const url=URL.createObjectURL(new Blob([damaged.raw],{type:'application/json'})),link=window.document.createElement('a');link.href=url;link.download=`genesis-field-draft-${damaged.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <details className="shared-custom-field-manager" open={expanded} onToggle={event=>{if(event.target!==event.currentTarget)return;setExpanded(event.currentTarget.open);if(event.currentTarget.open&&!loaded)void run(refresh);}}><summary>{t("Пользовательские поля")}</summary>
  <section className="shared-custom-field-device" aria-label={d('heading')}>
   {deviceStatus==='saving'||deviceStatus==='saved'?<p role="status" data-field-device-state={deviceStatus}>{d(deviceStatus)}</p>:null}
   {deviceError?<div role="alert"><p>{workflowDraftError(deviceError,language)}</p><IconActionButton icon="map-refresh" label={t('Обновить')} disabled={busy} onClick={()=>void refreshDevice()}/>{damaged?<IconActionButton icon="export" label={d('download')} onClick={download}/>:null}</div>:null}
   {rows.filter(row=>row.id!==writerId&&row.id!==source?.id).length?<details open><summary>{d('heading')}</summary><ul>{rows.filter(row=>row.id!==writerId&&row.id!==source?.id).map(row=><li key={row.id} data-field-device-draft={row.id}><div><strong data-no-translate>{row.value.draft.title||t('Добавить поле')}</strong><time dateTime={row.at}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.at))}</time></div><div className="shared-custom-field-actions"><IconActionButton icon="edit" label={d('restore')} disabled={busy||Boolean(document)} onClick={()=>restore(row)}/><IconActionButton icon="delete" label={d('discard')} disabled={busy||row.value.phase==='pending'&&row.value.attempts>0} onClick={()=>{if(window.confirm(d('discard')))void run(async()=>{await remove(row);});}}/></div></li>)}</ul></details>:null}
   {document?.phase==='pending'?<div role="status"><p>{d('pending')}</p><div className="shared-custom-field-actions"><button type="button" className="primary-button" disabled={busy||!ready} onClick={()=>void run(send)}>{t('Повторить')}</button>{document.attempts===0?<button type="button" className="secondary-button" disabled={busy} onClick={resumeEditing}>{d('edit')}</button>:null}</div></div>:null}
   {document?.phase==='rejected'?<div role="alert"><p>{customFieldsError(new Error(document.error??''),language)??t('Не удалось загрузить или сохранить поля. Черновик сохранён; повторите попытку.')}</p>{document.error==='CUSTOM_FIELD_CONFLICT'?<IconActionButton icon="map-refresh" label={customFieldRecoveryText('Обновить версию',language)} disabled={busy||!ready} onClick={rebase}/>:<button type="button" className="secondary-button" disabled={busy} onClick={resumeEditing}>{d('edit')}</button>}</div>:null}
   {document?.phase==='received'?<div role="status"><p>{t('Поле сохранено.')}</p><button type="button" className="primary-button" disabled={busy} onClick={()=>void run(finish)}>{t('Продолжить')}</button></div>:null}
  </section>
  <div className="shared-custom-field-workspace" data-editing={Boolean(draft)}>
   <section className="shared-custom-field-library" aria-label={t("Поля")}>
    <div className="shared-custom-field-block-heading"><h4>{t("Поля")}</h4><div className="shared-custom-field-actions">
     <IconActionButton icon="plus" label={t("Добавить поле")} disabled={busy||locked||!ready} onClick={()=>choose(null)}/>
     <IconActionButton icon="map-refresh" label={t("Обновить")} disabled={busy} onClick={()=>void run(refresh)}/>
    </div></div>
    <label>{t("Поиск")}<input type="search" value={query} maxLength={160} onChange={event=>{setQuery(event.target.value);setLimit(5);}}/></label>
    <div className="shared-custom-field-actions shared-custom-field-filters">
     <button type="button" className="secondary-button" aria-pressed={!archive} onClick={()=>{setArchive(false);setLimit(5);}}>{t("Действующие")}</button>
     <button type="button" className="secondary-button" aria-pressed={archive} onClick={()=>{setArchive(true);setLimit(5);}}>{t("Архив")}</button>
    </div>
    <ul>{visible.slice(0,limit).map(field=><li key={field.id} className="shared-custom-field-library-row" aria-current={draft?.id===field.id?true:undefined}>
     <div><strong data-no-translate>{field.title}</strong><p>{t(customFieldTypes[field.type])} · {t(field.projectId?"Этот проект":"Всё пространство")}</p></div>
     <IconActionButton icon="edit" label={`${t("Настроить")}: ${field.title}`} disabled={busy||locked||!ready} onClick={()=>choose(field)}/>
    </li>)}</ul>
    {loaded&&!visible.length?<p>{t(query?"Ничего не найдено":archive?"В архиве пока нет полей.":"Добавьте первое поле для задач проекта.")}</p>:null}
    {visible.length>limit?<IconActionButton icon="map-down" label={t("Показать ещё")} disabled={busy} onClick={()=>setLimit(value=>value+5)}/>:null}
    <p className="shared-custom-field-help">{t("Поля доступны читателям задачи. Видимость в карточке и списке меняет отображение, а не права доступа.")}</p>
   </section>
   <div className="shared-custom-field-detail">
   {draft?<form className="shared-custom-field-form" onSubmit={event=>{event.preventDefault();if(locked)return;if(customFieldPositionValue(document?.positionInput??String(draft.position))!==draft.position){setError(t('Проверьте название, тип и настройки поля.'));return;}void run(async()=>{const record=customFieldDeviceEdit(spaceId,projectId,draft,document?.positionInput);await persist(record);const value=await previewSharedCustomField(spaceId,draft);if(live.current){setPreview(value);setReviewOptionPage(0);}});}}>
    <div className="shared-custom-field-actions shared-custom-field-editor-tools">
     <IconActionButton icon="map-back" label={t("Отмена")} disabled={busy||locked} onClick={cancel}/>
     <IconActionButton icon="map-refresh" label={t("Обновить")} disabled={busy} onClick={()=>void run(refresh)}/>
     {draft.expectedRevision?<IconActionButton icon="history" label={t("История поля")} disabled={busy} onClick={()=>void run(async()=>{const value=await loadSharedCustomFieldHistory(draft.id);if(live.current)setHistory(value.versions);})}/>:null}
    </div>
    <fieldset disabled={busy||locked||!ready}><legend>{t("Настройки поля")}</legend><div className="shared-custom-field-basic-grid">
     <label className="shared-custom-field-name">{t("Название")}<input value={draft.title} maxLength={160} required onChange={event=>edit({...draft,title:event.target.value})}/></label>
     <label>{t("Тип поля")}<select value={draft.type} onChange={event=>{edit({...draft,type:event.target.value as CustomFieldType,options:[]});setOptionPage(0);setOptionsOpen(true);}}>{Object.entries(customFieldTypes).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
     <label>{t("Область поля")}<select value={draft.projectId??""} onChange={event=>edit({...draft,projectId:event.target.value||null})}><option value={projectId}>{t("Этот проект")}</option><option value="">{t("Всё пространство")}</option></select></label>
     <label>{t("Порядок")}<input type="text" inputMode="numeric" pattern="-?[0-9]+" maxLength={100} value={document?.positionInput??String(draft.position)} required
       aria-invalid={customFieldPositionValue(document?.positionInput??String(draft.position))===null}
       ref={element=>{element?.setCustomValidity(customFieldPositionValue(document?.positionInput??String(draft.position))===null?t('Проверьте название, тип и настройки поля.'):'');}}
       onChange={event=>{const raw=event.target.value;edit({...draft,position:customFieldPositionValue(raw)??draft.position},raw);}}/></label>
    </div></fieldset>
    <fieldset disabled={busy||locked||!ready}><legend>{t("Отображение и заполнение")}</legend>
     {([['required','Обязательное поле'],['showCard','Показывать в карточке'],['showList','Показывать в списке'],['archived','Архивировать поле']] as const).map(([key,label])=><label className="shared-custom-field-check" key={key}><input type="checkbox" checked={draft[key]} onChange={event=>edit({...draft,[key]:event.target.checked})}/>{t(label)}</label>)}
     <p className="shared-custom-field-help">{t("Архив сохраняет значения. Снимите отметку, чтобы восстановить поле. Новые обязательные поля проверяются при создании, заполнении полей или завершении задачи.")}</p>
    </fieldset>
    {['select','multi'].includes(draft.type)?<fieldset disabled={busy||locked||!ready} aria-label={t("Варианты списка")}>
     <details className="shared-custom-field-options-disclosure" open={optionsOpen} onToggle={event=>{if(event.target===event.currentTarget)setOptionsOpen(event.currentTarget.open);}}>
      <summary>{t("Варианты списка")} · {number(draft.options.length)}</summary>
      <div className="shared-custom-field-options">
       {draft.options.slice(optionStart,optionStart+5).map((option,index)=><div className="shared-custom-field-option" key={option.id}>
        <label>{t("Вариант списка")}<input value={option.title} maxLength={160} required onChange={event=>edit({...draft,options:draft.options.map((row,i)=>i===optionStart+index?{...row,title:event.target.value}:row)})}/></label>
        <label className="shared-custom-field-check"><input type="checkbox" checked={option.archived} onChange={event=>edit({...draft,options:draft.options.map((row,i)=>i===optionStart+index?{...row,archived:event.target.checked}:row)})}/>{t("Архив")}</label>
       </div>)}
       <div className="shared-custom-field-actions shared-custom-field-option-navigation">
        {draft.options.length>5?<><IconActionButton icon="map-up" label={t("Назад")} disabled={optionStart===0} onClick={()=>setOptionPage(Math.max(0,Math.floor(optionStart/5)-1))}/>
         <span>{number(optionStart+1)}–{number(Math.min(optionStart+5,draft.options.length))} / {number(draft.options.length)}</span>
         <IconActionButton icon="map-down" label={t("Далее")} disabled={optionStart+5>=draft.options.length} onClick={()=>setOptionPage(Math.floor(optionStart/5)+1)}/></>:null}
        <IconActionButton icon="plus" label={t("Добавить вариант")} disabled={draft.options.length>=200} onClick={()=>{setOptionPage(Math.floor(draft.options.length/5));edit({...draft,options:[...draft.options,{id:crypto.randomUUID(),title:"",archived:false}]});}}/>
       </div>
       <p className="shared-custom-field-help">{t("Архивный вариант сохраняется в старых задачах и недоступен для новых назначений.")}</p>
      </div>
     </details>
    </fieldset>:null}
    {preview?<section className="shared-custom-field-preview"><h4>{t("Предпросмотр изменений")}</h4>
     <strong data-no-translate>{preview.field.title}</strong>
     <dl><div><dt>{t("Тип поля")}</dt><dd>{t(customFieldTypes[preview.field.type])}</dd></div><div><dt>{t("Область поля")}</dt><dd>{t(preview.field.projectId?"Этот проект":"Всё пространство")}</dd></div>
      <div><dt>{t("Порядок")}</dt><dd>{new Intl.NumberFormat(language).format(preview.field.position)}</dd></div>
      {([['required','Обязательное поле'],['showCard','Показывать в карточке'],['showList','Показывать в списке'],['archived','Архив']] as const).map(([key,label])=><div key={key}><dt>{t(label)}</dt><dd>{t(preview.field[key]?"Да":"Нет")}</dd></div>)}
     </dl><p>{t("Задач со значением: {count}").replace('{count}',new Intl.NumberFormat(language).format(preview.valueCount))}</p>
     {preview.field.options.length?<details className="shared-custom-field-options-disclosure shared-custom-field-reviewed-options"><summary>{t("Варианты списка")} · {number(preview.field.options.length)}</summary>
      <ul>{preview.field.options.slice(reviewStart,reviewStart+5).map(option=><li key={option.id}><span data-no-translate>{option.title}</span>{option.archived?<small>{t("Архив")}</small>:null}</li>)}</ul>
      {preview.field.options.length>5?<div className="shared-custom-field-actions"><IconActionButton icon="map-up" label={t("Назад")} disabled={reviewStart===0} onClick={()=>setReviewOptionPage(Math.max(0,Math.floor(reviewStart/5)-1))}/>
       <span>{number(reviewStart+1)}–{number(Math.min(reviewStart+5,preview.field.options.length))} / {number(preview.field.options.length)}</span>
       <IconActionButton icon="map-down" label={t("Далее")} disabled={reviewStart+5>=preview.field.options.length} onClick={()=>setReviewOptionPage(Math.floor(reviewStart/5)+1)}/></div>:null}
     </details>:null}
     {preview.replaceType?<label className="shared-custom-field-check"><input type="checkbox" checked={confirm} disabled={busy} onChange={event=>setConfirm(event.target.checked)}/>{t("Создать поле нового типа. Прежнее поле и все его значения останутся в архиве.")}</label>:null}
    </section>:null}
    <div className="shared-custom-field-actions shared-custom-field-save-actions">
     <IconActionButton icon="eye" type="submit" label={t("Предпросмотр изменений")} disabled={busy||locked||!ready}/>
     {preview?<button type="button" className="primary-button" disabled={busy||locked||!ready||preview.replaceType&&!confirm} onClick={()=>void apply()}>{t("Применить")}</button>:null}
    </div>
   </form>:<p className="shared-custom-field-empty-detail">{t("Выберите поле или добавьте новое.")}</p>}
   {history.length?<section className="shared-custom-field-history"><h4>{t("История поля")}</h4><ol>{history.map(row=><li key={row.field.revision}>
    <div><strong data-no-translate>{row.field.title}</strong><time dateTime={row.createdAt}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.createdAt))}</time>
     <p>{t(customFieldTypes[row.field.type])} · {row.field.archived?t("Архив"):t("Действующее поле")}</p></div>
    <IconActionButton icon="undo" label={t("Использовать эти настройки")} disabled={busy||locked} onClick={()=>{const current=fields.find(field=>field.id===row.field.id);if(current)edit({...customFieldDraft(row.field),expectedRevision:current.revision});}}/>
   </li>)}</ol></section>:null}
   </div>
  </div>
  {busy?<p role="status">{t("Загрузка…")}</p>:null}{error&&document?.phase!=='pending'&&!(document?.phase==='rejected'&&errorCode===document.error)?<div className="shared-custom-field-actions" role="alert"><p>{error}</p>{errorCode==='CUSTOM_FIELD_CONFLICT'&&document?.phase==='editing'?<IconActionButton icon="map-refresh" label={customFieldRecoveryText('Обновить версию',language)} disabled={busy||!ready} onClick={rebase}/>:null}</div>:null}{status?<p role="status">{status}</p>:null}
 </details>;
}
