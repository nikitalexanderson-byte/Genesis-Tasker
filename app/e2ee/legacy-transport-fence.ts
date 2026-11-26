import {assertTechnical,exactKeys} from './keys.ts';
import type {VerifiedDirectory} from './directory.ts';
import {localMigrationMarker,retainLocalMigrationFence} from './web-local-migration-fence.ts';

export interface WebProductMigrationFence {
  withFence<T>(operation:()=>Promise<T>):Promise<T>;
  token():Promise<string|null>;
  activate(directory:VerifiedDirectory):Promise<void>;
  releaseCancelled(token:string,directory:VerifiedDirectory,currentStatus:()=>Promise<{phase:string;pending:unknown;resuming:unknown}|null>):Promise<void>;
}

export type LegacyTransportMarker = Readonly<{protocol:1;ownerId:string;scopeId:string;phase:'preparing'|'active';token:string}>;
export interface LegacyTransportMarkers {
  get(ownerId:string):Promise<LegacyTransportMarker|null>;
  /** Durable compare-and-set. An active marker can never be changed or deleted. */
  commit(ownerId:string,expected:LegacyTransportMarker|null,next:LegacyTransportMarker|null):Promise<void>;
}
export type LegacyTransportLocks = Pick<LockManager,'request'>;
declare const legacyOperationBrand:unique symbol;
export type LegacyOperationPermit=Readonly<{[legacyOperationBrand]:true}>;
type OperationState={ownerId:string;current:()=>void;open:boolean;pending:Set<Promise<unknown>>};
// Old pages have no authenticated owner binding. This lock is a conservative
// transport DENY boundary only; it cannot grant access to any account's content.
export const LEGACY_UNBOUND_TRANSPORT_LOCK='genesis-e2ee-legacy-transport-v1:unbound';
export function legacyTransportLock(ownerId:string) { assertTechnical(ownerId);return `genesis-e2ee-legacy-transport-v1:${ownerId.length}:${ownerId}`; }

function marker(value:unknown,ownerId:string):LegacyTransportMarker|null {
  if(value===null||value===undefined)return null;
  try {
    exactKeys(value,['protocol','ownerId','scopeId','phase','token']);
    const row=value as LegacyTransportMarker;
    assertTechnical(row.ownerId);assertTechnical(row.scopeId);assertTechnical(row.token);
    if(row.protocol!==1||row.ownerId!==ownerId||!['preparing','active'].includes(row.phase))throw new Error();
    return Object.freeze({...row});
  }catch{throw new Error('E2EE_CORRUPT_LOCAL_FENCE');}
}
const same=(left:LegacyTransportMarker|null,right:LegacyTransportMarker|null)=>left===null?right===null:
  right!==null&&left.ownerId===right.ownerId&&left.scopeId===right.scopeId&&left.phase===right.phase&&left.token===right.token;
export function validateLegacyTransportTransition(ownerId:string,current:LegacyTransportMarker|null,expected:LegacyTransportMarker|null,next:LegacyTransportMarker|null) {
  assertTechnical(ownerId);current=marker(current,ownerId);expected=marker(expected,ownerId);next=marker(next,ownerId);
  if(!same(current,expected))throw new Error('E2EE_LOCAL_CONFLICT');
  if(current?.phase==='active'&&!same(current,next))throw new Error('E2EE_LOCAL_DOWNGRADE_FORBIDDEN');
  if(current&&next&&(current.scopeId!==next.scopeId||current.token!==next.token))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
}

/** Only technical DENY metadata, never vault contents, keys or migration sources.
 * Its separate database is outside all legacy logout/import/cache cleanup paths. */
