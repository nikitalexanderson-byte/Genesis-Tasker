import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from './device-vault.ts';
import {IndexedDbE2eeStorage} from './storage.ts';
import {E2eeScopeClient,type ScopeTransport} from './scope-client.ts';
import {assertTechnical,exactKeys,recoverAuthority,publicDeviceKeys,forwardRoot,type RecoveryKit} from './keys.ts';
import {canonicalE2eeValue,signE2eeCommand,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {verifyDeviceDirectory,type VerifiedDirectory} from './directory.ts';
import {encodeE2eeBytes,decodeE2eeBytes} from './envelope.ts';

export type PrivateScopeSummary={scopeId:string;kind:'personal'|'project'|'space';resourceId:string;state:'preparing'|'uploading'|'verified'|'active'|'retirement'};
export type PrivateAccountStatus={pilotAllowed:boolean;cryptoProtocol:1;scopes:PrivateScopeSummary[]};
export type PrivateAccountTransport=ScopeTransport&{
 status:()=>Promise<unknown>;
 challenge:(scopeId:string,deviceId:string,keys:Awaited<ReturnType<typeof publicDeviceKeys>>)=>Promise<Record<string,WireValue>>;
};
export type PrivateAccountView=Readonly<{ownerId:string|null;phase:'closed'|'locked'|'unlocking'|'ready';reason:'unlock'|'recovery';language:string}>;
const listeners=new Set<()=>void>(),waiters=new Set<{ownerId:string;resolve:()=>void;reject:(error:Error)=>void}>();
let view:PrivateAccountView=Object.freeze({ownerId:null,phase:'closed',reason:'unlock',language:'en'}),active:WebPrivateAccount|null=null;
const notify=()=>{for(const listener of listeners)listener();};
export const privateAccountView=()=>view;
export const subscribePrivateAccount=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function privateAccountRequired(ownerId:string,language='en'){
 assertTechnical(ownerId);if(active?.ownerId===ownerId){try{active.requireOpen();return;}catch{/* Locked capabilities are retired below. */}}
 if(view.ownerId!==null&&view.ownerId!==ownerId)closePrivateAccount();
 view=Object.freeze({ownerId,phase:'locked',reason:view.ownerId===ownerId?view.reason:'unlock',language});notify();
}
export function requirePrivateAccount(ownerId:string):WebPrivateAccount{
 if(!active||active.ownerId!==ownerId){privateAccountRequired(ownerId);throw new Error('E2EE_UNLOCK_REQUIRED');}
 active.requireOpen();return active;
}
export async function waitForPrivateAccount(ownerId:string,language='en',signal?:AbortSignal){
 privateAccountRequired(ownerId,language);if(active?.ownerId===ownerId&&view.phase==='ready')return;
 await new Promise<void>((resolve,reject)=>{
  const abort=()=>{waiters.delete(waiter);reject(new DOMException('Account unlock cancelled','AbortError'));};
  const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
  const fail=(error:Error)=>{signal?.removeEventListener('abort',abort);reject(error);};
  const waiter={ownerId,resolve:finish,reject:fail};waiters.add(waiter);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 });
}
export function closePrivateAccount(){
 const old=active;active=null;old?.close();
 view=Object.freeze({ownerId:null,phase:'closed',reason:'unlock',language:'en'});
 for(const waiter of waiters)waiter.reject(new Error('E2EE_ACCOUNT_CHANGED'));waiters.clear();notify();
}
function validateStatus(input:unknown):PrivateAccountStatus{
 exactKeys(input,['pilotAllowed','cryptoProtocol','scopes']);if(typeof input.pilotAllowed!=='boolean'||input.cryptoProtocol!==1||!Array.isArray(input.scopes)||input.scopes.length>4096)throw new Error('E2EE_INVALID_RESPONSE');
 const seen=new Set<string>();for(const scope of input.scopes){exactKeys(scope,['scopeId','kind','resourceId','state']);assertTechnical(scope.scopeId);assertTechnical(scope.resourceId);
  if(!['personal','project','space'].includes(String(scope.kind))||!['preparing','uploading','verified','active','retirement'].includes(String(scope.state))||seen.has(scope.scopeId))throw new Error('E2EE_INVALID_RESPONSE');seen.add(scope.scopeId);
 }return input as PrivateAccountStatus;
}
/** Identity establishes the HTTP session. This capability additionally requires
 * independently entered recovery material or the durable device bundle, and
 * verifies the complete signed directory before opening any product object. */
export class WebPrivateAccount{
 readonly ownerId:string;readonly device:UnlockedWebDevice;
 #transport:PrivateAccountTransport;#current:()=>void;#closed=false;
 #clients=new Map<string,{client:E2eeScopeClient;directory:VerifiedDirectory}>();#cleanup:(()=>void)|null=null;
 private constructor(ownerId:string,device:UnlockedWebDevice,transport:PrivateAccountTransport,current:()=>void){
  this.ownerId=ownerId;this.device=device;this.#transport=transport;this.#current=current;
 }
 static async open(ownerId:string,secret:Uint8Array,transport:PrivateAccountTransport,current:()=>void,recoveryKit?:RecoveryKit){
  assertTechnical(ownerId);if(secret.length!==32)throw new Error('E2EE_UNLOCK_REQUIRED');const held=new Uint8Array(secret),storage=new IndexedDbE2eeStorage(),keys=new IndexedDbDeviceKeyStorage();
  let device:UnlockedWebDevice|undefined,account:WebPrivateAccount|undefined;
  try{
   current();const status=validateStatus(await transport.status());current();
   const personal=status.scopes.filter(scope=>scope.kind==='personal'&&scope.resourceId===ownerId);if(personal.length!==1)throw new Error('E2EE_PERSONAL_SCOPE_REQUIRED');
   const record=await keys.get(ownerId);current();
   if(record)device=await UnlockedWebDevice.unlock(ownerId,held,storage,keys);
   else{
    if(!recoveryKit)throw new Error('E2EE_RECOVERY_KIT_REQUIRED');
    // Pin comes from the user's saved kit. The server's kit is never a trust anchor.
    await recoverAuthority(ownerId,held,recoveryKit);current();
    device=await UnlockedWebDevice.provision(ownerId,held,recoveryKit,storage,keys);
   }
   current();account=new WebPrivateAccount(ownerId,device,transport,current);
   if(!record)await account.#recoverEnrollment(personal[0].scopeId,held,recoveryKit!);
   else if(recoveryKit){
    // A previous enrollment may have died after provisioning. Retrying uses
    // its durable packet, not a new identity or a replacement local root.
    const saved=await device.savedDirectory(personal[0].scopeId);current();
    if(!saved)await account.#recoverEnrollment(personal[0].scopeId,held,recoveryKit);
   }
   const personalClient=await account.openScope(personal[0],device.authorityPin,ownerId);current();
   if(personalClient.directory.state!=='active')throw new Error('E2EE_MIGRATION_RESUME_REQUIRED');
   return account;
  }catch(error){account?.close();device?.lock();throw error;}finally{held.fill(0);}
 }
 requireOpen(){if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');this.#current();this.device.requireOpen();}
 close(){if(this.#closed)return;this.#closed=true;this.#cleanup?.();this.#cleanup=null;this.#clients.clear();this.device.lock();}
 bindLifecycle(target:Window=window){
  this.requireOpen();const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(`genesis-e2ee-lock:${this.ownerId}`);
  const lock=()=>{if(this.#closed)return;this.close();if(active===this){active=null;view=Object.freeze({...view,phase:'locked'});notify();}};
  const hidden=()=>{if(target.document.visibilityState!=='visible'){channel?.postMessage({locked:true});lock();}};
  if(channel)channel.onmessage=lock;
  target.addEventListener('pagehide',lock);target.addEventListener('genesis-local-session-ended',lock);target.document.addEventListener('visibilitychange',hidden);
  this.#cleanup=()=>{target.removeEventListener('pagehide',lock);target.removeEventListener('genesis-local-session-ended',lock);target.document.removeEventListener('visibilitychange',hidden);channel?.close();};hidden();
 }
 async openScope(scope:PrivateScopeSummary,pin:RecoveryKit['authority'],scopeOwner:string){
  this.requireOpen();const client=new E2eeScopeClient(this.device,scopeOwner,scope.scopeId,pin,this.#transport),directory=await client.refresh();this.requireOpen();
  if(directory.kind!==scope.kind||directory.resourceId!==scope.resourceId||directory.ownerId!==scopeOwner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  this.#clients.set(scope.scopeId,{client,directory});return{client,directory};
 }
 personal(){this.requireOpen();const values=[...this.#clients.values()].filter(value=>value.directory.kind==='personal'&&value.directory.resourceId===this.ownerId);
  if(values.length!==1||values[0].directory.state!=='active')throw new Error('E2EE_MIGRATION_RESUME_REQUIRED');return values[0];}
 async #recoverEnrollment(scopeId:string,secret:Uint8Array,kit:RecoveryKit){
  this.requireOpen();const authority=await recoverAuthority(this.ownerId,secret,kit);this.requireOpen();
  if(kit.authority.signingKey!==this.device.authorityPin.signingKey||kit.authority.receivingKey!==this.device.authorityPin.receivingKey)throw new Error('E2EE_AUTHORITY_CHANGED');
  const id=`enrollment:${scopeId}`,previous=await this.device.vault.read('outbox',id);this.requireOpen();let packet:SignedE2eeCommand;
  try{
   if(previous){packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(previous.value));
    if(packet.command?.action!=='enroll'||packet.command.deviceId!=='recovery'||packet.command.ownerId!==this.ownerId||packet.command.scopeId!==scopeId)throw new Error('E2EE_CORRUPT_OUTBOX');
   }else{
    const response=await this.#transport.directory(scopeId);this.requireOpen();
    const frames=new Map<number,VerifiedDirectory>();const directory=await verifyDeviceDirectory(this.ownerId,scopeId,kit.authority,response.events,undefined,frame=>frames.set(frame.cryptoEpoch,frame));this.requireOpen();
    const publicKeys=await publicDeviceKeys(this.device.keys()),challenge=await this.#transport.challenge(scopeId,this.device.deviceId,publicKeys);this.requireOpen();
    exactKeys(challenge,['id','scopeId','userId','role','sessionHash','deviceId','signingKey','receivingKey','nonce','expiresAt']);
    if(challenge.scopeId!==scopeId||challenge.userId!==this.ownerId||challenge.role!=='owner'||challenge.deviceId!==this.device.deviceId
     ||challenge.signingKey!==publicKeys.signingKey||challenge.receivingKey!==publicKeys.receivingKey||typeof challenge.expiresAt!=='number'||challenge.expiresAt*1000<=Date.now())throw new Error('E2EE_CHALLENGE_INVALID');
    const prefix=new TextEncoder().encode('GENESIS-E2EE-ENROLLMENT\0v1\0'),body=canonicalE2eeValue(challenge),proof=new Uint8Array(prefix.length+body.length);proof.set(prefix);proof.set(body,prefix.length);
    const selfProof=encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},this.device.keys().signing.privateKey,proof)));this.requireOpen();
    const grant=async(frame:VerifiedDirectory)=>forwardRoot(frame.recoveryCapsule,authority.receiving.privateKey,{ownerId:this.ownerId,scopeId,cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,recipientId:'recovery'},
     publicKeys.receivingKey,{ownerId:this.ownerId,scopeId,cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,recipientId:this.device.deviceId});
    const historyCapsules=[];for(const frame of frames.values())if(frame.cryptoEpoch<directory.cryptoEpoch)historyCapsules.push({cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,capsule:await grant(frame)});
    packet=await signE2eeCommand({protocol:1,ownerId:this.ownerId,scopeId,deviceId:'recovery',action:'enroll',expectedRevision:directory.checkpoint.revision,
     checkpointHash:directory.checkpoint.hash,securityEpoch:directory.securityEpoch,operationId:crypto.randomUUID(),payload:{challenge,capsule:await grant(directory),historyCapsules,selfProof} as unknown as Record<string,WireValue>},authority.signing.privateKey);this.requireOpen();
    const bytes=new TextEncoder().encode(JSON.stringify(packet));try{await this.device.vault.write([{domain:'outbox',objectId:id,value:bytes,expected:null}]);}finally{bytes.fill(0);}
   }
   await this.#transport.command(packet);this.requireOpen();
   const response=await this.#transport.directory(scopeId);this.requireOpen();const directory=await this.device.rememberDirectory(scopeId,kit.authority,response.events,this.ownerId);this.requireOpen();
   const enrolled=directory.devices.get(this.device.deviceId),keys=await publicDeviceKeys(this.device.keys());
   if(!enrolled||enrolled.revoked||enrolled.userId!==this.ownerId||enrolled.signingKey!==keys.signingKey||enrolled.receivingKey!==keys.receivingKey)throw new Error('E2EE_UNTRUSTED_DEVICE');
  }finally{previous?.value.fill(0);}
 }
}
export async function unlockPrivateAccount(secretText:string,transport:PrivateAccountTransport,current:()=>void,kit?:RecoveryKit,onOpen?:(account:WebPrivateAccount)=>Promise<void>){
 const expected=view;if(!expected.ownerId||expected.phase!=='locked')throw new Error('E2EE_UNLOCK_REQUIRED');
 const secret=decodeE2eeBytes(secretText.trim(),32);view=Object.freeze({...expected,phase:'unlocking'});notify();
 let account:WebPrivateAccount|undefined;
 try{
  const check=()=>{current();if(view.ownerId!==expected.ownerId)throw new Error('E2EE_ACCOUNT_CHANGED');};
  account=await WebPrivateAccount.open(expected.ownerId,secret,transport,check,kit);check();account.bindLifecycle();account.requireOpen();
  await onOpen?.(account);check();account.requireOpen();active=account;
  view=Object.freeze({...expected,phase:'ready'});for(const waiter of [...waiters])if(waiter.ownerId===expected.ownerId){waiters.delete(waiter);waiter.resolve();}notify();
 }catch(error){account?.close();if(active===account)active=null;if(view.ownerId===expected.ownerId){view=Object.freeze({...expected,phase:'locked',reason:error instanceof Error&&error.message==='E2EE_RECOVERY_KIT_REQUIRED'?'recovery':expected.reason});notify();}throw error;}
 finally{secret.fill(0);}
}
