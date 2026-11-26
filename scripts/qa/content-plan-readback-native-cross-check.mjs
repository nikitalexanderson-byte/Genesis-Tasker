// Fresh owned component reports only. Hash the full generated file with an
// independently constructed bounded Node buffer, and verify extracted proof.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),[input,outputArg,expectedHash]=process.argv.slice(2);
if(!input||!outputArg||!/^[A-F0-9]{64}$/.test(expectedHash??''))throw new Error('Supply owned native report, fresh output and frozen input hash');
const source=resolve(root,input),output=resolve(root,outputArg);assert.ok(source.startsWith(resolve(root,'output/qa')+sep)&&source.endsWith(sep+'results.json'));assert.ok(output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep));await assert.rejects(access(output));
const report=JSON.parse(await readFile(source,'utf8'));assert.equal(report.package,'ru.genesis.calendar.qa1103.debug');assert.equal(report.status,'PASS_LOCAL_SCOPE');assert.deepEqual(report.reasons,[]);assert.equal(report.nativeSourceHash,expectedHash);assert.equal(report.build.nativeSourceHash,expectedHash);
const rows=report.results.filter(row=>row.class==='ru.genesis.calendar.security.E2eeContentPlanReadbackDeviceTest');assert.equal(rows.length,1);const[row]=rows;assert.equal(row.status,'PASS');assert.equal(row.passed,3);assert.equal(row.failed,0);assert.equal(row.skipped,0);assert.equal(row.externalArtifacts.status,'PASS');
let proof,checked=0;for(const artifact of row.externalArtifacts.files){const path=resolve(root,artifact.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const bytes=await readFile(path);assert.equal(bytes.length,artifact.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),artifact.sha256.toUpperCase());checked++;
 if(path.endsWith(sep+'content-plan-readback336-proof.json')){assert.equal(proof,undefined);proof=JSON.parse(bytes.toString('utf8'));}}
assert.ok(proof);for(const name of ['synthetic','componentOnly','coldSqlite','lazyPeer'])assert.equal(proof[name],true);
assert.equal(proof.fileBytes,9*1024*1024+7);assert.equal(proof.localBytes,3);assert.equal(proof.envelopes,38);assert.equal(proof.gets,38);assert.equal(proof.walks,1);assert.ok(proof.maxHeap>0&&proof.elapsedMs>0);
const hash=createHash('sha256'),block=Buffer.alloc(65536);try{for(let index=0;index<block.length;index++)block[index]=(index*31)&255;for(let at=0;at<proof.fileBytes;at+=block.length)hash.update(block.subarray(0,Math.min(block.length,proof.fileBytes-at)));}finally{block.fill(0);}assert.equal(hash.digest('base64url'),proof.sha256);
const result={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:expectedHash,device:row.device,cases:row.passed,fileBytes:proof.fileBytes,localBytes:proof.localBytes,envelopes:proof.envelopes,gets:proof.gets,walks:proof.walks,elapsedMs:proof.elapsedMs,maxHeap:proof.maxHeap,artifactHashesChecked:checked,
 checks:['whole generated9MiB+7byte file independently hashed through bounded Node buffers','real JCA and cold encrypted SQLite plan read through lazy synthetic peer ports','missing duplicate forged and retired callbacks do not return a receipt; suspended ack stops prefetch and cancellation wipes its borrowed buffer','component scope only; no actual HTTP/backend source coverage coordinator publication product recovery or activation inferred']};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
