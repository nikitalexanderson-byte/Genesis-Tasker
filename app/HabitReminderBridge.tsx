import { useEffect, useRef, useState } from "react";
import { deleteHabitReminderDevice, loadHabitReminderDelivery, loadHabitReminderStatus, refreshHabitReminderPlan, registerHabitReminderDevice,
  snoozeHabitReminderDelivery, type HabitReminderStatus } from "./cloud-sync";
import { habitReminderFrequency } from "./habit-reminder-device";
import { habitReminderAction, habitReminderTarget, type HabitReminderTarget, type HabitReminderInput } from "./habit-reminder-plan";
import { HabitReminderInputPanel } from "./HabitReminderInput";
import type { CalendarMode } from "./calendar-data";
import type { TimeFormat } from "./time-format";
import { habitReminderWorkerIntent, scheduleHabitReminderFallback, snoozeLocalHabitReminder, type HabitReminderIntent } from "./habit-reminder-browser";
import { privateDeviceAccessBlocked } from "./local-sign-out";
import { translateText, type Language } from "./i18n";
import type { HabitWorkspace } from "./habits";
import "./habit-reminders.css";

type ReminderReceiveRequest = { kind: "intent" | "notice"; id: string };

export default function HabitReminderBridge({ userId, workspace, language, appBase, calendarMode, timeFormat, onApply, onOpen }: {
  userId: string; workspace: HabitWorkspace; language: Language; appBase: string;
  calendarMode:CalendarMode;timeFormat:TimeFormat;
  onApply: (target: HabitReminderTarget,input?:HabitReminderInput) => Promise<void>; onOpen: (target: HabitReminderTarget | null) => void;
}) {
  const live = useRef({workspace,language,onApply,onOpen});
  useEffect(() => {live.current={workspace,language,onApply,onOpen};});
  const [status, setStatus] = useState<HabitReminderStatus | null>(null);
  const [checked,setChecked]=useState(false);
  const [pending, setPending] = useState<{id: string; intent: HabitReminderIntent} | null>(null);
  const [receiveRequest,setReceiveRequest]=useState<ReminderReceiveRequest|null>(null);
  const [receiving,setReceiving]=useState(false);
  const [inputTarget,setInputTarget]=useState<HabitReminderTarget|null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const received = useRef("");
  const t = (text: string) => translateText(text, language);
  useEffect(() => {
    let active=true, checking=false;
    const refresh=async()=>{
      if(checking||privateDeviceAccessBlocked())return;checking=true;
      try{
        let next=await loadHabitReminderStatus(userId);
        if(next.device?.enabled && typeof Notification!=="undefined" && Notification.permission!=="granted"){
          await deleteHabitReminderDevice(next.device);next=await loadHabitReminderStatus(userId);
        } else if(next.device?.enabled && next.capabilities.available && next.device.time_zone!==Intl.DateTimeFormat().resolvedOptions().timeZone){
          const subscription=await(await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
          if(subscription)await registerHabitReminderDevice(userId,subscription,habitReminderFrequency(userId),Number(next.device.revision),crypto.randomUUID());
          next=await loadHabitReminderStatus(userId);
        }
        if(next.hasDevices && (next.profile?.needsRefresh || !next.profile?.expiresAt || Date.parse(next.profile.expiresAt)-Date.now()<86400000)){
          await refreshHabitReminderPlan();next=await loadHabitReminderStatus(userId);
        }
        if(active){setStatus(next);setRevision(value=>value+1);}
      } catch { /* Keep the last confirmed schedule to avoid running two delivery channels during a transient failure. */ } finally{checking=false;if(active)setChecked(true);}
    };
    void refresh();const interval=setInterval(()=>void refresh(),60_000);
    const changed=()=>void refresh();
    window.addEventListener("focus",changed);window.addEventListener("online",changed);window.addEventListener("genesis:habit-reminders-changed",changed);
    return()=>{active=false;clearInterval(interval);window.removeEventListener("focus",changed);window.removeEventListener("online",changed);window.removeEventListener("genesis:habit-reminders-changed",changed);};
  },[userId]);
  useEffect(() => {
    const background=Boolean(status?.capabilities.available&&status.device?.enabled&&status.profile&&!status.profile.needsRefresh&&status.profile.expiresAt&&Date.parse(status.profile.expiresAt)>Date.now());
    if(background||!checked)return;
    return scheduleHabitReminderFallback(userId,()=>live.current.workspace,language,appBase);
  },[userId,workspace,language,appBase,status,revision,checked]);
  const apply = async (item: NonNullable<typeof pending>) => {
    if(busy||privateDeviceAccessBlocked())return;
    setBusy(true);setMessage("");
    try{
      let intent=item.intent;
      if(intent.deliveryId){
        const access=await loadHabitReminderDelivery(intent.deliveryId);
        if(access.userId!==userId)throw Error("ACCOUNT_CHANGED");
        intent={...intent,target:access.target};
      }
      if(intent.userId!==userId)throw Error("ACCOUNT_CHANGED");
      const target=intent.target&&habitReminderTarget(intent.target);
      live.current.onOpen(target??null);
      const action=target?habitReminderAction(live.current.workspace,target):null;
      if(intent.action==="snooze"){
        if(intent.deliveryId)await snoozeHabitReminderDelivery(intent.deliveryId);
        else if(intent.target)snoozeLocalHabitReminder(userId,intent.target,live.current.workspace);
        setMessage("Напоминание отложено.");
      } else if(action==="stale"||action==="unavailable")setMessage("Уведомление устарело. Сегодняшние отметки не изменены.");
      else if(action==="completed")setMessage("Результат уже записан.");
      else if(intent.action==="primary"&&target&&(action==="complete"||action==="interval")){
        await live.current.onApply(target);setMessage("Результат сохранён.");
      } else if(action==="input"&&target){setInputTarget(target);setMessage("Введите результат в карточке привычки. Отметка не добавляется автоматически.");}
      if(item.id)await habitReminderWorkerIntent(item.id,userId,true);
      setPending(null);
      const url=new URL(window.location.href);url.searchParams.delete("habitIntent");url.searchParams.delete("habitNotice");history.replaceState(history.state,"",url);
    }catch{setMessage("Не удалось обработать напоминание. Проверьте сеть и повторите.");setPending(item);}
    finally{setBusy(false);}
  };
  const applyRef=useRef(apply);useEffect(()=>{applyRef.current=apply;});
  const receive=async(request:ReminderReceiveRequest,isActive:()=>boolean=()=>true)=>{
    if(privateDeviceAccessBlocked())return;
    setReceiveRequest(request);setReceiving(true);setMessage("");
    try{
      let item:NonNullable<typeof pending>;
      if(request.kind==="intent"){
        const intent=await habitReminderWorkerIntent(request.id,userId);
        if(!isActive())return;
        if(!intent||intent.userId!==userId)throw Error("HABIT_REMINDER_INTENT_UNAVAILABLE");
        item={id:request.id,intent};
      }else{
        const access=await loadHabitReminderDelivery(request.id);
        if(!isActive())return;
        if(access.userId!==userId)throw Error("ACCOUNT_CHANGED");
        item={id:"",intent:{userId,deliveryId:request.id,target:access.target,action:"open"}};
      }
      received.current=`${userId}:${request.kind}:${request.id}`;
      setReceiveRequest(null);setPending(item);await applyRef.current(item);
    }catch{if(isActive())setMessage("Не удалось обработать напоминание. Проверьте сеть и повторите.");}
    finally{if(isActive())setReceiving(false);}
  };
  const receiveRef=useRef(receive);useEffect(()=>{receiveRef.current=receive;});
  useEffect(()=>{
    let active=true;
    const url=new URL(window.location.href),id=url.searchParams.get("habitIntent"),notice=url.searchParams.get("habitNotice");
    const request:ReminderReceiveRequest|null=id?{kind:"intent",id}:notice?{kind:"notice",id:notice}:null;
    if(request&&received.current!==`${userId}:${request.kind}:${request.id}`)void receiveRef.current(request,()=>active);
    const local=(event: Event)=>{const intent=(event as CustomEvent<HabitReminderIntent>).detail;if(intent?.userId===userId)void applyRef.current({id:"",intent});};
    window.addEventListener("genesis:local-habit-reminder",local);
    return()=>{active=false;window.removeEventListener("genesis:local-habit-reminder",local);};
  },[userId]);
  if(!message&&!pending&&!inputTarget&&!receiveRequest)return null;
  return <div className="habit-reminder-status" role="status" aria-live="polite">
    {message?<p>{t(message)}</p>:null}
    {inputTarget?<HabitReminderInputPanel key={`${inputTarget.habitId}:${inputTarget.date}:${inputTarget.at}`} workspace={workspace} target={inputTarget}
      language={language} calendarMode={calendarMode} timeFormat={timeFormat} onSave={onApply}/>:null}
    <div className="habit-reminder-buttons">
      {receiveRequest?<button type="button" className="secondary-button" disabled={busy||receiving} onClick={()=>void receive(receiveRequest)}>{t("Повторить")}</button>
        :pending?<button type="button" className="secondary-button" disabled={busy||receiving} onClick={()=>void apply(pending)}>{t("Повторить")}</button>:null}
      <button type="button" className="text-button" disabled={busy||receiving} onClick={()=>{setMessage("");setReceiveRequest(null);setPending(null);setInputTarget(null);}}>{t("Закрыть")}</button>
    </div>
  </div>;
}