export class IndexedDbLegacyTransportMarkers implements LegacyTransportMarkers {
  #database:Promise<IDBDatabase>;
  static available() { try{return typeof globalThis.indexedDB?.open==='function';}catch{return false;} }
  constructor(factory:IDBFactory=indexedDB) {
    this.#database=new Promise((resolve,reject)=>{
      const request=factory.open('genesis-e2ee-legacy-transport-v1',1);let failed=false;
      request.onupgradeneeded=()=>{request.result.createObjectStore('scopes');};
      request.onsuccess=()=>{
        const db=request.result;if(failed){db.close();return;}db.onversionchange=()=>db.close();resolve(db);
      };
      request.onerror=request.onblocked=()=>{failed=true;reject(new Error('E2EE_STORAGE_UNAVAILABLE'));};
    });
  }
  async get(ownerId:string) {
    assertTechnical(ownerId);const db=await this.#database;
    return new Promise<LegacyTransportMarker|null>((resolve,reject)=>{
      let value:LegacyTransportMarker|null=null,error:unknown,exists=false;
      const transaction=db.transaction('scopes','readonly'),store=transaction.objectStore('scopes'),count=store.count(ownerId),request=store.get(ownerId);
      count.onsuccess=()=>{exists=count.result>0;};
      request.onsuccess=()=>{try{value=marker(request.result,ownerId);}catch(failure){error=failure;transaction.abort();}};
      transaction.oncomplete=()=>{if(exists&&value===null)reject(new Error('E2EE_CORRUPT_LOCAL_FENCE'));else resolve(value);};
      transaction.onerror=transaction.onabort=()=>reject(error??new Error('E2EE_STORAGE_UNAVAILABLE'));
    });
  }
  async commit(ownerId:string,expected:LegacyTransportMarker|null,next:LegacyTransportMarker|null) {
    assertTechnical(ownerId);expected=marker(expected,ownerId);next=marker(next,ownerId);const db=await this.#database;
    return new Promise<void>((resolve,reject)=>{
      let error:unknown;
      const transaction=db.transaction('scopes','readwrite',{durability:'strict'}),store=transaction.objectStore('scopes'),count=store.count(ownerId),request=store.get(ownerId);
      request.onsuccess=()=>{
        try {
          if(count.result>0&&(request.result===null||request.result===undefined))throw new Error('E2EE_CORRUPT_LOCAL_FENCE');
          const current=marker(request.result,ownerId);validateLegacyTransportTransition(ownerId,current,expected,next);
          if(next===null)store.delete(ownerId);else store.put(next,ownerId);
        }catch(failure){error=failure;transaction.abort();}
      };
      transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(error??new Error('E2EE_STORAGE_UNAVAILABLE'));
    });
  }
  async any() {
    const db=await this.#database;
    return new Promise<boolean>((resolve,reject)=>{
      const transaction=db.transaction('scopes','readonly'),request=transaction.objectStore('scopes').count();let present=false;
      request.onsuccess=()=>{present=request.result>0;};transaction.oncomplete=()=>resolve(present);
      transaction.onerror=transaction.onabort=()=>reject(new Error('E2EE_STORAGE_UNAVAILABLE'));
    });
  }
  async close() { (await this.#database).close(); }
}

/** Application pages and migration controllers share this owner Web Lock through
 * response parsing/cleanup. The controlling SW separately gates unidentified old
 * IO with the global permit; synchronous local writers still need integration. */
export class WebLegacyTransportGate {
  readonly markers:LegacyTransportMarkers;readonly locks:LegacyTransportLocks;
  #operations=new WeakMap<LegacyOperationPermit,OperationState>();
  constructor(markers:LegacyTransportMarkers,locks:LegacyTransportLocks) {
    if(!locks?.request)throw new Error('E2EE_BROWSER_LOCKS_REQUIRED');this.markers=markers;this.locks=locks;
  }
  async request<T>(ownerId:string,assertCurrent:()=>void,operation:()=>Promise<T>,signal?:AbortSignal) {
    return this.locks.request(legacyTransportLock(ownerId),{mode:'shared',...(signal?{signal}:{})},async()=>{
      assertCurrent();if(await this.markers.get(ownerId))throw new Error('E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN');
      assertCurrent();const result=await operation();assertCurrent();return result;
    });
  }
  /** One shared lock covers local encryption, journals, IO and final cleanup.
   * Nested IO borrows this exact live permit instead of queuing behind a waiting
   * exclusive migration lock (which would deadlock its own parent operation). */
  async withOperation<T>(ownerId:string,current:()=>void,operation:(permit:LegacyOperationPermit)=>Promise<T>,signal?:AbortSignal) {
    return this.request(ownerId,current,async()=>{
      const permit=Object.freeze({}) as LegacyOperationPermit;
      const state:OperationState={ownerId,current,open:true,pending:new Set()};this.#operations.set(permit,state);
      try {
        const result=await operation(permit);this.assertOperation(permit,ownerId);
        if(state.pending.size)throw new Error('E2EE_UNAWAITED_LEGACY_OPERATION');
        return result;
      } finally {
        state.open=false;
        // Rejected/unawaited children cannot release the exclusion while an old
        // request is still receiving bytes. Their checks fail before local commit.
        await Promise.allSettled([...state.pending]);this.#operations.delete(permit);
      }
    },signal);
  }
  assertOperation(permit:LegacyOperationPermit,ownerId:string) {
    const state=this.#operations.get(permit);
    if(!state?.open||state.ownerId!==ownerId)throw new Error('E2EE_INVALID_LEGACY_OPERATION');
    state.current();
  }
  async borrow<T>(permit:LegacyOperationPermit,ownerId:string,current:()=>void,operation:()=>Promise<T>) {
    this.assertOperation(permit,ownerId);current();const state=this.#operations.get(permit)!;
    const task=Promise.resolve().then(()=>{this.assertOperation(permit,ownerId);current();return operation();})
      .then(result=>{this.assertOperation(permit,ownerId);current();return result;});
    state.pending.add(task);
    try{return await task;}finally{state.pending.delete(task);}
  }
}

/** Transport half of a migration barrier. Combine with mounted-editor/local
 * writer exclusion before passing it as the coordinator's local-write fence. */
export class WebMigrationTransportFence implements WebProductMigrationFence {
  #gate:WebLegacyTransportGate;#ownerId:string;#scopeId:string;#current:()=>void;#preflight:()=>Promise<void>;#recover:()=>Pick<LegacyTransportMarker,'token'|'phase'>|null;
  constructor(gate:WebLegacyTransportGate,ownerId:string,scopeId:string,assertCurrent:()=>void,preflight:()=>Promise<void>=async()=>{},recover:()=>Pick<LegacyTransportMarker,'token'|'phase'>|null=()=>null) {
    assertTechnical(ownerId);assertTechnical(scopeId);this.#gate=gate;this.#ownerId=ownerId;this.#scopeId=scopeId;this.#current=assertCurrent;this.#preflight=preflight;
    this.#recover=recover;
  }
  #bound(row:LegacyTransportMarker) { if(row.ownerId!==this.#ownerId||row.scopeId!==this.#scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH'); }
  #directory(directory:VerifiedDirectory,state:'preparing'|'active') {
    if(directory.kind!=='personal'||directory.ownerId!==this.#ownerId||directory.resourceId!==this.#ownerId||directory.scopeId!==this.#scopeId||directory.state!==state)
      throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  }
  async withFence<T>(operation:()=>Promise<T>):Promise<T> {
    this.#current();await this.#preflight();this.#current();
    return this.#gate.locks.request(LEGACY_UNBOUND_TRANSPORT_LOCK,{mode:'exclusive'},()=>this.#gate.locks.request(legacyTransportLock(this.#ownerId),{mode:'exclusive'},async()=>{
      this.#current();const row=await this.#gate.markers.get(this.#ownerId);this.#current();
      if(row)this.#bound(row);
      else {
        // Recreate only a DENY row after a crash between transport release and
        // synchronous local-marker cleanup. Reusing this technical token grants
        // no writer, account or crypto authority and never weakens an active row.
        const prior=this.#recover();if(prior){assertTechnical(prior.token);if(!['preparing','active'].includes(prior.phase))throw new Error('E2EE_CORRUPT_LOCAL_FENCE');}
        await this.#gate.markers.commit(this.#ownerId,null,{protocol:1,ownerId:this.#ownerId,scopeId:this.#scopeId,phase:prior?.phase??'preparing',token:prior?.token??crypto.randomUUID()});
      }
      this.#current();const result=await operation();this.#current();return result;
    }));
  }
  async token() { this.#current();const row=await this.#gate.markers.get(this.#ownerId);this.#current();if(row)this.#bound(row);return row?.token??null; }
  async activate(directory:VerifiedDirectory) {
    return this.#gate.locks.request(legacyTransportLock(this.#ownerId),{mode:'exclusive'},async()=>{
      this.#current();this.#directory(directory,'active');const row=await this.#gate.markers.get(this.#ownerId);
      if(!row)throw new Error('E2EE_LOCAL_FENCE_REQUIRED');this.#bound(row);this.#current();
      if(row.phase!=='active')await this.#gate.markers.commit(this.#ownerId,row,{...row,phase:'active'});
      this.#current();
    });
  }
  async releaseCancelled(token:string,directory:VerifiedDirectory,currentStatus:()=>Promise<{phase:string;pending:unknown;resuming:unknown}|null>) {
    return this.#gate.locks.request(legacyTransportLock(this.#ownerId),{mode:'exclusive'},async()=>{
      this.#current();this.#directory(directory,'preparing');const row=await this.#gate.markers.get(this.#ownerId);
      if(!row)throw new Error('E2EE_LOCAL_FENCE_REQUIRED');this.#bound(row);
      if(row.phase!=='preparing'||row.token!==token)throw new Error('E2EE_LOCAL_DOWNGRADE_FORBIDDEN');
      const status=await currentStatus();this.#current();
      if(status?.phase!=='cancelled'||status.pending!==null||status.resuming!==null)throw new Error('E2EE_LOCAL_DOWNGRADE_FORBIDDEN');
      await this.#gate.markers.commit(this.#ownerId,row,null);this.#current();
    });
  }
}

