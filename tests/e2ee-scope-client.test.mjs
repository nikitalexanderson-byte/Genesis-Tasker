import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {E2eeScopeClient} from '../app/e2ee/scope-client.ts';
import {E2eeReadRateError} from '../app/e2ee/read-rate-retry.ts';
import {E2eeEditorQueue} from '../app/e2ee/editor-queue.ts';
import {createRecoveryKit,freshSecret,sealRoot,publicDeviceKeys} from '../app/e2ee/keys.ts';
import {encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope} from '../app/e2ee/envelope.ts';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash} from '../app/e2ee/commands.ts';
import {envelopePayloadHash,objectManifestHash,sealE2eeFile} from '../app/e2ee/files.ts';
import {verifyDeviceDirectory} from '../app/e2ee/directory.ts';
import {showPrivateMigration,privateMigrationUi,closePrivateMigrationUi} from '../app/private-migration-ui.ts';
import {holdPrivateProductMutations,requirePrivateProductMutation} from '../app/e2ee/product-mutation-fence.ts';
import {inspectRetainedProductCustody} from '../app/e2ee/retained-product-custody.ts';
import {WebPrivateAccount} from '../app/e2ee/product-session.ts';

class Records {
  rows=new Map();fail=false;
  async get(id){return structuredClone(this.rows.get(id)??null);}
  async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
  async commit(changes,signal){
    if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');if(this.fail)throw new Error('SYNTHETIC_DISK_FULL');
    for(const change of changes)if((this.rows.get(change.key)?.serial??null)!==change.expected)throw new Error('E2EE_LOCAL_CONFLICT');
    const copy=new Map(this.rows);for(const change of changes)if(change.value===null)copy.delete(change.key);else copy.set(change.key,structuredClone(change.value));this.rows=copy;
  }
}
class Keys {
  rows=new Map();async get(id){return structuredClone(this.rows.get(id)??null);}
  async create(id,bundle){assert.ok(!this.rows.has(id));this.rows.set(id,{serial:1,bundle:structuredClone(bundle)});}
}
const bytes=text=>new TextEncoder().encode(text),text=value=>new TextDecoder().decode(value);

