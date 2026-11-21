import { canonicalE2eeValue,e2eeCommandHash,signE2eeCommand,snapshotE2eeValue,verifyE2eeCommand,type E2eeCommand,type SignedE2eeCommand,type WireValue } from './commands.ts';
import { E2EE_DOMAINS, E2EE_SUITE, decodeE2eeBytes, encodeE2eeBytes, openE2eeEnvelope, sealE2eeEnvelope, type E2eeContext, type E2eeEnvelope } from './envelope.ts';
import { envelopePayloadHash, objectManifestHash, openE2eeFile, sealE2eeFile, E2EE_CHUNK_BYTES, E2EE_MAX_FILE_BYTES } from './files.ts';
import { freshSecret,exactKeys,assertTechnical } from './keys.ts';
import { UnlockedE2eeVault, type LocalWrite } from './storage.ts';
import type { VerifiedDirectory } from './directory.ts';
import {validateMigrationLocalEntries,planMigrationLocalContent,openMigrationLocalContent,type MigrationLocalEntry} from './migration-local.ts';
import {captureStagedMigrationSnapshot,validateStagedMigrationSnapshot,verifyStagedMigrationSnapshot,stagedMigrationPublicationGuard,type StagedMigrationSnapshot,type StagedMigrationCapture,type StagedMigrationOptions} from './migration-stage.ts';
import {openMigrationSourceHistory,type MigrationHistoryOptions,type MigrationHistoryReadVault} from './migration-history.ts';
import type {StagedSourceInput} from './staged-reconciliation.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {validateStreamedPlanningOwnership,type StreamedPlanningOwnership,type OwnedMigrationContentPlan} from './migration-ownership.ts';
import {ProtectedMigrationContentPlan,inspectMigrationContentPlanAttempt,openMigrationContentPlan,verifyMigrationContentPlanReadback,type MigrationContentPlanCapacity,type MigrationContentPlanAdmission,type MigrationContentPlanReference} from './content-plan.ts';
import {withOwnedContentPlanning,type MigrationContentPlanningSession} from './content-planning-session.ts';
import {authenticateRemoteOriginalRegistration,describeRemoteOriginal,listRemoteOriginals,withRemoteOriginal,type RemoteOriginalReadOptions,type RemoteOriginalRegistration,type RemoteOriginalReference} from './remote-original.ts';
import {withOwnedMigrationPlanning,type MigrationPlanningSession} from './migration-session.ts';
import {UnlockedWebDevice} from './device-vault.ts';
import {requiredPrivatePaths} from './private-paths.ts';

export type MigrationPhase = 'preparing'|'uploading'|'verified'|'active'|'cancelled';
export type MigrationContent = { domain: E2eeContext['domain']; objectId: string; bytes: Uint8Array; filename?: string; mediaType?: string };
/** Product history reader requires no migration writer/legacy-key capability.
 * A clean device is explicit; a present but malformed journal never becomes an
 * empty local diary, map view or import history. */
export async function readActiveMigrationLocalContent(device:UnlockedWebDevice,directory:VerifiedDirectory,domain:E2eeContext['domain'],objectId:string):Promise<
 {availability:'not-on-this-device';content:null}|{availability:'present';content:MigrationContent|null}>{
 device.requireOpen();assertTechnical(objectId);if(directory.state!=='active')throw new Error('E2EE_MIGRATION_UNVERIFIED');
 const paths=requiredPrivatePaths(directory.kind),allowed=[...new Set(paths.flatMap(path=>path.domains))] as E2eeContext['domain'][];
 if(!allowed.includes(domain))throw new Error('E2EE_LOCAL_CONTENT_FORBIDDEN');
 const record=await device.vault.read('local-snapshot',`migration:${await digest(encoder.encode(directory.scopeId))}`);device.requireOpen();
 if(!record)return{availability:'not-on-this-device',content:null};
 try{
  const state=decodeState(record.value);if(state.phase!=='active'||state.protocol<3||!('source' in state))throw new Error('E2EE_MIGRATION_UNVERIFIED');
  validateStagedMigrationSnapshot(state.source,{ownerId:directory.ownerId,scopeId:directory.scopeId,kind:directory.kind},device.vault.localIdentity(),paths.map(path=>path.id));
  if(state.protocol===4||state.protocol===5)validateStreamedPlanningOwnership(state.ownership,{migrationId:state.migrationId,target:state.source.target,actor:device.vault.localIdentity(),
   sourceHash:state.sourceHash,lease:state.lease,checkpointHash:state.protocol===5?state.adopted.checkpointHash:state.checkpointHash,directoryRevision:state.protocol===5?state.adopted.directoryRevision:state.directoryRevision});
  if(state.lease?.generation!==directory.generation)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const entries=validateMigrationLocalEntries(state.local,state.protocol===5?state.adopted.reference.attemptId:state.migrationId,allowed),entry=entries.find(row=>row.domain===domain&&row.objectId===objectId);
  const content=entry?await openMigrationLocalContent(device.vault,entry):null;device.requireOpen();return{availability:'present',content};
 }finally{record.value.fill(0);}
}
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
  local?:MigrationLocalEntry[];planned?:boolean } & ({protocol:1|2;snapshotParts:number;snapshotSize:number;snapshotHash:string}|{protocol:3;source:StagedMigrationSnapshot}|{protocol:4;source:StagedMigrationSnapshot;ownership:StreamedPlanningOwnership}
  |{protocol:5;source:StagedMigrationSnapshot;ownership:StreamedPlanningOwnership;adopted:{reference:MigrationContentPlanReference;checkpointHash:string;directoryRevision:number;stateId:string;stateHash:string}});
export type StreamedPlanningOptions=MigrationHistoryOptions&{device:UnlockedWebDevice;originalCapacity:RemoteOriginalReadOptions['capacity']};
export type StreamedPlanningTicket=Readonly<{migrationId:string;attemptId:string;sourceHash:string;fence:number;generation:number}>;
export type {MigrationPlanningSession};
type LoadedMigration={state:MigrationState;serial:number;hash:string};
type SessionState=Extract<MigrationState,{protocol:4}>&{ownership:Exclude<StreamedPlanningOwnership,{protocol:1}>;sourceHash:string;lease:NonNullable<MigrationState['lease']>};
export type StreamedPlanningReceipt=Readonly<{ticket:StreamedPlanningTicket;originals:readonly Readonly<{registration:RemoteOriginalRegistration;completion:RemoteOriginalReference|null}>[]}>;
export type StreamedContentPlanningOptions=StreamedPlanningOptions&{planCapacity:MigrationContentPlanCapacity;admitPlan:(usage:MigrationContentPlanAdmission)=>Promise<void>};
export type StreamedContentPlanningReceipt=Readonly<{ticket:StreamedPlanningTicket;plan:MigrationContentPlanReference}>;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8',{fatal:true});
async function digest(bytes: Uint8Array) { return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))); }
function decodeState(bytes: Uint8Array): MigrationState {
  const state = parseLegacyMigrationJson(decoder.decode(bytes),'E2EE_CORRUPT_MIGRATION',4*1024*1024) as unknown as MigrationState;
  try{exactKeys(state,['protocol','migrationId','phase',...(state.protocol>=3?['source']:['snapshotParts','snapshotSize','snapshotHash']),...(state.protocol===4||state.protocol===5?['ownership']:[]),...(state.protocol===5?['adopted']:[]),'ancestors','sourceHash','lease','plan','logical','uploaded','manifestHash','verifiedCheckpoint','pending','resuming','checkpointHash','directoryRevision',...(state.protocol!==1?['local','planned']:[])]);}catch{throw new Error('E2EE_CORRUPT_MIGRATION');}
  if (![1,2,3,4,5].includes(state.protocol) || !['preparing','uploading','verified','active','cancelled'].includes(state.phase)
    || !Array.isArray(state.plan) || state.plan.length > 10000 || !Array.isArray(state.logical)
    || !Number.isSafeInteger(state.uploaded) || state.uploaded < 0 || state.uploaded > state.plan.length
    || (state.protocol===1||state.protocol===2)&&(!Number.isSafeInteger(state.snapshotParts) || state.snapshotParts < 0 || state.snapshotParts > 256)
    || !Array.isArray(state.ancestors)||state.ancestors.length>32||new Set(state.ancestors).size!==state.ancestors.length
    || state.ancestors.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(id)))
    throw new Error('E2EE_CORRUPT_MIGRATION');
  if(state.protocol!==1&&(!Array.isArray(state.local)||typeof state.planned!=='boolean'||!state.planned&&(state.local.length!==0||state.plan.length!==0||state.logical.length!==0||['verified','active'].includes(state.phase))))throw new Error('E2EE_CORRUPT_MIGRATION');
  // v3 currently publishes protected sources only. Never accept an injected
  // lease/plan/receipt as a way around the still-unimplemented streamed planner.
  if(state.protocol===3&&(!['preparing','cancelled'].includes(state.phase)||state.planned||state.sourceHash!==null||state.lease!==null||state.pending!==null||state.resuming!==null
    ||state.uploaded!==0||state.manifestHash!==null||state.verifiedCheckpoint!==null))throw new Error('E2EE_CORRUPT_MIGRATION');
  // This first explicit state4 owns local source/request material and a lease.
  // Upload, content-plan adoption, cancellation and activation remain CLOSED.
  if(state.protocol===4&&(state.phase!=='preparing'||state.planned||state.plan.length||state.logical.length||state.local?.length||state.uploaded!==0
    ||state.manifestHash!==null||state.verifiedCheckpoint!==null||state.pending&&state.pending.command.action!=='migration-start'
    ||state.resuming&&state.resuming.command.action!=='migration-resume'))throw new Error('E2EE_CORRUPT_MIGRATION');
  if(state.protocol===5){
    exactKeys(state.adopted,['reference','checkpointHash','directoryRevision','stateId','stateHash']);exactKeys(state.adopted.reference,['attemptId','manifestHash']);
    assertTechnical(state.adopted.reference.attemptId);assertTechnical(state.adopted.stateId);decodeE2eeBytes(state.adopted.reference.manifestHash,32);decodeE2eeBytes(state.adopted.checkpointHash,32);decodeE2eeBytes(state.adopted.stateHash,32);
    if(!state.planned||state.phase==='preparing'||!state.lease||!state.sourceHash||state.ownership.protocol!==3||!Number.isSafeInteger(state.adopted.directoryRevision)||state.adopted.directoryRevision<1)throw new Error('E2EE_CORRUPT_MIGRATION');
  }
  return state;
}

