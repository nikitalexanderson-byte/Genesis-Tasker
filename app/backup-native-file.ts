import {BACKUP_MAX_FILE} from './backup-format.ts';
import {decodeE2eeBytes} from './e2ee/envelope.ts';

export type NativeBackupFileOrigin={protocol:1;id:string;length:number;name:string|null;type:string|null;
 lastModified:number|null;declaredSize:number|null;sha256:string};
type Ports={choose:()=>Promise<unknown>;chunk:(id:string,offset:number)=>Promise<unknown>;clear:(id:string)=>Promise<unknown>;check:()=>void};
const origins=new WeakMap<File,NativeBackupFileOrigin>(),chunkSize=98304;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const invalid=():never=>{throw new Error('BACKUP_TRANSFER');};
function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const row=value as Record<string,unknown>,fields=Object.keys(row);
 if(fields.length!==keys.length||fields.some(key=>!keys.includes(key)))return invalid();return row;
}
function descriptor(value:unknown):NativeBackupFileOrigin{
 const row=object(value,['protocol','id','length','name','type','lastModified','declaredSize','sha256']);
 if(row.protocol!==1||typeof row.id!=='string'||!uuid.test(row.id)||!Number.isSafeInteger(row.length)||Number(row.length)<0||Number(row.length)>BACKUP_MAX_FILE
  ||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))return invalid();
 for(const [key,maximum] of [['name',4096],['type',1024]] as const)if(row[key]!==null&&(typeof row[key]!=='string'||row[key].length>maximum))return invalid();
 for(const key of ['lastModified','declaredSize'])if(row[key]!==null&&!Number.isSafeInteger(row[key]))return invalid();
 return {...row} as NativeBackupFileOrigin;
}
/** Original provider metadata remains explicit, including absent fields. File
 * may normalize its MIME type or need a display fallback; it is not provenance. */
export function nativeBackupFileOrigin(file:File){const value=origins.get(file);return value?{...value}:undefined;}

/** Import bytes never pass through a UTF-8 decoder. Authenticate the entire
 * transfer before constructing a File; later archive parsing owns text validity. */
export async function readNativeBackupFile(ports:Ports):Promise<File>{
 ports.check();const selected=await ports.choose();let id:string|undefined,bytes:Uint8Array<ArrayBuffer>|undefined;
 if(selected&&typeof selected==='object'&&'id' in selected&&typeof selected.id==='string'&&uuid.test(selected.id))id=selected.id;
 let failed=false,problem:unknown,result:File|undefined;
 try{
  ports.check();const info=descriptor(selected);id=info.id;bytes=new Uint8Array(info.length);let offset=0;
  while(offset<info.length){
   const reply=await ports.chunk(info.id,offset);ports.check();const part=object(reply,['id','offset','bytes','nextOffset','eof']);
   const next=Math.min(offset+chunkSize,info.length);
   if(part.id!==info.id||part.offset!==offset||part.nextOffset!==next||part.eof!==(next===info.length)||typeof part.bytes!=='string')invalid();
   let raw:Uint8Array<ArrayBuffer>|undefined;
   try{raw=decodeE2eeBytes(part.bytes,next-offset);bytes.set(raw,offset);}catch{invalid();}finally{raw?.fill(0);}
   offset=next;
  }
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));ports.check();
  const hash=Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');digest.fill(0);
  if(hash!==info.sha256)invalid();
  result=new File([bytes],info.name??'import.genesisbackup',{type:info.type??'application/octet-stream',lastModified:info.lastModified??0});
  origins.set(result,info);ports.check();
 }catch(error){failed=true;problem=error;}
 finally{
  bytes?.fill(0);
  if(id)try{const receipt=await ports.clear(id);if(receipt!==true)invalid();}catch(error){if(!failed){failed=true;problem=error;}}
 }
 if(failed)throw problem;ports.check();return result!;
}
