import assert from 'node:assert/strict';
import {createRecoveryKit,generateDeviceKeys,publicDeviceKeys,freshSecret,sealRoot} from '../../app/e2ee/keys.ts';
import {signE2eeCommand} from '../../app/e2ee/commands.ts';
import {deviceAccessProofBytes} from '../../app/e2ee/device-access-contract.ts';
import {encodeE2eeBytes} from '../../app/e2ee/envelope.ts';
import {verifyDeviceDirectory} from '../../app/e2ee/directory.ts';
import {membershipAtomicPageRef,membershipAtomicPlanHash,membershipAtomicChangeHash,membershipAtomicBatchHash} from '../../app/e2ee/membership-atomic-contract.ts';
import {createMembershipAtomicReview,membershipAtomicReviewFingerprint} from '../../app/e2ee/membership-atomic-review.ts';
import {membershipAtomicReceiptPageRef} from '../../app/e2ee/membership-atomic-receipts.ts';

export async function membershipRuntime(){
 const ownerId='review-owner',memberId='review-member',resourceId='review-project',scopeId='project:'+resourceId;
 const authority=await createRecoveryKit(ownerId),owner=await generateDeviceKeys(),member=await generateDeviceKeys();
 const ownerPublic=await publicDeviceKeys(owner),memberPublic=await publicDeviceKeys(member),root=freshSecret(),nextRoot=freshSecret();
 const rootContext=(epoch,keyId,recipientId)=>({ownerId,scopeId,cryptoEpoch:epoch,keyId,recipientId});
 const capsule=(bytes,epoch,keyId,recipientId,keys)=>sealRoot(bytes,keys.receivingKey,rootContext(epoch,keyId,recipientId));
 let operation=0;
 const base=(action,payload,directory)=>({protocol:1,ownerId,scopeId,deviceId:'review-owner-device',action,expectedRevision:directory?.checkpoint.revision??0,
  checkpointHash:directory?.checkpoint.hash??'genesis',securityEpoch:directory?.securityEpoch??1,operationId:'review-op-'+(++operation),payload});
 const initial=base('bootstrap',{kind:'project',resourceId,keyId:'review-root-one',generation:1,recoveryKit:authority.kit,
  recoveryCapsule:await capsule(root,1,'review-root-one','recovery',authority.kit.authority),deviceKeys:ownerPublic,
  deviceCapsule:await capsule(root,1,'review-root-one','review-owner-device',ownerPublic)});
 initial.payload.selfProof=(await signE2eeCommand(initial,owner.signing.privateKey)).signature;
 const events=[await signE2eeCommand(initial,authority.keys.signing.privateKey)];
 const directory=()=>verifyDeviceDirectory(ownerId,scopeId,authority.kit.authority,events);
 events.push(await signE2eeCommand(base('migration-commit',{migrationId:'review-migration',fence:1,manifestHash:'A'.repeat(43),objectCount:0,verifiedCheckpoint:'A'.repeat(43),generation:1},await directory()),owner.signing.privateKey));
 const challenge={id:'review-challenge',scopeId,userId:memberId,role:'writer',sessionHash:'a'.repeat(64),deviceId:'review-member-device',...memberPublic,nonce:'b'.repeat(64),expiresAt:2_000_000_000};
 const selfProof=encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},member.signing.privateKey,deviceAccessProofBytes(challenge))));
 events.push(await signE2eeCommand(base('enroll',{challenge,selfProof,capsule:await capsule(root,1,'review-root-one','review-member-device',memberPublic),historyCapsules:[]},await directory()),owner.signing.privateKey));
 const frame=await directory(),anchor={scopeId,ownerId,kind:'project',resourceId,generation:1,directoryRevision:frame.checkpoint.revision,checkpointHash:frame.checkpoint.hash,
  entityId:scopeId,revision:1,payloadHash:'A'.repeat(43),productIndexHash:'A'.repeat(43)};
 const pages=[{kind:'operation',items:[{kind:'project-remove',projectId:resourceId,userId:memberId}]},{kind:'anchors',items:[anchor]}];
 const plan={format:'genesis-membership-atomic-plan-v2',actorId:ownerId,intentId:'review-intent',spaceId:'review-space',reviewFingerprint:'A'.repeat(43),scopeIds:[scopeId],pages:pages.map((page,i)=>membershipAtomicPageRef(i,page))};
 const roles=[{deviceId:'review-member-device',userId:memberId,role:null},{deviceId:'review-owner-device',userId:ownerId,role:'owner'}];
 const scope={scopeId,ownerId,kind:'project',resourceId,generation:1,directoryRevision:frame.checkpoint.revision,checkpointHash:frame.checkpoint.hash,cryptoEpoch:1,securityEpoch:1,roles,manifest:{manifestHash:'A'.repeat(43),objectCount:0}};
 const planHash=membershipAtomicPlanHash(plan),changeHash=membershipAtomicChangeHash(plan);
 const preview={intentId:plan.intentId,planHash,changeHash,scopePlans:[scope],next:null};
 const authorization=await signE2eeCommand({...base('membership-atomic-begin',{intentId:plan.intentId,planHash},frame),scopeId:'personal:'+ownerId},owner.signing.privateKey);
 const request=createMembershipAtomicReview(plan,[preview],[],authorization,'2026-11-24T00:00:00.000Z'),fingerprint=membershipAtomicReviewFingerprint(request);
 const parts=[...pages.map((page,index)=>({format:'genesis-membership-atomic-review-part-v2',fingerprint,kind:'plan',index,page})),
  {format:'genesis-membership-atomic-review-part-v2',fingerprint,kind:'preview',index:0,page:preview}];
 const rotation=await signE2eeCommand(base('rotate-membership',{membershipHash:changeHash,revokedDeviceIds:['review-member-device'],roleChanges:[{deviceId:'review-owner-device',role:'owner'}],cryptoEpoch:2,securityEpoch:2,keyId:'review-root-two',
  capsules:[{deviceId:'review-owner-device',capsule:await capsule(nextRoot,2,'review-root-two','review-owner-device',ownerPublic)}],
  recoveryCapsule:await capsule(nextRoot,2,'review-root-two','recovery',authority.kit.authority),retiredManifestHash:'A'.repeat(43),retiredObjectCount:0},frame),owner.signing.privateKey);
 let pin;const target={ownerId,scopeId,kind:'project',resourceId,authority:authority.kit.authority};
 const peers={current:()=>{},target:async id=>{assert.equal(id,scopeId);return structuredClone(target);},directory:async()=>({events:structuredClone(events)}),
  checkpoint:async()=>structuredClone(pin),remember:async(value,observed)=>{assert.deepEqual(structuredClone(value),target);pin=(await verifyDeviceDirectory(ownerId,scopeId,target.authority,observed,pin)).checkpoint;}};
 async function commit(){if(events.at(-1).command.action!=='rotate-membership')events.push(rotation);const final=await directory();
  const packetPage={kind:'rotation-packets',items:[rotation]},packetRefs=[membershipAtomicPageRef(0,packetPage)];
  const receiptPage={format:'genesis-membership-receipt-page-v2',kind:'scopes',items:[{scopeId,ownerId,result:{directoryRevision:final.checkpoint.revision,checkpointHash:final.checkpoint.hash,cryptoEpoch:2,securityEpoch:2,signInRequired:true}}]};
  const receipt={format:'genesis-membership-atomic-receipt-v2',actorId:ownerId,intentId:plan.intentId,planHash,batchHash:membershipAtomicBatchHash(plan,packetRefs),changeHash,pages:[membershipAtomicReceiptPageRef(0,receiptPage)],signInRequired:true};
  return{packetPage,packetRefs,receiptPage,receipt};
 }
 authority.secret.fill(0);root.fill(0);nextRoot.fill(0);
 return{ownerId,scopeId,owner,member,frame,anchor,plan,pages,scope,request,fingerprint,parts,rotation:structuredClone(rotation),peers,commit,rootContext};
}

export function durableRows(){
 const rows=new Map();return{rows,read:async id=>structuredClone(rows.get(id)??null),write:async(id,value,expected)=>{
  assert.equal(rows.get(id)?.serial??null,expected);const serial=(expected??0)+1;rows.set(id,{serial,value:structuredClone(value)});return serial;},list:async prefix=>[...rows.keys()].filter(id=>id.startsWith(prefix))};
}
