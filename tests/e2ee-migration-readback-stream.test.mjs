import assert from 'node:assert/strict';
import test from 'node:test';
import {SignedMigrationTransport} from '../app/e2ee/migration-transport.ts';
import {generateDeviceKeys,freshSecret} from '../app/e2ee/keys.ts';
import {E2EE_SUITE,importE2eeRoot,sealE2eeEnvelope} from '../app/e2ee/envelope.ts';
import {verifyE2eeCommand} from '../app/e2ee/commands.ts';

async function fixture(){
 const keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);let live=true,mode='normal';
 const directory={ownerId:'owner',scopeId:'personal:stream-readback',securityEpoch:1,checkpoint:{revision:1,hash:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}},calls=[],rows=[];
 for(const[domain,objectId]of [['workspace','a'],['workspace','b'],['attachment','chunk-a']])rows.push(await sealE2eeEnvelope(root,keys.signing.privateKey,{cryptoProtocol:1,suite:E2EE_SUITE,
  ownerId:directory.ownerId,scopeId:directory.scopeId,domain,objectId,schemaVersion:1,dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'root',deviceId:'device',operationId:crypto.randomUUID()},new Uint8Array([1,2,3])));
 const device={deviceId:'device',requireOpen(){if(!live)throw new Error('E2EE_UNLOCK_REQUIRED');},keys:()=>keys};
 const transport=new SignedMigrationTransport(device,directory,['workspace'],async(path,packet)=>{
  assert.equal(path,'/read');const command=await verifyE2eeCommand(packet,keys.signing.publicKey);calls.push(command);const payload=command.payload;
  let selected=rows.filter(row=>row.context.domain===payload.domain&&(command.action==='get'?row.context.objectId===payload.objectId:mode==='loop'||row.context.objectId>payload.after)).slice(0,1).map(row=>structuredClone(row));
  if(mode==='foreign'&&selected[0])selected[0].context.scopeId='personal:foreign';
  if(mode==='oversized')selected=Array.from({length:9},()=>structuredClone(rows[0]));
  if(mode==='get-duplicate'&&selected[0])selected.push(structuredClone(selected[0]));
  if(mode==='retire')live=false;
  return{checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision+(mode==='directory'?1:0),envelopes:selected};
 });
 return{transport,calls,rows,setMode:value=>{mode=value;},retire:()=>{live=false;}};
}
test('bounded inventory awaits each sink and checks final empty pages for every domain including attachments',async()=>{
 const f=await fixture(),received=[];const count=await f.transport.forEachEnvelope(async envelope=>{received.push(envelope.context.domain+':'+envelope.context.objectId);});
 assert.equal(count,3);assert.deepEqual(received,['workspace:a','workspace:b','attachment:chunk-a']);assert.equal(f.calls.length,5);assert.ok(f.calls.every(row=>row.action==='read'&&row.payload.limit===1));
 assert.ok(f.calls.some(row=>row.payload.domain==='workspace'&&row.payload.after==='b'));assert.ok(f.calls.some(row=>row.payload.domain==='attachment'&&row.payload.after==='chunk-a'));
});
test('a pending sink blocks the next request and retirement after acknowledgement prevents further IO',async()=>{
 const f=await fixture();let hit,release;const reached=new Promise(resolve=>{hit=resolve;});let callbacks=0;
 const pending=f.transport.forEachEnvelope(async()=>{callbacks++;hit();await new Promise(resolve=>{release=resolve;});});
 await reached;assert.equal(f.calls.length,1);f.retire();release();await assert.rejects(pending,/UNLOCK_REQUIRED/);assert.equal(f.calls.length,1);assert.equal(callbacks,1);
});
test('loops foreign scopes oversized pages directory changes and retirement cannot yield a complete inventory',async()=>{
 for(const mode of ['loop','foreign','oversized','directory','retire']){const f=await fixture();f.setMode(mode);await assert.rejects(f.transport.forEachEnvelope(async()=>{}),/E2EE_/);}
});
test('sink failures and attempts to change immutable yielded metadata cannot forge the cursor',async()=>{
 const f=await fixture();await assert.rejects(f.transport.forEachEnvelope(async()=>{throw new Error('E2EE_NO_SPACE');}),/NO_SPACE/);assert.equal(f.calls.length,1);
 const g=await fixture();assert.equal(await g.transport.forEachEnvelope(async envelope=>{assert.throws(()=>{envelope.context.objectId='changed-by-sink';},TypeError);}),3);
 assert.deepEqual(g.calls.filter(row=>row.payload.domain==='workspace').map(row=>row.payload.after),['','a','b']);
});
test('single-envelope get binds exact scope domain and ID and rejects disallowed domains before HTTP',async()=>{
 const f=await fixture();const opened=await f.transport.getEnvelope('workspace','a');assert.equal(opened.context.objectId,'a');assert.equal(f.calls[0].action,'get');
 assert.deepEqual({...f.calls[0].payload},{domain:'workspace',objectId:'a'});assert.equal(await f.transport.getEnvelope('workspace','missing'),null);
 const before=f.calls.length;await assert.rejects(f.transport.getEnvelope('diary','a'),/E2EE_/);await assert.rejects(f.transport.getEnvelope('workspace',''),/E2EE_/);assert.equal(f.calls.length,before);
 for(const mode of ['foreign','directory','get-duplicate','retire']){const g=await fixture();g.setMode(mode);await assert.rejects(g.transport.getEnvelope('workspace','a'),/E2EE_/);}
});
