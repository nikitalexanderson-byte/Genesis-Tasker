import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dateSerial, ganttRange, serialDate, taskSpan, ganttSchedule, ganttCreationSchedule, ganttResizeSchedule, ganttAxisPoint, ganttAxisPosition, GANTT_CELL_WIDTH } from "../app/shared-gantt.ts";
import { stoicheionReadingSections } from "../app/stoicheion-reading.ts";
import { ganttTaskGroups, ganttUnscheduledTasks, ganttUnscheduledSchedule } from "../app/shared-gantt.ts";

test("return from Gantt clears dates or only daily time, keeping task identity and dependencies",()=>{
 const task={id:"scheduled",title:"Scheduled",projectId:"project",statusId:"active",startDate:"2026-10-12",dueDate:"2026-10-14",startTime:"10:00",endTime:"11:00",dependsOnIds:["parent"]};
 const before=JSON.stringify(task);
 const undated={...task,...ganttUnscheduledSchedule(task,"weeks")};
 assert.equal(taskSpan(undated),null);assert.deepEqual(ganttUnscheduledTasks([undated],"weeks"),[undated]);
 const untimed={...task,...ganttUnscheduledSchedule(task,"day")};
 assert.equal(untimed.startDate,task.startDate);assert.equal(untimed.dueDate,task.dueDate);assert.equal(taskSpan(untimed).timed,false);
 assert.deepEqual(ganttUnscheduledTasks([untimed],"day"),[untimed]);
 assert.equal(undated.statusId,task.statusId);assert.deepEqual(undated.dependsOnIds,task.dependsOnIds);assert.equal(JSON.stringify(task),before);
});
import { boardDisplay, boardTaskGroups } from "../app/shared-board-display.ts";

test("boards show the latest completions without losing old tasks or manual order when unlimited", () => {
  const done = {id:"done",isDone:1};
  assert.deepEqual(boardDisplay(done), {titleLines:2,visibleCount:5});
  assert.deepEqual(boardDisplay({id:"open",isDone:0}), {titleLines:0,visibleCount:0});
  const tasks = Array.from({length:8}, (_,i)=>({id:`task-${i}`,statusId:"done",position:i,
    completedAt:`2026-10-${String(i+1).padStart(2,"0")}T10:00:00Z`,updatedAt:"2026-11-01T10:00:00Z"}));
  const original = structuredClone(tasks);
  const groups = boardTaskGroups([...tasks,{id:"foreign",statusId:"open"}],done);
  assert.deepEqual(groups.recent.map(task=>task.id),["task-7","task-6","task-5","task-4","task-3"]);
  assert.deepEqual(groups.older.map(task=>task.id),["task-2","task-1","task-0"]);
  assert.deepEqual(tasks,original);
  assert.deepEqual(boardTaskGroups(tasks,{...done,visibleTaskCount:0}).recent,tasks);
  assert.deepEqual(boardTaskGroups(tasks,{...done,visibleTaskCount:100}).older,[]);
  const active=tasks.map(task=>({...task,statusId:"open",completedAt:null,updatedAt:task.completedAt}));
  assert.deepEqual(boardTaskGroups(active,{id:"open",isDone:0,visibleTaskCount:2}).recent.map(task=>task.id),["task-7","task-6"]);
});

test("dated tasks remain available for time planning until both times are assigned, even outside the selected day", () => {
  const tasks = [
    {id:"no-date",statusId:"open"},
    {id:"future-date",statusId:"open",startDate:"2026-10-13",dueDate:"2026-10-13"},
    {id:"partial-time",statusId:"open",startDate:"2026-10-14",dueDate:"2026-10-14",startTime:"09:00"},
    {id:"timed",statusId:"open",startDate:"2026-10-15",dueDate:"2026-10-15",startTime:"09:00",endTime:"10:00"},
    {id:"completed",statusId:"done",dueDate:"2026-10-13"},
  ];
  const {active} = ganttTaskGroups(tasks,[{id:"open",isDone:0},{id:"done",isDone:1}]);
  assert.deepEqual(ganttUnscheduledTasks(active,"day").map(task=>task.id),["no-date","future-date","partial-time"]);
  for (const scale of ["days","weeks","months"]) assert.deepEqual(ganttUnscheduledTasks(active,scale).map(task=>task.id),["no-date"]);
  const scheduled = active.map(task=>task.id==="future-date" ? {...task,startTime:"11:00",endTime:"12:00"} : task);
  assert.deepEqual(ganttUnscheduledTasks(scheduled,"day").map(task=>task.id),["no-date","partial-time"]);
  assert.equal(tasks[1].startTime,undefined);
});

