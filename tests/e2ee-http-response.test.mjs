import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {e2eeResponseLimit,isE2eeResponsePath,readE2eeJsonResponse} from '../app/e2ee/http-response.ts';
import {cloudSyncClient,deferred} from './helpers/cloud-sync-client.mjs';

const headers={'Content-Type':'application/json; charset=utf-8'},path='/e2ee/v1/source';
function streamed(parts,options={}){let at=0,cancelled=false;const loans=[];
 const stream=new ReadableStream({pull(controller){if(at===parts.length){controller.close();return;}const bytes=new Uint8Array(parts[at++]);loans.push(bytes);controller.enqueue(bytes);},cancel(){cancelled=true;}});
 return{response:new Response(stream,{status:options.status??200,headers:{...headers,...options.headers}}),loans,cancelled:()=>cancelled};
}
test('E2EE raw response limits match native routes and bound error bodies separately',()=>{
 assert.equal(e2eeResponseLimit('/e2ee/v1/read',200),16*1024*1024);assert.equal(e2eeResponseLimit('/e2ee/v1/directory',200),32*1024*1024);
 for(const suffix of ['source','status','bootstrap','challenge'])assert.equal(e2eeResponseLimit('/e2ee/v1/'+suffix,200),256*1024);
 assert.equal(e2eeResponseLimit('/e2ee/v1/command',200),8*1024*1024);
 assert.equal(e2eeResponseLimit('/e2ee/v1/read',503),8192);assert.equal(isE2eeResponsePath('/e2ee/v1/read'),true);assert.equal(isE2eeResponsePath('/session'),false);
 assert.throws(()=>e2eeResponseLimit('/e2ee/v1/unknown',200),/E2EE_/);
});

test('all declared membership calls reach authenticated fetch with bounded responses and exact routes',async()=>{
 const f=await cloudSyncClient(),routes=['membership-graph','membership-atomic-begin','membership-atomic-page','membership-atomic-status','membership-atomic-cancel','membership-atomic-seal','membership-atomic-commit','membership-atomic-receipt','membership-atomic-receipt-page','membership-atomic-preview'];
 f.respond((_url,init)=>{assert.equal(init.method,'POST');assert(init.headers['X-CSRF-Token']);return Response.json({accepted:true});});
 for(const route of routes){
  assert.equal(isE2eeResponsePath('/e2ee/v1/'+route),true);assert.equal(e2eeResponseLimit('/e2ee/v1/'+route,409),8192);
  assert.equal((await f.client.e2eeRequest('/'+route,{synthetic:true})).accepted,true);
  for(const suffix of ['/','?extra=1','-unknown'])assert.equal(isE2eeResponsePath('/e2ee/v1/'+route+suffix),false);
 }
 assert.equal(f.requests.length,routes.length);
 for(const route of ['membership-graph','membership-atomic-preview','membership-atomic-receipt-page'])assert.equal(e2eeResponseLimit('/e2ee/v1/'+route,200),4*1024*1024);
});
test('split UTF8 and a BOM decode correctly while consumed wire buffers expire',async()=>{
 const bytes=new TextEncoder().encode('\ufeff{"value":"α😀ёж","count":3}'),f=streamed(Array.from({length:bytes.length},(_,index)=>bytes.slice(index,index+1)));
 assert.deepEqual(await readE2eeJsonResponse(f.response,path,()=>{}),{value:'α😀ёж',count:3});assert.ok(f.loans.every(row=>row.every(byte=>byte===0)));assert.equal(f.response.body.locked,false);
});
test('declared and actual oversize bodies are cancelled without a parsed prefix',async()=>{
 const declared=streamed([new TextEncoder().encode('{}')],{headers:{'Content-Length':String(256*1024+1)}});await assert.rejects(readE2eeJsonResponse(declared.response,path,()=>{}),/RESPONSE_TOO_LARGE/);assert.equal(declared.cancelled(),true);
 const actual=streamed(Array.from({length:6},()=>new Uint8Array(65536).fill(32)));await assert.rejects(readE2eeJsonResponse(actual.response,path,()=>{}),/RESPONSE_TOO_LARGE/);assert.equal(actual.cancelled(),true);assert.ok(actual.loans.slice(0,5).every(row=>row.every(byte=>byte===0)));
});
test('actor retirement after a body pull wipes that loan and closes the reader',async()=>{
 const f=streamed([new TextEncoder().encode('{"private":"fixture"}'),new Uint8Array([32])]);let calls=0;
 await assert.rejects(readE2eeJsonResponse(f.response,path,()=>{if(++calls===3)throw new Error('E2EE_ACCOUNT_CHANGED');}),/ACCOUNT_CHANGED/);
 assert.equal(f.cancelled(),true);assert.ok(f.loans[0].every(byte=>byte===0));assert.equal(f.response.body.locked,false);
});
test('invalid UTF8 syntax roots content types and zero progress never yield a success object',async()=>{
 for(const parts of [[new Uint8Array([123,34,120,34,58,34,0xc3,34,125])],[new TextEncoder().encode('{"x":')],[new TextEncoder().encode('[]')],[new Uint8Array()]]){
  const f=streamed(parts);await assert.rejects(readE2eeJsonResponse(f.response,path,()=>{}),/E2EE_INVALID_RESPONSE/);assert.equal(f.response.body.locked,false);
 }
 const f=streamed([new TextEncoder().encode('{}')],{headers:{'Content-Type':'text/html'}});await assert.rejects(readE2eeJsonResponse(f.response,path,()=>{}),/E2EE_INVALID_RESPONSE/);assert.equal(f.cancelled(),true);
});

