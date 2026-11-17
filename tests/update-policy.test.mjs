import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedPolicy } from '../scripts/security/update-policy.mjs';
test('published update policy is independently signed and both activation floors are disabled',()=>{
  const signed=JSON.parse(readFileSync('public/android-security-policy.json','utf8'));
  const key=readFileSync('releases/android-security-policy-public.pem','utf8');
  const policy=verifiedPolicy(signed,key);
  for(const channel of ['site','play'])assert.deepEqual(policy.channels[channel],{minimumVersionCode:0,minimumCryptoProtocol:0});
  const bytes=Buffer.from(signed.payload,'base64');bytes[5]^=1;
  assert.throws(()=>verifiedPolicy({...signed,payload:bytes.toString('base64')},key));
});
