'use client';
import {useEffect,useRef,useState} from 'react';
import {IndexedDbDeviceKeyStorage} from './e2ee/device-vault';
import {openRetiredDeviceContent} from './e2ee/retired-device-content';
import {decodeE2eeBytes} from './e2ee/envelope';
import {newBackupRecoveryKey,sealBackup} from './backup-format';
import {useBackupCopy} from './use-backup-copy';
import entryCopy from '../contracts/e2ee/personal-device-entry-copy-v1.json';
import commonCopy from '../contracts/e2ee/shared-security-copy-v1.json';

/** Available while the active vault is locked. Old local code opens only the
 * historical reader; the separate backup key seals its content-only output. */
export function PrivateRetiredDeviceContent({ownerId,language,guard}:{ownerId:string;language:string;guard:()=>void}){
 const c=entryCopy[language as keyof typeof entryCopy]??entryCopy.en,common=commonCopy[language as keyof typeof commonCopy]??commonCopy.en,backup=useBackupCopy(language);
 const [slots,setSlots]=useState<number[]>([]),[slot,setSlot]=useState(0),[secret,setSecret]=useState(''),[key,setKey]=useState(''),[saved,setSaved]=useState(false),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),epoch=useRef(0),running=useRef(false);
 useEffect(()=>{let alive=true;void new IndexedDbDeviceKeyStorage().history(ownerId).then(rows=>{if(alive){const values=rows.slice(0,-1).map(row=>row.serial);setSlots(values);setSlot(values.at(-1)??0);}}).catch(()=>{if(alive)setFailed(true);});const clear=()=>{epoch.current++;setSecret('');setKey('');setSaved(false);setAck(false);},hide=()=>{if(document.visibilityState!=='visible')clear();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',clear);return()=>{alive=false;clear();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',clear);};},[ownerId]);
 const save=async()=>{if(running.current||!saved||!ack)return;running.current=true;setBusy(true);setFailed(false);const ticket=++epoch.current,current=()=>{guard();if(ticket!==epoch.current||document.visibilityState!=='visible')throw new Error('E2EE_ACCOUNT_CHANGED');};let reader:Awaited<ReturnType<typeof openRetiredDeviceContent>>|undefined,url:string|undefined,held:Uint8Array|undefined;
  try{current();held=decodeE2eeBytes(secret.trim(),32);reader=await openRetiredDeviceContent(ownerId,slot,held,current);current();const payload=await reader.capture();current();const file=await sealBackup(payload,key.trim());current();url=URL.createObjectURL(new Blob([file],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download=`genesis-retained-${payload.backupId}.genesisbackup`;link.click();const retained=url;setTimeout(()=>URL.revokeObjectURL(retained),1000);url=undefined;setSecret('');setKey('');setSaved(false);setAck(false);
  }catch{if(ticket===epoch.current)setFailed(true);}finally{held?.fill(0);reader?.close();if(url)URL.revokeObjectURL(url);running.current=false;setBusy(false);}
 };
 if(!slots.length||!backup.ready)return null;
 return <details data-no-translate><summary>{c.retainedTitle}</summary><p>{c.retainedNotice}</p><fieldset disabled={busy}>
  <label>{c.retainedSlot}<select value={slot} onChange={event=>{setSlot(Number(event.target.value));setSecret('');setAck(false);}}>{slots.map(id=><option key={id} value={id}>{id}</option>)}</select></label>
  <label>{c.previousCode}<input type="password" value={secret} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} onChange={event=>{setSecret(event.target.value);setAck(false);}}/></label>
  <label>{backup.c('Ключ копии','Backup key')}<textarea rows={2} value={key} autoComplete="off" spellCheck={false} onChange={event=>{setKey(event.target.value);setSaved(false);}}/></label><button type="button" onClick={()=>{setKey(newBackupRecoveryKey());setSaved(false);}}>{backup.c('Создать ключ','Generate key')}</button>
  <label className="backup-check"><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>{backup.c('Я сохранил ключ отдельно. Он расшифровывает данные и не восстанавливает вход.','I saved the key separately. It decrypts data and does not restore sign-in access.')}</label>
  <label className="backup-check"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/>{c.retainedAck}</label><button type="button" disabled={!slot||!secret.trim()||!key.trim()||!saved||!ack} onClick={()=>void save()}>{c.retainedExport}</button>
 </fieldset>{failed?<p role="alert">{common.error}</p>:null}</details>;
}
