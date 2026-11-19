import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {collectLegacyArchiveFragments,LEGACY_ARCHIVE_TABLES} from '../app/e2ee/archive-fragments.ts';
const context={ownerId:'archive-owner',scopeId:'personal:archive-owner',migrationId:'archive-attempt',fence:4,sourceHash:'A'.repeat(43),generation:2};
const key=Buffer.alloc(32,7).toString('base64');
function fixture(){
 const rows={stages:[{id:'old-stage',payload_json:'[{ "section":"workspace", "private":"незавершённое 🌙" }]',payload_enc:'exact-old-wrapper',generation:0},
  {id:'uncertain-stage',payload_json:'[1,2,3]',payload_enc:'other-old-wrapper',generation:0}],safety:[{id:'old-safety',snapshot_json:'{ "workspace_blobs":[] }',snapshot_enc:'exact-safety-wrapper'}],
  receipts:[{operation_id:'exact-uncertain-operation',generation:0},{operation_id:'older-operation',generation:0}]};
 const raw={};const calls=[];let live=true,chunkBytes=13;
 const ports={assertCurrent(){if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},async readFragment(bound,table,offset,byteOffset){
  assert.deepEqual(bound,context);calls.push({table,offset,byteOffset});
  const totals=Object.fromEntries(LEGACY_ARCHIVE_TABLES.map(name=>[name,rows[name].length]));
  const bytes=rows[table].length?Buffer.from(raw[table+':'+offset]??JSON.stringify(rows[table][offset])):Buffer.alloc(0),chunk=bytes.subarray(byteOffset,byteOffset+chunkBytes),next=byteOffset+chunk.length;
  return{protocol:1,ownerId:context.ownerId,scopeId:context.scopeId,migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,
   legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,encoding:'utf8-json-fragments-v1',table,offset,byteOffset,totals,
   rowBytes:bytes.length,rowHash:bytes.length?createHash('sha256').update(bytes).digest('base64url'):null,chunk:chunk.toString('base64url'),
   nextByteOffset:next<bytes.length?next:null,nextOffset:next<bytes.length?offset:offset+1<totals[table]?offset+1:null,
   legacyKey:bytes.length&&table!=='receipts'?{keyMode:'account',key}:{keyMode:'empty',key:null}};
 }};
 return{rows,raw,ports,calls,lock(){live=false;},chunkSize(value){chunkBytes=value;},run:options=>collectLegacyArchiveFragments(context,ports,options)};
}
test('archive fragments preserve every exact row and raw nested JSON across UTF-8 byte boundaries without replay',async()=>{
 const f=fixture();f.chunkSize(1);const result=await f.run();for(const table of LEGACY_ARCHIVE_TABLES)assert.deepEqual(result[table],f.rows[table]);
 assert.deepEqual(result.legacyKey,{keyMode:'account',key});assert.equal(result.stages[0].payload_json,f.rows.stages[0].payload_json);
 assert.ok(f.calls.some(value=>value.byteOffset>0));assert.ok(!Object.hasOwn(result,'chunk')&&!Object.hasOwn(result,'rowHash'));
});
test('explicit empty tables retain a bound header and never fabricate a row or old key',async()=>{
 const f=fixture();for(const table of LEGACY_ARCHIVE_TABLES)f.rows[table]=[];
 const result=await f.run();for(const table of LEGACY_ARCHIVE_TABLES)assert.deepEqual(result[table],[]);assert.deepEqual(result.legacyKey,{keyMode:'empty',key:null});assert.equal(f.calls.length,3);
});
for(const change of [p=>p.ownerId='foreign',p=>p.scopeId='foreign',p=>p.migrationId='foreign',p=>p.fence++,p=>p.sourceHash='B'.repeat(43),
 p=>p.encoding='future',p=>p.table='users',p=>p.offset++,p=>p.byteOffset++,p=>p.extra=true,p=>p.rowBytes=0,p=>p.chunk='',
 p=>p.nextByteOffset=0,p=>p.nextByteOffset++,p=>p.nextByteOffset=null,p=>p.nextOffset=1,p=>p.nextOffset=null,p=>p.rowHash='B'.repeat(43),
 p=>p.rowBytes=64*1024*1024+1,p=>p.chunk=Buffer.alloc(1024*1024+1).toString('base64url')])
 test('foreign altered or incomplete fragments never become a complete archive '+change.toString(),async()=>{
  const f=fixture(),read=f.ports.readFragment;f.ports.readFragment=async(...args)=>{const page=await read(...args);change(page);return page;};await assert.rejects(f.run(),/E2EE_/);
 });
