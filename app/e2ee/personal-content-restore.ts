import {sha256} from '@noble/hashes/sha2.js';
import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {validateMigrationTask} from './tasks-source.ts';
import {normalizeHabitWorkspace} from '../habits.ts';

type Row=Record<string,unknown>;
export type PersonalRestoreSource={workspace:Row|null;tasks:Row[]|null};
export type PersonalRestoreView={snapshot:Row;contentRevision:number;deletedTaskIds:string[];pending:boolean};
export type PersonalRestoreProposal={before:PersonalRestoreView;after:Row;added:number;skipped:number;fingerprint:string};
export type PersonalRestoreJournal={format:'genesis-personal-content-restore-v1';ownerId:string;intentId:string;backupId:string;source:PersonalRestoreSource;proposal:PersonalRestoreProposal|null;confirmed:string|null;started:boolean;complete:boolean};
function invalid():never{throw new Error('E2EE_RESTORE_CONTENT_INVALID');}
const object=(input:unknown):Row=>{if(!input||typeof input!=='object'||Array.isArray(input))invalid();return input as Row;};
const digest=(value:unknown)=>{const bytes=new TextEncoder().encode(canonicalJson(value));try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}};
export function personalRestoreWorkspace(input:unknown):Row{const value=object(input);for(const name of ['projects','categories','taskLists','taskListLinks'])if(!Array.isArray(value[name]))invalid();
 if(['user','csrf','key','rawKey','recoveryCode','billing','entitlements','devices','tasks'].some(name=>Object.hasOwn(value,name)))invalid();return structuredClone({...value,...normalizeHabitWorkspace(value)});
}
export function validatePersonalRestoreSource(input:unknown):PersonalRestoreSource{exactKeys(input,['workspace','tasks']);if(input.workspace===null&&input.tasks===null)invalid();
 if(input.tasks!==null&&(!Array.isArray(input.tasks)||input.tasks.length>10000))invalid();
 const tasks=input.tasks===null?null:input.tasks.map(row=>({...validateMigrationTask(row),syncToGoogle:false,syncAccountIds:[]}));if(tasks&&new Set(tasks.map(row=>row.id)).size!==tasks.length)invalid();
 return{workspace:input.workspace===null?null:personalRestoreWorkspace(input.workspace),tasks};
}
export function validatePersonalRestoreView(input:unknown):PersonalRestoreView{exactKeys(input,['snapshot','contentRevision','deletedTaskIds','pending']);const snapshot=object(input.snapshot),content={...snapshot};delete content.tasks;personalRestoreWorkspace(content);
 if(!Array.isArray(snapshot.tasks)||snapshot.tasks.length>10000||!Number.isSafeInteger(input.contentRevision)||Number(input.contentRevision)<1||typeof input.pending!=='boolean'||!Array.isArray(input.deletedTaskIds)||input.deletedTaskIds.length>10000||input.deletedTaskIds.some(id=>typeof id!=='string')||new Set(input.deletedTaskIds).size!==input.deletedTaskIds.length)invalid();snapshot.tasks.forEach(validateMigrationTask);return structuredClone(input) as PersonalRestoreView;
}
/** Add missing content only. Existing versions and deletion markers win.
 * The review fingerprint stays inside the encrypted local journal. */
