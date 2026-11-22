import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,commandBytes,e2eeCommandHash,verifyE2eeCommand,snapshotE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {assertTechnical,exactKeys,HPKE_SUITE} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {signingPublicKey,verifyDeviceDirectory,type DirectoryCheckpoint,type VerifiedDirectory} from './directory.ts';
import {MEMBERSHIP_HASH_FORMAT,validateMembershipChanges,membershipChangesProjection,membershipChangeHashValue,type MembershipChange} from './membership-contract.ts';
import {samePrivateJson as same} from './product-json.ts';
import type {MembershipPreview,MembershipScopePlan} from './membership-product.ts';
import {validateDeviceAccessTarget,type DeviceAccessTarget} from './device-access-contract.ts';

export type MembershipReviewRequest={format:'genesis-membership-review-v1';hashFormat:typeof MEMBERSHIP_HASH_FORMAT;actorId:string;intentId:string;scopeIds:string[];changes:MembershipChange[];preview:MembershipPreview};
export type MembershipOwnerApproval={format:'genesis-membership-owner-approval-v1';requestFingerprint:string;scopeId:string;packet:SignedE2eeCommand};
export interface MembershipPeerPorts{
 target:(scopeId:string)=>Promise<DeviceAccessTarget>;
 directory:(scopeId:string)=>Promise<{events:SignedE2eeCommand[]}>;
 checkpoint:(scopeId:string)=>Promise<DirectoryCheckpoint|undefined>;
 remember:(target:DeviceAccessTarget,events:SignedE2eeCommand[])=>Promise<void>;
 current:()=>void;
}
const invalid=():never=>{throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');};
const digest=(value:WireValue)=>{const bytes=canonicalE2eeValue(value);try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}};
export function validateMembershipReviewRequest(input:unknown):MembershipReviewRequest{
 exactKeys(input,['format','hashFormat','actorId','intentId','scopeIds','changes','preview']);
 if(input.format!=='genesis-membership-review-v1'||input.hashFormat!==MEMBERSHIP_HASH_FORMAT||!Array.isArray(input.scopeIds)||input.scopeIds.length>256)invalid();
 assertTechnical(input.actorId);assertTechnical(input.intentId);for(const id of input.scopeIds)assertTechnical(id);
 if(!same([...new Set(input.scopeIds)].sort(),input.scopeIds))invalid();validateMembershipChanges(input.changes);
 exactKeys(input.preview,['intentId','changeHash','scopePlans']);const preview=input.preview;
 if(preview.intentId!==input.intentId||!Array.isArray(preview.scopePlans)||preview.scopePlans.length!==input.scopeIds.length
  ||preview.changeHash!==digest(membershipChangeHashValue(input.actorId,input.intentId,input.changes,input.scopeIds as string[])))invalid();
 for(const plan of preview.scopePlans){exactKeys(plan,['scopeId','ownerId','kind','resourceId','directoryRevision','checkpointHash','cryptoEpoch','securityEpoch','roles','manifest']);
  for(const key of ['scopeId','ownerId','resourceId'])assertTechnical(plan[key]);for(const key of ['directoryRevision','cryptoEpoch','securityEpoch'])if(!Number.isSafeInteger(plan[key])||Number(plan[key])<1)invalid();
  if(!['space','project'].includes(String(plan.kind))||!Array.isArray(plan.roles)||plan.roles.length>256)invalid();decodeE2eeBytes(plan.checkpointHash,32);
  exactKeys(plan.manifest,['manifestHash','objectCount']);decodeE2eeBytes(plan.manifest.manifestHash,32);if(!Number.isSafeInteger(plan.manifest.objectCount)||Number(plan.manifest.objectCount)<0||Number(plan.manifest.objectCount)>10000)invalid();
  const devices=new Set<string>();for(const role of plan.roles){exactKeys(role,['deviceId','role']);assertTechnical(role.deviceId);if(devices.has(role.deviceId)||role.role!==null&&!['owner','writer','commenter','reader'].includes(String(role.role)))invalid();devices.add(role.deviceId);}
 }
 if(!same(preview.scopePlans.map(plan=>plan.scopeId).sort(),input.scopeIds))invalid();return snapshotE2eeValue(input) as MembershipReviewRequest;
}
export function membershipReviewFingerprint(input:MembershipReviewRequest){const request=validateMembershipReviewRequest(input);return digest({...request,changes:membershipChangesProjection(request.changes)} as unknown as WireValue);}
export function membershipRotationShape(input:unknown,request:MembershipReviewRequest,plan:MembershipScopePlan):SignedE2eeCommand{
 exactKeys(input,['command','signature']);const packet=input as SignedE2eeCommand;commandBytes(packet.command);decodeE2eeBytes(packet.signature,64);const c=packet.command,p=c.payload;
 if(c.ownerId!==plan.ownerId||c.scopeId!==plan.scopeId||c.action!=='rotate-membership'||c.expectedRevision!==plan.directoryRevision||c.checkpointHash!==plan.checkpointHash||c.securityEpoch!==plan.securityEpoch)invalid();
 exactKeys(p,['membershipHash','revokedDeviceIds','roleChanges','cryptoEpoch','securityEpoch','keyId','capsules','recoveryCapsule','retiredManifestHash','retiredObjectCount']);
 if(p.membershipHash!==request.preview.changeHash||p.cryptoEpoch!==plan.cryptoEpoch+1||p.securityEpoch!==plan.securityEpoch+1||p.retiredManifestHash!==plan.manifest.manifestHash||p.retiredObjectCount!==plan.manifest.objectCount
  ||!Array.isArray(p.revokedDeviceIds)||!Array.isArray(p.roleChanges)||!Array.isArray(p.capsules))invalid();assertTechnical(p.keyId);
 const order=(left:{deviceId:string},right:{deviceId:string})=>left.deviceId<right.deviceId?-1:left.deviceId>right.deviceId?1:0;
 const actual:{deviceId:string;role:unknown}[]=[];for(const role of [...p.roleChanges,...p.revokedDeviceIds.map(deviceId=>({deviceId,role:null}))]){exactKeys(role,['deviceId','role']);assertTechnical(role.deviceId);actual.push({deviceId:role.deviceId,role:role.role});}
 if(!same(actual.sort(order),[...plan.roles].sort(order)))invalid();
 const capsule=(value:unknown)=>{exactKeys(value,['suite','enc','ciphertext']);if(value.suite!==HPKE_SUITE)invalid();decodeE2eeBytes(value.enc,65);decodeE2eeBytes(value.ciphertext,48);};
 const recipients=new Set<string>();for(const row of p.capsules){exactKeys(row,['deviceId','capsule']);assertTechnical(row.deviceId);if(recipients.has(row.deviceId)||!plan.roles.some(role=>role.deviceId===row.deviceId&&role.role!==null))invalid();recipients.add(row.deviceId);capsule(row.capsule);}
 if(recipients.size!==plan.roles.filter(row=>row.role!==null).length)invalid();capsule(p.recoveryCapsule);return snapshotE2eeValue(packet);
}
export function validateMembershipOwnerApproval(input:unknown,request:MembershipReviewRequest):MembershipOwnerApproval{
 exactKeys(input,['format','requestFingerprint','scopeId','packet']);const held=validateMembershipReviewRequest(request);
 if(input.format!=='genesis-membership-owner-approval-v1'||input.requestFingerprint!==membershipReviewFingerprint(held))invalid();assertTechnical(input.scopeId);
 const plan=held.preview.scopePlans.find(row=>row.scopeId===input.scopeId);if(!plan)invalid();membershipRotationShape(input.packet,held,plan);return snapshotE2eeValue(input) as MembershipOwnerApproval;
}
/** Relayed signatures are checked against independently pinned directory
 * history without requiring the initiator to possess another owner's roots. */
