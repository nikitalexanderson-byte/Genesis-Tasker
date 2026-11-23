import {sha256} from '@noble/hashes/sha2.js';
import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {validateDiaryNote} from '../diary-model.ts';
import {validateMindmap} from '../mindmaps-model.ts';
import {validatePhysisRecord} from '../physis/validation.ts';
import {validateDocument as validateAuroraDocument,type AuroraSession} from '../aurora/session.ts';
import {normalizeRestorationWorks} from '../stoicheion-restoration-work.ts';

type Row=Record<string,unknown>;
export type RestoreDomain='diary'|'mindmap'|'physis'|'aurora'|'stoicheion';
export type DomainRestoreSource={domain:RestoreDomain;records:Row[]};
export type DomainRestoreRecord={id:string;revision:number;deleted:boolean;value:Row|null;localOnly:boolean};
export type DomainRestoreView={checkpoint:string;pending:boolean;records:DomainRestoreRecord[]};
type Proposal={before:DomainRestoreView;added:number;skipped:number;ids:string[];fingerprint:string};
export type DomainRestoreJournal={format:'genesis-domain-content-restore-v1';ownerId:string;intentId:string;backupId:string;source:DomainRestoreSource;proposal:Proposal|null;confirmed:string|null;started:boolean;complete:boolean;applied:string[]};
function invalid():never{throw new Error('E2EE_RESTORE_CONTENT_INVALID');}
const object=(value:unknown):Row=>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Row;};
const hash=(value:unknown)=>{const bytes=new TextEncoder().encode(canonicalJson(value));try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}};
export function domainRestoreRecord(domain:RestoreDomain,input:unknown):Row{
 if(domain==='diary')return validateDiaryNote(structuredClone(input)) as unknown as Row;
 if(domain==='mindmap'){const map=validateMindmap(structuredClone(input));if(map.projectId!==null&&map.projectId!==undefined)throw new Error('E2EE_RESTORE_DOMAIN_REQUIRED');return map as unknown as Row;}
 if(domain==='physis'){const record=structuredClone(input);if(!validatePhysisRecord(record))return invalid();return record as unknown as Row;}
 if(domain==='aurora'){const record=object(structuredClone(input));assertTechnical(record.id);assertTechnical(record.ownerId);if(record.version!==1)invalid();return record;}
 if(domain==='stoicheion')return normalizeRestorationWorks([structuredClone(input)])[0] as unknown as Row;
 return invalid();
}
export function validateDomainRestoreSource(input:unknown):DomainRestoreSource{
 exactKeys(input,['domain','records']);if(!['diary','mindmap','physis','aurora','stoicheion'].includes(String(input.domain))||!Array.isArray(input.records)||!input.records.length||input.records.length>10000)invalid();
 const domain=input.domain as RestoreDomain,records=input.records.map(row=>domainRestoreRecord(domain,row));if(new Set(records.map(row=>row.id)).size!==records.length)invalid();return{domain,records};
}
export async function validateDomainRestoreSourceDeep(source:DomainRestoreSource,ownerId:string){if(source.domain==='aurora')await validateAuroraDocument({version:1,ownerId,sessions:source.records as unknown as AuroraSession[],removed:[]},ownerId);}
export function validateDomainRestoreView(input:unknown,domain:RestoreDomain):DomainRestoreView{
 exactKeys(input,['checkpoint','pending','records']);if(typeof input.checkpoint!=='string'||!input.checkpoint||input.checkpoint.length>4096||typeof input.pending!=='boolean'||!Array.isArray(input.records)||input.records.length>20000)invalid();
 const identities=new Set<string>();for(const row of input.records){exactKeys(row,['id','revision','deleted','value','localOnly']);assertTechnical(row.id);if(!Number.isSafeInteger(row.revision)||Number(row.revision)<0||typeof row.deleted!=='boolean'||typeof row.localOnly!=='boolean')invalid();const key=String(row.localOnly)+':'+row.id;if(identities.has(key))invalid();identities.add(key);if(row.deleted?row.value!==null:domainRestoreRecord(domain,row.value).id!==row.id)invalid();}
 return structuredClone(input) as DomainRestoreView;
}
function proposal(source:DomainRestoreSource,raw:unknown):Proposal{
 const before=validateDomainRestoreView(raw,source.domain);if(before.pending)throw new Error('E2EE_PENDING_REVIEW_REQUIRED');const existing=new Set(before.records.map(row=>row.id)),ids=source.records.filter(row=>!existing.has(String(row.id))).map(row=>String(row.id));const value={before,added:ids.length,skipped:source.records.length-ids.length,ids};return{...value,fingerprint:hash({format:'genesis-domain-content-restore-review-v1',source,...value})};
}
export function validateDomainRestoreJournal(input:unknown,ownerId:string,id:string):DomainRestoreJournal{
 exactKeys(input,['format','ownerId','intentId','backupId','source','proposal','confirmed','started','complete','applied']);if(input.format!=='genesis-domain-content-restore-v1'||input.ownerId!==ownerId||input.intentId!==id||typeof input.started!=='boolean'||typeof input.complete!=='boolean'||!Array.isArray(input.applied)||input.applied.length>10000||new Set(input.applied).size!==input.applied.length)invalid();assertTechnical(id);assertTechnical(input.backupId);const source=validateDomainRestoreSource(input.source);
 if(input.proposal!==null){exactKeys(input.proposal,['before','added','skipped','ids','fingerprint']);if(!same(proposal(source,input.proposal.before),input.proposal))invalid();}
 const checkedProposal=input.proposal as Proposal|null;
 if(input.confirmed!==null&&(!checkedProposal||input.confirmed!==checkedProposal.fingerprint)||input.started&&input.confirmed===null||input.applied.some(value=>typeof value!=='string'||!checkedProposal||!(checkedProposal.ids as string[]).includes(value))||input.applied.length&&!input.started||input.complete&&(!input.started||input.applied.length!==(checkedProposal?.ids as string[]|undefined)?.length))invalid();return structuredClone(input) as DomainRestoreJournal;
}
export interface DomainRestorePorts{ownerId:string;current:()=>void;load:(id:string)=>Promise<{value:unknown;serial:number}|null>;save:(id:string,value:DomainRestoreJournal,expected:number|null)=>Promise<number>;list:()=>Promise<string[]>;read:(domain:RestoreDomain)=>Promise<unknown>;add:(domain:RestoreDomain,value:Row)=>Promise<void>;flush:(domain:RestoreDomain)=>Promise<void>}
/** Fresh, add-only content operations. Source bytes and the reviewed plan stay
 * encrypted before IO; existing records and tombstones are never replaced. */
