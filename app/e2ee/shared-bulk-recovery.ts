import {privateAccountIsRequired,requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {exactKeys} from './keys.ts';
import {samePrivateJson} from './product-json.ts';
import {bulkRecoveryKey,readBulkRecovery,type BulkRecovery} from '../shared-bulk-model.ts';

type Recovery={format:'genesis-private-bulk-recovery-v1';ownerId:string;value:BulkRecovery};
const pending=new WeakMap<WebPrivateAccount,Promise<unknown>>();
export function validatePrivateBulkRecovery(input:unknown,ownerId:string):Recovery{
 exactKeys(input,['format','ownerId','value']);if(input.format!=='genesis-private-bulk-recovery-v1'||input.ownerId!==ownerId)throw new Error('E2EE_PRIVATE_BULK_INVALID');
 const value=readBulkRecovery({getItem:()=>JSON.stringify(input.value)},ownerId);if(!samePrivateJson(value,input.value))throw new Error('E2EE_PRIVATE_BULK_INVALID');return input as Recovery;
}
function document(account:WebPrivateAccount,id='shared-bulk-recovery:v1'){return new E2eeDeviceDocument(account.device,id,value=>validatePrivateBulkRecovery(value,account.ownerId),()=>account.requireOpen());}
export async function loadBulkRecovery(ownerId:string){
 if(!privateAccountIsRequired(ownerId))return readBulkRecovery(localStorage,ownerId);
 const account=requirePrivateAccount(ownerId);await pending.get(account);account.requireOpen();const saved=await document(account).load();account.requireOpen();return saved?.value.value??{};
}
export async function saveBulkRecovery(ownerId:string,value:BulkRecovery){
 if(!privateAccountIsRequired(ownerId)){if(Object.keys(value).length)localStorage.setItem(bulkRecoveryKey(ownerId),JSON.stringify(value));else localStorage.removeItem(bulkRecoveryKey(ownerId));return;}
 const account=requirePrivateAccount(ownerId),held=validatePrivateBulkRecovery({format:'genesis-private-bulk-recovery-v1',ownerId,value:structuredClone(value)},ownerId),task=(pending.get(account)??Promise.resolve()).catch(()=>undefined).then(async()=>{
  account.requireOpen();const store=document(account),before=await store.load();account.requireOpen();if(before&&samePrivateJson(before.value,held))return;
  if(before){const retained=document(account,`shared-bulk-recovery-history:${before.serial}`),old=await retained.load();account.requireOpen();if(old&&!samePrivateJson(old.value,before.value))throw new Error('E2EE_LOCAL_CONFLICT');if(!old)await retained.save(before.value,null);account.requireOpen();}
  await store.save(held,before?.serial??null);account.requireOpen();
 });pending.set(account,task);await task;
}
