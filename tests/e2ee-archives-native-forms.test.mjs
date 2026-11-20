import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeNativeArchiveForms,normalizeNativeArchiveCapture} from '../app/e2ee/archives-native-forms.ts';
const owner='native-forms-owner',view='12345678-1234-5678-9012-123456789abc',fileId='23456789-1234-5678-9012-123456789abc';
const scope='account-'+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner))).toString('hex').slice(0,32);
async function fixture(){
 const raw=Uint8Array.from([0,255,0xc3,0x28]),descriptor={protocol:1,id:fileId,length:4,name:'исходный.genesisbackup',type:'APPLICATION/JSON',lastModified:1234,declaredSize:8,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',raw)).toString('hex')};
 const form={protocol:1,state:{key:' exact independent input ',operationId:'uncertain',confirmed:false,zero:0,plan:{operations:[{section:'workspace',input:{ciphertext:'unopened-old-account-cipher'}}]}},settled:true,
  file:{id:fileId,name:descriptor.name,type:'application/json',size:4,lastModified:1234}};
 return{protocol:1,ownerId:owner,sessionEpoch:5,views:[{id:view,source:'backup-panel',mounted:true,rawForm:' \n'+JSON.stringify(form)+'\n',files:[{descriptor,bytes:Buffer.from(raw).toString('base64url')}]}]};
}
async function valueFixture(){
 const input=await fixture(),row=input.views[0],form=JSON.parse(row.rawForm);
 const values=Object.entries(form.state).map(([name,value])=>({name,id:crypto.randomUUID(),rawJson:JSON.stringify(value)}));
 const rawManifest=JSON.stringify({protocol:2,fields:values.map(({name,id})=>({name,id})),settled:true,file:form.file});
 input.protocol=2;row.rawForm=null;row.valueForm={protocol:2,ownerId:owner,sessionEpoch:5,viewId:view,rawManifest,rawManifests:[rawManifest],values};
 return input;
}
test('composed v2 inventory keeps every original value, previous manifest and mixed detached v1 branch',async()=>{
 const input=await valueFixture(),row=input.views[0],source=row.valueForm,previous=source.rawManifest;
 const next={name:'key',id:crypto.randomUUID(),rawJson:JSON.stringify(' exact new key \ud800 ')};source.values.push(next);
 const manifest=JSON.parse(previous);manifest.fields=manifest.fields.map(field=>field.name==='key'?{name:field.name,id:next.id}:field);
 source.rawManifest=JSON.stringify(manifest);source.rawManifests.push(source.rawManifest);
 const unselected={name:'payload',id:crypto.randomUUID(),rawJson:' { "neverCommitted": true } '};source.values.push(unselected);
 const legacy=await fixture();legacy.views[0].id=crypto.randomUUID();legacy.views[0].mounted=false;legacy.views[0].files=[];
 const oldForm=JSON.parse(legacy.views[0].rawForm);oldForm.file=null;legacy.views[0].rawForm=JSON.stringify(oldForm);legacy.views[0].valueForm=null;input.views.push(legacy.views[0]);
 const before=JSON.stringify(input),captured=await normalizeNativeArchiveForms(input,owner,()=>{});
 assert.equal(captured.length,2);assert.equal(captured[0].form.state.key,' exact new key \ud800 ');
 assert.equal(captured[0].valueForm.manifests[0].state.key,' exact independent input ');
 assert.equal(captured[0].valueForm.values.at(-1).rawJson,unselected.rawJson);assert.equal(captured[0].form.state.payload,undefined);
 assert.equal(captured[1].rawForm,legacy.views[0].rawForm);assert.equal(captured[1].valueForm,null);assert.equal(JSON.stringify(input),before);
 assert.equal('complete' in captured[0],false);assert.equal(captured[0].valueForm.execution,'source-input');
});
test('composed v2 validation rejects a foreign binding, ambiguous legacy state, hidden duplicates and missing manifest history',async()=>{
 for(const change of [input=>input.views[0].valueForm.ownerId='foreign',input=>input.views[0].valueForm.sessionEpoch++,input=>input.views[0].valueForm.viewId=crypto.randomUUID(),
  input=>input.views[0].rawForm='{}',input=>input.views[0].valueForm.rawManifests=[],
  input=>input.views[0].valueForm.values.push({name:'payload',id:crypto.randomUUID(),rawJson:'{"hidden":1,"hidden":2}'})]){
  const input=await valueFixture();change(input);await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/E2EE_/);
 }
});
test('a file selected only by a prior v2 manifest still requires its original verified binary candidate',async()=>{
 const input=await valueFixture(),source=input.views[0].valueForm,next=JSON.parse(source.rawManifest);next.file=null;
 source.rawManifest=JSON.stringify(next);source.rawManifests.push(source.rawManifest);
 await normalizeNativeArchiveForms(input,owner,()=>{});
 input.views[0].files=[];await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/E2EE_ARCHIVE_FILE_INTEGRITY/);
});
test('composed v2 input pins its original inventory protocol and epoch before source callbacks run',async()=>{
 const input=await valueFixture();let checks=0;
 const [result]=await normalizeNativeArchiveForms(input,owner,()=>{if(++checks===2){input.protocol=1;input.sessionEpoch=99;}});
 assert.equal(result.valueForm.sessionEpoch,5);assert.equal(result.valueForm.protocol,2);
});
test('the composed candidate bound is global across v2 views, before cloning and parsing private values',async()=>{
 const input=await valueFixture();input.views=[];
 for(let index=0;index<2;index++){
  const id=crypto.randomUUID(),values=Array.from({length:5001},()=>({name:'key',id:crypto.randomUUID(),rawJson:'0'}));
  const manifest=JSON.stringify({protocol:2,fields:[{name:'key',id:values[0].id}],settled:true,file:null});
  input.views.push({id,source:'backup-panel',mounted:false,rawForm:null,files:[],valueForm:{protocol:2,ownerId:owner,sessionEpoch:5,viewId:id,rawManifest:manifest,rawManifests:[manifest],values}});
 }
 await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/E2EE_SOURCE_TOO_LARGE/);
});
test('actual native inventory framing preserves exact forms, binary input, provider absence and uncertain operations without executing plans',async()=>{
 const input=await fixture(),before=JSON.stringify(input),[captured]=await normalizeNativeArchiveForms(input,owner,()=>{});
 assert.equal(captured.rawForm,input.views[0].rawForm);assert.deepEqual(Buffer.from(captured.files[0].bytes,'base64url'),Buffer.from([0,255,0xc3,0x28]));
 assert.equal(captured.files[0].descriptor.type,'APPLICATION/JSON');assert.equal(captured.files[0].descriptor.declaredSize,8);
 assert.equal(captured.form.state.confirmed,false);assert.equal(captured.form.state.zero,0);assert.equal(captured.form.state.operationId,'uncertain');
 assert.equal('complete' in captured,false);assert.equal(JSON.stringify(input),before);assert.equal(Object.isFrozen(captured),true);
});
test('every detached branch and staged unselected file survives, while mounted unfinished work refuses',async()=>{
 const input=await fixture();input.views[0].mounted=false;input.views[0].rawForm=input.views[0].rawForm.replace('"settled":true','"settled":false');
 input.views.push({id:'34567890-1234-5678-9012-123456789abc',source:'backup-panel',mounted:false,rawForm:null,files:[]});
 const captured=await normalizeNativeArchiveForms(input,owner,()=>{});assert.equal(captured.length,2);assert.equal(captured[0].form.settled,false);assert.equal(captured[1].form,null);
 input.views[0].mounted=true;await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/OPERATION_IN_PROGRESS/);
 input.views[0].mounted=false;input.views[1].mounted=true;await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/OPERATION_IN_PROGRESS/);
});
test('empty native files and absent provider metadata retain explicit provenance and the actual File display fallback',async()=>{
 const input=await fixture(),candidate=input.views[0].files[0];candidate.bytes='';
 Object.assign(candidate.descriptor,{length:0,name:null,type:null,lastModified:null,declaredSize:null,sha256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'});
 const form=JSON.parse(input.views[0].rawForm);form.file={id:fileId,name:'import.genesisbackup',type:'application/octet-stream',size:0,lastModified:0};input.views[0].rawForm=JSON.stringify(form);
 const [captured]=await normalizeNativeArchiveForms(input,owner,()=>{});assert.equal(captured.files[0].bytes,'');assert.equal(captured.files[0].descriptor.name,null);assert.equal(captured.form.file.size,0);
 candidate.bytes='AA';await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/E2EE_/);
});
test('File display normalizes lone provider surrogates while preserving original metadata and a leading BOM',async()=>{
 for(const name of ['bad\ud800name','\ufefforiginal-\udfff']){
  const input=await fixture();input.views[0].files[0].descriptor.name=name;
  const form=JSON.parse(input.views[0].rawForm);form.file.name=new File([] ,name).name;input.views[0].rawForm=JSON.stringify(form);
  const [captured]=await normalizeNativeArchiveForms(input,owner,()=>{});assert.equal(captured.files[0].descriptor.name,name);assert.equal(captured.form.file.name,form.file.name);
 }
});
test('original duplicate escaped form names cannot be projected away by JSONObject or become trusted state',async()=>{
 for(const alter of [raw=>raw.replace('"protocol":1','"protocol":2,"protoc\\u006fl":1'),raw=>raw.replace('"confirmed":false','"confirmed":true,"confirmed":false'),raw=>raw+'{}']){
  const input=await fixture();input.views[0].rawForm=alter(input.views[0].rawForm);await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/E2EE_/);
 }
});
test('foreign owners, duplicate views/files and future schemas refuse without changing originals',async()=>{
 for(const change of [input=>input.ownerId='foreign',input=>input.protocol=2,input=>input.views.push(input.views[0]),input=>input.views[0].files.push(input.views[0].files[0]),
  input=>input.views[0].files[0].descriptor.protocol=2,input=>input.views[0].files[0].descriptor.length=-1,input=>input.views[0].source='external',input=>input.views[0].files[0].extra='future']){
  const input=await fixture();change(input);const before=JSON.stringify(input);await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/E2EE_/);assert.equal(JSON.stringify(input),before);
 }
});
test('truncated corrupted noncanonical binary input and spliced display metadata never pass as the selected file',async()=>{
 for(const change of [input=>input.views[0].files[0].bytes='AP_D',input=>input.views[0].files[0].bytes+='=',input=>input.views[0].files[0].descriptor.sha256='0'.repeat(64),
  input=>input.views[0].rawForm=input.views[0].rawForm.replace('"size":4','"size":3'),input=>input.views[0].rawForm=input.views[0].rawForm.replace('"type":"application/json"','"type":"invented"'),
  input=>input.views[0].files=[]]){
  const input=await fixture();change(input);await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/E2EE_/);
 }
});
test('a changed owner during full digest verification cannot publish preserved private forms',async()=>{
 const input=await fixture();let checks=0;await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{if(++checks===3)throw new Error('E2EE_ACCOUNT_CHANGED');}),/E2EE_ACCOUNT_CHANGED/);
});
test('AuthController inventory normalizes original protected state, forms and history without claiming old-key opening or complete recovery',async()=>{
 const forms=await fixture(),protectedState=JSON.stringify({format:'native-protected-state-v1',scope,capturedAt:'2026-11-20T03:00:00Z',preferences:{'pending:language':'ru'},documents:[],tasks:[],outbox:[]});
 const input={protocol:1,ownerId:owner,scopeId:'personal:'+owner,capturedAt:'2026-11-20T03:01:00Z',platform:'android',inventoryVersion:1,generation:0,pendingGeneration:7,
  history:'{"attempt":"2026-11-20T02:00:00Z"}',protectedState,safety:[],forms};
 const value=await normalizeNativeArchiveCapture(input,()=>{});assert.equal(value.protectedState.raw,protectedState);assert.equal(value.pendingGeneration,7);assert.equal(value.forms[0].form.state.operationId,'uncertain');
 assert.equal(value.originalHistory,input.history);assert.deepEqual(value.safety,[]);assert.equal('complete' in value,false);
 for(const history of ['{"attempt":"invalid"}','{"attempt":"2026-11-20","attempt":"2026-11-20"}','{"authority":true}'])await assert.rejects(normalizeNativeArchiveCapture({...input,history},()=>{}),/E2EE_/);
});
// Append to tests/e2ee-archives-native-forms.test.mjs after the protocol3 reader
// and native writer land. Uses that file's existing fixture/valueFixture helpers.
async function streamFixture(){
 const input=await valueFixture(),row=input.views[0],candidate=row.files[0],descriptor=candidate.descriptor;
 descriptor.name='\ufeffbad\ud800name';const manifest=JSON.parse(row.valueForm.rawManifest);manifest.file.name=new File([],descriptor.name).name;
 row.valueForm.rawManifest=JSON.stringify(manifest);row.valueForm.rawManifests=[row.valueForm.rawManifest];
 candidate.rawDescriptor=' \n'+JSON.stringify(descriptor).replace('"protocol"','"protoco\\u006c"')+'\r\n';delete candidate.descriptor;
 input.protocol=3;return input;
}
test('v3 source wire preserves original provider JSON and exact value/manifests without a metadata projection',async()=>{
 const input=await streamFixture(),before=JSON.stringify(input),[result]=await normalizeNativeArchiveForms(input,owner,()=>{});
 assert.equal(result.files[0].rawDescriptor,input.views[0].files[0].rawDescriptor);assert.equal(result.files[0].descriptor.name,'\ufeffbad\ud800name');
 assert.equal(result.files[0].descriptor.protocol,1);assert.equal(result.form.state.key,' exact independent input ');assert.equal(result.valueForm.manifests.length,1);
 assert.deepEqual(Buffer.from(result.files[0].bytes,'base64url'),Buffer.from([0,255,0xc3,0x28]));assert.equal(JSON.stringify(input),before);assert.equal('complete' in result,false);
});
test('v3 original provider metadata rejects escaped duplicates trailing text unsafe types and extra projected input',async()=>{
 for(const alter of [candidate=>candidate.rawDescriptor=candidate.rawDescriptor.replace('"length":4','"length":4,"len\\u0067th":4'),
  candidate=>candidate.rawDescriptor+='{}',candidate=>candidate.rawDescriptor=candidate.rawDescriptor.replace('"length":4','"length":4.5'),
  candidate=>candidate.descriptor={},candidate=>candidate.bytes='AP_D']){
  const input=await streamFixture();alter(input.views[0].files[0]);const before=JSON.stringify(input);
  await assert.rejects(normalizeNativeArchiveForms(input,owner,()=>{}),/E2EE_/);assert.equal(JSON.stringify(input),before);
 }
});
test('v3 source protocol and provider text are pinned before reentrant actor callbacks',async()=>{
 const input=await streamFixture(),raw=input.views[0].files[0].rawDescriptor;let checks=0;
 const [result]=await normalizeNativeArchiveForms(input,owner,()=>{if(++checks===2){input.protocol=1;input.views[0].files[0].rawDescriptor='{}';}});
 assert.equal(result.files[0].rawDescriptor,raw);assert.equal(result.valueForm.sessionEpoch,5);assert.equal(result.files[0].descriptor.name,'\ufeffbad\ud800name');
});
