// Only fresh synthetic QA results; independently hash the entire generated
// large source with a bounded host buffer. No user accounts, files or keys.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),[input,outputArg,expectedHash]=process.argv.slice(2);
if(!input||!outputArg||!/^[A-F0-9]{64}$/.test(expectedHash??''))throw new Error('Supply exact owned results, fresh output and frozen native input hash');
const source=resolve(root,input),output=resolve(root,outputArg);
assert.ok(source.startsWith(resolve(root,'output/qa')+sep)&&source.endsWith(sep+'results.json'));
assert.ok(output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep));await assert.rejects(access(output));
const report=JSON.parse(await readFile(source,'utf8'));assert.equal(report.package,'ru.genesis.calendar.qa1103.debug');assert.equal(report.status,'PASS_LOCAL_SCOPE');assert.deepEqual(report.reasons,[]);
assert.equal(report.nativeSourceHash,expectedHash);assert.equal(report.build.nativeSourceHash,expectedHash);
const rows=report.results.filter(row=>row.class==='ru.genesis.calendar.security.E2eeMigrationStageDeviceTest');assert.equal(rows.length,1);const[row]=rows;
assert.equal(row.status,'PASS');assert.equal(row.passed,5);assert.equal(row.failed,0);assert.equal(row.skipped,0);
let proof,hashes=0;
for(const result of report.results){
 assert.equal(result.status,'PASS');assert.equal(result.failed,0);assert.equal(result.skipped,0);
 if(result.externalArtifacts.status==='NOT_APPLICABLE')continue;assert.equal(result.externalArtifacts.status,'PASS');
 for(const artifact of result.externalArtifacts.files){
  const path=resolve(root,artifact.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const bytes=await readFile(path);
  assert.equal(bytes.length,artifact.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),artifact.sha256.toUpperCase());hashes++;
  if(result===row&&path.endsWith(sep+'migration-stage336-large-proof.json')){assert.equal(proof,undefined);assert.ok(bytes.length<32768);proof=JSON.parse(bytes.toString('utf8'));}
 }
}
assert.ok(proof);assert.equal(proof.synthetic,true);assert.equal(proof.sourceOnly,true);assert.equal(proof.bytes,70*1024*1024+7);assert.equal(proof.primary,'project.content');assert.equal(proof.transportCalls,0);
const registry=JSON.parse(await readFile(resolve(root,'contracts/e2ee/private-paths-v1.json'),'utf8'));
assert.deepEqual(proof.paths,registry.paths.filter(path=>path.scope==='project').map(path=>path.id));assert.equal(proof.paths.length,6);
for(const name of ['maxHeap','elapsedMs'])assert.ok(Number.isSafeInteger(proof[name])&&proof[name]>0);assert.match(proof.manifestHash,/^[A-Za-z0-9_-]{43}$/);
const digest=createHash('sha256'),buffer=Buffer.alloc(65536);for(let index=0;index<buffer.length;index++)buffer[index]=(index*31)&255;
try{for(let at=0;at<proof.bytes;at+=buffer.length)digest.update(buffer.subarray(0,Math.min(buffer.length,proof.bytes-at)));}finally{buffer.fill(0);}
assert.equal(digest.digest('base64url'),proof.sha256);
const accepted={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:expectedHash,device:row.device,cases:row.passed,
 sourceBytes:proof.bytes,paths:proof.paths.length,artifactHashesChecked:hashes,maxHeap:proof.maxHeap,elapsedMs:proof.elapsedMs,
 checks:['independent bounded host hash matched the complete70MiB+7byte source','actual SQLite v3 source pointer and cold original-vault readback matched all required paths',
 'part/pointer/catalogue-race failures retained originals and reached no transport','synthetic source registry only; no complete product adapter, streamed planner, recovery, migration activation or peak-heap claim']};
await writeFile(output,JSON.stringify(accepted,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(accepted));
