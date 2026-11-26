// Synthetic native export only; this process receives PUBLIC test material.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {recoverOriginalCustodyById,ORIGINAL_CUSTODY_PURPOSE} from '../../app/e2ee/original-custody.ts';
import {decodeE2eeBytes} from '../../app/e2ee/envelope.ts';
import {openBundle} from '../../app/e2ee/keys.ts';
const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const input=argument('input'),output=argument('output');if(!input||!output)throw new Error('Use explicit --input and --output paths');
const raw=readFileSync(input);if(raw.length>512*1024)throw new Error('Synthetic vector limit');const vector=JSON.parse(raw);
assert.equal(vector.synthetic,true);assert.match(vector.warning,/PUBLIC TEST RECOVERY MATERIAL/);assert.match(vector.producer,/JCA API(26|34)/);
const secret=decodeE2eeBytes(vector.secret,32),records={get:async key=>{const row=vector.records.find(row=>row.key===key);return row?{serial:row.serial,envelope:row.envelope}:null;},list:async prefix=>vector.records.map(row=>row.key).filter(key=>key.startsWith(prefix))};
const storage={get:async()=>vector.artifact,describe:async()=>vector.reference};
const before=JSON.stringify(vector.records);let reader;
try{
 reader=await recoverOriginalCustodyById({ownerId:vector.ownerId,primaryPin:vector.primaryPin,recoveryKit:vector.recoveryKit,secret,id:vector.reference.id,storage,records,assertCurrent:()=>{}});
 assert.deepEqual(Object.keys(reader).sort(),['close','openLegacy','openStage','reference']);const stage=await reader.openStage(vector.target,vector.stageReference),proofs=[];
 try{assert.deepEqual(stage.paths,vector.paths.map(row=>row.id));for(const path of vector.paths){
  const expected=decodeE2eeBytes(path.plaintext,0,65536),source=stage.openPath(path.id),hash=createHash('sha256');let size=0;
  try{for await(const bytes of source.chunks){assert.deepEqual(bytes,expected.subarray(size,size+bytes.length));hash.update(bytes);size+=bytes.length;}source.assertComplete();assert.equal(size,expected.length);proofs.push({id:path.id,bytes:size,sha256:hash.digest('hex')});}finally{expected.fill(0);}
 }}finally{stage.close();}
 const clear=await openBundle(vector.ownerId,ORIGINAL_CUSTODY_PURPOSE,secret,vector.artifact.bundle);
 try{const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(clear));assert.deepEqual(Object.keys(payload).sort(),['certificate','protocol','root']);assert.ok(!new TextDecoder().decode(clear).includes('signingPrivate'));}
 finally{clear.fill(0);}
 assert.equal(JSON.stringify(vector.records),before);
 const report={at:new Date().toISOString(),status:'PASS_METADATA_AND_STAGED_ORIGINAL_INTEROP',synthetic:true,producer:vector.producer,vectorSha256:createHash('sha256').update(raw).digest('hex'),
  ownerCertificateVerified:true,recoveredWithoutRememberedReference:true,oldPrivateDeviceKeysImported:false,sourceCiphertextUnchanged:true,paths:proofs,
  limits:'Synthetic component: not whole-account recovery, nested legacy materialization, product enrollment or release acceptance.'};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,producer:report.producer,paths:proofs.length}));
}finally{reader?.close();secret.fill(0);}
