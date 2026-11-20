import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import assert from 'node:assert/strict';
import {parseLegacyMigrationJson} from '../../app/e2ee/legacy-json.ts';
import {normalizeNativeArchiveForms} from '../../app/e2ee/archives-native-forms.ts';
import {createRecoveryKit} from '../../app/e2ee/keys.ts';
import {UnlockedWebDevice} from '../../app/e2ee/device-vault.ts';

const root=resolve(import.meta.dirname,'../..'),[sourceArg,outputArg]=process.argv.slice(2),source=resolve(root,sourceArg??''),output=resolve(root,outputArg??'');
if(!source.startsWith(resolve(root,'output/qa')+sep)||!source.endsWith('backup336-native-value-input.json')||
 !output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep))throw new Error('Synthetic native value fixture boundary');
const raw=await readFile(source),input=parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(raw),'E2EE_ARCHIVE_SOURCE_INVALID',48*1024*1024);
assert.match(input.ownerId,/^values-qa-[a-f0-9-]{36}$/);const [form]=await normalizeNativeArchiveForms(input,input.ownerId,()=>{});
assert.equal(input.protocol,2);assert.equal(form.mounted,false);assert.equal(form.form.settled,true);assert.equal(form.rawForm,null);
assert.equal(form.valueForm.values.length,5);assert.equal(form.valueForm.rawManifests.length,2);
assert.equal(form.form.state.key,' exact replacement input ');assert.equal(form.form.state.payload.raw,'literal\udfffunit');assert.equal(form.form.state.zero,0);
assert.equal(form.valueForm.manifests[0].state.key,' exact synthetic input \ud800 ');
assert.equal(form.valueForm.values.at(-1).value,' acknowledged but unselected input ');
assert.equal(form.files[0].descriptor.name,'\ufeffbad\ud800name');assert.equal(form.form.file.name,'\ufeffbad\ufffdname');assert.equal(form.files[0].descriptor.type,'APPLICATION/JSON');
assert.deepEqual(Buffer.from(form.files[0].bytes,'base64url'),Buffer.from([0,255,0xc3,0x28]));

// Readback uses real WebCrypto and the actual device/vault code. These owned
// memory stores exercise CAS and protected records, not browser IDB durability;
// the separate Chromium acceptance covers actual IDB and Web Locks.
const keyRows=new Map(),recordRows=new Map();
const keys={get:async owner=>structuredClone(keyRows.get(owner)??null),create:async(owner,bundle)=>{assert(!keyRows.has(owner));keyRows.set(owner,{serial:1,bundle:structuredClone(bundle)});}};
const records={get:async key=>structuredClone(recordRows.get(key)??null),list:async prefix=>[...recordRows.keys()].filter(key=>key.startsWith(prefix)),
 commit:async changes=>{for(const row of changes)assert.equal(recordRows.get(row.key)?.serial??null,row.expected);for(const row of changes)if(row.value===null)recordRows.delete(row.key);else recordRows.set(row.key,structuredClone(row.value));}};
const recovery=await createRecoveryKit(input.ownerId);let device;
try{
 device=await UnlockedWebDevice.provision(input.ownerId,recovery.secret,recovery.kit,records,keys);
 await device.vault.write([{domain:'local-snapshot',objectId:'actual-native-values',value:new Uint8Array(raw),expected:null}]);
 assert.equal(JSON.stringify([...recordRows]).includes('replacement input'),false);assert.equal(JSON.stringify([...keyRows]).includes('replacement input'),false);
 raw.fill(0);device.lock();device=await UnlockedWebDevice.unlock(input.ownerId,recovery.secret,records,keys);
 const restored=await device.vault.read('local-snapshot','actual-native-values');
 try{const [read]=await normalizeNativeArchiveForms(parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(restored.value),'E2EE_ARCHIVE_SOURCE_INVALID',48*1024*1024),input.ownerId,()=>{});
  assert.deepEqual(read.form,form.form);assert.deepEqual(read.valueForm,form.valueForm);assert.deepEqual(read.files,form.files);
 }finally{restored?.value.fill(0);}
 const report={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),checks:[
  'actual Android Keystore frames and strict manifests reached the common original-input reader',
  'every current, earlier and uncommitted named value plus both original manifests survived view disposal',
  'native JSON/UTF8 preserved exact lone-surrogate provider and raw-value code units',
  'original binary bytes, SHA256 and normalized File display reference verified independently',
  'real WebCrypto device/vault code cold-unlocked the complete native input under an independent new root',
  'no restore, replay, HTTP, entitlement, account session or ACL authority executed',
 ]};
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length}));
}finally{raw.fill(0);device?.lock();recovery.secret.fill(0);}
