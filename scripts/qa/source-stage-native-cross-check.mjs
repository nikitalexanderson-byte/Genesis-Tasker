// Independent bounded construction of the entire retained source wire, then
// compare the cold-read native proof. Only fresh owned QA reports are accepted.
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseLegacyMigrationJson} from '../../app/e2ee/legacy-json.ts';
const root=resolve(import.meta.dirname,'../..'),[input,outputArg]=process.argv.slice(2);
if(!input||!outputArg)throw new Error('Supply exact synthetic native results and a fresh output');
const source=resolve(root,input),output=resolve(root,outputArg);
assert.ok(source.startsWith(resolve(root,'output/qa')+sep)&&source.endsWith(sep+'results.json'));assert.ok(output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep));await assert.rejects(access(output));
const report=JSON.parse(await readFile(source,'utf8'));assert.equal(report.package,'ru.genesis.calendar.qa1103.debug');assert.equal(report.status,'PASS_LOCAL_SCOPE');assert.deepEqual(report.reasons,[]);
assert.equal(report.nativeSourceHash,report.build.nativeSourceHash);for(const key of ['nativeSourceHash','runnerSourceHash'])assert.match(report[key],/^[A-F0-9]{64}$/);
for(const key of ['apkSha256','testApkSha256'])assert.match(report.build[key],/^[A-F0-9]{64}$/);
const rows=report.results.filter(row=>row.class==='ru.genesis.calendar.data.NativeBackupProtectedSourceStageTest');assert.equal(rows.length,1);const [row]=rows;
assert.equal(row.status,'PASS');assert.ok(row.passed===3||row.passed===4);assert.equal(row.failed,0);assert.equal(row.skipped,0);assert.equal(row.externalArtifacts.status,'PASS');
let proof;
for(const artifact of row.externalArtifacts.files){
 const path=resolve(root,artifact.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const bytes=await readFile(path);assert.equal(bytes.length,artifact.bytes);
 assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),artifact.sha256.toUpperCase());
 if(artifact.path.endsWith('/source-stage336-large-proof.json')){assert.equal(proof,undefined);proof=parseLegacyMigrationJson(bytes.toString('utf8'),'E2EE_ARCHIVE_SOURCE_INVALID',1024*1024);}
}
assert.ok(proof);assert.equal(proof.synthetic,true);assert.equal(proof.sourceOnly,true);assert.equal(proof.oldAliasDeleted,true);assert.equal(proof.originalBytes,51*1024*1024);
assert.deepEqual(proof.fileSizes,[24,17,10].map(value=>value*1024*1024));assert.match(proof.stageId,/^[a-f0-9-]{36}$/);assert.match(proof.viewId,/^[a-f0-9-]{36}$/);
for(const key of ['bytes','maxHeap','elapsedMs'])assert.ok(Number.isSafeInteger(proof[key])&&proof[key]>0);
const descriptors=proof.rawDescriptors.map(value=>parseLegacyMigrationJson(value,'E2EE_ARCHIVE_SOURCE_INVALID',32768));assert.equal(descriptors.length,3);assert.equal(new Set(descriptors.map(row=>row.id)).size,3);
for(const [index,item]of descriptors.entries()){
 assert.equal(item.protocol,1);assert.equal(item.length,proof.fileSizes[index]);assert.equal(item.name,'\ufefforiginal\ud800name');assert.equal(item.type,'APPLICATION/JSON');
 assert.equal(item.lastModified,null);assert.equal(item.declaredSize,null);
}
const quoted=value=>JSON.stringify(value).replace(/[\ud800-\udfff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
const digest=createHash('sha256');let count=0;const append=value=>{digest.update(value);count+=Buffer.byteLength(value);};
const manifests=proof.rawManifests??[proof.rawManifest],values=proof.originalValues??[];assert.equal(manifests.at(-1),proof.rawManifest);assert.ok(manifests.length>=1);
assert.equal(proof.ownerId,'device-actor');assert.equal(proof.sessionEpoch,7);
if(values.length){
 assert.equal(values.length,4);assert.equal(manifests.length,2);
 assert.deepEqual(values.map(row=>row.name),['key','payload','key','key']);
 assert.deepEqual(values.map(row=>row.rawJson),['" original \ud800 input "','{"note":"literal\udfffunit α😀"}','" replacement input "','" acknowledged unselected input "']);
 assert.equal(new Set(values.map(row=>row.id)).size,4);
 for(const [index,raw]of manifests.entries())assert.deepEqual(parseLegacyMigrationJson(raw,'E2EE_ARCHIVE_SOURCE_INVALID',32768),{protocol:2,
  fields:[{name:'key',id:values[index===0?0:2].id},{name:'payload',id:values[1].id}],settled:true,
  file:{id:descriptors[0].id,name:'\ufefforiginal\ufffdname',type:'application/json',size:proof.fileSizes[0],lastModified:0}});
}else assert.equal(manifests.length,1);
append('{"protocol":3,"ownerId":'+quoted(proof.ownerId)+',"sessionEpoch":'+proof.sessionEpoch+',"views":[{"id":'+quoted(proof.viewId)+',"source":"backup-panel","mounted":false,"rawForm":null,"valueForm":');
append('{"protocol":2,"ownerId":'+quoted(proof.ownerId)+',"sessionEpoch":'+proof.sessionEpoch+',"viewId":'+quoted(proof.viewId)+',"rawManifest":'+quoted(proof.rawManifest)+',"rawManifests":['+manifests.map(quoted).join(',')+'],"values":[');
for(const [index,value]of values.entries()){if(index)append(',');append('{"id":'+quoted(value.id)+',"name":'+quoted(value.name)+',"rawJson":'+quoted(value.rawJson)+'}');}
append(']},"files":[');const block=Buffer.alloc(98304);for(let index=0;index<block.length;index++)block[index]=(index*31)&255;
try{for(const [index,item]of descriptors.entries()){
 if(index)append(',');append('{"rawDescriptor":'+quoted(proof.rawDescriptors[index])+',"bytes":"');const original=createHash('sha256');
 for(let at=0;at<item.length;at+=block.length){const bytes=block.subarray(0,Math.min(block.length,item.length-at));original.update(bytes);append(bytes.toString('base64url'));}
 assert.equal(item.sha256,original.digest('hex'));append('"}');
}}finally{block.fill(0);}
append(']}]}');assert.ok(count>64*1024*1024);assert.equal(count,proof.bytes);assert.equal(digest.digest('hex'),proof.sha256);
const accepted={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:report.nativeSourceHash,device:row.device,cases:row.passed,
 sourceBytes:proof.bytes,originalBytes:proof.originalBytes,rawValues:values.length,manifests:manifests.length,maxHeap:proof.maxHeap,elapsedMs:proof.elapsedMs,
 artifactHashesChecked:row.externalArtifacts.files.length,checks:['whole original source independently constructed with bounded host buffers','three complete original binary digests matched','native readback after deleting only the synthetic old alias matched every source byte','no coordinator, nested archive decryption, product recovery or activation inferred']};
await writeFile(output,JSON.stringify(accepted,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(accepted));
