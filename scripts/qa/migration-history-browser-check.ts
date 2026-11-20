import {sha256} from '@noble/hashes/sha2.js';
import {E2eeMigration} from '../../app/e2ee/migration.ts';
import {E2eeMigrationSources,requiredPrivatePaths} from '../../app/e2ee/migration-sources.ts';
import {ProtectedSourceStage} from '../../app/e2ee/source-stage.ts';
import {IndexedDbE2eeStorage,UnlockedE2eeVault,type E2eeRecordStorage} from '../../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys,createRecoveryKit,publicDeviceKeys,sealRoot} from '../../app/e2ee/keys.ts';
import {importE2eeRoot,encodeE2eeBytes} from '../../app/e2ee/envelope.ts';
import {signE2eeCommand} from '../../app/e2ee/commands.ts';
import {verifyDeviceDirectory} from '../../app/e2ee/directory.ts';
import type {StagedSourceInput} from '../../app/e2ee/staged-reconciliation.ts';
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];observed?:unknown;status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const show=(stage:string)=>{document.querySelector('#result')!.textContent=JSON.stringify({...report,status:'RUNNING',stage},null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show(name);if(!passed)throw new Error(name);};
const refuses=async(body:()=>unknown|Promise<unknown>)=>{try{await body();return false;}catch(error){return error instanceof Error&&error.message.startsWith('E2EE_');}};
const encoder=new TextEncoder(),firstSize=1024*1024+7;
function value(index:number,seed:number,size=index?3:firstSize){return Uint8Array.from({length:size},(_,at)=>(at*31+index*17+seed)&255);}
try{
 check('actual secure WebCrypto and encrypted IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const ownerId='history-owner',scopeId='project:history-browser',deviceId='history-device',keys=await generateDeviceKeys(),dataRaw=freshSecret(),root=await importE2eeRoot(dataRaw),localRaw=freshSecret(),localRoot=await importE2eeRoot(localRaw);localRaw.fill(0);
 const pub=await publicDeviceKeys(keys),recovery=await createRecoveryKit(ownerId),recipient={ownerId,scopeId,cryptoEpoch:1,keyId:'project-root',recipientId:deviceId};
 const command={protocol:1 as const,ownerId,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:'bootstrap',payload:{
  kind:'project',resourceId:'history-browser',keyId:'project-root',generation:1,recoveryKit:recovery.kit,deviceKeys:pub,
  deviceCapsule:await sealRoot(dataRaw,pub.receivingKey,recipient),recoveryCapsule:await sealRoot(dataRaw,recovery.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
 const packet={...command,payload:{...command.payload,selfProof:(await signE2eeCommand(command,keys.signing.privateKey)).signature}};
 const directory=await verifyDeviceDirectory(ownerId,scopeId,recovery.kit.authority,[await signE2eeCommand(packet,recovery.keys.signing.privateKey)]);dataRaw.fill(0);recovery.secret.fill(0);
 let storage:E2eeRecordStorage=new IndexedDbE2eeStorage(),live=true,network=0;
 const actor={ownerId,scopeId:'device:history-browser',deviceId,generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'local-root',signingKey:keys.signing.privateKey,roots:new Map([['local-root',localRoot]]),trustedSigner:()=>keys.signing.publicKey};
 let vault=new UnlockedE2eeVault(storage,actor);const paths=requiredPrivatePaths('project').map(row=>row.id),target={ownerId,scopeId,kind:'project' as const},sources=new E2eeMigrationSources(ownerId,scopeId,'project');
 for(const[index,id]of paths.entries())sources.register({id,async captureLocal(){return value(index,0);},async reconcile(){throw new Error('E2EE_NO_AGGREGATE_RECONCILE');}});
 const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const stageOptions={capacity:{maximumBytes:16*1024*1024,maximumParts:128},assertCurrent:current,admit:async()=>{}};
 const historyOptions=()=>({capacity:{maximumBytes:16*1024*1024,maximumParts:256,maximumMetadataBytes:4*1024*1024},assertCurrent:current,admit:async()=>{}});
 const make=()=>new E2eeMigration({vault,directory,deviceId,signingKey:keys.signing.privateKey,signer:keys.signing.publicKey,root,sources,
  transport:{async sourceHash(){network++;throw new Error('E2EE_UNEXPECTED_NETWORK');},async command(){network++;throw new Error('E2EE_UNEXPECTED_NETWORK');},async readAll(){network++;throw new Error('E2EE_NO_AGGREGATE_READ');}},
  ensureDurableKeys:async()=>{current();},withLocalWriteFence:async operation=>operation(),verifyRecovery:async()=>{throw new Error('E2EE_NO_PRODUCT_RECOVERY');}});
 const capture=(seed:number)=>({target,paths,async capturePath(id:string,write:(bytes:Uint8Array)=>Promise<void>){const index=paths.indexOf(id),size=index?3:firstSize;for(let at=0;at<size;at+=65536){
  const bytes=Uint8Array.from({length:Math.min(65536,size-at)},(_,offset)=>((at+offset)*31+index*17+seed)&255);try{await write(bytes);}finally{bytes.fill(0);}}}});
 show('prepare original legacy registry');await make().prepare();await make().cancel();
 const orphan=await ProtectedSourceStage.create({vault,target,paths,...stageOptions,ensureDurableKeys:async()=>{}}),orphanCapture=capture(17);
 for(const id of paths)await orphan.capturePath(id,write=>orphanCapture.capturePath(id,write));const orphanRef=await orphan.finish();
 await make().prepareStaged(capture(31),stageOptions);await make().cancel();await make().restartStaged(capture(47),stageOptions);
 vault.lock();storage=new IndexedDbE2eeStorage();vault=new UnlockedE2eeVault(storage,actor);const state=await make().status();
 check('cold actual coordinator retains mixed ancestors and all complete stage originals',state?.protocol===3&&state.ancestors.length===2&&state.source.history.length===2);
 const inventoryHash=async()=>{const hash=sha256.create();try{for(const key of (await storage.list('')).sort()){const row=await storage.get(key),raw=encoder.encode(JSON.stringify([key,row]));try{hash.update(raw);}finally{raw.fill(0);}}return encodeE2eeBytes(hash.digest());}finally{hash.destroy();}};
 const before=await inventoryHash(),expected=await (await fetch('/expected.json')).json() as string[][];let retained:StagedSourceInput|undefined;
 const read=async(input:StagedSourceInput)=>{
  const observed=[];for(const[sourceIndex,source]of [input.current,...input.previous].entries()){const hashes=[],sizes=[];for(const[pathIndex,path]of source.paths.entries()){
   const reader=await source.openPath(path),hash=sha256.create();let size=0,previous:Uint8Array|undefined;
   try{for await(const part of reader.chunks){if(previous&&!previous.every(value=>value===0))throw new Error('E2EE_BORROW_EXPIRED');hash.update(part);size+=part.length;previous=part;}
    reader.assertComplete();if(!previous?.every(value=>value===0)||size!==(pathIndex?3:firstSize))throw new Error('E2EE_INCOMPLETE_ORIGINAL');const digest=encodeE2eeBytes(hash.digest());if(digest!==expected[sourceIndex][pathIndex])throw new Error('E2EE_INDEPENDENT_HASH_MISMATCH');hashes.push(digest);sizes.push(size);
   }finally{hash.destroy();}
  }observed.push({sourceId:source.id,sha256:hashes,sizes});}return observed;
 };
 show('read every byte from mixed originals');const observed=await make().withStagedSourceHistory(async input=>{retained=input;return read(input);},historyOptions());report.observed=observed;
 check('all4194392 logical bytes and24 complete hashes match independent bounded host construction',observed.length===4&&observed.reduce((sum,row)=>sum+row.sizes.reduce((total,size)=>total+size,0),0)===4194392);
 check('complete orphan appears before the cancelled staged original',observed[2].sourceId==='stage:'+orphanRef.stageId);
 check('every encrypted original and coordinator record remains byte-identical',before===await inventoryHash());
 check('retained callback has no live source capability after return',await refuses(()=>retained!.current.openPath(paths[0])));
 const copyKey=(await storage.list('')).find(key=>key.includes(':cancel:'))!,originalCopy=(await storage.get(copyKey))!,copyId=originalCopy.envelope.context.objectId,copyRaw=(await vault.read('local-snapshot',copyId))!;
 const altered=JSON.parse(new TextDecoder().decode(copyRaw.value)) as {protocol:number;snapshotHash?:string;source?:{reference:{manifestHash:string}}};copyRaw.value.fill(0);
 if(altered.protocol===3)altered.source!.reference.manifestHash='A'.repeat(43);else altered.snapshotHash='A'.repeat(43);
 await storage.commit([{key:copyKey,expected:originalCopy.serial,value:null}]);const alteredBytes=encoder.encode(JSON.stringify(altered));
 try{await vault.write([{domain:'local-snapshot',objectId:copyId,value:alteredBytes,expected:null}]);}finally{alteredBytes.fill(0);}
 let invalidConsumer=false;
 try{check('a separately retained cancellation copy cannot change its authenticated original reference',await refuses(()=>make().withStagedSourceHistory(async()=>{invalidConsumer=true;},historyOptions()))&&!invalidConsumer);}
 finally{await storage.commit([{key:copyKey,expected:1,value:originalCopy}]);}
 check('restoring the owned tamper fixture leaves every original encrypted record identical',before===await inventoryHash());
 check('empty consumer cannot certify source history',await refuses(()=>make().withStagedSourceHistory(async()=>{},historyOptions())));
 check('a missed historical source cannot certify complete coverage',await refuses(()=>make().withStagedSourceHistory(input=>read({current:input.current,previous:[]}),historyOptions())));
 let borrowed:Uint8Array|undefined;
 check('caught consumer error never returns a successful prefix',await refuses(()=>make().withStagedSourceHistory(async input=>{const reader=await input.current.openPath(paths[0]);borrowed=(await reader.chunks.next()).value;throw new Error('E2EE_CONSUMER_FAILURE');},historyOptions())));
 check('closing wipes the borrowed plaintext immediately',!!borrowed&&borrowed.every(value=>value===0));
 let admitted=false,consumed=false;const refusedCapacity=historyOptions();refusedCapacity.capacity.maximumBytes=1;refusedCapacity.admit=async()=>{admitted=true;};
 check('capacity refuses before admission or consumer',await refuses(()=>make().withStagedSourceHistory(async()=>{consumed=true;},refusedCapacity))&&!admitted&&!consumed);
 check('actor retirement refuses without rewriting encrypted originals',await refuses(()=>make().withStagedSourceHistory(async()=>{live=false;},historyOptions())));live=true;
 check('closed v3 run still refuses before any network work',await refuses(()=>make().run())&&network===0);
 check('failed and cancelled read attempts leave all durable originals unchanged',before===await inventoryHash());
 report.status='PASS';vault.lock();
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.stack:String(error);}
document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);
