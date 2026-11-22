'use client';
import {useEffect,useRef,useState} from 'react';
import {PrivateContentExport} from './PrivateContentExport';
import {PrivateDrivePanel} from './PrivateDrivePanel';
import {BACKUP_MAX_FILE,openBackup,type BackupPayload} from './backup-format';
import {useBackupCopy} from './use-backup-copy';
import {useDataTransferGuard} from './FeatureAccessContext';
import {captureLocalContentArchive,captureRemoteContentArchive,contentOnlyBackupInput,retainImportedContentArchive,retainedContentArchives,openRetainedContentArchive,type ContentArchiveSection} from './e2ee/content-archive';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';
import {decodeE2eeBytes} from './e2ee/envelope';
import {parseLegacyMigrationJson} from './e2ee/legacy-json';
import copy from '../contracts/e2ee/content-archive-copy-v1.json';

export function PrivateBackupPanel({ownerId,language}:{ownerId:string;language:string}){
 const text=copy[language as keyof typeof copy]??copy.en,{c,ready}=useBackupCopy(language),transfer=useDataTransferGuard(),[key,setKey]=useState(''),[file,setFile]=useState<File|null>(null),[payload,setPayload]=useState<BackupPayload|null>(null),[selected,setSelected]=useState(''),[content,setContent]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false),generation=useRef(0),running=useRef(false);
 useEffect(()=>{const unsubscribe=subscribePrivateAccount(()=>{generation.current++;setKey('');setPayload(null);setContent('');setMessage('');});return()=>{generation.current++;unsubscribe();};},[ownerId]);
 const importFile=async()=>{if(running.current||!file||!key.trim()||!transfer.check())return;running.current=true;setBusy(true);setError(false);setMessage('');const token=++generation.current;
  try{const account=requirePrivateAccount(ownerId);if(file.size<1||file.size>BACKUP_MAX_FILE)throw new Error('BACKUP_TOO_LARGE');const imported=await contentOnlyBackupInput(await openBackup(await file.text(),key.trim()));account.requireOpen();if(token!==generation.current||requirePrivateAccount(ownerId)!==account||!transfer.check())throw new Error('E2EE_ACCOUNT_CHANGED');
   const retained=await retainImportedContentArchive(account,imported);account.requireOpen();if(token!==generation.current)return;setPayload(retained);setSelected('');setContent('');setMessage(text.saved);setKey('');
  }catch{if(token===generation.current)setError(true);}finally{running.current=false;setBusy(false);}
 };
 const [archives,setArchives]=useState<string[]>([]);
 const loadRetained=async(id?:string)=>{if(running.current)return;running.current=true;setBusy(true);setError(false);const token=++generation.current;
  try{const account=requirePrivateAccount(ownerId);if(id){const value=await openRetainedContentArchive(account,id);account.requireOpen();if(token===generation.current){setPayload(value);setSelected('');setContent('');}}
   else{const ids=await retainedContentArchives(account);account.requireOpen();if(token===generation.current)setArchives(ids);}
  }catch{if(token===generation.current)setError(true);}finally{running.current=false;setBusy(false);}
 };
 const rows=payload?.sections.flatMap(section=>(section.data as ContentArchiveSection).entries.flatMap((entry,index)=>[{key:`${section.id}:${index}:current`,title:`${entry.objectId} · ${c('Текущая версия','Current version')}`,value:entry.current},...entry.history.map((value,at)=>({key:`${section.id}:${index}:${at}`,title:`${entry.objectId} · ${at+1}`,value}))]))??[];
 const inspect=(id:string)=>{setSelected(id);setContent('');setError(false);const row=rows.find(row=>row.key===id);if(!row)return;try{requirePrivateAccount(ownerId).requireOpen();const bytes=row.value.size===0?new Uint8Array():decodeE2eeBytes(row.value.bytes,row.value.size);try{if(bytes.length>2*1024*1024)throw new Error('BACKUP_TOO_LARGE');const value=parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'BACKUP_INVALID',2*1024*1024);setContent(JSON.stringify(value,null,2));}finally{bytes.fill(0);}}catch{setError(true);}};
 if(!ready)return null;
 return <div data-no-translate><section className="backup-panel"><h3>{text.title}</h3><p>{text.notice}</p></section>
  <PrivateContentExport owner={ownerId} language={language} capture={()=>captureLocalContentArchive(requirePrivateAccount(ownerId))}/>
  <section className="backup-panel"><p>{text.remoteNotice}</p></section>
  <PrivateContentExport owner={ownerId} language={language} label={c('Снимок сервера','Server snapshot')} capture={()=>captureRemoteContentArchive(requirePrivateAccount(ownerId))}/>
  <PrivateDrivePanel ownerId={ownerId} language={language}/>
  <section className="backup-panel"><h3>{text.import}</h3><fieldset disabled={busy}>
   <label>{c('Файл копии','Backup file')}<input type="file" accept=".genesisbackup,application/octet-stream,application/json" onChange={event=>{setFile(event.target.files?.[0]??null);setPayload(null);setContent('');}}/></label>
   <label>{c('Ключ копии','Backup key')}<input type="password" autoComplete="off" value={key} maxLength={64} onChange={event=>setKey(event.target.value)}/></label>
   <button type="button" disabled={!file||!key.trim()} onClick={()=>void importFile()}>{text.import}</button>
  </fieldset>{message?<p role="status">{message}</p>:null}{error?<p role="alert">{text.error}</p>:null}
   <button type="button" disabled={busy} onClick={()=>void loadRetained()}>{text.history}</button>
   {archives.map(id=><button type="button" key={id} disabled={busy} onClick={()=>void loadRetained(id)}>{id}</button>)}
   {rows.length?<label>{text.history}<select value={selected} onChange={event=>inspect(event.target.value)}><option value="">—</option>{rows.map(row=><option key={row.key} value={row.key}>{row.title}</option>)}</select></label>:null}
   {content?<pre style={{whiteSpace:'pre',overflow:'auto',maxHeight:'50vh'}}>{content}</pre>:null}
  </section>
 </div>;
}
