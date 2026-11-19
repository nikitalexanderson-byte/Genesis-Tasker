import assert from 'node:assert/strict';
import test from 'node:test';
import {parseNativeProtectedArchive,planNativeSafetyArchives} from '../app/e2ee/archives-native-input.ts';
const owner='native-archive-owner',CHUNK=256*1024;
const scope='account-'+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner))).toString('hex').slice(0,32);
const kind='backup-safety:2026-11-20T02:00:00Z:12345678-1234-5678-9012-123456789abc';
const source=()=>({format:'native-protected-state-v1',scope,capturedAt:'2026-11-20T02:00:00Z',preferences:{'pending:language':'ru',enabled:false,zero:0},
 documents:[{kind:'structure',encrypted:'exact original default-key ciphertext',revision:7}],
 tasks:[{id:'deleted-task',encrypted:'exact tombstone ciphertext',revision:9,deleted:true}],
 outbox:[{entityId:'deleted-task',revision:9,operationId:'uncertain-original-operation',state:'pending'}]});
function rows(ciphertext,options={}){
 const chunks=Array.from({length:Math.ceil(ciphertext.length/CHUNK)},(_,index)=>({scope,kind:`${kind}/chunk/${index}`,encrypted:ciphertext.slice(index*CHUNK,(index+1)*CHUNK),revision:1}));
 return [...options.orphan?[]:[{scope,kind,encrypted:JSON.stringify({chunks:chunks.length,length:ciphertext.length}),revision:1}],...chunks];
}
async function encrypted(raw){
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`${scope}/${kind}`)},key,new TextEncoder().encode(raw)));
 const bytes=new Uint8Array(iv.length+ciphertext.length);bytes.set(iv);bytes.set(ciphertext,iv.length);const encoded=Buffer.from(bytes).toString('base64');bytes.fill(0);ciphertext.fill(0);
 return{key,ciphertext:encoded};
}
async function open(plan,key){
 const bytes=Buffer.from(plan.ciphertext,'base64');try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12),additionalData:new TextEncoder().encode(plan.context)},key,bytes.subarray(12)));}
 finally{bytes.fill(0);}
}

test('strict native protected input preserves the original JSON, source tombstones, false/zero and exact uncertain operations',async()=>{
 const value=source(),raw=' \n'+JSON.stringify(value,null,2)+'\n';const parsed=await parseNativeProtectedArchive(raw,owner,()=>{});
 assert.equal(parsed.raw,raw);assert.equal(parsed.scope,scope);assert.deepEqual(parsed.preferences,value.preferences);assert.deepEqual(parsed.tasks,value.tasks);assert.deepEqual(parsed.outbox,value.outbox);
 assert.equal(Object.isFrozen(parsed),true);assert.equal(Object.isFrozen(parsed.documents[0]),true);assert.equal('complete' in parsed,false);assert.equal('content' in parsed,false);
});

test('duplicate escaped property names, trailing content and prototype fields are refused before any native opener exists',async()=>{
 const original=JSON.stringify(source());
 for(const raw of [original.replace('"format":','"format":"hidden","for\\u006dat":'),original.replace('"revision":7','"revision":6,"revision":7'),
  original+' {}',original.replace('"preferences":{','"preferences":{"__proto__":1,'),original.replace('"preferences":{','"preferences":{"zero":1,')]){
  await assert.rejects(parseNativeProtectedArchive(raw,owner,()=>{}),/E2EE_/);
 }
});

test('foreign owner scopes, unsupported formats, duplicate records and unbounded metadata fail without changing originals',async()=>{
 const changes=[value=>value.scope='account-'+'f'.repeat(32),value=>value.format='future-v2',value=>value.capturedAt='not a date',value=>value.preferences=[],
  value=>value.documents.push(value.documents[0]),value=>value.tasks.push(value.tasks[0]),value=>value.outbox.push(value.outbox[0]),
  value=>value.tasks[0].deleted=1,value=>value.documents[0].revision=Number.MAX_SAFE_INTEGER+1,value=>value.outbox[0].state='x'.repeat(101),
  value=>value.tasks[0].owner='foreign',value=>value.outbox[0].revision=1.5];
 for(const change of changes){const value=source();change(value);const raw=JSON.stringify(value);await assert.rejects(parseNativeProtectedArchive(raw,owner,()=>{}),/E2EE_/);assert.equal(JSON.stringify(value),raw);}
});

