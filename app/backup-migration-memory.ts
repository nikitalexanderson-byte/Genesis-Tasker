import {assertTechnical} from './e2ee/keys.ts';
import {encodeE2eeBytes} from './e2ee/envelope.ts';
import {BACKUP_MAX_FILE} from './backup-format.ts';

export type BackupMigrationForm={state:unknown;file:File|null;settled:boolean};
export type BackupMigrationCapture={source:string;mounted:boolean;settled:boolean;state:unknown;
 file:{name:string;type:string;size:number;lastModified:number;bytes:string}|null};
type Editor={source:string;read:()=>BackupMigrationForm};
type Session={mounted:Map<object,Editor>;detached:{source:string;form:BackupMigrationForm}[];tasks:number;revision:number};
const sessions=new Map<string,Session>();let listening=false;
const MAX=48*1024*1024,encoder=new TextEncoder();
function session(ownerId:string){
 assertTechnical(ownerId);if(!listening&&typeof window!=='undefined'){listening=true;window.addEventListener('genesis-local-session-ended',clearBackupMigrationMemory);}
 let value=sessions.get(ownerId);if(!value){value={mounted:new Map(),detached:[],tasks:0,revision:0};sessions.set(ownerId,value);}return value;
}
function copy(form:BackupMigrationForm):BackupMigrationForm{return{state:structuredClone(form.state),file:form.file,settled:form.settled};}
/** Selected files and input keys stay in this login's memory. Only the complete
 * source coordinator may persist capture output, under the NEW unlocked root.
 * Page navigation retains unfinished imports; logout discards this memory. */
export function registerBackupMigrationEditor(ownerId:string,source:string,read:()=>BackupMigrationForm){
 if(!source||source.length>128)throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');const value=session(ownerId),token={};
 value.mounted.set(token,{source,read});value.revision++;
 return()=>{if(sessions.get(ownerId)!==value||!value.mounted.delete(token))return;value.revision++;
  if(value.detached.length>=1000)throw new Error('E2EE_SOURCE_TOO_LARGE');value.detached.push({source,form:copy(read())});};
}
/** Refuse capture while any import, decryption, preview, restore or export is
 * still in progress. A generation/fence cannot bisect an uncertain operation. */
export async function withBackupEditorTask<T>(ownerId:string,operation:()=>Promise<T>):Promise<T>{
 const value=session(ownerId);value.tasks++;value.revision++;
 try{return await operation();}finally{value.tasks--;value.revision++;}
}
export async function captureBackupMigrationEditors(ownerId:string,assertCurrent:()=>void):Promise<BackupMigrationCapture[]>{
 assertTechnical(ownerId);assertCurrent();const value=sessions.get(ownerId);if(!value)return[];
 if(value.tasks)throw new Error('E2EE_ARCHIVE_OPERATION_IN_PROGRESS');const revision=value.revision;
 const originals=[...value.detached.map(row=>({...row,mounted:false})),
  ...[...value.mounted.values()].map(editor=>({source:editor.source,form:copy(editor.read()),mounted:true}))];
 if(originals.length>1000)throw new Error('E2EE_SOURCE_TOO_LARGE');
 const current=()=>{assertCurrent();if(sessions.get(ownerId)!==value||value.revision!==revision||value.tasks)throw new Error('E2EE_ARCHIVE_CAPTURE_CHANGED');};
 const result:BackupMigrationCapture[]=[];let bytes=0;
 for(const row of originals){
  current();if(row.mounted&&!row.form.settled)throw new Error('E2EE_ARCHIVE_OPERATION_IN_PROGRESS');
  const file=row.form.file;let captured:BackupMigrationCapture['file']=null;
  if(file){
   if(!Number.isSafeInteger(file.size)||file.size<0||file.size>BACKUP_MAX_FILE)throw new Error('E2EE_SOURCE_TOO_LARGE');
   const raw=new Uint8Array(await file.arrayBuffer());
   try{current();if(raw.length!==file.size)throw new Error('E2EE_ARCHIVE_CAPTURE_CHANGED');
    captured={name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,bytes:encodeE2eeBytes(raw)};
   }finally{raw.fill(0);}
  }
  const entry={source:row.source,mounted:row.mounted,settled:row.form.settled,state:row.form.state,file:captured};
  const encoded=encoder.encode(JSON.stringify(entry));bytes+=encoded.length;encoded.fill(0);
  if(bytes>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');result.push(entry);
 }
 current();const after=[...value.mounted.values()];const before=originals.filter(row=>row.mounted);
 if(after.length!==before.length||after.some((editor,index)=>{const form=editor.read(),old=before[index];
  return editor.source!==old.source||form.file!==old.form.file||form.settled!==old.form.settled||JSON.stringify(form.state)!==JSON.stringify(old.form.state);
 }))throw new Error('E2EE_ARCHIVE_CAPTURE_CHANGED');
 current();return result;
}
export function clearBackupMigrationMemory(){sessions.clear();}
