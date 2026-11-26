import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseLegacyMigrationJson} from '../../app/e2ee/legacy-json.ts';
import {normalizeNativeArchiveForms} from '../../app/e2ee/archives-native-forms.ts';

const root=resolve(import.meta.dirname,'../..'),[sourceArg,outputArg]=process.argv.slice(2);
if(!sourceArg||!outputArg)throw new Error('Provide native results and a new report');
const source=resolve(root,sourceArg),output=resolve(root,outputArg);
if(!source.startsWith(resolve(root,'output/qa')+sep)||!source.endsWith(`${sep}results.json`)||!output.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep))throw new Error('Synthetic inventory-stream boundary');
await assert.rejects(access(output));
const record=JSON.parse(await readFile(source,'utf8'));assert.equal(record.status,'PASS_LOCAL_SCOPE');assert.deepEqual(record.reasons,[]);
assert.equal(record.package,'ru.genesis.calendar.qa1103.debug');assert.equal(record.nativeSourceHash,record.build.nativeSourceHash);
for(const field of ['nativeSourceHash','runnerSourceHash'])assert.match(record[field],/^[A-F0-9]{64}$/);
for(const field of ['apkSha256','testApkSha256'])assert.match(record.build[field],/^[A-F0-9]{64}$/);
const rows=record.results.filter(row=>row.class==='ru.genesis.calendar.data.NativeBackupInventorySourceTest');assert.equal(rows.length,1);
const [row]=rows;assert.equal(row.status,'PASS');assert.equal(row.passed,3);assert.equal(row.failed,0);assert.equal(row.skipped,0);assert.equal(row.externalArtifacts.status,'PASS');
async function artifact(name){
 const found=row.externalArtifacts.files.filter(file=>file.path.endsWith(`/${name}`));assert.equal(found.length,1);const [file]=found;
 const path=resolve(root,file.path);assert.ok(path.startsWith(resolve(source,'..')+sep));const bytes=await readFile(path);
 assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),file.sha256.toUpperCase());
 return parseLegacyMigrationJson(bytes.toString('utf8'),'E2EE_ARCHIVE_SOURCE_INVALID',1024*1024);
}
const small=await artifact('backup336-inventory-stream-input.json');assert.equal(small.protocol,3);assert.match(small.ownerId,/^stream-qa-[a-f0-9-]{36}$/);
const [view]=await normalizeNativeArchiveForms(small,small.ownerId,()=>{});assert.equal(view.mounted,false);assert.equal(view.form.state.key,' replacement input ');
assert.equal(view.valueForm.manifests.length,2);assert.equal(view.valueForm.values.length,4);assert.equal(view.valueForm.manifests[0].state.key,' original \ud800 input ');
assert.equal(view.valueForm.values.at(-1).value,' acknowledged unselected input ');assert.equal(view.form.state.payload.note,'literal\udfffunit α😀');
assert.equal(view.files[0].descriptor.name,'\ufeffbad\ud800name');assert.equal(view.files[0].bytes,'AP_DKA');assert.equal(typeof view.files[0].rawDescriptor,'string');
const lifetime=await artifact('backup336-inventory-stream-lifetime-proof.json');assert.equal(lifetime.synthetic,true);assert.equal(lifetime.clearedWhilePaused,true);
assert.equal(lifetime.error,'E2EE_ACCOUNT_CHANGED');assert.ok(Number.isSafeInteger(lifetime.pauseAtBytes)&&lifetime.pauseAtBytes>=4096&&lifetime.pauseAtBytes<=128*1024);
assert.ok(Number.isSafeInteger(lifetime.maximumWrite)&&lifetime.maximumWrite>0&&lifetime.maximumWrite<=128*1024);
assert.ok(Number.isSafeInteger(lifetime.singleWrites)&&lifetime.singleWrites>=0);assert.ok(Number.isSafeInteger(lifetime.clearWhilePausedMs)&&lifetime.clearWhilePausedMs>=0);
const large=await artifact('backup336-inventory-stream-large-proof.json');assert.equal(large.synthetic,true);assert.equal(large.files,3);assert.deepEqual(large.fileSizes,[24,17,10].map(value=>value*1024*1024));
assert.equal(large.originalBytes,51*1024*1024);assert.equal(large.oldAggregateGate,'E2EE_SNAPSHOT_TOO_LARGE');assert.equal(large.rawDescriptors.length,3);
assert.ok(large.maximumWrite>0&&large.maximumWrite<=128*1024);for(const field of ['bytes','maxHeap','elapsedMs'])assert.ok(Number.isSafeInteger(large[field])&&large[field]>0);
const descriptors=large.rawDescriptors.map(raw=>parseLegacyMigrationJson(raw,'E2EE_ARCHIVE_SOURCE_INVALID',32768));
assert.equal(new Set(descriptors.map(value=>value.id)).size,3);
for(const [index,value]of descriptors.entries()){
 assert.deepEqual(Object.keys(value).sort(),['protocol','id','length','name','type','lastModified','declaredSize','sha256'].sort());
 assert.equal(value.protocol,1);assert.match(value.id,/^[a-f0-9-]{36}$/);assert.equal(value.length,large.fileSizes[index]);assert.equal(value.name,'\ufefforiginal\ud800name');
 assert.equal(value.type,'APPLICATION/JSON');assert.equal(value.lastModified,null);assert.equal(value.declaredSize,null);
}
assert.deepEqual(parseLegacyMigrationJson(large.rawManifest,'E2EE_ARCHIVE_SOURCE_INVALID',32768),{protocol:2,fields:[],settled:true,
 file:{id:descriptors[0].id,name:'\ufefforiginal\ufffdname',type:'application/json',size:large.fileSizes[0],lastModified:0}});