/** Cold product resume may inspect the authenticated journal without restoring
 * legacy runtime keys or issuing a legacy bootstrap. This metadata grants no
 * writer capability; runStreamed still verifies all originals/plans/receipts. */
export async function readDeviceMigrationResume(device:UnlockedWebDevice,directory:VerifiedDirectory){
 device.requireOpen();const row=await device.vault.read('local-snapshot',`migration:${await digest(encoder.encode(directory.scopeId))}`);device.requireOpen();
 if(!row)return null;
 try{
  const state=decodeState(row.value);if(state.protocol<3||!('source'in state))throw new Error('E2EE_STREAMED_SOURCE_REQUIRED');
  validateStagedMigrationSnapshot(state.source,{ownerId:directory.ownerId,scopeId:directory.scopeId,kind:directory.kind},device.vault.localIdentity(),requiredPrivatePaths(directory.kind).map(path=>path.id));
  return Object.freeze({protocol:state.protocol,phase:state.phase});
 }finally{row.value.fill(0);}
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
    this.#vault=options.vault;this.#directory={...options.directory,checkpoint:snapshotE2eeValue(options.directory.checkpoint),
      devices:new Map([...options.directory.devices].map(([id,device])=>[id,snapshotE2eeValue(device)]))};this.#deviceId=options.deviceId;this.#signingKey=options.signingKey;
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
    try{const state=decodeState(record.value);this.#localEntries(state);return {state,serial:record.serial,hash:await digest(record.value)};}finally{record.value.fill(0);}
  }
  #localEntries(state:MigrationState){
    if(state.protocol===3||state.protocol===4||state.protocol===5)validateStagedMigrationSnapshot(state.source,{ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,kind:this.#directory.kind},this.#vault.localIdentity(),this.#required);
    if(state.protocol===4||state.protocol===5)validateStreamedPlanningOwnership(state.ownership,{migrationId:state.migrationId,target:state.source.target,actor:this.#vault.localIdentity(),
      sourceHash:state.sourceHash,lease:state.lease,checkpointHash:state.protocol===5?state.adopted.checkpointHash:state.checkpointHash,directoryRevision:state.protocol===5?state.adopted.directoryRevision:state.directoryRevision});
    return state.protocol!==1?validateMigrationLocalEntries(state.local,state.protocol===5?state.adopted.reference.attemptId:state.migrationId,this.#allowed):[];
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
  async #save(state: MigrationState, serial: number|null, extra: LocalWrite[] = [],current:()=>void=()=>this.#vault.assertUnlocked()) {
    const value=encoder.encode(JSON.stringify(state));
    try {if(state.protocol===4||state.protocol===5){if(value.length>4*1024*1024)throw new Error('E2EE_STREAMED_METADATA_LIMIT');this.#localEntries(decodeState(value));}const objectId=await this.#stateId;current();await this.#vault.write([...extra,{domain:'local-snapshot',objectId,value,expected:serial}],current);current(); }
    finally { value.fill(0); }
    return serial === null ? 1 : serial+1;
  }
  async prepare(): Promise<void> {
    return this.#localFence(()=>this.#prepareLocked());
  }
  async #prepareLocked():Promise<void> {
    await this.#durableKeys();
    const previous=await this.status();
    if(previous&&previous.protocol>=3)throw new Error('E2EE_STREAMED_SOURCE_REQUIRED');
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
    if(old?.state.protocol===4)throw new Error('E2EE_STREAMED_PLANNER_REQUIRED');
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
      await this.#save(state,old?.serial??null,changes,current);current();
    }finally{encoded.fill(0);changes.forEach(row=>row.value.fill(0));}
  }
  async #snapshot(state: MigrationState) {
    if(state.protocol===3||state.protocol===4)throw new Error('E2EE_STREAMED_PLANNER_REQUIRED');
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
        decode:bytes=>{const state=decodeState(bytes);this.#localEntries(state);if(state.protocol===4)throw new Error('E2EE_STAGED_SOURCE_REQUIRED');return state;},options:policy});
      let rejected=false;
      const close=async()=>{try{await history.close();}catch(error){if(!rejected)throw error;}};
      try{const result=await consume(history.input);await history.assertCompleteAndUnchanged();return result;}
      catch(error){rejected=true;throw error;}finally{await close();}
    });
  }
  #planningPolicy(options:StreamedPlanningOptions){
    const policy={...options,capacity:snapshotE2eeValue(options.capacity),originalCapacity:snapshotE2eeValue(options.originalCapacity)};
    const current=()=>{
      policy.assertCurrent();this.#vault.assertUnlocked();
      if(!(policy.device instanceof UnlockedWebDevice)||policy.device.vault!==this.#vault||policy.device.deviceId!==this.#deviceId)throw new Error('E2EE_DEVICE_VAULT_REQUIRED');
      policy.device.requireOpen();const actor=this.#vault.localIdentity(),device=this.#directory.devices.get(this.#deviceId);
      if(actor.ownerId!==policy.device.ownerId||actor.scopeId!==`device:${this.#deviceId}`||actor.deviceId!==this.#deviceId
        ||!device||device.revoked||device.role!=='owner'||device.userId!==actor.ownerId)throw new Error('E2EE_STREAMED_OWNER_REQUIRED');
    };current();return{policy,current};
  }
  #originalRead(policy:StreamedPlanningOptions,current:()=>void):RemoteOriginalReadOptions{
    return{vault:this.#vault,target:{ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,kind:this.#directory.kind},capacity:policy.originalCapacity,assertCurrent:current};
  }
  async #planningSigner(current:()=>void){
    current();const spki=this.#directory.devices.get(this.#deviceId)!.signingKey;
    const signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(spki,91),{name:'ECDSA',namedCurve:'P-256'},true,['verify']);current();return{spki,signer};
  }
  async #assertPlanningPackets(state:Extract<MigrationState,{protocol:4}>,signer:CryptoKey,current:()=>void){
    if(state.checkpointHash!==this.#directory.checkpoint.hash||state.directoryRevision!==this.#directory.checkpoint.revision
      ||state.ownership.securityEpoch!==this.#directory.securityEpoch||state.ownership.signer!==this.#directory.devices.get(this.#deviceId)!.signingKey)throw new Error('E2EE_DIRECTORY_CONFLICT');
    for(const [name,packet] of [['pending',state.pending],['resuming',state.resuming]] as const){
      if(!packet)continue;const command=await verifyE2eeCommand(packet,signer);current();
      if(command.ownerId!==this.#directory.ownerId||command.scopeId!==this.#directory.scopeId||command.deviceId!==this.#deviceId
        ||command.expectedRevision!==state.directoryRevision||command.checkpointHash!==state.checkpointHash||command.securityEpoch!==state.ownership.securityEpoch
        ||command.payload.migrationId!==state.migrationId||command.payload.sourceHash!==state.sourceHash)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
      if(name==='pending'){
        exactKeys(command.payload,['migrationId','sourceHash']);if(command.action!=='migration-start'||state.lease)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
      }else{
        exactKeys(command.payload,['migrationId','fence','sourceHash','pendingOperationId','pendingHash']);
        if(command.action!=='migration-resume'||!state.lease||command.payload.fence!==state.lease.fence||command.payload.pendingOperationId!==null||command.payload.pendingHash!==null)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
      }
    }
    if(!state.lease&&(state.resuming||state.sourceHash!==null&&!state.pending))throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
  }
  /** A bounded source-only view of the EXACT saved state3 bytes. No prefix is
   * filtered: the old reader still refuses every plan/unknown history role. */
  async #preparedHistory(loaded:{state:MigrationState;serial:number;hash:string},policy:StreamedPlanningOptions,current:()=>void){
    const state=loaded.state;if(state.protocol!==4)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
    const id=await this.#stateId,source=state.ownership.sourceState;current();
    const read:MigrationHistoryReadVault['read']=async(domain,objectId)=>{
      current();if(domain!=='local-snapshot'||objectId!==id)return this.#vault.read(domain,objectId);
      const active=await this.#vault.read(domain,id);
      try{current();if(!active||active.serial!==loaded.serial||await digest(active.value)!==loaded.hash)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');current();}finally{active?.value.fill(0);}
      const original=await this.#vault.read(domain,source.objectId);
      try{
        current();if(!original||original.serial!==1||await digest(original.value)!==source.hash)throw new Error('E2EE_SOURCE_HISTORY_INVALID');current();
        const old=decodeState(original.value);this.#localEntries(old);
        if(old.protocol!==3||old.phase!=='preparing'||old.migrationId!==state.migrationId||old.checkpointHash!==state.checkpointHash||old.directoryRevision!==state.directoryRevision)throw new Error('E2EE_SOURCE_HISTORY_INVALID');
        const left=canonicalE2eeValue({source:old.source,ancestors:old.ancestors} as unknown as WireValue),right=canonicalE2eeValue({source:state.source,ancestors:state.ancestors} as unknown as WireValue);
        try{if(left.length!==right.length||left.some((byte,index)=>byte!==right[index]))throw new Error('E2EE_SOURCE_HISTORY_INVALID');}finally{left.fill(0);right.fill(0);}
        return{serial:1,value:new Uint8Array(original.value)};
      }finally{original?.value.fill(0);}
    };
    const view:MigrationHistoryReadVault={read,assertUnlocked:current,localIdentity:()=>this.#vault.localIdentity(),listLocal:(domain,prefix)=>this.#vault.listLocal(domain,prefix),
      listMigrationOriginalParts:()=>this.#vault.listMigrationOriginalParts(),listMigrationHistoryCopies:()=>this.#vault.listMigrationHistoryCopies()};
    return openMigrationSourceHistory({vault:view,target:state.source.target,paths:this.#required,stateId:id,
      decode:bytes=>{const old=decodeState(bytes);this.#localEntries(old);if(old.protocol===4)throw new Error('E2EE_SOURCE_HISTORY_INVALID');return old;},options:{...policy,assertCurrent:current},
      inspectContentPlans:async ids=>{await this.#assertPlanningCell(loaded,current);return this.#inspectOwnedContentPlans(loaded.state,ids,current);}});
  }
  #contentPlanRead(state:Extract<MigrationState,{protocol:4|5}>,plan:OwnedMigrationContentPlan,current:()=>void){
    const context=plan.context;
    if(context.cryptoEpoch!==this.#directory.cryptoEpoch||context.keyId!==this.#directory.keyId||context.securityEpoch!==this.#directory.securityEpoch)throw new Error('E2EE_DIRECTORY_CONFLICT');
    return{vault:this.#vault,root:this.#root,signer:this.#signer,context,target:state.source.target,migrationId:state.migrationId,sourceHash:state.sourceHash!,paths:this.#required,assertCurrent:current};
  }
  async #inspectOwnedContentPlans(state:MigrationState,ids:readonly string[],current:()=>void){
    if(state.protocol!==4)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');this.#localEntries(state);
    const plans=state.ownership.protocol===3?state.ownership.plans:[],known=new Set<string>();let bytes=0,parts=0,metadataBytes=0;
    // Preflight ALL locator roles before opening their bodies. A journal prefix
    // by itself is not authority; only a durable exact state4 reservation is.
    for(const id of ids)if(!plans.some(plan=>id===`content-plan:${plan.attemptId}:journal`||id===`content-plan:${plan.attemptId}:manifest`))throw new Error('E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED');
    for(const plan of plans){
      const found=await inspectMigrationContentPlanAttempt({...this.#contentPlanRead(state,plan,current),attemptId:plan.attemptId,reference:plan.completion});current();
      for(const id of found.metadataIds)known.add(id);bytes+=found.bytes;parts+=found.records;metadataBytes+=found.metadataBytes;
    }
    if(known.size!==ids.length||ids.some(id=>!known.has(id)))throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
    const outputs=await this.#vault.listMigrationPlanOutputs();current();
    if(outputs.remote.some(id=>!plans.some(plan=>id.startsWith(plan.attemptId+':upload:')))
      ||outputs.local.some(id=>!plans.some(plan=>id.startsWith(plan.attemptId+':private:'))))throw new Error('E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED');
    return Object.freeze({bytes,parts,metadataBytes,sources:plans.length});
  }
  async #drainPreparedHistory(history:Awaited<ReturnType<typeof openMigrationSourceHistory>>,current:()=>void){
    let rejected=false;const close=async()=>{try{await history.close();}catch(error){if(!rejected)throw error;}};
    try{
      for(const source of [history.input.current,...history.input.previous])for(const path of source.paths){
        const reader=await source.openPath(path);for await(const chunk of reader.chunks){current();if(!(chunk instanceof Uint8Array))throw new Error('E2EE_SOURCE_HISTORY_INVALID');}reader.assertComplete();current();
      }
      return await history.assertCompleteAndUnchanged();
    }catch(error){rejected=true;throw error;}finally{await close();}
  }
  async #checkOwnedOriginals(state:Extract<MigrationState,{protocol:4}>,policy:StreamedPlanningOptions,signer:CryptoKey,current:()=>void){
    const options=this.#originalRead(policy,current),known=await listRemoteOriginals(options);current();
    const owned=new Map(state.ownership.originals.map(value=>[value.registration.id,value]));
    for(const original of state.ownership.originals){
      await authenticateRemoteOriginalRegistration(original.registration,original.packet,signer,{...options,generation:state.lease!.generation});current();
    }
    const completions=new Map(state.ownership.protocol!==1?state.ownership.originals.map(row=>[row.registration.id,row.completion] as const):[]);
    for(const [id,completion]of completions)if(completion!==null&&!known.some(marker=>marker.id===id))throw new Error('E2EE_REMOTE_ORIGINAL_MISSING');
    for(const marker of known){
      const original=owned.get(marker.id);if(!original)throw new Error('E2EE_STREAMED_ORIGINAL_REVIEW_REQUIRED');
      const found=await describeRemoteOriginal(options,marker.id);current();
      const left=canonicalE2eeValue(found.registration as unknown as WireValue),right=canonicalE2eeValue(original.registration as unknown as WireValue);
      try{if(left.length!==right.length||left.some((byte,index)=>byte!==right[index]))throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');}finally{left.fill(0);right.fill(0);}
      const completion=completions.get(marker.id);
      if(completion){
        const proof=await withRemoteOriginal(options,marker.id,async input=>{for await(const bytes of input)bytes.fill(0);});current();
        if(!proof.complete||proof.manifestHash!==completion.manifestHash||proof.rawHash!==completion.rawHash||proof.size!==completion.size)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
      }
    }
  }
  /** Explicit state4 PREPARATION, not a content planner. It authenticates all
   * local source EOFs, atomically retains the raw state3 original, then obtains
   * a durable signed lease. Normal run/upload/activation remain fail-closed. */
  async prepareStreamedPlanning(options:StreamedPlanningOptions):Promise<StreamedPlanningTicket>{
    const {policy,current}=this.#planningPolicy(options);
    return this.#localFence(async()=>(await this.#prepareStreamedPlanningLocked(policy,current)).ticket);
  }
  async #prepareStreamedPlanningLocked(policy:StreamedPlanningOptions,current:()=>void){
      current();await policy.device.ensureDurableKeys();current();await this.#durableKeys();current();const {spki,signer}=await this.#planningSigner(current);
      let loaded=await this.#load();current();
      if(loaded.state.protocol===3){
        if(loaded.state.phase!=='preparing')throw new Error('E2EE_STAGED_SOURCE_REQUIRED');
        if(loaded.state.checkpointHash!==this.#directory.checkpoint.hash||loaded.state.directoryRevision!==this.#directory.checkpoint.revision)throw new Error('E2EE_DIRECTORY_CONFLICT');
        const known=await listRemoteOriginals(this.#originalRead(policy,current));current();if(known.length)throw new Error('E2EE_STREAMED_ORIGINAL_REVIEW_REQUIRED');
        const raw=await this.#vault.read('local-snapshot',await this.#stateId);
        try{
          current();if(!raw||raw.serial!==loaded.serial||await digest(raw.value)!==loaded.hash)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');current();
          const history=await openMigrationSourceHistory({vault:this.#vault,target:loaded.state.source.target,paths:this.#required,stateId:await this.#stateId,
            decode:bytes=>{const old=decodeState(bytes);this.#localEntries(old);if(old.protocol===4)throw new Error('E2EE_SOURCE_HISTORY_INVALID');return old;},options:{...policy,assertCurrent:current}});
          const totals=await this.#drainPreparedHistory(history,current);current();
          const original=loaded.state,ownership:StreamedPlanningOwnership={protocol:1,attemptId:crypto.randomUUID(),sourceState:{objectId:`${original.migrationId}:preparation:3`,hash:loaded.hash,originalSerial:loaded.serial},signer:spki,securityEpoch:this.#directory.securityEpoch,originals:[]};
          const state:MigrationState={...original,protocol:4,ownership},guard=await stagedMigrationPublicationGuard(this.#vault,state.source,current);current();
          const bytes=encoder.encode(JSON.stringify(state));
          try{const metadataBytes=totals.metadataBytes+raw.value.length+bytes.length+guard.value.length;
            if(metadataBytes>policy.capacity.maximumMetadataBytes)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');await policy.admit({...totals,metadataBytes});current();
            await this.#save(state,loaded.serial,[guard,{domain:'local-snapshot',objectId:ownership.sourceState.objectId,value:raw.value,expected:null}],current);current();
          }finally{bytes.fill(0);guard.value.fill(0);}
        }finally{raw?.value.fill(0);}
        loaded=await this.#load();current();
      }
      let {state,serial}=loaded;if(state.protocol!==4)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
      await this.#assertPlanningPackets(state,signer,current);
      await this.#checkOwnedOriginals(state,policy,signer,current);
      await this.#drainPreparedHistory(await this.#preparedHistory(loaded,policy,current),current);current();
      if(state.resuming)({state,serial}=await this.#resume(state,serial,current));current();
      if(state.pending)({state,serial}=await this.#replay(state,serial,current));current();
      if(state.protocol!==4)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
      if(!state.lease){
        state.sourceHash=await this.#transport.sourceHash();current();decodeE2eeBytes(state.sourceHash,32);
        const packet=await this.#packet(state,'migration-start',{migrationId:state.migrationId,sourceHash:state.sourceHash});current();
        await verifyE2eeCommand(packet,signer);current();({state,serial}=await this.#send(state,serial,packet,current));current();
      }
      if(state.protocol!==4||!state.lease||!state.sourceHash)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
      if(state.lease.leaseUntil<=Math.floor(Date.now()/1000)+30){({state,serial}=await this.#resume(state,serial,current));current();}
      if(state.protocol!==4||!state.lease||!state.sourceHash)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
      await policy.device.ensureDurableKeys();current();
      const ticket=Object.freeze({migrationId:state.migrationId,attemptId:state.ownership.attemptId,sourceHash:state.sourceHash,fence:state.lease.fence,generation:state.lease.generation});
      const expected=await digest(encoder.encode(JSON.stringify(state))),saved=await this.#load();current();
      if(saved.serial!==serial||saved.hash!==expected)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
      return{ticket,loaded:saved};
  }
  async #assertPlanningCell(cell:LoadedMigration,current:()=>void){
    current();const actual=await this.#load();current();
    if(actual.serial!==cell.serial||actual.hash!==cell.hash)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
  }
  async #advancePlanningCell(cell:LoadedMigration,state:MigrationState,serial:number,current:()=>void){
    const bytes=encoder.encode(JSON.stringify(state));let expected:string;
    try{expected=await digest(bytes);}finally{bytes.fill(0);}current();const actual=await this.#load();current();
    if(actual.serial!==serial||actual.hash!==expected)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
    cell.state=actual.state;cell.serial=actual.serial;cell.hash=actual.hash;
  }
  async #savePlanningCell(cell:LoadedMigration,next:Extract<MigrationState,{protocol:4}>,policy:StreamedPlanningOptions,
    history:Awaited<ReturnType<typeof openMigrationSourceHistory>>,current:()=>void){
    current();this.#localEntries(next);await this.#assertPlanningCell(cell,current);
    const totals=await history.assertMetadataUnchanged();current();
    const guard=await stagedMigrationPublicationGuard(this.#vault,next.source,current),bytes=encoder.encode(JSON.stringify(next));
    try{
      const metadataBytes=totals.metadataBytes+bytes.length+guard.value.length;
      if(metadataBytes>policy.capacity.maximumMetadataBytes)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
      await policy.admit({...totals,metadataBytes});current();await policy.device.ensureDurableKeys();current();
      const serial=await this.#save(next,cell.serial,[guard],current);current();
      await this.#advancePlanningCell(cell,next,serial,current);
    }finally{bytes.fill(0);guard.value.fill(0);}
  }
  /** One real whole-job fence owns the complete capture session. Public
   * reserve/prepare methods are never recursively called from its callbacks.
   * This still publishes no content plan and opens no run/upload/activation. */
  async withStreamedPlanning(consume:(session:MigrationPlanningSession)=>Promise<void>,options:StreamedPlanningOptions):Promise<StreamedPlanningReceipt>{
    const {policy,current}=this.#planningPolicy(options);
    return this.#localFence(async()=>{
      const {ticket,loaded:cell}=await this.#prepareStreamedPlanningLocked(policy,current);current();
      const history=await this.#preparedHistory(cell,policy,current);let rejected=false;
      const close=async()=>{try{await history.close();}catch(error){if(!rejected)throw error;}};
      try{
        for(const source of [history.input.current,...history.input.previous])for(const path of source.paths){
          const reader=await source.openPath(path);for await(const bytes of reader.chunks){current();bytes.fill(0);}reader.assertComplete();current();
        }
        await history.assertCompleteAndUnchanged();current();
        if(cell.state.protocol!==4)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
        if(cell.state.ownership.protocol===1){
          const next:Extract<MigrationState,{protocol:4}>={...cell.state,ownership:{...cell.state.ownership,protocol:2,originals:cell.state.ownership.originals.map(row=>({...row,completion:null}))}};
          await this.#savePlanningCell(cell,next,policy,history,current);
        }
        const state4=():SessionState=>{current();if(cell.state.protocol!==4||!cell.state.lease||!cell.state.sourceHash||cell.state.ownership.protocol===1)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');return cell.state as SessionState;};
        const same=(left:unknown,right:unknown)=>{const a=canonicalE2eeValue(left as WireValue),b=canonicalE2eeValue(right as WireValue);try{return a.length===b.length&&a.every((value,index)=>value===b[index]);}finally{a.fill(0);b.fill(0);}};
        const {signer}=await this.#planningSigner(current),read=(guard:()=>void)=>this.#originalRead(policy,guard);
        const complete=async(registration:RemoteOriginalRegistration,packet:SignedE2eeCommand,reference:RemoteOriginalReference,guard:()=>void)=>{
          guard();const state=state4(),index=state.ownership.originals.findIndex(row=>row.registration.id===registration.id),owned=state.ownership.originals[index];
          if(index<0||!same(owned.registration,registration)||!same(owned.packet,packet)||reference.id!==registration.id)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
          if(owned.completion!==null){if(!same(owned.completion,reference))throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');await this.#assertPlanningCell(cell,guard);return;}
          const descriptor=await describeRemoteOriginal(read(guard),registration.id);guard();
          if(!same(descriptor.registration,registration)||descriptor.phase!=='complete'||descriptor.manifestHash!==reference.manifestHash||descriptor.rawHash!==reference.rawHash||descriptor.size!==reference.size)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
          const originals=state.ownership.originals.map((row,at)=>at===index?{...row,completion:snapshotE2eeValue(reference)}:row);
          await this.#savePlanningCell(cell,{...state,ownership:{...state.ownership,originals}},policy,history,guard);
        };
        // A completed response can outlive a lost ownership acknowledgement.
        // Cold repair authenticates its full bytes before adding a binding;
        // a missing/partial capture stays explicitly unbound and is retained.
        for(const owned of state4().ownership.originals){
          if(owned.completion!==null)continue;
          const markers=await listRemoteOriginals(read(current));current();const marker=markers.find(value=>value.id===owned.registration.id);
          if(marker?.phase!=='complete')continue;
          const proof=await withRemoteOriginal(read(current),marker.id,async source=>{for await(const bytes of source)bytes.fill(0);});current();
          if(!proof.complete||proof.manifestHash===null)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
          await complete(owned.registration,owned.packet,{id:proof.id,manifestHash:proof.manifestHash,rawHash:proof.rawHash,size:proof.size},current);
        }
        const refresh=async()=>{
          await this.#assertPlanningCell(cell,current);await history.assertMetadataUnchanged();current();const state=state4();
          if(state.lease!.leaseUntil<=Math.floor(Date.now()/1000)+30){
            const next=structuredClone(state),renewed=await this.#resume(next,cell.serial,current);current();
            await this.#advancePlanningCell(cell,renewed.state,renewed.serial,current);
          }
        };
        const context:MigrationSourceContext=Object.freeze({ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,migrationId:ticket.migrationId,sourceHash:ticket.sourceHash,fence:ticket.fence,generation:ticket.generation});
        return await withOwnedMigrationPlanning({context,binding:{ownerId:context.ownerId,scopeId:context.scopeId,deviceId:this.#deviceId,checkpointHash:this.#directory.checkpoint.hash,directoryRevision:this.#directory.checkpoint.revision,securityEpoch:this.#directory.securityEpoch},assertCurrent:current,
          packet:async(action,page)=>{await refresh();current();const state=state4();return this.#packet(state,action,{migrationId:state.migrationId,fence:state.lease!.fence,sourceHash:state.sourceHash!,...page});},
          original:(packet,guard)=>({...read(guard),vault:this.#vault,packet,signer,generation:state4().lease!.generation,ensureDurableKeys:()=>policy.device.ensureDurableKeys(),
            admit:async usage=>{await policy.admit({bytes:usage.bytes,parts:usage.parts,metadataBytes:usage.metadataBytes,sources:usage.observations});guard();}}),
          reserve:async(registration,packet,guard)=>{
            guard();const state=state4(),authenticated=await authenticateRemoteOriginalRegistration(registration,packet,signer,{...read(guard),generation:state.lease!.generation});guard();
            if(authenticated.binding.fence!==state.lease!.fence||authenticated.binding.migrationId!==state.migrationId||authenticated.binding.sourceHash!==state.sourceHash)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
            if(state.ownership.originals.length>=1000||state.ownership.originals.some(row=>row.registration.id===authenticated.id))throw new Error('E2EE_STREAMED_ORIGINAL_ALREADY_RESERVED');
            const next:Extract<MigrationState,{protocol:4}>={...state,ownership:{...state.ownership,originals:[...state.ownership.originals,{registration:authenticated,packet:snapshotE2eeValue(packet),completion:null}]}};
            await this.#savePlanningCell(cell,next,policy,history,guard);
          },complete,
          finish:async()=>{
            await history.assertCompleteAndUnchanged();current();await this.#assertPlanningCell(cell,current);const state=state4();
            await this.#checkOwnedOriginals(state,policy,signer,current);await policy.device.ensureDurableKeys();current();
            return Object.freeze({ticket:Object.freeze({...ticket,fence:state.lease!.fence}),originals:Object.freeze(state.ownership.originals.map(row=>Object.freeze({
              registration:Object.freeze({...row.registration,context:Object.freeze({...row.registration.context}),binding:Object.freeze({...row.registration.binding})}),
              completion:row.completion===null?null:Object.freeze({...row.completion})})))});
          }
        },consume);
      }catch(error){rejected=true;throw error;}finally{await close();}
    });
  }
  /** Local plan adoption under the same coordinator/source CAS. This consumes
   * authenticated local history and already captured remote originals; it never
   * performs a legacy read, upload, run or activation. A retry retains every
   * missing/partial/complete attempt and only reuses an exact complete binding. */
  async planStreamedContent(build:(session:MigrationContentPlanningSession)=>Promise<readonly MigrationCoverage[]>,options:StreamedContentPlanningOptions):Promise<StreamedContentPlanningReceipt>{
    if(typeof build!=='function'||typeof options.admitPlan!=='function')throw new Error('E2EE_STREAMED_PLANNER_REQUIRED');
    const planCapacity={...options.planCapacity},admitPlan=options.admitPlan,{policy,current}=this.#planningPolicy(options);
    if(!Number.isSafeInteger(planCapacity.maximumBytes)||planCapacity.maximumBytes<1||!Number.isSafeInteger(planCapacity.maximumEnvelopes)||planCapacity.maximumEnvelopes<1||planCapacity.maximumEnvelopes>8000
      ||!Number.isSafeInteger(planCapacity.maximumLocalParts)||planCapacity.maximumLocalParts<1||planCapacity.maximumLocalParts>8000)throw new Error('E2EE_CONTENT_PLAN_CAPACITY');
    return this.#localFence(async()=>{
      const {ticket,loaded:cell}=await this.#prepareStreamedPlanningLocked(policy,current);current();
      const history=await this.#preparedHistory(cell,policy,current);let writer:ProtectedMigrationContentPlan|undefined,rejected=false;
      const close=async()=>{try{await history.close();}catch(error){if(!rejected)throw error;}};
      const state4=()=>{current();if(cell.state.protocol!==4||!cell.state.lease||!cell.state.sourceHash)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');return cell.state;};
      try{
        let state=state4();
        if(state.ownership.protocol!==3){
          if(state.ownership.protocol===1&&state.ownership.originals.length)throw new Error('E2EE_STREAMED_CAPTURE_REQUIRED');
          const next:Extract<MigrationState,{protocol:4}>={...state,ownership:{...state.ownership,protocol:3,originals:state.ownership.originals as Extract<StreamedPlanningOwnership,{protocol:2}>['originals'],plans:[]}};
          await this.#savePlanningCell(cell,next,policy,history,current);state=state4();
        }
        if(state.ownership.protocol!==3)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
        // Failed read-only responses cannot contain a unique acknowledged edit.
        // Preserve their reservations/prefixes in ownership, without promoting
        // them to EOF proof. The full registry must read the SAME fenced source
        // through complete replies before it can finish a new plan.
        const originals=state.ownership.originals.filter(row=>row.completion!==null).map(row=>{
          return Object.freeze({registration:Object.freeze({...row.registration,context:Object.freeze({...row.registration.context}),binding:Object.freeze({...row.registration.binding})}),completion:Object.freeze({...row.completion!}),packet:snapshotE2eeValue(row.packet)});
        }),references=originals.map(row=>row.completion),{signer}=await this.#planningSigner(current);
        const same=(left:unknown,right:unknown)=>{const a=canonicalE2eeValue(left as WireValue),b=canonicalE2eeValue(right as WireValue);try{return a.length===b.length&&a.every((byte,index)=>byte===b[index]);}finally{a.fill(0);b.fill(0);}};
        const plans=state.ownership.plans;
        // Recover only the inert completion binding after a lost final CAS/ack.
        // This never turns a partial journal into a complete reference.
        for(const reserved of plans){
          const found=await inspectMigrationContentPlanAttempt({...this.#contentPlanRead(state4(),reserved,current),attemptId:reserved.attemptId,reference:reserved.completion});current();
          if(found.reference&&reserved.completion===null){
            const saved=snapshotE2eeValue(state4());if(saved.ownership.protocol!==3)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
            const next={...saved,ownership:{...saved.ownership,plans:saved.ownership.plans.map(row=>row.attemptId===reserved.attemptId?{...row,completion:found.reference}:row)}};
            await this.#savePlanningCell(cell,next,policy,history,current);
          }
        }
        state=state4();if(state.ownership.protocol!==3)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
        const reusable=[...state.ownership.plans].reverse().find(row=>row.completion&&same(row.originals,references));
        if(reusable?.completion){
          for(const source of [history.input.current,...history.input.previous])for(const path of source.paths){const reader=await source.openPath(path);for await(const bytes of reader.chunks)bytes.fill(0);reader.assertComplete();}
          await history.assertCompleteAndUnchanged();await this.#checkOwnedOriginals(state,policy,signer,current);await this.#assertPlanningCell(cell,current);
          await policy.device.ensureDurableKeys();current();await this.#durableKeys();current();await this.#assertPlanningCell(cell,current);
          return Object.freeze({ticket:Object.freeze({...ticket,fence:state.lease!.fence}),plan:Object.freeze({...reusable.completion})});
        }
        if(state.ownership.plans.length>=64)throw new Error('E2EE_CONTENT_PLAN_CAPACITY');
        const attemptId=crypto.randomUUID(),context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,
          domain:'local-snapshot',objectId:'migration-content-plan',schemaVersion:1,dataGeneration:state.lease!.generation,writerProtocol:9,cryptoEpoch:this.#directory.cryptoEpoch,
          securityEpoch:this.#directory.securityEpoch,revision:1,keyId:this.#directory.keyId,deviceId:this.#deviceId,operationId:crypto.randomUUID()};
        const plan:OwnedMigrationContentPlan={attemptId,context,fence:state.lease!.fence,generation:state.lease!.generation,originals:references,completion:null};
        await this.#savePlanningCell(cell,{...state,ownership:{...state.ownership,plans:[...state.ownership.plans,plan]}},policy,history,current);
        // The reservation above is durable BEFORE even the first plan journal.
        // A failed initial write leaves a discoverable missing reservation.
        const consumed=new Set<string>();
        const sourceComplete=async()=>{
          await history.assertCompleteAndUnchanged();current();await this.#assertPlanningCell(cell,current);
          if(originals.some(row=>!consumed.has(row.completion.id)))throw new Error('E2EE_REMOTE_ORIGINAL_INCOMPLETE_READ');
          await this.#checkOwnedOriginals(state4(),policy,signer,current);current();
          await policy.device.ensureDurableKeys();current();await this.#durableKeys();current();
        };
        writer=await ProtectedMigrationContentPlan.create({...this.#contentPlanRead(state4(),plan,current),vault:this.#vault,signingKey:this.#signingKey,attemptId,capacity:planCapacity,
          ensureDurableKeys:async()=>{await policy.device.ensureDurableKeys();current();await this.#durableKeys();current();},
          admit:async usage=>{await this.#assertPlanningCell(cell,current);await admitPlan(usage);current();},assertSourceComplete:sourceComplete});
        return await withOwnedContentPlanning({sources:history.input,originals:Object.freeze(originals),assertCurrent:current,
          withOriginal:async(id,consume,guard)=>{
            const owned=originals.find(row=>row.completion.id===id);if(!owned)throw new Error('E2EE_STREAMED_ORIGINAL_REVIEW_REQUIRED');
            await this.#assertPlanningCell(cell,guard);
            const proof=await withRemoteOriginal(this.#originalRead(policy,guard),id,consume);guard();
            if(!proof.complete||!same({id:proof.id,manifestHash:proof.manifestHash,rawHash:proof.rawHash,size:proof.size},owned.completion))throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
            consumed.add(id);
          },emit:async(path,record,guard)=>{guard();await writer!.append(path,record);guard();},
          finish:async coverage=>{
            const reference=await writer!.finish(coverage);current();
            await openMigrationContentPlan({...this.#contentPlanRead(state4(),plan,current),reference});current();await sourceComplete();
            const saved=snapshotE2eeValue(state4());if(saved.ownership.protocol!==3)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
            const next={...saved,ownership:{...saved.ownership,plans:saved.ownership.plans.map(row=>row.attemptId===attemptId?{...row,completion:reference}:row)}};
            await this.#savePlanningCell(cell,next,policy,history,current);
            await this.#assertPlanningCell(cell,current);await history.assertCompleteAndUnchanged();current();
            return Object.freeze({ticket:Object.freeze({...ticket,fence:next.lease!.fence}),plan:Object.freeze({...reference})});
          }
        },build);
      }catch(error){rejected=true;throw error;}finally{writer?.close();await close();}
    });
  }
  /** Adopt an authenticated complete plan, retaining its state4/originals.
   * This is the only transition from streamed preparation into upload. */
  async adoptStreamedContentPlan(reference:MigrationContentPlanReference,options:StreamedPlanningOptions):Promise<void>{
    const chosen={...reference},{policy,current}=this.#planningPolicy(options);
    return this.#localFence(async()=>{
      const loaded=await this.#load();current();
      if(loaded.state.protocol===5){if(loaded.state.adopted.reference.attemptId!==chosen.attemptId||loaded.state.adopted.reference.manifestHash!==chosen.manifestHash)throw new Error('E2EE_CONTENT_PLAN_CONFLICT');await this.#adoptedPlan(loaded.state,current);return;}
      const state=loaded.state;
      if(state.protocol!==4||state.ownership.protocol!==3||!state.lease||!state.sourceHash||state.pending||state.resuming)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
      const reserved=state.ownership.plans.find(plan=>plan.completion?.attemptId===chosen.attemptId&&plan.completion.manifestHash===chosen.manifestHash);
      if(!reserved||reserved.fence!==state.lease.fence||reserved.generation!==state.lease.generation)throw new Error('E2EE_CONTENT_PLAN_CONFLICT');
      const {signer}=await this.#planningSigner(current);await this.#checkOwnedOriginals(state,policy,signer,current);
      const manifest=await openMigrationContentPlan({...this.#contentPlanRead(state,reserved,current),reference:chosen});current();
      const expected=state.ownership.originals.filter(row=>row.completion!==null).map(row=>row.completion),same=(left:unknown,right:unknown)=>{const a=canonicalE2eeValue(left as WireValue),b=canonicalE2eeValue(right as WireValue);try{return a.length===b.length&&a.every((byte,index)=>byte===b[index]);}finally{a.fill(0);b.fill(0);}};
      if(!same(reserved.originals,expected))throw new Error('E2EE_CONTENT_PLAN_CONFLICT');
      await this.#drainPreparedHistory(await this.#preparedHistory(loaded,policy,current),current);
      await this.#recoveryCheck(this.#root);current();await policy.device.ensureDurableKeys();current();await this.#durableKeys();current();
      const original=encoder.encode(JSON.stringify(state)),stateId=`${state.migrationId}:adoption:${chosen.attemptId}`;
      const guard=await stagedMigrationPublicationGuard(this.#vault,state.source,current);
      try{
        const next:Extract<MigrationState,{protocol:5}>={...state,protocol:5,phase:'uploading',planned:true,plan:manifest.plan.map(row=>({...row})),logical:manifest.logical.map(row=>({...row})),
          local:manifest.local.map(row=>({...row})),adopted:{reference:chosen,checkpointHash:state.checkpointHash,directoryRevision:state.directoryRevision,stateId,stateHash:await digest(original)}};
        current();await this.#save(next,loaded.serial,[guard,{domain:'local-snapshot',objectId:stateId,value:original,expected:null}],current);current();
      }finally{original.fill(0);guard.value.fill(0);}
    });
  }
  async #adoptedPlan(state:Extract<MigrationState,{protocol:5}>,current:()=>void){
    this.#localEntries(state);const saved=await this.#vault.read('local-snapshot',state.adopted.stateId);
    try{
      current();if(!saved||saved.serial!==1||await digest(saved.value)!==state.adopted.stateHash||state.adopted.stateId!==`${state.migrationId}:adoption:${state.adopted.reference.attemptId}`)throw new Error('E2EE_CONTENT_PLAN_CONFLICT');
      const original=decodeState(saved.value);this.#localEntries(original);
      if(original.protocol!==4||original.ownership.protocol!==3||original.migrationId!==state.migrationId||original.sourceHash!==state.sourceHash||original.checkpointHash!==state.adopted.checkpointHash||original.directoryRevision!==state.adopted.directoryRevision)throw new Error('E2EE_CONTENT_PLAN_CONFLICT');
      const same=(left:unknown,right:unknown)=>{const a=canonicalE2eeValue(left as WireValue),b=canonicalE2eeValue(right as WireValue);try{return a.length===b.length&&a.every((byte,index)=>byte===b[index]);}finally{a.fill(0);b.fill(0);}};
      if(!same(original.ownership,state.ownership)||!same(original.source,state.source))throw new Error('E2EE_CONTENT_PLAN_CONFLICT');
      const plan=original.ownership.plans.find(row=>row.completion?.attemptId===state.adopted.reference.attemptId&&row.completion.manifestHash===state.adopted.reference.manifestHash);
      if(!plan)throw new Error('E2EE_CONTENT_PLAN_CONFLICT');const read={...this.#contentPlanRead(state,plan,current),reference:state.adopted.reference};
      const manifest=await openMigrationContentPlan(read);current();
      if(!same(state.plan,manifest.plan)||!same(state.logical,manifest.logical)||!same(state.local,manifest.local))throw new Error('E2EE_CONTENT_PLAN_CONFLICT');
      return{read,original};
    }finally{saved?.value.fill(0);}
  }
  async runStreamed(options:StreamedPlanningOptions):Promise<MigrationPhase>{
    const {policy,current}=this.#planningPolicy(options);
    return this.#localFence(async()=>{
      const loaded=await this.#load();current();if(loaded.state.protocol!==5)throw new Error('E2EE_STREAMED_PLAN_ADOPTION_REQUIRED');
      const {original}=await this.#adoptedPlan(loaded.state,current),{signer}=await this.#planningSigner(current);
      await this.#checkOwnedOriginals(original,policy,signer,current);current();return this.#runLocked(current,true);
    });
  }
  /** Reserve the exact inert request BEFORE observation.prepare / any network.
   * Every earlier reservation/capture remains owned, including missing/partial
   * originals. This is not a content/body proof or a plan publication. */
  async reserveStreamedRemoteOriginal(registration:RemoteOriginalRegistration,packet:SignedE2eeCommand,options:StreamedPlanningOptions):Promise<void>{
    const saved=snapshotE2eeValue(registration),request=snapshotE2eeValue(packet),{policy,current}=this.#planningPolicy(options);
    return this.#localFence(async()=>{
      current();await policy.device.ensureDurableKeys();current();const loaded=await this.#load(),{state}=loaded;current();
      if(state.protocol!==4||!state.lease||!state.sourceHash||state.pending||state.resuming)throw new Error('E2EE_STREAMED_PLANNING_REQUIRED');
      const {signer}=await this.#planningSigner(current);await this.#assertPlanningPackets(state,signer,current);
      await this.#checkOwnedOriginals(state,policy,signer,current);
      const authenticated=await authenticateRemoteOriginalRegistration(saved,request,signer,{...this.#originalRead(policy,current),generation:state.lease.generation});current();
      if(authenticated.binding.fence!==state.lease.fence||authenticated.binding.migrationId!==state.migrationId||authenticated.binding.sourceHash!==state.sourceHash)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');
      if(state.ownership.originals.some(value=>value.registration.id===authenticated.id)||state.ownership.originals.length===1000)throw new Error('E2EE_STREAMED_ORIGINAL_ALREADY_RESERVED');
      const ownership:StreamedPlanningOwnership=state.ownership.protocol!==1?{...state.ownership,originals:[...state.ownership.originals,{registration:authenticated,packet:request,completion:null}]}:
        {...state.ownership,originals:[...state.ownership.originals,{registration:authenticated,packet:request}]};
      const next:MigrationState={...state,ownership};
      this.#localEntries(next);
      // Reauthenticate the exact original metadata and all source EOFs before
      // the owner CAS. No empty/foreign history can authorize a request.
      await this.#drainPreparedHistory(await this.#preparedHistory(loaded,policy,current),current);current();
      const guard=await stagedMigrationPublicationGuard(this.#vault,state.source,current),bytes=encoder.encode(JSON.stringify(next));
      try{if(bytes.length+guard.value.length>policy.capacity.maximumMetadataBytes)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');await policy.admit({bytes:0,parts:0,metadataBytes:bytes.length+guard.value.length,sources:1});current();
        await policy.device.ensureDurableKeys();current();await this.#save(next,loaded.serial,[guard],current);current();
      }finally{guard.value.fill(0);bytes.fill(0);}
    });
  }
  #packet(state: MigrationState, action: string, payload: Record<string,WireValue>, operationId:string=crypto.randomUUID()) {
    const command:E2eeCommand={protocol:1,ownerId:this.#directory.ownerId,scopeId:this.#directory.scopeId,deviceId:this.#deviceId,action,
      expectedRevision:state.directoryRevision,checkpointHash:state.checkpointHash,securityEpoch:this.#directory.securityEpoch,operationId,payload};
    return signE2eeCommand(command,this.#signingKey);
  }
  #lease(state: MigrationState) { if (!state.lease) throw new Error('E2EE_CORRUPT_MIGRATION'); return state.lease; }
  async #send(state: MigrationState, serial: number, packet: SignedE2eeCommand,current:()=>void=()=>this.#vault.assertUnlocked()) {
    current();state.pending=snapshotE2eeValue(packet);serial=await this.#save(state,serial,[],current);
    return this.#replay(state,serial,current);
  }
  async #replay(state: MigrationState,serial: number,current:()=>void=()=>this.#vault.assertUnlocked()):Promise<{state:MigrationState;serial:number}> {
    const pending=state.pending;if(!pending)throw new Error('E2EE_CORRUPT_MIGRATION');
    // The exact signed ciphertext/operation is retried after a timeout or process death.
    current();this.#vault.assertUnlocked();
    if(['migration-verify','migration-commit'].includes(pending.command.action))await this.#verifyLocal(state);
    let result:Record<string,WireValue>;
    try{result=snapshotE2eeValue(await this.#transport.command(snapshotE2eeValue(pending)));current();}catch(error){
      current();
      if(error instanceof Error && error.message==='E2EE_MIGRATION_FENCED' && state.lease && pending.command.action!=='migration-start') {
        ({state,serial}=await this.#resume(state,serial,current));
        return state.pending?this.#replay(state,serial,current):{state,serial};
      }
      throw error;
    }
    return this.#applyReceipt(state,serial,result,current);
  }
  async #applyReceipt(state:MigrationState,serial:number,result:Record<string,WireValue>,current:()=>void=()=>this.#vault.assertUnlocked()) {
    current();
    const pending=state.pending;if(!pending)throw new Error('E2EE_CORRUPT_MIGRATION');
    switch(pending.command.action) {
      case 'migration-start': {
        const {fence,leaseUntil,generation}=result;
        if(!Number.isSafeInteger(fence)||!Number.isSafeInteger(leaseUntil)||!Number.isSafeInteger(generation))throw new Error('E2EE_INVALID_RECEIPT');
        state.lease={fence:fence as number,leaseUntil:leaseUntil as number,generation:generation as number};state.phase=state.protocol===4?'preparing':'uploading';break;
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
    current();state.pending=null;serial=await this.#save(state,serial,[],current);return{state,serial};
  }
  async #resume(state:MigrationState,serial:number,current:()=>void=()=>this.#vault.assertUnlocked()):Promise<{state:MigrationState;serial:number}> {
    current();
    const lease=this.#lease(state);if(!state.sourceHash)throw new Error('E2EE_CORRUPT_MIGRATION');
    if(!state.resuming) {
      state.resuming=await this.#packet(state,'migration-resume',{migrationId:state.migrationId,fence:lease.fence,sourceHash:state.sourceHash,
        pendingOperationId:state.pending?.command.operationId??null,pendingHash:state.pending?await e2eeCommandHash(state.pending.command):null});
      current();serial=await this.#save(state,serial,[],current);
    }
    current();this.#vault.assertUnlocked();const result=snapshotE2eeValue(await this.#transport.command(snapshotE2eeValue(state.resuming)));current();
    const {fence,leaseUntil,generation,pendingReceipt}=result;
    if(!Number.isSafeInteger(fence)||(fence as number)!==lease.fence+1||!Number.isSafeInteger(leaseUntil)||generation!==lease.generation)
      throw new Error('E2EE_INVALID_RECEIPT');
    state.lease={fence:fence as number,leaseUntil:leaseUntil as number,generation:lease.generation};
    if(pendingReceipt!==null) {
      if(!state.pending||!pendingReceipt||typeof pendingReceipt!=='object'||Array.isArray(pendingReceipt)
        ||pendingReceipt.payloadHash!==await e2eeCommandHash(state.pending.command)
        ||!pendingReceipt.result||typeof pendingReceipt.result!=='object'||Array.isArray(pendingReceipt.result))throw new Error('E2EE_INVALID_RECEIPT');
      // Persist a recovered acknowledgement and removal of its renewal together.
      state.resuming=null;return this.#applyReceipt(state,serial,pendingReceipt.result,current);
    }
    if(state.pending) {
      const old=state.pending.command;
      state.pending=await signE2eeCommand({...old,payload:{...old.payload,fence:state.lease.fence}},this.#signingKey);
    }
    current();state.resuming=null;serial=await this.#save(state,serial,[],current);return{state,serial};
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
        if(previous.protocol===3||previous.protocol===4)throw new Error('E2EE_STREAMED_SOURCE_REQUIRED');
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
  async #runLocked(current:()=>void=()=>this.#vault.assertUnlocked(),streamed=false):Promise<MigrationPhase> {
    let {state,serial}=await this.#load();
    current();
    if(state.protocol===3&&state.phase==='cancelled')return 'cancelled';
    if(state.protocol===3||state.protocol===4||state.protocol===5&&!streamed)throw new Error('E2EE_STREAMED_PLANNER_REQUIRED');
    await this.#durableKeys();
    await this.#verifyLocal(state);
    if(state.resuming)({state,serial}=await this.#resume(state,serial,current));
    if(state.pending)({state,serial}=await this.#replay(state,serial,current));
    if(state.phase==='active'||state.phase==='cancelled')return state.phase;
    if(state.phase==='preparing') {
      // No transport is reached until the snapshot and key material have been durably saved.
      this.#vault.assertUnlocked();state.sourceHash=await this.#transport.sourceHash();decodeE2eeBytes(state.sourceHash,32);
      ({state,serial}=await this.#send(state,serial,await this.#packet(state,'migration-start',{migrationId:state.migrationId,sourceHash:state.sourceHash})));
    }
    if(!state.lease)throw new Error('E2EE_CORRUPT_MIGRATION');
    if(state.lease.leaseUntil<=Math.floor(Date.now()/1000)+30)({state,serial}=await this.#resume(state,serial,current));
    if(state.phase==='uploading'&&(state.protocol===1?state.plan.length===0:!state.planned))({state,serial}=await this.#plan(state,serial));
    await this.#verifyLocal(state);
    while(state.phase==='uploading'&&state.uploaded<state.plan.length) {
      current();
      const item=state.plan[state.uploaded],row=await this.#vault.read('outbox',item.recordId);if(!row)throw new Error('E2EE_CORRUPT_OUTBOX');
      let envelope:E2eeEnvelope;
      try{envelope=JSON.parse(decoder.decode(row.value));if(await envelopePayloadHash(envelope)!==item.hash)throw new Error('E2EE_CORRUPT_OUTBOX');}
      finally{row.value.fill(0);}
      const payload={envelope:envelope as unknown as WireValue,expectedObjectRevision:0,migrationId:state.migrationId,fence:this.#lease(state).fence};
      ({state,serial}=await this.#send(state,serial,await this.#packet(state,'put',payload,envelope.context.operationId),current));
    }
    if(state.phase==='uploading') {
      if(state.protocol===5){
        const {read}=await this.#adoptedPlan(state,current);
        if(!this.#transport.forEachEnvelope||!this.#transport.getEnvelope)throw new Error('E2EE_STREAMED_READBACK_REQUIRED');
        await verifyMigrationContentPlanReadback(read,{forEachEnvelope:this.#transport.forEachEnvelope.bind(this.#transport),getEnvelope:this.#transport.getEnvelope.bind(this.#transport)});current();
      }else{
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
      }
      await this.#recoveryCheck(this.#root);
      await this.#verifyLocal(state);
      state.manifestHash=await objectManifestHash(state.plan.map(item=>({domain:item.domain,objectId:item.objectId,revision:1,payloadHash:item.hash})));
      state.verifiedCheckpoint=encodeE2eeBytes(freshSecret());
      ({state,serial}=await this.#send(state,serial,await this.#packet(state,'migration-verify',{migrationId:state.migrationId,fence:this.#lease(state).fence,
        manifestHash:state.manifestHash,objectCount:state.plan.length,verifiedCheckpoint:state.verifiedCheckpoint}),current));
    }
    if(state.phase==='verified') {
      if(!state.manifestHash||!state.verifiedCheckpoint)throw new Error('E2EE_MIGRATION_UNVERIFIED');
      ({state,serial}=await this.#send(state,serial,await this.#packet(state,'migration-commit',{migrationId:state.migrationId,fence:this.#lease(state).fence,
        manifestHash:state.manifestHash,verifiedCheckpoint:state.verifiedCheckpoint,generation:this.#lease(state).generation,objectCount:state.plan.length}),current));
    }
    return state.phase;
  }
  async cancel():Promise<void> {
    return this.#localFence(()=>this.#cancelLocked());
  }
  async #cancelLocked():Promise<void> {
    let {state,serial}=await this.#load();
    if(state.protocol===4)throw new Error('E2EE_STREAMED_PLANNER_REQUIRED');
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
    return this.#localFence(async()=>{const state=await this.status();if(state&&state.protocol>=3)throw new Error('E2EE_STREAMED_SOURCE_REQUIRED');await this.#cancelLocked();await this.#prepareLocked();});
  }
  async restartStaged(capture:StagedMigrationCapture,options:StagedMigrationOptions):Promise<void>{
    const captured={...capture,target:{...capture.target},paths:[...capture.paths]},policy={...options,capacity:{...options.capacity}};
    return this.#localFence(async()=>{await this.#cancelLocked();await this.#prepareStagedLocked(captured,policy);});
  }
}