test('duplicate and escaped duplicate E2EE fields refuse before last-value projection',async()=>{
 for(const raw of ['{"sourceHash":"first","sourceHash":"second"}','{"ownerId":"first","own\\u0065rId":"second"}',
  '{"envelopes":[{"context":{"securityEpoch":1,"securityEpoch":2}}]}']){
  const bytes=new TextEncoder().encode(raw),f=streamed(Array.from({length:bytes.length},(_,at)=>bytes.slice(at,at+1)));
  await assert.rejects(readE2eeJsonResponse(f.response,'/e2ee/v1/read',()=>{}),/E2EE_INVALID_RESPONSE/);
  assert.ok(f.loans.every(value=>value.every(byte=>byte===0)));assert.equal(f.response.body.locked,false);
 }
});

test('shared wire corpus is identical for split web/native success and error bodies',async()=>{
 const corpus=JSON.parse(readFileSync(new URL('../contracts/e2ee/transport-json-v1.json',import.meta.url),'utf8'));
 for(const row of corpus.cases)for(const status of [200,409]){
  const bytes=row.hex?new Uint8Array(Buffer.from(row.hex,'hex')):new TextEncoder().encode(row.raw);
  const f=streamed(Array.from({length:bytes.length},(_,at)=>bytes.slice(at,at+1)),{status});
  if(row.valid)assert.ok(await readE2eeJsonResponse(f.response,path,()=>{}),row.id);
  else if(status===409)assert.equal(await readE2eeJsonResponse(f.response,path,()=>{}),null,row.id);
  else await assert.rejects(readE2eeJsonResponse(f.response,path,()=>{}),/E2EE_INVALID_RESPONSE/,row.id);
  assert.ok(f.loans.every(value=>value.every(byte=>byte===0)),row.id);assert.equal(f.response.body.locked,false,row.id);
 }
});

