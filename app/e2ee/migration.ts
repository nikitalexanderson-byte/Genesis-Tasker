import { e2eeCommandHash, signE2eeCommand, type E2eeCommand, type SignedE2eeCommand, type WireValue } from './commands.ts';
import { E2EE_DOMAINS, E2EE_SUITE, decodeE2eeBytes, encodeE2eeBytes, openE2eeEnvelope, sealE2eeEnvelope, type E2eeContext, type E2eeEnvelope } from './envelope.ts';
import { envelopePayloadHash, objectManifestHash, openE2eeFile, sealE2eeFile, E2EE_CHUNK_BYTES, E2EE_MAX_FILE_BYTES } from './files.ts';
import { freshSecret,exactKeys,assertTechnical } from './keys.ts';
import { UnlockedE2eeVault, type LocalWrite } from './storage.ts';
import type { VerifiedDirectory } from './directory.ts';
import {validateMigrationLocalEntries,planMigrationLocalContent,openMigrationLocalContent,type MigrationLocalEntry} from './migration-local.ts';
import {captureStagedMigrationSnapshot,validateStagedMigrationSnapshot,verifyStagedMigrationSnapshot,stagedMigrationPublicationGuard,type StagedMigrationSnapshot,type StagedMigrationCapture,type StagedMigrationOptions} from './migration-stage.ts';
import {openMigrationSourceHistory,type MigrationHistoryOptions} from './migration-history.ts';
import type {StagedSourceInput} from './staged-reconciliation.ts';

export type MigrationPhase = 'preparing'|'uploading'|'verified'|'active'|'cancelled';
export type MigrationContent = { domain: E2eeContext['domain']; objectId: string; bytes: Uint8Array; filename?: string; mediaType?: string };
export type MigrationCoverage = { domain: string; complete: boolean };
export const E2EE_MIGRATION_BYTE_BUDGET = 128 * 1024 * 1024;
/** Supplied only after the local snapshot and server lease have committed. */
export type MigrationSourceContext = Readonly<{ownerId:string;scopeId:string;migrationId:string;fence:number;sourceHash:string;generation:number}>;
export interface MigrationSources {
  readonly requiredCoverage: readonly string[];
  readonly allowedContentDomains: readonly E2eeContext['domain'][];
  assertBinding?(ownerId:string,scopeId:string,kind:string):void;
  /** Must be local-only. Include outbox, drafts, tombstones, key metadata and all local stores. */
  captureLocal(): Promise<Uint8Array>;
  /** Runs only after the protected snapshot has committed. Missing/locked paths block activation. */
  reconcile(snapshot: Uint8Array, previousSnapshots:readonly Uint8Array[], context?:MigrationSourceContext): Promise<{ coverage: MigrationCoverage[]; content: MigrationContent[]; localContent?:MigrationContent[] }>;
}
export interface MigrationTransport {
  sourceHash(): Promise<string>;
  command(packet: SignedE2eeCommand): Promise<Record<string, WireValue>>;
  readAll(): Promise<E2eeEnvelope[]>;
  /** Optional bounded shadow-read ports. A streamed coordinator must require
   * these explicitly; it must never emulate them with aggregate readAll(). */
  forEachEnvelope?(consume:(envelope:E2eeEnvelope)=>Promise<void>):Promise<number>;
  getEnvelope?(domain:E2eeContext['domain'],objectId:string):Promise<E2eeEnvelope|null>;
}
type PlannedEnvelope = { recordId: string; domain: string; objectId: string; hash: string };
type LogicalContent = { domain: E2eeContext['domain']; objectId: string; plaintextHash: string; size: number };
type MigrationState = { migrationId: string; phase: MigrationPhase; ancestors:string[];
  sourceHash: string|null; lease: { fence: number; leaseUntil: number; generation: number }|null;
  plan: PlannedEnvelope[]; logical: LogicalContent[]; uploaded: number; manifestHash: string|null; verifiedCheckpoint: string|null;
  pending: SignedE2eeCommand|null; resuming: SignedE2eeCommand|null; checkpointHash: string; directoryRevision: number;
  local?:MigrationLocalEntry[];planned?:boolean } & ({protocol:1|2;snapshotParts:number;snapshotSize:number;snapshotHash:string}|{protocol:3;source:StagedMigrationSnapshot});
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8',{fatal:true});
async function digest(bytes: Uint8Array) { return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))); }
function decodeState(bytes: Uint8Array): MigrationState {
  const state = JSON.parse(decoder.decode(bytes)) as MigrationState;
  try{exactKeys(state,['protocol','migrationId','phase',...(state.protocol===3?['source']:['snapshotParts','snapshotSize','snapshotHash']),'ancestors','sourceHash','lease','plan','logical','uploaded','manifestHash','verifiedCheckpoint','pending','resuming','checkpointHash','directoryRevision',...(state.protocol!==1?['local','planned']:[])]);}catch{throw new Error('E2EE_CORRUPT_MIGRATION');}
  if (![1,2,3].includes(state.protocol) || !['preparing','uploading','verified','active','cancelled'].includes(state.phase)
    || !Array.isArray(state.plan) || state.plan.length > 10000 || !Array.isArray(state.logical)
    || !Number.isSafeInteger(state.uploaded) || state.uploaded < 0 || state.uploaded > state.plan.length
    || state.protocol!==3&&(!Number.isSafeInteger(state.snapshotParts) || state.snapshotParts < 0 || state.snapshotParts > 256)
    || !Array.isArray(state.ancestors)||state.ancestors.length>32||new Set(state.ancestors).size!==state.ancestors.length
    || state.ancestors.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(id)))
    throw new Error('E2EE_CORRUPT_MIGRATION');
  if(state.protocol!==1&&(!Array.isArray(state.local)||typeof state.planned!=='boolean'||!state.planned&&(state.local.length!==0||state.plan.length!==0||state.logical.length!==0||['verified','active'].includes(state.phase))))throw new Error('E2EE_CORRUPT_MIGRATION');
  // v3 currently publishes protected sources only. Never accept an injected
  // lease/plan/receipt as a way around the still-unimplemented streamed planner.
  if(state.protocol===3&&(!['preparing','cancelled'].includes(state.phase)||state.planned||state.sourceHash!==null||state.lease!==null||state.pending!==null||state.resuming!==null
    ||state.uploaded!==0||state.manifestHash!==null||state.verifiedCheckpoint!==null))throw new Error('E2EE_CORRUPT_MIGRATION');
  return state;
}