test('all actual native-style encrypted chunks join losslessly and the derived AAD opens the original protected state',async()=>{
 const value=source();value.preferences.largeOriginal='private original αβ '.repeat(CHUNK/8);const raw=JSON.stringify(value),sealed=await encrypted(raw),input=rows(sealed.ciphertext),before=JSON.stringify(input);
 assert.ok(input.length>3);const [plan]=await planNativeSafetyArchives(input.reverse(),owner,()=>{});
 assert.equal(plan.kind,kind);assert.equal(plan.context,`${scope}/${kind}`);assert.equal(plan.ciphertext,sealed.ciphertext);assert.equal(plan.orphan,false);assert.equal(plan.requiresAuthentication,true);
 assert.deepEqual([...plan.originals].map(row=>row.kind),rows(sealed.ciphertext).map(row=>row.kind));
 assert.equal(JSON.stringify(input.reverse()),before);const opened=await open(plan,sealed.key);
 try{const captured=await parseNativeProtectedArchive(new TextDecoder('utf-8',{fatal:true}).decode(opened),owner,()=>{});assert.equal(captured.raw,raw);}
 finally{opened.fill(0);}
});

test('every retained safety group remains distinct, while rootless chunks are explicit unauthenticated orphan candidates',async()=>{
 const sealed=await encrypted(JSON.stringify(source())),first=rows(sealed.ciphertext),second=rows(sealed.ciphertext,{orphan:true}).map(row=>({...row,kind:row.kind.replace('2026-11-20','2026-11-19')}));
 const plans=await planNativeSafetyArchives([...first,...second],owner,()=>{});assert.equal(plans.length,2);assert.equal(plans[0].orphan,true);assert.equal(plans[1].orphan,false);
 assert.equal(plans.every(plan=>plan.requiresAuthentication&&!('complete' in plan)),true);assert.equal(plans.flatMap(plan=>plan.originals).length,first.length+second.length);
});

test('missing reordered duplicate or foreign chunks cannot be mistaken for an empty or shorter archive',async()=>{
 const sealed=await encrypted('original '.repeat(CHUNK/4));
 const changes=[input=>input.splice(1,1),input=>input[1].kind=input[1].kind.replace('/0','/2'),input=>input.push({...input[1]}),
  input=>input[1].scope='account-'+'e'.repeat(32),input=>input[0].encrypted=JSON.stringify({chunks:1,length:40}),
  input=>input[1].encrypted=input[1].encrypted.slice(1),input=>input[0].extra='unsupported',input=>input[1].revision=-1];
 for(const change of changes){const input=rows(sealed.ciphertext);change(input);const before=JSON.stringify(input);await assert.rejects(planNativeSafetyArchives(input,owner,()=>{}),/E2EE_/);assert.equal(JSON.stringify(input),before);}
});

test('malformed duplicate or future manifests never fall back to inferred orphan assembly',async()=>{
 const sealed=await encrypted(JSON.stringify(source()));
 for(const manifest of ['{"chunks":1,"chunks":1,"length":'+sealed.ciphertext.length+'}',JSON.stringify({chunks:1,length:sealed.ciphertext.length,version:2}),
  JSON.stringify({chunks:0,length:0}),JSON.stringify({chunks:1.5,length:sealed.ciphertext.length}),'{"broken":']){
  const input=rows(sealed.ciphertext);input[0].encrypted=manifest;await assert.rejects(planNativeSafetyArchives(input,owner,()=>{}),/E2EE_/);
 }
});

test('ciphertext framing is bounded/canonical and still cannot replace successful native AEAD authentication',async()=>{
 const sealed=await encrypted(JSON.stringify(source()));
 for(const bad of ['x','A'.repeat(39),'A'.repeat(39)+'-',sealed.ciphertext+' ',sealed.ciphertext.slice(0,-2)+'B=']){
  await assert.rejects(planNativeSafetyArchives(rows(bad),owner,()=>{}),/E2EE_/);
 }
 const bytes=Buffer.from(sealed.ciphertext,'base64');bytes[20]^=1;const tampered=bytes.toString('base64');bytes.fill(0);
 const [plan]=await planNativeSafetyArchives(rows(tampered),owner,()=>{});assert.equal(plan.requiresAuthentication,true);await assert.rejects(open(plan,sealed.key));
});

test('an account transition during the async owner hash refuses both readers without publishing a plan',async()=>{
 const sealed=await encrypted(JSON.stringify(source()));
 for(const action of [current=>parseNativeProtectedArchive(JSON.stringify(source()),owner,current),current=>planNativeSafetyArchives(rows(sealed.ciphertext),owner,current)]){
  let checks=0;await assert.rejects(action(()=>{if(++checks===3)throw new Error('E2EE_ACCOUNT_CHANGED');}),/E2EE_ACCOUNT_CHANGED/);
 }
});
