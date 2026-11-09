import assert from 'node:assert/strict';
import {test} from 'node:test';
import {billingReturnOrderId,billingReturnCloseUrl,billingReturnState} from '../app/billing-return.ts';

const id='12345678-1234-4234-8234-123456789abc';
test('payment return accepts an opaque order reference and closing preserves navigation and other parameters',()=>{
  assert.equal(billingReturnOrderId(`https://genesiscalendar.com/?other=1&billingOrder=${id}#settings/account`),id);
  for(const value of ['paid','../secret','<script>','',id+'extra'])assert.equal(billingReturnOrderId(`https://genesiscalendar.com/?billingOrder=${encodeURIComponent(value)}`),null);
  assert.equal(billingReturnCloseUrl(`https://genesiscalendar.com/path?other=1&billingOrder=${id}#settings/account`),'/path?other=1#settings/account');
});
test('settlement status outranks paid, and uncertain and unknown states never imply entitlement',()=>{
  const base={id,status:'paid',settlement:null};
  assert.deepEqual(billingReturnState(base),{message:'paymentPaid',poll:false,paid:true});
  for(const [status,message,poll]of [['verifying','settlementVerifying',true],['refund-required','settlementRefundPending',true],['refund-pending','settlementRefundPending',true],['refunded','settlementRefunded',false],['failed','settlementFailed',false],['cancelled','settlementCancelled',false],['unknown','settlementFailed',false]]){
    assert.deepEqual(billingReturnState({...base,settlement:{status}}),{message,poll,paid:false});
  }
  for(const status of ['pending','payment-verifying','settlement-required']){const state=billingReturnState({...base,status});assert.equal(state.paid,false);assert.equal(state.poll,true);}
  assert.deepEqual(billingReturnState({...base,status:'unknown'}),{message:'settlementFailed',poll:false,paid:false});
});
