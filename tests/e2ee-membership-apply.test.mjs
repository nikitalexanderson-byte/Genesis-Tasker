import assert from 'node:assert/strict';
import {test} from 'node:test';
import {membershipRuntime,durableRows} from './helpers/membership-runtime.mjs';
import {MembershipAtomicStager} from '../app/e2ee/membership-atomic-stager.ts';
import {MembershipAtomicApply,membershipAtomicFinalReviewFingerprint} from '../app/e2ee/membership-atomic-apply.ts';
import {membershipAtomicPageRef,membershipAtomicPlanHash,membershipAtomicBatchHash} from '../app/e2ee/membership-atomic-contract.ts';
import {signE2eeCommand} from '../app/e2ee/commands.ts';
import {openRoot} from '../app/e2ee/keys.ts';

async function harness(){
 const f=await membershipRuntime(),local=durableRows(),calls=[];let serial=0,committed=null,dropCommit=false,refuseReadback=false,reads=0,acks=0;
 const sign=async(action,payload)=>signE2eeCommand({protocol:1,ownerId:f.ownerId,scopeId:'personal:'+f.ownerId,deviceId:'review-owner-device',action,
  expectedRevision:1,checkpointHash:'A'.repeat(43),securityEpoch:1,operationId:'apply-auth-'+(++serial),payload},f.owner.signing.privateKey);
 const transport={
  membershipAtomicBegin:async input=>{calls.push({action:'begin'});return{intentId:input.plan.intentId,planHash:membershipAtomicPlanHash(input.plan),state:'staged'};},
  membershipAtomicPage:async input=>({intentId:input.intentId,planHash:input.planHash,phase:input.phase,page:membershipAtomicPageRef(input.index,input.page)}),
  membershipAtomicSeal:async input=>({intentId:input.intentId,planHash:input.planHash,batchHash:membershipAtomicBatchHash(f.plan,input.packetPages),state:'sealed'}),
  membershipAtomicCommit:async input=>{calls.push({action:'commit',input:structuredClone(input)});
   if(committed)assert.deepEqual(input,committed.input);else committed={input:structuredClone(input),outcome:await f.commit()};
   if(dropCommit){dropCommit=false;throw new Error('SYNTHETIC_COMMIT_ACK_LOST');}return structuredClone(committed.outcome.receipt);},
  membershipAtomicReceipt:async input=>{calls.push({action:'receipt'});assert(committed);assert.equal(input.planHash,committed.input.planHash);return structuredClone(committed.outcome.receipt);},
  membershipAtomicReceiptPage:async input=>({...Object.fromEntries(['intentId','planHash','batchHash','index'].map(key=>[key,input[key]])),page:structuredClone(committed.outcome.receiptPage)}),
  membershipAtomicCancel:async input=>({intentId:input.intentId,planHash:input.planHash,state:'cancelled'})
 };
 const stagePorts={ownerId:f.ownerId,deviceId:'review-owner-device',current:()=>{},...local,sign,transport};
 const stager=new MembershipAtomicStager(stagePorts);await stager.create(f.plan,f.pages);await stager.createPackets(f.plan.intentId,[{kind:'rotation-packets',items:[f.rotation]}]);
 const ports={...stagePorts,stager,peers:f.peers,list:()=>local.list('membership-atomic-apply:'),scope:async packet=>{
  reads++;if(refuseReadback)throw new Error('SYNTHETIC_READBACK_FAILURE');assert.deepEqual(packet,f.rotation);
  await openRoot(packet.command.payload.capsules[0].capsule,f.owner.receiving.privateKey,f.rootContext(2,'review-root-two','review-owner-device'));},
  product:async()=>{throw new Error('Unexpected product');},acl:async()=>{acks++;}};
 const model=()=>new MembershipAtomicApply(ports);
 return{f,local,calls,stager,model,counts:()=>({reads,acks}),drop:()=>{dropCommit=true;},refuse:value=>{refuseReadback=value;},confirmed:async()=>{
  const manifest=await stager.readPacketManifest(f.plan.intentId);return model().confirm(f.plan.intentId,membershipAtomicFinalReviewFingerprint(membershipAtomicPlanHash(f.plan),manifest.batchHash));}};
}

test('a lost final ACK resumes with the same signed POST, no restaging, and complete verified readback',async()=>{
 const h=await harness(),id=h.f.plan.intentId;await h.confirmed();const originalKeys=[...h.local.rows.keys()];h.drop();
 await assert.rejects(h.model().submit(id),/SYNTHETIC_COMMIT_ACK_LOST/);assert.equal((await h.model().inspect(id)).complete,false);assert.equal(h.counts().acks,0);
 const starts=h.calls.filter(row=>row.action==='begin').length;const receipt=await h.model().submit(id);
 assert.equal(h.calls.filter(row=>row.action==='begin').length,starts);const commits=h.calls.filter(row=>row.action==='commit');assert.equal(commits.length,2);assert.deepEqual(commits[0].input,commits[1].input);
 assert.equal((await h.model().inspect(id)).complete,true);assert.equal(h.counts().acks,1);assert.equal(h.counts().reads,1);
 assert.deepEqual(await h.model().submit(id),receipt);assert.equal(h.calls.filter(row=>row.action==='commit').length,2);
 for(const key of originalKeys)assert(h.local.rows.has(key),'Original plan/packet/consent must survive completion');
});
test('a received receipt with failed readback stays incomplete and cold retry never executes the transaction again',async()=>{
 const h=await harness(),id=h.f.plan.intentId;await h.confirmed();h.refuse(true);
 await assert.rejects(h.model().submit(id),/SYNTHETIC_READBACK_FAILURE/);const pending=await h.model().inspect(id);assert(pending.receipt);assert.equal(pending.complete,false);assert.equal(h.counts().acks,0);
 h.refuse(false);await h.model().submit(id);assert.equal((await h.model().inspect(id)).complete,true);assert.equal(h.calls.filter(row=>row.action==='commit').length,1);
 assert.equal(h.counts().reads,2);assert.equal(h.counts().acks,1);
});
test('final apply requires separate compared consent and a cancelled plan cannot obtain it',async()=>{
 const h=await harness(),id=h.f.plan.intentId;
 await assert.rejects(h.model().submit(id),/E2EE_MEMBERSHIP_FINAL_REVIEW_REQUIRED/);
 await assert.rejects(h.model().confirm(id,'A'.repeat(43)),/E2EE_MEMBERSHIP_REVIEW_MISMATCH/);assert.equal(h.calls.length,0);
 await h.stager.cancel(id);await assert.rejects(h.confirmed(),/E2EE_MEMBERSHIP_CANCELLED/);assert.equal(h.calls.filter(row=>row.action==='commit').length,0);
});
