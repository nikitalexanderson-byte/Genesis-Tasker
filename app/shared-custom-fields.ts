import recoveryCopy from "./custom-field-recovery-translations.json";
import { GenesisApiError } from "./cloud-sync";
import { workflowError } from './workflow-copy';
import { translateText as t, runtimeLocale, type Language } from "./i18n";
export const customFieldRecoveryText=(source:keyof typeof recoveryCopy.ru,language:Language=runtimeLocale().split("-")[0] as Language)=>recoveryCopy[language][source];

export type CustomFieldType = "text"|"number"|"date"|"select"|"multi"|"checkbox"|"url";
export type CustomFieldValue = string|number|boolean|string[];
export type CustomFieldValues = Record<string,CustomFieldValue|null>;
export type SharedCustomField = {id:string;spaceId:string;projectId:string|null;title:string;type:CustomFieldType;
  options:{id:string;title:string;archived:boolean}[];position:number;required:boolean;showCard:boolean;showList:boolean;
  archived:boolean;predecessorId:string|null;revision:number};
export type CustomFieldDraft = Omit<SharedCustomField,"spaceId"|"revision"|"predecessorId"> & {expectedRevision:number};
export type CustomFieldPreview = {field:Omit<SharedCustomField,"revision"|"predecessorId">;fingerprint:string;valueCount:number;replaceType:boolean;previousRevision:number;preservesPreviousValues:true};
export type CustomFieldCommand = CustomFieldDraft & {fingerprint:string;operationId:string;replaceType:boolean};
export type CustomFieldCriterion = {fieldId:string;op:"exists"|"missing"|"eq"|"ne"|"contains"|"gt"|"gte"|"lt"|"lte";value?:CustomFieldValue};
export const customFieldTypes:Record<CustomFieldType,string>={text:"Текст",number:"Число",date:"Дата",select:"Одиночный выбор",multi:"Множественный выбор",checkbox:"Флажок",url:"Ссылка"};
export function customFieldDraft(field:SharedCustomField):CustomFieldDraft {
  return {id:field.id,title:field.title,type:field.type,projectId:field.projectId,options:structuredClone(field.options),position:field.position,
    required:field.required,showCard:field.showCard,showList:field.showList,archived:field.archived,expectedRevision:field.revision};
}
export function customFieldsError(error:unknown,language?:Language):string|null {
  const workflow=workflowError(error,language);if(workflow)return workflow;
  const code=error instanceof GenesisApiError?String(error.payload?.error??error.message):error instanceof Error?error.message:"";
  const copy:Record<string,string>={
    CUSTOM_FIELD_CONFLICT:"Поле или его значения изменились. Обновите предпросмотр; черновик сохранён.",
    CUSTOM_FIELD_SCOPE_HAS_VALUES:"Нельзя изменить область: у поля есть значения в других проектах.",
    CUSTOM_FIELD_TYPE_TRANSITION_REQUIRED:"Подтвердите создание нового поля с сохранением прежнего в архиве.",
    CUSTOM_FIELD_MOVE_REQUIRES_MAPPING:"Перенос требует сопоставления проектных полей. Сохраните данные через экспорт или используйте поля пространства.",
    CUSTOM_FIELD_REQUIRED:"Заполните обязательные пользовательские поля.",CUSTOM_FIELD_VALUE_INVALID:"Проверьте тип и значение пользовательского поля.",
    CUSTOM_FIELD_URL_INVALID:"Укажите ссылку, начинающуюся с https:// или http://.",CUSTOM_FIELD_OPTION_UNAVAILABLE:"Вариант списка недоступен. Выберите действующий вариант.",
    CUSTOM_FIELD_UNAVAILABLE:"Поле больше недоступно. Обновите данные; черновик сохранён.",CUSTOM_FIELD_LIMIT:"Достигнут лимит: 200 действующих полей в пространстве.",
    CUSTOM_FIELD_INVALID:"Проверьте название, тип и настройки поля.",CUSTOM_FIELD_OPERATION_REUSED:"Эта операция уже использована. Обновите предпросмотр и повторите.",
    CUSTOM_FIELD_FILTER_INVALID:"Условия выборки недействительны. Исправьте или сбросьте фильтр.",CUSTOM_FIELD_SORT_INVALID:"Условия выборки недействительны. Исправьте или сбросьте фильтр.",
  };
  if(code==='CUSTOM_FIELD_OPTIONS_LIMIT')return customFieldRecoveryText('Лимит — 200 вариантов, включая архивные. Для новых вариантов создайте другое поле.',language);
  return copy[code]?t(copy[code],language):null;
}
export function customFieldText(field:SharedCustomField,value:CustomFieldValue|null|undefined,language:Language):string {
  if(value===null||value===undefined)return t("Не задано",language);
  if(typeof value==="boolean")return t(value?"Да":"Нет",language);
  if(typeof value==="number")return new Intl.NumberFormat(language,{maximumFractionDigits:12}).format(value);
  if(field.type==="select"||field.type==="multi")return (Array.isArray(value)?value:[String(value)]).map(id=>field.options.find(option=>option.id===id)?.title??t("Недоступно",language)).join(", ");
  return String(value);
}
