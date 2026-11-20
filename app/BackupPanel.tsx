import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { authorizeBackup, BACKUP_NOTICE_VERSION, freezeBackupDevice, materializeDeviceBackup, materializeServerBackup, retainBackupSafety, type ServerEvidence, type FrozenDevice } from './backup-device';
import { BACKUP_MAX_FILE, newBackupRecoveryKey, openBackup, sealBackup, type BackupPayload, type BackupModuleId } from './backup-format';
import { BACKUP_WORKSPACE_COLLECTIONS, prepareBackupRestore, type BackupRestoreMode, type BackupRestorePlan } from './backup-restore';
import { backupNeedsReconciliation, backupRequest, captureAccountSessionGuard, holdBackupStaleChanges, type GenesisUser } from './cloud-sync';
import './backup.css';
import {useBackupCopy} from './use-backup-copy';
import {backupJournalConflicts,type BackupJournalConflict,type BackupJournalChoices} from './backup-private-journals';
import {BackupJournalChoicesPanel} from './BackupJournalChoices';
import {registerBackupMigrationEditor,withBackupEditorTask,type BackupMigrationForm} from './backup-migration-memory';
import {withWebBackupRuntime} from './backup-web-operations';
import {backupPanelMirror} from './backup-panel-mirror';
type Stage={stageId:string;digest:string;counts:Record<string,number>;expiresIn:number};
type Status={enabled:boolean;noticeVersion:string;generation:number;driveEnabled:false;serverSigningConfigured:boolean};
const names={workspace:['Дела, проекты, привычки и прогресс','Tasks, projects, habits and progress'],mindmaps:['Карты мыслей','Mind maps'],diary:['Дневник и сны','Diary and dreams'],stoicheion:['Практики','Practices'],aurora:['Гно Метэр Басилея','Gno Meter Basileia'],physis:['Фюзис','Physis'],'shared-drafts':['Общие дела','Shared affairs']} as const;
const webDownload=(content:string,id:string)=>{
  const url=URL.createObjectURL(new Blob([content],{type:'application/octet-stream'}));
  const link=document.createElement('a');link.href=url;link.download=`genesis-${id}.genesisbackup`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
export type BackupPanelRuntime={
 authorizeBackup:typeof authorizeBackup;freezeBackupDevice:(owner:string)=>FrozenDevice|Promise<FrozenDevice>;materializeDeviceBackup:typeof materializeDeviceBackup;
 materializeServerBackup:typeof materializeServerBackup;retainBackupSafety:typeof retainBackupSafety;
 prepareBackupRestore:(payload:BackupPayload,owner:string,selected:BackupModuleId[],mode:BackupRestoreMode,choices?:BackupJournalChoices)=>Promise<BackupRestorePlan>;
 backupNeedsReconciliation:typeof backupNeedsReconciliation;backupRequest:typeof backupRequest;
 captureAccountSessionGuard:typeof captureAccountSessionGuard;holdBackupStaleChanges:typeof holdBackupStaleChanges;
 download:(content:string,id:string)=>void|Promise<void>;
 readFile?:()=>Promise<File>;restart?:()=>void;
 withOperation?:<T>(owner:string,operation:(runtime:BackupPanelRuntime)=>Promise<T>)=>Promise<T>;
 retainForm?:(form:BackupMigrationForm)=>void;
};
const webRuntime:BackupPanelRuntime={authorizeBackup,freezeBackupDevice,materializeDeviceBackup,materializeServerBackup,retainBackupSafety,
 prepareBackupRestore:(payload,owner,selected,mode,choices)=>prepareBackupRestore(payload,owner,selected,mode,undefined,choices),backupNeedsReconciliation,backupRequest,captureAccountSessionGuard,holdBackupStaleChanges,download:webDownload,
 withOperation:(owner,action)=>withWebBackupRuntime(owner,webRuntime,action)};
function useBackupPanelState<T>(mirror:ReturnType<typeof backupPanelMirror>,name:string,initial:T|(()=>T)):[T,Dispatch<SetStateAction<T>>]{
 const [value,setValue]=useState(initial);mirror.initialize(name,value);
 return[value,action=>setValue(mirror.update(name,action))];
}
export function BackupPanel({user,runtime=webRuntime}:{user:GenesisUser;runtime?:BackupPanelRuntime}){
  const {backupNeedsReconciliation,backupRequest,captureAccountSessionGuard}=runtime;
  const {c,ready,failed,retry}=useBackupCopy(user.language);
  const live=useRef(true),guard=useRef(captureAccountSessionGuard()),running=useRef(false);
  const [mirror]=useState(()=>backupPanelMirror(runtime.retainForm));
  const [status,setStatus]=useBackupPanelState<Status|null>(mirror,'status',null),[busy,setBusy]=useBackupPanelState(mirror,'busy',false),[error,setError]=useBackupPanelState(mirror,'error',''),[message,setMessage]=useBackupPanelState(mirror,'message','');
  const [key,setKey]=useBackupPanelState(mirror,'key',''),[savedKey,setSavedKey]=useBackupPanelState(mirror,'savedKey',false),[consent,setConsent]=useBackupPanelState(mirror,'consent',false),[file,setFile]=useBackupPanelState<File|null>(mirror,'file',null);
  const [payload,setPayload]=useBackupPanelState<BackupPayload|null>(mirror,'payload',null),[selected,setSelected]=useBackupPanelState<BackupModuleId[]>(mirror,'selected',[]),[mode,setMode]=useBackupPanelState<BackupRestoreMode>(mirror,'mode','missing');
  const [plan,setPlan]=useBackupPanelState<BackupRestorePlan|null>(mirror,'plan',null),[stage,setStage]=useBackupPanelState<Stage|null>(mirror,'stage',null),[confirmed,setConfirmed]=useBackupPanelState(mirror,'confirmed',false);
  const [conflicts,setConflicts]=useBackupPanelState<BackupJournalConflict[]>(mirror,'conflicts',[]),[journalChoices,setJournalChoices]=useBackupPanelState<BackupJournalChoices>(mirror,'journalChoices',{});
  const [history,setHistory]=useBackupPanelState<{attempt?:string;success?:string}>(mirror,'history',()=>{try{return JSON.parse(localStorage.getItem(`genesis-backup-history-v1:${user.uid}`)||'{}');}catch{return {};}});
  const historyKey=`genesis-backup-history-v1:${user.uid}`;
  useLayoutEffect(()=>{mirror.publish();},[mirror]);
  useLayoutEffect(()=>registerBackupMigrationEditor(user.uid,'backup-panel',mirror.snapshot),[user.uid,mirror]);
  useEffect(()=>{live.current=true;void backupRequest<Status>('/status').then(value=>{if(live.current)setStatus(value);}).catch(()=>{if(live.current)setError(c('Проверка резервирования недоступна. Данные устройства сохранены.','Backup service is unavailable. Device data is preserved.'));});
    return()=>{live.current=false;};
  // The panel is keyed by owner in AccountPanel; translations do not restart operations.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[historyKey]);
  const check=()=>{guard.current();if(!live.current)throw new Error('BACKUP_PANEL_CLOSED');};
  const stamp=(success=false)=>{const at=new Date().toISOString(),value={...history,attempt:at,...success?{success:at}:{}};localStorage.setItem(historyKey,JSON.stringify(value));setHistory(value);};
  const report=(reason:unknown)=>{if(live.current){const code=reason instanceof Error?reason.message:'';
    if(code==='BACKUP_CANCELLED'){setMessage(c('Действие отменено.','Action cancelled.'));return;}
    const errors:Record<string,string>={BACKUP_DISABLED:c('Резервирование подготовлено, но ещё не включено владельцем сервиса.','Backups are prepared and await service activation.'),FEATURE_SUBSCRIPTION_REQUIRED:c('Нужен действующий Standart или выше.','An active Standart plan or higher is required.'),BACKUP_OWNER:c('Копия принадлежит другому аккаунту GENESIS.','This backup belongs to another GENESIS account.'),BACKUP_PREVIEW_CHANGED:c('Данные изменились. Создайте новый предпросмотр.','Data changed. Prepare a new preview.'),BACKUP_RECOVERY_OR_INTEGRITY:c('Ключ не подошёл или файл повреждён. Исходные данные сохранены.','The key is incorrect or the file is damaged. Existing data is preserved.'),BACKUP_DRAFT_CHOICE_REQUIRED:c('В копии несколько разных черновиков одной записи. Автоматический выбор остановлен.','This backup has conflicting drafts. Automatic selection has stopped.'),BACKUP_SIGNING_NOT_CONFIGURED:c('Для серверного снимка ещё не настроены ключи подписи.','Server snapshot signing keys are not configured.')};
    setError(errors[code]??c('Не удалось завершить действие. Проверьте файл, ключ и соединение; данные сохранены.','The operation could not finish. Check the file, key and connection; data is preserved.'));}};
  const run=async(action:(ports:BackupPanelRuntime)=>Promise<void>)=>{if(running.current)return;running.current=true;
   let reported=false;
   try{setBusy(true);setError('');setMessage('');await withBackupEditorTask(user.uid,async()=>{
    const execute=async(bound:BackupPanelRuntime)=>{try{check();stamp();await action(bound);check();}catch(reason){reported=true;report(reason);throw reason;}
     finally{if(live.current)setBusy(false);}};
    if(runtime.withOperation)await runtime.withOperation(user.uid,execute);else await execute(runtime);
   });}catch(reason){try{if(!reported){report(reason);if(live.current)setBusy(false);}}catch(refused){
    // A retired owner/frozen scope cannot adopt even a late UI-only error. The
    // last acknowledged form remains retained, and the failed action never runs.
    const code=refused instanceof Error?refused.message:'';
    if(!['BACKUP_OWNER','E2EE_ACCOUNT_CHANGED','E2EE_ARCHIVE_CAPTURE_BUSY','E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN'].includes(code))throw refused;
   }}finally{running.current=false;}};
  const exportFile=(source:'device'|'server')=>run(async ports=>{
    const {freezeBackupDevice,retainBackupSafety,authorizeBackup,materializeDeviceBackup,materializeServerBackup,backupRequest,download}=ports;
    const frozen=await freezeBackupDevice(user.uid); // MUST precede every network request.
    const safety=await retainBackupSafety(frozen);check();
    await authorizeBackup();check();
    const value=source==='device'?await materializeDeviceBackup(frozen):await materializeServerBackup(user.uid,await backupRequest<ServerEvidence>('/server-snapshot',{noticeVersion:BACKUP_NOTICE_VERSION}));
    check();const content=await sealBackup(value,key);check();await authorizeBackup();check();
    await download(content,value.backupId);check();const groups=await backupJournalConflicts(value);check();stamp(true);setPayload(value);setConflicts(groups);setJournalChoices({});setStage(null);setPlan(null);
    setMessage(c('Зашифрованная копия сохранена. Проверьте полноту разделов ниже.','Encrypted backup saved. Check section coverage below.')+(safety.persistent?'':c(' Защитный снимок остаётся только в памяти вкладки: хранилище устройства заполнено.',' The safety snapshot is held only in tab memory because device storage is full.')));
  });
  const inspect=()=>run(async ports=>{if(!file)return;await ports.authorizeBackup();check();if(file.size>BACKUP_MAX_FILE)throw new Error('BACKUP_TOO_LARGE');
    const value=await openBackup(await file.text(),key);check();if(value.ownerId!==user.uid)throw new Error('BACKUP_OWNER');
    const groups=await backupJournalConflicts(value);check();setPayload(value);setConflicts(groups);setJournalChoices({});setSelected(value.sections.filter(row=>!['physis','shared-drafts'].includes(row.id)&&row.completeness!=='unavailable').map(row=>row.id));setStage(null);setPlan(null);setConfirmed(false);
    setMessage(c('Файл проверен на этом устройстве. Выберите разделы и создайте предпросмотр.','File checked on this device. Select sections and prepare a preview.'));});
  const preview=()=>run(async ports=>{const {freezeBackupDevice,retainBackupSafety,authorizeBackup,prepareBackupRestore,backupRequest}=ports;if(!payload)return;const frozen=await freezeBackupDevice(user.uid);await retainBackupSafety(frozen);check();await authorizeBackup();
    const next=await prepareBackupRestore(payload,user.uid,selected,mode,journalChoices);check();setPlan(next);setStage(null);setConfirmed(false);
    if(!next.operations.length){setMessage(c('Добавлять нечего. Дубликаты не созданы.','Nothing to add. No duplicates created.'));return;}
    const result=await backupRequest<Stage>('/preview',{noticeVersion:BACKUP_NOTICE_VERSION,operations:next.operations,...payload.serverEvidence?{serverEvidence:payload.serverEvidence}:{}});check();setStage(result);mirror.setOperationId(crypto.randomUUID());});
  const commit=()=>run(async ports=>{const {freezeBackupDevice,retainBackupSafety,backupRequest}=ports;if(!stage||!confirmed)return;const frozen=await freezeBackupDevice(user.uid);await retainBackupSafety(frozen);check();
    const result=await backupRequest<{generation:number;duplicate:boolean}>('/commit',{noticeVersion:BACKUP_NOTICE_VERSION,stageId:stage.stageId,digest:stage.digest,operationId:mirror.operationId(),confirmed:true});check();
    setStage(null);setConfirmed(false);stamp(true);setMessage(c('Восстановление завершено. Поколение данных: {generation}. Перезагрузите приложение; старая очередь будет сохранена для сверки.','Restore completed. Data generation: {generation}. Reload the app; the old queue will be held for review.').replace('{generation}',String(result.generation)));});
  const resetPreview=()=>{setStage(null);setPlan(null);setConfirmed(false);};
  if(!ready)return <section className="backup-panel" data-no-translate><p role="status">{failed?c('Перевод не загружен. Повторите попытку.','Translation could not load. Try again.'):c('Загрузка…','Loading…')}</p>{failed?<button type="button" onClick={retry}>{c('Повторить','Retry')}</button>:null}</section>;
  return <section data-no-translate className="account-preferences backup-panel" aria-labelledby="backup-title" data-settings-group="backups">
    <h3 id="backup-title">{c('Резервные копии и восстановление','Backups and restore')}</h3>
    <p>{c('Зашифрованный файл ваших данных. Вход через связанный Google открывает аккаунт без импорта.','An encrypted file of your data. Signing in with a linked Google opens your account without importing.')}</p>
    {status&&!status.enabled?<p role="status">{c('Подготовлено для 3.2.2. Функция пока отключена на сервере.','Prepared for 3.2.2. This feature is currently disabled on the server.')}</p>:null}
    {backupNeedsReconciliation()?<div className="backup-notice"><p>{c('На сервере восстановлены данные. Автоматическая отправка старой очереди остановлена.','Server data was restored. Automatic replay of the old queue is paused.')}</p><button type="button" data-dialog-save="false" disabled={busy} onClick={()=>void run(async ports=>{await ports.holdBackupStaleChanges(user.uid);check();(ports.restart??(()=>window.location.reload()))();})}>{c('Сохранить прежнее состояние для сверки и продолжить','Hold the previous state for review and continue')}</button></div>:null}
    <dl className="backup-dates"><div><dt>{c('Последняя попытка','Last attempt')}</dt><dd>{history.attempt?new Date(history.attempt).toLocaleString(user.language):'—'}</dd></div><div><dt>{c('Последняя успешная операция','Last successful operation')}</dt><dd>{history.success?new Date(history.success).toLocaleString(user.language):'—'}</dd></div></dl>
    <label className="backup-check"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>{c('Я ознакомился с составом копии, шифрованием и условиями восстановления в','I have read about backup contents, encryption and restore in the')} <a href="/privacy" target="_blank" rel="noreferrer">{c('политике','privacy policy')}</a> {c('и','and')} <a href="/terms" target="_blank" rel="noreferrer">{c('соглашении','terms')}</a>. {c('Новые разрешения Google не запрашиваются.','No new Google permissions are requested.')}</span></label>
    <fieldset disabled={busy}><legend>{c('Ключ копии','Backup key')}</legend><label>{c('Храните ключ отдельно от файла и Google','Keep this key separate from the file and Google')}<textarea autoComplete="off" spellCheck={false} rows={2} value={key} onChange={event=>{setKey(event.target.value);setSavedKey(false);resetPreview();}}/></label><button type="button" className="secondary-button" onClick={()=>{setKey(newBackupRecoveryKey());setSavedKey(false);resetPreview();}}>{c('Создать ключ','Generate key')}</button><label className="backup-check"><input type="checkbox" checked={savedKey} onChange={event=>setSavedKey(event.target.checked)}/>{c('Я сохранил ключ отдельно. Он расшифровывает данные и не восстанавливает вход.','I saved the key separately. It decrypts data and does not restore sign-in access.')}</label></fieldset>
    <fieldset disabled={busy||!status?.enabled||!consent||!savedKey||!key.trim()}><legend>{c('Создать копию','Create a backup')}</legend><p>{c('Копия устройства сохраняет доступные данные и несинхронизированные изменения до проверки тарифа. Серверный снимок содержит только синхронизированные разделы.','A device snapshot preserves available data and pending changes before checking the plan. A server snapshot contains synced sections only.')}</p><div className="backup-actions"><button type="button" className="primary-button" onClick={()=>void exportFile('device')}>{c('Копия этого устройства','Back up this device')}</button><button type="button" className="secondary-button" disabled={!status?.serverSigningConfigured} onClick={()=>void exportFile('server')}>{c('Серверный снимок','Server snapshot')}</button></div></fieldset>
    <fieldset disabled={busy||!status?.enabled||!consent}><legend>{c('Проверить файл','Check a file')}</legend><label>{c('Файл .genesisbackup · до 24 МиБ','File .genesisbackup · up to 24 MiB')}{runtime.readFile?<button type="button" onClick={()=>void run(async ports=>{const picked=await ports.readFile!();check();setFile(picked);setPayload(null);resetPreview();})}>{file?<span data-no-translate>{file.name}</span>:c('Выбрать файл','Choose file')}</button>:<input type="file" accept=".genesisbackup" onChange={event=>{setFile(event.target.files?.[0]??null);setPayload(null);resetPreview();}}/>}</label><button type="button" disabled={!file||!key.trim()} onClick={()=>void inspect()}>{c('Проверить и расшифровать','Check and decrypt')}</button></fieldset>
{payload?<div className="backup-coverage"><h4>{c('Состав копии','Backup contents')}</h4><p>{payload.source==='device_snapshot'?c('Источник: это устройство','Source: this device'):c('Источник: сервер GENESIS','Source: GENESIS server')} · {new Date(payload.createdAt).toLocaleString(user.language)}</p><p>{c('Кеш может быть неполным. Не загруженные на устройство файлы и закрытые разделы не обещаны в копии.','Caches may be incomplete. Files never downloaded and locked sections are not guaranteed in this backup.')}</p><ul>{payload.sections.map(row=><li key={row.id}><label className="backup-check"><input type="checkbox" disabled={busy||['physis','shared-drafts'].includes(row.id)||row.completeness==='unavailable'} checked={selected.includes(row.id)} onChange={event=>{setSelected(old=>event.target.checked?[...old,row.id]:old.filter(id=>id!==row.id));resetPreview();}}/><span>{c(names[row.id][0],names[row.id][1])} · {row.count} · {row.completeness==='unavailable'?c('недоступно','unavailable'):row.completeness==='partial'?c('частично','partial'):c('доступно','available')}{row.pending?` · ${c('изменений','pending')}: ${row.pending}`:''}</span></label></li>)}</ul><p>{c('Фюзис сохраняется в файле; для его применения используется существующий отдельный механизм после разблокировки. Общие дела переносятся с проверкой прав в их разделе.','Physis data is retained in the file; applying it uses the existing separate flow after unlocking. Shared affairs use their permission-aware transfer section.')}</p><label>{c('Правило восстановления','Restore rule')}<select value={mode} aria-describedby="backup-rule-description" disabled={busy} onChange={event=>{setMode(event.target.value as BackupRestoreMode);resetPreview();}}><option value="missing">{c('Добавить недостающее','Add missing data')}</option><option value="replace">{c('Версии из копии','Backup versions')}</option></select></label><p id="backup-rule-description">{mode==='missing'?c('Добавятся отсутствующие данные. Существующие записи выбранных разделов сохранятся.','Missing data will be added. Existing records in selected sections will be preserved.'):c('Выбранные разделы будут использовать версии из копии. История, прогресс и настройки личного пространства также могут измениться; удаления будут показаны перед подтверждением.','Selected sections will use backup versions. Personal workspace history, progress and settings may also change; removals will be shown before confirmation.')}</p><BackupJournalChoicesPanel groups={conflicts.filter(group=>selected.includes(group.section))} choices={journalChoices} disabled={busy} c={c} onChange={value=>{setJournalChoices(value);resetPreview();}}/><div className="backup-actions"><button type="button" disabled={busy||!selected.length||!status?.enabled||!consent||conflicts.some(group=>selected.includes(group.section)&&!journalChoices[group.section])} onClick={()=>void preview()}>{c('Предпросмотр восстановления','Preview restore')}</button></div></div>:null}
    {plan?<div className="backup-preview"><h4>{c('Изменения','Changes')}</h4><p>{c('Добавится','Added')}: {plan.added} · {c('Изменится','Changed')}: {plan.changed} · {c('Пропущено','Skipped')}: {plan.skipped} · {c('Удаляемых записей','Records removed')}: {plan.removed}</p>{plan.workspaceRemovals.length?<div><h5>{c('Удаляемые записи по разделам','Records removed by section')}</h5><dl className="backup-removals">{plan.workspaceRemovals.map(row=><div key={row.collection}><dt>{c(BACKUP_WORKSPACE_COLLECTIONS[row.collection][0],BACKUP_WORKSPACE_COLLECTIONS[row.collection][1])}</dt><dd>{row.count}</dd></div>)}</dl></div>:null}<p>{c('Входы, тариф и роли сохраняются. Записей в Google: 0. Историческая очередь не запускается.','Sign-in methods, plan and roles are preserved. Google writes: 0. Historical changes are not replayed.')}</p>{stage?<><label className="backup-check"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{c('Подтверждаю показанные изменения. Текущее состояние будет сохранено в защитной копии.','I confirm these changes. A safety snapshot will preserve the current state.')}</label><button type="button" className="primary-button" disabled={busy||!confirmed} onClick={()=>void commit()}>{c('Восстановить данные','Restore data')}</button></>:null}</div>:null}
    <p className="backup-cloud">{c('Google Drive отключён до получения письменного разрешения Google. Сохраняйте независимую локальную копию.','Google Drive is disabled pending written permission from Google. Keep an independent local backup.')}</p>
    {busy?<p role="status" aria-live="polite">{c('Подготовка и проверка…','Preparing and checking…')}</p>:null}{message?<p role="status" aria-live="polite">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
  </section>;
}
