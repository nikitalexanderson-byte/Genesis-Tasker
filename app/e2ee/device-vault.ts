import { encodeE2eeBytes, decodeE2eeBytes, importE2eeRoot } from './envelope.ts';
import { snapshotE2eeValue, type SignedE2eeCommand } from './commands.ts';
import { assertTechnical, exactKeys, freshSecret, generateDeviceKeys, exportPrivateDeviceKeys, importDeviceKeys,
  openBundle, protectBundle, recoverAuthority,publicDeviceKeys,retainE2eeSecret as retainedSecret, type DeviceKeys, type ProtectedBundle, type PublicDeviceKeys, type RecoveryKit } from './keys.ts';
import { verifyDeviceDirectory, type VerifiedDirectory } from './directory.ts';
import { openE2eeDatabase, IndexedDbE2eeStorage, UnlockedE2eeVault, type E2eeRecordStorage } from './storage.ts';
import {ComparedPersonalDeviceTarget} from './personal-device-target.ts';
import {commitE2eeIndexedDb} from './indexeddb-write.ts';
import {sealOriginalCustody,persistOriginalCustody} from './original-custody.ts';
import {IndexedDbOriginalCustodyStorage} from './original-custody-storage.ts';

export type ProtectedDeviceRecord = { serial: number; bundle: ProtectedBundle };
export interface DeviceKeyStorage {
  get(ownerId: string): Promise<ProtectedDeviceRecord|null>;
  create(ownerId: string, bundle: ProtectedBundle): Promise<void>;
}
export class IndexedDbDeviceKeyStorage implements DeviceKeyStorage {
  #database:Promise<IDBDatabase>;
  constructor(factory:IDBFactory=indexedDB){this.#database=openE2eeDatabase(factory);}
  async history(ownerId:string){
    assertTechnical(ownerId);const db=await this.#database;
    return new Promise<ProtectedDeviceRecord[]>((resolve,reject)=>{
      const transaction=db.transaction('keyMaterial','readonly'),store=transaction.objectStore('keyMaterial'),request=store.get(ownerId),prefix='replacement:'+ownerId+':',cursor=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));let first:ProtectedDeviceRecord|null=null;const replacements:ProtectedDeviceRecord[]=[];let invalid=false;
      request.onsuccess=()=>{first=request.result??null;};cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;const value=row.value as ProtectedDeviceRecord;if(replacements.length>=63||typeof row.key!=='string'||!value||row.key!==prefix+value.serial||!Number.isSafeInteger(value.serial)||value.serial<2){invalid=true;transaction.abort();return;}replacements.push(value);row.continue();};transaction.oncomplete=()=>{const rows=[...(first?[first]:[]),...replacements.sort((a,b)=>a.serial-b.serial)];if(rows.some((row,at)=>row.serial!==at+1)){reject(new Error('E2EE_CORRUPT_DEVICE_VAULT'));return;}resolve(rows);};
      transaction.onabort=transaction.onerror=()=>reject(new Error(invalid?'E2EE_CORRUPT_DEVICE_VAULT':'E2EE_STORAGE_UNAVAILABLE'));
    });
  }
  async get(ownerId:string){return(await this.history(ownerId)).at(-1)??null;}
  /** Append-only active identity chain. All previous bundles and record
   * namespaces stay intact; the unique next slot also resolves concurrent CAS. */
  async appendReplacement(ownerId:string,expected:ProtectedDeviceRecord,bundle:ProtectedBundle,current:()=>void){
    current();const actual=await this.get(ownerId);current();if(!actual||JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('E2EE_LOCAL_CONFLICT');if(actual.serial>=64)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
    await commitE2eeIndexedDb(this.#database,'keyMaterial',[{key:'replacement:'+ownerId+':'+(actual.serial+1),expected:null,value:{serial:actual.serial+1,bundle}}],undefined,current);current();
  }
  async create(ownerId:string,bundle:ProtectedBundle){
    assertTechnical(ownerId);return commitE2eeIndexedDb(this.#database,'keyMaterial',[{key:ownerId,expected:null,value:{serial:1,bundle}}]);
  }
  originalCustodyStorage(){return new IndexedDbOriginalCustodyStorage(undefined,this.#database);}
}
type PrivateDeviceBundle = {protocol:1|2;ownerId:string;deviceId:string;localKeyId:string;localRoot:string;deviceKeys:Awaited<ReturnType<typeof exportPrivateDeviceKeys>>;authorityPin:PublicDeviceKeys;previous?:{serial:number;deviceId:string;bundleHash:string}};
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
    assertTechnical(ownerId);recoveryKit=snapshotE2eeValue(recoveryKit);const held=retainedSecret(secret);
    let localRoot:Uint8Array|undefined,bytes:Uint8Array|undefined;
    try{
      // Verify independently entered/saved recovery material before any root is made durable.
      await recoverAuthority(ownerId,held,recoveryKit);
      if(await keyStorage.get(ownerId))throw new Error('E2EE_DEVICE_ALREADY_EXISTS');
      const keys=await generateDeviceKeys(),deviceId=crypto.randomUUID();localRoot=freshSecret();
      const bundle:PrivateDeviceBundle={protocol:1,ownerId,deviceId,localKeyId:`local:${deviceId}`,localRoot:encodeE2eeBytes(localRoot),
        deviceKeys:await exportPrivateDeviceKeys(keys),authorityPin:recoveryKit.authority};
      bytes=encoder.encode(JSON.stringify(bundle));
      await keyStorage.create(ownerId,await protectBundle(ownerId,'device-vault',held,bytes));
      // Read/decrypt the persisted copy rather than accepting an in-memory successful seal.
      return await this.unlock(ownerId,held,storage,keyStorage);
    }finally{held.fill(0);bytes?.fill(0);localRoot?.fill(0);}
  }
  /** Creates local keys only after independent target comparison. This stores
   * no personal root and grants no remote scope access. The separate local
   * unlock secret is unrelated to account recovery or Google identity. */
  static async provisionCandidate(compared:ComparedPersonalDeviceTarget,secret:Uint8Array,storage:E2eeRecordStorage,keyStorage:DeviceKeyStorage){
    const target=ComparedPersonalDeviceTarget.require(compared),ownerId=target.ownerId,held=retainedSecret(secret);let raw:Uint8Array|undefined,bytes:Uint8Array|undefined;
    try{if(await keyStorage.get(ownerId))throw new Error('E2EE_DEVICE_ALREADY_EXISTS');const keys=await generateDeviceKeys(),deviceId=crypto.randomUUID();raw=freshSecret();
      const bundle:PrivateDeviceBundle={protocol:1,ownerId,deviceId,localKeyId:'local:'+deviceId,localRoot:encodeE2eeBytes(raw),deviceKeys:await exportPrivateDeviceKeys(keys),authorityPin:target.authority};
      bytes=encoder.encode(JSON.stringify(bundle));await keyStorage.create(ownerId,await protectBundle(ownerId,'device-vault',held,bytes));return await this.unlock(ownerId,held,storage,keyStorage);
    }finally{held.fill(0);raw?.fill(0);bytes?.fill(0);}
  }
  static async unlock(ownerId:string,secret:Uint8Array,storage:E2eeRecordStorage,keyStorage:DeviceKeyStorage){
    assertTechnical(ownerId);const held=retainedSecret(secret);let bytes:Uint8Array|undefined,raw:Uint8Array|undefined;
    try{
      const record=snapshotE2eeValue(await keyStorage.get(ownerId));
      if(!record)throw new Error('E2EE_DEVICE_NOT_ENROLLED');
      if(!Number.isSafeInteger(record.serial)||record.serial<1)throw new Error('E2EE_CORRUPT_DEVICE_VAULT');
      bytes=await openBundle(ownerId,'device-vault',held,record.bundle);
      const bundle:PrivateDeviceBundle=JSON.parse(decoder.decode(bytes));
      exactKeys(bundle,['protocol','ownerId','deviceId','localKeyId','localRoot','deviceKeys','authorityPin',...(bundle.protocol===2?['previous']:[])]);
      if(![1,2].includes(bundle.protocol)||bundle.ownerId!==ownerId)throw new Error('E2EE_CORRUPT_DEVICE_VAULT');
      if(bundle.protocol===2){if(!(keyStorage instanceof IndexedDbDeviceKeyStorage))throw new Error('E2EE_STORAGE_PROVIDER_REQUIRED');exactKeys(bundle.previous,['serial','deviceId','bundleHash']);assertTechnical(bundle.previous.deviceId);const prior=(await keyStorage.history(ownerId))[record.serial-2];if(!prior||bundle.previous.serial!==record.serial-1||await protectedDeviceHash(prior.bundle)!==bundle.previous.bundleHash)throw new Error('E2EE_CORRUPT_DEVICE_VAULT');}
      assertTechnical(bundle.deviceId);assertTechnical(bundle.localKeyId);exactKeys(bundle.authorityPin,['signingKey','receivingKey']);
      raw=decodeE2eeBytes(bundle.localRoot,32);const root=await importE2eeRoot(raw),keys=await importDeviceKeys(bundle.deviceKeys);
      return new UnlockedWebDevice(ownerId,bundle,keys,root,storage,keyStorage,record);
    }finally{held.fill(0);bytes?.fill(0);raw?.fill(0);}
  }
  requireOpen(){if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');}
  /** Product authenticated capture requires the real durable providers.
   * Memory ports remain useful for component fixtures, never custody proof. */
  requireDurableProvider(){
    this.requireOpen();
    if(!(this.vault.storage instanceof IndexedDbE2eeStorage)||!(this.#keyStorage instanceof IndexedDbDeviceKeyStorage))throw new Error('E2EE_STORAGE_PROVIDER_REQUIRED');
  }
  keys(){this.requireOpen();return this.#keys!;}
  async readKeys(){this.requireOpen();const publicKeys=await publicDeviceKeys(this.#keys!);this.requireOpen();return{publicKeys,receivingKey:this.#keys!.receiving.privateKey};}
  /** Explicit revoked-identity replacement, never an unlock-error fallback.
   * New keys stay a candidate until the ordinary enrollment is approved. */
  static async replaceRevoked(compared:ComparedPersonalDeviceTarget,oldSecret:Uint8Array,newSecret:Uint8Array,events:SignedE2eeCommand[],storage:E2eeRecordStorage,keys:IndexedDbDeviceKeyStorage,current:()=>void){
    const target=ComparedPersonalDeviceTarget.require(compared),priorSecret=retainedSecret(oldSecret);let old:UnlockedWebDevice|undefined,held:Uint8Array|undefined,raw:Uint8Array|undefined,bytes:Uint8Array|undefined;
    try{held=retainedSecret(newSecret);const history=snapshotE2eeValue(events);current();old=await this.unlock(target.ownerId,priorSecret,storage,keys);current();if(JSON.stringify(old.authorityPin)!==JSON.stringify(target.authority))throw new Error('E2EE_AUTHORITY_CHANGED');const saved=await old.savedDirectory(target.scopeId);current();const directory=await verifyDeviceDirectory(target.ownerId,target.scopeId,target.authority,history,saved?.checkpoint);current();const prior=directory.devices.get(old.deviceId),publicKeys=await publicDeviceKeys(old.keys());current();
      if(directory.kind!=='personal'||directory.resourceId!==target.ownerId||directory.state!=='active'||!prior?.revoked||prior.userId!==target.ownerId||prior.signingKey!==publicKeys.signingKey||prior.receivingKey!==publicKeys.receivingKey)throw new Error('E2EE_REVOKED_REPLACEMENT_REQUIRED');await old.ensureDurableKeys();current();
      const deviceKeys=await generateDeviceKeys(),deviceId=crypto.randomUUID();raw=freshSecret();const bundle:PrivateDeviceBundle={protocol:2,ownerId:target.ownerId,deviceId,localKeyId:'local:'+deviceId,localRoot:encodeE2eeBytes(raw),deviceKeys:await exportPrivateDeviceKeys(deviceKeys),authorityPin:target.authority,previous:{serial:old.#record.serial,deviceId:old.deviceId,bundleHash:await protectedDeviceHash(old.#record.bundle)}};
      bytes=encoder.encode(JSON.stringify(bundle));const sealed=await protectBundle(target.ownerId,'device-vault',held,bytes);current();await old.ensureDurableKeys();current();await keys.appendReplacement(target.ownerId,old.#record,sealed,current);if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('genesis-e2ee-lock:'+target.ownerId);channel.postMessage({locked:true});channel.close();}return await this.unlock(target.ownerId,held,storage,keys);
    }finally{old?.lock();priorSecret.fill(0);held?.fill(0);raw?.fill(0);bytes?.fill(0);}
  }
  lock(){this.#closed=true;this.vault.lock();this.#keys=null;}
  async ensureDurableKeys(){
    this.requireOpen();const stored=await this.#keyStorage.get(this.ownerId);this.requireOpen();
    const fields=['protocol','ownerId','purpose','salt','nonce','ciphertext'] as const;let row:ProtectedDeviceRecord|null;
    try{row=snapshotE2eeValue(stored);if(row)exactKeys(row.bundle,fields);}
    catch{throw new Error('E2EE_DEVICE_KEY_UNAVAILABLE');}
    if(!row||row.serial!==this.#record.serial||fields.some(name=>row.bundle[name]!==this.#record.bundle[name]))throw new Error('E2EE_DEVICE_KEY_UNAVAILABLE');
  }
  /** Explicit owner recovery custody. Re-entered secret opens the exact saved
   * bundle; only its root and PUBLIC signer leave this method inside a new
   * owner-secret-protected artifact. Never export the old signing identity. */
  async preserveOriginalSources(secret:Uint8Array,recoveryKit:RecoveryKit,assertCurrent:()=>void){
    const held=retainedSecret(secret),current=()=>{this.requireOpen();assertCurrent();};let bytes:Uint8Array|undefined,root:Uint8Array|undefined;
    try{
      const kit=snapshotE2eeValue(recoveryKit);
      this.requireDurableProvider();current();await this.ensureDurableKeys();current();
      bytes=await openBundle(this.ownerId,'device-vault',held,this.#record.bundle);current();const saved=JSON.parse(decoder.decode(bytes));
      if(saved.ownerId!==this.ownerId||saved.deviceId!==this.deviceId||saved.localKeyId!==`local:${this.deviceId}`)throw new Error('E2EE_DEVICE_KEY_UNAVAILABLE');
      root=decodeE2eeBytes(saved.localRoot,32);const signer=saved.deviceKeys.signingKey;delete saved.localRoot;delete saved.deviceKeys;bytes.fill(0);
      const sealed=await sealOriginalCustody({original:{ownerId:this.ownerId,scopeId:`device:${this.deviceId}`,deviceId:this.deviceId,generation:1,cryptoEpoch:1,securityEpoch:1},keyId:saved.localKeyId,
        signer,root,primaryPin:this.authorityPin,recoveryKit:kit,secret:held,assertCurrent:current});current();
      await this.ensureDurableKeys();current();const reference=await persistOriginalCustody((this.#keyStorage as IndexedDbDeviceKeyStorage).originalCustodyStorage(),this.ownerId,sealed,current);
      await this.ensureDurableKeys();current();return reference;
    }finally{held.fill(0);bytes?.fill(0);root?.fill(0);}
  }
  async #directoryId(scopeId:string){assertTechnical(scopeId);return 'directory-'+encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(scopeId))));}
  async rememberDirectory(scopeId:string,pin:PublicDeviceKeys,events:SignedE2eeCommand[],ownerId=this.ownerId,onVerified?:(directory:VerifiedDirectory)=>void):Promise<VerifiedDirectory>{
    this.requireOpen();pin=snapshotE2eeValue(pin);events=snapshotE2eeValue(events);
    const id=await this.#directoryId(scopeId),previous=await this.vault.read('key-check',id);
    let checkpoint:VerifiedDirectory['checkpoint']|undefined;
    try{
      if(previous){const old=JSON.parse(decoder.decode(previous.value));
        if(old.ownerId!==ownerId||old.pin.signingKey!==pin.signingKey||old.pin.receivingKey!==pin.receivingKey)throw new Error('E2EE_AUTHORITY_CHANGED');checkpoint=old.checkpoint;}
      const directory=await verifyDeviceDirectory(ownerId,scopeId,pin,events,checkpoint,onVerified);
      const encoded=encoder.encode(JSON.stringify({ownerId,pin,checkpoint:directory.checkpoint,events}));
      try{
        if(previous&&previous.value.length===encoded.length&&previous.value.every((byte,index)=>byte===encoded[index])){
          // Keep identical history stable. Recheck after signature work so
          // concurrent replacement still refuses at this read's linearization.
          const actual=await this.vault.read('key-check',id);this.requireOpen();
          try{if(!actual||actual.serial!==previous.serial||actual.value.length!==previous.value.length||actual.value.some((byte,index)=>byte!==previous.value[index]))throw new Error('E2EE_LOCAL_CONFLICT');}
          finally{actual?.value.fill(0);}
        }else await this.vault.write([{domain:'key-check',objectId:id,value:encoded,expected:previous?.serial??null}]);
      }finally{encoded.fill(0);}
      return directory;
    }finally{previous?.value.fill(0);}
  }
  async savedDirectory(scopeId:string,onVerified?:(directory:VerifiedDirectory)=>void):Promise<VerifiedDirectory|null>{
    const record=await this.vault.read('key-check',await this.#directoryId(scopeId));if(!record)return null;
    try{const saved=JSON.parse(decoder.decode(record.value));return await verifyDeviceDirectory(saved.ownerId,scopeId,saved.pin,saved.events,saved.checkpoint,onVerified);}
    finally{record.value.fill(0);}
  }
}
export async function protectedDeviceHash(bundle:ProtectedBundle){const bytes=encoder.encode(JSON.stringify(bundle));try{return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}finally{bytes.fill(0);}}

/** Background tabs, account switches and cross-tab lock never retain an unlocked capability. */
export function bindWebVaultLifecycle(device:UnlockedWebDevice,target:Window=window){
  const lock=()=>device.lock(),visibility=()=>{if(target.document.visibilityState!=='visible')lock();};
  const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(`genesis-e2ee-lock:${device.ownerId}`);
  const received=()=>lock();if(channel)channel.onmessage=received;
  const pageHide=()=>{lock();channel?.postMessage({locked:true});};
  target.addEventListener('pagehide',pageHide);target.document.addEventListener('visibilitychange',visibility);
  target.addEventListener('genesis-local-session-ended',pageHide);
  visibility();
  return()=>{lock();target.removeEventListener('pagehide',pageHide);target.document.removeEventListener('visibilitychange',visibility);
    target.removeEventListener('genesis-local-session-ended',pageHide);channel?.close();};
}
