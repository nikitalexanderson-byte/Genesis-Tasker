// Next increment: wire ordering only. This memory port is NOT durable custody.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readE2eeJsonResponse} from '../app/e2ee/http-response.ts';
import {cloudSyncClient} from './helpers/cloud-sync-client.mjs';
const path='/e2ee/v1/read',headers={'Content-Type':'application/json; charset=utf-8'};
function observation(){
 const parts=[],events=[];let closed=false;
 return{parts,events,closed:()=>closed,port:{
  async begin(metadata){events.push(['begin',metadata.path,metadata.status]);},
  async append(bytes){assert.equal(closed,false);parts.push(new Uint8Array(bytes));events.push(['append',bytes.length]);},
  async finish(){events.push(['eof']);},
  close(){if(!closed){closed=true;events.push(['close']);}},
 }};
}
test('a complete raw observation precedes duplicate projection refusal and retains exact BOM whitespace and EOF',async()=>{
 const raw=new TextEncoder().encode('\ufeff {\r\n"sourceHash":"first", "sourceHash":"second"\n}'),f=observation();
 const response=new Response(new ReadableStream({start(controller){for(let at=0;at<raw.length;at+=3)controller.enqueue(raw.slice(at,at+3));controller.close();}}),{headers});
 await assert.rejects(readE2eeJsonResponse(response,path,()=>{},f.port),/E2EE_INVALID_RESPONSE/);
 assert.deepEqual(f.events[0],['begin',path,200]);assert.deepEqual(f.events.slice(-2),[['eof'],['close']]);
 assert.deepEqual(Buffer.concat(f.parts),Buffer.from(raw));assert.equal(f.closed(),true);
});

test('bounded observation loans cannot mutate parser input and expire even on successful acknowledgement',async()=>{
 const f=observation(),raw=JSON.stringify({sourceHash:'original',padding:'a'.repeat(200000)}),loans=[];
 const append=f.port.append;f.port.append=async bytes=>{assert.ok(bytes.length<=65536);await append(bytes);loans.push(bytes);bytes.fill(32);};
 const result=await readE2eeJsonResponse(new Response(raw,{headers}),path,()=>{},f.port);
 assert.equal(result.sourceHash,'original');assert.equal(result.padding.length,200000);assert.equal(Buffer.concat(f.parts).toString(),raw);
 assert.ok(loans.every(value=>value.every(byte=>byte===0)));assert.equal(f.closed(),true);
});

test('actual authenticated fetch registers the exact immutable request before networking and captures before parsing',async()=>{
 const f=await cloudSyncClient(),capture=observation(),body={command:{action:'legacy-workspace',scopeId:'personal:original'}};let prepared;
 capture.port.prepare=async request=>{assert.equal(Object.isFrozen(request),true);assert.equal(f.requests.length,0);prepared=request;body.command.scopeId='personal:changed';};
 f.respond((url,init)=>{assert.equal(prepared.path,'/e2ee/v1/read');assert.equal(prepared.method,'POST');assert.equal(init.body,prepared.body);assert.ok(!init.body.includes('changed'));return new Response('\ufeff {"sourceHash":"first","sourceHash":"second"}',{headers});});
 await assert.rejects(f.client.e2eeRequest('/read',body,undefined,capture.port),/E2EE_INVALID_RESPONSE/);
 assert.deepEqual(capture.events.slice(-2),[['eof'],['close']]);assert.equal(capture.closed(),true);assert.equal(f.requests.length,1);
});

test('failed request registration closes the observation and forbids authenticated fetch',async()=>{
 const f=await cloudSyncClient(),capture=observation(),before=new Map(f.storage.data);
 capture.port.prepare=async()=>{throw new Error('E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE');};
 f.respond(()=>{throw new Error('Unexpected network');});
 await assert.rejects(f.client.e2eeRequest('/read',{},undefined,capture.port),/E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE/);
 assert.equal(f.requests.length,0);assert.equal(capture.closed(),true);assert.deepEqual(f.storage.data,before);
});

test('retirement during real request registration closes the observation before any legacy read is sent',async()=>{
 const f=await cloudSyncClient(),capture=observation();
 f.respond(url=>{assert.equal(new URL(url).pathname,'/api/session');return Response.json({user:{uid:'retired-new-owner'},csrf:'new-csrf',loginId:'new-login'});});
 capture.port.prepare=async()=>{await f.client.loadGenesisSession();};
 await assert.rejects(f.client.e2eeRequest('/read',{},undefined,capture.port));
 assert.equal(f.requests.length,1);assert.equal(capture.closed(),true);assert.equal(capture.parts.length,0);
});
test('a failed original write cannot yield parsed success and cannot declare a captured prefix complete',async()=>{
 const f=observation(),response=new Response('{"sourceHash":"synthetic"}',{headers});
 const append=f.port.append;f.port.append=async bytes=>{await append(bytes);throw new Error('E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE');};
 await assert.rejects(readE2eeJsonResponse(response,path,()=>{},f.port),/E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE/);
 assert.equal(f.parts.length,1);assert.equal(f.events.some(row=>row[0]==='eof'),false);assert.equal(response.body.locked,false);assert.equal(f.closed(),true);
});
test('retirement during awaited raw acknowledgement refuses before decoding and preserves the acknowledged original',async()=>{
 const f=observation(),raw=new TextEncoder().encode('{"sourceHash":"synthetic"}');let active=true;
 const append=f.port.append;f.port.append=async bytes=>{await append(bytes);active=false;};
 const response=new Response(raw.slice(),{headers});
 await assert.rejects(readE2eeJsonResponse(response,path,()=>{if(!active)throw new Error('E2EE_ACCOUNT_CHANGED');},f.port),/E2EE_ACCOUNT_CHANGED/);
 assert.deepEqual(Buffer.concat(f.parts),Buffer.from(raw));assert.equal(f.events.some(row=>row[0]==='eof'),false);assert.equal(f.closed(),true);
});
