import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {parseNativeProtectedArchive,planNativeSafetyArchives} from './archives-native-input.ts';
import type {NativeBackupFileOrigin} from '../backup-native-file.ts';
import {normalizeNativeArchiveValues} from './archives-native-values.ts';

type Row=Record<string,unknown>;
export type NativeArchiveForm=Readonly<{id:string;source:'backup-panel';mounted:boolean;rawForm:string|null;
 form:Readonly<{state:Row;settled:boolean;file:Row|null}>|null;
 valueForm:ReturnType<typeof normalizeNativeArchiveValues>|null;
 files:readonly Readonly<{descriptor:NativeBackupFileOrigin;bytes:string;rawDescriptor?:string}>[]}>;
const encoder=new TextEncoder(),uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX=48*1024*1024,MAX_FILE=24*1024*1024;
function invalid():never{throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');}
function integer(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min)invalid();}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function text(value:unknown,max=4096):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function fileOrigin(input:unknown):NativeBackupFileOrigin {
 exactKeys(input,['protocol','id','length','name','type','lastModified','declaredSize','sha256']);
 if(input.protocol!==1||typeof input.id!=='string'||!uuid.test(input.id)||typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256))invalid();
 integer(input.length);if(input.length>MAX_FILE)throw new Error('E2EE_SOURCE_TOO_LARGE');
 if(input.name!==null)text(input.name);if(input.type!==null)text(input.type,1024);
 for(const field of ['lastModified','declaredSize'])if(input[field]!==null&&!Number.isSafeInteger(input[field]))invalid();
 return{...input} as NativeBackupFileOrigin;
}
function mime(value:string|null){if(value===null)return'application/octet-stream';for(const char of value)if(char.charCodeAt(0)<32||char.charCodeAt(0)>126)return'';return value.toLowerCase();}
function displayName(value:string|null){
 // File's USVString display replaces lone surrogates. Preserve the original
 // provider string separately; that normalization is not an integrity failure.
 const raw=encoder.encode(value??'import.genesisbackup');try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}finally{raw.fill(0);}
}

/** Source validation only. No native paths, key/HTTP/storage/restore ports and
 * no execution of pending plans or receipts. Validate the ORIGINAL form JSON,
 * even when a native JSONObject could project a different duplicate field. */
