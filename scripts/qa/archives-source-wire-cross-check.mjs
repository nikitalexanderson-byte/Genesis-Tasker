import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseLegacyMigrationJson} from '../../app/e2ee/legacy-json.ts';

const root=resolve(import.meta.dirname,'../..'),[sourceArg,outputArg]=process.argv.slice(2);
if(!sourceArg||!outputArg)throw new Error('Provide native results and a new report');
const source=resolve(root,sourceArg),output=resolve(root,outputArg);
if(!source.startsWith(resolve(root,'output/qa')+sep)||!source.endsWith(`${sep}results.json`)||!output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep))throw new Error('Synthetic source-wire boundary');
await assert.rejects(access(output));
const record=JSON.parse(await readFile(source,'utf8'));assert.equal(record.status,'PASS_LOCAL_SCOPE');assert.deepEqual(record.reasons,[]);
assert.equal(record.package,'ru.genesis.calendar.qa1103.debug');assert.equal(record.nativeSourceHash,record.build.nativeSourceHash);
for(const field of ['nativeSourceHash','runnerSourceHash'])assert.match(record[field],/^[A-F0-9]{64}$/);
for(const field of ['apkSha256','testApkSha256'])assert.match(record.build[field],/^[A-F0-9]{64}$/);
assert.ok(['PASS','REUSED_SOURCE_AND_APK_VERIFIED'].includes(record.build.status));
const rows=record.results.filter(row=>row.class==='ru.genesis.calendar.data.NativeBackupSourceJsonTest');assert.equal(rows.length,1);
const [row]=rows;assert.equal(row.status,'PASS');assert.equal(row.passed,1);assert.equal(row.failed,0);assert.equal(row.skipped,0);
assert.equal(row.externalArtifacts.status,'PASS');
async function artifact(name){
 const found=row.externalArtifacts.files.filter(file=>file.path.endsWith(`/${name}`));assert.equal(found.length,1);const [file]=found;
 const path=resolve(root,file.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const bytes=await readFile(path);
 assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),file.sha256.toUpperCase());
 return parseLegacyMigrationJson(bytes.toString('utf8'),'E2EE_ARCHIVE_SOURCE_INVALID',1024*1024);
}
const value=await artifact('backup336-source-wire-input.json');assert.equal(value.protocol,1);assert.equal(value.synthetic,true);
assert.deepEqual(Array.from({length:value.raw.length},(_,index)=>value.raw.charCodeAt(index)),value.units);
assert.equal(value.raw,'\ufeff \n{"private":{"duplicate":1,"duplicate":2},"note":"literal\ud800unit α😀"}\r\n');
assert.deepEqual(Buffer.from(value.binary,'base64url'),Buffer.from([0,255,0xc3,0x28]));assert.equal(value.binary,'AP_DKA');
assert.throws(()=>parseLegacyMigrationJson(value.raw.trim(),'E2EE_ARCHIVE_SOURCE_INVALID',1024*1024));
const large=await artifact('backup336-source-wire-large-proof.json');assert.equal(large.synthetic,true);assert.equal(large.characters,40*1024*1024);assert.equal(large.bytes,large.characters+2);
assert.ok(large.maximumRead>0&&large.maximumRead<=8192);assert.ok(large.maximumWrite>0&&large.maximumWrite<=8192);assert.ok(large.currentChecks>large.characters/8192);
for(const field of ['maxHeap','elapsedMs'])assert.ok(Number.isSafeInteger(large[field])&&large[field]>0);
const hash=createHash('sha256'),block=Buffer.alloc(8192,'x');hash.update('"');for(let index=0;index<large.characters;index+=block.length)hash.update(block);hash.update('"');block.fill(0);
assert.equal(large.sha256,hash.digest('hex'));
const report={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:record.nativeSourceHash,device:row.device,
 large:{characters:large.characters,bytes:large.bytes,maxHeap:large.maxHeap,elapsedMs:large.elapsedMs},checks:[
  'actual native UTF8 source output preserved every original UTF16 unit including BOM, controls, emoji and a lone surrogate',
  'original duplicate private names survived encoding and still refuse in the shared strict private parser',
  'platform Base64URL output preserved the exact original non-text bytes without padding',
  'independent host SHA256 matched the complete quoted 40MiB generated input using bounded native reader/output blocks',
  'runner-verified source/APK identity and host-verified output artifact hashes; no source adapter, protected snapshot or migration authority inferred'
 ]};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
