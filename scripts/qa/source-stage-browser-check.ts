import {ProtectedSourceStage,inspectSourceStages,openSourceStage} from '../../app/e2ee/source-stage.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {createRecoveryKit} from '../../app/e2ee/keys.ts';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from '../../app/e2ee/device-vault.ts';
import {E2EE_CHUNK_BYTES} from '../../app/e2ee/files.ts';
import {checkNativeSourceStageVector} from './source-stage-interop-browser-check.ts';

const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];error?:string;status?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});if(!passed)throw new Error(name);};
async function refuses(name:string,work:()=>Promise<unknown>){let refused=false;try{await work();}catch{refused=true;}check(name,refused);}
let device:UnlockedWebDevice|undefined,recovery:Awaited<ReturnType<typeof createRecoveryKit>>|undefined;
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 recovery=await createRecoveryKit('source-stage-browser-'+crypto.randomUUID());const owner=recovery.kit.ownerId;
 const storage=new IndexedDbE2eeStorage();device=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,storage,new IndexedDbDeviceKeyStorage());
 let live=true;const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const target={ownerId:'different-content-owner',scopeId:'project:browser-source',kind:'project' as const};
 const options={vault:device.vault,target,paths:['project.content','project.local-work'],capacity:{maximumBytes:16*1024*1024,maximumParts:64},ensureDurableKeys:()=>device!.ensureDurableKeys(),assertCurrent:current,
  admit:async(request:{metadataBytes:number})=>{const estimate=await navigator.storage.estimate();if(estimate.quota===undefined||estimate.usage===undefined||estimate.quota-estimate.usage<2*E2EE_CHUNK_BYTES+2*request.metadataBytes)throw new Error('E2EE_SOURCE_STAGE_CAPACITY');}};
 const crashed=await ProtectedSourceStage.create(options),original=new Uint8Array(E2EE_CHUNK_BYTES).fill(37);
 await refuses('source tag failure leaves inert SQLite-equivalent IDB stage',()=>crashed.capturePath(options.paths[0],async write=>{await write(original);throw new Error('SYNTHETIC_TAG_FAILURE');}));original.fill(0);
 check('incomplete stage discovered explicitly',(await inspectSourceStages(device.vault,target,current))[0].complete===false);
 const kept=(await storage.list('')).filter(key=>!key.includes('source-stage-catalog:')),before=new Map(await Promise.all(kept.map(async key=>[key,JSON.stringify(await storage.get(key))] as const)));
 const stage=await ProtectedSourceStage.create(options),length=9*1024*1024+13;
 const lengths=[length,65543];
 for(const [path,id]of options.paths.entries())await stage.capturePath(id,async write=>{
  let at=0;const chunk=new Uint8Array(65536);
  try{while(at<lengths[path]){const size=Math.min(chunk.length,lengths[path]-at);for(let index=0;index<size;index++)chunk[index]=((at+index)*37)&255;await write(chunk.subarray(0,size));at+=size;}}
  finally{chunk.fill(0);}
 });
 const ref=await stage.finish();check('readback manifest completes before any coordinator or IO authority',!!ref.manifestHash);
 device.lock();device=await UnlockedWebDevice.unlock(owner,recovery.secret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
 const history=await inspectSourceStages(device.vault,target,current);check('new connection preserves incomplete and complete attempts',history.length===2&&!history[0].complete&&history[1].complete);
 for(const[key,value]of before)check('original incomplete record preserved '+key.includes(':p:'),JSON.stringify(await storage.get(key))===value);
 const opened=await openSourceStage(device.vault,target,ref,current);
 for(const [path,id]of opened.paths.entries()){
  const reader=opened.openPath(id);let at=0,exact=true;for await(const chunk of reader.chunks){for(let index=0;index<chunk.length;index++)if(chunk[index]!==((at+index)*37&255))exact=false;at+=chunk.length;}reader.assertComplete();check('cold read complete original '+id,exact&&at===lengths[path]);
 }
 const early=opened.openPath(options.paths[0]),first=await early.chunks.next();await early.chunks.return(undefined);
 check('borrowed prefix wiped on early close',first.value instanceof Uint8Array&&first.value.every(byte=>byte===0));
 await refuses('early close cannot certify EOF',async()=>early.assertComplete());
 const blocked=opened.openPath(options.paths[0]);live=false;await refuses('actor retirement prevents a new plaintext chunk',()=>blocked.chunks.next());live=true;
 const denied=await ProtectedSourceStage.create({...options,vault:device.vault,paths:['project.content'],capacity:{maximumBytes:1,maximumParts:1}});
 await refuses('capacity refusal remains explicit',()=>denied.capturePath('project.content',write=>write(Uint8Array.of(1,2))));
 check('capacity failure never becomes completed source',(await inspectSourceStages(device.vault,target,current)).at(-1)?.complete===false);
 device.lock();device=undefined;
 const native=await fetch('/native-source-stage.json');if(!native.ok)throw new Error('SYNTHETIC_NATIVE_VECTOR_REQUIRED');
 const nativeText=await native.text();if(nativeText.length>128*1024)throw new Error('SYNTHETIC_VECTOR_LIMIT');
 const interop=await checkNativeSourceStageVector(JSON.parse(nativeText));
 check('actual JCA signed stage opens in Chromium and IndexedDB',interop.producer.startsWith('Android/JCA API')&&interop.paths===2&&interop.bytes===63);
}catch(error){report.error=(error as Error).message.slice(0,180);}finally{device?.lock();recovery?.secret.fill(0);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS source stage';
