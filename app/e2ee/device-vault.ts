import { encodeE2eeBytes, decodeE2eeBytes, importE2eeRoot } from './envelope.ts';
import { snapshotE2eeValue, type SignedE2eeCommand } from './commands.ts';
import { assertTechnical, exactKeys, freshSecret, generateDeviceKeys, exportPrivateDeviceKeys, importDeviceKeys,
  openBundle, protectBundle, recoverAuthority, type DeviceKeys, type ProtectedBundle, type PublicDeviceKeys, type RecoveryKit } from './keys.ts';
import { verifyDeviceDirectory, type VerifiedDirectory } from './directory.ts';
import { openE2eeDatabase, UnlockedE2eeVault, type E2eeRecordStorage } from './storage.ts';

export type ProtectedDeviceRecord = { serial: number; bundle: ProtectedBundle };
export interface DeviceKeyStorage {
  get(ownerId: string): Promise<ProtectedDeviceRecord|null>;
  create(ownerId: string, bundle: ProtectedBundle): Promise<void>;
}
export class IndexedDbDeviceKeyStorage implements DeviceKeyStorage {
  #database:Promise<IDBDatabase>;
  constructor(factory:IDBFactory=indexedDB){this.#database=openE2eeDatabase(factory);}
  async get(ownerId:string){
    assertTechnical(ownerId);const db=await this.#database;
    return new Promise<ProtectedDeviceRecord|null>((resolve,reject)=>{
      const transaction=db.transaction('keyMaterial','readonly'),request=transaction.objectStore('keyMaterial').get(ownerId);let row:ProtectedDeviceRecord|null=null;
      request.onsuccess=()=>{row=request.result??null;};transaction.oncomplete=()=>resolve(row);
      transaction.onabort=transaction.onerror=()=>reject(new Error('E2EE_STORAGE_UNAVAILABLE'));
    });
  }
  async create(ownerId:string,bundle:ProtectedBundle){
    assertTechnical(ownerId);const db=await this.#database;
    return new Promise<void>((resolve,reject)=>{
      const transaction=db.transaction('keyMaterial','readwrite',{durability:'strict'}),store=transaction.objectStore('keyMaterial');let conflict=false;
      const request=store.get(ownerId);request.onsuccess=()=>{
        if(request.result!==undefined){conflict=true;transaction.abort();return;}
        store.add({serial:1,bundle},ownerId);
      };
      transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(new Error(conflict?'E2EE_DEVICE_ALREADY_EXISTS':'E2EE_STORAGE_UNAVAILABLE'));
    });
  }
}
type PrivateDeviceBundle = {protocol:1;ownerId:string;deviceId:string;localKeyId:string;localRoot:string;deviceKeys:Awaited<ReturnType<typeof exportPrivateDeviceKeys>>;authorityPin:PublicDeviceKeys};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});

