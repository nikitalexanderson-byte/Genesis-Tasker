"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DialogCloseButton } from "./DialogCloseButton";
import { IconActionButton } from "./IconActionButton";
import { TimeClockPicker } from "./TimeClockPicker";
import { translateText as t, runtimeLocale } from "./i18n";
import { privateDeviceAccessBlocked } from "./local-sign-out";
import { waitForSharedPush } from "./shared-push-device";
import { notificationKindLabels, notificationErrorLabels, notificationFailure, rebaseNotificationPreferences, sharedPushDeviceKey, supportsSharedPush, type SharedNotificationPreferences, type SharedNotificationSettings } from "./notification-settings-model";
import { deleteSharedPushSubscription, loadSharedNotificationSettings, loadSharedTaskWatch, registerSharedPushSubscription, retrySharedNotificationDeliveries, saveSharedNotificationSettings, updateSharedTaskWatch } from "./cloud-sync";
import "./notification-preferences.css";

const subscribeOnline=(changed:()=>void)=>{window.addEventListener("online",changed);window.addEventListener("offline",changed);return()=>{window.removeEventListener("online",changed);window.removeEventListener("offline",changed);};};
const onlineSnapshot=()=>navigator.onLine,serverOnline=()=>true;
const deviceZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";
const permitted=(alive:boolean,signal:AbortSignal)=>alive&&!signal.aborted&&!privateDeviceAccessBlocked();
const blocker=(value?:string)=>t(notificationErrorLabels[value??""]??"Недоступно");

export function SharedTaskWatch({userId,projectId,taskId}:{userId:string;projectId:string;taskId:string}) {
  const key=`${userId}:${projectId}:${taskId}`,[result,setResult]=useState<{key:string;watching:boolean}|null>(null),[failure,setFailure]=useState(""),[busy,setBusy]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[version,setVersion]=useState(0);
  const alive=useRef(false),controller=useRef<AbortController|null>(null),online=useSyncExternalStore(subscribeOnline,onlineSnapshot,serverOnline);
  useEffect(()=>{alive.current=true;const abort=new AbortController();controller.current=abort;
    void loadSharedTaskWatch(projectId,taskId,abort.signal).then(value=>{if(permitted(alive.current,abort.signal)){setResult({key,...value});setFailure("");setBusy(false);}})
      .catch(error=>{if(permitted(alive.current,abort.signal)){setResult(null);setFailure(notificationFailure(error));setBusy(false);}});
    return()=>{alive.current=false;abort.abort();controller.current?.abort();};
  },[key,projectId,taskId,version]);
  const watching=result?.key===key?result.watching:null;
  const toggle=async()=>{
    if(watching===null||busy||!online)return;const abort=new AbortController();controller.current=abort;setBusy(true);setFailure("");
    try{const next=await updateSharedTaskWatch(projectId,taskId,!watching,abort.signal);if(permitted(alive.current,abort.signal))setResult({key,...next});}
    catch(error){if(permitted(alive.current,abort.signal))setFailure(notificationFailure(error));}finally{if(permitted(alive.current,abort.signal))setBusy(false);}
  };
  return <div className="notification-task-watch"><div className="notification-watch-row">
    <IconActionButton icon={watching?"check":"eye"} label={t("Наблюдение за задачей")} aria-pressed={Boolean(watching)} disabled={watching===null||busy||!online} onClick={()=>void toggle()} aria-description={t("Наблюдение сообщает об изменениях и комментариях задачи.")}/>
    <IconActionButton icon="mail" label={t("Настройки уведомлений")} onClick={()=>setSettingsOpen(true)}/>
  </div>{watching===null&&!failure?<small role="status">{t("Загрузка…")}</small>:null}{failure?<p role="alert">{failure} <button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>setVersion(value=>value+1)}>{t("Повторить")}</button></p>:null}
    {settingsOpen?<SharedNotificationPreferencesDialog userId={userId} onClose={()=>setSettingsOpen(false)}/>:null}
  </div>;
}

