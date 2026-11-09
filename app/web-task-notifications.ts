import type {GenesisTask} from "./cloud-sync";
import {captureAccountSessionGuard} from "./cloud-sync";
import {webTaskReminderPlan} from "./web-task-reminder-plan";
import {presentWebReminder} from "./web-reminder-presentation";
import {privateDeviceAccessBlocked} from "./local-sign-out";
export function scheduleWebTaskReminders(tasks:GenesisTask[],userId:string,appBase:string) {
 if(typeof window==="undefined"||!userId||typeof Notification==="undefined"||Notification.permission!=="granted"||privateDeviceAccessBlocked())return()=>{};
 const key=`genesis-task-reminders:${userId}`;const guard=captureAccountSessionGuard();let active=true;
 const timers = new Map<string, number>();
 const refresh = () => {
  if (!active) return;
  try { guard(); } catch { return; }
  const candidates = webTaskReminderPlan(tasks);
  const wanted = new Set(candidates.map(candidate => candidate.id));
  for (const [id, timer] of timers) if (!wanted.has(id)) { clearTimeout(timer); timers.delete(id); }
  for (const candidate of candidates) {
   if (timers.has(candidate.id)) continue;
   timers.set(candidate.id, window.setTimeout(()=>{void(async()=>{
  const deliver=async()=>{guard();if(!active||privateDeviceAccessBlocked())return;
   const delivered:string[]=JSON.parse(localStorage.getItem(key)||"[]");if(delivered.includes(candidate.id))return;
   const registration="serviceWorker" in navigator?await navigator.serviceWorker.getRegistration():undefined;guard();if(!active)return;
   const body=new Date(candidate.at).toLocaleString(document.documentElement.lang);const sounded=presentWebReminder("task",candidate.title,body);
   const options:NotificationOptions={body,tag:`genesis-task:${candidate.id}`,icon:`${appBase}/mindmap-icons/calendar-check.png`,badge:`${appBase}/mindmap-icons/calendar-check.png`,silent:sounded,data:{kind:"task",taskId:candidate.taskId,url:`${appBase||"/"}#projects`}};
   if(document.hidden){if(registration)await registration.showNotification(candidate.title,options);else new Notification(candidate.title,options);}
   guard();if(active)localStorage.setItem(key,JSON.stringify([...delivered,candidate.id].slice(-512)));
  };
  if(navigator.locks)await navigator.locks.request(`genesis-task-reminder:${userId}`,deliver);else await deliver();
 })().catch(()=>{});},Math.max(0,candidate.at-Date.now())));
  }
 };
 refresh();
 const refreshTimer = window.setInterval(refresh, 30 * 60_000);
 window.addEventListener("focus", refresh);
 document.addEventListener("visibilitychange", refresh);
 return()=>{active=false;timers.forEach(timer=>clearTimeout(timer));clearInterval(refreshTimer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
}
