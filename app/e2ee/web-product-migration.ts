import {REMOTE_ORIGINAL_READ_CAPACITY} from './remote-original.ts';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage,bindWebVaultLifecycle} from './device-vault.ts';
import {IndexedDbE2eeStorage} from './storage.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {E2eeScopeSetup,verifyScopeRecovery,type ScopeSetupTransport} from './scope-setup.ts';
import {validatePrivateAccountStatus,type PrivateAccountTransport,type WebPrivateAccount} from './product-session.ts';
import {assertTechnical,exactKeys,openRoot,publicDeviceKeys,type RecoveryKit} from './keys.ts';
import {snapshotE2eeValue} from './commands.ts';
import {E2eeMigration,E2EE_MIGRATION_BYTE_BUDGET,type StreamedPlanningOptions,type StreamedContentPlanningOptions} from './migration.ts';
import {MigrationSourceReadRouter,type LegacyReadPorts} from './source-replay.ts';
import {SignedMigrationTransport,type E2eeMigrationRequest} from './migration-transport.ts';
import {migratePrivateProductScope} from './product-migration.ts';
import {requireExclusiveMigrationWindow} from './legacy-worker-client.ts';
import {retainLocalMigrationFence,releaseCancelledLocalMigrationFence,localMigrationMarker} from './web-local-migration-fence.ts';
import {measureE2eeDeviceStorage} from './storage-admission.ts';
import {admitE2eeStorage,E2EE_PROVIDER_STORAGE_BUDGET} from './storage-capacity.ts';
import type {VerifiedDirectory} from './directory.ts';
import type {E2eeMigrationSources} from './migration-sources.ts';
import type {WebProductMigrationFence} from './legacy-transport-fence.ts';

type Target={ownerId:string;scopeId:string;kind:'personal'|'space'|'project';resourceId:string};
export type WebSharedMigrationTarget=Pick<Target,'scopeId'|'resourceId'>&{kind:'space'|'project'};
type Intent={protocol:1;target:Target;sourceGeneration:number};
type Progress='snapshot'|'sources'|'reconciliation'|'uploading'|'active';
export type WebProductMigrationPorts={
 account:PrivateAccountTransport;setup:ScopeSetupTransport;request:E2eeMigrationRequest;
 sources:(device:UnlockedWebDevice,directory:VerifiedDirectory,ports:LegacyReadPorts)=>Promise<E2eeMigrationSources>;
 fence:(device:UnlockedWebDevice,directory:VerifiedDirectory)=>WebProductMigrationFence;
 assertCurrent:()=>void;assertEditorsFrozen:()=>void;
};
/** Real owner/device composition. Recovery material is supplied again for each
 * operation and erased from working byte buffers; the controller stores none.
 * It never enables pilot/cutover, changes update floors or erases old sources. */
