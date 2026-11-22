import {assertTechnical,exactKeys,freshSecret,publicDeviceKeys,recoverAuthority,sealRoot,openRoot,type RecoveryKit} from './keys.ts';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash,snapshotE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {signingPublicKey,verifyDeviceDirectory,type VerifiedDirectory} from './directory.ts';
import {samePrivateJson} from './product-json.ts';
import type {UnlockedWebDevice} from './device-vault.ts';
import type {PrivateScopeKind} from './private-paths.ts';
import {E2EE_SUITE,sealE2eeEnvelope,openE2eeEnvelope,type E2eeContext} from './envelope.ts';

type Target={ownerId:string;scopeId:string;kind:PrivateScopeKind;resourceId:string};
type Plan={protocol:1;target:Target;packet:SignedE2eeCommand;complete:boolean};
export interface ScopeSetupTransport{bootstrap:(packet:SignedE2eeCommand)=>Promise<unknown>;directory:(scopeId:string)=>Promise<{events:SignedE2eeCommand[]}>}
/** Initial scopes are explicit owner operations, separate from identity and
 * from the later all-path migration. An immutable signed packet precedes IO;
 * neither an HTTP retry nor a lost receipt can replace its independent root. */
export class E2eeScopeSetup{
 #serial:Promise<unknown>=Promise.resolve();
 readonly target:Target;
 constructor(private readonly device:UnlockedWebDevice,target:Target,private readonly transport:ScopeSetupTransport,private readonly current:()=>void){
  this.target=Object.freeze({...target});
  for(const id of [target.ownerId,target.scopeId,target.resourceId])assertTechnical(id);if(target.ownerId!==device.ownerId||!['personal','project','space'].includes(target.kind)||target.kind==='personal'&&target.resourceId!==target.ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 }
 #check(){this.device.requireOpen();this.current();}
 #run<T>(run:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.#check();return run();});this.#serial=task;return task;}
 #store(){return new E2eeDeviceDocument<Plan>(this.device,`scope-bootstrap:${this.target.scopeId}`,input=>{
  exactKeys(input,['protocol','target','packet','complete']);if(input.protocol!==1||!samePrivateJson(input.target,this.target)||typeof input.complete!=='boolean')throw new Error('E2EE_SCOPE_SETUP_INVALID');return input as Plan;
 },()=>this.#check());}
 async #verify(packet:SignedE2eeCommand){
  const command=await verifyE2eeCommand(packet,await signingPublicKey(this.device.authorityPin.signingKey));this.#check();const payload=command.payload;
  if(command.action!=='bootstrap'||command.ownerId!==this.target.ownerId||command.scopeId!==this.target.scopeId||command.deviceId!==this.device.deviceId||command.expectedRevision!==0||command.checkpointHash!=='genesis'||command.securityEpoch!==1||payload.kind!==this.target.kind||payload.resourceId!==this.target.resourceId)throw new Error('E2EE_SCOPE_SETUP_INVALID');
  if(!samePrivateJson(payload.deviceKeys,await publicDeviceKeys(this.device.keys()))||!samePrivateJson((payload.recoveryKit as unknown as RecoveryKit).authority,this.device.authorityPin))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const self={...command,payload:{...command.payload}};delete self.payload.selfProof;await verifyE2eeCommand({command:self,signature:String(payload.selfProof)},this.device.keys().signing.publicKey);this.#check();return command;
 }
 prepare(secret:Uint8Array,savedKit:RecoveryKit,sourceGeneration:number){const held=new Uint8Array(secret);let kit:RecoveryKit;
  try{kit=snapshotE2eeValue(savedKit);}catch(error){held.fill(0);throw error;}return this.#run(async()=>{
  try{const authority=await recoverAuthority(this.target.ownerId,held,kit);this.#check();if(!samePrivateJson(kit.authority,this.device.authorityPin))throw new Error('E2EE_AUTHORITY_CHANGED');
   const store=this.#store(),prior=await store.load();this.#check();if(prior){await this.#verify(prior.value.packet);if(!samePrivateJson(prior.value.packet.command.payload.recoveryKit,kit))throw new Error('E2EE_AUTHORITY_CHANGED');return snapshotE2eeValue(prior.value.packet);}
   if(!Number.isSafeInteger(sourceGeneration)||sourceGeneration<0||sourceGeneration>=Number.MAX_SAFE_INTEGER)throw new Error('E2EE_INVALID_GENERATION');
   await this.device.ensureDurableKeys();this.#check();const raw=freshSecret();try{
    const keys=await publicDeviceKeys(this.device.keys()),keyId=`root:${crypto.randomUUID()}`,recipient={ownerId:this.target.ownerId,scopeId:this.target.scopeId,cryptoEpoch:1,keyId,recipientId:this.device.deviceId};
    const payload:Record<string,WireValue>={kind:this.target.kind,resourceId:this.target.resourceId,keyId,generation:sourceGeneration+1,recoveryKit:kit as unknown as WireValue,deviceKeys:keys as unknown as WireValue,
     deviceCapsule:await sealRoot(raw,keys.receivingKey,recipient) as unknown as WireValue,recoveryCapsule:await sealRoot(raw,kit.authority.receivingKey,{...recipient,recipientId:'recovery'}) as unknown as WireValue};this.#check();
    const command={protocol:1 as const,ownerId:this.target.ownerId,scopeId:this.target.scopeId,deviceId:this.device.deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload};
    payload.selfProof=(await signE2eeCommand(command,this.device.keys().signing.privateKey)).signature;this.#check();const packet=await signE2eeCommand(command,authority.signing.privateKey);await this.#verify(packet);
    const plan:Plan={protocol:1,target:structuredClone(this.target),packet,complete:false};await store.save(plan,null);this.#check();const verified=await store.load();if(!verified||!samePrivateJson(verified.value,plan))throw new Error('E2EE_SCOPE_SETUP_UNVERIFIED');return snapshotE2eeValue(packet);
   }finally{raw.fill(0);}
  }finally{held.fill(0);}
 }).finally(()=>held.fill(0));}
 submit(){return this.#run(async()=>{
  const store=this.#store(),saved=await store.load();this.#check();if(!saved)throw new Error('E2EE_SCOPE_SETUP_REQUIRED');await this.#verify(saved.value.packet);let failure:unknown;
  if(!saved.value.complete)try{await this.transport.bootstrap(snapshotE2eeValue(saved.value.packet));}catch(error){failure=error;}this.#check();
  let response;try{response=await this.transport.directory(this.target.scopeId);}catch(error){throw failure??error;}this.#check();
  const directory=await verifyDeviceDirectory(this.target.ownerId,this.target.scopeId,this.device.authorityPin,response.events);this.#check();
  if(!response.events.length||await e2eeCommandHash(response.events[0].command)!==await e2eeCommandHash(saved.value.packet.command)||directory.kind!==this.target.kind||directory.resourceId!==this.target.resourceId)throw new Error('E2EE_SCOPE_SETUP_UNVERIFIED');
  const own=directory.devices.get(this.device.deviceId);if(!own||own.revoked||own.userId!==this.target.ownerId||own.role!=='owner')throw new Error('E2EE_REVOKED_DEVICE');
  await this.device.rememberDirectory(this.target.scopeId,this.device.authorityPin,response.events,this.target.ownerId);this.#check();if(!saved.value.complete)await store.save({...saved.value,complete:true},saved.serial);this.#check();return directory;
 });}
}

