import {BACKUP_MAX_FILE,backupDigest,backupJson} from './backup-format';
import {privateDriveRequest} from './cloud-sync';
import {E2eeDeviceDocument} from './e2ee/device-document';
import {exactKeys} from './e2ee/keys';
import {captureMessagingAccess} from './e2ee/message-lifetime';
import {requirePrivateAccount,type WebPrivateAccount} from './e2ee/product-session';

export const DRIVE_BACKUP_CONSENT='encrypted-drive-backup-336-v1';
export type DriveStatus={enabled:boolean;connectionId:string|null;consentVersion:typeof DRIVE_BACKUP_CONSENT};
export type DriveFile={fileId:string;backupId:string;sha256:string;bytes:number;createdAt:string};
type DriveReceipt={operationId:string;fileId:string;sha256:string;bytes:number;verified:true};
type DriveIntent={protocol:1;operationId:string;connectionId:string;backupId:string;sha256:string;bytes:number;file:string;receipt:DriveReceipt|null};
const prefix='drive-backup-upload:',encoder=new TextEncoder();
function invalid():never{throw new Error('DRIVE_INVALID_RESPONSE');}
function uuid(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))invalid();}
function fileId(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{10,200}$/.test(value))invalid();}
function hash(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))invalid();}
function size(value:unknown):asserts value is number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>BACKUP_MAX_FILE)invalid();}
function receipt(value:unknown):DriveReceipt{
 exactKeys(value,['operationId','fileId','sha256','bytes','verified']);uuid(value.operationId);fileId(value.fileId);hash(value.sha256);size(value.bytes);if(value.verified!==true)invalid();return value as DriveReceipt;
}
function intent(value:unknown):DriveIntent{
 exactKeys(value,['protocol','operationId','connectionId','backupId','sha256','bytes','file','receipt']);
 if(value.protocol!==1||typeof value.file!=='string')invalid();uuid(value.operationId);uuid(value.connectionId);uuid(value.backupId);hash(value.sha256);size(value.bytes);
 if(encoder.encode(value.file).length!==value.bytes)invalid();
 if(value.receipt!==null){const found=receipt(value.receipt);if(found.operationId!==value.operationId||found.sha256!==value.sha256||found.bytes!==value.bytes)invalid();}
 return value as DriveIntent;
}
export interface BackupCloudAdapter {
 readonly provider:'google-drive';status():Promise<DriveStatus>;connect():Promise<string>;
 stage(file:string):Promise<string>;retry(operationId:string):Promise<DriveReceipt>;pending():Promise<string[]>;
 stagedFile(operationId:string):Promise<{file:string;backupId:string}>;
 list(pageToken?:string):Promise<{files:DriveFile[];nextPageToken:string|null}>;
 download(file:DriveFile):Promise<string>;disconnect():Promise<void>;
}
/** One foreground admission per action, retired forever on hide/lock/account
 * change. Only the sealed file and immutable technical intent are persisted;
 * a retry never needs or stores the portable recovery key. */