export function SharedNotificationPreferencesDialog({userId,onClose}:{userId:string;onClose:()=>void}) {
  const [data,setData]=useState<SharedNotificationSettings|null>(null),[draft,setDraft]=useState<SharedNotificationPreferences|null>(null),[failure,setFailure]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),[deviceId,setDeviceId]=useState("");
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(false),controller=useRef<AbortController|null>(null),online=useSyncExternalStore(subscribeOnline,onlineSnapshot,serverOnline);
  const latest=useRef({userId,data,draft});
  useEffect(()=>{latest.current={userId,data,draft};},[userId,data,draft]);
  const receive=useCallback((value:SharedNotificationSettings)=>{
    const previous=latest.current;
    setData(value);
    setDraft(previous.userId===userId&&previous.data&&previous.draft
      ?rebaseNotificationPreferences(previous.data.settings,previous.draft,value.settings):structuredClone(value.settings));
  },[userId]);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  useEffect(()=>{
    alive.current=true;const abort=new AbortController();controller.current=abort;
    void loadSharedNotificationSettings(abort.signal).then(value=>{if(permitted(alive.current,abort.signal)){receive(value);setFailure("");setBusy(false);try{setDeviceId(localStorage.getItem(sharedPushDeviceKey(userId))??"");}catch{/* Connection can still be managed through the browser. */}}})
      .catch(error=>{if(permitted(alive.current,abort.signal)){setFailure(notificationFailure(error));setBusy(false);if(error&&typeof error==="object"&&"status"in error&&[401,403,404].includes(Number(error.status))){setData(null);setDraft(null);}}});
    return()=>{alive.current=false;abort.abort();controller.current?.abort();};
  },[userId,version,receive]);
  const update=(patch:Partial<SharedNotificationPreferences>)=>{setDraft(previous=>previous?{...previous,...patch}:previous);setMessage("");};
  const changed=Boolean(data&&draft&&JSON.stringify(data.settings)!==JSON.stringify(draft));
  const run=async(action:(signal:AbortSignal)=>Promise<void>)=>{if(busy||!online)return;const abort=new AbortController();controller.current=abort;setBusy(true);setFailure("");setMessage("");try{await action(abort.signal);}catch(error){if(permitted(alive.current,abort.signal))setFailure(notificationFailure(error));}finally{if(permitted(alive.current,abort.signal))setBusy(false);}};
  const save=()=>run(async signal=>{if(!draft||!data)return;const next=await saveSharedNotificationSettings(draft,data.revision,signal);if(permitted(alive.current,signal)){setData(next);setDraft(structuredClone(next.settings));setMessage(t("Настройки уведомлений сохранены."));window.dispatchEvent(new Event("genesis:shared-updates"));}});
  const push=()=>run(async signal=>{
    if(!data||!draft||!supportsSharedPush())return;
    if(Notification.permission==="denied"){setFailure(t("Уведомления запрещены в настройках браузера. Все события доступны во входящих."));return;}
    const permission=await Notification.requestPermission();if(!permitted(alive.current,signal))return;
    if(permission!=="granted"){setFailure(t("Разрешение на уведомления не получено. Все события доступны во входящих."));return;}
    const registration=await waitForSharedPush(navigator.serviceWorker.ready,signal);if(!permitted(alive.current,signal))return;
    const key=data.capabilities.push.publicKey;if(!key)throw new Error("PUSH_KEYS_UNCONFIGURED");const bytes=Uint8Array.from(atob(key.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-key.length%4)%4)),character=>character.charCodeAt(0));
    const existing=await waitForSharedPush(registration.pushManager.getSubscription(),signal);const subscription=existing??await waitForSharedPush(registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes}),signal,late=>{void late.unsubscribe().catch(()=>undefined);});
    if(!permitted(alive.current,signal)){if(!existing)void subscription.unsubscribe();return;}
    const linked=await registerSharedPushSubscription(subscription.toJSON(),signal);if(!permitted(alive.current,signal))return;
    try{localStorage.setItem(sharedPushDeviceKey(userId),linked.id);}catch{/* The explicit connection remains recoverable through the server. */}setDeviceId(linked.id);
    const settings={...draft,channels:{...draft.channels,push:true}},next=await saveSharedNotificationSettings(settings,data.revision,signal);if(permitted(alive.current,signal)){setData(next);setDraft(structuredClone(next.settings));setMessage(t("Это устройство подключено."));}
  });
  const disconnect=()=>run(async signal=>{await deleteSharedPushSubscription(deviceId,signal);if(!permitted(alive.current,signal))return;const registration=await navigator.serviceWorker.getRegistration();await(await registration?.pushManager.getSubscription())?.unsubscribe();const next=await loadSharedNotificationSettings(signal);if(!permitted(alive.current,signal))return;try{localStorage.removeItem(sharedPushDeviceKey(userId));}catch{/* Server and browser subscription were removed. */}setDeviceId("");receive(next);setMessage(t("Это устройство отключено."));});
  const retry=()=>run(async signal=>{const result=await retrySharedNotificationDeliveries(signal);const next=await loadSharedNotificationSettings(signal);if(permitted(alive.current,signal)){receive(next);setMessage(t("Возобновлено отправок: {count}").replace("{count}",result.resumed.toLocaleString(runtimeLocale())));}});
  const connected=Boolean(deviceId&&data?.subscriptions.some(item=>item.id===deviceId));
  return <dialog ref={dialog} className="shared-projects-modal notification-preferences" aria-labelledby="notification-preferences-title" onCancel={event=>{if(dialog.current?.querySelector('[aria-modal="true"]'))event.preventDefault();else onClose();}} onClose={onClose}>
    <header><h2 id="notification-preferences-title">{t("Настройки уведомлений")}</h2><DialogCloseButton aria-label={t("Закрыть настройки уведомлений")} onClick={onClose}/></header>
    {!draft||!data?<p role={failure?"alert":"status"}>{failure||t("Загрузка…")}</p>:<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy||!online}>
      <fieldset className="notification-setting-group"><legend>{t("События во входящих и на устройстве")}</legend><div className="notification-options">{Object.entries(notificationKindLabels).map(([kind,label])=><label className="notification-option" key={kind}><input type="checkbox" checked={draft.types[kind as keyof typeof draft.types]} onChange={event=>update({types:{...draft.types,[kind]:event.target.checked}})}/><span>{t(label)}</span></label>)}</div></fieldset>
      <fieldset className="notification-setting-group"><legend>{t("Каналы")}</legend>
        <label className="notification-option"><input type="checkbox" checked={draft.channels.inbox} onChange={event=>update({channels:{...draft.channels,inbox:event.target.checked}})}/><span>{t("Входящие GENESIS")}</span></label>
        <label className="notification-option"><input type="checkbox" checked={draft.channels.push} disabled={!data.capabilities.push.available&&!draft.channels.push} onChange={event=>update({channels:{...draft.channels,push:event.target.checked}})}/><span>{t("Уведомления устройства")}</span></label>
        {!data.capabilities.push.available?<p className="notification-setting-note">{blocker(data.capabilities.push.blocker)}</p>:!supportsSharedPush()?<p className="notification-setting-note">{t("Этот браузер не поддерживает фоновые уведомления. Все события доступны во входящих.")}</p>:<div className="notification-preference-buttons"><button type="button" className="secondary-button" onClick={()=>void(connected?disconnect():push())}>{t(connected?"Отключить это устройство":"Включить на этом устройстве")}</button><small>{t("Устройства: {count}").replace("{count}",data.subscriptions.length.toLocaleString(runtimeLocale()))}</small></div>}
        <label className="notification-option"><input type="checkbox" checked={draft.channels.email} disabled={!data.capabilities.email.available&&!draft.channels.email} onChange={event=>update({channels:{...draft.channels,email:event.target.checked}})}/><span>{t("Письма по email")}</span></label>
        {!data.capabilities.email.available?<p className="notification-setting-note">{blocker(data.capabilities.email.blocker)}</p>:null}
      </fieldset>
      <fieldset className="notification-setting-group"><legend>{t("События писем")}</legend>
        <p className="notification-setting-note">{t("Отправитель: noreply@genesiscalendar.com. Письма можно отключить отдельно. Частота и тихие часы применяются к уведомлениям; письмо подтверждения регистрации отправляется только при создании аккаунта.")}</p>
        <div className="notification-options">{Object.entries({...notificationKindLabels,messages:"Личные сообщения"}).map(([kind,label])=><label className="notification-option" key={kind}><input type="checkbox" checked={(draft.emailTypes??{...draft.types,messages:true})[kind as keyof NonNullable<SharedNotificationPreferences["emailTypes"]>]} onChange={event=>update({emailTypes:{...draft.types,messages:true,...draft.emailTypes,[kind]:event.target.checked}})}/><span>{t(label)}</span></label>)}</div>
      </fieldset>
      <details className="notification-advanced"><summary>{t("Время и частота")}</summary><div className="notification-preference-fields">
        <label>{t("Частота отправки")}<select value={draft.frequency} onChange={event=>update({frequency:event.target.value as SharedNotificationPreferences["frequency"]})}><option value="immediate">{t("Сразу")}</option><option value="hourly">{t("Раз в час")}</option><option value="daily">{t("Ежедневная сводка")}</option></select></label>
        {draft.frequency==="daily"?<label>{t("Время сводки")}<TimeClockPicker value={draft.digestTime} ariaLabel={t("Время сводки")} onChange={digestTime=>update({digestTime})}/></label>:null}
        <label>{t("За сколько дней напоминать о сроке")}<input type="number" min={0} max={30} step={1} required value={draft.reminderDays} onChange={event=>update({reminderDays:Number(event.target.value)})}/></label>
        <div className="notification-zone-field"><label>{t("Часовой пояс")}<select value={draft.timeZoneMode??"fixed"} onChange={event=>update({timeZoneMode:event.target.value as "device"|"fixed",...(event.target.value==="device"?{timeZone:deviceZone()}:{})})}><option value="device">{t("Часовой пояс устройства")}</option><option value="fixed">{t("Выбрать часовой пояс")}</option></select></label><label>{t("Часовой пояс IANA")}<input required maxLength={80} value={draft.timeZone} disabled={draft.timeZoneMode==="device"} onChange={event=>update({timeZone:event.target.value})}/></label></div>
      </div><label className="notification-option"><input type="checkbox" checked={draft.quiet.enabled} onChange={event=>update({quiet:{...draft.quiet,enabled:event.target.checked}})}/><span>{t("Тихие часы")}</span></label>
        {draft.quiet.enabled?<div className="notification-preference-fields"><label>{t("Начало тихих часов")}<TimeClockPicker value={draft.quiet.start} ariaLabel={t("Начало тихих часов")} onChange={start=>update({quiet:{...draft.quiet,start}})}/></label><label>{t("Окончание тихих часов")}<TimeClockPicker value={draft.quiet.end} ariaLabel={t("Окончание тихих часов")} onChange={end=>update({quiet:{...draft.quiet,end}})}/></label></div>:null}
      </details>
      {data.delivery.some(item=>item.state==="failed")?<div className="notification-delivery-failure"><p>{t("Некоторые уведомления не отправлены. Проверьте доступность канала и повторите отправку.")}</p><button type="button" className="secondary-button" onClick={()=>void retry()}>{t("Повторить отправку")}</button></div>:null}
      <footer className="notification-preference-buttons"><button type="submit" className="primary-button" disabled={!changed}>{t("Сохранить")}</button><button type="button" className="secondary-button" onClick={onClose}>{t("Отмена")}</button></footer>
    </fieldset></form>}
    {draft&&failure?<p role="alert">{failure}</p>:null}{failure?<IconActionButton icon="map-refresh" label={t("Обновить настройки")} disabled={busy||!online} onClick={()=>setVersion(value=>value+1)}/>:null}
    {message?<p role="status">{message}</p>:null}{!online?<p role="status">{t("Для сохранения нужно подключение к интернету")}</p>:null}
  </dialog>;
}
