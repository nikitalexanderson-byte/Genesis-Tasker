import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import Messenger from '../../app/Messenger';
import {loadGenesisSession,loadGenesisWorkspace} from '../../app/cloud-sync';
import {PrivateMigrationEntry,PrivateMigrationGate} from '../../app/PrivateMigrationGate';
import {PrivateVaultGate} from '../../app/PrivateVaultGate';
import {waitForPrivateAccount,privateAccountIsRequired,requirePrivateAccount} from '../../app/e2ee/product-session';
import {E2eeMessageLocal} from '../../app/e2ee/message-local';
import {claimMessengerDevice,messengerPending} from '../../app/private-message-vault';
import {messengerComposeCell,parseMessengerCompose} from '../../app/messenger-compose';
import {createMessagingIdentity,conversationKey,encryptPrivateMessage} from '../../app/private-message-crypto';
import type {} from './messenger-secret-browser-check';

// Public throwaway chat metadata is shared with the modeled chat transport.
// Account enrollment, complete migration sources, recovery and local storage
// remain the actual product implementations. No key or successful auth result
// is supplied by this fixture.
declare global {interface Window {
 genesisSecretQaLocalCells?:()=>Promise<{privateMode:boolean;cells:{name:string;sha256:string|null}[]}>;
 genesisSecretQaTaskRetained?:boolean;
}}
const initial=await loadGenesisSession();if(!initial)throw new Error('Synthetic session required');
async function localPendingKeys(ownerId:string){
 return new Promise<string[]>((done,fail)=>{
  const request=indexedDB.open('genesis-private-messaging-v1',1);request.onerror=()=>fail(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('keys','readonly'),scan=tx.objectStore('keys').getAllKeys();let keys:string[]=[];
   scan.onsuccess=()=>{keys=scan.result.filter((key):key is string=>typeof key==='string'&&key.startsWith('messenger-pending:'+ownerId+':')).sort();};
   tx.oncomplete=()=>{db.close();done(keys);};tx.onerror=tx.onabort=()=>{db.close();fail(new Error('Synthetic inventory failed'));};
  };
 });
}
function Fixture(){
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;void(async()=>{
  if(initial!.privateVault)await waitForPrivateAccount(initial!.uid,initial!.language);
  const workspace=await loadGenesisWorkspace();
  window.genesisSecretQaTaskRetained=workspace.tasks.some(task=>task.title==='Retained ordinary migration task62');
  const claimed=await claimMessengerDevice(initial!.uid,{id:crypto.randomUUID(),identity:await createMessagingIdentity()});
  if(!claimed)throw new Error('KEY_STORAGE_UNAVAILABLE');
  let fixture=window.genesisSecretQaPublic;
  if(!fixture){
   const peer=await createMessagingIdentity(),chatId=crypto.randomUUID(),messageId=crypto.randomUUID(),peerId='synthetic-secret-peer';
   const key=await conversationKey(peer,claimed.identity.publicKey,chatId,'messenger-secret-v1');
   const payload=await encryptPrivateMessage(key,{conversationId:chatId,spaceId:'messenger-secret-v1',id:messageId,senderId:peerId,revision:1},'Retained secret history',{[initial!.uid]:claimed.identity.keyId,[peerId]:peer.keyId});
   fixture={chatId,messageId,peerId,peerDevice:crypto.randomUUID(),peer:{keyId:peer.keyId,publicKey:peer.publicKey},payload};
  }
  if(!live)return;
  window.genesisSecretQa={...fixture,ownerId:initial!.uid,deviceId:claimed.id,own:{keyId:claimed.identity.keyId,publicKey:claimed.identity.publicKey}};
  window.genesisSecretQaCompositionRetained=async(text,editing)=>{
   const chat=String(fixture!.chatId),raw=await messengerPending(initial!.uid,messengerComposeCell(chat));if(raw===null)return false;
   const value=parseMessengerCompose(JSON.parse(raw),initial!.uid,chat);return value.text===text&&(value.edit!==null)===editing;
  };
  window.genesisSecretQaLocalCells=async()=>{
   const owner=initial!.uid,privateMode=privateAccountIsRequired(owner),account=privateMode?requirePrivateAccount(owner):null;
   const protectedStore=account?new E2eeMessageLocal(account):null,cells=[];
   for(const name of await localPendingKeys(owner)){
    // Direct protected read is deliberate: this assertion must not lazily
    // adopt a missing cell from the legacy store and conceal failed adoption.
    const saved=protectedStore?await protectedStore.read(name):null;
    const value=protectedStore?saved?.value.value:await messengerPending(owner,name.slice(('messenger-pending:'+owner+':').length));
    if(value!==null&&value!==undefined&&typeof value!=='string')throw new Error('E2EE_MESSAGE_CELL_INVALID');
    const digest=typeof value==='string'?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join(''):null;
    cells.push({name,sha256:digest});
   }
   account?.requireOpen();return{privateMode,cells};
  };
  setReady(true);
 })().catch(reason=>{if(live)setError(reason instanceof Error?reason.message.match(/\b(?:E2EE|KEY_STORAGE)_[A-Z_]+\b/)?.[0]??'FIXTURE_BOOT_FAILED':'FIXTURE_BOOT_FAILED');});return()=>{live=false;};
 },[]);
 return <><div id="genesis-app-content">{error?<p role="alert">{error}</p>:null}{ready?<><PrivateMigrationEntry user={{...initial!,language:'en'}}/><Messenger userId={initial!.uid} language="en"/></>:<p role="status">Loading ordinary workspace</p>}</div><PrivateMigrationGate/><PrivateVaultGate/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
