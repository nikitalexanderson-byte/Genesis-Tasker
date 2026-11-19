import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptNativeBackupReply,assertNativeBackupSession} from '../app/backup-native-replies.ts';
test('a private reply is adopted only after checking its captured native operation token in the renderer',()=>{
 const value={private:'selected encrypted archive contents'},calls=[];
 assert.equal(acceptNativeBackupReply('request','original-job',{value},token=>{calls.push(token);return true;}),value);assert.deepEqual(calls,['original-job']);
});
test('an account change between Main dispatch and renderer adoption refuses every private reply kind',()=>{
 for(const method of ['request','capture','current','open','seal','retain','materialize','importChoose','importChunk','importClear','exportBegin','exportChunk','exportSave','operationBegin','reconcile']){
  let adopted=false;assert.throws(()=>{acceptNativeBackupReply(method,'old-job',{value:{private:'departed account'}},()=>false);adopted=true;},/BACKUP_OWNER/);assert.equal(adopted,false);
 }
});
test('failed native checks are bounded refusals and never disclose native exception details',()=>{
 const privateError='private old account key material';
 assert.throws(()=>acceptNativeBackupReply('open','old-job',{value:'private plaintext'},()=>{throw new Error(privateError);}),error=>error.message==='BACKUP_OWNER'&&!error.message.includes(privateError));
 assert.throws(()=>assertNativeBackupSession(()=>false,'old-job'),/BACKUP_OWNER/);assert.doesNotThrow(()=>assertNativeBackupSession(()=>true,''));
});
test('only exact empty cleanup and navigation receipts can finish after intentional gateway retirement',()=>{
 let checks=0;const expired=()=>{checks++;return false;};assert.equal(acceptNativeBackupReply('operationEnd','old-job',{value:true},expired),true);
 assert.deepEqual(acceptNativeBackupReply('restart','',{value:{}},expired),{});assert.equal(checks,0);
 for(const [method,value] of [['operationEnd',{private:'old content'}],['operationEnd',false],['restart',{private:'old content'}],['restart',true],['restart',[]]]){
  assert.throws(()=>acceptNativeBackupReply(method,'old-job',{value},expired),/BACKUP_TRANSFER/);
 }
});
test('malformed mixed or missing replies cannot resolve a pending operation',()=>{
 for(const response of [null,[],{},'value',{value:undefined},{value:true,error:'BACKUP_OWNER'},{value:true,extra:1},{other:'private'}]){
  assert.throws(()=>acceptNativeBackupReply('request','old-job',response,()=>true),/BACKUP_TRANSFER/);
 }
});
test('error receipts preserve bounded technical codes and never turn private text into an error string',()=>{
 assert.throws(()=>acceptNativeBackupReply('request','old-job',{error:'FEATURE_SUBSCRIPTION_REQUIRED'},()=>false),/FEATURE_SUBSCRIPTION_REQUIRED/);
 for(const error of ['private archive contents',1,'A'.repeat(129),'BACKUP_OWNER\nprivate']){
  assert.throws(()=>acceptNativeBackupReply('request','old-job',{error},()=>true),result=>result.message==='BACKUP_NATIVE_FAILED');
 }
});
