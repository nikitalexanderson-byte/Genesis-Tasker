// Independently hash the complete synthetic composition and verify extracted
// artifacts/build identity. No product source coverage or recovery is inferred.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
import {requiredPrivatePaths} from '../../app/e2ee/migration-sources.ts';
const root=resolve(import.meta.dirname,'../..'),[input,outputArg,expectedHash]=process.argv.slice(2);
if(!input||!outputArg||!/^[A-F0-9]{64}$/.test(expectedHash??''))throw new Error('Supply owned report, fresh output and frozen native input hash');
const source=resolve(root,input),output=resolve(root,outputArg);assert.ok(source.startsWith(resolve(root,'output/qa')+sep)&&source.endsWith(sep+'results.json'));assert.ok(output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep));await assert.rejects(access(output));
const report=JSON.parse(await readFile(source,'utf8'));assert.equal(report.package,'ru.genesis.calendar.qa1103.debug');assert.equal(report.status,'PASS_LOCAL_SCOPE');assert.deepEqual(report.reasons,[]);assert.equal(report.nativeSourceHash,expectedHash);assert.equal(report.build.nativeSourceHash,expectedHash);
const rows=report.results.filter(row=>row.class==='ru.genesis.calendar.security.E2eeStagedReconciliationDeviceTest');assert.equal(rows.length,1);const[row]=rows;assert.equal(row.status,'PASS');assert.equal(row.passed,2);assert.equal(row.failed,0);assert.equal(row.skipped,0);assert.equal(row.externalArtifacts.status,'PASS');
let proof;for(const artifact of row.externalArtifacts.files){const path=resolve(root,artifact.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const raw=await readFile(path);assert.equal(raw.length,artifact.bytes);assert.equal(createHash('sha256').update(raw).digest('hex').toUpperCase(),artifact.sha256.toUpperCase());
 if(path.endsWith(sep+'staged-reconciliation336-report.json')){assert.equal(proof,undefined);proof=JSON.parse(raw.toString('utf8'));}}
assert.equal(proof.synthetic,true);assert.ok([26,34].includes(proof.api));assert.equal(proof.firstSourceBytes,2*1024*1024+17);assert.ok(proof.originalRows>20&&proof.elapsedMs>0);
const paths=requiredPrivatePaths('project').map(path=>path.id);assert.deepEqual(proof.coverage,paths);assert.equal(proof.values.length,6);const byId=new Map(proof.values.map(value=>[value.path,value]));assert.equal(byId.size,6);
let total=0;const block=Buffer.alloc(65536);
try{for(const[index,path]of paths.entries()){
 const record=byId.get(path),size=index===0?proof.firstSourceBytes:7;assert.equal(record.placement,path.endsWith('.local-work')?'local':'remote');assert.equal(record.size,2*size);
 const hash=createHash('sha256');for(const seed of [2,1]){block.fill(seed+index);for(let at=0;at<size;at+=block.length)hash.update(block.subarray(0,Math.min(block.length,size-at)));}
 assert.equal(record.plaintextHash,hash.digest('base64url'));total+=record.size;
}}finally{block.fill(0);}
assert.equal(proof.totalBytes,total);
const result={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:expectedHash,device:row.device,api:proof.api,newCases:row.passed,
 totalLogicalBytes:total,originalRows:proof.originalRows,remoteRecords:5,localRecords:1,artifactHashesChecked:row.externalArtifacts.files.length,elapsedMs:proof.elapsedMs,
 checks:['all six complete current/history logical hashes independently reconstructed with bounded Node buffers','cold native SQLite plan verification preserves every original encrypted row','late original authentication and quota failures cannot publish a complete plan','synthetic composition only; no real adapter count coordinator lease lost-key custody transport or activation inferred']};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
