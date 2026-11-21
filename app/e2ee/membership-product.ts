import {canonicalE2eeValue,snapshotE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {encodeE2eeBytes,decodeE2eeBytes} from './envelope.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import type {E2eeScopeClient,ReviewedDeviceRole} from './scope-client.ts';
import type {UnlockedWebDevice} from './device-vault.ts';

export type MembershipChange={table:'shared_project_members'|'shared_space_members'|'shared_member_categories'|'shared_member_project_grants';key:Record<string,string>;expectedHash:string;after:Record<string,WireValue>|null};
export type MembershipScopePlan={scopeId:string;ownerId:string;kind:'project'|'space';resourceId:string;directoryRevision:number;checkpointHash:string;cryptoEpoch:number;securityEpoch:number;roles:ReviewedDeviceRole[];manifest:{manifestHash:string;objectCount:number}};
export type MembershipPreview={intentId:string;changeHash:string;scopePlans:MembershipScopePlan[]};
export type MembershipReview={scopeId:string;roles:ReviewedDeviceRole[]};
export interface MembershipTransport{
 membershipState(targets:Pick<MembershipChange,'table'|'key'>[]):Promise<unknown>;
 membershipPreview(intentId:string,changes:MembershipChange[]):Promise<MembershipPreview>;
 membershipCommit(batch:MembershipBatch):Promise<Record<string,WireValue>>;
}
export type MembershipBatch={intentId:string;changes:MembershipChange[];authorization:SignedE2eeCommand;rotations:SignedE2eeCommand[]};
type State={protocol:1;ownerId:string;intentId:string;scopeIds:string[];changes:MembershipChange[];preview:MembershipPreview|null;review:MembershipReview[]|null;batch:MembershipBatch|null;result:Record<string,WireValue>|null};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
async function digest(value:WireValue){return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',canonicalE2eeValue(value))));}
const same=(a:unknown,b:unknown)=>encodeE2eeBytes(canonicalE2eeValue(a as WireValue))===encodeE2eeBytes(canonicalE2eeValue(b as WireValue));
/** Protected plans precede preview and crypto preparation. An unknown outcome
 * retries exactly the same batch. Changing a roster/source requires a new
 * explicit intent; no automatic rekey, privilege approval or lost draft reset. */
export class E2eeMembershipProduct{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly device:UnlockedWebDevice,private readonly personal:E2eeScopeClient,private readonly transport:MembershipTransport,
  private readonly openScope:(scopeId:string)=>Promise<E2eeScopeClient>,private readonly current:()=>void){}
 #run<T>(operation:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(operation);this.#serial=task;return task;}
 async #load(intentId:string){assertTechnical(intentId);this.current();const row=await this.device.vault.read('outbox',`membership:${intentId}`);this.current();if(!row)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');
  try{const state=JSON.parse(decoder.decode(row.value));exactKeys(state,['protocol','ownerId','intentId','scopeIds','changes','preview','review','batch','result']);
   if(state.protocol!==1||state.ownerId!==this.device.ownerId||state.intentId!==intentId||!Array.isArray(state.scopeIds)||state.scopeIds.length>256||!Array.isArray(state.changes))throw new Error('E2EE_CORRUPT_OUTBOX');
   return{state:state as State,serial:row.serial};
  }finally{row.value.fill(0);}
 }
 async #save(state:State,serial:number|null){this.current();const bytes=encoder.encode(JSON.stringify(state));try{await this.device.vault.write([{domain:'outbox',objectId:`membership:${state.intentId}`,value:bytes,expected:serial}]);this.current();}finally{bytes.fill(0);}return(serial??0)+1;}
 create(changes:MembershipChange[],expectedScopeIds:string[]){const held=snapshotE2eeValue(changes),scopes=[...expectedScopeIds].sort();return this.#run(async()=>{
  this.current();if(held.length<1||held.length>200||scopes.length>256||new Set(scopes).size!==scopes.length)throw new Error('E2EE_MEMBERSHIP_BATCH_INVALID');for(const id of scopes)assertTechnical(id);
  const intentId=crypto.randomUUID();await this.#save({protocol:1,ownerId:this.device.ownerId,intentId,scopeIds:scopes,changes:held,preview:null,review:null,batch:null,result:null},null);return intentId;
 });}
 preview(intentId:string){return this.#run(async()=>{const {state,serial}=await this.#load(intentId);if(state.preview)return snapshotE2eeValue(state.preview);
  const preview=await this.transport.membershipPreview(intentId,state.changes);this.current();exactKeys(preview,['intentId','changeHash','scopePlans']);
  if(preview.intentId!==intentId||!Array.isArray(preview.scopePlans)||!same(preview.scopePlans.map(row=>row.scopeId).sort(),state.scopeIds))throw new Error('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
  const changeHash=await digest({protocol:1,actorId:this.device.ownerId,intentId,changes:state.changes as unknown as WireValue,scopeIds:state.scopeIds});
  if(preview.changeHash!==changeHash)throw new Error('E2EE_CONTEXT_MISMATCH');
  for(const plan of preview.scopePlans){exactKeys(plan,['scopeId','ownerId','kind','resourceId','directoryRevision','checkpointHash','cryptoEpoch','securityEpoch','roles','manifest']);
   for(const field of ['scopeId','ownerId','resourceId'] as const)assertTechnical(plan[field]);decodeE2eeBytes(plan.checkpointHash,32);decodeE2eeBytes(plan.manifest.manifestHash,32);
   if(!['project','space'].includes(plan.kind)||!Array.isArray(plan.roles)||plan.roles.length>256)throw new Error('E2EE_MEMBERSHIP_BATCH_INVALID');
  }
  state.preview=snapshotE2eeValue(preview);await this.#save(state,serial);return snapshotE2eeValue(preview);
 });}
 prepare(intentId:string,explicitReview:MembershipReview[]){const held=snapshotE2eeValue(explicitReview);return this.#run(async()=>{
  const loaded=await this.#load(intentId),{state}=loaded;let serial=loaded.serial;if(!state.preview)throw new Error('E2EE_MEMBERSHIP_PREVIEW_REQUIRED');
  if(!same(held.map(row=>row.scopeId).sort(),state.scopeIds)||new Set(held.map(row=>row.scopeId)).size!==held.length)throw new Error('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
  for(const row of held){exactKeys(row,['scopeId','roles']);if(!same(row.roles,state.preview.scopePlans.find(plan=>plan.scopeId===row.scopeId)!.roles))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');}
  if(state.review&&!same(state.review,held))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
  if(state.batch)return snapshotE2eeValue(state.batch);
  if(!state.review){state.review=held;serial=await this.#save(state,serial);}
  const rotations:SignedE2eeCommand[]=[];
  for(const plan of state.preview.scopePlans){const client=await this.openScope(plan.scopeId);this.current();
   rotations.push(await client.prepareMembershipRotation(state.preview.changeHash,held.find(row=>row.scopeId===plan.scopeId)!.roles,plan.manifest,plan));this.current();}
  const authorization=await this.personal.authorizeMembership(intentId,state.preview.changeHash);this.current();
  state.batch={intentId,changes:state.changes,authorization,rotations};await this.#save(state,serial);return snapshotE2eeValue(state.batch);
 });}
 submit(intentId:string){return this.#run(async()=>{const {state,serial}=await this.#load(intentId);if(!state.batch)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');
  if(state.result)return snapshotE2eeValue(state.result);
  // Never refresh/re-sign/rekey on a failed POST. Exact idempotent retry also
  // covers a successful transaction whose HTTP response was lost.
  const result=await this.transport.membershipCommit(state.batch);this.current();
  if(result.intentId!==intentId||result.changeHash!==state.preview?.changeHash)throw new Error('E2EE_INVALID_RECEIPT');
  for(const packet of state.batch.rotations){const client=await this.openScope(packet.command.scopeId);this.current();await client.confirmMembershipRotation(packet);this.current();}
  state.result=result;await this.#save(state,serial);return snapshotE2eeValue(result);
 });}
 async pending(){this.current();const ids=await this.device.vault.listLocal('outbox','membership:');this.current();return ids.map(id=>id.slice('membership:'.length));}
 async inspect(intentId:string){return snapshotE2eeValue((await this.#load(intentId)).state);}
}
