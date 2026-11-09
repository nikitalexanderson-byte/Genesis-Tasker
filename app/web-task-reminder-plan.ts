import type {GenesisTask} from "./cloud-sync";
import {normalizeTaskReminders,taskReminderKey} from "./task-reminders.ts";
import {recurrenceDatesForTask} from "./task-recurrence.ts";
export type WebTaskReminder={id:string;taskId:string;title:string;at:number};
export function webTaskReminderPlan(tasks:GenesisTask[],now=Date.now()):WebTaskReminder[] {
 const candidates:WebTaskReminder[]=[];
 for(const task of tasks){if(task.done)continue;const reminders=normalizeTaskReminders(task.reminders,task.reminderMinutes);
  for(const reminder of reminders){
   if(reminder.kind==="absolute"){const at=Date.parse(reminder.at);if(at>=now-6*3600000&&at<=now+86400000)candidates.push({id:`${task.id}:absolute:${reminder.at}`,taskId:task.id,title:task.title,at});continue;}
   for(const date of recurrenceDatesForTask(task)){const at=new Date(`${date}T${task.time||"09:00"}:00`).getTime()-reminder.minutes*60000;
    if(at>=now-6*3600000&&at<=now+86400000)candidates.push({id:`${task.id}:${date}:${taskReminderKey(reminder)}`,taskId:task.id,title:task.title,at});
   }
  }
 }
 return [...new Map(candidates.map(candidate=>[candidate.id,candidate])).values()].sort((a,b)=>a.at-b.at).slice(0,128);
}