/** A shared transition borrows the already irreversible PERSONAL barrier.
 * Neither activating nor cancelling a child may rewrite its scope/token or
 * reopen account-wide local/legacy writers. A new/recovered device may install
 * that same active deny boundary from the freshly verified personal directory. */
export class WebSharedMigrationTransportFence implements WebProductMigrationFence {
  readonly #target:Readonly<{scopeId:string;kind:'space'|'project';resourceId:string}>;
  constructor(private readonly gate:WebLegacyTransportGate,private readonly ownerId:string,private readonly personalScopeId:string,
    target:{scopeId:string;kind:'space'|'project';resourceId:string},private readonly current:()=>void,
    private readonly personal:()=>Promise<VerifiedDirectory>,private readonly preflight:()=>Promise<void>){
    for(const id of [ownerId,personalScopeId,target.scopeId,target.resourceId])assertTechnical(id);
    if(!['space','project'].includes(target.kind)||target.scopeId===personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    this.#target=Object.freeze({...target});
  }
  async #active(adopt=false){
    this.current();const directory=await this.personal();this.current();
    if(directory.ownerId!==this.ownerId||directory.scopeId!==this.personalScopeId||directory.kind!=='personal'
      ||directory.resourceId!==this.ownerId||directory.state!=='active')throw new Error('E2EE_PERSONAL_SCOPE_REQUIRED');
    let row=await this.gate.markers.get(this.ownerId);this.current();const local=localMigrationMarker(this.ownerId);
    if(adopt){
      if(row&&row.scopeId!==this.personalScopeId||local&&local.scopeId!==this.personalScopeId||row&&local&&row.token!==local.token)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
      if(!row){const active:LegacyTransportMarker={protocol:1,ownerId:this.ownerId,scopeId:this.personalScopeId,phase:'active',token:local?.token??crypto.randomUUID()};
        await this.gate.markers.commit(this.ownerId,null,active);row=active;
      }else if(row.phase!=='active'){const active:LegacyTransportMarker={...row,phase:'active'};await this.gate.markers.commit(this.ownerId,row,active);row=active;}
      this.current();retainLocalMigrationFence(this.ownerId,this.personalScopeId,row.token,'active');
    }
    const confirmed=localMigrationMarker(this.ownerId);
    if(!row||!confirmed||row.ownerId!==this.ownerId||row.scopeId!==this.personalScopeId||row.phase!=='active'
      ||confirmed.scopeId!==row.scopeId||confirmed.phase!=='active'||confirmed.token!==row.token)throw new Error('E2EE_LOCAL_FENCE_REQUIRED');
    return row;
  }
  #directory(directory:VerifiedDirectory,state:'preparing'|'active'){
    if(directory.ownerId!==this.ownerId||directory.scopeId!==this.#target.scopeId||directory.kind!==this.#target.kind
      ||directory.resourceId!==this.#target.resourceId||directory.state!==state)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  }
  async withFence<T>(operation:()=>Promise<T>):Promise<T>{
    this.current();await this.preflight();this.current();
    return this.gate.locks.request(LEGACY_UNBOUND_TRANSPORT_LOCK,{mode:'exclusive'},()=>this.gate.locks.request(legacyTransportLock(this.ownerId),{mode:'exclusive'},async()=>{
      await this.#active(true);const result=await operation();this.current();await this.#active();return result;
    }));
  }
  async token(){return(await this.#active()).token;}
  async activate(directory:VerifiedDirectory){
    await this.gate.locks.request(legacyTransportLock(this.ownerId),{mode:'exclusive'},async()=>{this.current();this.#directory(directory,'active');await this.#active(true);});
  }
  async releaseCancelled(token:string,directory:VerifiedDirectory,currentStatus:()=>Promise<{phase:string;pending:unknown;resuming:unknown}|null>){
    await this.gate.locks.request(legacyTransportLock(this.ownerId),{mode:'exclusive'},async()=>{
      this.current();this.#directory(directory,'preparing');const row=await this.#active();
      if(row.token!==token)throw new Error('E2EE_LOCAL_DOWNGRADE_FORBIDDEN');const status=await currentStatus();this.current();
      if(status?.phase!=='cancelled'||status.pending!==null||status.resuming!==null)throw new Error('E2EE_LOCAL_DOWNGRADE_FORBIDDEN');
      await this.#active();
    });
  }
}
