import { GenesisApiError, sharedCollaborationRequest } from "./cloud-sync";
import { calendarContext, todayCivilDate, type CalendarContext } from "./calendar-context";
import type { CalendarMode } from "./calendar-data";
import { translateText, type Language } from "./i18n";
import { customFieldsError, type CustomFieldValue } from "./shared-custom-fields";
import type { TemplateApplyOptions } from "./shared-templates";
import { convertTrackerRecurrenceCalendar, DEFAULT_RECURRENCE_CONFIG, type RecurrenceConfig } from "./task-recurrence";

export const automationTriggers={created:"Создание задачи",status:"Смена статуса",assignee:"Смена исполнителя",dueSoon:"Приближение срока",due:"Наступление срока",completed:"Завершение задачи",schedule:"По расписанию"} as const;
export const automationActionTypes={status:"Изменить статус",assignee:"Назначить исполнителя",priority:"Изменить приоритет",addLabels:"Добавить метки",removeLabels:"Убрать метки",due:"Изменить срок",custom:"Изменить пользовательское поле",createTemplate:"Создать задачу из шаблона",notify:"Отправить уведомление"} as const;
export const automationOperators={eq:"Равно",ne:"Не равно",missing:"Не задано",present:"Задано",contains:"Содержит",notContains:"Не содержит",gt:"Больше",gte:"Не меньше",lt:"Меньше",lte:"Не больше"} as const;
export type AutomationTrigger={type:keyof typeof automationTriggers;leadDays?:number;time?:string;recurrence?:RecurrenceConfig;target?:"project"|"tasks"};
export type AutomationCondition={field:"project"|"status"|"label"|"assignee"|"priority"|"custom";fieldId?:string;operator:keyof typeof automationOperators;value:CustomFieldValue|null};
export type AutomationAction={type:keyof typeof automationActionTypes;value?:CustomFieldValue|null;fieldId?:string;mode?:"set"|"shift"|"clear";date?:string|null;offset?:{amount:number;unit:"day"|"month"|"year"};templateId?:string;options?:Partial<TemplateApplyOptions>;recipientIds?:string[];message?:string;unavailable?:boolean};
export type AutomationDefinition={schemaVersion:1;trigger:AutomationTrigger;conditions:AutomationCondition[];actions:AutomationAction[];calendarMode:CalendarMode;calendarContext:CalendarContext};
export type AutomationRule={id:string;projectId:string;ownerId:string|null;title:string;enabled:boolean;deleted:boolean;revision:number;canManage:boolean;definition:AutomationDefinition;createdAt:string;updatedAt:string};
export type AutomationSummary=Omit<AutomationRule,"definition">;
export type AutomationSave={operationId:string;expectedRevision?:number;title?:string;ownerId?:string;enabled?:boolean;deleted?:boolean;definition?:AutomationDefinition};
export type AutomationEffects={updated:boolean;patch:Record<string,unknown>;createdTaskCount:number;notifications:number;notices:string[]};
export type AutomationPreview={matches:boolean;ownerId:string;taskId:string|null;taskRevision:number|null;effects:AutomationEffects|null;dryRun:true};
export type AutomationRun={id:string;ruleId:string;revision:number;taskId:string|null;taskTitle:string|null;state:"pending"|"succeeded"|"skipped"|"cancelled"|"failed";attempts:number;retryCount:number;errorCode:string|null;result:AutomationEffects|null;createdAt:string;finishedAt:string|null};
export function initialAutomation(mode:CalendarMode):AutomationDefinition {
 const context=calendarContext();
 return {schemaVersion:1,trigger:{type:"created"},conditions:[],actions:[{type:"priority",value:1}],calendarMode:mode,calendarContext:context};
}
export function automationSchedule(mode:CalendarMode,context:CalendarContext):RecurrenceConfig {
 const today=todayCivilDate(context);return convertTrackerRecurrenceCalendar({...DEFAULT_RECURRENCE_CONFIG,enabled:true,mode:"classic",pattern:"daily",days:[1],rangeStart:today,rangeEnd:"",calendarContext:context},mode,today);
}
const path=(project:string)=>`/projects/${encodeURIComponent(project)}/automations`;
export function listAutomations(project:string,deleted=false,cursor:string|null=null,signal?:AbortSignal){return sharedCollaborationRequest<{rules:AutomationSummary[];nextCursor:string|null;canCreate:boolean;workerCompletedAt:string|null}>(`${path(project)}?deleted=${deleted}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,{signal});}
export async function loadAutomation(project:string,id:string,signal?:AbortSignal){return (await sharedCollaborationRequest<{rule:AutomationRule}>(`${path(project)}/${encodeURIComponent(id)}`,{signal})).rule;}
export async function saveAutomation(project:string,command:AutomationSave,id?:string){return (await sharedCollaborationRequest<{rule:AutomationRule}>(`${path(project)}${id?`/${encodeURIComponent(id)}`:""}`,{method:id?"PATCH":"POST",body:JSON.stringify(command)})).rule;}
export function previewAutomation(project:string,definition:AutomationDefinition,ownerId:string,taskId:string|null){return sharedCollaborationRequest<AutomationPreview>(`${path(project)}/preview`,{method:"POST",body:JSON.stringify({definition,ownerId,taskId})});}
export function listAutomationRuns(project:string,id:string,cursor:string|null=null,signal?:AbortSignal){return sharedCollaborationRequest<{runs:AutomationRun[];nextCursor:string|null}>(`${path(project)}/${encodeURIComponent(id)}/runs${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,{signal});}
export function retryAutomation(project:string,id:string,runId:string,command:{operationId:string;expectedRevision:number}){return sharedCollaborationRequest(`${path(project)}/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/retry`,{method:"POST",body:JSON.stringify(command)});}
export function automationError(error:unknown,language:Language):string {
 const code=typeof error==='string'?error:error instanceof GenesisApiError?String(error.payload?.error??error.message):error instanceof Error?error.message:"";
 const copy:Record<string,string>={AUTOMATION_INVALID:"Проверьте триггер, условия и действия правила.",AUTOMATION_CONFLICT:"Правило изменилось. Загрузите актуальную версию или сохраните копию.",
 AUTOMATION_STALE:"Запуск отменён: задача, правило или права изменились.",SHARED_PROJECT_NOT_FOUND:"Нет доступа",SHARED_PROJECT_FORBIDDEN:"Нет доступа",SHARED_PROJECTS_DISABLED:"Нет доступа",
 AUTOMATION_CONDITIONS_NOT_MET:"Условия правила не выполнены.",AUTOMATION_LOOP_GUARD:"Цикл остановлен: правило уже выполнялось в этой цепочке.",AUTOMATION_CHAIN_LIMIT:"Достигнут лимит действий в цепочке.",AUTOMATION_RATE_LIMIT:"Достигнут лимит: 100 запусков правила в час.",
 AUTOMATION_RULE_LIMIT:"Достигнут лимит: 100 действующих правил в проекте.",AUTOMATION_EFFECT_LIMIT:"Один запуск может создать не более 50 задач.",AUTOMATION_TASK_TEMPLATE_REQUIRED:"Выберите шаблон задачи.",AUTOMATION_TEMPLATE_BLOCKED:"Шаблон требует сопоставления данных. Проверьте настройки применения.",
 AUTOMATION_TASK_REQUIRED:"Выберите задачу для пробного запуска.",AUTOMATION_DUE_REQUIRED:"Для сдвига сначала нужен срок задачи.",AUTOMATION_SERIES_DUPLICATE:"Создание следующей задачи уже выполняет серия. Повторное создание остановлено.",
 AUTOMATION_RECIPIENT_UNAVAILABLE:"Получатель больше недоступен в проекте.",AUTOMATION_RETRY_UNAVAILABLE:"Этот запуск нельзя повторить. Проверьте версию и состояние правила.",
 AUTOMATION_OPERATION_REUSED:"Эта операция уже использована. Обновите данные и повторите.",AUTOMATION_OPERATION_REQUIRED:"Эта операция уже использована. Обновите данные и повторите.",
 BACKGROUND_RETRY:"Временная ошибка. Фоновый обработчик повторит запуск.",BACKGROUND_LEASE_EXPIRED:"Обработчик не подтвердил запуск. Доступен ручной повтор.",
 };
 return translateText(copy[code]??customFieldsError(new Error(code),language)??"Не удалось выполнить правило. Проверьте права, поля и утверждения, затем повторите.",language);
}
