// Public synthetic keys/data only. Generate once; never use for customer data.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ProtectedMigrationContentPlan,openMigrationContentPlan} from '../../app/e2ee/content-plan.ts';
import {UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {E2EE_SUITE,encodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';
import {freshSecret,generateDeviceKeys} from '../../app/e2ee/keys.ts';
import {requiredPrivatePaths} from '../../app/e2ee/migration-sources.ts';
class Memory {
 rows=new Map();
 async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return[...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){if(signal?.aborted)throw new Error('SYNTHETIC_LOCKED');for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);for(const row of changes)if(row.value===null)this.rows.delete(row.key);else this.rows.set(row.key,structuredClone(row.value));}
}
const root=resolve(import.meta.dirname,'../..'),storage=new Memory(),localRaw=freshSecret(),contentRaw=freshSecret(),keys=await generateDeviceKeys(),localRoot=await importE2eeRoot(localRaw),contentRoot=await importE2eeRoot(contentRaw);
const actor={ownerId:'plan-actor',scopeId:'device:plan-source',deviceId:'plan-device'},localKeyId='plan-local-root';
const vault=new UnlockedE2eeVault(storage,{...actor,generation:1,cryptoEpoch:1,securityEpoch:1,keyId:localKeyId,signingKey:keys.signing.privateKey,roots:new Map([[localKeyId,localRoot]]),trustedSigner:id=>id===actor.deviceId?keys.signing.publicKey:undefined});
const context={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:'content-owner',scopeId:'personal:content-plan',domain:'workspace',objectId:'plan-context',schemaVersion:1,dataGeneration:2,
 writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'content-root',deviceId:actor.deviceId,operationId:crypto.randomUUID()};
const options={vault,root:contentRoot,signer:keys.signing.publicKey,signingKey:keys.signing.privateKey,context,target:{ownerId:context.ownerId,scopeId:context.scopeId,kind:'personal'},migrationId:crypto.randomUUID(),
 sourceHash:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array([7])))),paths:requiredPrivatePaths('personal').map(path=>path.id),capacity:{maximumBytes:1024*1024,maximumEnvelopes:32,maximumLocalParts:16},
 admit:async()=>{},ensureDurableKeys:async()=>{},assertCurrent:()=>{},assertSourceComplete:async()=>{}};
try{
 const stage=await ProtectedMigrationContentPlan.create(options);
 for(const[id,bytes,placement]of [['vector-file',new Uint8Array([1,2,3]),'remote'],['empty-file',new Uint8Array(),'remote'],['local-value',new Uint8Array([9,8,7]),'local']]){
  try{await stage.append(placement==='remote'?'personal.workspace':'personal.local-work',{placement,domain:'workspace',objectId:id,size:bytes.length,source:(async function*(){if(bytes.length)yield bytes;})(),
   filename:id==='vector-file'?'\ufeff\ud800-\udfff-α':'',mediaType:id==='vector-file'?'application/octet-stream':'application/json'});}finally{bytes.fill(0);}
 }
 const reference=await stage.finish(options.paths.map(domain=>({domain,complete:true}))),opened=await openMigrationContentPlan({...options,reference});assert.equal(opened.logical.length,2);assert.equal(opened.local.length,1);
 const vector={synthetic:true,warning:'PUBLIC TEST KEYS; DO NOT USE FOR USER DATA',producer:'Node/WebCrypto content plan',actor,localKeyId,localRootKey:encodeE2eeBytes(localRaw),contentRootKey:encodeE2eeBytes(contentRaw),
  publicKeySpki:encodeE2eeBytes(new Uint8Array(await crypto.subtle.exportKey('spki',keys.signing.publicKey))),context,target:options.target,migrationId:options.migrationId,sourceHash:options.sourceHash,paths:options.paths,reference,
  records:[...storage.rows].map(([key,row])=>({key,...row}))};
 const output=resolve(root,'tests/fixtures/e2ee/content-plan-web-v1.json');await writeFile(output,JSON.stringify(vector,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({synthetic:true,records:vector.records.length,logical:opened.logical.length,local:opened.local.length,privateKeysExported:false,output:'tests/fixtures/e2ee/content-plan-web-v1.json'}));
}finally{vault.lock();localRaw.fill(0);contentRaw.fill(0);}
