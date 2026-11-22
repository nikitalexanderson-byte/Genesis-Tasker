import {E2eeDeviceDocument} from './device-document.ts';
import {commandBytes,e2eeCommandHash,snapshotE2eeValue,type SignedE2eeCommand} from './commands.ts';
import {assertTechnical,exactKeys,publicDeviceKeys,HPKE_SUITE} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {verifyDeviceDirectory} from './directory.ts';
import {samePrivateJson as same} from './product-json.ts';
import {validateDeviceAccessTarget,validateDeviceAccessChallenge,validateDeviceAccessRequest,verifyDeviceAccessRequest,deviceAccessFingerprint,deviceAccessProofBytes,type DeviceAccessTarget,type DeviceAccessRequest} from './device-access-contract.ts';
import type {WebPrivateAccount} from './product-session.ts';
import type {E2eeScopeClient} from './scope-client.ts';

export interface DeviceAccessPorts{
 target:(scopeId:string)=>Promise<DeviceAccessTarget>;client:(target:DeviceAccessTarget)=>Promise<E2eeScopeClient>;
 directory:(scopeId:string)=>Promise<{events:SignedE2eeCommand[]}>;
 challenge:(target:DeviceAccessTarget,deviceId:string,keys:Awaited<ReturnType<typeof publicDeviceKeys>>,requestId:string)=>Promise<unknown>;
 command:(packet:SignedE2eeCommand)=>Promise<unknown>;open:(target:DeviceAccessTarget)=>Promise<void>;
}
export type DeviceAccessState={format:'genesis-device-access-v1';ownerId:string;id:string;mode:'request'|'grant';target:DeviceAccessTarget;request:DeviceAccessRequest|null;reviewedFingerprint:string|null;approval:SignedE2eeCommand|null;complete:boolean};
const prefix='device-access:';
function invalid():never{throw new Error('E2EE_DEVICE_ACCESS_INVALID');}
function approvalShape(input:unknown,request:DeviceAccessRequest):SignedE2eeCommand{
 exactKeys(input,['command','signature']);commandBytes(input.command as SignedE2eeCommand['command']);decodeE2eeBytes(input.signature,64);const packet=input as SignedE2eeCommand,c=packet.command;
 if(c.ownerId!==request.target.ownerId||c.scopeId!==request.target.scopeId||c.action!=='enroll')invalid();
 exactKeys(c.payload,['challenge','capsule','historyCapsules','selfProof']);if(!same(c.payload.challenge,request.challenge)||c.payload.selfProof!==request.selfProof||!Array.isArray(c.payload.historyCapsules)||c.payload.historyCapsules.length>2048)invalid();
 const capsule=(value:unknown)=>{exactKeys(value,['suite','enc','ciphertext']);if(value.suite!==HPKE_SUITE)invalid();decodeE2eeBytes(value.enc,65);decodeE2eeBytes(value.ciphertext,48);};
 capsule(c.payload.capsule);for(const grant of c.payload.historyCapsules){exactKeys(grant,['cryptoEpoch','keyId','capsule']);assertTechnical(grant.keyId);if(!Number.isSafeInteger(grant.cryptoEpoch)||Number(grant.cryptoEpoch)<1)invalid();capsule(grant.capsule);}
 return snapshotE2eeValue(packet);
}
/** Requests, reviewed grants and exact approvals survive process death. A peer
 * exchange carries public keys and recipient ciphertext only. No discovery or
 * HTTP response becomes an independent authority pin or a user's comparison. */