export async function normalizeNativeArchiveForms(input:unknown,ownerId:string,current:()=>void):Promise<readonly NativeArchiveForm[]> {
 assertTechnical(ownerId);current();exactKeys(input,['protocol','ownerId','sessionEpoch','views']);
 if(![1,2,3].includes(input.protocol as number)||input.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');integer(input.sessionEpoch);
 if(!Array.isArray(input.views)||input.views.length>1000)invalid();
 const protocol=input.protocol,sessionEpoch=input.sessionEpoch;
 let candidates=0;
 if(protocol!==1)for(const row of input.views){object(row);if(row.valueForm===null)continue;object(row.valueForm);
  if(!Array.isArray(row.valueForm.values)||!Array.isArray(row.valueForm.rawManifests))invalid();
  candidates+=row.valueForm.values.length+row.valueForm.rawManifests.length;
  if(candidates>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');
 }
 const views=structuredClone(input.views),ids=new Set<string>(),files=new Set<string>(),output:NativeArchiveForm[]=[];let size=0;
 const budget=(value:string)=>{const raw=encoder.encode(value);try{size+=raw.length;if(size>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');}finally{raw.fill(0);}};
 for(const row of views){
  current();exactKeys(row,protocol!==1?['id','source','mounted','rawForm','valueForm','files']:['id','source','mounted','rawForm','files']);
  if(typeof row.id!=='string'||!uuid.test(row.id)||ids.has(row.id)||row.source!=='backup-panel'||typeof row.mounted!=='boolean')invalid();ids.add(row.id);
  if(!Array.isArray(row.files)||row.files.length>1000)invalid();
  let form:NativeArchiveForm['form']=null;
  if(row.rawForm!==null){text(row.rawForm,32*1024*1024);budget(row.rawForm);
   const value=parseLegacyMigrationJson(row.rawForm,'E2EE_ARCHIVE_SOURCE_INVALID',32*1024*1024);exactKeys(value,['protocol','state','settled','file']);object(value.state);
   if(value.protocol!==1||typeof value.settled!=='boolean')invalid();
   if(value.file!==null){exactKeys(value.file,['id','name','type','size','lastModified']);if(typeof value.file.id!=='string'||!uuid.test(value.file.id))invalid();
    text(value.file.name);text(value.file.type,1024);integer(value.file.size);if(!Number.isSafeInteger(value.file.lastModified))invalid();}
   form=Object.freeze({state:value.state,settled:value.settled,file:value.file as Row|null});
  }
  let valueForm:NativeArchiveForm['valueForm']=null;
  if(protocol!==1&&row.valueForm!==null){
   if(row.rawForm!==null)invalid();object(row.valueForm);
   const raw=row.valueForm;
   if(!Array.isArray(raw.values)||!Array.isArray(raw.rawManifests)||raw.values.length+raw.rawManifests.length>10000)invalid();
   for(const value of raw.values){object(value);text(value.rawJson,32*1024*1024);budget(value.rawJson);}
   for(const manifest of raw.rawManifests){text(manifest,32768);budget(manifest);}
   if(raw.rawManifest!==null){text(raw.rawManifest,32768);budget(raw.rawManifest);}
   valueForm=normalizeNativeArchiveValues(raw,{ownerId,sessionEpoch,viewId:row.id},current);
   if(valueForm.manifest&&valueForm.state)form=Object.freeze({state:valueForm.state,settled:valueForm.manifest.settled,file:valueForm.manifest.file as Row|null});
  }
  if(row.mounted&&(!form||!form.settled))throw new Error('E2EE_ARCHIVE_OPERATION_IN_PROGRESS');
  const preserved:NativeArchiveForm['files'][number][]=[];
  for(const candidate of row.files){
   exactKeys(candidate,protocol===3?['rawDescriptor','bytes']:['descriptor','bytes']);
   let rawDescriptor:string|undefined;
   if(protocol===3){text(candidate.rawDescriptor,32768);budget(candidate.rawDescriptor);rawDescriptor=candidate.rawDescriptor;}
   const descriptor=Object.freeze(fileOrigin(rawDescriptor===undefined?candidate.descriptor:parseLegacyMigrationJson(rawDescriptor,'E2EE_ARCHIVE_SOURCE_INVALID',32768)));
   if(files.has(descriptor.id)||files.size>=10000)invalid();files.add(descriptor.id);text(candidate.bytes,Math.ceil(MAX_FILE/3)*4);budget(candidate.bytes);
   if(descriptor.length===0&&candidate.bytes!=='')invalid();
   const raw=descriptor.length===0?new Uint8Array():decodeE2eeBytes(candidate.bytes,descriptor.length);let digest:Uint8Array|undefined;
   try{digest=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));current();
    if(Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('')!==descriptor.sha256)throw new Error('E2EE_ARCHIVE_FILE_INTEGRITY');
   }finally{raw.fill(0);digest?.fill(0);}
   preserved.push(Object.freeze({descriptor,bytes:candidate.bytes,...(rawDescriptor===undefined?{}:{rawDescriptor})}));
  }
  const selections=[form?.file,...valueForm?.manifests.map(item=>item.manifest.file)??[]];
  for(const selected of selections){if(!selected)continue;const found=preserved.find(file=>file.descriptor.id===selected.id)?.descriptor;
   if(!found||selected.size!==found.length||selected.name!==displayName(found.name)||selected.type!==mime(found.type)||selected.lastModified!==(found.lastModified??0))throw new Error('E2EE_ARCHIVE_FILE_INTEGRITY');}
  output.push(Object.freeze({id:row.id,source:'backup-panel',mounted:row.mounted,rawForm:row.rawForm as string|null,form,valueForm,files:Object.freeze(preserved)}));
 }
 current();return Object.freeze(output);
}

/** Normalize the actual AuthController capture only AFTER it has been protected.
 * Old LocalCipher/account envelopes remain source inputs requiring authenticated
 * opening; this function neither returns complete=true nor claims portability. */
export async function normalizeNativeArchiveCapture(input:unknown,current:()=>void){
 current();exactKeys(input,['protocol','ownerId','scopeId','capturedAt','platform','inventoryVersion','generation','pendingGeneration','history','protectedState','safety','forms']);
 if(input.protocol!==1||input.platform!=='android'||input.inventoryVersion!==1||typeof input.capturedAt!=='string'||!Number.isFinite(Date.parse(input.capturedAt)))invalid();
 assertTechnical(input.ownerId);assertTechnical(input.scopeId);integer(input.generation);if(input.pendingGeneration!==null)integer(input.pendingGeneration);
 const ownerId=input.ownerId,scopeId=input.scopeId,capturedAt=input.capturedAt,generation=input.generation,pendingGeneration=input.pendingGeneration;
 const frozen={protectedState:input.protectedState,safety:structuredClone(input.safety),forms:structuredClone(input.forms),history:input.history};
 const protectedState=await parseNativeProtectedArchive(frozen.protectedState,ownerId,current);
 const safety=await planNativeSafetyArchives(frozen.safety,ownerId,current),forms=await normalizeNativeArchiveForms(frozen.forms,ownerId,current);
 let history:Row|null=null;
 if(frozen.history!==null){text(frozen.history,500);const parsed=parseLegacyMigrationJson(frozen.history,'E2EE_ARCHIVE_SOURCE_INVALID',500);object(parsed);
  if(Object.keys(parsed).some(key=>!['attempt','success'].includes(key)))invalid();for(const value of Object.values(parsed))if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))invalid();history=parsed;}
 current();return{protocol:1 as const,ownerId,scopeId,capturedAt,generation,pendingGeneration,protectedState,safety,forms,history,originalHistory:frozen.history};
}
