'use client';
import {useRef,useState} from 'react';
import {newBackupRecoveryKey,sealBackup,type BackupPayload} from './backup-format';
import {useBackupCopy} from './use-backup-copy';
import {useDataTransferGuard} from './FeatureAccessContext';
import {requirePrivateAccount} from './e2ee/product-session';

/** Reuses the existing independently keyed backup format. The recovery key is
 * never included in the file, storage, queue, analytics or a network request. */
export function PrivateContentExport({owner,language,capture}:{owner:string;language:string;capture:()=>Promise<BackupPayload>}){
 const {c,ready}=useBackupCopy(language),transfer=useDataTransferGuard(),[key,setKey]=useState(''),[saved,setSaved]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const running=useRef(false);
 const save=async()=>{if(running.current||!saved||!consent||!key.trim()||!transfer.check())return;running.current=true;setBusy(true);setError('');
  let url:string|undefined;try{const account=requirePrivateAccount(owner),payload=await capture();account.requireOpen();
   if(payload.ownerId!==owner||payload.billingEvidence!==null)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   const file=await sealBackup(payload,key.trim());account.requireOpen();if(requirePrivateAccount(owner)!==account||!transfer.check())throw new Error('E2EE_ACCOUNT_CHANGED');
   url=URL.createObjectURL(new Blob([file],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download=`genesis-${payload.backupId}.genesisbackup`;link.click();
   const retained=url;setTimeout(()=>URL.revokeObjectURL(retained),1000);url=undefined;
  }catch(reason){setError(reason instanceof Error?reason.message:'BACKUP_INVALID');}finally{if(url)URL.revokeObjectURL(url);running.current=false;setBusy(false);}
 };
 if(!ready)return null;
 return <section className="backup-panel" data-no-translate><h3>{c('Снимок устройства','Device snapshot')}</h3>
  <fieldset disabled={busy}><legend>{c('Ключ копии','Backup key')}</legend>
   <label>{c('Храните ключ отдельно от файла и Google','Keep this key separate from the file and Google')}<textarea rows={2} autoComplete="off" spellCheck={false} value={key} onChange={event=>{setKey(event.target.value);setSaved(false);}}/></label>
   <button type="button" onClick={()=>{setKey(newBackupRecoveryKey());setSaved(false);}}>{c('Создать ключ','Generate key')}</button>
   <label className="backup-check"><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>{c('Я сохранил ключ отдельно. Он расшифровывает данные и не восстанавливает вход.','I saved the key separately. It decrypts data and does not restore sign-in access.')}</label>
   <label className="backup-check"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>{c('Я ознакомился с составом копии, шифрованием и условиями восстановления в','I have read about backup contents, encryption and restore in the')} <a href="/privacy" target="_blank" rel="noreferrer">{c('политике','privacy policy')}</a> {c('и','and')} <a href="/terms" target="_blank" rel="noreferrer">{c('соглашении','terms')}</a>. {c('Новые разрешения Google не запрашиваются.','No new Google permissions are requested.')}</span></label>
   <button type="button" disabled={!saved||!consent||!key.trim()} onClick={()=>void save()}>{c('Снимок устройства','Device snapshot')}</button>
  </fieldset>{busy?<p role="status">{c('Подготовка и проверка…','Preparing and checking…')}</p>:null}{error?<p role="alert">{error}</p>:null}
 </section>;
}
