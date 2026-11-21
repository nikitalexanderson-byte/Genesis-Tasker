import { e2eeCommandHash, signE2eeCommand, snapshotE2eeValue, type SignedE2eeCommand, type WireValue } from './commands.ts';
import { contentSigningKey, type VerifiedDirectory } from './directory.ts';
import { E2EE_SUITE, encodeE2eeBytes, openE2eeEnvelope, sealE2eeEnvelope, validateE2eeEnvelope, type E2eeContext, type E2eeEnvelope } from './envelope.ts';
import { E2EE_CHUNK_BYTES, E2EE_MAX_FILE_BYTES, envelopePayloadHash, objectManifestHash, openE2eeFile, sealE2eeFile } from './files.ts';
import { assertTechnical, openRoot, type PublicDeviceKeys } from './keys.ts';
import { UnlockedWebDevice } from './device-vault.ts';
import type { LocalWrite } from './storage.ts';

export interface ScopeTransport {
  directory(scopeId:string):Promise<{events:SignedE2eeCommand[]}>;
  command(packet:SignedE2eeCommand):Promise<Record<string,WireValue>>;
  read(packet:SignedE2eeCommand):Promise<{envelopes?:E2eeEnvelope[];objects?:{domain:string;objectId:string;revision:number;payloadHash:string}[];
    receipt?:{payloadHash:string;result:Record<string,WireValue>}|null;checkpointHash:string;directoryRevision:number}>;
}
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
  constructor(device:UnlockedWebDevice,ownerId:string,scopeId:string,pin:PublicDeviceKeys,transport:ScopeTransport){
    assertTechnical(ownerId);assertTechnical(scopeId);this.#device=device;this.#owner=ownerId;this.#scopeId=scopeId;
    this.#pin=snapshotE2eeValue(pin);this.#transport=transport;
  }
  assertBinding(device:object,scopeId:string){if(device!==this.#device||scopeId!==this.#scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}
  #open(){this.#device.requireOpen();if(!this.#directory)throw new Error('E2EE_DIRECTORY_REQUIRED');return this.#directory;}
  async refresh():Promise<VerifiedDirectory> {
    this.#refreshed=false;
    this.#device.requireOpen();const response=await this.#transport.directory(this.#scopeId);this.#device.requireOpen();
    const frames=new Map<string,VerifiedDirectory>();
    const directory=await this.#device.rememberDirectory(this.#scopeId,this.#pin,response.events,this.#owner,frame=>frames.set(epochKey(frame),frame));
    await this.#installDirectory(directory,frames);
    this.#refreshed=true;
    try{await this.#loadSealedHeads(true);}catch(error){this.#refreshed=false;throw error;}
    return structuredClone(directory);
  }
  /** Explicit offline unlock. No network fallback is performed after a failed refresh. */
  async hydrateOffline():Promise<VerifiedDirectory> {
    this.#refreshed=false;this.#device.requireOpen();const frames=new Map<string,VerifiedDirectory>();
    const directory=await this.#device.savedDirectory(this.#scopeId,frame=>frames.set(epochKey(frame),frame));
    if(!directory)throw new Error('E2EE_DIRECTORY_REQUIRED');
    await this.#installDirectory(directory,frames);await this.#loadSealedHeads(false);return structuredClone(directory);
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
      } else if(previous&&!previous.job.complete)throw new Error('E2EE_PENDING_SAVE_REQUIRED');
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
    return job.complete?{originId:job.originId,revision:job.expected+1}:null;
  }
  async #acknowledge(id:string,job:UploadJob,serial:number,result:Record<string,WireValue>) {
      this.#device.requireOpen();const pending=job.pending,item=job.plan[job.uploaded];if(!pending||!item)throw new Error('E2EE_CORRUPT_OUTBOX');
      const envelope=validateE2eeEnvelope(pending.command.payload.envelope);
      if(await envelopePayloadHash(envelope)!==item.hash||result.revision!==envelope.context.revision||result.payloadHash!==item.hash||result.generation!==job.generation)throw new Error('E2EE_INVALID_RECEIPT');
      job.uploaded++;job.pending=null;job.complete=job.uploaded===job.plan.length;
      const confirmed:LocalWrite[]=[];
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
  async read(domain:E2eeContext['domain'],objectId:string):Promise<{bytes:Uint8Array;filename:string;mediaType:string;revision:number}|null> {
    this.#open();const id=await this.#id(domain,objectId),floorRecord=await this.#device.vault.read('key-check',`floor:${id}`);
    let floor:{revision:number;hash:string}|null=null;
    try{if(floorRecord)floor=JSON.parse(decoder.decode(floorRecord.value));}finally{floorRecord?.value.fill(0);}
    const envelope=await this.#getEnvelope(domain,objectId);
    if(!envelope){if(floor||(await this.#sealedHeads())?.has(`${domain}\0${objectId}`))throw new Error('E2EE_REMOTE_ROLLBACK');return null;}
    const context=envelope.context,directory=this.#history.get(epochKey({cryptoEpoch:context.cryptoEpoch,securityEpoch:context.securityEpoch,keyId:context.keyId,generation:context.dataGeneration}));
    if(!directory||context.ownerId!==this.#owner||context.scopeId!==this.#scopeId||context.domain!==domain||context.objectId!==objectId)throw new Error('E2EE_CONTEXT_MISMATCH');
    const payloadHash=await envelopePayloadHash(envelope);
    if(floor&&(context.revision<floor.revision||context.revision===floor.revision&&payloadHash!==floor.hash))throw new Error('E2EE_REMOTE_ROLLBACK');
    const root=this.#roots.get(context.keyId);if(!root)throw new Error('E2EE_KEY_UNAVAILABLE');
    await this.#historicalHead(envelope);
    const signer=await contentSigningKey(directory,context);
    const opened=domain==='shared-comment'?{bytes:await openE2eeEnvelope(root,signer,context,envelope),filename:'',mediaType:'application/json'}
      :await openE2eeFile(root,signer,context,envelope,async chunkId=>{const chunk=await this.#getEnvelope('attachment',chunkId);if(!chunk)throw new Error('E2EE_CORRUPT_FILE');await this.#historicalHead(chunk);return chunk;});
    const encoded=encoder.encode(JSON.stringify({revision:context.revision,hash:payloadHash}));
    try{await this.#device.vault.write([{domain:'key-check',objectId:`floor:${id}`,value:encoded,expected:floorRecord?.serial??null}]);this.#device.requireOpen();return{...opened,revision:context.revision};}
    catch(error){opened.bytes.fill(0);throw error;}finally{encoded.fill(0);}
  }
}
