import type {E2eeContext} from './envelope.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES} from './files.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import type {LocalWrite,UnlockedE2eeVault} from './storage.ts';
import type {UnlockedWebDevice} from './device-vault.ts';
import {requirePrivateProductMutation} from '../private-migration-ui.ts';

type Metadata={filename:string;mediaType:string};
type Draft={id:string;size:number;parts:number;metadata:Metadata};
export type EditorHistoryCursor={id:string;hash:string};
type EditorState={protocol:1|2;scopeId:string;domain:E2eeContext['domain'];objectId:string;remoteRevision:number;latest:Draft;
  pending:string[];history:Draft[];review?:{originId:string;remoteRevision:number};preparing?:string;historyHead?:EditorHistoryCursor};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_RETAINED_DRAFTS=1024;

/** Product editors may keep saving while an earlier immutable upload is in flight.
 * Every acknowledged edit is encrypted locally. Coalescing skips network uploads
 * of intermediate edits, but preserves their snapshots for explicit recovery.
 */
export class E2eeEditorQueue {
  #vault:UnlockedE2eeVault;#client:E2eeScopeClient|null;#scopeId:string;#domain:E2eeContext['domain'];#objectId:string;#stateId:Promise<string>;
  #device:Pick<UnlockedWebDevice,'vault'|'ensureDurableKeys'>;
  constructor(device:Pick<UnlockedWebDevice,'vault'|'ensureDurableKeys'>,client:E2eeScopeClient|null,scopeId:string,domain:E2eeContext['domain'],objectId:string){
    if(client)client.assertBinding(device,scopeId);
    [scopeId,domain,objectId].forEach(assertTechnical);this.#device=device;this.#vault=device.vault;this.#client=client;this.#scopeId=scopeId;this.#domain=domain;this.#objectId=objectId;
    this.#stateId=crypto.subtle.digest('SHA-256',encoder.encode(`${scopeId}\0${domain}\0${objectId}`)).then(hash=>`editor:${encodeE2eeBytes(new Uint8Array(hash))}`);
  }
  #writerClient(){if(!this.#client)throw new Error('E2EE_HISTORY_NOT_EXECUTABLE');return this.#client;}
  static readOnly(vault:UnlockedE2eeVault,scopeId:string,domain:E2eeContext['domain'],objectId:string){return new E2eeEditorQueue({vault,ensureDurableKeys:async()=>{throw new Error('E2EE_HISTORY_NOT_EXECUTABLE');}},null,scopeId,domain,objectId);}
  async #load(){
    const row=await this.#vault.read('draft',await this.#stateId);if(!row)return null;
    try {
      const state=JSON.parse(decoder.decode(row.value)) as EditorState;
      if(![1,2].includes(state.protocol)||state.scopeId!==this.#scopeId||state.domain!==this.#domain||state.objectId!==this.#objectId
        ||!Number.isSafeInteger(state.remoteRevision)||state.remoteRevision<0||!Array.isArray(state.pending)||!Array.isArray(state.history)
        ||state.history.length<1||state.history.length>MAX_RETAINED_DRAFTS||new Set(state.history.map(item=>item.id)).size!==state.history.length
        ||new Set(state.pending).size!==state.pending.length||state.pending.some(id=>!state.history.some(item=>item.id===id))
        ||state.latest?.id!==state.history.at(-1)?.id)throw new Error('E2EE_CORRUPT_EDITOR');
      for(const draft of state.history) {
        assertTechnical(draft.id);
        if(!Number.isSafeInteger(draft.size)||draft.size<0||draft.size>E2EE_MAX_FILE_BYTES||draft.parts!==Math.ceil(draft.size/E2EE_CHUNK_BYTES)
          ||typeof draft.metadata?.filename!=='string'||draft.metadata.filename.length>512||typeof draft.metadata.mediaType!=='string'||draft.metadata.mediaType.length>128)throw new Error('E2EE_CORRUPT_EDITOR');
      }
      if(state.review&&(typeof state.review!=='object'||Object.keys(state.review).length!==2||state.review.remoteRevision!==state.remoteRevision||!state.pending.includes(state.review.originId)))throw new Error('E2EE_CORRUPT_EDITOR');
      if(state.preparing!==undefined&&!state.pending.includes(state.preparing))throw new Error('E2EE_CORRUPT_EDITOR');
      if(state.historyHead){exactKeys(state.historyHead,['id','hash']);assertTechnical(state.historyHead.id);decodeE2eeBytes(state.historyHead.hash,32);}
      return {state,serial:row.serial};
    }finally{row.value.fill(0);}
  }
  async #save(state:EditorState,serial:number|null,changes:LocalWrite[]=[]){
    const current=()=>{this.#vault.assertUnlocked();requirePrivateProductMutation(this.#vault.localIdentity().ownerId);};current();
    const bytes=encoder.encode(JSON.stringify(state));
    try{await this.#vault.write([...changes,{domain:'draft',objectId:await this.#stateId,value:bytes,expected:serial}],current);}
    finally{bytes.fill(0);}return(serial??0)+1;
  }
  async #bytes(draft:Draft){
    const bytes=new Uint8Array(draft.size);let offset=0;
    try {
      for(let part=0;part<draft.parts;part++){
        const row=await this.#vault.read('draft',`${draft.id}:${part}`);if(!row)throw new Error('E2EE_CORRUPT_EDITOR');
        try{if(row.value.length!==Math.min(E2EE_CHUNK_BYTES,bytes.length-offset))throw new Error('E2EE_CORRUPT_EDITOR');bytes.set(row.value,offset);offset+=row.value.length;}
        finally{row.value.fill(0);}
      }
      this.#vault.assertUnlocked();return bytes;
    }catch(error){bytes.fill(0);throw error;}
  }
  async load():Promise<{bytes:Uint8Array;metadata:Metadata;serial:number;remoteRevision:number;pending:boolean}|null>{
    const value=await this.#load();if(!value)return null;
    const bytes=await this.#bytes(value.state.latest);
    try{this.#vault.assertUnlocked();return{bytes,metadata:{...value.state.latest.metadata},serial:value.serial,remoteRevision:value.state.remoteRevision,pending:value.state.pending.length>0};}
    catch(error){bytes.fill(0);throw error;}
  }
  /** Caller keeps its previous serial; another tab's acknowledged edit is never overwritten. */
  async stage(source:Uint8Array,expectedSerial:number|null,baseRevision:number,metadata:Metadata={filename:'',mediaType:'application/json'}):Promise<number>{
    return this.#stage(source,expectedSerial,baseRevision,metadata,'edit');
  }
  /** Only a previously authenticated read may move an editor's remote base.
   * Dirty content requires an explicit merged result; all old snapshots remain.
   * An unresolved prepared upload must first be resolved, never silently replaced.
   */
  async reconcile(source:Uint8Array,expectedSerial:number|null,remoteRevision:number,metadata:Metadata={filename:'',mediaType:'application/json'},mode:'merge'|'cache'='merge'){
    const bytes=new Uint8Array(source);metadata={filename:metadata.filename,mediaType:metadata.mediaType};
    try{
      const job=await this.#writerClient().localJob(this.#domain,this.#objectId);if(job&&!job.complete)throw new Error('E2EE_PENDING_SAVE_REQUIRED');
      await this.#writerClient().assertVerifiedRevision(this.#domain,this.#objectId,remoteRevision);
      return await this.#stage(bytes,expectedSerial,remoteRevision,metadata,mode);
    }finally{bytes.fill(0);}
  }
  async #stage(source:Uint8Array,expectedSerial:number|null,baseRevision:number,metadata:Metadata,mode:'edit'|'merge'|'cache'|'review'):Promise<number>{
    if(!Number.isSafeInteger(baseRevision)||baseRevision<0||source.length>E2EE_MAX_FILE_BYTES
      ||typeof metadata.filename!=='string'||metadata.filename.length>512||typeof metadata.mediaType!=='string'||metadata.mediaType.length>128)throw new Error('E2EE_INVALID_EDITOR_INPUT');
    const bytes=new Uint8Array(source),changes:LocalWrite[]=[];metadata={filename:metadata.filename,mediaType:metadata.mediaType};
    try {
      await this.#device.ensureDurableKeys();
      const previous=await this.#load();
      if((previous?.serial??null)!==expectedSerial)throw new Error('E2EE_LOCAL_CONFLICT');
      if(previous&&(mode==='edit'?previous.state.remoteRevision!==baseRevision:baseRevision<previous.state.remoteRevision)
        ||mode==='cache'&&previous?.state.pending.length||previous?.state.review&&mode!=='edit'&&mode!=='review')throw new Error('E2EE_EDITOR_CONFLICT');
      let history=[...previous?.state.history??[]],pending=[...previous?.state.pending??[]],historyHead=previous?.state.historyHead;
      if(history.length>=MAX_RETAINED_DRAFTS){
        // Every possible upload origin has a durable preparing claim before
        // crypto starts. Coalescing keeps that origin, the current job/review
        // and latest version; older content remains in authenticated pages.
        const job=await this.#writerClient().localJob(this.#domain,this.#objectId),keep=new Set([previous!.state.latest.id,previous!.state.preparing,previous!.state.review?.originId,job?.originId]);
        const archived=history.filter(row=>!keep.has(row.id));history=history.filter(row=>keep.has(row.id));pending=pending.filter(id=>keep.has(id));
        if(!archived.length)throw new Error('E2EE_EDITOR_BUSY');
        const id=`editor-history:${crypto.randomUUID()}`,value=encoder.encode(JSON.stringify({protocol:1,scopeId:this.#scopeId,domain:this.#domain,objectId:this.#objectId,previous:historyHead??null,drafts:archived}));
        historyHead={id,hash:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',value)))};changes.push({domain:'local-snapshot',objectId:id,value,expected:null});
      }
      const draft:Draft={id:`edit:${crypto.randomUUID()}`,size:bytes.length,parts:Math.ceil(bytes.length/E2EE_CHUNK_BYTES),metadata};
      for(let part=0;part<draft.parts;part++)changes.push({domain:'draft',objectId:`${draft.id}:${part}`,value:bytes.slice(part*E2EE_CHUNK_BYTES,(part+1)*E2EE_CHUNK_BYTES),expected:null});
      const state:EditorState={protocol:2,scopeId:this.#scopeId,domain:this.#domain,objectId:this.#objectId,remoteRevision:baseRevision,
        latest:draft,pending:mode==='cache'?[]:[...pending,draft.id],history:[...history,draft],
        // A verified merge supersedes an origin claimed before prepare failed.
        // Replaying that old draft at the new base would publish unmerged text.
        ...(historyHead?{historyHead}:{}),...(previous?.state.preparing&&mode!=='cache'&&mode!=='merge'?{preparing:previous.state.preparing}:{}),
        ...(mode==='review'?{review:{originId:draft.id,remoteRevision:baseRevision}}:previous?.state.review?{review:previous.state.review}:{})};
      return await this.#save(state,expectedSerial,changes);
    }finally{bytes.fill(0);changes.forEach(change=>change.value.fill(0));}
  }
  async #confirm(originId:string,revision:number){
    for(let attempt=0;attempt<4;attempt++){
      const saved=await this.#load();if(!saved)throw new Error('E2EE_CORRUPT_EDITOR');
      const {state}=saved,index=state.pending.indexOf(originId);
      if(index<0){if(state.remoteRevision>=revision)return;throw new Error('E2EE_CORRUPT_EDITOR');}
      // A verified remote reconciliation may already have advanced past this
      // accepted local write. Acknowledge its origin without lowering the base.
      if(state.review&&state.review.originId!==originId&&revision>state.review.remoteRevision)throw new Error('E2EE_CONFLICT_REVIEW_STALE');
      state.remoteRevision=Math.max(state.remoteRevision,revision);state.pending=state.pending.slice(index+1);
      if(state.review&&!state.pending.includes(state.review.originId))delete state.review;
      if(state.preparing&&!state.pending.includes(state.preparing))delete state.preparing;
      try{await this.#save(state,saved.serial);return;}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_LOCAL_CONFLICT'||attempt===3)throw error;}
    }
  }
  async flush():Promise<number>{
    // Bounded even when another editor keeps producing changes during network I/O.
    for(let iteration=0;iteration<MAX_RETAINED_DRAFTS;iteration++){
      const saved=await this.#load();if(!saved)throw new Error('E2EE_EDITOR_EMPTY');
      if(saved.state.review){
        const review=saved.state.review,draft=saved.state.history.find(row=>row.id===review.originId);if(!draft)throw new Error('E2EE_CORRUPT_EDITOR');
        const job=await this.#writerClient().localJob(this.#domain,this.#objectId);
        if(job?.originId!==review.originId){const bytes=await this.#bytes(draft);try{await this.#writerClient().replaceReviewed(this.#domain,this.#objectId,bytes,review.remoteRevision,review.originId,draft.metadata);}finally{bytes.fill(0);}}
        const current=await this.#load();if(!current)throw new Error('E2EE_CORRUPT_EDITOR');
        if(current.state.review?.originId===review.originId){delete current.state.review;delete current.state.preparing;try{await this.#save(current.state,current.serial);}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_LOCAL_CONFLICT')throw error;}}continue;
      }
      const job=await this.#writerClient().localJob(this.#domain,this.#objectId);
      if(job&&!job.complete){
        if(!job.originId||!saved.state.pending.includes(job.originId))throw new Error('E2EE_PENDING_EDITOR_MISMATCH');
        const revision=await this.#writerClient().flush(this.#domain,this.#objectId,job.originId);await this.#confirm(job.originId,revision);continue;
      }
      if(job?.complete&&job.originId&&saved.state.pending.includes(job.originId)){await this.#confirm(job.originId,job.expectedRevision+1);continue;}
      const selectedId=saved.state.preparing??saved.state.pending.at(-1);if(!selectedId)return saved.state.remoteRevision;
      const selected=saved.state.history.find(draft=>draft.id===selectedId);if(!selected)throw new Error('E2EE_CORRUPT_EDITOR');
      if(!saved.state.preparing){saved.state.preparing=selectedId;try{await this.#save(saved.state,saved.serial);}catch(error){if(error instanceof Error&&error.message==='E2EE_LOCAL_CONFLICT')continue;throw error;}}
      const bytes=await this.#bytes(selected);
      try{await this.#writerClient().prepare(this.#domain,this.#objectId,bytes,saved.state.remoteRevision,selected.metadata,selected.id);}
      finally{bytes.fill(0);}
    }
    throw new Error('E2EE_EDITOR_BUSY');
  }
  async recoverAcknowledgement(){
    const saved=await this.#load();if(!saved?.state.pending.length)return;
    const receipt=await this.#writerClient().recoverReceipt(this.#domain,this.#objectId);
    if(receipt&&saved.state.pending.includes(receipt.originId))await this.#confirm(receipt.originId,receipt.revision);
  }
  /** Explicit reviewed merge. Its intent is durable before cancel/replace I/O;
   * retry cannot send the superseded old packet after a process interruption. */
  async reviewConflict(source:Uint8Array,expectedSerial:number,remoteRevision:number,metadata:Metadata={filename:'',mediaType:'application/json'}){
    const bytes=new Uint8Array(source);try{await this.#writerClient().assertVerifiedRevision(this.#domain,this.#objectId,remoteRevision);
      return await this.#stage(bytes,expectedSerial,remoteRevision,metadata,'review');}finally{bytes.fill(0);}
  }
  /** Epoch/concurrency conflicts are explicit; every later local edit stays queued. */
  async rebasePending(expectedRemoteRevision:number){
    const job=await this.#writerClient().localJob(this.#domain,this.#objectId),saved=await this.#load();
    if(!job?.originId||!saved?.state.pending.includes(job.originId))throw new Error('E2EE_PENDING_EDITOR_MISMATCH');
    const outcome=await this.#writerClient().rebase(this.#domain,this.#objectId,expectedRemoteRevision,undefined,job.originId);
    if(outcome==='already-confirmed'){
      const confirmed=await this.#writerClient().localJob(this.#domain,this.#objectId);
      if(!confirmed?.complete||confirmed.originId!==job.originId)throw new Error('E2EE_PENDING_EDITOR_MISMATCH');
      await this.#confirm(job.originId,confirmed.expectedRevision+1);
    }
    return outcome;
  }
  async #history(cursor?:EditorHistoryCursor):Promise<{drafts:Draft[];cursor:EditorHistoryCursor|null}>{
    if(!cursor){const saved=await this.#load();return saved?{drafts:structuredClone(saved.state.history),cursor:saved.state.historyHead??null}:{drafts:[],cursor:null};}
    exactKeys(cursor,['id','hash']);assertTechnical(cursor.id);decodeE2eeBytes(cursor.hash,32);const row=await this.#vault.read('local-snapshot',cursor.id);if(!row)throw new Error('E2EE_EDITOR_HISTORY_MISSING');
    try{if(encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',row.value)))!==cursor.hash)throw new Error('E2EE_EDITOR_HISTORY_CORRUPT');
      const value=parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_EDITOR_HISTORY_CORRUPT',4*1024*1024);exactKeys(value,['protocol','scopeId','domain','objectId','previous','drafts']);
      if(value.protocol!==1||value.scopeId!==this.#scopeId||value.domain!==this.#domain||value.objectId!==this.#objectId||!Array.isArray(value.drafts)||value.drafts.length<1||value.drafts.length>MAX_RETAINED_DRAFTS)throw new Error('E2EE_EDITOR_HISTORY_CORRUPT');
      if(value.previous!==null){exactKeys(value.previous,['id','hash']);assertTechnical(value.previous.id);decodeE2eeBytes(value.previous.hash,32);}
      const seen=new Set<string>();for(const raw of value.drafts){exactKeys(raw,['id','size','parts','metadata']);assertTechnical(raw.id);exactKeys(raw.metadata,['filename','mediaType']);
        if(seen.has(raw.id)||!Number.isSafeInteger(raw.size)||Number(raw.size)<0||Number(raw.size)>E2EE_MAX_FILE_BYTES||raw.parts!==Math.ceil(Number(raw.size)/E2EE_CHUNK_BYTES)
          ||typeof raw.metadata.filename!=='string'||raw.metadata.filename.length>512||typeof raw.metadata.mediaType!=='string'||raw.metadata.mediaType.length>128)throw new Error('E2EE_EDITOR_HISTORY_CORRUPT');seen.add(raw.id);}
      this.#vault.assertUnlocked();return{drafts:value.drafts as Draft[],cursor:value.previous as EditorHistoryCursor|null};
    }finally{row.value.fill(0);}
  }
  historyPage(cursor?:EditorHistoryCursor){return this.#history(cursor?structuredClone(cursor):undefined);}
  async openHistory(id:string,cursor?:EditorHistoryCursor){assertTechnical(id);const page=await this.#history(cursor?structuredClone(cursor):undefined),draft=page.drafts.find(row=>row.id===id);if(!draft)throw new Error('E2EE_EDITOR_HISTORY_MISSING');return{bytes:await this.#bytes(draft),metadata:{...draft.metadata}};}
}
