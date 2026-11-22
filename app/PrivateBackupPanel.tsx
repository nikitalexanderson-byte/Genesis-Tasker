'use client';
import {useEffect,useRef,useState} from 'react';
import {PrivateContentExport} from './PrivateContentExport';
import {PrivatePersonalContentRestore} from './PrivatePersonalContentRestore';
import {PrivateDrivePanel} from './PrivateDrivePanel';
import {BACKUP_MAX_FILE,openBackup,type BackupPayload} from './backup-format';
import {useBackupCopy} from './use-backup-copy';
import {useDataTransferGuard} from './FeatureAccessContext';
import {captureLocalContentArchive,captureRemoteContentArchive,contentOnlyBackupInput,retainImportedContentArchive,retainedContentArchives,openRetainedContentArchive,openContentArchiveValue,type ContentArchiveSection} from './e2ee/content-archive';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';
import {decodeE2eeBytes} from './e2ee/envelope';
import {parseLegacyMigrationJson} from './e2ee/legacy-json';
import {captureMessagingAccess} from './e2ee/message-lifetime';
import copy from '../contracts/e2ee/content-archive-copy-v1.json';
import fileCopy from '../contracts/e2ee/content-file-copy-v1.json';
import sectionNames from '../contracts/e2ee/backup-section-names-v1.json';

