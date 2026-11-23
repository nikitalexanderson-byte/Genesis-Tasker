import type {UnlockedWebDevice} from './device-vault.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {E2EE_CHUNK_BYTES} from './files.ts';
export const E2EE_DEVICE_DOCUMENT_MAX_BYTES=256*1024*1024;
import type {LocalWrite} from './storage.ts';

function readOnly():never{throw new Error('E2EE_HISTORY_NOT_EXECUTABLE');}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export type DeviceDocumentView<T>={value:T;serial:number};
/** Device-only content has no transport or flush method. CAS protects drafts
 * from other tabs; an absent record is distinct from corrupt ciphertext. */
export class E2eeDeviceDocument<T>{
 private readonly partPrefix:Promise<string>;
 constructor(private readonly device:UnlockedWebDevice|null,private readonly id:string,
  private readonly validate:(input:unknown)=>T,private readonly current:()=>void,private readonly reader:Pick<UnlockedWebDevice['vault'],'read'>=device!.vault){assertTechnical(id);this.partPrefix=crypto.subtle.digest('SHA-256',encoder.encode(id)).then(bytes=>'device-doc:'+encodeE2eeBytes(new Uint8Array(bytes)));}
 private decode(bytes:Uint8Array){return parseLegacyMigrationJson(decoder.decode(bytes),'E2EE_PRIVATE_DOCUMENT_CORRUPT',E2EE_DEVICE_DOCUMENT_MAX_BYTES);}
 private manifest(value:unknown):{format:'genesis-device-document-v1';size:number;hash:string;slots:number[]}|null{
  if(!value||typeof value!=='object'||!('format' in value)||value.format!=='genesis-device-document-v1')return null;
  exactKeys(value,['format','size','hash','slots']);if(typeof value.size!=='number'||!Number.isSafeInteger(value.size)||value.size<1||value.size>E2EE_DEVICE_DOCUMENT_MAX_BYTES
   ||typeof value.hash!=='string'||!Array.isArray(value.slots)||value.slots.length>1024||value.slots.length<Math.ceil(value.size/E2EE_CHUNK_BYTES)||value.slots.some(serial=>!Number.isSafeInteger(serial)||serial<1||serial>=Number.MAX_SAFE_INTEGER))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
  decodeE2eeBytes(value.hash,32);return value as {format:'genesis-device-document-v1';size:number;hash:string;slots:number[]};
 }
 async load():Promise<DeviceDocumentView<T>|null>{
  this.current();const row=await this.reader.read('draft',this.id);this.current();if(!row)return null;
  try{const decoded=this.decode(row.value),manifest=this.manifest(decoded);if(!manifest)return{value:this.validate(decoded),serial:row.serial};
   const bytes=new Uint8Array(manifest.size),prefix=await this.partPrefix;try{
    for(let part=0;part<Math.ceil(manifest.size/E2EE_CHUNK_BYTES);part++){
     this.current();const value=await this.reader.read('draft',`${prefix}:${part}`);this.current();if(!value)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
     try{if(value.serial!==manifest.slots[part])throw new Error('E2EE_LOCAL_CONFLICT');if(value.value.length!==Math.min(E2EE_CHUNK_BYTES,bytes.length-part*E2EE_CHUNK_BYTES))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');bytes.set(value.value,part*E2EE_CHUNK_BYTES);}finally{value.value.fill(0);}
    }
    if(encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==manifest.hash)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');this.current();
    return{value:this.validate(this.decode(bytes)),serial:row.serial};
   }finally{bytes.fill(0);}
  }
  finally{row.value.fill(0);}
 }
 async save(input:T,expected:number|null):Promise<DeviceDocumentView<T>>{
  this.current();const value=this.validate(structuredClone(input)),bytes=encoder.encode(JSON.stringify(value));
  const writes:LocalWrite[]=[];
  try{if(bytes.length<1||bytes.length>E2EE_DEVICE_DOCUMENT_MAX_BYTES)throw new Error('E2EE_SOURCE_TOO_LARGE');await (this.device??readOnly()).ensureDurableKeys();this.current();
   const previous=await (this.device??readOnly()).vault.read('draft',this.id);this.current();let slots:number[];
   try{if((previous?.serial??null)!==expected)throw new Error('E2EE_LOCAL_CONFLICT');slots=previous?[...this.manifest(this.decode(previous.value))?.slots??[]]:[];}finally{previous?.value.fill(0);}
   const prefix=await this.partPrefix;for(let part=0;part<Math.ceil(bytes.length/E2EE_CHUNK_BYTES);part++){
    const serial=slots[part]??null;writes.push({domain:'draft',objectId:`${prefix}:${part}`,value:bytes.slice(part*E2EE_CHUNK_BYTES,(part+1)*E2EE_CHUNK_BYTES),expected:serial});slots[part]=(serial??0)+1;
   }
   const manifest=encoder.encode(JSON.stringify({format:'genesis-device-document-v1',size:bytes.length,hash:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))),slots}));
   writes.push({domain:'draft',objectId:this.id,value:manifest,expected});this.current();await (this.device??readOnly()).vault.write(writes,this.current);this.current();
   return{value,serial:(expected??0)+1};
  }finally{bytes.fill(0);writes.forEach(write=>write.value.fill(0));}
 }
}
