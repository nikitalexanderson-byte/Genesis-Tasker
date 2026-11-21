import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateStreamedPlanningOwnership} from '../../app/e2ee/migration-ownership.ts';
import {canonicalE2eeValue,verifyE2eeCommand} from '../../app/e2ee/commands.ts';
const argument=process.argv.find(value=>value.startsWith('--artifact='));
if(!argument)throw new Error('Pass the fresh, runner-bound --artifact= path');
const value=JSON.parse(readFileSync(argument.slice('--artifact='.length),'utf8'));
if(value.synthetic!==true||value.metadataOnly!==true||value.warning!=='Generated fixture; no product recovery or activation proof')throw new Error('Synthetic fixture marker missing');
const ownership=validateStreamedPlanningOwnership(value.ownership,value.expected);
if(ownership.protocol!==2||ownership.originals.length!==11)throw new Error('Fresh native complete ownership inventory missing');
const canonical=canonicalE2eeValue(ownership);
try{if(createHash('sha256').update(canonical).digest('base64url')!==value.ownershipCanonicalHash)throw new Error('Native/web canonical ownership hash mismatch');}finally{canonical.fill(0);}
const signer=await crypto.subtle.importKey('spki',Buffer.from(ownership.signer,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']),actions=new Set();
const block=Buffer.alloc(65536,97);
for(const[index,original]of ownership.originals.entries()){
 const command=await verifyE2eeCommand(original.packet,signer);actions.add(command.action);
 const digest=createHash('sha256'),fixture=value.rawFixture,padding=index===0?fixture.largePadding:fixture.smallPadding;
 if(padding!==(index===0?512*1024+7:17)||fixture.checkpointHash!==value.expected.checkpointHash||fixture.directoryRevision!==value.expected.directoryRevision)throw new Error('Generated raw fixture binding changed');
 const prefix=Buffer.from('\ufeff {\r\n"checkpointHash":"'+fixture.checkpointHash+'","directoryRevision":'+fixture.directoryRevision+',"rows":[],"private":"SYNTHETIC ORIGINAL α😀'),suffix=Buffer.from('"}\r\n');
 digest.update(prefix);for(let at=0;at<padding;at+=block.length)digest.update(block.subarray(0,Math.min(block.length,padding-at)));digest.update(suffix);
 const ref=original.completion;
 if(!ref||ref.id!==original.registration.id||ref.size!==prefix.length+padding+suffix.length||ref.rawHash!==digest.digest('base64url'))throw new Error('Native complete original does not match independently generated host bytes');
}
if(actions.size!==10)throw new Error('Not all ten legacy request roles were captured');
console.log(JSON.stringify({status:'PASS_SYNTHETIC_METADATA_AND_BYTE_HASH_INTEROP',originals:11,actions:10,canonicalOwnership:true,allRequestSignatures:true,boundedHostRawHashes:true,
 limitation:'Use the native runner report to bind fresh source/APKs/artifact hash. No product recovery, real TLS/backend or activation proof.'}));
