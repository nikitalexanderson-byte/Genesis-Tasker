import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {streamNativeSourceResults}=calendarModule('app/e2ee/native-source-stream.ts');
const CHUNK=256*1024;
const row=(id,bytes)=>({domain:'mindmap',objectId:id,bytes,filename:'',mediaType:'application/json'});

test('large output uses consecutive bounded backpressured parts with exact hashes and explicit placements',async()=>{
 const large=new Uint8Array(17*1024*1024+29);for(let i=0;i<large.length;i++)large[i]=(i*7)%251;
 const original=new Uint8Array(large),local=new TextEncoder().encode('Device-only original work'),messages=[];let pending=0;
 const counts=await streamNativeSourceResults({content:[row('remote',large)],localContent:[row('local',local)]},async part=>{
  assert.equal(pending++,0);await Promise.resolve();messages.push(structuredClone(part));pending--;return true;
 },()=>{});
 assert.deepEqual(counts,{remoteCount:1,localCount:1});const parts=messages.filter(p=>p.sequence===0),restored=Buffer.concat(parts.map(p=>Buffer.from(p.bytes,'base64url')));
 assert.deepEqual(restored,Buffer.from(original));assert.equal(parts.length,Math.ceil(original.length/CHUNK));assert.equal(parts.at(-1).last,true);
 const hash=createHash('sha256').update(original).digest('base64url');
 for(let index=0;index<parts.length;index++){assert.equal(parts[index].index,index);assert.equal(parts[index].size,original.length);assert.equal(parts[index].last,index===parts.length-1);assert.equal(parts[index].placement,'remote');assert.equal(parts[index].hash,hash);assert.ok(Buffer.from(parts[index].bytes,'base64url').length<=CHUNK);}
 assert.equal(messages.at(-1).sequence,1);assert.equal(messages.at(-1).placement,'local');assert.equal(Buffer.from(messages.at(-1).bytes,'base64url').toString(),'Device-only original work');
 assert.ok(large.every(byte=>byte===0)&&local.every(byte=>byte===0));
});
test('empty content and aliased legitimate buffers preserve all logical bytes until the entire transfer ends',async()=>{
 const bytes=new TextEncoder().encode('Shared original content'),messages=[];
 await streamNativeSourceResults({content:[row('first',bytes),row('second',bytes.subarray(7)),row('empty',new Uint8Array())]},async part=>{messages.push(part);return true;},()=>{});
 assert.equal(Buffer.from(messages[0].bytes,'base64url').toString(),'Shared original content');assert.equal(Buffer.from(messages[1].bytes,'base64url').toString(),'original content');
 assert.equal(messages[2].bytes,'');assert.equal(messages[2].last,true);assert.equal(messages[2].hash,createHash('sha256').update('').digest('base64url'));assert.ok(bytes.every(byte=>byte===0));
});
test('refused acknowledgement or an account change aborts and wipes both sent and unsent private buffers',async()=>{
 for(const mode of ['ack','account']){let live=true,calls=0;const first=new Uint8Array(CHUNK+1).fill(19),second=new Uint8Array(32).fill(27);
  await assert.rejects(streamNativeSourceResults({content:[row('one',first)],localContent:[row('two',second)]},async()=>{calls++;if(mode==='account')live=false;return mode!=='ack';},()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');}),/E2EE_/);
  assert.equal(calls,1);assert.ok(first.every(byte=>byte===0)&&second.every(byte=>byte===0));
 }
});
test('duplicate logical content and oversized metadata refuse before crossing the bridge',async()=>{
 for(const alter of [rows=>rows.push(row('one',new Uint8Array(8))),rows=>rows[0].filename='x'.repeat(513)]){const rows=[row('one',new Uint8Array(8).fill(99))];alter(rows);let calls=0;
  await assert.rejects(streamNativeSourceResults({content:rows},async()=>{calls++;return true;},()=>{}),/E2EE_/);assert.equal(calls,0);assert.ok(rows.every(r=>r.bytes.every(byte=>byte===0)));
 }
});
