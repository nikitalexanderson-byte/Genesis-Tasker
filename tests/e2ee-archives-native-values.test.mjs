import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeNativeArchiveValues} from '../app/e2ee/archives-native-values.ts';

const owner='native-value-source-owner',view=crypto.randomUUID(),expected={ownerId:owner,sessionEpoch:7,viewId:view};
function source(entries,fields=entries.map(row=>({name:row.name,id:row.id})),settled=true){
 const rawManifest=JSON.stringify({protocol:2,fields,settled,file:null});
 return{protocol:2,...expected,rawManifest,rawManifests:[rawManifest],values:entries.map(({id,name,rawJson})=>({id,name,rawJson}))};
}
const entry=(name,value)=>({name,id:crypto.randomUUID(),rawJson:JSON.stringify(value)});

test('staged v2 source retains exact raw values and inert private form state without executable authority',()=>{
 const rows=[entry('key',' exact independent input α😀\uD800 '),entry('zero',0),entry('confirmed',false),entry('operationId','uncertain-original'),entry('stage',{stageId:'old-stage',roles:{admin:true}})];
 rows[1].rawJson=' \n0\n';const input=source(rows),before=JSON.stringify(input),result=normalizeNativeArchiveValues(input,expected,()=>{});
 assert.equal(result.execution,'source-input');assert.equal(result.state.key,' exact independent input α😀\uD800 ');assert.equal(result.state.zero,0);assert.equal(result.state.confirmed,false);
 assert.equal(result.state.operationId,'uncertain-original');assert.equal(result.state.stage.stageId,'old-stage');assert.equal(result.values[1].rawJson,' \n0\n');
 assert.equal(result.rawManifest,input.rawManifest);assert.equal(JSON.stringify(input),before);assert.equal('complete' in result,false);assert.equal('restore' in result,false);
});

test('all unreferenced candidates survive, and duplicate private JSON cannot hide in an unselected value',()=>{
 const rows=[entry('key','selected'),entry('payload',{unsent:'independent candidate'})],input=source(rows,[{name:'key',id:rows[0].id}]);
 const value=normalizeNativeArchiveValues(input,expected,()=>{});assert.equal(value.values.length,2);assert.equal(value.state.payload,undefined);assert.equal(value.values[1].value.unsent,'independent candidate');
 input.values[1].rawJson='{"private":1,"private":2}';assert.throws(()=>normalizeNativeArchiveValues(input,expected,()=>{}),/E2EE_ARCHIVE_SOURCE_INVALID/);
});

test('a missing manifest remains explicit pending source input rather than an empty completed form',()=>{
 const input=source([entry('key','uncommitted candidate')]);input.rawManifest=null;input.rawManifests=[];
 const result=normalizeNativeArchiveValues(input,expected,()=>{});assert.equal(result.manifest,null);assert.equal(result.state,null);assert.equal(result.values.length,1);assert.equal('complete' in result,false);
 assert.equal(result.values[0].name,'key');
});

test('wrong owner, epoch or view refuses attribution before malformed private JSON is interpreted',()=>{
 for(const patch of [{ownerId:'another-owner'},{sessionEpoch:8},{viewId:crypto.randomUUID()}]){
  const input=source([entry('key','original')]);Object.assign(input,patch);input.values[0].rawJson='{unreadable';
  assert.throws(()=>normalizeNativeArchiveValues(input,expected,()=>{}),/E2EE_SCOPE_BINDING_MISMATCH/);
 }
});

test('original duplicate manifests, repeated identities, forbidden field names and missing references refuse',()=>{
 const row=entry('key','original'),valid=source([row]);
 const duplicate={...valid,rawManifest:'{"protocol":2,"protocol":1,"fields":[],"settled":true,"file":null}'};duplicate.rawManifests=[duplicate.rawManifest];
 assert.throws(()=>normalizeNativeArchiveValues(duplicate,expected,()=>{}),/E2EE_ARCHIVE_SOURCE_INVALID/);
 assert.throws(()=>normalizeNativeArchiveValues({...valid,values:[...valid.values,...valid.values]},expected,()=>{}),/E2EE_ARCHIVE_SOURCE_INVALID/);
 for(const fields of [[{name:'key',id:row.id},{name:'key',id:row.id}],[{name:'__proto__',id:row.id}],[{name:'constructor',id:row.id}]])
  assert.throws(()=>normalizeNativeArchiveValues(source([row],fields),expected,()=>{}),/E2EE_ARCHIVE_SOURCE_INVALID/);
 assert.throws(()=>normalizeNativeArchiveValues(source([row],[{name:'payload',id:crypto.randomUUID()}]),expected,()=>{}),/E2EE_ARCHIVE_VALUE_ORIGIN_REQUIRED/);
 assert.throws(()=>normalizeNativeArchiveValues(source([row],[{name:'payload',id:row.id}]),expected,()=>{}),/E2EE_ARCHIVE_VALUE_ORIGIN_REQUIRED/);
});

test('selected file metadata is inert and exact, with binary-origin checking deliberately left to the enclosing collector',()=>{
 const input=source([entry('key','original')]),manifest=JSON.parse(input.rawManifest),file={id:crypto.randomUUID(),name:'literal <img>.genesisbackup',type:'application/octet-stream',size:0,lastModified:0};
 manifest.file=file;input.rawManifest=JSON.stringify(manifest);input.rawManifests=[input.rawManifest];assert.deepEqual(normalizeNativeArchiveValues(input,expected,()=>{}).manifest.file,file);
 manifest.file={...file,uri:'file:///untrusted'};input.rawManifest=JSON.stringify(manifest);input.rawManifests=[input.rawManifest];
 assert.throws(()=>normalizeNativeArchiveValues(input,expected,()=>{}),/E2EE_/);
});

test('a current-session failure interrupts normalization without returning a partial source result',()=>{
 const input=source([entry('key','original'),entry('payload',{note:'private'})]);let checks=0;
 assert.throws(()=>normalizeNativeArchiveValues(input,expected,()=>{if(++checks===2)throw new Error('E2EE_ACCOUNT_CHANGED');}),/E2EE_ACCOUNT_CHANGED/);
});

test('normalization keeps the original captured context if a caller later mutates its context object',()=>{
 const input=source([entry('key','original')]),context={...expected};
 const result=normalizeNativeArchiveValues(input,context,()=>{context.ownerId='changed-owner';context.sessionEpoch=99;context.viewId=crypto.randomUUID();});
 assert.equal(result.ownerId,expected.ownerId);assert.equal(result.sessionEpoch,expected.sessionEpoch);assert.equal(result.viewId,expected.viewId);
});
