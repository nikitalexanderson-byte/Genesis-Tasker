"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {loadSharedTask,type SharedProjectSnapshot,type SharedTask} from './cloud-sync';
import {formatCalendarDateValue} from './calendar-data';
import {translateText,type Language} from './i18n';
import {planningAccessLost,planningText,type SharedSprint} from './shared-planning';
import {SharedEstimateValues} from './SharedTaskEstimates';
import {DialogCloseButton} from './DialogCloseButton';
import {IconActionButton} from './IconActionButton';
import {sprintReportText,type SprintReportCopyKey} from './sprint-report-copy';
import {checkSprintReport,loadSprintReport,loadSprintSources,sprintReportCode,type SprintMetric,type SprintReport,type SprintReportUnit,type SprintSeriesPoint,type SprintSourceItem,type SprintSourcePage,type SprintSourceQuery,type SprintSourceTask} from './shared-sprint-reports';
import './shared-sprint-reports.css';

const plotValue=(metric:SprintMetric|undefined)=>metric?.value!=null&&(metric.unestimated??0)===0?metric.value:null;
type PlotPoint={x:number;y:number;connect:boolean};
function stepPath(points:(PlotPoint|null)[]):string{
 let path='',previous:PlotPoint|null=null;
 for(const point of points){if(!point){previous=null;continue;}path+=!previous||!point.connect?`M${point.x},${point.y}`:`H${point.x}V${point.y}`;previous=point;}
 return path;
}
function FlowChart({series,title,label,language,statuses,read,dateLabel,stack=false}:{series:SprintSeriesPoint[];title:string;label:string;language:Language;statuses:{id:string;title:string;color:string}[];read:(point:SprintSeriesPoint)=>SprintMetric|undefined;dateLabel:(date:string)=>string;stack?:boolean}){
 const id=useId(),figure=useRef<HTMLElement>(null),[measured,setMeasured]=useState(620),height=240,left=64,right=16,top=16,bottom=16,number=new Intl.NumberFormat(language,{maximumFractionDigits:2});
 useEffect(()=>{if(!figure.current)return;const observer=new ResizeObserver(entries=>{const next=Math.floor(entries[0].contentRect.width);if(next>0)setMeasured(previous=>previous===next?previous:next);});observer.observe(figure.current);return()=>observer.disconnect();},[]);
 const width=Math.max(260,measured);
 const times=series.map(point=>Date.parse(point.at)),from=Math.min(...times),to=Math.max(...times),values=series.map(point=>plotValue(stack?point.scope:read(point))),known=values.filter((value):value is number=>value!==null);
 const max=Math.max(1,...known),axisNumber=max>=10000?new Intl.NumberFormat(language,{notation:'compact',maximumFractionDigits:1}):number,x=(index:number)=>from===to?(width+left-right)/2:left+(times[index]-from)/(to-from)*(width-left-right),y=(value:number)=>height-bottom-value/max*(height-top-bottom);
 const points=series.map((point,index)=>values[index]===null?null:{x:x(index),y:y(values[index]!),connect:point.connectPrevious});
 const groups:number[][]=[];
 if(stack){let group:number[]=[];series.forEach((point,index)=>{const valid=values[index]!==null&&statuses.every(status=>plotValue(point.statuses[status.id]??{tasks:0,value:0,knownValue:0,unestimated:0})!==null);if(!valid){if(group.length)groups.push(group);group=[];return;}if(!point.connectPrevious&&group.length){groups.push(group);group=[];}group.push(index);});if(group.length)groups.push(group);}
 const stackedPath=(group:number[],statusIndex:number)=>{
  const low=(index:number)=>statuses.slice(0,statusIndex).reduce((sum,status)=>sum+(series[index].statuses[status.id]?.value??0),0),high=(index:number)=>low(index)+(series[index].statuses[statuses[statusIndex].id]?.value??0);
  let path=`M${x(group[0])},${y(high(group[0]))}`;
  for(let i=1;i<group.length;i++)path+=`H${x(group[i])}V${y(high(group[i]))}`;
  path+=`L${x(group.at(-1)!)},${y(low(group.at(-1)!))}`;
  for(let i=group.length-1;i>0;i--)path+=`V${y(low(group[i-1]))}H${x(group[i-1])}`;
  return path+'Z';
 };
 return <figure ref={figure} className={`sprint-flow-chart${stack?' sprint-flow-chart-wide':''}`}><figcaption id={id}>{title} · {label}</figcaption>
  {!known.length?<p>{translateText('Нет данных',language)}</p>:<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id}>
   {[0,0.5,1].map(fraction=><g key={fraction}><path className="sprint-chart-grid" d={`M${left},${y(max*fraction)}H${width-right}`}/><text x={left-8} y={y(max*fraction)+4} textAnchor="end">{axisNumber.format(max*fraction)}</text></g>)}
   {stack?statuses.map((status,index)=><g key={status.id} style={{color:status.color}}>{groups.map((group,i)=><path key={i} d={stackedPath(group,index)} fill="currentColor" fillOpacity=".6" stroke="var(--paper)" strokeWidth="1"/> )}</g>):<><path className="sprint-chart-line" d={stepPath(points)}/>{points.map((point,index)=>point?<circle key={index} cx={point.x} cy={point.y} r="3" fill="currentColor"/>:null)}</>}
  </svg>}
  {known.length?<div className="sprint-chart-dates"><time dateTime={series[0].at}>{dateLabel(series[0].date)}</time>{from!==to?<time dateTime={series.at(-1)!.at}>{dateLabel(series.at(-1)!.date)}</time>:null}</div>:null}
  {stack?<ul className="sprint-chart-legend">{statuses.map(status=><li key={status.id}><span aria-hidden="true" style={{background:status.color}}/><span data-no-translate>{status.title}</span></li>)}</ul>:null}
 </figure>;
}

