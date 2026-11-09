import fs from "node:fs";
import { calendarModule } from "./calendar-modules.mjs";
const habits=calendarModule("app/habits.ts"),reminders=calendarModule("app/habit-reminder-plan.ts");
const cases=[
 {id:"utc",now:"2026-10-17T08:00:00Z",zone:"UTC",time:"09:00"},
 {id:"dst-gap",now:"2026-03-29T00:00:00Z",zone:"Europe/Berlin",time:"02:00",interval:{intervalMinutes:30,startTime:"02:00",endTime:"03:00",completionMode:"each"}},
 {id:"dst-overlap",now:"2026-10-25T00:00:00Z",zone:"Europe/Berlin",time:"02:30"},
 {id:"previous-civil-day",now:"2026-10-17T05:00:00Z",zone:"Pacific/Honolulu",time:"20:00"},
 {id:"goal-perfect",now:"2026-10-17T08:00:00Z",zone:"Asia/Kathmandu",time:"18:00",mode:"perfect"},
 {id:"rest-day",now:"2026-10-17T08:00:00Z",zone:"UTC",time:"09:00",mode:"easy",rest:true},
].map(item=>{
 const habit=habits.defaultHabit("2026-01-01","profane");Object.assign(habit,{id:"habit-vector",title:"PRIVATE synthetic habit",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"});
 habit.schedule.timezone=item.zone;habit.reminder={...habit.reminder,enabled:true,time:item.time};
 if(item.interval)habit.intervalSchedule=item.interval;
 const workspace=structuredClone(habits.EMPTY_HABIT_WORKSPACE);workspace.habits=[habit];
 if(item.mode){workspace.habitSettings.notifications={...workspace.habitSettings.notifications,enabled:true,motivational:true};
 workspace.habitSettings.dailyGoalModeChanges=[{effectiveFrom:"2026-01-01",mode:item.mode,updatedAt:"2026-01-01T00:00:00.000Z"}];}
 if(item.rest)workspace.habitSettings.plannedRestDays=["2026-10-17"];
 return {id:item.id,now:item.now,zone:item.zone,workspace,plan:reminders.buildHabitReminderPlan(workspace,new Date(item.now),item.zone,2)};
});
fs.mkdirSync(new URL("../fixtures/",import.meta.url),{recursive:true});
fs.writeFileSync(new URL("../fixtures/habit-reminders-vectors.json",import.meta.url),JSON.stringify(cases,null,2)+"\n");