for(const change of [p=>p.totals.safety++,p=>p.checkpointHash='B'.repeat(43),p=>p.directoryRevision++,p=>p.legacyGeneration++,p=>p.rowBytes++,
 p=>p.rowHash='B'.repeat(43),p=>p.legacyKey.key=Buffer.alloc(32,8).toString('base64')])
 test('changed identity lengths totals old keys and hashes cannot splice fragments '+change.toString(),async()=>{
  const f=fixture(),read=f.ports.readFragment;let index=0;f.ports.readFragment=async(...args)=>{const p=await read(...args);if(index++)change(p);return p;};await assert.rejects(f.run(),/E2EE_/);
 });
test('altered bytes with unchanged metadata fail the full row hash before returning any JSON',async()=>{
 const f=fixture(),read=f.ports.readFragment;f.ports.readFragment=async(...args)=>{const p=await read(...args);const bytes=Buffer.from(p.chunk,'base64url');bytes[0]^=1;p.chunk=bytes.toString('base64url');return p;};await assert.rejects(f.run(),/TRANSPORT_INVALID/);
});
test('duplicate top-level row fields refuse after the protected source rather than JSON.parse replacing a private value',async()=>{
 const f=fixture();f.raw['stages:0']='{"id":"one","id":"two","payload_json":"[]"}';await assert.rejects(f.run(),/TRANSPORT_INVALID/);
});
test('a switched owner stops after the response without returning or reading further source rows',async()=>{
 const f=fixture(),read=f.ports.readFragment;f.ports.readFragment=async(...args)=>{const p=await read(...args);f.lock();return p;};await assert.rejects(f.run(),/ACCOUNT_CHANGED/);assert.equal(f.calls.length,1);
});
test('a valid archive row beyond normal page size joins fully from bounded chunks',async()=>{
 const f=fixture();f.chunkSize(1024*1024);f.rows.stages=[{id:'large-retained-stage',payload_json:'["'+'x'.repeat(9*1024*1024)+'"]',payload_enc:'exact-old-wrapper'}];
 const result=await f.run();assert.equal(result.stages[0].payload_json.length,9*1024*1024+4);assert.equal(result.stages[0].payload_enc,'exact-old-wrapper');assert.ok(f.calls.filter(row=>row.table==='stages').length>8);
});
test('opaque native keys require explicit capability mode; missing web keys never invent an unlock',async()=>{
 const f=fixture(),read=f.ports.readFragment;f.ports.readFragment=async(...args)=>{const p=await read(...args);if(p.legacyKey.keyMode==='account')p.legacyKey.key=null;return p;};
 await assert.rejects(f.run(),/E2EE_/);const result=await f.run({opaqueKeys:true});assert.deepEqual(result.legacyKey,{keyMode:'account',key:null});
});
test('nonempty archives require old-key provenance while receipt-only rows never smuggle a key',async()=>{
 for(const table of ['stages','receipts']){
  const f=fixture(),read=f.ports.readFragment;f.ports.readFragment=async(...args)=>{const p=await read(...args);if(p.table===table)p.legacyKey=table==='stages'?{keyMode:'empty',key:null}:{keyMode:'account',key};return p;};await assert.rejects(f.run(),/TRANSPORT_INVALID/);
 }
});
