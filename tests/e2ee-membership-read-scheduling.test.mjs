import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {MembershipOperationDrafts} from '../app/e2ee/membership-operation-drafts.ts';
import {membershipBeforeHash} from '../app/e2ee/membership-contract.ts';
import {E2eeMembershipProduct} from '../app/e2ee/membership-product.ts';
import {E2eeReadRateError} from '../app/e2ee/read-rate-retry.ts';

const ownerId='schedule-owner';
const operation={kind:'space-role',spaceId:'schedule-space',userId:'schedule-member',role:'guest'};
function fixture(){
 const rows=new Map(),started=Promise.withResolvers(),held=Promise.withResolvers();
 let open=true,captures=0;
 const current=()=>{if(!open)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const drafts=new MembershipOperationDrafts({ownerId,current,
  load:async id=>structuredClone(rows.get(id)??null),list:async()=>[...rows.keys()],
  save:async(id,value,expected)=>{assert.equal(rows.get(id)?.serial??null,expected);const serial=(expected??0)+1;rows.set(id,{value:structuredClone(value),serial});return serial;},
  capture:async()=>{current();captures++;started.resolve();return held.promise;},
 });
 return{drafts,rows,started,held,close(){open=false;},get captures(){return captures;}};
}

test('an unfinished read-only access probe does not block durable membership intent or its review entry',async()=>{
 const f=fixture(),probe=f.drafts.snapshot(operation),refusal=assert.rejects(probe,/SYNTHETIC_READ_UNAVAILABLE/);
 await f.started.promise;
 const id='independent-membership-intent';let inspected=false,unreviewedRefused=false;
 const creation=f.drafts.create(operation,id);
 const inspection=f.drafts.inspect(id).then(value=>{inspected=true;assert.equal(value.proposal,null);assert.equal(value.review,null);assert.equal(value.started,false);return value;});
 const unreviewed=assert.rejects(f.drafts.start(id),/E2EE_MEMBERSHIP_REVIEW_REQUIRED/).then(()=>{unreviewedRefused=true;});
 await setImmediate();const savedBeforeReadSettled=f.rows.has(id),enteredBeforeReadSettled=inspected;
 const refusedBeforeReadSettled=unreviewedRefused;
 f.held.reject(new Error('SYNTHETIC_READ_UNAVAILABLE'));await refusal;await creation;await inspection;await unreviewed;
 assert.equal(savedBeforeReadSettled,true,'The durable intent must not wait for unrelated network IO');
 assert.equal(enteredBeforeReadSettled,true,'The review entry must be able to inspect its saved intent');
 assert.equal(refusedBeforeReadSettled,true,'An unrelated probe cannot approve or start the new operation');assert.equal(f.captures,1);
 assert.deepEqual((await f.drafts.follow(id)).operation,operation);
});

test('read-only probes retain the current-account guard before starting any capture',async()=>{
 const f=fixture();f.close();await assert.rejects(f.drafts.snapshot(operation),/E2EE_ACCOUNT_CHANGED/);
 assert.equal(f.captures,0);assert.equal(f.rows.size,0);
});

test('an account change during a read refuses its result before adopting or parsing another owner data',async()=>{
 const f=fixture(),probe=f.drafts.snapshot(operation),refusal=assert.rejects(probe,/E2EE_ACCOUNT_CHANGED/);
 await f.started.promise;f.close();f.held.resolve({untrusted:'late response'});await refusal;
 assert.equal(f.rows.size,0);
});

test('membership graph and state retry read quotas with the same validated target',async()=>{
 const target={table:'shared_space_members',key:{space_id:operation.spaceId,user_id:operation.userId}};
 const row={...target,before:null,beforeHash:membershipBeforeHash(target.table,null)};
 let graphReads=0,stateReads=0;
 const transport={
  async membershipGraph(spaceId){
   assert.equal(this,transport);assert.equal(spaceId,operation.spaceId);
   if(++graphReads===1)throw new E2eeReadRateError(0);
   return {spaceId};
  },
  async membershipState(targets){
   assert.deepEqual(structuredClone(targets),[target]);
   if(++stateReads===1)throw new E2eeReadRateError(0);
   return {rows:[row]};
  },
 };
 const membership=new E2eeMembershipProduct({}, {}, transport, async()=>{}, ()=>{});
 assert.deepEqual(await membership.graph(operation.spaceId),{spaceId:operation.spaceId});
 assert.deepEqual(structuredClone(await membership.readState([target])),[row]);
 assert.equal(graphReads,2);assert.equal(stateReads,2);
});
