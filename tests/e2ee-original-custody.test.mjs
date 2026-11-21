import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalE2eeValue,signE2eeCommand} from '../app/e2ee/commands.ts';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {encodeE2eeBytes,decodeE2eeBytes} from '../app/e2ee/envelope.ts';
import {createRecoveryKit,freshSecret,openBundle,protectBundle,generateDeviceKeys,publicDeviceKeys} from '../app/e2ee/keys.ts';
import {ORIGINAL_CUSTODY_PURPOSE,sealOriginalCustody,openOriginalCustody,persistOriginalCustody,recoverOriginalCustody,recoverOriginalCustodyById,validateOriginalCustodyId} from '../app/e2ee/original-custody.ts';
import {ProtectedSourceStage} from '../app/e2ee/source-stage.ts';
class Records {
 rows=new Map();beforeGet;
 async get(key){await this.beforeGet?.(key);return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes){for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);for(const row of changes)this.rows.set(row.key,structuredClone(row.value));}
}
class Keys {
 rows=new Map();
 async get(owner){return structuredClone(this.rows.get(owner)??null);}
 async create(owner,bundle){if(this.rows.has(owner))throw new Error('E2EE_DEVICE_ALREADY_EXISTS');this.rows.set(owner,{serial:1,bundle:structuredClone(bundle)});}
}
class Custody {
 rows=new Map();descriptions=new Map();beforeGet;beforeCreate;
 async get(owner,id,current){await validateOriginalCustodyId(owner,id);await this.beforeGet?.();current();return structuredClone(this.rows.get(id)??null);}
 async describe(owner,id,current){await validateOriginalCustodyId(owner,id);current();return structuredClone(this.descriptions.get(id)??null);}
 async create(owner,artifact,current,reference){await validateOriginalCustodyId(owner,artifact.id);await this.beforeCreate?.();current();if(this.rows.has(artifact.id))throw new Error('E2EE_DEVICE_ALREADY_EXISTS');this.rows.set(artifact.id,structuredClone(artifact));this.descriptions.set(artifact.id,structuredClone(reference));}
 async list(){return [...this.rows.keys()];}
}
async function fixture(){
 const owner='original-custody-owner',recovery=await createRecoveryKit(owner),records=new Records(),keys=new Keys(),custody=new Custody();
 const device=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,records,keys),target={ownerId:'separate-project-owner',scopeId:'project:custody',kind:'project'};
 let live=true;const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const stage=await ProtectedSourceStage.create({vault:device.vault,target,paths:['project.content'],capacity:{maximumBytes:1024*1024,maximumParts:8},assertCurrent:current,ensureDurableKeys:()=>device.ensureDurableKeys(),admit:async()=>{}});
 const expected=new Uint8Array(300003);for(let i=0;i<expected.length;i++)expected[i]=i%251;
 await stage.capturePath('project.content',async write=>{for(let i=0;i<expected.length;i+=65536)await write(expected.subarray(i,i+65536));});const stageReference=await stage.finish();
 const clear=await openBundle(owner,'device-vault',recovery.secret,keys.rows.get(owner).bundle);let raw,saved;
 try{saved=JSON.parse(new TextDecoder().decode(clear));raw=decodeE2eeBytes(saved.localRoot,32);}finally{clear.fill(0);}
 const sealOptions={original:{...device.vault.localIdentity(),generation:1,cryptoEpoch:1,securityEpoch:1},keyId:saved.localKeyId,signer:saved.deviceKeys.signingKey,root:raw,
  primaryPin:recovery.kit.authority,recoveryKit:recovery.kit,secret:recovery.secret,assertCurrent:current};
 const sealed=await sealOriginalCustody(sealOptions);raw.fill(0);
 const options={ownerId:owner,primaryPin:recovery.kit.authority,recoveryKit:recovery.kit,secret:recovery.secret,reference:sealed.reference,artifact:sealed.artifact,records,assertCurrent:current};
 return{owner,recovery,records,keys,custody,device,target,expected,stageReference,sealed,options,sealOptions,saved,retire:()=>{live=false;}};
}
async function consume(handle,expected){let at=0;const reader=handle.openPath('project.content');for await(const bytes of reader.chunks){assert.deepEqual(bytes,expected.subarray(at,at+bytes.length));at+=bytes.length;}reader.assertComplete();assert.equal(at,expected.length);}
async function rewrap(f,change){
 const clear=await openBundle(f.owner,ORIGINAL_CUSTODY_PURPOSE,f.recovery.secret,f.sealed.artifact.bundle);let payload;
 try{payload=JSON.parse(new TextDecoder().decode(clear));}finally{clear.fill(0);}await change(payload);
 const bytes=new TextEncoder().encode(JSON.stringify(payload));let bundle;
 try{bundle=await protectBundle(f.owner,ORIGINAL_CUSTODY_PURPOSE,f.recovery.secret,bytes);}finally{bytes.fill(0);}
 const artifact={...f.sealed.artifact,bundle},hash=encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',canonicalE2eeValue(artifact))));
 return{...f.options,artifact,reference:{...f.sealed.reference,hash}};
}

