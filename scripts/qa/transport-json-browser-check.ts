import {e2eeRequest,loadGenesisSession} from '../../app/cloud-sync';
import {readE2eeJsonResponse} from '../../app/e2ee/http-response.ts';
import {IndexedDbE2eeStorage,UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys} from '../../app/e2ee/keys.ts';
import {importE2eeRoot} from '../../app/e2ee/envelope.ts';
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string;cases?:number;expectedHttpErrors?:number}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const show=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show();if(!passed)throw new Error(name);};
const outcome=async(run:()=>Promise<unknown>)=>{try{return{ok:true,value:await run(),error:''};}catch(error){return{ok:false,error:error instanceof Error?error.message:String(error)};}};
const control=async(index:number,status:number,mode='corpus')=>{const response=await fetch(`/control?case=${index}&status=${status}&mode=${mode}`);if(!response.ok)throw new Error('Fixture control failed');return await response.json();};
try{
 check('secure browser uses actual WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
 const actor={ownerId:'wire-owner',scopeId:'device:wire-json',deviceId:'wire-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'wire-local-root',signingKey:keys.signing.privateKey,roots:new Map([['wire-local-root',root]]),trustedSigner:(id:string)=>id==='wire-device'?keys.signing.publicKey:undefined};
 let storage=new IndexedDbE2eeStorage(),vault=new UnlockedE2eeVault(storage,actor);
 const marker=new TextEncoder().encode('retained-synthetic-pending-work');try{await vault.write([{domain:'outbox',objectId:'wire-original',value:marker,expected:null}]);}finally{marker.fill(0);}
 const snapshot=async()=>JSON.stringify(await Promise.all((await storage.list('')).map(async key=>[key,await storage.get(key)])));
 const before=await snapshot();check('actual authenticated session binds the synthetic account',(await loadGenesisSession())?.uid==='wire-owner');
 const localBefore=JSON.stringify(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]));
 const corpus=await(await fetch('/corpus.json')).json() as {cases:{id:string;raw?:string;hex?:string;valid:boolean}[]};
 check('shared44-case wire corpus loaded',corpus.cases.length===44);let admitted=0,refused=0,errorReplies=0;
 for(const[index,row]of corpus.cases.entries()){
  await control(index,200);const actual=await outcome(()=>e2eeRequest('/source',{scopeId:'personal:synthetic'}));
  check('actual authenticated wire: '+row.id,row.valid?actual.ok:!actual.ok&&actual.error==='E2EE_INVALID_RESPONSE');
  if(actual.ok)admitted++;else refused++;
  const bytes=row.hex?new Uint8Array(row.hex.match(/../g)!.map(value=>parseInt(value,16))):new TextEncoder().encode(row.raw!);
  const response=new Response(new ReadableStream<Uint8Array>({start(controller){for(let at=0;at<bytes.length;at++)controller.enqueue(bytes.slice(at,at+1));controller.close();}}),{status:409,headers:{'Content-Type':'application/json'}});
  const error=await readE2eeJsonResponse(response,'/e2ee/v1/source',()=>{});check('split HTTP error: '+row.id,row.valid?error!==null:error===null);
  bytes.fill(0);check('unchanged encrypted originals: '+row.id,await snapshot()===before);
 }
 check('actual channel admits8 and rejects36 success bodies',admitted===8&&refused===36);
 for(const[index,expected]of [[11,'GENESIS API 409'],[0,'E2EE_SOURCE_CHANGED']] as const){
  await control(index,409,index===0?'code':'corpus');errorReplies++;
  const result=await outcome(()=>e2eeRequest('/source',{}));check('actual error does not mint ambiguous migration authority: '+index,!result.ok&&result.error===expected);
 }
 check('all previous localStorage entries remain identical',JSON.stringify(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))===localBefore);
 await control(0,200,'slow');const pending=outcome(()=>e2eeRequest('/source',{}));
 for(let count=0;count<100;count++){if((await control(0,200,'state')).held)break;if(count===99)throw new Error('Slow wire not reached');await new Promise(resolve=>setTimeout(resolve,20));}
 await control(0,200,'retire');check('new authenticated owner retires old streamed response',(await loadGenesisSession())?.uid==='wire-retired-owner');
 const retired=await pending;check('old stream cannot publish a successful response after account change',!retired.ok);
 vault.lock();storage=new IndexedDbE2eeStorage();vault=new UnlockedE2eeVault(storage,actor);
 check('cold encrypted inventory remains byte-identical',await snapshot()===before);
 const saved=await vault.read('outbox','wire-original');try{check('retained original still authenticates after wire refusals',!!saved&&new TextDecoder().decode(saved.value)==='retained-synthetic-pending-work');}finally{saved?.value.fill(0);vault.lock();}
 report.status='PASS';report.cases=corpus.cases.length;report.expectedHttpErrors=errorReplies;document.title='PASS GENESIS strict wire JSON';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.message:String(error);document.title='FAIL GENESIS strict wire JSON';}
show();
