import type { SharedStatus, SharedTask } from "./cloud-sync";

export function ganttTaskGroups(tasks: SharedTask[], statuses: Pick<SharedStatus, "id" | "isDone">[]) {
  const completedStatuses = new Set(statuses.filter(status => Boolean(status.isDone)).map(status => status.id));
  return { active: tasks.filter(task => !completedStatuses.has(task.statusId)),
    completed: tasks.filter(task => completedStatuses.has(task.statusId)) };
}

export type GanttScale = "day" | "days" | "weeks" | "months";
export function ganttUnscheduledTasks(tasks: SharedTask[], scale: GanttScale) {
  return tasks.filter(task => {
    const span = taskSpan(task);
    return !span || scale === "day" && !span.timed;
  });
}
export type GanttAxisPeriod = {start:number;end:number};
export const GANTT_CELL_WIDTH=96;
/** Every calendar period has the same visual width, even when its number of days differs. */
export function ganttAxisPosition(periods:GanttAxisPeriod[],point:number):number {
  if(!periods.length)return 0;
  const index=point<periods[0].start ? 0 : periods.findIndex(period=>point<period.end);
  const i=index<0 ? periods.length-1 : index,period=periods[i];
  return (i+(point-period.start)/(period.end-period.start))*GANTT_CELL_WIDTH;
}
export function ganttAxisPoint(periods:GanttAxisPeriod[],position:number):number {
  if(!periods.length)return 0;
  const index=Math.max(0,Math.min(periods.length-1,Math.floor(position/GANTT_CELL_WIDTH))),period=periods[index];
  return period.start+(position/GANTT_CELL_WIDTH-index)*(period.end-period.start);
}
export function dateSerial(key: string) { return Date.parse(`${key}T00:00:00Z`) / 86400000; }
export function serialDate(value: number) { return new Date(value * 86400000).toISOString().slice(0, 10); }
export function timeFraction(value?: string | null) { const [h, m] = (value ?? "00:00").split(":").map(Number); return (h * 60 + m) / 1440; }
export function taskSpan(task: SharedTask): { start: number; end: number; timed: boolean } | null {
  const first = task.startDate || task.dueDate; const last = task.dueDate || task.startDate;
  if (!first || !last) return null;
  const timed = Boolean(task.startTime && task.endTime);
  return { start: dateSerial(first) + (timed ? timeFraction(task.startTime) : 0),
    end: dateSerial(last) + (timed ? timeFraction(task.endTime) : 1), timed };
}
export function ganttRange(anchor: string, scale: GanttScale, tasks: SharedTask[], fit = false, bounds?: {first: string | null; last: string | null}) {
  const day = dateSerial(anchor);
  if (scale === "day") return { start: day, end: day + 1 };
  if (fit) {
    if (bounds?.first && bounds.last) { const start=dateSerial(bounds.first)-1; return {start,end:Math.min(start+366,dateSerial(bounds.last)+2)}; }
    const spans = tasks.map(taskSpan).filter((span): span is NonNullable<typeof span> => Boolean(span));
    if (spans.length) { const start = Math.floor(Math.min(...spans.map(span => span.start))) - 1;
      return { start, end: Math.min(start + 366, Math.ceil(Math.max(...spans.map(span => span.end))) + 1) }; }
  }
  const weekday = (new Date(day * 86400000).getUTCDay() + 6) % 7;
  if (scale === "days") return { start: day - weekday, end: day - weekday + 14 };
  if (scale === "weeks") return { start: day - weekday, end: day - weekday + 56 };
  const date = new Date(day * 86400000);
  return { start: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86400000,
    end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 6, 1) / 86400000 };
}

