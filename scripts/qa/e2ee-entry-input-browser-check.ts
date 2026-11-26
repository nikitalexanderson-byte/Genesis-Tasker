import {createRecoveryKit,freshSecret,generateDeviceKeys,publicDeviceKeys,sealRoot,type RecoveryKit} from '../../app/e2ee/keys.ts';
import {encodeE2eeBytes} from '../../app/e2ee/envelope.ts';
import {signE2eeCommand,type E2eeCommand,type WireValue,type SignedE2eeCommand} from '../../app/e2ee/commands.ts';
import {verifyDeviceDirectory} from '../../app/e2ee/directory.ts';
import {objectManifestHash} from '../../app/e2ee/files.ts';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from '../../app/e2ee/device-vault.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {ComparedPersonalDeviceTarget,personalDeviceTargetFingerprint} from '../../app/e2ee/personal-device-target.ts';
import {WebPersonalDeviceEntry,type PersonalDeviceEntryPorts} from '../../app/e2ee/personal-device-entry.ts';
import {WebPrivateAccount,type PrivateAccountTransport} from '../../app/e2ee/product-session.ts';
import type {DeviceAccessTarget} from '../../app/e2ee/device-access-contract.ts';

const report:{synthetic:true;checks:{name:string;passed:boolean;error?:string}[];inputs?:unknown;status?:string}={synthetic:true,checks:[]};
const requireValue=(value:unknown,code:string)=>{if(!value)throw new Error(code);};
async function test(name:string,run:()=>Promise<void>){try{await run();report.checks.push({name,passed:true});}catch(error){const code=error instanceof Error&&/^(?:E2EE|SYNTHETIC)_[A-Z_]+$/.test(error.message)?error.message:'SYNTHETIC_CHECK_FAILED';report.checks.push({name,passed:false,error:code});}}
async function rig(local:boolean){
 const owner='entry-audit-'+crypto.randomUUID(),scopeId='personal:'+owner,recovery=await createRecoveryKit(owner),storage=new IndexedDbE2eeStorage(),keys=new IndexedDbDeviceKeyStorage();
 const device=local?await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,storage,keys):null;
 const signing=device?.keys()??await generateDeviceKeys(),deviceId=device?.deviceId??crypto.randomUUID(),pub=await publicDeviceKeys(signing),raw=freshSecret(),keyId='entry-audit-root';
 const recipient={ownerId:owner,scopeId,cryptoEpoch:1,keyId,recipientId:deviceId};
 const payload={kind:'personal',resourceId:owner,keyId,generation:1,recoveryKit:recovery.kit,deviceKeys:pub,
  deviceCapsule:await sealRoot(raw,pub.receivingKey,recipient),recoveryCapsule:await sealRoot(raw,recovery.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})} as unknown as Record<string,WireValue>;
 raw.fill(0);
 const bootstrap:E2eeCommand={protocol:1,ownerId:owner,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload};
 payload.selfProof=(await signE2eeCommand(bootstrap,signing.signing.privateKey)).signature;
 const events:SignedE2eeCommand[]=[await signE2eeCommand(bootstrap,recovery.keys.signing.privateKey)];
 let directory=await verifyDeviceDirectory(owner,scopeId,recovery.kit.authority,events);
 async function append(action:string,value:Record<string,WireValue>,asRecovery=false){
  const command:E2eeCommand={protocol:1,ownerId:owner,scopeId,deviceId:asRecovery?'recovery':deviceId,action,expectedRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash,securityEpoch:directory.securityEpoch,operationId:crypto.randomUUID(),payload:value};
  events.push(await signE2eeCommand(command,asRecovery?recovery.keys.signing.privateKey:signing.signing.privateKey));directory=await verifyDeviceDirectory(owner,scopeId,recovery.kit.authority,events);
 }
 await append('migration-commit',{generation:1,migrationId:'entry-audit-migration',fence:1,manifestHash:await objectManifestHash([]),objectCount:0,verifiedCheckpoint:encodeE2eeBytes(freshSecret())});
 if(device){await device.rememberDirectory(scopeId,recovery.kit.authority,events);device.lock();}
 const target:DeviceAccessTarget={ownerId:owner,scopeId,kind:'personal',resourceId:owner,authority:structuredClone(recovery.kit.authority)};
 const compared=ComparedPersonalDeviceTarget.compare(target,personalDeviceTargetFingerprint(target),owner);
 async function revoke(){const next=freshSecret();try{await append('rotate',{revokedDeviceIds:[deviceId],cryptoEpoch:2,securityEpoch:2,keyId:'entry-next-root',retiredManifestHash:await objectManifestHash([]),retiredObjectCount:0,capsules:[],recoveryCapsule:await sealRoot(next,recovery.kit.authority.receivingKey,{ownerId:owner,scopeId,cryptoEpoch:2,keyId:'entry-next-root',recipientId:'recovery'})} as unknown as Record<string,WireValue>,true);}finally{next.fill(0);}}
 return{owner,scopeId,recovery,storage,keys,compared,events,revoke,deviceId};
}

