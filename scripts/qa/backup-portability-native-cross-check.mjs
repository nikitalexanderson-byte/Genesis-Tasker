import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import assert from 'node:assert/strict';
import {openBackup} from '../../app/backup-format.ts';
import {parseLegacyMigrationJson} from '../../app/e2ee/legacy-json.ts';

const root=resolve(import.meta.dirname,'../..'),[sourceArg,outputArg]=process.argv.slice(2),source=resolve(root,sourceArg??''),output=resolve(root,outputArg??'');
if(!source.startsWith(resolve(root,'output/qa')+sep)||!source.endsWith('backup336-portability-native-output.json')||
 !output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep))throw new Error('Synthetic native portability fixture boundary');
const fixture=JSON.parse(await readFile(resolve(root,'tests/fixtures/backup-portability-v1.json'),'utf8'));
const input=parseLegacyMigrationJson(await readFile(source,'utf8'),'BACKUP_INVALID',1024*1024);assert.equal(input.synthetic,true);assert.equal(input.protocol,1);
const file=input.file;assert(file.wrappedKey.includes('/'));assert.deepEqual(await openBackup(JSON.stringify(file),fixture.recoveryKey),fixture.payload);
// Independently require the NEW native writer's canonical AAD. The compatibility
// reader above alone could otherwise hide a writer still producing old bytes.
const secret=await crypto.subtle.importKey('raw',Buffer.from(fixture.recoveryKey,'base64'),'AES-KW',false,['unwrapKey']);
const key=await crypto.subtle.unwrapKey('raw',Buffer.from(file.wrappedKey,'base64'),secret,'AES-KW',{name:'AES-GCM'},false,['decrypt']);
const aad=JSON.stringify([file.format,file.schema,file.backupId,file.algorithm,file.wrappedKey]);
const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(file.iv,'base64'),additionalData:new TextEncoder().encode(aad)},key,Buffer.from(file.ciphertext,'base64'));
try{assert.deepEqual(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)),fixture.payload);}finally{new Uint8Array(plain).fill(0);}
for(const original of Object.values(fixture.files))assert.deepEqual(await openBackup(JSON.stringify(original),fixture.recoveryKey),fixture.payload);
const report={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),platformEscapesSolidus:input.platformEscapesSolidus,checks:[
 'actual native JCA archive with a solidus in its wrapped key opened with the common WebCrypto reader',
 'independent WebCrypto decrypt verified NEW writer canonical AAD without relying on compatibility attempts',
 'both fixed historical semantic-header encodings remained readable with authenticated plaintext',
 'complete original Unicode payload and owner matched; no restore, replay, HTTP or account authority ran',
]};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length}));