test('wire node member key number and depth budgets admit the boundary then refuse over it',async()=>{
 const read=raw=>readE2eeJsonResponse(new Response(raw,{headers}),'/e2ee/v1/directory',()=>{});
 const cases=[
  ['{"'+ 'a'.repeat(1024)+'":1}','{"'+ 'a'.repeat(1025)+'":1}'],
  ['{"x":'+ '['.repeat(39)+'0'+']'.repeat(39)+'}','{"x":'+ '['.repeat(40)+'0'+']'.repeat(40)+'}'],
  ['{"x":0.'+'0'.repeat(125)+'1}','{"x":0.'+'0'.repeat(126)+'1}'],
  ['{'+Array.from({length:10000},(_,i)=>`"k${i}":0`).join(',')+'}','{'+Array.from({length:10001},(_,i)=>`"k${i}":0`).join(',')+'}'],
  ['{"x":['+'0,'.repeat(249997)+'0]}','{"x":['+'0,'.repeat(249998)+'0]}'],
 ];
 for(const[valid,invalid]of cases){assert.ok(await read(valid));await assert.rejects(read(invalid),/E2EE_INVALID_RESPONSE/);}
 const directory=JSON.stringify({events:Array.from({length:2048},(_,revision)=>({protocol:1,ownerId:'synthetic',scopeId:'personal:synthetic',deviceId:'synthetic-device',action:'rotate',expectedRevision:revision,checkpointHash:'synthetic',securityEpoch:revision+1,operationId:'synthetic-'+revision,payload:{keyId:'synthetic-root',generation:revision+1,capsules:[{deviceId:'synthetic-device',ciphertext:'A'.repeat(128)}]}}))});
 assert.ok((await read(directory)).events.length===2048);
});

test('ambiguous error codes and invalid JSON resource shapes never become migration instructions',async()=>{
 const ambiguous=streamed([new TextEncoder().encode('{"error":"E2EE_SOURCE_CHANGED","err\\u006fr":"E2EE_MIGRATION_FENCED"}')],{status:409});
 assert.equal(await readE2eeJsonResponse(ambiguous.response,'/e2ee/v1/read',()=>{}),null);
 for(const raw of ['{"value":1e999}','{"x":'+ '['.repeat(41)+'0'+']'.repeat(41)+'}',
  '{"'+ 'a'.repeat(1025)+'":1}']){
  const f=streamed([new TextEncoder().encode(raw)]);await assert.rejects(readE2eeJsonResponse(f.response,'/e2ee/v1/read',()=>{}),/E2EE_INVALID_RESPONSE/);
 }
});

test('the real authenticated web channel refuses duplicate source authority and preserves all previous durable state',async()=>{
 const f=await cloudSyncClient(),before=new Map(f.storage.data);f.respond(()=>new Response('{"sourceHash":"first","sourceHash":"second"}',{headers}));
 await assert.rejects(f.client.e2eeRequest('/source',{scopeId:'personal:fixture'}),/E2EE_INVALID_RESPONSE/);
 for(const[key,value]of before)assert.equal(f.storage.getItem(key),value);
});

test('an invalid non-byte stream chunk keeps the sanitized protocol failure during cleanup',async()=>{
 const response=new Response(new ReadableStream({start(controller){controller.enqueue('synthetic-wire-canary');}}),{headers});
 await assert.rejects(readE2eeJsonResponse(response,path,()=>{}),/E2EE_INVALID_RESPONSE/);assert.equal(response.body.locked,false);
});
test('bounded non-JSON HTTP errors remain errors without accepting success or copying large pages',async()=>{
 const f=streamed([new TextEncoder().encode('<html>temporary fixture</html>')],{status:503,headers:{'Content-Type':'text/html'}});
 assert.equal(await readE2eeJsonResponse(f.response,'/e2ee/v1/read',()=>{}),null);assert.equal(f.response.body.locked,false);
 const g=streamed([new TextEncoder().encode('{"error":"E2EE_SOURCE_CHANGED"}')],{status:409});assert.deepEqual(await readE2eeJsonResponse(g.response,'/e2ee/v1/read',()=>{}),{error:'E2EE_SOURCE_CHANGED'});
});

test('the real authenticated web channel uses E2EE limits and preserves the existing error code',async()=>{
 const f=await cloudSyncClient();f.respond((url,init)=>{assert.equal(new URL(url).pathname,'/api/e2ee/v1/source');assert.equal(init.method,'POST');return Response.json({sourceHash:'synthetic-source'});});
 assert.equal((await f.client.e2eeRequest('/source',{scopeId:'personal:fixture'})).sourceHash,'synthetic-source');
 const large=streamed([new Uint8Array(65536).fill(32),new Uint8Array(65536).fill(32)],{headers:{'Content-Length':String(256*1024+1)}});f.respond(()=>large.response);
 await assert.rejects(f.client.e2eeRequest('/source',{scopeId:'personal:fixture'}),/E2EE_RESPONSE_TOO_LARGE/);assert.equal(large.cancelled(),true);
 f.respond(()=>Response.json({error:'E2EE_SOURCE_CHANGED'},{status:409}));await assert.rejects(f.client.e2eeRequest('/read',{}),/E2EE_SOURCE_CHANGED/);
});

