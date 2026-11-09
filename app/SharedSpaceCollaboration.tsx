"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { useCallback,useEffect,useId,useRef,useState } from 'react';
import { GenesisApiError } from './cloud-sync';
import { createPortal } from 'react-dom';
import { ExperimentalIcon } from './ExperimentalIcon';
import { translateText } from './i18n';
import { collaborationText } from './collaboration-copy';
import { PRIVATE_MESSAGE_OPEN, type PrivateMessagePeer } from './SharedMemberMessageButton';
import { spaceParticipants,messagingKey,openConversation,respondPrivateInvitation,privateMessages,privateInbox,privateConversationDestination,savePrivateMessage,deletePrivateMessage,readPrivateMessages,clearPrivateConversation,uploadPrivateFileChunk,loadPrivateFileChunk,discardPrivateFile,type SpaceParticipant,type PrivateMessage,type PrivateNotice,type PrivateInvitation,type PrivateConversation } from './private-messages-api';
import { createMessagingIdentity,keyFingerprint,conversationKey,encryptPrivateMessage,decryptPrivateMessage,securityCode,exportMessagingBackup,importMessagingBackup,encryptPrivateFile,decryptPrivateFile,decodePrivateContent,PRIVATE_FILE_LIMIT,type PrivateFile,type MessagingIdentity } from './private-message-crypto';
import {loadMessagingIdentity,saveMessagingIdentity,claimMessagingIdentity,pinPeerKey} from './private-message-vault';
import type { NoticeActivity } from './notification-dock-model';
import { PrivateConversationList } from './PrivateConversationList';
import {useDataTransferGuard} from './FeatureAccessContext';
import './shared-space-collaboration.css';
type Peer={spaceId:string;userId:string;displayName:string};