export function PrivateBackupPanel({ownerId,language}:{ownerId:string;language:string}){
 const text=copy[language as keyof typeof copy]??copy.en,{c,ready}=useBackupCopy(language),transfer=useDataTransferGuard(),[key,setKey]=useState(''),[file,setFile]=useState<File|null>(null),[payload,setPayload]=useState<BackupPayload|null>(null),[selected,setSelected]=useState(''),[content,setContent]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false),generation=useRef(0),running=useRef(false);
 const filesText=fileCopy[language as keyof typeof fileCopy]??fileCopy.en,[binary,setBinary]=useState(false),payloadAccount=useRef<ReturnType<typeof requirePrivateAccount>|null>(null);
 useEffect(()=>{const clear=()=>{generation.current++;payloadAccount.current=null;setKey('');setPayload(null);setSelected('');setContent('');setBinary(false);setMessage('');},hide=()=>{if(document.visibilityState!=='visible')clear();};const unsubscribe=subscribePrivateAccount(clear);document.addEventListener('visibilitychange',hide);return()=>{generation.current++;payloadAccount.current=null;unsubscribe();document.removeEventListener('visibilitychange',hide);};},[ownerId]);
 const importFile=async()=>{if(running.current||!file||!key.trim()||!transfer.check())return;running.current=true;setBusy(true);setError(false);setMessage('');const token=++generation.current;
  try{const account=requirePrivateAccount(ownerId);if(file.size<1||file.size>BACKUP_MAX_FILE)throw new Error('BACKUP_TOO_LARGE');const imported=await contentOnlyBackupInput(await openBackup(await file.text(),key.trim()));account.requireOpen();if(token!==generation.current||requirePrivateAccount(ownerId)!==account||!transfer.check())throw new Error('E2EE_ACCOUNT_CHANGED');
   const retained=await retainImportedContentArchive(account,imported);account.requireOpen();if(token!==generation.current)return;payloadAccount.current=account;setPayload(retained);setSelected('');setContent('');setBinary(false);setMessage(text.saved);setKey('');
  }catch{if(token===generation.current)setError(true);}finally{running.current=false;setBusy(false);}
 };
 const [archives,setArchives]=useState<string[]>([]);
 const loadRetained=async(id?:string)=>{if(running.current)return;running.current=true;setBusy(true);setError(false);const token=++generation.current;
  try{const account=requirePrivateAccount(ownerId);if(id){const value=await openRetainedContentArchive(account,id);account.requireOpen();if(token===generation.current){payloadAccount.current=account;setPayload(value);setSelected('');setContent('');setBinary(false);}}
   else{const ids=await retainedContentArchives(account);account.requireOpen();if(token===generation.current)setArchives(ids);}
  }catch{if(token===generation.current)setError(true);}finally{running.current=false;setBusy(false);}
 };
 const rows=payload?.sections.flatMap((section,sectionIndex)=>{const name=c(sectionNames[section.id][0],sectionNames[section.id][1]);return(section.data as ContentArchiveSection).entries.flatMap((entry,index)=>[{key:`${section.id}:${index}:current`,sectionIndex,entryIndex:index,versionId:entry.current.id,title:`${name} · ${entry.current.filename||`${filesText.file} ${index+1}`} · ${filesText.current}`,value:entry.current},...entry.history.map((value,at)=>({key:`${section.id}:${index}:${at}`,sectionIndex,entryIndex:index,versionId:value.id,title:`${name} · ${value.filename||`${filesText.file} ${index+1}`} · ${filesText.version} ${at+1}`,value}))]);})??[];
 const inspect=(id:string)=>{setSelected(id);setContent('');setBinary(false);setError(false);const row=rows.find(row=>row.key===id);if(!row)return;try{const account=requirePrivateAccount(ownerId);if(account!==payloadAccount.current)throw new Error('E2EE_ACCOUNT_CHANGED');account.requireOpen();
  if(row.value.size>2*1024*1024||row.value.mediaType&&!['application/json','text/json','application/octet-stream'].includes(row.value.mediaType)){setBinary(true);return;}
  const bytes=row.value.size===0?new Uint8Array():decodeE2eeBytes(row.value.bytes,row.value.size);try{const value=parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'BACKUP_INVALID',2*1024*1024);setContent(JSON.stringify(value,null,2));}catch{setBinary(true);}finally{bytes.fill(0);}
 }catch{setError(true);}};
 const saveSelected=async()=>{
  if(running.current||!selected||!transfer.check())return;const row=rows.find(row=>row.key===selected);if(!row)return;running.current=true;setBusy(true);setError(false);const token=++generation.current;let bytes:Uint8Array|undefined,url:string|undefined;
  try{const guard=captureMessagingAccess(ownerId),account=requirePrivateAccount(ownerId),current=()=>{guard();account.requireOpen();if(token!==generation.current||requirePrivateAccount(ownerId)!==account||payloadAccount.current!==account||!transfer.check())throw new Error('E2EE_ACCOUNT_CHANGED');};current();
   const file=await openContentArchiveValue(row.value,current);bytes=file.bytes;current();
   const safe=Array.from(file.filename.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'_')).slice(0,180).join('').replace(/[ .]+$/g,'');
   const id=row.value.id.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,96),name=safe&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)?safe:`genesis-content-${id}.${file.mediaType==='application/json'?'json':'bin'}`;
   const output=new Uint8Array(bytes);try{url=URL.createObjectURL(new Blob([output],{type:'application/octet-stream'}));}finally{output.fill(0);}current();const link=document.createElement('a');link.href=url;link.download=name;link.click();const held=url;setTimeout(()=>URL.revokeObjectURL(held),1000);url=undefined;
  }catch{if(token===generation.current)setError(true);}finally{bytes?.fill(0);if(url)URL.revokeObjectURL(url);running.current=false;setBusy(false);}
 };
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
   {binary?<p>{filesText.binary}</p>:null}
   {selected?<><p>{filesText.notice}</p><button type="button" disabled={busy} onClick={()=>void saveSelected()}>{filesText.download}</button></>:null}
  </section>
  <PrivatePersonalContentRestore ownerId={ownerId} language={language} payload={payload} selection={(()=>{const row=rows.find(row=>row.key===selected);return row&&['workspace','diary','mindmaps','physis','aurora','stoicheion'].includes(payload?.sections[row.sectionIndex]?.id??'')?{sectionIndex:row.sectionIndex,entryIndex:row.entryIndex,versionId:row.versionId}:null;})()}/>
 </div>;
}
