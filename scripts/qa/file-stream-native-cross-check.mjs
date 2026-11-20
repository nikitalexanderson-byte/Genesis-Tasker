// Fresh owned public primitive fixtures only. No user devices/accounts/keys.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {openE2eeFile} from '../../app/e2ee/files.ts';
import {decodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';
const root=resolve(import.meta.dirname,'../..'),[input,outputArg]=process.argv.slice(2);if(!input||!outputArg)throw new Error('Supply an owned report and fresh output');
const source=resolve(root,input),output=resolve(root,outputArg);assert.ok(source.startsWith(resolve(root,'output/qa')+sep)&&source.endsWith(sep+'results.json'));
assert.ok(output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep));await assert.rejects(access(output));
const report=JSON.parse(await readFile(source,'utf8'));assert.equal(report.status,'PASS_LOCAL_SCOPE');assert.equal(report.package,'ru.genesis.calendar.qa1103.debug');assert.deepEqual(report.reasons,[]);
assert.equal(report.nativeSourceHash,report.build.nativeSourceHash);const rows=report.results.filter(row=>row.class==='ru.genesis.calendar.security.E2eeFileStreamDeviceTest');assert.equal(rows.length,1);const [row]=rows;
assert.equal(row.status,'PASS');assert.ok(row.passed===3||row.passed===4);assert.equal(row.failed,0);assert.equal(row.skipped,0);assert.equal(row.externalArtifacts.status,'PASS');
const artifacts=new Map();for(const file of row.externalArtifacts.files){const path=resolve(root,file.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const raw=await readFile(path);
 assert.equal(raw.length,file.bytes);assert.equal(createHash('sha256').update(raw).digest('hex').toUpperCase(),file.sha256.toUpperCase());artifacts.set(path.split(sep).at(-1),JSON.parse(raw.toString('utf8')));
}
const large=artifacts.get('file-stream336-large-proof.json');assert.equal(large.synthetic,true);assert.equal(large.primitiveOnly,true);assert.equal(large.bytes,40*1024*1024);assert.equal(large.chunks,160);assert.equal(large.actualEof,true);
assert.ok(large.readCalls>large.chunks);assert.ok(large.maxHeap>0&&large.elapsedMs>0);const block=Buffer.alloc(65536);for(let index=0;index<block.length;index++)block[index]=(index*31)&255;
const digest=createHash('sha256');try{for(let at=0;at<large.bytes;at+=block.length)digest.update(block.subarray(0,Math.min(block.length,large.bytes-at)));}finally{block.fill(0);}
assert.equal(digest.digest('hex'),large.sha256);
const vector=artifacts.get('file-stream336-native-vector.json');assert.equal(vector.synthetic,true);assert.equal(vector.warning,'PUBLIC TEST KEYS; DO NOT USE FOR USER DATA');assert.ok(vector.producer.startsWith('Android/JCA API'));
const wrapping=await importE2eeRoot(decodeE2eeBytes(vector.rootKey,32)),signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(vector.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
const opened=await openE2eeFile(wrapping,signer,vector.context,vector.manifest,async id=>vector.chunks.find(chunk=>chunk.context.objectId===id));
try{assert.deepEqual(opened.bytes,decodeE2eeBytes(vector.plaintext,1,1024));assert.equal(opened.mediaType,vector.mediaType);assert.deepEqual(Array.from({length:opened.filename.length},(_,index)=>opened.filename.charCodeAt(index)),vector.filenameUnits);
 assert.deepEqual(large.filenameUnits,vector.filenameUnits);
}finally{opened.bytes.fill(0);}
const result={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:report.nativeSourceHash,device:row.device,cases:row.passed,bytes:large.bytes,chunks:large.chunks,maxHeap:large.maxHeap,elapsedMs:large.elapsedMs,artifactHashesChecked:row.externalArtifacts.files.length,
 checks:['bounded host independently matched all generated original40MiB bytes','actual native v1 cold file readback matched source','actual JCA writer opens in the existing WebCrypto v1 reader with every filename unit','tag/actor failure returned no complete manifest','primitive/IO only; no coordinator, product key custody, backup coverage or activation inferred']};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
