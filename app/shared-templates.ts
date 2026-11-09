import { GenesisApiError } from "./cloud-sync";
import { translateText, type Language } from "./i18n";
import type { CalendarContext } from "./calendar-context";
import type { CalendarMode } from "./calendar-data";
import { customFieldsError, type CustomFieldType, type CustomFieldValues, type SharedCustomField } from "./shared-custom-fields";

export type TemplateOffset={amount:number;unit:"day"|"month"|"year"};
export type TemplateField={key:string;projectKey:string|null;title:string;type:CustomFieldType;options:SharedCustomField["options"];position:number;required:boolean;showCard:boolean;showList:boolean};
export type TemplateStatus={key:string;title:string;isDone:boolean;color:string;taskTitleLines:number;visibleTaskCount:number};
export type TemplateProject={key:string;parentKey:string|null;title:string;description:string;layout:"list"|"board";kind:"project"|"task-list";statuses:TemplateStatus[];
 categories:{key:string;title:string;color:string}[];labelKeys:string[];tags:string[];boardStatusKey:string|null};
export type TemplateChecklist={key:string;title:string;items:{key:string;title:string;assigneeId:string|null;due:TemplateOffset|null;linkedTaskKey:string|null}[]};
export type TemplateTask={key:string;projectKey:string;parentKey:string|null;title:string;description:string;entryType:"task"|"meeting"|"event";statusKey:string;categoryKey:string|null;priority:number;tags:string[];
 storyPoints?:number|null;estimateHours?:number|null;
 assigneeId:string|null;approvalRequired:boolean;approverIds:string[];labelKeys:string[];dependsOnKeys:string[];due:TemplateOffset|null;start:TemplateOffset|null;startTime:string|null;endTime:string|null;checklists:TemplateChecklist[];customValues:CustomFieldValues};
export type TemplateManifest={schemaVersion:1;kind:"task"|"project";calendarMode:CalendarMode;calendarContext:CalendarContext;projects:TemplateProject[];labels:{key:string;title:string;color:string}[];fields:TemplateField[];tasks:TemplateTask[]};
export type TemplateIssue={code:string;taskKey?:string;projectKey?:string;fieldKey?:string;fieldRef?:string;itemKey?:string;title?:string;date?:string;count?:number;option?:keyof typeof templateOptions;sourceUserId?:string};
export type SharedTemplateSummary={id:string;spaceId:string|null;projectId:string|null;ownerId:string|null;title:string;kind:"task"|"project";revision:number;deleted:boolean;system:boolean;canEdit?:boolean;projectCount:number;taskCount:number;updatedAt:string|null};
export type SharedTemplate=SharedTemplateSummary & {manifest:TemplateManifest;notices:TemplateIssue[];libraryPermissions?:{editTasks:boolean;createProjects:boolean}|null};
export type TemplateDestinationProject={id:string;title:string;archivedAt?:string|null;canWrite:boolean};
export const templateOptions={descriptions:"Описания",tags:"Теги",labels:"Метки",customFields:"Пользовательские поля",assignees:"Исполнители",checklists:"Чек-листы",subtasks:"Подзадачи",dependencies:"Зависимости",dates:"Сроки и время",approvals:"Подтверждения выполнения"} as const;
export type TemplateApplyOptions={spaceId:string;projectId:string|null;parentProjectId:string|null;boardStatusId?:string|null;anchorDate:string;title?:string;language:Language;
 include?:Partial<Record<keyof typeof templateOptions,boolean>>;statusMap?:Record<string,string|null>;categoryMap?:Record<string,string|null>;fieldMap?:Record<string,string|null>;
 optionMap?:Record<string,Record<string,string|null>>;memberMap?:Record<string,string|null>;fieldValues?:Record<string,CustomFieldValues>};
