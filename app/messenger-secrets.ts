import {claimMessengerDevice, pinMessengerChat} from './private-message-vault';
import {createMessagingIdentity,keyFingerprint,conversationKey,securityCode,type MessagingIdentity} from './private-message-crypto';
import {messengerRequest,type MessengerChat} from './messenger-api';
import {captureMessagingAccess} from './e2ee/message-lifetime';
export type LocalMessengerDevice={id:string;identity:MessagingIdentity};
/** Independent of legacy account-wide keys. Never exports/uploads a private key. */
export async function messengerDevice(userId:string):Promise<LocalMessengerDevice>{
  const current=captureMessagingAccess(userId),identity=await createMessagingIdentity();current();
  const saved=await claimMessengerDevice(userId,{id:crypto.randomUUID(),identity});current();
  if(!saved)throw new Error('KEY_STORAGE_UNAVAILABLE');
  await messengerRequest('/devices','POST',{id:saved.id,publicKey:saved.identity.publicKey,label:'Web'});
  current();
  return saved;
}
export async function messengerSecret(userId:string,chat:MessengerChat,device:LocalMessengerDevice){
  const current=captureMessagingAccess(userId);
  const own=chat.members.find(m=>m.userId===userId),peer=chat.members.find(m=>m.userId!==userId);
  if(chat.kind!=='secret'||chat.members.length!==2||own?.deviceId!==device.id||own.keyId!==device.identity.keyId)throw new Error('MESSENGER_SECRET_DEVICE_ONLY');
  if(!peer?.publicKey||!peer.keyId||peer.status!=='active'||peer.revokedAt||own.revokedAt)throw new Error('MESSENGER_SECRET_NOT_READY');
  if(await keyFingerprint(peer.publicKey)!==peer.keyId)throw new Error('MESSENGER_DEVICE_CHANGED');
  current();
  await pinMessengerChat(userId,chat.id,JSON.stringify(chat.members.map(m=>[m.userId,m.deviceId,m.keyId]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))));
  current();const key=await conversationKey(device.identity,peer.publicKey,chat.id,'messenger-secret-v1');current();
  const code=await securityCode([own.keyId,peer.keyId]);current();return {key,keyIds:{[userId]:own.keyId,[peer.userId]:peer.keyId},code};
}
