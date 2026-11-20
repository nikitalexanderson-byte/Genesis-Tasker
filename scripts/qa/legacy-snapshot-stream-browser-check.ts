import {sha256} from '@noble/hashes/sha2.js';
import {openLegacyMigrationSnapshot} from '../../app/e2ee/legacy-snapshot-stream.ts';
import {IndexedDbE2eeStorage,UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {encodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';
import {freshSecret,generateDeviceKeys} from '../../app/e2ee/keys.ts';
import {E2EE_CHUNK_BYTES} from '../../app/e2ee/files.ts';
import {requiredPrivatePaths} from '../../app/e2ee/migration-sources.ts';
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const show=(stage:string)=>{document.querySelector('#result')!.textContent=JSON.stringify({...report,status:'RUNNING',stage},null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show(name);if(!passed)throw new Error(name);};
const refuses=async(body:()=>unknown|Promise<unknown>)=>{try{await body();return false;}catch(error){return error instanceof Error&&error.message.startsWith('E2EE_');}};
try{
 check('actual secure WebCrypto and encrypted IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);let live=true;
 const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const actor={ownerId:'legacy-actor',scopeId:'device:legacy-reader',deviceId:'legacy-device'},scope={...actor,generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'local-root',signingKey:keys.signing.privateKey,roots:new Map([['local-root',root]]),trustedSigner:(id:string)=>id===actor.deviceId?keys.signing.publicKey:undefined};
 let vault=new UnlockedE2eeVault(new IndexedDbE2eeStorage(),scope);const target={ownerId:'content-owner',scopeId:'project:legacy-reader',kind:'project' as const},paths=requiredPrivatePaths('project').map(row=>row.id),migrationId=crypto.randomUUID(),digest=sha256.create(),encoder=new TextEncoder();
 const expected=await(await fetch('/expected.json')).json() as {rawHash:string;rawSize:number;hashes:string[];sizes:number[]};let count=0,used=0,parts=0;const buffer=new Uint8Array(E2EE_CHUNK_BYTES);
 const store=async()=>{await vault.write([{domain:'local-snapshot',objectId:`${migrationId}:source:${parts++}`,value:buffer.subarray(0,used),expected:null}]);buffer.fill(0);used=0;};
 const write=async(bytes:Uint8Array)=>{digest.update(bytes);count+=bytes.length;for(let at=0;at<bytes.length;){const n=Math.min(buffer.length-used,bytes.length-at);buffer.set(bytes.subarray(at,at+n),used);used+=n;at+=n;if(used===buffer.length)await store();}};
 const text=async(value:string)=>{const bytes=encoder.encode(value);try{await write(bytes);}finally{bytes.fill(0);}};
 show('write bounded original JSON/Base64 parts');await text('{"protocol":1,"ownerId":"content-owner","scopeId":"project:legacy-reader","paths":[');
 const block=new Uint8Array(65535);try{for(const[index,path]of paths.entries()){
  if(index)await text(',');await text(`{"id":${JSON.stringify(path)},"bytes":"`);const size=expected.sizes[index];
  for(let at=0;at<size;at+=block.length){const n=Math.min(block.length,size-at);for(let j=0;j<n;j++)block[j]=((at+j)*31+index*17)&255;await text(encodeE2eeBytes(block.subarray(0,n)));block.fill(0);}
  await text('"}');}await text(']}');if(used)await store();}finally{block.fill(0);buffer.fill(0);}
 const bytes=digest.digest(),snapshotHash=encodeE2eeBytes(bytes);bytes.fill(0);digest.destroy();
 check('entire original raw wrapper hash and length match independent bounded Node construction',snapshotHash===expected.rawHash&&count===expected.rawSize);
 const reference={migrationId,snapshotSize:count,snapshotParts:parts,snapshotHash};vault.lock();vault=new UnlockedE2eeVault(new IndexedDbE2eeStorage(),scope);
 const options={vault,target,paths,reference,assertCurrent:current};show('cold full original preflight');const opened=await openLegacyMigrationSnapshot(options);
 check('cold reader preserves exact original reference and all required paths',Object.isFrozen(opened)&&Object.isFrozen(opened.reference)&&JSON.stringify(opened.reference)===JSON.stringify(reference)&&opened.paths.length===6);
 let total=0,expired=true;for(const[index,path]of paths.entries()){
  show('stream original '+path);const reader=opened.openPath(path),hash=sha256.create();let size=0,prior:Uint8Array|undefined;
  try{for await(const part of reader.chunks){if(prior)expired=expired&&prior.every(value=>value===0);for(let offset=0;offset<part.length;offset++)if(part[offset]!==(((size+offset)*31+index*17)&255))throw new Error('E2EE_ORIGINAL_BYTE_MISMATCH');hash.update(part);size+=part.length;prior=part;}
   reader.assertComplete();if(prior)expired=expired&&prior.every(value=>value===0);const result=hash.digest();try{if(size!==expected.sizes[index]||encodeE2eeBytes(result)!==expected.hashes[index])throw new Error('E2EE_INCOMPLETE_ORIGINAL');}finally{result.fill(0);}total+=size;
  }finally{hash.destroy();}
 }
 check('every decoded original byte and all six hashes match independent Node construction',total===expected.sizes.reduce((a,b)=>a+b,0));check('every borrowed part stays zero after its lifetime',expired);
 check('unknown paths and incomplete EOF cannot be accepted',await refuses(()=>opened.openPath('project.unknown')));
 const partial=opened.openPath(paths[0]);await partial.chunks.next();check('a second live path cannot accumulate concurrent source buffers',await refuses(()=>opened.openPath(paths[1])));check('an unread tail cannot claim complete source EOF',await refuses(()=>partial.assertComplete()));await partial.chunks.return?.();
 opened.close();check('closed capabilities cannot open another original path',await refuses(()=>opened.openPath(paths[0])));
 const owned=await openLegacyMigrationSnapshot(options),prior=owned.openPath(paths[1]);for await(const part of prior.chunks){part.fill(0);}prior.assertComplete();const later=owned.openPath(paths[2]);await later.chunks.next();await prior.chunks.return?.();const laterDone=await later.chunks.next();later.assertComplete();check('closing an older completed reader does not cancel a later active path',laterDone.done===true);owned.close();
 let blockRead=false,release!:()=>void,arrive!:()=>void;const pendingRaw:Uint8Array[]=[],wait=new Promise<void>(resolve=>{release=resolve;}),arrived=new Promise<void>(resolve=>{arrive=resolve;});
 const pendingPort={assertUnlocked:()=>vault.assertUnlocked(),localIdentity:()=>vault.localIdentity(),listLocal:(domain:Parameters<typeof vault.listLocal>[0],prefix:string)=>vault.listLocal(domain,prefix),async read(domain:Parameters<typeof vault.read>[0],id:string){if(blockRead){arrive();await wait;}const row=await vault.read(domain,id);if(row)pendingRaw.push(row.value);return row;}};
 const pendingOwner=await openLegacyMigrationSnapshot({...options,vault:pendingPort}),pendingReader=pendingOwner.openPath(paths[1]);blockRead=true;const pending=pendingReader.chunks.next();await arrived;const concurrent=await refuses(()=>pendingReader.chunks.next());let reserved=false;
 try{pendingOwner.openPath(paths[2]);}catch(error){reserved=error instanceof Error&&error.message==='E2EE_LEGACY_SNAPSHOT_BUSY';}finally{release();}const stopped=await refuses(()=>pending);blockRead=false;check('raw parts arriving after revocation are wiped on actual drain',pendingRaw.every(part=>part.every(value=>value===0)));
 const afterDrain=pendingOwner.openPath(paths[2]);for await(const part of afterDrain.chunks){part.fill(0);}afterDrain.assertComplete();check('a rejected concurrent pull retains reservation until the original read drains',concurrent&&reserved&&stopped);pendingOwner.close();
 const rawParts:Uint8Array[]=[];const tracked={assertUnlocked:()=>vault.assertUnlocked(),localIdentity:()=>vault.localIdentity(),listLocal:(domain:Parameters<typeof vault.listLocal>[0],prefix:string)=>vault.listLocal(domain,prefix),async read(domain:Parameters<typeof vault.read>[0],id:string){const row=await vault.read(domain,id);if(row)rawParts.push(row.value);return row;}};
 const closeable=await openLegacyMigrationSnapshot({...options,vault:tracked}),closing=closeable.openPath(paths[0]),first=await closing.chunks.next();closeable.close();
 check('close immediately wipes raw wrapper and decoded buffers',!first.done&&first.value.every(value=>value===0)&&rawParts.every(part=>part.every(value=>value===0)));check('closed pending reader cannot continue',await refuses(()=>closing.chunks.next()));
 check('wrong complete original digest refuses a handle',await refuses(()=>openLegacyMigrationSnapshot({...options,reference:{...reference,snapshotHash:encodeE2eeBytes(new Uint8Array(32))}})));
 const retiring=await openLegacyMigrationSnapshot(options),retired=retiring.openPath(paths[0]);live=false;check('original actor retirement refuses continuation',await refuses(()=>retired.chunks.next()));retiring.close();live=true;
 const final=await openLegacyMigrationSnapshot(options);final.close();check('all protected originals remain readable after refused attempts',true);vault.lock();report.status='PASS';document.title='PASS GENESIS legacy snapshot stream';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.message:String(error);document.title='FAIL GENESIS legacy snapshot stream';}
document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);
