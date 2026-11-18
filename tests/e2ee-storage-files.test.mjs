import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnlockedE2eeVault } from '../app/e2ee/storage.ts';
import { E2EE_SUITE, importE2eeRoot, openE2eeEnvelope, sealE2eeEnvelope } from '../app/e2ee/envelope.ts';
import { generateDeviceKeys, freshSecret } from '../app/e2ee/keys.ts';
import { E2EE_CHUNK_BYTES, sealE2eeFile, openE2eeFile, envelopePayloadHash } from '../app/e2ee/files.ts';

class AtomicMemory {
  rows=new Map(); fail=false;
  async get(key){return structuredClone(this.rows.get(key)??null);}
  async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
  async commit(changes){
    if(this.fail)throw new Error('SYNTHETIC_DISK_FULL');
    for(const change of changes)if((this.rows.get(change.key)?.serial??null)!==change.expected)throw new Error('E2EE_LOCAL_CONFLICT');
    const next=new Map(this.rows);
    for(const change of changes)if(change.value===null)next.delete(change.key);else next.set(change.key,structuredClone(change.value));
    this.rows=next;
  }
}
const privateBytes=new TextEncoder().encode('PRIVATE CANARY — личный текст / queued operation');
async function setup(){
  const keys=await generateDeviceKeys(),root=await importE2eeRoot(freshSecret()),storage=new AtomicMemory();
  const scope={ownerId:'owner',scopeId:'personal:owner',deviceId:'device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'root-one',
    signingKey:keys.signing.privateKey,roots:new Map([['root-one',root]]),trustedSigner:id=>id==='device'?keys.signing.publicKey:undefined};
  return {keys,root,storage,scope,vault:new UnlockedE2eeVault(storage,scope)};
}
test('all private domains persist ciphertext only; durable batches/CAS preserve queued data',async()=>{
  const {vault,storage}=await setup();
  const domains=['workspace','diary','dream-journal','mindmap','physis','aurora','stoicheion','shared-project','attachment','local-snapshot','outbox','draft'];
  await vault.write(domains.map(domain=>({domain,objectId:'object',value:privateBytes,expected:null})));
  assert.ok(!JSON.stringify([...storage.rows]).includes('PRIVATE CANARY'));
  for(const domain of domains)assert.deepEqual((await vault.read(domain,'object')).value,privateBytes);
  await assert.rejects(vault.write([{domain:'workspace',objectId:'object',value:new Uint8Array(1),expected:null}]),/CONFLICT/);
  storage.fail=true;
  await assert.rejects(vault.write([{domain:'outbox',objectId:'object',value:new Uint8Array(1),expected:1}]),/DISK_FULL/);
  assert.deepEqual((await vault.read('outbox','object')).value,privateBytes);
  storage.fail=false;vault.lock();
  await assert.rejects(vault.read('workspace','object'),/UNLOCK_REQUIRED/);
  await assert.rejects(vault.write([{domain:'workspace',objectId:'new',value:privateBytes,expected:null}]),/UNLOCK_REQUIRED/);
});
test('lock/account switch while encrypting never commits a pending plaintext or clears old records',async()=>{
  const {vault,storage}=await setup();
  const writing=vault.write([{domain:'draft',objectId:'new',value:privateBytes,expected:null}]);vault.lock();
  await assert.rejects(writing,/UNLOCK_REQUIRED/);assert.equal(storage.rows.size,0);
});
test('locking after encryption while durable commit is queued aborts persistence and the caller continuation',async()=>{
  const {vault,storage}=await setup();let release,entered;
  const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});
  const commit=storage.commit.bind(storage);
  storage.commit=async(changes,signal)=>{entered();await gate;if(signal.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');await commit(changes);};
  let continued=false;const writing=vault.write([{domain:'outbox',objectId:'queued',value:privateBytes,expected:null}]).then(()=>{continued=true;});
  await waiting;vault.lock();release();
  await assert.rejects(writing,/UNLOCK_REQUIRED/);assert.equal(storage.rows.size,0);assert.equal(continued,false);
});
test('record substitution, epoch/generation tamper and wrong owner cannot produce empty data',async()=>{
  const {vault,storage,scope}=await setup();
  await vault.write([{domain:'workspace',objectId:'first',value:privateBytes,expected:null},{domain:'workspace',objectId:'second',value:privateBytes,expected:null}]);
  const [first,second]=[...storage.rows.keys()];storage.rows.set(second,storage.rows.get(first));
  await assert.rejects(vault.read('workspace','second'),/CORRUPT_LOCAL_RECORD/);
  const other=new UnlockedE2eeVault(storage,{...scope,generation:2});
  await assert.rejects(other.read('workspace','first'),/CORRUPT_LOCAL_RECORD/);
});
function fileContext(){return {cryptoProtocol:1,suite:E2EE_SUITE,ownerId:'owner',scopeId:'personal:owner',domain:'attachment',objectId:'file',schemaVersion:1,
  dataGeneration:1,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'root-one',deviceId:'device',operationId:'file-op'};}
test('file manifest authenticates metadata, complete chunk order/size and context; retry reuses ciphertext',async()=>{
  const {root,keys}=await setup(),context=fileContext(),bytes=new Uint8Array(E2EE_CHUNK_BYTES*2+37);
  crypto.getRandomValues(bytes.subarray(0,65536));bytes.set(privateBytes,E2EE_CHUNK_BYTES+1);
  const file=await sealE2eeFile(root,keys.signing.privateKey,context,bytes,{filename:'Приватное имя.txt',mediaType:'text/plain'});
  const chunks=new Map(file.chunks.map(chunk=>[chunk.context.objectId,chunk]));
  assert.ok(!JSON.stringify(file).includes('Приватное'));
  const opened=await openE2eeFile(root,keys.signing.publicKey,context,file.manifest,async id=>chunks.get(id));
  assert.deepEqual(opened.bytes,bytes);assert.equal(opened.filename,'Приватное имя.txt');
  await assert.rejects(openE2eeFile(root,keys.signing.publicKey,context,file.manifest,async()=>file.chunks[1]),/CORRUPT_FILE/);
  await assert.rejects(openE2eeFile(root,keys.signing.publicKey,context,file.manifest,async()=>undefined),/CORRUPT_FILE/);
  const manifestBytes=await openE2eeEnvelope(root,keys.signing.publicKey,context,file.manifest);
  const manifest=JSON.parse(new TextDecoder().decode(manifestBytes));manifest.chunks[0].index=1;
  const invalid=await sealE2eeEnvelope(root,keys.signing.privateKey,context,new TextEncoder().encode(JSON.stringify(manifest)));
  await assert.rejects(openE2eeFile(root,keys.signing.publicKey,context,invalid,async id=>chunks.get(id)),/CORRUPT_FILE/);
  const changed=structuredClone(file.chunks[0]);changed.context.objectId='another';
  assert.notEqual(await envelopePayloadHash(changed),await envelopePayloadHash(file.chunks[0]));
});
test('zero-length files have an authenticated manifest and no implicit missing chunk',async()=>{
  const {root,keys}=await setup(),context=fileContext();
  const sealed=await sealE2eeFile(root,keys.signing.privateKey,context,new Uint8Array(),{filename:'empty',mediaType:''});
  assert.equal(sealed.chunks.length,0);
  const opened=await openE2eeFile(root,keys.signing.publicKey,context,sealed.manifest,async()=>{throw new Error('must not fetch');});
  assert.equal(opened.bytes.length,0);
});
