import type {E2eeContext} from './envelope.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES} from './files.ts';
import {assertTechnical} from './keys.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import type {LocalWrite,UnlockedE2eeVault} from './storage.ts';
import type {UnlockedWebDevice} from './device-vault.ts';

type Metadata={filename:string;mediaType:string};
type Draft={id:string;size:number;parts:number;metadata:Metadata};
type EditorState={protocol:1;scopeId:string;domain:E2eeContext['domain'];objectId:string;remoteRevision:number;latest:Draft;
  pending:string[];history:Draft[]};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_RETAINED_DRAFTS=1024;

/** Product editors may keep saving while an earlier immutable upload is in flight.
 * Every acknowledged edit is encrypted locally. Coalescing skips network uploads
 * of intermediate edits, but preserves their snapshots for explicit recovery.
 */
export class E2eeEditorQueue {
  #vault:UnlockedE2eeVault;#client:E2eeScopeClient;#scopeId:string;#domain:E2eeContext['domain'];#objectId:string;#stateId:Promise<string>;
  #device:Pick<UnlockedWebDevice,'vault'|'ensureDurableKeys'>;
  constructor(device:Pick<UnlockedWebDevice,'vault'|'ensureDurableKeys'>,client:E2eeScopeClient,scopeId:string,domain:E2eeContext['domain'],objectId:string){
    client.assertBinding(device,scopeId);
    [scopeId,domain,objectId].forEach(assertTechnical);this.#device=device;this.#vault=device.vault;this.#client=client;this.#scopeId=scopeId;this.#domain=domain;this.#objectId=objectId;
    this.#stateId=crypto.subtle.digest('SHA-256',encoder.encode(`${scopeId}\0${domain}\0${objectId}`)).then(hash=>`editor:${encodeE2eeBytes(new Uint8Array(hash))}`);
  }
  async #load(){
    const row=await this.#vault.read('draft',await this.#stateId);if(!row)return null;
    try {
      const state=JSON.parse(decoder.decode(row.value)) as EditorState;
      if(state.protocol!==1||state.scopeId!==this.#scopeId||state.domain!==this.#domain||state.objectId!==this.#objectId
        ||!Number.isSafeInteger(state.remoteRevision)||state.remoteRevision<0||!Array.isArray(state.pending)||!Array.isArray(state.history)
        ||state.history.length<1||state.history.length>MAX_RETAINED_DRAFTS||new Set(state.history.map(item=>item.id)).size!==state.history.length
        ||new Set(state.pending).size!==state.pending.length||state.pending.some(id=>!state.history.some(item=>item.id===id))
        ||state.latest?.id!==state.history.at(-1)?.id)throw new Error('E2EE_CORRUPT_EDITOR');
      for(const draft of state.history) {
        assertTechnical(draft.id);
        if(!Number.isSafeInteger(draft.size)||draft.size<0||draft.size>E2EE_MAX_FILE_BYTES||draft.parts!==Math.ceil(draft.size/E2EE_CHUNK_BYTES)
          ||typeof draft.metadata?.filename!=='string'||draft.metadata.filename.length>512||typeof draft.metadata.mediaType!=='string'||draft.metadata.mediaType.length>128)throw new Error('E2EE_CORRUPT_EDITOR');
      }
      return {state,serial:row.serial};
    }finally{row.value.fill(0);}
  }
  async #save(state:EditorState,serial:number|null,changes:LocalWrite[]=[]){
    const bytes=encoder.encode(JSON.stringify(state));
    try{await this.#vault.write([...changes,{domain:'draft',objectId:await this.#stateId,value:bytes,expected:serial}]);}
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
      const job=await this.#client.localJob(this.#domain,this.#objectId);if(job&&!job.complete)throw new Error('E2EE_PENDING_SAVE_REQUIRED');
      await this.#client.assertVerifiedRevision(this.#domain,this.#objectId,remoteRevision);
      return await this.#stage(bytes,expectedSerial,remoteRevision,metadata,mode);
    }finally{bytes.fill(0);}
  }
  async #stage(source:Uint8Array,expectedSerial:number|null,baseRevision:number,metadata:Metadata,mode:'edit'|'merge'|'cache'):Promise<number>{
    if(!Number.isSafeInteger(baseRevision)||baseRevision<0||source.length>E2EE_MAX_FILE_BYTES
      ||typeof metadata.filename!=='string'||metadata.filename.length>512||typeof metadata.mediaType!=='string'||metadata.mediaType.length>128)throw new Error('E2EE_INVALID_EDITOR_INPUT');
    const bytes=new Uint8Array(source),changes:LocalWrite[]=[];metadata={filename:metadata.filename,mediaType:metadata.mediaType};
    try {
      await this.#device.ensureDurableKeys();
      const previous=await this.#load();
      if((previous?.serial??null)!==expectedSerial)throw new Error('E2EE_LOCAL_CONFLICT');
      if(previous&&(mode==='edit'?previous.state.remoteRevision!==baseRevision:baseRevision<previous.state.remoteRevision)
        ||mode==='cache'&&previous?.state.pending.length)throw new Error('E2EE_EDITOR_CONFLICT');
      if((previous?.state.history.length??0)>=MAX_RETAINED_DRAFTS)throw new Error('E2EE_EDITOR_HISTORY_LIMIT');
      const draft:Draft={id:`edit:${crypto.randomUUID()}`,size:bytes.length,parts:Math.ceil(bytes.length/E2EE_CHUNK_BYTES),metadata};
      for(let part=0;part<draft.parts;part++)changes.push({domain:'draft',objectId:`${draft.id}:${part}`,value:bytes.slice(part*E2EE_CHUNK_BYTES,(part+1)*E2EE_CHUNK_BYTES),expected:null});
      const state:EditorState={protocol:1,scopeId:this.#scopeId,domain:this.#domain,objectId:this.#objectId,remoteRevision:baseRevision,
        latest:draft,pending:mode==='cache'?[]:[...previous?.state.pending??[],draft.id],history:[...previous?.state.history??[],draft]};
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
      state.remoteRevision=Math.max(state.remoteRevision,revision);state.pending=state.pending.slice(index+1);
      try{await this.#save(state,saved.serial);return;}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_LOCAL_CONFLICT'||attempt===3)throw error;}
    }
  }
  async flush():Promise<number>{
    // Bounded even when another editor keeps producing changes during network I/O.
    for(let iteration=0;iteration<MAX_RETAINED_DRAFTS;iteration++){
      const saved=await this.#load();if(!saved)throw new Error('E2EE_EDITOR_EMPTY');
      const job=await this.#client.localJob(this.#domain,this.#objectId);
      if(job&&!job.complete){
        if(!job.originId||!saved.state.pending.includes(job.originId))throw new Error('E2EE_PENDING_EDITOR_MISMATCH');
        const revision=await this.#client.flush(this.#domain,this.#objectId,job.originId);await this.#confirm(job.originId,revision);continue;
      }
      if(job?.complete&&job.originId&&saved.state.pending.includes(job.originId)){await this.#confirm(job.originId,job.expectedRevision+1);continue;}
      const selectedId=saved.state.pending.at(-1);if(!selectedId)return saved.state.remoteRevision;
      const selected=saved.state.history.find(draft=>draft.id===selectedId);if(!selected)throw new Error('E2EE_CORRUPT_EDITOR');
      const bytes=await this.#bytes(selected);
      try{await this.#client.prepare(this.#domain,this.#objectId,bytes,saved.state.remoteRevision,selected.metadata,selected.id);}
      finally{bytes.fill(0);}
    }
    throw new Error('E2EE_EDITOR_BUSY');
  }
  async recoverAcknowledgement(){
    const saved=await this.#load();if(!saved?.state.pending.length)return;
    const receipt=await this.#client.recoverReceipt(this.#domain,this.#objectId);
    if(receipt&&saved.state.pending.includes(receipt.originId))await this.#confirm(receipt.originId,receipt.revision);
  }
  /** Epoch/concurrency conflicts are explicit; every later local edit stays queued. */
  async rebasePending(expectedRemoteRevision:number){
    const job=await this.#client.localJob(this.#domain,this.#objectId),saved=await this.#load();
    if(!job?.originId||!saved?.state.pending.includes(job.originId))throw new Error('E2EE_PENDING_EDITOR_MISMATCH');
    const outcome=await this.#client.rebase(this.#domain,this.#objectId,expectedRemoteRevision,undefined,job.originId);
    if(outcome==='already-confirmed'){
      const confirmed=await this.#client.localJob(this.#domain,this.#objectId);
      if(!confirmed?.complete||confirmed.originId!==job.originId)throw new Error('E2EE_PENDING_EDITOR_MISMATCH');
      await this.#confirm(job.originId,confirmed.expectedRevision+1);
    }
    return outcome;
  }
}