test('parallel scope readers wait for one verified refresh rather than observing its temporary closed flag',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();
 let release,started,calls=0,settled=false;const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve),directory=f.transport.directory;
 f.transport.directory=async()=>{calls++;started();await gate;return directory();};
 const first=client.refresh();await begun;const second=client.refresh();
 const read=client.recoverReceipt('diary','not-saved').finally(()=>settled=true);read.catch(()=>{});
 await new Promise(resolve=>setTimeout(resolve,10));
 const before={calls,settled};release();await Promise.allSettled([first,second,read]);
 assert.deepEqual(before,{calls:1,settled:false});assert.equal(await read,null);f.device.lock();
});
test('a failed parallel scope refresh cannot silently use stale online authority',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();let release,started;
 const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve);
 f.transport.directory=async()=>{started();await gate;throw Error('DIRECTORY_UNAVAILABLE');};
 const refresh=client.refresh();await begun;
 const read=client.recoverReceipt('diary','not-saved');read.catch(()=>{});release();
 await assert.rejects(refresh,/DIRECTORY_UNAVAILABLE/);await assert.rejects(read,/DIRECTORY_UNAVAILABLE/);
 await assert.rejects(client.recoverReceipt('diary','not-saved'),/E2EE_REFRESH_REQUIRED/);f.device.lock();
});
test('a rate-limited directory refresh keeps readers waiting for verified authority',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();const directory=f.transport.directory;let calls=0;
 f.transport.directory=async()=>{if(++calls===1)throw new E2eeReadRateError(0);return directory();};
 try{await Promise.all([client.refresh(),client.read('diary','not-saved')]);assert.equal(calls,2);assert.equal(await client.read('diary','not-saved'),null);}
 finally{f.device.lock();}
});
test('rate-limited scope discovery retries only while its account remains open',async()=>{
 const f=await fixture(),scopes=[{scopeId:f.rootContext.scopeId,kind:'personal',resourceId:f.device.ownerId,state:'active'}];let calls=0,retire=false,account;
 f.transport.status=async()=>{calls++;if(calls%2===1){if(retire)account.close();throw new E2eeReadRateError(0);}return{pilotAllowed:true,cryptoProtocol:1,scopes};};
 account=new WebPrivateAccount(f.device.ownerId,f.device,f.transport,()=>{});
 try{assert.deepEqual(await account.scopeSummaries(),scopes);assert.equal(calls,2);retire=true;await assert.rejects(account.scopeSummaries(),/E2EE_UNLOCK_REQUIRED/);assert.equal(calls,3);}
 finally{account.close();}
});
test('closing a scope during a directory rate refusal prevents another directory request',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();const before=structuredClone(f.storage.rows);let calls=0;
 f.transport.directory=async()=>{calls++;client.close();throw new E2eeReadRateError(0);};
 try{await assert.rejects(client.refresh(),/E2EE_UNLOCK_REQUIRED/);assert.equal(calls,1);assert.deepEqual(f.storage.rows,before);}
 finally{f.device.lock();}
});
test('closing the scope during a pending refresh cannot reinstall an open channel',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();let release,started;
 const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve),directory=f.transport.directory;
 f.transport.directory=async()=>{started();await gate;return directory();};
 const refresh=client.refresh();await begun;client.close();release();
 await assert.rejects(refresh,/E2EE_UNLOCK_REQUIRED/);await assert.rejects(client.recoverReceipt('diary','not-saved'),/E2EE_REFRESH_REQUIRED/);f.device.lock();
});
test('a multi-chunk file keeps its original bytes when a rate refusal interrupts upload and the same journal resumes',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();const input=new Uint8Array(1331200).map((_,i)=>i%251);
 const command=f.transport.command;let puts=0,refused=false;
 f.transport.command=async packet=>{if(packet.command.action==='put'&&++puts===2){refused=true;throw Error('E2EE_HTTP_ERROR');}return command(packet);};
 await client.prepare('attachment','retained-file',input,0,{filename:'private.txt',mediaType:'text/plain'});
 await assert.rejects(client.flush('attachment','retained-file'),/E2EE_HTTP_ERROR/);assert(refused);
 await client.refresh();await client.flush('attachment','retained-file');
 const reopened=await f.reopen();await reopened.refresh();const actual=await reopened.read('attachment','retained-file');
 assert(actual);assert.deepEqual(actual.bytes,input);assert.equal(actual.filename,'private.txt');f.device.lock();
});
test('a rate refusal repeats the exact signed read without replacing its operation identity',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();const original=f.transport.read,seen=[];
 f.transport.read=async packet=>{seen.push(structuredClone(packet));if(seen.length===1)throw new E2eeReadRateError(0);return original(packet);};
 assert.equal(await client.read('diary','not-saved'),null);assert.equal(seen.length,2);assert.deepEqual(seen[0],seen[1]);f.device.lock();
});
test('scope closure during a refused read prevents its retry',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();let calls=0;
 f.transport.read=async()=>{calls++;client.close();throw new E2eeReadRateError(0);};
 await assert.rejects(client.read('diary','not-saved'),/E2EE_UNLOCK_REQUIRED/);assert.equal(calls,1);f.device.lock();
});
test('an owning account change refuses the next RPC even while the underlying device remains open',async()=>{
 const f=await fixture();let live=true,calls=0;const client=f.make(()=>{if(!live)throw Error('E2EE_ACCOUNT_CHANGED');});await client.refresh();
 f.transport.read=async()=>{calls++;live=false;throw new E2eeReadRateError(0);};
 await assert.rejects(client.read('diary','not-saved'),/E2EE_ACCOUNT_CHANGED/);assert.equal(calls,1);f.device.requireOpen();f.device.lock();
});
test('a newly verified crypto epoch retires an older refused read before another RPC',async()=>{
 const f=await fixture(),client=f.make();await client.refresh();const original=f.transport.read;let intercepted=false,gets=0;
 f.transport.read=async packet=>{if(packet.command.action==='get'){gets++;if(!intercepted){intercepted=true;await f.rotate();await client.refresh();throw new E2eeReadRateError(0);}}return original(packet);};
 await assert.rejects(client.read('diary','not-saved'),/E2EE_DIRECTORY_CONFLICT/);assert.equal(gets,1);f.device.lock();
});
test('an active migration freezes encrypted uploads and editors, then permits initialization while its surface remains visible',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('diary','frozen-upload',bytes('retained pending input'),0);
  const queue=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','frozen-editor');
  showPrivateMigration(f.device.ownerId,'en','resume',{scopeId:'project:synthetic',kind:'project',resourceId:'synthetic'});
  const release=holdPrivateProductMutations(f.device.ownerId);
  const retained=JSON.stringify([...f.storage.rows]);
  try{
    await assert.rejects(client.flush('diary','frozen-upload'),/E2EE_MIGRATION_BUSY/);
    await assert.rejects(queue.stage(bytes('new ordinary input'),null,0),/E2EE_MIGRATION_BUSY/);
    assert(JSON.stringify([...f.storage.rows])===retained,'the migration must see the same retained job and editor inventory');
    assert.equal(f.server.writes,0);
    release();assert(privateMigrationUi(),'completion UI remains mounted during product initialization');
    await client.flush('diary','frozen-upload');assert.equal(f.server.writes,2,'one content chunk and its manifest are uploaded after admission resumes');
  }finally{release();closePrivateMigrationUi(privateMigrationUi().id);f.device.lock();}
});

test('an upload committed as migration opens retains its exact pending packet until the surface closes',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('diary','race-upload',bytes('immutable pending input'),0);
  const command=f.transport.command;let retained,release=()=>{};
  f.transport.command=async packet=>{
    showPrivateMigration(f.device.ownerId,'en','resume',{scopeId:'project:synthetic',kind:'project',resourceId:'synthetic'});
    release=holdPrivateProductMutations(f.device.ownerId);
    retained=JSON.stringify([...f.storage.rows]);return command(packet);
  };
  try{
    await assert.rejects(client.flush('diary','race-upload'),/E2EE_MIGRATION_BUSY/);
    assert.equal(f.server.writes,1);
    assert(JSON.stringify([...f.storage.rows])===retained,'a late receipt must not mutate the authenticated custody snapshot');
    release();f.transport.command=command;
    await client.flush('diary','race-upload');assert.equal(f.server.writes,2,'retry recovers the first chunk receipt and adds only its manifest');
  }finally{release();if(privateMigrationUi())closePrivateMigrationUi(privateMigrationUi().id);f.transport.command=command;f.device.lock();}
});

