import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HabitReminderInputPanel} from '../../app/HabitReminderInput';
import {defaultHabit,EMPTY_HABIT_WORKSPACE} from '../../app/habits';
import {buildHabitReminderPlan,habitReminderTarget} from '../../app/habit-reminder-plan';
import {captureReminderMigrationEditors,clearReminderMigrationMemory} from '../../app/reminder-migration-memory';
import {PersonalRemindersSource,readMigratedReminderHistory,reminderWebStorageKeys} from '../../app/e2ee/reminders-source';
import {captureWebReminderInventory} from '../../app/e2ee/reminders-web-source';
import {E2eeMigration,type MigrationSources,type MigrationTransport} from '../../app/e2ee/migration';
import {createRecoveryKit,freshSecret,openRoot,publicDeviceKeys,recoverAuthority,sealRoot} from '../../app/e2ee/keys';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash,type E2eeCommand,type WireValue} from '../../app/e2ee/commands';
import {verifyDeviceDirectory,type VerifiedDirectory} from '../../app/e2ee/directory';
import {encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope,openE2eeEnvelope,validateE2eeEnvelope,E2EE_SUITE,type E2eeEnvelope,type E2eeContext} from '../../app/e2ee/envelope';
import {envelopePayloadHash} from '../../app/e2ee/files';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage';
import {IndexedDbDeviceKeyStorage,UnlockedWebDevice} from '../../app/e2ee/device-vault';
import {IndexedDbLegacyTransportMarkers,WebLegacyTransportGate,WebMigrationTransportFence} from '../../app/e2ee/legacy-transport-fence';
import {legacyWorkerBackground} from '../../app/e2ee/legacy-worker';
import {E2eeScopeClient,type ScopeTransport} from '../../app/e2ee/scope-client';

const report:{synthetic:true;runtime:string;checks:{name:string;passed:boolean}[];status:string;error?:string;diagnostic?:string}={synthetic:true,runtime:navigator.userAgent,checks:[],status:'STARTING'};
const update=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS reminder source';};
function check(name:string,passed:boolean){report.checks.push({name,passed});if(!passed)throw new Error('BROWSER_REMINDER_CHECK_FAILED');}
const decoder=new TextDecoder(),owner='browser-reminder-'+crypto.randomUUID(),scopeId='personal:'+owner;
const today=new Date().toISOString().slice(0,10),minute=new Date().toISOString().slice(11,16),habit=defaultHabit(today,'profane');
habit.title='Synthetic reminder input';habit.schedule.timezone='UTC';habit.reminder={...habit.reminder,enabled:true,timing:'custom',time:minute,minutesBefore:0,allowDuringQuietHours:true};
habit.measurement={kind:'quantity',unit:'pages',target:10000,quickAdd:1000};
const workspace={...EMPTY_HABIT_WORKSPACE,habits:[habit]},plan=buildHabitReminderPlan(workspace,new Date(),'UTC',1);
const row=plan.rows.find(value=>value.kind==='habit');if(!row)throw new Error('BROWSER_REMINDER_FIXTURE_INVALID');
const target=habitReminderTarget(row)!;let saves=0,live=true,device:UnlockedWebDevice|undefined,recovery:Awaited<ReturnType<typeof createRecoveryKit>>|undefined;
const canary='Synthetic unsent reminder '+crypto.randomUUID(),intentCanary='Synthetic stored pending action '+crypto.randomUUID();
const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');device?.requireOpen();};
const cacheName='genesis-habit-push-receipts-v1',url=(kind:string,id:string)=>new URL(`/__habit-${kind}/${encodeURIComponent(id)}`,location.origin).href;
localStorage.setItem(`genesis.habit-reminder.frequency.${owner}`,'{ "maxPerDay":24, "snoozeMinutes":15 }');
localStorage.setItem(`genesis.habit-reminder.snoozes.${owner}`,JSON.stringify({pending:{row,due:new Date(Date.now()+600000).toISOString()}}));
const cache=await caches.open(cacheName);
await cache.put(url('intent','synthetic-pending-intent'),Response.json({userId:owner,deliveryId:'old-delivery',action:'primary',receivedAt:Date.now(),note:intentCanary}));
await cache.put(url('receipt','old-ownerless-receipt'),Response.json({receivedAt:1}));

