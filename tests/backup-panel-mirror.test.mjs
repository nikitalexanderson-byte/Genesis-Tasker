import assert from 'node:assert/strict';
import test from 'node:test';
import {backupPanelMirror} from '../app/backup-panel-mirror.ts';
import {retainNativeBackupForm} from '../app/backup-native-form.ts';
import {readNativeBackupFile} from '../app/backup-native-file.ts';
import {nativeBackupOperations} from '../app/backup-native-operations.ts';
const clone=form=>({...form,state:structuredClone(form.state)});

test('accepted input and functional updates reach retention before a React render or disposal',()=>{
 const captured=[],mirror=backupPanelMirror(form=>captured.push(clone(form)));
 mirror.initialize('key','');mirror.initialize('selected',[]);mirror.initialize('confirmed',false);mirror.initialize('busy',false);
 mirror.update('key','  exact private input  ');mirror.update('selected',old=>[...old,'workspace']);mirror.update('selected',old=>[...old,'diary']);
 mirror.setOperationId('original-uncertain-operation');mirror.update('confirmed',true);
 assert.equal(captured[0].state.key,'  exact private input  ');assert.deepEqual(captured[2].state.selected,['workspace','diary']);
 assert.equal(mirror.snapshot().state.operationId,'original-uncertain-operation');assert.equal(mirror.snapshot().state.confirmed,true);
 assert.deepEqual(captured.at(-1),mirror.snapshot());mirror.initialize('key','stale rendered value');assert.equal(mirror.snapshot().state.key,'  exact private input  ');
});

test('failed retention leaves file, input, operation identity and settled state at the last accepted version',()=>{
 let fail=false;const mirror=backupPanelMirror(()=>{if(fail)throw new Error('E2EE_ARCHIVE_CAPTURE_BUSY');});
 mirror.initialize('key','original');mirror.initialize('file',null);mirror.initialize('busy',false);mirror.setOperationId('accepted');const before=mirror.snapshot();fail=true;
 for(const action of [()=>mirror.update('key','refused'),()=>mirror.update('file',new File(['private'],'selected')),()=>mirror.update('busy',true),()=>mirror.setOperationId('refused')]){
  assert.throws(action,/E2EE_ARCHIVE_CAPTURE_BUSY/);assert.deepEqual(mirror.snapshot(),before);
 }
});

test('busy work stays explicitly unsettled and a final acknowledged result can precede releasing the native permit',async()=>{
 const captured=[],mirror=backupPanelMirror(form=>captured.push(clone(form)));mirror.initialize('payload',null);mirror.initialize('busy',false);
 let operations;operations=nativeBackupOperations({begin:async operationId=>({operationId}),end:async id=>{
  assert.equal(operations.token(),'');assert.equal(operations.formToken(),id);assert.equal(captured.at(-1).settled,true);
  assert.deepEqual(captured.at(-1).state.payload,{result:'accepted before end'});return true;
 },restart:async()=>({})});
 mirror.update('busy',true);assert.equal(mirror.snapshot().settled,false);
 await operations.run(async()=>{assert.equal(operations.formToken(),operations.token());mirror.update('payload',{result:'accepted before end'});mirror.update('busy',false);});
 assert.equal(operations.formToken(),'');
});

async function selectedFile(){
 const bytes=Uint8Array.from([0,255,0xc3,0x28]),id='12345678-1234-5678-9012-123456789abc';
 const info={protocol:1,id,length:bytes.length,name:'исходный.genesisbackup',type:'APPLICATION/JSON',lastModified:1234,declaredSize:null,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')};
 return readNativeBackupFile({check(){},choose:async()=>info,chunk:async()=>({id,offset:0,bytes:Buffer.from(bytes).toString('base64url'),nextOffset:bytes.length,eof:true}),clear:async()=>true});
}
test('native form retention sends exact raw input in ordered synchronous chunks and only references original native bytes',async()=>{
 const file=await selectedFile(),chunks=[],state={key:' exact independent input ',operationId:'uncertain',privateText:'α😀'.repeat(100000)};
 retainNativeBackupForm({file,state,settled:true},{check(){},operationId:()=> 'bound-job',submit:(id,index,last,raw,token)=>{chunks.push({id,index,last,raw,token});return '';}});
 assert.equal(chunks.length,3);assert.equal(new Set(chunks.map(part=>part.id)).size,1);
 chunks.forEach((part,index)=>{assert.equal(part.index,index);assert.equal(part.last,index===chunks.length-1);assert.equal(part.token,'bound-job');});
 const value=JSON.parse(chunks.map(part=>part.raw).join(''));assert.deepEqual(value.state,state);assert.equal(value.settled,true);
 assert.deepEqual(value.file,{id:'12345678-1234-5678-9012-123456789abc',name:file.name,type:'application/json',size:4,lastModified:1234});assert.equal('bytes' in value.file,false);
});

test('missing provenance, failed acknowledgement and changed owner refuse input before it can become accepted UI state',async()=>{
 const ports={check(){},operationId:()=>'',submit:()=>''};let calls=0;
 assert.throws(()=>retainNativeBackupForm({file:new File(['original'],'invented'),state:{},settled:true},{...ports,submit(){calls++;return '';}}),/E2EE_ARCHIVE_FILE_ORIGIN_REQUIRED/);assert.equal(calls,0);
 for(const result of ['E2EE_ARCHIVE_CAPTURE_BUSY','private unbounded exception'])assert.throws(()=>retainNativeBackupForm({file:null,state:{key:'private'},settled:true},{...ports,submit:()=>result}),new RegExp(result.startsWith('E2EE_')?result:'BACKUP_NATIVE_FAILED'));
 assert.throws(()=>retainNativeBackupForm({file:null,state:{},settled:true},{...ports,check(){throw new Error('BACKUP_OWNER');}}),/BACKUP_OWNER/);
});
