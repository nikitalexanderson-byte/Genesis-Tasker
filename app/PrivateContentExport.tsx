'use client';
import {publicPagePath} from './public-route';
import {useEffect,useRef,useState} from 'react';
import {newBackupRecoveryKey,sealBackup,type BackupPayload} from './backup-format';
import contentCopy from '../contracts/e2ee/content-archive-copy-v1.json';
import {normalizeLanguage} from './i18n';
import {useBackupCopy} from './use-backup-copy';
import {useDataTransferGuard} from './FeatureAccessContext';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';

/** Reuses the existing independently keyed backup format. The recovery key is
 * never included in the file, storage, queue, analytics or a network request. */
export function PrivateContentExport({owner,language,capture,label,deliver,deliveryNotice}:{owner:string;language:string;capture:()=>Promise<BackupPayload>;label?:string;deliver?:(file:string,payload:BackupPayload)=>Promise<void>;deliveryNotice?:string}){
 const contentText=contentCopy[normalizeLanguage(language)],{c,ready}=useBackupCopy(language),transfer=useDataTransferGuard(),[key,setKey]=useState(''),[saved,setSaved]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const running=useRef(false),generation=useRef(0);
 useEffect(()=>{const clear=()=>{generation.current++;setKey('');setSaved(false);setConsent(false);setError('');},hide=()=>{if(document.visibilityState!=='visible')clear();};const unsubscribe=subscribePrivateAccount(clear);document.addEventListener('visibilitychange',hide);return()=>{generation.current++;unsubscribe();document.removeEventListener('visibilitychange',hide);};},[owner]);
 const save=async()=>{if(running.current||!saved||!consent||!key.trim()||!transfer.check())return;running.current=true;setBusy(true);setError('');
  const token=generation.current;let url:string|undefined;try{const account=requirePrivateAccount(owner),payload=await capture();account.requireOpen();
   if(payload.ownerId!==owner||payload.billingEvidence!==null)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   const file=await sealBackup(payload,key.trim());account.requireOpen();if(token!==generation.current||requirePrivateAccount(owner)!==account||!transfer.check())throw new Error('E2EE_ACCOUNT_CHANGED');
   if(deliver){await deliver(file,payload);account.requireOpen();if(token!==generation.current||requirePrivateAccount(owner)!==account)throw new Error('E2EE_ACCOUNT_CHANGED');setKey('');setSaved(false);return;}
   url=URL.createObjectURL(new Blob([file],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download=`genesis-${payload.backupId}.genesisbackup`;link.click();
   const retained=url;setTimeout(()=>URL.revokeObjectURL(retained),1000);url=undefined;
  }catch(reason){if(token===generation.current){const code=reason instanceof Error?reason.message:'';setError(['E2EE_SOURCE_HISTORY_CHANGED','E2EE_BACKUP_CAPTURE_CHANGED'].includes(code)?'changed':'failed');}}finally{if(url)URL.revokeObjectURL(url);running.current=false;setBusy(false);}
 };
 if(!ready)return null;
 return <section className="backup-panel" data-no-translate><h3>{label??contentText.deviceSnapshot}</h3>
  <fieldset disabled={busy}><legend>{c('Ключ копии','Backup key')}</legend>
   <label>{c('Храните ключ отдельно от файла и Google','Keep this key separate from the file and Google')}<textarea rows={2} autoComplete="off" spellCheck={false} value={key} onChange={event=>{setKey(event.target.value);setSaved(false);}}/></label>
   <button type="button" onClick={()=>{setKey(newBackupRecoveryKey());setSaved(false);}}>{c('Создать ключ','Generate key')}</button>
   <label className="backup-check"><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>{c('Я сохранил ключ отдельно. Он расшифровывает данные и не восстанавливает вход.','I saved the key separately. It decrypts data and does not restore sign-in access.')}</label>
   <label className="backup-check"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>{c('Я ознакомился с составом копии, шифрованием и условиями восстановления в','I have read about backup contents, encryption and restore in the')} <a href={publicPagePath(normalizeLanguage(language),'privacy')} target="_blank" rel="noreferrer">{c('политике','privacy policy')}</a> {c('и','and')} <a href={publicPagePath(normalizeLanguage(language),'terms')} target="_blank" rel="noreferrer">{c('соглашении','terms')}</a>. {deliveryNotice??c('Новые разрешения Google не запрашиваются.','No new Google permissions are requested.')}</span></label>
   <button type="button" disabled={!saved||!consent||!key.trim()} onClick={()=>void save()}>{label??contentText.deviceSnapshot}</button>
  </fieldset>{busy?<p role="status">{c('Подготовка и проверка…','Preparing and checking…')}</p>:null}{error?<p role="alert" data-backup-failure={error}>{error==='changed'?contentText.captureChanged:contentText.error}</p>:null}
 </section>;
}
