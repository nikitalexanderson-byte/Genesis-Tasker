import {SignedMigrationTransport,type E2eeMigrationRequest} from '../../app/e2ee/migration-transport.ts';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from '../../app/e2ee/device-vault.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {createRecoveryKit,freshSecret} from '../../app/e2ee/keys.ts';
import {E2EE_SUITE,encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope,openE2eeEnvelope,type E2eeContext,type E2eeEnvelope} from '../../app/e2ee/envelope.ts';
import {verifyE2eeCommand,type SignedE2eeCommand,type WireValue} from '../../app/e2ee/commands.ts';
import type {VerifiedDirectory} from '../../app/e2ee/directory.ts';
import {envelopePayloadHash} from '../../app/e2ee/files.ts';
import {readE2eeJsonResponse} from '../../app/e2ee/http-response.ts';

const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const progress=(stage:string)=>{document.querySelector('#result')!.textContent=JSON.stringify({...report,status:'RUNNING',stage},null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});progress(name);if(!passed)throw new Error(name);};
try{
 const owner='readback-browser-'+crypto.randomUUID(),recovery=await createRecoveryKit(owner),storage=new IndexedDbE2eeStorage();
 const device=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,storage,new IndexedDbDeviceKeyStorage());recovery.secret.fill(0);
 check('actual WebCrypto and encrypted IndexedDB device fixture',isSecureContext&&!!crypto.subtle&&!!device.keys());
 // This local fixture supplies only the transport's pinned header fields. It
 // is not a real directory/enrollment/product authorization acceptance.
 const directory={ownerId:owner,scopeId:'personal:'+owner,securityEpoch:1,checkpoint:{revision:1,hash:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}} as unknown as VerifiedDirectory;
 const raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);const signer=device.keys().signing.publicKey,sizes=[4*1024*1024,3,3],rows:E2eeEnvelope[]=[];
 for(const[index,pair]of (['a','b','chunk-a'] as const).entries()){
  const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:owner,scopeId:directory.scopeId,domain:index===2?'attachment':'workspace',objectId:pair,schemaVersion:1,dataGeneration:2,
   writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'content-root',deviceId:device.deviceId,operationId:crypto.randomUUID()};
  const bytes=new Uint8Array(sizes[index]);for(let at=0;at<bytes.length;at++)bytes[at]=(at*31+index*17)&255;
  try{rows.push(await sealE2eeEnvelope(root,device.keys().signing.privateKey,context,bytes));}finally{bytes.fill(0);}
 }
 let mode='normal';const calls:Awaited<ReturnType<typeof verifyE2eeCommand>>[]=[];
 const request:E2eeMigrationRequest=async(path,packet)=>{
  if(path!=='/read')throw new Error('NO_NONREAD_PORT');const command=await verifyE2eeCommand(packet as SignedE2eeCommand,signer);calls.push(command);
  const payload=command.payload,selected=rows.filter(row=>row.context.domain===payload.domain&&(command.action==='get'?row.context.objectId===payload.objectId:mode==='loop'||row.context.objectId>String(payload.after))).slice(0,1).map(row=>structuredClone(row));
  if(mode==='foreign'&&selected[0])selected[0].context.scopeId='personal:foreign';if(mode==='oversized'){selected.push(...[structuredClone(rows[0]),structuredClone(rows[0])]);}
  if(mode==='get-duplicate'&&selected[0])selected.push(structuredClone(selected[0]));
  return{checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision+(mode==='directory'?1:0),envelopes:selected as unknown as WireValue[]};
 };
 const transport=new SignedMigrationTransport(device,directory,['workspace'],request),hashes:string[]=[];let total=0,exact=true;
 progress('bounded inventory authenticates each complete envelope');const count=await transport.forEachEnvelope(async envelope=>{
  const index=rows.findIndex(row=>row.context.objectId===envelope.context.objectId);if(index<0)throw new Error('WRONG_OBJECT');
  const bytes=await openE2eeEnvelope(root,signer,rows[index].context,envelope);try{for(let at=0;at<bytes.length;at++)if(bytes[at]!==((at*31+index*17)&255)){exact=false;break;}
   hashes.push(encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))));total+=bytes.length;
  }finally{bytes.fill(0);}
 });
 check('one-envelope pages include attachments and final empty pages with pinned headers',count===3&&calls.length===5&&calls.every(command=>command.action==='read'&&command.payload.limit===1));
 check('every byte including the largest4MiB envelope opens under exact original context',exact&&total===sizes.reduce((a,b)=>a+b,0));
 const expected:string[]=await(await fetch('/expected.json')).json();check('all complete plaintext hashes match independent bounded Node construction',JSON.stringify(hashes)===JSON.stringify(expected));
 const fetched=await transport.getEnvelope('workspace','a');check('direct signed get returns the exact original encrypted object',!!fetched&&await envelopePayloadHash(fetched)===await envelopePayloadHash(rows[0]));
 check('absent exact object returns no invented envelope',await transport.getEnvelope('workspace','missing')===null);
 let before=calls.length,denied=0;for(const[domain,id]of [['diary','a'],['workspace','']] as const)try{await transport.getEnvelope(domain,id);}catch{denied++;}
 check('invalid IDs and disallowed domains refuse before request IO',denied===2&&calls.length===before);
 let invalid=0;for(const changed of ['loop','foreign','oversized','directory']){mode=changed;try{await transport.forEachEnvelope(async()=>{});}catch{invalid++;}}
 for(const changed of ['foreign','directory','get-duplicate']){mode=changed;try{await transport.getEnvelope('workspace','a');}catch{invalid++;}}
 check('loops foreign scopes oversized pages and changed checkpoints cannot complete',invalid===7);mode='normal';before=calls.length;let failed=false;
 try{await transport.forEachEnvelope(async()=>{throw new Error('E2EE_NO_SPACE');});}catch(error){failed=(error as Error).message==='E2EE_NO_SPACE';}
 check('a failed sink cannot fetch a following page',failed&&calls.length===before+1);
 const utf8=await readE2eeJsonResponse(await fetch('/http/utf8'),'/e2ee/v1/source',()=>{});check('real HTTP UTF8 JSON is bounded before parsing',utf8?.fixture==='α😀ёж');
 let tooLarge=0;for(const route of ['/http/declared-large','/http/actual-large'])try{await readE2eeJsonResponse(await fetch(route),'/e2ee/v1/source',()=>{});}catch(error){if((error as Error).message==='E2EE_RESPONSE_TOO_LARGE')tooLarge++;}
 check('declared and actual oversized HTTP bodies cannot yield parsed prefixes',tooLarge===2);
 check('bounded HTML HTTP errors preserve their non-success result',await readE2eeJsonResponse(await fetch('/http/error'),'/e2ee/v1/read',()=>{})===null);
 let badUtf8=false;try{await readE2eeJsonResponse(await fetch('/http/bad-utf8'),'/e2ee/v1/read',()=>{});}catch(error){badUtf8=(error as Error).message==='E2EE_INVALID_RESPONSE';}
 check('invalid HTTP UTF8 never becomes a success object',badUtf8);
 const nonByte=new Response(new ReadableStream({start(controller){controller.enqueue('synthetic-wire-canary');}}),{headers:{'Content-Type':'application/json'}});let badChunk=false;
 try{await readE2eeJsonResponse(nonByte,'/e2ee/v1/read',()=>{});}catch(error){badChunk=(error as Error).message==='E2EE_INVALID_RESPONSE';}
 check('non-byte response chunks keep a sanitized protocol error through cleanup',badChunk&&!nonByte.body!.locked);
 const loan=new TextEncoder().encode('{"x":'),body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(loan);}});let guards=0,retiredBody=false;
 const response=new Response(body,{headers:{'Content-Type':'application/json'}});try{await readE2eeJsonResponse(response,'/e2ee/v1/read',()=>{if(++guards===3)throw new Error('E2EE_ACCOUNT_CHANGED');});}catch(error){retiredBody=(error as Error).message==='E2EE_ACCOUNT_CHANGED';}
 check('retirement during body reading wipes the borrowed chunk and unlocks the stream',retiredBody&&loan.every(byte=>byte===0)&&!response.body!.locked);
 let hit:()=>void=()=>{},release:()=>void=()=>{};const reached=new Promise<void>(resolve=>{hit=resolve;});before=calls.length;
 const pending=transport.forEachEnvelope(async()=>{hit();await new Promise<void>(resolve=>{release=resolve;});}).then(()=>false,error=>(error as Error).message==='E2EE_UNLOCK_REQUIRED');
 await reached;check('an outstanding sink prevents any prefetch',calls.length===before+1);device.lock();release();check('device retirement after sink acknowledgement prevents further IO',await pending&&calls.length===before+1);
}catch(error){report.error=(error as Error).message.slice(0,200);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS bounded readback';