export function personalRestoreProposal(raw:unknown,sourceInput:unknown):PersonalRestoreProposal{
 const before=validatePersonalRestoreView(raw),source=validatePersonalRestoreSource(sourceInput),after=structuredClone(before.snapshot);let added=0,skipped=0;
 if(source.workspace)for(const [name,incoming]of Object.entries(source.workspace)){
  if(Array.isArray(incoming)){const existing=after[name];if(existing!==undefined&&!Array.isArray(existing))invalid();const next=[...(existing as unknown[]|undefined)??[]];
   const identity=(value:unknown)=>{const row=value&&typeof value==='object'&&!Array.isArray(value)?value as Row:null;return row&&typeof row.id==='string'?'id:'+row.id:row&&typeof row.date==='string'?'date:'+row.date:'value:'+canonicalJson(value);};
   const ids=new Set(next.map(identity));for(const row of incoming){const id=identity(row);if(ids.has(id)){skipped++;continue;}if(row&&typeof row==='object'&&('deleted'in row&&row.deleted===true||'deletedAt'in row&&row.deletedAt)){skipped++;continue;}next.push(structuredClone(row));ids.add(id);added++;}after[name]=next;
  }else if(!Object.hasOwn(after,name))after[name]=structuredClone(incoming);
 }
 const tasks=after.tasks as Row[],ids=new Set(tasks.map(row=>row.id)),deleted=new Set(before.deletedTaskIds);for(const task of source.tasks??[]){if(ids.has(task.id)||deleted.has(String(task.id))){skipped++;continue;}tasks.push(structuredClone(task));ids.add(task.id);added++;}
 const proposal={before,after,added,skipped};return{...proposal,fingerprint:digest({format:'genesis-personal-restore-review-v1',...proposal})};
}
export function validatePersonalRestoreJournal(input:unknown,ownerId:string,intentId:string):PersonalRestoreJournal{
 exactKeys(input,['format','ownerId','intentId','backupId','source','proposal','confirmed','started','complete']);if(input.format!=='genesis-personal-content-restore-v1'||input.ownerId!==ownerId||input.intentId!==intentId||typeof input.started!=='boolean'||typeof input.complete!=='boolean')invalid();assertTechnical(intentId);assertTechnical(input.backupId);validatePersonalRestoreSource(input.source);
 if(input.proposal!==null){exactKeys(input.proposal,['before','after','added','skipped','fingerprint']);if(!same(personalRestoreProposal(input.proposal.before,input.source),input.proposal))invalid();}
 if(input.confirmed!==null&&(typeof input.confirmed!=='string'||!input.proposal||input.confirmed!==input.proposal.fingerprint)||input.started&&input.confirmed===null||input.complete&&!input.started)invalid();return structuredClone(input) as PersonalRestoreJournal;
}
export interface PersonalRestorePorts{ownerId:string;current:()=>void;load:(id:string)=>Promise<{value:unknown;serial:number}|null>;save:(id:string,value:PersonalRestoreJournal,expected:number|null)=>Promise<number>;list:()=>Promise<string[]>;read:()=>Promise<unknown>;apply:(snapshot:Row,expectedContentRevision:number,alreadyStaged:boolean)=>Promise<void>}
export class PersonalContentRestore{
 #serial:Promise<unknown>=Promise.resolve();constructor(private readonly ports:PersonalRestorePorts){assertTechnical(ports.ownerId);}
 #run<T>(operation:()=>Promise<T>){const work=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return operation();});this.#serial=work;return work;}
 async #load(id:string){assertTechnical(id);const row=await this.ports.load(id);this.ports.current();if(!row)throw new Error('E2EE_RESTORE_REQUIRED');return{...row,value:validatePersonalRestoreJournal(row.value,this.ports.ownerId,id)};}
 async #save(value:PersonalRestoreJournal,expected:number|null){validatePersonalRestoreJournal(value,this.ports.ownerId,value.intentId);const serial=await this.ports.save(value.intentId,value,expected);this.ports.current();const row=await this.#load(value.intentId);if(serial!==(expected??0)+1||row.serial!==serial||!same(row.value,value))throw new Error('E2EE_LOCAL_CONFLICT');return row;}
 create(backupId:string,input:PersonalRestoreSource){const source=validatePersonalRestoreSource(input);assertTechnical(backupId);return this.#run(async()=>{const intentId=crypto.randomUUID();await this.#save({format:'genesis-personal-content-restore-v1',ownerId:this.ports.ownerId,intentId,backupId,source,proposal:null,confirmed:null,started:false,complete:false},null);return intentId;});}
 inspect(id:string){return this.#run(async()=>(await this.#load(id)).value);}
 pending(){return this.#run(async()=>{const ids=await this.ports.list();this.ports.current();const rows:PersonalRestoreJournal[]=[];for(const id of ids)rows.push((await this.#load(id)).value);return rows;});}
 preview(id:string){return this.#run(async()=>{const row=await this.#load(id);if(row.value.started)throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');const before=await this.ports.read();this.ports.current();const proposal=personalRestoreProposal(before,row.value.source);return(await this.#save({...row.value,proposal,confirmed:null},row.serial)).value;});}
 confirm(id:string,fingerprint:string){return this.#run(async()=>{const row=await this.#load(id);if(row.value.started||!row.value.proposal||row.value.proposal.fingerprint!==fingerprint)throw new Error('E2EE_RESTORE_REVIEW_STALE');const before=validatePersonalRestoreView(await this.ports.read());this.ports.current();if(!same(before,row.value.proposal.before))throw new Error('E2EE_RESTORE_REVIEW_STALE');return(await this.#save({...row.value,confirmed:fingerprint},row.serial)).value;});}
 apply(id:string){return this.#run(async()=>{let row=await this.#load(id);const proposal=row.value.proposal;if(!proposal||row.value.confirmed!==proposal.fingerprint)throw new Error('E2EE_RESTORE_REVIEW_REQUIRED');if(row.value.complete)return row.value;
  const observed=validatePersonalRestoreView(await this.ports.read());this.ports.current();if(!row.value.started){if(!same(observed,proposal.before))throw new Error('E2EE_RESTORE_REVIEW_STALE');row=await this.#save({...row.value,started:true},row.serial);}
  const staged=same(observed.snapshot,proposal.after);if(!staged||observed.pending){if(observed.contentRevision!==proposal.before.contentRevision&&!staged)throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');await this.ports.apply(proposal.after,observed.contentRevision,staged);this.ports.current();}
  const after=validatePersonalRestoreView(await this.ports.read());this.ports.current();if(after.pending||!same(after.snapshot,proposal.after))throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');return(await this.#save({...row.value,complete:true},row.serial)).value;
 });}
}
