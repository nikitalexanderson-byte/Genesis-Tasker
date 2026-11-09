import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionReader,sessionEnvelope} from '../app/browser-session.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
test('focus, online and timer observers share a session check and cannot race an anonymous reply against a newer user',async()=>{
  const pending=deferred();let requests=0;const read=sessionReader(()=>{requests++;return pending.promise;});
  const checks=Array.from({length:5},()=>read());await Promise.resolve();assert.equal(requests,1);
  const profile={user:{uid:'alice'},csrf:'synthetic',loginId:'login-a'};pending.resolve(profile);
  assert.deepEqual(await Promise.all(checks),Array(5).fill(profile));
  await read();assert.equal(requests,2,'A completed check was cached instead of asking the server again');
});
test('unmounting an observer aborts its delivery without cancelling another observer',async()=>{
  const pending=deferred(),controller=new AbortController();const read=sessionReader(()=>pending.promise);
  const abandoned=read(controller.signal),active=read();controller.abort();
  await assert.rejects(abandoned,{name:'AbortError'});pending.resolve('still signed in');assert.equal(await active,'still signed in');
});
test('a failed check allows a retry and does not fabricate a signed-out response',async()=>{
  let attempts=0;const read=sessionReader(async()=>{if(++attempts===1)throw Error('network');return 'authenticated';});
  await assert.rejects(read(),/network/);assert.equal(await read(),'authenticated');
});
test('malformed successful payloads cannot be interpreted as a signed-out account',()=>{
  for(const value of [{},[],null,{user:undefined,csrf:'x'},{user:{uid:'alice'}},{user:{},csrf:'x'},{user:null,csrf:''},{user:null,csrf:'x',loginId:2}]){
    assert.throws(()=>sessionEnvelope(value),/INVALID_SESSION_RESPONSE/);
  }
  assert.deepEqual(sessionEnvelope({user:null,csrf:'valid'}),{user:null,csrf:'valid'});
  assert.equal(sessionEnvelope({user:{uid:'alice'},csrf:'valid',loginId:'login-a'}).user.uid,'alice');
});
