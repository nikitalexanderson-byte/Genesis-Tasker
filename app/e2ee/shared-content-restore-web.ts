import type {WebPrivateAccount} from './product-session.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {SharedContentRestore,validateSharedRestoreJournal,type SharedRestoreJournal} from './shared-content-restore.ts';
import {privateSharedRestoreRequest} from './shared-web-live.ts';
export const SHARED_RESTORE_PREFIX='shared-content-restore:';
export function webSharedContentRestore(account:WebPrivateAccount,guard:()=>void){
 const current=()=>{guard();account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');},document=(id:string)=>new E2eeDeviceDocument<SharedRestoreJournal>(account.device,SHARED_RESTORE_PREFIX+id,value=>validateSharedRestoreJournal(value,account.ownerId,id),current);
 return new SharedContentRestore({ownerId:account.ownerId,current,load:id=>document(id).load(),save:async(id,value,expected)=>(await document(id).save(value,expected)).serial,list:async()=>(await account.device.vault.listLocal('draft',SHARED_RESTORE_PREFIX)).map(id=>id.slice(SHARED_RESTORE_PREFIX.length)),capture:binding=>privateSharedRestoreRequest(account.ownerId,binding,'GET','execution/capture',{},current),request:(binding,path,input)=>privateSharedRestoreRequest(account.ownerId,binding,'POST',path,input,current)});
}
