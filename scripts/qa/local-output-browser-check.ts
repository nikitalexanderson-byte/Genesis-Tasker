import {E2eeMigration,type MigrationSources,type MigrationTransport} from '../../app/e2ee/migration';
import {createRecoveryKit,freshSecret,openRoot,publicDeviceKeys,recoverAuthority,sealRoot} from '../../app/e2ee/keys';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash,type E2eeCommand,type WireValue} from '../../app/e2ee/commands';
import {verifyDeviceDirectory,type VerifiedDirectory} from '../../app/e2ee/directory';
import {encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope,openE2eeEnvelope,E2EE_SUITE,type E2eeContext} from '../../app/e2ee/envelope';
import {objectManifestHash} from '../../app/e2ee/files';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage';
import {IndexedDbDeviceKeyStorage,UnlockedWebDevice} from '../../app/e2ee/device-vault';

const report:{synthetic:true;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string;diagnostic?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
function check(name:string,passed:boolean){report.checks.push({name,passed});if(!passed)throw new Error('BROWSER_LOCAL_OUTPUT_CHECK_FAILED');}
const owner='browser-local-output-'+crypto.randomUUID(),scopeId='personal:'+owner,encoder=new TextEncoder();
let device:UnlockedWebDevice|undefined,recovery:Awaited<ReturnType<typeof createRecoveryKit>>|undefined,payload:Uint8Array|undefined;
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 recovery=await createRecoveryKit(owner);const kit=recovery,storage=new IndexedDbE2eeStorage();
 device=await UnlockedWebDevice.provision(owner,kit.secret,kit.kit,storage,new IndexedDbDeviceKeyStorage());
 const publicKeys=await publicDeviceKeys(device.keys()),rawRoot=freshSecret(),root=await importE2eeRoot(rawRoot),deviceId=device.deviceId;
 const recipient={ownerId:owner,scopeId,cryptoEpoch:1,keyId:'synthetic-new-root',recipientId:deviceId};
 const bootstrap:E2eeCommand={protocol:1,ownerId:owner,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{
  kind:'personal',resourceId:owner,keyId:recipient.keyId,generation:1,recoveryKit:kit.kit,deviceKeys:publicKeys,
  deviceCapsule:await sealRoot(rawRoot,publicKeys.receivingKey,recipient),recoveryCapsule:await sealRoot(rawRoot,kit.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
 rawRoot.fill(0);bootstrap.payload.selfProof=(await signE2eeCommand(bootstrap,device.keys().signing.privateKey)).signature;
 const events=[await signE2eeCommand(bootstrap,kit.keys.signing.privateKey)];let directory:VerifiedDirectory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);
 const canary='Synthetic local-only plaintext '+crypto.randomUUID(),filename='Synthetic private local filename.txt';payload=new Uint8Array(3*256*1024+17).fill(71);payload.set(encoder.encode(canary));const original=payload;
 let captures=0,reconciliations=0,sourceReads=0,recoveryChecks=0,puts=0,interrupted=false,state='legacy';const packets:unknown[]=[],receipts=new Map<string,{hash:string;result:Record<string,WireValue>}>();
 const transport:MigrationTransport={
  async sourceHash(){device!.requireOpen();sourceReads++;check('source read follows the durable protected snapshot',(await storage.list('')).length>0);return 'A'.repeat(43);},
  async readAll(){return[];},
  async command(packet){
   device!.requireOpen();const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);packets.push(packet);
   check('signed packet binds the current owner scope and device',command.ownerId===owner&&command.scopeId===scopeId&&command.deviceId===deviceId);
   const hash=await e2eeCommandHash(command),prior=receipts.get(command.operationId);if(prior){check('ambiguous commit replays the exact durable packet',prior.hash===hash);return prior.result;}
   let result:Record<string,WireValue>;
   if(command.action==='migration-start'){state='uploading';result={fence:1,leaseUntil:2_000_000_000,generation:2};}
   else if(command.action==='put'){puts++;throw new Error('BROWSER_PRIVATE_UPLOAD_ATTEMPT');}
   else if(command.action==='migration-verify'){
    check('cloud manifest is empty for local-only content',command.payload.objectCount===0&&command.payload.manifestHash===await objectManifestHash([]));state='verified';result={state,manifestHash:command.payload.manifestHash};
   }else if(command.action==='migration-commit'){
    check('independent saved recovery is checked before commit',recoveryChecks>0);events.push(packet);directory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);state='active';
    result={state,directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash};
   }else throw new Error('BROWSER_UNEXPECTED_MIGRATION_ACTION');
   receipts.set(command.operationId,{hash,result});
   if(command.action==='migration-commit'&&!interrupted){interrupted=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
   return result;
  },
 };
 const sources:MigrationSources={requiredCoverage:['synthetic.device-only'],allowedContentDomains:['diary'],
  async captureLocal(){captures++;return original.slice();},
  async reconcile(snapshot){reconciliations++;check('complete local source survives protected readback',snapshot.length===original.length&&new TextDecoder().decode(snapshot.subarray(0,encoder.encode(canary).length))===canary);
   return{coverage:[{domain:'synthetic.device-only',complete:true}],content:[],localContent:[{domain:'diary',objectId:'device-private-note',bytes:original.slice(),filename,mediaType:'text/plain'}]};},
 };
 const make=()=>new E2eeMigration({vault:device!.vault,directory,deviceId,signingKey:device!.keys().signing.privateKey,signer:device!.keys().signing.publicKey,root,transport,sources,
  ensureDurableKeys:()=>device!.ensureDurableKeys(),withLocalWriteFence:async operation=>operation(),
  verifyRecovery:async candidate=>{
   const authority=await recoverAuthority(owner,kit.secret,kit.kit),restored=await openRoot(directory.recoveryCapsule,authority.receiving.privateKey,{...recipient,recipientId:'recovery'});
   const probe=freshSecret();let opened:Uint8Array|undefined;
   const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:owner,scopeId,domain:'key-check',objectId:'recovery-probe',schemaVersion:1,dataGeneration:2,
    writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:recipient.keyId,deviceId,operationId:crypto.randomUUID()};
   try{const envelope=await sealE2eeEnvelope(candidate,device!.keys().signing.privateKey,context,probe);opened=await openE2eeEnvelope(restored,device!.keys().signing.publicKey,context,envelope);
    check('saved recovery authority unwraps the independent scope root',opened.every((byte,index)=>byte===probe[index]));recoveryChecks++;
   }finally{probe.fill(0);opened?.fill(0);}
  }});
 const migration=make();await migration.prepare();check('prepare performs no private network read',sourceReads===0&&packets.length===0);
 let failed=false;try{await migration.run();}catch(error){failed=error instanceof Error&&error.message==='SYNTHETIC_PROCESS_DEATH';if(!failed)throw error;}
 check('ambiguous commit retains a pending local journal',failed&&state==='active'&&(await migration.status())?.pending?.command.action==='migration-commit');
 check('restart completes without repeating capture or reconciliation',await make().run()==='active'&&captures===1&&reconciliations===1);
 const status=await make().status();check('device-only plan has zero upload objects and multiple local chunks',status?.plan.length===0&&status.local?.[0].parts===4&&puts===0);
 const wire=JSON.stringify(packets);check('network packets exclude local IDs filenames content and plaintext hashes',![canary,filename,'device-private-note',status!.local![0].plaintextHash,encodeE2eeBytes(kit.secret)].some(value=>wire.includes(value)));
 const disk=JSON.stringify(await Promise.all((await storage.list('')).map(key=>storage.get(key))));
 check('IndexedDB stores no local content filename or recovery secret',![canary,filename,encodeE2eeBytes(kit.secret)].some(value=>disk.includes(value)));
 device.lock();let locked=false;try{await migration.readLocal('diary','device-private-note');}catch{locked=true;}check('locked vault refuses local content',locked);
 device=await UnlockedWebDevice.unlock(owner,kit.secret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
 const opened=await make().readLocal('diary','device-private-note');try{check('fresh recovered device-vault connection reads exact local multipart bytes',!!opened&&opened.filename===filename&&opened.bytes.length===original.length&&opened.bytes.every((byte,index)=>byte===original[index]));}finally{opened?.bytes.fill(0);}
 check('normal local read cannot fetch or upload a provider copy',puts===0&&sourceReads===1&&reconciliations===1);
}catch(error){report.error=error instanceof Error&&/^E2EE_[A-Z_]+$/.test(error.message)?error.message:'BROWSER_LOCAL_OUTPUT_ACCEPTANCE_FAILED';
 if(error instanceof Error)report.diagnostic=(error.stack??error.name).split('\n').slice(0,4).join('\n').replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g,'[REDACTED]');}
finally{device?.lock();recovery?.secret.fill(0);payload?.fill(0);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS local-only migration';
