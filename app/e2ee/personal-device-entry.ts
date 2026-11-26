import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from './device-vault.ts';
import {IndexedDbE2eeStorage} from './storage.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {ComparedPersonalDeviceTarget} from './personal-device-target.ts';
import {E2eeDeviceAccess,type DeviceAccessPorts} from './device-access.ts';
import {validateDeviceAccessTarget,type DeviceAccessTarget} from './device-access-contract.ts';
import {E2eeScopeClient,type ScopeTransport} from './scope-client.ts';
import {verifyDeviceDirectory} from './directory.ts';
import {samePrivateJson as same} from './product-json.ts';
import {assertTechnical,exactKeys,retainE2eeSecret,type publicDeviceKeys} from './keys.ts';
import type {SignedE2eeCommand} from './commands.ts';

export const PERSONAL_DEVICE_ENTRY_ID='personal-device-entry:v1';
const markerId=PERSONAL_DEVICE_ENTRY_ID;
export type PersonalDeviceEntryMarker={format:'genesis-personal-device-entry-v1';ownerId:string;target:DeviceAccessTarget;attemptIds:string[]};
type Marker=PersonalDeviceEntryMarker;
export function validatePersonalDeviceEntryMarker(value:unknown,ownerId:string,expected?:DeviceAccessTarget):Marker{exactKeys(value,['format','ownerId','target','attemptIds']);const target=validateDeviceAccessTarget(value.target);if(value.format!=='genesis-personal-device-entry-v1'||value.ownerId!==ownerId||target.kind!=='personal'||target.ownerId!==ownerId||expected&&!same(target,expected)||!Array.isArray(value.attemptIds)||value.attemptIds.length<1||value.attemptIds.length>64||new Set(value.attemptIds).size!==value.attemptIds.length)throw new Error('E2EE_DEVICE_ACCESS_INVALID');for(const id of value.attemptIds)assertTechnical(id);return structuredClone(value) as Marker;}
export interface PersonalDeviceEntryPorts{transport:ScopeTransport;challenge:(target:DeviceAccessTarget,deviceId:string,keys:Awaited<ReturnType<typeof publicDeviceKeys>>,requestId:string)=>Promise<unknown>}
/** This object is deliberately not an unlocked product account. Its only
 * network mutation is the existing exact device enrollment protocol. */
