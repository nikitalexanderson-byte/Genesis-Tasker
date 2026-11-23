import { canonicalE2eeValue, e2eeCommandHash, signE2eeCommand, snapshotE2eeValue,verifyE2eeCommand, type SignedE2eeCommand, type WireValue } from './commands.ts';
import { contentSigningKey, type VerifiedDirectory } from './directory.ts';
import { E2EE_SUITE, E2EE_DOMAINS, decodeE2eeBytes,encodeE2eeBytes, openE2eeEnvelope, sealE2eeEnvelope, validateE2eeEnvelope, verifyE2eeEnvelope, type E2eeContext, type E2eeEnvelope } from './envelope.ts';
import { E2EE_CHUNK_BYTES, E2EE_MAX_FILE_BYTES, envelopePayloadHash, objectManifestHash, openE2eeFile, sealE2eeFile } from './files.ts';
import { assertTechnical, exactKeys, freshSecret, openRoot, sealRoot, forwardRoot, type PublicDeviceKeys } from './keys.ts';
import {verifyDeviceAccessRequest,deviceAccessFingerprint,type DeviceAccessRequest} from './device-access-contract.ts';
import { UnlockedWebDevice } from './device-vault.ts';
import type { LocalWrite } from './storage.ts';
import {validatePrivateProjectSelection,validatePrivateProjectTopology,type PrivateProjectSelection} from './project-create-contract.ts';
import {productMutation,type ProductMutation} from './product-contract.ts';
import {membershipAtomicStagingPayload,type MembershipAtomicStagingAction} from './membership-atomic-contract.ts';
import {membershipAtomicApplyPayload,type MembershipAtomicApplyAction} from './membership-atomic-receipts.ts';

export interface ScopeTransport {
  directory(scopeId:string):Promise<{events:SignedE2eeCommand[]}>;
  command(packet:SignedE2eeCommand):Promise<Record<string,WireValue>>;
  read(packet:SignedE2eeCommand):Promise<{resourceId?:string;topology?:unknown;envelopes?:E2eeEnvelope[];objects?:{domain:string;objectId:string;revision:number;payloadHash:string}[];
    receipt?:{payloadHash:string;result:Record<string,WireValue>}|null;manifestHash?:string;objectCount?:number;context?:unknown;history?:unknown;bootstrap?:unknown;part?:unknown;bootstrapProofHash?:string;entities?:unknown[];heads?:unknown[];proofs?:unknown[];proposals?:unknown[];attestations?:unknown[];pages?:unknown[];checkpointHash:string;directoryRevision:number}>;
}

export type ReviewedDeviceRole={deviceId:string;role:'owner'|'writer'|'commenter'|'reader'|null};
type PlanItem={recordId:string;hash:string;expected:number};
type UploadJob={protocol:1;scopeId:string;domain:E2eeContext['domain'];objectId:string;generation:number;cryptoEpoch:number;keyId:string;
  expected:number;size:number;metadata:{filename:string;mediaType:string};originId:string|null;draftId:string;draftParts:number;plan:PlanItem[];uploaded:number;pending:SignedE2eeCommand|null;cancelling:SignedE2eeCommand|null;complete:boolean};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