test('owner-authenticated custody opens original stage after old vault loss; fresh device keeps its own independent signing identity',async()=>{
 const f=await fixture(),before=JSON.stringify([...f.records.rows]);await persistOriginalCustody(f.custody,f.owner,f.sealed,f.options.assertCurrent);
 const privateOld=f.saved.deviceKeys.signingPrivate,oldId=f.device.deviceId;f.device.lock();f.keys.rows.clear();
 const fresh=await UnlockedWebDevice.provision(f.owner,f.recovery.secret,f.recovery.kit,f.records,f.keys);assert.notEqual(fresh.deviceId,oldId);
 const opened=await recoverOriginalCustody({...f.options,storage:f.custody});assert.deepEqual(Object.keys(opened).sort(),['close','openLegacy','openStage','reference']);
 assert.equal(opened.keys,undefined);assert.equal(opened.root,undefined);assert.equal(opened.write,undefined);assert.equal(opened.storage,undefined);
 const stage=await opened.openStage(f.target,f.stageReference);await consume(stage,f.expected);stage.close();opened.close();
 const clear=await openBundle(f.owner,ORIGINAL_CUSTODY_PURPOSE,f.recovery.secret,f.sealed.artifact.bundle);
 try{const payload=JSON.parse(new TextDecoder().decode(clear));assert.deepEqual(Object.keys(payload).sort(),['certificate','protocol','root']);assert.ok(!new TextDecoder().decode(clear).includes(privateOld));}
 finally{clear.fill(0);}
 assert.equal(JSON.stringify([...f.records.rows]),before);assert.ok(!JSON.stringify([...f.custody.rows]).includes(privateOld));
 await assert.rejects(opened.openStage(f.target,f.stageReference),/ORIGINAL_SOURCE_CLOSED/);fresh.lock();f.recovery.secret.fill(0);
});
test('wrong secret, either changed primary public key, and an otherwise valid same-owner project kit refuse without source writes',async()=>{
 const f=await fixture(),other=await createRecoveryKit(f.owner),before=JSON.stringify([...f.records.rows]);
 for(const change of [{secret:freshSecret()},{primaryPin:{...f.options.primaryPin,signingKey:other.kit.authority.signingKey}},
  {primaryPin:{...f.options.primaryPin,receivingKey:other.kit.authority.receivingKey}},{recoveryKit:other.kit,secret:other.secret},
  {primaryPin:other.kit.authority,recoveryKit:other.kit,secret:other.secret},{ownerId:'different-owner'}])await assert.rejects(openOriginalCustody({...f.options,...change}),/E2EE_/);
 assert.equal(JSON.stringify([...f.records.rows]),before);f.device.lock();
});
test('root signer original coordinates purpose and artifact substitution cannot be accepted with a recomputed ciphertext hash',async()=>{
 const f=await fixture(),other=await generateDeviceKeys(),otherPublic=await publicDeviceKeys(other);
 const changes=[p=>{p.root=encodeE2eeBytes(freshSecret());},p=>{p.certificate.command.payload.signer=otherPublic.signingKey;},p=>{p.certificate.command.payload.original.generation=2;},
  p=>{p.certificate.command.action='enroll';},p=>{p.certificate.command.payload.artifactId=f.sealed.artifact.id.replace(/.$/,'0');},p=>{p.deviceKeys=f.saved.deviceKeys;},
  async p=>{p.certificate=await signE2eeCommand(p.certificate.command,f.device.keys().signing.privateKey);}];
 for(const change of changes)await assert.rejects(openOriginalCustody(await rewrap(f,change)),/E2EE_/);
 // Even a valid owner signature cannot make a changed expected source/root true.
 await assert.rejects(openOriginalCustody(await rewrap(f,async p=>{p.certificate.command.payload.original.cryptoEpoch=2;p.certificate=await signE2eeCommand(p.certificate.command,f.recovery.keys.signing.privateKey);})),/ORIGINAL_CUSTODY/);
 for(const change of [{original:{...f.sealed.reference.original,deviceId:'wrong-device'}},{keyId:'different-key'}, {signer:otherPublic.signingKey}])await assert.rejects(openOriginalCustody({...f.options,reference:{...f.sealed.reference,...change}}),/E2EE_/);
 f.device.lock();
});
test('custody input trust, separately entered secret, root and callbacks are owned before asynchronous work',async()=>{
 const f=await fixture(),raw=decodeE2eeBytes(f.saved.localRoot,32),secret=new Uint8Array(f.recovery.secret),original={...f.sealOptions.original},pin={...f.options.primaryPin};
 const input={...f.sealOptions,original,primaryPin:pin,root:raw,secret};const pending=sealOriginalCustody(input);raw.fill(0);secret.fill(0);original.ownerId='mutated';pin.receivingKey='invalid';input.assertCurrent=()=>{throw new Error('REPLACED');};
 const sealed=await pending;const opened=await openOriginalCustody({...f.options,...sealed});await consume(await opened.openStage(f.target,f.stageReference),f.expected);opened.close();
 await persistOriginalCustody(f.custody,f.owner,f.sealed,f.options.assertCurrent);
 const source={...f.options,primaryPin:{...f.options.primaryPin},reference:structuredClone(f.sealed.reference),secret:new Uint8Array(f.recovery.secret),storage:f.custody};
 const restoring=recoverOriginalCustody(source);source.secret.fill(0);source.primaryPin.signingKey='invalid';source.reference.signer='invalid';source.assertCurrent=()=>{throw new Error('REPLACED');};source.records=new Records();
 const recovered=await restoring;await consume(await recovered.openStage(f.target,f.stageReference),f.expected);recovered.close();f.device.lock();
});
test('cold read failure, create conflict, missing readback and retirement preserve every original and never return a custody receipt',async()=>{
 const f=await fixture(),before=JSON.stringify([...f.records.rows]);await persistOriginalCustody(f.custody,f.owner,f.sealed,f.options.assertCurrent);
 await assert.rejects(persistOriginalCustody(f.custody,f.owner,f.sealed,f.options.assertCurrent),/ALREADY_EXISTS/);assert.equal(f.custody.rows.size,1);
 const dropped={...f.custody,create:async()=>{},get:async()=>null,describe:async()=>null};await assert.rejects(persistOriginalCustody(dropped,f.owner,f.sealed,f.options.assertCurrent),/CUSTODY_UNAVAILABLE/);
 const conflict={create:async()=>{throw new Error('E2EE_STORAGE_CAPACITY');},get:async()=>{throw new Error('READ_FORBIDDEN');},describe:async()=>null};
 await assert.rejects(persistOriginalCustody(conflict,f.owner,f.sealed,f.options.assertCurrent),/STORAGE_CAPACITY/);
 f.custody.beforeGet=()=>f.retire();await assert.rejects(recoverOriginalCustody({...f.options,storage:f.custody}),/ACCOUNT_CHANGED/);
 assert.equal(JSON.stringify([...f.records.rows]),before);f.device.lock();
});
test('revocation wipes a borrowed original chunk and rejects in-flight source reads after recovery',async()=>{
 const f=await fixture(),opened=await openOriginalCustody(f.options),stage=await opened.openStage(f.target,f.stageReference),reader=stage.openPath('project.content');
 const first=await reader.chunks.next();assert.ok(first.value.some(b=>b!==0));opened.close();assert.ok(first.value.every(b=>b===0));await assert.rejects(reader.chunks.next(),/ORIGINAL_SOURCE_CLOSED/);
 const next=await openOriginalCustody(f.options),nextStage=await next.openStage(f.target,f.stageReference);let release,hit;const reached=new Promise(resolve=>{hit=resolve;});
 f.records.beforeGet=async key=>{if(key.includes(':p:00:00000')){hit();await new Promise(resolve=>{release=resolve;});}};
 const pending=nextStage.openPath('project.content').chunks.next();await reached;next.close();release();await assert.rejects(pending,/ORIGINAL_SOURCE_CLOSED/);f.device.lock();
});
test('product custody refuses memory-only device/key ports; wrong owner locator refuses before a custody body read',async()=>{
 const f=await fixture();await assert.rejects(f.device.preserveOriginalSources(f.recovery.secret,f.recovery.kit,f.options.assertCurrent),/STORAGE_PROVIDER_REQUIRED/);
 let reads=0;const storage={get:async()=>{reads++;throw new Error('BODY_FORBIDDEN');}};
 await assert.rejects(recoverOriginalCustody({...f.options,storage,ownerId:'other-owner'}),/ORIGINAL_CUSTODY/);assert.equal(reads,0);f.device.lock();
});