test('nested migration holds release independently, tolerate repeated cleanup, and do not block another owner',()=>{
  const first=holdPrivateProductMutations('nested-owner'),second=holdPrivateProductMutations('nested-owner');
  try{
    assert.throws(()=>requirePrivateProductMutation('nested-owner'),/E2EE_MIGRATION_BUSY/);
    requirePrivateProductMutation('other-owner');first();first();
    assert.throws(()=>requirePrivateProductMutation('nested-owner'),/E2EE_MIGRATION_BUSY/);
    second();requirePrivateProductMutation('nested-owner');
  }finally{first();second();}
});
async function fixture(options={}){
  const ownerId='scope-owner',scopeId=options.kind?`${options.kind}:scope-resource`:'personal:scope-owner',recovery=await createRecoveryKit(ownerId),storage=new Records(),keyStorage=new Keys();
  let device=await UnlockedWebDevice.provision(ownerId,recovery.secret,recovery.kit,storage,keyStorage);
  const raw=freshSecret(),keyId='root-one',keys=device.keys(),pub=await publicDeviceKeys(keys);
  const rootContext={ownerId,scopeId,cryptoEpoch:1,keyId,recipientId:device.deviceId};
  const command={protocol:1,ownerId,scopeId,deviceId:device.deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:'bootstrap',payload:{
    kind:options.kind??'personal',resourceId:options.kind?'scope-resource':ownerId,keyId,generation:1,recoveryKit:recovery.kit,deviceKeys:pub,
    deviceCapsule:await sealRoot(raw,pub.receivingKey,rootContext),recoveryCapsule:await sealRoot(raw,recovery.kit.authority.receivingKey,{...rootContext,recipientId:'recovery'})}};
  command.payload.selfProof=(await signE2eeCommand(command,keys.signing.privateKey)).signature;
  const events=[await signE2eeCommand(command,recovery.keys.signing.privateKey)];
  let directory=await verifyDeviceDirectory(ownerId,scopeId,recovery.kit.authority,events);
  const append=async(action,payload)=>{
    const c={protocol:1,ownerId,scopeId,deviceId:device.deviceId,action,expectedRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash,
      securityEpoch:directory.securityEpoch,operationId:crypto.randomUUID(),payload};
    events.push(await signE2eeCommand(c,keys.signing.privateKey));directory=await verifyDeviceDirectory(ownerId,scopeId,recovery.kit.authority,events);
  };
  await append('migration-commit',{generation:1,migrationId:'synthetic-migration',fence:1,manifestHash:await objectManifestHash([]),objectCount:0,verifiedCheckpoint:encodeE2eeBytes(freshSecret())});
  const server={objects:new Map(),receipts:new Map(),writes:0,crashed:false};
  const transport={
    async directory(){return {events:structuredClone(events)};},
    async command(packet){
      const c=await verifyE2eeCommand(packet,keys.signing.publicKey),identity=await e2eeCommandHash(c),receipt=server.receipts.get(c.operationId);
      if(receipt){assert.equal(receipt.payloadHash,identity);return receipt.result;}
      assert.equal(c.expectedRevision,directory.checkpoint.revision);assert.equal(c.checkpointHash,directory.checkpoint.hash);assert.equal(c.securityEpoch,directory.securityEpoch);
      const p=c.payload;
      if(c.action==='cancel-put') {
        const original=p.original.command,originalHash=await e2eeCommandHash(original);
        const old=server.receipts.get(original.operationId),outcome=old??{payloadHash:originalHash,result:{cancelled:true}};
        assert.equal(outcome.payloadHash,originalHash);server.receipts.set(original.operationId,outcome);
        const result={operationReceipt:outcome};server.receipts.set(c.operationId,{payloadHash:identity,result});
        if(options.crashAfterCancel&&!server.cancelCrashed){server.cancelCrashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}return result;
      }
      server.lastPut=structuredClone(packet);
      if(options.crashBeforePut&&!server.beforeCrashed){server.beforeCrashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
      const e=p.envelope,k=`${e.context.domain}\0${e.context.objectId}`,old=server.objects.get(k);
      if((old?.context.revision??0)!==p.expectedObjectRevision)throw new Error('E2EE_OBJECT_CONFLICT');
      const result={revision:e.context.revision,generation:e.context.dataGeneration,payloadHash:await envelopePayloadHash(e)};
      server.objects.set(k,structuredClone(e));server.receipts.set(c.operationId,{payloadHash:identity,result});server.writes++;
      if(options.crashAfterPut&&!server.crashed&&server.writes===(options.crashAtWrite??1)){server.crashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
      return result;
    },
    async read(packet){
      const c=await verifyE2eeCommand(packet,keys.signing.publicKey);assert.equal(c.checkpointHash,directory.checkpoint.hash);
      const base={checkpointHash:c.checkpointHash,directoryRevision:c.expectedRevision};
      if(c.action==='receipt')return {...base,receipt:server.receipts.get(c.payload.operationId)??null};
      if(c.action==='sealed-heads')return {...base,objects:c.payload.cryptoEpoch===0?[]:server.retired};
      assert.equal(c.action,'get');const e=server.objects.get(`${c.payload.domain}\0${c.payload.objectId}`);return {...base,envelopes:e?[structuredClone(e)]:[]};
    },
  };
  const make=current=>new E2eeScopeClient(device,ownerId,scopeId,recovery.kit.authority,transport,current);
  const reopen=async()=>{device.lock();device=await UnlockedWebDevice.unlock(ownerId,recovery.secret,storage,keyStorage);return make();};
  const rotate=async()=>{
    server.retired=await Promise.all([...server.objects.values()].map(async e=>({domain:e.context.domain,objectId:e.context.objectId,revision:e.context.revision,payloadHash:await envelopePayloadHash(e)})));
    const newRoot=freshSecret(),ctx={...rootContext,cryptoEpoch:2,keyId:'root-two'};
    await append('rotate',{revokedDeviceIds:[],cryptoEpoch:2,securityEpoch:2,keyId:'root-two',retiredManifestHash:await objectManifestHash(server.retired),retiredObjectCount:server.retired.length,
      capsules:[{deviceId:device.deviceId,capsule:await sealRoot(newRoot,pub.receivingKey,ctx)}],recoveryCapsule:await sealRoot(newRoot,recovery.kit.authority.receivingKey,{...ctx,recipientId:'recovery'})});
    return newRoot;
  };
  return {make,reopen,storage,keyStorage,server,transport,rotate,raw,keys,rootContext,get device(){return device;}};
}
test('custody retains the real shared-trust key-check upload without authorizing or rewriting it',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('key-check','personal-shared-trust-live-v1',bytes(JSON.stringify({protocol:1,ownerId:f.device.ownerId,document:{scopes:[]},base:{scopes:[]}})),0);
  const frame=await f.device.savedDirectory(f.rootContext.scopeId),claims=new Map(),before=JSON.stringify([...f.storage.rows]);
  try{
    const options={vault:f.device.vault,actor:{ownerId:f.device.ownerId,deviceId:f.device.deviceId},
      receivingKey:f.keys.receiving.privateKey,selfKeys:await publicDeviceKeys(f.keys),assertCurrent:()=>f.device.requireOpen(),
      outbox:(await f.device.vault.listMigrationPlanOutputs()).remote,copies:[],jobHistory:[],controlHistory:[],personalScopeId:f.rootContext.scopeId,
      claimed:(domain,id)=>claims.has(domain+'\0'+id),claim:(domain,id,scopeId,role)=>claims.set(domain+'\0'+id,{scopeId,role}),
      directory:async(scopeId,select)=>{assert.equal(scopeId,frame.scopeId);assert(select(frame));return frame;}};
    await inspectRetainedProductCustody(options);
    assert([...claims.values()].some(row=>row.role==='product-job'));
    assert([...claims.values()].some(row=>row.role==='product-cipher'));
    for(const actor of [{ownerId:'another-owner',deviceId:f.device.deviceId},{ownerId:f.device.ownerId,deviceId:'another-device'}]){
      claims.clear();await assert.rejects(inspectRetainedProductCustody({...options,actor}),/E2EE_PRODUCT_CUSTODY_REVIEW_REQUIRED/);
    }
    assert.equal(JSON.stringify([...f.storage.rows]),before);assert.equal(f.server.writes,0);
  }finally{f.device.lock();}
});

test('normal save atomically protects draft/ciphertext before network; restart reuses exact acknowledged request',async()=>{
  const f=await fixture({crashAfterPut:true});let client=f.make();await client.refresh();
  await client.prepare('workspace','workspace',bytes('PRIVATE QUEUED OFFLINE EDIT'),0);assert.equal(f.server.writes,0);
  assert.ok(!JSON.stringify([...f.storage.rows]).includes('PRIVATE QUEUED'));assert.equal(text(await client.readDraft('workspace','workspace')),'PRIVATE QUEUED OFFLINE EDIT');
  await assert.rejects(client.flush('workspace','workspace'),/PROCESS_DEATH/);
  client=await f.reopen();await client.refresh();assert.equal(await client.flush('workspace','workspace'),1);assert.equal(f.server.writes,2);
  assert.equal(text((await client.read('workspace','workspace')).bytes),'PRIVATE QUEUED OFFLINE EDIT');
});
test('disk full accepts neither a new save nor a network request; pending edits cannot be overwritten',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();f.storage.fail=true;
  await assert.rejects(client.prepare('diary','note',bytes('private'),0),/DISK_FULL/);assert.equal(f.server.writes,0);
  f.storage.fail=false;await client.prepare('diary','note',bytes('private'),0);
  await assert.rejects(client.prepare('diary','note',bytes('replacement'),0),/PENDING_SAVE_REQUIRED/);
  assert.equal(text(await client.readDraft('diary','note')),'private');
});
test('a confirmed local write pins its head even before first download; server rollback cannot look empty',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();await client.prepare('workspace','one',bytes('private'),0);await client.flush('workspace','one');
  f.server.objects.delete('workspace\0one');await assert.rejects(client.read('workspace','one'),/REMOTE_ROLLBACK/);
});

