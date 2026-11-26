// Offline SYNTHETIC interoperability vector. Never import into runtime or use these keys.
import { createCipheriv, createECDH, createPrivateKey, createPublicKey, createHash, sign } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const rootKey = Buffer.from(Array.from({length:32}, (_, i) => i));
const dataKey = Buffer.from('00112233445566778899aabbccddeeff000102030405060708090a0b0c0d0e0f', 'hex');
const nonce = Buffer.from(Array.from({length:12}, (_, i) => 0x80 + i));
const scalar = Buffer.alloc(32, 1);
const ec = createECDH('prime256v1'); ec.setPrivateKey(scalar);
const point = ec.getPublicKey();
const key = createPrivateKey({ format:'jwk', key:{kty:'EC',crv:'P-256',
  x:point.subarray(1,33).toString('base64url'), y:point.subarray(33).toString('base64url'), d:scalar.toString('base64url')} });
const context = {cryptoProtocol:1,suite:'A256KW-A256GCM-ES256',ownerId:'synthetic-owner',scopeId:'synthetic-owner',
  domain:'workspace',objectId:'synthetic-workspace',schemaVersion:1,dataGeneration:4294967297,writerProtocol:9,
  cryptoEpoch:2,securityEpoch:3,revision:7,keyId:'synthetic-root-2',deviceId:'synthetic-device-1',
  operationId:'00000000-0000-4000-8000-000000000001'};
const numeric = new Set(['cryptoProtocol','schemaVersion','dataGeneration','writerProtocol','cryptoEpoch','securityEpoch','revision']);
const aad = input => Buffer.concat([Buffer.from('GENESIS-E2EE-AAD\0v1\0'), ...Object.entries(input).map(([name,value]) => {
  if(numeric.has(name)) {const result=Buffer.alloc(8);result.writeBigUInt64BE(BigInt(value));return result;}
  const bytes=Buffer.from(value), length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);return Buffer.concat([length,bytes]);
})]);
const additionalData = aad(context);
const wrap = createCipheriv('id-aes256-wrap',rootKey,Buffer.alloc(8,0xa6));
const wrappedKey = Buffer.concat([wrap.update(dataKey),wrap.final()]);
// Independently published AES-256-KW test case: RFC3394 section 4.6.
assert.equal(wrappedKey.toString('hex'),'28c9f404c4b810f4cbccb35cfb87f8263f5786e2d80ed326cbc7f0e71a99f43bfb988b9b7a02dd21');
const plaintext = Buffer.from('{"text":"Synthetic E2EE / Синтетика / 日本語","tombstones":["deleted-fixture"]}');
const cipher = createCipheriv('aes-256-gcm',dataKey,nonce,{authTagLength:16});cipher.setAAD(additionalData);
const ciphertext = Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
const signatureData=Buffer.concat([Buffer.from('GENESIS-E2EE-SIGNATURE\0v1\0'),additionalData,wrappedKey,nonce,
  createHash('sha256').update(ciphertext).digest()]);
const signature = sign('sha256',signatureData,{key,dsaEncoding:'ieee-p1363'});
const fixture={warning:'PUBLIC SYNTHETIC TEST KEYS; NEVER USE FOR USER DATA',origin:'Node crypto + RFC3394 section 4.6',
  rootKey:rootKey.toString('base64url'),dataKey:dataKey.toString('base64url'),
  publicKeySpki:createPublicKey(key).export({format:'der',type:'spki'}).toString('base64url'),
  privateKeyPkcs8:key.export({format:'der',type:'pkcs8'}).toString('base64url'),
  publicKeyPem:createPublicKey(key).export({format:'pem',type:'spki'}),
  plaintext:plaintext.toString('base64url'),aad:additionalData.toString('base64url'),
  signatureData:signatureData.toString('base64url'),
  maxIntegerAad:aad({...context,revision:Number.MAX_SAFE_INTEGER}).toString('base64url'),
  envelope:{context,wrappedKey:wrappedKey.toString('base64url'),nonce:nonce.toString('base64url'),
    ciphertext:ciphertext.toString('base64url'),signature:signature.toString('base64url')}};
const directory=new URL('../../tests/fixtures/e2ee/',import.meta.url);mkdirSync(directory,{recursive:true});
writeFileSync(new URL('v1.json',directory),JSON.stringify(fixture,null,2)+'\n');
console.log('Synthetic E2EE fixture written; RFC3394 section 4.6 PASS. No production material read.');