export class WebProductMigration{
 readonly target:Readonly<Target>;
 #closed=false;#running=false;#cleanup:()=>void;
 #operation:{abort:AbortController;drained:Promise<void>}|null=null;
 private constructor(readonly device:UnlockedWebDevice,private directory:VerifiedDirectory,private readonly ports:WebProductMigrationPorts,ownsDevice=true){
  this.target=Object.freeze({ownerId:directory.ownerId,scopeId:directory.scopeId,kind:directory.kind,resourceId:directory.resourceId});
  this.#cleanup=ownsDevice?bindWebVaultLifecycle(device):()=>{};
 }
 /** Attach an owner transition to the live private account, without unlocking a
  * second device or taking ownership of the account's key-vault lifecycle. The
  * HTTP summary locates the scope; only its independently pinned directory can
  * authorize migration, and recovery is checked again by each run/cancel. */
 static async attach(account:WebPrivateAccount,target:WebSharedMigrationTarget,ports:WebProductMigrationPorts){
  const binding=Object.freeze({...target}),device=account.device;
  for(const id of [binding.scopeId,binding.resourceId])assertTechnical(id);
  if(!['space','project'].includes(binding.kind))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const current=()=>{ports.assertCurrent();ports.assertEditorsFrozen();account.requireOpen();
   if(account.mode!=='online'||account.ownerId!==device.ownerId)throw new Error('E2EE_ONLINE_REQUIRED');account.personal();};
  current();await requireExclusiveMigrationWindow();current();
  const status=validatePrivateAccountStatus(await ports.account.status());current();
  if(status.scopes.filter(row=>row.scopeId===binding.scopeId&&row.kind===binding.kind&&row.resourceId===binding.resourceId).length!==1)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const response=await ports.setup.directory(binding.scopeId);current();
  const directory=await device.rememberDirectory(binding.scopeId,device.authorityPin,response.events,account.ownerId);current();
  if(directory.kind!==binding.kind||directory.resourceId!==binding.resourceId||directory.ownerId!==account.ownerId
    ||!['preparing','uploading','verified','active'].includes(directory.state))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const own=directory.devices.get(device.deviceId),keys=await publicDeviceKeys(device.keys());current();
  if(!own||own.revoked||own.userId!==account.ownerId||own.role!=='owner'||own.signingKey!==keys.signingKey||own.receivingKey!==keys.receivingKey)throw new Error('E2EE_OWNER_REQUIRED');
  return new WebProductMigration(device,directory,{...ports,assertCurrent:current},false);
 }
 static async open(ownerId:string,secret:Uint8Array,savedKit:RecoveryKit,sourceGeneration:number,ports:WebProductMigrationPorts){
  assertTechnical(ownerId);const held=new Uint8Array(secret);
  const current=()=>{ports.assertCurrent();ports.assertEditorsFrozen();};let device:UnlockedWebDevice|undefined;
  try{
   const kit=snapshotE2eeValue(savedKit);
   current();await requireExclusiveMigrationWindow();current();
   const status=validatePrivateAccountStatus(await ports.account.status());current();
   const personal=status.scopes.filter(row=>row.kind==='personal'&&row.resourceId===ownerId);
   if(personal.length>1||!personal.length&&!status.pilotAllowed)throw new Error('E2EE_PILOT_DISABLED');
   const keys=new IndexedDbDeviceKeyStorage(),record=await keys.get(ownerId);current();
   if(!record&&personal.length)throw new Error('E2EE_ORIGINAL_MIGRATION_DEVICE_REQUIRED');
   device=record?await UnlockedWebDevice.unlock(ownerId,held,new IndexedDbE2eeStorage(),keys)
     :await UnlockedWebDevice.provision(ownerId,held,kit,new IndexedDbE2eeStorage(),keys);current();
   const activeDevice=device,check=()=>{current();activeDevice.requireOpen();};
   const store=new E2eeDeviceDocument<Intent>(device,'product-migration-setup-v1',input=>{
    exactKeys(input,['protocol','target','sourceGeneration']);exactKeys(input.target,['ownerId','scopeId','kind','resourceId']);
    if(input.protocol!==1||input.target.ownerId!==ownerId||input.target.kind!=='personal'||input.target.resourceId!==ownerId
      ||!Number.isSafeInteger(input.sourceGeneration)||(input.sourceGeneration as number)<0||(input.sourceGeneration as number)>=Number.MAX_SAFE_INTEGER)throw new Error('E2EE_SCOPE_SETUP_INVALID');
    assertTechnical(input.target.scopeId);return input as Intent;
   },check);
   let intent=await store.load();check();
   if(!intent){
    if(personal.length||!status.pilotAllowed)throw new Error('E2EE_ORIGINAL_MIGRATION_DEVICE_REQUIRED');
    if(!Number.isSafeInteger(sourceGeneration)||sourceGeneration<0||sourceGeneration>=Number.MAX_SAFE_INTEGER)throw new Error('E2EE_INVALID_GENERATION');
    const value:Intent={protocol:1,target:{ownerId,scopeId:`personal:${crypto.randomUUID()}`,kind:'personal',resourceId:ownerId},sourceGeneration};
    await store.save(value,null);check();intent=await store.load();if(!intent)throw new Error('E2EE_SCOPE_SETUP_UNVERIFIED');
   }
   if(personal.length&&personal[0].scopeId!==intent.value.target.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   await device.preserveOriginalSources(held,kit,check);check();
   const setup=new E2eeScopeSetup(device,intent.value.target,ports.setup,check);
   await setup.prepare(held,kit,intent.value.sourceGeneration);check();const directory=await setup.submit();check();
   return new WebProductMigration(device,directory,ports);
  }catch(error){device?.lock();throw error;}finally{held.fill(0);}
 }
 #current(){if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');this.device.requireOpen();this.ports.assertCurrent();this.ports.assertEditorsFrozen();}
 close(){if(this.#closed)return;this.#closed=true;this.#operation?.abort.abort();this.#cleanup();}
 /** Wait for source observers and local fences to drain before another attempt.
  * A pause keeps the durable signed request for exact replay; it does not cancel
  * the remote migration or grant permission to reopen legacy writers. */
 async stop(){const operation=this.#operation;if(!operation)return;operation.abort.abort();await operation.drained;}
 async run(secret:Uint8Array,savedKit:RecoveryKit,progress?:(phase:Progress)=>void){return this.#execute(secret,savedKit,progress,false);}
 async cancel(secret:Uint8Array,savedKit:RecoveryKit){return this.#execute(secret,savedKit,undefined,true);}
 async #execute(secret:Uint8Array,savedKit:RecoveryKit,progress:((phase:Progress)=>void)|undefined,cancelling:boolean){
  const held=new Uint8Array(secret),abort=new AbortController();
  const current=()=>{this.#current();if(abort.signal.aborted)throw new Error('E2EE_OPERATION_STOPPED');};
  if(this.#running){held.fill(0);throw new Error('E2EE_MIGRATION_BUSY');}this.#running=true;
  let drained!:()=>void;const operation={abort,drained:new Promise<void>(resolve=>{drained=resolve;})};this.#operation=operation;
  try{
   const kit=snapshotE2eeValue(savedKit);
   current();const directory=structuredClone(this.directory),router=new MigrationSourceReadRouter();
   const sources=await this.ports.sources(this.device,directory,router.port);current();
   const own=directory.devices.get(this.device.deviceId);if(!own||own.revoked||own.userId!==this.device.ownerId||own.role!=='owner')throw new Error('E2EE_REVOKED_DEVICE');
   const root=await openRoot(own.capsule,this.device.keys().receiving.privateKey,{ownerId:directory.ownerId,scopeId:directory.scopeId,
    cryptoEpoch:directory.cryptoEpoch,keyId:directory.keyId,recipientId:this.device.deviceId});current();
   await verifyScopeRecovery(this.device,directory,root,held,kit,current);current();
   const fence=this.ports.fence(this.device,directory),request:E2eeMigrationRequest=async(path,body,observation,signal)=>{
    current();if(path==='/command'&&(body as {command?:{action?:string}})?.command?.action==='migration-commit')await requireExclusiveMigrationWindow();current();
    const linked=new AbortController(),stop=()=>linked.abort();
    abort.signal.addEventListener('abort',stop,{once:true});signal?.addEventListener('abort',stop,{once:true});
    try{if(abort.signal.aborted||signal?.aborted)stop();current();const result=await this.ports.request(path,body,observation,linked.signal);current();return result;}
    finally{abort.signal.removeEventListener('abort',stop);signal?.removeEventListener('abort',stop);}
   };
   const transport=new SignedMigrationTransport(this.device,directory,sources.allowedContentDomains,request);
   const withFence=<T>(operation:()=>Promise<T>)=>fence.withFence(async()=>{
    current();await requireExclusiveMigrationWindow();current();const token=await fence.token();current();if(!token)throw new Error('E2EE_LOCAL_FENCE_REQUIRED');
    if(this.target.kind==='personal'){
     const prior=localMigrationMarker(this.target.ownerId);
     retainLocalMigrationFence(this.target.ownerId,this.target.scopeId,token,directory.state==='active'||prior?.phase==='active'?'active':'preparing');
    }current();return operation();
   });
   const migration=new E2eeMigration({vault:this.device.vault,directory,deviceId:this.device.deviceId,signingKey:this.device.keys().signing.privateKey,
    signer:this.device.keys().signing.publicKey,root,transport,sources,withLocalWriteFence:withFence,
    ensureDurableKeys:async()=>{current();await this.device.ensureDurableKeys();current();},
    verifyRecovery:recoveryRoot=>verifyScopeRecovery(this.device,directory,recoveryRoot,held,kit,current)});
   const admit=async()=>{current();const usage=await measureE2eeDeviceStorage(this.device,current);current();
    // Every actual IDB write additionally admits its exact serialized growth.
    admitE2eeStorage(usage,{records:0,keyRecords:0,writeBytes:0,rewriteBytes:0},E2EE_PROVIDER_STORAGE_BUDGET);
   };
   const planning:StreamedPlanningOptions={device:this.device,assertCurrent:current,admit,
    capacity:{maximumBytes:E2EE_MIGRATION_BYTE_BUDGET,maximumParts:10000,maximumMetadataBytes:128*1024*1024},
    originalCapacity:REMOTE_ORIGINAL_READ_CAPACITY};
   if(cancelling){
    await migration.cancelStreamed(planning);current();
    const response=await this.ports.setup.directory(this.target.scopeId);current();
    const cancelled=await this.device.rememberDirectory(this.target.scopeId,this.device.authorityPin,response.events,this.target.ownerId);current();
    if(cancelled.state!=='preparing'||cancelled.kind!==this.target.kind||cancelled.resourceId!==this.target.resourceId)throw new Error('E2EE_DOWNGRADE_FORBIDDEN');
    const token=await fence.token();current();if(!token)throw new Error('E2EE_LOCAL_FENCE_REQUIRED');
    await fence.releaseCancelled(token,cancelled,()=>migration.status());current();
    if(this.target.kind==='personal')releaseCancelledLocalMigrationFence(this.target.ownerId,this.target.scopeId,token);current();this.directory=cancelled;return;
   }
   const content:StreamedContentPlanningOptions={...planning,planCapacity:{maximumBytes:E2EE_MIGRATION_BYTE_BUDGET,maximumEnvelopes:8000,maximumLocalParts:8000},admitPlan:admit};
   await migratePrivateProductScope({target:this.target,migration,sources,router,assertCurrent:current,planning,content,
    staged:{capacity:{maximumBytes:E2EE_MIGRATION_BYTE_BUDGET,maximumParts:10000},admit,assertCurrent:current},
    network:session=>new SignedMigrationTransport(this.device,directory,sources.allowedContentDomains,request,session),progress,
    finalizeClientDeny:async()=>{
     current();const response=await this.ports.setup.directory(this.target.scopeId);current();
     const active=await this.device.rememberDirectory(this.target.scopeId,this.device.authorityPin,response.events,this.target.ownerId);current();
     if(active.state!=='active'||active.kind!==this.target.kind||active.resourceId!==this.target.resourceId)throw new Error('E2EE_MIGRATION_UNVERIFIED');
     await fence.activate(active);current();const token=await fence.token();if(!token)throw new Error('E2EE_LOCAL_FENCE_REQUIRED');
     if(this.target.kind==='personal')retainLocalMigrationFence(this.target.ownerId,this.target.scopeId,token,'active');this.directory=active;
    }});current();
  }finally{held.fill(0);this.#running=false;if(this.#operation===operation)this.#operation=null;drained();}
 }
}