/** Recovery proof uses independently supplied kit/secret, rather than the
 * original creation object or a successful-download checkbox. The root is
 * returned as an opaque CryptoKey only for the migration's local verification. */
export async function recoverScopeRoot(directory:VerifiedDirectory,secret:Uint8Array,kit:RecoveryKit,current:()=>void){
 const held=new Uint8Array(secret);try{current();const authority=await recoverAuthority(directory.ownerId,held,kit);current();if(!samePrivateJson(kit.authority,directory.recoveryKit.authority))throw new Error('E2EE_AUTHORITY_CHANGED');
  const root=await openRoot(directory.recoveryCapsule,authority.receiving.privateKey,{ownerId:directory.ownerId,scopeId:directory.scopeId,cryptoEpoch:directory.cryptoEpoch,keyId:directory.keyId,recipientId:'recovery'});current();return root;
 }finally{held.fill(0);}
}
/** A recovery checkbox is insufficient. Independently re-entered material must
 * open an actual AEAD object sealed by the exact root about to be activated. */
export async function verifyScopeRecovery(device:UnlockedWebDevice,directory:VerifiedDirectory,root:CryptoKey,secret:Uint8Array,kit:RecoveryKit,current:()=>void){
 const probe=freshSecret();let opened:Uint8Array|undefined;
 try{
  device.requireOpen();current();const recoveryRoot=await recoverScopeRoot(directory,secret,kit,current);device.requireOpen();current();
  const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:directory.ownerId,scopeId:directory.scopeId,domain:'key-check',
   objectId:`recovery-probe:${crypto.randomUUID()}`,schemaVersion:1,dataGeneration:directory.generation,writerProtocol:9,
   cryptoEpoch:directory.cryptoEpoch,securityEpoch:directory.securityEpoch,revision:1,keyId:directory.keyId,deviceId:device.deviceId,operationId:crypto.randomUUID()};
  const envelope=await sealE2eeEnvelope(root,device.keys().signing.privateKey,context,probe);device.requireOpen();current();
  opened=await openE2eeEnvelope(recoveryRoot,device.keys().signing.publicKey,context,envelope);device.requireOpen();current();
  if(opened.length!==probe.length||opened.some((byte,index)=>byte!==probe[index]))throw new Error('E2EE_RECOVERY_UNVERIFIED');
 }finally{probe.fill(0);opened?.fill(0);}
}
