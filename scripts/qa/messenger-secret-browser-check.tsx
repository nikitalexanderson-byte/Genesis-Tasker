import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import Messenger from '../../app/Messenger';
import {loadGenesisSession} from '../../app/cloud-sync';
import {claimMessengerDevice,messengerPending} from '../../app/private-message-vault';
import {createMessagingIdentity,conversationKey,encryptPrivateMessage} from '../../app/private-message-crypto';
import copy from '../../app/messenger-copy.json';

// Public throwaway fixture metadata only. No private key leaves the real IDB
// device store; the driver supplies chat replies, not authentication authority.
declare global {interface Window {genesisSecretQa?:Record<string,unknown>;genesisSecretQaPublic?:Record<string,unknown>;genesisSecretQaDraftRetained?:()=>Promise<boolean>;}}
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
window.genesisSecretQaDraftRetained=async()=>await messengerPending(user.uid,'draft:'+fixture!.chatId)==='Retained unsent secret draft';
function Fixture(){const[language,setLanguage]=useState('en');return <><label>QA language<select aria-label="QA language" value={language} onChange={event=>setLanguage(event.target.value)}>{Object.keys(copy).map(value=><option key={value}>{value}</option>)}</select></label><Messenger userId={user!.uid} language={language}/></>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
