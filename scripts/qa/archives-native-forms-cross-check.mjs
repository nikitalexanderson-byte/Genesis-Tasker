import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import assert from 'node:assert/strict';
import {parseLegacyMigrationJson} from '../../app/e2ee/legacy-json.ts';
import {normalizeNativeArchiveForms} from '../../app/e2ee/archives-native-forms.ts';
import {openBackup} from '../../app/backup-format.ts';

// Only task-owned, synthetic QA files pulled by the isolated native runner.
const root=resolve(import.meta.dirname,'../..'),boundary=resolve(root,'output/qa')+sep;
const [sourceArg,outputArg]=process.argv.slice(2),source=resolve(root,sourceArg??''),output=resolve(root,outputArg??'');
if(!source.startsWith(boundary)||!output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep)||!source.endsWith('backup336-native-form-input.json'))throw new Error('Synthetic native form fixture boundary');
const input=parseLegacyMigrationJson(await readFile(source,'utf8'),'E2EE_ARCHIVE_SOURCE_INVALID',48*1024*1024);
assert.match(input.ownerId,/^saf-qa-[a-f0-9-]{36}$/);const forms=await normalizeNativeArchiveForms(input,input.ownerId,()=>{});
assert.equal(forms.length,1);const form=forms[0];assert.equal(form.mounted,false);assert.equal(form.form.settled,true);assert.equal(form.files.length,1);
const state=form.form.state,selected=form.files[0],raw=Buffer.from(selected.bytes,'base64url');
try{
 const payload=await openBackup(new TextDecoder('utf-8',{fatal:true}).decode(raw),state.key);
 assert.equal(payload.ownerId,input.ownerId);assert.equal(payload.backupId,state.payload.backupId);assert.deepEqual(payload,state.payload);
 assert.equal(form.form.file.id,selected.descriptor.id);assert.equal(form.form.file.size,raw.length);
 const report={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),checks:[
  'actual native WebView acknowledged settled form retained after view disposal',
  'all original binary bytes and provider metadata passed the shared strict parser',
  'actual native-exported encrypted SAF archive opened with WebCrypto using only retained input',
  'decrypted owner/backup ID/payload matched the actual native renderer preview',
  'no restore, HTTP, entitlement, session or ACL authority executed',
 ]};
 await writeFile(output,JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({status:report.status,checks:report.checks.length})+'\n');
}finally{raw.fill(0);}
