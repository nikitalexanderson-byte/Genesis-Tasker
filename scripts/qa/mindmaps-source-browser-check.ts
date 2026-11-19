import {PersonalMindmapsSource,readMigratedMindmaps,type MindmapsMigrationMemory} from '../../app/e2ee/mindmaps-source';
import {collectLegacyPersonalPages} from '../../app/e2ee/legacy-pages';
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
function check(name:string,passed:boolean){report.checks.push({name,passed});if(!passed)throw new Error('BROWSER_MINDMAPS_CHECK_FAILED');}
const encoder=new TextEncoder(),decoder=new TextDecoder(),owner='browser-maps-'+crypto.randomUUID(),scopeId='personal:'+owner,prefix=`genesis-mindmaps:${owner}:`;
let device:UnlockedWebDevice|undefined,recovery:Awaited<ReturnType<typeof createRecoveryKit>>|undefined;
const oldKey=freshSecret(),storedKeys:string[]=[];
try{
 check('actual secure WebCrypto localStorage and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 recovery=await createRecoveryKit(owner);const kit=recovery,storage=new IndexedDbE2eeStorage();device=await UnlockedWebDevice.provision(owner,kit.secret,kit.kit,storage,new IndexedDbDeviceKeyStorage());
 const publicKeys=await publicDeviceKeys(device.keys()),rawRoot=freshSecret(),root=await importE2eeRoot(rawRoot),deviceId=device.deviceId;
 const recipient={ownerId:owner,scopeId,cryptoEpoch:1,keyId:'synthetic-new-mindmap-root',recipientId:deviceId};
 const bootstrap:E2eeCommand={protocol:1,ownerId:owner,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{
  kind:'personal',resourceId:owner,keyId:recipient.keyId,generation:1,recoveryKit:kit.kit,deviceKeys:publicKeys,
  deviceCapsule:await sealRoot(rawRoot,publicKeys.receivingKey,recipient),recoveryCapsule:await sealRoot(rawRoot,kit.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
 rawRoot.fill(0);bootstrap.payload.selfProof=(await signE2eeCommand(bootstrap,device.keys().signing.privateKey)).signature;
 const events=[await signE2eeCommand(bootstrap,kit.keys.signing.privateKey)];let directory:VerifiedDirectory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);
 const cloudCanary='Synthetic acknowledged map '+crypto.randomUUID(),draftCanary='Synthetic closed-tab map '+crypto.randomUUID(),conversionCanary='Synthetic unsent conversion '+crypto.randomUUID();
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2coAAAAASUVORK5CYII=',image='data:image/png;base64,'+png;
 const now='2026-11-19T10:00:00Z',map=(id:string,title:string)=>({schemaVersion:1,id,title,description:'',projectId:null,pinned:false,archived:false,
  nodes:[{id:'root',parentId:null,kind:'idea',text:title,note:'Original note',tags:[],presentation:{image:{data:image,alt:'Original embedded picture',fit:'contain'}}},
   {id:'linked',parentId:'root',kind:'task',refId:'original-task',occurrenceDate:'2026-11-19',note:'Original task link'}],links:[]});
 const legacy=await crypto.subtle.importKey('raw',new Uint8Array(oldKey),'AES-GCM',false,['encrypt']);
 const seal=async(value:unknown,purpose:string)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`genesis-mindmap-v1:${owner}:${purpose}`)},legacy,encoder.encode(JSON.stringify(value)));
  return{iv:btoa(String.fromCharCode(...iv)),ciphertext:btoa(String.fromCharCode(...new Uint8Array(cipher)))};};
 const serverMap=map('server-map',cloudCanary),serverEnvelope=await seal(serverMap,'map:server-map'),draft=map('draft-map',draftCanary),draftEnvelope=await seal(draft,'map:draft-map');
 const conversion={mapId:'server-map',nodeId:'root',taskId:'uncertain-task',task:{title:conversionCanary},applied:false},conversionEnvelope=await seal(conversion,'conversion:server-map:root');
 const view={mode:'map',collapsed:['linked'],focus:'root',zoom:1.5,viewport:{left:17,top:42}},viewEnvelope=await seal(view,'view:server-map');
 for(const [key,value]of [['cache',JSON.stringify([{...serverEnvelope,id:'server-map',revision:30,schemaVersion:2,updatedAt:now}])],
  ['draft:closed-tab:draft-map',JSON.stringify({...draftEnvelope,expectedRevision:0,operationId:'uncertain-map-write',schemaVersion:2})],
  ['request:closed-tab:draft-map',JSON.stringify({...draftEnvelope,expectedRevision:0,operationId:'uncertain-map-write',schemaVersion:2})],
  ['conversion:server-map:root',JSON.stringify(conversionEnvelope)],['view:server-map',JSON.stringify(viewEnvelope)]]){localStorage.setItem(prefix+key,value);storedKeys.push(prefix+key);}
 const before=storedKeys.map(key=>localStorage.getItem(key));
 const memory:MindmapsMigrationMemory={ownerId:owner,legacyKey:btoa(String.fromCharCode(...oldKey)),generation:0,reconciliationRequired:false,records:[],editors:[{source:'new-dialog',document:null,revision:0,state:{title:'Synthetic not-yet-created map'}}],localWork:[]};
 const historical=[];for(let revision=1;revision<=25;revision++)historical.push({map_id:'server-map',revision,schema_version:2,...await seal(map('server-map','Synthetic retained version '+revision),'map:server-map'),updated_at:now});
 const oldData:Record<string,Record<string,unknown>[]>={maps:[{id:'server-map',revision:30,schema_version:2,...serverEnvelope,updated_at:now}],versions:historical,
  receipts:[{map_id:'server-map',operation_id:'uncertain-old-write',payload_hash:'a'.repeat(64),revision:29}],deletions:[]};
 const objects=new Map<string,E2eeEnvelope>(),receipts=new Map<string,{hash:string;result:Record<string,WireValue>}>(),packets:unknown[]=[];
 let sourceReads=0,pageReads=0,reconciliations=0,captures=0,recoveryChecks=0,interrupted=false,state='legacy';
 const source=new PersonalMindmapsSource(owner,scopeId,{storage:localStorage,memory:()=>memory,assertCurrent:()=>device!.requireOpen(),legacyMindmaps:async context=>{
  sourceReads++;return collectLegacyPersonalPages(context,'mindmaps',{assertCurrent:()=>device!.requireOpen(),readPage:async(value,table,offset)=>{
   pageReads++;check('each map page follows the committed protected snapshot',((await make().status())?.snapshotParts??0)>0);
   const rows=oldData[table].slice(offset,offset+7),next=offset+rows.length;
   return{protocol:1,ownerId:owner,scopeId,migrationId:value.migrationId,fence:value.fence,sourceHash:value.sourceHash,legacyGeneration:0,checkpointHash:directory.checkpoint.hash,directoryRevision:1,
    table,offset,totals:Object.fromEntries(Object.entries(oldData).map(([name,items])=>[name,items.length])),rows,nextOffset:next<oldData[table].length?next:null,
    legacyKey:rows.length&&['maps','versions'].includes(table)?{keyMode:'account',key:memory.legacyKey}:{keyMode:'empty',key:null}};
  }});
 }});
 const sources:MigrationSources={requiredCoverage:['personal.mindmaps'],allowedContentDomains:['mindmap','attachment'],async captureLocal(){captures++;return source.captureLocal();},async reconcile(raw,previous,context){reconciliations++;const result=await source.reconcile(raw,previous,context);return{...result,coverage:[{domain:'personal.mindmaps',complete:result.complete}]};}};
 const transport:MigrationTransport={async sourceHash(){device!.requireOpen();return'A'.repeat(43);},async readAll(){return[...objects.values()].map(row=>structuredClone(row));},async command(packet){
  const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);packets.push(packet);check('signed packets stay bound to current map owner and device',command.ownerId===owner&&command.scopeId===scopeId&&command.deviceId===deviceId);
  const hash=await e2eeCommandHash(command),prior=receipts.get(command.operationId);if(prior){check('ambiguous retry reuses its exact durable signed packet',prior.hash===hash);return prior.result;}
  let result:Record<string,WireValue>;
  if(command.action==='migration-start'){state='uploading';result={fence:1,leaseUntil:2_000_000_000,generation:2};}
  else if(command.action==='put'){const envelope=validateE2eeEnvelope(command.payload.envelope);objects.set(envelope.context.domain+'\0'+envelope.context.objectId,envelope);result={revision:1,payloadHash:await envelopePayloadHash(envelope),generation:envelope.context.dataGeneration};}
  else if(command.action==='migration-verify'){check('independent saved recovery is verified before the remote manifest',recoveryChecks>0&&Number(command.payload.objectCount)>0);state='verified';result={state,manifestHash:command.payload.manifestHash};}
  else if(command.action==='migration-commit'){events.push(packet);directory=await verifyDeviceDirectory(owner,scopeId,kit.kit.authority,events);state='active';result={state,directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash};}
  else throw new Error('BROWSER_MINDMAPS_UNEXPECTED_ACTION');receipts.set(command.operationId,{hash,result});
  if(command.action==='migration-commit'&&!interrupted){interrupted=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}return result;
 }};
 const make=()=>new E2eeMigration({vault:device!.vault,directory,deviceId,signingKey:device!.keys().signing.privateKey,signer:device!.keys().signing.publicKey,root,transport,sources,
  ensureDurableKeys:()=>device!.ensureDurableKeys(),withLocalWriteFence:async operation=>operation(),verifyRecovery:async candidate=>{
   const authority=await recoverAuthority(owner,kit.secret,kit.kit),restored=await openRoot(directory.recoveryCapsule,authority.receiving.privateKey,{...recipient,recipientId:'recovery'}),probe=freshSecret();let opened:Uint8Array|undefined;
   const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:owner,scopeId,domain:'key-check',objectId:'recovery-probe',schemaVersion:1,dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:recipient.keyId,deviceId,operationId:crypto.randomUUID()};
   try{const envelope=await sealE2eeEnvelope(candidate,device!.keys().signing.privateKey,context,probe);opened=await openE2eeEnvelope(restored,device!.keys().signing.publicKey,context,envelope);check('saved recovery opens the independent new map root',opened.every((byte,index)=>byte===probe[index]));recoveryChecks++;}finally{probe.fill(0);opened?.fill(0);}
  }});
 await make().prepare();check('prepare performs no source IO or upload',sourceReads===0&&packets.length===0);let failed=false;
 try{await make().run();}catch(error){failed=error instanceof Error&&error.message==='SYNTHETIC_PROCESS_DEATH';if(!failed)throw error;}
 check('ambiguous commit keeps its pending encrypted journal',failed&&state==='active'&&(await make().status())?.pending?.command.action==='migration-commit');
 check('restart commits once without recapture or duplicate source reads',await make().run()==='active'&&captures===1&&reconciliations===1&&sourceReads===1&&pageReads===7);
 const status=await make().status(),wire=JSON.stringify(packets),disk=JSON.stringify(await Promise.all((await storage.list('')).map(key=>storage.get(key))));
 check('wire excludes map titles drafts conversion text image bytes old keys and recovery secret',![cloudCanary,draftCanary,conversionCanary,image,png,'uncertain-map-write',memory.legacyKey,encodeE2eeBytes(kit.secret)].some(value=>wire.includes(value)));
 check('device-only work selectors and plaintext digests never enter upload packets',!!status?.local?.length&&status.local.every(row=>!wire.includes(row.objectId)&&!wire.includes(row.plaintextHash)));
 check('new IndexedDB contains no plaintext maps drafts conversions or recovery secret',![cloudCanary,draftCanary,conversionCanary,encodeE2eeBytes(kit.secret)].some(value=>disk.includes(value)));
 check('legacy owner storage stays byte-identical until approved retirement',storedKeys.every((key,index)=>localStorage.getItem(key)===before[index]));
 memory.legacyKey='';oldKey.fill(0);device.lock();device=await UnlockedWebDevice.unlock(owner,kit.secret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
 const scopeTransport:ScopeTransport={directory:async()=>({events}),command:transport.command,read:async packet=>{
  const command=await verifyE2eeCommand(packet,device!.keys().signing.publicKey);
  if(command.action==='sealed-heads')return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,objects:await Promise.all([...objects.values()].map(async row=>({domain:row.context.domain,objectId:row.context.objectId,revision:row.context.revision,payloadHash:await envelopePayloadHash(row)})))};
  if(command.action!=='get')throw new Error('BROWSER_MINDMAPS_UNEXPECTED_READ');const row=objects.get(command.payload.domain+'\0'+command.payload.objectId);return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,envelopes:row?[row]:[]};}};
 const client=new E2eeScopeClient(device,owner,scopeId,kit.kit.authority,scopeTransport);await client.refresh();
 const read=await readMigratedMindmaps(async(domain,id)=>{const row=await client.read(domain,id);if(!row)throw new Error('E2EE_MISSING_MINDMAP');try{return JSON.parse(decoder.decode(row.bytes));}finally{row.bytes.fill(0);}},
  id=>client.read('attachment',id),async(domain,id)=>(await make().readLocal(domain,id))?.bytes??null,owner);
 check('cold normal scope reader opens current maps without old keys',read.records.length===1&&read.records[0].document?.title===cloudCanary);
 check('all 25 retained versions remain readable after old-key removal',read.versions.length===25&&(read.versions[0].document as Record<string,unknown>).title==='Synthetic retained version 1'&&(read.versions[24].document as Record<string,unknown>).title==='Synthetic retained version 25');
 const graph=read.records[0].document!,nodes=graph.nodes as Record<string,unknown>[];
 check('new encrypted file keys and manifests rehydrate the exact original image',((nodes[0].presentation as Record<string,unknown>).image as Record<string,unknown>).data===image);
 check('task identities recurrence references and empty optional fields survive',nodes[1].refId==='original-task'&&nodes[1].occurrenceDate==='2026-11-19'&&Array.isArray(nodes[0].tags));
 check('closed-tab request and new-dialog work remain local and inert',read.local.drafts instanceof Array&&read.local.drafts.length===2&&read.local.conversions instanceof Array&&(read.local.conversions[0] as Record<string,unknown>).execution==='history-only');
 check('normal reads do not replay legacy requests or conversion provider calls',sourceReads===1&&captures===1&&reconciliations===1);
}catch(error){report.error=error instanceof Error&&/^E2EE_[A-Z_]+$/.test(error.message)?error.message:'BROWSER_MINDMAPS_ACCEPTANCE_FAILED';if(error instanceof Error)report.diagnostic=(error.stack??error.name).split('\n').slice(0,4).join('\n').replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g,'[REDACTED]');}
finally{device?.lock();recovery?.secret.fill(0);oldKey.fill(0);for(const key of storedKeys)localStorage.removeItem(key);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS mindmap source';
