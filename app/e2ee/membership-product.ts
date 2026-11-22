import {canonicalE2eeValue,e2eeCommandHash,snapshotE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {encodeE2eeBytes,decodeE2eeBytes} from './envelope.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import type {E2eeScopeClient,ReviewedDeviceRole} from './scope-client.ts';
import type {UnlockedWebDevice} from './device-vault.ts';
import {MEMBERSHIP_HASH_FORMAT,MEMBERSHIP_SPECS,validateMembershipChanges,membershipChangeHashValue,membershipBeforeHash,membershipGrantReviewRequired,type MembershipChange} from './membership-contract.ts';
import {samePrivateJson as same} from './product-json.ts';
import {validateMembershipReviewRequest,membershipReviewFingerprint,validateMembershipOwnerApproval,verifyMembershipOwnerApproval,type MembershipReviewRequest,type MembershipOwnerApproval,type MembershipPeerPorts} from './membership-exchange.ts';

export type {MembershipChange} from './membership-contract.ts';
export type MembershipScopePlan={scopeId:string;ownerId:string;kind:'project'|'space';resourceId:string;directoryRevision:number;checkpointHash:string;cryptoEpoch:number;securityEpoch:number;roles:ReviewedDeviceRole[];manifest:{manifestHash:string;objectCount:number}};
export type MembershipPreview={intentId:string;changeHash:string;scopePlans:MembershipScopePlan[]};
export type MembershipReview={scopeId:string;roles:ReviewedDeviceRole[]};
export interface MembershipTransport{
 membershipGraph?(spaceId:string):Promise<unknown>;
 membershipState(targets:Pick<MembershipChange,'table'|'key'>[]):Promise<unknown>;
 membershipPreview(intentId:string,changes:MembershipChange[]):Promise<MembershipPreview>;
 membershipCommit(batch:MembershipBatch):Promise<Record<string,WireValue>>;
}
export type MembershipBatch={intentId:string;changes:MembershipChange[];authorization:SignedE2eeCommand;rotations:SignedE2eeCommand[]};
type State={protocol:1;hashFormat?:typeof MEMBERSHIP_HASH_FORMAT;ownerApprovals?:{approval:MembershipOwnerApproval;verified:boolean}[];ownerId:string;intentId:string;scopeIds:string[];changes:MembershipChange[];preview:MembershipPreview|null;review:MembershipReview[]|null;batch:MembershipBatch|null;result:Record<string,WireValue>|null};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
async function digest(value:WireValue){return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',canonicalE2eeValue(value))));}
/** Protected plans precede preview and crypto preparation. An unknown outcome
 * retries exactly the same batch. Changing a roster/source requires a new
 * explicit intent; no automatic rekey, privilege approval or lost draft reset. */
export class E2eeMembershipProduct{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly device:UnlockedWebDevice,private readonly personal:E2eeScopeClient,private readonly transport:MembershipTransport,
  private readonly openScope:(scopeId:string)=>Promise<E2eeScopeClient>,private readonly current:()=>void,private readonly peers?:MembershipPeerPorts){}
 #run<T>(operation:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(operation);this.#serial=task;return task;}
 async #load(intentId:string){assertTechnical(intentId);this.current();const row=await this.device.vault.read('outbox',`membership:${intentId}`);this.current();if(!row)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');
  try{const state=JSON.parse(decoder.decode(row.value));exactKeys(state,['protocol',...(Object.hasOwn(state,'hashFormat')?['hashFormat']:[]),...(Object.hasOwn(state,'ownerApprovals')?['ownerApprovals']:[]),'ownerId','intentId','scopeIds','changes','preview','review','batch','result']);
   if(state.protocol!==1||state.ownerId!==this.device.ownerId||state.intentId!==intentId||!Array.isArray(state.scopeIds)||state.scopeIds.length>256||!Array.isArray(state.changes))throw new Error('E2EE_CORRUPT_OUTBOX');
   if(Object.hasOwn(state,'hashFormat')&&state.hashFormat!==MEMBERSHIP_HASH_FORMAT)throw new Error('E2EE_CORRUPT_OUTBOX');validateMembershipChanges(state.changes,true);
   for(const id of state.scopeIds)assertTechnical(id);if(!same([...new Set(state.scopeIds)].sort(),state.scopeIds))throw new Error('E2EE_CORRUPT_OUTBOX');
   if(Object.hasOwn(state,'ownerApprovals')){
    if(!Array.isArray(state.ownerApprovals)||state.ownerApprovals.length>256)throw new Error('E2EE_CORRUPT_OUTBOX');const scopes=new Set<string>();
    for(const row of state.ownerApprovals){exactKeys(row,['approval','verified']);if(typeof row.verified!=='boolean')throw new Error('E2EE_CORRUPT_OUTBOX');const approval=validateMembershipOwnerApproval(row.approval,this.#request(state as State));if(scopes.has(approval.scopeId))throw new Error('E2EE_CORRUPT_OUTBOX');scopes.add(approval.scopeId);}
   }
   return{state:state as State,serial:row.serial};
  }finally{row.value.fill(0);}
 }
 async #save(state:State,serial:number|null){this.current();const bytes=encoder.encode(JSON.stringify(state));try{await this.device.vault.write([{domain:'outbox',objectId:`membership:${state.intentId}`,value:bytes,expected:serial}]);this.current();}finally{bytes.fill(0);}return(serial??0)+1;}
 #request(state:State):MembershipReviewRequest{if(membershipGrantReviewRequired(state.changes))throw new Error('E2EE_MEMBERSHIP_HASH_REVIEW_REQUIRED');if(state.hashFormat!==MEMBERSHIP_HASH_FORMAT||!state.preview)throw new Error('E2EE_MEMBERSHIP_PREVIEW_REQUIRED');return validateMembershipReviewRequest({format:'genesis-membership-review-v1',hashFormat:MEMBERSHIP_HASH_FORMAT,actorId:state.ownerId,intentId:state.intentId,scopeIds:state.scopeIds,changes:state.changes,preview:state.preview});}
 async exportReview(intentId:string){const {state}=await this.#load(intentId),request=this.#request(state);this.current();return{request,fingerprint:membershipReviewFingerprint(request)};}
 importOwnerApproval(intentId:string,input:MembershipOwnerApproval){const held=snapshotE2eeValue(input);return this.#run(async()=>{
  const loaded=await this.#load(intentId),state=loaded.state,request=this.#request(state),approval=validateMembershipOwnerApproval(held,request);let serial=loaded.serial;
  if(!this.peers)throw new Error('E2EE_MEMBERSHIP_OWNER_APPROVAL_REQUIRED');const rows=[...(state.ownerApprovals??[])],before=rows.find(row=>row.approval.scopeId===approval.scopeId);
  if(before){if(!same(before.approval,approval))throw new Error('E2EE_MEMBERSHIP_APPROVAL_CHANGED');if(before.verified)return snapshotE2eeValue(before.approval);}
  else{if(state.batch)throw new Error('E2EE_MEMBERSHIP_PLAN_LOCKED');rows.push({approval,verified:false});state.ownerApprovals=rows;serial=await this.#save(state,serial);}
  await verifyMembershipOwnerApproval(approval,request,this.peers);this.current();rows.find(row=>row.approval.scopeId===approval.scopeId)!.verified=true;state.ownerApprovals=rows;await this.#save(state,serial);return snapshotE2eeValue(approval);
 });}
 async readState(targets:Pick<MembershipChange,'table'|'key'>[]){
  this.current();if(!Array.isArray(targets)||targets.length<1||targets.length>200)throw new Error('E2EE_MEMBERSHIP_BATCH_INVALID');const held=snapshotE2eeValue(targets);
  for(const row of held){exactKeys(row,['table','key']);if(!Object.hasOwn(MEMBERSHIP_SPECS,row.table))throw new Error('E2EE_MEMBERSHIP_BATCH_INVALID');exactKeys(row.key,MEMBERSHIP_SPECS[row.table].keys);for(const value of Object.values(row.key))assertTechnical(value);}
  const result=await this.transport.membershipState(held);this.current();exactKeys(result,['rows']);if(!Array.isArray(result.rows)||result.rows.length!==held.length)throw new Error('E2EE_MEMBERSHIP_BATCH_INVALID');
  for(const [at,row]of result.rows.entries()){exactKeys(row,['table','key','before','beforeHash']);if(row.table!==held[at].table||!same(row.key,held[at].key)||row.beforeHash!==membershipBeforeHash(held[at].table,row.before))throw new Error('E2EE_MEMBERSHIP_STALE');
   if(row.before!==null){for(const [key,value]of Object.entries(held[at].key))if((row.before as Record<string,unknown>)[key]!==value)throw new Error('E2EE_MEMBERSHIP_STALE');}}
  return snapshotE2eeValue(result.rows) as {table:MembershipChange['table'];key:Record<string,string>;before:Record<string,WireValue>|null;beforeHash:string}[];
 }
  async graph(spaceId:string){assertTechnical(spaceId);this.current();if(!this.transport.membershipGraph)throw new Error('E2EE_MEMBERSHIP_GRAPH_REQUIRED');const result=await this.transport.membershipGraph(spaceId);this.current();return result;}
 create(changes:MembershipChange[],expectedScopeIds:string[]){const held=validateMembershipChanges(changes),scopes=[...expectedScopeIds].sort();return this.#run(async()=>{
  this.current();if(held.length<1||held.length>200||scopes.length>256||new Set(scopes).size!==scopes.length)throw new Error('E2EE_MEMBERSHIP_BATCH_INVALID');for(const id of scopes)assertTechnical(id);
  const intentId=crypto.randomUUID();await this.#save({protocol:1,hashFormat:MEMBERSHIP_HASH_FORMAT,ownerApprovals:[],ownerId:this.device.ownerId,intentId,scopeIds:scopes,changes:held,preview:null,review:null,batch:null,result:null},null);return intentId;
 });}
 preview(intentId:string){return this.#run(async()=>{const {state,serial}=await this.#load(intentId);if(state.hashFormat!==MEMBERSHIP_HASH_FORMAT||membershipGrantReviewRequired(state.changes))throw new Error('E2EE_MEMBERSHIP_HASH_REVIEW_REQUIRED');if(state.preview)return snapshotE2eeValue(state.preview);
  const preview=await this.transport.membershipPreview(intentId,state.changes);this.current();exactKeys(preview,['intentId','changeHash','scopePlans']);
  if(preview.intentId!==intentId||!Array.isArray(preview.scopePlans)||!same(preview.scopePlans.map(row=>row.scopeId).sort(),state.scopeIds))throw new Error('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
  const changeHash=await digest(membershipChangeHashValue(this.device.ownerId,intentId,state.changes,state.scopeIds));
  if(preview.changeHash!==changeHash)throw new Error('E2EE_CONTEXT_MISMATCH');
  for(const plan of preview.scopePlans){exactKeys(plan,['scopeId','ownerId','kind','resourceId','directoryRevision','checkpointHash','cryptoEpoch','securityEpoch','roles','manifest']);
   for(const field of ['scopeId','ownerId','resourceId'] as const)assertTechnical(plan[field]);decodeE2eeBytes(plan.checkpointHash,32);decodeE2eeBytes(plan.manifest.manifestHash,32);
   if(!['project','space'].includes(plan.kind)||!Array.isArray(plan.roles)||plan.roles.length>256)throw new Error('E2EE_MEMBERSHIP_BATCH_INVALID');
  }
  state.preview=snapshotE2eeValue(preview);await this.#save(state,serial);return snapshotE2eeValue(preview);
 });}
 prepare(intentId:string,explicitReview:MembershipReview[]){const held=snapshotE2eeValue(explicitReview);return this.#run(async()=>{
  const loaded=await this.#load(intentId),{state}=loaded;let serial=loaded.serial;if(state.hashFormat!==MEMBERSHIP_HASH_FORMAT||membershipGrantReviewRequired(state.changes))throw new Error('E2EE_MEMBERSHIP_HASH_REVIEW_REQUIRED');if(!state.preview)throw new Error('E2EE_MEMBERSHIP_PREVIEW_REQUIRED');
  if(!same(held.map(row=>row.scopeId).sort(),state.scopeIds)||new Set(held.map(row=>row.scopeId)).size!==held.length)throw new Error('E2EE_MEMBERSHIP_ROTATION_INCOMPLETE');
  for(const row of held){exactKeys(row,['scopeId','roles']);if(!same(row.roles,state.preview.scopePlans.find(plan=>plan.scopeId===row.scopeId)!.roles))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');}
  if(state.review&&!same(state.review,held))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
  if(state.batch)return snapshotE2eeValue(state.batch);
  if(!state.review){state.review=held;serial=await this.#save(state,serial);}
  const rotations:SignedE2eeCommand[]=[];
  const request=this.#request(state);
  for(const plan of state.preview.scopePlans){const imported=state.ownerApprovals?.find(row=>row.approval.scopeId===plan.scopeId&&row.verified);
   if(imported){if(!this.peers)throw new Error('E2EE_MEMBERSHIP_OWNER_APPROVAL_REQUIRED');const approved=await verifyMembershipOwnerApproval(imported.approval,request,this.peers);this.current();rotations.push(approved.packet);}
   else{if(plan.ownerId!==this.device.ownerId)throw new Error('E2EE_MEMBERSHIP_OWNER_APPROVAL_REQUIRED');const client=await this.openScope(plan.scopeId);this.current();
    rotations.push(await client.prepareMembershipRotation(state.preview.changeHash,held.find(row=>row.scopeId===plan.scopeId)!.roles,plan.manifest,plan));this.current();}}
  await this.personal.refresh();this.current();const authorization=await this.personal.authorizeMembership(intentId,state.preview.changeHash);this.current();
  state.batch={intentId,changes:state.changes,authorization,rotations};await this.#save(state,serial);return snapshotE2eeValue(state.batch);
 });}
 submit(intentId:string){return this.#run(async()=>{const {state,serial}=await this.#load(intentId);if(state.hashFormat!==MEMBERSHIP_HASH_FORMAT||membershipGrantReviewRequired(state.changes))throw new Error('E2EE_MEMBERSHIP_HASH_REVIEW_REQUIRED');if(!state.batch)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');
  if(state.result)return snapshotE2eeValue(state.result);
  // Never refresh/re-sign/rekey on a failed POST. Exact idempotent retry also
  // covers a successful transaction whose HTTP response was lost.
  const result=await this.transport.membershipCommit(state.batch);this.current();
  exactKeys(result,['intentId','changeHash','scopes','signInRequired']);
  if(result.intentId!==intentId||result.changeHash!==state.preview?.changeHash||result.signInRequired!==true||!result.scopes||typeof result.scopes!=='object'||Array.isArray(result.scopes)||!same(Object.keys(result.scopes).sort(),state.scopeIds))throw new Error('E2EE_INVALID_RECEIPT');
  const request=this.#request(state);
  for(const packet of state.batch.rotations){const command=packet.command,receipt=(result.scopes as Record<string,unknown>)[command.scopeId];exactKeys(receipt,['directoryRevision','checkpointHash','cryptoEpoch','securityEpoch','signInRequired']);
   const commandHash=await e2eeCommandHash(command),bytes=encoder.encode(command.checkpointHash+'\0'+commandHash);let checkpoint:string;
   try{checkpoint=encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}finally{bytes.fill(0);}this.current();
   if(receipt.directoryRevision!==command.expectedRevision+1||receipt.checkpointHash!==checkpoint||receipt.cryptoEpoch!==command.payload.cryptoEpoch||receipt.securityEpoch!==command.payload.securityEpoch||receipt.signInRequired!==((command.payload.revokedDeviceIds as string[]).length>0))throw new Error('E2EE_INVALID_RECEIPT');
   if(this.peers){await verifyMembershipOwnerApproval({format:'genesis-membership-owner-approval-v1',requestFingerprint:membershipReviewFingerprint(request),scopeId:command.scopeId,packet},request,this.peers,true);this.current();}
   else{const client=await this.openScope(command.scopeId);this.current();await client.confirmMembershipRotation(packet);this.current();}}
  state.result=result;await this.#save(state,serial);return snapshotE2eeValue(result);
 });}
 async pending(){this.current();const ids=await this.device.vault.listLocal('outbox','membership:');this.current();return ids.map(id=>id.slice('membership:'.length));}
 async inspect(intentId:string){return snapshotE2eeValue((await this.#load(intentId)).state);}
}
