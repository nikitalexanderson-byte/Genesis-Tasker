import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { E2EE_SUITE, E2EE_DOMAINS, E2EE_MAX_PLAINTEXT, e2eeAdditionalData, importE2eeRoot,
  encodeE2eeBytes, decodeE2eeBytes, validateE2eeContext, validateE2eeEnvelope,
  sealE2eeEnvelope, verifyE2eeEnvelope, openE2eeEnvelope } from '../app/e2ee/envelope.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1.json',import.meta.url),'utf8'));
const jcaFixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1-jca.json',import.meta.url),'utf8'));
const bytes=value=>Uint8Array.from(Buffer.from(value,'base64url'));
const context=fixture.envelope.context;
const root=()=>importE2eeRoot(bytes(fixture.rootKey));
const publicKey=()=>crypto.subtle.importKey('spki',bytes(fixture.publicKeySpki),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
const privateKey=()=>crypto.subtle.importKey('pkcs8',bytes(fixture.privateKeyPkcs8),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
const mutated=fn=>{const value=structuredClone(fixture.envelope);fn(value);return value;};
const flip=value=>{const data=bytes(value);data[0]^=1;return encodeE2eeBytes(data);};

test('independent Node/RFC3394 vector: canonical bytes, signature and multilingual plaintext',async()=>{
  assert.equal(encodeE2eeBytes(e2eeAdditionalData(context)),fixture.aad);
  assert.equal(encodeE2eeBytes(e2eeAdditionalData({...context,revision:Number.MAX_SAFE_INTEGER})),fixture.maxIntegerAad);
  const key=await root(); assert.equal(key.extractable,false);
  assert.deepEqual(await openE2eeEnvelope(key,await publicKey(),context,fixture.envelope),bytes(fixture.plaintext));
});

test('Kotlin/JCA sealed and signed vector opens in Web Crypto',async()=>{
  assert.equal(jcaFixture.rootFixture,'v1.json');
  assert.deepEqual(await openE2eeEnvelope(await root(),await publicKey(),context,jcaFixture.envelope),bytes(fixture.plaintext));
});

test('seal always creates fresh DEK and nonce; returned packet/context are immutable',async()=>{
  const key=await root(), signer=await privateKey(), peer=await publicKey(), plaintext=bytes(fixture.plaintext);
  const packets=await Promise.all(Array.from({length:32},()=>sealE2eeEnvelope(key,signer,context,plaintext)));
  assert.equal(new Set(packets.map(value=>value.wrappedKey)).size,32);
  assert.equal(new Set(packets.map(value=>value.nonce)).size,32);
  for(const packet of packets){
    assert.ok(Object.isFrozen(packet)&&Object.isFrozen(packet.context));
    assert.deepEqual(await openE2eeEnvelope(key,peer,context,packet),plaintext);
  }
  assert.equal(encodeE2eeBytes(plaintext),fixture.plaintext,'caller data was not zeroed');
});

test('context is snapshotted before async work, preventing caller mutation races',async()=>{
  const source={...context}, plaintext=bytes(fixture.plaintext), key=await root(), signer=await privateKey();
  const promise=sealE2eeEnvelope(key,signer,source,plaintext);
  source.ownerId='different-owner';plaintext.fill(0);
  const packet=await promise;
  assert.equal(packet.context.ownerId,context.ownerId);
  assert.deepEqual(await openE2eeEnvelope(key,await publicKey(),context,packet),bytes(fixture.plaintext));
});

for(const field of ['ownerId','scopeId','domain','objectId','schemaVersion','dataGeneration','cryptoEpoch',
  'securityEpoch','revision','keyId','deviceId','operationId']){
  test(`expected ${field} is bound; no server supplied context is trusted`,async()=>{
    const expected={...context,[field]:typeof context[field]==='number'?context[field]+1:field==='domain'?'diary':'changed-id'};
    await assert.rejects(openE2eeEnvelope(await root(),await publicKey(),expected,fixture.envelope),/E2EE_CONTEXT_MISMATCH/);
    const packet=mutated(value=>{value.context=expected;});
    await assert.rejects(verifyE2eeEnvelope(packet,expected,await publicKey()),/E2EE_CORRUPT_ENVELOPE/);
  });
}

for(const field of ['wrappedKey','nonce','ciphertext','signature']){
  test(`${field} tampering is rejected before returning plaintext`,async()=>{
    await assert.rejects(openE2eeEnvelope(await root(),await publicKey(),context,
      mutated(value=>{value[field]=flip(value[field]);})),/E2EE_CORRUPT_ENVELOPE/);
  });
}

test('wrong root and wrong signer never yield empty or replacement data',async()=>{
  const wrongRoot=await importE2eeRoot(new Uint8Array(32).fill(111));
  await assert.rejects(openE2eeEnvelope(wrongRoot,await publicKey(),context,fixture.envelope),/E2EE_CORRUPT_ENVELOPE/);
  const wrongSigner=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  await assert.rejects(openE2eeEnvelope(await root(),wrongSigner.publicKey,context,fixture.envelope),/E2EE_CORRUPT_ENVELOPE/);
});

test('valid device signature does not bypass KW/GCM authentication',async()=>{
  const key=createPrivateKey({key:Buffer.from(fixture.privateKeyPkcs8,'base64url'),type:'pkcs8',format:'der'});
  for(const field of ['wrappedKey','nonce','ciphertext']){
    const packet=mutated(value=>{value[field]=flip(value[field]);});
    const {createHash}=await import('node:crypto');
    const data=Buffer.concat([Buffer.from('GENESIS-E2EE-SIGNATURE\0v1\0'),e2eeAdditionalData(packet.context),
      bytes(packet.wrappedKey),bytes(packet.nonce),createHash('sha256').update(bytes(packet.ciphertext)).digest()]);
    packet.signature=sign('sha256',data,{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
    await verifyE2eeEnvelope(packet,context,await publicKey());
    await assert.rejects(openE2eeEnvelope(await root(),await publicKey(),context,packet),/E2EE_CORRUPT_ENVELOPE/);
  }
});

test('strict parser rejects unsupported versions, coercion, unknown fields, encodings and resource limits',()=>{
  const changes=[v=>v.context.suite='unknown',v=>v.context.cryptoProtocol=2,v=>v.context.writerProtocol=10,
    v=>v.context.domain='billing',v=>v.context.revision='7',v=>v.context.revision=1.5,v=>v.context.revision=0,
    v=>v.context.revision=Number.MAX_SAFE_INTEGER+1,v=>v.context.revision=NaN,v=>v.context.revision=Infinity,
    v=>v.context.ownerId='name\n',v=>v.context.ownerId='личные',v=>v.context.keyId='a'.repeat(129),
    v=>v.context.extra=1,v=>delete v.context.keyId,v=>v.extra=1,v=>delete v.wrappedKey,
    v=>v.nonce+='=',v=>v.nonce='!!!!',v=>v.nonce=123,v=>v.nonce=null,
    v=>v.wrappedKey=v.wrappedKey.slice(0,-1),v=>v.ciphertext='AA',v=>v.signature=v.signature.slice(0,-1),
    v=>v.ciphertext='A'.repeat(Math.ceil((E2EE_MAX_PLAINTEXT+17)*4/3))];
  for(const change of changes)assert.throws(()=>validateE2eeEnvelope(mutated(change)),/E2EE_INVALID_ENVELOPE/);
  // Non-zero unused base64 bits are not another spelling of the same bytes.
  assert.throws(()=>decodeE2eeBytes('AB',1),/E2EE_INVALID_ENVELOPE/);
  assert.equal(validateE2eeContext(context).suite,E2EE_SUITE);
  for(const domain of E2EE_DOMAINS)assert.equal(validateE2eeContext({...context,domain}).domain,domain);
});

test('empty content is authenticated and oversized content/key is rejected before encryption',async()=>{
  const key=await root(),signer=await privateKey(),peer=await publicKey();
  const packet=await sealE2eeEnvelope(key,signer,context,new Uint8Array());
  assert.equal(decodeE2eeBytes(packet.ciphertext,16).length,16);
  assert.equal((await openE2eeEnvelope(key,peer,context,packet)).length,0);
  await assert.rejects(importE2eeRoot(new Uint8Array(31)),/E2EE_INVALID_ENVELOPE/);
  await assert.rejects(sealE2eeEnvelope(key,signer,context,new Uint8Array(E2EE_MAX_PLAINTEXT+1)),/E2EE_INVALID_ENVELOPE/);
  const wrong=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-384'},false,['sign','verify']);
  await assert.rejects(verifyE2eeEnvelope(packet,context,wrong.publicKey),/E2EE_INVALID_ENVELOPE/);
});

test('parser snapshots data descriptors and rejects accessor/symbol/non-enumerable smuggling',()=>{
  let reads=0;
  const accessor=structuredClone(fixture.envelope);
  Object.defineProperty(accessor,'nonce',{enumerable:true,get(){reads++;return reads===1?fixture.envelope.nonce:123;}});
  assert.throws(()=>validateE2eeEnvelope(accessor),/E2EE_INVALID_ENVELOPE/);
  assert.equal(reads,0);
  const hidden=structuredClone(fixture.envelope);
  Object.defineProperty(hidden,'hidden',{value:'forbidden',enumerable:false});
  assert.throws(()=>validateE2eeEnvelope(hidden),/E2EE_INVALID_ENVELOPE/);
  const symbol=structuredClone(fixture.envelope);symbol[Symbol('hidden')]='forbidden';
  assert.throws(()=>validateE2eeEnvelope(symbol),/E2EE_INVALID_ENVELOPE/);
  const contextAccessor=structuredClone(fixture.envelope);
  Object.defineProperty(contextAccessor.context,'ownerId',{enumerable:true,get(){reads++;return 'swapped';}});
  assert.throws(()=>validateE2eeEnvelope(contextAccessor),/E2EE_INVALID_ENVELOPE/);
  assert.equal(reads,0);
  const revoked=Proxy.revocable(structuredClone(fixture.envelope),{});revoked.revoke();
  assert.throws(()=>validateE2eeEnvelope(revoked.proxy),/E2EE_INVALID_ENVELOPE/);
});

test('JSON integer decimal/exponent spellings canonicalize identically',async()=>{
  for(const spelling of ['7.0','7e0']){
    const packet=JSON.parse(JSON.stringify(fixture.envelope).replace('"revision":7',`"revision":${spelling}`));
    assert.equal(encodeE2eeBytes(e2eeAdditionalData(packet.context)),fixture.aad);
    await verifyE2eeEnvelope(packet,context,await publicKey());
  }
});
