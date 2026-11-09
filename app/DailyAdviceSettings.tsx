"use client";

import { useState, useRef, useEffect } from "react";
import { AdvicePrivacyNotice } from './AdvicePrivacyNotice';
export { AdvicePrivacyNotice } from './AdvicePrivacyNotice';
import { DialogCloseButton } from "./DialogCloseButton";
import { updateAccountPreferences,loadAdviceNotificationStatus,registerAdviceNotificationDevice,deleteAdviceNotificationDevice,type AdviceNotificationStatus, type GenesisUser } from "./cloud-sync";
import { ADVICE_CATEGORIES, ADVICE_COLLECTIONS, adviceAvailableCategories, advicePreferences, type AdvicePreferences, type AdviceCollection } from "./daily-advice";
import labels from "./daily-advice-copy.json";
import collectionLabels from "./advice-collections-copy.json";
import "./daily-advice.css";
import { translateText } from './i18n';
import { featureAllowed } from './feature-access';
import {FeatureAccessUI} from './FeatureAccessUI';
import {adviceDeviceTimeZone,advicePushDeviceKey} from './advice-notifications';
import notificationLabels from './advice-notification-copy.json';
import './daily-advice-settings.css';
import {TimeClockPicker} from './TimeClockPicker';
import {waitForSharedPush} from './shared-push-device';
import {ExperimentalIcon} from './ExperimentalIcon';
import {AdvicePsychopompiaSettings} from './AdvicePsychopompiaSettings';
import {useDialogAccessibility} from './use-dialog-accessibility';