test('concurrent authenticated reads reuse an identical durable floor without rewriting it',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('workspace','parallel-read',bytes('PARALLEL PRIVATE CONTENT'),0);await client.flush('workspace','parallel-read');
  const before=JSON.stringify([...f.storage.rows]),read=f.transport.read;let arrived=0,release;
  const together=new Promise(resolve=>{release=resolve;});
  f.transport.read=async packet=>{
    const response=await read(packet);
    if(packet.command.action==='get'&&packet.command.payload.domain==='workspace'&&packet.command.payload.objectId==='parallel-read'){
      if(++arrived===2)release();await together;
    }
    return response;
  };
  try{
    const opened=await Promise.all([client.read('workspace','parallel-read'),client.read('workspace','parallel-read')]);
    try{for(const result of opened)assert.equal(text(result.bytes),'PARALLEL PRIVATE CONTENT');}
    finally{for(const result of opened)result.bytes.fill(0);}
    assert.equal(JSON.stringify([...f.storage.rows]),before,'identical reads must not publish fresh checkpoint revisions');
  }finally{release();f.device.lock();}
});

test('concurrent first opens share one authenticated scope client and keep the first reader usable',async()=>{
  const f=await fixture({kind:'project'});await f.make().refresh();
  const account=new WebPrivateAccount(f.device.ownerId,f.device,f.transport,()=>{}),directory=f.transport.directory;
  let release,calls=0;const held=new Promise(resolve=>{release=resolve;});
  f.transport.directory=async(...args)=>{calls++;await held;return directory(...args);};
  const target={scopeId:f.rootContext.scopeId,kind:'project',resourceId:'scope-resource',state:'active'};
  try{
    const first=account.openScope(target,f.device.authorityPin,f.device.ownerId),second=account.openScope(target,f.device.authorityPin,f.device.ownerId);
    release();const [left,right]=await Promise.all([first,second]);
    assert.equal(calls,1);assert.equal(left.client,right.client);assert.equal(account.shared(target.scopeId,'project','scope-resource').client,left.client);
    assert.equal(await left.client.read('shared-project','missing'),null);
  }finally{release();account.close();}
});

