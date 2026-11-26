'use client';
import {useEffect,useRef,useState} from 'react';
import {backupDriveAdapter,type BackupCloudAdapter,type DriveFile,type DriveStatus} from './backup-drive';
import {PrivateContentExport} from './PrivateContentExport';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';
import {captureMessagingAccess} from './e2ee/message-lifetime';
import {captureLocalContentArchive,captureRemoteContentArchive} from './e2ee/content-archive';
import {useDataTransferGuard} from './FeatureAccessContext';
import copy from '../contracts/e2ee/drive-backup-copy-v1.json';

export function PrivateDrivePanel({ownerId,language}:{ownerId:string;language:string}){
 const text=copy[language as keyof typeof copy]??copy.en,transfer=useDataTransferGuard();
 const [status,setStatus]=useState<DriveStatus|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[message,setMessage]=useState(false);
 const [pending,setPending]=useState<string[]>([]),[files,setFiles]=useState<DriveFile[]>([]),[next,setNext]=useState<string|null>(null),generation=useRef(0),running=useRef(false),pages=useRef(new Set<string>());
 useEffect(()=>{const clear=()=>{generation.current++;setStatus(null);setConsent(false);setError(false);setMessage(false);setPending([]);setFiles([]);setNext(null);pages.current.clear();},hide=()=>{if(document.visibilityState!=='visible')clear();};const unsubscribe=subscribePrivateAccount(clear);document.addEventListener('visibilitychange',hide);return()=>{generation.current++;unsubscribe();document.removeEventListener('visibilitychange',hide);};},[ownerId]);
 const run=async<T,>(operation:(adapter:BackupCloudAdapter,current:()=>void)=>Promise<T>,complete?:(value:T)=>void)=>{
  if(running.current||!transfer.check())throw new Error('DRIVE_BUSY');running.current=true;setBusy(true);setError(false);setMessage(false);const token=generation.current;
  try{const guard=captureMessagingAccess(ownerId),current=()=>{guard();if(token!==generation.current||!transfer.check())throw new Error('E2EE_ACCOUNT_CHANGED');};current();
   const value=await operation(backupDriveAdapter(requirePrivateAccount(ownerId)),current);current();complete?.(value);return value;
  }catch(reason){if(token===generation.current)setError(true);throw reason;}
  finally{running.current=false;setBusy(false);}
 };
 const click=<T,>(operation:(adapter:BackupCloudAdapter,current:()=>void)=>Promise<T>,complete?:(value:T)=>void)=>{void run(operation,complete).catch(()=>{});};
 const refresh=()=>click(async adapter=>({status:await adapter.status(),pending:await adapter.pending()}),value=>{setStatus(value.status);setPending(value.pending);setFiles([]);setNext(null);pages.current.clear();});
 const list=(token?:string)=>click(async adapter=>{if(token&&pages.current.has(token))throw new Error('DRIVE_INVALID_RESPONSE');return adapter.list(token);},value=>{
  const combined=token?[...files,...value.files]:value.files;if(new Set(combined.map(row=>row.fileId)).size!==combined.length)throw new Error('DRIVE_INVALID_RESPONSE');
  if(!token)pages.current.clear();else pages.current.add(token);if(value.nextPageToken&&pages.current.has(value.nextPageToken))throw new Error('DRIVE_INVALID_RESPONSE');setFiles(combined);setNext(value.nextPageToken);
 });
 const deliver=async(file:string)=>{await run(async adapter=>{const id=await adapter.stage(file);await adapter.retry(id);return adapter.pending();},value=>{setPending(value);setMessage(true);});};
 return <section className="backup-panel" data-no-translate><h3>{text.title}</h3><p>{text.notice}</p>
  <button type="button" disabled={busy} onClick={refresh}>{text.check}</button>
  {status?.enabled===false?<p role="status">{text.disabled}</p>:null}
  {status?.enabled&&!status.connectionId?<><label className="backup-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>{text.consent}</label>
   <button type="button" disabled={busy||!consent} onClick={()=>click(adapter=>adapter.connect(),url=>window.location.assign(url))}>{text.connect}</button></>:null}
  {status?.connectionId?<><button type="button" disabled={busy} onClick={()=>click(async adapter=>{await adapter.disconnect();return adapter.status();},value=>{setStatus(value);setFiles([]);setNext(null);})}>{text.disconnect}</button>
   {status.enabled?<><PrivateContentExport owner={ownerId} language={language} capture={()=>captureLocalContentArchive(requirePrivateAccount(ownerId))} label={text.saveDevice} deliver={deliver} deliveryNotice={text.notice}/>
    <PrivateContentExport owner={ownerId} language={language} capture={()=>captureRemoteContentArchive(requirePrivateAccount(ownerId))} label={text.saveServer} deliver={deliver} deliveryNotice={text.notice}/>
    <button type="button" disabled={busy} onClick={()=>list()}>{text.files}</button>
    {files.map(file=><div key={file.fileId}><time dateTime={file.createdAt}>{file.createdAt}</time> · {file.bytes} B <button type="button" disabled={busy} onClick={()=>click(async(adapter,current)=>{const value=await adapter.download(file);current();const url=URL.createObjectURL(new Blob([value],{type:'application/octet-stream'}));try{const link=document.createElement('a');link.href=url;link.download=`genesis-${file.backupId}.genesisbackup`;link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}})}>{text.download}</button></div>)}
    {next?<button type="button" disabled={busy} onClick={()=>list(next)}>{text.more}</button>:null}</>:null}
  </>:null}
  {pending.map(id=><div key={id}><button type="button" disabled={busy||!status?.enabled||!status.connectionId} onClick={()=>click(async adapter=>{await adapter.retry(id);return adapter.pending();},value=>{setPending(value);setMessage(true);})}>{text.retry} · {id}</button>
   <button type="button" disabled={busy} onClick={()=>click(async(adapter,current)=>{const value=await adapter.stagedFile(id);current();const url=URL.createObjectURL(new Blob([value.file],{type:'application/octet-stream'}));try{const link=document.createElement('a');link.href=url;link.download=`genesis-${value.backupId}.genesisbackup`;link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}})}>{text.download}</button></div>)}
  {message?<p role="status">{text.saved}</p>:null}{error?<p role="alert">{text.error}</p>:null}
 </section>;
}
