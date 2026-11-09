import { GenesisApiError, sharedCollaborationRequest, type SharedTask, type SharedTaskFilter } from './cloud-sync';
import { translateText, type Language } from './i18n';
import { customFieldsError, type SharedCustomField } from './shared-custom-fields';
import type { CalendarMode } from './calendar-data';
import type { CalendarContext } from './calendar-context';
export type ReportMetric={key:string;count:number};
export type ReportEstimateGroup={all:ReportMetric;points:{value:number;estimated:ReportMetric;unestimated:ReportMetric};hours:{value:number;estimated:ReportMetric;unestimated:ReportMetric}};
export type ReportProjectEstimates=ReportEstimateGroup&{projectId:string;members:(ReportEstimateGroup&{id:string})[]};
export type ReportOptions={filter:SharedTaskFilter;from:string;to:string;calendarMode:CalendarMode;calendarContext:CalendarContext;cycleStartStatusIds:string[]};
export type TeamReport={token:string;asOf:string;period:Omit<ReportOptions,'filter'|'cycleStartStatusIds'>;filter:SharedTaskFilter;summary:Record<'all'|'open'|'completed'|'overdue'|'unassigned',ReportMetric>;
 members:{id:string;title:string|null;all:ReportMetric;open:ReportMetric;completed:ReportMetric}[];stages:{id:string;title:string|null;projectId:string|null;seconds:number;tasks:ReportMetric}[];ages:{id:'week'|'month'|'quarter'|'older'|'unknown';tasks:ReportMetric}[];
 cycle:{meanSeconds:number|null;medianSeconds:number|null;eligible:number;known:ReportMetric;unknown:ReportMetric};unknown:ReportMetric;daily:{date:string;coverage:'observed'|'partial'|'unknown'|'future';created:ReportMetric;completed:ReportMetric;reopened:ReportMetric;unknown:ReportMetric}[];
 catalog:{projects:{id:string;spaceId:string;title:string}[];statuses:{id:string;projectId:string;title:string;isDone:boolean;revision:number}[];members:{id:string;title:string}[];customFieldDefinitions:SharedCustomField[]};estimates:{available:boolean;unestimated:number;points:number|null;hours:number|null;projects:ReportProjectEstimates[]}};
export type ReportTaskPage={tasks:SharedTask[];total:number;nextCursor:string|null;asOf:string};
export function loadTeamReport(options:ReportOptions,signal?:AbortSignal){return sharedCollaborationRequest<TeamReport>('/reports',{method:'POST',body:JSON.stringify(options),signal});}
export function checkTeamReport(token:string,signal?:AbortSignal){return sharedCollaborationRequest<{unchanged:true}>('/reports/check',{method:'POST',body:JSON.stringify({token}),signal});}
export function loadReportTasks(token:string,metric:string,cursor:string|null=null,signal?:AbortSignal){return sharedCollaborationRequest<ReportTaskPage>('/reports/tasks',{method:'POST',body:JSON.stringify({token,metric,cursor}),signal});}
export function reportError(reason:unknown,language:Language){
 const code=reason instanceof GenesisApiError?String(reason.payload?.error??reason.message):'';const copy:Record<string,string>={REPORT_CHANGED:'Данные изменились. Обновите отчёт; выбранные условия сохранены.',REPORT_STATUS_CHANGED:'Выберите доступный незавершённый статус для начала цикла.',REPORT_PERIOD_INVALID:'Укажите корректный период не длиннее 10 лет.',REPORT_CONTEXT_INVALID:'Обновите календарный контекст отчёта.',REPORT_TOKEN_INVALID:'Обновите отчёт и повторите переход к задачам.',REPORT_METRIC_INVALID:'Обновите отчёт и повторите переход к задачам.',SHARED_QUERY_CHANGED:'Данные изменились. Обновите отчёт; выбранные условия сохранены.',SHARED_PROJECT_NOT_FOUND:'Нет доступа',SHARED_PROJECT_FORBIDDEN:'Нет доступа',SHARED_SPACE_FORBIDDEN:'Нет доступа'};
 return copy[code]?translateText(copy[code],language):customFieldsError(reason,language)??translateText('Не удалось загрузить отчёт. Условия сохранены; повторите попытку.',language);
}