export function DailyAdviceSettings({ user, onUserChange }: { user: GenesisUser; onUserChange: (user: GenesisUser) => void }) {
  const copy = labels[user.language];
  const notificationCopy=notificationLabels[user.language];
  const collectionsCopy = collectionLabels[user.language];
  const preferences = advicePreferences(user.advicePreferences);
  const advanced=featureAllowed(user.featureAccess,'advice-settings');
  const available = adviceAvailableCategories(user.adviceAvailableCategories);
  const selected = available.filter(id => preferences.categories.includes(id));
  const effective = selected.length ? selected : available.slice(0, 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collectionTab, setCollectionTab] = useState<AdviceCollection>(preferences.collections[0]);
  const [ageCategories, setAgeCategories] = useState<AdvicePreferences["categories"] | null>(null);
  const [pushStatus,setPushStatus]=useState<AdviceNotificationStatus|null>(null);
  const [pushFailed,setPushFailed]=useState(false),[pushRevision,setPushRevision]=useState(0),[deviceId,setDeviceId]=useState('');
  const operation=useRef<AbortController|null>(null);
  const supported=typeof window!=='undefined'&&window.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
  useEffect(()=>{
    const controller=new AbortController();
    if(supported)void loadAdviceNotificationStatus(controller.signal).then(status=>{
      if(controller.signal.aborted)return;setPushStatus(status);setPushFailed(false);
      let id='';try{id=localStorage.getItem(advicePushDeviceKey(user.uid))??'';}catch{/* Only an opaque device receipt is cached. */}
      setDeviceId(status.devices.some(device=>device.id===id)?id:'');
    }).catch(()=>{if(!controller.signal.aborted)setPushFailed(true);});
    return()=>{controller.abort();operation.current?.abort();};
  },[user.uid,supported,pushRevision]);
  const save = async (patch:Partial<AdvicePreferences>,signal?:AbortSignal) => {
      const { user: saved } = await updateAccountPreferences({ advicePreferences: patch },signal);
      if(signal?.aborted)return;
      const expected = { ...preferences, ...patch };
      const actual = advicePreferences(saved.advicePreferences);
      if (!saved.advicePreferences || actual.enabled !== expected.enabled || actual.smart !== expected.smart
        || actual.categories.join() !== expected.categories.join()
        || actual.collections.join() !== expected.collections.join()
        || actual.philosophersPerDay !== expected.philosophersPerDay
        || actual.aphrodisiaAdult !== expected.aphrodisiaAdult
        || actual.notifications.enabled!==expected.notifications.enabled||actual.notifications.time!==expected.notifications.time
        || actual.notifications.timeZone!==expected.notifications.timeZone) throw new Error("ADVICE_PREFERENCES_NOT_SAVED");
      if(JSON.stringify(actual.psychopompia)!==JSON.stringify(expected.psychopompia))throw new Error('ADVICE_PSYCHOPOMPIA_NOT_SAVED');
      onUserChange(saved);
  };
  const change = async (patch: Partial<AdvicePreferences>) => {
    setBusy(true); setError("");
    try {
      await save(patch);
    } catch { setError(copy.saveError); }
    finally { setBusy(false); }
  };
  const connectNotifications=async()=>{
    if(busy||!supported||!pushStatus?.capabilities.available)return;
    const controller=new AbortController();operation.current=controller;const signal=controller.signal;
    setBusy(true);setError('');
    try {
      if(await waitForSharedPush(Notification.requestPermission(),signal)!=='granted')throw new Error('ADVICE_PERMISSION_REQUIRED');
      const key=pushStatus.capabilities.publicKey;if(!key)throw new Error('PUSH_KEYS_UNCONFIGURED');
      const registration=await waitForSharedPush(navigator.serviceWorker.getRegistration(),signal);if(!registration)throw new Error('SERVICE_WORKER_REQUIRED');
      const bytes=Uint8Array.from(atob(key.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-key.length%4)%4)),character=>character.charCodeAt(0));
      const existing=await waitForSharedPush(registration.pushManager.getSubscription(),signal);
      const subscription=existing??await waitForSharedPush(registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes}),signal,late=>{void late.unsubscribe().catch(()=>undefined);});
      if(signal.aborted)return;
      const linked=await registerAdviceNotificationDevice(subscription.toJSON(),signal);
      if(signal.aborted)return;
      try{localStorage.setItem(advicePushDeviceKey(user.uid),linked.id);}catch{/* Connection remains available through server status. */}
      setDeviceId(linked.id);setPushStatus(status=>status?{...status,devices:[...status.devices.filter(device=>device.id!==linked.id),linked]}:status);
      await save({notifications:{...preferences.notifications,enabled:true,timeZone:adviceDeviceTimeZone()}},signal);
    } catch(error) {if(!signal.aborted)setError(error instanceof Error&&error.message==='ADVICE_PERMISSION_REQUIRED'?notificationCopy.permission:notificationCopy.error);}
    finally {if(!signal.aborted)setBusy(false);}
  };
  const disconnectNotifications=async()=>{
    if(busy||!deviceId)return;const controller=new AbortController();operation.current=controller;
    setBusy(true);setError('');
    try{await deleteAdviceNotificationDevice(deviceId,controller.signal);if(controller.signal.aborted)return;
      try{localStorage.removeItem(advicePushDeviceKey(user.uid));}catch{/* No content is cached in the receipt. */}
      setDeviceId('');setPushStatus(status=>status?{...status,devices:status.devices.filter(device=>device.id!==deviceId)}:status);
    }catch{if(!controller.signal.aborted)setError(notificationCopy.error);}finally{if(!controller.signal.aborted)setBusy(false);}
  };
  return <section className="account-preferences daily-advice-settings" data-settings-group="appearance" aria-labelledby="advice-settings-title" data-no-translate>
    <div><h3 id="advice-settings-title">{copy.title}</h3><p>{copy.tradition}</p></div>
    <div className="daily-advice-source-tabs" role="tablist" tabIndex={-1} aria-label={collectionsCopy.title} onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?'aurora':event.key==='End'?'philosophers':collectionTab==='aurora'?'philosophers':'aurora';
      setCollectionTab(next);document.getElementById(`advice-source-tab-${next}`)?.focus();
    }}>
      {ADVICE_COLLECTIONS.map(collection=><button type="button" role="tab" id={`advice-source-tab-${collection}`} key={collection}
        aria-selected={collectionTab===collection} aria-controls="advice-source-settings" tabIndex={collectionTab===collection?0:-1}
        onClick={()=>setCollectionTab(collection)}>{collectionsCopy[collection]}</button>)}
    </div>
    <div id="advice-source-settings" role="tabpanel" aria-labelledby={`advice-source-tab-${collectionTab}`}>
      <fieldset className="daily-advice-collections" aria-describedby="advice-collections-hint">
        <legend>{collectionsCopy.title}</legend>
        {ADVICE_COLLECTIONS.filter(collection=>collection===collectionTab).map(collection => <label className="account-switch-row" key={collection} htmlFor={`advice-collection-${collection}`}>
          <span><strong>{collectionsCopy[collection]}</strong>{collection === "philosophers" ? <small>{user.adviceCollectionsReady?.includes(collection)?collectionsCopy.ready:collectionsCopy.pending}</small> : null}</span>
          <input id={`advice-collection-${collection}`} type="checkbox" role="switch" aria-label={collectionsCopy[collection]}
            checked={preferences.collections.includes(collection)} disabled={busy || (preferences.collections.length === 1 && preferences.collections[0] === collection)}
            onChange={event => void change({ collections: ADVICE_COLLECTIONS.filter(id => id === collection ? event.target.checked : preferences.collections.includes(id)) })}/>
          <i aria-hidden="true"/>
        </label>)}
        <p className="daily-advice-note" id="advice-collections-hint">{collectionsCopy.hint}</p>
        {collectionTab === "philosophers" ? <label className="daily-advice-count">
          <span>{collectionsCopy.dailyCount}</span>
          <select value={preferences.philosophersPerDay} disabled={busy || !preferences.enabled || !preferences.collections.includes("philosophers")}
            onChange={event => void change({ philosophersPerDay: Number(event.target.value) })}>
            {[1, 2, 3].map(count => <option key={count} value={count}>{count}</option>)}
          </select>
        </label> : null}
      </fieldset>
      {collectionTab === "aurora" ? <>
      {!advanced?<><p className="daily-advice-note">{user.language==='en'?'One advice per day. Category and mode settings are available with Standard and above.':translateText('Один совет в день. Настройки категорий и режима доступны в Standart и выше.',user.language).replaceAll('Standart','Standard')}</p><FeatureAccessUI language={user.language} feature="advice-settings"/></>:null}
      <fieldset className="daily-advice-advanced" disabled={!advanced || !preferences.collections.includes("aurora")}>
      <label className="account-switch-row" htmlFor="advice-smart">
        <span><strong>{copy.smart}</strong><small>{copy.smartHint}</small></span>
        <input id="advice-smart" aria-label={copy.smart} type="checkbox" role="switch" checked={preferences.smart} disabled={busy || available.length === 0} onChange={event => void change({ smart: event.target.checked, categories: effective })} />
        <i aria-hidden="true" />
      </label>
      {preferences.smart ? <p className="daily-advice-note">{copy.fallback}</p> : <fieldset className="daily-advice-categories" aria-describedby="advice-category-hint">
        <legend>{copy.choose}</legend>
        {ADVICE_CATEGORIES.map((category, index) => <label className="daily-advice-category" data-unavailable={!available.includes(category)} key={category} htmlFor={`advice-category-${category}`}>
          <input id={`advice-category-${category}`} aria-label={copy.categories[index]} aria-describedby={`advice-category-hint-${category}`} type="checkbox" checked={effective.includes(category)}
            disabled={busy || !available.includes(category) || (effective.length === 1 && effective[0] === category)}
            onChange={event => {
              const categories = available.filter(id => id === category ? event.target.checked : effective.includes(id));
              if (category === "aphrodisia" && event.target.checked) setAgeCategories(categories);
              else void change({ categories });
            }} />
          <span><strong>{copy.categories[index]}</strong><small id={`advice-category-hint-${category}`}>{copy.categoryHints[index]}{!available.includes(category) ? ` · ${copy.comingSoon}` : ""}</small></span>
        </label>)}
        <p id="advice-category-hint" className="daily-advice-note">{copy.oneCategory}</p>
      </fieldset>}
      {preferences.smart && available.includes("aphrodisia") ? <label className="daily-advice-category">
        <input type="checkbox" checked={effective.includes("aphrodisia")} disabled={busy} aria-label={copy.categories[4]} onChange={event => {
          if(event.target.checked) setAgeCategories(available.filter(id => id === "aphrodisia" || effective.includes(id)));
          else void change({categories: effective.filter(id => id !== "aphrodisia")});
        }} /><span><strong>{copy.categories[4]}</strong><small>{copy.categoryHints[4]}</small></span>
      </label> : null}
      {available.includes("aphrodisia") && effective.includes("aphrodisia") ? <div className="daily-advice-age-setting">
        <button type="button" disabled={busy} onClick={() => setAgeCategories(preferences.categories)}>{copy.ageManage}</button>
        <p className="daily-advice-note" role="status">{preferences.aphrodisiaAdult === true ? copy.ageAllowed : copy.ageRestricted}</p>
      </div> : null}
      </fieldset>
      <AdvicePsychopompiaSettings value={preferences.psychopompia} language={user.language}
        disabled={busy||!preferences.enabled||!preferences.collections.includes('aurora')} error={error} onChange={psychopompia=>void change({psychopompia})}/>
      </> : null}
    </div>
    <div className="daily-advice-common-settings">
      <h4>{collectionsCopy.common}</h4>
      <label className="account-switch-row" htmlFor="advice-enabled">
        <span><strong>{copy.enable}</strong><small>{advanced?copy.enableHint:translateText('Один совет в день. Настройки категорий и режима доступны в Standart и выше.',user.language)}</small></span>
        <input id="advice-enabled" aria-label={copy.enable} type="checkbox" role="switch" checked={preferences.enabled} disabled={busy} onChange={event => void change({ enabled: event.target.checked })} />
        <i aria-hidden="true" />
      </label>
      <p className="daily-advice-note">{copy.scopeHint}</p>
      <fieldset className="daily-advice-notification-settings" aria-describedby="advice-notification-hint">
        <legend>{notificationCopy.enable}</legend>
        <label className="account-switch-row" htmlFor="advice-notifications-enabled">
          <span><strong>{notificationCopy.enable}</strong><small id="advice-notification-hint">{notificationCopy.hint}</small></span>
          <input id="advice-notifications-enabled" type="checkbox" role="switch" checked={preferences.notifications.enabled}
            disabled={busy||!preferences.enabled||(!preferences.notifications.enabled&&(!supported||!pushStatus?.capabilities.available))} aria-label={notificationCopy.enable}
            onChange={event=>{if(event.target.checked&&(!deviceId||Notification.permission!=='granted'))void connectNotifications();else void change({notifications:{...preferences.notifications,enabled:event.target.checked}});}}/>
          <i aria-hidden="true"/>
        </label>
        <div className="daily-advice-notification-time"><label htmlFor="advice-notification-time">{notificationCopy.time}</label>
          <AdviceNotificationTime key={preferences.notifications.time} value={preferences.notifications.time} label={notificationCopy.time} user={user}
            disabled={busy||!preferences.enabled||!preferences.notifications.enabled} onSave={time=>void change({notifications:{...preferences.notifications,time}})}/>
          <p className="daily-advice-note">{notificationCopy.zone.replace('{zone}',preferences.notifications.timeZone)}</p>
        </div>
        {!supported?<p className="daily-advice-note">{notificationCopy.unsupported}</p>:pushStatus&&!pushStatus.capabilities.available?<p className="daily-advice-note">{notificationCopy.unavailable}</p>:null}
        {supported&&pushStatus?.capabilities.available&&(preferences.notifications.enabled||deviceId)?<div className="daily-advice-notification-device"><button type="button" className="secondary-button" disabled={busy||(!deviceId&&!preferences.enabled)}
          onClick={()=>void(deviceId?disconnectNotifications():connectNotifications())}>{deviceId?notificationCopy.disconnect:notificationCopy.connect}</button>
          {deviceId?<span role="status">{Notification.permission==='denied'?notificationCopy.permission:notificationCopy.connected}</span>:null}</div>:null}
        {pushFailed?<p className="daily-advice-note" role="alert">{notificationCopy.unavailable}<button type="button" className="secondary-button" disabled={busy} onClick={()=>setPushRevision(value=>value+1)}>{notificationCopy.retry}</button></p>:null}
      </fieldset>
      {user.adviceCatalogAvailable === false ? <p className="daily-advice-note" role="status">{copy.pending}</p> : null}
      <AdvicePrivacyNotice language={user.language}/>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {ageCategories ? <AdviceAgeDialog copy={copy} busy={busy} onClose={() => {if(!busy)setAgeCategories(null);}} onAnswer={adult => {
      if(busy)return;
      const categories=ageCategories;
      // Restore focus only after saving re-enables the real initiating button.
      void change({categories, aphrodisiaAdult: adult}).then(()=>setAgeCategories(null));
    }} /> : null}
  </section>;
}

