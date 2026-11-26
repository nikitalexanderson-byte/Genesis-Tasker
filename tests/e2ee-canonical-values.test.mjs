import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {canonicalE2eeValue,decodeCanonicalE2eeValue} from '../app/e2ee/commands.ts';

const vectors=JSON.parse(readFileSync(new URL('./fixtures/e2ee/canonical-values-v1.json',import.meta.url),'utf8'));
test('tagged technical values match independently enumerated cross-platform bytes',()=>{
 for(const row of vectors.valid){
  const wire=Buffer.from(row.hex,'hex');assert.deepEqual(Buffer.from(canonicalE2eeValue(row.value)),wire,row.name);
  const decoded=decodeCanonicalE2eeValue(wire);assert.deepEqual(JSON.parse(JSON.stringify(decoded)),row.value,row.name);
  assert.deepEqual(Buffer.from(canonicalE2eeValue(decoded)),wire,row.name);
  // Every proper prefix is incomplete; no missing scalar/length becomes empty.
  for(let size=0;size<wire.length;size++)assert.throws(()=>decodeCanonicalE2eeValue(wire.subarray(0,size)),/E2EE_INVALID_COMMAND/,`${row.name}:${size}`);
 }
});
test('malformed, duplicate, noncanonical and overlong tagged values refuse',()=>{
 for(const row of vectors.invalid)assert.throws(()=>decodeCanonicalE2eeValue(Buffer.from(row.hex,'hex')),/E2EE_INVALID_COMMAND/,row.name);
 let depth=Buffer.from('00','hex');for(let index=0;index<17;index++)depth=Buffer.concat([Buffer.from('0500000001','hex'),depth]);
 assert.throws(()=>decodeCanonicalE2eeValue(depth),/E2EE_INVALID_COMMAND/);
 for(const maximum of [0,-1,0.5,6*1024*1024+1,NaN])assert.throws(()=>decodeCanonicalE2eeValue(Uint8Array.of(0),maximum),/E2EE_INVALID_COMMAND/);
 assert.throws(()=>decodeCanonicalE2eeValue(Buffer.from('040000000161','hex'),5),/E2EE_INVALID_COMMAND/);
});
test('decoder respects a borrowed byte view and never writes into its input',()=>{
 const wire=Buffer.from('ff0400000003616263ff','hex'),before=Buffer.from(wire);
 assert.equal(decodeCanonicalE2eeValue(wire.subarray(1,-1)),'abc');assert.deepEqual(wire,before);
});