export type TemplatePlannedTask={key:string;projectKey:string;parentKey:string|null;title:string;description:string;dueDate:string|null;startDate:string|null;startTime:string|null;endTime:string|null;customValues:CustomFieldValues;assigneeId:string|null;approverIds:string[];statusRef:string;checklists:unknown[];dependsOnKeys:string[]};
export type TemplatePreview={templateId:string;kind:"task"|"project";revision:number;calendarMode:CalendarMode;calendarContext:CalendarContext;fingerprint:string;options:TemplateApplyOptions;
 projects:TemplateProject[];tasks:TemplatePlannedTask[];newFields:(TemplateField&{ref:string;sourceKey:string})[];fields:SharedCustomField[];sourceFields:TemplateField[];fieldMappings:Record<string,Record<string,string|null>>;
 members:{id:string;title:string;role:string}[];statuses:{id:string;title:string;isDone:boolean|number}[];categories:{id:string;title:string}[];notices:TemplateIssue[];blockers:TemplateIssue[];canApply:boolean};
export type TemplateReceipt={operationId:string;templateId:string;rootProjectId:string;rootTaskId:string|null;projectCount:number;taskCount:number;projectIds:Record<string,string>;taskIds:Record<string,string>;notices:TemplateIssue[]};
export type TemplateSave={operationId:string;projectId:string;title:string;expectedRevision?:number;manifest?:TemplateManifest;deleted?:boolean;cloneTemplateId?:string;
 sourceProjectId?:string;sourceTaskId?:string;capture?:{calendarMode:CalendarMode;calendarContext:CalendarContext;anchorDate:string}};

