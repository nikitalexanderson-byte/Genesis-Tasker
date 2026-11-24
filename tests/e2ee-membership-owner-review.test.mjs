import assert from 'node:assert/strict';
import {test} from 'node:test';
import {membershipRuntime,durableRows} from './helpers/membership-runtime.mjs';
import {MembershipAtomicOwnerReviews,membershipAtomicOwnerId,membershipAtomicOwnerScopeSuffix} from '../app/e2ee/membership-atomic-owner.ts';
import {MembershipAtomicReceiptVerifier} from '../app/e2ee/membership-atomic-proofs.ts';
import {openRoot} from '../app/e2ee/keys.ts';
import {E2EE_SUITE,sealE2eeEnvelope,openE2eeEnvelope} from '../app/e2ee/envelope.ts';

function ownerModel(f,extra={}){
 const local=durableRows();let rotations=0,reviews=0;
 const ports={ownerId:f.ownerId,current:()=>{},peers:f.peers,...local,
  reviewEffects:async()=>{reviews++;return{taskCount:0,categoryCount:0,eventCount:0,renames:[]};},
  rotate:async()=>{rotations++;const consent=local.rows.get(membershipAtomicOwnerId(f.ownerId,f.fingerprint,2,membershipAtomicOwnerScopeSuffix(f.scopeId)));
   assert(consent,'Exact consent must be durable before root rotation');assert.equal(consent.value.packet,null);assert.deepEqual(consent.value.roles,f.scope.roles);return structuredClone(f.rotation);},...extra};
 return{...local,ports,model:()=>new MembershipAtomicOwnerReviews(ports),counts:()=>({rotations,reviews})};
}
async function upload(model,f){await model.create(f.request);for(const part of f.parts)await model.putPart(part);}

test('owner approval requires every immutable part, compared fingerprint and exact displayed roster',async()=>{
 const f=await membershipRuntime(),h=ownerModel(f),model=h.model();await model.create(f.request);
 await model.putPart(f.parts[0]);await assert.rejects(model.approve(f.fingerprint,f.scopeId,f.fingerprint,f.scope.roles),/E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED/);
 for(const part of f.parts.slice(1))await model.putPart(part);
 await assert.rejects(model.approve(f.fingerprint,f.scopeId,'A'.repeat(43),f.scope.roles),/E2EE_MEMBERSHIP_FINGERPRINT_REQUIRED/);
 await assert.rejects(model.approve(f.fingerprint,f.scopeId,f.fingerprint,[...f.scope.roles].reverse()),/E2EE_MEMBERSHIP_REVIEW_MISMATCH/);
 assert.equal(h.counts().rotations,0);
 const approved=await model.approve(f.fingerprint,f.scopeId,f.fingerprint,f.scope.roles);assert.deepEqual(approved.packet,f.rotation);assert.equal(h.counts().rotations,1);
 assert.deepEqual(await h.model().exportApproval(f.fingerprint,f.scopeId),approved);
 assert.deepEqual(await h.model().approve(f.fingerprint,f.scopeId,f.fingerprint,f.scope.roles),approved);assert.equal(h.counts().rotations,1);
});
test('substituted recipient identities or a different pinned authority never reach owner rotation',async()=>{
 for(const damage of ['identity','authority']){
  const f=await membershipRuntime();let peers=f.peers;
  if(damage==='identity')peers={...peers,directory:async()=>{const value=await f.peers.directory(f.scopeId);value.events.at(-1).command.payload.challenge.userId='foreign-user';return value;}};
  else peers={...peers,target:async id=>{const value=await f.peers.target(id);value.authority.signingKey=f.rotation.command.payload.capsules[0].capsule.enc;return value;}};
  const h=ownerModel(f,{peers}),model=h.model();await upload(model,f);
  await assert.rejects(model.approve(f.fingerprint,f.scopeId,f.fingerprint,f.scope.roles),/E2EE_/);assert.equal(h.counts().rotations,0);
 }
});
test('private-effect refusal and foreign ownership cannot release a new root',async()=>{
 const f=await membershipRuntime(),h=ownerModel(f,{reviewEffects:async()=>{throw new Error('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');}}),model=h.model();await upload(model,f);
 await assert.rejects(model.approve(f.fingerprint,f.scopeId,f.fingerprint,f.scope.roles),/E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE/);
 assert.equal(h.counts().rotations,0);assert(!h.rows.has(membershipAtomicOwnerId(f.ownerId,f.fingerprint,2,membershipAtomicOwnerScopeSuffix(f.scopeId))));
 const other=ownerModel(f,{ownerId:'foreign-owner'}),foreign=other.model();await upload(foreign,f);
 await assert.rejects(foreign.approve(f.fingerprint,f.scopeId,f.fingerprint,f.scope.roles),/E2EE_MEMBERSHIP_REVIEW_MISMATCH/);assert.equal(other.counts().rotations,0);
});
test('observed completed rotation makes the old review stale without losing its exact exportable approval',async()=>{
 const f=await membershipRuntime(),h=ownerModel(f),model=h.model();await upload(model,f);const approved=await model.approve(f.fingerprint,f.scopeId,f.fingerprint,f.scope.roles);
 await f.commit();await assert.rejects(h.model().approve(f.fingerprint,f.scopeId,f.fingerprint,f.scope.roles),/E2EE_MEMBERSHIP_STALE/);
 assert.deepEqual(await h.model().exportApproval(f.fingerprint,f.scopeId),approved);assert.equal(h.counts().rotations,1);
});

