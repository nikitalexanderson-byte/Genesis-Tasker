import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {MembershipAtomicStager} from '../app/e2ee/membership-atomic-stager.ts';
import {membershipAtomicPageRef,membershipAtomicPlanHash} from '../app/e2ee/membership-atomic-contract.ts';
import {membershipAtomicLocalId,membershipAtomicLocalPageId,membershipAtomicLocalRequestId} from '../app/e2ee/membership-atomic-local.ts';
import {commandBytes} from '../app/e2ee/commands.ts';

const ownerId='stage-owner',deviceId='stage-device',intentId='stage-intent';
function fixture(){
 const pages=[{kind:'operation',items:[{kind:'project-remove',projectId:'stage-project',userId:'stage-member'}]},
  {kind:'anchors',items:[{scopeId:'project:stage-project',ownerId,kind:'project',resourceId:'stage-project',entityId:'project:stage-project',generation:1,directoryRevision:1,checkpointHash:'A'.repeat(43),revision:1,payloadHash:'A'.repeat(43),productIndexHash:'A'.repeat(43)}]}];
 const plan={format:'genesis-membership-atomic-plan-v2',actorId:ownerId,intentId,spaceId:'stage-space',reviewFingerprint:'A'.repeat(43),scopeIds:['project:stage-project'],pages:pages.map((page,i)=>membershipAtomicPageRef(i,page))};
 return {plan,pages};
}
function harness(){
 // Durable/CAS port model only; encrypted IDB and PHP acceptance are separate.
 const rows=new Map(),calls=[],signatures=[];let serial=0,current=true,failWrite=null,drop=null;
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const read=async id=>structuredClone(rows.get(id)??null);
 const write=async(id,value,expected)=>{if(failWrite?.(id,value))throw new Error('SYNTHETIC_WRITE_FAILURE');const prior=rows.get(id);assert.equal(prior?.serial??null,expected);const next=(expected??0)+1;rows.set(id,{serial:next,value:structuredClone(value)});return next;};
 function authorized(action,input){
  const payload=action==='membership-atomic-page'?{intentId:input.intentId,planHash:input.planHash,phase:input.phase,index:input.index,pageHash:membershipAtomicPageRef(input.index,input.page).pageHash}:
   {intentId:input.intentId??input.plan.intentId,planHash:input.planHash??membershipAtomicPlanHash(input.plan)};
  const saved=rows.get(membershipAtomicLocalRequestId(ownerId,action,payload));assert(saved,'Authorization must be durable before IO');
  assert.deepEqual(saved.value.packet,input.authorization);assert(verify('sha256',commandBytes(input.authorization.command),{key:keys.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(input.authorization.signature,'base64url')));
  calls.push({action,input:structuredClone(input)});
  if(drop?.(action,input)){drop=null;throw new Error('SYNTHETIC_LOST_ACK');}
 }
 const transport={
  membershipAtomicBegin:async input=>{authorized('membership-atomic-begin',input);return{intentId:input.plan.intentId,planHash:membershipAtomicPlanHash(input.plan),state:'staged'};},
  membershipAtomicPage:async input=>{authorized('membership-atomic-page',input);return{intentId:input.intentId,planHash:input.planHash,phase:input.phase,page:membershipAtomicPageRef(input.index,input.page)};},
  membershipAtomicCancel:async input=>{authorized('membership-atomic-cancel',input);return{intentId:input.intentId,planHash:input.planHash,state:'cancelled'};}
 };
 const ports={ownerId,deviceId,current:()=>{if(!current)throw new Error('E2EE_SESSION_CHANGED');},read,write,transport,
  sign:async(action,payload)=>{const command={protocol:1,ownerId,scopeId:'personal:'+ownerId,deviceId,action,expectedRevision:1,checkpointHash:'A'.repeat(43),securityEpoch:1,operationId:'signed-'+(++serial),payload:structuredClone(payload)};
   const packet={command,signature:sign('sha256',commandBytes(command),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};signatures.push(packet);return packet;}};
 return{rows,calls,signatures,ports,model:()=>new MembershipAtomicStager(ports),failWrite:fn=>{failWrite=fn;},drop:fn=>{drop=fn;},logout:()=>{current=false;}};
}

test('cold retry after a lost page ACK reuses the exact durable signed originals',async()=>{
 const h=harness(),value=fixture(),model=h.model();await model.create(value.plan,value.pages);
 h.drop((action,input)=>action==='membership-atomic-page'&&input.index===0);
 await assert.rejects(model.stagePlan(intentId),/SYNTHETIC_LOST_ACK/);
 const first=h.calls.find(c=>c.action==='membership-atomic-page').input.authorization;
 await h.model().stagePlan(intentId);
 const retry=h.calls.filter(c=>c.action==='membership-atomic-page'&&c.input.index===0);
 assert.equal(retry.length,2);assert.deepEqual(retry[1].input.authorization,first);
 assert.equal(h.signatures.length,3);assert.equal((await h.model().inspect(intentId)).ready,true);
});
test('an interrupted local save cannot send a partial plan and exact cold create resumes it',async()=>{
 const h=harness(),value=fixture(),model=h.model();h.failWrite(id=>id===membershipAtomicLocalPageId(ownerId,intentId,1));
 await assert.rejects(model.create(value.plan,value.pages),/SYNTHETIC_WRITE_FAILURE/);
 await assert.rejects(h.model().stagePlan(intentId),/E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED/);assert.equal(h.calls.length,0);
 assert.equal((await model.inspect(intentId)).ready,false);h.failWrite(null);
 await h.model().create(value.plan,value.pages);await h.model().stagePlan(intentId);assert.equal(h.calls.length,3);
});
test('a lost cancellation response keeps the fence through cold restart and reuses its authorization',async()=>{
 const h=harness(),value=fixture(),model=h.model();await model.create(value.plan,value.pages);
 h.drop(action=>action==='membership-atomic-cancel');await assert.rejects(model.cancel(intentId),/SYNTHETIC_LOST_ACK/);
 assert.equal((await h.model().inspect(intentId)).cancelRequested,true);
 await assert.rejects(h.model().stagePlan(intentId),/E2EE_MEMBERSHIP_CANCELLED/);
 const result=await h.model().cancel(intentId);assert.equal(result.state,'cancelled');assert.equal(h.signatures.length,1);
 assert.deepEqual(h.calls[0].input.authorization,h.calls[1].input.authorization);
 await h.model().cancel(intentId);assert.equal(h.calls.length,2);assert.equal((await model.inspect(intentId)).cancelled,true);
});
test('missing or substituted saved pages are refused before any transport or signing',async()=>{
 for(const damage of [h=>h.rows.delete(membershipAtomicLocalPageId(ownerId,intentId,1)),h=>{h.rows.get(membershipAtomicLocalPageId(ownerId,intentId,1)).value.page.items[0].ownerId='foreign-owner';}]){
  const h=harness(),value=fixture();await h.model().create(value.plan,value.pages);damage(h);
  await assert.rejects(h.model().stagePlan(intentId),/E2EE_/);assert.equal(h.calls.length,0);assert.equal(h.signatures.length,0);
 }
});
test('caller mutations after create cannot change persisted plan or page originals',async()=>{
 const h=harness(),value=fixture(),before=structuredClone(value),model=h.model();const creating=model.create(value.plan,value.pages);
 value.plan.scopeIds.push('project:foreign');value.pages[0].items[0].userId='foreign-member';await creating;
 await model.stagePlan(intentId);assert.deepEqual((await model.inspect(intentId)).plan,before.plan);
 assert.deepEqual(h.calls.find(c=>c.action==='membership-atomic-page').input.page,before.pages[0]);
});
test('a changed session and a foreign owner cannot authorize or overwrite the retained originals',async()=>{
 const h=harness(),value=fixture(),model=h.model();await model.create(value.plan,value.pages);const original=structuredClone([...h.rows]);h.logout();
 await assert.rejects(h.model().stagePlan(intentId),/E2EE_SESSION_CHANGED/);assert.deepEqual([...h.rows],original);assert.equal(h.calls.length,0);
 const foreign=new MembershipAtomicStager({...h.ports,ownerId:'foreign-owner',current:()=>{}});
 await assert.rejects(foreign.inspect(intentId),/E2EE_MEMBERSHIP_PLAN_REQUIRED/);
 assert.throws(()=>foreign.create(value.plan,value.pages),/E2EE_MEMBERSHIP_ATOMIC_INVALID/);
 assert(h.rows.has(membershipAtomicLocalId(ownerId,intentId)));
});