export function templateIssueText(issue:TemplateIssue,language:Language):string {
 const copy:Record<string,string>={
  TEMPLATE_PREVIEW_CHANGED:"Шаблон или назначение изменились. Обновите предпросмотр; черновик сохранён.",TEMPLATE_CONFLICT:"Шаблон изменился. Загрузите актуальную версию или сохраните копию.",TEMPLATE_LIST_CHANGED:"Библиотека изменилась. Обновите список шаблонов.",
  TEMPLATE_SOURCE_SCOPE_UNAVAILABLE:"Один из исходных проектов больше недоступен.",TEMPLATE_UNAVAILABLE:"Шаблон больше недоступен.",TEMPLATE_FORBIDDEN:"Нет доступа",SHARED_PROJECT_FORBIDDEN:"Нет доступа",SHARED_SPACE_FORBIDDEN:"Нет доступа",SHARED_PROJECT_NOT_FOUND:"Нет доступа",
  TEMPLATE_FIELD_VALUE_UNMAPPED:"Сопоставьте поле с полем назначения.",FIELD_NOT_MAPPED:"Сопоставьте поле с полем назначения.",TEMPLATE_FIELD_MAPPING_COLLISION:"Несколько полей сопоставлены с одним. Выберите разные поля.",TEMPLATE_FIELD_CREATE_FORBIDDEN:"Создавать поля может владелец или администратор пространства.",
  APPROVER_NOT_AVAILABLE:"Участник для подтверждения недоступен. Выберите замену или отключите перенос подтверждений.",TEMPLATE_APPROVERS_REQUIRED:"Выберите участников для подтверждения.",ASSIGNEE_NOT_AVAILABLE:"Исполнитель недоступен в назначении. Задача останется без исполнителя.",
  TEMPLATE_DATE_CLAMPED:"Дата сдвинута на последний день периода.",TEMPLATE_DATE_OUTSIDE_RANGE:"Дата вне поддерживаемого диапазона 1900–2100.",
  INVALID_CALENDAR_TIME_ZONE:"Введите действительный часовой пояс IANA, например Europe/Moscow. Черновик сохранён.",
  TEMPLATE_CATEGORY_CREATE_FORBIDDEN:"Нет доступа",
  TASK_COMPLETION_RESET:"Отметки выполнения и подтверждения будут сброшены.",CHECKLIST_COMPLETION_RESET:"Отметки выполнения и подтверждения будут сброшены.",APPROVAL_CONFIRMATIONS_RESET:"Отметки выполнения и подтверждения будут сброшены.",PROJECT_ARCHIVE_RESET:"Новый проект будет действующим.",
  EXTERNAL_DEPENDENCIES_EXCLUDED:"Внешние связи не переносятся.",EXTERNAL_CHECKLIST_LINK_EXCLUDED:"Внешние связи не переносятся.",CHECKLIST_LINK_EXCLUDED:"Внешние связи не переносятся.",DEPENDENCIES_EXCLUDED:"Внешние связи не переносятся.",
  PRIVATE_CONTENT_EXCLUDED:"Файлы, изображения и обсуждения не переносятся.",PROJECT_IMAGE_EXCLUDED:"Файлы, изображения и обсуждения не переносятся.",BOARD_IMAGE_EXCLUDED:"Файлы, изображения и обсуждения не переносятся.",
  LABEL_NOT_AVAILABLE:"Метка недоступна в назначении.",CATEGORY_NOT_AVAILABLE:"Категория недоступна в назначении.",STATUS_MAPPED:"Выбран доступный незавершённый статус.",TEMPLATE_OPEN_STATUS_REQUIRED:"Добавьте незавершённый статус в назначение.",
  ARCHIVED_FIELD_EXCLUDED:"Архивные поля и задачи не переносятся.",ARCHIVED_TASKS_EXCLUDED:"Архивные поля и задачи не переносятся.",UNAVAILABLE_FIELD_VALUES_EXCLUDED:"Архивные поля и задачи не переносятся.",FORMER_APPROVER_UNAVAILABLE:"Выберите участников для подтверждения.",
  TEMPLATE_RESOURCE_LIMIT:"Применение превысит доступный лимит проектов или задач.",LABEL_LIMIT:"Достигнут лимит: 50 меток в пространстве.",TEMPLATE_LIMIT:"Достигнут лимит: 500 шаблонов в пространстве.",
  TEMPLATE_APPLY_BLOCKED:"Исправьте отмеченные пункты и обновите предпросмотр.",TEMPLATE_OPERATION_REUSED:"Эта операция уже использована. Обновите предпросмотр и повторите.",
  TEMPLATE_INVALID:"Проверьте структуру, сроки и связи шаблона.",TEMPLATE_REFERENCE_INVALID:"Проверьте структуру, сроки и связи шаблона.",TASK_RELATION_CYCLE:"Связи задач образуют цикл. Измените родителя или зависимости.",
  INVALID_TASK_RANGE:"Начало задачи должно быть не позже срока.",INVALID_TASK_TIME_RANGE:"Время окончания должно быть позже начала.",TASK_DATE_REQUIRED:"Укажите дату для времени задачи.",
 };
 if(issue.code==='OPTION_EXCLUDED'&&issue.option)return translateText(templateOptions[issue.option],language)+": "+translateText("Не переносится",language);
 if(issue.code==='SUBTASKS_EXCLUDED')return translateText("Подзадачи",language)+": "+translateText("Не переносится",language);
 const custom=customFieldsError(new Error(issue.code),language);
 return copy[issue.code]?translateText(copy[issue.code],language):custom??translateText("Проверьте структуру, сроки и связи шаблона.",language);
}
export function templateError(error:unknown,language:Language):string {
 if(!(error instanceof GenesisApiError))return translateText("Не удалось выполнить действие. Черновик сохранён; повторите попытку.",language);
 const code=String(error.payload?.error??error.message);
 return code?templateIssueText({code},language):translateText("Не удалось выполнить действие. Черновик сохранён; повторите попытку.",language);
}
export function templateFieldDefinition(field:TemplateField,id=field.key):SharedCustomField {
 return {id,spaceId:"",projectId:field.projectKey,title:field.title,type:field.type,options:field.options,position:field.position,required:field.required,
  showCard:field.showCard,showList:field.showList,archived:false,predecessorId:null,revision:0};
}