async function verifier(f,outcome,scope){
 const model=new MembershipAtomicReceiptVerifier(f.plan,outcome.packetRefs,outcome.receipt,{current:()=>{},peers:f.peers,scope,product:async()=>{throw new Error('Unexpected product');}});
 f.pages.forEach((page,index)=>model.planPage(index,page));await model.packetPage(0,outcome.packetPage);await model.seal();return model;
}
test('a signed receipt cannot acknowledge before mandatory readback; failed readback can be retried',async()=>{
 const f=await membershipRuntime(),outcome=await f.commit();let refuse=true,reads=0;
 const model=await verifier(f,outcome,async()=>{reads++;if(refuse)throw new Error('SYNTHETIC_READBACK_FAILURE');});
 await assert.rejects(model.finish(),/E2EE_INVALID_RECEIPT/);await assert.rejects(model.consume(0,outcome.receiptPage),/SYNTHETIC_READBACK_FAILURE/);
 await assert.rejects(model.finish(),/E2EE_INVALID_RECEIPT/);refuse=false;
 await model.consume(0,outcome.receiptPage);assert.deepEqual(await model.finish(),outcome.receipt);assert.equal(reads,2);
 await model.consume(0,outcome.receiptPage);assert.equal(reads,2);
});
test('membership root release opens future content for the survivor and refuses the removed device',async()=>{
 const f=await membershipRuntime(),outcome=await f.commit(),capsule=f.rotation.command.payload.capsules[0].capsule,context=f.rootContext(2,'review-root-two','review-owner-device');
 const root=await openRoot(capsule,f.owner.receiving.privateKey,context);
 await assert.rejects(openRoot(capsule,f.member.receiving.privateKey,context));
 const header={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:f.ownerId,scopeId:f.scopeId,domain:'shared-project',objectId:'membership-future',schemaVersion:1,dataGeneration:1,
  writerProtocol:9,cryptoEpoch:2,securityEpoch:2,revision:1,keyId:'review-root-two',deviceId:'review-owner-device',operationId:'membership-write'};
 const bytes=new TextEncoder().encode('PRIVATE MEMBERSHIP FUTURE');const envelope=await sealE2eeEnvelope(root,f.owner.signing.privateKey,header,bytes);
 assert.deepEqual(await openE2eeEnvelope(root,f.owner.signing.publicKey,header,envelope),bytes);
 const model=await verifier(f,outcome,async(packet)=>{assert.deepEqual(packet,f.rotation);await openRoot(packet.command.payload.capsules[0].capsule,f.owner.receiving.privateKey,context);});
 await model.consume(0,outcome.receiptPage);assert.deepEqual(await model.finish(),outcome.receipt);
});