test('after losing old keys and the in-memory reference, owner-only discovery recovers authenticated originals and refuses replaced public metadata',async()=>{
 const f=await fixture();await persistOriginalCustody(f.custody,f.owner,f.sealed,f.options.assertCurrent);f.device.lock();f.keys.rows.clear();
 const {reference:discarded,artifact:unused,...rest}=f.options;const [id]=await f.custody.list(f.owner);assert.equal(id,discarded.id);assert.ok(unused);
 const input={...rest,id,storage:f.custody},reader=await recoverOriginalCustodyById(input);await consume(await reader.openStage(f.target,f.stageReference),f.expected);reader.close();
 f.custody.descriptions.set(id,{...discarded,signer:(await publicDeviceKeys(await generateDeviceKeys())).signingKey});
 await assert.rejects(recoverOriginalCustodyById(input),/ORIGINAL_CUSTODY/);f.custody.descriptions.delete(id);await assert.rejects(recoverOriginalCustodyById(input),/CUSTODY_UNAVAILABLE/);
});

test('malformed read ports refuse before decryption and a discovered reference accessor is never invoked',async()=>{
 const f=await fixture();for(const records of [null,{}, {get:async()=>null}, {get:1,list:async()=>[]}])await assert.rejects(openOriginalCustody({...f.options,records}),/INVALID_ORIGINAL_CUSTODY/);
 await persistOriginalCustody(f.custody,f.owner,f.sealed,f.options.assertCurrent);let calls=0;
 const descriptor={...f.sealed.reference};Object.defineProperty(descriptor,'id',{enumerable:true,get(){calls++;return f.sealed.reference.id;}});
 f.custody.describe=async()=>descriptor;
 await assert.rejects(recoverOriginalCustodyById({...f.options,id:f.sealed.reference.id,storage:f.custody}),/INVALID_COMMAND/);assert.equal(calls,0);f.device.lock();
});
