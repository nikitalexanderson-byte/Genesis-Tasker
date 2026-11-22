import {E2eeDeviceDocument} from './device-document.ts';
import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {samePrivateJson as same} from './product-json.ts';
import {WorkDraftError,type WorkDraft,type SharedWorkDraftPurpose} from '../shared-work-draft-journal.ts';

type State<T>={format:'genesis-private-shared-work-draft-v1';ownerId:string;projectId:string;purpose:SharedWorkDraftPurpose;id:string;at:string;active:boolean;value:T};
const listeners=new Map<string,Set<()=>void>>();
/** Device-root drafts use no legacy cipher/storage/transport. Every replaced
 * or acknowledged value is retained in an immutable separate history document.
 * Restoring a draft never recreates a signer, receipt or consent. */
export class PrivateSharedWorkDraftJournal<T>{
 readonly writerId=crypto.randomUUID();private serial:Promise<unknown>=Promise.resolve();private closed=false;private account:WebPrivateAccount|null=null;
 private readonly prefix:string;private readonly historyPrefix:string;
 constructor(private readonly options:{ownerId:string;projectId:string;purpose:SharedWorkDraftPurpose;validate:(value:unknown)=>T;maxBytes?:number}){assertTechnical(options.ownerId);assertTechnical(options.projectId);this.prefix='shared-work-private:'+options.projectId+':'+options.purpose+':';this.historyPrefix='shared-work-history:'+options.projectId+':'+options.purpose+':';}
 private current(){if(this.closed)throw new WorkDraftError('DRAFT_CLOSED');const account=requirePrivateAccount(this.options.ownerId);if(this.account&&this.account!==account)throw new WorkDraftError('DRAFT_CLOSED');this.account??=account;account.requireOpen();return account;}
 private run<R>(work:()=>Promise<R>){const pending=this.serial.catch(()=>undefined).then(async()=>{this.current();return work();});this.serial=pending;return pending;}
 private validate(input:unknown,id:string):State<T>{exactKeys(input,['format','ownerId','projectId','purpose','id','at','active','value']);if(input.format!=='genesis-private-shared-work-draft-v1'||input.ownerId!==this.options.ownerId||input.projectId!==this.options.projectId||input.purpose!==this.options.purpose||input.id!==id||typeof input.at!=='string'||!Number.isFinite(Date.parse(input.at))||typeof input.active!=='boolean')throw new WorkDraftError('DRAFT_INVALID');return{...input,value:this.options.validate(input.value)} as State<T>;}
 private document(id:string,historySerial?:number){assertTechnical(id);const objectId=historySerial===undefined?this.prefix+id:this.historyPrefix+id+':'+historySerial;return new E2eeDeviceDocument<State<T>>(this.current().device,objectId,value=>this.validate(value,id),()=>{this.current();});}
 private row(value:State<T>,serial:number):WorkDraft<T>{return{id:value.id,at:value.at,value:structuredClone(value.value),raw:JSON.stringify({format:'genesis-private-shared-work-ref-v1',id:value.id,serial})};}
 private async retain(id:string,previous:{value:State<T>;serial:number}){const document=this.document(id,previous.serial),old=await document.load();this.current();if(old){if(!same(old.value,previous.value))throw new WorkDraftError('DRAFT_CHANGED');return;}await document.save(previous.value,null);this.current();const read=await document.load();this.current();if(!read||!same(read.value,previous.value))throw new WorkDraftError('DRAFT_INVALID');}
 private notify(){for(const listener of listeners.get(this.options.ownerId+':'+this.prefix)??[])listener();}
 list(){return this.run(async()=>{const account=this.current(),keys=await account.device.vault.listLocal('draft',this.prefix);this.current();if(keys.length>10000)throw new WorkDraftError('DRAFT_LIMIT');const rows:WorkDraft<T>[]=[];for(const key of keys){const id=key.slice(this.prefix.length),opened=await this.document(id).load();this.current();if(!opened)throw new WorkDraftError('DRAFT_CHANGED');if(opened.value.active)rows.push(this.row(opened.value,opened.serial));}return rows.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id));});}
 write(input:T){const value=this.options.validate(structuredClone(input));if(new TextEncoder().encode(JSON.stringify(value)).length>(this.options.maxBytes??64*1024*1024))throw new WorkDraftError('DRAFT_TOO_LARGE');return this.run(async()=>{
  const document=this.document(this.writerId),old=await document.load();this.current();if(old)await this.retain(this.writerId,old);
  const state:State<T>={format:'genesis-private-shared-work-draft-v1',ownerId:this.options.ownerId,projectId:this.options.projectId,purpose:this.options.purpose,id:this.writerId,at:new Date().toISOString(),active:true,value};
  const saved=await document.save(state,old?.serial??null);this.current();const read=await document.load();this.current();if(!read||read.serial!==saved.serial||!same(read.value,state))throw new WorkDraftError('DRAFT_CHANGED');this.notify();return this.row(state,read.serial);
 });}
 remove(record:Pick<WorkDraft<T>,'id'|'raw'>){assertTechnical(record.id);const reference=JSON.parse(record.raw);exactKeys(reference,['format','id','serial']);if(reference.format!=='genesis-private-shared-work-ref-v1'||reference.id!==record.id||!Number.isSafeInteger(reference.serial)||reference.serial<1)throw new WorkDraftError('DRAFT_CHANGED');return this.run(async()=>{
  const document=this.document(record.id),old=await document.load();this.current();if(!old)return;if(old.serial!==reference.serial)throw new WorkDraftError('DRAFT_CHANGED');if(!old.value.active)return;await this.retain(record.id,old);const next={...old.value,active:false},saved=await document.save(next,old.serial);this.current();const read=await document.load();this.current();if(!read||read.serial!==saved.serial||!same(read.value,next))throw new WorkDraftError('DRAFT_CHANGED');this.notify();
 });}
 async flush(){await this.serial;this.current();}
 subscribe(listener:()=>void){const key=this.options.ownerId+':'+this.prefix;let current=listeners.get(key);if(!current)listeners.set(key,current=new Set());current.add(listener);return()=>{current!.delete(listener);if(!current!.size)listeners.delete(key);};}
 dispose(){this.closed=true;this.account=null;}
}

/** Header classification for retained originals only; the actual editor's
 * complete validator still runs before restoration, staging or submission. */
export function inspectPrivateSharedWorkDraft(input:unknown,ownerId:string){
 exactKeys(input,['format','ownerId','projectId','purpose','id','at','active','value']);if(input.format!=='genesis-private-shared-work-draft-v1'||input.ownerId!==ownerId||typeof input.active!=='boolean'||typeof input.at!=='string'||!Number.isFinite(Date.parse(input.at))||!['workflow','planning','planning-tasks','custom-fields','saved-views','templates','template-apply','automations','project-access','data-import','stoicheion-restoration'].includes(String(input.purpose)))throw new WorkDraftError('DRAFT_INVALID');for(const key of ['projectId','id'])assertTechnical(input[key]);return structuredClone(input) as State<unknown>;
}
