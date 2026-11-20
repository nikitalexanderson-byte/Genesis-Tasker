import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
import assert from 'node:assert/strict';

// Independent checks of the deterministic synthetic binary digest and of the
// exact evidence produced by the isolated Android runner. No source/restore port.
const root=resolve(import.meta.dirname,'../..'),[sourceArg,outputArg]=process.argv.slice(2);
if(!sourceArg||!outputArg)throw new Error('Provide native results and a new report path');
const source=resolve(root,sourceArg),output=resolve(root,outputArg),qa=resolve(root,'output/qa')+sep;
if(!source.startsWith(qa)||!source.endsWith(`${sep}results.json`)||!output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep))throw new Error('Synthetic binary evidence boundary');
await assert.rejects(access(output));
const result=JSON.parse(await readFile(source,'utf8'));
assert.equal(result.package,'ru.genesis.calendar.qa1103.debug');assert.match(result.nativeSourceHash,/^[A-F0-9]{64}$/);
assert.equal(result.status,'PASS_LOCAL_SCOPE');assert.deepEqual(result.reasons,[]);
assert.equal(result.build.nativeSourceHash,result.nativeSourceHash);
const selected=result.results.filter(row=>row.class==='ru.genesis.calendar.data.NativeBackupBinaryInventoryTest');
assert.equal(selected.length,1);const row=selected[0];assert.equal(row.status,'PASS');assert.equal(row.passed,3);assert.equal(row.failed,0);assert.equal(row.skipped,0);
assert.equal(row.externalArtifacts.status,'PASS');
const files=row.externalArtifacts.files;
async function evidence(name){
 const matches=files.filter(file=>file.path.endsWith(`/${name}`));assert.equal(matches.length,1);const [record]=matches;
 const path=resolve(root,record.path);assert.ok(path.startsWith(resolve(source,'..')+sep));
 const bytes=await readFile(path);assert.equal(bytes.length,record.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),record.sha256.toUpperCase());
 const value=JSON.parse(bytes.toString('utf8'));assert.equal(value.synthetic,true);return value;
}
const streamed=await evidence('backup336-binary-24-proof.json'),history=await evidence('backup336-binary-history-proof.json');
assert.equal(streamed.bytes,24*1024*1024);assert.equal(streamed.originalDescriptorCodeUnits,true);assert.equal(streamed.completeFooterAndEof,true);assert.equal(streamed.readBufferBytes,65536);
const buffer=Buffer.alloc(65536);for(let index=0;index<buffer.length;index++)buffer[index]=(index*37+131)&255;
const hash=createHash('sha256');try{for(let offset=0;offset<streamed.bytes;offset+=buffer.length)hash.update(buffer);}finally{buffer.fill(0);}
assert.equal(streamed.sha256,hash.digest('hex'));
assert.equal(history.files,3);assert.equal(history.originalBytes,51*1024*1024);assert.equal(history.retainedFileMemoryBytes,0);
assert.equal(history.selectedFiles,1);assert.equal(history.unselectedFiles,2);assert.equal(history.pending,0);assert.equal(history.retainedAfterClose,true);
assert.equal(history.aggregateCaptureGate,'E2EE_SNAPSHOT_TOO_LARGE');
for(const value of [streamed,history])for(const name of ['elapsedMs','maxHeap'])assert.ok(Number.isSafeInteger(value[name])&&value[name]>0);
const report={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:result.nativeSourceHash,
 device:row.device,streamed:{bytes:streamed.bytes,elapsedMs:streamed.elapsedMs,maxHeap:streamed.maxHeap},
 history:{files:history.files,bytes:history.originalBytes,retainedFileMemoryBytes:history.retainedFileMemoryBytes,elapsedMs:history.elapsedMs,maxHeap:history.maxHeap},checks:[
  'three real native binary cases passed with no skip and runner-verified source/APK identity',
  'host recomputed the deterministic 24MiB original-binary digest independently of JCA',
  'native readback reached authenticated footer/EOF using a 64KiB read buffer and retained original descriptor code units',
  '51MiB selected/unselected candidates released retained native File buffers and survived view disposal',
  'aggregate migration still explicitly refuses oversized capture; no restore or activation is inferred',
  'native descriptors rejected duplicate/escaped names, trailing data, unknown fields, unsafe numbers, wrong types and wrong digest'
 ]};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