test('an account change aborts an in-flight E2EE body and preserves the old durable data',async()=>{
 const f=await cloudSyncClient(),reached=deferred();let loan;const originals=[...f.storage.data.entries()];
 f.respond((url,init)=>{
  if(new URL(url).pathname==='/api/session')return Response.json({user:{uid:'new-owner'},csrf:'new-csrf',loginId:'new-login'});
  const stream=new ReadableStream({start(controller){loan=new TextEncoder().encode('{"envelopes":[');controller.enqueue(loan);reached.resolve();init.signal.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});}});
  return new Response(stream,{headers});
 });
 const reading=f.client.e2eeRequest('/read',{}).then(value=>({value}),error=>({error}));await reached.promise;await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.client.loadGenesisSession()).uid,'new-owner');const result=await reading;assert.equal(result.value,undefined);assert.ok(result.error);assert.ok(loan.every(byte=>byte===0));assert.equal(f.requests[0].init.signal.aborted,true);
 for(const[key,value]of originals)if(key!=='genesis-local-login-id-v1')assert.equal(f.storage.getItem(key),value);
});

test('invalid E2EE route methods refuse before fetch',async()=>{
 const f=await cloudSyncClient();for(const[route,body]of [['/read',undefined],['/status',{}],['/unknown',{}]])await assert.rejects(f.client.e2eeRequest(route,body),/E2EE_ROUTE_FORBIDDEN/);
 assert.equal(f.requests.length,0);
});
test('private reads and queued writes share the server retry window without replaying mutations',async()=>{
 let now=1000;
 const f=await cloudSyncClient({timers:{setTimeout,clearTimeout,performance:{now:()=>now}}});
 f.respond(()=>Response.json({error:'API_RATE_LIMIT'},{status:429,headers:{'Retry-After':'3'}}));
 for(const [route,body]of [['/status',undefined],['/directory',{scopeId:'personal:fixture'}],['/read',{}],['/membership-graph',{}],['/membership-state',{}]])
  await assert.rejects(f.client.e2eeRequest(route,body),error=>error.message==='E2EE_HTTP_ERROR'&&error.seconds===3);
 for(const route of ['/command','/membership-atomic-commit'])
  await assert.rejects(f.client.e2eeRequest(route,{}),error=>error.seconds===undefined);
 assert.equal(f.requests.length,1);
 now+=2400;
 await assert.rejects(f.client.e2eeRequest('/read',{}),error=>error.seconds===1);
 const cancelled=AbortSignal.abort();
 await assert.rejects(f.client.e2eeRequest('/command',{},cancelled),error=>error.name==='AbortError');
 assert.equal(f.requests.length,1);
 now+=600;
 f.respond(()=>Response.json({ack:'fixture'}));
 assert.equal((await f.client.e2eeRequest('/command',{})).ack,'fixture');
 assert.equal(f.requests.length,2);
});

test('a limited private session can refresh identity and a different owner can read immediately',async()=>{
 const f=await cloudSyncClient();
 f.respond(()=>Response.json({error:'API_RATE_LIMIT'},{status:429,headers:{'Retry-After':'300'}}));
 await assert.rejects(f.client.e2eeRequest('/command',{}),error=>error.status===429);
 f.respond(url=>new URL(url).pathname==='/api/session'
   ?Response.json({user:{uid:'new-owner'},csrf:'new-csrf',loginId:'new-login'})
   :Response.json({scopes:[]}));
 assert.equal((await f.client.loadGenesisSession()).uid,'new-owner');
 assert.equal((await f.client.e2eeRequest('/status')).scopes.length,0);
 assert.equal(f.requests.length,3);
});
