import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import Messenger from '../../app/Messenger';
import {loadGenesisSession} from '../../app/cloud-sync';
import {claimMessengerDevice,messengerPending} from '../../app/private-message-vault';
import {messengerComposeCell,parseMessengerCompose} from '../../app/messenger-compose';
import {createMessagingIdentity,conversationKey,encryptPrivateMessage} from '../../app/private-message-crypto';
import copy from '../../app/messenger-copy.json';

// Public throwaway fixture metadata only. No private key leaves the real IDB
// device store; the driver supplies chat replies, not authentication authority.
declare global {interface Window {genesisSecretQa?:Record<string,unknown>;genesisSecretQaPublic?:Record<string,unknown>;genesisSecretQaDraftRetained?:()=>Promise<boolean>;genesisSecretQaCompositionRetained?:(text:string,editing:boolean)=>Promise<boolean>;genesisSecretQaConflictRetained?:()=>Promise<boolean>;}}
const user=await loadGenesisSession();if(!user)throw new Error('Synthetic session required');
const claimed=await claimMessengerDevice(user.uid,{id:crypto.randomUUID(),identity:await createMessagingIdentity()});
if(!claimed)throw new Error('Actual device storage required');
let fixture=window.genesisSecretQaPublic;
if(!fixture){
 const [peer,replacement]=await Promise.all([createMessagingIdentity(),createMessagingIdentity()]);
 const chatId=crypto.randomUUID(),messageId=crypto.randomUUID(),peerId='synthetic-secret-peer';
 const key=await conversationKey(peer,claimed.identity.publicKey,chatId,'messenger-secret-v1');
 const payload=await encryptPrivateMessage(key,{conversationId:chatId,spaceId:'messenger-secret-v1',id:messageId,senderId:peerId,revision:1},'Retained secret history',{[user.uid]:claimed.identity.keyId,[peerId]:peer.keyId});
 fixture={chatId,messageId,peerId,peerDevice:crypto.randomUUID(),peer:{keyId:peer.keyId,publicKey:peer.publicKey},replacement:{keyId:replacement.keyId,publicKey:replacement.publicKey},payload};
}
window.genesisSecretQa={...fixture,ownerId:user.uid,deviceId:claimed.id,own:{keyId:claimed.identity.keyId,publicKey:claimed.identity.publicKey}};
window.genesisSecretQaCompositionRetained=async(text,editing)=>{const chat=String(fixture!.chatId),raw=await messengerPending(user.uid,messengerComposeCell(chat));if(raw===null)return false;const value=parseMessengerCompose(JSON.parse(raw),user.uid,chat);return value.text===text&&(value.edit!==null)===editing;};
window.genesisSecretQaDraftRetained=()=>window.genesisSecretQaCompositionRetained!('Retained unsent secret draft',false);
window.genesisSecretQaConflictRetained=async()=>{
 const keys=await new Promise<IDBValidKey[]>((done,fail)=>{const request=indexedDB.open('genesis-private-messaging-v1',1);request.onerror=()=>fail(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('keys','readonly'),scan=tx.objectStore('keys').getAllKeys();let result:IDBValidKey[]=[];scan.onsuccess=()=>{result=scan.result;};tx.oncomplete=()=>{db.close();done(result);};tx.onerror=tx.onabort=()=>{db.close();fail(new Error('Synthetic key inventory failed'));};};});
 const prefix='messenger-pending:'+user.uid+':',chat=String(fixture!.chatId);
 for(const key of keys)if(typeof key==='string'&&key.startsWith(prefix+'draft:'+chat+':compose-conflict:')){const raw=await messengerPending(user.uid,key.slice(prefix.length));if(raw!==null&&parseMessengerCompose(JSON.parse(raw),user.uid,chat).text==='Competing unsent draft')return true;}return false;
};
function Fixture(){const[language,setLanguage]=useState('en');return <><label>QA language<select aria-label="QA language" value={language} onChange={event=>setLanguage(event.target.value)}>{Object.keys(copy).map(value=><option key={value}>{value}</option>)}</select></label><Messenger userId={user!.uid} language={language}/></>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
