// Consume PUBLIC synthetic native/web vectors only. Never opens user devices or keys.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {openSourceStage,inspectSourceStages} from '../../app/e2ee/source-stage.ts';
import {decodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';

const [input,output]=process.argv.slice(2);if(!input||!output)throw new Error('Supply explicit synthetic input and report paths');
const raw=readFileSync(input),fixture=JSON.parse(raw);assert.equal(fixture.synthetic,true);assert.equal(fixture.warning,'PUBLIC TEST KEYS; DO NOT USE FOR USER DATA');
const rows=new Map(fixture.records.map(row=>[row.key,{serial:row.serial,envelope:row.envelope}]));assert.equal(rows.size,fixture.records.length);
const storage={get:async key=>structuredClone(rows.get(key)??null),list:async prefix=>[...rows.keys()].filter(key=>key.startsWith(prefix)),commit:async()=>{throw new Error('SYNTHETIC_READ_ONLY');}};
const signingKey=await crypto.subtle.importKey('pkcs8',decodeE2eeBytes(fixture.privateKeyPkcs8,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
const publicKey=await crypto.subtle.importKey('spki',decodeE2eeBytes(fixture.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
const root=await importE2eeRoot(decodeE2eeBytes(fixture.rootKey,32));
const vault=new UnlockedE2eeVault(storage,{...fixture.scope,signingKey,roots:new Map([[fixture.scope.keyId,root]]),trustedSigner:id=>id===fixture.scope.deviceId?publicKey:undefined});
const check=()=>vault.assertUnlocked(),history=await inspectSourceStages(vault,fixture.target,check);assert.equal(history.length,fixture.historyStages);
const opened=await openSourceStage(vault,fixture.target,fixture.reference,check);assert.deepEqual(opened.paths,fixture.expectedPaths.map(row=>row.id));let bytes=0;
for(const row of fixture.expectedPaths){
 const expected=decodeE2eeBytes(row.bytes,1,1024*1024),reader=opened.openPath(row.id);let at=0;
 try{for await(const chunk of reader.chunks){assert.deepEqual(chunk,expected.subarray(at,at+chunk.length));at+=chunk.length;}reader.assertComplete();assert.equal(at,expected.length);bytes+=at;}finally{expected.fill(0);}
}
await assert.rejects(openSourceStage(vault,{...fixture.target,ownerId:'foreign-owner'},fixture.reference,check),/E2EE_/);vault.lock();
const report={synthetic:true,status:'PASS',producer:fixture.producer,consumer:'Node WebCrypto',fixtureSha256:createHash('sha256').update(raw).digest('hex'),records:rows.size,historyStages:history.length,paths:opened.paths.length,bytes};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
