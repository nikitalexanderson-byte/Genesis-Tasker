// PUBLIC synthetic interoperability material. Never use these keys for real data.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ProtectedSourceStage} from '../../app/e2ee/source-stage.ts';
import {UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {decodeE2eeBytes,encodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';

const output=process.argv[2];if(!output)throw new Error('Supply an explicit synthetic output path');
const original=JSON.parse(readFileSync(new URL('../../tests/fixtures/e2ee/v1.json',import.meta.url),'utf8'));
const signingKey=await crypto.subtle.importKey('pkcs8',decodeE2eeBytes(original.privateKeyPkcs8,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
const publicKey=await crypto.subtle.importKey('spki',decodeE2eeBytes(original.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
const root=await importE2eeRoot(decodeE2eeBytes(original.rootKey,32)),records=new Map();
const storage={get:async key=>structuredClone(records.get(key)??null),list:async prefix=>[...records.keys()].filter(key=>key.startsWith(prefix)),commit:async(changes,signal)=>{
 if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');for(const row of changes)if((records.get(row.key)?.serial??null)!==row.expected)throw new Error('E2EE_LOCAL_CONFLICT');
 for(const row of changes)records.set(row.key,structuredClone(row.value));
}};
const scope={ownerId:'synthetic-stage-actor',scopeId:'device:synthetic-stage',deviceId:'fixture-stage-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'public-synthetic-stage-root'};
const vault=new UnlockedE2eeVault(storage,{...scope,signingKey,roots:new Map([[scope.keyId,root]]),trustedSigner:id=>id===scope.deviceId?publicKey:undefined});
const target={ownerId:'different-content-owner',scopeId:'project:interop-source',kind:'project'};
const options={vault,target,paths:['project.content','project.local-work'],capacity:{maximumBytes:1024*1024,maximumParts:4},ensureDurableKeys:async()=>{},assertCurrent:()=>vault.assertUnlocked(),admit:async()=>{}};
const partial=await ProtectedSourceStage.create(options);
await partial.capturePath(options.paths[0],write=>write(new TextEncoder().encode('PUBLIC INCOMPLETE WHOLE-SCOPE ATTEMPT')));
const input=[new TextEncoder().encode('PUBLIC SYNTHETIC SOURCE {"duplicate":1,"duplicate":2}\r\n'),Uint8Array.of(0,255,216,0,34,92,13,10)];
const stage=await ProtectedSourceStage.create(options);for(const [index,id]of options.paths.entries())await stage.capturePath(id,write=>write(input[index]));const reference=await stage.finish();
const fixture={synthetic:true,warning:'PUBLIC TEST KEYS; DO NOT USE FOR USER DATA',producer:'Node WebCrypto',scope,rootKey:original.rootKey,publicKeySpki:original.publicKeySpki,privateKeyPkcs8:original.privateKeyPkcs8,target,reference,
 historyStages:2,expectedPaths:options.paths.map((id,index)=>({id,bytes:encodeE2eeBytes(input[index])})),records:[...records].sort(([left],[right])=>left.localeCompare(right)).map(([key,row])=>({key,...row}))};
writeFileSync(resolve(output),JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});vault.lock();input.forEach(bytes=>bytes.fill(0));
console.log(JSON.stringify({synthetic:true,records:records.size,output:resolve(output)}));
