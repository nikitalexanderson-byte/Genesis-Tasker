import {PersonalDiarySource,readMigratedDiary,type DiaryMigrationMemory} from '../../app/e2ee/diary-source';
import {E2eeMigration,type MigrationSources,type MigrationTransport} from '../../app/e2ee/migration';
import {createRecoveryKit,freshSecret,openRoot,publicDeviceKeys,recoverAuthority,sealRoot} from '../../app/e2ee/keys';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash,type E2eeCommand,type WireValue} from '../../app/e2ee/commands';
import {verifyDeviceDirectory,type VerifiedDirectory} from '../../app/e2ee/directory';
import {encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope,openE2eeEnvelope,validateE2eeEnvelope,E2EE_SUITE,type E2eeEnvelope,type E2eeContext} from '../../app/e2ee/envelope';
import {envelopePayloadHash} from '../../app/e2ee/files';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage';
import {IndexedDbDeviceKeyStorage,UnlockedWebDevice} from '../../app/e2ee/device-vault';
import {E2eeScopeClient,type ScopeTransport} from '../../app/e2ee/scope-client';

const report:{synthetic:true;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string;diagnostic?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
function check(name:string,passed:boolean){report.checks.push({name,passed});if(!passed)throw new Error('BROWSER_DIARY_CHECK_FAILED');}
const encoder=new TextEncoder(),decoder=new TextDecoder(),owner='browser-diary-'+crypto.randomUUID(),scopeId='personal:'+owner,prefix=`genesis-diary-v1:${owner}:`;
let device:UnlockedWebDevice|undefined,recovery:Awaited<ReturnType<typeof createRecoveryKit>>|undefined;
const oldKey=freshSecret(),storedKeys:string[]=[];
try{
 check('actual secure WebCrypto localStorage and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 recovery=await createRecoveryKit(owner);const kit=recovery,storage=new IndexedDbE2eeStorage();device=await UnlockedWebDevice.provision(owner,kit.secret,kit.kit,storage,new IndexedDbDeviceKeyStorage());
 const publicKeys=await publicDeviceKeys(device.keys()),rawRoot=freshSecret(),root=await importE2eeRoot(rawRoot),deviceId=device.deviceId;
 const recipient={ownerId:owner,scopeId,cryptoEpoch:1,keyId:'synthetic-new-diary-root',recipientId:deviceId};
 const bootstrap:E2eeCommand={protocol:1,ownerId:owner,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{
  kind:'personal',resourceId:owner,keyId:recipient.keyId,generation:1,recoveryKit:kit.kit,deviceKeys:publicKeys,
  deviceCapsule:await sealRoot(rawRoot,publicKeys.receivingKey,recipient),recoveryCapsule:await sealRoot(rawRoot,kit.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
 rawRoot.fill(0);bootstrap.payload.selfProof=(await signE2eeCommand(bootstrap,device.keys().signing.privateKey)).signature;
 const events=[await signE2eeCommand(bootstrap,kit.keys.signing.privateKey)];let directory:VerifiedDirectory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);
 const cloudCanary='Synthetic cloud diary '+crypto.randomUUID(),localCanary='Synthetic local-only diary '+crypto.randomUUID(),draftCanary='Synthetic closed tab draft '+crypto.randomUUID();
 const now='2026-11-19T09:00:00Z',note=(id:string,body:string)=>({version:1,id,title:'Synthetic private diary title',body,color:'sage',createdAt:now,updatedAt:now,archived:false,pinned:false,reaction:null});
 const legacy=await crypto.subtle.importKey('raw',new Uint8Array(oldKey),'AES-GCM',false,['encrypt']);
 const seal=async(value:ReturnType<typeof note>)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`genesis-mindmap-v1:${owner}:diary-note:v1:${value.id}`)},legacy,encoder.encode(JSON.stringify(value)));
  return{iv:btoa(String.fromCharCode(...iv)),ciphertext:btoa(String.fromCharCode(...new Uint8Array(cipher)))};};
 const privateNote=note('private-local',localCanary),privateEnvelope=await seal(privateNote),draft=note('private-draft',draftCanary),draftEnvelope=await seal(draft),serverNote=note('server-note',cloudCanary),serverEnvelope=await seal(serverNote);
 for(const [key,value]of [['cache',JSON.stringify([{...privateEnvelope,id:privateNote.id,revision:0,schemaVersion:1,updatedAt:now,localOnly:true,uploadId:'uncertain-copy'}])],
  ['draft:closed-tab:'+draft.id,JSON.stringify({...draftEnvelope,expectedRevision:0,schemaVersion:1})],['deleted','[]'],['settings',JSON.stringify({syncEnabled:true,revision:2,deviceLocalOnly:false})]]){
  localStorage.setItem(prefix+key,value);storedKeys.push(prefix+key);
 }
 const before=storedKeys.map(key=>localStorage.getItem(key));
 const memory:DiaryMigrationMemory={ownerId:owner,legacyKey:btoa(String.fromCharCode(...oldKey)),generation:0,reconciliationRequired:false,records:[],editors:[{source:'blank-editor',note:note('blank',''),revision:0}]};
 const objects=new Map<string,E2eeEnvelope>(),receipts=new Map<string,{hash:string;result:Record<string,WireValue>}>(),packets:unknown[]=[];
 let sourceReads=0,reconciliations=0,captures=0,recoveryChecks=0,interrupted=false,state='legacy';
 const source=new PersonalDiarySource(owner,scopeId,{storage:localStorage,memory:()=>memory,assertCurrent:()=>device!.requireOpen(),legacyDiary:async context=>{
  sourceReads++;check('diary source follows the protected local capture',((await make().status())?.snapshotParts??0)>0);
  return{protocol:1,ownerId:owner,scopeId,migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:directory.checkpoint.hash,directoryRevision:1,
   notes:[{id:serverNote.id,revision:1,schema_version:1,...serverEnvelope,payload_hash:'a'.repeat(64),updated_at:now}],deletions:[],settings:[],dreams:[],dreamSettings:[],adviceReferences:[],legacyKey:{keyMode:'account',key:memory.legacyKey}};
 }});
 const sources:MigrationSources={requiredCoverage:['personal.diary'],allowedContentDomains:['diary'],async captureLocal(){captures++;return source.captureLocal();},async reconcile(raw,previous,context){reconciliations++;const result=await source.reconcile(raw,previous,context);return{...result,coverage:[{domain:'personal.diary',complete:result.complete}]};}};
 const transport:MigrationTransport={async sourceHash(){device!.requireOpen();return'A'.repeat(43);},async readAll(){return[...objects.values()].map(row=>structuredClone(row));},async command(packet){
  const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);packets.push(packet);check('signed packet stays bound to current diary owner and device',command.ownerId===owner&&command.scopeId===scopeId&&command.deviceId===deviceId);
  const hash=await e2eeCommandHash(command),prior=receipts.get(command.operationId);if(prior){check('retry reuses the same durable signed packet',prior.hash===hash);return prior.result;}
  let result:Record<string,WireValue>;
  if(command.action==='migration-start'){state='uploading';result={fence:1,leaseUntil:2_000_000_000,generation:2};}
  else if(command.action==='put'){const envelope=validateE2eeEnvelope(command.payload.envelope);objects.set(envelope.context.domain+'\0'+envelope.context.objectId,envelope);result={revision:1,payloadHash:await envelopePayloadHash(envelope),generation:envelope.context.dataGeneration};}
  else if(command.action==='migration-verify'){check('recovery is verified before accepting the remote manifest',recoveryChecks>0&&Number(command.payload.objectCount)>0);state='verified';result={state,manifestHash:command.payload.manifestHash};}
  else if(command.action==='migration-commit'){events.push(packet);directory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);state='active';result={state,directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash};}
  else throw new Error('BROWSER_DIARY_UNEXPECTED_ACTION');receipts.set(command.operationId,{hash,result});
  if(command.action==='migration-commit'&&!interrupted){interrupted=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}return result;
 }};
 const make=()=>new E2eeMigration({vault:device!.vault,directory,deviceId,signingKey:device!.keys().signing.privateKey,signer:device!.keys().signing.publicKey,root,transport,sources,
  ensureDurableKeys:()=>device!.ensureDurableKeys(),withLocalWriteFence:async operation=>operation(),verifyRecovery:async candidate=>{
   const authority=await recoverAuthority(owner,kit.secret,kit.kit),restored=await openRoot(directory.recoveryCapsule,authority.receiving.privateKey,{...recipient,recipientId:'recovery'}),probe=freshSecret();let opened:Uint8Array|undefined;
   const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:owner,scopeId,domain:'key-check',objectId:'recovery-probe',schemaVersion:1,dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:recipient.keyId,deviceId,operationId:crypto.randomUUID()};
   try{const envelope=await sealE2eeEnvelope(candidate,device!.keys().signing.privateKey,context,probe);opened=await openE2eeEnvelope(restored,device!.keys().signing.publicKey,context,envelope);check('saved recovery unwraps the independent diary root',opened.every((byte,index)=>byte===probe[index]));recoveryChecks++;}finally{probe.fill(0);opened?.fill(0);}
  }});
 await make().prepare();check('prepare performs no source reads or migration requests',sourceReads===0&&packets.length===0);let failed=false;
 try{await make().run();}catch(error){failed=error instanceof Error&&error.message==='SYNTHETIC_PROCESS_DEATH';if(!failed)throw error;}
 check('ambiguous commit retains its pending journal',failed&&state==='active'&&(await make().status())?.pending?.command.action==='migration-commit');
 check('restart reaches active without recapturing or rereconciling diary',await make().run()==='active'&&captures===1&&reconciliations===1&&sourceReads===1);
 const status=await make().status(),wire=JSON.stringify(packets),disk=JSON.stringify(await Promise.all((await storage.list('')).map(key=>storage.get(key))));
 check('transport excludes cloud plaintext private notes drafts filenames old keys and recovery secret',![cloudCanary,localCanary,draftCanary,'uncertain-copy',memory.legacyKey,encodeE2eeBytes(kit.secret)].some(value=>wire.includes(value)));
 check('local-only IDs and plaintext digests stay out of migration packets',!!status?.local?.length&&status.local.every(row=>!wire.includes(row.objectId)&&!wire.includes(row.plaintextHash)));
 check('new IndexedDB contains no diary plaintext or recovery secret',![cloudCanary,localCanary,draftCanary,encodeE2eeBytes(kit.secret)].some(value=>disk.includes(value)));
 check('legacy local storage stays byte-identical until separately approved retirement',storedKeys.every((key,index)=>localStorage.getItem(key)===before[index]));
 memory.legacyKey='';oldKey.fill(0);device.lock();device=await UnlockedWebDevice.unlock(owner,kit.secret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
 const scopeTransport:ScopeTransport={directory:async()=>({events}),command:transport.command,read:async packet=>{
  const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);
  if(command.action==='sealed-heads')return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,objects:await Promise.all([...objects.values()].map(async row=>({domain:row.context.domain,objectId:row.context.objectId,revision:row.context.revision,payloadHash:await envelopePayloadHash(row)})))};
  if(command.action!=='get')throw new Error('BROWSER_DIARY_UNEXPECTED_READ');
  const row=objects.get(command.payload.domain+'\0'+command.payload.objectId);return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,envelopes:row?[row]:[]};}};
 const client=new E2eeScopeClient(device,owner,scopeId,kit.kit.authority,scopeTransport);await client.refresh();
 const records=await readMigratedDiary(async(domain,id)=>{const row=await client.read(domain,id);if(!row)throw new Error('E2EE_MISSING_DIARY');try{return JSON.parse(decoder.decode(row.bytes));}finally{row.bytes.fill(0);}},async(domain,id)=>(await make().readLocal(domain,id))?.bytes??null,owner);
 check('cold unlocked scope reader opens cloud diary without old keys',records.some(row=>row.placement==='remote'&&row.note?.body===cloudCanary));
 check('cold device vault opens the local-only note without a cloud fallback',records.some(row=>row.placement==='local'&&row.note?.body===localCanary));
 const history=await make().readLocal('diary','personal-diary-local-history-v1');try{const value=JSON.parse(decoder.decode(history!.bytes));check('closed tab and blank editor drafts survive recovery of the retained device vault',value.drafts.some((row:{note:{body:string}})=>row.note.body===draftCanary)&&value.drafts.some((row:{note:{body:string}})=>row.note.body===''));}finally{history?.bytes.fill(0);}
 check('normal reads do not re-run legacy source or acknowledge old uploads',sourceReads===1&&captures===1&&reconciliations===1);
}catch(error){report.error=error instanceof Error&&/^E2EE_[A-Z_]+$/.test(error.message)?error.message:'BROWSER_DIARY_ACCEPTANCE_FAILED';if(error instanceof Error)report.diagnostic=(error.stack??error.name).split('\n').slice(0,4).join('\n').replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g,'[REDACTED]');}
finally{device?.lock();recovery?.secret.fill(0);oldKey.fill(0);for(const key of storedKeys)localStorage.removeItem(key);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS diary source';
