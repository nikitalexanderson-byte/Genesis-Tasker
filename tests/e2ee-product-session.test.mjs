import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 closePrivateAccount,privateAccountRequired,privateAccountView,requirePrivateAccount,subscribePrivateAccount,
} from '../app/e2ee/product-session.ts';

test('observing a locked account does not publish a new lock notification or reset its language',()=>{
 const owner='fixture-private-account';
 let notifications=0;
 const unsubscribe=subscribePrivateAccount(()=>{
  notifications++;
  if(notifications===1)assert.throws(()=>requirePrivateAccount(owner),/E2EE_UNLOCK_REQUIRED/);
 });
 try{
  privateAccountRequired(owner,'ru');
  assert.equal(notifications,1);
  const locked=privateAccountView();
  assert.deepEqual(locked,{ownerId:owner,phase:'locked',reason:'unlock',language:'ru'});
  privateAccountRequired(owner,'ru');
  assert.throws(()=>requirePrivateAccount(owner),/E2EE_UNLOCK_REQUIRED/);
  assert.strictEqual(privateAccountView(),locked);
  assert.equal(notifications,1);
 }finally{unsubscribe();closePrivateAccount();}
});