async function identityFor(userId:string,create=false):Promise<MessagingIdentity|null>{
  const server=await messagingKey(),saved=await loadMessagingIdentity(userId);
  if(saved&&(!server.keyId||saved.keyId===server.keyId)){await messagingKey(saved.publicKey);return saved;}
  if(server.keyId)throw new Error('LOCAL_KEY_MISSING');
  if(!create)return null;
  const identity=await claimMessagingIdentity(userId,await createMessagingIdentity());if(!identity)throw new Error('KEY_STORAGE_UNAVAILABLE');await messagingKey(identity.publicKey);return identity;
}
function KeyRecovery({userId,onReady,identity,missing,language}:{userId:string;onReady:(key:MessagingIdentity)=>void;identity:MessagingIdentity|null;missing:boolean;language:string}){
  const transfer=useDataTransferGuard();
  const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const c=(key:Parameters<typeof collaborationText>[0])=>collaborationText(key,language);
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError(false);try{await action();}catch{setError(true);}finally{setBusy(false);}};
  return <details className="shared-key-recovery" open={!identity} data-no-translate><summary>{identity?c('backup'):c('restore')}</summary><p>{c('recovery')} {c('signOut')}</p>
    {missing?<p role="status">{c('missing')}</p>:!identity?<button type="button" className="primary-button" disabled={busy} onClick={()=>void run(async()=>{const key=await identityFor(userId,true);if(key)onReady(key);})}>{c('enable')}</button>:null}
    <label>{c('password')}<input type="password" minLength={12} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
    <div className="shared-key-actions">{identity?<button type="button" className="secondary-button" disabled={busy||password.length<12} onClick={()=>void run(async()=>{
      if(!transfer.check())return;const source=await exportMessagingBackup(identity,password);if(!transfer.check())return;const url=URL.createObjectURL(new Blob([source],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='genesis-private-messages-key.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setPassword('');
    })}>{c('backup')}</button>:null}
    <label className="shared-key-import">{c('restore')}<input type="file" accept=".json,application/json" disabled={busy||password.length<12} onChange={event=>{
      const file=event.target.files?.[0];event.target.value='';if(!file||!transfer.check())return;void run(async()=>{if(file.size>4000)throw new Error('INVALID_BACKUP');const text=await file.text();if(!transfer.check())return;const key=await importMessagingBackup(text,password),server=await messagingKey();if(!transfer.check())return;if(server.keyId&&server.keyId!==key.keyId)throw new Error('KEY_MISMATCH');await messagingKey(key.publicKey);await saveMessagingIdentity(userId,key);setPassword('');onReady(key);});
    }}/></label></div>{error?<p role="alert">{c('failure')}</p>:null}</details>;
}

export function SharedPrivateMessages({userId,peer,language,onClose,embedded=false,active=true}:{userId:string;peer:Peer;language:string;onClose:()=>void;embedded?:boolean;active?:boolean}){
  const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0);
  const titleId=useId();
  const embeddedRoot=useRef<HTMLElement>(null);
  const [identity,setIdentity]=useState<MessagingIdentity|null>(null),[missing,setMissing]=useState(false),[error,setError]=useState(false),[loading,setLoading]=useState(true);
  const [ready,setReady]=useState<{id:string;key:CryptoKey;keyIds:Record<string,string>;code:string}|null>(null);
  const [conversation,setConversation]=useState<PrivateConversation|null>(null),[handshake,setHandshake]=useState(0);
  const [messages,setMessages]=useState<(PrivateMessage&{text:string;files:PrivateFile[];failed?:boolean})[]>([]),[cursor,setCursor]=useState<number|null>(null);
  const [files,setFiles]=useState<File[]>([]),[position,setPosition]=useState<{x:number;y:number}|null>(null);
  const drag=useRef<{x:number;y:number;left:number;top:number}|null>(null),messageList=useRef<HTMLOListElement>(null),lastRead=useRef(0),loadingMessages=useRef(false);
  const [draft,setDraft]=useState(''),[editing,setEditing]=useState<PrivateMessage|null>(null),[busy,setBusy]=useState(false),[peerMissing,setPeerMissing]=useState(false);
  const c=(key:Parameters<typeof collaborationText>[0])=>collaborationText(key,language),t=(text:string)=>translateText(text,language as import('./i18n').Language);
  useEffect(()=>{if(embedded&&active)embeddedRoot.current?.focus({preventScroll:true});},[embedded,active]);
  useEffect(()=>{
    const element=embeddedRoot.current;if(!embedded||!element)return;
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'&&!busy){event.preventDefault();event.stopPropagation();onClose();}};
    element.addEventListener('keydown',escape);return()=>element.removeEventListener('keydown',escape);
  },[embedded,busy,onClose]);
  useEffect(()=>{const guard=generation;dialog.current?.show();return()=>{guard.current++;};},[]);
  useEffect(()=>{let active=true;void identityFor(userId).then(key=>{if(active)setIdentity(key);}).catch(()=>{if(active)setMissing(true);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[userId]);
  useEffect(()=>{
    const guard=generation;++guard.current;if(!identity||!active)return;const controller=new AbortController();let inFlight=false;
    const start=async()=>{try{
      const conversation=await openConversation(peer.spaceId,peer.userId,controller.signal);
      if(controller.signal.aborted)return;
      setConversation(conversation);
      if(conversation.status!=='accepted'){setReady(null);setPeerMissing(false);setError(false);return;}
      const {members}=await spaceParticipants(peer.spaceId,undefined,controller.signal),member=members.find(item=>item.userId===peer.userId);
      if(!member?.publicKey||!member.keyId){if(!controller.signal.aborted)setPeerMissing(true);return;}
      if(await keyFingerprint(member.publicKey)!==member.keyId)throw new Error('INVALID_PEER_KEY');
      await pinPeerKey(userId,peer.userId,member.keyId);const key=await conversationKey(identity,member.publicKey,conversation.id,peer.spaceId),code=await securityCode([identity.keyId,member.keyId]);
      if(controller.signal.aborted)return;
      setReady({id:conversation.id,key,keyIds:{[userId]:identity.keyId,[peer.userId]:member.keyId},code});setPeerMissing(false);setError(false);
    }catch{if(!controller.signal.aborted){setError(true);setReady(null);setMessages([]);}}};
    const retry=()=>{if(inFlight||document.visibilityState!=='visible')return;inFlight=true;void start().finally(()=>{inFlight=false;});};retry();const timer=setInterval(retry,5000);
    window.addEventListener('focus',retry);window.addEventListener('genesis:private-updates',retry);
    return()=>{controller.abort();clearInterval(timer);guard.current++;window.removeEventListener('focus',retry);window.removeEventListener('genesis:private-updates',retry);};
  },[identity,userId,peer.spaceId,peer.userId,handshake,active]);
  const load=async(before=0)=>{
    if(!ready||!active||loadingMessages.current)return;loadingMessages.current=true;try{const version=generation.current;const element=messageList.current,follow=!element||element.scrollHeight-element.scrollTop-element.clientHeight<80;const oldHeight=element?.scrollHeight??0;let result=await privateMessages(ready.id,before),rows=result.messages;
    if(!before){const oldest=messages[0]?.seq;while(oldest&&result.nextCursor&&rows[0]?.seq>oldest){result=await privateMessages(ready.id,result.nextCursor);rows=[...result.messages,...rows];if(version!==generation.current)return;}}
    const decoded=await Promise.all(rows.map(async message=>{if(!message.payload)return {...message,text:c('deleted'),files:[]};try{const content=decodePrivateContent(await decryptPrivateMessage(ready.key,{conversationId:ready.id,spaceId:peer.spaceId,id:message.id,senderId:message.senderId,revision:message.revision},message.payload,ready.keyIds));return {...message,text:content.text,files:content.files};}catch{return {...message,text:c('cannotDecrypt'),files:[],failed:true};}}));
    if(version!==generation.current)return;
    setError(false);setMessages(old=>before?[...decoded,...old.filter(item=>!decoded.some(row=>row.id===item.id))]:decoded);setCursor(result.nextCursor);
    requestAnimationFrame(()=>{if(!element)return;if(before)element.scrollTop+=element.scrollHeight-oldHeight;else if(follow)element.scrollTop=element.scrollHeight;});
    if(!before&&rows.length&&rows.at(-1)!.seq>lastRead.current){await readPrivateMessages(ready.id,rows.at(-1)!.seq);lastRead.current=rows.at(-1)!.seq;window.dispatchEvent(new Event('genesis:private-updates'));}
    }finally{loadingMessages.current=false;}
  };
  const loadRef=useRef(load);useEffect(()=>{loadRef.current=load;});
  useEffect(()=>{if(!ready||!active)return;let alive=true,pending=false;const refresh=()=>{if(pending||document.visibilityState!=='visible')return;pending=true;void loadRef.current().catch(error=>{if(alive){setError(true);if(error instanceof GenesisApiError&&[401,403,404].includes(error.status)){generation.current++;setReady(null);setMessages([]);}}}).finally(()=>{pending=false;});};refresh();const timer=setInterval(refresh,2000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[ready,active]);
  const run=async(action:()=>Promise<void>,reload=true)=>{if(busy)return;setBusy(true);setError(false);try{await action();if(reload)await load();}catch{setError(true);}finally{setBusy(false);}};
  const clampPosition=(x:number,y:number)=>{const rect=dialog.current?.getBoundingClientRect();return {x:Math.max(8,Math.min(x,window.innerWidth-(rect?.width??520)-8)),y:Math.max(8,Math.min(y,window.innerHeight-(rect?.height??600)-8))};};
  useEffect(()=>{const resize=()=>setPosition(old=>old?clampPosition(old.x,old.y):null);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  const send=async()=>{
    if(!ready||(!draft.trim()&&!files.length)||busy)return;
    await run(async()=>{
      const id=editing?.id??crypto.randomUUID(),revision=editing?editing.revision+1:1,context={conversationId:ready.id,spaceId:peer.spaceId,id,senderId:userId,revision};
      const existing=editing?messages.find(message=>message.id===editing.id)?.files??[]:[],attached=[...existing],uploaded:string[]=[];
      try{
        for(const file of files){const encrypted=await encryptPrivateFile(ready.key,context,file);uploaded.push(encrypted.metadata.id);for(let chunk=0;chunk<encrypted.chunks.length;chunk++)await uploadPrivateFileChunk(ready.id,encrypted.metadata.id,chunk,{ciphertext:encrypted.chunks[chunk],chunks:encrypted.chunks.length,bytes:file.size+16});attached.push(encrypted.metadata);}
        const content=attached.length?JSON.stringify({format:'genesis-private-content',text:draft,files:attached}):draft;
        const payload=await encryptPrivateMessage(ready.key,context,content,ready.keyIds);await savePrivateMessage(ready.id,id,payload,editing?.revision,attached.map(file=>file.id));setDraft('');setFiles([]);setEditing(null);
      }catch(error){for(const fileId of uploaded)await discardPrivateFile(ready.id,fileId).catch(()=>{});throw error;}
    });
  };
  const close=()=>{if(!busy){if(embedded)onClose();else dialog.current?.close();}};
  const recovery=loading?<p role="status">{t('Загрузка…')}</p>:<KeyRecovery userId={userId} identity={identity} missing={missing} language={language} onReady={key=>{setIdentity(key);setMissing(false);}}/>;
  const tools=ready?<><details className="shared-security-code"><summary>{c('code')}</summary><code>{ready.code}</code><p>{c('compare')}</p></details><button className="secondary-button" type="button" disabled={busy} onClick={()=>{if(confirm(c('clearConfirm')))void run(async()=>{generation.current++;await clearPrivateConversation(ready.id);setMessages([]);setCursor(null);lastRead.current=0;setDraft('');setEditing(null);setFiles([]);window.dispatchEvent(new Event('genesis:private-updates'));});}}>{c('clear')}</button></>:null;
  const content=<>
    <header data-dialog-header-container className="shared-private-drag-bar" onPointerDown={event=>{
      if(embedded||event.button!==0||!window.matchMedia('(min-width: 768px)').matches||(event.target as HTMLElement).closest('button'))return;
      const rect=dialog.current!.getBoundingClientRect();drag.current={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
    }} onPointerMove={event=>{if(drag.current)setPosition(clampPosition(drag.current.left+event.clientX-drag.current.x,drag.current.top+event.clientY-drag.current.y));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}><h2 id={titleId}>{embedded?peer.displayName:<>{c('messages')} · {peer.displayName}</>}</h2>{embedded?<button type="button" className="notification-chat-back secondary-button icon-button" disabled={busy} aria-label={c('backContacts')} data-tooltip={c('backContacts')} onClick={close}><ExperimentalIcon name="chevron"/></button>:<DialogCloseButton type="button" className="shared-projects-close" disabled={busy} aria-label={t('Закрыть')} onClick={close} />}</header>
    {embedded&&identity?<details className="shared-private-tools"><summary><ExperimentalIcon name="lock"/><span>{t('Настройки')}</span><ExperimentalIcon name="chevron"/></summary><p className="shared-private-encryption-note">{c('encrypted')}</p>{recovery}{tools}</details>:<><p className="shared-private-encryption-note">{c('encrypted')}</p>{recovery}{tools}</>}{peerMissing?<p role="status">{c('peerMissing')}</p>:null}
    {conversation?.status==='pending' ? <section className="shared-private-invitation" aria-live="polite"><p>{c(conversation.initiatorId===userId?'invitationWaiting':'invitationReceived')}</p>
      {conversation.initiatorId!==userId ? <div className="shared-private-actions">{[true,false].map(accept=><button type="button" key={String(accept)} className={accept?'primary-button':'secondary-button'} disabled={busy||!identity} onClick={()=>void run(async()=>{await respondPrivateInvitation(conversation.id,accept);setConversation({...conversation,status:accept?'accepted':'declined'});setHandshake(value=>value+1);window.dispatchEvent(new Event('genesis:private-updates'));},false)}>{c(accept?'acceptInvitation':'declineInvitation')}</button>)}</div>:null}
    </section> : conversation?.status==='declined' ? <p role="status">{c('invitationDeclined')}</p> : null}
    {ready?<>{cursor?<button type="button" disabled={busy} onClick={()=>void run(()=>load(cursor),false)}>{t('Показать ещё')}</button>:null}
    <ol ref={messageList} className="shared-private-messages" aria-live="polite" aria-relevant="additions text">{messages.map(message=><li key={message.id} data-self={message.senderId===userId||undefined}><header><strong>{message.senderId===userId?t('Вы'):peer.displayName}</strong><time dateTime={message.updatedAt}>{new Intl.DateTimeFormat(language,{dateStyle:'short',timeStyle:'short'}).format(new Date(message.updatedAt))}</time></header><p role={message.failed?'alert':undefined}>{message.text}</p>{message.files.map(file=><button type="button" className="secondary-button shared-private-file" key={file.id} disabled={busy} onClick={()=>void run(async()=>{
      const parts:string[]=[];for(let chunk=0;chunk<file.chunks;chunk++)parts.push((await loadPrivateFileChunk(ready.id,file.id,chunk)).ciphertext);
      const blob=await decryptPrivateFile(ready.key,{conversationId:ready.id,spaceId:peer.spaceId,id:message.id,senderId:message.senderId,revision:message.revision},file,parts),url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=file.name||'file';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    },false)}><ExperimentalIcon name="download"/><span>{file.name} · {new Intl.NumberFormat(language,{maximumFractionDigits:1}).format(file.size/1024)} KB</span></button>)}
    {!message.deletedAt&&message.senderId===userId?<div className="shared-private-actions"><button type="button" disabled={busy||message.failed} onClick={()=>{setEditing(message);setDraft(message.text);}}>{t('Редактировать')}</button><button type="button" disabled={busy} onClick={()=>{if(confirm(t('Удалить сообщение?')))void run(async()=>{await deletePrivateMessage(ready.id,message);if(editing?.id===message.id){setEditing(null);setDraft('');}});}}>{t('Удалить')}</button></div>:null}</li>)}</ol>
    <form onSubmit={event=>{event.preventDefault();void send();}}><label>{editing?t('Редактировать'):c('write')}<textarea maxLength={8000} value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label>
    {!editing?<label className="shared-private-upload" title={embedded?`${c('attach')} · ${c('fileLimit')}`:undefined}><span className={embedded?'sr-only':undefined}>{c('attach')}</span>{embedded?<ExperimentalIcon name="attach"/>:null}<input type="file" aria-label={c('attach')} multiple disabled={busy} onChange={event=>{const chosen=Array.from(event.target.files??[]);event.target.value='';if(chosen.some(file=>file.size>PRIVATE_FILE_LIMIT)||files.length+chosen.length>5){setError(true);return;}setFiles(old=>[...old,...chosen]);}}/><small className={embedded?'sr-only':undefined}>{c('fileLimit')}</small></label>:null}
    {files.length?<ul className="shared-private-pending">{files.map((file,index)=><li key={index}><span>{file.name}</span><button type="button" disabled={busy} aria-label={t('Удалить')} onClick={()=>setFiles(old=>old.filter((_,i)=>i!==index))}><ExperimentalIcon name="close"/></button></li>)}</ul>:null}
    <div className="shared-private-actions"><button type="submit" className="primary-button" disabled={busy||(!draft.trim()&&!files.length)}>{editing?t('Сохранить'):t('Отправить')}</button>{editing?<button type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft('');}}>{t('Отмена')}</button>:null}</div></form></>:null}{error?<p role="alert">{c('failure')}</p>:null}
  </>;
  if(embedded)return <section ref={embeddedRoot} tabIndex={-1} className="shared-private-embedded" data-no-translate aria-labelledby={titleId}>{content}</section>;
  return createPortal(<dialog ref={dialog} className="shared-projects-modal shared-private-dialog" style={position?{left:position.x,top:position.y,right:'auto',bottom:'auto'}:undefined} data-no-translate aria-labelledby={titleId} onClose={onClose} onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.preventDefault();close();}}} onCancel={event=>{if(busy)event.preventDefault();}}>{content}</dialog>,document.querySelector(".genesis-app")??document.body);
}

export default function SharedSpaceCollaboration({userId,spaceId,language,writeEnabled}:{userId:string;spaceId:string;language:string;writeEnabled:boolean}){
  const [clientId]=useState(()=>crypto.randomUUID());
  const [members,setMembers]=useState<SpaceParticipant[]>([]),[error,setError]=useState(false),[peer,setPeer]=useState<Peer|null>(null),[keysOpen,setKeysOpen]=useState(false),[identity,setIdentity]=useState<MessagingIdentity|null>(null),[missing,setMissing]=useState(false);
  const c=(key:Parameters<typeof collaborationText>[0])=>collaborationText(key,language);
  useEffect(()=>{const controller=new AbortController();let inFlight=false;const refresh=()=>{if(inFlight||!navigator.onLine)return;inFlight=true;void spaceParticipants(spaceId,writeEnabled?document.visibilityState==='visible':undefined,controller.signal,clientId).then(result=>{if(!controller.signal.aborted){setMembers(result.members);setError(false);}}).catch(()=>{if(!controller.signal.aborted){setMembers([]);setError(true);}}).finally(()=>{inFlight=false;});};refresh();const timer=setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);window.addEventListener('focus',refresh);return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);if(writeEnabled)void spaceParticipants(spaceId,false,undefined,clientId).catch(()=>{});};},[spaceId,clientId,writeEnabled]);
  useEffect(()=>{
    const open=(event:Event)=>{
      const peer=(event as CustomEvent<PrivateMessagePeer>).detail;
      if(peer?.spaceId===spaceId && typeof peer.userId==="string" && peer.userId!==userId && typeof peer.displayName==="string")setPeer(peer);
    };
    window.addEventListener(PRIVATE_MESSAGE_OPEN,open);
    return()=>window.removeEventListener(PRIVATE_MESSAGE_OPEN,open);
  },[spaceId,userId]);
  return <section className="shared-space-collaboration" data-no-translate><details className="shared-space-participants"><summary><ExperimentalIcon name="chevron"/><span className="shared-participants-heading"><ExperimentalIcon name="team"/>{c('participants')} · {members.length}</span><span>{c('viewing')} · {members.filter(member=>member.viewing).length}</span></summary>{error?<p role="alert">{c('failure')}</p>:null}
    <ul>{members.map(member=><li key={member.userId}><strong>{member.displayName}</strong><span>{translateText(({owner:'Владелец',admin:'Администратор',member:'Участник',guest:'Гость'} as Record<string,string>)[member.role]??'Участник',language as import('./i18n').Language)}</span>{member.viewing?<small>{c('viewing')}</small>:null}{member.userId!==userId?<button type="button" className="secondary-button" onClick={()=>setPeer({spaceId,userId:member.userId,displayName:member.displayName})}><ExperimentalIcon name="mail"/>{c('write')}</button>:null}</li>)}</ul>
    <button type="button" className="secondary-button" onClick={()=>{setKeysOpen(true);void identityFor(userId).then(setIdentity).catch(()=>setMissing(true));}}>{c('enable')}</button>{keysOpen?<KeyRecovery userId={userId} identity={identity} missing={missing} language={language} onReady={key=>{setIdentity(key);setMissing(false);}}/>:null}
    </details>{peer?<SharedPrivateMessages key={peer.userId} userId={userId} peer={peer} language={language} onClose={()=>setPeer(null)}/>:null}</section>;
}
export function SharedPrivateNotices({userId,language,embedded=false,onActivity,onNavigate,onConversationOpen,view='notices',active=true}:{userId:string;language:string;embedded?:boolean;onActivity?:(activity:NoticeActivity)=>void;onNavigate?:()=>void;onConversationOpen?:()=>void;view?:'notices'|'contacts';active?:boolean}){
  const [items,setItems]=useState<PrivateNotice[]>([]),[invitations,setInvitations]=useState<PrivateInvitation[]>([]),[busy,setBusy]=useState(''),[failed,setFailed]=useState(''),[open,setOpen]=useState(false),[peer,setPeer]=useState<Peer|null>(null);const dialog=useRef<HTMLDialogElement>(null);
  const choose=useCallback((target:Peer)=>{
    if(target.userId===userId)return;
    setPeer(target);
    if(embedded){if(onConversationOpen)onConversationOpen();else onNavigate?.();}
  },[userId,embedded,onConversationOpen,onNavigate]);
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  useEffect(()=>{const controller=new AbortController();let pending=false;const refresh=()=>{if(pending||document.visibilityState!=='visible'||!navigator.onLine)return;pending=true;void privateInbox(controller.signal).then(result=>{if(!controller.signal.aborted){setItems(result.conversations);setInvitations(result.invitations??[]);setFailed(current=>current==='inbox'?'':current);

    }}).catch(()=>{if(!controller.signal.aborted)setFailed('inbox');}).finally(()=>{pending=false;});};refresh();const timer=setInterval(refresh,5000);window.addEventListener('genesis:private-updates',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{controller.abort();clearInterval(timer);window.removeEventListener('genesis:private-updates',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[userId]);
  useEffect(()=>{
    const requested=new URL(window.location.href).searchParams.get("conversation");
    if(!requested||!/^[-a-f0-9]{36}$/.test(requested))return;
    const controller=new AbortController();
    void privateConversationDestination(requested,controller.signal).then(target=>{
      if(controller.signal.aborted)return;
      const url=new URL(window.location.href);if(url.searchParams.get("conversation")!==requested)return;
      url.searchParams.delete("conversation");window.history.replaceState(window.history.state,"",url);
      window.dispatchEvent(new Event("genesis:notification-inbox-open"));
      choose({spaceId:target.spaceId,userId:target.peerId,displayName:target.peerName});
    }).catch(()=>{if(!controller.signal.aborted){setFailed('inbox');window.dispatchEvent(new Event("genesis:notification-inbox-open"));}});
    return()=>controller.abort();
  },[userId,choose]);
  const c=(key:Parameters<typeof collaborationText>[0])=>collaborationText(key,language);
  const respond=async(item:PrivateInvitation,accept:boolean)=>{
    if(busy)return false;setBusy(item.id);setFailed('');
    try {
      if(accept)await identityFor(userId,true);
      await respondPrivateInvitation(item.id,accept);
      setInvitations(current=>current.filter(invite=>invite.id!==item.id));window.dispatchEvent(new Event('genesis:private-updates'));
      if(accept)choose({spaceId:item.spaceId,userId:item.peerId,displayName:item.peerName});
      return true;
    } catch(error){setFailed(item.id);if(accept&&error instanceof Error&&error.message==='LOCAL_KEY_MISSING')choose({spaceId:item.spaceId,userId:item.peerId,displayName:item.peerName});return false;}
    finally{setBusy('');}
  };
  const count=items.reduce((total,item)=>total+item.unread,0);
  useEffect(()=>{onActivity?.({count:count+invitations.length,tokens:[...invitations.map(item=>`private-invitation:${item.id}`),...items.filter(item=>item.unread>0).map(item=>`private:${item.id}:${item.latestSeq}`)],title:collaborationText('unread',language)});},[items,invitations,count,language,onActivity]);
  return <><aside className={embedded?"notification-private-items":"shared-private-notices"} hidden={embedded&&view==='contacts'} data-no-translate aria-live={embedded?undefined:"polite"}>{failed==='inbox'?<p role="alert">{c('failure')}</p>:null}{invitations.map(item=><article className="shared-private-invitation-notice" key={item.id}>
    <strong>{c('invitationTitle')}</strong><p>{item.peerName} · {item.spaceTitle}</p><p>{c('invitationReceived')}</p>
    <div className="shared-private-actions"><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={()=>void respond(item,true)}>{c('acceptInvitation')}</button><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={()=>void respond(item,false)}>{c('declineInvitation')}</button></div>
    {failed===item.id?<p role="alert">{c('failure')}</p>:null}
  </article>)}{embedded?items.filter(item=>item.unread>0).map(item=><button type="button" className="shared-private-notice" key={item.id} onClick={()=>choose({spaceId:item.spaceId,userId:item.peerId,displayName:item.peerName})}><span className="notification-item-heading"><ExperimentalIcon name="mail"/><strong>{item.peerName}</strong><span>{item.unread}</span></span><span>{item.spaceTitle}</span><span>{c('messages')}</span></button>):count?<button type="button" className="primary-button" onClick={()=>setOpen(true)}><ExperimentalIcon name="mail"/>{c('unread')} · {count}</button>:null}</aside>
    <dialog ref={dialog} className="shared-projects-modal" data-no-translate onClose={()=>setOpen(false)} aria-label={collaborationText('messages',language)}><header><h2>{collaborationText('messages',language)}</h2><DialogCloseButton type="button" className="shared-projects-close" aria-label={translateText('Закрыть')} onClick={()=>setOpen(false)} /></header>{items.map(item=><button type="button" className="shared-private-notice" key={item.id} onClick={()=>{setOpen(false);setPeer({spaceId:item.spaceId,userId:item.peerId,displayName:item.peerName});}}><strong>{item.peerName}</strong><span>{item.spaceTitle} · {item.unread}</span></button>)}</dialog>
    {embedded?<div className="notification-conversations" hidden={view!=='contacts'}>
      <div hidden={Boolean(peer)}><PrivateConversationList key={userId} userId={userId} language={language} active={active&&view==='contacts'&&!peer} onOpen={choose}/></div>
      {peer?<SharedPrivateMessages key={userId+peer.spaceId+peer.userId} userId={userId} peer={peer} language={language} embedded active={active&&view==='contacts'} onClose={()=>setPeer(null)}/>:null}
    </div>:peer?<SharedPrivateMessages key={userId+peer.spaceId+peer.userId} userId={userId} peer={peer} language={language} onClose={()=>setPeer(null)}/>:null}</>;
}
