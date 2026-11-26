// Exact owned synthetic reports only. Public test roots; no customer custody.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {openOriginalSourceStage} from '../../app/e2ee/original-source.ts';
import {decodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';
const root=resolve(import.meta.dirname,'../..'),[input,outputArg]=process.argv.slice(2);
if(!input||!outputArg)throw new Error('Supply owned native report and fresh output');
const source=resolve(root,input),output=resolve(root,outputArg);assert.ok(source.startsWith(resolve(root,'output/qa')+sep)&&source.endsWith(sep+'results.json'));
assert.ok(output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep));await assert.rejects(access(output));
const report=JSON.parse(await readFile(source,'utf8'));assert.equal(report.package,'ru.genesis.calendar.qa1103.debug');assert.equal(report.status,'PASS_LOCAL_SCOPE');assert.deepEqual(report.reasons,[]);
assert.equal(report.nativeSourceHash,report.build.nativeSourceHash);const rows=report.results.filter(row=>row.class==='ru.genesis.calendar.security.E2eeOriginalSourceDeviceTest');assert.equal(rows.length,1);const [row]=rows;
assert.equal(row.status,'PASS');assert.equal(row.passed,2);assert.equal(row.failed,0);assert.equal(row.skipped,0);assert.equal(row.externalArtifacts.status,'PASS');const artifacts=new Map();
for(const artifact of row.externalArtifacts.files){const path=resolve(root,artifact.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const raw=await readFile(path);
 assert.equal(raw.length,artifact.bytes);assert.equal(createHash('sha256').update(raw).digest('hex').toUpperCase(),artifact.sha256.toUpperCase());
 if(path.endsWith(sep+'original-source336-large-proof.json')||path.endsWith(sep+'original-source336-native-vector.json'))artifacts.set(path.split(sep).at(-1),JSON.parse(raw.toString('utf8')));
}
const proof=artifacts.get('original-source336-large-proof.json');assert.equal(proof.synthetic,true);assert.equal(proof.componentOnly,true);assert.equal(proof.oldAliasRemoved,true);assert.equal(proof.oldPrivateKeysImportedByReader,false);
assert.equal(proof.originalDevice,'original-device');assert.equal(proof.newDevice,'new-device');assert.equal(proof.pathBytes,35*1024*1024+17);assert.equal(proof.paths,2);assert.equal(proof.totalReadBytes,2*proof.pathBytes);
assert.equal(proof.sha256.length,2);assert.ok(proof.maxHeap>0&&proof.elapsedMs>0);const block=Buffer.alloc(65536);
try{for(let path=0;path<2;path++){for(let index=0;index<block.length;index++)block[index]=(index*37+path*17)&255;const hash=createHash('sha256');
 for(let at=0;at<proof.pathBytes;at+=block.length)hash.update(block.subarray(0,Math.min(block.length,proof.pathBytes-at)));assert.equal(hash.digest('hex'),proof.sha256[path]);}}
finally{block.fill(0);}
const vector=artifacts.get('original-source336-native-vector.json');assert.equal(vector.synthetic,true);assert.equal(vector.warning,'PUBLIC TEST KEYS; DO NOT USE FOR USER DATA');assert.ok(vector.producer.startsWith('Android/JCA API'));
assert.deepEqual(Object.keys(vector).sort(),['synthetic','warning','producer','original','target','reference','rootKey','keyId','publicKeySpki','paths','records'].sort());
assert.ok(vector.records.length>=5&&vector.records.length<=32);const records=new Map(vector.records.map(row=>[row.key,{serial:row.serial,envelope:row.envelope}]));assert.equal(records.size,vector.records.length);
const wrapping=await importE2eeRoot(decodeE2eeBytes(vector.rootKey,32)),signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(vector.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
let reads=0,bytes=0;const handle=await openOriginalSourceStage({original:vector.original,roots:new Map([[vector.keyId,wrapping]]),signer,target:vector.target,reference:vector.reference,assertCurrent:()=>{},
 storage:{get:async key=>{reads++;return structuredClone(records.get(key)??null);},list:async prefix=>[...records.keys()].filter(key=>key.startsWith(prefix))}});
try{assert.deepEqual(Object.keys(handle).sort(),['close','openPath','paths']);assert.deepEqual(handle.paths,vector.paths.map(path=>path.id));
 for(const path of vector.paths){const expected=decodeE2eeBytes(path.plaintext,1,1024),reader=handle.openPath(path.id);let at=0,borrowed;
  try{for await(const part of reader.chunks){assert.ok(part.length<=256*1024);assert.deepEqual(part,expected.subarray(at,at+part.length));at+=part.length;borrowed=part;}reader.assertComplete();assert.equal(at,expected.length);assert.ok(borrowed?.every(value=>value===0));bytes+=at;}
  finally{expected.fill(0);}
 }
}finally{handle.close();}
assert.equal(bytes,6);assert.ok(reads>=5);
const result={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:report.nativeSourceHash,device:row.device,cases:row.passed,
 totalReadBytes:proof.totalReadBytes,pathBytes:proof.pathBytes,paths:proof.paths,maxHeap:proof.maxHeap,elapsedMs:proof.elapsedMs,artifactHashesChecked:row.externalArtifacts.files.length,
 interopPaths:vector.paths.length,interopBytes:bytes,checks:['both complete generated35MiB+17byte paths independently matched with bounded host buffers',
 'native read capability succeeded after synthetic old-alias deletion while separate new-device identity stayed unchanged',
 'fresh JCA source catalogue opens with roots and public signer only through WebCrypto original-source reader',
 'component/fixture only; no product custody enrollment whole-account recovery or activation inferred']};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
