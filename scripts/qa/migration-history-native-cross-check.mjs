// Exact owned synthetic coordinator reports. No keys or customer custody.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),[input,outputArg,expectedHash]=process.argv.slice(2);
if(!input||!outputArg||!/^[A-F0-9]{64}$/.test(expectedHash??''))throw new Error('Supply owned report, fresh output and frozen native input');
const source=resolve(root,input),output=resolve(root,outputArg);assert.ok(source.startsWith(resolve(root,'output/qa')+sep)&&source.endsWith(sep+'results.json'));assert.ok(output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep));await assert.rejects(access(output));
const report=JSON.parse(await readFile(source,'utf8'));assert.equal(report.package,'ru.genesis.calendar.qa1103.debug');assert.equal(report.status,'PASS_LOCAL_SCOPE');assert.deepEqual(report.reasons,[]);assert.equal(report.nativeSourceHash,expectedHash);assert.equal(report.build.nativeSourceHash,expectedHash);
const rows=report.results.filter(row=>row.class==='ru.genesis.calendar.security.E2eeMigrationHistoryDeviceTest');assert.equal(rows.length,1);const[row]=rows;assert.equal(row.status,'PASS');assert.equal(row.passed,2);assert.equal(row.failed,0);assert.equal(row.skipped,0);assert.equal(row.externalArtifacts.status,'PASS');let proof;
for(const artifact of row.externalArtifacts.files){const path=resolve(root,artifact.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const bytes=await readFile(path);assert.equal(bytes.length,artifact.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),artifact.sha256.toUpperCase());if(path.endsWith(sep+'migration-history336-proof.json'))proof=JSON.parse(bytes.toString('utf8'));}
assert.ok(proof);for(const name of ['synthetic','componentOnly','actualCoordinator','coldSqlite','rowsUnchanged'])assert.equal(proof[name],true);assert.equal(proof.networkCalls,0);assert.ok(proof.retainedRows>20&&proof.elapsedMs>0&&proof.maxHeap>0);assert.equal(proof.decodedBytes,4194392);assert.equal(proof.sources.length,4);
const sizes=[1024*1024+7,3,3,3,3,3],seeds=[47,0,17,31],block=Buffer.alloc(65536),ids=new Set();
try{for(const[index,item]of proof.sources.entries()){
 assert.ok((index===1?/^legacy:[A-Za-z0-9_-]{43}$/:/^stage:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/).test(item.sourceId));assert.ok(!ids.has(item.sourceId));ids.add(item.sourceId);assert.deepEqual(item.sizes,sizes);assert.equal(item.sha256.length,6);
 for(let path=0;path<6;path++){for(let at=0;at<block.length;at++)block[at]=(at*31+path*17+seeds[index])&255;const digest=createHash('sha256');for(let at=0;at<sizes[path];at+=block.length)digest.update(block.subarray(0,Math.min(block.length,sizes[path]-at)));assert.equal(digest.digest('base64url'),item.sha256[path]);}
}}finally{block.fill(0);}
const result={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:expectedHash,device:row.device,cases:row.passed,decodedBytes:proof.decodedBytes,sources:4,paths:24,retainedRows:proof.retainedRows,elapsedMs:proof.elapsedMs,maxHeap:proof.maxHeap,artifactHashesChecked:row.externalArtifacts.files.length,
 checks:['every logical byte/hash of four mixed original sources independently reconstructed with bounded host buffers','actual cold coordinator includes current legacy cancelled and orphan stages while every encrypted row remains unchanged','unread EOF actor retirement and unknown original refuse with zero transport calls','same-original-actor synthetic component only; no cross-device custody remote original preservation plan publication real source coverage or activation inferred']};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
