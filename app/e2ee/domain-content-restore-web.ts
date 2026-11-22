import type {WebPrivateAccount} from './product-session.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {E2eeDiaryRepository} from './diary-product.ts';
import {E2eeMindmapRepository} from './mindmaps-product.ts';
import {DomainContentRestore,validateDomainRestoreJournal,type DomainRestoreJournal} from './domain-content-restore.ts';
export const DOMAIN_RESTORE_PREFIX='domain-content-restore:';
export function webDomainContentRestore(account:WebPrivateAccount,guard:()=>void){
 const current=()=>{guard();account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');};
 const diary=new E2eeDiaryRepository(account.ownerId),maps=new E2eeMindmapRepository(account.ownerId);
 const document=(id:string)=>new E2eeDeviceDocument<DomainRestoreJournal>(account.device,DOMAIN_RESTORE_PREFIX+id,value=>validateDomainRestoreJournal(value,account.ownerId,id),current);
 return new DomainContentRestore({ownerId:account.ownerId,current,load:id=>document(id).load(),save:async(id,value,expected)=>(await document(id).save(value,expected)).serial,list:async()=>(await account.device.vault.listLocal('draft',DOMAIN_RESTORE_PREFIX)).map(id=>id.slice(DOMAIN_RESTORE_PREFIX.length)),
  read:async domain=>domain==='diary'?diary.restoreView():maps.restoreView(),add:async(domain,value)=>{current();if(domain==='diary')await diary.restoreAdd(value);else await maps.restoreAdd(value);current();},flush:async domain=>{if(domain==='diary')await diary.list();else await maps.restoreView();current();},
 });
}