await test('candidate entry retains its local secret before directory I/O',async()=>{
 const f=await rig(false),supplied=freshSecret(),expected=new Uint8Array(supplied);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const ports={transport:{directory:async()=>{await gate;return{events:structuredClone(f.events)};}}} as unknown as PersonalDeviceEntryPorts;
 let entry:WebPersonalDeviceEntry|undefined;
 try{const pending=WebPersonalDeviceEntry.begin(f.compared,supplied,ports,()=>{});supplied.fill(0);release();entry=await pending;entry.close();const reopened=await UnlockedWebDevice.unlock(f.owner,expected,f.storage,f.keys);reopened.lock();}
 finally{entry?.close();supplied.fill(0);expected.fill(0);f.recovery.secret.fill(0);}
});

await test('revoked replacement retains the requested new secret before old-vault I/O',async()=>{
 const f=await rig(true);await f.revoke();const supplied=freshSecret(),expected=new Uint8Array(supplied),before=JSON.stringify((await f.keys.history(f.owner))[0]);let replacement:UnlockedWebDevice|undefined;
 try{const pending=UnlockedWebDevice.replaceRevoked(f.compared,f.recovery.secret,supplied,f.events,f.storage,f.keys,()=>{});supplied.fill(0);replacement=await pending;replacement.lock();
  const reopened=await UnlockedWebDevice.unlock(f.owner,expected,f.storage,f.keys);reopened.lock();requireValue(JSON.stringify((await f.keys.history(f.owner))[0])===before,'SYNTHETIC_ORIGINAL_CHANGED');}
 finally{replacement?.lock();supplied.fill(0);expected.fill(0);f.recovery.secret.fill(0);}
});

await test('revoked replacement retains exact signed history before old-vault I/O',async()=>{
 const f=await rig(true);await f.revoke();const supplied=freshSecret(),events=structuredClone(f.events);let replacement:UnlockedWebDevice|undefined;
 try{const pending=UnlockedWebDevice.replaceRevoked(f.compared,f.recovery.secret,supplied,events,f.storage,f.keys,()=>{});events[0].signature='invalid';replacement=await pending;replacement.lock();const reopened=await UnlockedWebDevice.unlock(f.owner,supplied,f.storage,f.keys);reopened.lock();}
 finally{replacement?.lock();supplied.fill(0);f.recovery.secret.fill(0);}
});

await test('account recovery retains the saved kit before status I/O',async()=>{
 const f=await rig(false),kit=structuredClone(f.recovery.kit);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const transport={status:async()=>{await gate;return{pilotAllowed:false,cryptoProtocol:1,scopes:[{scopeId:f.scopeId,kind:'personal',resourceId:f.owner,state:'active'}]};},directory:async()=>{throw new Error('SYNTHETIC_ENROLLMENT_STOP');}} as unknown as PrivateAccountTransport;
 try{const pending=WebPrivateAccount.open(f.owner,f.recovery.secret,transport,()=>{},kit as RecoveryKit);kit.protectedKeys.ciphertext='invalid';release();await pending.then(account=>account.close(),()=>undefined);
  const reopened=await UnlockedWebDevice.unlock(f.owner,f.recovery.secret,f.storage,f.keys);requireValue(reopened.authorityPin.signingKey===f.recovery.kit.authority.signingKey,'SYNTHETIC_AUTHORITY_CHANGED');reopened.lock();}
 finally{f.recovery.secret.fill(0);}
});

const inputs=await(await fetch('/inputs.json')).json();report.inputs=inputs.inputs;
await test('the tested entry inputs remain unchanged',async()=>requireValue(inputs.unchanged===true,'SYNTHETIC_INPUT_CHANGED'));
report.status=report.checks.every(row=>row.passed)?'PASS':'FAIL';
document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS entry input audit';