export class DomainContentRestore{
 #serial:Promise<unknown>=Promise.resolve();constructor(private readonly ports:DomainRestorePorts){}
 #run<T>(operation:()=>Promise<T>){const next=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return operation();});this.#serial=next;return next;}
 async #load(id:string){assertTechnical(id);const row=await this.ports.load(id);this.ports.current();if(!row)throw new Error('E2EE_RESTORE_REQUIRED');const value=validateDomainRestoreJournal(row.value,this.ports.ownerId,id);await validateDomainRestoreSourceDeep(value.source,this.ports.ownerId);this.ports.current();return{...row,value};}
 async #save(value:DomainRestoreJournal,serial:number|null){validateDomainRestoreJournal(value,this.ports.ownerId,value.intentId);const next=await this.ports.save(value.intentId,value,serial);this.ports.current();const saved=await this.#load(value.intentId);if(next!==(serial??0)+1||saved.serial!==next||!same(saved.value,value))throw new Error('E2EE_LOCAL_CONFLICT');return saved;}
 async #read(domain:RestoreDomain){const view=validateDomainRestoreView(await this.ports.read(domain),domain);this.ports.current();if(domain==='aurora'){const records=view.records.filter(row=>!row.deleted).map(row=>row.value!);if(records.length)await validateDomainRestoreSourceDeep({domain,records},this.ports.ownerId);}this.ports.current();return view;}
 create(backupId:string,input:unknown){const source=validateDomainRestoreSource(input);assertTechnical(backupId);return this.#run(async()=>{await validateDomainRestoreSourceDeep(source,this.ports.ownerId);this.ports.current();const intentId=crypto.randomUUID();await this.#save({format:'genesis-domain-content-restore-v1',ownerId:this.ports.ownerId,intentId,backupId,source,proposal:null,confirmed:null,started:false,complete:false,applied:[]},null);return intentId;});}
 inspect(id:string){return this.#run(async()=>(await this.#load(id)).value);}
 pending(){return this.#run(async()=>{const result:DomainRestoreJournal[]=[];for(const id of await this.ports.list())result.push((await this.#load(id)).value);return result;});}
 preview(id:string){return this.#run(async()=>{const row=await this.#load(id);if(row.value.started)throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');const before=await this.#read(row.value.source.domain);return(await this.#save({...row.value,proposal:proposal(row.value.source,before),confirmed:null},row.serial)).value;});}
 confirm(id:string,fingerprint:string){return this.#run(async()=>{const row=await this.#load(id);if(row.value.started||!row.value.proposal||row.value.proposal.fingerprint!==fingerprint)throw new Error('E2EE_RESTORE_REVIEW_STALE');const before=await this.#read(row.value.source.domain);if(!same(before,row.value.proposal.before))throw new Error('E2EE_RESTORE_REVIEW_STALE');return(await this.#save({...row.value,confirmed:fingerprint},row.serial)).value;});}
 apply(id:string){return this.#run(async()=>{let row=await this.#load(id);const review=row.value.proposal,source=row.value.source;if(!review||row.value.confirmed!==review.fingerprint)throw new Error('E2EE_RESTORE_REVIEW_REQUIRED');if(row.value.complete)return row.value;
  const read=()=>this.#read(source.domain);
  if(!row.value.started){if(!same(await read(),review.before))throw new Error('E2EE_RESTORE_REVIEW_STALE');row=await this.#save({...row.value,started:true},row.serial);}
  for(const id of review.ids.filter(id=>!row.value.applied.includes(id)).slice(0,25)){
   const content=source.records.find(item=>item.id===id)!;let observed=await read(),matches=observed.records.filter(item=>item.id===id);
   if(!matches.length){if(observed.pending)throw new Error('E2EE_PENDING_REVIEW_REQUIRED');await this.ports.add(source.domain,content);this.ports.current();observed=await read();matches=observed.records.filter(item=>item.id===id);}
   if(matches.length!==1||matches[0].deleted||matches[0].revision!==1||!same(matches[0].value,content)||source.domain==='diary'&&!matches[0].localOnly)throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');
   if(observed.pending){await this.ports.flush(source.domain);this.ports.current();observed=await read();const result=observed.records.find(item=>item.id===id);if(observed.pending||!result||result.deleted||!same(result.value,content))throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');}
   row=await this.#save({...row.value,applied:[...row.value.applied,id]},row.serial);
  }
  if(row.value.applied.length===review.ids.length)row=await this.#save({...row.value,complete:true},row.serial);return row.value;
 });}
}

export function domainRestoreSourceFromJson(domain:RestoreDomain,raw:unknown):DomainRestoreSource{
 let value=object(raw);if(Object.hasOwn(value,'document')&&value.document&&typeof value.document==='object'&&!Array.isArray(value.records))value=object(value.document);
 const input=Array.isArray(value.records)?value.records:domain==='stoicheion'&&Array.isArray(value.works)?value.works:domain==='stoicheion'&&Object.hasOwn(value,'snapshot')?[value]:domain==='aurora'&&Array.isArray(value.sessions)?value.sessions:domain==='aurora'&&Object.hasOwn(value,'primary')?[value]:domain==='diary'&&Object.hasOwn(value,'note')?[value]:domain==='mindmap'&&Object.hasOwn(value,'nodes')?[value]:domain==='physis'&&Object.hasOwn(value,'record')?[value]:null;if(!input)throw new Error('E2EE_RESTORE_DOMAIN_REQUIRED');
 const records=input.filter(row=>object(row).deleted!==true).map(row=>{const item=object(row);return domain==='diary'?item.note??item:domain==='physis'?item.record??item:item.document??item;});return validateDomainRestoreSource({domain,records});
}