test('a pending scope open cannot be joined under another resource or authority',async()=>{
  const f=await fixture({kind:'project'});await f.make().refresh();
  const account=new WebPrivateAccount(f.device.ownerId,f.device,f.transport,()=>{}),directory=f.transport.directory;
  let release,calls=0;const held=new Promise(resolve=>{release=resolve;});
  f.transport.directory=async(...args)=>{calls++;await held;return directory(...args);};
  const target={scopeId:f.rootContext.scopeId,kind:'project',resourceId:'scope-resource',state:'active'},pin=f.device.authorityPin;
  const first=account.openScope(target,pin,f.device.ownerId);
  try{
    const attempts=[account.openScope({...target,resourceId:'another-resource'},pin,f.device.ownerId),
      account.openScope(target,{...pin,signingKey:'another-authority'},f.device.ownerId),
      account.openScope(target,pin,'another-owner')].map(task=>assert.rejects(task,/E2EE_SCOPE_BINDING_MISMATCH/));
    release();await Promise.all([...attempts,first]);assert.equal(calls,1);
  }finally{release();await first.catch(()=>{});account.close();}
});

test('closing the account retires all callers waiting for the first verified scope',async()=>{
  const f=await fixture({kind:'project'});await f.make().refresh();
  const account=new WebPrivateAccount(f.device.ownerId,f.device,f.transport,()=>{}),directory=f.transport.directory;
  let release;const held=new Promise(resolve=>{release=resolve;});
  f.transport.directory=async(...args)=>{await held;return directory(...args);};
  const target={scopeId:f.rootContext.scopeId,kind:'project',resourceId:'scope-resource',state:'active'};
  const tasks=[account.openScope(target,f.device.authorityPin,f.device.ownerId),account.openScope(target,f.device.authorityPin,f.device.ownerId)];
  try{
    const refused=tasks.map(task=>assert.rejects(task,/E2EE_UNLOCK_REQUIRED/));account.close();release();await Promise.all(refused);
    assert.throws(()=>account.shared(target.scopeId,'project',target.resourceId),/E2EE_UNLOCK_REQUIRED/);
  }finally{release();account.close();}
});

test('two readers establish missing authenticated floors atomically and converge after CAS',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('workspace','new-floor',bytes('SAME VERIFIED VERSION'),0);await client.flush('workspace','new-floor');
  for(const [key,row]of f.storage.rows)if(/^(floor:|confirmed:)/.test(row.envelope.context.objectId))f.storage.rows.delete(key);
  let release,arrived=0;const together=new Promise(resolve=>{release=resolve;}),read=f.transport.read;
  f.transport.read=async packet=>{const response=await read(packet);if(packet.command.action==='get'&&packet.command.payload.domain==='workspace'){
    if(++arrived===2)release();await together;
  }return response;};
  try{
    const opened=await Promise.all([client.read('workspace','new-floor'),client.read('workspace','new-floor')]);
    try{for(const result of opened)assert.equal(text(result.bytes),'SAME VERIFIED VERSION');}finally{opened.forEach(result=>result.bytes.fill(0));}
    const floors=[...f.storage.rows.values()].filter(row=>/^(floor:|confirmed:)/.test(row.envelope.context.objectId));
    assert.equal(floors.length,3);assert(floors.every(row=>row.serial===1));
  }finally{release();f.device.lock();}
});

test('an older in-flight read refuses a newer durable floor without overwriting it',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('workspace','changed-during-read',bytes('OLD VERSION'),0);await client.flush('workspace','changed-during-read');
  let release,observed;const held=new Promise(resolve=>{release=resolve;}),arrived=new Promise(resolve=>{observed=resolve;}),read=f.transport.read;
  f.transport.read=async packet=>{const response=await read(packet);if(packet.command.action==='get'&&packet.command.payload.domain==='workspace'){
    observed();await held;
  }return response;};
  const pending=client.read('workspace','changed-during-read');
  try{
    await arrived;await client.prepare('workspace','changed-during-read',bytes('NEW VERSION'),1);await client.flush('workspace','changed-during-read');
    const retained=JSON.stringify([...f.storage.rows]);release();
    await assert.rejects(pending,/E2EE_REMOTE_ROLLBACK/);assert.equal(JSON.stringify([...f.storage.rows]),retained);
  }finally{release();await pending.catch(()=>{});f.device.lock();}
});

