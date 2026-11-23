import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {UnlockedE2eeVault} from '../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys} from '../app/e2ee/keys.ts';
import {importE2eeRoot} from '../app/e2ee/envelope.ts';
import {newBackupRecoveryKey,sealBackup} from '../app/backup-format.ts';
const ts=createRequire(import.meta.url)('typescript');
const source=ts.transpileModule(readFileSync(new URL('../app/backup-drive.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText;
class Memory{
  rows=new Map();
  async get(key){return structuredClone(this.rows.get(key)??null);}
  async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
  async commit(changes,signal){assert(!signal?.aborted);for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);for(const row of changes)if(row.value===null)this.rows.delete(row.key);else this.rows.set(row.key,structuredClone(row.value));}
}
async function fixture(){
  const owner=crypto.randomUUID(),connectionId=crypto.randomUUID(),backupId=crypto.randomUUID(),keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
  const memory=new Memory(),vault=new UnlockedE2eeVault(memory,{ownerId:owner,scopeId:'device:drive-test',deviceId:'drive-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'local-root',signingKey:keys.signing.privateKey,roots:new Map([['local-root',root]]),trustedSigner:id=>id==='drive-device'?keys.signing.publicKey:undefined});
  let open=true,active,corrupt=false,enabled=true,connected=connectionId,hold;
  const account={ownerId:owner,device:{vault,async ensureDurableKeys(){}},requireOpen(){if(!open)throw new Error('E2EE_ACCOUNT_CHANGED');}};active=account;
  const calls=[],remote=new Map(),fileId='drive_fixture_file_001',exports={exports:{}};
  const request=async(actor,path,body)=>{
    assert.equal(actor,owner);calls.push({path,body});await hold?.(path);
    if(path==='status')return{enabled,connectionId:connected,consentVersion:'encrypted-drive-backup-336-v1'};
    if(path==='prepare')return{fileId,operationId:body.operationId};
    if(path==='commit'){remote.set(fileId,body);return{fileId,operationId:body.operationId,sha256:body.sha256,bytes:body.bytes,verified:true};}
    if(path==='download'){const row=remote.get(body.fileId);return{fileId:body.fileId,sha256:row.sha256,bytes:row.bytes,file:corrupt?row.file.replace('genesisbackup','broken-archive'):row.file};}
    if(path==='disconnect'){enabled=false;connected=null;return{ok:true};}
    if(path==='web-connect')return{url:'https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture'};
    throw new Error('Unexpected fixture route: '+path);
  };
  new Function('require','module','exports',source)(id=>{
    if(id==='./cloud-sync')return{privateDriveRequest:request};
    if(id==='./e2ee/message-lifetime')return{captureMessagingAccess:()=>()=>account.requireOpen()};
    if(id==='./e2ee/product-session')return{requirePrivateAccount:()=>active};
    return calendarModule('app/'+id.slice(2)+(/\.ts$/.test(id)?'':'.ts'));
  },exports,exports.exports);
  const adapter=exports.exports.backupDriveAdapter(account),file=await sealBackup({schema:1,backupId,source:'device_snapshot',ownerId:owner,createdAt:new Date().toISOString(),client:'web',billingEvidence:null,sections:[]},newBackupRecoveryKey());
  return{adapter,file,memory,remote,calls,retire:()=>{open=false;},swap:()=>{active={};},corrupt:()=>{corrupt=true;},reconnect:()=>{connected=crypto.randomUUID();},hold:callback=>{hold=callback;}};
}
test('Drive completion requires actual downloaded ciphertext and durable encrypted local readback',async()=>{
  const f=await fixture(),id=await f.adapter.stage(f.file);assert.deepEqual(await f.adapter.pending(),[id]);
  const receipt=await f.adapter.retry(id);assert.equal(receipt.verified,true);assert.deepEqual(await f.adapter.pending(),[]);
  assert.equal((await f.adapter.stagedFile(id)).file,f.file);assert(f.calls.some(row=>row.path==='download'));
  assert.equal(JSON.stringify([...f.memory.rows.values()]).includes(f.file),false);
});
test('a corrupt downloaded file keeps the upload pending and the original encrypted intent intact',async()=>{
  const f=await fixture(),id=await f.adapter.stage(f.file);f.corrupt();await assert.rejects(f.adapter.retry(id),/DRIVE_INVALID_RESPONSE/);
  assert.deepEqual(await f.adapter.pending(),[id]);assert.equal((await f.adapter.stagedFile(id)).file,f.file);
});
test('late account retirement or replacement cannot persist a newly staged Drive intent',async()=>{
  for(const mode of ['retire','swap']){const f=await fixture();f.hold(async path=>{if(path==='status')f[mode]();});await assert.rejects(f.adapter.stage(f.file),/E2EE_ACCOUNT_CHANGED/);assert.equal(f.memory.rows.size,0);}
});
test('connection replacement refuses upload before prepare or commit without losing the intent',async()=>{
  const f=await fixture(),id=await f.adapter.stage(f.file);f.reconnect();await assert.rejects(f.adapter.retry(id),/DRIVE_CONNECTION_CHANGED/);
  assert(!f.calls.some(row=>row.path==='prepare'||row.path==='commit'));assert.deepEqual(await f.adapter.pending(),[id]);
});
test('Drive keeps its smaller transport limit and refuses oversized local archives before network IO',async()=>{
  const f=await fixture();await assert.rejects(f.adapter.stage('x'.repeat(24*1024*1024+1)),/BACKUP_TOO_LARGE/);assert.equal(f.calls.length,0);assert.equal(f.memory.rows.size,0);
});
test('disconnect never deletes remote files or encrypted local work and does not authorize another upload',async()=>{
  const f=await fixture(),id=await f.adapter.stage(f.file);await f.adapter.retry(id);const original=structuredClone(f.memory.rows);
  await f.adapter.disconnect();assert.equal(f.remote.size,1);assert.deepEqual(f.memory.rows,original);assert(!f.calls.some(row=>/delete|trash/i.test(row.path)));
  await assert.rejects(f.adapter.stage(f.file),/DRIVE_CONNECTION_REQUIRED/);assert.deepEqual(f.memory.rows,original);
});
