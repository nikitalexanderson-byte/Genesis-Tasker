import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {PhysisMigrationProvider} from '../../app/physis/migration-editors';
import {PhysisPersonalProfile} from '../../app/physis/personal-profile';
import {NumberField} from '../../app/physis/fields';
import {PhysisMemoryStore,type WireRecord} from '../../app/physis/store';
import {rememberPhysisSession,capturePhysisSessionMemory,forgetPhysisSession} from '../../app/physis/session-memory';
import {accountPhysisVault,sealPhysis,toBase64} from '../../app/physis/crypto';
import {newPhysisRecord,type PhysisSettings} from '../../app/physis/types';
import {calendarContext} from '../../app/calendar-context';
import {PersonalPhysisSource,readMigratedPhysis} from '../../app/e2ee/physis-source';
import {E2eeMigration,type MigrationSources,type MigrationTransport} from '../../app/e2ee/migration';
import {createRecoveryKit,freshSecret,openRoot,publicDeviceKeys,recoverAuthority,sealRoot} from '../../app/e2ee/keys';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash,type E2eeCommand,type WireValue} from '../../app/e2ee/commands';
import {verifyDeviceDirectory,type VerifiedDirectory} from '../../app/e2ee/directory';
import {encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope,openE2eeEnvelope,validateE2eeEnvelope,E2EE_SUITE,type E2eeEnvelope,type E2eeContext} from '../../app/e2ee/envelope';
import {envelopePayloadHash} from '../../app/e2ee/files';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage';
import {IndexedDbDeviceKeyStorage,UnlockedWebDevice} from '../../app/e2ee/device-vault';
import {E2eeScopeClient,type ScopeTransport} from '../../app/e2ee/scope-client';
import '../../app/physis/physis.css';

const report:{synthetic:true;runtime:string;checks:{name:string;passed:boolean}[];status:string;error?:string;diagnostic?:string}={synthetic:true,runtime:navigator.userAgent,checks:[],status:'STARTING'};
const update=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS Physis source';};
function check(name:string,passed:boolean){report.checks.push({name,passed});if(!passed)throw new Error('BROWSER_PHYSIS_CHECK_FAILED');}
const encoder=new TextEncoder(),decoder=new TextDecoder(),owner='browser-physis-'+crypto.randomUUID(),scopeId='personal:'+owner;
let device:UnlockedWebDevice|undefined,recovery:Awaited<ReturnType<typeof createRecoveryKit>>|undefined;
const oldKey=freshSecret(),oldAccount=await crypto.subtle.importKey('raw',new Uint8Array(oldKey),'AES-GCM',false,['encrypt']);let legacyKey=toBase64(oldKey);const originalLegacyKey=legacyKey;
const oldVault=await accountPhysisVault({seal:async(value,purpose)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`genesis-mindmap-v1:${owner}:${purpose}`)},oldAccount,encoder.encode(JSON.stringify(value)));return{iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(cipher))};},open:async()=>{throw new Error('No ordinary account opening');}});
const cloudCanary='Synthetic original server Physis '+crypto.randomUUID(),pendingCanary='Synthetic pending local Physis '+crypto.randomUUID();
const settings:PhysisSettings={calendarMode:'sacred',inputCalendarMode:'profane',timeZone:'UTC',weightUnit:'kg',distanceUnit:'km',energyUnit:'kcal',glucoseUnit:'mmol/L',restSeconds:90,reminders:false,foodRules:[],enabledMetrics:[],overviewBlocks:[]};
const original={...newPhysisRecord('settings',settings),privateOptional:{note:cloudCanary,empty:[]}},envelope=await sealPhysis(oldVault.key,owner,original.id,1,original);
const wire:WireRecord={id:original.id,revision:1,sequence:1,updatedAt:original.updatedAt,deletedAt:null,envelope};let legacyWrites=0,live=true;
const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');device?.requireOpen();};
const model=new PhysisMemoryStore(owner,oldVault.key,1,async<T,>(path:string)=>{current();if(path.startsWith('/records?'))return{records:[wire],cursor:1,minCursor:0,snapshot:1,hasMore:false}as T;legacyWrites++;throw new Error('SYNTHETIC_OFFLINE');},current);
await model.reload();rememberPhysisSession(owner,model,{vault:oldVault.vault,revision:1});