test('read checkpoint CAS retries are bounded and preserve all original records',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('workspace','contended-floor',bytes('RETAINED VERSION'),0);await client.flush('workspace','contended-floor');
  for(const [key,row]of f.storage.rows)if(row.envelope.context.objectId.startsWith('floor:'))f.storage.rows.delete(key);
  const original=JSON.stringify([...f.storage.rows]),commit=f.storage.commit.bind(f.storage);let attempts=0;
  f.storage.commit=async(changes,signal)=>{if(changes.some(row=>row.value?.envelope.context.objectId.startsWith('floor:'))){attempts++;throw new Error('E2EE_LOCAL_CONFLICT');}return commit(changes,signal);};
  try{await assert.rejects(client.read('workspace','contended-floor'),/E2EE_LOCAL_CONFLICT/);assert.equal(attempts,4);assert.equal(JSON.stringify([...f.storage.rows]),original);}
  finally{f.device.lock();}
});
test('rotation keeps authentic history readable but rejects new ciphertext forged under an old epoch',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();await client.prepare('workspace','one',bytes('AUTHENTIC BEFORE ROTATION'),0);await client.flush('workspace','one');
  const original=f.server.objects.get('workspace\0one');await f.rotate();await client.refresh();
  assert.equal(text((await client.read('workspace','one')).bytes),'AUTHENTIC BEFORE ROTATION');
  const forged=await sealE2eeEnvelope(await importE2eeRoot(f.raw),f.keys.signing.privateKey,{...original.context,operationId:'forged-old-epoch'},bytes('FORGED LATER'));
  f.server.objects.set('workspace\0one',forged);await assert.rejects(client.read('workspace','one'),/REMOTE_ROLLBACK|UNSEALED_HISTORY/);
});
test('unsent old-epoch draft remains recoverable and requires explicit rebase after rotation',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();await client.prepare('diary','draft',bytes('UNSENT PRIVATE DRAFT'),0);
  await f.rotate();await client.refresh();await assert.rejects(client.flush('diary','draft'),/DRAFT_REBASE_REQUIRED/);
  assert.equal(text(await client.readDraft('diary','draft')),'UNSENT PRIVATE DRAFT');assert.equal(f.server.writes,0);
  assert.equal(await client.rebase('diary','draft',0),'rebased');assert.equal(await client.flush('diary','draft'),1);
  assert.equal(text((await client.read('diary','draft')).bytes),'UNSENT PRIVATE DRAFT');
});
test('signed existence rejects an empty server response on a new local floor',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();await client.prepare('workspace','one',bytes('PRIVATE'),0);await client.flush('workspace','one');
  await f.rotate();await client.refresh();
  for(const [key,value]of f.storage.rows)if(value.envelope.context.objectId.startsWith('floor:'))f.storage.rows.delete(key);
  f.server.objects.delete('workspace\0one');await assert.rejects(client.read('workspace','one'),/REMOTE_ROLLBACK/);
});
test('signed head is a minimum revision for current-epoch reads and saves on a clean local floor',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  for(const expected of [0,1]){await client.prepare('workspace','one',bytes(`revision-${expected+1}`),expected);await client.flush('workspace','one');}
  const original=f.server.objects.get('workspace\0one'),newRoot=await f.rotate();await client.refresh();
  for(const [key,value]of f.storage.rows)if(value.envelope.context.objectId.startsWith('floor:'))f.storage.rows.delete(key);
  await assert.rejects(client.prepare('workspace','one',bytes('STALE SAVE'),0),/OBJECT_CONFLICT/);
  const stale=await sealE2eeFile(await importE2eeRoot(newRoot),f.keys.signing.privateKey,
    {...original.context,cryptoEpoch:2,securityEpoch:2,keyId:'root-two',revision:1,operationId:'stale-current-epoch'},bytes('STALE BUT AUTHENTIC'),{filename:'',mediaType:'application/json'});
  f.server.objects.set('workspace\0one',stale.manifest);
  for(const chunk of stale.chunks)f.server.objects.set(`attachment\0${chunk.context.objectId}`,chunk);
  await assert.rejects(client.read('workspace','one'),/REMOTE_ROLLBACK/);
});
test('rebase preserves filename and media type in the durable encrypted job',async()=>{
  const f=await fixture();let client=f.make();await client.refresh();
  await client.prepare('attachment','photo',bytes('SYNTHETIC IMAGE BYTES'),0,{filename:'private-photo.png',mediaType:'image/png'});
  await f.rotate();client=await f.reopen();await client.refresh();await client.rebase('attachment','photo',0);await client.flush('attachment','photo');
  const opened=await client.read('attachment','photo');assert.equal(opened.filename,'private-photo.png');assert.equal(opened.mediaType,'image/png');
  assert.equal(text(opened.bytes),'SYNTHETIC IMAGE BYTES');assert.ok(!JSON.stringify([...f.storage.rows]).includes('private-photo.png'));
});
test('offline unlock opens durable drafts and accepts edits without any network; sync requires explicit refresh',async()=>{
  const f=await fixture();let client=f.make();await client.refresh();await client.prepare('diary','one',bytes('SAVED BEFORE OFFLINE'),0);
  client=await f.reopen();let network=0;
  for(const name of ['directory','read','command'])f.transport[name]=async()=>{network++;throw new Error('SYNTHETIC_OFFLINE');};
  assert.equal(text(await client.readDraft('diary','one')),'SAVED BEFORE OFFLINE');
  await client.hydrateOffline();await client.prepare('diary','two',bytes('NEW OFFLINE DRAFT'),0);
  assert.equal(text(await client.readDraft('diary','two')),'NEW OFFLINE DRAFT');assert.equal(network,0);
  await assert.rejects(client.flush('diary','two'),/REFRESH_REQUIRED/);assert.equal(network,0);
  assert.ok(!JSON.stringify([...f.storage.rows]).includes('OFFLINE DRAFT'));
});
test('editor keeps later offline edits while the first upload awaits a lost ACK, including restart and full disk',async()=>{
  const f=await fixture({crashAfterPut:true});let client=f.make();await client.refresh();
  let editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  const first=await editor.stage(bytes('FIRST EDIT'),null,0);await editor.stage(bytes('SECOND EDIT'),first,0);
  await assert.rejects(editor.flush(),/PROCESS_DEATH/);
  let saved=await editor.load();await editor.stage(bytes('THIRD EDIT WHILE PENDING'),saved.serial,0);
  f.storage.fail=true;saved=await editor.load();await assert.rejects(editor.stage(bytes('MUST NOT REPLACE'),saved.serial,0),/DISK_FULL/);f.storage.fail=false;
  client=await f.reopen();await client.hydrateOffline();editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  assert.equal(text((await editor.load()).bytes),'THIRD EDIT WHILE PENDING');
  await client.refresh();assert.equal(await editor.flush(),2);
  assert.equal(text((await client.read('diary','one')).bytes),'THIRD EDIT WHILE PENDING');assert.equal((await editor.load()).pending,false);
  assert.ok(!JSON.stringify([...f.storage.rows]).includes('THIRD EDIT'));
});
test('a new edit created during acknowledgement remains queued and a stale second tab cannot overwrite it',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  const oldSerial=await editor.stage(bytes('INITIAL'),null,0),original=f.transport.command;let edited=false;
  f.transport.command=async packet=>{
    const result=await original(packet);
    if(packet.command.action==='put'&&packet.command.payload.envelope.context.domain==='diary'&&!edited){edited=true;const state=await editor.load();await editor.stage(bytes('EDIT DURING ACK'),state.serial,state.remoteRevision);}
    return result;
  };
  assert.equal(await editor.flush(),2);assert.equal(text((await client.read('diary','one')).bytes),'EDIT DURING ACK');
  const secondTab=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await assert.rejects(secondTab.stage(bytes('STALE TAB'),oldSerial,0),/LOCAL_CONFLICT/);
  assert.equal(text((await secondTab.load()).bytes),'EDIT DURING ACK');
});
test('crash after scope receipt but before editor acknowledgement reconciles locally without another remote write',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('PRIVATE FINAL EDIT'),null,0);const commit=f.storage.commit.bind(f.storage);let crashed=false;
  f.storage.commit=async(changes,signal)=>{
    if(f.server.writes===2&&!crashed&&changes.some(change=>change.value?.envelope.context.objectId.startsWith('editor:'))){crashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
    return commit(changes,signal);
  };
  await assert.rejects(editor.flush(),/PROCESS_DEATH/);assert.equal((await client.localJob('diary','one')).complete,true);
  const writes=f.server.writes;assert.equal(await editor.flush(),1);assert.equal(f.server.writes,writes);assert.equal((await editor.load()).pending,false);
});
test('editor does not acknowledge a new edit after durable device keys disappear',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  const serial=await editor.stage(bytes('PRESERVED'),null,0);f.keyStorage.rows.clear();
  await assert.rejects(editor.stage(bytes('NEW UNSAFE EDIT'),serial,0),/DEVICE_KEY_UNAVAILABLE/);assert.equal(text((await editor.load()).bytes),'PRESERVED');
});
test('editor cannot expose plaintext through the async continuation after lock',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('PRIVATE LOCK CANARY'),null,0);const check=f.device.vault.assertUnlocked.bind(f.device.vault);let scheduled=false;
  f.device.vault.assertUnlocked=()=>{check();if(!scheduled){scheduled=true;queueMicrotask(()=>f.device.lock());}};
  await assert.rejects(editor.load(),/UNLOCK_REQUIRED/);
});
test('editor acknowledges the actual revision if a second worker completes a rebased job first',async()=>{
  const f=await fixture({crashBeforePut:true}),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('LOCAL EDIT'),null,0);await assert.rejects(editor.flush(),/PROCESS_DEATH/);
  const context={...f.server.lastPut.command.payload.envelope.context,domain:'diary',objectId:'one',revision:5,operationId:'other-device-head'};
  const remote=await sealE2eeFile(await importE2eeRoot(f.raw),f.keys.signing.privateKey,context,bytes('OTHER DEVICE EDIT'),{filename:'',mediaType:'application/json'});
  f.server.objects.set('diary\0one',remote.manifest);for(const chunk of remote.chunks)f.server.objects.set(`attachment\0${chunk.context.objectId}`,chunk);
  const rebase=client.rebase.bind(client);client.rebase=async(...args)=>{
    await rebase(...args);const job=await client.localJob('diary','one');await client.flush('diary','one',job.originId);return rebase(...args);
  };
  assert.equal(await editor.rebasePending(5),'already-confirmed');const saved=await editor.load();assert.equal(saved.remoteRevision,6);assert.equal(saved.pending,false);
  await editor.stage(bytes('NEXT EDIT'),saved.serial,6);
});
test('editor rejects a scope or device mismatch before accepting any personal text',async()=>{
  const f=await fixture(),client=f.make();
  assert.throws(()=>new E2eeEditorQueue(f.device,client,'project:wrong-scope','mindmap','one'),/SCOPE_BINDING_MISMATCH/);
  assert.throws(()=>new E2eeEditorQueue({vault:f.device.vault,ensureDurableKeys:()=>Promise.resolve()},client,f.rootContext.scopeId,'mindmap','one'),/SCOPE_BINDING_MISMATCH/);
  assert.equal(f.storage.rows.size,0);assert.equal(f.server.writes,0);
});
for(const dirty of [false,true])test(`editor reconciles a verified update from another device while retaining old snapshots (dirty: ${dirty})`,async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('INITIAL'),null,0);await editor.flush();let saved=await editor.load();
  if(dirty){await editor.stage(bytes('UNSENT LOCAL'),saved.serial,1);saved=await editor.load();}
  await client.prepare('diary','one',bytes('REMOTE UPDATE'),1);await client.flush('diary','one');await client.read('diary','one');
  if(dirty)await assert.rejects(editor.flush(),/OBJECT_CONFLICT/);
  saved=await editor.load(); // A failed flush still durably records its upload origin.
  await assert.rejects(editor.reconcile(bytes('UNVERIFIED'),saved.serial,3),/VERIFIED_REMOTE_REQUIRED/);
  const retained=f.storage.rows.size;
  await editor.reconcile(bytes(dirty?'MERGED LOCAL AND REMOTE':'REMOTE UPDATE'),saved.serial,2,{filename:'',mediaType:'application/json'},dirty?'merge':'cache');
  assert.ok(f.storage.rows.size>retained);saved=await editor.load();assert.equal(saved.remoteRevision,2);assert.equal(saved.pending,dirty);
  if(dirty){assert.equal(await editor.flush(),3);assert.equal(text((await client.read('diary','one')).bytes),'MERGED LOCAL AND REMOTE');}
  else {await editor.stage(bytes('NEXT EDIT'),saved.serial,2);assert.equal(await editor.flush(),3);}
});
test('reconciliation after lost editor ACK preserves a newer verified remote base while consuming the older receipt',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('LOCAL A'),null,0);const commit=f.storage.commit.bind(f.storage);let crashed=false;
  f.storage.commit=async(changes,signal)=>{
    if(f.server.writes===2&&!crashed&&changes.some(change=>change.value?.envelope.context.objectId.startsWith('editor:'))){crashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
    return commit(changes,signal);
  };
  await assert.rejects(editor.flush(),/PROCESS_DEATH/);assert.equal((await client.localJob('diary','one')).complete,true);
  const original=f.server.objects.get('diary\0one'),remote=await sealE2eeFile(await importE2eeRoot(f.raw),f.keys.signing.privateKey,
    {...original.context,revision:2,operationId:'remote-after-crash'},bytes('REMOTE B'),{filename:'',mediaType:'application/json'});
  f.server.objects.set('diary\0one',remote.manifest);for(const chunk of remote.chunks)f.server.objects.set(`attachment\0${chunk.context.objectId}`,chunk);
  await client.read('diary','one');const saved=await editor.load();await editor.reconcile(bytes('MERGED A AND B'),saved.serial,2);
  assert.equal(await editor.flush(),3);assert.equal((await editor.load()).remoteRevision,3);assert.equal(text((await client.read('diary','one')).bytes),'MERGED A AND B');
});
for(const manifestAccepted of [false,true])test(`rebase resolves lost ACK before rotation (manifest accepted: ${manifestAccepted})`,async()=>{
  const f=await fixture({crashAfterPut:true,crashAtWrite:manifestAccepted?2:1});let client=f.make();await client.refresh();
  await client.prepare('workspace','one',bytes('DURABLE PRIVATE EDIT'),0);await assert.rejects(client.flush('workspace','one'),/PROCESS_DEATH/);
  await f.rotate();client=await f.reopen();await client.refresh();
  assert.equal(await client.rebase('workspace','one',0),manifestAccepted?'already-confirmed':'rebased');
  if(!manifestAccepted)await client.flush('workspace','one');
  assert.equal(text((await client.read('workspace','one')).bytes),'DURABLE PRIVATE EDIT');
});
test('durable cancel tombstone blocks a delayed original put; crash during cancel preserves the draft',async()=>{
  const f=await fixture({crashBeforePut:true,crashAfterCancel:true});let client=f.make();await client.refresh();
  await client.prepare('diary','one',bytes('PRESERVED DURING REBASE'),0);await assert.rejects(client.flush('diary','one'),/PROCESS_DEATH/);
  const delayed=f.server.lastPut;await f.rotate();await client.refresh();await assert.rejects(client.rebase('diary','one',0),/PROCESS_DEATH/);
  client=await f.reopen();await client.refresh();assert.equal(await client.rebase('diary','one',0),'rebased');
  assert.deepEqual(await f.transport.command(delayed),{cancelled:true});assert.equal(f.server.writes,0);
  await client.flush('diary','one');assert.equal(text((await client.read('diary','one')).bytes),'PRESERVED DURING REBASE');
});

