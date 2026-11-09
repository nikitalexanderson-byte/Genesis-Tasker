import type { SharedBulkAction, SharedBulkSelection } from "./cloud-sync";

export type BulkPreviewRequest = {requestId:string;selection:SharedBulkSelection;action:SharedBulkAction};
export type BulkRecovery = {operationId?:string;pending?:BulkPreviewRequest};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const bulkRecoveryKey=(userId:string)=>`genesis.shared-bulk.${userId}.recovery`;

/** No task titles or reports persist on the device. A lost preview uses the exact same receipt. */
export function readBulkRecovery(storage:Pick<Storage,"getItem">,userId:string):BulkRecovery {
  try{
    const raw=storage.getItem(bulkRecoveryKey(userId));if(!raw||raw.length>1_100_000)return {};
    const value=JSON.parse(raw),result:BulkRecovery={};
    if(typeof value?.operationId==="string"&&uuid.test(value.operationId))result.operationId=value.operationId;
    const pending=value?.pending;
    if(uuid.test(pending?.requestId??"")&&["page","all"].includes(pending?.selection?.mode)
      &&["priority","assignee","status","due","labels","move","archive","trash"].includes(pending?.action?.kind))result.pending=pending;
    return result;
  }catch{return {};}
}

export function bulkPreviewRequest(previous:BulkPreviewRequest|undefined,selection:SharedBulkSelection,action:SharedBulkAction):BulkPreviewRequest {
  if(previous&&JSON.stringify([previous.selection,previous.action])===JSON.stringify([selection,action]))return previous;
  return {requestId:crypto.randomUUID(),selection,action};
}

export const bulkActionLabels={priority:"Приоритет",assignee:"Исполнитель",status:"Статус",due:"Срок",labels:"Метки",move:"Перенести",archive:"В архив",trash:"В корзину"} as const;
export const bulkStateLabels={preview:"Предварительный просмотр",running:"Выполняется",done:"Завершено",cancelled:"Отменено",failed:"Не удалось завершить"} as const;
export const bulkItemLabels={pending:"Ожидает",succeeded:"Выполнено",skipped:"Пропущено",failed:"Ошибка",cancelled:"Отменено"} as const;
export const bulkErrorLabels:Record<string,string>={
  BULK_PREVIEW_EXPIRED:"Предварительный просмотр истёк. Создайте новую операцию.",
  BULK_TREE_CHANGED:"Состав подзадач изменился. Обновите выборку перед повтором.",
  BULK_NO_DUE:"У задачи нет срока для сдвига.",
  BULK_STATUS_REQUIRED:"Для проекта не выбран статус.",
  SHARED_TASK_CONFLICT:"Задача изменена другим участником. Обновите выборку перед повтором.",
  BULK_NOT_ALLOWED:"Недостаточно прав или задача недоступна.",
  SHARED_PROJECT_FORBIDDEN:"Недостаточно прав или задача недоступна.",
  SHARED_PROJECT_NOT_FOUND:"Недостаточно прав или задача недоступна.",
  INVALID_ASSIGNEE:"Исполнитель недоступен в этом проекте.",
  INVALID_STATUS:"Статус больше недоступен в этом проекте.",
  INVALID_LABEL:"Метка недоступна в этом пространстве.",
  TASK_APPROVAL_REQUIRED:"Сначала требуется утверждение результата.",
  CUSTOM_FIELD_MOVE_REQUIRES_MAPPING:"Перенос требует сопоставления проектных полей. Сохраните данные через экспорт или используйте поля пространства.",
};
