import {openOriginalSourceStage,type OriginalSourceIdentity,type OriginalSourceOptions} from '../../app/e2ee/original-source.ts';
import {IndexedDbE2eeStorage,type SealedLocalRecord} from '../../app/e2ee/storage.ts';
import {decodeE2eeBytes,importE2eeRoot,type E2eeEnvelope} from '../../app/e2ee/envelope.ts';
import {generateDeviceKeys} from '../../app/e2ee/keys.ts';
import type {SourceStageTarget,SourceStageReference} from '../../app/e2ee/source-stage.ts';
type Vector={synthetic:boolean;original:OriginalSourceIdentity;target:SourceStageTarget;reference:SourceStageReference;keyId:string;rootKey:string;publicKeySpki:string;
 paths:{id:string;plaintext:string}[];records:{key:string;serial:number;envelope:E2eeEnvelope}[]};
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});if(!passed)throw new Error(name);};
async function rig(vector:Vector){
 const seed=new IndexedDbE2eeStorage();for(const row of vector.records){const old=await seed.get(row.key);if(old){if(JSON.stringify(old)!==JSON.stringify({serial:row.serial,envelope:row.envelope}))throw new Error('PUBLIC_FIXTURE_CONFLICT');}
  else await seed.commit([{key:row.key,expected:null,value:{serial:row.serial,envelope:row.envelope}}]);}
 const cold=new IndexedDbE2eeStorage(),root=await importE2eeRoot(decodeE2eeBytes(vector.rootKey,32)),signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(vector.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const before=JSON.stringify(await Promise.all(vector.records.map(row=>cold.get(row.key))));
 const storage={get:(key:string)=>cold.get(key),list:(prefix:string)=>cold.list(prefix)};
 const options:OriginalSourceOptions={storage,original:{...vector.original},roots:new Map([[vector.keyId,root]]),signer,target:{...vector.target},reference:{...vector.reference},assertCurrent:()=>{}};
 return{options,cold,before,unchanged:async()=>before===JSON.stringify(await Promise.all(vector.records.map(row=>cold.get(row.key))))};
}
async function consume(handle:Awaited<ReturnType<typeof openOriginalSourceStage>>,vector:Vector){let total=0;
 for(const path of vector.paths){const reader=handle.openPath(path.id),expected=decodeE2eeBytes(path.plaintext,1,1024);let at=0,previous:Uint8Array|undefined;
  try{for await(const part of reader.chunks){if(previous&&!previous.every(value=>value===0))throw new Error('BORROWED_PREFIX_NOT_WIPED');
   if(part.length>256*1024||part.some((value,index)=>value!==expected[at+index]))throw new Error('ORIGINAL_BYTES_MISMATCH');at+=part.length;previous=part;}
   reader.assertComplete();if(at!==expected.length||!previous?.every(value=>value===0))throw new Error('INCOMPLETE_ORIGINAL_BYTES');total+=at;
  }finally{expected.fill(0);}
 }
 return total;
}
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const [web,native]:Vector[]=await Promise.all(['/web.json','/native.json'].map(async path=>{const response=await fetch(path);if(!response.ok)throw new Error('SYNTHETIC_FIXTURE_UNAVAILABLE');return response.json();}));
 for(const [name,vector]of [['web',web],['fresh JCA',native]] as const){
  const f=await rig(vector),handle=await openOriginalSourceStage(f.options);try{check(name+' original stage opens from a cold IDB connection with only roots and public signer',(await consume(handle,vector))>0);
   check(name+' handle exposes only immutable paths openPath close',JSON.stringify(Object.keys(handle).sort())===JSON.stringify(['close','openPath','paths'])&&Object.isFrozen(handle)&&Object.isFrozen(handle.paths));
   check(name+' read capability never changes original ciphertext/serials',await f.unchanged());
  }finally{handle.close();}
 }
 const f=await rig(web);let refused=true;const wrong=await generateDeviceKeys();
 for(const changed of [{original:{...web.original,ownerId:'foreign'}},{original:{...web.original,scopeId:'device:foreign'}},{original:{...web.original,deviceId:'new-device'}},
  {original:{...web.original,generation:2}},{original:{...web.original,cryptoEpoch:0}},{roots:new Map<string,CryptoKey>()},{signer:wrong.signing.publicKey},{signer:wrong.signing.privateKey},
  {target:{...web.target,ownerId:'foreign'}},{reference:{...web.reference,manifestHash:'A'.repeat(43)}}]){
  let rejected=false;try{const value=await openOriginalSourceStage({...f.options,...changed});value.close();}catch(error){rejected=(error as Error).message.startsWith('E2EE_');}refused=refused&&rejected;
 }
 check('foreign original actor scope generation epochs keys target and reference never become successful empty input',refused&&await f.unchanged());
 const capturedOptions={...f.options,original:{...web.original},target:{...web.target},reference:{...web.reference},roots:new Map(f.options.roots),storage:{...f.options.storage}};
 const pending=openOriginalSourceStage(capturedOptions);capturedOptions.original.ownerId='changed-owner';capturedOptions.target.scopeId='project:changed';capturedOptions.reference.manifestHash='invalid';capturedOptions.roots.clear();
 capturedOptions.assertCurrent=()=>{throw new Error('REPLACED_GUARD');};capturedOptions.storage.get=async()=>{throw new Error('REPLACED_GET');};
 const captured=await pending;try{check('original binding roots callbacks and storage methods are captured before the first await',(await consume(captured,web))>0);}finally{captured.close();}
 const handle=await openOriginalSourceStage(f.options),reader=handle.openPath(web.paths[0].id);let busy=false;try{handle.openPath(web.paths[0].id);}catch(error){busy=(error as Error).message==='E2EE_ORIGINAL_SOURCE_PATH_BUSY';}
 check('one active reader per original path bounds the working set',busy);const first=await reader.chunks.next();if(first.done)throw new Error('MISSING_PUBLIC_SOURCE');handle.close();
 let closed=false;try{await reader.chunks.next();}catch(error){closed=(error as Error).message==='E2EE_ORIGINAL_SOURCE_CLOSED';}
 let complete=false;try{reader.assertComplete();complete=true;}catch{/* Expected: closed prefix grants no EOF. */}
 check('capability close wipes currently borrowed bytes and refuses complete-source receipt',closed&&!complete&&first.value.every(value=>value===0));
 for(const mode of ['close','actor']){
  let live=true,trigger=false;
  const options={...f.options,assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},storage:{list:f.options.storage.list,
   get:async(key:string):Promise<SealedLocalRecord|null>=>{const row=await f.options.storage.get(key);if(trigger&&key.includes(':p:00:00000')){if(mode==='close')active.close();else live=false;}return row;}}};
  const active=await openOriginalSourceStage(options);trigger=true;const source=active.openPath(web.paths[0].id);let errorCode='';
  try{await source.chunks.next();}catch(error){errorCode=(error as Error).message;}finally{active.close();}
  check(mode+' during actual IDB fetch returns no original plaintext',errorCode===(mode==='close'?'E2EE_ORIGINAL_SOURCE_CLOSED':'E2EE_ACCOUNT_CHANGED'));
 }
 check('all original fixture records remain exact after refusal and retirement',await f.unchanged());
}catch(error){report.error=(error as Error).message.slice(0,180);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS original source';
