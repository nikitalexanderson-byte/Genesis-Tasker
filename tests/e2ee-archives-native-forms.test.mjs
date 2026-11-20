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
