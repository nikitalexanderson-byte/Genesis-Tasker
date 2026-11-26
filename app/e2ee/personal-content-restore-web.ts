import type {WebPrivateAccount} from './product-session.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {E2eePersonalProduct} from './personal-product.ts';
import {PersonalContentRestore,validatePersonalRestoreJournal,type PersonalRestoreJournal} from './personal-content-restore.ts';
import {samePrivateJson as same} from './product-json.ts';
export const PERSONAL_RESTORE_PREFIX='personal-content-restore:';
export function webPersonalContentRestore(account:WebPrivateAccount,guard:()=>void){
 const current=()=>{guard();account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');},product=new E2eePersonalProduct(account);
 const document=(id:string)=>new E2eeDeviceDocument<PersonalRestoreJournal>(account.device,PERSONAL_RESTORE_PREFIX+id,value=>validatePersonalRestoreJournal(value,account.ownerId,id),current);
 return new PersonalContentRestore({ownerId:account.ownerId,current,load:id=>document(id).load(),save:async(id,value,expected)=>(await document(id).save(value,expected)).serial,
  list:async()=>{const ids=await account.device.vault.listLocal('draft',PERSONAL_RESTORE_PREFIX);current();return ids.map(id=>id.slice(PERSONAL_RESTORE_PREFIX.length));},
  read:async()=>{await product.load('online');current();return product.restoreView();},
  apply:async(snapshot,expectedContentRevision,alreadyStaged)=>{current();const observed=product.restoreView();if(observed.contentRevision!==expectedContentRevision)throw new Error('E2EE_RESTORE_REVIEW_STALE');
   if(alreadyStaged){if(!same(observed.snapshot,snapshot))throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');await product.flush();}else await product.restoreSnapshot(snapshot,expectedContentRevision);current();},
 });
}
