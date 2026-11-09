import { type BackupPayload, type BackupModuleId } from './backup-format';
import { personalDocumentAccess, backupRestoreCurrent, sealBackupWorkspace, type GenesisTask, type EncryptedWorkspaceStructure } from './cloud-sync';
import { recoverBackupTasks } from './backup-task-restore';
import { normalizeHabitWorkspace } from './habits';
import { createHabitBackup, canonicalHabitBackup } from './habit-backup';
import { previewHabitRestore, applyHabitRestore } from './habit-backup-restore';
import { validateMindmap } from './mindmaps-model';
import { validateDiaryNote } from './diary-model';
import { validateRestorationDocument } from './stoicheion-restoration-work';
import type { AuroraDocument } from './aurora/session';
export type BackupRestoreMode='missing'|'replace';
export type BackupOperation={section:string;id?:string;input:unknown};
export const BACKUP_WORKSPACE_COLLECTIONS={projects:['Проекты','Projects'],categories:['Категории','Categories'],habits:['Привычки','Habits'],habitCompletions:['Выполнения привычек','Habit completions'],habitMeasurements:['Измерения привычек','Habit measurements'],habitTimers:['Таймеры привычек','Habit timers'],habitHistory:['История привычек','Habit history'],sleepPlans:['Планы сна','Sleep plans'],sleepEntries:['Записи сна','Sleep entries'],moodEntries:['Записи настроения','Mood entries'],addictionTrackers:['Трекеры воздержания','Abstinence trackers'],addictionEntries:['Записи воздержания','Abstinence entries'],analyticsSnapshots:['Снимки аналитики','Analytics snapshots'],dailyGoalRecords:['Дневные цели','Daily goals'],quests:['Квесты','Quests'],achievementUnlocks:['Достижения','Achievements'],rewardTransactions:['История наград','Reward history'],streakFreezeTransactions:['Защита серий','Streak protection'],hiddenDefaultTemplates:['Скрытые шаблоны','Hidden templates']} as const;
export type BackupRestorePlan={operations:BackupOperation[];added:number;changed:number;skipped:number;removed:number;workspaceRemovals:{collection:keyof typeof BACKUP_WORKSPACE_COLLECTIONS;count:number}[];notices:string[]};
type RecordData={id:string;revision:number;schemaVersion?:number;document:unknown;pending?:boolean};
const same=(a:unknown,b:unknown)=>canonicalHabitBackup(a)===canonicalHabitBackup(b);
const mergeIds=<T extends {id:string}>(current:T[],incoming:T[])=>[...current,...incoming.filter(row=>!current.some(old=>old.id===row.id))];
export type BackupDocumentAccess=Pick<ReturnType<typeof personalDocumentAccess>,'check'|'request'|'seal'|'open'>;
export type BackupRestoreAdapter={access:BackupDocumentAccess;current:()=>ReturnType<typeof backupRestoreCurrent>;sealWorkspace:typeof sealBackupWorkspace};
export async function prepareBackupRestore(payload:BackupPayload,owner:string,selected:BackupModuleId[],mode:BackupRestoreMode,adapter?:BackupRestoreAdapter):Promise<BackupRestorePlan> {
  if(payload.ownerId!==owner)throw new Error('BACKUP_OWNER');
  const access=adapter?.access??personalDocumentAccess(owner),plan:BackupRestorePlan={operations:[],added:0,changed:0,skipped:0,removed:0,workspaceRemovals:[],notices:[]};
  const current=await (adapter?.current??(()=>backupRestoreCurrent(owner)))();
  const taskSource=selected.includes('workspace')?payload.sections.find(row=>row.id==='workspace'&&row.completeness!=='unavailable')?.data as {document?:{tasks?:GenesisTask[]}}|undefined:undefined;
  const recoveredTasks=taskSource?.document?.tasks?await recoverBackupTasks(taskSource.document.tasks,owner,payload.backupId):null;
  for(const section of payload.sections.filter(row=>selected.includes(row.id))){
    if(section.completeness==='unavailable'||!section.data){plan.skipped++;continue;}
    if(section.id==='physis'||section.id==='shared-drafts'){plan.notices.push('BACKUP_SECTION_SEPARATE');plan.skipped+=section.count;continue;}
    if(section.id==='workspace'){
      const source=(section.data as {document:EncryptedWorkspaceStructure&{tasks?:GenesisTask[]}}).document;
      if(!source||source.trackerSchemaVersion!==16||!Array.isArray(source.projects)||!Array.isArray(source.categories))throw new Error('BACKUP_WORKSPACE_VERSION');
      const normalized=normalizeHabitWorkspace(source);
      let document:EncryptedWorkspaceStructure;
      if(mode==='missing'){
        const habitBackup=await createHabitBackup(normalized,payload.createdAt),preview=await previewHabitRestore(normalizeHabitWorkspace(current.document),JSON.stringify(habitBackup));
        const habits=await applyHabitRestore(normalizeHabitWorkspace(current.document),{preview,choices:Object.fromEntries(preview.habits.filter(row=>row.kind==='conflict').map(row=>[row.id,'keep']))});
        document={...current.document,...habits,projects:mergeIds(current.document.projects,source.projects),categories:mergeIds(current.document.categories,source.categories),
          taskLists:current.document.taskLists,taskListLinks:current.document.taskListLinks,
          sleepPlans:mergeIds(current.document.sleepPlans,normalized.sleepPlans),sleepEntries:mergeIds(current.document.sleepEntries,normalized.sleepEntries),
          moodEntries:mergeIds(current.document.moodEntries,normalized.moodEntries),addictionTrackers:mergeIds(current.document.addictionTrackers,normalized.addictionTrackers),addictionEntries:mergeIds(current.document.addictionEntries,normalized.addictionEntries)};
        plan.skipped+=preview.habits.filter(row=>row.kind==='conflict'||row.kind==='same'||row.kind==='restored').length;
      }else{
        document={...normalized,projects:source.projects,categories:source.categories,taskLists:current.document.taskLists,taskListLinks:current.document.taskListLinks};
        for(const collection of Object.keys(BACKUP_WORKSPACE_COLLECTIONS) as (keyof typeof BACKUP_WORKSPACE_COLLECTIONS)[]){
          const identity=(row:unknown)=>row&&typeof row==='object'&&'id' in row?`id:${String(row.id)}`:collection==='dailyGoalRecords'&&row&&typeof row==='object'&&'date' in row?`day:${String(row.date)}`:canonicalHabitBackup(row);
          const incoming=new Set(document[collection].map(identity));
          const count=current.document[collection].filter(row=>!incoming.has(identity(row))).length;
          if(count){plan.workspaceRemovals.push({collection,count});plan.removed+=count;}
        }
      }
      if(!same(current.document,document)){plan.operations.push({section:'workspace',input:await (adapter?.sealWorkspace??sealBackupWorkspace)(owner,document,current.version)});plan.changed++;}
      for(const recovered of recoveredTasks?.tasks??[]){
        const id=recovered.id,old=current.tasks.find(row=>row.id===id);
        if(old && mode==='missing'){plan.skipped++;continue;}
        plan.operations.push({section:'recovered-tasks',id,input:{...await access.seal(recovered,`recovered-task:v1:${id}`),expectedRevision:old?.restoredRevision??0}});
        if(old)plan.changed++;else plan.added++;
      }
      if(source.tasks?.length)plan.notices.push('EXTERNAL_TASKS_RESTORED_TO_GENESIS');
      continue;
    }
    if(section.id==='mindmaps'||section.id==='diary'){
      const isMap=section.id==='mindmaps';
      const response=await access.request<{maps?:RecordData[];notes?:RecordData[]}>(isMap?'/mindmaps':'/diary',{cache:'no-store'});
      const rows=(isMap?response.maps:response.notes)??[];
      const seen=new Map<string,unknown>();
      for(const row of (section.data as {records:RecordData[]}).records){
        let document=isMap?validateMindmap(row.document):validateDiaryNote(row.document);
        if(isMap&&recoveredTasks){
          const map=validateMindmap(document);
          document={...map,nodes:await Promise.all(map.nodes.map(async node=>node.kind==='task'?{...node,refId:await recoveredTasks.reference(node.refId!)}:node))};
        }
        if(document.id!==row.id)throw new Error('BACKUP_DOCUMENT_ID');
        if(seen.has(row.id)){if(!same(seen.get(row.id),document))throw new Error('BACKUP_DRAFT_CHOICE_REQUIRED');continue;}seen.set(row.id,document);
        const old=rows.find(item=>item.id===row.id);
        if(old&&(mode==='missing'||same(await access.open(old as unknown as {iv:string;ciphertext:string},(isMap?'map:':'diary-note:v1:')+row.id),document))){plan.skipped++;continue;}
        const sealed=await access.seal(document,(isMap?'map:':'diary-note:v1:')+row.id);
        const note=isMap?null:validateDiaryNote(document);
        plan.operations.push({section:section.id,id:row.id,input:{...sealed,expectedRevision:old?.revision??0,schemaVersion:isMap?(row.schemaVersion??1):1,
          ...(isMap?{operationId:crypto.randomUUID()}:note?.dream?{dream:{day:note.dream.day,timeZone:note.dream.timeZone}}:{})}});
        if(old)plan.changed++;else plan.added++;
      }
      continue;
    }
    const isAurora=section.id==='aurora',path=isAurora?'/aurora-workspace':'/stoicheion-workspace',scope=isAurora?'aurora-workspace:v1':'stoicheion-workspace:v1';
    const response=await access.request<{document:({iv:string;ciphertext:string;revision:number})|null}>(path,{cache:'no-store'});
    const value=(section.data as {document:unknown}).document;
    const document=isAurora?await (await import('./aurora/session')).validateDocument(value as AuroraDocument,owner):validateRestorationDocument(value);
    if(response.document&&(mode==='missing'||same(await access.open(response.document,scope),document))){plan.skipped++;continue;}
    plan.operations.push({section:section.id,input:{...await access.seal(document,scope),expectedRevision:response.document?.revision??0}});
    if(response.document)plan.changed++;else plan.added++;
  }
  access.check();return plan;
}
