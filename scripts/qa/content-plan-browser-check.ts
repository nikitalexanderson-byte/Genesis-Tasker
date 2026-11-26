import {ProtectedMigrationContentPlan,openMigrationContentPlan,type MigrationContentPlanOptions} from '../../app/e2ee/content-plan.ts';
import {IndexedDbE2eeStorage,UnlockedE2eeVault,localRecordKey} from '../../app/e2ee/storage.ts';
import {E2EE_SUITE,decodeE2eeBytes,encodeE2eeBytes,importE2eeRoot,openE2eeEnvelope,type E2eeContext,type E2eeEnvelope} from '../../app/e2ee/envelope.ts';
import {freshSecret,generateDeviceKeys} from '../../app/e2ee/keys.ts';
import {requiredPrivatePaths} from '../../app/e2ee/migration-sources.ts';
import {openE2eeFileStream} from '../../app/e2ee/files.ts';
import {parseE2eeContentPlanJson} from '../../app/e2ee/file-manifest-json.ts';
import type {SourceStageReadVault} from '../../app/e2ee/source-stage.ts';

const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const progress=(stage:string)=>{document.querySelector('#result')!.textContent=JSON.stringify({...report,status:'RUNNING',stage},null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});progress(name);if(!passed)throw new Error(name);};
const digest=async(bytes:Uint8Array)=>encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))));
function generated(size:number,path:number,late=false){return(async function*(){for(let at=0;at<size;at+=65536){const bytes=new Uint8Array(Math.min(65536,size-at));for(let index=0;index<bytes.length;index++)bytes[index]=((at+index)*31+path*17)&255;try{yield bytes;}finally{bytes.fill(0);}}
 if(late)throw new Error('E2EE_OLD_TAG_INVALID');})();}
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const storage=new IndexedDbE2eeStorage(),keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);let live=true,complete=true;
 const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const identity={ownerId:'browser-plan-actor',scopeId:'device:browser-content-plan',deviceId:'browser-plan-device'},scope={...identity,generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'browser-local-root',
  signingKey:keys.signing.privateKey,roots:new Map([['browser-local-root',root]]),trustedSigner:(id:string)=>id===identity.deviceId?keys.signing.publicKey:undefined};
 const vault=new UnlockedE2eeVault(storage,scope),context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:'browser-content-owner',scopeId:'personal:browser-content-plan',domain:'workspace',objectId:'plan-context',schemaVersion:1,dataGeneration:2,
  writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'browser-content-root',deviceId:identity.deviceId,operationId:crypto.randomUUID()};
 const options:MigrationContentPlanOptions={vault,root,signer:keys.signing.publicKey,signingKey:keys.signing.privateKey,context,target:{ownerId:context.ownerId,scopeId:context.scopeId,kind:'personal'},
  migrationId:crypto.randomUUID(),sourceHash:await digest(new Uint8Array([7])),paths:requiredPrivatePaths('personal').map(path=>path.id),capacity:{maximumBytes:128*1024*1024,maximumEnvelopes:8000,maximumLocalParts:8000},
  ensureDurableKeys:async()=>{},assertCurrent:current,assertSourceComplete:async()=>{if(!complete)throw new Error('E2EE_SOURCE_STAGE_EOF_REQUIRED');},admit:async request=>{
   const estimate=await navigator.storage.estimate();if(estimate.quota!==undefined&&estimate.usage!==undefined&&estimate.quota-estimate.usage<request.additionalStorageBytes)throw new Error('E2EE_NO_SPACE');}};
 let callbacks=0;try{await ProtectedMigrationContentPlan.create({...options,paths:options.paths.slice(1),ensureDurableKeys:async()=>{callbacks++;}});}catch{/* Expected full registry refusal. */}
 check('full registry is checked before durable-key callbacks',callbacks===0);
 const stage=await ProtectedMigrationContentPlan.create(options),size=9*1024*1024+7;
 for(let index=0;index<2;index++){progress('writing generated file '+index);await stage.append('personal.workspace',{placement:'remote',domain:'workspace',objectId:'payload-'+index,size,source:generated(size,index),filename:'\ufeff\ud800-\udfff-α/'+index,mediaType:'application/octet-stream'});}
 await stage.append('personal.local-work',{placement:'local',domain:'workspace',objectId:'local-value',size:3,source:(async function*(){yield new Uint8Array([9,8,7]);})()});
 progress('complete plan publication and cold read');const coverage=options.paths.map(domain=>({domain,complete:true})),reference=await stage.finish(coverage);vault.lock();const cold=new IndexedDbE2eeStorage(),reader=new UnlockedE2eeVault(cold,scope);
 const opened=await openMigrationContentPlan({...options,vault:reader,reference});
 check('cold IDB opens both complete generated files and the local-only value',opened.logical.length===2&&opened.local.length===1&&opened.plan.length===76);
 const expected=await(await fetch('/expected.json')).json();check('whole original logical SHA256 matches independent bounded host hashing',opened.logical.every((row,index)=>row.plaintextHash===expected[index]));
 const lookup=new Map(opened.plan.map(row=>[row.objectId,row.recordId]));const get=async(id:string)=>{const row=await reader.read('outbox',id);if(!row)throw new Error('MISSING_PLAN_ENVELOPE');try{return JSON.parse(new TextDecoder().decode(row.value)) as E2eeEnvelope;}finally{row.value.fill(0);}};
 let total=0,expired=true;
 for(const[index,logical]of opened.logical.entries()){
  const envelope=await get(logical.manifestRecordId);let at=0,previous:Uint8Array|undefined;
  const metadata=await openE2eeFileStream({root,signer:keys.signing.publicKey,expectedContext:envelope.context,manifestEnvelope:envelope,fetchChunk:id=>get(lookup.get(id)!),assertCurrent:current,
   writeQuarantinedPlaintext:async bytes=>{if(previous)expired=expired&&previous.every(value=>value===0);for(let offset=0;offset<bytes.length;offset++)if(bytes[offset]!==(((at+offset)*31+index*17)&255))throw new Error('ORIGINAL_BYTE_MISMATCH');at+=bytes.length;previous=bytes;}});
  if(at!==size||metadata.filename!==`\ufeff\ud800-\udfff-α/${index}`)throw new Error('INCOMPLETE_ORIGINAL');expired=expired&&!!previous?.every(value=>value===0);total+=at;
 }
 check('bounded v1 readback checks every original byte and private filename unit',total===2*size);
 check('borrowed output expires at every sink and final EOF',expired);
 check('plan result descriptors are immutable and contain no local-only upload',Object.isFrozen(opened)&&Object.isFrozen(opened.plan)&&opened.plan.every(row=>row.objectId!=='local-value'));
 let late=false;const partial=await ProtectedMigrationContentPlan.create({...options,vault:reader});try{await partial.append('personal.workspace',{placement:'remote',domain:'workspace',objectId:'late',size:256*1024+1,source:generated(256*1024+1,0,true)});}catch(error){late=(error as Error).message==='E2EE_OLD_TAG_INVALID';}
 let publish=false;try{await partial.finish(coverage);publish=true;}catch{/* Expected inert prefix. */}check('late original authentication failure preserves an inert attempt without a final plan',late&&!publish);
 const pending=await ProtectedMigrationContentPlan.create({...options,vault:reader});await pending.append('personal.workspace',{placement:'remote',domain:'workspace',objectId:'incomplete',size:1,source:generated(1,0)});complete=false;
 let incomplete=false;try{await pending.finish(coverage);}catch(error){incomplete=(error as Error).message==='E2EE_SOURCE_STAGE_EOF_REQUIRED';}complete=true;check('an incomplete original source blocks complete-plan publication',incomplete);
 let admits=0;const noSpace=await ProtectedMigrationContentPlan.create({...options,vault:reader,admit:async()=>{if(++admits===4)throw new Error('E2EE_NO_SPACE');}});let refused=false;
 try{await noSpace.append('personal.workspace',{placement:'remote',domain:'workspace',objectId:'no-space',size:512*1024,source:generated(512*1024,0)});}catch(error){refused=(error as Error).message==='E2EE_NO_SPACE';}
 check('quota refusal retains earlier accepted complete plans',refused&&(await openMigrationContentPlan({...options,vault:reader,reference})).logical.length===2);
 const big=new TextEncoder().encode('{"rows":['+'0,'.repeat(140000)+'0]}');const syntax=parseE2eeContentPlanJson(big) as {rows:number[]};let rejects=true;
 for(const value of ['{"x":1,"\\u0078":2}','{x:1}','{"x":01}','{"x":1,}','{"x":1}{}']){let bad=false;try{parseE2eeContentPlanJson(new TextEncoder().encode(value));}catch{bad=true;}rejects=rejects&&bad;}
 check('strict bounded plan syntax rejects duplicate names and platform-lenient JSON',big.length>256*1024&&syntax.rows.length===140001&&rejects);
 const response=await fetch('/native.json');if(!response.ok)throw new Error('FRESH_SYNTHETIC_JCA_VECTOR_REQUIRED');const native=await response.json();
 if(native.synthetic!==true||native.warning!=='PUBLIC TEST KEYS; DO NOT USE FOR USER DATA')throw new Error('INVALID_PUBLIC_FIXTURE');
 const localRoot=await importE2eeRoot(decodeE2eeBytes(native.localRootKey,32)),contentRoot=await importE2eeRoot(decodeE2eeBytes(native.contentRootKey,32)),signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(native.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const records=new Map<string,{serial:number;envelope:E2eeEnvelope}>(native.records.map((row:{key:string;serial:number;envelope:E2eeEnvelope})=>[row.key,row]));
 const readOnly:SourceStageReadVault={assertUnlocked:()=>{},localIdentity:()=>({...native.actor}),async listLocal(domain,prefix){
  const frame=[native.actor.ownerId,native.actor.scopeId,domain].map(value=>`${value.length}:${value}`).join('');return[...records.keys()].filter(key=>key.startsWith(frame)).map(key=>{const rest=key.slice(frame.length),colon=rest.indexOf(':');const value=rest.slice(colon+1);if(Number(rest.slice(0,colon))!==value.length)throw new Error('BAD_PUBLIC_KEY_FRAME');return value;}).filter(id=>id.startsWith(prefix));},
  async read(domain,objectId){const row=records.get(localRecordKey(native.actor,domain,objectId));if(!row)return null;const ctx=row.envelope.context;
   if(ctx.ownerId!==native.actor.ownerId||ctx.scopeId!==native.actor.scopeId||ctx.deviceId!==native.actor.deviceId||ctx.domain!==domain||ctx.objectId!==objectId||ctx.revision!==row.serial||ctx.dataGeneration!==1||ctx.cryptoEpoch!==1||ctx.securityEpoch!==1||ctx.keyId!==native.localKeyId)throw new Error('BAD_PUBLIC_CONTEXT');
   return{serial:row.serial,value:await openE2eeEnvelope(localRoot,signer,ctx,row.envelope)};}};
 const accepted=await openMigrationContentPlan({vault:readOnly,root:contentRoot,signer,context:native.context,target:native.target,migrationId:native.migrationId,sourceHash:native.sourceHash,
  paths:native.paths,reference:native.reference,assertCurrent:()=>{}});
 check('fresh JCA content plan opens with public signer and separate roots through a read-only port',accepted.logical.length===2&&accepted.local.length===1&&accepted.logical[0].size===3&&accepted.logical[1].size===0);
 live=false;let retired=false;try{await openMigrationContentPlan({...options,vault:reader,reference});}catch(error){retired=(error as Error).message==='E2EE_ACCOUNT_CHANGED';}
 check('actor retirement returns no complete-plan receipt',retired);reader.lock();
}catch(error){report.error=(error as Error).message.slice(0,180);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS content plan';
