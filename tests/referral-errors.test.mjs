import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {referralErrorKey} from '../app/referral-errors.ts';

test('Referral access restrictions give a specific recovery action instead of a network retry',()=>{
  assert.equal(referralErrorKey(403,'REFERRAL_PRIMARY_GOOGLE_REQUIRED'),'primaryRequired');
  assert.equal(referralErrorKey(403,'REFERRAL_STANDARD_REQUIRED'),'standardRequired');
  assert.equal(referralErrorKey(409,'REFERRAL_PRIVATE_PARTNER_PROGRAM'),'privateProgram');
});
test('Unknown or mismatched failures remain retryable without showing server details',()=>{
  for(const [status,code] of [[500,'REFERRAL_PRIMARY_GOOGLE_REQUIRED'],[403,'REFERRAL_PRIVATE_PARTNER_PROGRAM'],[401,'AUTH_REQUIRED'],[403,'PRIVATE_SERVER_DETAIL'],[undefined,undefined]])assert.equal(referralErrorKey(status,code),'error');
});
test('All 14 referral catalogs contain the access explanations used by web and Android',()=>{
  const copy=JSON.parse(readFileSync(new URL('../app/referral-copy.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(copy).length,14);
  for(const row of Object.values(copy))for(const key of ['primaryRequired','standardRequired','privateProgram'])assert.ok(typeof row[key]==='string'&&row[key].length>15,key);
});
