import {backupBytes} from '../backup-format.ts';
import {exactKeys} from './keys.ts';
import type {SharedContentRecord,SharedRecordBody} from './shared-domain.ts';

const extensions=new Set(['jpg','jpeg','png','webp','gif','bmp','tif','tiff','pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','txt','csv']);
export function sharedFilename(value:unknown){if(typeof value!=='string'||!value.trim()||Array.from(value).length>180||/[/\\\x00-\x1f\x7f]/.test(value)||!extensions.has(value.split('.').at(-1)!.toLowerCase()))throw new Error('INVALID_TASK_FILENAME');return value;}
export function openSharedFileInput(data:unknown,image=false){
 if(typeof data!=='string'||data.length>15*1024*1024)throw new Error('TASK_FILES_TOO_LARGE');const comma=data.indexOf(',');if(comma<0||comma>160)throw new Error('INVALID_TASK_FILE');
 const header=data.slice(0,comma);if(!/^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64$/.test(header))throw new Error('INVALID_TASK_FILE');
 const mediaType=header.slice(5,-7).toLowerCase(),bytes=backupBytes(data.slice(comma+1),image?3*1024*1024:10*1024*1024);
 try{if(!bytes.length)throw new Error('INVALID_TASK_FILE');if(image){const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte),webp=String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
   if(!(mediaType==='image/jpeg'&&jpeg||mediaType==='image/png'&&png||mediaType==='image/webp'&&webp))throw new Error('INVALID_TASK_IMAGE');}
  return{bytes,mediaType};
 }catch(error){bytes.fill(0);throw error;}
}
export type SharedFileReference={objectId:string;size:number;filename:string;mediaType:string};
export function sharedFileReference(row:SharedContentRecord|undefined):SharedFileReference{const value=row?.file;exactKeys(value,['objectId','size','filename','mediaType']);return value as SharedFileReference;}
/** The task's signed encrypted body includes every file reference. Approvals
 * therefore bind the exact files, rather than following independently mutable
 * child records after a person has reviewed the proposed task. */
export function prepareSharedTaskFiles(body:SharedRecordBody,input:Record<string,unknown>,requestId:string,time:string){
 const id=body.record.id;let attachments=structuredClone(body.related.shared_task_attachments??[]),images=structuredClone(body.related.shared_task_images??[]);
 if(Object.hasOwn(input,'removeAttachmentIds')){if(!Array.isArray(input.removeAttachmentIds)||input.removeAttachmentIds.length>5||new Set(input.removeAttachmentIds).size!==input.removeAttachmentIds.length)throw new Error('INVALID_TASK_FILE_REMOVAL');for(const removed of input.removeAttachmentIds)if(!attachments.some(row=>row.id===removed))throw new Error('INVALID_TASK_FILE_REMOVAL');attachments=attachments.filter(row=>!(input.removeAttachmentIds as unknown[]).includes(row.id));}
 if(Object.hasOwn(input,'attachments')){
  if(!Array.isArray(input.attachments)||attachments.length+input.attachments.length>5)throw new Error('TOO_MANY_TASK_FILES');
  for(const [index,value]of input.attachments.entries()){exactKeys(value,['name','data']);const filename=sharedFilename(value.name),file=openSharedFileInput(value.data);
   try{attachments.push({id:crypto.randomUUID(),task_id:id,mime_type:file.mediaType,byte_size:file.bytes.length,created_at:time,file:{objectId:`shared-file:${requestId}:attachment:${index}`,size:file.bytes.length,filename,mediaType:file.mediaType}});}finally{file.bytes.fill(0);}
  }
 }
 if(attachments.length>5||attachments.reduce((sum,row)=>sum+sharedFileReference(row).size,0)>10*1024*1024)throw new Error('TASK_FILES_TOO_LARGE');
 if(Object.hasOwn(input,'imageData')){
  if(input.imageData===null||input.imageData==='')images=[];
  else{const file=openSharedFileInput(input.imageData,true);try{const filename=file.mediaType==='image/jpeg'?'image.jpg':file.mediaType==='image/png'?'image.png':'image.webp';images=[{task_id:id,mime_type:file.mediaType,byte_size:file.bytes.length,updated_at:time,file:{objectId:`shared-file:${requestId}:image`,size:file.bytes.length,filename,mediaType:file.mediaType}}];}finally{file.bytes.fill(0);}}
 }
 body.related.shared_task_attachments=attachments;body.related.shared_task_images=images;
}
export function sharedRequestFileInputs(body:SharedRecordBody,input:Record<string,unknown>,requestId:string){
 const uploads:{reference:SharedFileReference;bytes:Uint8Array}[]=[];
 try{
  if(Array.isArray(input.attachments))for(const [index,value]of input.attachments.entries()){
   exactKeys(value,['name','data']);const objectId=`shared-file:${requestId}:attachment:${index}`,row=body.related.shared_task_attachments?.find(row=>sharedFileReference(row).objectId===objectId);if(!row)throw new Error('E2EE_CORRUPT_OUTBOX');
   const reference=sharedFileReference(row),file=openSharedFileInput(value.data);uploads.push({reference,bytes:file.bytes});if(reference.filename!==value.name||reference.mediaType!==file.mediaType||reference.size!==file.bytes.length)throw new Error('E2EE_CORRUPT_OUTBOX');
  }
  if(input.imageData!==undefined&&input.imageData!==null&&input.imageData!==''){
   const reference=sharedFileReference(body.related.shared_task_images?.[0]),file=openSharedFileInput(input.imageData,true);uploads.push({reference,bytes:file.bytes});if(reference.objectId!==`shared-file:${requestId}:image`||reference.mediaType!==file.mediaType||reference.size!==file.bytes.length)throw new Error('E2EE_CORRUPT_OUTBOX');
  }return uploads;
 }catch(error){uploads.forEach(row=>row.bytes.fill(0));throw error;}
}