async function acceptance(){
 const markers=new IndexedDbLegacyTransportMarkers(),gate=new WebLegacyTransportGate(markers,navigator.locks);
 const fence=new WebMigrationTransportFence(gate,owner,scopeId,current);let release:()=>void=()=>{};
 try{
  check('secure real WebCrypto, IndexedDB, CacheStorage and Web Locks are available',isSecureContext&&!!crypto.subtle&&!!indexedDB&&!!caches&&!!navigator.locks);
  const editors=captureReminderMigrationEditors(owner),input=editors.find(value=>value.source==='habit-reminder-input');
  check('actual detached reminder form preserves the exact unfinished number',(input?.state as {value?:string})?.value==='1,,');
  check('actual detached reminder form preserves its unsent note',(input?.state as {note?:string})?.note===canary);
  check('unmount does not submit or acknowledge the form',saves===0&&editors.every(value=>!value.mounted));
  recovery=await createRecoveryKit(owner);const kit=recovery,storage=new IndexedDbE2eeStorage();device=await UnlockedWebDevice.provision(owner,kit.secret,kit.kit,storage,new IndexedDbDeviceKeyStorage());
  const publicKeys=await publicDeviceKeys(device.keys()),rawRoot=freshSecret(),root=await importE2eeRoot(rawRoot),deviceId=device.deviceId;
  const recipient={ownerId:owner,scopeId,cryptoEpoch:1,keyId:'synthetic-new-reminder-root',recipientId:deviceId};
  const bootstrap:E2eeCommand={protocol:1,ownerId:owner,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{
   kind:'personal',resourceId:owner,keyId:recipient.keyId,generation:1,recoveryKit:kit.kit,deviceKeys:publicKeys,deviceCapsule:await sealRoot(rawRoot,publicKeys.receivingKey,recipient),recoveryCapsule:await sealRoot(rawRoot,kit.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
  rawRoot.fill(0);bootstrap.payload.selfProof=(await signE2eeCommand(bootstrap,device.keys().signing.privateKey)).signature;
  const events=[await signE2eeCommand(bootstrap,kit.keys.signing.privateKey)];let directory:VerifiedDirectory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);
  const objects=new Map<string,E2eeEnvelope>(),receipts=new Map<string,{hash:string;result:Record<string,WireValue>}>(),packets:unknown[]=[];
  let captures=0,reconciliations=0,sourceReads=0,reviews=0,recoveryChecks=0,interrupted=false,state='legacy';
  const source=new PersonalRemindersSource(owner,scopeId,{assertCurrent:current,memory:async()=>({ownerId:owner,generation:0,reconciliationRequired:false,
   local:await captureWebReminderInventory(owner,{storage:localStorage,assertCurrent:current,caches,notifications:async()=>[],projectionWanted:true})}),
   reviewUnassigned:async entries=>{check('ownerless legacy receipts require an explicit synthetic review',entries.some(value=>value.source.includes('old-ownerless-receipt')));reviews++;return'attribute-to-current-owner';},
   legacyReminders:async context=>{sourceReads++;check('server history follows a durable protected local capture',((await make().status())?.snapshotParts??0)>0);
    return{protocol:1,ownerId:owner,scopeId,migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:directory.checkpoint.hash,directoryRevision:1,
     habitProfiles:[],habitDevices:[{id:'old-device',device_key:'old-device-key',encrypted_subscription:'inert-old-endpoint-ciphertext',enabled:0,request_id:'exact-uncertain-request',request_hash:'b'.repeat(64),time_zone:'UTC',max_per_day:24,snooze_minutes:15,revision:3,created_at:row!.at,updated_at:row!.at}],
     habitDeliveries:[{id:'old-delivery',device_id:'old-device',profile_revision:1,event_key:'c'.repeat(64),encrypted_target:'exact-old-target-ciphertext',scheduled_at:row!.at,expires_at:row!.at,state:'failed',sent_at:null,reserved_at:row!.at,snooze_of:null,error_code:'OLD_FAILURE',created_at:row!.at,updated_at:row!.at,target_json:JSON.stringify(row)}],
     adviceDays:[],adviceDeliveries:[],sharedPreferences:[{settings_json:'{ "enabled":false }',revision:3,updated_at:row!.at}],legacyKey:{keyMode:'empty',key:null}};
   }});
  const sources:MigrationSources={requiredCoverage:['personal.reminders'],allowedContentDomains:['workspace'],async captureLocal(){captures++;return source.captureLocal();},async reconcile(raw,previous,context){reconciliations++;const result=await source.reconcile(raw,previous,context);return{...result,coverage:[{domain:'personal.reminders',complete:result.complete}]};}};
  const transport:MigrationTransport={sourceHash:async()=>{current();return'A'.repeat(43);},readAll:async()=>[...objects.values()].map(value=>structuredClone(value)),async command(packet){
   const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);packets.push(packet);check('every migration packet is bound to this owner scope and device',command.ownerId===owner&&command.scopeId===scopeId&&command.deviceId===deviceId);
   const hash=await e2eeCommandHash(command),prior=receipts.get(command.operationId);if(prior){check('ambiguous commit retries the exact signed packet',prior.hash===hash);return prior.result;}
   let result:Record<string,WireValue>;
   if(command.action==='migration-start'){state='uploading';result={fence:1,leaseUntil:2_000_000_000,generation:2};}
   else if(command.action==='put'){const value=validateE2eeEnvelope(command.payload.envelope);objects.set(value.context.domain+'\0'+value.context.objectId,value);result={revision:1,payloadHash:await envelopePayloadHash(value),generation:value.context.dataGeneration};}
   else if(command.action==='migration-verify'){check('migration verifies recovery before accepting remote data',recoveryChecks>0&&Number(command.payload.objectCount)>0);state='verified';result={state,manifestHash:command.payload.manifestHash};}
   else if(command.action==='migration-commit'){events.push(packet);directory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);state='active';result={state,directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash};}
   else throw new Error('BROWSER_REMINDER_UNEXPECTED_ACTION');receipts.set(command.operationId,{hash,result});
   if(command.action==='migration-commit'&&!interrupted){interrupted=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}return result;
  }};
  const make=()=>new E2eeMigration({vault:device!.vault,directory,deviceId,signingKey:device!.keys().signing.privateKey,signer:device!.keys().signing.publicKey,root,transport,sources,
   ensureDurableKeys:()=>device!.ensureDurableKeys(),withLocalWriteFence:operation=>fence.withFence(operation),verifyRecovery:async candidate=>{
    const authority=await recoverAuthority(owner,kit.secret,kit.kit),restored=await openRoot(directory.recoveryCapsule,authority.receiving.privateKey,{...recipient,recipientId:'recovery'}),probe=freshSecret();let opened:Uint8Array|undefined;
    const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:owner,scopeId,domain:'key-check',objectId:'recovery-probe',schemaVersion:1,dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:recipient.keyId,deviceId,operationId:crypto.randomUUID()};
    try{const packet=await sealE2eeEnvelope(candidate,device!.keys().signing.privateKey,context,probe);opened=await openE2eeEnvelope(restored,device!.keys().signing.publicKey,context,packet);check('independent recovery opens the new reminder scope root',opened.every((byte,index)=>byte===probe[index]));recoveryChecks++;}finally{probe.fill(0);opened?.fill(0);}
   }});
  let admitted:()=>void=()=>{};const entered=new Promise<void>(resolve=>{admitted=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const background=legacyWorkerBackground({locks:navigator.locks,markers:()=>markers},async()=>{admitted();await held;await cache.put(url('receipt','already-admitted'),Response.json({userId:owner,receivedAt:2}));});await entered;
  const preparing=make().prepare();await new Promise(resolve=>setTimeout(resolve,30));check('real Web Locks drain earlier background work before capture',captures===0);
  release();await background;await preparing;check('prepare captured everything without reading or uploading private source content',sourceReads===0&&packets.length===0&&captures===1);
  let late=false;try{await legacyWorkerBackground({locks:navigator.locks,markers:()=>markers},async()=>{late=true;});}catch{/* Expected durable preparing deny. */}
  check('the persistent preparing marker blocks late background delivery',!late&&(await markers.get(owner))?.phase==='preparing');
  clearReminderMigrationMemory();for(const key of reminderWebStorageKeys(owner))localStorage.removeItem(key);await cache.delete(url('intent','synthetic-pending-intent'));
  let failed=false;try{await make().run();}catch(error){failed=error instanceof Error&&error.message==='SYNTHETIC_PROCESS_DEATH';if(!failed)throw error;}
  check('an ambiguous commit leaves the exact pending journal',failed&&state==='active'&&(await make().status())?.pending?.command.action==='migration-commit');
  check('restart uses the protected capture and persisted plan without replay or recapture',await make().run()==='active'&&captures===1&&reconciliations===1&&sourceReads===1&&reviews===1&&saves===0);
  await fence.activate(directory);const status=await make().status(),wire=JSON.stringify(packets),disk=JSON.stringify(await Promise.all((await storage.list('')).map(key=>storage.get(key))));
  check('migration uploads no private reminder drafts actions old grants or recovery secret',![canary,intentCanary,'exact-uncertain-request','inert-old-endpoint-ciphertext',encodeE2eeBytes(kit.secret)].some(value=>wire.includes(value)));
  check('local history identifiers and plaintext digests stay off the signed wire',!!status?.local?.length&&status.local.every(value=>!wire.includes(value.objectId)&&!wire.includes(value.plaintextHash)));
  check('IndexedDB contains no plaintext reminder canaries or recovery secret',![canary,intentCanary,encodeE2eeBytes(kit.secret)].some(value=>disk.includes(value)));
  device.lock();device=await UnlockedWebDevice.unlock(owner,kit.secret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
  const history=await readMigratedReminderHistory(async(domain,id)=>(await make().readLocal(domain,id))?.bytes??null,owner);
  const local=history.captures[0].local as {editors:{state:{value?:string;note?:string}}[];worker:{records:{raw:string}[]};entries:{key:string;value:unknown}[]};
  check('cold device unlock restores the exact detached form',local.editors.some(value=>value.state.value==='1,,'&&value.state.note===canary));
  check('the deleted original pending worker intent survives under the new root',local.worker.records.some(value=>value.raw.includes(intentCanary)));
  check('the earlier background receipt is included in the same protected capture',local.worker.records.some(value=>value.raw.includes('"receivedAt":2')));
  check('raw preference bytes survive instead of a normalized replacement',local.entries.some(value=>value.key===`genesis.habit-reminder.frequency.${owner}`&&value.value==='{ "maxPerDay":24, "snoozeMinutes":15 }'));
  check('old failed delivery and exact uncertain request remain non-executable history',history.execution==='history-only'&&history.deliveryAuthority==='fresh-consent-required'&&history.server.some(value=>(value.original as {request_id?:string}).request_id==='exact-uncertain-request'));
  const scopeTransport:ScopeTransport={directory:async()=>({events}),command:transport.command,read:async packet=>{
   const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);if(command.action==='sealed-heads')return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,objects:await Promise.all([...objects.values()].map(async value=>({domain:value.context.domain,objectId:value.context.objectId,revision:value.context.revision,payloadHash:await envelopePayloadHash(value)})))};
   if(command.action!=='get')throw new Error('BROWSER_REMINDER_UNEXPECTED_READ');const value=objects.get(command.payload.domain+'\0'+command.payload.objectId);return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,envelopes:value?[value]:[]};}};
  const client=new E2eeScopeClient(device,owner,scopeId,kit.kit.authority,scopeTransport);await client.refresh();const preferences=await client.read('workspace','personal-reminders-preferences-v1');
  try{check('cold signed scope reader opens private preferences from the new root',!!preferences&&JSON.parse(decoder.decode(preferences.bytes)).deliveryAuthority==='fresh-consent-required');}finally{preferences?.bytes.fill(0);}
 }catch(error){report.error=error instanceof Error&&/^E2EE_[A-Z_]+$/.test(error.message)?error.message:'BROWSER_REMINDER_ACCEPTANCE_FAILED';if(error instanceof Error)report.diagnostic=(error.stack??error.name).split('\n').slice(0,4).join('\n').replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g,'[REDACTED]');}
 finally{release();device?.lock();recovery?.secret.fill(0);clearReminderMigrationMemory();await markers.close();live=false;}
 report.status=report.error||report.checks.some(value=>!value.passed)?'FAIL':'PASS';update();
}
function Fixture(){const [mounted,setMounted]=useState(true),[running,setRunning]=useState(false),started=useRef(false);
 useEffect(()=>{if(running&&!mounted&&!started.current){started.current=true;void acceptance();}},[running,mounted]);
 return <main><h1>Synthetic reminder source acceptance</h1><p>Enter <strong>1,,</strong> and the synthetic note, then detach the form.</p><p id="synthetic-note">{canary}</p>
  <button id="run-migration" type="button" disabled={running} onClick={()=>{setMounted(false);setRunning(true);report.status='RUNNING';update();}}>Detach form and test migration</button>
  {mounted&&<HabitReminderInputPanel userId={owner} workspace={workspace} target={target} language="en" calendarMode="profane" timeFormat="24h" onSave={async()=>{saves++;throw new Error('SYNTHETIC_OFFLINE');}}/>}
 </main>;
}
createRoot(document.querySelector('#root')!).render(<Fixture/>);report.status='READY';update();