test("Gantt separates completed tasks from every active schedule and restores reopened tasks",()=>{
  const statuses=[{id:"open",isDone:0},{id:"done",isDone:1},{id:"approved",isDone:1}];
  const tasks=[{id:"active",statusId:"open",dueDate:"2026-10-11"},{id:"done",statusId:"done",dueDate:"2030-01-01"},{id:"done-no-date",statusId:"approved"},{id:"unknown-status",statusId:"missing"}];
  const groups=ganttTaskGroups(tasks,statuses);
  assert.deepEqual(groups.active.map(task=>task.id),["active","unknown-status"]);
  assert.deepEqual(groups.completed.map(task=>task.id),["done","done-no-date"]);
  assert.equal(serialDate(ganttRange("2026-10-11","days",groups.active,true).end),"2026-10-13");
  assert.equal(ganttTaskGroups(tasks.map(task=>task.id==="done"?{...task,statusId:"open"}:task),statuses).active.length,3);
  assert.equal(tasks.length,4);
});

test("Gantt keeps all-day dates inclusive and timed spans exact across day boundaries",()=>{
  assert.deepEqual(taskSpan({startDate:"2026-10-10",dueDate:"2026-10-12"}),{start:dateSerial("2026-10-10"),end:dateSerial("2026-10-13"),timed:false});
  const span=taskSpan({startDate:"2026-10-10",dueDate:"2026-10-11",startTime:"23:00",endTime:"01:30"});
  assert.ok(Math.abs((span.end-span.start)*24-2.5)<1e-8);
  assert.equal(taskSpan({dueDate:null}),null);
  assert.equal(taskSpan({dueDate:"2026-10-10"}).end-taskSpan({dueDate:"2026-10-10"}).start,1);
  assert.equal(serialDate(dateSerial("2026-10-25")+1),"2026-10-26");
});
test("Gantt drops snap to minutes or dates and preserve duration including overnight spans",()=>{
  const task={startDate:"2026-10-10",dueDate:"2026-10-11",startTime:"23:00",endTime:"01:30"};
  assert.deepEqual(ganttSchedule(task,dateSerial("2026-10-12")+10.16/24,"day"),{startDate:"2026-10-12",dueDate:"2026-10-12",startTime:"10:15",endTime:"12:45"});
  assert.deepEqual(ganttSchedule(task,dateSerial("2026-10-25"),"weeks"),{startDate:"2026-10-25",dueDate:"2026-10-26",startTime:"23:00",endTime:"01:30"});
  assert.deepEqual(ganttSchedule({startDate:"2026-10-10",dueDate:"2026-10-12"},dateSerial("2026-10-13"),"days"),{startDate:"2026-10-13",dueDate:"2026-10-15",startTime:null,endTime:null});
  assert.deepEqual(ganttSchedule({},dateSerial("2026-10-10")+23.75/24,"day"),{startDate:"2026-10-10",dueDate:"2026-10-11",startTime:"23:45",endTime:"00:45"});
});
test("Gantt creation follows the clicked date or today's time, including midnight",()=>{
  for(const scale of ["days","weeks","months"]){
    assert.deepEqual(ganttCreationSchedule(dateSerial("2026-12-31")+.9,scale,"2026-10-11"),{startDate:"2026-12-31",dueDate:"2026-12-31",startTime:null,endTime:null});
  }
  assert.deepEqual(ganttCreationSchedule(dateSerial("2026-12-31")+10.16/24,"day","2026-10-11"),{startDate:"2026-10-11",dueDate:"2026-10-11",startTime:"10:15",endTime:"11:15"});
  assert.deepEqual(ganttCreationSchedule(dateSerial("2026-12-31")+23.999/24,"day","2026-10-11"),{startDate:"2026-10-11",dueDate:"2026-10-12",startTime:"23:45",endTime:"00:45"});
});
test("Gantt scales and fitted ranges preserve the selected day and bound large projects",()=>{
  const day=dateSerial("2026-10-10");
  assert.deepEqual(ganttRange("2026-10-10","day",[],true),{start:day,end:day+1});
  assert.equal(serialDate(ganttRange("2026-10-10","days",[]).start),"2026-10-05");
  const fit=ganttRange("2026-10-10","months",[{startDate:"2026-01-01",dueDate:"2030-01-01"}],true);
  assert.equal(fit.end-fit.start,366);
});
test("Gantt calendar periods keep equal cell widths with reversible date coordinates",()=>{
  const start=dateSerial("2026-10-01");
  for(const lengths of [[1,1,1],[7,7,7],[5,5,1],[10,10,9],[31,30,31],[30,30,5],[29,30,29],[1/24,1/24,1/24]]){
    let cursor=start;
    const periods=lengths.map(length=>{const period={start:cursor,end:cursor+length};cursor+=length;return period;});
    for(const [index,period] of periods.entries()){
      assert.ok(Math.abs(ganttAxisPosition(periods,period.end)-ganttAxisPosition(periods,period.start)-GANTT_CELL_WIDTH)<1e-6);
      const middle=(period.start+period.end)/2;
      assert.ok(Math.abs(ganttAxisPoint(periods,ganttAxisPosition(periods,middle))-middle)<1e-8);
      assert.ok(Math.abs(ganttAxisPoint(periods,(index+.5)*GANTT_CELL_WIDTH)-middle)<1e-8);
    }
  }
});
test("Gantt resizing keeps inclusive dates and the opposite edge in every date scale",()=>{
  const task={startDate:"2026-10-10",dueDate:"2026-10-12"};
  for(const scale of ["days","weeks","months"]) {
    assert.deepEqual(ganttResizeSchedule(task,dateSerial("2026-10-15"),scale,"end"),{...task,dueDate:"2026-10-14",startTime:null,endTime:null});
    assert.equal(ganttResizeSchedule(task,dateSerial("2026-10-09"),scale,"start").startDate,"2026-10-09");
    assert.equal(ganttResizeSchedule(task,dateSerial("2026-10-16"),scale,"start").startDate,"2026-10-12");
    assert.equal(ganttResizeSchedule(task,dateSerial("2026-10-08"),scale,"end").dueDate,"2026-10-10");
  }
  assert.equal(ganttResizeSchedule({},dateSerial("2026-10-10"),"days","end"),null);
});
test("Gantt timed resizing snaps to 15 minutes, crosses midnight and prevents inverted spans",()=>{
  const task={startDate:"2026-10-10",dueDate:"2026-10-11",startTime:"23:00",endTime:"01:30"};
  assert.deepEqual(ganttResizeSchedule(task,dateSerial("2026-10-11")+2.1/24,"day","end"),{...task,endTime:"02:00"});
  assert.deepEqual(ganttResizeSchedule(task,dateSerial("2026-10-10")+22.6/24,"day","start"),{...task,startTime:"22:30"});
  assert.deepEqual(ganttResizeSchedule(task,dateSerial("2026-10-10"),"day","end"),{...task,dueDate:"2026-10-10",endTime:"23:15"});
  assert.deepEqual(ganttResizeSchedule(task,dateSerial("2026-10-12"),"day","start"),{...task,startDate:"2026-10-11",startTime:"01:15"});
  for(const scale of ["days","weeks","months"]) {
    const shortened=ganttResizeSchedule(task,dateSerial("2026-10-10"),scale,"end");
    assert.deepEqual(shortened,task);
    assert.deepEqual(ganttResizeSchedule(task,dateSerial("2026-10-12"),scale,"start"),task);
    const extended=ganttResizeSchedule(task,dateSerial("2026-10-14"),scale,"end");
    assert.equal(extended.dueDate,"2026-10-13");assert.equal(extended.startTime,"23:00");assert.equal(extended.endTime,"01:30");
    assert.equal(ganttResizeSchedule({...task,endTime:"00:00"},dateSerial("2026-10-12"),scale,"end").dueDate,"2026-10-12");
  }
});
test("The translated reading catalog retains all 24 consistently grouped descriptions",()=>{
  const cards=JSON.parse(readFileSync(new URL("../app/catalog-translations/en.json",import.meta.url),"utf8")).stoicheion;
  assert.equal(Object.keys(cards).length,24);
  for(const [id,card] of Object.entries(cards)) {
    const sections=stoicheionReadingSections(card.content);
    assert.ok(sections.length>=5,id);
    assert.ok(sections.every(section=>section.heading.length<65&&section.body.length>0),id);
  }
});
const source=readFileSync(new URL("../app/stoicheion-data.ts",import.meta.url),"utf8");
const ru=[...source.matchAll(/id: "([^"]+)"[\s\S]*?content: ("(?:[^"\\]|\\.)*")/g)].map(match=>({id:match[1],content:JSON.parse(match[2])}));
test("All 24 authored cards have full, consistently grouped reading sections",()=>{
  assert.equal(ru.length,24);
  for(const card of ru){
    const sections=stoicheionReadingSections(card.content);
    for(const heading of ["Космогонический профиль","Магическая настройка и Корень — ῥίζα","Парадное положение","Перевернутое положение","Практика и магическая поза"]){
      const matching=sections.filter(section=>section.heading===heading);
      assert.equal(matching.length,1,`${card.id}: ${heading}`);
      assert.ok(matching[0].body.length>40,`${card.id}: empty ${heading}`);
    }
    assert.ok(sections.every(section=>section.heading.length<65 && section.body.length>0),card.id);
    const body=sections.map(section=>section.body).join("\n");
    for(const field of ["Заклинание:","Божество:","Центр в теле:","Медитация:","Магическая поза:","Работа с телом:"]){assert.ok(body.includes(field),`${card.id}: ${field}`);}
    for(const line of card.content.split("\n").filter(line=>/^\s*-\s/.test(line))){assert.ok(body.includes(line),`${card.id}: lost authored bullet`);}
  }
});