type Sources={query:SprintSourceQuery;page:SprintSourcePage|null};
export function SharedSprintReport({context,sprint,language,verified,disabled,onAccessLost,onOpenTask}:{context:SharedProjectSnapshot;sprint:SharedSprint;language:Language;verified:boolean;disabled:boolean;onAccessLost:()=>void;onOpenTask:(task:SharedTask)=>Promise<void>}){
 const project=context.project.id,t=(key:SprintReportCopyKey)=>sprintReportText(key,language),g=(value:string)=>translateText(value,language),p=(key:'count'|'points'|'hours'|'unit'|'unestimated')=>planningText(key,language);
 const [expanded,setExpanded]=useState(false),[unit,setUnit]=useState<SprintReportUnit>(sprint.estimateUnit??'points'),[report,setReport]=useState<SprintReport|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[invalidated,setInvalidated]=useState(false),[online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine),[sources,setSources]=useState<Sources|null>(null),[wipStatus,setWipStatus]=useState('all');
 const [contextWasVerified,setContextWasVerified]=useState(verified);
 if(contextWasVerified!==verified){setContextWasVerified(verified);if(!verified){setBusy(false);setInvalidated(true);setSources(null);}}
 const generation=useRef(0),request=useRef<AbortController|null>(null),sourceHeading=useRef<HTMLHeadingElement>(null),lost=useRef(onAccessLost);
 useEffect(()=>{lost.current=onAccessLost;},[onAccessLost]);
 const stale=invalidated||!verified||Boolean(report&&report.sprint.revision<sprint.revision),blocked=busy||disabled||!online,ready=Boolean(report)&&!blocked&&!stale;
 const discard=()=>{generation.current++;request.current?.abort();setBusy(false);setReport(null);setSources(null);setInvalidated(true);};
 const handle=(reason:unknown)=>{
  if(reason instanceof DOMException&&reason.name==='AbortError')return;
  setError(reason);
  if(planningAccessLost(reason)){discard();lost.current();}
  else if(sprintReportCode(reason)==='REPORT_CHANGED')discard();
 };
 const refresh=async(nextUnit=unit)=>{
  if(disabled||!navigator.onLine)return;request.current?.abort();const controller=new AbortController(),version=++generation.current;request.current=controller;
  setBusy(true);setError(null);setReport(null);setSources(null);setInvalidated(false);
  try{const result=await loadSprintReport(project,sprint.id,nextUnit,controller.signal);if(version===generation.current)setReport(result);}
  catch(reason){if(version===generation.current)handle(reason);}finally{if(version===generation.current)setBusy(false);}
 };
 const choose=async(query:SprintSourceQuery,more=false)=>{
  if(!report||!ready)return;request.current?.abort();const controller=new AbortController(),version=++generation.current;request.current=controller;
  const previous=more?sources?.page:null;setBusy(true);setError(null);if(!more)setSources({query,page:null});
  try{
   const page=await loadSprintSources(project,sprint.id,report.token,query,more?previous?.nextCursor??undefined:undefined,controller.signal);
   if(version===generation.current){setSources({query,page:{...page,items:[...(previous?.items??[]),...page.items]}});if(!more)requestAnimationFrame(()=>sourceHeading.current?.focus());}
  }catch(reason){if(version===generation.current)handle(reason);}finally{if(version===generation.current)setBusy(false);}
 };
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>{if(!verified){generation.current++;request.current?.abort();}},[verified]);
 useEffect(()=>{
  const invalidate=()=>{generation.current++;request.current?.abort();setBusy(false);setInvalidated(true);setReport(null);setSources(null);};
  const connection=()=>{setOnline(navigator.onLine);if(!navigator.onLine){generation.current++;request.current?.abort();setBusy(false);setInvalidated(true);setSources(null);}};
  window.addEventListener('online',connection);window.addEventListener('offline',connection);window.addEventListener('genesis:shared-updates',invalidate);
  return()=>{window.removeEventListener('online',connection);window.removeEventListener('offline',connection);window.removeEventListener('genesis:shared-updates',invalidate);};
 },[]);
 useEffect(()=>{
  if(!report||!expanded||stale)return;let active=true,checking=false;const controller=new AbortController();
  const verify=async()=>{
   if(!active||checking||document.visibilityState!=='visible'||!navigator.onLine)return;checking=true;
   try{await checkSprintReport(project,sprint.id,report.token,controller.signal);}
   catch(reason){if(active&&!(reason instanceof DOMException&&reason.name==='AbortError')){generation.current++;request.current?.abort();setBusy(false);setSources(null);setInvalidated(true);if(planningAccessLost(reason)){setReport(null);lost.current();}else{if(sprintReportCode(reason)==='REPORT_CHANGED')setReport(null);setError(reason);}}}
   finally{checking=false;}
  };
  const interval=setInterval(()=>void verify(),30000),focus=()=>void verify();window.addEventListener('focus',focus);
  return()=>{active=false;controller.abort();clearInterval(interval);window.removeEventListener('focus',focus);};
 },[report,expanded,stale,project,sprint.id]);
 const openSource=async(task:SprintSourceTask)=>{
  if(!ready)return;const version=++generation.current;setBusy(true);setError(null);
  try{const fresh=await loadSharedTask(task.projectId,task.id,task.archived);if(version===generation.current)await onOpenTask(fresh);}
  catch(reason){if(version===generation.current)handle(reason);}finally{if(version===generation.current)setBusy(false);}
 };
 const number=new Intl.NumberFormat(language,{maximumFractionDigits:2}),unitLabel=p(unit==='tasks'?'count':unit),flow=report?.flow,summary=flow?.available?flow.summary:null;
 const metricValue=(value:SprintMetric)=>value.value===null||value.tasks!==null&&value.tasks>0&&value.unestimated===value.tasks?'—':number.format(value.value);
 const stamp=(value:string)=>{const instant=new Date(value);return Number.isFinite(instant.getTime())?new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short',timeZone:report?.launch.calendarContext.timeZone??sprint.calendarContext.timeZone}).format(instant):t('unknown');};
 const date=(value:string)=>formatCalendarDateValue(value,report?.launch.calendarMode??sprint.calendarMode,false,report?.launch.calendarContext??sprint.calendarContext);
 const statusIds=[...new Set(flow?.available?flow.series.flatMap(point=>Object.keys(point.statuses)):[])].sort((a,b)=>(report?.statuses.find(status=>status.id===a)?.position??Number.MAX_SAFE_INTEGER)-(report?.statuses.find(status=>status.id===b)?.position??Number.MAX_SAFE_INTEGER)),boardColors=statusIds.map(id=>report?.statuses.find(status=>status.id===id)?.color?.toLowerCase()??''),palette=['var(--teal)','var(--gold)','var(--ink-soft)','var(--ink)'];
 const statuses=statusIds.map((id,index)=>({id,title:report?.statuses.find(status=>status.id===id)?.title??t('historicalStatus'),color:boardColors[index]&&boardColors.filter(color=>color===boardColors[index]).length===1?boardColors[index]:palette[index%palette.length]}));
 const wipIds=[...new Set(flow?.available?flow.series.flatMap(point=>Object.keys(point.wipStatuses)):[])].sort((a,b)=>statusIds.indexOf(a)-statusIds.indexOf(b));
 const emptyMetric=(point:SprintSeriesPoint):SprintMetric=>({value:point.coverage==='observed'?0:null,knownValue:point.coverage==='observed'?0:null,tasks:point.coverage==='observed'?0:null,unestimated:0});
 const readWip=(point:SprintSeriesPoint)=>wipStatus==='all'?point.wip:point.wipStatuses[wipStatus]??emptyMetric(point);
 const metric=(key:string,label:string,value:SprintMetric)=><div key={key}><dt>{label}</dt><dd><button type="button" className="report-metric" data-sprint-metric={key} disabled={!ready} aria-pressed={sources?.query.kind==='tasks'&&sources.query.metric===key} aria-label={`${label}: ${metricValue(value)==='—'?t('unknown'):metricValue(value)}`} onClick={()=>void choose({kind:'tasks',metric:key})}>{metricValue(value)}</button><small>{p('count')}: {value.tasks===null?'—':number.format(value.tasks)}{value.unestimated?` · ${p('unestimated')}: ${number.format(value.unestimated)}`:''}{value.value!==null&&value.unestimated&&value.unestimated!==value.tasks?` · ${t('knownPart')}`:''}</small></dd></div>;
 const sourceRow=(item:SprintSourceItem,index:number)=>{
  const task=item.task??(item.id&&item.title&&item.projectId?item as SprintSourceTask:undefined),label=item.completionCarry?t('carryEvent'):item.action==='sprint.started'?t('startEvent'):item.action==='sprint.completed'?t('closeEvent'):item.kind==='added'?t('added'):item.kind==='removed'||item.leftScope?t('removed'):item.kind==='estimate'?t('estimateDelta'):t('stateEvent');
  return <li key={item.sourceId??item.id??index}><header>{task?<button type="button" className="sprint-source-task" disabled={!ready} onClick={()=>void openSource(task)} data-no-translate>{task.title}</button>:<strong>{item.unavailable?t('unavailable'):label}</strong>}{item.at?<time dateTime={item.at}>{stamp(item.at)}</time>:null}</header>
   {task?<p>{label}{item.observed?<> · {g('Статус')}: <span data-no-translate>{report?.statuses.find(status=>status.id===item.observed?.statusId)?.title??t('historicalStatus')}</span> · {g('Завершено')}: {g(item.observed.done?'Да':'Нет')}{!item.observed.active?` · ${g('Архив')}`:''}</>:null}</p>:null}
   {item.observed?<p>{item.observed.active&&item.observed.sprintId===sprint.id?<>{planningText('sprint',language)}: <span data-no-translate>{report?.sprint.title??sprint.title}</span></>:t('outside')}</p>:null}
   {item.kind==='estimate'&&item.before&&item.after?<div className="sprint-source-comparison"><div><span>{t('before')}</span><SharedEstimateValues task={item.before} language={language}/></div><div><span>{t('after')}</span><SharedEstimateValues task={item.after} language={language}/></div></div>:item.observed||item.after||item.before?<SharedEstimateValues task={(item.observed??item.after??item.before)!} language={language}/>:null}
  </li>;
 };
 return <details className="shared-sprint-report" data-sprint-report-panel open={expanded} onToggle={event=>{if(event.target!==event.currentTarget)return;setExpanded(event.currentTarget.open);if(event.currentTarget.open){if(!report&&!busy)void refresh();}else{generation.current++;request.current?.abort();setBusy(false);setReport(null);setSources(null);setInvalidated(false);}}}>
  <summary>{t('heading')}</summary>{expanded?<div>
   <div className="shared-planning-actions"><label>{t('unit')}<select data-sprint-report-unit value={unit} disabled={blocked} onChange={event=>{const next=event.target.value as SprintReportUnit;setUnit(next);void refresh(next);}}>{(['tasks','points','hours'] as const).map(value=><option value={value} key={value}>{p(value==='tasks'?'count':value)}</option>)}</select></label><IconActionButton icon="map-refresh" label={g('Обновить')} disabled={blocked} onClick={()=>void refresh()}/></div>
   {!online?<p role="status">{t('offline')}</p>:stale?<p role="status">{t('stale')}</p>:null}
   {error&&sprintReportCode(error)!=='REPORT_CHANGED'?<p role="alert">{sprintReportCode(error)==='SPRINT_REPORT_TOO_LARGE'?t('tooLarge'):sprintReportCode(error)==='SPRINT_REPORT_HISTORY_INVALID'?t('partial'):g('Не удалось загрузить данные')}</p>:null}
   {busy?<p role="status">{g('Загрузка…')}</p>:null}
   {report?<><p className="shared-planning-period">{g('Состояние на')} <time dateTime={report.asOf}>{stamp(report.asOf)}</time><span data-no-translate>{report.launch.calendarContext.timeZone}</span></p>
    {!flow?.available?<p>{report.sprint.state==='planning'?t('notStarted'):flow?.reason==='terminal-observation-missing'?t('missingEnd'):t('missingStart')}</p>:summary?<>
     {!flow.historyComplete?<p className="sprint-report-coverage" role="status">{t('partial')}</p>:null}
     <dl className="sprint-report-metrics">{metric('plan',t('plan'),summary.plan)}{metric('alreadyDone',t('alreadyDone'),summary.alreadyDone)}{metric('delivered',t('delivered'),summary.delivered)}{metric('remaining',t(flow.terminal?'closedRemaining':'remaining'),summary.remaining)}{metric('carried',t('carried'),summary.carried)}{metric('scope',t('scope'),summary.scope)}</dl>
     <dl className="sprint-scope-deltas">{(['added','removed'] as const).map(key=><div key={key}><dt>{t(key)}</dt><dd>{metricValue({...summary[key],value:summary.scopeChangeCoverage==='observed'?summary[key].knownValue:null})}<small>{p('count')}: {number.format(summary[key].tasks??0)} · {p('unestimated')}: {number.format(summary[key].unestimated??0)}</small></dd></div>)}<div><dt>{t('estimateDelta')}</dt><dd>{summary.scopeChangeCoverage==='observed'?number.format(summary.estimateDelta):'—'}<small>{t('unestimatedDelta')}: {summary.scopeChangeCoverage==='observed'?number.format(summary.unestimatedDelta):'—'}</small></dd></div></dl>
     <div className="shared-planning-actions"><IconActionButton icon="history" label={t('events')} disabled={!ready} data-sprint-events aria-pressed={sources?.query.kind==='events'&&!sources.query.date} onClick={()=>void choose({kind:'events'})}/><IconActionButton icon="list" label={t('changes')} disabled={!ready} data-sprint-changes aria-pressed={sources?.query.kind==='changes'} onClick={()=>void choose({kind:'changes'})}/></div>
     <p>{t('daily')}</p><div className="shared-planning-actions sprint-wip-controls"><label>{t('wip')} · {g('Статус')}<select data-sprint-wip-status value={wipStatus} disabled={blocked} onChange={event=>setWipStatus(event.target.value)}><option value="all">{t('allStatuses')}</option>{wipIds.map(id=><option key={id} value={id}>{statuses.find(status=>status.id===id)?.title??t('historicalStatus')}</option>)}</select></label></div><div className="sprint-report-charts"><FlowChart series={flow.series} title={t('burndown')} label={unitLabel} language={language} statuses={statuses} read={point=>point.remaining} dateLabel={date}/><FlowChart series={flow.series} title={t('wip')} label={unitLabel} language={language} statuses={statuses} read={readWip} dateLabel={date}/><FlowChart series={flow.series} title={t('flow')} label={unitLabel} language={language} statuses={statuses} read={point=>point.scope} dateLabel={date} stack/></div>
     {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table region must be keyboard reachable. */}
     <details className="sprint-report-data"><summary>{t('data')} · {unitLabel}</summary><div className="sprint-series-scroll" tabIndex={0} role="region" aria-label={t('heading')}><table><thead><tr><th scope="col">{g('Дата')}</th><th scope="col">{t('scope')}</th><th scope="col">{t('burndown')}</th><th scope="col">{g('Завершено')}</th><th scope="col">{t('wip')}</th>{statuses.map(status=><th scope="col" key={status.id} data-no-translate>{status.title}</th>)}<th scope="col">{t('sources')}</th></tr></thead><tbody>{flow.series.map((point,index)=><tr key={index}><th scope="row"><time dateTime={point.at}>{date(point.date)}</time>{point.sourceKind==='current-snapshot'?<small>{t('snapshot')}</small>:point.coverage==='partial'||point.gapWithinBucket?<small>{t('knownPart')}</small>:null}</th><td>{metricValue(point.scope)}</td><td>{metricValue(point.remaining)}</td><td>{metricValue(point.done)}</td><td>{metricValue(readWip(point))}</td>{statuses.map(status=><td key={status.id}>{metricValue(point.statuses[status.id]??emptyMetric(point))}</td>)}<td><IconActionButton icon="history" label={`${t('events')} · ${date(point.date)}`} disabled={!ready} onClick={()=>void choose({kind:'events',date:point.date})}/></td></tr>)}</tbody></table></div></details>
    </>:null}
   </>:null}
   {sources?<section className="sprint-report-sources" aria-labelledby="sprint-sources-heading"><header><h3 id="sprint-sources-heading" tabIndex={-1} ref={sourceHeading}>{t(sources.query.kind==='events'?'events':sources.query.kind==='changes'?'changes':'sources')}</h3><DialogCloseButton className="icon-button" onClick={()=>{generation.current++;request.current?.abort();setBusy(false);setSources(null);}}/></header>
    {sources.page?<><p>{number.format(sources.page.items.length)} / {number.format(sources.page.total)}</p>{sources.page.unavailable?<p>{t('unavailable')} · {number.format(sources.page.unavailable)}</p>:null}<ul>{sources.page.items.map(sourceRow)}</ul>{!sources.page.items.length?<p>{t('empty')}</p>:null}{sources.page.nextCursor?<button type="button" className="secondary-button" disabled={!ready} onClick={()=>void choose(sources.query,true)}>{g('Показать ещё')}</button>:null}</>:null}
   </section>:null}
  </div>:null}
 </details>;
}