export async function verifyMembershipOwnerApproval(raw:unknown,source:MembershipReviewRequest,ports:MembershipPeerPorts,confirmed=false){
 ports.current();const request=validateMembershipReviewRequest(source),approval=validateMembershipOwnerApproval(raw,request),plan=request.preview.scopePlans.find(row=>row.scopeId===approval.scopeId)!;
 const target=validateDeviceAccessTarget(await ports.target(plan.scopeId));ports.current();if(target.scopeId!==plan.scopeId||target.ownerId!==plan.ownerId||target.kind!==plan.kind||target.resourceId!==plan.resourceId)invalid();
 const previous=await ports.checkpoint(plan.scopeId);ports.current();const response=await ports.directory(plan.scopeId);ports.current();const frames=new Map<number,VerifiedDirectory>();
 const directory=await verifyDeviceDirectory(plan.ownerId,plan.scopeId,target.authority,response.events,previous,value=>{if(value.checkpoint.revision===plan.directoryRevision)frames.set(value.checkpoint.revision,structuredClone(value));});ports.current();const frame=frames.get(plan.directoryRevision);
 if(!frame||frame.kind!==plan.kind||frame.resourceId!==plan.resourceId||frame.checkpoint.hash!==plan.checkpointHash||frame.cryptoEpoch!==plan.cryptoEpoch||frame.securityEpoch!==plan.securityEpoch)invalid();
 const signer=frame.devices.get(approval.packet.command.deviceId);if(!signer||signer.revoked||signer.role!=='owner'||signer.userId!==plan.ownerId)invalid();
 await verifyE2eeCommand(approval.packet,await signingPublicKey(signer.signingKey));ports.current();
 const hash=await e2eeCommandHash(approval.packet.command);ports.current();const event=response.events[plan.directoryRevision];
 if(event){if(await e2eeCommandHash(event.command)!==hash)throw new Error('E2EE_MEMBERSHIP_STALE');}
 else{if(confirmed||directory.checkpoint.revision!==plan.directoryRevision)throw new Error('E2EE_MEMBERSHIP_STALE');
  await verifyDeviceDirectory(plan.ownerId,plan.scopeId,target.authority,[...response.events,approval.packet],directory.checkpoint);ports.current();}
 // Save only observed signed history, never the hypothetical appended event.
 // It is also the independent checkpoint for retained pending peer evidence.
 await ports.remember(target,response.events);ports.current();return approval;
}