async function hash(value:string){return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
function epochKey(directory:Pick<VerifiedDirectory,'cryptoEpoch'|'securityEpoch'|'keyId'|'generation'>){return `${directory.cryptoEpoch}:${directory.securityEpoch}:${directory.keyId}:${directory.generation}`;}

/** Durable normal-operation channel, separate from the migration state machine.
 * A save is acknowledged locally only after its draft, ciphertext and retry plan
 * commit atomically. Network retries never manufacture replacement empty content. */
export class E2eeScopeClient {
  #device:UnlockedWebDevice;#owner:string;#scopeId:string;#pin:PublicDeviceKeys;#transport:ScopeTransport;
  #directory:VerifiedDirectory|null=null;#history=new Map<string,VerifiedDirectory>();#roots=new Map<string,CryptoKey>();
  #sealedCache=new Map<string,Map<string,{revision:number;payloadHash:string}>>();
  #refreshed=false;
  #directoryFrames=new Map<number,VerifiedDirectory>();
  constructor(device:UnlockedWebDevice,ownerId:string,scopeId:string,pin:PublicDeviceKeys,transport:ScopeTransport){
    assertTechnical(ownerId);assertTechnical(scopeId);this.#device=device;this.#owner=ownerId;this.#scopeId=scopeId;
    this.#pin=snapshotE2eeValue(pin);this.#transport=transport;
  }
  assertBinding(device:object,scopeId:string){if(device!==this.#device||scopeId!==this.#scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}
  #open(){this.#device.requireOpen();if(!this.#directory)throw new Error('E2EE_DIRECTORY_REQUIRED');return this.#directory;}
  async refresh():Promise<VerifiedDirectory> {
    this.#refreshed=false;
    this.#device.requireOpen();const response=await this.#transport.directory(this.#scopeId);this.#device.requireOpen();
    const frames=new Map<string,VerifiedDirectory>(),revisions=new Map<number,VerifiedDirectory>();
    const directory=await this.#device.rememberDirectory(this.#scopeId,this.#pin,response.events,this.#owner,frame=>{frames.set(epochKey(frame),frame);revisions.set(frame.checkpoint.revision,frame);});
    await this.#installDirectory(directory,frames);
    this.#directoryFrames=revisions;this.#refreshed=true;
    try{await this.#loadSealedHeads(true);}catch(error){this.#refreshed=false;throw error;}
    return structuredClone(directory);
  }
  /** Explicit offline unlock. No network fallback is performed after a failed refresh. */
  async hydrateOffline():Promise<VerifiedDirectory> {
    this.#refreshed=false;this.#device.requireOpen();const frames=new Map<string,VerifiedDirectory>(),revisions=new Map<number,VerifiedDirectory>();
    const directory=await this.#device.savedDirectory(this.#scopeId,frame=>{frames.set(epochKey(frame),frame);revisions.set(frame.checkpoint.revision,frame);});
    if(!directory)throw new Error('E2EE_DIRECTORY_REQUIRED');
    await this.#installDirectory(directory,frames);this.#directoryFrames=revisions;await this.#loadSealedHeads(false);return structuredClone(directory);
  }
  async #installDirectory(directory:VerifiedDirectory,frames:Map<string,VerifiedDirectory>) {
    if(directory.ownerId!==this.#owner||directory.recoveryKit.authority.signingKey!==this.#pin.signingKey
      ||directory.recoveryKit.authority.receivingKey!==this.#pin.receivingKey)throw new Error('E2EE_AUTHORITY_CHANGED');
    const device=directory.devices.get(this.#device.deviceId);
    if(!device||device.revoked||device.userId!==this.#device.ownerId)throw new Error('E2EE_REVOKED_DEVICE');
    const roots=new Map<string,CryptoKey>(),keys=this.#device.keys();
    for(const grant of [...device.historyCapsules,{cryptoEpoch:directory.cryptoEpoch,keyId:directory.keyId,capsule:device.capsule}]) {
      roots.set(grant.keyId,await openRoot(grant.capsule,keys.receiving.privateKey,{ownerId:this.#owner,scopeId:this.#scopeId,
        cryptoEpoch:grant.cryptoEpoch,keyId:grant.keyId,recipientId:device.deviceId}));
    }
    this.#device.requireOpen();this.#directory=directory;this.#history=frames;this.#roots=roots;
  }
  async #id(domain:E2eeContext['domain'],objectId:string){assertTechnical(objectId);return hash(`${this.#scopeId}\0${domain}\0${objectId}`);}
  async #knownPrefix(generation:number){return `confirmed:${await hash(this.#scopeId)}:${generation}:`;}
  async #confirmed(envelope:E2eeEnvelope):Promise<LocalWrite|null>{
    const context=envelope.context,directory=this.#open();
    if(context.scopeId!==this.#scopeId||context.ownerId!==this.#owner||context.dataGeneration!==directory.generation)throw new Error('E2EE_CONTEXT_MISMATCH');
    const objectId=(await this.#knownPrefix(directory.generation))+await this.#id(context.domain,context.objectId),prior=await this.#device.vault.read('key-check',objectId);
    const head={scopeId:this.#scopeId,generation:directory.generation,domain:context.domain,objectId:context.objectId,revision:context.revision,payloadHash:await envelopePayloadHash(envelope)};
    try{
      if(prior){const old=JSON.parse(decoder.decode(prior.value));exactKeys(old,['scopeId','generation','domain','objectId','revision','payloadHash']);
        if(old.scopeId!==head.scopeId||old.generation!==head.generation||old.domain!==head.domain||old.objectId!==head.objectId||typeof old.revision!=='number'||!Number.isSafeInteger(old.revision)||old.revision<1)throw new Error('E2EE_CORRUPT_CHECKPOINT');
        decodeE2eeBytes(old.payloadHash,32);
        if(old.revision>head.revision||old.revision===head.revision&&old.payloadHash!==head.payloadHash)throw new Error('E2EE_REMOTE_ROLLBACK');
        if(old.revision===head.revision)return null;
      }
      return{domain:'key-check',objectId,value:encoder.encode(JSON.stringify(head)),expected:prior?.serial??null};
    }finally{prior?.value.fill(0);}
  }
  /** Includes confirmed chunks and objects added after the last signed retired
   * manifest. A server cannot omit a newer locally observed object during rekey.
   * Per-object CAS avoids a shared mutable index losing concurrent additions. */
  async #assertKnownHeads(objects:{domain:string;objectId:string;revision:number;payloadHash:string}[],requireSettled=true){
    const directory=this.#open(),prefix=await this.#knownPrefix(directory.generation),byId=new Map<string,typeof objects[number]>();
    for(const row of objects){const id=prefix+await this.#id(row.domain as E2eeContext['domain'],row.objectId);if(byId.has(id))throw new Error('E2EE_MANIFEST_MISMATCH');byId.set(id,row);}
    const ids=await this.#device.vault.listLocal('key-check',prefix);this.#device.requireOpen();
    for(const id of ids){const saved=await this.#device.vault.read('key-check',id);if(!saved)throw new Error('E2EE_CORRUPT_CHECKPOINT');
      try{const old=JSON.parse(decoder.decode(saved.value));exactKeys(old,['scopeId','generation','domain','objectId','revision','payloadHash']);
        if(old.scopeId!==this.#scopeId||old.generation!==directory.generation||typeof old.revision!=='number'||!Number.isSafeInteger(old.revision)||old.revision<1||id!==prefix+await this.#id(old.domain as E2eeContext['domain'],String(old.objectId)))throw new Error('E2EE_CORRUPT_CHECKPOINT');
        decodeE2eeBytes(old.payloadHash,32);const head=byId.get(id);if(!head||head.revision<old.revision||head.revision===old.revision&&head.payloadHash!==old.payloadHash)throw new Error('E2EE_REMOTE_ROLLBACK');
      }finally{saved.value.fill(0);}
    }
    // Adopt the durable pre-index writer history too. This is necessary for
    // candidate devices created before confirmed-head records were introduced.
    for(const id of await this.#device.vault.listLocal('outbox','job:')){const record=await this.#device.vault.read('outbox',id);if(!record)throw new Error('E2EE_CORRUPT_OUTBOX');
      try{const job=JSON.parse(decoder.decode(record.value)) as UploadJob;if(job.scopeId!==this.#scopeId||job.generation!==directory.generation)continue;
        if(!job.complete){if(requireSettled)throw new Error('E2EE_PENDING_SAVE_REQUIRED');continue;}
        for(const item of job.plan){const bytes=await this.#device.vault.read('outbox',item.recordId);if(!bytes)throw new Error('E2EE_CORRUPT_OUTBOX');
          try{const envelope=validateE2eeEnvelope(JSON.parse(decoder.decode(bytes.value))),head=byId.get(prefix+await this.#id(envelope.context.domain,envelope.context.objectId));
            if(await envelopePayloadHash(envelope)!==item.hash||!head||head.revision<envelope.context.revision||head.revision===envelope.context.revision&&head.payloadHash!==item.hash)throw new Error('E2EE_REMOTE_ROLLBACK');
          }finally{bytes.value.fill(0);}
        }
      }finally{record.value.fill(0);}
    }
    this.#device.requireOpen();if(this.#open()!==directory)throw new Error('E2EE_DIRECTORY_CONFLICT');
  }
  async #packet(action:string,payload:Record<string,WireValue>,operationId=crypto.randomUUID()) {
    const directory=this.#open();return signE2eeCommand({protocol:1,ownerId:this.#owner,scopeId:this.#scopeId,deviceId:this.#device.deviceId,action,
      expectedRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash,securityEpoch:directory.securityEpoch,operationId,payload},this.#device.keys().signing.privateKey);
  }
  async #readPacket(action:string,payload:Record<string,WireValue>) {
    if(!this.#refreshed)throw new Error('E2EE_REFRESH_REQUIRED');
    const packet=await this.#packet(action,payload);this.#device.requireOpen();const response=await this.#transport.read(packet);this.#device.requireOpen();
    if(response.checkpointHash!==packet.command.checkpointHash||response.directoryRevision!==packet.command.expectedRevision)throw new Error('E2EE_DIRECTORY_CONFLICT');return response;
  }
  async #loadJob(id:string) {
    const record=await this.#device.vault.read('outbox',`job:${id}`);if(!record)return null;
    try {
      const job=JSON.parse(decoder.decode(record.value)) as UploadJob;
      job.originId??=null;
      if(job.protocol!==1||job.scopeId!==this.#scopeId||!Array.isArray(job.plan)||job.plan.length<1||job.plan.length>258
        ||!Number.isSafeInteger(job.uploaded)||job.uploaded<0||job.uploaded>job.plan.length||typeof job.complete!=='boolean'
        ||!Number.isSafeInteger(job.size)||job.size<0||job.size>E2EE_MAX_FILE_BYTES
        ||!job.metadata||typeof job.metadata.filename!=='string'||job.metadata.filename.length>512||typeof job.metadata.mediaType!=='string'||job.metadata.mediaType.length>128
        ||!Number.isSafeInteger(job.draftParts)||job.draftParts!==Math.ceil(job.size/E2EE_CHUNK_BYTES))throw new Error('E2EE_CORRUPT_OUTBOX');
      return {job,serial:record.serial};
    }finally{record.value.fill(0);}
  }
  async #saveJob(id:string,job:UploadJob,serial:number|null,changes:LocalWrite[]=[]) {
    const bytes=encoder.encode(JSON.stringify(job));try{await this.#device.vault.write([...changes,{domain:'outbox',objectId:`job:${id}`,value:bytes,expected:serial}]);}
    finally{bytes.fill(0);}return(serial??0)+1;
  }
  async localJob(domain:E2eeContext['domain'],objectId:string):Promise<{originId:string|null;expectedRevision:number;complete:boolean}|null> {
    this.#device.requireOpen();const loaded=await this.#loadJob(await this.#id(domain,objectId));
    return loaded?{originId:loaded.job.originId,expectedRevision:loaded.job.expected,complete:loaded.job.complete}:null;
  }
  async assertVerifiedRevision(domain:E2eeContext['domain'],objectId:string,revision:number){
    this.#device.requireOpen();const floor=await this.#device.vault.read('key-check',`floor:${await this.#id(domain,objectId)}`);
    try{if(!floor||JSON.parse(decoder.decode(floor.value)).revision!==revision)throw new Error('E2EE_VERIFIED_REMOTE_REQUIRED');}
    finally{floor?.value.fill(0);}
  }
  async prepare(domain:E2eeContext['domain'],objectId:string,source:Uint8Array,expectedRevision:number,metadata={filename:'',mediaType:'application/json'},originId:string|null=null):Promise<void> {
    if(originId!==null)assertTechnical(originId);
    return this.#prepare(domain,objectId,source,expectedRevision,metadata,undefined,originId);
  }
  async #prepare(domain:E2eeContext['domain'],objectId:string,source:Uint8Array,expectedRevision:number,metadata:{filename:string;mediaType:string},replacement?:{serial:number;job:UploadJob;originId?:string},originId:string|null=null):Promise<void> {
    const directory=this.#open();if(directory.state!=='active')throw new Error('E2EE_NOT_ACTIVE');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)throw new Error('E2EE_INVALID_REVISION');
    if(source.length>E2EE_MAX_FILE_BYTES||domain==='shared-comment'&&(source.length>65536||expectedRevision!==0))throw new Error('E2EE_FILE_TOO_LARGE');
    // Snapshot caller bytes before the first await. Local acceptance never relies on a background promise.
    const bytes=new Uint8Array(source),changes:LocalWrite[]=[];
    metadata={filename:metadata.filename,mediaType:metadata.mediaType};
    try {
      await this.#device.ensureDurableKeys();const id=await this.#id(domain,objectId),previous=await this.#loadJob(id);
      const signedFloor=(await this.#sealedHeads())?.get(`${domain}\0${objectId}`);
      const savedFloor=await this.#device.vault.read('key-check',`floor:${id}`);
      try {
        const localFloor=savedFloor?JSON.parse(decoder.decode(savedFloor.value)) as {revision:number}:null;
        if(expectedRevision<Math.max(signedFloor?.revision??0,localFloor?.revision??0))throw new Error('E2EE_OBJECT_CONFLICT');
      }finally{savedFloor?.value.fill(0);}
      if(replacement) {
        if(!previous||previous.serial!==replacement.serial||previous.job.draftId!==replacement.job.draftId||previous.job.pending||previous.job.cancelling)throw new Error('E2EE_LOCAL_CONFLICT');
        changes.push({domain:'local-snapshot',objectId:`${replacement.job.draftId}:rebase:${crypto.randomUUID()}`,value:encoder.encode(JSON.stringify(replacement.job)),expected:null});
      } else if(previous){
        if(!previous.job.complete)throw new Error('E2EE_PENDING_SAVE_REQUIRED');
        // Completing a new save must not orphan the only ownership manifest
        // for the preceding ciphertext/draft. Keep its exact raw job as history.
        const raw=await this.#device.vault.read('outbox',`job:${id}`);
        try{if(!raw||raw.serial!==previous.serial)throw new Error('E2EE_LOCAL_CONFLICT');
          changes.push({domain:'local-snapshot',objectId:`${previous.job.draftId}:completed:${crypto.randomUUID()}`,value:new Uint8Array(raw.value),expected:null});
        }finally{raw?.value.fill(0);}
      }
      const root=this.#roots.get(directory.keyId);if(!root)throw new Error('E2EE_KEY_UNAVAILABLE');
      const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:this.#owner,scopeId:this.#scopeId,domain,objectId,schemaVersion:1,
        dataGeneration:directory.generation,writerProtocol:9,cryptoEpoch:directory.cryptoEpoch,securityEpoch:directory.securityEpoch,revision:expectedRevision+1,
        keyId:directory.keyId,deviceId:this.#device.deviceId,operationId:crypto.randomUUID()};
      await contentSigningKey(directory,context);
      const sealed=domain==='shared-comment'?{chunks:[],manifest:await sealE2eeEnvelope(root,this.#device.keys().signing.privateKey,context,bytes)}
        :await sealE2eeFile(root,this.#device.keys().signing.privateKey,context,bytes,metadata);
      const draftId=crypto.randomUUID(),draftParts=Math.ceil(bytes.length/E2EE_CHUNK_BYTES),plan:PlanItem[]=[];
      for(let part=0;part<draftParts;part++)changes.push({domain:'draft',objectId:`${draftId}:${part}`,value:bytes.slice(part*E2EE_CHUNK_BYTES,(part+1)*E2EE_CHUNK_BYTES),expected:null});
      for(const envelope of [...sealed.chunks,sealed.manifest]) {
        const recordId=`${draftId}:cipher:${plan.length}`;changes.push({domain:'outbox',objectId:recordId,value:encoder.encode(JSON.stringify(envelope)),expected:null});
        plan.push({recordId,hash:await envelopePayloadHash(envelope),expected:envelope===sealed.manifest?expectedRevision:0});
      }
      const job:UploadJob={protocol:1,scopeId:this.#scopeId,domain,objectId,generation:directory.generation,cryptoEpoch:directory.cryptoEpoch,keyId:directory.keyId,
        expected:expectedRevision,size:bytes.length,metadata,originId:replacement?.originId??replacement?.job.originId??originId,draftId,draftParts,plan,uploaded:0,pending:null,cancelling:null,complete:false};
      await this.#saveJob(id,job,previous?.serial??null,changes);
    }finally{bytes.fill(0);changes.forEach(change=>change.value.fill(0));}
  }
  async readDraft(domain:E2eeContext['domain'],objectId:string):Promise<Uint8Array|null> {
    this.#device.requireOpen();const state=await this.#loadJob(await this.#id(domain,objectId));if(!state)return null;
    const bytes=new Uint8Array(state.job.size);let offset=0;
    try {
      for(let part=0;part<state.job.draftParts;part++) {
        const row=await this.#device.vault.read('draft',`${state.job.draftId}:${part}`);if(!row)throw new Error('E2EE_CORRUPT_OUTBOX');
        try{if(row.value.length!==Math.min(E2EE_CHUNK_BYTES,bytes.length-offset))throw new Error('E2EE_CORRUPT_OUTBOX');bytes.set(row.value,offset);offset+=row.value.length;}finally{row.value.fill(0);}
      }
      this.#device.requireOpen();return bytes;
    }catch(error){bytes.fill(0);throw error;}
  }
  async flush(domain:E2eeContext['domain'],objectId:string,originId?:string):Promise<number> {
    if(!this.#refreshed)throw new Error('E2EE_REFRESH_REQUIRED');
    const directory=this.#open(),id=await this.#id(domain,objectId),loaded=await this.#loadJob(id);if(!loaded)throw new Error('E2EE_PENDING_SAVE_REQUIRED');
    const {job}=loaded;let serial=loaded.serial;
    if(originId!==undefined&&job.originId!==originId)throw new Error('E2EE_PENDING_EDITOR_MISMATCH');
    if(job.complete)return job.expected+1;
    if(job.cancelling)throw new Error('E2EE_DRAFT_REBASE_REQUIRED');
    if(job.generation!==directory.generation||job.cryptoEpoch!==directory.cryptoEpoch||job.keyId!==directory.keyId)throw new Error('E2EE_DRAFT_REBASE_REQUIRED');
    while(job.uploaded<job.plan.length) {
      const item=job.plan[job.uploaded],record=await this.#device.vault.read('outbox',item.recordId);if(!record)throw new Error('E2EE_CORRUPT_OUTBOX');
      let envelope:E2eeEnvelope;
      try{envelope=validateE2eeEnvelope(JSON.parse(decoder.decode(record.value)));if(await envelopePayloadHash(envelope)!==item.hash)throw new Error('E2EE_CORRUPT_OUTBOX');}finally{record.value.fill(0);}
      if(!job.pending) {job.pending=await this.#packet('put',{envelope:envelope as unknown as WireValue,expectedObjectRevision:item.expected,migrationId:null,fence:0},envelope.context.operationId);serial=await this.#saveJob(id,job,serial);}
      let result:Record<string,WireValue>;
      const pending=job.pending;
      if(pending.command.expectedRevision!==directory.checkpoint.revision||pending.command.checkpointHash!==directory.checkpoint.hash) {
        // A directory change can race a lost response. Query the old identity before
        // replacing a packet; a committed operation must never acquire a new hash.
        const lookup=await this.#readPacket('receipt',{operationId:pending.command.operationId,payloadHash:await e2eeCommandHash(pending.command)});
        if(lookup.receipt) {
          if(lookup.receipt.payloadHash!==await e2eeCommandHash(pending.command))throw new Error('E2EE_INVALID_RECEIPT');result=lookup.receipt.result;
        } else {
          job.pending=await this.#packet('put',pending.command.payload,pending.command.operationId);serial=await this.#saveJob(id,job,serial);
          this.#device.requireOpen();result=await this.#transport.command(job.pending);
        }
      } else {this.#device.requireOpen();result=await this.#transport.command(pending);}
      serial=await this.#acknowledge(id,job,serial,result);
    }
    return job.expected+1;
  }
  /** Read-only recovery of a previously sent immutable packet. A GET/list must
   * never upload an unconfirmed draft merely to discover a lost response. */
  async recoverReceipt(domain:E2eeContext['domain'],objectId:string):Promise<{originId:string;revision:number}|null>{
    if(!this.#refreshed)throw new Error('E2EE_REFRESH_REQUIRED');this.#open();const id=await this.#id(domain,objectId),loaded=await this.#loadJob(id);
    if(!loaded||!loaded.job.originId)return null;const {job}=loaded;
    if(!job.complete&&job.pending&&!job.cancelling){
      const hash=await e2eeCommandHash(job.pending.command),lookup=await this.#readPacket('receipt',{operationId:job.pending.command.operationId,payloadHash:hash});
      if(lookup.receipt){if(lookup.receipt.payloadHash!==hash)throw new Error('E2EE_INVALID_RECEIPT');if(lookup.receipt.result.cancelled!==true)await this.#acknowledge(id,job,loaded.serial,lookup.receipt.result);}
    }
    return job.complete&&job.originId!==null?{originId:job.originId,revision:job.expected+1}:null;
  }
  async #acknowledge(id:string,job:UploadJob,serial:number,result:Record<string,WireValue>) {
      this.#device.requireOpen();const pending=job.pending,item=job.plan[job.uploaded];if(!pending||!item)throw new Error('E2EE_CORRUPT_OUTBOX');
      const envelope=validateE2eeEnvelope(pending.command.payload.envelope);
      if(await envelopePayloadHash(envelope)!==item.hash||result.revision!==envelope.context.revision||result.payloadHash!==item.hash||result.generation!==job.generation)throw new Error('E2EE_INVALID_RECEIPT');
      job.uploaded++;job.pending=null;job.complete=job.uploaded===job.plan.length;
      const confirmed:LocalWrite[]=[];
      const observed=await this.#confirmed(envelope);if(observed)confirmed.push(observed);
      if(job.complete) {
        const floor=await this.#device.vault.read('key-check',`floor:${id}`);let previous:{revision:number;hash:string}|null=null;
        try{if(floor)previous=JSON.parse(decoder.decode(floor.value));}finally{floor?.value.fill(0);}
        if(previous?.revision===envelope.context.revision&&previous.hash!==item.hash)throw new Error('E2EE_REMOTE_ROLLBACK');
        if(!previous||previous.revision<envelope.context.revision) {
          const value=encoder.encode(JSON.stringify({revision:envelope.context.revision,hash:item.hash}));
          confirmed.push({domain:'key-check',objectId:`floor:${id}`,value,expected:floor?.serial??null});
        }
      }
      try{serial=await this.#saveJob(id,job,serial,confirmed);}finally{confirmed.forEach(change=>change.value.fill(0));}
      return serial;
  }
  /** Resolves the old request under a server writer lock before replacing its
   * ciphertext. Every old draft/job remains encrypted locally for recovery. */
  async rebase(domain:E2eeContext['domain'],objectId:string,expectedRevision:number,metadata?:{filename:string;mediaType:string},originId?:string):Promise<'rebased'|'already-confirmed'> {
    return this.#rebase(domain,objectId,expectedRevision,metadata,originId);
  }
  async replaceReviewed(domain:E2eeContext['domain'],objectId:string,source:Uint8Array,expectedRevision:number,originId:string,metadata:{filename:string;mediaType:string}){
    assertTechnical(originId);const bytes=new Uint8Array(source);
    try{return await this.#rebase(domain,objectId,expectedRevision,metadata,undefined,{bytes,originId});}finally{bytes.fill(0);}
  }
  async #rebase(domain:E2eeContext['domain'],objectId:string,expectedRevision:number,metadata?:{filename:string;mediaType:string},originId?:string,replacement?:{bytes:Uint8Array;originId:string}):Promise<'rebased'|'already-confirmed'> {
    if(!this.#refreshed)throw new Error('E2EE_REFRESH_REQUIRED');
    this.#open();const id=await this.#id(domain,objectId),loaded=await this.#loadJob(id);
    if(!loaded){if(!replacement)throw new Error('E2EE_PENDING_SAVE_REQUIRED');await this.prepare(domain,objectId,replacement.bytes,expectedRevision,metadata,replacement.originId);return'rebased';}
    const {job}=loaded;let serial=loaded.serial;
    if(originId!==undefined&&job.originId!==originId)throw new Error('E2EE_PENDING_EDITOR_MISMATCH');
    if(job.complete&&!replacement)return 'already-confirmed';
    if(job.pending) {
      if(!job.cancelling) {
        const value=encoder.encode(JSON.stringify(job));
        job.cancelling=await this.#packet('cancel-put',{original:job.pending as unknown as WireValue});
        try{serial=await this.#saveJob(id,job,serial,[{domain:'local-snapshot',objectId:`${job.draftId}:cancel:${crypto.randomUUID()}`,value,expected:null}]);}finally{value.fill(0);}
      }
      let result:Record<string,WireValue>|undefined;
      if(job.cancelling.command.checkpointHash!==this.#open().checkpoint.hash) {
        const old=job.cancelling;const lookup=await this.#readPacket('receipt',{operationId:old.command.operationId,payloadHash:await e2eeCommandHash(old.command)});
        if(lookup.receipt)result=lookup.receipt.result;
        else {job.cancelling=await this.#packet('cancel-put',old.command.payload,old.command.operationId);serial=await this.#saveJob(id,job,serial);}
      }
      if(!result){this.#device.requireOpen();result=await this.#transport.command(job.cancelling);}
      this.#device.requireOpen();const receipt=result.operationReceipt;
      if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||receipt.payloadHash!==await e2eeCommandHash(job.pending.command)
        ||!receipt.result||typeof receipt.result!=='object'||Array.isArray(receipt.result))throw new Error('E2EE_INVALID_RECEIPT');
      job.cancelling=null;
      if(receipt.result.cancelled===true){job.pending=null;serial=await this.#saveJob(id,job,serial);}
      else serial=await this.#acknowledge(id,job,serial,receipt.result);
      if(job.complete&&!replacement)return 'already-confirmed';
    }
    if(replacement&&job.complete&&job.expected+1>expectedRevision)throw new Error('E2EE_CONFLICT_REVIEW_STALE');
    const bytes=replacement?new Uint8Array(replacement.bytes):await this.readDraft(domain,objectId);if(!bytes)throw new Error('E2EE_CORRUPT_OUTBOX');
    try{await this.#prepare(domain,objectId,bytes,expectedRevision,metadata??job.metadata,{job,serial,...(replacement?{originId:replacement.originId}:{})});return 'rebased';}finally{bytes.fill(0);}
  }
  async #getEnvelope(domain:E2eeContext['domain'],objectId:string) {
    const response=await this.#readPacket('get',{domain,objectId});
    if(!response.envelopes||response.envelopes.length>1)throw new Error('E2EE_INVALID_RESPONSE');
    return response.envelopes.length?validateE2eeEnvelope(response.envelopes[0]):null;
  }
  async #loadSealedHeads(allowNetwork:boolean) {
    const sealed=this.#open().sealedHeads;if(!sealed)return null;
    let heads=this.#sealedCache.get(sealed.hash);
    if(!heads) {
      const record=await this.#device.vault.read('key-check',`heads:${sealed.hash}`);
      let objects:{domain:string;objectId:string;revision:number;payloadHash:string}[]|undefined;
      try{if(record)objects=JSON.parse(decoder.decode(record.value));}finally{record?.value.fill(0);}
      if(!objects) {
        if(!allowNetwork)throw new Error('E2EE_SEALED_HEADS_REQUIRED');
        objects=(await this.#readPacket('sealed-heads',{cryptoEpoch:sealed.cryptoEpoch})).objects;
        if(!objects||objects.length!==sealed.count||await objectManifestHash(objects)!==sealed.hash)throw new Error('E2EE_MANIFEST_MISMATCH');
        const bytes=encoder.encode(JSON.stringify(objects));
        try{await this.#device.vault.write([{domain:'key-check',objectId:`heads:${sealed.hash}`,value:bytes,expected:null}]);}finally{bytes.fill(0);}
      }
      if(!Array.isArray(objects)||objects.length!==sealed.count||await objectManifestHash(objects)!==sealed.hash)throw new Error('E2EE_MANIFEST_MISMATCH');
      heads=new Map(objects.map(item=>[`${item.domain}\0${item.objectId}`,{revision:item.revision,payloadHash:item.payloadHash}]));this.#sealedCache.set(sealed.hash,heads);
    }
    return heads;
  }
  async #sealedHeads(){return this.#loadSealedHeads(false);}
  async #historicalHead(envelope:E2eeEnvelope) {
    const current=this.#open(),context=envelope.context;
    const head=(await this.#sealedHeads())?.get(`${context.domain}\0${context.objectId}`);
    const payloadHash=await envelopePayloadHash(envelope);
    if(head&&(context.revision<head.revision||context.revision===head.revision&&payloadHash!==head.payloadHash))throw new Error('E2EE_REMOTE_ROLLBACK');
    if(context.cryptoEpoch===current.cryptoEpoch)return;
    const sealed=current.sealedHeads;if(!sealed||context.cryptoEpoch>sealed.cryptoEpoch)throw new Error('E2EE_UNSEALED_HISTORY');
    if(!head||head.revision!==context.revision||head.payloadHash!==payloadHash)throw new Error('E2EE_UNSEALED_HISTORY');
  }
  async read(domain:E2eeContext['domain'],objectId:string,expected?:{revision:number;payloadHash:string}):Promise<{bytes:Uint8Array;filename:string;mediaType:string;revision:number}|null> {
    this.#open();const id=await this.#id(domain,objectId),floorRecord=await this.#device.vault.read('key-check',`floor:${id}`);
    let floor:{revision:number;hash:string}|null=null;
    try{if(floorRecord)floor=JSON.parse(decoder.decode(floorRecord.value));}finally{floorRecord?.value.fill(0);}
    const envelope=await this.#getEnvelope(domain,objectId);
    if(!envelope){if(floor||(await this.#sealedHeads())?.has(`${domain}\0${objectId}`))throw new Error('E2EE_REMOTE_ROLLBACK');return null;}
    const context=envelope.context,directory=this.#history.get(epochKey({cryptoEpoch:context.cryptoEpoch,securityEpoch:context.securityEpoch,keyId:context.keyId,generation:context.dataGeneration}));
    if(!directory||context.ownerId!==this.#owner||context.scopeId!==this.#scopeId||context.domain!==domain||context.objectId!==objectId)throw new Error('E2EE_CONTEXT_MISMATCH');
    const payloadHash=await envelopePayloadHash(envelope);
    if(expected&&(context.revision!==expected.revision||payloadHash!==expected.payloadHash))throw new Error('E2EE_MANIFEST_MISMATCH');
    if(floor&&(context.revision<floor.revision||context.revision===floor.revision&&payloadHash!==floor.hash))throw new Error('E2EE_REMOTE_ROLLBACK');
    const root=this.#roots.get(context.keyId);if(!root)throw new Error('E2EE_KEY_UNAVAILABLE');
    await this.#historicalHead(envelope);
    const signer=await contentSigningKey(directory,context);
    const chunks:E2eeEnvelope[]=[];
    const opened=domain==='shared-comment'?{bytes:await openE2eeEnvelope(root,signer,context,envelope),filename:'',mediaType:'application/json'}
      :await openE2eeFile(root,signer,context,envelope,async chunkId=>{const chunk=await this.#getEnvelope('attachment',chunkId);if(!chunk)throw new Error('E2EE_CORRUPT_FILE');await this.#historicalHead(chunk);chunks.push(chunk);return chunk;});
    const encoded=encoder.encode(JSON.stringify({revision:context.revision,hash:payloadHash}));
    const writes:LocalWrite[]=[{domain:'key-check',objectId:`floor:${id}`,value:encoded,expected:floorRecord?.serial??null}];
    try{for(const record of [...chunks,envelope]){const observed=await this.#confirmed(record);if(observed)writes.push(observed);}
      await this.#device.vault.write(writes);this.#device.requireOpen();return{...opened,revision:context.revision};}
    catch(error){opened.bytes.fill(0);throw error;}finally{writes.forEach(write=>write.value.fill(0));}
  }
  async assertObjectReference(domain:E2eeContext['domain'],objectId:string,revision:number,payloadHash:unknown){
    const directory=this.#open(),envelope=await this.#getEnvelope(domain,objectId);this.#device.requireOpen();
    if(!envelope||envelope.context.ownerId!==this.#owner||envelope.context.scopeId!==this.#scopeId||envelope.context.dataGeneration!==directory.generation
      ||envelope.context.domain!==domain||envelope.context.objectId!==objectId||envelope.context.revision!==revision
      ||typeof payloadHash!=='string'||await envelopePayloadHash(envelope)!==payloadHash)throw new Error('E2EE_OBJECT_REFERENCE_MISMATCH');
    this.#device.requireOpen();
  }
  /** Business intent is durable independently of a checkpoint-bound transport
   * packet. Renewal never changes the intended mutation or replays an import. */
  async executeService(action:'product-commit'|'product-approve'|'stoicheion-grant'|'advice-issue'|'product-bootstrap-start'|'product-bootstrap-stage'|'product-bootstrap-complete'|'resource-create-prepare'|'resource-create-resolve'|'shared-invitations-issue'|'shared-invitation-revoke'|'shared-invitation-respond',payload:Record<string,WireValue>,intentId:string){
    assertTechnical(intentId);const held=snapshotE2eeValue({...payload,intentId}),id=`service:${await hash(`${action}\0${intentId}`)}`;
    for(let attempt=0;attempt<2;attempt++){
      const directory=this.#open(),prior=await this.#device.vault.read('outbox',id);this.#device.requireOpen();let packet:SignedE2eeCommand;
      try{
        let old:SignedE2eeCommand|undefined;if(prior){old=JSON.parse(decoder.decode(prior.value));const command=old!.command;
          const actual=canonicalE2eeValue(command.payload),expected=canonicalE2eeValue(held);
          if(command?.action!==action||command.ownerId!==this.#owner||command.scopeId!==this.#scopeId||command.deviceId!==this.#device.deviceId
            ||actual.length!==expected.length||actual.some((byte,index)=>byte!==expected[index]))throw new Error('E2EE_CORRUPT_OUTBOX');}
        const current=old?.command.expectedRevision===directory.checkpoint.revision&&old.command.securityEpoch===directory.securityEpoch&&old.command.checkpointHash===directory.checkpoint.hash;
        packet=current?old!:await this.#packet(action,held);
        if(!current){const bytes=encoder.encode(JSON.stringify(packet));try{await this.#device.vault.write([
          ...(prior?[{domain:'local-snapshot' as const,objectId:`${id}:attempt:${prior.serial}`,value:prior.value,expected:null}]:[]),
          {domain:'outbox',objectId:id,value:bytes,expected:prior?.serial??null}]);}finally{bytes.fill(0);}}
        this.#device.requireOpen();const result=await this.#transport.command(packet);this.#device.requireOpen();return result;
      }catch(error){if(attempt!==0||!(error instanceof Error)||!['E2EE_STALE_EPOCH','E2EE_DIRECTORY_CONFLICT','E2EE_CHECKPOINT_MISMATCH'].includes(error.message))throw error;}
      finally{prior?.value.fill(0);}
      await this.refresh();this.#device.requireOpen();
    }throw new Error('E2EE_DIRECTORY_CONFLICT');
  }
  /** Catalogue completeness is checked against protected observations and the
   * signed migration/retirement floors. A fresh device still cannot prove that
   * an otherwise malicious server disclosed all previously unseen objects. */
  async contentHeads(){
    const directory=this.#open();if(!this.#refreshed||!['active','retirement'].includes(directory.state))throw new Error('E2EE_REFRESH_REQUIRED');
    const objects:{domain:string;objectId:string;revision:number;payloadHash:string}[]=[];let manifestHash:string|null=null,count=-1;
    do{const response=await this.#readPacket('content-heads',{offset:objects.length,manifestHash});this.#device.requireOpen();
      if(!Number.isSafeInteger(response.objectCount)||Number(response.objectCount)<0||Number(response.objectCount)>10000||!Array.isArray(response.objects)||response.objects.length>50||typeof response.manifestHash!=='string')throw new Error('E2EE_MANIFEST_MISMATCH');
      decodeE2eeBytes(response.manifestHash,32);if(manifestHash!==null&&(manifestHash!==response.manifestHash||count!==response.objectCount))throw new Error('E2EE_MANIFEST_MISMATCH');
      manifestHash=response.manifestHash;count=response.objectCount!;
      for(const row of response.objects){exactKeys(row,['domain','objectId','revision','payloadHash']);assertTechnical(row.objectId);decodeE2eeBytes(row.payloadHash,32);
        if(!E2EE_DOMAINS.includes(row.domain as E2eeContext['domain'])||!Number.isSafeInteger(row.revision)||row.revision<1)throw new Error('E2EE_MANIFEST_MISMATCH');objects.push({...row});}
      if(objects.length>count||response.objects.length===0&&objects.length<count)throw new Error('E2EE_MANIFEST_MISMATCH');
    }while(objects.length<count);
    if(await objectManifestHash(objects)!==manifestHash)throw new Error('E2EE_MANIFEST_MISMATCH');await this.#assertKnownHeads(objects,false);
    const floors=await this.#sealedHeads(),byId=new Map(objects.map(row=>[`${row.domain}\0${row.objectId}`,row]));
    for(const [id,floor]of floors??[]){const row=byId.get(id);if(!row||row.revision<floor.revision||row.revision===floor.revision&&row.payloadHash!==floor.payloadHash)throw new Error('E2EE_REMOTE_ROLLBACK');}
    this.#device.requireOpen();if(this.#open()!==directory)throw new Error('E2EE_DIRECTORY_CONFLICT');return{objects,manifestHash:manifestHash!,objectCount:count};
  }
  async readProductIndex(after='',limit=50){if(after)assertTechnical(after);if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error('E2EE_INVALID_LIMIT');
    return this.#readPacket('product-index',{after,limit});}
  async readStoicheionState():Promise<unknown>{return this.#readPacket('stoicheion-state',{protocol:1});}
  async readBootstrapState(afterPart=-1){if(!Number.isInteger(afterPart)||afterPart< -1||afterPart>4095)throw new Error('E2EE_INVALID_LIMIT');return this.#readPacket('product-bootstrap-state',{afterPart:afterPart===-1?null:afterPart});}
  async readProductContext(){return this.#readPacket('product-context',{protocol:1});}
  async readTransitionCandidates(){return this.#readPacket('resource-transition-candidates',{protocol:1});}
  /** Routing proposal only. The UI must separately obtain explicit consent,
   * and the creation journal must independently verify its pinned anchors. */
  async readProjectCreationPreview(resourceId:string,input:PrivateProjectSelection){
    assertTechnical(resourceId);const selected=validatePrivateProjectSelection(input);
    const response=await this.#readPacket('project-create-preview',{resourceId,topology:selected as unknown as WireValue});
    exactKeys(response,['resourceId','topology','checkpointHash','directoryRevision']);if(response.resourceId!==resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const topology=validatePrivateProjectTopology(response.topology,this.#device.ownerId);
    const actual=Object.fromEntries((Object.keys(selected) as (keyof PrivateProjectSelection)[]).map(key=>[key,topology[key]]));
    const left=canonicalE2eeValue(selected as unknown as WireValue),right=canonicalE2eeValue(actual as WireValue);
    try{if(left.length!==right.length||left.some((byte,at)=>byte!==right[at]))throw new Error('E2EE_PROJECT_TOPOLOGY_CHANGED');}finally{left.fill(0);right.fill(0);}
    this.#device.requireOpen();return topology;
  }
  async readSharedInvitationPage(after='',limit=50){if(after)assertTechnical(after);if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error('E2EE_INVALID_LIMIT');return this.#readPacket('shared-invitations-page',{after,limit});}
  async readSharedInvitationResponse(id:string){assertTechnical(id);return this.#readPacket('shared-invitation-response-state',{id});}
  async readPendingInvitationPage(after='',limit=50){if(after)assertTechnical(after);if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error('E2EE_INVALID_LIMIT');return this.#readPacket('shared-invitation-pending',{after,limit});}
  async readInvitationState(ids:string[]){if(ids.length>20||new Set(ids).size!==ids.length)throw new Error('E2EE_INVALID_LIMIT');for(const id of ids)assertTechnical(id);return this.#readPacket('shared-invitation-state',{ids});}
  async sharedReadHistory(){const result=await this.#readPacket('shared-read-history',{protocol:1});exactKeys(result,['history','checkpointHash','directoryRevision']);return result.history;}
  async readProductHistory(entityId:string,before:number,limit=5){assertTechnical(entityId);if(!Number.isSafeInteger(before)||before<1||!Number.isInteger(limit)||limit<1||limit>10)throw new Error('E2EE_INVALID_LIMIT');return this.#readPacket('product-history',{entityId,before,limit});}
  async readAdvicePolicy():Promise<unknown>{return this.#readPacket('advice-policy',{protocol:1});}
  async originalMigrationManifest(){
    this.#open();const frame=[...this.#directoryFrames.values()].find(frame=>frame.state==='active'&&frame.sealedHeads?.cryptoEpoch===0),sealed=frame?.sealedHeads;
    if(!sealed)throw new Error('E2EE_MIGRATION_PROOF_REQUIRED');const response=await this.#readPacket('sealed-heads',{cryptoEpoch:0});
    if(!response.objects||response.objects.length!==sealed.count||await objectManifestHash(response.objects)!==sealed.hash)throw new Error('E2EE_MANIFEST_MISMATCH');
    this.#device.requireOpen();return{manifestHash:sealed.hash,objectCount:sealed.count};
  }
  async readMigrationOriginal(domain:E2eeContext['domain'],objectId:string){
    this.#open();const frame=[...this.#directoryFrames.values()].find(frame=>frame.state==='active'&&frame.sealedHeads?.cryptoEpoch===0),sealed=frame?.sealedHeads;if(!sealed)throw new Error('E2EE_MIGRATION_PROOF_REQUIRED');
    const response=await this.#readPacket('sealed-heads',{cryptoEpoch:0});this.#device.requireOpen();if(!response.objects||response.objects.length!==sealed.count||await objectManifestHash(response.objects)!==sealed.hash)throw new Error('E2EE_MANIFEST_MISMATCH');
    const reference=response.objects.find(row=>row.domain===domain&&row.objectId===objectId);if(!reference||reference.revision!==1)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
    const opened=await this.read(domain,objectId,reference);if(!opened)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');return opened;
  }
  async authorizeMembership(intentId:string,changeHash:string){
    assertTechnical(intentId);decodeE2eeBytes(changeHash,32);const directory=this.#open(),own=directory.devices.get(this.#device.deviceId);
    if(!this.#refreshed||directory.kind!=='personal'||directory.ownerId!==this.#device.ownerId||directory.state!=='active'||own?.role!=='owner'||own.revoked)throw new Error('E2EE_OWNER_REQUIRED');
    return this.#packet('membership-authorize',{intentId,changeHash});
  }
  async authorizeMembershipAtomic(action:MembershipAtomicStagingAction,input:Record<string,WireValue>){
    const payload=membershipAtomicStagingPayload(action,input),directory=this.#open(),own=directory.devices.get(this.#device.deviceId);
    if(!this.#refreshed||directory.kind!=='personal'||directory.ownerId!==this.#device.ownerId||directory.state!=='active'||own?.role!=='owner'||own.revoked)throw new Error('E2EE_OWNER_REQUIRED');
    return this.#packet(action,payload);
  }
  async authorizeMembershipAtomicApply(action:MembershipAtomicApplyAction,input:Record<string,WireValue>){
    const payload=membershipAtomicApplyPayload(action,input),directory=this.#open(),own=directory.devices.get(this.#device.deviceId);
    if(!this.#refreshed||directory.kind!=='personal'||directory.ownerId!==this.#device.ownerId||directory.state!=='active'||own?.role!=='owner'||own.revoked)throw new Error('E2EE_OWNER_REQUIRED');
    return this.#packet(action,payload);
  }
  /** Frozen packet for the containing transaction. It cannot be executed by
   * the ordinary command route or renewed into a different directory frame. */
  async prepareMembershipProduct(intentId:string,membershipHash:string,input:ProductMutation[]){
    assertTechnical(intentId);decodeE2eeBytes(membershipHash,32);const operations=input.map(productMutation);
    if(operations.length<1||operations.length>100||new Set(operations.map(row=>row.entityId)).size!==operations.length)throw new Error('E2EE_PRODUCT_BATCH_INVALID');
    const payload=snapshotE2eeValue({intentId,membershipHash,operations}) as unknown as Record<string,WireValue>,id='membership-product:'+await hash(this.#scopeId+'\0'+intentId),prior=await this.#device.vault.read('outbox',id);this.#device.requireOpen();
    try{if(prior){const packet=JSON.parse(decoder.decode(prior.value)) as SignedE2eeCommand,c=packet.command;
      const before=canonicalE2eeValue(c.payload),after=canonicalE2eeValue(payload);try{if(c.action!=='product-commit-bound'||c.ownerId!==this.#owner||c.scopeId!==this.#scopeId||c.deviceId!==this.#device.deviceId||before.length!==after.length||before.some((byte,index)=>byte!==after[index]))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}finally{before.fill(0);after.fill(0);}return snapshotE2eeValue(packet);}
      const directory=this.#open(),own=directory.devices.get(this.#device.deviceId);if(!this.#refreshed||directory.state!=='active'||!own||own.revoked||!['owner','writer'].includes(own.role))throw new Error('E2EE_WRITE_FORBIDDEN');
      const packet=await this.#packet('product-commit-bound',payload),bytes=encoder.encode(JSON.stringify(packet));try{await this.#device.vault.write([{domain:'outbox',objectId:id,value:bytes,expected:null}]);this.#device.requireOpen();}finally{bytes.fill(0);}return snapshotE2eeValue(packet);
    }finally{prior?.value.fill(0);}
  }
  async prepareDeviceAccess(input:DeviceAccessRequest,comparedFingerprint:string){
    const request=await verifyDeviceAccessRequest(input),directory=this.#open();this.#device.requireOpen();
    const own=directory.devices.get(this.#device.deviceId),target=request.target,challenge=request.challenge;
    if(!this.#refreshed||directory.state!=='active'||directory.ownerId!==this.#device.ownerId||!own||own.revoked||own.role!=='owner'
      ||target.scopeId!==this.#scopeId||target.ownerId!==this.#owner||target.kind!==directory.kind||target.resourceId!==directory.resourceId
      ||target.authority.signingKey!==this.#pin.signingKey||target.authority.receivingKey!==this.#pin.receivingKey)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    if(await deviceAccessFingerprint(request)!==comparedFingerprint)throw new Error('E2EE_DEVICE_FINGERPRINT_REQUIRED');
    if(challenge.expiresAt*1000<=Date.now())throw new Error('E2EE_CHALLENGE_EXPIRED');if(directory.devices.has(challenge.deviceId))throw new Error('E2EE_DEVICE_ALREADY_KNOWN');
    const forward=async(grant:{cryptoEpoch:number;keyId:string;capsule:unknown})=>{
      const context={ownerId:this.#owner,scopeId:this.#scopeId,cryptoEpoch:grant.cryptoEpoch,keyId:grant.keyId};
      const capsule=await forwardRoot(grant.capsule,this.#device.keys().receiving.privateKey,{...context,recipientId:this.#device.deviceId},challenge.receivingKey,{...context,recipientId:challenge.deviceId});
      this.#device.requireOpen();if(this.#open()!==directory)throw new Error('E2EE_DIRECTORY_CONFLICT');return capsule;
    };
    const historyCapsules:WireValue[]=[];for(const grant of own.historyCapsules)historyCapsules.push({cryptoEpoch:grant.cryptoEpoch,keyId:grant.keyId,capsule:await forward(grant) as unknown as WireValue});
    const capsule=await forward({cryptoEpoch:directory.cryptoEpoch,keyId:directory.keyId,capsule:own.capsule});
    if(this.#open()!==directory)throw new Error('E2EE_DIRECTORY_CONFLICT');return this.#packet('enroll',{challenge:challenge as unknown as WireValue,selfProof:request.selfProof,historyCapsules,capsule:capsule as unknown as WireValue});
  }
  async confirmMembershipRotation(packet:SignedE2eeCommand){
    const command=packet.command;if(command.scopeId!==this.#scopeId||command.ownerId!==this.#owner||command.action!=='rotate-membership')throw new Error('E2EE_CONTEXT_MISMATCH');
    await this.refresh();const frame=this.#directoryFrames.get(command.expectedRevision+1);
    const expected=await hash(`${command.checkpointHash}\0${await e2eeCommandHash(command)}`);
    if(!frame||frame.checkpoint.hash!==expected||frame.cryptoEpoch!==command.payload.cryptoEpoch||frame.keyId!==command.payload.keyId)throw new Error('E2EE_INVALID_RECEIPT');
    this.#device.requireOpen();
  }
  /** The caller supplies an explicitly reviewed COMPLETE recipient roster. A
   * server preview may propose it, but may never silently approve recipients.
   * Only public HPKE capsules enter the durable retry record or the network. */
  async prepareMembershipRotation(changeHash:string,reviewed:ReviewedDeviceRole[],manifest:{manifestHash:string;objectCount:number},expected:{directoryRevision:number;checkpointHash:string;cryptoEpoch:number;securityEpoch:number;ownerId:string;kind:string;resourceId:string}):Promise<SignedE2eeCommand>{
    decodeE2eeBytes(changeHash,32);decodeE2eeBytes(manifest.manifestHash,32);const roles=snapshotE2eeValue(reviewed),directory=this.#open(),own=directory.devices.get(this.#device.deviceId);
    if(!this.#refreshed||directory.kind==='personal'||directory.ownerId!==this.#device.ownerId||own?.role!=='owner'||own.revoked||!['active','retirement'].includes(directory.state))throw new Error('E2EE_OWNER_REQUIRED');
    const live=[...directory.devices.values()].filter(row=>!row.revoked),seen=new Set<string>();
    if(!Array.isArray(roles)||roles.length!==live.length||roles.length>256)throw new Error('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
    for(const row of roles){exactKeys(row,['deviceId','role']);assertTechnical(row.deviceId);const known=directory.devices.get(row.deviceId);
      if(!known||known.revoked||seen.has(row.deviceId)||row.role!==null&&!['owner','writer','commenter','reader'].includes(row.role)
        ||known.userId===directory.ownerId&&row.role!=='owner'||known.userId!==directory.ownerId&&row.role==='owner')throw new Error('E2EE_MEMBERSHIP_ROLE_INVALID');seen.add(row.deviceId);}
    const key=`rotation:${await hash(`${this.#scopeId}\0${changeHash}`)}`,previous=await this.#device.vault.read('outbox',key);this.#device.requireOpen();
    try{
      if(previous){const saved=JSON.parse(decoder.decode(previous.value));exactKeys(saved,['protocol','roles','manifest','packet']);
        if(!saved.manifest||typeof saved.manifest!=='object'||Array.isArray(saved.manifest)||!saved.packet||typeof saved.packet!=='object'||Array.isArray(saved.packet))throw new Error('E2EE_CORRUPT_OUTBOX');
         const manifestSaved=saved.manifest as Record<string,unknown>,packetSaved=saved.packet as SignedE2eeCommand;
         if(saved.protocol!==1||encodeE2eeBytes(canonicalE2eeValue(saved.roles as WireValue))!==encodeE2eeBytes(canonicalE2eeValue(roles))
          ||manifestSaved.manifestHash!==manifest.manifestHash||manifestSaved.objectCount!==manifest.objectCount||packetSaved.command?.payload?.membershipHash!==changeHash
          ||packetSaved.command.scopeId!==this.#scopeId||packetSaved.command.ownerId!==this.#owner||packetSaved.command.deviceId!==this.#device.deviceId||packetSaved.command.action!=='rotate-membership')throw new Error('E2EE_CORRUPT_OUTBOX');
        await verifyE2eeCommand(packetSaved,this.#device.keys().signing.publicKey);return snapshotE2eeValue(packetSaved) as SignedE2eeCommand;
      }
      if(expected.directoryRevision!==directory.checkpoint.revision||expected.checkpointHash!==directory.checkpoint.hash||expected.cryptoEpoch!==directory.cryptoEpoch||expected.securityEpoch!==directory.securityEpoch
        ||expected.ownerId!==this.#owner||expected.kind!==directory.kind||expected.resourceId!==directory.resourceId)throw new Error('E2EE_MEMBERSHIP_STALE');
      if(!Number.isSafeInteger(manifest.objectCount)||manifest.objectCount<0||manifest.objectCount>10000)throw new Error('E2EE_MANIFEST_MISMATCH');
      const objects:NonNullable<Awaited<ReturnType<ScopeTransport['read']>>['objects']>=[];
      do{const response=await this.#readPacket('active-heads',{offset:objects.length,manifestHash:objects.length===0?null:manifest.manifestHash});
        if(response.manifestHash!==manifest.manifestHash||response.objectCount!==manifest.objectCount||!Array.isArray(response.objects)||response.objects.length>50
          ||objects.length+response.objects.length>manifest.objectCount||response.objects.length===0&&objects.length<manifest.objectCount)throw new Error('E2EE_MANIFEST_MISMATCH');
        objects.push(...response.objects);
      }while(objects.length<manifest.objectCount);
      if(await objectManifestHash(objects)!==manifest.manifestHash)throw new Error('E2EE_MANIFEST_MISMATCH');
      await this.#assertKnownHeads(objects);
      const heads=new Map(objects.map(row=>[`${row.domain}\0${row.objectId}`,row]));
      for(const [id,floor] of await this.#sealedHeads()??[]){const head=heads.get(id);if(!head||head.revision<floor.revision||head.revision===floor.revision&&head.payloadHash!==floor.payloadHash)throw new Error('E2EE_REMOTE_ROLLBACK');}
      // Each current head must prove its historical device authority. The final
      // rotation CAS rejects a concurrent object change after this readback.
      for(const head of objects){exactKeys(head,['domain','objectId','revision','payloadHash']);assertTechnical(head.objectId);decodeE2eeBytes(head.payloadHash,32);
        const envelope=await this.#getEnvelope(head.domain as E2eeContext['domain'],head.objectId);if(!envelope||envelope.context.revision!==head.revision||await envelopePayloadHash(envelope)!==head.payloadHash)throw new Error('E2EE_MANIFEST_MISMATCH');
        const context=envelope.context,frame=this.#history.get(epochKey({cryptoEpoch:context.cryptoEpoch,securityEpoch:context.securityEpoch,keyId:context.keyId,generation:context.dataGeneration}));
        if(!frame||context.ownerId!==this.#owner||context.scopeId!==this.#scopeId||context.domain!==head.domain||context.objectId!==head.objectId||context.dataGeneration!==directory.generation)throw new Error('E2EE_CONTEXT_MISMATCH');
        await verifyE2eeEnvelope(envelope,context,await contentSigningKey(frame,context));await this.#historicalHead(envelope);
        const floor=await this.#device.vault.read('key-check',`floor:${await this.#id(context.domain,context.objectId)}`);
        try{if(floor){const prior=JSON.parse(decoder.decode(floor.value));if(head.revision<prior.revision||head.revision===prior.revision&&head.payloadHash!==prior.hash)throw new Error('E2EE_REMOTE_ROLLBACK');}}finally{floor?.value.fill(0);}
      }
      this.#device.requireOpen();if(this.#open()!==directory)throw new Error('E2EE_DIRECTORY_CONFLICT');
      const root=freshSecret(),keyId=crypto.randomUUID(),capsules:WireValue[]=[],cryptoEpoch=directory.cryptoEpoch+1;
      try{
        for(const row of roles)if(row.role!==null){const recipient=directory.devices.get(row.deviceId)!;capsules.push({deviceId:row.deviceId,capsule:await sealRoot(root,recipient.receivingKey,{ownerId:this.#owner,scopeId:this.#scopeId,cryptoEpoch,keyId,recipientId:row.deviceId}) as unknown as WireValue});}
        const recoveryCapsule=await sealRoot(root,directory.recoveryKit.authority.receivingKey,{ownerId:this.#owner,scopeId:this.#scopeId,cryptoEpoch,keyId,recipientId:'recovery'});
        this.#device.requireOpen();if(this.#open()!==directory)throw new Error('E2EE_DIRECTORY_CONFLICT');
        await this.#assertKnownHeads(objects);
        const packet=await this.#packet('rotate-membership',{membershipHash:changeHash,revokedDeviceIds:roles.filter(row=>row.role===null).map(row=>row.deviceId),
          roleChanges:roles.filter(row=>row.role!==null) as unknown as WireValue,cryptoEpoch,securityEpoch:directory.securityEpoch+1,keyId,capsules,recoveryCapsule:recoveryCapsule as unknown as WireValue,retiredManifestHash:manifest.manifestHash,retiredObjectCount:manifest.objectCount});
        const bytes=encoder.encode(JSON.stringify({protocol:1,roles,manifest,packet}));try{await this.#device.vault.write([{domain:'outbox',objectId:key,value:bytes,expected:null}]);}finally{bytes.fill(0);}
        return packet;
      }finally{root.fill(0);}
    }finally{previous?.value.fill(0);}
  }
  async objectReference(domain:E2eeContext['domain'],objectId:string){
    const directory=this.#open(),envelope=await this.#getEnvelope(domain,objectId);this.#device.requireOpen();if(!envelope)throw new Error('E2EE_PRIVATE_DOCUMENT_MISSING');
    const context=envelope.context,frame=this.#history.get(epochKey({cryptoEpoch:context.cryptoEpoch,securityEpoch:context.securityEpoch,keyId:context.keyId,generation:context.dataGeneration}));
    if(!frame||context.ownerId!==this.#owner||context.scopeId!==this.#scopeId||context.domain!==domain||context.objectId!==objectId||context.dataGeneration!==directory.generation)throw new Error('E2EE_CONTEXT_MISMATCH');
    const root=this.#roots.get(context.keyId);if(!root)throw new Error('E2EE_KEY_UNAVAILABLE');await this.#historicalHead(envelope);
    const bytes=await openE2eeEnvelope(root,await contentSigningKey(frame,context),context,envelope);bytes.fill(0);this.#device.requireOpen();
    return{scopeId:this.#scopeId,generation:context.dataGeneration,revision:context.revision,payloadHash:await envelopePayloadHash(envelope)};
  }
  async verifyServiceProof(input:SignedE2eeCommand){
    this.#open();const packet=snapshotE2eeValue(input),command=packet.command,frame=this.#directoryFrames.get(command.expectedRevision);
    if(!frame||command.ownerId!==this.#owner||command.scopeId!==this.#scopeId||command.checkpointHash!==frame.checkpoint.hash||command.securityEpoch!==frame.securityEpoch
      ||!['product-commit','product-commit-bound','product-approve','product-bootstrap-stage','product-bootstrap-complete'].includes(command.action))throw new Error('E2EE_PRODUCT_PROOF_INVALID');
    const signer=frame.devices.get(command.deviceId);if(!signer||signer.revoked)throw new Error('E2EE_PRODUCT_PROOF_INVALID');
    if(command.action.startsWith('product-bootstrap-')&&(signer.role!=='owner'||signer.userId!==frame.ownerId))throw new Error('E2EE_PRODUCT_PROOF_INVALID');
    if(command.action==='product-commit-bound'){
      const accepted=this.#directoryFrames.get(command.expectedRevision+1);if(!accepted||accepted.membershipHash!==command.payload.membershipHash||accepted.cryptoEpoch!==frame.cryptoEpoch+1)throw new Error('E2EE_PRODUCT_PROOF_INVALID');
    }
    if(command.action==='product-commit'||command.action==='product-commit-bound'){
      const operations=command.payload.operations;if(!Array.isArray(operations)||operations.length<1||operations.length>100)throw new Error('E2EE_PRODUCT_PROOF_INVALID');
      for(const row of operations){if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('E2EE_PRODUCT_PROOF_INVALID');const comment=['comment','project-comment'].includes(String(row.kind));
        if(!(comment?['owner','writer','commenter']:['owner','writer']).includes(signer.role))throw new Error('E2EE_PRODUCT_PROOF_INVALID');}
    }
    const key=await crypto.subtle.importKey('spki',decodeE2eeBytes(signer.signingKey,91),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    const verified=await verifyE2eeCommand(packet,key);this.#device.requireOpen();return{command:verified,actorId:signer.userId,proofHash:await e2eeCommandHash(verified)};
  }
  async prepareAuroraResult(resultId:string,methodVersion:string){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(resultId)||methodVersion!=='aurora-two-circles-v2')throw new Error('AURORA_RESULT_MISMATCH');
    const directory=this.#open();if(directory.kind!=='personal'||directory.ownerId!==this.#device.ownerId||directory.state!=='active')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const objectId=`aurora-result-live:${resultId}`,envelope=await this.#getEnvelope('aurora',objectId);this.#device.requireOpen();
    if(!envelope||envelope.context.revision!==1)throw new Error('E2EE_AURORA_RESULT_MISSING');
    const payloadHash=await envelopePayloadHash(envelope);await this.assertObjectReference('aurora',objectId,1,payloadHash);
    const payload={id:resultId,methodVersion,objectId,payloadHash},id=`aurora-manifest:${resultId}`,previous=await this.#device.vault.read('outbox',id);this.#device.requireOpen();
    try{
      let packet:SignedE2eeCommand;
      if(previous){packet=JSON.parse(decoder.decode(previous.value));const command=packet.command;
        if(command?.action!=='aurora-result'||command.ownerId!==this.#owner||command.scopeId!==this.#scopeId||command.deviceId!==this.#device.deviceId
          ||JSON.stringify(command.payload)!==JSON.stringify(payload))throw new Error('E2EE_CORRUPT_OUTBOX');
        // A new checkpoint may supersede an unaccepted command. Both requests
        // can only bind this identical immutable object/result identity.
        if(command.expectedRevision!==directory.checkpoint.revision||command.securityEpoch!==directory.securityEpoch||command.checkpointHash!==directory.checkpoint.hash){
          packet=await this.#packet('aurora-result',payload);const bytes=encoder.encode(JSON.stringify(packet));
          try{await this.#device.vault.write([{domain:'local-snapshot',objectId:`${id}:attempt:${previous.serial}`,value:previous.value,expected:null},
            {domain:'outbox',objectId:id,value:bytes,expected:previous.serial}]);}finally{bytes.fill(0);}
        }
      }else{packet=await this.#packet('aurora-result',payload);const bytes=encoder.encode(JSON.stringify(packet));
        try{await this.#device.vault.write([{domain:'outbox',objectId:id,value:bytes,expected:null}]);}finally{bytes.fill(0);}}
      this.#device.requireOpen();const receipt=await this.#transport.command(packet);this.#device.requireOpen();
      if(receipt.id!==resultId||receipt.ready!==true)throw new Error('AURORA_RESULT_MISMATCH');
    }finally{previous?.value.fill(0);}
  }
  close(){this.#refreshed=false;this.#directory=null;this.#history.clear();this.#directoryFrames.clear();this.#roots.clear();this.#sealedCache.clear();}
}