export type GanttSchedule = {startDate: string; dueDate: string; startTime: string | null; endTime: string | null};
export type GanttTaskDates = {startDate: string | null; dueDate: string | null; startTime: string | null; endTime: string | null};
export type GanttReturnTarget = {projectId:string;statusId:string;position:number;unschedule?:GanttTaskDates;view?:"list"|"board"};
export function ganttUnscheduledSchedule(task: SharedTask, scale: GanttScale): GanttTaskDates {
  return { startDate: scale === "day" ? task.startDate ?? null : null,
    dueDate: scale === "day" ? task.dueDate : null, startTime: null, endTime: null };
}
export type GanttEdge = "start" | "end";
const minuteTime=(value:number)=>`${String(Math.floor(value/60)%24).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
/** A time-axis click starts today; date-axis clicks keep their actual calendar date. */
export function ganttCreationSchedule(point:number,scale:GanttScale,todayKey:string):GanttSchedule {
  if(scale!=="day") {
    const date=serialDate(Math.floor(point+1e-7));
    return {startDate:date,dueDate:date,startTime:null,endTime:null};
  }
  const minutes=Math.max(0,Math.min(1425,Math.round((point-Math.floor(point))*96)*15));
  return {startDate:todayKey,dueDate:serialDate(dateSerial(todayKey)+Math.floor((minutes+60)/1440)),startTime:minuteTime(minutes),endTime:minuteTime(minutes+60)};
}
/** Resize one endpoint; inclusive all-day dates and exact timed endpoints stay independent. */
export function ganttResizeSchedule(task: SharedTask, point: number, scale: GanttScale, edge: GanttEdge): GanttSchedule | null {
  const span=taskSpan(task);
  if(!span)return null;
  const schedule={startDate:task.startDate||task.dueDate!,dueDate:task.dueDate||task.startDate!,startTime:span.timed ? task.startTime! : null,endTime:span.timed ? task.endTime! : null};
  if(scale==="day") {
    const start=Math.round(span.start*1440),end=Math.round(span.end*1440);
    const value=edge==="start" ? Math.min(Math.round(point*96)*15,end-15) : Math.max(Math.round(point*96)*15,start+15);
    return {...schedule,...(edge==="start" ? {startDate:serialDate(Math.floor(value/1440)),startTime:minuteTime(value)} : {dueDate:serialDate(Math.floor(value/1440)),endTime:minuteTime(value)})};
  }
  let day=Math.round(point);
  if(edge==="start") {
    const latest=span.timed ? Math.floor(span.end)- (timeFraction(schedule.startTime)>=timeFraction(schedule.endTime) ? 1 : 0) : span.end-1;
    day=Math.min(day,latest);
    return {...schedule,startDate:serialDate(day)};
  }
  // Midnight is already the exact end-date boundary; other ends include the last date.
  if(!span.timed||timeFraction(schedule.endTime)!==0)day-=1;
  const earliest=Math.floor(span.start)+(span.timed && timeFraction(schedule.endTime)<=timeFraction(schedule.startTime) ? 1 : 0);
  return {...schedule,dueDate:serialDate(Math.max(day,earliest))};
}
/** Snaps in UTC date arithmetic; browser time zone and DST cannot change the duration. */
export function ganttSchedule(task: SharedTask, point: number, scale: GanttScale): GanttSchedule {
  const span=taskSpan(task);
  if(scale==="day") {
    const start=Math.round(point*96)*15;
    const duration=span?.timed ? Math.max(1,Math.round((span.end-span.start)*1440)) : 60;
    return {startDate:serialDate(Math.floor(start/1440)),dueDate:serialDate(Math.floor((start+duration)/1440)),startTime:minuteTime(start),endTime:minuteTime(start+duration)};
  }
  const first=Math.floor(point+1e-7);
  const days=span ? Math.floor(span.end-(span.timed ? 0 : 1)+1e-7)-Math.floor(span.start) : 0;
  return {startDate:serialDate(first),dueDate:serialDate(first+days),startTime:span?.timed ? task.startTime! : null,endTime:span?.timed ? task.endTime! : null};
}