function AdviceNotificationTime({value,label,user,disabled,onSave}:{value:string;label:string;user:GenesisUser;disabled:boolean;onSave:(time:string)=>void}){
  const [draft,setDraft]=useState(value);
  const saveLabel=translateText('Сохранить',user.language)+': '+label;
  return <div className="daily-advice-notification-time-actions">
    <TimeClockPicker id="advice-notification-time" value={draft} ariaLabel={label} timeFormat={user.timeFormat} disabled={disabled} allowClear={false} onChange={setDraft}/>
    <button type="button" className="secondary-button daily-advice-time-save" aria-label={saveLabel} data-tooltip={saveLabel}
      disabled={disabled||draft===value} onClick={()=>onSave(draft)}><ExperimentalIcon name="check"/></button>
  </div>;
}

function AdviceAgeDialog({copy, busy, onClose, onAnswer}: {copy: typeof labels.ru; busy: boolean; onClose: () => void; onAnswer: (adult: boolean) => void}) {
  const nativeDialog=useRef<HTMLDialogElement>(null);
  const focusRef=useDialogAccessibility<HTMLDialogElement>(onClose);
  const dialogRef=(element:HTMLDialogElement|null)=>{nativeDialog.current=element;focusRef(element);};
  useEffect(() => {
    const dialog=nativeDialog.current;dialog?.showModal();
    return()=>dialog?.close();
  }, []);
  return <dialog ref={dialogRef} className="daily-advice-age-dialog" aria-labelledby="advice-age-title" aria-describedby="advice-age-hint" aria-busy={busy} onClose={onClose}>
    <header><h2 id="advice-age-title">{copy.ageQuestion}</h2><DialogCloseButton type="button" disabled={busy} onClick={onClose}/></header>
    <p id="advice-age-hint">{copy.ageHint}</p>
    <div className="daily-advice-age-actions"><button type="button" disabled={busy} onClick={() => onAnswer(false)}>{copy.ageNo}</button><button type="button" disabled={busy} onClick={() => onAnswer(true)}>{copy.ageYes}</button></div>
  </dialog>;
}