export class E2eeDeviceAccess{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly account:WebPrivateAccount,private readonly ports:DeviceAccessPorts,private readonly guard:()=>void=()=>{}){}
 #current(){this.guard();this.account.requireOpen();}
 #run<T>(work:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.#current();if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');return work();});this.#serial=task;return task;}
 #store(id:string){assertTechnical(id);return new E2eeDeviceDocument<DeviceAccessState>(this.account.device,prefix+id,value=>{
  exactKeys(value,['format','ownerId','id','mode','target','request','reviewedFingerprint','approval','complete']);
  if(value.format!=='genesis-device-access-v1'||value.ownerId!==this.account.ownerId||value.id!==id||!['request','grant'].includes(String(value.mode))||typeof value.complete!=='boolean')invalid();
  const target=validateDeviceAccessTarget(value.target);if(value.request!==null){const request=validateDeviceAccessRequest(value.request);if(!same(request.target,target))invalid();
   if(value.mode==='request'&&(request.challenge.userId!==this.account.ownerId||request.challenge.deviceId!==this.account.device.deviceId))invalid();
   if(value.approval!==null)approvalShape(value.approval,request);
  }else if(value.approval!==null||value.reviewedFingerprint!==null||value.mode==='grant'||value.complete)invalid();
  if(value.mode==='grant'){if(typeof value.reviewedFingerprint!=='string')invalid();decodeE2eeBytes(value.reviewedFingerprint,32);}
  else if(value.reviewedFingerprint!==null)invalid();if(value.complete&&value.approval===null)invalid();return structuredClone(value) as DeviceAccessState;
 },()=>this.#current());}
 async inspect(id:string){this.#current();const row=await this.#store(id).load();this.#current();if(!row)throw new Error('E2EE_DEVICE_ACCESS_REQUIRED');return structuredClone(row.value);}
 async pending(){this.#current();const keys=await this.account.device.vault.listLocal('draft',prefix),rows:DeviceAccessState[]=[];this.#current();for(const key of keys){const row=await this.inspect(key.slice(prefix.length));if(!row.complete||row.mode==='grant')rows.push(row);}return rows;}
 create(scopeId:string){return this.#run(async()=>{
  const target=validateDeviceAccessTarget(await this.ports.target(scopeId));this.#current();const id=crypto.randomUUID();
  await this.#store(id).save({format:'genesis-device-access-v1',ownerId:this.account.ownerId,id,mode:'request',target,request:null,reviewedFingerprint:null,approval:null,complete:false},null);this.#current();return id;
 });}
 request(id:string){return this.#run(async()=>{
  const store=this.#store(id),before=await store.load();this.#current();if(!before||before.value.mode!=='request')invalid();if(before.value.request)return before.value;
  const target=validateDeviceAccessTarget(await this.ports.target(before.value.target.scopeId));this.#current();if(!same(target,before.value.target))throw new Error('E2EE_AUTHORITY_CHANGED');
  const keys=await publicDeviceKeys(this.account.device.keys());this.#current();const challenge=validateDeviceAccessChallenge(await this.ports.challenge(target,this.account.device.deviceId,keys,id),target);this.#current();
  if(challenge.userId!==this.account.ownerId||challenge.deviceId!==this.account.device.deviceId||challenge.signingKey!==keys.signingKey||challenge.receivingKey!==keys.receivingKey)invalid();
  const bytes=deviceAccessProofBytes(challenge);let selfProof:string;
  try{selfProof=encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},this.account.device.keys().signing.privateKey,bytes)));}finally{bytes.fill(0);}
  this.#current();const request=await verifyDeviceAccessRequest({format:'genesis-device-access-request-v1',target,challenge,selfProof});this.#current();
  await store.save({...before.value,request},before.serial);this.#current();return this.inspect(id);
 });}
 approve(input:DeviceAccessRequest,comparedFingerprint:string){const held=validateDeviceAccessRequest(input);return this.#run(async()=>{
  await verifyDeviceAccessRequest(held);this.#current();const fingerprint=await deviceAccessFingerprint(held);this.#current();if(fingerprint!==comparedFingerprint)throw new Error('E2EE_DEVICE_FINGERPRINT_REQUIRED');
  const id='grant:'+fingerprint,store=this.#store(id),before=await store.load();this.#current();
  if(before){if(before.value.mode!=='grant'||!same(before.value.request,held)||before.value.reviewedFingerprint!==fingerprint)invalid();if(before.value.approval)return before.value;}
  else await store.save({format:'genesis-device-access-v1',ownerId:this.account.ownerId,id,mode:'grant',target:held.target,request:held,reviewedFingerprint:fingerprint,approval:null,complete:false},null);
  this.#current();const target=validateDeviceAccessTarget(await this.ports.target(held.target.scopeId));this.#current();if(!same(target,held.target))throw new Error('E2EE_AUTHORITY_CHANGED');
  const client=await this.ports.client(target);this.#current();await client.refresh();this.#current();const approval=await client.prepareDeviceAccess(held,fingerprint);this.#current();
  const saved=await store.load();this.#current();if(!saved||!same(saved.value.request,held)||saved.value.approval!==null)throw new Error('E2EE_LOCAL_CONFLICT');
  await store.save({...saved.value,approval,complete:true},saved.serial);this.#current();return this.inspect(id);
 });}
 stageApproval(id:string,input:SignedE2eeCommand){const held=snapshotE2eeValue(input);return this.#run(async()=>{
  const store=this.#store(id),before=await store.load();this.#current();if(!before||before.value.mode!=='request'||!before.value.request)invalid();const approval=approvalShape(held,before.value.request);
  if(before.value.approval){if(!same(before.value.approval,approval))throw new Error('E2EE_DEVICE_APPROVAL_CHANGED');return before.value;}
  await store.save({...before.value,approval},before.serial);this.#current();return this.inspect(id);
 });}
 async #verifyApproval(state:DeviceAccessState){
  if(!state.request||!state.approval)throw new Error('E2EE_DEVICE_APPROVAL_REQUIRED');const target=validateDeviceAccessTarget(await this.ports.target(state.target.scopeId));this.#current();if(!same(target,state.target))throw new Error('E2EE_AUTHORITY_CHANGED');
  const response=await this.ports.directory(target.scopeId);this.#current();const previous=await this.account.device.savedDirectory(target.scopeId);this.#current();
  const directory=await verifyDeviceDirectory(target.ownerId,target.scopeId,target.authority,response.events,previous?.checkpoint);this.#current();const packet=approvalShape(state.approval,state.request),hash=await e2eeCommandHash(packet.command);this.#current();
  const event=response.events[packet.command.expectedRevision];let granted=directory;
  if(event){if(await e2eeCommandHash(event.command)!==hash)throw new Error('E2EE_DIRECTORY_CONFLICT');}
  else{if(directory.checkpoint.revision!==packet.command.expectedRevision||directory.checkpoint.hash!==packet.command.checkpointHash)throw new Error('E2EE_DIRECTORY_CONFLICT');
   granted=await verifyDeviceDirectory(target.ownerId,target.scopeId,target.authority,[...response.events,packet],directory.checkpoint);this.#current();}
  const own=granted.devices.get(this.account.device.deviceId),keys=await publicDeviceKeys(this.account.device.keys());this.#current();
  if(granted.kind!==target.kind||granted.resourceId!==target.resourceId||!own||own.revoked||own.userId!==this.account.ownerId||own.signingKey!==keys.signingKey||own.receivingKey!==keys.receivingKey)throw new Error('E2EE_REVOKED_DEVICE');
  return{packet,hash,target};
 }
 submit(id:string){return this.#run(async()=>{
  const store=this.#store(id),before=await store.load();this.#current();if(!before||before.value.mode!=='request')invalid();const {packet,hash,target}=await this.#verifyApproval(before.value);this.#current();
  const result=await this.ports.command(packet);this.#current();exactKeys(result,['directoryRevision','checkpointHash']);if(result.directoryRevision!==packet.command.expectedRevision+1||result.checkpointHash!==hash)throw new Error('E2EE_INVALID_RECEIPT');
  const response=await this.ports.directory(target.scopeId);this.#current();const directory=await verifyDeviceDirectory(target.ownerId,target.scopeId,target.authority,response.events,{revision:packet.command.expectedRevision+1,hash});this.#current();
  const own=directory.devices.get(this.account.device.deviceId);if(!own||own.revoked||own.userId!==this.account.ownerId)throw new Error('E2EE_REVOKED_DEVICE');
  await this.ports.open(target);this.#current();const saved=await store.load();this.#current();if(!saved||!same(saved.value.approval,packet))throw new Error('E2EE_LOCAL_CONFLICT');
  if(!saved.value.complete)await store.save({...saved.value,complete:true},saved.serial);this.#current();return this.inspect(id);
 });}
}