test('parameterless product reads send a signed versioned payload without weakening the command codec',async()=>{
  const f=await fixture(),client=f.make(),seen=[];
  const methods=[['readTransitionCandidates','resource-transition-candidates'],['readProductContext','product-context'],
    ['readStoicheionState','stoicheion-state'],['readAdvicePolicy','advice-policy'],['sharedReadHistory','shared-read-history']];
  const original=f.transport.read.bind(f.transport);
  f.transport.read=async packet=>{
    const command=await verifyE2eeCommand(packet,f.keys.signing.publicKey);
    if(!methods.some(([,action])=>command.action===action))return original(packet);
    assert.deepEqual(command.payload,{protocol:1});seen.push(command.action);
    const base={checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision};
    return command.action==='shared-read-history'?{...base,history:{ownerId:command.ownerId,readFlags:{},watching:{}}}:base;
  };
  try{await client.refresh();for(const [method]of methods)await client[method]();
    assert.deepEqual(seen,methods.map(([,action])=>action));assert.equal(f.server.writes,0);
  }finally{f.device.lock();}
});

test('bootstrap discovery signs an initial null cursor and every supported nonnegative part index',async()=>{
  const f=await fixture(),client=f.make(),seen=[],original=f.transport.read.bind(f.transport);
  f.transport.read=async packet=>{
    const command=await verifyE2eeCommand(packet,f.keys.signing.publicKey);
    if(command.action!=='product-bootstrap-state')return original(packet);
    seen.push(command.payload.afterPart);
    return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,bootstrap:null,part:null};
  };
  try{
    await client.refresh();await client.readBootstrapState();for(const part of [-1,0,255,256,4095])await client.readBootstrapState(part);
    assert.deepEqual(seen,[null,null,0,255,256,4095]);
    for(const part of [-2,4096,1.5])await assert.rejects(client.readBootstrapState(part),/E2EE_INVALID_LIMIT/);
    assert.equal(f.server.writes,0);
  }finally{f.device.lock();}
});