async function acceptance(){
 try{
  check('secure WebCrypto and IndexedDB are available',isSecureContext&&!!crypto.subtle&&!!indexedDB);
  const detached=await capturePhysisSessionMemory(owner),editors=detached[0].state.editors;
  const profile=editors.find(row=>(row.value as {source?:string}).source==='personal-profile.PhysisPersonalProfile')?.value as {state?:{draft?:{age?:string;weightKg?:string}}}|undefined;
  const decimal=editors.find(row=>(row.value as {source?:string;state?:{label?:string}}).source==='fields.NumberField'&&(row.value as {state?:{label?:string}}).state?.label==='Synthetic decimal input')?.value as {state?:{draft?:string}}|undefined;
  check('actual personal profile preserves typed age and unfinished decimal after unmount',profile?.state?.draft?.age==='29'&&profile.state.draft.weightKg==='71,');
  check('actual NumberField preserves invalid raw numeric input independently of its numeric parent',decimal?.state?.draft==='1,,');
  check('all captured form states are detached before migration IO',editors.length>1&&editors.every(row=>!row.mounted));
  const edited={...original,privateOptional:{...original.privateOptional,note:pendingCanary}};
  let offline=false;try{await model.getSnapshot().save(edited);}catch{offline=true;}check('a real uncertain store write remains queued',offline&&legacyWrites===1&&model.hasPending);
  recovery=await createRecoveryKit(owner);const kit=recovery,storage=new IndexedDbE2eeStorage();device=await UnlockedWebDevice.provision(owner,kit.secret,kit.kit,storage,new IndexedDbDeviceKeyStorage());
  const publicKeys=await publicDeviceKeys(device.keys()),rawRoot=freshSecret(),root=await importE2eeRoot(rawRoot),deviceId=device.deviceId;
  const recipient={ownerId:owner,scopeId,cryptoEpoch:1,keyId:'synthetic-new-physis-root',recipientId:deviceId};
  const bootstrap:E2eeCommand={protocol:1,ownerId:owner,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{
   kind:'personal',resourceId:owner,keyId:recipient.keyId,generation:1,recoveryKit:kit.kit,deviceKeys:publicKeys,deviceCapsule:await sealRoot(rawRoot,publicKeys.receivingKey,recipient),recoveryCapsule:await sealRoot(rawRoot,kit.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
  rawRoot.fill(0);bootstrap.payload.selfProof=(await signE2eeCommand(bootstrap,device.keys().signing.privateKey)).signature;
  const events=[await signE2eeCommand(bootstrap,kit.keys.signing.privateKey)];let directory:VerifiedDirectory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);
  const objects=new Map<string,E2eeEnvelope>(),receipts=new Map<string,{hash:string;result:Record<string,WireValue>}>(),packets:unknown[]=[];
  let captures=0,reconciliations=0,sourceReads=0,recoveryChecks=0,interrupted=false,state='legacy';
  const source=new PersonalPhysisSource(owner,scopeId,{assertCurrent:current,memory:async()=>({ownerId:owner,generation:0,reconciliationRequired:false,legacyKey,stores:await capturePhysisSessionMemory(owner)}),
   legacyPhysis:async context=>{sourceReads++;const state=await make().status();check('server source follows a complete new-root-protected local capture',!!state&&state.protocol!==3&&state.snapshotParts>0);
    return{protocol:1,ownerId:owner,scopeId,migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:directory.checkpoint.hash,directoryRevision:1,
     owners:[{current_cursor:1,min_cursor:0,vault_json:JSON.stringify(oldVault.vault),vault_revision:1,key_version:1}],records:[{id:wire.id,revision:1,sequence:1,envelope_json:JSON.stringify(envelope),updated_at:wire.updatedAt,deleted_at:null}],usedIds:[{id:wire.id}],receipts:[],legacyKey:{keyMode:'client',key:null}};
   },review:async conflicts=>Object.fromEntries(conflicts.map(row=>[row.id,'store:0:current']))});
  const sources:MigrationSources={requiredCoverage:['personal.physis'],allowedContentDomains:['physis'],async captureLocal(){captures++;return source.captureLocal();},async reconcile(raw,previous,context){reconciliations++;const result=await source.reconcile(raw,previous,context);return{...result,coverage:[{domain:'personal.physis',complete:result.complete}]};}};
  const transport:MigrationTransport={sourceHash:async()=>{current();return'A'.repeat(43);},readAll:async()=>[...objects.values()].map(row=>structuredClone(row)),async command(packet){
   const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);packets.push(packet);check('every signed migration packet retains owner scope and device',command.ownerId===owner&&command.scopeId===scopeId&&command.deviceId===deviceId);
   const hash=await e2eeCommandHash(command),prior=receipts.get(command.operationId);if(prior){check('unknown commit retry keeps the durable exact signed request',prior.hash===hash);return prior.result;}
   let result:Record<string,WireValue>;
   if(command.action==='migration-start'){state='uploading';result={fence:1,leaseUntil:2_000_000_000,generation:2};}
   else if(command.action==='put'){const row=validateE2eeEnvelope(command.payload.envelope);objects.set(row.context.domain+'\0'+row.context.objectId,row);result={revision:1,payloadHash:await envelopePayloadHash(row),generation:row.context.dataGeneration};}
   else if(command.action==='migration-verify'){check('recovery is checked before accepting the migrated source',recoveryChecks>0&&Number(command.payload.objectCount)>0);state='verified';result={state,manifestHash:command.payload.manifestHash};}
   else if(command.action==='migration-commit'){events.push(packet);directory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);state='active';result={state,directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash};}
   else throw new Error('BROWSER_PHYSIS_UNEXPECTED_ACTION');receipts.set(command.operationId,{hash,result});
   if(command.action==='migration-commit'&&!interrupted){interrupted=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}return result;
  }};
  const make=()=>new E2eeMigration({vault:device!.vault,directory,deviceId,signingKey:device!.keys().signing.privateKey,signer:device!.keys().signing.publicKey,root,transport,sources,
   ensureDurableKeys:()=>device!.ensureDurableKeys(),withLocalWriteFence:async operation=>operation(),verifyRecovery:async candidate=>{
    const authority=await recoverAuthority(owner,kit.secret,kit.kit),restored=await openRoot(directory.recoveryCapsule,authority.receiving.privateKey,{...recipient,recipientId:'recovery'}),probe=freshSecret();let opened:Uint8Array|undefined;
    const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:owner,scopeId,domain:'key-check',objectId:'recovery-probe',schemaVersion:1,dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:recipient.keyId,deviceId,operationId:crypto.randomUUID()};
    try{const packet=await sealE2eeEnvelope(candidate,device!.keys().signing.privateKey,context,probe);opened=await openE2eeEnvelope(restored,device!.keys().signing.publicKey,context,packet);check('independent recovery authority opens the actual new Physis root',opened.every((byte,index)=>byte===probe[index]));recoveryChecks++;}finally{probe.fill(0);opened?.fill(0);}
   }});
  await make().prepare();check('prepare does not read server content or send a migration packet',sourceReads===0&&packets.length===0);
  oldKey.fill(0);legacyKey='';forgetPhysisSession(owner);let failed=false;
  try{await make().run();}catch(error){failed=error instanceof Error&&error.message==='SYNTHETIC_PROCESS_DEATH';if(!failed)throw error;}
  check('ambiguous committed transition retains its pending journal',failed&&state==='active'&&(await make().status())?.pending?.command.action==='migration-commit');
  check('restart completes without recapture source replay or new legacy writes',await make().run()==='active'&&captures===1&&reconciliations===1&&sourceReads===1&&legacyWrites===1);
  const status=await make().status(),wireText=JSON.stringify(packets),disk=JSON.stringify(await Promise.all((await storage.list('')).map(key=>storage.get(key))));
  check('signed transport has no private Physis content old keys or recovery secret',![cloudCanary,pendingCanary,originalLegacyKey,detached[0].state.key,encodeE2eeBytes(kit.secret)].some(value=>wireText.includes(value)));
  check('local form IDs and plaintext digests never enter upload packets',!!status?.local?.length&&status.local.every(row=>!wireText.includes(row.objectId)&&!wireText.includes(row.plaintextHash)));
  check('IndexedDB stores no plaintext Physis canaries old keys or recovery secret',![cloudCanary,pendingCanary,originalLegacyKey,detached[0].state.key,encodeE2eeBytes(kit.secret)].some(value=>disk.includes(value)));
  device.lock();device=await UnlockedWebDevice.unlock(owner,kit.secret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
  const scopeTransport:ScopeTransport={directory:async()=>({events}),command:transport.command,read:async packet=>{
   const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);
   if(command.action==='sealed-heads')return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,objects:await Promise.all([...objects.values()].map(async row=>({domain:row.context.domain,objectId:row.context.objectId,revision:row.context.revision,payloadHash:await envelopePayloadHash(row)})))};
   if(command.action!=='get')throw new Error('BROWSER_PHYSIS_UNEXPECTED_READ');const row=objects.get(command.payload.domain+'\0'+command.payload.objectId);return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,envelopes:row?[row]:[]};}};
  const client=new E2eeScopeClient(device,owner,scopeId,kit.kit.authority,scopeTransport);await client.refresh();
  const read=await readMigratedPhysis(async(domain,id)=>{const row=await client.read(domain,id);if(!row)throw new Error('E2EE_MISSING_PHYSIS');try{return JSON.parse(decoder.decode(row.bytes));}finally{row.bytes.fill(0);}},async(domain,id)=>(await make().readLocal(domain,id))?.bytes??null,owner);
  check('a cold scope reader opens the reviewed record using the new root alone',(read.records[0].record as {privateOptional:{note:string}}).privateOptional.note===pendingCanary);
  const local=read.local as {stores:{pending:{requestId:string}[];editors:{value:{source:string;state:unknown}}[]}[];variants:{variants:{source:string;record:{privateOptional?:{note?:string}}|null}[]}[]};
  check('the original server variant remains recoverable under the new root',local.variants.some(row=>row.variants.some(value=>value.source==='server'&&value.record?.privateOptional?.note===cloudCanary)));
  check('detached real profile and raw decimal survive cold unlock',local.stores[0].editors.some(row=>row.value.source==='personal-profile.PhysisPersonalProfile'&&(row.value.state as {draft:{weightKg:string}}).draft.weightKg==='71,')&&local.stores[0].editors.some(row=>row.value.source==='fields.NumberField'&&(row.value.state as {draft?:string}).draft==='1,,'));
  check('the uncertain retry intent remains inert history with its original ID',local.stores[0].pending[0].requestId.length===36&&legacyWrites===1&&sourceReads===1);
 }catch(error){report.error=error instanceof Error&&/^E2EE_[A-Z_]+$/.test(error.message)?error.message:'BROWSER_PHYSIS_ACCEPTANCE_FAILED';if(error instanceof Error)report.diagnostic=(error.stack??error.name).split('\n').slice(0,4).join('\n').replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g,'[REDACTED]');}
 finally{forgetPhysisSession(owner);device?.lock();recovery?.secret.fill(0);oldKey.fill(0);live=false;}
 report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';update();
}
function Fixture(){
 const store=useSyncExternalStore(model.subscribe,model.getSnapshot,model.getSnapshot),[profile,setProfile]=useState(true),[decimal,setDecimal]=useState(true),[numeric,setNumeric]=useState<number|null>(null),[running,setRunning]=useState(false),started=useRef(false);
 useEffect(()=>{if(running&&!profile&&!decimal&&!started.current){started.current=true;void acceptance();}},[running,profile,decimal]);
 return <PhysisMigrationProvider model={model}><div className="physis"><h1>Synthetic Physis source acceptance</h1>
  <button type="button" id="run-migration" disabled={profile||running} onClick={()=>{setDecimal(false);setRunning(true);report.status='RUNNING';update();}}>Detach forms and test migration</button>
  {decimal&&<NumberField label="Synthetic decimal input" value={numeric} onChange={setNumeric}/>}
  {profile&&<PhysisPersonalProfile store={store} settings={settings} context={calendarContext({timeZone:'UTC'})} language="en" onClose={()=>setProfile(false)}/>}
 </div></PhysisMigrationProvider>;
}
createRoot(document.querySelector('#root')!).render(<Fixture/>);report.status='READY';update();
