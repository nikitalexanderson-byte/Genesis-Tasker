import {openOriginalLegacySnapshot,type OriginalLegacySnapshotOptions} from '../../app/e2ee/original-source.ts';
import {IndexedDbE2eeStorage,UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {decodeE2eeBytes,encodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';
import {freshSecret,generateDeviceKeys,protectBundle,openBundle} from '../../app/e2ee/keys.ts';
import {E2EE_CHUNK_BYTES} from '../../app/e2ee/files.ts';
import {requiredPrivatePaths} from '../../app/e2ee/migration-sources.ts';
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const show=(stage:string)=>{document.querySelector('#result')!.textContent=JSON.stringify({...report,status:'RUNNING',stage},null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show(name);if(!passed)throw new Error(name);};
const refuses=async(body:()=>unknown|Promise<unknown>)=>{try{await body();return false;}catch(error){return error instanceof Error&&error.message.startsWith('E2EE_');}};
try{
 check('actual secure WebCrypto and encrypted IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const storage=new IndexedDbE2eeStorage(),keys=await generateDeviceKeys(),raw=freshSecret(),secret=freshSecret(),original={ownerId:'original-actor',scopeId:'device:original-legacy',deviceId:'original-device',generation:1,cryptoEpoch:1,securityEpoch:1};
 const saved=await protectBundle(original.ownerId,'synthetic-old-root-only',secret,raw),root=await importE2eeRoot(raw);raw.fill(0);
 const old=new UnlockedE2eeVault(storage,{...original,keyId:'old-local-root',signingKey:keys.signing.privateKey,roots:new Map([['old-local-root',root]]),trustedSigner:id=>id===original.deviceId?keys.signing.publicKey:undefined});
 const target={ownerId:'content-owner',scopeId:'project:original-legacy',kind:'project' as const},paths=requiredPrivatePaths('project').map(row=>row.id),values=paths.map((_,index)=>Uint8Array.from({length:index?3:1024*1024+7},(_,at)=>(at*31+index*17)&255));
 const bytes=new TextEncoder().encode(JSON.stringify({protocol:1,ownerId:target.ownerId,scopeId:target.scopeId,paths:paths.map((id,index)=>({id,bytes:encodeE2eeBytes(values[index])}))})),migrationId=crypto.randomUUID();
 const reference={migrationId,snapshotSize:bytes.length,snapshotParts:Math.ceil(bytes.length/E2EE_CHUNK_BYTES),snapshotHash:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))};
 for(let index=0;index<reference.snapshotParts;index++)await old.write([{domain:'local-snapshot',objectId:`${migrationId}:source:${index}`,value:bytes.subarray(index*E2EE_CHUNK_BYTES,(index+1)*E2EE_CHUNK_BYTES),expected:null}]);bytes.fill(0);old.lock();
 const recovered=await openBundle(original.ownerId,'synthetic-old-root-only',secret,saved);secret.fill(0);let recoveredRoot:CryptoKey;try{recoveredRoot=await importE2eeRoot(recovered);}finally{recovered.fill(0);}
 const signer=await crypto.subtle.importKey('spki',await crypto.subtle.exportKey('spki',keys.signing.publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const activeKeys=await generateDeviceKeys(),activeRaw=freshSecret(),activeRoot=await importE2eeRoot(activeRaw);activeRaw.fill(0);const active=new UnlockedE2eeVault(storage,{ownerId:original.ownerId,scopeId:'device:new',deviceId:'new-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'new-local-root',signingKey:activeKeys.signing.privateKey,roots:new Map([['new-local-root',activeRoot]]),trustedSigner:id=>id==='new-device'?activeKeys.signing.publicKey:undefined});
 await active.write([{domain:'draft',objectId:'new-device-work',value:new Uint8Array([9,8,7]),expected:null}]);const identity=active.localIdentity();let live=true;
 const options:OriginalLegacySnapshotOptions={storage:new IndexedDbE2eeStorage(),original,roots:new Map([['old-local-root',recoveredRoot]]),signer,target,paths,reference,assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');}};
 const read=async(handle:Awaited<ReturnType<typeof openOriginalLegacySnapshot>>,index:number)=>{const source=handle.openPath(paths[index]);let at=0,prior:Uint8Array|undefined;for await(const chunk of source.chunks){if(prior&&!prior.every(value=>value===0))throw new Error('E2EE_BORROW_EXPIRED');for(let offset=0;offset<chunk.length;offset++)if(chunk[offset]!==values[index][at+offset])throw new Error('E2EE_ORIGINAL_BYTE_MISMATCH');at+=chunk.length;prior=chunk;}source.assertComplete();if(at!==values[index].length||!prior?.every(value=>value===0))throw new Error('E2EE_INCOMPLETE_ORIGINAL');return at;};
 show('read old actor through independent roots and public signer');const handle=await openOriginalLegacySnapshot(options);let total=0;for(let index=0;index<paths.length;index++)total+=await read(handle,index);
 check('cold original encrypted rows open with independent root and imported public signer',total===1024*1024+22);
 check('handle exposes only immutable original reference paths open and close',Object.isFrozen(handle)&&Object.isFrozen(handle.reference)&&JSON.stringify(Object.keys(handle).sort())===JSON.stringify(['close','openPath','paths','reference']));
 const draft=await active.read('draft','new-device-work');let retained=false;if(draft){try{retained=draft.value.join(',')==='9,8,7';}finally{draft.value.fill(0);}}
 check('new active identity and its protected pending work are unchanged',retained&&JSON.stringify(active.localIdentity())===JSON.stringify(identity));handle.close();
 const other=await generateDeviceKeys();check('a private signer cannot be imported as original read authority',await refuses(()=>openOriginalLegacySnapshot({...options,signer:other.signing.privateKey})));
 check('wrong original generation never falls back to new-device keys',await refuses(()=>openOriginalLegacySnapshot({...options,original:{...original,generation:2}})));
 check('a missing original root refuses instead of creating an empty source',await refuses(()=>openOriginalLegacySnapshot({...options,roots:new Map()})));
 check('an oversized reference refuses before any original body lookup',await refuses(()=>openOriginalLegacySnapshot({...options,reference:{...reference,snapshotParts:1e12}})));
 check('source-stage references are not interpreted as legacy snapshots',await refuses(()=>openOriginalLegacySnapshot({...options,reference:{stageId:crypto.randomUUID(),manifestHash:'A'.repeat(43)} as unknown as typeof reference})));
 const closed=await openOriginalLegacySnapshot(options),reader=closed.openPath(paths[0]),first=await reader.chunks.next();closed.close();
 check('original-capability close wipes borrowed plaintext and revokes continuation',!first.done&&first.value.every(value=>value===0)&&await refuses(()=>reader.chunks.next()));
 let release!:()=>void,arrive!:()=>void,pause=false;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{arrive=resolve;});const port={get:async(key:string)=>{if(pause){arrive();await gate;}return storage.get(key);},list:storage.list.bind(storage)};
 const pendingOwner=await openOriginalLegacySnapshot({...options,storage:port});pause=true;const pending=pendingOwner.openPath(paths[1]).chunks.next();await entered;pendingOwner.close();release();check('close during actual IndexedDB lookup returns no original plaintext',await refuses(()=>pending));
 const retired=await openOriginalLegacySnapshot(options),retiredReader=retired.openPath(paths[1]);live=false;check('original-actor retirement blocks later source reads',await refuses(()=>retiredReader.chunks.next()));retired.close();live=true;
 const final=await openOriginalLegacySnapshot(options);check('all original rows remain readable after refused authority attempts',await read(final,0)===values[0].length);final.close();
 check('returned capabilities contain no roots signer storage write or restore authority',['roots','signer','storage','write','restore','keys'].every(name=>!(name in handle)));
 active.lock();for(const value of values)value.fill(0);decodeE2eeBytes(reference.snapshotHash,32);report.status='PASS';document.title='PASS GENESIS original legacy source';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.message:String(error);document.title='FAIL GENESIS original legacy source';}
document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);
