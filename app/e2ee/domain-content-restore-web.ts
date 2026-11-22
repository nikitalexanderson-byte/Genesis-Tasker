import type {WebPrivateAccount} from './product-session.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {E2eeDiaryRepository} from './diary-product.ts';
import {E2eeMindmapRepository} from './mindmaps-product.ts';
import {DomainContentRestore,validateDomainRestoreJournal,type DomainRestoreJournal} from './domain-content-restore.ts';
import {physisFeatureDocument} from './physis-product.ts';
import {currentFeatureAccess,requireFeature} from '../feature-access.ts';
import type {PhysisRecord} from '../physis/types.ts';
import {AuroraPrivateRepository,privateAuroraDocument} from './aurora-product.ts';
export const DOMAIN_RESTORE_PREFIX='domain-content-restore:';
export function webDomainContentRestore(account:WebPrivateAccount,guard:()=>void){
 const current=()=>{guard();account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');};
 const diary=new E2eeDiaryRepository(account.ownerId),maps=new E2eeMindmapRepository(account.ownerId),physis=physisFeatureDocument(account.ownerId),aurora=new AuroraPrivateRepository(account.ownerId,privateAuroraDocument(account.ownerId));
 const document=(id:string)=>new E2eeDeviceDocument<DomainRestoreJournal>(account.device,DOMAIN_RESTORE_PREFIX+id,value=>validateDomainRestoreJournal(value,account.ownerId,id),current);
 return new DomainContentRestore({ownerId:account.ownerId,current,load:id=>document(id).load(),save:async(id,value,expected)=>(await document(id).save(value,expected)).serial,list:async()=>(await account.device.vault.listLocal('draft',DOMAIN_RESTORE_PREFIX)).map(id=>id.slice(DOMAIN_RESTORE_PREFIX.length)),
  read:async domain=>{if(domain==='diary')return diary.restoreView();if(domain==='mindmap')return maps.restoreView();if(domain==='aurora')return aurora.restoreView();requireFeature(currentFeatureAccess(account.ownerId),'physis');const before=await physis.read(true);if(before.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');const view=await physis.flush();current();return{checkpoint:'physis:'+view.remoteRevision,pending:view.pending,records:view.document.records.map(row=>({id:row.id,revision:row.revision,deleted:row.deleted,value:row.record,localOnly:false}))};},
  add:async(domain,value)=>{current();if(domain==='diary')await diary.restoreAdd(value);else if(domain==='mindmap')await maps.restoreAdd(value);else if(domain==='aurora')await aurora.restoreAdd(value);else{requireFeature(currentFeatureAccess(account.ownerId),'physis');const before=await physis.read(false);current();if(before.pending||before.conflict||before.document.records.some(row=>row.id===value.id))throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');await physis.write({...before.document,records:[...before.document.records,{id:String(value.id),record:value as unknown as PhysisRecord,revision:1,deleted:false}]});current();await physis.flush();}current();},flush:async domain=>{if(domain==='diary')await diary.list();else if(domain==='mindmap')await maps.restoreView();else if(domain==='aurora')await aurora.load();else await physis.flush();current();},
 });
}