export class WebPersonalDeviceEntry{
 readonly #access:E2eeDeviceAccess;readonly #document:E2eeDeviceDocument<Marker>;readonly #target:DeviceAccessTarget;#closed=false;#serial:Promise<unknown>=Promise.resolve();
 private constructor(readonly device:UnlockedWebDevice,target:DeviceAccessTarget,private readonly ports:PersonalDeviceEntryPorts,private readonly guard:()=>void){
  this.#target=structuredClone(target);const current=()=>this.current(),account={ownerId:device.ownerId,device,mode:'online' as const,requireOpen:current};
  this.#document=new E2eeDeviceDocument(device,markerId,value=>validatePersonalDeviceEntryMarker(value,device.ownerId,target),current);
  const accessPorts:DeviceAccessPorts={target:async scopeId=>{current();if(scopeId!==target.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return structuredClone(target);},
   client:async()=>{throw new Error('E2EE_OWNER_REQUIRED');},directory:scopeId=>ports.transport.directory(scopeId),challenge:(binding,deviceId,keys,requestId)=>ports.challenge(binding,deviceId,keys,requestId),command:packet=>ports.transport.command(packet),
   open:async binding=>{current();if(!same(binding,target))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const client=new E2eeScopeClient(device,target.ownerId,target.scopeId,target.authority,ports.transport);
    try{const directory=await client.refresh();current();if(directory.kind!=='personal'||directory.resourceId!==device.ownerId||directory.state!=='active')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}finally{client.close();}},
  };this.#access=new E2eeDeviceAccess(account,accessPorts,current);
 }
 get target(){return structuredClone(this.#target);}
 current(){this.guard();if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');this.device.requireOpen();}
 #run<T>(work:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.current();return work();});this.#serial=task;return task;}
 static async begin(compared:ComparedPersonalDeviceTarget,localSecret:Uint8Array,ports:PersonalDeviceEntryPorts,current:()=>void){
  const target=ComparedPersonalDeviceTarget.require(compared),held=retainE2eeSecret(localSecret);let device:UnlockedWebDevice|undefined;
  try{const storage=new IndexedDbE2eeStorage(),keys=new IndexedDbDeviceKeyStorage();current();const response=await ports.transport.directory(target.scopeId);current();const directory=await verifyDeviceDirectory(target.ownerId,target.scopeId,target.authority,response.events);current();
   if(directory.kind!=='personal'||directory.resourceId!==target.ownerId||directory.state!=='active')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   device=await keys.get(target.ownerId)?await UnlockedWebDevice.unlock(target.ownerId,held,storage,keys):await UnlockedWebDevice.provisionCandidate(compared,held,storage,keys);current();
   if(!same(device.authorityPin,target.authority))throw new Error('E2EE_AUTHORITY_CHANGED');const entry=new WebPersonalDeviceEntry(device,target,ports,current),saved=await entry.#document.load();entry.current();
   if(!saved){if(await device.savedDirectory(target.scopeId))throw new Error('E2EE_DEVICE_ALREADY_ENROLLED');await entry.#document.save({format:'genesis-personal-device-entry-v1',ownerId:target.ownerId,target,attemptIds:[crypto.randomUUID()]},null);entry.current();}return entry;
  }catch(error){device?.lock();throw error;}finally{held.fill(0);}
 }
 static async resume(ownerId:string,localSecret:Uint8Array,ports:PersonalDeviceEntryPorts,current:()=>void){let device:UnlockedWebDevice|undefined;
  try{current();device=await UnlockedWebDevice.unlock(ownerId,localSecret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());current();const row=await new E2eeDeviceDocument<Marker>(device,markerId,value=>validatePersonalDeviceEntryMarker(value,ownerId),()=>{current();device!.requireOpen();}).load();current();if(!row)throw new Error('E2EE_DEVICE_ACCESS_REQUIRED');const target=row.value.target;
   if(target.kind!=='personal'||target.ownerId!==ownerId||!same(target.authority,device.authorityPin))throw new Error('E2EE_AUTHORITY_CHANGED');const entry=new WebPersonalDeviceEntry(device,target,ports,current);await entry.#document.load();entry.current();return entry;
  }catch(error){device?.lock();throw error;}
 }
 static async replaceRevoked(compared:ComparedPersonalDeviceTarget,oldSecret:Uint8Array,newSecret:Uint8Array,ports:PersonalDeviceEntryPorts,current:()=>void){
  const target=ComparedPersonalDeviceTarget.require(compared),priorSecret=retainE2eeSecret(oldSecret);let nextSecret:Uint8Array|undefined;
  try{nextSecret=retainE2eeSecret(newSecret);current();const response=await ports.transport.directory(target.scopeId);current();const candidate=await UnlockedWebDevice.replaceRevoked(compared,priorSecret,nextSecret,response.events,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage(),current);candidate.lock();current();return await this.begin(compared,nextSecret,ports,current);}
  finally{priorSecret.fill(0);nextSecret?.fill(0);}
 }
 async #active(){const marker=await this.#document.load();this.current();if(!marker)throw new Error('E2EE_DEVICE_ACCESS_REQUIRED');const id=marker.value.attemptIds.at(-1)!;await this.#access.create(this.target.scopeId,id);this.current();return{id,marker};}
 request(){return this.#run(async()=>{const {id}=await this.#active();return this.#access.request(id);});}
 /** Only an explicit foreground retry creates a new challenge. Old requests,
  * self-proofs and any staged approval are retained and never re-signed. */
 newRequest(){return this.#run(async()=>{const {id,marker}=await this.#active(),old=await this.#access.inspect(id);this.current();if(old.approval)throw new Error('E2EE_DEVICE_PREVIOUS_OUTCOME_REQUIRED');if(marker.value.attemptIds.length>=64)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
  const next=crypto.randomUUID();await this.#document.save({...marker.value,attemptIds:[...marker.value.attemptIds,next]},marker.serial);this.current();await this.#access.create(this.target.scopeId,next);return this.#access.request(next);
 });}
 submit(input?:SignedE2eeCommand){return this.#run(async()=>{const {id}=await this.#active();if(input){await this.#access.stageApproval(id,input);this.current();}return this.#access.submit(id);});}
 close(){this.#closed=true;this.device.lock();}
}
