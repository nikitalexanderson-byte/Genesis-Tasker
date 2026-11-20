import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeBackupValueRetainer} from '../app/backup-native-values.ts';
import {readNativeBackupFile} from '../app/backup-native-file.ts';

function rig(){
 const values=new Map(),transfers=[],manifests=[];let live=true,failValue='',failCommit='';
 const receiver=nativeBackupValueRetainer({check(){if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},operationId:()=> 'original-native-job',
  value(name,id,index,last,raw,token){if(failValue)return failValue;transfers.push({name,id,index,last,raw,token});values.set(id,(values.get(id)??'')+raw);return '';},
  commit(raw,token){if(failCommit)return failCommit;const manifest=JSON.parse(raw);assert.equal(token,'original-native-job');
   for(const field of manifest.fields){assert.ok(values.has(field.id));assert.equal(transfers.find(part=>part.id===field.id).name,field.name);}manifests.push(manifest);return '';},
 });
 return{receiver,values,transfers,manifests,live(value){live=value;},failValue(value){failValue=value;},failCommit(value){failCommit=value;},
  current(){const manifest=manifests.at(-1);return{...manifest,state:Object.fromEntries(manifest.fields.map(field=>[field.name,JSON.parse(values.get(field.id))]))};}};
}
const form=(state,settled=true)=>({file:null,state,settled});

test('staged value transport preserves exact input, false, zero, ordering, file absence and original operation token',()=>{
 const r=rig(),state={key:' exact key input ',zero:0,confirmed:false,operationId:'uncertain-original',selection:['workspace','diary'],omitted:undefined};
 r.receiver.retain(form(state));const accepted=r.current();assert.equal(accepted.protocol,2);assert.equal(accepted.file,null);assert.equal(accepted.settled,true);
 assert.deepEqual(accepted.state,{key:state.key,zero:0,confirmed:false,operationId:state.operationId,selection:state.selection});
 assert.deepEqual(accepted.fields.map(field=>field.name),['key','zero','confirmed','operationId','selection']);
 assert.ok(r.transfers.every(part=>part.token==='original-native-job'));assert.equal(r.receiver.toString(),'NativeBackupValueRetainer([redacted])');
});

test('large unchanged payload and plan are not retransmitted when a small input, selection or settled state changes',()=>{
 const r=rig(),state={payload:{text:'α😀'.repeat(500000)},plan:{ciphertext:'x'.repeat(3*1024*1024)},key:'original',confirmed:false};
 r.receiver.retain(form(state));const initial=r.current(),bytes=r.transfers.reduce((sum,row)=>sum+row.raw.length,0),first=r.transfers.length;
 assert.ok(first>25&&bytes>4*1024*1024);
 r.receiver.retain(form({...state,key:' changed exact input '}));const changed=r.current(),small=r.transfers.slice(first);
 assert.equal(small.length,1);assert.equal(small[0].name,'key');assert.equal(small[0].raw,JSON.stringify(' changed exact input '));
 for(const name of ['payload','plan','confirmed'])assert.equal(changed.fields.find(field=>field.name===name).id,initial.fields.find(field=>field.name===name).id);
 const before=r.transfers.length;r.receiver.retain(form({...state,key:' changed exact input '},false));assert.equal(r.transfers.length,before);
 assert.equal(r.current().settled,false);assert.deepEqual(r.current().state.plan,state.plan);
 const commits=r.manifests.length;r.receiver.retain(form({...state,key:' changed exact input '},false));assert.equal(r.manifests.length,commits);
});

test('unchanged serialized objects reuse values while in-place edits are detected before publication',()=>{
 const r=rig(),payload={nested:{note:'original'}};r.receiver.retain(form({payload}));const original=r.current().fields[0].id;
 r.receiver.retain(form({payload:structuredClone(payload)}));assert.equal(r.current().fields[0].id,original);
 payload.nested.note='edited without changing reference';r.receiver.retain(form({payload}));assert.notEqual(r.current().fields[0].id,original);
 assert.equal(r.current().state.payload.nested.note,payload.nested.note);
});

test('failed value/manifest acknowledgements cannot advance the accepted cache or overwrite the preceding manifest',()=>{
 const r=rig();r.receiver.retain(form({key:'accepted',zero:0}));const previous=structuredClone(r.current());
 r.failValue('E2EE_ARCHIVE_CAPTURE_BUSY');assert.throws(()=>r.receiver.retain(form({key:'candidate',zero:0})),/E2EE_ARCHIVE_CAPTURE_BUSY/);assert.deepEqual(r.current(),previous);
 r.failValue('');r.failCommit('unbounded private error');assert.throws(()=>r.receiver.retain(form({key:'candidate',zero:0})),/BACKUP_NATIVE_FAILED/);assert.deepEqual(r.current(),previous);
 r.failCommit('');const before=r.transfers.length;r.receiver.retain(form({key:'candidate',zero:0}));assert.equal(r.transfers.length,before+1);assert.equal(r.current().state.key,'candidate');
});

test('full preflight and original session checks precede every native transfer, and disposal closes the cache',()=>{
 const r=rig(),cycle={};cycle.self=cycle;
 assert.throws(()=>r.receiver.retain(form({valid:'not published',cycle})),TypeError);assert.equal(r.transfers.length,0);
 assert.throws(()=>r.receiver.retain(form({'invalid name':'private'})),/E2EE_ARCHIVE_SOURCE_INVALID/);assert.equal(r.transfers.length,0);
 r.receiver.retain(form({key:'accepted'}));r.live(false);assert.throws(()=>r.receiver.retain(form({key:'foreign owner'})),/E2EE_ACCOUNT_CHANGED/);
 r.receiver.clear();r.live(true);assert.throws(()=>r.receiver.retain(form({key:'same UID new epoch'})),/BACKUP_VIEW_CLOSED/);
});

test('oversized small manifest and invented file provenance refuse before any value is published',async()=>{
 const r=rig();assert.throws(()=>r.receiver.retain({file:new File(['private'],'invented'),state:{key:'private'},settled:true}),/E2EE_ARCHIVE_FILE_ORIGIN_REQUIRED/);
 const file=await readNativeBackupFile({check(){},choose:async()=>({protocol:1,id:crypto.randomUUID(),length:0,name:'\u0001'.repeat(4096),type:'"'.repeat(1024),lastModified:0,declaredSize:null,
  sha256:Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array())).toString('hex')}),chunk:async()=>{throw new Error('empty file has no chunk');},clear:async()=>true});
 const state=Object.fromEntries(Array.from({length:64},(_,index)=>['field'+String(index).padStart(2,'0')+'x'.repeat(57),null]));
 assert.throws(()=>r.receiver.retain({file,state,settled:true}),/E2EE_SOURCE_TOO_LARGE/);assert.equal(r.transfers.length,0);assert.equal(r.manifests.length,0);
});
