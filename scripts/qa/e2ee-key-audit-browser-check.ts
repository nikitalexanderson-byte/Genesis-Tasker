import { freshSecret, forwardRoot, importDeviceKeys, openBundle, openRoot, protectBundle, publicDeviceKeys, recoverAuthority, sealRoot, createRecoveryKit } from '../../app/e2ee/keys.ts';
import { decodeE2eeBytes, encodeE2eeBytes, importE2eeRoot, sealE2eeEnvelope, openE2eeEnvelope } from '../../app/e2ee/envelope.ts';
import { signE2eeCommand, type E2eeCommand, type WireValue } from '../../app/e2ee/commands.ts';
import { IndexedDbE2eeStorage, openE2eeDatabase } from '../../app/e2ee/storage.ts';
import { IndexedDbDeviceKeyStorage, UnlockedWebDevice, bindWebVaultLifecycle } from '../../app/e2ee/device-vault.ts';
import { verifyDeviceDirectory } from '../../app/e2ee/directory.ts';

const report:{synthetic:true;runtime:string;checks:{name:string;passed:boolean}[];inputs?:unknown;error?:string;status?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});if(!passed)throw new Error(name);};
async function reject(name:string,operation:()=>Promise<unknown>){let refused=false;try{await operation();}catch(error){refused=(error as Error).message.startsWith('E2EE_');}check(name,refused);}
const bytes=(value:string)=>new TextEncoder().encode(value),equal=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
try{
 check('secure Chromium WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const fixture=await(await fetch('/runtime.json')).json(),device=await importDeviceKeys(fixture.device),peer=await importDeviceKeys(fixture.secondDevice);
 const secret=decodeE2eeBytes(fixture.secret,32),owner=fixture.rootContext.ownerId;
 const first=await verifyDeviceDirectory(owner,fixture.rootContext.scopeId,fixture.recoveryKit.authority,fixture.directory.events.slice(0,1));
 const previous={...fixture.directory.checkpoint};
 const checking=verifyDeviceDirectory(owner,fixture.rootContext.scopeId,fixture.recoveryKit.authority,fixture.directory.events.slice(0,-1),previous);
 Object.assign(previous,first.checkpoint);
 await reject('trusted checkpoint cannot be lowered during asynchronous verification',()=>checking);
 check('established HKDF/GCM vector remains readable',encodeE2eeBytes(await openBundle(owner,'device-vault',secret,fixture.bundle))===fixture.plaintext);
 await reject('text secret refused before ciphertext',()=>protectBundle(owner,'device-vault','x'.repeat(32) as unknown as Uint8Array,bytes('synthetic')));
 for(const value of [Array(32).fill(7),{length:32},new Uint16Array(32)]){
  await reject('non-byte secret refused '+Object.prototype.toString.call(value),()=>protectBundle(owner,'device-vault',value as Uint8Array,bytes('synthetic')));
 }
 const plain=bytes('SYNTHETIC CAPTURE BEFORE KDF'),expected=new Uint8Array(plain),pending=protectBundle(owner,'device-vault',secret,plain);plain.fill(0);
 const bundle=await pending,opened=await openBundle(owner,'device-vault',secret,bundle);
 check('bundle owns plaintext before caller clears it',equal(opened,expected));opened.fill(0);
 const buffer=new ArrayBuffer(4,{maxByteLength:65537}),view=new Uint8Array(buffer);view.set([7,8,9,10]);
 const resizable=protectBundle(owner,'device-vault',secret,view);buffer.resize(65537);
 const small=await openBundle(owner,'device-vault',secret,await resizable);check('resizable input cannot exceed admitted bundle',equal(small,new Uint8Array([7,8,9,10])));small.fill(0);
 const rootBytes=decodeE2eeBytes(fixture.root,32),rootCopy=new Uint8Array(rootBytes),recipient={...fixture.rootContext};
 const sealing=sealRoot(rootCopy,fixture.device.receivingKey,recipient);rootCopy.fill(0);recipient.scopeId='different-scope';
 const capsule=await sealing,opening=openRoot(capsule,device.receiving.privateKey,fixture.rootContext);capsule.ciphertext='invalid';
 const root=await opening,originalRoot=await importE2eeRoot(rootBytes),clear=bytes('SYNTHETIC HPKE KEY INPUT');
 const envelope=await sealE2eeEnvelope(originalRoot,device.signing.privateKey,fixture.file.manifest.context,clear);
 check('HPKE owns original root, recipient binding and opening capsule',equal(await openE2eeEnvelope(root,device.signing.publicKey,envelope.context,envelope),clear));
 const source={...fixture.rootContext},target={...source,recipientId:'audit-peer'},intended={...target};
 const forwarding=forwardRoot(fixture.rootCapsule,device.receiving.privateKey,source,fixture.secondDevice.receivingKey,target);
 target.ownerId='different-owner';target.scopeId='different-scope';target.cryptoEpoch++;target.keyId='different-key';
 const forwarded=await forwarding;
 await reject('pending forwarding cannot rebind owner, scope, epoch or key',()=>openRoot(forwarded,peer.receiving.privateKey,target));
 await openRoot(forwarded,peer.receiving.privateKey,intended);check('original forward recipient remains readable',true);
 const privateInput={...fixture.device},importing=importDeviceKeys(privateInput);privateInput.signingPrivate='invalid';privateInput.receivingPrivate='invalid';
 check('imported private pair uses immutable original fields',JSON.stringify(await publicDeviceKeys(await importing))===JSON.stringify(await publicDeviceKeys(device)));
 const kit=structuredClone(fixture.recoveryKit),recovering=recoverAuthority(owner,secret,kit);kit.authority.signingKey='invalid';kit.protectedKeys.ciphertext='invalid';
 check('recovery keeps verified authority and protected bytes',JSON.stringify(await publicDeviceKeys(await recovering))===JSON.stringify(fixture.recoveryKit.authority));
 let getters=0;const unsafe={...fixture.rootContext};Object.defineProperty(unsafe,'ownerId',{enumerable:true,get(){getters++;return owner;}});
 await reject('key context getter refused',()=>sealRoot(rootBytes,fixture.device.receivingKey,unsafe));check('key context getter never executes',getters===0);

 const recovery=await createRecoveryKit('audit-'+crypto.randomUUID()),heldSecret=new Uint8Array(recovery.secret),account=recovery.kit.ownerId;
 const storage=new IndexedDbE2eeStorage(),keyStorage=new IndexedDbDeviceKeyStorage();
 const provisioning=UnlockedWebDevice.provision(account,recovery.secret,recovery.kit,storage,keyStorage);recovery.secret.fill(0);
 const identity=await provisioning;await identity.ensureDurableKeys();check('actual IndexedDB provisioning owns recovery input through persisted readback',true);
 const scopeId='personal:'+account,scopeKey='audit-root',scopeRoot=freshSecret(),keys=identity.keys();
 const payload={kind:'personal',resourceId:account,keyId:scopeKey,generation:1,recoveryKit:recovery.kit,
  deviceKeys:await publicDeviceKeys(keys),deviceCapsule:await sealRoot(scopeRoot,(await publicDeviceKeys(keys)).receivingKey,{ownerId:account,scopeId,cryptoEpoch:1,keyId:scopeKey,recipientId:identity.deviceId}),
  recoveryCapsule:await sealRoot(scopeRoot,recovery.kit.authority.receivingKey,{ownerId:account,scopeId,cryptoEpoch:1,keyId:scopeKey,recipientId:'recovery'})} as unknown as Record<string,WireValue>;
 const command:E2eeCommand={protocol:1,ownerId:account,scopeId,deviceId:identity.deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload};
 command.payload.selfProof=(await signE2eeCommand(command,keys.signing.privateKey)).signature;
 const events=[await signE2eeCommand(command,recovery.keys.signing.privateKey)],pin={...recovery.kit.authority};
 const verified=await identity.rememberDirectory(scopeId,pin,events,account,()=>{pin.signingKey='invalid';events[0].signature='invalid';});
 check('directory verification tolerates later caller-owned mutation',verified.recoveryKit.authority.signingKey===recovery.kit.authority.signingKey);
 const canary=bytes('SYNTHETIC COLD DRAFT '+crypto.randomUUID());await identity.vault.write([{domain:'draft',objectId:'audit-draft',value:canary,expected:null}]);
 const serialized=JSON.stringify(await Promise.all((await storage.list('')).map(key=>storage.get(key))))+JSON.stringify(await keyStorage.get(account));
 check('actual stores retain ciphertext without private canary or root/secret',!serialized.includes(new TextDecoder().decode(canary))&&!serialized.includes(encodeE2eeBytes(heldSecret))&&!serialized.includes(encodeE2eeBytes(scopeRoot)));
 const originalKeyRow=await keyStorage.get(account),connection=await openE2eeDatabase();
 const setKeyRow=(row:unknown)=>new Promise<void>((resolve,reject)=>{
  const transaction=connection.transaction('keyMaterial','readwrite',{durability:'strict'});transaction.objectStore('keyMaterial').put(row,account);
  transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(new Error('SYNTHETIC_KEY_METADATA_WRITE_FAILED'));
 });
 const before=JSON.stringify(await Promise.all((await storage.list('')).map(key=>storage.get(key))));
 for(const [field,value]of [['protocol',2],['ownerId','different-owner'],['purpose','different-purpose'],['unknown','refuse-extra']] as const){
  const changed=structuredClone(originalKeyRow) as unknown as {bundle:Record<string,unknown>};changed.bundle[field]=value;await setKeyRow(changed);
  await reject('durable key receipt refuses modified '+field,()=>identity.ensureDurableKeys());
 }
 check('failed key durability never discards retained ciphertext',before===JSON.stringify(await Promise.all((await storage.list('')).map(key=>storage.get(key)))));
 await setKeyRow(originalKeyRow);connection.close();await identity.ensureDurableKeys();check('original verified key row remains usable after explicit fixture repair',true);
 identity.lock();const supplied=new Uint8Array(heldSecret),unlocking=UnlockedWebDevice.unlock(account,supplied,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());supplied.fill(0);
 const reopened=await unlocking,saved=await reopened.savedDirectory(scopeId);
 check('cold IndexedDB unlock preserves captured secret and exact verified directory',saved?.checkpoint.hash===verified.checkpoint.hash&&saved?.recoveryKit.authority.signingKey===recovery.kit.authority.signingKey);
 const draft=await reopened.vault.read('draft','audit-draft');check('cold draft intact after key and directory input mutation',!!draft&&equal(draft.value,canary));draft?.value.fill(0);
 reopened.lock();await reject('locked capability cannot read retained private drafts',()=>reopened.vault.read('draft','audit-draft'));
 const hiddenIdentity=await UnlockedWebDevice.unlock(account,heldSecret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
 const hiddenTarget=Object.assign(new EventTarget(),{document:Object.assign(new EventTarget(),{visibilityState:'hidden'})});
 const dispose=bindWebVaultLifecycle(hiddenIdentity,hiddenTarget as unknown as Window);
 try{
  let locked=false;try{hiddenIdentity.keys();}catch(error){locked=(error as Error).message==='E2EE_UNLOCK_REQUIRED';}
  check('initially hidden lifecycle port immediately revokes key capability',locked);
  await reject('initially hidden lifecycle port denies retained draft reads',()=>hiddenIdentity.vault.read('draft','audit-draft'));
 }finally{dispose();}
 heldSecret.fill(0);secret.fill(0);rootBytes.fill(0);scopeRoot.fill(0);canary.fill(0);clear.fill(0);
 const inputs=await(await fetch('/inputs.json')).json();report.inputs=inputs.inputs;check('bundled and tested inputs remain unchanged',inputs.unchanged===true);
}catch(error){report.error=(error as Error).message.slice(0,180);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';
document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS internal key audit';
