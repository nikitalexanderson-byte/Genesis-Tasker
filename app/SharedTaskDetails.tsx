import type { SharedProjectSnapshot, SharedTask } from './cloud-sync';
import { translateText, type Language } from './i18n';

export function SharedTaskDetails({task,context,language}:{task:SharedTask;context:SharedProjectSnapshot;language:Language}) {
  const t=(text:string)=>translateText(text,language);
  const memberName=(id:string)=>context.members.find(member=>member.userId===id)?.displayName??t('Бывший участник');
  const category=context.categories.find(item=>item.id===task.categoryId);
  const updated=new Date(task.updatedAt);
  return <div className="shared-task-details">
    {task.description ? <p className="shared-task-description" data-no-translate>{task.description}</p> : null}
    <dl className="shared-task-metadata">
      {task.createdBy ? <div><dt>{t('Создатель задачи')}</dt><dd data-no-translate>{memberName(task.createdBy)}</dd></div> : null}
      {task.assigneeId ? <div><dt>{t('Исполнитель')}</dt><dd data-no-translate>{memberName(task.assigneeId)}</dd></div> : null}
      {category ? <div><dt>{t('Категория')}</dt><dd data-no-translate>{category.title}</dd></div> : null}
      {Number.isFinite(updated.getTime()) ? <div><dt>{t('Обновлено')}</dt><dd data-no-translate><time dateTime={task.updatedAt}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(updated)}</time></dd></div> : null}
    </dl>
  </div>;
}