// Independent, bounded host construction. Full Base64 blocks end on a3-byte
// boundary; only the last short block omits padding. No aggregate output tree.
const quoted=value=>JSON.stringify(value).replace(/[\ud800-\udfff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
const hash=createHash('sha256');let count=0;const append=value=>{count+=Buffer.byteLength(value);hash.update(value);};
append('{"protocol":3,"ownerId":'+quoted(large.ownerId)+',"sessionEpoch":'+large.sessionEpoch+',"views":[{"id":'+quoted(large.viewId)+',"source":"backup-panel","mounted":false,"rawForm":null,"valueForm":');
append('{"protocol":2,"ownerId":'+quoted(large.ownerId)+',"sessionEpoch":'+large.sessionEpoch+',"viewId":'+quoted(large.viewId)+',"rawManifest":'+quoted(large.rawManifest)+',"rawManifests":['+quoted(large.rawManifest)+'],"values":[]},"files":[');
const block=Buffer.alloc(98304);for(let index=0;index<block.length;index++)block[index]=(index*31)&255;
try{
 for(let index=0;index<descriptors.length;index++){
  if(index)append(',');append('{"rawDescriptor":'+quoted(large.rawDescriptors[index])+',"bytes":"');const original=createHash('sha256');
  for(let offset=0;offset<large.fileSizes[index];offset+=block.length){const part=block.subarray(0,Math.min(block.length,large.fileSizes[index]-offset));original.update(part);append(part.toString('base64url'));}
  assert.equal(descriptors[index].sha256,original.digest('hex'));append('"}');
 }
}finally{block.fill(0);}
append(']}]}');assert.equal(count,large.bytes);assert.ok(count>64*1024*1024);assert.equal(hash.digest('hex'),large.sha256);
const report={synthetic:true,status:'PASS',input:relative(root,source).replaceAll('\\','/'),nativeSourceHash:record.nativeSourceHash,device:row.device,
 large:{originalBytes:large.originalBytes,sourceBytes:large.bytes,maxHeap:large.maxHeap,elapsedMs:large.elapsedMs},checks:[
  'actual native value/history/provider source reached the strict shared reader with original code units and bytes',
  'selected24MiB and unselected17/10MiB candidates independently matched each original binary digest',
  'host independently matched every emitted byte of the greater-than64MiB source using bounded Base64 blocks',
  'native account retirement cleared inventory while binary output was paused; no bulk inventory/File monitor held',
  'old aggregate capture still refuses; no whole coordinator/common-reader streaming, protected snapshot, old-key portability or activation inferred'
 ]};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