export function backupDriveAdapter(account:WebPrivateAccount):BackupCloudAdapter {
 const session=captureMessagingAccess(account.ownerId),current=()=>{session();account.requireOpen();if(requirePrivateAccount(account.ownerId)!==account)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const request=async(path:Parameters<typeof privateDriveRequest>[1],body?:unknown)=>{
  current();const controller=new AbortController(),hide=()=>{if(document.visibilityState!=='visible')controller.abort();};
  const unsubscribe=typeof document==='undefined'?()=>{}:(document.addEventListener('visibilitychange',hide),()=>document.removeEventListener('visibilitychange',hide));
  try{const value=await privateDriveRequest(account.ownerId,path,body,controller.signal);current();return value;}finally{unsubscribe();}
 };
 const documentFor=(id:string)=>{uuid(id);return new E2eeDeviceDocument(account.device,prefix+id,intent,current);};
 const verify=async(row:DriveIntent)=>{if(await backupDigest(row.file)!==row.sha256)invalid();current();};
 const read=async(id:string)=>{current();const found=await documentFor(id).load();current();if(!found||found.value.operationId!==id)throw new Error('DRIVE_INTENT_MISSING');await verify(found.value);return found;};
 const status=async()=>{const value=await request('status');exactKeys(value,['enabled','connectionId','consentVersion']);if(typeof value.enabled!=='boolean'||value.consentVersion!==DRIVE_BACKUP_CONSENT)invalid();if(value.connectionId!==null)uuid(value.connectionId);return value as DriveStatus;};
 const connected=async(id:string)=>{const value=await status();if(!value.enabled||value.connectionId!==id)throw new Error('DRIVE_CONNECTION_CHANGED');};
 const adapter:BackupCloudAdapter={provider:'google-drive',status,
  async connect(){const value=await request('web-connect',{consentVersion:DRIVE_BACKUP_CONSENT});exactKeys(value,['url']);if(typeof value.url!=='string')invalid();const url=new URL(value.url);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.username||url.password||url.hash)invalid();return value.url;},
  async stage(file){
   current();const bytes=encoder.encode(file);if(bytes.length<1||bytes.length>BACKUP_MAX_FILE)throw new Error('BACKUP_TOO_LARGE');
   try{const header=backupJson(file,BACKUP_MAX_FILE);exactKeys(header,['format','schema','backupId','algorithm','wrappedKey','iv','ciphertext','sha256']);if(header.format!=='genesisbackup'||header.schema!==1||header.algorithm!=='A256GCM+A256KW')invalid();uuid(header.backupId);
    const state=await status();if(!state.enabled||!state.connectionId)throw new Error('DRIVE_CONNECTION_REQUIRED');
    const row:DriveIntent={protocol:1,operationId:crypto.randomUUID(),connectionId:state.connectionId,backupId:header.backupId,sha256:await backupDigest(bytes),bytes:bytes.length,file,receipt:null};current();
    await documentFor(row.operationId).save(row,null);current();const saved=await read(row.operationId);if(saved.value.file!==file)throw new Error('E2EE_BACKUP_UNVERIFIED');return row.operationId;
   }finally{bytes.fill(0);}
  },
  async retry(id){
   const found=await read(id),row=found.value;await connected(row.connectionId);
   const input={connectionId:row.connectionId,operationId:row.operationId,backupId:row.backupId,sha256:row.sha256,bytes:row.bytes};
   const prepared=await request('prepare',input);exactKeys(prepared,['fileId','operationId']);fileId(prepared.fileId);if(prepared.operationId!==id)invalid();
   const result=receipt(await request('commit',{...input,file:row.file}));if(result.operationId!==id||result.fileId!==prepared.fileId||result.sha256!==row.sha256||result.bytes!==row.bytes)invalid();
   // The server receipt alone cannot complete the device intent.
   await adapter.download({fileId:result.fileId,backupId:row.backupId,sha256:row.sha256,bytes:row.bytes,createdAt:''});await connected(row.connectionId);current();
   const final=await read(id);if(final.value.receipt){if(JSON.stringify(final.value.receipt)!==JSON.stringify(result))invalid();return result;}
   await documentFor(id).save({...row,receipt:result},final.serial);current();const persisted=await read(id);if(JSON.stringify(persisted.value.receipt)!==JSON.stringify(result))throw new Error('E2EE_BACKUP_UNVERIFIED');return result;
  },
  async pending(){current();const ids=await account.device.vault.listLocal('draft',prefix);current();const result:string[]=[];for(const key of ids){const id=key.slice(prefix.length),found=await read(id);if(!found.value.receipt)result.push(id);}return result;},
  async stagedFile(id){const found=await read(id);return{file:found.value.file,backupId:found.value.backupId};},
  async list(pageToken){if(pageToken!==undefined&&(pageToken.length<1||pageToken.length>2048))invalid();const state=await status();if(!state.enabled||!state.connectionId)throw new Error('DRIVE_CONNECTION_REQUIRED');
   const value=await request('list',{connectionId:state.connectionId,pageToken:pageToken??null});exactKeys(value,['files','nextPageToken']);if(!Array.isArray(value.files)||value.files.length>100||value.nextPageToken!==null&&(typeof value.nextPageToken!=='string'||value.nextPageToken.length>2048))invalid();
   const seen=new Set<string>();for(const item of value.files){exactKeys(item,['fileId','backupId','sha256','bytes','createdAt']);fileId(item.fileId);uuid(item.backupId);hash(item.sha256);size(item.bytes);if(typeof item.createdAt!=='string'||!Number.isFinite(Date.parse(item.createdAt))||seen.has(item.fileId))invalid();seen.add(item.fileId);}
   return value as {files:DriveFile[];nextPageToken:string|null};
  },
  async download(file){fileId(file.fileId);uuid(file.backupId);hash(file.sha256);size(file.bytes);const state=await status();if(!state.enabled||!state.connectionId)throw new Error('DRIVE_CONNECTION_REQUIRED');
   const value=await request('download',{connectionId:state.connectionId,fileId:file.fileId});exactKeys(value,['fileId','sha256','bytes','file']);
   if(value.fileId!==file.fileId||value.sha256!==file.sha256||value.bytes!==file.bytes||typeof value.file!=='string'||encoder.encode(value.file).length!==file.bytes||await backupDigest(value.file)!==file.sha256)invalid();
   current();const header=backupJson(value.file,BACKUP_MAX_FILE);exactKeys(header,['format','schema','backupId','algorithm','wrappedKey','iv','ciphertext','sha256']);if(header.format!=='genesisbackup'||header.schema!==1||header.algorithm!=='A256GCM+A256KW'||header.backupId!==file.backupId)invalid();return value.file;
  },
  async disconnect(){const state=await status();if(state.connectionId)await request('disconnect',{connectionId:state.connectionId});},
 };current();return adapter;
}
