import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Independent, deterministic legacy schema1 vectors. All keys are public
 * synthetic fixture material. Each encryption has its own fixed nonce. */
export async function backupPortabilityVectors(){
 const secret=Uint8Array.from({length:32},(_,index)=>index+3),wrap=await crypto.subtle.importKey('raw',secret,'AES-KW',false,['wrapKey']);
 let dataKey,wrappedKey;
 for(let seed=0;seed<256;seed++){
  dataKey=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(seed),{name:'AES-GCM'},true,['encrypt']);
  wrappedKey=Buffer.from(await crypto.subtle.wrapKey('raw',dataKey,wrap,'AES-KW')).toString('base64');
  if(wrappedKey.includes('/'))break;
 }
 assert(wrappedKey.includes('/'));
 const payload={schema:1,backupId:'9c7ad786-8f3c-4f83-8bac-2d1b2c6e9856',source:'device_snapshot',ownerId:'portable-backup-qa',createdAt:'2026-11-20T03:00:00Z',client:'android',billingEvidence:null,
  sections:[{id:'workspace',source:'device',completeness:'available',capturedAt:'2026-11-20T03:00:00Z',revision:1,count:1,pending:0,notices:[],data:{document:{tasks:[{id:'portable-task',title:'Portable synthetic note α Ω'}]}}}]};
 const header={format:'genesisbackup',schema:1,backupId:payload.backupId,algorithm:'A256GCM+A256KW',wrappedKey};
 const canonicalAad=JSON.stringify([header.format,header.schema,header.backupId,header.algorithm,header.wrappedKey]),androidLegacyAad=canonicalAad.replaceAll('/','\\/');
 assert.notEqual(canonicalAad,androidLegacyAad);
 const files={};
 for(const [index,name,aad] of [[0,'canonical',canonicalAad],[1,'androidLegacy',androidLegacyAad]]){
  const iv=Uint8Array.from({length:12},(_,offset)=>index*16+offset),ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},dataKey,new TextEncoder().encode(JSON.stringify(payload))));
  files[name]={...header,iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64'),sha256:Buffer.from(await crypto.subtle.digest('SHA-256',ciphertext)).toString('hex')};
  ciphertext.fill(0);
 }
 return{synthetic:true,protocol:1,recoveryKey:Buffer.from(secret).toString('base64'),canonicalAad,androidLegacyAad,payload,files};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(import.meta.dirname,'../..'),target=resolve(root,process.argv[2]??'');
 assert(target===resolve(root,'tests/fixtures/backup-portability-v1.json')||target.startsWith(resolve(root,'output/release-3.3.6/runtime')+sep)&&target.endsWith('.json'),'Owned fixture output required');
 const bytes=JSON.stringify(await backupPortabilityVectors(),null,2)+'\n';
 const previous=await readFile(target,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});assert(previous===null||previous===bytes,'Existing fixture differs');
 if(previous===null)await writeFile(target,bytes);console.log(JSON.stringify({synthetic:true,output:target}));
}
