import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudSyncClient} from './helpers/cloud-sync-client.mjs';

test('actual authenticated E2EE routes explicitly forbid fetch redirects while session reads keep their existing policy',async()=>{
 const f=await cloudSyncClient();
 f.respond((url,init)=>{assert.equal(init.redirect,'error',new URL(url).pathname);return Response.json({});});
 for(const path of ['/status','/bootstrap','/command','/read','/challenge','/directory','/source'])await f.client.e2eeRequest(path,path==='/status'?undefined:{});
 f.respond((_url,init)=>{assert.equal(init.redirect,undefined);return Response.json({user:{uid:f.userId},csrf:'fixture-csrf',loginId:'fixture-login'});});
 await f.client.loadGenesisSession();
});

test('unknown E2EE error data cannot escape through an exception or payload while bounded native-compatible codes survive',async()=>{
 const f=await cloudSyncClient(),before=new Map(f.storage.data);
 for(const error of ['E2EE_PRIVATE source-canary-with-spaces','E2EE_private-source-canary',`E2EE_${'A'.repeat(81)}`,{private:'source-canary-object'},42,null]){
  f.respond(()=>Response.json({error,private:'source-canary-payload'},{status:409}));
  await assert.rejects(f.client.e2eeRequest('/source',{}),failure=>failure.message==='E2EE_HTTP_ERROR'&&failure.payload===null);
  assert.deepEqual(f.storage.data,before);
 }
 for(const [status,error]of [[409,'E2EE_MIGRATION_FENCED'],[503,'E2EE_PILOT_DISABLED'],[403,'E2EE_FORBIDDEN']]){
  f.respond(()=>Response.json({error},{status}));await assert.rejects(f.client.e2eeRequest('/source',{}),failure=>failure.message===error);
 }
});

test('successful E2EE content responses cannot publish account metadata or replace CSRF and must preserve pending work',async()=>{
 for(const reserved of [{user:{uid:'foreign-owner',email:'synthetic@example.invalid'}},{user:null},{user:{uid:'cache-qa-user',featureAccess:{private:'canary'}}},{csrf:'b'.repeat(48)}]){
  const f=await cloudSyncClient(),before=new Map(f.storage.data);
  f.respond(()=>Response.json({sourceHash:'synthetic',...reserved}));
  await assert.rejects(f.client.e2eeRequest('/source',{}),failure=>failure.message==='E2EE_INVALID_RESPONSE');assert.deepEqual(f.storage.data,before);
  f.respond((_url,init)=>{assert.equal(init.headers['X-CSRF-Token'],'fixture-csrf');return Response.json({sourceHash:'unchanged-synthetic'});});
  assert.equal((await f.client.e2eeRequest('/source',{})).sourceHash,'unchanged-synthetic');assert.deepEqual(f.storage.data,before);
 }
});