/** Google login never constructs this capability. It needs a separately held secret. */
export class UnlockedWebDevice {
  readonly ownerId:string;readonly deviceId:string;readonly authorityPin:PublicDeviceKeys;readonly vault:UnlockedE2eeVault;
  #keys:DeviceKeys|null;#closed=false;#keyStorage:DeviceKeyStorage;#record:ProtectedDeviceRecord;
  private constructor(ownerId:string,bundle:PrivateDeviceBundle,keys:DeviceKeys,root:CryptoKey,storage:E2eeRecordStorage,keyStorage:DeviceKeyStorage,record:ProtectedDeviceRecord){
    this.ownerId=ownerId;this.deviceId=bundle.deviceId;this.authorityPin=snapshotE2eeValue(bundle.authorityPin);this.#keys=keys;this.#keyStorage=keyStorage;this.#record=record;
    this.vault=new UnlockedE2eeVault(storage,{ownerId,scopeId:`device:${bundle.deviceId}`,deviceId:bundle.deviceId,generation:1,cryptoEpoch:1,securityEpoch:1,
      keyId:bundle.localKeyId,signingKey:keys.signing.privateKey,roots:new Map([[bundle.localKeyId,root]]),trustedSigner:id=>id===bundle.deviceId?keys.signing.publicKey:undefined});
  }
  static async provision(ownerId:string,secret:Uint8Array,recoveryKit:RecoveryKit,storage:E2eeRecordStorage,keyStorage:DeviceKeyStorage){
    assertTechnical(ownerId);
    // Verify independently entered/saved recovery material before any root is made durable.
    await recoverAuthority(ownerId,secret,recoveryKit);
    if(await keyStorage.get(ownerId))throw new Error('E2EE_DEVICE_ALREADY_EXISTS');
    const keys=await generateDeviceKeys(),localRoot=freshSecret(),deviceId=crypto.randomUUID();
    const bundle:PrivateDeviceBundle={protocol:1,ownerId,deviceId,localKeyId:`local:${deviceId}`,localRoot:encodeE2eeBytes(localRoot),
      deviceKeys:await exportPrivateDeviceKeys(keys),authorityPin:recoveryKit.authority};
    const bytes=encoder.encode(JSON.stringify(bundle));
    try{await keyStorage.create(ownerId,await protectBundle(ownerId,'device-vault',secret,bytes));}
    finally{bytes.fill(0);localRoot.fill(0);}
    // Read/decrypt the persisted copy rather than accepting an in-memory successful seal.
    return this.unlock(ownerId,secret,storage,keyStorage);
  }
  static async unlock(ownerId:string,secret:Uint8Array,storage:E2eeRecordStorage,keyStorage:DeviceKeyStorage){
    assertTechnical(ownerId);const record=await keyStorage.get(ownerId);
    if(!record)throw new Error('E2EE_DEVICE_NOT_ENROLLED');
    if(!Number.isSafeInteger(record.serial)||record.serial<1)throw new Error('E2EE_CORRUPT_DEVICE_VAULT');
    const bytes=await openBundle(ownerId,'device-vault',secret,record.bundle);let raw:Uint8Array|undefined;
    try{
      const bundle:PrivateDeviceBundle=JSON.parse(decoder.decode(bytes));
      exactKeys(bundle,['protocol','ownerId','deviceId','localKeyId','localRoot','deviceKeys','authorityPin']);
      if(bundle.protocol!==1||bundle.ownerId!==ownerId)throw new Error('E2EE_CORRUPT_DEVICE_VAULT');
      assertTechnical(bundle.deviceId);assertTechnical(bundle.localKeyId);exactKeys(bundle.authorityPin,['signingKey','receivingKey']);
      raw=decodeE2eeBytes(bundle.localRoot,32);const root=await importE2eeRoot(raw),keys=await importDeviceKeys(bundle.deviceKeys);
      return new UnlockedWebDevice(ownerId,bundle,keys,root,storage,keyStorage,record);
    }finally{bytes.fill(0);raw?.fill(0);}
  }
  requireOpen(){if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');}
  keys(){this.requireOpen();return this.#keys!;}
  lock(){this.#closed=true;this.vault.lock();this.#keys=null;}
  async ensureDurableKeys(){
    this.requireOpen();const row=await this.#keyStorage.get(this.ownerId);this.requireOpen();
    if(!row||row.serial!==this.#record.serial||row.bundle.ciphertext!==this.#record.bundle.ciphertext
      ||row.bundle.nonce!==this.#record.bundle.nonce||row.bundle.salt!==this.#record.bundle.salt)throw new Error('E2EE_DEVICE_KEY_UNAVAILABLE');
  }
  async #directoryId(scopeId:string){assertTechnical(scopeId);return 'directory-'+encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(scopeId))));}
  async rememberDirectory(scopeId:string,pin:PublicDeviceKeys,events:SignedE2eeCommand[],ownerId=this.ownerId,onVerified?:(directory:VerifiedDirectory)=>void):Promise<VerifiedDirectory>{
    this.requireOpen();const id=await this.#directoryId(scopeId),previous=await this.vault.read('key-check',id);
    let checkpoint:VerifiedDirectory['checkpoint']|undefined;
    try{
      if(previous){const old=JSON.parse(decoder.decode(previous.value));
        if(old.ownerId!==ownerId||old.pin.signingKey!==pin.signingKey||old.pin.receivingKey!==pin.receivingKey)throw new Error('E2EE_AUTHORITY_CHANGED');checkpoint=old.checkpoint;}
      const directory=await verifyDeviceDirectory(ownerId,scopeId,pin,events,checkpoint,onVerified);
      const encoded=encoder.encode(JSON.stringify({ownerId,pin,checkpoint:directory.checkpoint,events}));
      try{await this.vault.write([{domain:'key-check',objectId:id,value:encoded,expected:previous?.serial??null}]);}finally{encoded.fill(0);}
      return directory;
    }finally{previous?.value.fill(0);}
  }
  async savedDirectory(scopeId:string,onVerified?:(directory:VerifiedDirectory)=>void):Promise<VerifiedDirectory|null>{
    const record=await this.vault.read('key-check',await this.#directoryId(scopeId));if(!record)return null;
    try{const saved=JSON.parse(decoder.decode(record.value));return await verifyDeviceDirectory(saved.ownerId,scopeId,saved.pin,saved.events,saved.checkpoint,onVerified);}
    finally{record.value.fill(0);}
  }
}

/** Background tabs, account switches and cross-tab lock never retain an unlocked capability. */
export function bindWebVaultLifecycle(device:UnlockedWebDevice,target:Window=window){
  const lock=()=>device.lock(),visibility=()=>{if(target.document.visibilityState!=='visible')lock();};
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(`genesis-e2ee-lock:${device.ownerId}`);
  const received=()=>lock();if(channel)channel.onmessage=received;
  const pageHide=()=>{lock();channel?.postMessage({locked:true});};
  target.addEventListener('pagehide',pageHide);target.document.addEventListener('visibilitychange',visibility);
  target.addEventListener('genesis-local-session-ended',pageHide);
  return()=>{lock();target.removeEventListener('pagehide',pageHide);target.document.removeEventListener('visibilitychange',visibility);
    target.removeEventListener('genesis-local-session-ended',pageHide);channel?.close();};
}
