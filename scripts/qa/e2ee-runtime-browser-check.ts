import { createRecoveryKit, recoverAuthority, importDeviceKeys, openRoot, openBundle } from '../../app/e2ee/keys.ts';
import { decodeE2eeBytes, encodeE2eeBytes } from '../../app/e2ee/envelope.ts';
import { IndexedDbE2eeStorage, openE2eeDatabase } from '../../app/e2ee/storage.ts';
import { IndexedDbDeviceKeyStorage, UnlockedWebDevice } from '../../app/e2ee/device-vault.ts';
import { verifyDeviceDirectory } from '../../app/e2ee/directory.ts';
import { openE2eeFile } from '../../app/e2ee/files.ts';

const report:{runtime:string;synthetic:boolean;checks:{name:string;passed:boolean}[];error?:string;status?:string}={runtime:navigator.userAgent,synthetic:true,checks:[]};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});if(!passed)throw new Error(name);};
const reject=async(name:string,operation:()=>Promise<unknown>)=>{let rejected=false;try{await operation();}catch{rejected=true;}check(name,rejected);};
try{
  const fixture=await(await fetch('/runtime.json')).json();
  const secret=decodeE2eeBytes(fixture.secret,32),owner=fixture.rootContext.ownerId;
  check('secure browser crypto',isSecureContext&&!!crypto.subtle&&!!indexedDB);
  await recoverAuthority(owner,secret,fixture.recoveryKit);check('WebCrypto recovery bundle',true);
  const directory=await verifyDeviceDirectory(owner,fixture.rootContext.scopeId,fixture.recoveryKit.authority,fixture.directory.events);
  check('signed directory and native checkpoint',directory.checkpoint.hash===fixture.directory.checkpoint.hash&&directory.devices.get('fixture-device')?.revoked===true);
  const native=await(await fetch('/native.json')).json(),device=await importDeviceKeys(fixture.device);
  const root=await openRoot(native.rootCapsule,device.receiving.privateKey,fixture.rootContext);
  check('Bouncy Castle HPKE root opens in Chromium',root.algorithm.name==='AES-KW'&&!root.extractable);
  check('Bouncy Castle HKDF/GCM bundle opens in Chromium',encodeE2eeBytes(await openBundle(owner,'device-vault',secret,native.bundle))===fixture.plaintext);
  if(native.nativeRecovery){await recoverAuthority(owner,decodeE2eeBytes(native.nativeRecovery.secret,32),native.nativeRecovery.kit);check('native 67-byte PKCS8 recovery bundle opens in Chromium',true);}
  const file=await openE2eeFile(root,device.signing.publicKey,fixture.file.manifest.context,fixture.file.manifest,
    async id=>fixture.file.chunks.find((item:{context:{objectId:string}})=>item.context.objectId===id));
  check('authenticated file and filename',encodeE2eeBytes(file.bytes)===fixture.plaintext&&file.filename==='Синтетическое имя.txt');
  const recovery=await createRecoveryKit('browser-'+crypto.randomUUID());
  const account=recovery.kit.ownerId,storage=new IndexedDbE2eeStorage(),keys=new IndexedDbDeviceKeyStorage();
  const identity=await UnlockedWebDevice.provision(account,recovery.secret,recovery.kit,storage,keys);
  const privateBytes=new TextEncoder().encode('PRIVATE BROWSER CANARY '+crypto.randomUUID());
  await identity.vault.write([{domain:'draft',objectId:'private-draft',value:privateBytes,expected:null},{domain:'outbox',objectId:'pending',value:privateBytes,expected:null}]);
  await identity.ensureDurableKeys();check('strict IndexedDB commits key bundle and encrypted outbox',true);
  const all=await storage.list(''),serialized=JSON.stringify(await Promise.all(all.map(key=>storage.get(key))));
  check('no plaintext/key in IndexedDB records',!serialized.includes(new TextDecoder().decode(privateBytes))&&!serialized.includes(encodeE2eeBytes(recovery.secret)));
  identity.lock();await reject('locked vault denies pending access',()=>identity.vault.read('outbox','pending'));
  const reopenedStorage=new IndexedDbE2eeStorage();
  const reopened=await UnlockedWebDevice.unlock(account,recovery.secret,reopenedStorage,new IndexedDbDeviceKeyStorage());
  check('new connection unlock preserves pending ciphertext',encodeE2eeBytes((await reopened.vault.read('outbox','pending'))!.value)===encodeE2eeBytes(privateBytes));
  await reject('wrong recovery cannot initialize empty vault',()=>UnlockedWebDevice.unlock(account,crypto.getRandomValues(new Uint8Array(32)),storage,keys));
  await reject('batch CAS prevents a second tab overwriting drafts',()=>reopened.vault.write([{domain:'draft',objectId:'private-draft',value:privateBytes,expected:null}]));
  const original=(await reopened.vault.read('draft','private-draft'))!;
  check('failed CAS leaves original private draft intact',encodeE2eeBytes(original.value)===encodeE2eeBytes(privateBytes));
  // Keep an actual IDB writer busy on a second connection, so the
  // protected save has encrypted already but cannot acquire its durable txn yet.
  const connection=await openE2eeDatabase(),hold=connection.transaction('records','readwrite');let holding=true;
  const held=new Promise<void>((resolve,reject)=>{hold.oncomplete=()=>resolve();hold.onerror=hold.onabort=()=>reject(new Error('IDB hold failed'));});
  const pump=()=>{const request=hold.objectStore('records').get('synthetic-write-lock');request.onsuccess=()=>{if(holding)pump();};};pump();
  const commit=reopenedStorage.commit.bind(reopenedStorage);let entered!:()=>void;
  const queued=new Promise<void>(resolve=>{entered=resolve;});
  reopenedStorage.commit=async(changes,signal)=>{const pending=commit(changes,signal);await Promise.resolve();entered();return pending;};
  const pending=reopened.vault.write([{domain:'draft',objectId:'queued-lock',value:privateBytes,expected:null}]);
  const outcome=pending.then(()=>false,error=>(error as Error).message==='E2EE_UNLOCK_REQUIRED');
  await queued;reopened.lock();holding=false;await held;
  check('lock aborts a real IndexedDB transaction queued behind another writer',await outcome);
  const after=await Promise.all((await reopenedStorage.list('')).map(key=>reopenedStorage.get(key)));
  check('queued IDB transaction never commits after lock',!after.some(row=>row?.envelope.context.objectId==='queued-lock'));
  connection.close();
  reopened.lock();secret.fill(0);recovery.secret.fill(0);privateBytes.fill(0);
}catch(error){report.error=(error as Error).message.slice(0,180);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';
document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS E2EE runtime';