/** Durable snapshot/shadow state machine. No legacy data is erased, including on failure.
 * Account/session/billing/ACL restoration is deliberately absent from the content adapter API.
 */
export class E2eeMigration {
  #vault: UnlockedE2eeVault; #directory: VerifiedDirectory; #deviceId: string; #signingKey: CryptoKey;
  #transport: MigrationTransport; #sources: MigrationSources; #required: readonly string[]; #allowed: readonly E2eeContext['domain'][];
  #recoveryCheck: (root: CryptoKey) => Promise<void>; #root: CryptoKey; #signer: CryptoKey;
  #durableKeys: () => Promise<void>; #localFence: <T>(operation: () => Promise<T>) => Promise<T>;
  #stateId: Promise<string>;
  constructor(options: { vault: UnlockedE2eeVault; directory: VerifiedDirectory; deviceId: string; signingKey: CryptoKey; signer: CryptoKey;
    root: CryptoKey; transport: MigrationTransport; sources: MigrationSources;
    ensureDurableKeys: () => Promise<void>;
    withLocalWriteFence: <T>(operation: () => Promise<T>) => Promise<T>;
    /** Must unwrap independently saved recovery material and prove it opens the new generation. */
    verifyRecovery: (root: CryptoKey) => Promise<void> }) {
    this.#vault=options.vault;this.#directory=options.directory;this.#deviceId=options.deviceId;this.#signingKey=options.signingKey;
    this.#transport=options.transport;this.#sources=options.sources;
    this.#required=Object.freeze([...options.sources.requiredCoverage]);this.#allowed=Object.freeze([...options.sources.allowedContentDomains]);
    this.#root=options.root;this.#signer=options.signer;this.#recoveryCheck=options.verifyRecovery;
    this.#durableKeys=options.ensureDurableKeys;this.#localFence=options.withLocalWriteFence;
    options.sources.assertBinding?.(options.directory.ownerId,options.directory.scopeId,options.directory.kind);
    // One device vault can hold personal data and several shared scopes.
    this.#stateId=digest(encoder.encode(this.#directory.scopeId)).then(hash=>`migration:${hash}`);
    if (this.#required.length < 1 || new Set(this.#required).size !== this.#required.length || this.#allowed.length < 1
      || new Set(this.#allowed).size !== this.#allowed.length || this.#allowed.some(domain=>!E2EE_DOMAINS.includes(domain))) throw new Error('E2EE_COVERAGE_REQUIRED');
  }
  async status(): Promise<MigrationState|null> {
    const record = await this.#vault.read('local-snapshot',await this.#stateId);
    if (!record) return null;
    try { const state=decodeState(record.value);this.#localEntries(state);return state; } finally { record.value.fill(0); }
  }
  async #load() {
    const record=await this.#vault.read('local-snapshot',await this.#stateId);if(!record)throw new Error('E2EE_SNAPSHOT_REQUIRED');
    try{const state=decodeState(record.value);this.#localEntries(state);return {state,serial:record.serial};}finally{record.value.fill(0);}
  }
  #localEntries(state:MigrationState){
    if(state.protocol===3)validateStagedMigrationSnapshot(state.source,{ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,kind:this.#directory.kind},this.#vault.localIdentity(),this.#required);
    return state.protocol!==1?validateMigrationLocalEntries(state.local,state.migrationId,this.#allowed):[];
  }
  async #verifyLocal(state:MigrationState){for(const entry of this.#localEntries(state)){const content=await openMigrationLocalContent(this.#vault,entry);content.bytes.fill(0);}}
  /** Local-only content has no transport fallback. A missing/corrupt part is an
   * error, never an empty note or permission to fetch/upload a legacy copy. */
  async readLocal(domain:E2eeContext['domain'],objectId:string):Promise<MigrationContent|null>{
    assertTechnical(objectId);this.#vault.assertUnlocked();if(!this.#allowed.includes(domain))throw new Error('E2EE_LOCAL_CONTENT_FORBIDDEN');
    const {state}=await this.#load();if(state.phase!=='active')throw new Error('E2EE_MIGRATION_UNVERIFIED');
    const entry=this.#localEntries(state).find(row=>row.domain===domain&&row.objectId===objectId);
    return entry?openMigrationLocalContent(this.#vault,entry):null;
  }
  async #save(state: MigrationState, serial: number|null, extra: LocalWrite[] = []) {
    const value=encoder.encode(JSON.stringify(state));
    try { await this.#vault.write([...extra,{domain:'local-snapshot',objectId:await this.#stateId,value,expected:serial}]); }
    finally { value.fill(0); }
    return serial === null ? 1 : serial+1;
  }
  async prepare(): Promise<void> {
    return this.#localFence(()=>this.#prepareLocked());
  }
  async #prepareLocked():Promise<void> {
    await this.#durableKeys();
    const previous=await this.status();
    if(previous?.protocol===3)throw new Error('E2EE_STREAMED_SOURCE_REQUIRED');
    if(previous&&previous.phase!=='cancelled')throw new Error('E2EE_MIGRATION_ALREADY_PREPARED');
    const old=previous?await this.#load():null;
    const ancestors=previous?[...previous.ancestors,`${previous.migrationId}:archive`]:[];
    if(ancestors.length>32)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
    const snapshot=await this.#sources.captureLocal();
    if(snapshot.length>E2EE_MAX_FILE_BYTES)throw new Error('E2EE_SNAPSHOT_TOO_LARGE');
    const migrationId=crypto.randomUUID(),parts=Math.ceil(snapshot.length/E2EE_CHUNK_BYTES);
    try {
      const changes: LocalWrite[]=[];
      if(previous)changes.push({domain:'local-snapshot',objectId:ancestors.at(-1)!,value:encoder.encode(JSON.stringify(previous)),expected:null});
      for(let index=0;index<parts;index++)changes.push({domain:'local-snapshot',objectId:`${migrationId}:source:${index}`,
        value:snapshot.subarray(index*E2EE_CHUNK_BYTES,(index+1)*E2EE_CHUNK_BYTES),expected:null});
      const state: MigrationState={protocol:2,migrationId,phase:'preparing',snapshotParts:parts,snapshotSize:snapshot.length,snapshotHash:await digest(snapshot),ancestors,local:[],planned:false,
        sourceHash:null,lease:null,plan:[],logical:[],uploaded:0,manifestHash:null,verifiedCheckpoint:null,pending:null,resuming:null,
        checkpointHash:this.#directory.checkpoint.hash,directoryRevision:this.#directory.checkpoint.revision};
      // One transaction: a visible state always has all of its protected source chunks.
      await this.#save(state,old?.serial??null,changes);
    } finally { snapshot.fill(0); }
  }
  /** Local v3 source publication only. This does not run reconciliation or
   * transport; the complete streamed planner is a separate acceptance gate. */
  async prepareStaged(capture:StagedMigrationCapture,options:StagedMigrationOptions):Promise<void>{
    const captured={...capture,target:{...capture.target},paths:[...capture.paths]},policy={...options,capacity:{...options.capacity}};
    return this.#localFence(()=>this.#prepareStagedLocked(captured,policy));
  }
  async #prepareStagedLocked(capture:StagedMigrationCapture,options:StagedMigrationOptions):Promise<void>{
    const target={ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,kind:this.#directory.kind};
    if(capture.target.ownerId!==target.ownerId||capture.target.scopeId!==target.scopeId||capture.target.kind!==target.kind)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const current=()=>{options.assertCurrent();this.#vault.assertUnlocked();};current();
    const previous=await this.status(),old=previous?await this.#load():null;current();
    if(old&&old.state.phase!=='cancelled')throw new Error('E2EE_MIGRATION_ALREADY_PREPARED');
    const ancestors=old?[...old.state.ancestors,`${old.state.migrationId}:archive`]:[];
    if(ancestors.length>32)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
    const source=await captureStagedMigrationSnapshot(this.#vault,capture,this.#required,options,this.#durableKeys);current();
    const state:MigrationState={protocol:3,migrationId:crypto.randomUUID(),phase:'preparing',source,ancestors,local:[],planned:false,
      sourceHash:null,lease:null,plan:[],logical:[],uploaded:0,manifestHash:null,verifiedCheckpoint:null,pending:null,resuming:null,
      checkpointHash:this.#directory.checkpoint.hash,directoryRevision:this.#directory.checkpoint.revision};
    const changes:LocalWrite[]=old?[{domain:'local-snapshot',objectId:ancestors.at(-1)!,value:encoder.encode(JSON.stringify(old.state)),expected:null}]:[];
    const encoded=encoder.encode(JSON.stringify(state));
    try{
      const totals=await verifyStagedMigrationSnapshot(this.#vault,source,current);current();
      changes.push(await stagedMigrationPublicationGuard(this.#vault,source,current));current();
      await options.admit({...totals,metadataBytes:encoded.length+changes.reduce((total,row)=>total+row.value.length,0)});current();
      await this.#save(state,old?.serial??null,changes);current();
    }finally{encoded.fill(0);changes.forEach(row=>row.value.fill(0));}
  }
  async #snapshot(state: MigrationState) {
    if(state.protocol===3)throw new Error('E2EE_STREAMED_PLANNER_REQUIRED');
    if(!Number.isSafeInteger(state.snapshotSize)||state.snapshotSize<0||state.snapshotSize>E2EE_MAX_FILE_BYTES)throw new Error('E2EE_CORRUPT_SNAPSHOT');
    const bytes=new Uint8Array(state.snapshotSize);let offset=0;
    try {
      for(let index=0;index<state.snapshotParts;index++) {
        const part=await this.#vault.read('local-snapshot',`${state.migrationId}:source:${index}`);
        if(!part)throw new Error('E2EE_CORRUPT_SNAPSHOT');
        try { if(part.value.length!==Math.min(E2EE_CHUNK_BYTES,bytes.length-offset))throw new Error('E2EE_CORRUPT_SNAPSHOT');bytes.set(part.value,offset);offset+=part.value.length; }
        finally{part.value.fill(0);}
      }
      if(offset!==bytes.length||await digest(bytes)!==state.snapshotHash)throw new Error('E2EE_CORRUPT_SNAPSHOT');
      return bytes;
    } catch(error){bytes.fill(0);throw error;}
  }
  /** Same-original-actor bounded input under the actual coordinator fence.
   * Every path/ancestor must reach EOF and remain unchanged before returning.
   * No lease, plan publication, remote source, recovered identity or activation. */
  async withStagedSourceHistory<T>(consume:(input:StagedSourceInput)=>Promise<T>,options:MigrationHistoryOptions):Promise<T>{
    const policy={...options,capacity:{...options.capacity}},target={ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,kind:this.#directory.kind};
    return this.#localFence(async()=>{
      const history=await openMigrationSourceHistory({vault:this.#vault,target,paths:this.#required,stateId:await this.#stateId,
        decode:bytes=>{const state=decodeState(bytes);this.#localEntries(state);return state;},options:policy});
      let rejected=false;
      const close=async()=>{try{await history.close();}catch(error){if(!rejected)throw error;}};
      try{const result=await consume(history.input);await history.assertCompleteAndUnchanged();return result;}
      catch(error){rejected=true;throw error;}finally{await close();}
    });
  }
  #packet(state: MigrationState, action: string, payload: Record<string,WireValue>, operationId=crypto.randomUUID()) {
    const command:E2eeCommand={protocol:1,ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,deviceId:this.#deviceId,action,
      expectedRevision:state.directoryRevision,checkpointHash:state.checkpointHash,securityEpoch:this.#directory.securityEpoch,operationId,payload};
    return signE2eeCommand(command,this.#signingKey);
  }
  #lease(state: MigrationState) { if (!state.lease) throw new Error('E2EE_CORRUPT_MIGRATION'); return state.lease; }
  async #send(state: MigrationState, serial: number, packet: SignedE2eeCommand) {
    state.pending=packet;serial=await this.#save(state,serial);
    return this.#replay(state,serial);
  }
  async #replay(state: MigrationState,serial: number):Promise<{state:MigrationState;serial:number}> {
    const pending=state.pending;if(!pending)throw new Error('E2EE_CORRUPT_MIGRATION');
    // The exact signed ciphertext/operation is retried after a timeout or process death.
    this.#vault.assertUnlocked();
    if(['migration-verify','migration-commit'].includes(pending.command.action))await this.#verifyLocal(state);
    let result:Record<string,WireValue>;
    try{result=await this.#transport.command(pending);}catch(error){
      if(error instanceof Error && error.message==='E2EE_MIGRATION_FENCED' && state.lease && pending.command.action!=='migration-start') {
        ({state,serial}=await this.#resume(state,serial));
        return state.pending?this.#replay(state,serial):{state,serial};
      }
      throw error;
    }
    return this.#applyReceipt(state,serial,result);
  }
  async #applyReceipt(state:MigrationState,serial:number,result:Record<string,WireValue>) {
    const pending=state.pending;if(!pending)throw new Error('E2EE_CORRUPT_MIGRATION');
    switch(pending.command.action) {
      case 'migration-start': {
        const {fence,leaseUntil,generation}=result;
        if(!Number.isSafeInteger(fence)||!Number.isSafeInteger(leaseUntil)||!Number.isSafeInteger(generation))throw new Error('E2EE_INVALID_RECEIPT');
        state.lease={fence:fence as number,leaseUntil:leaseUntil as number,generation:generation as number};state.phase='uploading';break;
      }
      case 'put': {
        const envelope=pending.command.payload.envelope as unknown as E2eeEnvelope;
        if(result.revision!==envelope.context.revision||result.payloadHash!==await envelopePayloadHash(envelope)||result.generation!==envelope.context.dataGeneration)throw new Error('E2EE_INVALID_RECEIPT');
        state.uploaded++;break;
      }
      case 'migration-verify': if(result.state!=='verified'||result.manifestHash!==state.manifestHash)throw new Error('E2EE_INVALID_RECEIPT');state.phase='verified';break;
      case 'migration-commit':
        {const hash=await digest(encoder.encode(`${state.checkpointHash}\0${await e2eeCommandHash(pending.command)}`));
        if(result.state!=='active'||result.checkpointHash!==hash||result.directoryRevision!==state.directoryRevision+1)throw new Error('E2EE_INVALID_RECEIPT');
        state.phase='active';state.checkpointHash=hash;state.directoryRevision++;break;}
      case 'migration-cancel': if(result.state!=='preparing')throw new Error('E2EE_INVALID_RECEIPT');state.phase='cancelled';break;
      default:throw new Error('E2EE_CORRUPT_MIGRATION');
    }
    state.pending=null;serial=await this.#save(state,serial);return{state,serial};
  }
  async #resume(state:MigrationState,serial:number):Promise<{state:MigrationState;serial:number}> {
    const lease=this.#lease(state);if(!state.sourceHash)throw new Error('E2EE_CORRUPT_MIGRATION');
    if(!state.resuming) {
      state.resuming=await this.#packet(state,'migration-resume',{migrationId:state.migrationId,fence:lease.fence,sourceHash:state.sourceHash,
        pendingOperationId:state.pending?.command.operationId??null,pendingHash:state.pending?await e2eeCommandHash(state.pending.command):null});
      serial=await this.#save(state,serial);
    }
    this.#vault.assertUnlocked();const result=await this.#transport.command(state.resuming);
    const {fence,leaseUntil,generation,pendingReceipt}=result;
    if(!Number.isSafeInteger(fence)||(fence as number)!==lease.fence+1||!Number.isSafeInteger(leaseUntil)||generation!==lease.generation)
      throw new Error('E2EE_INVALID_RECEIPT');
    state.lease={fence:fence as number,leaseUntil:leaseUntil as number,generation:lease.generation};
    if(pendingReceipt!==null) {
      if(!state.pending||!pendingReceipt||typeof pendingReceipt!=='object'||Array.isArray(pendingReceipt)
        ||pendingReceipt.payloadHash!==await e2eeCommandHash(state.pending.command)
        ||!pendingReceipt.result||typeof pendingReceipt.result!=='object'||Array.isArray(pendingReceipt.result))throw new Error('E2EE_INVALID_RECEIPT');
      // Persist a recovered acknowledgement and removal of its renewal together.
      state.resuming=null;return this.#applyReceipt(state,serial,pendingReceipt.result);
    }
    if(state.pending) {
      const old=state.pending.command;
      state.pending=await signE2eeCommand({...old,payload:{...old.payload,fence:state.lease.fence}},this.#signingKey);
    }
    state.resuming=null;serial=await this.#save(state,serial);return{state,serial};
  }
  async #plan(state: MigrationState,serial: number) {
    const snapshot=await this.#snapshot(state);
    const previousSnapshots:Uint8Array[]=[];
    let content:MigrationContent[]=[],localContent:MigrationContent[]=[];const changes:LocalWrite[]=[];
    try {
      let total=snapshot.length;
      for(const id of state.ancestors) {
        const row=await this.#vault.read('local-snapshot',id);if(!row)throw new Error('E2EE_CORRUPT_SNAPSHOT');
        let previous:MigrationState;try{previous=decodeState(row.value);}finally{row.value.fill(0);}
        if(previous.protocol===3)throw new Error('E2EE_STREAMED_SOURCE_REQUIRED');
        total+=previous.snapshotSize;if(total>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
        previousSnapshots.push(await this.#snapshot(previous));
      }
      if(!state.sourceHash)throw new Error('E2EE_CORRUPT_MIGRATION');
      const lease=this.#lease(state);
      const reconciled=await this.#sources.reconcile(snapshot,previousSnapshots,Object.freeze({ownerId:this.#directory.ownerId,
        scopeId:this.#directory.scopeId,migrationId:state.migrationId,fence:lease.fence,sourceHash:state.sourceHash,generation:lease.generation}));
      if(!Array.isArray(reconciled.content)||reconciled.localContent!==undefined&&!Array.isArray(reconciled.localContent))throw new Error('E2EE_INVALID_SOURCE_RESULT');
      content=reconciled.content;localContent=reconciled.localContent??[];const all=[...content,...localContent];
      if(reconciled.coverage.length!==this.#required.length || this.#required.some(domain=>reconciled.coverage.filter(row=>row.domain===domain&&row.complete).length!==1)
        || reconciled.coverage.some(row=>!this.#required.includes(row.domain)) || all.length<1
        || all.length>10000 || new Set(all.map(row=>`${row.domain}\0${row.objectId}`)).size!==all.length)throw new Error('E2EE_INCOMPLETE_COVERAGE');
      let contentBytes=0;
      for(const record of all){
        assertTechnical(record.objectId);
        if(!this.#allowed.includes(record.domain))throw new Error('E2EE_INCOMPLETE_COVERAGE');
        if(!(record.bytes instanceof Uint8Array)||record.bytes.length>E2EE_MAX_FILE_BYTES||record.domain==='shared-comment'&&record.bytes.length>65536)throw new Error('E2EE_INVALID_SOURCE_RESULT');
        if(record.filename!==undefined&&(typeof record.filename!=='string'||record.filename.length>512)||record.mediaType!==undefined&&(typeof record.mediaType!=='string'||record.mediaType.length>128))throw new Error('E2EE_INVALID_SOURCE_RESULT');
        contentBytes+=record.bytes.length;if(contentBytes>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_TOO_LARGE');
      }
      const plan:PlannedEnvelope[]=[];const logical:LogicalContent[]=[];
      for(const record of content) {
        if(!state.lease)throw new Error('E2EE_CORRUPT_MIGRATION');
        const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,domain:record.domain,
          objectId:record.objectId,schemaVersion:1,dataGeneration:state.lease.generation,writerProtocol:9,cryptoEpoch:this.#directory.cryptoEpoch,
          securityEpoch:this.#directory.securityEpoch,revision:1,keyId:this.#directory.keyId,deviceId:this.#deviceId,operationId:crypto.randomUUID()};
        const file=record.domain==='shared-comment'?{chunks:[],manifest:await sealE2eeEnvelope(this.#root,this.#signingKey,context,record.bytes)}
          :await sealE2eeFile(this.#root,this.#signingKey,context,record.bytes,{filename:record.filename??'',mediaType:record.mediaType??'application/json'});
        logical.push({domain:record.domain,objectId:record.objectId,plaintextHash:await digest(record.bytes),size:record.bytes.length});
        for(const envelope of [...file.chunks,file.manifest]) {
          const recordId=`${state.migrationId}:upload:${plan.length}`;
          changes.push({domain:'outbox',objectId:recordId,value:encoder.encode(JSON.stringify(envelope)),expected:null});
          plan.push({recordId,domain:envelope.context.domain,objectId:envelope.context.objectId,hash:await envelopePayloadHash(envelope)});
        }
      }
      if(plan.length>8000)throw new Error('E2EE_MIGRATION_TOO_LARGE');
      const local=await planMigrationLocalContent(state.migrationId,localContent);changes.push(...local.changes);
      state.protocol=2;state.local=validateMigrationLocalEntries(local.entries,state.migrationId,this.#allowed);state.planned=true;
      state.plan=plan;state.logical=logical;serial=await this.#save(state,serial,changes);return{state,serial};
    }finally{snapshot.fill(0);previousSnapshots.forEach(bytes=>bytes.fill(0));[...content,...localContent].forEach(record=>record.bytes.fill(0));changes.forEach(change=>change.value.fill(0));}
  }
  async run():Promise<MigrationPhase> {
    return this.#localFence(() => this.#runLocked());
  }
  async #runLocked():Promise<MigrationPhase> {
    let {state,serial}=await this.#load();
    if(state.protocol===3&&state.phase==='cancelled')return 'cancelled';
    if(state.protocol===3)throw new Error('E2EE_STREAMED_PLANNER_REQUIRED');
    await this.#durableKeys();
    await this.#verifyLocal(state);
    if(state.resuming)({state,serial}=await this.#resume(state,serial));
    if(state.pending)({state,serial}=await this.#replay(state,serial));
    if(state.phase==='active'||state.phase==='cancelled')return state.phase;
    if(state.phase==='preparing') {
      // No transport is reached until the snapshot and key material have been durably saved.
      this.#vault.assertUnlocked();state.sourceHash=await this.#transport.sourceHash();decodeE2eeBytes(state.sourceHash,32);
      ({state,serial}=await this.#send(state,serial,await this.#packet(state,'migration-start',{migrationId:state.migrationId,sourceHash:state.sourceHash})));
    }
    if(!state.lease)throw new Error('E2EE_CORRUPT_MIGRATION');
    if(state.lease.leaseUntil<=Math.floor(Date.now()/1000)+30)({state,serial}=await this.#resume(state,serial));
    if(state.phase==='uploading'&&(state.protocol===1?state.plan.length===0:!state.planned))({state,serial}=await this.#plan(state,serial));
    await this.#verifyLocal(state);
    while(state.phase==='uploading'&&state.uploaded<state.plan.length) {
      const item=state.plan[state.uploaded],row=await this.#vault.read('outbox',item.recordId);if(!row)throw new Error('E2EE_CORRUPT_OUTBOX');
      let envelope:E2eeEnvelope;
      try{envelope=JSON.parse(decoder.decode(row.value));if(await envelopePayloadHash(envelope)!==item.hash)throw new Error('E2EE_CORRUPT_OUTBOX');}
      finally{row.value.fill(0);}
      const payload={envelope:envelope as unknown as WireValue,expectedObjectRevision:0,migrationId:state.migrationId,fence:this.#lease(state).fence};
      ({state,serial}=await this.#send(state,serial,await this.#packet(state,'put',payload,envelope.context.operationId)));
    }
    if(state.phase==='uploading') {
      this.#vault.assertUnlocked();const remote=await this.#transport.readAll(),byId=new Map<string,E2eeEnvelope>();
      for(const envelope of remote){const key=`${envelope.context.domain}\0${envelope.context.objectId}`;if(byId.has(key))throw new Error('E2EE_DUPLICATE_OBJECT');byId.set(key,envelope);}
      if(byId.size!==state.plan.length)throw new Error('E2EE_MANIFEST_MISMATCH');
      for(const item of state.plan)if(await envelopePayloadHash(byId.get(`${item.domain}\0${item.objectId}`)!)!==item.hash)throw new Error('E2EE_MANIFEST_MISMATCH');
      for(const content of state.logical) {
        const manifest=byId.get(`${content.domain}\0${content.objectId}`)!;
        const opened=content.domain==='shared-comment'?{bytes:await openE2eeEnvelope(this.#root,this.#signer,manifest.context,manifest)}
          :await openE2eeFile(this.#root,this.#signer,manifest.context,manifest,async id=>byId.get(`attachment\0${id}`)!);
        try{if(opened.bytes.length!==content.size||await digest(opened.bytes)!==content.plaintextHash)throw new Error('E2EE_CONTENT_MISMATCH');}finally{opened.bytes.fill(0);}
      }
      await this.#recoveryCheck(this.#root);
      await this.#verifyLocal(state);
      state.manifestHash=await objectManifestHash(state.plan.map(item=>({domain:item.domain,objectId:item.objectId,revision:1,payloadHash:item.hash})));
      state.verifiedCheckpoint=encodeE2eeBytes(freshSecret());
      ({state,serial}=await this.#send(state,serial,await this.#packet(state,'migration-verify',{migrationId:state.migrationId,fence:this.#lease(state).fence,
        manifestHash:state.manifestHash,objectCount:state.plan.length,verifiedCheckpoint:state.verifiedCheckpoint})));
    }
    if(state.phase==='verified') {
      if(!state.manifestHash||!state.verifiedCheckpoint)throw new Error('E2EE_MIGRATION_UNVERIFIED');
      ({state,serial}=await this.#send(state,serial,await this.#packet(state,'migration-commit',{migrationId:state.migrationId,fence:this.#lease(state).fence,
        manifestHash:state.manifestHash,verifiedCheckpoint:state.verifiedCheckpoint,generation:this.#lease(state).generation,objectCount:state.plan.length})));
    }
    return state.phase;
  }
  async cancel():Promise<void> {
    return this.#localFence(()=>this.#cancelLocked());
  }
  async #cancelLocked():Promise<void> {
    let {state,serial}=await this.#load();
    if(state.phase==='cancelled')return;
    if(state.resuming)try{({state,serial}=await this.#resume(state,serial));}catch(error){
      if(!(error instanceof Error)||error.message!=='E2EE_SOURCE_CHANGED')throw error;
    }
    if(state.pending&&['migration-start','migration-commit'].includes(state.pending.command.action))try{({state,serial}=await this.#replay(state,serial));}catch(error){
      if(!(error instanceof Error)||!['E2EE_SOURCE_CHANGED','E2EE_MIGRATION_FENCED'].includes(error.message))throw error;
    }
    if(state.phase==='active')throw new Error('E2EE_DOWNGRADE_FORBIDDEN');
    // Preserve the abandoned pending/renewal request before creating the cancel.
    const id=`${state.migrationId}:cancel:${crypto.randomUUID()}`,archived=encoder.encode(JSON.stringify(state));
    try{serial=await this.#save(state,serial,[{domain:'local-snapshot',objectId:id,value:archived,expected:null}]);}finally{archived.fill(0);}
    state.resuming=null;
    if(state.lease)await this.#send(state,serial,await this.#packet(state,'migration-cancel',{migrationId:state.migrationId,fence:state.lease.fence}));
    else{state.phase='cancelled';await this.#save(state,serial);}
    // Protected snapshots, uploads and unsent changes remain available for recovery.
  }
  /** Explicit conflict resolution starts a distinct shadow generation and supplies
   * every prior protected local snapshot to the reconciliation adapter. */
  async restart():Promise<void> {
    return this.#localFence(async()=>{if((await this.status())?.protocol===3)throw new Error('E2EE_STREAMED_SOURCE_REQUIRED');await this.#cancelLocked();await this.#prepareLocked();});
  }
  async restartStaged(capture:StagedMigrationCapture,options:StagedMigrationOptions):Promise<void>{
    const captured={...capture,target:{...capture.target},paths:[...capture.paths]},policy={...options,capacity:{...options.capacity}};
    return this.#localFence(async()=>{await this.#cancelLocked();await this.#prepareStagedLocked(captured,policy);});
  }
}
